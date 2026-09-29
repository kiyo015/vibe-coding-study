# Day19 学習記録（2026-09-29）— DB接続とテスト用DBの実証、週次振り返り

基幹システム開発計画の5日目で、1週目の最終日。EF Core を入れて空のマイグレーションを開発用DBに通し、結合テストが**トランザクションのロールバックで独立する**ことを対照実験つきで示した。その前に、ツールを入れることで**安全の前提が崩れる**箇所を見つけ、先に直した。

## 今日行った処理

### 1. 安全上の問題を、ツールを入れる前に潰した

Day17・18 の guard-e2e には、対照実験として**ガードを外して** `dotnet ef database drop --force` を**本当に実行させる**セルがある。安全の根拠は「この環境には dotnet-ef が入っていないので、コマンドが見つからずに終わる」ことだった。

今日は sales-core に dotnet-ef と DbContext を入れ、接続文字列も設定する。その状態で同じ対照実験を回すと、**開発用DBが本当に消える**。そこで、ツールを入れる前にコマンドを変えた。

```js
const DB_DROP_PROBE = {
  command: 'dotnet ef database drop --dry-run --project guard-probe-does-not-exist-7f3a',
  ...
};
```

| オプション | 役割 |
|---|---|
| `--dry-run` | 消さずに「何を消すか」を表示するだけ（dotnet ef の機能） |
| `--project <存在しない名前>` | DbContext を見つけられずにエラーで終わる |

**環境に頼らず、コマンド自体が2重に安全**な形にした。ガードは「`ef` の後ろが `database drop` で始まるか」で判定し、`-` で始まるオプションは読み飛ばすので、この形でも止まる。ガードの単体テストにこのコマンドを1件足した（68件すべて成功）。この1件は最初から通る回帰テストで、「E2E が使うコマンドがこれからも止まり続ける」ことを固定する。

### 2. EF Core を入れた

| パッケージ | 版 | 入れた場所 | 理由 |
|---|---|---|---|
| `Npgsql.EntityFrameworkCore.PostgreSQL` | 8.0.11 | Infrastructure | DB との接続は Infrastructure の責務 |
| `Microsoft.EntityFrameworkCore.Design` | 8.0.31 | Api | `dotnet ef` はスタートアッププロジェクトにこれを要求する |
| `dotnet-ef`（ツール） | 8.0.31 | `.config/dotnet-tools.json` | **ローカルツール**。メンバーは `dotnet tool restore` だけで同じ版がそろう |

入れた直後に `dotnet ef --version` が `8.0.31` を返した。**この瞬間から、手順1で直す前の対照実験は本当に危険だった。**

空の `SalesCoreDbContext`（テーブルの対応付けは Day25）を作り、API には接続を足した。接続文字列が無ければ「CLAUDE.md の『DBの準備』に従って user-secrets に設定すること」と示して止まる。新しいメンバーが最初につまずく場所なので、エラーの文言に次の行動を書いた。

### 3. 結合テストの安全装置（TDD）

結合テストはデータを書いては戻す。接続先を取り違えると、戻し損ねたときに開発用のデータを壊す。そこで**接続先のDB名が `_test` で終わらなければ止める**。

テストを先に書き、中身が空の関数で実行した。

| 接続先のDB名 | 期待 | ねらい |
|---|---|---|
| `salescore_dev` | 拒否 | 開発用DB |
| `salescore` | 拒否 | 接尾辞なし |
| `salescore_test_backup` | 拒否 | `_test` を**含む**が末尾ではない。「含むか」で判定すると通ってしまう |
| （指定なし） | 拒否 | DB名が無い |
| `salescore_test` | 受け入れ | テスト用DB |

RED：拒否すべき4件が「例外が出なかった」で失敗し、受け入れる1件は成功。GREEN：接続文字列の分解は Npgsql の `NpgsqlConnectionStringBuilder` に任せ（別名や大文字小文字を正しく扱うため）、5件すべて成功。

### 4. 読み返して見つけた落とし穴：user-secrets を黙って読まない

```csharp
.AddUserSecrets(typeof(TestDatabase).Assembly, optional: true)
```

これは、テストのアセンブリに user-secrets の ID が付いていないと、**エラーを出さずに何も読まない**。すると「接続文字列が設定されていない」という**原因と違うエラー**が出て、設定したのに原因にたどり着けない。

テストプロジェクトに API と同じ `UserSecretsId` を付け、**属性が実際に生成されたかをビルド結果で確かめた**。

```
[assembly: Microsoft.Extensions.Configuration.UserSecrets.UserSecretsIdAttribute("37da7993-...")]
```

`optional: true` のままにしたのは、CI には user-secrets のファイルが無く、環境変数 `ConnectionStrings__SalesCoreTest` で渡すため。

### 5. DB の準備（本人の作業）

パスワードを扱うので、本人に実行してもらった。

1. 専用ロール `salescore_dev` と、`salescore_dev`・`salescore_test` の2つのDBを作る
2. `\password` でパスワードを設定する（画面に表示されない）
3. 接続文字列を user-secrets に2つ入れる

- **スーパーユーザー（`postgres`）で接続しない。** 専用ロールは、自分がオーナーの2つのDBにしか権限が無い
- **開発用とテスト用を別のDBにする。** 手順3の安全装置もこの分離が前提
- **`dotnet user-secrets list` は実行しない。** パスワードが会話に表示されるため。設定できたかどうかは、DB に接続できるかで確かめる

### 6. 空のマイグレーションを通した

**適用する前に、実行される SQL を確認した**（Day25 で作る「SQL をレビューしてから適用する」手順の予行）。

```sql
CREATE TABLE IF NOT EXISTS "__EFMigrationsHistory" ( ... );
START TRANSACTION;
INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion") VALUES ('20260929021329_Initial', '8.0.31');
COMMIT;
```

作るのは履歴用の表1つだけ。確認してから開発用DBに適用し、`migrations list` で `Initial` が適用済みになったことを見た。**これで user-secrets の接続文字列で接続できることも分かった。パスワードを見ずに、設定が正しいことを確かめられた。**

### 7. ロールバックによる独立の実証（今日の中心）

**仕組み**：DB を使うテストの基底クラス `DatabaseTest` が、テストの開始時にトランザクションを始め、終わったらコミットせずに捨てる。DB を使うテストはすべて1つのコレクションに入れ、並列に走らないようにした。マイグレーションはテストの実行ごとに1回だけテスト用DBに適用する。

**完了条件を、テストそのものが判定できる形にした。**

```csharp
// 検証用の表は、トランザクションの外(別の接続)で作る
await using (var setup = Fixture.CreateContext())
    await setup.Database.ExecuteSqlRawAsync("CREATE TABLE IF NOT EXISTS test_isolation_probe (...)");

Assert.Equal(0, await CountRowsAsync());   // 前の実行で書いた行は残っていない
await Db.Database.ExecuteSqlRawAsync("INSERT INTO test_isolation_probe DEFAULT VALUES");
Assert.Equal(1, await CountRowsAsync());   // 書いた行はテストの中でだけ見える
```

表を**トランザクションの外**で作るのが要点。中で作ると、ロールバックで表ごと消えて、戻し損ねても何も検出できない。外に作っておけば、戻し損ねた行が残り、次の実行で「開始時点で0行」が失敗する。**「2回続けて実行して2回とも通る」ことが、状態が積み上がらないことの証拠になる。**

**RED ＝ 対照実験**：最初は基底クラスに**トランザクションを入れない版**で2回実行した。

| 回 | トランザクションなし | トランザクションあり |
|---|---|---|
| 1回目 | 成功 | 成功 |
| 2回目 | **失敗：`Expected: 0 / Actual: 1`** | 成功 |
| 3回目 | — | 成功 |

トランザクションが無いと、1回目の行が残って2回目で積み上がる。**テストが積み上がりを検出できることを先に見てから** GREEN にしたので、積み上がらない理由がロールバックだと言える。

**後始末**：RED で残った1行を消す方法を3つ比べた。

| 方法 | 判断 |
|---|---|
| psql で消す | パスワードが要る。知らないし、知るべきでもない |
| `TRUNCATE` | **自分のガードが止める** |
| **user-secrets の接続を使う一時的なテストで `DELETE`** | これを選んだ |

一時的なテストでは、消した行数がちょうど1であることも確かめた（想定外の行があれば失敗する）。実行後にファイルを削除した。

### 8. 対照実験の安全性を実測した

| 時点 | 開発用DBのマイグレーション |
|---|---|
| guard-e2e の実行前 | `20260929021329_Initial`（適用済み） |
| guard-e2e の実行後 | `20260929021329_Initial`（**適用済みのまま**） |

E2E は6セルすべて合格（$0.5336）。sales-core のセルでは、ガードを外した対照実行で dotnet-ef が**実際に動いた**。それでも DB は消えていない。手順1で直していなければ、ここで開発用DBが消えていた。

### 9. CLAUDE.md を更新した

エラーメッセージが案内している「DBの準備」の節（ロールとDBの作り方、user-secrets のキー名、CI では環境変数）と、マイグレーションのコマンド（追加・SQL の確認・適用、`dotnet tool restore`）、結合テストのきまりを書いた。

`dotnet user-secrets list` を禁止ルールで強制することも考えたが、「お願い」にとどめた。漏れるのはローカル専用のパスワードで、残る先は本人の会話記録だけ。仕組みを足してまで強制する害ではないと判断した。

## 1週目（Day15〜19）の振り返り

**予定の作業はすべて完了した。** 未完了の持ち越しは無い。

| 指標 | 1週目の始め | 1週目の終わり |
|---|---|---|
| ガードの単体テスト | 46件 | 68件 |
| ガードの実効性テスト（対照実験つき） | 3セル | 6セル（未検証セル0） |
| sales-core のテスト | テンプレートの空テストのみ | Domain 1件・結合 6件 |
| 業務の決めごと | ER図の保留5点 | 業務ルール集で8点＋派生1点を確定 |

**うまくいったやり方（2週目も続ける）**
- 変更の前に**基準値**を取る
- ガードやテストは**対照実験**で「止めているのはそれだ」と示す
- 検証用データは**本物の出力**から作る
- 完了条件は**文脈を切った別セッション**で確かめる

**繰り返した失敗**
- **シェル経由でバックスラッシュが消える**（Day15〜17）→ Day18 から Write・Edit ツールに切り替え、再発していない
- **「設定したつもり」**（Day16 の未信頼、Day17 の未接続）→ どちらも実測で見つけた
- **安全の前提が環境の変化で崩れる**（Day19）→ 新しい教訓

1週目に見つかった課題は、2週目の先頭に「どの日で扱うか」を書いた（DB破壊ガードの抜けは Day33、健康診断の C# 対応は Day32）。

## 今日学んだこと

### 「今は安全」の根拠は、何に依存しているか

Day17 で対照実験を組んだとき、安全の根拠を実測で確かめた（`dotnet ef --version` がエラーを返す）。そのとき確かめた事実は正しかった。ただし、それは**その時点の環境**の事実で、ツールを1つ入れれば崩れる。

安全の根拠を「環境がそうなっているから」に置くと、環境を変える人が気付かないまま危険になる。**根拠をコマンドの側（`--dry-run`、存在しないプロジェクト）に移す**と、環境が変わっても安全なまま。1週目の振り返りで「環境を変えるときに、安全の根拠を見直す」を習慣として足した。

### テストが「検出できること」を先に見る

結合テストの RED は、ふつうの TDD の RED（機能が無いから落ちる）とは違う。**仕組みを外すと落ちる**ことを見る、つまり対照実験そのもの。これを見ずに GREEN から入ると、テストが何も検出できない作りでも気付けない。ガードの E2E で身につけた考え方が、製品のテストにもそのまま使えた。

### 設定が効かないとき、黙る仕組みを疑う

`AddUserSecrets(optional: true)` は、ID が無いと黙って何も読まない。Day16 のワークスペース未信頼（許可ルールを黙って無視）、Day18 のマーケットプレイス（未信頼なら黙って無視）と同じ形。**「黙って何もしない」仕組みは、原因と違うエラーを別の場所で起こす。** 付けたら、付いたことを確かめる。

## つまずき

### 書き込み前の安全チェックが一時的に止まった

**症状** — ファイルの書き込みとコマンドの実行で、安全チェックが続けて応答しなかった（操作の中身が拒否されたわけではない）。

**対策** — 書き込みを伴わない作業（計画シートの確認など）に切り替え、ちょうど本人の作業（DBの準備）が必要な区切りだったので、そこで手順をお願いした。戻ってきた後に同じ操作を再実行して通った。

## 成果物

### sales-core（製品コード）

- [src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day19/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs) — 空の DbContext
- [src/SalesCore.Infrastructure/Persistence/Migrations/](https://github.com/kiyo015/sales-core/tree/day19/src/SalesCore.Infrastructure/Persistence/Migrations) — 空のマイグレーション `Initial`
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day19/src/SalesCore.Api/Program.cs) — 接続文字列の読み込みと、無いときの案内
- [tests/SalesCore.Integration.Tests/TestDatabase.cs](https://github.com/kiyo015/sales-core/blob/day19/tests/SalesCore.Integration.Tests/TestDatabase.cs) — 接続文字列の読み込みと `_test` の安全装置
- [tests/SalesCore.Integration.Tests/DatabaseTest.cs](https://github.com/kiyo015/sales-core/blob/day19/tests/SalesCore.Integration.Tests/DatabaseTest.cs) — テストごとのトランザクションとロールバック
- [tests/SalesCore.Integration.Tests/TransactionIsolationTests.cs](https://github.com/kiyo015/sales-core/blob/day19/tests/SalesCore.Integration.Tests/TransactionIsolationTests.cs) — 状態が積み上がらないことのテスト
- [.config/dotnet-tools.json](https://github.com/kiyo015/sales-core/blob/day19/.config/dotnet-tools.json) — dotnet-ef 8.0.31（ローカルツール）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day19/CLAUDE.md) — DBの準備・マイグレーションのコマンド・結合テストのきまり

### Study（学習記録・E2E）

- [checks/guard-e2e.js](https://github.com/kiyo015/vibe-coding-study/blob/day19/checks/guard-e2e.js) — 対照実験のコマンドを `--dry-run` と存在しないプロジェクトの2重に変更
- [plugins/dev-guard/hooks/pre-bash-guard.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day19/plugins/dev-guard/hooks/pre-bash-guard.test.js) — E2E のコマンドが止まり続けることの回帰テスト（68件）
- [checks/guard-matrix.md](https://github.com/kiyo015/vibe-coding-study/blob/day19/checks/guard-matrix.md) — 「安全の根拠は環境が変わると崩れる」を記録
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day19/study_plan_next_month.md) — Day19 の実施内容、1週目の振り返り、2週目の持ち越し
- [2026-09-29/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day19/2026-09-29/summary.md) — この記録
- [2026-09-29/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day19/2026-09-29/summary.html) — 配布用HTML

## 次回予告

**Day20 — 金額型と端数処理（2週目の開始）**

- `Money` 型（`decimal` のみ）。端数処理は業務ルール集の方式（四捨五入）に従い、`Money` の中だけで行う
- 境界値（ちょうど0.5円など）のテスト

**完了条件:** 端数処理のテストが境界値を含めて通る。丸めの実装が1か所にしかない

**持ち越し:** なし。今日の費用は guard-e2e の $0.5336 のみ。
