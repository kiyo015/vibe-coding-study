# Day26 control experiments for the integration tests. Insert ONE fault, run the integration tests, restore byte-for-byte.
# ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$out = Join-Path $env:TEMP 'claude\day26'
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$config = 'src\SalesCore.Infrastructure\Persistence\Configurations.cs'
$migration = (Get-ChildItem (Join-Path $repo 'src\SalesCore.Infrastructure\Persistence\Migrations') -Filter '*_AddStageOneTables.cs').FullName.Substring($repo.Length + 1)
$ignoreAfterSave = '.Metadata.SetAfterSaveBehavior(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Ignore);'

$mutations = @(
    @{ id = 'F0-baseline'; file = $config; old = $null; new = $null },
    @{ id = 'F1-shipped-quantity-not-updated'; file = $config
       old = 'b.Property(l => l.ShippedQuantity).HasPrecision(QuantityPrecision, QuantityScale);'
       new = 'b.Property(l => l.ShippedQuantity).HasPrecision(QuantityPrecision, QuantityScale); b.Property(l => l.ShippedQuantity)' + $ignoreAfterSave },
    @{ id = 'F2-returned-quantity-not-updated'; file = $config
       old = 'b.Property(l => l.ReturnedQuantity).HasPrecision(QuantityPrecision, QuantityScale);'
       new = 'b.Property(l => l.ReturnedQuantity).HasPrecision(QuantityPrecision, QuantityScale); b.Property(l => l.ReturnedQuantity)' + $ignoreAfterSave },
    @{ id = 'F3-order-status-not-updated'; file = $config; firstOnly = $true
       old = 'b.Property(o => o.Status).HasConversion<string>().HasMaxLength(20);'
       new = 'b.Property(o => o.Status).HasConversion<string>().HasMaxLength(20); b.Property(o => o.Status)' + $ignoreAfterSave },
    @{ id = 'F4-hand-written-migration-sql-typo'; file = $migration
       old = "daterange(valid_from, valid_to, '[]')"
       new = "daterange(valid_from, valid_until, '[]')" }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($m in $mutations) {
    $path = Join-Path $repo $m.file
    $original = [IO.File]::ReadAllBytes($path)
    try {
        if ($m.old) {
            $text = [IO.File]::ReadAllText($path, $utf8)
            $i = $text.IndexOf($m.old)
            if ($i -lt 0) { throw "pattern not found: $($m.id)" }
            if ($m.firstOnly) { $text = $text.Substring(0, $i) + $m.new + $text.Substring($i + $m.old.Length) } else { $text = $text.Replace($m.old, $m.new) }
            [IO.File]::WriteAllText($path, $text, $utf8)
        }
        $trx = "$($m.id).trx"
        $ErrorActionPreference = 'Continue'
        $log = & dotnet test (Join-Path $repo 'tests\SalesCore.Integration.Tests') --nologo --logger "trx;LogFileName=$trx" --results-directory $out 2>$null | Out-String
        $ErrorActionPreference = 'Stop'
        if ($log -match ' error CS') {
            $report.Add("## $($m.id): BUILD ERROR")
        } else {
            [xml]$x = [IO.File]::ReadAllText((Join-Path $out $trx), $utf8)
            $results = $x.TestRun.Results.UnitTestResult
            $failed = @($results | Where-Object { $_.outcome -eq 'Failed' })
            $report.Add("## $($m.id): failed $($failed.Count) / total $(@($results).Count)")
            $failed | ForEach-Object { $_.testName -replace '^SalesCore\.Integration\.Tests\.', '' } | Sort-Object | ForEach-Object { $report.Add("  - $_") }
        }
    } finally {
        [IO.File]::WriteAllBytes($path, $original)
    }
}
[IO.File]::WriteAllLines((Join-Path $out 'mutations.txt'), $report, $utf8)
$report
git -C $repo status --short
