# Day34 学習記録（2026-10-21）— 総振り返りとチーム展開の準備

基幹システム開発計画の20日目で、段階1の最終日。段階1を振り返り、チーム用の雛形を基幹システム版にし、段階2（画面と権限）を日単位に展開した。

その途中、新しく参加した人の初日の確認手順を試していて、**sales-core で安全柵（dev-guard）が黙って読み込まれていなかった**ことを見つけた。PowerShell ツールで、DB を壊すコマンドが止まらずに実行された（安全の2重化で、何も消えていない）。原因を突き止めて直し、同じことが起きたら気付ける形にした。

**完了条件「段階2の計画が、この形式（日単位・完了条件つき）で書けている」は達成した。** Day35〜49 の15日分を、毎日に完了条件をつけて書いた。

## 今日行った処理

### 1. 安全柵が黙って無効になっていた件

#### 見つけた経緯

初日の確認手順を書く前に、各項目を sales-core の新しいセッション（`claude -p`）で試した。

| # | 項目 | 結果 |
|---|---|---|
| 1 | Bash で `dotnet ef database drop --dry-run --project <存在しない名前>` | 止まった |
| 2 | 同じコマンドを PowerShell で | **止まらずに実行された**（`MSB1009: プロジェクト ファイルが存在しません`） |
| 3 | PowerShell で `git push --force --dry-run` | deny ルールで止まった |
| 4・5 | `.env` と、同じ中身の別名のファイルを Read | `.env` は読めず、対照は読めた |

#### 原因の切り分け

| 確かめたこと | 結果 |
|---|---|
| フックに同じ入力を直接渡す | Bash でも PowerShell でも `deny` を返す → 判定は正しい |
| 会話の記録 | PreToolUse のフックは記録に残らない → 手掛かりなし |
| `--debug` の記録 | `Plugin "dev-guard" not cached at ...\1.1.0`、`marketplace not registered` |
| 起動時の記録（`system:init`）の `plugins` | dev-guard が**無い**（2回続けて同じ） |

- **原因:** Study と sales-core が、同じ名前のマーケットプレイス `vibe-study` を、それぞれローカルのフォルダと GitHub のタグとして上書きし合っていた（名前はマシン全体で1つ）。
  - 今朝、sales-core のセッションが登録を GitHub に切り替えた。しかし GitHub 版はキャッシュに無く（9/28 の 1.2.0 は消えていた）、読み込みに失敗した。
  - 失敗は画面に出なかった。
- **それまで止まっていた理由:** 登録が Study のローカルのフォルダを指していて、作業中のソースを読んでいたから。前日までの guard-e2e の「GitHub 配布」のセルも、実は GitHub 配布を通っていなかった可能性が高い。

#### 直し方（本人の決定: 名前を分ける）

1. Study のローカル用の目録を `plugins/.claude-plugin/marketplace.json`（名前 `vibe-study-local`）として別に作った。
   - 設定のキーだけを変えても効かなかった（名前は `marketplace.json` の `name` で決まる）。
2. sales-core には、GitHub の v1.3.1 を入れ直した。
   - `claude plugin marketplace add "kiyo015/vibe-coding-study#dev-guard-v1.3.1" --scope local` で登録した。
   - 続けて `claude plugin install dev-guard@vibe-study --scope project` で入れた。
3. 結果: Study は `dev-guard@vibe-study-local`（作業中のソース）、sales-core は `dev-guard@vibe-study`（GitHub のキャッシュ）から読み込むようになった。続けて起動しても上書きし合わない。

**途中のつまずき**
- `claude plugin marketplace remove` を sales-core の中で実行したら、プロジェクトの `settings.json` からも登録が消えた。すぐに `git checkout` で戻した。
- `claude -p` のセッションは、バックグラウンドの取得（`git clone`）を終える前に閉じた。60秒・90秒待たせても登録されなかった（clone 単独なら10秒）。取得を待ってくれる CLI に切り替えた。

#### 再発の防止

- guard-e2e の sales-core のセルは、起動時の記録で読み込み元が `dev-guard@vibe-study` でなければ合格にしない（`pluginSource`。テストを先に書いた）。
- 直した後の実行は7セルすべて合格（$0.0654）。対照として、期待する読み込み元をわざと `vibe-study-local` にすると、`wrong-plugin(...)` で判定不能になった。

### 2. 初日に安全柵を確かめる手順（sales-core の `docs/onboarding.md`）

- 手順は、①準備（DB、信頼の承認、プラグインの承認）、②dev-guard が読み込まれているかの確認、③6項目の試行、④止まらなかった時、⑤知っておくこと、の5段。
- 試行はどれも、止まらなくても何も壊れない形にした。
- 直した後に、新しいセッションで1〜6をすべて試した。Windows の Bash ツールでの強制 push も含め、すべて期待どおりだった。

| # | 結果 |
|---|---|
| 1・2 | `[pre-bash-guard] 危険なコマンド(dotnet ef database drop)` で止まる（Bash・PowerShell） |
| 3 | `[pre-bash-guard] 危険なコマンド(force push)` で止まる（PowerShell・Bash） |
| 4・5 | `.env` は読めない。対照の別名のファイルは読める |
| 6 | `[dev-guard] SalesCore.Domain.Tests: 編集後のテスト 全件パス` |

- 6番は、最初は guard-e2e と同時に走らせたため、60秒で打ち切られた（普段は約12秒）。空いてから試し直して全件パスした。手順書に注意として書いた。
- **AI レビュー（PR #7）:** マージ可 $0.1944・40秒 → 直した後もマージ可 $0.1790・31秒。指摘で直したこと:
  - 見るのは文言でなく「実行されずに止まったか」と書いた（文言は版で変わりうる）。
  - CLAUDE.md の段階2の説明に、承認待ちを足した。

### 3. 段階1の振り返り（計画シートの Day34 の節）

| 指標 | 段階1の始め | 終わり |
|---|---|---|
| sales-core のテスト | 空テストのみ | 201件（Domain 147・結合 45・アーキテクチャ 9） |
| API | なし | 10本 |
| マイグレーション | なし | 5本 |
| 「お願い」から「強制」へ | 0 | 計画の7本すべて＋α |
| guard-e2e | 3セル | 7セル・週1回の無人実行 |
| 健康診断 | 9項目 | 14項目 |
| AI レビュー | — | 17回、$5.96（API 換算）。マージ可 8・修正後マージ可 9 |

- **効いたやり方:**
  - 対照実験。
  - 業務の判断は本人に聞く。
  - AI レビューの指摘は、実測してから採否を決める。
  - 新しいセッションで確かめる。
- **繰り返した失敗:**
  - 「設定したつもり」（Day16・17・33・34。どれも画面にエラーが出なかった）。
  - 思い込みで説明した（Day32・34）。
  - シェル経由でのエスケープの崩れ。
  - 合否を、テスト以外のものの成否で見た。

### 4. チーム用の雛形を基幹システム版に（`templates/team-CLAUDE.md`）

- npm 向けの雛形を、C# と DB を使う基幹システム向けに書き直した。
- 禁止事項を「業務のデータとお金」と「開発の操作」の2表に分けた。
  - 業務のデータとお金: 金額の型、端数、税、未出荷の請求、状態遷移、物理削除、同時更新、二重請求。
  - 開発の操作: 秘密情報、DB の破壊、強制 push、テスト、main の保護、レビュー役。
- 安全柵の漏れ、設定の置き場所、マーケットプレイスの名前を分けること、初日の手順を入れた。

### 5. 段階2の日単位の計画（Day35〜49）

**本人の決定**
- 描画方式は Interactive Server。
- 画面から Application を直接呼び、権限の検査はユースケースの入口に置く。
- 承認の基準は税抜100万円（下記の訂正を参照）。

| 週 | 日 | 内容 |
|---|---|---|
| 1週目 | Day35〜39 | 設計と画面の骨格 → Identity → 役割と操作した人 → ユースケースの入口での権限の検査（全組み合わせ） → API の認証と権限の実効性テスト（対照実験） |
| 2週目 | Day40〜44 | 承認の金額の基準 → 画面の共通部品とマスタ → 受注 → 出荷 → 締め請求（段階1の任意の持ち越しを割り振った） |
| 3週目 | Day45〜49 | Playwright で端から端まで → 画面での権限の実効性テスト → セキュリティの確認 → 仕上げ → 段階2の振り返りと段階3の展開 |

**承認の基準の訂正:** 業務ルール集には、Day16 に「税抜合計100万円以上」と決めてあった。今日の質問では、それを確かめずに「税込100万円以上」の選択肢を出してしまった。PR #7 の AI レビューの指摘で気付き、本人に確かめて税抜に戻した。

## 今日学んだこと

- **安全柵は、読み込まれたことを確かめるまで効いていない。** 設定ファイル、テスト、guard-e2e の合格がそろっていても、実際には別の経路（Study のソース）で止まっていた。起動時の記録の `plugins` で、どこから読み込んだかまで見る。
- **新しく参加した人と同じ条件で試すと、作者の機械の癖が見える。** 作者の機械だけにある状態（Study の登録）が、問題を隠していた。手順書は、書く前に新しいセッションで試す。
- **安全の2重化は効いた。** 止まらなかった DB 破壊のコマンドも、`--dry-run` と存在しないプロジェクト名のおかげで何も消えなかった（Day19 に決めた形）。
- **既に決めたことを確かめてから聞く。** 業務の判断を聞く前に、業務ルール集をひととおり確かめる。今日は確かめずに聞いて、税抜と税込を取り違えた。

## つまずき

- **ガードの誤検知（2回）**
  - **症状:** PR の本文を heredoc で渡したら、本文にある DB を壊すコマンドの文字列で止められた。`rm -rf` を含む片付けのコマンドも止められた（こちらは正しい動き）。
  - **対策:** 本文はファイルで渡した。
- **`claude plugin marketplace remove` の副作用**
  - **症状:** プロジェクトの設定からも登録が消えた。
  - **対策:** `git checkout` で戻した。初日の手順に「使わない」と書いた。
- **シェル経由でのバックスラッシュの消失（また）**
  - **症状:** テストに書いた Windows のパスの `\` が消え、`Invalid hexadecimal escape sequence` で失敗した。
  - **対策:** Edit ツールで直した。

## 成果物

**Study**
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day34/study_plan_next_month.md) — 段階1の振り返り、段階2の日単位の計画
- [templates/team-CLAUDE.md](https://github.com/kiyo015/vibe-coding-study/blob/day34/templates/team-CLAUDE.md) — 基幹システム版の雛形
- [plugins/.claude-plugin/marketplace.json](https://github.com/kiyo015/vibe-coding-study/blob/day34/plugins/.claude-plugin/marketplace.json) — ローカル用の目録（`vibe-study-local`）
- [.claude/settings.json](https://github.com/kiyo015/vibe-coding-study/blob/day34/.claude/settings.json)
- [checks/guard-e2e.js](https://github.com/kiyo015/vibe-coding-study/blob/day34/checks/guard-e2e.js)・[guard-e2e.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day34/checks/guard-e2e.test.js) — 読み込み元の確認
- [checks/guard-matrix.md](https://github.com/kiyo015/vibe-coding-study/blob/day34/checks/guard-matrix.md)
- [evidence/2026-10-21-onboarding-and-marketplace.md](https://github.com/kiyo015/vibe-coding-study/blob/day34/evidence/2026-10-21-onboarding-and-marketplace.md)

**sales-core**
- [docs/onboarding.md](https://github.com/kiyo015/sales-core/blob/day34/docs/onboarding.md) — 初日の確認手順
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day34/CLAUDE.md)

## 次回予告

**Day35 — 段階2の設計と画面の骨格**
- 段階2の設計の文書を書く。
- `SalesCore.Web`（Blazor、Interactive Server）と、bUnit のテストプロジェクトを作る。
- アーキテクチャテストで「Web から Domain を直接呼ばない」を止める。
- CI に Web のビルドとテストを足す。

**持ち越し**
- 10/26（月）9:00 の初めての定期実行（guard-e2e）を、健康診断で確かめる。
