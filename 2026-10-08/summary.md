# Day26 学習記録（2026-10-08）— 結合テスト

基幹システム開発計画の12日目。受注 → 出荷（分納）→ 返品 → 請求を、DB を通して1本で流す結合テストを作った。あわせて、**CI と手元で結果が変わる原因**を手元で1つずつ潰した。CI そのものは Day28 で作るので、「CI でも同じ結果」の最終確認はそこで行う。

## 今日行った処理

### 1. 受注から請求までを1本で流すテスト

筋書き: 支店（請求先は本社）が、ボルト（105円・10%）3箱とお茶（33.33円・8%）3本を受注。10月に3回に分けて出荷し、お茶を1本返品する。10月末締めで、本社あての請求書を作る。

| 操作 | 日付 | 売上 |
|---|---|---|
| 出荷1: ボルト1・お茶2 | 10/5 | 105円、お茶 Round(66.66) − 0 ＝ 67円 |
| 出荷2: ボルト1 | 10/12 | 105円 |
| 出荷3: ボルト1・お茶1 | 10/19 | 105円、お茶 Round(99.99) − 67 ＝ 33円 |
| 返品: お茶1 | 10/20 | お茶 Round(66.66) − 100 ＝ −33円 |

請求書（期待値は手で計算した）:

| 税率 | 対象額 | 税額 |
|---|---|---|
| 10% | 105 × 3 ＝ 315円 | 31.5 → **32円**（売上ごとに丸めると 11 × 3 ＝ 33円） |
| 8% | 67 + 33 − 33 ＝ 67円 | 5.36 → **5円** |
| 合計 | 382円 | 37円 → 請求額 419円 |

テストの書き方で気を付けたこと:

- **操作ごとに保存して読み直す。** 出荷の「指示」と「確定」も別の操作にし、確定は DB から読み直した出荷で行う。画面や API で1回ずつ呼ばれるのと同じ形にすると、保存し忘れや対応付けの漏れが結果に出る
- 請求の対象にならない売上（11月の売上、別の請求先の売上）も入れておき、それが請求書に入らないことを確かめる
- 受注は出荷済になり、明細ごとの売上の合計（手元の数量 × 単価）が、請求書の税抜合計と一致する

請求書の表は Day31 で作るので、請求書は「締め期間の売上を DB から集めて作る」ところまでにした（保存はしない）。

### 2. テスト用の組み立て役（Day25 からの申し送り）

`TestScenario`。番号・得意先・商品・倉庫といった、エンティティに無い列（シャドウプロパティ）をまとめて設定し、番号は連番で振る。`EndRequestAsync()` は「保存して、メモリ上のオブジェクトを手放す」で、1回の操作の終わりを表す。

既存の結合テストもこれを使う形に書き直し、重複していた組み立てのコードを消した。

### 3. CI と手元で結果が変わる原因を潰した

| 違い | やったこと |
|---|---|
| CI のDBはまっさらで、マイグレーションを最初から当てる。手元は適用済み | **`MigrationTests` を足した。** まっさらなスキーマを作って全マイグレーションを最初から当て、適用の履歴と13表がそろうことを確かめる。トランザクションの中で行い、最後に取り消す |
| 手元のテスト用DBには別の行が残りうる | 表全体を数えていたテスト（「税率は2件」）を、自分が作った行だけ数えるように直した。日付はすべて固定の値 |
| CI はビルド成果物（bin・obj）の無い状態から始まる | 今日の変更を含む作業ツリーをビルド成果物なしで作り、全テストを2回流した |
| CI は接続文字列を環境変数で渡す | 読み込み側は対応済み。実際に通るかは Day28 |

この PC には Docker が無く、CI と同じまっさらな PostgreSQL を手元に立てられなかったので、上の方法で置き換えた。

### 4. 対照実験：テストは誤りを捕まえるか

保存まわりの誤りと、手で書いたマイグレーションの SQL の誤りを1種類ずつ入れ、結合テスト16件を流した。

| 入れた誤り | 落ちたテスト |
|---|---|
| なし（基準） | 0件 |
| 出荷済み数量の更新が保存されない | 2件（流れのテスト、保存して読み直すテスト） |
| 返品数量の更新が保存されない | 2件（同上） |
| 受注の状態の更新が保存されない | 2件（同上） |
| **手で書いたマイグレーションの SQL を壊す**（存在しない列を参照） | **1件（`MigrationTests` だけ）** |

最後の行が今日の一番の発見。**マイグレーションを壊しても、既存の15件はすべて通った。** 手元のテスト用DBは適用済みなので、壊れたマイグレーションはもう当てられないから。CI のまっさらなDBでだけ落ちる誤りで、`MigrationTests` が無ければ Day28 の CI で初めて気付くところだった。

### 5. クリーンな作業ツリーで2回流した

| 回 | Domain | 結合 |
|---|---|---|
| 1回目 | 125件 成功 | 16件 成功 |
| 2回目 | 125件 成功 | 16件 成功 |

結合テストの結果の一覧（テスト名と成否）は、1回目と2回目で1行も違わなかった。前の実行のデータが残らないこと（Day19 の `TransactionIsolationTests`）も、2回とも成功した。

### 6. 文書

- **CLAUDE.md**「結合テストのきまり」: 組み立て役、操作の区切りでの保存と読み直し、CI と同じ結果にするための書き方（自分の行に絞る、日付は固定）、`MigrationTests` の役割
- **migration スキル**の手順4: 手で SQL を足したときは特に `MigrationTests` が通ることを確かめる

## 今日学んだこと

### 手元で通るテストは、CI で通る保証にならない

手元のDBは「今まで当ててきたマイグレーションの結果」で、まっさらから当てた結果ではない。最初から当てると失敗するマイグレーションがあっても、手元では誰も気付かない。違いが生まれる場所（DBの状態、ビルド成果物、接続の渡し方）を挙げ、それぞれを手元で再現する手段を用意した。

### 対照実験は「どのテストが捕まえたか」まで見る

4種の誤りのうち3種は複数のテストが落ちた。マイグレーションの誤りは1件だけで、そのテストが無ければ0件だった。「全体として捕まえる」だけでなく、どのテストが捕まえたかを見ると、そのテストの存在意義がはっきりする。

### 操作ごとに読み直すと、「メモリ上では正しい」を見逃さない

同じオブジェクトを使い続けるテストは、保存が漏れても、メモリ上の値で正しく動いてしまう。操作ごとに保存して手放し、DB から読み直すと、更新が保存されない誤りがそのまま結果に出た（対照実験の3種）。

### 表全体を数えると、DB の状態に結果が左右される

「税率は2件」は、手元のDBに別の税率が残っていれば3件になる。CI のまっさらなDBでは2件で、結果が食い違う。数えるときは、そのテストが作った行に絞る。

## つまずき

特になし（今日はハーネスやシェルの問題に当たらなかった）。

## 気づき・発見

- CI と同じ PostgreSQL を手元に立てる手段（Docker）が無い。Day28 では GitHub Actions のサービスコンテナ（PostgreSQL 18 の公式イメージ。`btree_gist` を含む）を使う
- `MigrationTests` は、Day25 の migration スキルの抜けを埋めた。スキルの手順4は「テスト用DBで確かめる」だったが、テスト用DBは今回の分しか当てないので、最初から当てたときの誤りは見えていなかった

## 成果物

### sales-core（製品コード）

- [tests/SalesCore.Integration.Tests/SalesFlowTests.cs](https://github.com/kiyo015/sales-core/blob/day26/tests/SalesCore.Integration.Tests/SalesFlowTests.cs) — 受注から請求までの流れ
- [tests/SalesCore.Integration.Tests/MigrationTests.cs](https://github.com/kiyo015/sales-core/blob/day26/tests/SalesCore.Integration.Tests/MigrationTests.cs) — まっさらなスキーマに全マイグレーションを当てる
- [tests/SalesCore.Integration.Tests/TestScenario.cs](https://github.com/kiyo015/sales-core/blob/day26/tests/SalesCore.Integration.Tests/TestScenario.cs) — テスト用の組み立て役
- [tests/SalesCore.Integration.Tests/PersistenceMappingTests.cs](https://github.com/kiyo015/sales-core/blob/day26/tests/SalesCore.Integration.Tests/PersistenceMappingTests.cs) — 組み立て役を使う形に書き直し
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day26/CLAUDE.md) ／ [.claude/skills/migration/SKILL.md](https://github.com/kiyo015/sales-core/blob/day26/.claude/skills/migration/SKILL.md)

### Study（学習記録）

- [evidence/2026-10-08-integration-mutations.txt](https://github.com/kiyo015/vibe-coding-study/blob/day26/evidence/2026-10-08-integration-mutations.txt) — 対照実験の結果
- [evidence/2026-10-08-integration-mutate.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day26/evidence/2026-10-08-integration-mutate.ps1) — 対照実験のスクリプト
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day26/study_plan_next_month.md) — Day26 の実測値、Day28 への持ち越し
- [2026-10-08/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day26/2026-10-08/summary.md) — この記録
- [2026-10-08/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day26/2026-10-08/summary.html) — 配布用HTML

## 付録：検証の中身

スクリプト本体はメールに添付しない（`.ps1` は危険な添付と扱われる）。入れた誤りと結果をここに載せる。

### まっさらなスキーマに当てるテスト（要点）

```csharp
var script = Db.GetService<IMigrator>().GenerateScript(options: MigrationsSqlGenerationOptions.NoTransactions);
await Db.Database.ExecuteSqlRawAsync("CREATE SCHEMA migration_probe; SET LOCAL search_path TO migration_probe, public;");
await Db.Database.ExecuteSqlRawAsync(script);
// 適用の履歴 = 全マイグレーション、表 = 13個(履歴の表を含む)。テストの終わりにトランザクションごと取り消す
```

### 入れた誤り

```
F1 出荷済み数量の更新が保存されない
   b.Property(l => l.ShippedQuantity).Metadata.SetAfterSaveBehavior(PropertySaveBehavior.Ignore);
F2 返品数量の更新が保存されない(同じ形で ReturnedQuantity)
F3 受注の状態の更新が保存されない(同じ形で SalesOrder.Status)
F4 手で書いたマイグレーションの SQL を壊す
   daterange(valid_from, valid_to, '[]')  →  daterange(valid_from, valid_until, '[]')
```

### 結果

```
F0-baseline: failed 0 / total 16
F1-shipped-quantity-not-updated: failed 2 / total 16
  - PersistenceMappingTests.受注から出荷と返品までを保存し_読み直しても状態と金額が同じで_続きの出荷もできる
  - SalesFlowTests.受注から分納と返品を経て_締め期間の売上で請求書を作ると税率ごとに1回だけ丸めた額になる
F2-returned-quantity-not-updated: failed 2 / total 16（同じ2件）
F3-order-status-not-updated: failed 2 / total 16（同じ2件）
F4-hand-written-migration-sql-typo: failed 1 / total 16
  - MigrationTests.全マイグレーションをまっさらなスキーマに最初から適用できる
```

今日の費用は0（`claude -p` を使っていない）。

## 次回予告

**Day27 — 楽観ロック・監査ログ・削除の禁止**

- 同時更新の衝突検知、誰がいつ何を変えたかの記録
- アーキテクチャテストで受注・請求の物理削除を禁止する
- 申し送り（Day25）: 全表に共通する列（作成者・更新日時・版数）を、2本目のマイグレーションとして migration スキルで足す。今回は `MigrationTests` も通ることを確かめる

**完了条件:** 物理削除するコードを書くとアーキテクチャテストが落ちる。衝突がテストで再現できる

**持ち越し:** 「結合テストが CI でも手元と同じ結果になる」の確認を Day28 へ（CI を作る日）。
