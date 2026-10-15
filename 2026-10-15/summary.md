# Day30 学習記録（2026-10-15）— 受注・出荷API

基幹システム開発計画の16日目（4週目の初日）。受注の登録・承認・取消、出荷の指示・確定・取消を API にした。番号は DB のシーケンスで振る。Day29 で作った AI レビューが初めて本番の機能の PR を見て、4回のレビューで Critical 1件・Important 8件を見つけた。全部確かめ、正しいものを直した（2件は既に対策済み・申し送り）。

**完了条件「受注登録と出荷登録が API 経由で通り、状態が正しく遷移する」は達成した。** HTTP 経由のテストで、受注 → 承認 → 分納2回 → 出荷済まで通り、状態に合わない操作は 409 で止まる。

## 今日行った処理

### 1. 決めたこと（本人の判断）

| 項目 | 決定 |
|---|---|
| 番号 | DB のシーケンスで振る通し番号（`SO-000001`・`SH-`・`SR-`）。保存が失敗すると飛ぶ（欠番あり） |
| 単価 | 明細で指定しなければ商品の標準単価。指定すればその単価 |

業務ルール集には、ほかに次を書いた（私が書き、AI レビューで直したものを含む）。

- 税率は受注日時点の、商品の税区分の税率。その日の税率が無ければ受注できない
- 無効な得意先・商品では受注できない。無効な倉庫からは出荷を指示できない。受注の後で得意先・商品を無効にしても、その受注は出荷できる
- 出荷日（＝売上日）は受注日より前にできない。締めた期間の日付で確定することを止めるかは未決定

### 2. 作ったもの

| 層 | 内容 |
|---|---|
| Api（`Program.cs`） | エンドポイント8本（受注: 登録・照会・承認・取消、出荷: 指示・照会・確定・取消）。例外を状態コードにする。weatherforecast のテンプレートを消した |
| Application（`SalesOrderUseCases`） | マスタを引き、Domain の操作をして保存する。エンティティに無い列（得意先・商品・倉庫・日付）を埋める。確定のときに売上の請求先を写す |
| Domain（`DomainExceptions.cs`） | 業務の誤りの例外型 `BusinessRuleException`（409）と `InvalidInputException`（400） |
| Infrastructure | 番号のシーケンスと既定値（マイグレーション `AddDocumentNumberSequences`） |

**依存の向きを直した。** テンプレートの Infrastructure → Application の参照が使われないまま残っていたので外し、Api → Application → Infrastructure → Domain にした。Application は DbContext を直接使う（インターフェースは挟まない）。

**例外と状態コード:** 入力の誤り（`InvalidInputException`）→ 400、無い → 404、業務の決まりに反する（`BusinessRuleException`）・同時更新 → 409、それ以外 → 500 で中身を返さない。

### 3. 番号のマイグレーション（migration スキルの3周目）

SQL レビュー: DROP・型の変更・CASCADE なし。シーケンスの作成と `SET DEFAULT` だけ。上限は 999999（`lpad` は6桁を超えると黙って切り詰めて番号が重なるので、その前にシーケンスで止める）。テスト用DBと開発用DBに当てた。

**巻き戻し（`Down`）が壊れていた。** EF Core が生成した `Down` は、列の既定値が使っているシーケンスを先に消そうとし、PostgreSQL が `2BP01`（依存しているものがある）で止めた。AI レビューの指摘で、巻き戻しのテストを先に書いて落ちることを確かめ、順番を直した。migration スキルにも「`Down` は `MigrationTests` が確かめる」を足した。

### 4. テスト（HTTP 経由、13件）

`WebApplicationFactory` で API を動かし、テストのトランザクションを共有させる。環境は `Testing` にして開発用DBは読ませない。

| テスト | 確かめたこと |
|---|---|
| 受注から出荷済まで | 受付 → 承認 → 一部出荷 → 出荷済。売上は累計差分で 172円・243円（計 415円＝受注額）。請求先は本社 |
| 単価の上書き・税率の日付 | 単価 100円で受注できる。9/30 の受注は 8%、10/1 は 10%（途中で変わる税区分）。税率の無い日は 400 |
| 状態に合わない操作 | 承認前の出荷、2回目の承認、受注数量を超える出荷、確定済みの再確定・取消、一部出荷の取消 → 409 で状態は変わらない |
| 入力の誤り・無いもの | 無いコード・数量0・明細なし・明細 null → 400。理由は日本語だけ（内部の引数名を付けない）。無い受注・出荷 → 404 |
| 無効なマスタ | 1つずつ無効にして確かめる。受注の後で無効にした得意先・商品は出荷できる |
| 出荷日 | 受注日より前は 400、当日は確定できる |
| 同時更新 | 2人目が開いた後に1人目が承認 → 2人目の取消は 409。**同じ明細への出荷（10 に 6 と 6）を2人が同時に確定 → 後の方は 409、出荷済みは 6、売上は1件** |
| 500 | 業務の誤りでない例外（EF Core の `ObjectDisposedException`）は 500 で、中身を返さない |

### 5. 対照実験（12種類 ＋ 1種類、すべて検出）

| 入れた誤り | 落ちた件数 |
|---|---|
| A1 単価の上書きを無視 | 1 |
| A2 請求先を写さない | 1 |
| A3 税率の日付を見ない | 1 |
| A4 業務の誤りを 400 にする | 2 |
| A5 承認を保存しない | 6 |
| A6 倉庫を確かめない | 1 |
| A7〜A9 無効な得意先・商品・倉庫を受け付ける | 各1 |
| A10 標準の例外も 409 で中身を返す | 1 |
| A11 同時更新を 409 にしない | 1 |
| A12 受注日より前の出荷日を受け付ける | 1 |
| 版数を比べない（同じ明細への同時確定） | 1（2人目の確定が通り 12 出荷になった） |

### 6. AI レビュー（PR #3、4回）

| 回 | 判定 | 費用（API 換算） | 時間 | 主な指摘 |
|---|---|---|---|---|
| 1 | 修正後マージ可 | $0.4574 | 91秒 | Critical: 無効なマスタの検査の範囲とテストの穴。Important: `Down` の順番、標準の例外を一律 409、同時更新と 500 のテストが無い、出荷日の検査が無い |
| 2 | マージ可 | $0.5092 | 71秒 | Minor: 400 の理由に引数名が付く ほか |
| 3 | 修正後マージ可 | $0.5715 | 97秒 | Important: 同じ明細への同時確定のテストが無い、`Money.Of` などのプログラムの誤りまで 400 になる。Minor: CLAUDE.md の表が切れた |
| 4 | 修正後マージ可 | $0.5633 | 102秒 | Important: 別々の明細の同時確定（Day27 の受注の版数で対策済み。差分の外なので AI からは見えない）、桁あふれで 500（申し送り） |

差分が大きいと入力が増え（3.4万〜4.7万トークン）、費用は Day29 の約2倍になった。

### 7. 実際の起動

開発用DB・Development 環境で起動。無い受注 → 404「受注 999999 が無い。」、無い得意先 → 400、壊れた JSON → 400。Swagger のエンドポイントは8本で、weatherforecast は出ない。

### 8. 結果

全テスト成功（アーキテクチャ 9・Domain 125・結合 36、前日から14件増）。ビルドの警告0。

## 今日学んだこと

### 一括置換は「意味」を見ない

例外型を Domain の型にそろえるとき、Domain 全体を sed で一括置換した。そのため、プログラムの誤りやマスタの整合性の検査（`Money.Of` の円未満の端数など）まで「利用者の入力の誤り（400）」になり、内部向けのメッセージを返す形になった。テストは型を合わせて全部通っていた。3回目の AI レビューで気付いた。**置換で直すと、1件ずつ「これは何の誤りか」を考える工程が抜ける。**

### テストが「どの検査で止まったか」を区別できているか

無効なマスタのテストは、3つを同時に無効にしていて、倉庫の検査だけで 400 になっていた。得意先・商品の検査が無くても通る。対照実験の A7〜A9 は最初の形でも全部捕まったが、それは誤りを1つずつ入れたから。**1つのテストで複数の検査をまとめて確かめると、どれか1つで止まって残りが見えなくなる。**

### 生成されたコードの、使わない側の道も確かめる

マイグレーションの `Up` は SQL レビューで読んだが、`Down` は読んでいなかった。障害のときにしか使わない道で、生成されたままでは動かなかった。巻き戻しもテストで確かめるようにした。

### AI レビューは、私が書いた業務ルールの文言も疑う

「無効な得意先・商品・倉庫では、受注も出荷の指示もできない」は私が書いた文言で、本人の決定ではなかった。AI レビューはこの文言と実装の食い違いを Critical として指摘した。業務として自然なのは「販売を終えた商品でも、受けた注文は出す」で、文言の方を直した。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| Application から Infrastructure を参照すると循環参照（MSB4006） | テンプレートの Infrastructure → Application の参照が残っていた（使われていない） | 外して Domain を直接参照させた |
| 税率 0%（非課税）を「税率が無い」と扱う書き方 | 税率の型は struct で、0% が既定値と同じ | 期間の行ごと読む形にした |
| `python -` が標準入力を待って止まった | 私のコマンドの書き方の誤り | バックグラウンドの処理を止め、Edit で書き換えた |
| 主コンストラクターで CS9107（警告をエラーにしている） | 引数を基底クラスとこのクラスの両方が保持する | 普通のコンストラクターにした |

## 気づき・発見

- **AI レビューは差分しか見ないので、既にある仕組みが見えない。** 4回目の Important 1（別々の明細の同時確定）は Day27 で対策とテストがあるのに、差分の外なので「恐れがある」と指摘された。差分の外を読ませるか（ツールを与える＝秘密に届く道が増える）、指摘を人が確かめるかの取り合い。今は後者
- `.http` ファイルに手で試す例を書いた。Study の `.claude/launch.json` に API の起動設定を足した
- 申し送り（AI レビューの Minor）: 出荷日の検査を Domain に移す（受注日を Domain に持たせるとき）、数量・単価が DB の桁を超えると 500、出力の型に入力の型を使い回している

## 成果物

### sales-core（製品コード）

- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day30/src/SalesCore.Api/Program.cs) — エンドポイントと例外の対応
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day30/src/SalesCore.Application/SalesOrderUseCases.cs) ／ [SalesOrderContracts.cs](https://github.com/kiyo015/sales-core/blob/day30/src/SalesCore.Application/SalesOrderContracts.cs)
- [src/SalesCore.Domain/DomainExceptions.cs](https://github.com/kiyo015/sales-core/blob/day30/src/SalesCore.Domain/DomainExceptions.cs) — 業務の誤りの例外型
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261015011137_AddDocumentNumberSequences.cs](https://github.com/kiyo015/sales-core/blob/day30/src/SalesCore.Infrastructure/Persistence/Migrations/20261015011137_AddDocumentNumberSequences.cs) ／ [docs/migrations/2026-10-15-AddDocumentNumberSequences.sql](https://github.com/kiyo015/sales-core/blob/day30/docs/migrations/2026-10-15-AddDocumentNumberSequences.sql)
- [tests/SalesCore.Integration.Tests/SalesOrderApiTests.cs](https://github.com/kiyo015/sales-core/blob/day30/tests/SalesCore.Integration.Tests/SalesOrderApiTests.cs) — API のテスト13件
- [tests/SalesCore.Integration.Tests/MigrationTests.cs](https://github.com/kiyo015/sales-core/blob/day30/tests/SalesCore.Integration.Tests/MigrationTests.cs) — 巻き戻しのテスト
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day30/docs/domain/business-rules.md) ／ [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day30/CLAUDE.md) ／ [.claude/skills/migration/SKILL.md](https://github.com/kiyo015/sales-core/blob/day30/.claude/skills/migration/SKILL.md)
- [PR #3](https://github.com/kiyo015/sales-core/pull/3) — AI レビューのコメント

### Study（学習記録）

- [evidence/2026-10-15-mutations.txt](https://github.com/kiyo015/vibe-coding-study/blob/day30/evidence/2026-10-15-mutations.txt) ／ [evidence/2026-10-15-mutate.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day30/evidence/2026-10-15-mutate.ps1) — 対照実験
- [evidence/2026-10-15-ai-review.txt](https://github.com/kiyo015/vibe-coding-study/blob/day30/evidence/2026-10-15-ai-review.txt) — AI レビューの記録と対応
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day30/study_plan_next_month.md) — Day30 の実測値
- [2026-10-15/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day30/2026-10-15/summary.md) ／ [2026-10-15/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day30/2026-10-15/summary.html)

## 付録：検証の中身

### 対照実験の結果（evidence/2026-10-15-mutations.txt）

```
A1-ignore-requested-unit-price: failed 1 / total 12
A2-billing-customer-not-copied: failed 1 / total 12
A3-tax-rate-ignores-order-date: failed 1 / total 12
A4-state-error-as-400: failed 2 / total 12
A5-approve-not-saved: failed 6 / total 12
A6-warehouse-not-checked: failed 1 / total 12
A7-inactive-customer-accepted: failed 1 / total 12
A8-inactive-product-accepted: failed 1 / total 12
A9-inactive-warehouse-accepted: failed 1 / total 12
A10-any-InvalidOperationException-as-409-with-message: failed 1 / total 12
A11-concurrency-not-409: failed 1 / total 12
A12-shipped-before-ordered-accepted: failed 1 / total 12
(3回目の指摘の後) IsConcurrencyToken を外す → 同じ明細への同時確定のテストが失敗(Expected: Conflict / Actual: OK)
```

### 巻き戻しのテスト（修正前）

```
失敗 MigrationTests.最後のマイグレーションは1つ前に巻き戻せる
  Npgsql.PostgresException : 2BP01: 他のオブジェクトが依存しているためシーケンスsales_order_number_seqを削除できません
```

### 番号の既定値（マイグレーションの SQL）

```
CREATE SEQUENCE sales_order_number_seq START WITH 1 INCREMENT BY 1 NO MINVALUE MAXVALUE 999999 NO CYCLE;
ALTER TABLE sales_orders ALTER COLUMN number SET DEFAULT ('SO-' || lpad(nextval('sales_order_number_seq')::text, 6, '0'));
```

今日の費用: 追加の請求は0。AI レビュー4回分は API 換算で計 $2.1014（プランの利用枠を使用）。

## 次回予告

**Day31 — 締め請求書の発行APIと端から端までのテスト**

- 申し送り（AI レビュー）: 出荷日の検査を Domain に移す、数量・単価が DB の桁を超えたら 400、出力の型の整理
- 請求書の表（invoices・invoice_tax_summaries）は Day25 からの申し送り

**持ち越し:** Day30 の分は無し。
