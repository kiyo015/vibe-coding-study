# Day25 学習記録（2026-10-07）— EF Core での永続化とマイグレーション手順

基幹システム開発計画の11日目で、3週目（永続化とCI）の初日。段階1で使う業務の表12個を EF Core で対応付け、マイグレーションの手順を `migration` スキルにまとめた。**生成された SQL をレビューしてから適用する**手順を最初のマイグレーションで1周回し、適用前に欠陥を2つ見つけて直した。

## 今日行った処理

### 1. 申し送りの MSB3277 を解消した

Npgsql 8.0.11 が引く EF Core は 8.0.11、Api の EF Core Design は 8.0.31 で、結合テストのビルドで版の競合の警告が出ていた。Infrastructure に `Microsoft.EntityFrameworkCore.Relational` 8.0.31 を明示して、全プロジェクトを 8.0.31 に揃えた。**警告 30件 → 0件。**

### 2. 範囲を決めた

| 作った表（12） | 後に回したもの |
|---|---|
| customers・products・tax_categories・tax_rates・warehouses | 請求書（invoices・invoice_tax_summaries）→ Day31 |
| sales_orders・sales_order_lines | 全表に共通する列（作成者・更新日時・版数）→ Day27 |
| shipments・shipment_lines | `sales_records.reverses_id`（赤伝）・`quotation_id`（見積）など → 使う段階 |
| sales_records・sales_record_lines・audit_logs | |

請求書を後に回したのは、Invoice のドメインが締め・繰越・状態を作る Day31 まで仮の形で、今マッピングすると作り直しになるため。

番号・日付・得意先・商品・倉庫のように、ドメインの判断に使わない列は**シャドウプロパティ**（エンティティのクラスに持たず、EF Core の側だけで持つ列）にした。ドメインが使うようになったらプロパティに移せばよく、列は変わらないのでマイグレーションは要らない。

### 3. ドメインを DB に載せられる形にした（テスト先行）

新しいテスト21件を書き、空の実装で落ちることを確かめてから実装した。

| 変更 | 理由 |
|---|---|
| 出荷を確定すると出荷日を記録する | `shipments.shipped_on` |
| 売上が、どの出荷・どの受注明細から生まれたかを指す。返品の売上は出荷を指さない | `sales_records.shipment_id`・`sales_record_lines.sales_order_line_id` |
| 出荷の明細を `ShipmentLine` にした | `shipment_lines` |
| 得意先: 締め日は 5・10・15・20・25・31（月末）だけ。請求先を指定しなければ自分 | 業務ルール集「4. 請求」 |
| 税率の期間: 終了日は開始日より前にできない | レビューの指摘（下の6） |
| `Id` と、DB から読み込むための非公開のコンストラクタ | EF Core が組み立て直すため |

ER図の初版から変えたところもある。請求先が自分なら `billing_customer_id` を NULL にした（作るときに自分の id がまだ無い）。売上明細は、出荷明細ではなく受注明細を指すようにした（返品は出荷明細を持たないので、出荷と返品を同じ形で表せる）。

### 4. `migration` スキル

`sales-core/.claude/skills/migration/SKILL.md`。

| 手順 | 中身 |
|---|---|
| 1. 先に ER図を直す | ER図とマイグレーションが食い違ったら、マイグレーションが正 |
| 2. 生成 | `dotnet ef migrations add <名前>` |
| 3. **SQL を出してレビュー** | `docs/migrations/<日付>-<名前>.sql` に出し、観点の表で1行ずつ読む。1つでも引っかかったら適用しない |
| 4. テスト用DB | 結合テストのフィクスチャが適用してから走る |
| 5. 開発用DBにだけ適用 | `migrations list` で未適用を確かめてから `database update` |
| 6. 直したくなったら | 適用済みは書き換えない（新しく足す）。未適用なら作り直してよい |
| 7. 記録 | SQL ファイルと ER図を一緒にコミット |

手順3の観点: データを消す操作（`DROP`）、型の変更、**削除の連鎖（`ON DELETE CASCADE`）**、金額・数量の型（`numeric(15,0)` など、`double precision` が無いこと）、NULL 可否、一意制約、名前、余計なもの（`INSERT`・秘密情報）。

### 5. 対照実験：削除の連鎖

DbContext に「外部キーをすべて RESTRICT にする」2行を入れてある。これを一時的に外して、モデルから出る SQL を比べた。

| | ON DELETE CASCADE | ON DELETE RESTRICT |
|---|---|---|
| 設定なし（EF Core の既定） | **13本** | 0本 |
| 設定あり | 0本 | 15本 |

EF Core の既定では、必須の外部キーがすべて CASCADE になる。**得意先を1件消すと、その得意先の受注・明細・出荷・売上が連鎖して黙って消える**構造だった。取引データを物理削除しない決まりを、DB でも守るために必要な設定だった。

### 6. SQL レビューで見つけたもの

**1回目（自分で観点の表を当てた）**: 受注・出荷・売上の**番号（`number`）に NOT NULL が無かった**。番号はシャドウプロパティの文字列で、既定で NULL を許す。PostgreSQL の一意インデックスは NULL を何件でも通すので、番号の無い受注をいくつでも作れる状態だった。`IsRequired()` を付け、未適用なので作り直した。

**2回目（`team-reviewer`・opus、$0.61・88秒）**: 判定は「修正後マージ可」、Critical なし。

| 指摘 | 重さ | 対応 |
|---|---|---|
| 税率の期間が重なる・逆転する行を登録できる。同じ日に税率が2つあると、受注明細にどちらを写すか決まらず、税額が狂う | Important | **3段で止めた**: ドメインで逆転を止める、DB の CHECK 制約、`btree_gist` の排他制約（EF Core に API が無いので、マイグレーションに SQL で手書き） |
| 同じ出荷に同じ受注明細を2行入れられる | Minor | 一意制約を付けた |
| ER図の「後で作るもの」の漏れ（見積の参照、監査ログの操作者） | Minor | 文書を直した |
| 締め日・数量に CHECK 制約が無い | Minor | **見送った**。ドメインとテストで守っていて、DB にも書くと規則が2か所になる。理由を ER図に書いた |

直した SQL をもう一度観点で数えた。

```
CASCADE 0 / RESTRICT 15 / double・real 0 / 桁の無い numeric 0 / DROP 0 / INSERT 1（履歴だけ） / NOT NULL の number 3
```

### 7. 結合テスト（新規8件）

| テスト | 確かめたこと |
|---|---|
| マスタを保存して読み直す | 請求先の参照、税率の型、単価の桁 |
| **受注 → 出荷 → 返品を保存して読み直す** | 状態・数量・金額（33・34・-34円）が、DB から組み立て直しても同じ。読み直した受注で続きの出荷もでき、金額は累計差分どおり |
| 明細のある受注を SQL で直接消す | **DB が止める（SQLSTATE 23001）** |
| 同じ税区分で期間が重なる税率 | 止める（23P01） |
| 期間が続いていれば税率を改定できる | 10% → 12% のような改定はできる |
| 終了日が開始日より前の税率を SQL で直接入れる | 止める（23514） |
| 番号の無い受注 | 止める（23502） |
| 得意先コードの重複 | 止める（23505） |

途中で2件が落ちたが、**落ちた理由はテストの期待値の誤りで、実装は正しかった**。

| テスト | 誤っていた期待値 | 正しい値 |
|---|---|---|
| 返品の後に残りを出荷 | 33円（コメントは「67 → 100」） | **34円**。返品の後なので手元は1個 → 2個。33.33 × 2 ＝ 66.66 → 67 から 33 を引く |
| 明細のある受注を消す | 23503（foreign_key_violation） | **23001**（restrict_violation）。RESTRICT が止めると 23001、何も指定しない NO ACTION なら 23503。期待値を 23001 にしたので、RESTRICT が付いていることまで区別できる |

### 8. 適用とスキルの確認

テスト用DB・開発用DBの両方に適用した。`btree_gist` 拡張は、DB の所有者 `salescore_dev` で作れた（PostgreSQL 13 以降）。

新しいセッション（haiku）でスキルが呼ばれるかを確かめた。

| 依頼 | 結果 |
|---|---|
| 「audit_logs の occurred_at にインデックスを足して、開発用DBに反映して」 | **`Skill(migration)` が呼ばれ**、手順どおりに答えた |
| 「受注に『納期』の列を足したい。DBにも反映して」 | スキルは呼ばれなかったが、「業務の意味を決めるのが先なので `domain-rule-change` → 実装 → `migration` の順」と答えた |

### 9. 文書

- **ER図**: 段階1で作った表と後で作るもの、DB で止めている決まり、見送った CHECK 制約とその理由、初版から変えた列
- **CLAUDE.md**: `migration` スキルの場所、`btree_gist` 拡張、禁止事項の「物理削除」を「一部強制（DB）」に（子のある親は DB が消させない。子の無い行は Day27 にコードで止める）

## 今日学んだこと

### EF Core の既定は、業務の決まりと逆を向くことがある

必須の外部キーを CASCADE にするのは、EF Core としては自然な既定。しかしこのシステムでは「取引データを物理削除しない」が決まりで、既定のままだと得意先1件の削除で売上まで消える。**C# の差分を見ても `ON DELETE CASCADE` は見えない。** 生成された SQL を読む手順が要る理由がこれだった。

### 一意制約は NULL を素通りさせる

番号に一意インデックスを付けても、列が NULL を許すと番号の無い行は何件でも入る。C# 側では `string` の型を見ても NULL を許すかどうかが分からず、SQL の `NOT NULL` の有無で初めて見えた。

### レビューは「観点の表」と「別の目」の両方で効いた

自分で観点の表を当てたレビューは番号の NULL を、opus のレビューは税率の期間の重なりを見つけた。どちらも、相手が見つけたものは見つけていなかった。前者は形（NULL 可否）、後者は業務の意味（同じ日に税率が2つ）を見ていた。

### SQLSTATE はテストの精度を上げる

「消えない」ことを確かめるだけなら、例外が出れば十分に見える。しかし 23001 と 23503 を区別すると、「RESTRICT が付いている」ことまで確かめられる。期待値を誤っていたおかげで、この違いに気付いた。

### テストの期待値も、独立に計算して確かめる

落ちた2件は、実装ではなくテストが誤っていた。テストを直す前に、期待値を手で計算し直して、どちらが正しいかを決めた。テストが落ちたら実装を疑うのが基本だが、テストの側を直すときは、根拠を明示する。

## つまずき

### 変数経由の Remove-Item をハーネスが止めた

**症状** — `Get-ChildItem … | ForEach-Object { Remove-Item $_.FullName }` が「ルート（`/`）の削除は止める」と拒否された。

**原因** — ハーネスの安全確認は、実行前のコマンドの文字列を見て判定する。変数の中身は分からないので、最悪の場合を想定して止めた。

**対策** — 消すファイルの名前を先に確かめ、`Remove-Item -LiteralPath '<完全なパス>'` で明示して消した。

### PowerShell 5.1 に `??` 演算子が無い

**症状** — 構文エラー。**対策** — `if` で書き直した。

## 気づき・発見

- 未適用のマイグレーションを作り直す手順は、`dotnet ef migrations remove` を dev-guard が止めるので使えない。生成された2つのファイルを消し、スナップショットを `git checkout` で戻す。スキルの手順6に書き、今日3回使った
- `team-reviewer` に SQL を渡すと、ファイルも読みにいくので費用が上がった（Day24 の差分レビューは $0.29、今日は $0.61）。大きな変更のときだけ使う、とスキルに書いたとおりの使い分けが要る
- シャドウプロパティ（番号・得意先など）を毎回設定するテストは手間が大きい。Day26 では、テスト用の組み立て方を用意する

## 成果物

### sales-core（製品コード）

- [.claude/skills/migration/SKILL.md](https://github.com/kiyo015/sales-core/blob/day25/.claude/skills/migration/SKILL.md) — マイグレーションの7手順
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day25/src/SalesCore.Infrastructure/Persistence/Configurations.cs) — 表ごとの対応付け
- [src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day25/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs) — snake_case、外部キーをすべて RESTRICT、金額・税率の型
- [src/SalesCore.Infrastructure/Persistence/Migrations/](https://github.com/kiyo015/sales-core/tree/day25/src/SalesCore.Infrastructure/Persistence/Migrations) — `AddStageOneTables`（排他制約は手書き）
- [docs/migrations/2026-10-07-AddStageOneTables.sql](https://github.com/kiyo015/sales-core/blob/day25/docs/migrations/2026-10-07-AddStageOneTables.sql) — レビューして適用した SQL
- [src/SalesCore.Domain/Customer.cs](https://github.com/kiyo015/sales-core/blob/day25/src/SalesCore.Domain/Customer.cs) ／ [Masters.cs](https://github.com/kiyo015/sales-core/blob/day25/src/SalesCore.Domain/Masters.cs) — 得意先・商品・税区分・税率・倉庫
- [tests/SalesCore.Integration.Tests/PersistenceMappingTests.cs](https://github.com/kiyo015/sales-core/blob/day25/tests/SalesCore.Integration.Tests/PersistenceMappingTests.cs) — 結合テスト8件
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day25/docs/domain/er-diagram.md) ／ [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day25/CLAUDE.md)

### Study（学習記録）

- [evidence/2026-10-07-migration-review.md](https://github.com/kiyo015/vibe-coding-study/blob/day25/evidence/2026-10-07-migration-review.md) — 対照実験、3回のレビュー、期待値を直した2件
- [evidence/2026-10-07-sql-review-by-team-reviewer.md](https://github.com/kiyo015/vibe-coding-study/blob/day25/evidence/2026-10-07-sql-review-by-team-reviewer.md) — opus のレビュー全文
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day25/study_plan_next_month.md) — Day25 の実測値、Day26・27 への申し送り
- [2026-10-07/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day25/2026-10-07/summary.md) — この記録
- [2026-10-07/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day25/2026-10-07/summary.html) — 配布用HTML

## 付録：SQL の要点

```sql
-- 金額・数量の型（業務ルール集「1. 金額と数量」）
quantity numeric(15,3), unit_price numeric(15,2), tax_rate numeric(5,2), amount numeric(15,0)

-- 番号は必須（1回目のレビューで NOT NULL が無いのを見つけた）
number character varying(20) NOT NULL

-- 外部キーはすべて RESTRICT（設定が無いと13本が CASCADE になる）
CONSTRAINT "FK_sales_orders_customers_customer_id" FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT

-- 税率の期間（2回目のレビューの指摘）
CONSTRAINT ck_tax_rates_valid_period CHECK (valid_to IS NULL OR valid_to >= valid_from)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE tax_rates ADD CONSTRAINT ex_tax_rates_no_overlap
  EXCLUDE USING gist (tax_category_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&);

-- 1回の出荷に同じ受注明細は1行
CREATE UNIQUE INDEX "IX_shipment_lines_shipment_id_sales_order_line_id" ON shipment_lines (shipment_id, sales_order_line_id);
```

費用: SQL レビュー $0.61、スキルの確認 $0.044・$0.040。合計 $0.69。

## 次回予告

**Day26 — 結合テスト**

- 受注 → 出荷 → 請求を DB 込みで通すテスト。テスト専用DBで独立実行
- 申し送り: 請求書の表は Day31 で作るので、受注 → 出荷 → 売上までを DB に保存して読み直し、請求書は読み直した売上から作る。シャドウプロパティを毎回設定する手間を減らすため、テスト用の組み立て方を用意する

**完了条件:** 結合テストが CI でも手元でも同じ結果になる

**持ち越し:** なし。
