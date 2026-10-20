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

## 追加：足したルールと同じ形（`*` の前に空白）の実測

sales-core の PR #6 の AI レビューに、「実験したルールは `*` の前に空白が無く、足した3本（`PowerShell(git push --force *)` など）と形が違う」と指摘された。そこで、同じ形の無害なルール `PowerShell(Write-Output guard-probe-7f3a *)` で確かめた。

本物の `git push --force` は使わなかった。理由は2つある。
- 止まらなければ、実際に push してしまう。
- dev-guard のフックも同じコマンドを止めるので、どちらが止めたかを区別できない。

| # | コマンド | 結果 |
|---|---|---|
| 7 | `Write-Output guard-probe-7f3a`（引数なし） | 拒否 |
| 8 | `Write-Output guard-probe-7f3a extra`（引数あり） | 拒否 |
| 9 | `Write-Output guard-probe-7f3aX`（続けて書く） | 実行された（空白の区切りが要る） |
| 10 | `Write-Output extra guard-probe-7f3a`（引数を前に置く） | 実行された（先頭一致なので抜ける） |

ここから読めること:
- `PowerShell(git push --force *)` は、`git push --force` と `git push --force origin main` を止める。
- `git push origin main --force` は止めない。

## 副産物：dev-guard の誤検知

この追記を heredoc で書こうとしたら、Bash のコマンドの中にあった文字列 `git push --force`（文書の中身）が理由で、pre-bash-guard に止められた。
- 原因: ガードは、コマンド全体を単語に分けて判定する。そのため、heredoc や文字列の中身と、実際に実行するコマンドを区別できない。
- 安全側の誤検知（止めすぎ）なので、そのままにする。文書は Edit ツールで書き、git は別のコマンドで実行して避けた。
