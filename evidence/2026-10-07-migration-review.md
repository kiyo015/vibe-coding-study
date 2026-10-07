# Day25（2026-10-07）最初のマイグレーション AddStageOneTables：SQL レビューの記録

`sales-core/.claude/skills/migration/SKILL.md` の手順どおりに、生成 → SQL を出してレビュー → テスト用DB → 開発用DB の順で進めた記録。最終の SQL は `sales-core/docs/migrations/2026-10-07-AddStageOneTables.sql`。

## 対照実験：RESTRICT の設定が無いと、どうなるか

`dotnet ef dbcontext script`（マイグレーションを作らずにモデルから SQL を出す）で、DbContext の「外部キーをすべて RESTRICT にする」2行を一時的に外したときと比べた。

| | ON DELETE CASCADE | ON DELETE RESTRICT |
|---|---|---|
| 設定なし（EF Core の既定） | **13本** | 0本 |
| 設定あり | 0本 | 15本 |

設定が無いと、必須の外部キー13本がすべて CASCADE になる。たとえば `FK_sales_orders_customers_customer_id` が CASCADE なので、得意先を1件消すと、その得意先の受注・明細・出荷・売上が連鎖して黙って消える。

## 1回目の生成：レビューで1件引っかかった

| 確かめること | 結果 |
|---|---|
| データを消す操作・型の変更 | 無し |
| 削除の連鎖 | CASCADE 0本 |
| 金額・数量の型 | 決まりどおり |
| **NULL 可否** | **✗ `sales_orders.number`・`shipments.number`・`sales_records.number` に NOT NULL が無い** |
| 一意制約 | 番号・コードに付いている |
| 余計なもの | INSERT は `__EFMigrationsHistory` の1件だけ |

原因: 番号はシャドウプロパティ（エンティティに無い列）の文字列で、既定で NULL を許す。PostgreSQL の一意インデックスは NULL を何件でも通すので、**番号の無い受注をいくつでも作れる**状態だった。

対処: `IsRequired()` を付け、未適用なので手順6どおりに作り直した（`dotnet ef migrations remove` は dev-guard が止めるので、生成された2ファイルを消し、スナップショットを `git checkout` で戻した）。回帰を止めるテスト「番号の無い受注は保存できない」を追加。

## 2回目：team-reviewer（opus）の SQL レビュー

結果の全文は `2026-10-07-sql-review-by-team-reviewer.md`（$0.61・88秒・権限拒否0件）。判定は「修正後マージ可」、Critical なし。

| 指摘 | 重さ | 対応 |
|---|---|---|
| 税率の期間が重なる・逆転する行を登録できる（同じ日に税率が2つあると、受注明細にどちらを写すか決まらず、税額が狂う） | Important | **直した。** ドメインで逆転を止める（テスト先行）、DB に CHECK 制約 `ck_tax_rates_valid_period`、`btree_gist` の排他制約 `ex_tax_rates_no_overlap`（EF Core に API が無いので、マイグレーションに SQL で手書き） |
| 同じ出荷に同じ受注明細を2行入れられる | Minor | **直した。** `(shipment_id, sales_order_line_id)` に一意制約 |
| ER図の「後で作るもの」に `sales_orders.quotation_id` が無い | Minor | 直した（文書） |
| `audit_logs.user_id` が NULL を許す理由が書かれていない | Minor | 直した（文書。ユーザーを作る段階2まで操作した人が無い） |
| 締め日・数量・単価に CHECK 制約が無い | Minor | **見送り。** ドメインとテストで守っていて、DB にも書くと規則が2か所になる。DBに直接書く別の入口ができたら見直す |

## 3回目：直した SQL を確かめて適用

```
CASCADE 0 / RESTRICT 15 / double・real 0 / 桁の無い numeric 0 / DROP 0 / INSERT 1（履歴だけ） / NOT NULL の number 3
CONSTRAINT ck_tax_rates_valid_period CHECK (valid_to IS NULL OR valid_to >= valid_from),
CREATE UNIQUE INDEX "IX_shipment_lines_shipment_id_sales_order_line_id" ON shipment_lines (shipment_id, sales_order_line_id);
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE tax_rates ADD CONSTRAINT ex_tax_rates_no_overlap EXCLUDE USING gist (tax_category_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&);
```

- テスト用DB: 結合テスト14件すべて成功（`btree_gist` は DB の所有者 `salescore_dev` で作れた）
- 開発用DB: `migrations list` で未適用が `AddStageOneTables` だけであることを確かめてから `database update`。適用後の未適用 0件

## 結合テストで期待値を直した2件（実装は正しかった）

| テスト | 誤っていた期待値 | 正しい値と理由 |
|---|---|---|
| 返品の後に残りを出荷 | 33円（コメントは「67 → 100」） | **34円**。返品の後なので手元は 1個 → 2個。33.33 × 2 ＝ 66.66 → 67 から 33 を引く |
| 明細のある受注を DB から消す | SQLSTATE 23503（foreign_key_violation） | **23001**（restrict_violation）。ON DELETE RESTRICT が止めると 23001、何も指定しない NO ACTION なら 23503。期待値を 23001 にしたので、RESTRICT が付いていることまで区別できる |

## スキルが呼ばれるか（新しいセッション・haiku）

| 依頼 | Skill の呼び出し | 答え |
|---|---|---|
| 「受注に『納期』の列を足したい。DBにも反映して」 | 無し | 業務の意味を決めるのが先なので `domain-rule-change` → 実装 → `migration` の順、と答えた（呼ばずに説明だけ） |
| 「audit_logs の occurred_at にインデックスを足して、開発用DBに反映して」 | **`Skill(migration)`** | ER図 → 構成 → 生成 → SQL確認 → テスト用DB → 開発用DB の順 |

費用: $0.044・$0.040。
