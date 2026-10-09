# Day27 学習記録（2026-10-09）— 楽観ロック・監査ログ・削除の禁止

基幹システム開発計画の13日目。全表に「作った人・日時・最後に変えた人・日時・版数」の列を足し（2本目のマイグレーション）、保存の入口で自動的に埋めるようにした。同時更新の衝突を版数で検知し、変えた値を監査ログに残す。物理削除は、アーキテクチャテスト・保存のとき・DB の3段で止める。

**完了条件は2つとも達成した。** 物理削除するコードを書くとアーキテクチャテストが落ちる（書き方5通りで確認）。同時更新の衝突をテストで再現できる（2つの場面）。

## 今日行った処理

### 1. 設計（最初に決めた3点）

| 項目 | やり方 | 理由 |
|---|---|---|
| 衝突の検知 | 全表に版数 `row_version` を持たせ、更新のたびに1上げる。保存のときに読んだ時点の値と比べる | PostgreSQL の `xmin` は同じトランザクションの中では値が変わらない。トランザクションを取り消す結合テストで衝突を再現できない |
| 監査ログ・作成者と更新日時 | 保存の入口（`SaveChangesAsync`）の1か所で埋める | 書き忘れが起きない。業務のデータと監査ログは1つのトランザクションで保存する |
| 物理削除の禁止 | アーキテクチャテスト、保存のとき、DB の3段 | 下の3に書く |

### 2. 2本目のマイグレーション（migration スキルの2周目）

`AddCommonColumns`。監査ログ以外の全11表に、`created_at`・`created_by`・`updated_at`・`updated_by`・`row_version` の5列を足した。

| SQL レビューの観点 | 数 |
|---|---|
| 列の追加（`ADD`） | 55 |
| CASCADE・DROP・型の変更 | 0 |
| INSERT | 1（マイグレーションの履歴だけ） |
| 監査ログの表への変更 | 0 |

NOT NULL の列には既定値（日時は `now()`、版数は `0`）があるので、既に行のある表に当てても失敗しない。テスト用DB（まっさらなスキーマに当てる `MigrationTests` を含む）と開発用DBの両方に適用した。

### 3. 物理削除の禁止（3段）

| 段 | 止めるもの | 仕組み |
|---|---|---|
| アーキテクチャテスト | 削除のコードを書くこと | 新しいプロジェクト `SalesCore.Architecture.Tests`。src の4プロジェクトの DLL を .NET 標準の `System.Reflection.Metadata` で読み（パッケージは足していない）、EF Core の `Remove`・`RemoveRange`・`ExecuteDelete(Async)` の呼び出しと、`DELETE FROM`・`TRUNCATE` の SQL が無いことを確かめる |
| 保存のとき | 削除の印の付いた行 | `SaveChangesAsync` が `Deleted` の行を見つけたら例外で止める |
| DB | 子のある親の削除 | 外部キーの RESTRICT（Day25） |

保存のときの段が必要な理由: **子の無い行（売上明細など）は、DB の RESTRICT も EF Core も止めない。** テストを先に書いた時点では、売上明細が実際に消せてしまうことを確認した。子のある親（受注など）は、EF Core 自身が RESTRICT を見て保存の前に止めるので、テストでは末端の行を使った。

DLL を読む仕組みそのものが働いているかを確かめるテストも1件入れた（テスト自身の DLL にある `"DELETE FROM probe_table"` が読めること）。読み方を誤ると「何も見つからない＝成功」になってしまうため。

### 4. 衝突の再現（結合テスト）

同じトランザクションを共有する「2人目の利用者」（2つ目の DbContext、`CreateAnotherSession()`）を作れるようにした。

| 場面 | 結果 |
|---|---|
| 同じ受注を2人が開く。1人が承認して保存した後、もう1人が古い画面のまま取り消す | 後から保存した方が `DbUpdateConcurrencyException` で止まり、承認済のまま残る |
| 3行の受注（1行目は出荷済）で、残りの2行を2人が別々の出荷で同時に確定する | 後から保存した方が衝突で止まる |

2つ目の場面が今日の発見。どちらも「ほかの行が残っている」と見て、受注の状態を一部出荷のままにする。**明細の版数だけを見ていると両方が通り、全部出荷したのに状態が一部出荷のまま残る。** そこで、受注明細が変わったら受注（集約の根）の版数も上げるようにした（計画に無かった追加）。

### 5. 監査ログ

業務の値のうち変わったものだけを、変更前と変更後の JSON で残す。作成者・更新日時などの共通の列と id は含めない。

| テストで確かめたこと | 値 |
|---|---|
| 承認 | `"status": "Received"` → `"Approved"`、操作した人と日時。`updated_at` は入らない |
| 出荷の確定 | 受注明細の出荷済み数量 0 → 2、売上明細の金額 67円（33.33 × 2 ＝ 66.66 → 67） |
| 作成 | 作った人・日時、版数 1 |

日時はテストで固定の時刻（`TimeProvider` を差し替える `FixedClock`）にした。

### 6. 対照実験（10ケース）

| ケース | 結果 |
|---|---|
| D1 `DbContext.Remove` | アーキテクチャテストが落ちた |
| D2 `DbSet.RemoveRange` | 落ちた |
| D3 `ExecuteDeleteAsync` | 落ちた |
| D4 生の `delete from` の SQL | 落ちた（SQL のテスト） |
| D5 Api プロジェクトでの `Remove` | 落ちた（Api の DLL） |
| D6 ドメインのリストの `List.Remove`（EF Core 以外） | 止まらない（既知の穴） |
| C1 保存のときの削除の禁止を外す | 末端の行の削除テスト1件が落ちた |
| C2 受注の版数を上げる処理を外す | 別々の明細を同時に出荷するテスト1件だけが落ちた |
| C3 版数を比べない（`IsConcurrencyToken` を外す） | 衝突のテスト2件が落ちた |
| C4 版数を上げない | 3件が落ちた |

D6 は EF Core の削除ではないので、アーキテクチャテストの対象外にした（ドメインのリストから外すこと自体は正当な場面がある）。CLAUDE.md に「レビューで拾う」と書いた。

### 7. 最終の結果

ビルドの警告0・エラー0。テストは Domain 125件・アーキテクチャ 9件・結合 22件（Day26 から6件増）、すべて成功。

### 8. 文書

- **CLAUDE.md**
  - 禁止事項の「物理削除」を「強制（テスト・実行時・DB）」に変え、止まらない書き方（ドメインのリストの `Remove`）も書いた
  - 禁止事項に「同時更新の上書き」の行を足した
  - 「保存のときに自動で行うこと」の節を足した
  - 結合テストのきまりに、2人目の利用者の作り方と固定の時刻の使い方を足した
  - プロジェクトの表に、アーキテクチャテストを足した
- **er-diagram.md**: 共通の列の型と値を入れるところ、`xmin` を使わない理由、削除を止める3段

## 今日学んだこと

### 衝突の単位は「行」ではなく「判断に使ったもの全体」

明細の版数で衝突を検知すれば十分だと思っていた。実際には、受注の状態は「全明細の出荷済み数量」を見て決まる。2人が別々の明細を更新すると、行としては1つもぶつからないのに、2人とも古い全体像で状態を決めてしまう。判断に使った範囲（集約）の根の版数を上げることで、初めて衝突になった。

### DB で止まるから安心、は「子のある親」だけ

Day25 で外部キーを全部 RESTRICT にした。それで物理削除は止まると考えていたが、子の無い行は何も止めない。先にテストを書いて、実際に消せることを見たので気付けた。

### 検査の仕組みが黙って何も見ない失敗に備える

DLL を読む検査は、読み方を誤ると「何も見つからない」＝成功になる。Day23 で、アナライザの最新版が黙って無効になっていたのと同じ形。検査そのものが働いていることを確かめるテストを1件入れた。

### `HasConversion<string>()` の変換器は、思った場所に無い

監査ログで状態が `"Received"` ではなく数値で書かれた。`HasConversion<string>()` は DB での型を決めるだけで、`GetValueConverter()` では変換器が取れない。変換器は型の対応付け（`GetTypeMapping().Converter`）の側にある。テストで値まで比べていたので気付けた。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 受注（子のある親）を削除するテストが、保存の前に EF Core の例外で落ちた | EF Core 自身が RESTRICT を見て止める。保存のときの禁止まで届かない | 子の無い売上明細を消すテストにした |
| 2人目の利用者で受注を作ると番号が重複した | `TestScenario` の連番が利用者ごとに1から振られる | 番号の頭に付ける文字（`numberPrefix`）を渡せるようにした |
| 監査ログの状態が数値になった | 上の「学んだこと」の通り | `GetTypeMapping().Converter` を使う |

## 気づき・発見

- アーキテクチャテストは、新しいパッケージ（NetArchTest など）を足さずに標準の `System.Reflection.Metadata` で書けた。ジェネリック型（`DbSet<T>`）の呼び出しは、型の署名の先頭バイトを読んで定義の名前に戻す必要があった
- 対照実験の C2 は、別々の明細の同時出荷テスト1件だけが落ちた。このテストが無ければ、集約の根の版数を上げる処理は誰にも守られていない

## 成果物

### sales-core（製品コード）

- [src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day27/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs) — 保存のときの削除の禁止・版数・監査ログ
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day27/src/SalesCore.Infrastructure/Persistence/Configurations.cs) — 共通の列
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261009002125_AddCommonColumns.cs](https://github.com/kiyo015/sales-core/blob/day27/src/SalesCore.Infrastructure/Persistence/Migrations/20261009002125_AddCommonColumns.cs) ／ [docs/migrations/2026-10-09-AddCommonColumns.sql](https://github.com/kiyo015/sales-core/blob/day27/docs/migrations/2026-10-09-AddCommonColumns.sql)
- [tests/SalesCore.Architecture.Tests/NoPhysicalDeleteTests.cs](https://github.com/kiyo015/sales-core/blob/day27/tests/SalesCore.Architecture.Tests/NoPhysicalDeleteTests.cs) — 物理削除のアーキテクチャテスト
- [tests/SalesCore.Integration.Tests/AuditAndConcurrencyTests.cs](https://github.com/kiyo015/sales-core/blob/day27/tests/SalesCore.Integration.Tests/AuditAndConcurrencyTests.cs) — 監査ログと衝突のテスト
- [tests/SalesCore.Integration.Tests/DatabaseTest.cs](https://github.com/kiyo015/sales-core/blob/day27/tests/SalesCore.Integration.Tests/DatabaseTest.cs) — 2人目の利用者
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day27/CLAUDE.md) ／ [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day27/docs/domain/er-diagram.md)

### Study（学習記録）

- [evidence/2026-10-09-mutations.txt](https://github.com/kiyo015/vibe-coding-study/blob/day27/evidence/2026-10-09-mutations.txt) — 対照実験の結果
- [evidence/2026-10-09-mutate.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day27/evidence/2026-10-09-mutate.ps1) — 対照実験のスクリプト
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day27/study_plan_next_month.md) — Day27 の実測値
- [2026-10-09/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day27/2026-10-09/summary.md) — この記録
- [2026-10-09/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day27/2026-10-09/summary.html) — 配布用HTML

## 付録：検証の中身

スクリプト本体はメールに添付しない（`.ps1` は危険な添付と扱われる）。要点と結果をここに載せる。

### 保存の入口（要点）

```csharp
ChangeTracker.DetectChanges();
RejectDeletes();          // Deleted の行があれば例外。取消は状態か赤黒で表す
TouchAggregateRoots();    // 受注明細が変わったら、受注の row_version も上げる
// 監査ログの対象(業務の値・変わった列だけ)と変更前の値を控える → 作成者・日時・版数(元の値 + 1)を入れる
// 業務のデータを保存 → 新しい行の id が決まってから監査ログを保存 → 1つのトランザクションで確定
```

### 入れた誤り

```
D1 Infrastructure に db.Remove(order)
D2 Infrastructure に db.SalesRecords.RemoveRange(records)
D3 Infrastructure に db.Shipments.Where(...).ExecuteDeleteAsync()
D4 Infrastructure に db.Database.ExecuteSqlRaw("delete from sales_records where id = 1")
D5 Api に db.Customers.Remove(customer)
D6 Domain に List<SalesOrderLine>.Remove(line)            (既知の穴)
C1 SaveChangesAsync から RejectDeletes(); を外す
C2 SaveChangesAsync から TouchAggregateRoots(); を外す
C3 b.Property<int>(RowVersion).IsConcurrencyToken() → b.Property<int>(RowVersion)
C4 version.CurrentValue = 元の値 + 1 → 元の値
```

### 結果

```
D1-DbContext.Remove: failed 1 / total 9
  - NoPhysicalDeleteTests.EFCoreで行を消す呼び出しが無い(assemblyName: "SalesCore.Infrastructure")
D2-DbSet.RemoveRange: failed 1 / total 9（同上）
D3-ExecuteDeleteAsync: failed 1 / total 9（同上）
D4-raw-DELETE-sql: failed 1 / total 9
  - NoPhysicalDeleteTests.行を消すSQLが無い(assemblyName: "SalesCore.Infrastructure")
D5-Remove-in-Api-project: failed 1 / total 9
  - NoPhysicalDeleteTests.EFCoreで行を消す呼び出しが無い(assemblyName: "SalesCore.Api")
D6-known-gap-List.Remove-in-domain: failed 0 / total 9
C1-no-RejectDeletes: failed 1 / total 22
  - AuditAndConcurrencyTests.末端の行でも_削除の印を付けて保存しようとすると止まり_消えない
C2-no-TouchAggregateRoots: failed 1 / total 22
  - AuditAndConcurrencyTests.同じ受注の別々の明細を2人が同時に出荷すると_後から保存した方が衝突で止まる
C3-RowVersion-not-concurrency-token: failed 2 / total 22
  - AuditAndConcurrencyTests.同じ受注の別々の明細を2人が同時に出荷すると_後から保存した方が衝突で止まる
  - AuditAndConcurrencyTests.同じ受注を2人が同時に変えると_後から保存した方が衝突で止まる
C4-RowVersion-not-incremented: failed 3 / total 22
  - AuditAndConcurrencyTests.作った人と日時_最後に変えた人と日時が残る
  - AuditAndConcurrencyTests.同じ受注の別々の明細を2人が同時に出荷すると_後から保存した方が衝突で止まる
  - AuditAndConcurrencyTests.同じ受注を2人が同時に変えると_後から保存した方が衝突で止まる
```

今日の費用は0（`claude -p` を使っていない）。

## 次回予告

**Day28 — CI（ビルドとテスト）**

- GitHub Actions で `dotnet build`・`dotnet test`。テスト用DBの用意も CI 上で行う
- 持ち越し（Day26 から）: 「結合テストが CI でも手元と同じ結果になる」を確かめる。CI の DB は PostgreSQL 18（`btree_gist` を含む公式イメージ）、接続文字列は環境変数 `ConnectionStrings__SalesCoreTest`。手元と同じ結合テスト22件（`MigrationTests` を含む）とアーキテクチャテスト9件が通ることを、結果の一覧で突き合わせる

**持ち越し:** Day27 の分は無し。
