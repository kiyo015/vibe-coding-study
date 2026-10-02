# Day22 学習記録（2026-10-02）— 受注の状態遷移と分納

基幹システム開発計画の8日目。受注 → 出荷 → 売上 → 請求の流れを Domain に作り、**未出荷のまま請求しようとするコードがコンパイルできない**形にした。分納と返品の金額は Day20 に決めた累計差分で実装し、ランダムな出荷と返品の並び1万件で、売上の合計が常に合うことを確かめた。

## 今日行った処理

### 1. 何を型で止め、何をテストで止めるかを決めた

完了条件は「未出荷のまま請求しようとするコードが、コンパイルかテストで落ちる」。2つの層に分けた。

| 守りたいこと | 止め方 | 仕組み |
|---|---|---|
| 未出荷のまま請求しない | **コンパイル** | 請求書の入口（`Invoice.Create`）は売上（`SalesRecord`）だけを受け取る。売上は出荷の確定と返品からしか生まれず、コンストラクタを公開していない |
| 状態を飛び越えない・逆戻りしない | テスト（実行時の例外） | 受注は1つのクラスで、状態は enum。許されない操作は例外になる |
| 受注数量を超えて出荷しない | テスト（実行時の例外） | 指示のときと確定のときの両方で確かめる |

受注の状態ごとに別のクラスを作る（受付の受注・承認済の受注…）方法なら、状態の飛び越しもコンパイルで止まる。採らなかったのは、Day25 に EF Core で1つの表に保存するときに、状態が変わるたびにクラスを載せ替える必要が出て重くなるため。完了条件は「コンパイルかテスト」なので、請求の境界だけを型にした。

### 2. 作ったもの（`SalesCore.Domain`。DBは使わない）

| クラス | 役割 |
|---|---|
| `SalesOrder` | 受注。受付 → 承認済 → 一部出荷 → 出荷済 ／ 取消。承認・取消・出荷指示・返品 |
| `SalesOrderLine` | 受注明細。出荷済み数量と返品数量を別々に持つ。金額は累計差分 |
| `Shipment` | 出荷。指示 → 確定 ／ 取消。確定すると売上が計上される |
| `SalesRecord` | 売上。売上日は出荷確定日。返品は数量も金額も負 |
| `Invoice` | 請求書。売上をまとめ、税率ごとに1回だけ税額を丸める（Day21 の `TaxCalculator` を使う） |

累計差分の実装は3行。動く前と後の「手元の数量 × 単価の四捨五入」の差を取る。

```csharp
var before = SalesAmount;              // Money.Round(単価 × (出荷済み − 返品))
ShippedQuantity += quantity;
return new SalesRecordLine(quantity, UnitPrice, TaxRate, SalesAmount - before);
```

丸めを行う場所は、引き続き `Money.cs` の1か所だけ（検索で確認）。

### 3. テストを先に書いた（新規68件）

| テストクラス | 件数 | 主な内容 |
|---|---|---|
| `SalesOrderTests` | 50 | 状態の進み方、分納、超過の禁止、取消、出荷の状態、**状態 × 操作の全20通り** |
| `SalesRecordTests` | 10 | 売上の計上、33.33円×3個の分納（33・34・33円）、返品、**ランダム1万件** |
| `InvoiceTests` | 8 | 分納した売上を請求書にまとめる、返品の打ち消し、**型による保証** |

状態 × 操作の表は、5つの状態と4つの操作（承認・取消・出荷指示・返品）の組み合わせをすべて並べ、許されない操作は例外になって状態が変わらないこと、許される操作は決まった先の状態になることを確かめる。

### 4. RED → GREEN

| 段階 | 結果 |
|---|---|
| 変更前 | Domain 36件 成功 |
| RED（空の実装） | 新規68件中 **66件が失敗**。すべてアサーションの失敗（例外が出ない 24件、値の不一致 33件、ほか 9件） |
| GREEN | Domain **104件**・結合 6件 すべて成功。警告なし |

**最初の RED では、新規のテスト5件が空の実装でも通ってしまった。** 調べると3件は検証が弱かった。

| 通ってしまったテスト | 原因 | 直し方 |
|---|---|---|
| 状態×操作の「受付で承認できる」「受付で取消できる」 | 例外が出ないことしか見ていなかった | 操作の後の状態まで確かめる |
| 返品の売上を同じ請求書に入れると打ち消し合う | 何も計上しなくても合計は0円になる | 出荷が105円、返品が-105円であることも確かめる |
| 登録した受注は受付で始まる | enum の既定値がたまたま受付 | 対照実験で確認（下の M11） |
| 請求書を作る入口は売上を受け取るものだけ | 空の実装の時点で形が合っている | 対照実験で確認（下の M10） |

### 5. 対照実験：誤った実装14種を入れて、すべて検出された

もっともらしい誤りを1つずつ製品コードに入れ、テストが落ちることを確かめた（スクリプトで入れて実行し、元に戻す）。

| 番号 | 入れた誤り | 失敗した件数 |
|---|---|---|
| M01 | 出荷ごとに金額を丸める（累計差分にしない） | 2（33.33円×3の例、ランダム1万件） |
| M02 | 返品ごとに金額を丸める | 2 |
| M03 | 承認していない受注でも出荷できる | 1（状態×操作の表） |
| M04 | 受注数量を超えるかを確かめない | 4 |
| M05 | 一部出荷の受注を取り消せる | 1（状態×操作の表） |
| M06 | 確定した出荷をもう一度確定できる | 2 |
| M07 | 確定のときに全行を先に確かめない | 2 |
| M08 | 返品で出荷済み数量を戻す | 6 |
| M09 | 売上のコンストラクタを公開する | 1（型による保証） |
| M10 | 受注から請求書を作る入口を足す | 1（型による保証） |
| M11 | 受注が承認済で始まる | 52 |
| M12 | 1行でも出荷が終われば出荷済にする | 1 |
| M13 | 返品の数量の上限を確かめない | 5 |
| M14 | 確定した出荷を取り消せる | 1 |

M03 と M05 を捕まえたのは、状態×操作の表の1行だけだった。個別の例だけを書いていたら、この2つは素通りしていた。

### 6. コンパイル実験：12通りの書き方がすべてエラーになった

テストプロジェクトに一時ファイルを置き、未出荷のまま請求しようとする書き方を12通り並べてビルドした（確認後に削除）。

| 書き方 | エラー |
|---|---|
| 受注をそのまま渡す／受注の一覧を渡す／受注明細を渡す | CS1503・CS0029（売上に変換できない） |
| 確定していない出荷指示を渡す | CS0029 |
| 売上・売上明細・出荷・請求書を直接作る | CS1729（そのコンストラクタは無い） |
| 出荷済み数量だけを進める／出荷指示を通さずに売上を計上する | CS1061（外から見えない） |
| 出荷済み数量や状態を書き換える | CS0200（読み取り専用） |

この保証は、後から公開コンストラクタや別の入口を足すと崩れる。それを止めるために、`InvoiceTests` がリフレクションで「公開コンストラクタが無い」「`InternalsVisibleTo` が付いていない」「請求書を作る入口は売上を受け取る1つだけ」を確かめている（M09・M10 で検出を確認）。

### 7. ランダムな出荷と返品の並び 1万件

受注1万件について、出荷と返品をランダムに最大12回動かし、**動くたびに**「売上の合計 ＝ 手元の数量 × 単価の四捨五入」を確かめた。期待値は Day21 と同じく、製品コードとは別の方法（`long` の整数計算）で出した。

| 項目 | 実測 |
|---|---|
| 出荷 | 24,688回 |
| 返品 | 26,849回 |
| **単価 × 数量の四捨五入と1円違う金額になった動き** | **8,089回（15.7%）** |
| 出荷済まで進んだ受注 | 6,368件 |
| 全部返品された受注 | 4,368件 |

15.7% は、累計差分でなければ合計がずれていた動きにあたる。Day21 の教訓（乱数が偏ると、確かめたい場面を通らないまま合格する）から、これらの件数に下限を置くアサーションもテストに入れた。

### 8. 文書を更新した

- **業務ルール集**: 状態 × 操作の表、出荷と受注数量、返品、「請求は売上からしか作れない」
- **業務フロー**: 出荷の状態図、返品で状態が戻らないこと
- **ER図・用語集**: `sales_order_lines.returned_quantity`、「返品」
- **CLAUDE.md**: 禁止事項に2行（未出荷のまま請求＝強制（型＋テスト）、状態の飛び越し・超過出荷＝強制（テスト））

## 実装のときに決めたこと（本人の確認待ち）

業務ルール集に無かったので、既存の方針（状態は逆戻りしない、出荷済は終点）に沿って決めた。違っていれば直す。

| # | 決めたこと | 理由 |
|---|---|---|
| 1 | 返品しても受注の状態と出荷済み数量は戻さない。返品数量は別に持つ | 出荷済み数量が増えるだけなら、状態は逆戻りしない |
| 2 | 返品した数量は同じ受注で出荷し直せない。代わりの品は新しい受注で出す | 出荷済は終点。受注の残りは返品で増えない |
| 3 | 出荷指示だけでは数量を押さえない。指示が重なって超えるときは、先に確定したほうが通り、後のほうが確定時に止まる | 数量を押さえるのは在庫の引当（段階4） |
| 4 | 確定した出荷は取り消せない。返品の売上日は返品日 | 確定した時点で売上になっている。打ち消すのは返品 |

## 今日学んだこと

### 型で止める場所は、境界に絞る

すべての状態を型にすると、保存や画面とのつなぎが重くなる。「請求書は売上からしか作れない」という1つの境界を型にするだけで、未出荷のまま請求する書き方は12通りとも書けなくなった。境界の内側（受注の状態）は、表を網羅するテストで守る。

### 空の実装で通るテストは、検証が弱い

RED で「66件落ちた」だけを見ていたら、通ってしまった5件に気付かなかった。落ちなかったテストを一覧にして、なぜ通ったかを1件ずつ確かめた。「例外が出ない」「合計が0円」のような、何もしなくても成り立つ条件だけを見ているテストが3件あった。

### 表を網羅するテストは、個別の例が見落とす誤りを捕まえる

承認の飛び越し（M03）と出荷後の取消（M05）を捕まえたのは、状態 × 操作の表だけだった。「できること」の例は自然に書くが、「できないこと」は意識して並べないと抜ける。

### 型による保証は、後から崩れないように固定する

コンパイルで止まるのは、コンストラクタを公開していないから。誰かが1つ公開すれば崩れる。保証の前提そのものをテストにしておく。

## つまずき

### 対照実験のスクリプトが最初の1件で止まった

**症状** — `dotnet test` がテストの失敗を標準エラーに出すと、スクリプトが例外で止まった。

**原因** — Windows PowerShell 5.1 で `$ErrorActionPreference = 'Stop'` のまま `2>&1` を付けると、標準エラーの1行目が例外になる。

**対策** — `dotnet test` の間だけ `Continue` に切り替え、結果は trx ファイルから読む。書き換えたファイルは `finally` で必ず戻すようにしていたので、止まったときも製品コードは元のままだった。

### テストの実行時間が測れなかった

**症状** — Domain のテストが朝の約1秒から7〜8秒になった。

**原因** — 切り分けられていない。測ったときPCのCPU使用率が94〜100%で、Day21 までの36件だけでも3秒かかった。ランダム1万件のテストによる増分と、負荷による増分が混ざっている。

**対策** — 負荷の無い状態で測り直す（Day23 に持ち越し）。`dev-guard` が編集のたびにテストを走らせるので、増分が大きければ件数を見直す。

## 気づき・発見

- 結合テストのビルドで `MSB3277`（EF Core 8.0.11 と 8.0.31 の競合）の警告が出ている。今日の変更とは関係が無く、テストは成功する。Day25 で EF Core を触るときに揃える
- `team-reviewer` によるレビューは行っていない（Day24 で観点を足す）

## 作らなかったもの

- 承認待ちと100万円の基準（段階2）。今は受付から承認済へ直接進む
- 請求書の締め・繰越・状態・二重請求の防止（Day31）
- 負の単価の明細（値引きの明細行。入力方法が未決定なので受け付けない）
- 一部出荷の受注の残りを打ち切る操作（未決定事項に追記）
- 商品・得意先・IDとの結び付け（Day25 の永続化で）

## 成果物

### sales-core（製品コード）

- [src/SalesCore.Domain/SalesOrder.cs](https://github.com/kiyo015/sales-core/blob/day22/src/SalesCore.Domain/SalesOrder.cs) — 受注と状態遷移
- [src/SalesCore.Domain/SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day22/src/SalesCore.Domain/SalesOrderLine.cs) — 受注明細、累計差分
- [src/SalesCore.Domain/Shipment.cs](https://github.com/kiyo015/sales-core/blob/day22/src/SalesCore.Domain/Shipment.cs) — 出荷（指示 → 確定 ／ 取消）
- [src/SalesCore.Domain/SalesRecord.cs](https://github.com/kiyo015/sales-core/blob/day22/src/SalesCore.Domain/SalesRecord.cs) — 売上（外から作れない）
- [src/SalesCore.Domain/Invoice.cs](https://github.com/kiyo015/sales-core/blob/day22/src/SalesCore.Domain/Invoice.cs) — 請求書（売上からしか作れない）
- [tests/SalesCore.Domain.Tests/SalesOrderTests.cs](https://github.com/kiyo015/sales-core/blob/day22/tests/SalesCore.Domain.Tests/SalesOrderTests.cs) — 50件
- [tests/SalesCore.Domain.Tests/SalesRecordTests.cs](https://github.com/kiyo015/sales-core/blob/day22/tests/SalesCore.Domain.Tests/SalesRecordTests.cs) — 10件（ランダム1万件を含む）
- [tests/SalesCore.Domain.Tests/InvoiceTests.cs](https://github.com/kiyo015/sales-core/blob/day22/tests/SalesCore.Domain.Tests/InvoiceTests.cs) — 8件（型による保証を含む）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day22/docs/domain/business-rules.md) — 状態×操作の表、出荷、返品
- [docs/domain/business-flow.md](https://github.com/kiyo015/sales-core/blob/day22/docs/domain/business-flow.md) — 出荷の状態図
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day22/docs/domain/er-diagram.md) ／ [glossary.md](https://github.com/kiyo015/sales-core/blob/day22/docs/domain/glossary.md) — 返品数量、「返品」
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day22/CLAUDE.md) — 禁止事項に2行

### Study（学習記録）

- [evidence/2026-10-02-mutation-results.txt](https://github.com/kiyo015/vibe-coding-study/blob/day22/evidence/2026-10-02-mutation-results.txt) — 対照実験14種の結果（落ちたテストの名前）
- [evidence/2026-10-02-mutate.ps1](https://github.com/kiyo015/vibe-coding-study/blob/day22/evidence/2026-10-02-mutate.ps1) — 対照実験のスクリプト
- [evidence/2026-10-02-compile-probe.txt](https://github.com/kiyo015/vibe-coding-study/blob/day22/evidence/2026-10-02-compile-probe.txt) — コンパイル実験の12通りとエラー
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day22/study_plan_next_month.md) — Day22 の実測値
- [2026-10-02/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day22/2026-10-02/summary.md) — この記録
- [2026-10-02/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day22/2026-10-02/summary.html) — 配布用HTML

## 付録：検証の中身

スクリプト本体はメールに添付しない（`.ps1` は危険な添付と扱われる）。入れた誤りと結果をここに載せる。

### 対照実験で入れた誤り（抜粋）

```
M01 出荷ごとに丸める
  正: return new SalesRecordLine(quantity, UnitPrice, TaxRate, SalesAmount - before);
  誤: return new SalesRecordLine(quantity, UnitPrice, TaxRate, Money.Round(UnitPrice * quantity));
  → 失敗 2件: 分納の金額は累計数量で丸めた金額の差で決まり… ／ ランダムな出荷と返品の並びでも…

M03 承認していない受注でも出荷できる
  正: Require(Status is Approved or PartiallyShipped, "出荷");
  誤: Require(Status is Received or Approved or PartiallyShipped, "出荷");
  → 失敗 1件: 状態ごとに許される操作だけができる(受付, 出荷指示, 許されない)

M08 返品で出荷済み数量を戻す
  正: ReturnedQuantity += quantity;
  誤: ShippedQuantity -= quantity;
  → 失敗 6件: 返品しても受注の状態と出荷済み数量は戻らない ／ ランダム1万件 ほか

M09 売上のコンストラクタを公開する
  正: internal SalesRecord(DateOnly recordedOn, ...)
  誤: public SalesRecord(DateOnly recordedOn, ...)
  → 失敗 1件: 売上と出荷と請求書は_外から直接は作れない(SalesRecord)
```

### コンパイル実験（12通り、すべてエラー）

```
 1 Invoice.Create(order);                                   CS1503 SalesOrder から IEnumerable<SalesRecord> へ変換できない
 2 Invoice.Create([order]);                                 CS0029 SalesOrder を SalesRecord に変換できない
 3 Invoice.Create(order.Lines);                             CS1503
 4 Invoice.Create([order.InstructShipment([...])]);         CS0029 Shipment を SalesRecord に変換できない
 5 new SalesRecord(new DateOnly(2026, 10, 2), []);          CS1729 そのコンストラクタは無い
 6 new SalesRecordLine(10, 100m, TaxRate.Of(10m), ...);     CS1729
 7 new Shipment(order, []);                                 CS1729
 8 new Invoice([], new TaxBreakdown([]));                   CS1729
 9 order.Lines[0].Ship(10);                                 CS1061 外から見えない
10 order.Lines[0].ShippedQuantity = 10;                     CS0200 読み取り専用
11 order.Status = SalesOrderStatus.Shipped;                 CS0200 読み取り専用
12 order.RecordShipment(new DateOnly(2026, 10, 2), []);     CS1061 外から見えない
ビルドの結果: 12 エラー
```

### ランダムテストの期待値の出し方

```csharp
// 単価は銭、数量は 1/1000 の整数で持つ。decimal も Money も使わない
var expected = RoundHalfUp(unitPriceSen * (shipped - returned), 100_000);
Assert.Equal(expected, salesTotal);                    // 売上を足し上げた合計
Assert.Equal(expected, (long)line.SalesAmount.Yen);    // 明細が持つ売上の合計
```

## 次回予告

**Day23 — アナライザで強制にする**

- BannedApiAnalyzers で `double`・`float` の金額利用、`Money` 以外での `Math.Round` を禁止する
- わざと違反するコードを書き、ビルドが落ちることを確認する

**完了条件:** 違反コードでビルドが落ちる。CLAUDE.md の該当ルールが「お願い」から「強制」に変わっている

**持ち越し:**
- 「実装のときに決めたこと」4点の、本人による確認
- Domain のテストの実行時間を、負荷の無い状態で測り直す

今日の費用は0。
