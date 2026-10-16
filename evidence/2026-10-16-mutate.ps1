# Day31 control experiments: put one plausible bug into closing/invoicing and run the tests.
# Always restore byte-for-byte. Local only (never pushed). ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$out = Join-Path $env:TEMP 'claude\day31'
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$useCases = 'src\SalesCore.Application\InvoiceUseCases.cs'
$invoice = 'src\SalesCore.Domain\Invoice.cs'
$api = @{ project = 'Integration'; filter = 'FullyQualifiedName~InvoiceApiTests' }
$domain = @{ project = 'Domain'; filter = 'FullyQualifiedName~InvoiceTests' }

$cases = @(
    @{ id = 'B1-tax-rounded-per-sales-record'; file = $invoice; tests = $api
       old = 'TaxAmount = tax.TaxTotal;'
       new = 'TaxAmount = salesRecords.Aggregate(Money.Zero, (t, r) => t + TaxCalculator.Calculate(r.Lines.Select(l => new TaxableLine(l.Amount, l.TaxRate))).TaxTotal);' },
    @{ id = 'B2-domain-double-billing-check-removed'; file = $invoice; tests = $domain
       old = 'if (records.FirstOrDefault(r => r.Invoice is not null) is { } billed)'; new = 'if (records.FirstOrDefault(r => false) is { } billed)' },
    @{ id = 'B3-already-invoiced-records-collected'; file = $useCases; tests = $api
       old = 'r.Invoice == null && '; new = '' },
    @{ id = 'B4-records-after-closing-date-collected'; file = $useCases; tests = $api
       old = ' && r.RecordedOn <= request.ClosingDate'; new = '' },
    @{ id = 'B5-other-billing-customers-collected'; file = $useCases; tests = $api
       old = 'EF.Property<long>(r, "BillingCustomerId") == customer.Id && '; new = '' },
    @{ id = 'B6-closing-date-not-checked'; file = $useCases; tests = $api
       old = 'if (!customer.IsClosingDate(request.ClosingDate))'; new = 'if (false)' },
    @{ id = 'B7-previous-closing-not-checked'; file = $useCases; tests = $api
       old = 'if (lastClosingDate >= request.ClosingDate)'; new = 'if (lastClosingDate > DateOnly.MaxValue)' },
    @{ id = 'B8-period-starts-on-previous-closing-date'; file = $useCases; tests = $api
       old = 'customer.PreviousClosingDate(request.ClosingDate)).AddDays(1);'; new = 'customer.PreviousClosingDate(request.ClosingDate));' },
    @{ id = 'B9-branch-can-be-closed'; file = $useCases; tests = $api
       old = 'if (customer.BillingCustomer is { } billingCustomer)'; new = 'if (customer.BillingCustomer is { } billingCustomer && billingCustomer.Id < 0)' }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($c in $cases) {
    $path = Join-Path $repo $c.file
    $bytes = [IO.File]::ReadAllBytes($path)
    try {
        $text = [IO.File]::ReadAllText($path, $utf8)
        if (-not $text.Contains($c.old)) { throw "pattern not found: $($c.id)" }
        [IO.File]::WriteAllText($path, $text.Replace($c.old, $c.new), $utf8)
        $trx = "$($c.id).trx"
        $ErrorActionPreference = 'Continue'
        $log = & dotnet test (Join-Path $repo "tests\SalesCore.$($c.tests.project).Tests") --nologo --filter $c.tests.filter --logger "trx;LogFileName=$trx" --results-directory $out 2>$null | Out-String
        $ErrorActionPreference = 'Stop'
        if ($log -match ' error CS') {
            $report.Add("## $($c.id): BUILD ERROR")
            ($log -split "`n" | Where-Object { $_ -match ' error CS' } | Select-Object -First 2) | ForEach-Object { $report.Add('  ' + $_.Trim()) }
        } else {
            [xml]$x = [IO.File]::ReadAllText((Join-Path $out $trx), $utf8)
            $results = $x.TestRun.Results.UnitTestResult
            $failed = @($results | Where-Object { $_.outcome -eq 'Failed' })
            $report.Add("## $($c.id): failed $($failed.Count) / total $(@($results).Count)")
            $failed | ForEach-Object { $_.testName -replace '^SalesCore\.\w+\.Tests\.', '' } | Sort-Object | ForEach-Object { $report.Add("  - $_") }
        }
    } finally {
        [IO.File]::WriteAllBytes($path, $bytes)
    }
}
[IO.File]::WriteAllLines((Join-Path $out 'mutations.txt'), $report, $utf8)
git -C $repo status --short
