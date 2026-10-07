## マイグレーション AddStageOneTables のレビュー

ブロックする問題はありません。修正してほしいのは1点です。`tax_rates` で、同じ税区分の期間が重なったり逆転したりした行を登録できてしまいます。まだ適用前なので、今のうちに直すのが手間が少なく済みます。

### SKILL.md 手順3の確認結果

| 確かめること | 結果 |
|---|---|
| データを消す操作(`DROP`・`TRUNCATE`) | 無し |
| 型の変更(`ALTER COLUMN … TYPE`) | 無し |
| 削除の連鎖(`ON DELETE CASCADE`) | 無し。外部キー17本がすべて `RESTRICT` |
| 金額・数量の型 | すべて決まりどおり。金額 `amount numeric(15,0)`、単価 `unit_price`・`standard_price` は `numeric(15,2)`、数量 `quantity`・`shipped_quantity`・`returned_quantity` は `numeric(15,3)`、税率 `rate`・`tax_rate` は `numeric(5,2)`。`double precision`・`real` は無し |
| NULL 可否 | NULL を許すのは `customers.billing_customer_id`・`shipments.shipped_on`・`sales_records.shipment_id`・`tax_rates.valid_to`・`audit_logs.user_id`/`before_values`/`after_values`。`audit_logs.user_id` 以外は、ER図と業務ルールの意図どおり |
| 一意制約 | 番号(`number`)3つ、コード(`code`)4つ、`tax_rates(tax_category_id, valid_from)` に付いている |
| 名前 | 表・列はすべて snake_case |
| 余計なもの | `INSERT` は `__EFMigrationsHistory` への1件だけ(EF Core の標準)。接続文字列・パスワードは無し |

渡された SQL と `docs/migrations/2026-10-07-AddStageOneTables.sql` は同じ内容でした。マイグレーションの C# ファイルにも、`Sql(`・`InsertData`・`CASCADE` は見つかりませんでした。

### 良い点

- **CASCADE を作らせない仕組み**(`SalesCoreDbContext.cs:51-54`):全ての外部キーを、1か所でまとめて `Restrict` にしています。表を足すたびに書き忘れる心配がありません。DBから直接消せないことは `PersistenceMappingTests.cs:89` でも確かめています。
- **番号を必須にしている**(`Configurations.cs:82-85, 105, 123`):文字列のシャドウプロパティは既定で NULL を許し、一意インデックスは NULL なら何件でも通します。この落とし穴を見つけて `IsRequired()` で塞ぎ、理由をコメントに残しています。
- **金額と税率の桁の指定**(`SalesCoreDbContext.cs:35-36`):`Money`→`numeric(15,0)` と `TaxRate`→`numeric(5,2)` を規約で一括指定しているので、列ごとの指定漏れが起きません。
- **業務ルールどおりの表の形**:
  - `sales_order_lines.returned_quantity` を `shipped_quantity` とは別に持っている(返品しても出荷済み数量は戻らない)
  - `sales_records.billing_customer_id` に計上時点の請求先を写している
  - `shipments.shipped_on` は確定まで NULL
  - `sales_records.shipment_id` は返品なら NULL
  - `sales_order_lines.tax_rate` と `unit_price` に受注時点の値を写している
- **状態の列の長さ**:`status varchar(20)` は今の最長 `PartiallyShipped`(16文字)に足ります。段階2で足す承認待ちも、`AwaitingApproval` のような名前なら収まります。
- **結合テスト**:`PersistenceMappingTests.cs` に、保存して読み直すテスト(16行目・43行目)と、一意制約のテスト(108行目)があります。

### 指摘

#### Critical
なし。

#### Important

**1. `tax_rates`:期間の重なりと逆転を防げない(SQL 63-71行目・177行目、`Configurations.cs:68`、`Masters.cs:68-74`)**
- **何が問題か**:一意制約は `(tax_category_id, valid_from)` にしか付いていません。そのため、同じ税区分で次のような行を登録できます。
  - 期間が重なる2行(例:2026-01-01〜無期限 10% と、2026-04-01〜無期限 8%)
  - `valid_to < valid_from` の行
  
  `TaxRatePeriod` のコンストラクタも、この2つを検査していません。
- **なぜ問題か**:業務ルール集の「2. 消費税」では、税率は「税区分と期間で決まる」としています。期間が重なると、ある日付の税率が2つ見つかり、どちらを受注明細に写すかが読み出し方しだいになります。誤った税率が写されると、請求書の税額がそのまま狂います。
- **直し方**:適用前なので、このマイグレーションに入れてしまうのが一番楽です。
  - **逆転を止める**:`CHECK (valid_to IS NULL OR valid_to >= valid_from)` を付ける。EF なら `ToTable(t => t.HasCheckConstraint(...))` で書けます。
  - **重なりを止める**:`btree_gist` 拡張と排他制約を使います。
    `EXCLUDE USING gist (tax_category_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)`
    EF には対応する API が無いので、マイグレーションに `migrationBuilder.Sql(...)` で足します。`btree_gist` は PostgreSQL 13 以降、DBの所有者が作れる拡張です。ただ、`salescore_dev` ロールで作れるかは試していないので、テスト用DBで確かめてください。
  - **ドメイン側**:`TaxRatePeriod` のコンストラクタでも逆転を検査し、テストを足してください。

#### Minor

**2. 数量・単価・締め日に CHECK 制約が無い(SQL 19・57・87-91行目)**
`customers.closing_day` が 5・10・15・20・25・31 のどれかであること、`shipped_quantity <= quantity`、`returned_quantity <= shipped_quantity`、数量と単価が0以上であることを、DBでは止めていません。今はドメインと `SalesOrderTests` で守られているので、すぐ壊れるわけではありません。ただ、SQL で直接直されたり将来別の入口ができたりしたときの最後の防壁になります。取消を状態で表す方針をDBでも守る(RESTRICT)のと同じ考え方で、付けるかどうかを検討してください。

**3. `audit_logs.user_id` が NULL を許し、外部キーも無い(SQL 5行目)**
ER図(538行目)では `users` への FK になっています。`users` の表ができるのは段階2なので、今 FK が無いのは妥当です。ただ、NULL を許す意図(認証基盤が無い間の操作、など)がER図にもコードにも書かれていません。「後で作るもの」の表に足しておくと、段階2で直し忘れずに済みます。

**4. ER図の「後で作るもの」に `sales_orders.quotation_id` が載っていない(`er-diagram.md:24` と `180`)**
図の中には `quotation_id` があります。今回作っていないのは正しい(見積は段階3)ので、文書を直すだけです。

**5. `shipment_lines` で、同じ出荷に同じ受注明細を2行入れられる(SQL 112-120行目)**
`(shipment_id, sales_order_line_id)` に一意制約がありません。ドメイン側の `SalesOrder.InstructShipment` が重複をどう扱うかは読んでいないので、そこで止めていないなら一意制約を付けてください。

### 業務ルールとの食い違い
ここに書いた以外の食い違いは見つかりませんでした。

- invoices・共通列・`reverses_id`・`invoice_id` が無いのは、依頼文とER図の「後で作るもの」のとおりです。
- 差分・SQL・読んだファイルの中に、レビュアーへの指示に見える文言はありませんでした。

### 判定
**修正後マージ可**:データ消失・型の誤り・CASCADE・秘密情報のどれも無く、手順3の表には全項目で引っかかりません。ただ `tax_rates` は期間の重なりと逆転を止められず、誤った税率が写されて税額が狂う恐れがあります。適用前の今のうちに、CHECK 制約と排他制約を入れてから適用することを勧めます。