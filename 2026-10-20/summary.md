# Day33 学習記録（2026-10-20）— ガードの定期実行とWindowsの整理

基幹システム開発計画の19日目。2週目（2026-09-14）から持ち越していた、Windows の未確認の3件（PreToolUse の `decision: 'block'` の非推奨、PowerShell 用の deny ルール、タイムアウト後の孫プロセス）に、実測で結論を出した。ガードの実効性テスト（guard-e2e）を週1回の定期実行にし、タスクスケジューラから無人で完走することを確かめた。Day32 から持ち越した「プラグインから呼ぶ Stop・PreCompact の発火」も確かめた。

**完了条件「`guard-matrix.md` に未検証セルが無く、週1回の実行が無人で完走する」は達成した。**
- タスクスケジューラから起動した guard-e2e は、7セルすべて合格して exit=0 で終わった。
- PowerShell の deny ルールの行を「手動」から「自動」に上げた。

## 今日行った処理

### 1. Windows の未確認3件の結論

| 件 | 結論 | 根拠 | 対応 |
|---|---|---|---|
| PreToolUse の `decision: 'block'` | **非推奨だった**。`block` は `deny` に読み替えられるので、今まで動いていた | 公式ドキュメント（hooks）。PreToolUse は `hookSpecificOutput.permissionDecision` を使う。PostToolUse と Stop は上の階層の `decision` が今も正式 | pre-bash-guard を `permissionDecision: 'deny'` に移した。dev-guard 1.3.1 |
| PowerShell 用の deny ルール | **`PowerShell(...)` で書く**。別名と複合コマンドも見る。先頭一致なので、並べ替えると抜ける | 公式ドキュメント（permissions）＋このセッションで対照実験10通り | Study と sales-core に3本を足した。guard-e2e にセルを足した |
| タイムアウト後の孫プロセス | **残る**。打ち切った後は `taskkill /T` も届かない | 実測（`evidence/2026-10-20-grandchild.js`） | post-edit-test に限界として注記した。害が出たら直す |

#### `decision: 'block'` の移行（TDD）

- テストの判定を、新しい形（`hookSpecificOutput.permissionDecision === 'deny'`、上の階層の `decision` が無い、理由の先頭が `[pre-bash-guard]`）に変えた。先に、止めるべき 42件が失敗することを確かめた。
- 実装を直した後は 68件すべて成功した。
- このセッションの Bash と PowerShell で、実際に止まることを確かめた（Study は作業中のソースをそのまま読む）。
- 版を dev-guard 1.3.1 に上げ、タグを打った。sales-core の参照も上げた。

#### PowerShell の deny ルールの対照実験（`evidence/2026-10-20-powershell-deny.md`）

このセッションの `settings.json` に、無害な一時的なルールを足して試した。

| # | ルール | コマンド | 結果 |
|---|---|---|---|
| 1 | `…guard-probe-deny-7f3a*)` | `Write-Output guard-probe-deny-7f3a` | 拒否 |
| 2（対照） | 同上 | `Write-Output guard-probe-allow-7f3a` | 実行 |
| 3 | 同上 | `echo guard-probe-deny-7f3a`（別名） | 拒否 |
| 4 | 同上 | `Write-Output ok; Write-Output guard-probe-deny-7f3a` | 拒否 |
| 5 | 同上 | Bash ツールで `echo guard-probe-deny-7f3a` | 実行（PowerShell 用は Bash に効かない） |
| 6 | 同上 | `Write-Output -InputObject guard-probe-deny-7f3a` | **実行**（名前付き引数で抜ける） |
| 7 | `…guard-probe-7f3a *)`（空白あり） | `Write-Output guard-probe-7f3a`（引数なし） | 拒否 |
| 8 | 同上 | `Write-Output guard-probe-7f3a extra` | 拒否 |
| 9 | 同上 | `Write-Output guard-probe-7f3aX` | 実行（空白の区切りが要る） |
| 10 | 同上 | `Write-Output extra guard-probe-7f3a` | **実行**（並べ替えで抜ける） |

- 7〜10 は、sales-core の PR の AI レビューの指摘で足した。最初の実験では、足したルール（`git push --force *`、`*` の前に空白あり）と形が違っていたため。
- 本物の `git push --force` は使わなかった。止まらなければ実際に push してしまううえ、dev-guard のフックも同じコマンドを止めるので、どちらが止めたかを区別できない。

#### 孫プロセス（`evidence/2026-10-20-grandchild.js`）

| 手順 | 結果 |
|---|---|
| `execSync`（cmd 経由、上限1秒）で、4秒後にファイルを書く node を起動する | 1021ms で `ETIMEDOUT` が返る |
| 6秒後にファイルを確かめる | **ある** → 孫は打ち切り後も動き続けた |
| `spawnSync` で pid を取り、打ち切り後に `taskkill /PID … /T /F` する | 「プロセスが見つからない」で失敗し、孫は残った |

- post-edit-test のテストが時間切れになると、`npm test` や `dotnet test` の本体が残る。
- 直すなら、非同期の `spawn` と自前の時間切れにして、シェルが生きているうちに `taskkill /T /F` で木ごと止める。今は害が出ていないので、注記（`ponytail:`）だけにした。

### 2. guard-e2e の週1回の定期実行

- 入口として `checks/guard-e2e.cmd` を作った（health-check.cmd と同じ形。cmd.exe は Shift-JIS で読むので、コメントは ASCII）。
- タスク `vibe-study-guard-e2e` を登録した（毎週月曜 9:00、ログオン中だけ動く。本人の決定）。
- **失敗を見逃さない仕組み:** 毎日の健康診断が `guard-e2e.log` の最後の行を読み、8日を過ぎるか不合格なら NG にする（`guardE2eStatus`。テストを先に書いた）。
- **認証は `/login` だけにした**（本人の決定）。ログインが切れると guard-e2e は判定不能で不合格になるので、健康診断の NG で気付ける。
- **無人の実測:** 本人が `/login` した後、`Start-ScheduledTask` で起動した。

| 項目 | 値 |
|---|---|
| 実行時間 | 10:02:55 → 10:10:37（約7分40秒）、exit=0 |
| 結果 | **7セルすべて合格**（PowerShell の deny ルールのセルを含む） |
| 費用（API 換算） | $0.0631（前回 9/29 の6セルは $0.5336。理由は未確認） |
| 健康診断 | 14/14 OK（新しい項目「ガードの実効性テスト（週1回）の結果」も OK） |

### 3. プラグインから呼ぶ Stop・PreCompact の発火（Day32 からの持ち越し）

新しいセッションを `claude -p` で起動して確かめた（`evidence/2026-10-20-unattended-and-plugin-hooks.md`）。

| イベント | 確かめ方 | 記録 |
|---|---|---|
| 起動 | `system:init` の `plugins` | `dev-guard` 1.3.1、パスは `Study\plugins\dev-guard`（作業中のソース） |
| Stop | 未追跡のファイルを Write させて返事を終わらせる | `hook_success Stop node "${CLAUDE_PLUGIN_ROOT}/hooks/session-hooks.js" stop` →「Study に未コミットの変更が 1 件」 |
| PreCompact | `--resume` して `/compact` | `PreCompact [node "${CLAUDE_PLUGIN_ROOT}/hooks/session-hooks.js" pre-compact docs/decisions] completed successfully`。決定が無いので書き出しなし（意図どおり） |

出力の無いフックは、会話の記録に `hook_success` を残さない。PreCompact の発火の証拠は、`/compact` の出力に出る1行だけだった。

### 4. AIレビュー（[kiyo015/sales-core#6](https://github.com/kiyo015/sales-core/pull/6)）

| 対象 | 判定 | 費用（API換算） | 時間 |
|---|---|---|---|
| 39426c4（PowerShell の deny ルール） | 修正後マージ可（Important 1・Minor 2） | $0.1524 | 30秒 |
| 899de02（dev-guard 1.3.1） | 修正後マージ可（Important 2・Minor 2） | $0.1460 | 26秒 |
| 04cccc3（指摘を直した後） | マージ可（Minor 2） | $0.1464 | 30秒 |

- **採用した指摘:**
  - 足したルールと同じ形でも実験する。
  - PR の本文に 1.3.1 の変更を書く。
  - CLAUDE.md で、確認した日と根拠を分けて書く。
  - 削除は dev-guard のフックだけで止めていることを書き分ける。
  - タグが指すコミットを本文に書き添える。
- **残した指摘:** 「足した3本そのものは試していない」。本物の強制 push は試せないので、同じ形の無害なルールで代えた。理由は本文と証拠に書いた。

## 今日学んだこと

- **「動いている」と「正しい書き方」は別物。** `decision: 'block'` はずっと動いていたが、PreToolUse では非推奨の書き方だった。動いていたのは、互換のために読み替えられていたから。2026-09-14 のレビューで指摘された時は「公式ドキュメントを確かめていない」と見送っていた。確かめれば数分で済んだ。
- **deny ルールの一致は先頭から。** 別名と複合コマンドは賢く見てくれるが、引数の並べ方は見ない。deny は「よくある書き方を止める」1段目と考え、並べ替えはフックで止める2段構えにする。
- **判定の目印は「実行した時にだけ出るもの」にする。** 拒否の文言にはコマンドがそのまま入る。コマンドに書いた文字列を目印にすると、止まったのに「実行された」と誤判定する（対照で確かめた）。
- **定期実行は、走らせるだけでは足りない。** 週1回の結果を毎日の健康診断が読むことで、失敗やログイン切れにその日のうちに気付ける。
- **公式ドキュメントにも、無人実行の注意があった。** `/login` は期限が切れると、無人のセッションが止まる。長く使えるトークン（`claude setup-token`）もあるが、環境変数に置くと全セッションがそれを使う。本人の判断で `/login` だけにした。

## つまずき

- **ガードの誤検知（止めすぎ）**
  - **症状:** 証拠の文書を heredoc で書くコマンドが、文書の中の文字列 `git push --force` を理由に pre-bash-guard に止められた。
  - **原因:** ガードはコマンド全体を単語に分けて判定するので、heredoc や文字列の中身と、実際に実行するコマンドを区別できない。
  - **対策:** 止めすぎの側なので、ガードは直さない。文書は Edit ツールで書き、git は別のコマンドにした。
- **`node --test` にフォルダを渡すと失敗する**
  - **症状:** 「fail 1」と出た。
  - **原因:** フォルダをモジュールとして読もうとして失敗しただけで、テストの失敗ではなかった。
  - **見落とし:** `&&` でつないだ後ろの grep は成功するので、そのままタグの push まで進んでしまった。テストのファイルを1つずつ流し直して、すべて成功していることは確かめた（15・68・7・21・9件）。
  - **教訓:** 判定は grep の成否ではなく、テストの終了コードで行う。
- **node -e の中のエスケープの崩れ（2回）**
  - **症状:** 正規表現の `\[` と文字列の `'\n'` が、シェルを通る間に崩れた。
  - **対策:** Edit ツールで直した。複数行の書き換えは Edit の方が確実。

## 成果物

**Study**
- [pre-bash-guard.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/plugins/dev-guard/hooks/pre-bash-guard.js) — `permissionDecision: 'deny'`
- [pre-bash-guard.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/plugins/dev-guard/hooks/pre-bash-guard.test.js)
- [post-edit-test.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/plugins/dev-guard/hooks/post-edit-test.js) — 孫プロセスの注記
- [plugin.json](https://github.com/kiyo015/vibe-coding-study/blob/day33/plugins/dev-guard/.claude-plugin/plugin.json) — 1.3.1
- [guard-e2e.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/guard-e2e.js) — PowerShell の deny ルールのセル
- [guard-e2e.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/guard-e2e.test.js)
- [guard-e2e.cmd](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/guard-e2e.cmd)
- [health-check.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/health-check.js) — `guardE2eStatus`
- [health-check.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/health-check.test.js)
- [guard-matrix.md](https://github.com/kiyo015/vibe-coding-study/blob/day33/checks/guard-matrix.md) — Windows の落とし穴の結論
- [.claude/settings.json](https://github.com/kiyo015/vibe-coding-study/blob/day33/.claude/settings.json)
- 証拠:
  - [powershell-deny.md](https://github.com/kiyo015/vibe-coding-study/blob/day33/evidence/2026-10-20-powershell-deny.md)
  - [grandchild.js](https://github.com/kiyo015/vibe-coding-study/blob/day33/evidence/2026-10-20-grandchild.js)
  - [unattended-and-plugin-hooks.md](https://github.com/kiyo015/vibe-coding-study/blob/day33/evidence/2026-10-20-unattended-and-plugin-hooks.md)

**sales-core**
- [.claude/settings.json](https://github.com/kiyo015/sales-core/blob/day33/.claude/settings.json) — PowerShell の deny ルール、`dev-guard-v1.3.1`
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day33/CLAUDE.md) — 禁止事項の表

## 次回予告

**Day34 — 総振り返りとチーム展開の準備**
- 段階1の振り返り。`templates/team-CLAUDE.md` を基幹システム版に更新する。
- 新しく参加した人が、初日に安全柵の動作を確認できる手順を書く。
- 段階2（画面と権限）を日単位に展開する。

**持ち越し（任意）**
- 二重請求のテストで、売上の請求書を読み込んでいないことも確かめる。
- 決定の書き出しで、秘密を機械で伏せる。
- 請求先を Domain で守る。
- 一意違反の文言を、制約ごとに分ける。
- 返品だけの締めの API テスト。
- Day30 からの3件。
- 孫プロセスの片付け（害が出たら）。
- guard-e2e の費用が下がった理由。
- 「定期タスク × 許可ルール」の自動化。
