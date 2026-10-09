# Day27 control experiments. D*: put deletion code into src and run the architecture tests.
# C*: remove one safeguard from SalesCoreDbContext and run the integration tests. Always restore byte-for-byte.
# ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$out = Join-Path $env:TEMP 'claude\day27'
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$context = 'src\SalesCore.Infrastructure\Persistence\SalesCoreDbContext.cs'
$config = 'src\SalesCore.Infrastructure\Persistence\Configurations.cs'

function Probe([string]$ns, [string]$usings, [string]$body) {
    "$usings`nnamespace $ns;`ninternal static class DeleteProbe`n{`n$body`n}`n"
}
$efUsings = "using Microsoft.EntityFrameworkCore;`nusing SalesCore.Domain;`nusing SalesCore.Infrastructure.Persistence;"

$cases = @(
    @{ id = 'D1-DbContext.Remove'; tests = 'Architecture'
       newFile = 'src\SalesCore.Infrastructure\DeleteProbe.cs'
       content = (Probe 'SalesCore.Infrastructure' $efUsings '    public static void Run(SalesCoreDbContext db, SalesOrder order) => db.Remove(order);') },
    @{ id = 'D2-DbSet.RemoveRange'; tests = 'Architecture'
       newFile = 'src\SalesCore.Infrastructure\DeleteProbe.cs'
       content = (Probe 'SalesCore.Infrastructure' $efUsings '    public static void Run(SalesCoreDbContext db, SalesRecord[] records) => db.SalesRecords.RemoveRange(records);') },
    @{ id = 'D3-ExecuteDeleteAsync'; tests = 'Architecture'
       newFile = 'src\SalesCore.Infrastructure\DeleteProbe.cs'
       content = (Probe 'SalesCore.Infrastructure' $efUsings '    public static Task<int> Run(SalesCoreDbContext db) => db.Shipments.Where(s => s.Status == ShipmentStatus.Cancelled).ExecuteDeleteAsync();') },
    @{ id = 'D4-raw-DELETE-sql'; tests = 'Architecture'
       newFile = 'src\SalesCore.Infrastructure\DeleteProbe.cs'
       content = (Probe 'SalesCore.Infrastructure' $efUsings '    public static int Run(SalesCoreDbContext db) => db.Database.ExecuteSqlRaw("delete from sales_records where id = 1");') },
    @{ id = 'D5-Remove-in-Api-project'; tests = 'Architecture'
       newFile = 'src\SalesCore.Api\DeleteProbe.cs'
       content = (Probe 'SalesCore.Api' $efUsings '    public static void Run(SalesCoreDbContext db, Customer customer) => db.Customers.Remove(customer);') },
    @{ id = 'D6-known-gap-List.Remove-in-domain'; tests = 'Architecture'
       newFile = 'src\SalesCore.Domain\DeleteProbe.cs'
       content = (Probe 'SalesCore.Domain' '' '    public static bool Run(List<SalesOrderLine> lines, SalesOrderLine line) => lines.Remove(line);') },
    @{ id = 'C1-no-RejectDeletes'; tests = 'Integration'; file = $context
       old = "        RejectDeletes();`r`n"; oldLf = "        RejectDeletes();`n"; new = '' },
    @{ id = 'C2-no-TouchAggregateRoots'; tests = 'Integration'; file = $context
       old = "        TouchAggregateRoots();`r`n"; oldLf = "        TouchAggregateRoots();`n"; new = '' },
    @{ id = 'C3-RowVersion-not-concurrency-token'; tests = 'Integration'; file = $config
       old = 'b.Property<int>(RowVersion).IsConcurrencyToken();'; new = 'b.Property<int>(RowVersion);' },
    @{ id = 'C4-RowVersion-not-incremented'; tests = 'Integration'; file = $context
       old = 'version.CurrentValue = (int)version.OriginalValue! + 1;'; new = 'version.CurrentValue = (int)version.OriginalValue!;' }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($c in $cases) {
    $restore = $null; $created = $null
    try {
        if ($c.newFile) {
            $created = Join-Path $repo $c.newFile
            [IO.File]::WriteAllText($created, $c.content, $utf8)
        } else {
            $path = Join-Path $repo $c.file
            $restore = @{ path = $path; bytes = [IO.File]::ReadAllBytes($path) }
            $text = [IO.File]::ReadAllText($path, $utf8)
            $old = $c.old
            if (-not $text.Contains($old)) { if ($c.oldLf -and $text.Contains($c.oldLf)) { $old = $c.oldLf } else { throw "pattern not found: $($c.id)" } }
            [IO.File]::WriteAllText($path, $text.Replace($old, $c.new), $utf8)
        }
        $project = Join-Path $repo "tests\SalesCore.$($c.tests).Tests"
        $trx = "$($c.id).trx"
        $ErrorActionPreference = 'Continue'
        $log = & dotnet test $project --nologo --logger "trx;LogFileName=$trx" --results-directory $out 2>$null | Out-String
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
        if ($created -and (Test-Path -LiteralPath $created)) { Remove-Item -LiteralPath $created }
        if ($restore) { [IO.File]::WriteAllBytes($restore.path, $restore.bytes) }
    }
}
[IO.File]::WriteAllLines((Join-Path $out 'mutations.txt'), $report, $utf8)
$report
git -C $repo status --short
