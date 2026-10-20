# PowerShell ツールの deny ルールの実測（2026-10-20）

このセッション（Claude Code デスクトップ、Windows PowerShell 5.1）で、`Study/.claude/settings.json` の `permissions.deny` に
`PowerShell(Write-Output guard-probe-deny-7f3a*)` を一時的に足して、PowerShell ツールで次を実行した。
設定の変更は、セッションの途中でもすぐに効いた。

| # | ツール | コマンド | 結果 |
|---|---|---|---|
| 1 | PowerShell | `Write-Output guard-probe-deny-7f3a` | 拒否（`Permission to use PowerShell with command ... has been denied.`） |
| 2（対照） | PowerShell | `Write-Output guard-probe-allow-7f3a` | 実行された |
| 3 | PowerShell | `echo guard-probe-deny-7f3a`（`Write-Output` の別名） | 拒否 |
| 4 | PowerShell | `Write-Output ok; Write-Output guard-probe-deny-7f3a`（複合） | 拒否 |
| 5 | Bash | `echo guard-probe-deny-7f3a` | 実行された（PowerShell のルールは Bash に効かない） |
| 6 | PowerShell | `Write-Output -InputObject guard-probe-deny-7f3a`（引数に名前を付ける） | **実行された**（先頭一致なので抜ける） |

公式ドキュメント（code.claude.com/docs/en/permissions の「PowerShell」）の記述どおり。別名は正規化され、複合コマンドは1つずつ判定される。
ただし一致は先頭からなので、引数の並べ方を変えると抜ける。Bash の deny ルールと同じ限界（Day11 の `git -C .` と同じ）。
