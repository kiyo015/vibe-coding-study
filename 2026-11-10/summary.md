# Day47 学習記録（2026-11-10）— セキュリティの確認

基幹システム開発計画の33日目で、段階2（画面と権限）の13日目。

- **確かめたもの:** 偽のリクエスト（CSRF）、Cookie の属性、枠に入れる攻撃、ログインの総当たり、役割を外す・無効にした時の効き方、監査ログの抜け、エラーの画面。発行した画面に、本物のブラウザ（Playwright）と素の HTTP で確かめた。
- **直したもの:** 役割を外したり無効にしたりしても、画面ではいつまでも効かなかった件（1分以内に効くようにした）。ログインの成功・失敗・ロックがどこにも残らなかった件（アプリのログに残す）。ログインの Cookie に Secure が付かなかった件。
- **Study 側:** 決定の書き出し（PreCompact のフック）で、パスワードやキーの形をした値を伏せる。書き出す先を sales-core にする。

**完了条件「確認した項目と結果の表があり、見つかった問題が直っているか、直さない理由が書いてある」は達成した。** CI は成功し、AI レビューは4回目でマージ可。

## 今日行った処理

### 1. 確かめた項目と結果

| 項目 | 実測の結果 | 対応 |
|---|---|---|
| 偽のリクエスト（CSRF） | 印の無いログイン・ログアウトの送信は 400。ログイン済みの Cookie 付きでもログアウトされない | 問題なし。`SecurityE2ETests` で守る |
| ログインの Cookie | HttpOnly、SameSite=Lax、ブラウザを閉じると消える。**Secure は http では付かない** | 常に Secure にした |
| 偽のリクエストを防ぐ印の Cookie | HttpOnly、SameSite=Strict、Secure なし | Secure は強制できない（後述）。印だけではログインの代わりにならないので、そのまま |
| 枠に入れる攻撃（クリックジャッキング） | `X-Frame-Options: SAMEORIGIN` が付く | 問題なし |
| ログインの総当たり | 5回でロック。画面でもロック中と出る | 問題なし。画面のテストを足した |
| **役割を外す・無効にする** | **開いたままの画面で、管理者でなくなった人が倉庫を登録できた。開き直しても登録の欄が出た。無効にした後も使えた**（Cookie の有効期限、最長14日まで） | **1分以内に効かせた**（本人の決定） |
| 監査ログの抜け | 業務の変更はすべて残る。**ログインの成功・失敗・ロックはどこにも残らない** | アプリのログに残す（本人の決定） |
| エラーの画面 | `/Error` は問い合わせ番号だけ。存在しない画面は 404 | 問題なし |
| `security-review` | Study から起動すると `origin/HEAD` が無く動かなかった | 同じ観点で差分を読み、間隔の設定の検査を足した |

前日からの持ち越し「Day47の3件」のうち、印の無いログアウトが 400 になること、HTTP の段階のテストは、上の確認で済んだ。「15分」の二重の定義（画面・API の文言と設定）は残った。

### 2. 役割を外す・無効にすると、1分以内に効く

本人に「画面では、どれくらいで効けばよいか」を聞き、「1分以内」に決まった。

- **Cookie（画面を開くたびの要求）:** Identity の `SecurityStampValidator` が、間隔を過ぎた Cookie を確かめ直す。既定の30分を設定の半分（既定30秒）にした。`SalesCoreSignInManager` で、無効にした利用者も通さない（Identity の既定は変更の印しか見ない）。
- **開いたままの画面（Blazor の回線）:** 回線は Cookie を読み直さない。`RevalidatingUserStateProvider` が同じ決まりで確かめ直し、役割も DB と突き合わせる。
- **ログインしていない扱いに変わった画面:** `OperationPage` がログインの画面へ送る。
- **間隔の設定** `SalesCore:UserRevalidationInterval`: 既定1分。短くする方にだけ変えられる。空・0以下・1分超は起動で止める。端から端までのテストは2秒で起動する。

測って分かった、Identity と Blazor の仕組み:

- **役割を外しても、Identity は変更の印（セキュリティスタンプ）を変えない。** だから印を比べるだけでは、開いたままの画面は役割の変更に気付けない。役割そのものを突き合わせた。
- Cookie は確かめ直すたびに DB から作り直すので、開き直した画面は新しい役割になる。
- 画面は、認証の状態が変わっても描き直さない（`Task<AuthenticationState>` を受け取っていない）。受け取ってログインの画面へ送る形にした。

テスト（`UserRevocationE2ETests`）:

- 管理者の役割を外すと、開いたままの画面はログインに戻る。開き直すと新しい役割（役割なし）で、マスタの参照も 403。
- 無効にすると、開いたままの画面の登録の欄が消え、開き直してもログインに戻る。

### 3. ログインの記録

`AccountUseCases.SignInAsync` がアプリのログに残す。

- 成功は Information、失敗（利用者が無い・無効な利用者・パスワードが違う）とロックは Warning。理由はログにだけ書き、画面には出さない。
- **利用者が無い時は、入力した利用者名を残さない。** 利用者名の欄にパスワードを打ち間違えると、平文で残るため（AI レビューの指摘）。
- テストでは、利用者名の欄に打ったパスワードが、どのログにも出ないことを確かめる。

### 4. Cookie の Secure

- ログインの Cookie は、http の要求には Secure が付かなかった（要求に合わせる既定）。TLS を終える中継の後ろで動かすと付かないので、常に付けた。
- `http://127.0.0.1` でもブラウザは Secure の Cookie を送る（Chromium は手元を安全とみなす）。端から端までのテストはそのまま通った。開発で http で開けるのは `localhost` と `127.0.0.1` だけ（CLAUDE.md に書いた）。
- 偽のリクエストを防ぐ印の Cookie にも Secure を強制しようとしたら、印の仕組みが https でない要求を例外で拒み、画面が起動しなくなった（端から端までのテストがすべて落ちた）。戻して、理由をテストのコメントに残した。

### 5. 決定の書き出しのフック（Study・dev-guard 1.4.0）

- **秘密を伏せる:** `redact()` で、`password`・`pwd`・`secret`・`api_key` の値、`sk-ant-`、`ghp_` などの GitHub のトークン、`github_pat_` を `***` にする。見出し・質問・回答のすべてに当てる。形は sales-core の AI レビューの投稿と同じ。
- **書き出す先:** 環境変数 `DEV_GUARD_DECISIONS_DIR` で替えられるようにし、Study の `.claude/settings.json` で `../sales-core/docs/decisions` を指した（本人の決定）。今日の会話の要約の時に、フックが sales-core に `docs/decisions/2026-11-10.md` を書き出したことで、実際に効くことを確かめた。手で移す作業が要らなくなった。
- テスト: 2件足して9件とも通る。回答を伏せないと1件落ちる。

### 6. 対照実験（10通り、すべて検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| C1 開いたままの画面を確かめ直さない | 端から端まで 2 |
| C2 無効を見ない | 端から端まで 1 |
| C3 役割を突き合わせない | 端から端まで 1 |
| C4 ログインの画面へ送らない | 端から端まで 1 |
| C5 間隔の設定を当てない（既定30分のまま） | 端から端まで 2 |
| C6 既定を30分にする | Web 1 |
| C7 ロックのログを出さない | 結合 1 |
| ログインの Cookie に Secure を付けない | 端から端まで 1 |
| `SalesCoreSignInManager` を登録しない | 端から端まで 1 |
| フックで回答を伏せない | node 1 |

### 7. CI と AI レビュー（PR #20）

| 回 | 判定 | 主な指摘と対応 |
|---|---|---|
| 1 | 修正後マージ可 | Important: 業務ルール集「9.」に今日決めたことが未決のまま残っていた。Minor: 無い利用者名をログに残さない、間隔の設定の空と上限、`AddSignInManager` での登録。すべて RED を見てから直した |
| 2 | マージ可 | Minor: コメントの誤り、ログアウトの確かめ方（Cookie を消させる応答を返さないこと）、http で開けるのは手元の2つだけ |
| 3 | 修正後マージ可 | Important: 変更の直後に開き直すと、確かめ直していない Cookie で回線が始まり、最悪で約2分残る → Cookie と回線の両方を設定の半分ごとに確かめる（RED を見た） |
| 4 | **マージ可** | Important なし。Minor 4件（持ち越し） |

### 確認

- Release ビルド（警告もエラー）: 警告0件。
- `dotnet test`: Domain 192・アーキテクチャ 16・Web 41・結合 209・端から端まで 11（前回は Web 32・結合 208・端から端まで 5）。
- 無効にするテストが1回だけ落ちた。欄が消えた後、ログインの画面へ移り終わる前に開き直していた。移り終わるのを待つ形にし、5回続けて通った。

## 今日学んだこと

- **「ログインを守る」と「ログインし続けている人を守る」は別の問題。** パスワードとロックは前からあったが、ログインした後に権限を外した時の効き方は、誰も測っていなかった。実測すると、最長14日効かなかった。
- **Identity の変更の印は、役割の変更では変わらない。** 「印を見れば変更に気付ける」という思い込みが外れた。仕組みの名前でなく、何を比べているかを測って確かめる。
- **時間の約束は、仕組みが重なると足し算になる。** Cookie を1分、回線を1分ごとにすると、最悪で約2分になる（AI レビューが見つけた）。両方を半分ごとにして、合わせて1分以内にした。
- **安全の設定を強めると、起動しなくなることがある。** 印の Cookie の Secure の強制は、http の手元で画面が開かなかった。強められない理由を記録しておけば、次に同じことを試さずに済む。
- **ログは、入力をそのまま書くと漏れ口になる。** 利用者名の欄にパスワードを打つ人は実際にいる。無い利用者の名前は残さない。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 確かめ直しを入れても、開いたままの画面が変わらなかった | 画面が認証の状態の変化で描き直さない。役割の変更では変更の印が変わらない | `OperationPage` でログインの画面へ送る。回線で役割を突き合わせる |
| 役割を外すテストの期待が違った | 管理者に他の役割が無いので、開き直すと参照も 403 になる | 期待を直した |
| 無効にするテストが1回落ちた | ログインの画面へ移る途中に開き直し、2つの移動がぶつかった | 移り終わるのを待つ |
| 印の Cookie を Secure にすると画面が起動しない | 印の仕組みが https でない要求を例外で拒む | 戻し、理由を記録した |
| `security-review` が動かない | Study から起動すると `origin/HEAD` が分からない | 差分を同じ観点で手で読んだ |
| フックのファイルに見えない文字が入った | Python の普通の文字列で `\b` がバックスペースになった | `chr(92)+'b'` で書き直した |

## 成果物

**sales-core**（タグ `day47`）
- [src/SalesCore.Application/UserRevalidation.cs](https://github.com/kiyo015/sales-core/blob/day47/src/SalesCore.Application/UserRevalidation.cs)（新規）・[SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day47/src/SalesCore.Application/SalesCoreServices.cs)・[AccountUseCases.cs](https://github.com/kiyo015/sales-core/blob/day47/src/SalesCore.Application/AccountUseCases.cs)
- [src/SalesCore.Web/Components/Shared/OperationPage.cs](https://github.com/kiyo015/sales-core/blob/day47/src/SalesCore.Web/Components/Shared/OperationPage.cs)・[src/SalesCore.Web/Program.cs](https://github.com/kiyo015/sales-core/blob/day47/src/SalesCore.Web/Program.cs)
- [tests/SalesCore.E2E.Tests/SecurityE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.E2E.Tests/SecurityE2ETests.cs)（新規）・[UserRevocationE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.E2E.Tests/UserRevocationE2ETests.cs)（新規）・[WebAppFixture.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.E2E.Tests/WebAppFixture.cs)
- [tests/SalesCore.Web.Tests/UserRevalidationTests.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.Web.Tests/UserRevalidationTests.cs)（新規）・[tests/SalesCore.Integration.Tests/AccountTests.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.Integration.Tests/AccountTests.cs)・[CapturedLogs.cs](https://github.com/kiyo015/sales-core/blob/day47/tests/SalesCore.Integration.Tests/CapturedLogs.cs)（新規）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day47/docs/domain/business-rules.md)・[CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day47/CLAUDE.md)・[docs/decisions/2026-11-10.md](https://github.com/kiyo015/sales-core/blob/day47/docs/decisions/2026-11-10.md)（フックが書き出した）
- [kiyo015/sales-core#20](https://github.com/kiyo015/sales-core/pull/20)

**Study**（タグ `day47`）
- [plugins/dev-guard/hooks/session-hooks.js](https://github.com/kiyo015/vibe-coding-study/blob/day47/plugins/dev-guard/hooks/session-hooks.js)・[session-hooks.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day47/plugins/dev-guard/hooks/session-hooks.test.js)・[plugin.json](https://github.com/kiyo015/vibe-coding-study/blob/day47/plugins/dev-guard/.claude-plugin/plugin.json)・[.claude/settings.json](https://github.com/kiyo015/vibe-coding-study/blob/day47/.claude/settings.json)
- [2026-11-10/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day47/2026-11-10/summary.md)
- [2026-11-10/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day47/2026-11-10/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day47/study_plan_next_month.md)（Day47）

## 次回予告

**Day48 — 段階2の仕上げ**
- `CLAUDE.md`・業務フロー・`docs/onboarding.md` を段階2の形に直す（画面の起動、初期利用者の作り方）。
- 段階の完了条件を確かめるテストを通しで流す。guard-e2e に権限のセルを足すか判断する。
- 完了条件: 段階2の完了条件を、新しいセッション（文脈を切った状態）で確かめた記録がある。

**持ち越し（Day48 の先頭に書き写した）**
- PR #20 の AI レビュー4回目の Minor:
  1. 設定の間隔に極小の正の値を入れると、半分にした時に実際の間隔が0になる。
  2. ログインしていない扱いに変わった画面で、ログインの画面へ送る前に初期化が動く。
  3. Application 層が Blazor Server の型に依存した（回線用の部品の登録を Web 側へ移す）。
  4. 業務ルール集「8.」の書き方の揺れ。
- 「15分」の二重の定義（画面・API の文言と設定）。
- 役割の変更と無効にしたことを監査ログに残すか（業務ルール集「9.」。利用者の管理の画面を作る時に決める）。
- sales-core 側のプラグインのキャッシュ（GitHub のタグから入れた 1.3.2）は更新していない。
- PR #19 の Minor 3件、PR #16 の残り、請求書・受注の一覧のページ分け、前からの持ち越し（桁あふれの文言、`InitialUsers` の文言と明細を消すボタンのテスト、Swagger の Bearer、`CreateUserAsync`・`EnsureUserAsync` を `internal` に、`Routes.razor` の bUnit テスト、.razor の SALES001、無効にした得意先を請求先にしてよいか、DB の接続の時間切れ）。
