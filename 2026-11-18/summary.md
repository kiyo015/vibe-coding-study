# Day53 学習記録（2026-11-18）— 見積から受注

基幹システム開発計画の39日目で、段階3（販売の完結）の4日目。

- **決めたこと:** 作業の前に本人に4件を聞いた（受注日、受注を取り消した時の見積、有効期限の入れ方、期限切れの見積の提出）。4件とも推奨の案に決まった。
- **作ったこと:** 見積の全明細を1つの受注に写す処理と、見積の API（登録・参照・明細を直す・提出・失注・受注化）。`sales_orders.quotation_id` に元の見積を残し、一意インデックスで同じ見積から2回受注できないようにした。
- **片付けたこと:** PR #25 の Minor 5件（業務ルール集の古い一文、上限ちょうどの値のテスト、明細金額のあふれのエラーの欄、得意先が空の見積と同じ明細を2つの見積に入れること、数の入力の桁のテストを作業の決まりに）。

**完了条件「見積から受注が API で作れ、期限切れ・受注済・同時の受注化が止まることを対照実験付きで確かめてある」は達成した。** CI は全回成功。AI レビューは4回で、3回目と4回目はマージ可（計 $2.5187）（Critical・Important なし）。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 見積から受注にする時の受注日 | **受注にした日（日本時間の今日）。** 入力はさせない |
| 見積から作った受注を取り消した時 | **見積は受注済のまま。** もう一度受注にするなら新しい見積を作る |
| 見積の有効期限 | **登録の時に必ず入れる。** 既定値は持たない |
| 有効期限を過ぎた作成中の見積の提出 | **提出できない。** 有効期限の当日までは提出できる |

決定は業務ルール集「3.」の「見積と得意先別単価」と状態×操作の表（提出のマスに「有効期限の当日まで」）、段階3の設計の決定の表、`docs/decisions/2026-11-18.md` に書いた。

### 2. 見積を受注にする処理（Domain）

- `Quotation.ToSalesOrder(today, taxRateOn, threshold)` で、全明細を1つの受注にする。
  - 数量と単価は見積のまま写す。受注日は今日、税率は受注日の税率で引き直す。
  - 承認待ちになるかは、受注の登録と同じく税抜合計（100万円以上）で決まる。
  - 受注を作れた時だけ見積を受注済にする。見積を受注済にするだけの操作（`MarkOrdered`）は無くした。作れなかった時は提出済のまま残る。
- 提出を `Submit(today)` に変え、期限切れなら止める。
- `EnsureCanOrder(today)` を足し、状態と有効期限をほかの検査より先に見られるようにした。
- 見積明細が商品を持つ形にした（Day52 では DB の列だけで持っていた）。
- 見積を作る時に、得意先が空・同じ明細を2度・別の見積の明細を入れることを止めた。明細の「見積に入れた印」は、検査がすべて済んでから立てる（作れなかった見積の明細は作り直しに使える）。

### 3. DB（マイグレーション `AddSalesOrderQuotation`）

`sales_orders.quotation_id` を足した。NULL を許し（見積を通らない受注がある）、外部キーは RESTRICT、一意インデックス `IX_sales_orders_quotation_id` 付き。

- 手順: ER 図を先に直す → マイグレーションを作る → SQL を `docs/migrations/2026-11-18-AddSalesOrderQuotation.sql` に出して読む（データを消す操作・型の変更・削除の連鎖は無い）→ テスト用 DB の結合テスト → 開発用 DB に当てる（未適用0件）。
- 一意インデックスに引っかかった時の 409 の文言は「同じ見積からの受注」。`OperationError` の一覧に足した。

### 4. 見積の API（`/quotations`）

| 操作 | 道 | 役割 |
|---|---|---|
| 登録 | `POST /quotations`（201） | 営業・管理者 |
| 参照 | `GET /quotations/{id}` | 全員 |
| 明細を直す | `POST /quotations/{id}/lines/{lineId}` | 営業・管理者 |
| 提出・失注 | `POST /quotations/{id}/submit`・`/lost` | 営業・管理者 |
| 受注化 | `POST /quotations/{id}/order`（201、受注の場所を返す） | 営業・管理者 |

- 得意先・商品・単価・税率の引き方は、受注の登録と同じ関数を使う（`ActiveCustomerAsync`・`ActiveProductAsync`・`TaxRateOnAsync`・`CustomerPrice.UnitPriceFor`）。エラーの文言もそろう。
- 見積の単価は**見積日**の得意先別単価、税率も**見積日**の税率で引く。受注化では**受注日**の税率で引き直す。
- 受注にする時は、受注の登録と同じ検査をする（得意先・商品が無効になっていないか、受注日の税率があるか）。状態と有効期限はその前に見る（失注の見積に「商品が無効」と返さない）。
- 「日本時間の今日」は `TimeProvider` から作る（`JapanTime.Today`）。テストでは時計を止め、12/16 00:00（日本時間）の境目で税率が切り替わることを確かめた。
- 見積の2行（参照・登録〜受注化）を `PermissionTests` が役割の表と突き合わせる対象に移した。

### 5. PR #25 の Minor の片付け

- 業務ルール集の古い一文「数量を変える時は、受注にする前に見積を直す」を、今の決まり（提出済は直さず新しい見積を作る）に直した。
- 上限ちょうどの値を受け付けるテストを足した（数量 `999999999999.999`、単価 `9999999999999.99`、明細金額 15桁）。
- 明細金額が15桁を超えた時のエラーは、数量の欄を指さないようにした。
- 得意先が空の見積と、同じ明細を2つの見積に入れることを止めた（上の2.）。
- sales-core の CLAUDE.md の作業の決まりに「数の入力を足したら、Domain で桁を止めるテストも足す」を書いた。古くなっていた記述（桁あふれは 400）も消した。

### 6. 対照実験（25通り、すべて検出）

誤りを1つずつ入れて、テストが落ちることを確かめた。入れた誤りは元に戻してある。R1〜R20 は本体、R21〜R25 は AI レビューの対応の分。

| 番号 | 入れた誤り |
|---|---|
| R1・R2 | 提出で有効期限を見ない、受注化で有効期限を見ない |
| R3・R12 | 受注化で税率を見積のまま写す、受注化の税率を見積日で引く |
| R4 | 受注日を見積日にする |
| R5 | 受注を作る前に受注済にする |
| R6 | 受注に元の見積を残さない |
| R7 | DB の一意インデックスが無い |
| R8 | 見積の版数で止めない |
| R9 | 見積の版数で止めず、一意インデックスも無い |
| R10・R11 | 受注化で得意先・商品の有効を見ない |
| R13・R14 | 見積の単価・税率を今日で引く |
| R15 | 「今日」を日本時間でなく UTC の日付にする |
| R16 | 受注化の入口を参照の権限で検査する |
| R17 | 2つの見積に同じ明細を入れられる |
| R18 | 明細金額のあふれで数量の欄を指す |
| R19・R20 | 数量の上限を1桁厳しくする、明細金額の上限を1円厳しくする |
| R21 | 明細を見積に入れた印を、検査の前に立てる |
| R22 | 商品の無い明細を作れる |
| R23 | 有効期限を省くと日付の最小値にする |
| R24 | 明細を直す時に単価を省くと0円にする |
| R25 | 受注化で状態と有効期限を後で見る |

- **R8 と R9（二重の守り）:** 見積の版数だけを外しても、同時の受注化のテストは通った。後の方は一意インデックスが止めていた。両方外すと落ちた。同時の受注化は、版数と一意インデックスの二重で守られている。
- **R13 と R14（テストの穴を先に直した）:** 最初のテストは見積日と登録する日が同じ日で、「見積日でなく今日で単価や税率を引く」誤りを見逃す形だった。登録する日を 12/31 にずらし（12/16 からの単価 85円）、税の境目の日に作るテストにしてから実験した。

### 7. CI と AI レビュー（PR #26）

| 回 | 判定 | 費用 | 対応 |
|---|---|---|---|
| 1回目 | マージ可 | $0.6242 | Minor 4件を直した（作れなかった見積の明細が使えなくなる、商品が空、有効期限の省略、明細の対応の取り方） |
| 2回目 | 修正後マージ可 | $0.6225 | Important（明細を直す時に単価を省くと黙って0円）と Minor 2件（見積日の省略、受注化で状態を後で見る）を直した |
| 3回目 | マージ可 | $0.6349 | 任意の Minor 3件。Day54 へ回す |
| 4回目 | マージ可 | $0.6371 | 決定の記録を自動書き出しの形にそろえたコミット。Minor 2件（見積明細の読み込みに順序の指定が無い、明細の件数の検査にテストが無い）。Day54 へ回す |

2回目の Important は、テストで再現（200 が返り、0円の明細になった）してから直した（RED）。

### 確認

- `dotnet test`: 585件 → **613件**（Domain 272・Web 47・アーキテクチャ 20・結合 263・端から端まで 11）。
- Release ビルドの警告は0件。
- CI（`build-and-test`・`ai-review`）は全回成功。

## 今日学んだこと

- **値型の項目は、JSON で省くと黙って既定値になる。** `decimal UnitPrice` は省くと 0、`DateOnly` は `0001-01-01` になり、エラーにならない。必ず入れてほしい値は null を許す型で受け、「入れる」と返す。登録の有効期限と見積日は気付いて直したが、明細を直す API の単価は AI レビューに言われるまで同じ穴が残っていた。同じ形の入力は、まとめて見直す。
- **テストの日付が同じ日だと、「どの日付で引くか」の誤りが見えない。** 見積日 = 今日のテストでは、見積日で引いても今日で引いても同じ値になる。日付で値が変わる処理は、比べる2つの日付をずらし、その間に値が変わるデータを置いてはじめて確かめたことになる。
- **2つ目の柵があると、1つ目の柵のテストは確かめたことにならない。** R8 で版数を外しても、一意インデックスが同時の受注化を止めた。Day52 の Q12（版数と排他制約）と同じ形。守りが二重なのは良いが、どちらの柵が効いているかは1つずつ外すまで分からない。
- **検査の順番は、返す理由を決める。** 失注の見積で商品が無効だと、商品の検査を先にすると「商品が無効」と返る。直しても受注にできないので、利用者を迷わせる。直せない理由（状態・期限）を先に返す。
- **印を立てるのは、全部の検査が通った後。** 明細に「見積に入れた」印を検査の途中で立てると、後の検査で見積を作れなかった時に、その明細が二度と使えなくなる。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| bash のヒアドキュメントで書いたスクリプトが「unexpected EOF」で止まった | 引用符やバックスラッシュを含む文字列を、シェルが先に解釈した | スクリプトは Write ツールでファイルに書き、python で流す |
| テストのファイルの先頭に BOM が入った | 書き換えのスクリプトが BOM 付きで保存した | sed で取り除いた。書き換えは BOM と改行コードを保つ `ed.py` に寄せた |
| 対照実験のスクリプトが、置き換える文字列を見つけられなかった | 対象のファイルが CRLF で、スクリプトの文字列は LF だった | `chr(13)+chr(10)` に読み替えてから探す形にした |

## 成果物

**sales-core**（タグ `day53`）
- [src/SalesCore.Domain/Quotation.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Domain/Quotation.cs)（`ToSalesOrder`・`EnsureCanOrder`・`Submit(today)`）
- [src/SalesCore.Domain/SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Domain/SalesOrderLine.cs)
- [src/SalesCore.Application/QuotationContracts.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Application/QuotationContracts.cs)（新規）
- [src/SalesCore.Application/QuotationUseCases.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Application/QuotationUseCases.cs)（新規）
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Application/SalesOrderUseCases.cs)（得意先・商品の引き方を共通に）
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Application/Permissions.cs)
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Application/OperationError.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Api/Program.cs)（`/quotations`）
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261118003815_AddSalesOrderQuotation.cs](https://github.com/kiyo015/sales-core/blob/day53/src/SalesCore.Infrastructure/Persistence/Migrations/20261118003815_AddSalesOrderQuotation.cs)（新規）
- [docs/migrations/2026-11-18-AddSalesOrderQuotation.sql](https://github.com/kiyo015/sales-core/blob/day53/docs/migrations/2026-11-18-AddSalesOrderQuotation.sql)（新規）
- [tests/SalesCore.Domain.Tests/QuotationTests.cs](https://github.com/kiyo015/sales-core/blob/day53/tests/SalesCore.Domain.Tests/QuotationTests.cs)
- [tests/SalesCore.Domain.Tests/SalesOrderTests.cs](https://github.com/kiyo015/sales-core/blob/day53/tests/SalesCore.Domain.Tests/SalesOrderTests.cs)（上限ちょうどの値）
- [tests/SalesCore.Integration.Tests/QuotationApiTests.cs](https://github.com/kiyo015/sales-core/blob/day53/tests/SalesCore.Integration.Tests/QuotationApiTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/QuotationPersistenceTests.cs](https://github.com/kiyo015/sales-core/blob/day53/tests/SalesCore.Integration.Tests/QuotationPersistenceTests.cs)
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day53/tests/SalesCore.Integration.Tests/PermissionTests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day53/docs/domain/business-rules.md)
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day53/docs/domain/er-diagram.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day53/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-18.md](https://github.com/kiyo015/sales-core/blob/day53/docs/decisions/2026-11-18.md)（新規。本人の決定4件）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day53/CLAUDE.md)（数の入力の桁のテスト）
- [kiyo015/sales-core#26](https://github.com/kiyo015/sales-core/pull/26)

**Study**（タグ `day53`）
- [2026-11-18/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day53/2026-11-18/summary.md)
- [2026-11-18/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day53/2026-11-18/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day53/study_plan_next_month.md)

## 次回予告

**Day54 — 見積の画面、1週目の振り返り**
- 見積の一覧・登録・詳細（提出・失注・受注にする）の画面。営業の画面から受注まで通す。
- 1週目の振り返り。未完了を2週目の先頭に書き写す。
- 完了条件: 画面で見積を作って受注にでき、画面のテスト（bUnit）が通る。1週目の振り返りがある。

**持ち越し（Day54 の先頭に書いた）**
- **作業の前に聞く:** 見積日が今日より先の見積を許すか。今は許していて、見積日より前の日に受注にでき、その場合はまだ来ていない日の単価になる（PR #26 の AI レビュー3回目の Minor）。
- 一意インデックスが止めた時の 409 の文言（「同じ見積からの受注」）を確かめるテストが無い（3回目の Minor）。
- 受注化で見積明細を読む時に順序の指定が無い。受注明細の並びが見積の表示順と一致するかは EF Core の読み込み順に頼っている（4回目の Minor。`Include(q => q.Lines.OrderBy(l => l.Id))`）。
- 見積の一覧の API（画面と一緒に作る）。手で直した単価の後で得意先・日付を変えた時に入れ直して知らせる（Day52 の決定）。
- 出荷・返品の数量の整数部の桁は確かめていない。明細の件数が合わない時に止める処理はテストが無い（今は起きない経路）。
- PR #19 の Minor 3件、`Routes.razor` の「権限がありません」の bUnit テスト、DB の接続の時間切れ（見張る）。
