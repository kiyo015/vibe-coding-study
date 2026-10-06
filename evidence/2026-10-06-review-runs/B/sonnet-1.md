# レビュー結果

## 良い点

- `SalesOrder.cs:63-88` の新規メソッドが、既存の `Require` ヘルパーを使って状態チェックの体裁を既存コードに揃えている。
- `SalesOrderLine.cs:29` でコメントを更新し、`UnitPrice` が可変になった理由を示している。
- 変更した振る舞いに対してテスト（`SalesOrderTests.cs`、`InvoiceTests.cs`）を追加しようとした姿勢自体は良い。

## 指摘

### Critical

1. **`appsettings.Development.json:7-9` に接続文字列とパスワードを平文で書いている**
   `"Password=<仕込みの架空の値>"` がリポジトリにコミットされる。`CLAUDE.md` のDB準備手順・業務ルールの両方で「接続文字列は `dotnet user-secrets` に入れる。`appsettings.json` には書かない」と明記されており、これに反する。開発用でも秘密情報の漏えいであり、パスワードは即座に無効化・変更が必要。
   直し方: この変更を取り消し、`dotnet user-secrets set ConnectionStrings:SalesCore ... --project src/SalesCore.Api` を使うよう案内する（本人の作業）。

2. **`SalesOrder.ApplyDiscount` は業務ルール文書で明確に禁止されている「伝票全体への値引き」そのもの**
   `docs/domain/business-rules.md` 8章: 「伝票全体への値引きは扱わない(2026-09-30 決定)。値引きは明細単位(単価を下げるか、税率を指定した値引きの明細行を立てる)で行う」。本差分は受注全体に% をかけて各明細の単価を下げる実装（`SalesOrder.cs:81-88`）であり、決定済みの業務ルールと矛盾する。文書の更新もされていない。
   直し方: 明細単位の値引きとして実装し直すか、文書のルールを変える決定をした上で `business-rules.md` ・テスト・コードを揃えて直す。

3. **`ChangeQuantity`／`RemoveLine`／`ApplyDiscount` が出荷済み・一部出荷の受注でも実行できる**
   `SalesOrder.cs:65, 76, 83` はいずれも `Status is not Cancelled` しか見ていないため、`一部出荷`・`出荷済` の受注でも数量変更・明細削除・値引きができてしまう。業務ルール「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられない」に直接違反する。すでに売上（`SalesRecord`）が計上された明細の単価・数量を後から書き換えられ、帳簿と現物の出荷記録が食い違う。
   直し方: これらの操作は `Received`・`Approved` のときだけ許可するよう `Require` の条件を絞る（最低限）。それ以降に数量変更が必要な場合は別途ルールを決めて文書化する。

4. **`ChangeQuantity` に、出荷済み数量より小さくできないことの検査が無い**
   `SalesOrderLine.ChangeQuantity` (`SalesOrderLine.cs:53`) は検査なしで `Quantity` を書き換える。業務ルール「受注数量を出荷済み数量より小さくできない」に違反し、`RemainingQuantity`（`Quantity - ShippedQuantity`）が負になる。負の残数量で `EnsureCanShip`／`Amount` の計算が破綻する。
   直し方: `quantity < ShippedQuantity` なら例外にする検査を `ChangeQuantity` に追加する。

5. **`RemoveLine` は出荷済み数量があっても、最後の1行でも削除できる**
   `SalesOrder.cs:74-78` は検査なしで `_lines.Remove(line)` する。すでに出荷・売上が計上された明細を消すと、`Amount`（受注の税抜合計）から売上済みの明細が消え、計上済み売上と受注明細が整合しなくなる。また、受注の最後の1行を削除すると「受注には明細が1行以上要る」というコンストラクタの不変条件（`SalesOrder.cs:36-39`）が、生成後は保たれない状態になる。
   直し方: `line.ShippedQuantity > 0` なら削除を拒否し、削除後に `_lines.Count == 0` にならないことも検査する。

6. **`SalesOrderLine.ApplyDiscount` が二重に禁止API相当のことをしている（double と切り捨て）**
   `SalesOrderLine.cs:57`: `var factor = 1 - percent / 100.0;` は型名の書かれていない `double` 演算（`100.0`）。
   `SalesOrderLine.cs:58`: `(long)(UnitPrice * (decimal)factor * 100) / 100m` はキャストによる切り捨て（0から遠い側への四捨五入ではなく、常に0方向に切り捨てる）。
   具体例: 単価 33.33円に10%値引きをかけると、正しい四捨五入（業務ルールどおり）では 33.33 × 0.9 = 29.997 → 30.00円になるべきだが、このコードでは `(long)2999.7 = 2999` → 29.99円になり、1銭ずれる。これはビルドでは拾えない「型名を書かない double」「キャストによる切り捨て」の典型例であり、業務ルールの端数処理（四捨五入、0.5は0から遠い側）にも違反する。
   直し方: `decimal` のみで計算し、四捨五入（0から遠い側）で小数2桁に丸める。現在 `Money` は円単位(0桁)の丸めしか提供していないため、単価(2桁)用の丸め関数を `Money.cs`（または同種の場所）に追加して一元化する。

7. **`ApplyDiscount(int percent)` に範囲検査が無い**
   `percent` が負（値上げ）や100を超える値（単価が負になる）でもそのまま適用される。`SalesOrderLine` のコンストラクタは単価0以上を強制しているが、`ApplyDiscount` 経由だとその検査を経由せず単価が負になり得る（例: `percent=150`）。
   直し方: `0 <= percent <= 100` を検査する。

8. **`Invoice.LineTaxes`／`TotalAmount` が「明細ごとに税額を丸めて合計する」禁止パターンを実装している**
   `Invoice.cs:21-22`: `line.TaxRate.TaxOn(line.Amount)` を明細（`SalesRecordLine`）ごとに呼んでおり、`TaxOn` 内部は `Money.Round` で丸める（`TaxRate.cs:26`）ため、明細1件ごとに税額を丸めてから `LineTaxes.Aggregate` で合計している。これは業務ルール「消費税は税率ごとに1回だけ丸める。明細ごとに税額を丸めて合計してはならない」に正面から違反する。既存の `TaxCalculator.Calculate`（`TaxCalculator.cs`）は税率ごとに1回だけ正しく丸めているのに、`TotalAmount` はそれとは別経路（`Tax.TaxableTotal + Σ明細税額`）で請求額を出しており、複数明細・同一税率のケースで `Tax.TotalWithTax` と1円以上ずれる（業務ルール文書に載っている105円×3行の例がまさにこれに該当する）。
   追加されたテスト（`InvoiceTests.cs:76-86`）は1明細・1税率のケースのみで、このズレを検出できない。
   直し方: `LineTaxes`／`TotalAmount` を削除するか、`TaxCalculator` の税率ごとの集計結果（`Tax.Summaries`）から表示用に出す。合計は既存の `Tax.TotalWithTax` を使う。複数明細・同一税率のケースをテストに追加する（例: 105円の明細3行で `TaxTotal` が32円になることを検証）。

### Important

9. **業務ルール文書が更新されていない**
   `ChangeQuantity`／`RemoveLine`／`ApplyDiscount` は受注の新しい操作であり、`business-rules.md` の「受注の状態ごとに、できる操作」表にも、値引きの扱い（現在「伝書全体への値引きは扱わない」と明記）にも反映されていない。`CLAUDE.md` の約束（業務ルールを変える時はコード・テスト・文書を一緒に直す）に反する。

10. **削除・数量変更の操作が監査ログに残らない**
    業務ルール「金額・数量・状態を変えた操作は監査ログに残す」に対応する実装がこの差分には見当たらない（渡された差分内に監査ログの記録が無い）。将来の実装で足すのであれば構わないが、この段階でCriticalな値を変える操作を入れるなら合わせて検討が必要。

11. **テストが境界条件を検証していない**
    - `ChangeQuantity` で出荷済み数量より小さくするケース、一部出荷・出荷済での呼び出しを拒否するケースのテストが無い（検査自体が無いので当然失敗する）。
    - `RemoveLine` を出荷済み明細・最後の1行に対して呼ぶケースのテストが無い。
    - `ApplyDiscount` の丸め（33.33円など、切り捨てと四捨五入で結果が変わるケース）のテストが無い。
    - `Invoice.LineTaxes`/`TotalAmount` の複数明細・同一税率でのズレを検出するテストが無い。

## 判定

**マージ不可。** 接続文字列の漏えい、禁止されているはずの受注全体値引きの実装、出荷済み・一部出荷の受注で計上済み売上に関わる値を書き換えられる状態遷移の欠落、消費税を明細ごとに丸めて合計している実装の4点がいずれもCriticalで、請求額・売上の誤りやデータ不整合に直結するため、現状では統合できない。