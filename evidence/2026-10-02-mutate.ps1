# Control experiments: inject a wrong implementation, run the Domain tests, restore the file.
# ASCII only (Windows PowerShell 5.1 reads a BOM-less script as ANSI).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$src = Join-Path $repo 'src\SalesCore.Domain'
$out = Join-Path $env:TEMP 'claude\day22'
$utf8 = New-Object System.Text.UTF8Encoding($false)

$mutations = @(
    @{ id = 'M01-round-each-shipment'; file = 'SalesOrderLine.cs'
       old = 'return new SalesRecordLine(quantity, UnitPrice, TaxRate, SalesAmount - before);'
       new = 'return new SalesRecordLine(quantity, UnitPrice, TaxRate, Money.Round(UnitPrice * quantity));' },
    @{ id = 'M02-round-each-return'; file = 'SalesOrderLine.cs'
       old = 'return new SalesRecordLine(-quantity, UnitPrice, TaxRate, SalesAmount - before);'
       new = 'return new SalesRecordLine(-quantity, UnitPrice, TaxRate, -Money.Round(UnitPrice * quantity));' },
    @{ id = 'M03-ship-without-approval'; file = 'SalesOrder.cs'
       old = 'Require(Status is SalesOrderStatus.Approved or SalesOrderStatus.PartiallyShipped, "'
       new = 'Require(Status is SalesOrderStatus.Received or SalesOrderStatus.Approved or SalesOrderStatus.PartiallyShipped, "' },
    @{ id = 'M04-no-overship-check'; file = 'SalesOrderLine.cs'
       old = 'if (quantity > RemainingQuantity)'
       new = 'if (false)' },
    @{ id = 'M05-cancel-after-shipment'; file = 'SalesOrder.cs'
       old = 'Require(Status is SalesOrderStatus.Received or SalesOrderStatus.Approved, "'
       new = 'Require(Status is SalesOrderStatus.Received or SalesOrderStatus.Approved or SalesOrderStatus.PartiallyShipped, "' },
    @{ id = 'M06-confirm-twice'; file = 'Shipment.cs'
       old = "    public SalesRecord Confirm(DateOnly shippedOn)`r`n    {`r`n        RequireInstructed("
       new = "    public SalesRecord Confirm(DateOnly shippedOn)`n    {`n        // RequireInstructed("
       oldLf = "    public SalesRecord Confirm(DateOnly shippedOn)`n    {`n        RequireInstructed(" },
    @{ id = 'M07-no-precheck-of-all-lines'; file = 'SalesOrder.cs'
       old = "        EnsureCanShip(lines);`r`n        var record"
       new = "        var record" ; oldLf = "        EnsureCanShip(lines);`n        var record" },
    @{ id = 'M08-return-rewinds-shipped-quantity'; file = 'SalesOrderLine.cs'
       old = 'ReturnedQuantity += quantity;'
       new = 'ShippedQuantity -= quantity;' },
    @{ id = 'M09-public-sales-record-ctor'; file = 'SalesRecord.cs'
       old = 'internal SalesRecord(DateOnly'
       new = 'public SalesRecord(DateOnly' },
    @{ id = 'M10-invoice-from-order'; file = 'Invoice.cs'
       old = '    public static Invoice Create(IEnumerable<SalesRecord> salesRecords)'
       new = "    public static Invoice Create(SalesOrder order) => new([], TaxCalculator.Calculate(order.Lines.Select(l => new TaxableLine(l.Amount, l.TaxRate))));`n`n    public static Invoice Create(IEnumerable<SalesRecord> salesRecords)" },
    @{ id = 'M11-initial-status-approved'; file = 'SalesOrder.cs'
       old = '{ get; private set; } = SalesOrderStatus.Received;'
       new = '{ get; private set; } = SalesOrderStatus.Approved;' },
    @{ id = 'M12-shipped-if-any-line-done'; file = 'SalesOrder.cs'
       old = 'Status = _lines.All(line => line.RemainingQuantity == 0m)'
       new = 'Status = _lines.Any(line => line.RemainingQuantity == 0m)' },
    @{ id = 'M13-no-return-limit'; file = 'SalesOrderLine.cs'
       old = 'if (quantity > ShippedQuantity - ReturnedQuantity)'
       new = 'if (false)' },
    @{ id = 'M14-shipment-cancel-after-confirm'; file = 'Shipment.cs'
       old = "    public void Cancel()`r`n    {`r`n        RequireInstructed("
       new = "    public void Cancel()`n    {`n        // RequireInstructed("
       oldLf = "    public void Cancel()`n    {`n        RequireInstructed(" }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($m in $mutations) {
    $path = Join-Path $src $m.file
    $original = [IO.File]::ReadAllText($path, $utf8)
    try {
        $old = $m.old
        if (-not $original.Contains($old)) {
            if ($m.oldLf -and $original.Contains($m.oldLf)) { $old = $m.oldLf } else { throw "pattern not found: $($m.id)" }
        }
        $mutated = $original.Replace($old, $m.new)
        [IO.File]::WriteAllText($path, $mutated, $utf8)
        $trx = "$($m.id).trx"
        $ErrorActionPreference = 'Continue'
        $log = & dotnet test (Join-Path $repo 'tests\SalesCore.Domain.Tests') --nologo --logger "trx;LogFileName=$trx" --results-directory $out 2>$null | Out-String
        $ErrorActionPreference = 'Stop'
        $trxPath = Join-Path $out $trx
        if ($log -match ' error CS') {
            $report.Add("## $($m.id): BUILD ERROR")
            ($log -split "`n" | Where-Object { $_ -match ' error CS' } | Select-Object -First 3) | ForEach-Object { $report.Add("  " + $_.Trim()) }
        } else {
            [xml]$x = [IO.File]::ReadAllText($trxPath, $utf8)
            $results = $x.TestRun.Results.UnitTestResult
            $failed = @($results | Where-Object { $_.outcome -eq 'Failed' })
            $report.Add("## $($m.id): failed $($failed.Count) / total $(@($results).Count)")
            $failed | ForEach-Object { $_.testName -replace '^SalesCore\.Domain\.Tests\.', '' } | Sort-Object | ForEach-Object { $report.Add("  - $_") }
        }
    } finally {
        [IO.File]::WriteAllText($path, $original, $utf8)
    }
}
[IO.File]::WriteAllLines((Join-Path $out 'mutations.txt'), $report, $utf8)
git -C $repo status --short
