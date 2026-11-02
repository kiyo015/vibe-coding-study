# Day42 学習記録（2026-11-02）— 受注の画面

基幹システム開発計画の28日目で、段階2（画面と権限）の8日目。

- **作ったもの:** 受注の画面（一覧・登録・詳細・承認・取消）。Day41 の共通部品（`OperationPage`・`ErrorMessage`・`Permissions.Allows`）の上に作った。
- **決めてもらったこと:** 開発用 DB に税区分が無く、画面から何も登録できなかった。本人の決定で、税区分と税率をマイグレーションで入れた。
- **持ち越しの分:** DB の桁あふれを 400 に、出力の型の整理（どちらも Day30 から）、PR #14 の Minor 4件、前日のブラウザでの確認で見つけた2件。

**完了条件「画面から受注を登録・承認・取消でき、権限の無い操作のボタンは出ず、URL を直接開いても拒否される」は達成した。** bUnit の画面のテストと、ブラウザでの操作で確かめた。

## 今日行った処理

### 0. 前日の積み残し（ブラウザでのログイン）

- 初期の利用者3人（admin・sales・accounting）を、本人が user-secrets に置いた。PowerShell 5.1 では `&&` が使えないので、コマンドを書き直して渡した。
- 1回目の起動は、sales のパスワードが12文字未満で止まった。**誤りの文言から、どの利用者で止まったか分からなかった。** 本人が入れ直して起動した。
- 管理者で、マスタの登録・400（空のコード）・409（重複）を確かめた。営業では登録の欄が出ず、一覧だけが見えた。
- 見つけたこと3つを、今日の作業の先頭に書き写した（起動の文言、メニューの間隔、税区分）。

### 1. 受注の画面

| 画面 | 内容 |
|---|---|
| `/orders` | 一覧（全員）。新しい順で、状態は日本語（受付・承認待ち・承認済・一部出荷・出荷済・取消）。登録への入口は営業と管理者にだけ出す |
| `/orders/new` | 登録。得意先・受注日・明細（商品・数量・単価）。商品を選ぶと標準単価が入り、書き換えられる。無効にしたマスタは選択肢に出さない。登録すると詳細へ移る |
| `/orders/{id}` | 詳細と、承認・取消のボタン |

- **ボタンを出すかどうかは、状態と役割の両方で決める（`SalesOrderActions`）。**
  - 状態: Domain に `SalesOrderStatusRules`（`CanApprove`・`CanCancel`）を作った。`SalesOrder.Approve`・`Cancel` も同じ規則を使う。画面と Domain で規則が分かれない。
  - 役割: 入口の検査と同じ表（`Permissions.Allows`）。
  - 承認待ちを承認するボタンは、管理者にだけ出る。
- **URL を直接開いた時も拒む。** 登録の画面は最初に `Permissions.Require` を呼ぶ。経理が `/orders/new` を開くと、403 の理由が出て入力欄は出ない。
- **開いている間に、ほかの人が状態を変えた時:** ボタンを押すと 409 の理由が出て、今の状態を読み直して出す。読み直しに失敗しても、元の理由（409）を出す。
- 受注日の初期値は、日本時間の今日（`JapanTime.Today`。締めと同じ）。
- `SalesOrderUseCases.ListAsync` を足し、`PermissionTests` の参照の行にも足した。
- メニューに「受注」を足した。

### 2. 税区分と税率をマイグレーションで入れた（本人の決定）

ブラウザで商品を登録しようとすると、税区分の選択肢が空だった。税区分を登録する操作は無い。テストはデータ作り（`TestScenario`）で自分で税区分を作っていたので、気付けなかった。

| 質問 | 本人の決定 |
|---|---|
| 税区分（標準10%・軽減8%）をどうやって DB に入れる？ 業務ルール集には「現在の税率」だけがあり、入れ方は決まっていない | **マイグレーションで入れる。** 標準 `STD` 10%・軽減 `RED` 8%、どちらも 2019-10-01 から |

- マイグレーション `SeedTaxCategories`。作成者は `migration`（業務ルール集「8.」に書いた）。
- マイグレーションの手順のスキルは「データを入れない」としている。法令で決まり、どの環境でも同じ値なので、税区分と税率だけを例外として書き足した。
- **最初は `Down` で行を消す形にしたが、`NoPhysicalDeleteTests` が止めた。** 業務のデータを物理削除しない決まりが、巻き戻しの `DELETE` も止めた。
  - `Down` は何もしない（行を残す）。
  - `Up` はもう一度当てても重ならない（`ON CONFLICT DO NOTHING`）。
- SQL を `docs/migrations/2026-11-02-SeedTaxCategories.sql` に書き出して見た（`DROP`・型の変更・`CASCADE` なし）。テストの DB で確かめてから、未適用が今回の分だけであることを見て、開発用 DB に当てた。
- 決定は `docs/decisions/2026-11-02.md` に書いた。PreCompact のフックが Study 側にも書き出したので、sales-core 側に移して消した。

### 3. 持ち越しの分

| 項目 | 直す前 | 直した後 |
|---|---|---|
| DB の桁あふれ（Day30 から） | 数量や単価が DB の桁（`numeric(15,3)`・`numeric(15,2)`）を超えると、理由の無い 500 | `OperationError` で 22003 を理由付きの 400 に |
| 出力の型（Day30 から） | 出荷の出力が入力の型（`ShipmentLineRequest`）を使い回していた | 出力用の `ShipmentLineView` に分けた（JSON の形は同じ） |
| 商品の標準単価が空欄（PR #14） | 0 円で登録された | 画面で止める。0 円そのものは登録できる |
| 税区分・得意先・商品を選ばない（PR #14） | 「税区分コード  の税区分が無い。」 | 「税区分を選ぶ。」「得意先を選ぶ。」「明細の商品を選ぶ。」 |
| 起動で止まった時の文言（ブラウザ） | どの利用者か分からない | `InitialUsers:{番号}({ユーザー名})` を入れた |
| メニュー（ブラウザ） | 「トップ得意先商品倉庫」と1語に見える | 間をあけた |

コメント（確かめるのは Domain）と、業務ルール集の「API・画面とも 400」（マスタの API はまだ無い）も直した。

### 4. テスト

- **RED を見てから直したもの:**
  - 桁あふれ: 2件（500 だった）
  - 税区分の初期データ: 1件（0件だった）
  - 受注日の初期値: 1件（AI レビューの指摘。テストの時計をサーバーが UTC の時と同じにすると、11/01 になった）
- **RED を見ていないもの:** 画面と空の入力の文言は、実装を先に書いた。どれも対照実験で、外すとテストが落ちることを確かめた。
- `SalesOrderPageTests`（bUnit。ユースケースは本物で、テストのトランザクションを使う）:
  - 営業が明細2行で登録して詳細へ移る。
  - 商品を選ぶと標準単価が入り、書き換えた単価で受注する。
  - 得意先が空なら 400 の理由。
  - 経理が登録の画面を開くと 403 で入力欄なし。
  - 一覧は新しい順で状態が日本語、登録への入口は営業と管理者だけ。
  - 受付の承認、承認待ちの承認のボタンは管理者だけ、経理にはボタンなし、取消。
  - 開いている間にほかの人が取り消すと 409 と読み直した状態。
  - 無い受注は 404、無効のマスタは選択肢に出ない、すべての状態に表示名がある。
  - 受注日の初期値は日本時間の今日。
- 「どのテストも通らない経路」を書き出し、無効のマスタを選択肢から外すことのテストを足した。起動の文言・メニューの間隔（CSS）・詳細への移動は、ブラウザで確かめた。明細を消すボタンはテストが無い（持ち越し）。

| 対照実験（入れた誤り） | 落ちた件数 |
|---|---|
| 承認待ちでも営業に承認のボタンを出す | 1 |
| 取消のボタンで役割を見ない | 1 |
| 取消のボタンで状態を見ない | 1 |
| 登録の画面で入口の検査をしない | 1 |
| 登録への入口を全員に出す | 1 |
| 商品を選んでも標準単価を入れない | 1 |
| 得意先が空の文言を外す | 2 |
| 商品が空の文言を外す | 1 |
| 税区分が空の文言を外す | 1 |
| 桁あふれの扱いを外す | 2 |
| 一覧を古い順にする | 3 |
| 状態の表示名を1つ書き忘れる | 1 |
| メニューに受注を出さない | Web 3 |
| 標準単価の空欄を止めない | 1 |
| 拒まれた時に読み直さない | 1 |
| 無効のマスタを選択肢に出す | 1 |
| 一覧で入口の検査をしない | 1 |

17通りすべてを検出した。数字は落ちたテストの件数（結合。メニューだけ Web）。

### 5. ブラウザでの確認（管理者）

1. メニューに「受注」が出て、リンクの間があいている。
2. 商品 `TP01` を登録。単価が空欄だと止まることも確かめた。
3. 受注の登録: 得意先 `T001`、商品 `TP01` を選ぶと単価に 105.00 が入る。数量3で登録。
4. 詳細 `SO-000001` に移る（315円）。承認すると、ボタンが消える。
5. 一覧に承認済で出る。

- サーバーのログとブラウザのコンソールに、エラーは無かった。
- 開発用 DB に `T001`・`TP01`・`SO-000001` が残っている（物理削除しない）。

### 6. CI と AI レビュー（PR #15）

| 回 | 費用・時間 | 判定 | 対応 |
|---|---|---|---|
| 1回目 | $0.5361・78秒 | 修正後マージ可（Important 2・Minor 5） | Important 2件を直した。Minor は3件直し、2件はそのままにした |
| 2回目 | $0.5294・72秒 | マージ可（Important 0・Minor 5） | Day43 へ持ち越した |
| 3回目 | $0.5689・83秒 | マージ可（Important 0・Minor 5） | 決定の記録を足したのでまわった。Day43 へ持ち越した |

- **Important 1:** 受注日の初期値が、サーバーのタイムゾーンで決まっていた。UTC のサーバーだと、日本時間 0:00〜9:00 に前の日になる。締めと同じ日本時間の今日にした。
- **Important 2:** マイグレーションで入れた行の作成者 `migration` が、「操作した人のいない保存は空」という業務ルール集の決まりと食い違っていた。業務ルール集「8.」に書いた。
- 1回目の Minor で直したもの: 読み直しに失敗しても元の理由を出す、空白だけの入力も「選ぶ」の文言にする、画面に出した単価を指定して送ることをコメントに書く。
- そのままにしたもの: 入力以外の桁あふれも 400 になる、一覧で受注の表を2回読む。
- CI は3回とも成功した。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- `dotnet test`: すべて成功、合計393件（前日 370件）

  | 対象 | 件数 | 前日 |
  |---|---|---|
  | Domain | 181 | 181 |
  | アーキテクチャ | 16 | 16 |
  | Web | 31 | 31 |
  | 結合 | 165 | 142 |

## 今日学んだこと

- **ブラウザで実際に操作して、初めて分かることがある。**
  - 税区分が無いと、商品も受注も登録できない。テストはデータ作りで自分で税区分を作っていたので、見えなかった。
  - パスワードが短い時の起動の文言、メニューの間隔も、テストでは見ない。
- **テストの時計が手元の機械に頼っていると、日本時間の誤りを見逃す。**
  - 手元の機械は日本時間なので、サーバーのタイムゾーンで今日を決めても通っていた。
  - テストの時計を UTC に固定して、初めて RED になった。AI レビューが見つけた。
- **決まりをテストで守らせると、思わぬ所でも効く。** 物理削除を止めるテストが、マイグレーションの巻き戻しの `DELETE` も止めた。巻き戻しでも業務のデータは消さない形に直した。
- **ボタンを出す規則と、操作を許す規則を同じ所に置く。** 状態の規則を Domain の `SalesOrderStatusRules` に置き、画面のボタンと `SalesOrder.Approve` の両方が使う。役割は `Permissions` の同じ表を使う。だから、画面に出るボタンと、押して通る操作が食い違わない。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| PowerShell で「トークン '&&' は…有効なステートメント区切りではありません」 | Windows PowerShell 5.1 は `&&` に対応していない | 1行ずつのコマンドに書き直した |
| 本人のコマンドで、営業と経理のユーザー名が番号0に入っていた | 配列の番号の写し間違い | 番号1・2に直したコマンドを渡した |
| Web の起動が「Passwords must be at least 12 characters」で止まった | sales のパスワードが短い | 本人が入れ直した。文言に番号とユーザー名を入れた |
| ブラウザで CSS の変更が出ない | 古い app.css が残っていた | 強制的に読み直した |
| 画面のテストを足したら `RenderModeTests` が落ちた | 画面の一覧を固定で持っている | 一覧に受注の画面を足した |
| マイグレーションの `Down` の `DELETE` で `NoPhysicalDeleteTests` が落ちた | 物理削除の禁止 | `Down` は何もしない形にした |
| `PersistenceMappingTests` が税区分の重複で落ちた | マイグレーションで `STD` が入るようになった | テストでは別のコード `TST` を作る |
| Python で編集したファイルの改行が混ざった | CRLF と LF | CRLF に揃えた |

一度だけ起きた、DB のテストがすべて準備の段階で落ちた件は、今日の実行では見なかった（見張りを続ける）。

## 成果物

**sales-core**（タグ `day42`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day42/docs/domain/business-rules.md)（桁あふれ・税区分・作成者 `migration`）
- [docs/decisions/2026-11-02.md](https://github.com/kiyo015/sales-core/blob/day42/docs/decisions/2026-11-02.md)（新規）
- [docs/migrations/2026-11-02-SeedTaxCategories.sql](https://github.com/kiyo015/sales-core/blob/day42/docs/migrations/2026-11-02-SeedTaxCategories.sql)（新規）
- [.claude/skills/migration/SKILL.md](https://github.com/kiyo015/sales-core/blob/day42/.claude/skills/migration/SKILL.md)（税区分の例外）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day42/CLAUDE.md)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261102032134_SeedTaxCategories.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Infrastructure/Persistence/Migrations/20261102032134_SeedTaxCategories.cs)（新規）
- [src/SalesCore.Domain/SalesOrder.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Domain/SalesOrder.cs)（`SalesOrderStatusRules`）
- [src/SalesCore.Application/SalesOrderContracts.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Application/SalesOrderContracts.cs)（`SalesOrderActions`・`ShipmentLineView`）・[SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Application/SalesOrderUseCases.cs)（`ListAsync`）
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Application/OperationError.cs)（桁あふれ）・[JapanTime.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Application/JapanTime.cs)（新規）
- [src/SalesCore.Web/Components/Pages/Orders/](https://github.com/kiyo015/sales-core/tree/day42/src/SalesCore.Web/Components/Pages/Orders)（一覧・登録・詳細、新規）
- [src/SalesCore.Web/Components/Pages/Masters/Products.razor](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Web/Components/Pages/Masters/Products.razor)・[Program.cs](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Web/Program.cs)・[NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day42/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs](https://github.com/kiyo015/sales-core/blob/day42/tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs)（新規）・[SalesOrderApiTests.cs](https://github.com/kiyo015/sales-core/blob/day42/tests/SalesCore.Integration.Tests/SalesOrderApiTests.cs)・[MasterTests.cs](https://github.com/kiyo015/sales-core/blob/day42/tests/SalesCore.Integration.Tests/MasterTests.cs)・[TestScenario.cs](https://github.com/kiyo015/sales-core/blob/day42/tests/SalesCore.Integration.Tests/TestScenario.cs)
- [kiyo015/sales-core#15](https://github.com/kiyo015/sales-core/pull/15)

**Study**（タグ `day42`）
- [2026-11-02/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day42/2026-11-02/summary.md)
- [2026-11-02/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day42/2026-11-02/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day42/study_plan_next_month.md)（Day42）

## 次回予告

**Day43 — 出荷の画面**
- 出荷の指示（分納）・確定・取消。
- 出荷日の検査を Domain へ（Day30 からの持ち越し）。
- 完了条件: 画面から分納の出荷を指示・確定でき、受注数量を超える出荷が画面でも止まる。
- 開発用 DB の承認済の受注 `SO-000001` を、ブラウザでの確認に使える。

**持ち越し（Day43 の先頭に書き写した）**
- PR #15 の AI レビュー2回目の Minor:
  - 単価の欄を空にすると標準単価で受注される（商品の画面は空欄を止める）。止めるか、画面に書く。
  - 商品を選び直すと、手で直した単価が上書きされる。
  - 桁あふれの文言が受注の入力の前提になっている（`OperationError` は共通）。
  - 受注の一覧が全件を読む（ページ分け）。
  - `SalesOrderActions` を別のファイルに。
- PR #15 の AI レビュー3回目の Minor（2回目と重なる分を除く）:
  - 税区分・税率の行が既にある環境では、黙って残るか、排他制約で失敗する。適用の前に中身を確かめる手順を1行残す。
  - CSS の `nav` が全ページの `nav` に当たる。クラスに絞る。
  - 一覧の税抜合計の列を確かめるテストが無い。
- 画面の起動の時の設定の確かめ（`InitialUsers` の文言）にテストが無い。明細を消すボタンにテストが無い。
- Swagger の Bearer の定義。`SignInManager` の上書きが登録の順に頼っている。
- `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする。
- `Routes.razor` の「権限がありません」の分岐の bUnit テスト。
- `.razor` の SALES001 の自動化、Day47 の3件。
- 無効にした得意先を請求先にしてよいか。
- 一度だけ起きた、DB のテストがすべて準備の段階で落ちた件（見張る）。
