# Day32 学習記録（2026-10-19）— hooksの他イベントと健康診断のC#対応

基幹システム開発計画の18日目。前日のAIレビューで残った「二重請求の Domain の検査が、売上の請求書を読み込んでいるかに頼る」を直した。そのうえで、返事を終えた時（Stop）と会話を要約する前（PreCompact）に動くフックを作り、dev-guard 1.3.0 として配布した。健康診断には C# の項目を3つ足した。足した検査が、テストのプロジェクトに High の脆弱性が2件あることを初回で見つけた。

**完了条件「2つのイベントの発火を実測した記録がある。健康診断がC#の項目込みで無人完走する」は達成した。**
- Stop と PreCompact が受け取る JSON を記録した（`evidence/2026-10-19-hook-input.jsonl`）。
- `/compact` で PreCompact が発火し、決定を1件書き出した。
- 健康診断は 13/13 OK で完走した（245秒）。

## 今日行った処理

### 1. 二重請求の検査を、請求書を読み込まなくても効く形にした（Day31からの申し送り・優先）

| | 直す前 | 直した後 |
|---|---|---|
| 締め済みかの判定 | `Invoice is not null`（請求書を読み込んでいる時だけ分かる） | `IsBilled` ＝ `Invoice is not null \|\| InvoiceId is not null` |
| 請求書の番号（外部キー） | EF Core の影の列（Domain から見えない） | `SalesRecord.InvoiceId`（読み取り専用。外から付け替えられない） |
| 締めの対象の抽出 | 請求書との結合 | `r.InvoiceId == null`（Domain と同じ根拠） |
| 請求書を読み込まずに渡す | **素通りして、締め済みの売上が新しい請求書に付け替わる** | 409（`BusinessRuleException`） |

- **RED:** 結合テスト `請求書を読み込まずに渡しても_締め済みの売上は二重に請求できない` を先に書いた。10月に締めた売上を明細だけ読み込んで11月の締めに渡すと、直す前は例外が出ずに失敗した。
- **列は変わらない:** 列名は同じなので、マイグレーションは不要（`has-pending-model-changes` で変更なしを確認）。
- **AIレビューの Minor を採用:** テストは例外の種類だけでなく、文言に「締め済み」が入ることも確かめる。別の理由の 409 で緑にならないようにするため。

### 2. Stop と PreCompact が受け取るデータを、作る前に実測した

受け取ったものを一時フォルダに追記するだけの記録用フックを先に登録した。返事を終えた時と、本人の `/compact` の時に1回ずつ記録した。

| 項目 | Stop | PreCompact |
|---|---|---|
| 共通 | `session_id`・`transcript_path`・`cwd`・`scratchpad_dir`・`prompt_id`・`hook_event_name` | 同じ |
| 固有 | `stop_hook_active`・`last_assistant_message`・`background_tasks`・`session_crons` | `trigger`（実測は `manual`）・`custom_instructions`（実測は `null`） |
| 来なかったもの | — | `permission_mode`・`effort`（Stop には来る） |

- **会話の記録（`transcript_path`）:** 1ファイルで 54MB（JSONL）。
  - 本人の入力は、`type:'user'` で `message.content` が文字列の行。
  - 質問への回答は `toolUseResult.questions` と `toolUseResult.answers` にある。
- **設定の変更:** セッションの途中で `settings.json` に足したフックは、すぐに発火した。
- **会話の記録に残る形:** フックの実行は `hook_success` として、実行したコマンドごと残る。出力が無い回は残らない。

### 3. 2つのフックを作った（`session-hooks.js`、テスト7件）

| イベント | すること | 実測 |
|---|---|---|
| Stop | 今回の返事で `.cs` を編集した後に `dotnet test` を流していなければ知らせる。編集したリポジトリに未コミットの変更があれば件数を知らせる。止めない（`systemMessage` で知らせるだけ） | 「[Stop] Study に未コミットの変更が 4 件」と表示された。会話の記録の末尾 8MB だけを読み、約1.3秒 |
| PreCompact | その日（日本時間）に本人に確認して決めたこと（質問と回答）を `docs/decisions/<日付>.md` に書き出す。その日の分を毎回書き直す | `/compact` で発火し、「フックの置き場」の1件を `sales-core/docs/decisions/2026-10-19.md` に書いた |

- テストは、中身の無い関数に対して7件すべて失敗する（RED）ことを確かめてから実装した。
- 手で組んだ JSON の書き間違いで、フックが2回失敗した。失敗を `systemMessage` で知らせる経路が動くことも、これで分かった。

### 4. フックを dev-guard 1.3.0 に入れて配布した（本人の決定）

- `plugin.json` に Stop と PreCompact を登録した。決定の記録は、開いているリポジトリの `docs/decisions/` に書く。
- Study の `settings.json` からは同じフックを外した（二重に動かさないため）。
- タグ `dev-guard-v1.3.0` を打った。sales-core はその参照を上げた。
- sales-core の CLAUDE.md に2点を書いた。
  - `docs/decisions` は自動で書かれる記録で、業務ルールの定義元ではない。
  - **書き出したファイルは自動でコミットされない。コミットする前に、秘密情報が混ざっていないか読んで確かめる。**（AIレビューの Important を受けたもの）

### 5. 健康診断に C# の項目を3つ足した

| 項目 | コマンド | 判定 |
|---|---|---|
| テスト | `dotnet test`（600秒まで待つ） | 終了コードが0 |
| 未適用のマイグレーション | `dotnet ef migrations list` | `(Pending)` の行が0 |
| 脆弱なパッケージ | `dotnet list package --vulnerable --include-transitive` | 脆弱なパッケージのあるプロジェクトが0（日本語と英語の出力に対応） |

| 実行 | 結果 | 時間 |
|---|---|---|
| 1回目 | 12 OK・**1 NG（脆弱なパッケージ）** | 165秒 |
| xunit を上げた後 | **13/13 OK**、AIを呼ばない | 245秒 |

- **NGの中身:** xunit 2.5.3 → NETStandard.Library 1.6.1 経由で、`System.Net.Http` 4.3.0 と `System.Text.RegularExpressions` 4.3.0 が入っていた（どちらも High）。対象はテストの3プロジェクトだった。
- **直し方:** xunit を 2.9.3、xunit.runner.visualstudio を 2.8.2 に上げて、0件になった。
- **異常時の要約は失敗した:** 異常時に AI が書く要約は「OAuth session expired」で失敗した（ローカルの claude のログイン切れ）。報告書そのものは、失敗の出力つきで書き出された。

### 6. AIレビュー（[kiyo015/sales-core#5](https://github.com/kiyo015/sales-core/pull/5)）

| 対象 | 判定 | 費用（API換算） | 時間 |
|---|---|---|---|
| 0a86a00（二重請求・xunit） | マージ可 | $0.1788 | 29秒 |
| e6f2c81（dev-guard 1.3.0 を追加） | 修正後マージ可（Important 1・Minor 2） | $0.2310 | 46秒 |
| 3ef57f4（指摘を直した後） | マージ可（Minor 4） | $0.2069 | 34秒 |

- **Important:** PRの本文に無いプラグインの更新が混ざっていた。また、決定の書き出しに秘密情報が入るおそれがある。
  - 本文に書き足した。
  - 書き出したファイルをコミットする前に読む決まりを CLAUDE.md に書いた。
- **Minor:**
  - 例外の文言の確認は採用した。
  - 保存前の請求書だと番号が0と表示される件は、直す前からの挙動なので見送った。
- **3回目の Minor:** 「テストが前提（売上の請求書を読み込んでいないこと）を確かめていない」は Day33 に持ち越す。ほかの3件（タグより SHA で固定、秘密はお願いだけ、番号0）は、既に書いたことの繰り返し。

## 今日学んだこと

- **Stop と PreCompact は受け取るものが違う。** PreCompact には `permission_mode` と `effort` が来ず、代わりに `trigger` と `custom_instructions` が来る。どちらも推測で書かずに、記録用のフックで1回受けてから作ったので、項目名で迷わなかった。
- **会話の記録は大きい（54MB）。** 毎回の返事で走る Stop は末尾 8MB だけを読み、1日に数回の PreCompact は全部を読む。読み方を、頻度で分けた。
- **「決定を残す」と「秘密を残さない」はぶつかる。** 質問の自由回答に貼った文字列も、そのままファイルに出る。今は人が読んでからコミットすることで止める（お願い）。機械で止めるなら、AIレビューで使っている秘密の伏せ字の処理を流用する。
- **検査を足すと、すぐに見つかるものがある。** 推移的な依存（xunit の下）の脆弱性は、`--include-transitive` を付けないと出てこない。

## つまずき

- **プラグインの版の思い込み**
  - **症状:** `installed_plugins.json` に「1.1.0」とあり、キャッシュにも 1.1.0 しか無かった。そのため、Study では古い版が動いていると説明した。
  - **原因:** ローカルフォルダのマーケットプレイスは、作業中のソースを直接読む。1.1.0 は、インストールした時の記録が残っているだけだった。
  - **確かめ方:** 新しい版だけが止め、古い版は通すコマンド（`dotnet ef migrations remove --help`）を先に両方の版で判定した。そのうえで実際に投げたら、新しい版のガードに止められた。`guard-matrix.md` の「Study＝作業中のコード」（2026-09-28 実測）が正しかった。
  - **教訓:** 同じ入力で両方の版の判定を比べてから、実際に投げる。`echo` は両方とも通したので、判別に使えなかった。
- **PowerShell の `ConvertFrom-Json`:** 記録の1行が日本語を含む長い文字列だと、`Invalid object passed in` で読めなかった。node で読み直した。

## 成果物

**sales-core**
- [SalesRecord.cs](https://github.com/kiyo015/sales-core/blob/day32/src/SalesCore.Domain/SalesRecord.cs) — `InvoiceId` と `IsBilled`
- [Invoice.cs](https://github.com/kiyo015/sales-core/blob/day32/src/SalesCore.Domain/Invoice.cs) — 二重請求の検査
- [Configurations.cs](https://github.com/kiyo015/sales-core/blob/day32/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day32/src/SalesCore.Application/InvoiceUseCases.cs)
- [AuditAndConcurrencyTests.cs](https://github.com/kiyo015/sales-core/blob/day32/tests/SalesCore.Integration.Tests/AuditAndConcurrencyTests.cs) — 請求書を読み込まずに渡すテスト
- [docs/decisions/2026-10-19.md](https://github.com/kiyo015/sales-core/blob/day32/docs/decisions/2026-10-19.md) — PreCompact が書き出した決定の記録
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day32/CLAUDE.md)
- [.claude/settings.json](https://github.com/kiyo015/sales-core/blob/day32/.claude/settings.json) — `dev-guard-v1.3.0`

**Study**
- [session-hooks.js](https://github.com/kiyo015/vibe-coding-study/blob/day32/plugins/dev-guard/hooks/session-hooks.js)
- [session-hooks.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day32/plugins/dev-guard/hooks/session-hooks.test.js)
- [plugin.json](https://github.com/kiyo015/vibe-coding-study/blob/day32/plugins/dev-guard/.claude-plugin/plugin.json) — 1.3.0
- [health-check.js](https://github.com/kiyo015/vibe-coding-study/blob/day32/checks/health-check.js)
- [health-check.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day32/checks/health-check.test.js)
- [evidence/2026-10-19-hook-input.jsonl](https://github.com/kiyo015/vibe-coding-study/blob/day32/evidence/2026-10-19-hook-input.jsonl) — 受け取った JSON の実測

## 次回予告

**Day33 — ガードの定期実行とWindowsの整理**
- `guard-e2e` を週1回の定期実行に組み込む。
- 未確認の3件（孫プロセス、PowerShell 用の deny ルール、`decision: 'block'` の非推奨）に結論を出す。

**持ち越し**
- プラグインから呼ぶ Stop・PreCompact が、新しいセッションで発火するかを確かめる。今日の実測は settings.json から呼んだもので、プラグインに移した後の発火はまだ見ていない。会話の記録の `hook_success` の `command` が `${CLAUDE_PLUGIN_ROOT}` になっているかで見分ける。
- 任意:
  - 二重請求のテストで、売上の請求書を読み込んでいないこと（`Invoice` が null）も確かめる（3回目の AI レビューの Minor）。
  - 決定の書き出しで、秘密を機械で伏せる（AIレビューの伏せ字の処理を流用）。
  - 請求先を Domain で守る。
  - 一意違反の文言を制約ごとに分ける。
  - 返品だけの締めの API テスト。
  - Day30 からの3件（出荷日の検査を Domain へ、DBの桁あふれを400に、出力の型の整理）。
- 本人の作業: 健康診断の異常時の要約のため、ローカルの claude に再ログインする。
