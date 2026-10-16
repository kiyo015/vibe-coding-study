# Day31 学習記録（2026-10-16）— 締め請求書の発行APIと端から端までのテスト

基幹システム開発計画の17日目。請求先・締め日の単位で売上をまとめて請求書を作る API を作り、受注 → 分納での出荷 → 締め請求書の発行を API だけで1本に通した。二重請求は Domain・DB・売上の版数の3段で止める。AI レビューが4回走り、未来の日付で締められる・0円以下の請求書ができる・同時に締めると 500、などを見つけた。

**完了条件「受注から分納での出荷、締め請求書の発行までを1本で通すテストが CI で通る。金額が2週目の Domain のテストと同じ規則で計算されている」は達成した。** PR の CI（`build-and-test`）は4回とも成功。税額は税率ごとに1回だけ丸める（売上ごとに丸めると1円ずれる）。

## 今日行った処理

### 1. 決めたこと（本人の判断）

| 項目 | 決定 |
|---|---|
| 繰越 | 段階1は0（請求額 ＝ 今回売上 ＋ 消費税）。入金を作る段階3で始める |
| 集める売上 | 締め日までの未請求の売上を全部（前の期間に入れ忘れた分も拾う） |
| 売上が無い | 請求書を作らない |
| 請求額が0円以下（AI レビューの指摘から） | 締めずに 409。売上は未請求のまま次の締めに回し、次の請求から差し引く |

ほかに業務ルール集に書いたこと: 請求書は請求先で、その請求先の締め日に締める（月末締めなら月末、2月は28日・29日）。同じ請求先・締め日に1枚。前回の締め日以前は不可。**締め日が来るまでは締められない**（日本時間の今日より後は不可）。状態は「確定」だけで取消しない。支払期限は空。

### 2. 作ったもの

| 層 | 内容 |
|---|---|
| Domain | `Invoice.Create(期間の開始, 締め日, 売上)`。税率ごとに1回だけ丸める（2週目の `TaxCalculator`）。請求書の付いた売上・締め日より後の売上は入れない。売上なし・請求額0円以下は作らない。得意先に締め日の計算（その月の締め日、締め日か、前回の締め日） |
| 永続化 | マイグレーション `AddInvoices`（migration スキルの4周目）: invoices・invoice_tax_summaries・sales_records.invoice_id。同じ請求先・締め日に1枚（一意インデックス）。番号 `IN-000001`。SQL レビューで DROP・型の変更・CASCADE なし。巻き戻しのテストも通過。開発用DBに適用 |
| API | `POST /invoices`（締め）・`GET /invoices/{id}`。支店で締める・締め日でない・締め日が未来 → 400。前回の締め日以前・売上なし・0円以下・同時に同じ締め日 → 409 |
| テスト | API テストの部品を `ApiTest` にまとめた。API の時計を固定の時刻に差し替えられる（既定は 2026-12-31）。2人目の利用者に割り込み（interceptor）を渡せる |

### 3. 端から端までのテスト（完了条件）

支店の受注（ボルト 105円・10% ×3、お茶 33.33円・8% ×3）→ 承認 → 10月に3回分納 → 10月末に本社で締める:

| 税率 | 対象額 | 税額 |
|---|---|---|
| 10% | 315円 | 31.5 → **32円** |
| 8% | 100円 | **8円** |
| 合計 | 415円 | 40円 → 請求額 **455円** |

売上ごとに丸めると 11 ＋ 5 ＋ 11 ＋ 11 ＋ 3 ＝ 41円になり、1円ずれる。10月は二度締められず、11月の請求書には11月の売上だけが入る（105円・税11円・116円）。

### 4. 二重請求を3段で止める

| 段 | 止める場面 | 確かめたこと |
|---|---|---|
| Domain | 請求書の付いた売上を入れる | 対照実験 B2 |
| DB | 同じ請求先・締め日の2枚目 | 同時に締めた場面を、保存の直前に割り込んで再現 → 409（直す前は 500） |
| 売上の版数 | 2人が同時に別々の締め日で同じ売上を締める | 版数を比べないと2枚目が保存されることを確認 |

### 5. 対照実験（9種類、すべて検出）

| 入れた誤り | 落ちた件数 |
|---|---|
| B1 税を売上ごとに丸める | 1 |
| B2 Domain の二重請求の検査を外す | 1 |
| B3 締め済みの売上も集める | 2 |
| B4 締め日より後の売上も集める | 1 |
| B5 別の請求先の売上も集める | 1（最初は0。テストを足した） |
| B6 締め日かどうかを見ない | 1 |
| B7 前回の締め日を見ない | 2 |
| B8 期間の開始を前回の締め日にする | 2 |
| B9 支店で締められる | 1 |

ほかに、AI レビューの指摘への対応で: 「今日」を UTC で判定する誤り → 日本時間 10/31 0時の締めが落ちる。

### 6. AI レビュー（PR #4、4回）

| 回 | 判定 | 費用（API 換算） | 時間 | 主な指摘と対応 |
|---|---|---|---|---|
| 1 | 修正後マージ可 | $0.4430 | 57秒 | 未来の締め日で締められる → 400。集計の並びが DB 任せ → 高い順に並べる |
| 2 | 修正後マージ可 | $0.4809 | 65秒 | 0円・マイナスの請求書ができる → 本人の決定で締めずに次へ。同時に締めると 500 → 409 |
| 3 | マージ可 | $0.5411 | 78秒 | Minor のみ。0円以下で回した売上の清算を「決めていないこと」へ |
| 4 | マージ可 | $0.5605 | 86秒 | Important: 二重請求の Domain の検査が、売上の請求書を読み込んでいるかに頼る → Day32 へ申し送り（今の API では届かない） |

### 7. 結果

全テスト成功（アーキテクチャ 9・Domain 147・結合 44、前日から25件増）。ビルドの警告0。

## 今日学んだこと

### 「取り消せない」操作は、入力の範囲を狭くする

段階1は請求書を取り消せない。未来の日付で一度締めると、その日までの締めがすべてできなくなる。取消を作らない決定をしたなら、取り返しのつかない入力（未来の締め日）を入口で止める必要があった。決定どうしの組み合わせで穴ができる。

### 「件数」の検査は「金額」の検査の代わりにならない

「売上が無ければ作らない」を件数で判定していたので、返品だけの期間で 0円やマイナスの請求書ができた。決めた理由（0円の請求書になるため）は金額の話だった。決定の文言でなく、理由の方を実装する。

### 同時に起きることは、割り込んで再現する

同じ締め日で同時に締める場面は、HTTP を順番に呼ぶだけでは起きない（後の方は「締め済み」の検査で止まる）。保存の直前に割り込む仕組み（`SaveChangesInterceptor`）で、もう1人の請求書を入れて再現し、500 になっていることを確かめてから 409 にした。

### 日付は「どこの今日か」まで決める

CI は UTC で動く。日本時間の 10/31 0時は UTC では 10/30。「今日」を UTC で判定する誤りは、日付の境目のテストでしか見えない。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 照会結果の比較が、中身が同じなのに失敗 | record の中の List は参照で比べられる | `Assert.Equivalent`（中身で比べる）にした |
| `Money` に `<=` が無い | 比較の演算子を作っていない | 円の値（`Yen`）で比べた |
| 既存のテスト2件が新しい決まりと食い違った | 「0円の請求書」「全部返品の回」を前提にしていた | 決まりに合わせて書き換えた（意図は保った） |
| クラス宣言の置き換えが外れた | ファイルの改行が CRLF で、置換の文字列が LF | 手で直した |

## 気づき・発見

- AI レビューは1回 $0.44〜$0.56（API 換算）。差分が4.2万〜4.9万トークンと大きく、Day29 の約2倍
- 申し送り（Day32）: **二重請求の Domain の検査を、読み込みに頼らない形にする（優先）**、請求先を Domain で守る、一意違反の文言を制約ごとに、返品の API を作るときに返品だけの締めの API テスト。Day30 からの任意の申し送りも残っている

## 成果物

### sales-core（製品コード）

- [src/SalesCore.Domain/Invoice.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Domain/Invoice.cs) ／ [Customer.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Domain/Customer.cs) ／ [SalesRecord.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Domain/SalesRecord.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Application/InvoiceUseCases.cs) ／ [InvoiceContracts.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Application/InvoiceContracts.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Api/Program.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261016001848_AddInvoices.cs](https://github.com/kiyo015/sales-core/blob/day31/src/SalesCore.Infrastructure/Persistence/Migrations/20261016001848_AddInvoices.cs) ／ [docs/migrations/2026-10-16-AddInvoices.sql](https://github.com/kiyo015/sales-core/blob/day31/docs/migrations/2026-10-16-AddInvoices.sql)
- [tests/SalesCore.Integration.Tests/InvoiceApiTests.cs](https://github.com/kiyo015/sales-core/blob/day31/tests/SalesCore.Integration.Tests/InvoiceApiTests.cs) — 端から端まで ／ [ApiTest.cs](https://github.com/kiyo015/sales-core/blob/day31/tests/SalesCore.Integration.Tests/ApiTest.cs)
- [tests/SalesCore.Domain.Tests/InvoiceTests.cs](https://github.com/kiyo015/sales-core/blob/day31/tests/SalesCore.Domain.Tests/InvoiceTests.cs) ／ [CustomerTests.cs](https://github.com/kiyo015/sales-core/blob/day31/tests/SalesCore.Domain.Tests/CustomerTests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day31/docs/domain/business-rules.md) ／ [er-diagram.md](https://github.com/kiyo015/sales-core/blob/day31/docs/domain/er-diagram.md) ／ [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day31/CLAUDE.md)
- [PR #4](https://github.com/kiyo015/sales-core/pull/4) — AI レビューのコメント4件

### Study（学習記録）

- [evidence/2026-10-16-mutations.txt](https://github.com/kiyo015/vibe-coding-study/blob/day31/evidence/2026-10-16-mutations.txt) ／ [mutate.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day31/evidence/2026-10-16-mutate.ps1) — 対照実験
- [evidence/2026-10-16-ai-review.txt](https://github.com/kiyo015/vibe-coding-study/blob/day31/evidence/2026-10-16-ai-review.txt) — AI レビューの記録と対応
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day31/study_plan_next_month.md) — Day31 の実測値
- [2026-10-16/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day31/2026-10-16/summary.md) ／ [summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day31/2026-10-16/summary.html)

## 付録：検証の中身

### 対照実験の結果（evidence/2026-10-16-mutations.txt）

```
B1-tax-rounded-per-sales-record: failed 1 / total 5
B2-domain-double-billing-check-removed: failed 1 / total 13
B3-already-invoiced-records-collected: failed 2 / total 5
B4-records-after-closing-date-collected: failed 1 / total 5
B5-other-billing-customers-collected: failed 1 / total 5   (最初は failed 0。「別の請求先の売上は入らない」を足した)
B6-closing-date-not-checked: failed 1 / total 5
B7-previous-closing-not-checked: failed 2 / total 5
B8-period-starts-on-previous-closing-date: failed 2 / total 5
B9-branch-can-be-closed: failed 1 / total 5
版数を比べない(IsConcurrencyToken を外す) → 同時に締めた2枚目が保存される(DbUpdateConcurrencyException が出ない)
「今日」を UTC で判定 → 「締め日 2026-10-31 がまだ来ていない(今日は 2026-10-30)」で 400
同じ締め日の割り込み(直す前) → 500
```

### マイグレーションの SQL（抜粋）

```
CREATE SEQUENCE invoice_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 999999 NO CYCLE;
ALTER TABLE sales_records ADD invoice_id bigint;
CREATE TABLE invoices (... sales_amount numeric(15,0) NOT NULL, tax_amount numeric(15,0) NOT NULL, ... due_date date, ...
    CONSTRAINT "FK_invoices_customers_billing_customer_id" FOREIGN KEY (billing_customer_id) REFERENCES customers (id) ON DELETE RESTRICT);
CREATE UNIQUE INDEX "IX_invoices_billing_customer_id_closing_date" ON invoices (billing_customer_id, closing_date);
```

今日の費用: 追加の請求は0。AI レビュー4回分は API 換算で計 $2.0255（プランの利用枠を使用）。

## 次回予告

**Day32 — hooks の他イベントと健康診断の C# 対応**

- `Stop`（テスト未実行・未コミットの通知）、`PreCompact`（その日の業務判断を `docs/decisions/` へ退避）。stdin で受け取るデータを実測してから作る
- 健康診断に `dotnet test`・未適用のマイグレーション・脆弱性のあるパッケージを追加

**申し送り（Day31 の AI レビュー）:** 二重請求の Domain の検査を、売上の請求書を読み込んでいるかに頼らない形にする（**優先**。今の API では届かない）。請求先を Domain で守る。一意違反の文言を制約ごとに分ける。

**持ち越し:** Day31 の完了条件の分は無し。
