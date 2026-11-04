# Day43 学習記録（2026-11-04）— 出荷の画面

基幹システム開発計画の29日目で、段階2（画面と権限）の9日目。

- **作ったもの:** 出荷の画面（指示・確定・取消）。Day42 の受注の画面の上に作った。
- **持ち越しの分:** 出荷日の検査を Domain へ（Day30 から）。PR #15 の AI レビューの Minor（単価の空欄・選び直し・CSS・一覧の金額・マイグレーションの手順・`SalesOrderActions` のファイル）。

**完了条件「画面から分納の出荷を指示・確定でき、受注数量を超える出荷が画面でも止まる」は達成した。** bUnit の画面のテストと、ブラウザでの操作で確かめた。

## 今日行った処理

### 1. 出荷日の検査を Domain へ（Day30 から）

| 項目 | 直す前 | 直した後 |
|---|---|---|
| 受注日 | DB の裏の列（シャドウプロパティ）。Domain から見えない | `SalesOrder.OrderedOn`。コンストラクタで受け取る |
| 出荷日が受注日より前 | ユースケースが DB から受注日を読んで止めていた | `SalesOrder.RecordShipment`（出荷の確定から呼ばれる）が `InvalidInputException`（400）で止める |

- 受注日の移動は、振る舞いを変えずに全テストが通ることを確かめてから、別のコミットにした。DB の形は変わらない（`has-pending-model-changes` で確かめた）。
- 出荷日の検査は、テストを先に書いて RED（例外が出ない）を見てから Domain に移した。止まった出荷は指示のまま残る。受注日と同じ日はできる。

### 2. 出荷の画面

| 画面 | 内容 |
|---|---|
| `/orders/{id}/shipments/new` | 出荷の指示。倉庫と、明細ごとの今回の数量（初期値は残り）。空にした明細は今回は出さない（分納）。出荷を終えた明細・無効の倉庫は出さない。指示すると受注の画面へ戻る |
| `/orders/{id}` | 出荷の一覧（番号・状態・明細・出荷日・売上の番号）を足した。指示への入口、確定（出荷日を入れる。初期値は日本時間の今日）、指示の取消 |

- **受注数量を超える出荷は、画面でも理由付きで止まる（409）。** 止まるのは2か所。
  - 指示の時。
  - 確定の時。開いている間に、別の出荷が先に確定した場合。
- **ボタンを出すかどうかは、状態と役割の両方で決める（Day42 と同じ形）。**
  - 状態: Domain に `SalesOrderStatusRules.CanShip` と `ShipmentStatusRules`（`CanConfirm`・`CanCancel`）を足した。`SalesOrder.EnsureCanShip`・`Shipment.Confirm`・`Cancel` も同じ規則を使う。
  - 役割: 入口の検査と同じ表（`Permissions.Allows`）。
  - 取り消した受注に残った指示は、確定のボタンを出さず、取消のボタンは出す（片付けられるように）。
- **URL を直接開いた時も拒む。** 指示の画面は最初に `Permissions.Require` を呼ぶ。経理が開くと 403 の理由が出て、入力欄は出ない。
- 操作の後と拒まれた時は、受注と出荷の両方を読み直す（確定で受注の状態と残りが変わる）。
- `SalesOrderUseCases.ListShipmentsAsync` を足し、`PermissionTests` の参照の行にも足した。倉庫を選ばずに指示すると「倉庫を選ぶ。」。

### 3. PR #15 の AI レビューの Minor

| 項目 | 直す前 | 直した後 |
|---|---|---|
| 受注の単価の欄を空にする | 見ていない標準単価で受注された | 画面で止めて理由を出す（RED を見た） |
| 商品を選び直す | 手で直した単価がどうなるか、決まっていなかった | その商品の標準単価に入れ直す。テストとコメントに書いた |
| `SalesOrderActions` | 入出力の型のファイルに同居 | 別のファイルに |
| メニューの CSS | `nav` が全ページの `nav` に当たる | `nav.menu` に絞った |
| 一覧の税抜合計の列 | テストが無い | テストを足した |
| 税区分のマイグレーション | 行が既にある環境で黙って残るか失敗する | 当てる前にその環境の行を見ることを、マイグレーションの手順に書いた |

- 単価の空欄は、1回目の実装では止まったのに理由が出なかった。
  - 明細はリストなので、注釈による検証（`[Required]`）は中まで届かない。送る前に自分で検証のメッセージを足す形にした。
  - **`EditContext.Validate()` は、検証の状態が変わったことを通知しない。** だから `ValidationSummary` が描き直されなかった。自分で `NotifyValidationStateChanged()` を呼んで直した。

### 4. テスト

- **RED を見てから直したもの:**
  - 出荷日の検査（Domain）: 例外が出なかった。
  - 単価の空欄: 登録できてしまった。
  - 理由の数量の書式: 「残り 3.000」と出た（ブラウザで見つけた。下の5.）。
- `ShipmentPageTests`（20件。bUnit。ユースケースは本物で、テストのトランザクションを使う）:
  - 一部を指示して受注の画面へ移る。初期値は残りで、終えた明細は出ない。
  - 残りより多いと 409 と理由。倉庫が空なら 400。無効の倉庫は出ない。経理は 403。
  - 入口は営業と管理者だけ。承認前は入口なし。
  - 確定で一部出荷と売上の番号。2回の確定で出荷済。
  - 開いている間に別の出荷が先に確定すると 409 と読み直し。
  - 受注日より前の出荷日は 400。出荷日の初期値は日本時間の今日。
  - 指示の取消。取り消した受注の指示は確定なし・取消あり。経理はボタンなし。
  - その受注の出荷だけ出る。すべての状態に表示名がある。
- 「どのテストも通らない経路」を書き出すと、出荷の一覧で受注を絞る条件を外しても、どのテストも落ちなかった（0件）。テストを足した。
- 出荷日の初期値のテストは、時計を 2026-11-09T16:00Z（日本時間 11/10）に固定した。実行する日（11/04）と同じ日付だと、誤りがあっても偶然に通るため。

| 対照実験（入れた誤り） | Domain | 結合 |
|---|---|---|
| 出荷日の検査を外す | 1 | 2 |
| 受付でも出荷できる | 1 | 2 |
| 確定した出荷も確定できる | 1 | 2 |
| 指示の入口で役割を見ない | 0 | 1 |
| 確定のボタンで受注の状態を見ない | 0 | 1 |
| 確定のボタンで役割を見ない | 0 | 1 |
| 取消のボタンで役割を見ない | 0 | 1 |
| 出荷の一覧の参照で入口の検査をしない | 0 | 1 |
| 倉庫が空の文言を外す | 0 | 1 |
| 指示の画面で入口の検査をしない | 0 | 1 |
| 無効の倉庫を選択肢に出す | 0 | 1 |
| 今回の数量の初期値を空にする | 0 | 1 |
| 出荷を終えた明細も出す | 0 | 1 |
| 空の明細も0で送る | 0 | 1 |
| 操作の後に読み直さない | 0 | 5 |
| 拒まれた時に読み直さない | 0 | 2 |
| 出荷日の初期値をサーバーのタイムゾーンで決める | 0 | 1 |
| 出荷の状態の表示名を1つ書き忘れる | 0 | 2 |
| 受注の単価の空を止めない | 0 | 1 |
| 検証の状態を通知しない | 0 | 1 |
| 選び直しで手で直した単価を残す | 0 | 1 |
| 一覧の金額を出さない | 0 | 3 |
| 出荷の一覧で受注を絞らない | 0 | 1（テストを足す前は0） |

23通りすべてを検出した。数字は落ちたテストの件数。

### 5. ブラウザでの確認（管理者）

1. 倉庫 `W01`（本社倉庫）を登録した。開発用 DB に倉庫が無かった。
2. 受注 `SO-000001`（承認済・`TP01` 3個）で4個を指示すると、理由付きで止まった（409）。
3. 1個を指示して、出荷日の初期値（2026-11-04）のまま確定すると、一部出荷になり、売上 `SR-000001` ができた。
4. 残りの2個を指示した（初期値のまま）。出荷日に 11/01 を入れると「出荷日 2026-11-01 は受注日 2026-11-02 より前にできない。」と出た。
5. 11/04 で確定すると出荷済になり（`SR-000002`）、指示への入口と受注の取消のボタンが消えた。

- サーバーのログとブラウザのコンソールに、エラーは無かった。
- 開発用 DB に `W01`・`SH-000001`・`SH-000002`・`SR-000001`・`SR-000002` が残る（物理削除しない）。

**見つけて直したこと:**

| 症状 | 原因 | 対策 |
|---|---|---|
| 理由の数量が「残り 3.000」 | DB から読んだ数量は小数3桁（`numeric(15,3)`）の形で戻る。Domain のテストは手元で作った値なので気付けない | Domain の文言を `0.###` で書く（RED を見た）。入力欄の初期値も小数の0を落とす |
| 受注の取消と出荷の取消が、同じ「取消」のボタンで並んだ | 名前の付け方 | 出荷の方を「指示を取消」に。ブラウザではまだ見ていない（テストで確かめた） |

### 6. CI と AI レビュー（PR #16）

| 回 | 費用・時間 | 判定 | 対応 |
|---|---|---|---|
| 1回目 | $0.5520・73秒 | マージ可（Critical 0・Important 0・Minor 6） | Day44 へ持ち越した |

- Minor 6件:
  - 理由の数量の書式は丸めを伴う。ただし小数4桁以上の数量は手前の検査（`EnsureQuantity`）で 400 になり、届かない。コメントに書く。
  - 入力欄の数量の0を落とす変換も書式を通るので、丸めに見える。
  - 出荷できない状態の受注でも、URL から開くと指示の入力欄が出る（送れば 409 で止まる）。
  - `ListShipmentsAsync` は、無い受注の番号を渡されると 404 でなく空の一覧を返す。
  - 確定が成功した後の読み直しが失敗すると、確定できなかったように見える。
  - 単価の誤りの文言が、次に送るまで消えない。
- CI は成功した。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- モデルの変更なし（`has-pending-model-changes`）
- `dotnet test`: すべて成功、合計417件（前日 393件）

  | 対象 | 件数 | 前日 |
  |---|---|---|
  | Domain | 183 | 181 |
  | アーキテクチャ | 16 | 16 |
  | Web | 31 | 31 |
  | 結合 | 187 | 165 |

## 今日学んだこと

- **DB から読んだ値は、手元で作った値と形が違う。**
  - 数量が `10.000` で戻り、入力欄にも理由の文言にも出た。
  - Domain のテストは手元で作った `10m` を使うので、気付けない。ブラウザと、DB を通す画面のテストで初めて見えた。
- **テストの日付が実行する日と重なると、誤りがあっても偶然に通る。** 対照実験を組む時に気付き、固定の時計を別の日にずらした。
- **検証の仕組みには、届く範囲がある。**
  - 注釈による検証は、リストの中の項目まで届かない。
  - `EditContext.Validate()` は通知しないので、自分で足したメッセージは描き直しを頼まないと出ない。
  - 画面のテストで「理由が出ない」ことを見て、初めて分かった。
- **規則を Domain に寄せると、画面とユースケースが同じ答えを出す。**
  - 出荷できる状態（`CanShip`）と、確定・取消できる状態（`ShipmentStatusRules`）を Domain に置き、ボタンと操作の両方が使う。
  - 出荷日の検査も受注日を Domain に持たせたので、DB を読まずに Domain の中で止められた。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| `has-pending-model-changes` が「More than one DbContext」 | `-c Release` が文脈の名前と読まれ、さらに DbContext が2つある | `--configuration Release --context SalesCoreDbContext` |
| 単価の空欄の理由が出ない | `Validate()` が通知しない | `NotifyValidationStateChanged()` を呼ぶ。原因は描画の中身を書き出して見つけた |
| `messages.Add(() => line.UnitPrice, …)` で CS8603 | 式の形が null を返しうる | `new FieldIdentifier(line, nameof(Line.UnitPrice))` |
| 受注を絞るテストで DbUpdateException | `TestScenario` を2つ作り、受注の番号が重なった | 1つの `TestScenario` で2つの受注を作る |
| 対照実験の出力が文字化け | Python の出力が cp932 | 並びの順で読み取った。以後 `PYTHONIOENCODING=utf-8` |
| `sed -i` で改行が LF になった | CRLF のファイル | Python で CRLF に戻した |

## 成果物

**sales-core**（タグ `day43`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day43/docs/domain/business-rules.md)（単価の空欄は画面で止める）
- [.claude/skills/migration/SKILL.md](https://github.com/kiyo015/sales-core/blob/day43/.claude/skills/migration/SKILL.md)（当てる前に行を見る）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day43/CLAUDE.md)
- [src/SalesCore.Domain/SalesOrder.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Domain/SalesOrder.cs)（`OrderedOn`・出荷日の検査・`CanShip`）・[Shipment.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Domain/Shipment.cs)（`ShipmentStatusRules`）・[SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Domain/SalesOrderLine.cs)（文言の書式）
- [src/SalesCore.Application/SalesOrderActions.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Application/SalesOrderActions.cs)（新規）・[SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Application/SalesOrderUseCases.cs)（`ListShipmentsAsync`）
- [src/SalesCore.Web/Components/Pages/Orders/NewShipment.razor](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/Components/Pages/Orders/NewShipment.razor)（新規）・[SalesOrderDetail.razor](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/Components/Pages/Orders/SalesOrderDetail.razor)・[ShipmentStatusText.cs](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/Components/Pages/Orders/ShipmentStatusText.cs)（新規）・[NewSalesOrder.razor](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor)
- [src/SalesCore.Web/wwwroot/app.css](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/wwwroot/app.css)・[NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day43/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [tests/SalesCore.Integration.Tests/ShipmentPageTests.cs](https://github.com/kiyo015/sales-core/blob/day43/tests/SalesCore.Integration.Tests/ShipmentPageTests.cs)（新規）・[SalesOrderPageTests.cs](https://github.com/kiyo015/sales-core/blob/day43/tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs)・[tests/SalesCore.Domain.Tests/SalesOrderTests.cs](https://github.com/kiyo015/sales-core/blob/day43/tests/SalesCore.Domain.Tests/SalesOrderTests.cs)
- [kiyo015/sales-core#16](https://github.com/kiyo015/sales-core/pull/16)

**Study**（タグ `day43`）
- [2026-11-04/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day43/2026-11-04/summary.md)
- [2026-11-04/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day43/2026-11-04/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day43/study_plan_next_month.md)（Day43）

## 次回予告

**Day44 — 締め請求の画面、2週目の振り返り**
- 締め（請求先・締め日を選ぶ）、請求書の一覧・詳細（税率ごとの内訳）。
- 請求先を Domain で守る、二重請求のテストの前提を確かめる（段階1からの持ち越し）。
- 2週目の振り返り。
- 完了条件: 経理が画面で締め請求でき、営業は締めの画面を開けない。
- 開発用 DB に売上 `SR-000001`・`SR-000002`（得意先 `T001`、11/04）があり、締めの確認に使える。

**持ち越し（Day44 の先頭に書き写した）**
- PR #16 の AI レビューの Minor:
  - 理由の数量の書式が丸めを伴う（`EnsureQuantity` で手前で止まることをコメントに）。入力欄の0を落とす変換も同じ。
  - 出荷できない受注でも、URL から指示の入力欄が出る。
  - `ListShipmentsAsync` は無い受注で 404 でなく空の一覧を返す。
  - 確定が成功した後の読み直しの失敗が、確定の失敗に見える。
  - 単価の誤りの文言が次に送るまで消えない。
- 「指示を取消」のボタン名をブラウザで見る。
- 前日からの持ち越し:
  - 桁あふれの文言が受注の入力の前提（`OperationError` は共通）。入力以外の桁あふれも 400 になる。
  - 受注の一覧が全件を読む（ページ分け）。
  - 画面の起動の時の設定の確かめ（`InitialUsers` の文言）、明細を消すボタンにテストが無い。
  - Swagger の Bearer の定義。`SignInManager` の上書きが登録の順に頼っている。
  - `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする。
  - `Routes.razor` の「権限がありません」の bUnit テスト。
  - `.razor` の SALES001 の自動化、Day47 の3件。
  - 無効にした得意先を請求先にしてよいか。
  - 一度だけ起きた、DB のテストがすべて準備の段階で落ちた件（見張る。今日は見なかった）。
