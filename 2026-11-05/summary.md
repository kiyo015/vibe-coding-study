# Day44 学習記録（2026-11-05）— 締め請求の画面、2週目の振り返り

基幹システム開発計画の30日目で、段階2（画面と権限）の10日目。2週目（Day40〜44、画面）の最終日。

- **作ったもの:** 締め請求の画面（一覧・締め・詳細）。
- **持ち越しの分:** 請求先を Domain で守る、二重請求のテストの前提を確かめる（どちらも段階1から）。PR #16 の AI レビューの Minor 3件。Day43 のボタン名のブラウザでの確認。
- **2週目の振り返り:** 最後の節に書いた。

**完了条件「経理が画面で締め請求でき、営業は締めの画面を開けない」は達成した。** bUnit の画面のテストと、ブラウザでの操作で確かめた。

## 今日行った処理

### 1. 請求先を Domain で守る（段階1から）

Day43 の受注日と同じ進め方にした。振る舞いを変えない変更を先にコミットし、検査はテストで RED を見てから入れた。

| 項目 | 直す前 | 直した後 |
|---|---|---|
| 受注の得意先 | DB の裏の列（シャドウプロパティ）。Domain から見えない | `SalesOrder.Customer`。コンストラクタで受け取る |
| 売上の得意先・請求先 | ユースケースとテストが外部キーの値を直接入れる | 受注の得意先から Domain が決める（計上した時点の請求先を写す） |
| 支店で締める | ユースケースが止める | `Invoice.Create(請求先, …)` が 400 で止める |
| 別の請求先の売上 | ユースケースの検索だけが頼り | `Invoice.Create` が 409 で止める（RED を見た） |
| 支店の請求先を読み込まずに売上を作る | **黙って支店あての売上になる**（RED: 例外が出なかった） | 例外で止まる |
| 受注の得意先を読み込まずに売上を作る | ― | 理由の分かる例外で止まる |

- 支店の請求先の読み込み忘れは、売上の `InvoiceId` と同じ形で塞いだ。`Customer.BillingCustomerId` を Domain に出し、請求先を持つのに読み込んでいなければ `BillingTarget` が止める。得意先の登録の検査（請求先は1段まで）も同じ所を通るので、読み込み忘れで黙って通らない（PR #14 の Minor）。
- DB の形は変わらない（`has-pending-model-changes`）。
- 二重請求のテスト（請求書を読み込まずに渡す）で、前提（`Invoice` が null、`InvoiceId` はある）も確かめる。前提が崩れると、請求書だけを見る検査でも止まり、テストの意味が無くなるため。
- テストのデータ作り（`TestScenario`）は、追跡から外れた得意先で受注を足すと、得意先まで新しい行として挿入された（PK の重複）。外部キーの値だけを入れていた時は起きなかった。外れていれば付け直す形にした。

### 2. 締め請求の画面

| 画面 | 内容 |
|---|---|
| `/invoices` | 一覧（全員）。新しい順、状態は日本語。締めの入口は経理と管理者だけ。読み込んでから表を出す |
| `/invoices/new` | 締め。請求先は請求先を持たない得意先（無効も含む。残っている売上を請求するため）。締め日の初期値は、選んだ請求先の今日以前で最近の締め日（`Customer.LatestClosingDate`）。締めると請求書の画面へ移る |
| `/invoices/{id}` | 金額（前回請求額・入金額・繰越額・今回売上・消費税・請求額）、税率ごとの内訳、売上の番号 |

- **URL を直接開いた時も拒む。** 締めの画面は最初に `Permissions.Require` を呼ぶ。営業が開くと 403 の理由が出て、入力欄は出ない。
- 請求先を選ばずに締めると「請求先を選ぶ。」。締め日の誤り・まだ来ていない・締め済み・売上が無いは、ユースケースと Domain の理由がそのまま出る。
- `InvoiceUseCases.ListAsync`・`ListBillingCustomersAsync` を足し、`PermissionTests` の行にも足した。メニューに「請求書」を足した。

### 3. PR #16 の Minor

| 項目 | 直す前 | 直した後 |
|---|---|---|
| 出荷できない受注で指示の画面を開く | 入力欄が出る（送れば 409） | 理由を出して入力欄を出さない（RED を見た） |
| 無い受注の出荷の一覧 | 空の一覧 | 404（RED を見た） |
| 数量の書式 `0.###` | 丸めに見える | 小数3桁までは `EnsureQuantity` が手前で限るので丸まらない、とコメントに書いた |

画面から Domain の例外を作ることは、アーキテクチャのテスト（`WebLayerTests`）が止める。出荷できない受注は、例外でなく画面の文言で知らせる形にした。

残りの2件（確定の後の読み直しの失敗、単価の誤りの文言が残る）は持ち越した。

### 4. 画面のテストのホストが落ちた件

| 症状 | 原因 | 対策 |
|---|---|---|
| 結合のテストを全部流すと、ホストが落ちる（85件目で中止）か、4分20秒かかる。単独や `--blame` では起きない | 締めの入口のテストが、一覧を読み込む前から出ている表を見て終わり、読み込みとテストの後始末（ロールバック）が同じ DB の接続を同時に使った | 一覧は読み込んでから出し、テストは読み込みの終わりを待つ。直した後は3回続けて201件成功（約50秒）。CLAUDE.md に書いた |
| `dotnet test` が10分を超えて終わらない | 出力を `head` で途中まで読んで捨て、書き手が詰まった | 出力はファイルに書いてから読む |

### 5. テスト

- **RED を見てから直したもの:**
  - Domain: 支店での締め・別の請求先の売上（2件）、最近の締め日（5件）
  - 結合: 請求先を読み込まない支店（例外が出なかった）、出荷できない受注の指示の画面、無い受注の出荷の一覧
- `InvoicePageTests`（13件。bUnit。ユースケースは本物で、テストのトランザクションを使う）:
  - 経理が請求先を選ぶと締め日の初期値が入り、締めると請求書へ移る。
  - 選択肢は請求先を持たない得意先だけ。営業は 403 で入力欄なし。
  - 売上が無ければ 409、締め日でなければ 400、請求先を選ばなければ 400。
  - 詳細の金額・内訳・売上の番号（営業も見られる）。無い請求書は 404。
  - 一覧は新しい順で状態は日本語。入口は経理と管理者だけ。すべての状態に表示名。
- 時計は日本時間 11/05 10:00 に固定した。**これは実行した日と同じ日付で、前日の学び（実行する日と重ねない）に反した。** 今日を時計でなくサーバーの時刻で決める誤りがあっても、今日に限っては締め日の初期値のテストが偶然に通る。締めの記録を書いていて気付いた。対照実験にもこの誤りを入れていない（Day45 へ持ち越し）。
- 「どのテストも通らない経路」を書き出し、受注の得意先を読み込まずに確定すると止まることのテストを足した。

| 対照実験（入れた誤り） | Domain | 結合 | Web |
|---|---|---|---|
| 請求先を持つ得意先で締められる | 1 | 1 | 0 |
| 別の請求先の売上を入れる | 1 | 0 | 0 |
| 請求先を読み込まなくても黙って通す | 0 | 1 | 0 |
| 売上の請求先を受注の得意先にする | 1 | 11 | 0 |
| 受注の得意先の読み込みを確かめない | 0 | 1 | 0 |
| 最近の締め日で当日を含めない | 1 | 0 | 0 |
| 締める売上を請求先で絞らない | 0 | 3 | 0 |
| 一覧の参照で入口の検査をしない | 0 | 1 | 0 |
| 請求先の選択肢で入口の検査をしない | 0 | 1 | 0 |
| 請求先の選択肢に支店も出す | 0 | 1 | 0 |
| 請求先が空の文言を外す | 0 | 1 | 0 |
| 請求書の一覧を古い順にする | 0 | 1 | 0 |
| 無い受注の出荷の一覧を空で返す | 0 | 1 | 0 |
| **締めの画面で入口の検査をしない** | **0** | **0** | **0** |
| 締めの入口を全員に出す | 0 | 1 | 0 |
| 締め日の初期値を入れない | 0 | 2 | 0 |
| 締めた後に請求書へ移らない | 0 | 1 | 0 |
| 請求書の状態の表示名を1つ書き忘れる | 0 | 1 | 0 |
| 税率ごとの内訳を出さない | 0 | 1 | 0 |
| 売上の番号を出さない | 0 | 1 | 0 |
| 出荷できない受注でも入力欄を出す | 0 | 1 | 0 |
| メニューに請求書を出さない | 0 | 0 | 3 |

22通りのうち21通りを検出した。数字は落ちたテストの件数。

- **未検出の1通り:** 画面が最初に呼ぶ `ListBillingCustomersAsync` も同じ「締め請求」の検査をするので、画面の検査を外しても 403 になる。**両方を外すと「営業が締めの画面を開くと」が落ちる**ことを確かめた。検査が二重なだけで、テストの抜けではない。画面の検査は CLAUDE.md の決まりどおり残した。
- 「別の請求先の売上を入れる」は結合では落ちない。ユースケースの検索が請求先で絞っているため。逆に「締める売上を請求先で絞らない」は Domain の検査が止める（結合 3）。2段で守っている。

### 6. ブラウザでの確認（管理者）

1. T001（月末締め）を選ぶと、締め日の初期値は 10/31。売上は 11/04 なので「2026-10-31 締めで請求する売上が無い。」（409）。11/30 は「まだ来ていない(今日は 2026-11-05)」（400）。
2. 今日が締め日になる5日締めの得意先 `T005` を登録し、受注 `SO-000002`（`TP01` 2個・210円）を登録・承認した。
3. 出荷を指示した。**「指示を取消」のボタン名を確かめた**（受注の「取消」と別の名前で並ぶ。Day43 の持ち越し）。
4. 11/05 で確定した（出荷済・`SR-000003`）。
5. 締めの画面で T005 を選ぶと、初期値は 11/05。締めると `IN-000001` の画面へ移った。期間 10/06〜11/05（最初の締めなので前の月の締め日の翌日から）、10%: 210円・税 21円、計 231円、売上 `SR-000003`。
6. もう一度締めると「T005 は 2026-11-05 まで締め済み。」（409）。一覧に確定・231 で出た。

- サーバーのログとブラウザのコンソールに、エラーは無かった。
- 開発用 DB に `T005`・`SO-000002`・`SH-000003`・`SR-000003`・`IN-000001` が残る（物理削除しない）。

### 7. CI と AI レビュー（PR #17）

| 回 | 費用・時間 | 判定 | 対応 |
|---|---|---|---|
| 1回目 | $0.6204・73秒 | マージ可（Critical 0・Important 0・Minor 5） | Day45 へ持ち越した |

- Minor 5件:
  - 締め日を空にして送ると 0001-01-01 で送る。その時の文言のテストが無い（画面で「締め日を入れる。」を出すか、テストを足す）。
  - 売上の請求先を読み込まずに `Invoice.Create` へ渡した時の例外を、テストで確かめていない。
  - 得意先の登録で請求先の読み込みを忘れると 500。プログラムの誤りとして意図どおりなら、コメントに書く。
  - 一覧の画面の字下げ。
  - 請求書の一覧が全件を読む（受注の一覧と同じ）。
- CI は成功した。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- モデルの変更なし（`has-pending-model-changes`）
- `dotnet test`: すべて成功、合計443件（前日 417件）

  | 対象 | 件数 | 前日 |
  |---|---|---|
  | Domain | 192 | 183 |
  | アーキテクチャ | 16 | 16 |
  | Web | 31 | 31 |
  | 結合 | 204 | 187 |

## 今日学んだこと

- **「読み込んでいないナビゲーションが null に見えて、検査を黙って通る」が3回目だった。**
  - 1回目は売上の請求書（Day31）、2回目は得意先の請求先（PR #14）、3回目は今日の支店の請求先。
  - 外部キーの値を Domain に出し、「関連はあるのに読み込んでいない」を例外にする形で塞いだ。黙って通らず、読み込み忘れはすぐ分かる。
- **画面のテストは、読み込みが終わったのを見てから終える。**
  - 早く終えると、テストの後始末と画面の読み込みが同じ接続を同時に使う。症状は、ホストが落ちる・遅くなるという、原因から遠い形で出た。
  - 単独で流すと起きず、`--blame` でも起きなかった。並びと速さで出たり消えたりする誤りは、手掛かりを「同時に何が動いていたか」に置く。
- **対照実験で検出しなかった時は、外すものを2つに増やして確かめる。** 今日の未検出は、検査が二重なだけだと切り分けられた。
- **道具が詰まることもある。** 出力を途中まで読むと、テストの実行そのものが止まった。出力はファイルに書いてから読む。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 受注を足すと「重複したキー値は一意性制約"PK_customers"違反」 | 追跡から外れた得意先をナビゲーションで渡すと、新しい行として挿入される | `TestScenario` で外れていれば付け直す |
| 2人が同時に締めるテストで同じ重複 | 別のセッションに、こちらのセッションの得意先を渡した | 売上と一緒に、そのセッションで請求先を読む |
| 請求書の一覧のテストが失敗 | テストのデータで C003 にも売上を入れていた | 一覧のテストだけ C003 に売上を入れる |
| メニューのテストが失敗 | 期待のメニューに「請求書」が無い | 期待に足した |
| テストのホストが落ちる・10分を超える | 上の4. | 上の4. |

## 2週目（Day40〜44）の振り返り

**予定の作業はすべて完了した。** マスタ・受注・出荷・締め請求の画面ができ、どれも役割で入口とボタンが変わり、URL を直接開いても拒む。

| 指標 | 2週目の始め（Day39 の終わり） | 2週目の終わり |
|---|---|---|
| sales-core のテスト | Domain 147・アーキテクチャ 14・Web 19・結合 89 | Domain 192・アーキテクチャ 16・Web 31・結合 204 |
| 画面 | ログインとトップだけ | 10画面（マスタ3・受注3・出荷の指示・請求3。受注の詳細に出荷の一覧と操作） |
| 本人に決めてもらったこと | ― | 4件（承認の基準、DbContext の寿命、請求先は1段まで、税区分の入れ方）。どれも作業の前に聞いた |
| 対照実験 | ― | 90通り（11・17・17・23・22）。未検出は2通りで、どちらも理由を確かめた（画面の起動のテストが無い、検査が二重） |
| AI レビュー | ― | PR 5件で9回（#13 1回・#14 3回・#15 3回・#16 1回・#17 1回）。Important は計2件（どちらも Day42） |

**うまくいったやり方（3週目も続ける）**
- **「どのテストも通らない経路」を先に書き出す**（1週目の振り返りで決めた試み）。毎日1件以上の抜けが見つかった。
  - Day40: 設定の誤りが最初の登録まで気付かれない
  - Day41: サービスの登録・描画の方式
  - Day42: 無効のマスタを選択肢から外す
  - Day43: 出荷の一覧で受注を絞る
  - Day44: 受注の得意先の読み込み
- **ブラウザで実際に操作する。** テストでは見えない誤りが見つかった（税区分が無い・起動の文言・メニューの間隔、「残り 3.000」、同じ名前のボタン）。
- **状態と規則を Domain に寄せ、画面とユースケースが同じ規則を使う。** `SalesOrderStatusRules`・`ShipmentStatusRules`・出荷日・請求先。画面に出るボタンと、押して通る操作が食い違わない。

**繰り返した失敗**
- **読み込みに頼る検査（3回目）。** 塞ぎ方は決まった（外部キーの値を Domain に出す）。
  - **3週目に試すこと:** Domain の判断にナビゲーションを使う時は、最初からこの形にする。
- **画面のテストの待ち方（2回）。** Day41 は入力が反映される前に送った（CI で5回中2回失敗）、今日は読み込みの前に終えた（ホストが落ちた）。
  - **3週目に試すこと:** 画面は読み込みが終わってから中身を出し、テストはその中身を待つ。Playwright（Day45）でも同じ待ち方にする。
- **テストの時計（3回）。** Day42 はサーバーのタイムゾーン（UTC で前の日）、Day43 は実行する日と重なる日付。**Day44 も、前日の学びを決めたのに、時計を実行した日と同じ日にした。** 決めたことが手順になっていない。
  - **3週目に試すこと:** 時計を固定する時は、テストを書いた日と同じ月日にしないことを、対照実験の書き出し（「通らない経路」）に毎回1行入れる。
- **道具の空振り。** 改行（CRLF）と `sed`（Day43）、出力を途中まで読んで詰まる（Day44）。どれも変更の前か、すぐに分かる形で止まった。

## 成果物

**sales-core**（タグ `day44`）
- [src/SalesCore.Domain/Invoice.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Domain/Invoice.cs)（請求先の検査）・[Customer.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Domain/Customer.cs)（`BillingCustomerId`・`LatestClosingDate`）・[SalesOrder.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Domain/SalesOrder.cs)（`Customer`）・[SalesRecord.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Domain/SalesRecord.cs)（得意先・請求先）・[SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Domain/SalesOrderLine.cs)
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Application/InvoiceUseCases.cs)・[InvoiceContracts.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Application/InvoiceContracts.cs)・[SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Application/SalesOrderUseCases.cs)
- [src/SalesCore.Web/Components/Pages/Invoices/](https://github.com/kiyo015/sales-core/tree/day44/src/SalesCore.Web/Components/Pages/Invoices)（一覧・締め・詳細・表示名、新規）・[NewShipment.razor](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Web/Components/Pages/Orders/NewShipment.razor)・[NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day44/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [tests/SalesCore.Integration.Tests/InvoicePageTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Integration.Tests/InvoicePageTests.cs)（新規）・[PersistenceMappingTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Integration.Tests/PersistenceMappingTests.cs)・[AuditAndConcurrencyTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Integration.Tests/AuditAndConcurrencyTests.cs)・[TestScenario.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Integration.Tests/TestScenario.cs)・[ShipmentPageTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Integration.Tests/ShipmentPageTests.cs)
- [tests/SalesCore.Domain.Tests/InvoiceTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Domain.Tests/InvoiceTests.cs)・[CustomerTests.cs](https://github.com/kiyo015/sales-core/blob/day44/tests/SalesCore.Domain.Tests/CustomerTests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day44/docs/domain/business-rules.md)（請求先の検査・締め日の初期値）・[CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day44/CLAUDE.md)（画面のテストの終え方）
- [kiyo015/sales-core#17](https://github.com/kiyo015/sales-core/pull/17)

**Study**（タグ `day44`）
- [2026-11-05/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day44/2026-11-05/summary.md)
- [2026-11-05/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day44/2026-11-05/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day44/study_plan_next_month.md)（Day44・2週目の振り返り）

## 次回予告

**Day45 — 端から端までのテスト（Playwright）**
- Playwright の導入（手元と CI の両方。CI のブラウザの準備を含む）。
- 営業がログイン → 受注 → 承認 → 分納で出荷、経理がログイン → 締め → 請求額が段階1の API のテストと同じ、を1本で通す。
- 完了条件: 端から端までのテストが CI で通る。
- 振り返りで決めたこと: 画面は読み込みが終わってから中身を出し、テストはその中身を待つ。

**持ち越し（Day45 の先頭に書き写した）**
- PR #17 の AI レビューの Minor:
  - 締め日を空にして送った時の文言（画面で止めるかテスト）。
  - 売上の請求先を読み込まずに `Invoice.Create` へ渡した時の例外のテスト。
  - 得意先の登録で請求先の読み込み忘れが 500（意図をコメントに）。
  - 請求書の一覧の画面の字下げ。請求書の一覧が全件を読む。
- `InvoicePageTests` の時計を、実行する日と重ならない日にする（今日は 11/05 で重なった）。「今日をサーバーの時刻で決める」の対照実験も入れる。
- PR #16 の AI レビューの Minor の残り: 確定の後の読み直しの失敗が確定の失敗に見える、単価の誤りの文言が次に送るまで消えない。
- 前日からの持ち越し:
  - 桁あふれの文言が受注の入力の前提（`OperationError` は共通）。入力以外の桁あふれも 400 になる。
  - 受注の一覧が全件を読む（ページ分け）。
  - 画面の起動の時の設定の確かめ（`InitialUsers` の文言）、明細を消すボタンにテストが無い。
  - Swagger の Bearer の定義。`SignInManager` の上書きが登録の順に頼っている。
  - `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする。
  - `Routes.razor` の「権限がありません」の bUnit テスト。
  - `.razor` の SALES001 の自動化、Day47 の3件。
  - 無効にした得意先を請求先にしてよいか。
  - 一度だけ起きた、DB のテストがすべて準備の段階で落ちた件（見張る。今日のホストの落ちとは別。今日は原因が分かった）。
