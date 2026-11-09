# Day46 学習記録（2026-11-09）— 画面での権限の実効性テスト

基幹システム開発計画の32日目で、段階2（画面と権限）の12日目。

- **作ったもの:** 3つの役割（営業・経理・管理者）でログインし、許された操作だけが画面に出ること、許されない画面は URL を直接入れても開けないことを確かめる、端から端までのテスト（Playwright）。
- **測ったもの:** 画面の守りの3段（隠す・画面が開いた時に拒む・ユースケースの入口が拒む）のどれが何を止めているか（対照実験6通り）。
- **持ち越しの分:** 直した欄の理由が次に送るまで残る件（PR #16・#18）、失敗の一覧をロックの中で読む、CI でスクリーンショットを上げる、決定の記録を sales-core へ移す。

**完了条件「権限の実効性テスト（画面）が対照実験付きで合格している」は達成した。** 手元と CI の両方で通り、AI レビューは1回目でマージ可。

## 今日行った処理

### 1. 権限の実効性テスト（`PermissionE2ETests`）

役割ごとに、次の画面で「出る・出ない」「開ける・開けない」を確かめる。

| 確かめる所 | 営業 | 経理 | 管理者 |
|---|---|---|---|
| メニュー（受注・請求書・得意先・商品・倉庫） | 出る | 出る | 出る |
| 受注の登録のリンク・`/orders/new` を直接 | 出る・開ける | 出ない・403 | 出る・開ける |
| 締め請求のリンク・`/invoices/new` を直接 | 出ない・403 | 出る・開ける | 出る・開ける |
| マスタ3画面の登録の欄 | 出ない | 出ない | 出る |
| 受付の受注の承認・取消のボタン | 出る | 出ない | 出る |
| 承認済の受注の出荷の指示のリンク・URL を直接 | 出る・開ける | 出ない・403 | 出る・開ける |

- 承認待ちの受注（105円×10,000箱 = 税抜1,050,000円）は、営業には承認のボタンが出ず（取消は出る）、管理者が承認できる。
- **期待は業務ルール集の役割の表から書き写した。** 画面と同じ `Permissions` から期待を作ると、表そのものの誤りを見逃す。業務ルール集にも「表を変えたら画面のテストも直す」と書き足した。
- **「出ない」ことを確かめる前に、読み込みが終わったことを確かめる。** 終わる前は何も描かれていないので、「ボタンが0個」はいつでも通ってしまう。一覧の行や受注の状態が出るのを待ってから数える。
- 最初に流した時、得意先の一覧で「本社の行が1行」を待つ所が落ちた。支店の行にも請求先として本社のコードが出るので、2行に当たっていた。支店の行で待つようにした。

テストの部品も整理した。

- `E2EScreens`（ログイン・受注の登録・スクリーンショット）と `RequestFailures`（読み込みの失敗の一覧。書くのも読むのもロックの中）に分けた。
- `WebCollection`: 画面の発行・起動とブラウザを、テストのクラスで分け合う。クラスごとに `IClassFixture` にすると、クラスの数だけ画面を発行して起動する。
- 管理者の利用者も実行ごとに作る。

### 2. 対照実験（6通り）

計画では「ユースケースの入口の検査を外すと、画面から許されない操作が通ってしまう」ことを示す予定だった。実際に外してみると、そうはならなかった。

- E1 = ユースケースの入口の検査（参照以外の11か所）を外す
- E2 = 画面が開いた時の `Permissions.Require`（3画面）を外す
- E3 = 得意先の登録の欄を隠し忘れる（全員に出す）
- 「観測」は、経理が画面に出た（出てしまった）欄から送った時の結果。観測用のテストを一時的に足して確かめ、コミットしていない。

| 入れた誤り | 端から端まで | 結合 | 観測 |
|---|---|---|---|
| なし | 0 | 0 | 欄が出ない・URL で開くと 403 |
| E1 入口だけ外す | **0** | 8 | 欄が出ない・URL で開くと 403 |
| E2 開いた時の検査だけ外す | 1（経理） | – | 出荷の指示の画面に「指示できない」と出る（403 でない） |
| E3 隠し忘れるだけ | 2（営業・経理） | – | **欄から送ると 403**（入口が止める） |
| E1+E2 | 2（営業・経理） | – | 営業に締め請求の欄が開く |
| E1+E3 | 2（営業・経理） | – | **経理が得意先を登録できた** |

- 画面の中では「隠す」「開いた時に拒む」の2段が先に止める。入口の検査だけを外しても、画面からは許されない操作に届かない。入口の検査は API と結合テスト（`PermissionTests`、8件落ちた）が守る。
- 画面が隠し忘れた時に止めるのは入口の検査（E3）。隠し忘れと入口の両方が欠けると、許されない操作が通る（E1+E3）。
- E1+E2 で営業も落ちたのは、揺らぎではなかった。締め請求の画面は欄を隠さず、開いた時の検査だけで守っている。そこが外れると、営業にも欄が出る。1通りだけ流し直して確かめた。

### 3. 直した欄の理由を、次に送るのを待たずに消す（PR #16・#18 の持ち越し）

- 受注の登録で単価を空にして送ると「単価を入力してください。」が出る。単価を入れ直しても、次に送るまで残っていた。締め請求の「請求先を選んでください。」「締め日を入れてください。」も同じだった。
- RED: 「送った後に入れ直すと理由が消える」テストを2件書き、2件とも落ちることを見た。
- 直し方: `FormCheck`（画面で足す検査の部品）を作った。最初に送った時に作り、その後は欄を入れ直すたびに確かめ直す。2画面に同じ形で書いていた処理を1か所にまとめた。
- 請求先を選ぶと締め日の初期値も入るので、締め日の理由も一緒に消える（テストで確認）。
- 「`Validate()` は通知しない」のコメントは、「`DataAnnotationsValidator` の無いフォームでは」と正確にした。
- 対照実験: 欄の変更の購読を外すと、2件落ちる。

### 4. その他の持ち越し

- CI: 端から端までのテストが落ちた時の画面を、成果物 `e2e-screenshots` として上げる（落ちた時だけ）。
- Study に書き出されていた決定の記録 `docs/decisions/2026-11-06.md`（本人の決定2件）を、sales-core の `docs/decisions/` へ移し、Study から消した。

### 5. CI と AI レビュー（PR #19）

- CI: ビルドとテスト、AI レビューともに成功。
- AI レビュー: 1回目でマージ可。Critical・Important なし、Minor 3件（すべて持ち越し）:
  1. `FormCheck` は最初に受け取ったフォームの状態に結び付く。フォームを作り直すと、古い方を見続けるおそれがある（今は作り直していない）。
  2. コードから値を入れた時（商品を選び直した時の標準単価）は確かめ直さない。
  3. 出荷の確定・取消のボタンが画面のテストに入っていない。

### 確認

- Release ビルド（警告もエラー）: 警告0件。
- `dotnet test`: Domain 192・アーキテクチャ 16・Web 32・結合 208・端から端まで 5（合計453件、前回447件）。端から端までは34秒。
- 本物のブラウザでの確認は、端から端までのテストで行った（ブラウザのペインでの手作業の確認はしていない）。

## 今日学んだこと

- **「画面で隠すだけでは守れない」は、この画面では実測すると成り立たなかった。** Blazor の Interactive Server は、描いていないボタンを利用者が押す手段が無い。画面も開いた時に検査している。守りの層が多いと、1つを外しても上の層のテストでは見えない。どの層をどのテストが見張っているかを、実験で表にしておく。
- **予定の仮説が外れたら、外れた形をそのまま記録する。** 「入口を外すと画面から通る」を無理に再現するのでなく、どの組み合わせで通るかを測った。結果として「隠し忘れた時の最後の砦が入口」という、より正確な説明になった。
- **「出ない」ことのテストは、何もしなくても通る。** 読み込みの完了を先に確かめないと、空の画面で「0個」になって通ってしまう。
- **テストの期待を、守る側と同じ表から作らない。** 同じ表から作ると、表の誤りはテストも一緒に誤る。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 3つの役割すべてで、得意先の一覧の行を待つ所が落ちた | 支店の行にも請求先として本社のコードが出て、2行に当たった | 支店のコードで待つ |
| 観測用のテスト（経理が出荷を指示）が時間切れ（E2 のとき） | 開いた時の検査を外すと、役割の足りない利用者に「承認済なので指示できない」と出て、待っていた欄も 403 も出なかった | 観測の結果としてそのまま記録した（本物のコードでは開いた時の検査が先に止める） |
| E1+E2 で営業も落ちた | 締め請求の画面は欄を隠さず、開いた時の検査だけで守っている | 1通りだけ流し直して原因を確かめた |

## 成果物

**sales-core**（タグ `day46`）
- [tests/SalesCore.E2E.Tests/PermissionE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.E2E.Tests/PermissionE2ETests.cs)（新規）・[E2EScreens.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.E2E.Tests/E2EScreens.cs)（新規）・[WebAppFixture.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.E2E.Tests/WebAppFixture.cs)・[E2EData.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.E2E.Tests/E2EData.cs)・[SalesFlowE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.E2E.Tests/SalesFlowE2ETests.cs)
- [src/SalesCore.Web/Components/Shared/FormCheck.cs](https://github.com/kiyo015/sales-core/blob/day46/src/SalesCore.Web/Components/Shared/FormCheck.cs)（新規）・[NewSalesOrder.razor](https://github.com/kiyo015/sales-core/blob/day46/src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor)・[NewInvoice.razor](https://github.com/kiyo015/sales-core/blob/day46/src/SalesCore.Web/Components/Pages/Invoices/NewInvoice.razor)
- [tests/SalesCore.Integration.Tests/InvoicePageTests.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.Integration.Tests/InvoicePageTests.cs)・[SalesOrderPageTests.cs](https://github.com/kiyo015/sales-core/blob/day46/tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs)
- [.github/workflows/ci.yml](https://github.com/kiyo015/sales-core/blob/day46/.github/workflows/ci.yml)・[CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day46/CLAUDE.md)・[docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day46/docs/domain/business-rules.md)・[docs/decisions/2026-11-06.md](https://github.com/kiyo015/sales-core/blob/day46/docs/decisions/2026-11-06.md)（Study から移した）
- [kiyo015/sales-core#19](https://github.com/kiyo015/sales-core/pull/19)

**Study**（タグ `day46`）
- [2026-11-09/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day46/2026-11-09/summary.md)
- [2026-11-09/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day46/2026-11-09/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day46/study_plan_next_month.md)（Day46）

## 次回予告

**Day47 — セキュリティの確認**
- CSRF（偽のリクエスト）の対策、Cookie の属性、ログインの総当たり（ロック）、監査ログの抜け、エラー画面に内部の情報を出さない。
- `security-review` で差分を見る。指摘は実測してから直す。
- 決定の書き出し（PreCompact）で、秘密を機械で伏せる。書き出す先がその日の作業フォルダ（Study）になる件も一緒に見る。
- 完了条件: 確認した項目と結果の表があり、見つかった問題が直っているか、直さない理由が書いてある。

**持ち越し（Day47 の先頭に書き写した）**
- PR #19 の AI レビューの Minor 3件（上の5.）。
- PR #16 の残り: 確定の後の読み直しの失敗が、確定の失敗に見える。
- 請求書の一覧・受注の一覧が全件を読む（ページ分け）。
- 前からの持ち越し: 桁あふれの文言、`InitialUsers` の文言と明細を消すボタンのテスト、Swagger の Bearer の定義、`SignInManager` の上書きの登録の順、`CreateUserAsync`・`EnsureUserAsync` を `internal` にする件、`Routes.razor` の bUnit テスト、.razor の SALES001 の自動化、無効にした得意先を請求先にしてよいか、DB の接続の時間切れ（見張る）。
