# Day30 control experiments: put one plausible bug into the order/shipment API and run the API tests.
# Always restore byte-for-byte. Local only (never pushed). ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$out = Join-Path $env:TEMP 'claude\day30'
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$useCases = 'src\SalesCore.Application\SalesOrderUseCases.cs'
$program = 'src\SalesCore.Api\Program.cs'

$cases = @(
    @{ id = 'A1-ignore-requested-unit-price'; file = $useCases
       old = 'requested.UnitPrice ?? product.StandardPrice'; new = 'product.StandardPrice' },
    @{ id = 'A2-billing-customer-not-copied'; file = $useCases
       old = 'customer.BillingTarget.Id'; new = 'customer.Id' },
    @{ id = 'A3-tax-rate-ignores-order-date'; file = $useCases
       old = 'r.ValidFrom <= date && (r.ValidTo == null || r.ValidTo >= date)'; new = 'r.ValidTo == null' },
    @{ id = 'A4-state-error-as-400'; file = $program
       old = 'BusinessRuleException e => (StatusCodes.Status409Conflict'; new = 'BusinessRuleException e => (StatusCodes.Status400BadRequest' },
    @{ id = 'A5-approve-not-saved'; file = $useCases
       old = "change(await LoadOrderAsync(id));`r`n        await db.SaveChangesAsync();"; oldLf = "change(await LoadOrderAsync(id));`n        await db.SaveChangesAsync();"
       new = 'change(await LoadOrderAsync(id));' },
    @{ id = 'A6-warehouse-not-checked'; file = $useCases
       old = 'w.Code == request.WarehouseCode && w.IsActive'; new = 'w.IsActive' },
    @{ id = 'A7-inactive-customer-accepted'; file = $useCases
       old = 'c.Code == request.CustomerCode && c.IsActive'; new = 'c.Code == request.CustomerCode' },
    @{ id = 'A8-inactive-product-accepted'; file = $useCases
       old = 'p.Code == requested.ProductCode && p.IsActive'; new = 'p.Code == requested.ProductCode' },
    @{ id = 'A9-inactive-warehouse-accepted'; file = $useCases
       old = 'w.Code == request.WarehouseCode && w.IsActive'; new = 'w.Code == request.WarehouseCode' },
    @{ id = 'A10-any-InvalidOperationException-as-409-with-message'; file = $program
       old = '_ => (StatusCodes.Status500InternalServerError'; new = 'InvalidOperationException e => (StatusCodes.Status409Conflict, e.Message), _ => (StatusCodes.Status500InternalServerError' },
    @{ id = 'A11-concurrency-not-409'; file = $program
       old = 'DbUpdateConcurrencyException => (StatusCodes.Status409Conflict'; new = 'DbUpdateConcurrencyException => (StatusCodes.Status500InternalServerError' },
    @{ id = 'A12-shipped-before-ordered-accepted'; file = $useCases
       old = 'if (request.ShippedOn < ordered.OrderedOn)'; new = 'if (request.ShippedOn < DateOnly.MinValue)' }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($c in $cases) {
    $path = Join-Path $repo $c.file
    $bytes = [IO.File]::ReadAllBytes($path)
    try {
        $text = [IO.File]::ReadAllText($path, $utf8)
        $old = $c.old
        if (-not $text.Contains($old)) { if ($c.oldLf -and $text.Contains($c.oldLf)) { $old = $c.oldLf } else { throw "pattern not found: $($c.id)" } }
        [IO.File]::WriteAllText($path, $text.Replace($old, $c.new), $utf8)
        $trx = "$($c.id).trx"
        $ErrorActionPreference = 'Continue'
        $log = & dotnet test (Join-Path $repo 'tests\SalesCore.Integration.Tests') --nologo --filter 'FullyQualifiedName~SalesOrderApiTests' --logger "trx;LogFileName=$trx" --results-directory $out 2>$null | Out-String
        $ErrorActionPreference = 'Stop'
        if ($log -match ' error CS') {
            $report.Add("## $($c.id): BUILD ERROR")
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
$report
git -C $repo status --short
