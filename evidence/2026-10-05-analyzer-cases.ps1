# Day23 control experiments: put ONE kind of violation in, build, record error codes, restore.
# ASCII only (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\sakaguchi\sales-core'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$out = Join-Path $env:TEMP 'claude\day23'
New-Item -ItemType Directory -Force $out | Out-Null

function Probe([string]$ns, [string]$body) {
    "namespace $ns;`ninternal static class Probe`n{`n    internal static void Run(decimal amount)`n    {`n$body`n    }`n}`n"
}

$rounding = @'
        _ = Math.Round(amount);
        _ = Math.Round(amount, 0, MidpointRounding.AwayFromZero);
        _ = decimal.Round(amount, 0, MidpointRounding.AwayFromZero);
        _ = decimal.Truncate(amount);
        _ = Math.Floor(amount);
        _ = Convert.ToInt64(amount);
'@

$cases = @(
    @{ id = 'C0-baseline-no-violation'; project = 'src\SalesCore.Domain'; files = @{} },
    @{ id = 'C1-rounding-api-in-domain'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' $rounding) } },
    @{ id = 'C2-double-in-domain'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' '        double price = 1.5; _ = price;') } },
    @{ id = 'C3-float-cast-in-domain'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' '        var rate = (float)amount; _ = rate;') } },
    @{ id = 'C4-pragma-outside-money'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' "#pragma warning disable RS0030`n        _ = Math.Round(amount);`n#pragma warning restore RS0030") } },
    @{ id = 'C5-suppressmessage-outside-money'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = ("[System.Diagnostics.CodeAnalysis.SuppressMessage(""ApiDesign"", ""RS0030"")]`n" + (Probe 'SalesCore.Domain' '        _ = Math.Round(amount);')) } },
    @{ id = 'C6-nowarn-in-csproj'; project = 'src\SalesCore.Domain'; nowarn = 'src\SalesCore.Domain\SalesCore.Domain.csproj'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' '        _ = Math.Round(amount);') } },
    @{ id = 'C7-rounding-api-in-api-project'; project = 'src\SalesCore.Api'
       files = @{ 'src\SalesCore.Api\Probe.cs' = (Probe 'SalesCore.Api' '        _ = Math.Round(amount, 0, MidpointRounding.AwayFromZero);') } },
    @{ id = 'C8-double-in-infrastructure'; project = 'src\SalesCore.Infrastructure'
       files = @{ 'src\SalesCore.Infrastructure\Probe.cs' = (Probe 'SalesCore.Infrastructure' '        double price = 1.5; _ = price;') } },
    @{ id = 'C9-known-gap-var-double-and-long-cast'; project = 'src\SalesCore.Domain'
       files = @{ 'src\SalesCore.Domain\Probe.cs' = (Probe 'SalesCore.Domain' '        var price = 1.5; var yen = (long)amount; _ = price; _ = yen;') } }
)

$report = New-Object System.Collections.Generic.List[string]
foreach ($c in $cases) {
    $backup = $null
    try {
        foreach ($k in $c.files.Keys) { [IO.File]::WriteAllText((Join-Path $repo $k), $c.files[$k], $utf8) }
        if ($c.nowarn) {
            $proj = Join-Path $repo $c.nowarn
            # restore byte-for-byte later (the csproj starts with a BOM; re-encoding dropped it on the first run)
            $backup = [IO.File]::ReadAllBytes($proj)
            $text = [IO.File]::ReadAllText($proj)
            [IO.File]::WriteAllText($proj, $text.Replace('<Nullable>enable</Nullable>', '<Nullable>enable</Nullable><NoWarn>$(NoWarn);RS0030</NoWarn>'), $utf8)
        }
        $ErrorActionPreference = 'Continue'
        $log = & dotnet build (Join-Path $repo $c.project) --nologo --no-incremental 2>$null | Out-String
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $ids = ($log -split "`n") | Where-Object { $_ -match ': (error|warning) (\w+):' } | ForEach-Object {
            if ($_ -match '(\w+\.cs)?(\((\d+),\d+\))?\s*: (error|warning) (\w+):') { "$($Matches[5])$(if ($Matches[1]) { '@' + $Matches[1] + ':' + $Matches[3] })" }
        } | Sort-Object -Unique
        $report.Add(("{0}: exit {1} -> {2}" -f $c.id, $code, ($(if ($ids) { $ids -join ', ' } else { 'no errors' }))))
    } finally {
        foreach ($k in $c.files.Keys) { Remove-Item (Join-Path $repo $k) -ErrorAction SilentlyContinue }
        if ($backup) { [IO.File]::WriteAllBytes((Join-Path $repo $c.nowarn), $backup) }
    }
}
[IO.File]::WriteAllLines((Join-Path $out 'analyzer-cases.txt'), $report, $utf8)
$report
git -C $repo status --short
