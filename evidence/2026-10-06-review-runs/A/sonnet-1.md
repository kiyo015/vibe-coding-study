## 良い点

- `InvoiceTests.cs` の新規テストと `SalesOrderTests.cs` の新規テストで、各操作の正常系を日本語名でわかりやすく記述している（命名は glossary/コメント方針に沿っている）。
- `取り消した受注は変更できない()`（`SalesOrderTests.cs`）で、取消済み受注への操作拒否を明示的に確認している。
- `ChangeQuantity`/`RemoveLine`/`ApplyDiscount` の引数・戻り値の型は `decimal`/`int` で、明らかな `double` 型宣言は無い。

## 指摘

### Critical

- **`src/SalesCore.Api/appsettings.Development.json`**（追加した `ConnectionStrings:SalesCore` ブロック）
  パスワード付きの接続文字列をリポジトリにコミットしている。`CLAUDE.md`・レビュー基準のどちらでも明示的に禁止されているパターン（`appsettings*.json を含む`）。Developmentだから良いという例外はない。
  → この行を削除し、`dotnet user-secrets set ConnectionStrings:SalesCore ... --project src/SalesCore.Api` に置き換える。すでにコミットされたパスワードは漏えいとして扱い、ロールのパスワードを変更するよう本人に伝える。

- **`src/SalesCore.Domain/SalesOrder.cs` の `ChangeQuantity`/`RemoveLine`/`ApplyDiscount`**
  状態チェックが `Status is not SalesOrderStatus.Cancelled` のみで、**一部出荷・出荷済みの受注でも数量変更・明細削除・値引きができてしまう**。`business-rules.md`「受注の状態ごとにできる操作」の表にはこの3操作が存在せず、どの状態で許すかが定義されていない。レビュー観点の「出荷済み・一部出荷の受注で、計上済みの売上に関わる値（単価・数量・税率）を変えられないか」に直接抵触する。
  → 少なくとも「受付・承認済」でのみ許可する検査に直し、`business-rules.md` の状態別操作表にこの3操作を追加する。

- **`SalesOrder.ChangeQuantity`（`SalesOrder.cs`）／`SalesOrderLine.ChangeQuantity`（`SalesOrderLine.cs`）**
  新しい数量が「出荷済み数量（`ShippedQuantity`）より小さくならないこと」を確認していない。また `SalesOrderLine.EnsureQuantity` を呼んでおらず、0以下の数量も通る。「受注数量を出荷済み数量より小さくできない」というルールに違反し、出荷済み数量より少ない受注数量という矛盾した状態を作れる。
  → `line.ShippedQuantity <= quantity` と `EnsureQuantity(quantity, nameof(quantity))` の両方を検査する。

- **`SalesOrder.RemoveLine`（`SalesOrder.cs`）**
  `_lines.Remove(line)` で明細をリストから無条件に削除している。レビュー基準で明示されている「物理削除」の典型パターン（`リストからのRemove`）そのもの。出荷済み数量・返品数量を持つ明細が削除されると、以後の残数量計算・返品可否判定・請求書への紐づけが成立しなくなる。
  → 出荷済み数量（`ShippedQuantity`）が0の明細だけ削除を許可する検査を入れる。それ以外は取消・状態で表す方針に合わせる。

- **`SalesOrderLine.ApplyDiscount`（`SalesOrderLine.cs`）**
  ```csharp
  var factor = 1 - percent / 100.0;
  UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;
  ```
  - `100.0` は型名を書かない `double` リテラル。decimalの金額計算にdoubleを混在させている。
  - `(long)(...)` はキャストによる切り捨て。`Money.Round`（四捨五入、0.5は0から遠い側）を使っていない。常に0方向へ切り捨てるため、割引後単価が本来より低くなるケースがある（例：切り捨て前の値が `x.xx5` 以上になる割引率のとき）。
  現在のテストは `1000×10%→900`・`200×10%→180` のように誤差が出ない値だけで、この丸め誤りを検出できない。
  → `decimal` のみで計算し、`Money.Round` を使って四捨五入する実装に直す。

- **`SalesOrder.ApplyDiscount(int percent)`（`SalesOrder.cs`）**
  `percent` の範囲検査が無い。`percent > 100` だと単価が負になり、受注明細の単価は0以上という業務ルール（`business-rules.md` 8章）に違反する。負の`percent`も素通りする。
  → `0 <= percent <= 100` を検査し、結果の単価が負にならないことも確認する。

- **`src/SalesCore.Domain/Invoice.cs` の `LineTaxes`／`TotalAmount`**
  ```csharp
  public IReadOnlyList<Money> LineTaxes =>
      SalesRecords.SelectMany(record => record.Lines).Select(line => line.TaxRate.TaxOn(line.Amount)).ToList();
  public Money TotalAmount => Tax.TaxableTotal + LineTaxes.Aggregate(...);
  ```
  明細ごとに税額を計算して合計している。既存の `Tax`（`TaxBreakdown`）は税率ごとに1回だけ丸める正しい実装を持っているのに、`TotalAmount` はそれを使わず明細単位の丸め合計で請求額を出している。これは `business-rules.md` が明示的に禁止している「明細ごとに税額を丸めて合計する」実装そのもの（105円×3行の例で1円ずれるのと同じ構造）。
  追加テスト `請求額は税抜合計と税額の合計()` は明細1行・税率1種類のケースのみで、この不一致を検出できない（複数明細が同じ税率を持つケースで初めて食い違う）。
  → `TotalAmount` は `Tax.TotalWithTax`（既存の正しい集計）を使う。`LineTaxes` を明細表示用に残すなら、税額の合計には使わないことをコメントで明記する。複数明細・同一税率のテストを追加する。

### Important

- **`docs/domain/business-rules.md` が更新されていない**。今回追加した受注変更（数量変更・明細削除・値引き）は、唯一の定義元であるこの文書の「受注の状態ごとにできる操作」の表に存在しない。特に値引きは文書8章で「値引きの明細行の入力方法が決まるまで」と未決定扱いになっている項目であり、今回実装するなら決定内容を文書に追記する必要がある（`CLAUDE.md`・レビュー基準の両方で明記されている進め方）。
- 境界条件のテストが無い：出荷済み／一部出荷の受注に対する `ChangeQuantity`/`RemoveLine`/`ApplyDiscount`、出荷済み数量未満への数量変更、`percent` が0・100・100超・負のケース。業務ルールに関わる変更なので、誤った実装（今回の実装）で落ちるテストが必要。

### Minor

- `SalesOrder.ApplyDiscount` のコメント「受注全体に値引き(%)をかける。各明細の単価を下げる」は、`business-rules.md` の「伝票全体への値引きは扱わない」という決定と見た目上矛盾するように読める。単一の%を全明細に適用する意図（明細単位の値引きの特殊形であること）をコメントで明確にしたほうがよい。

## 判定

**マージ不可。** 接続文字列の漏えい、消費税の明細単位丸め、出荷済み/一部出荷の受注の単価・数量が変更可能な状態検査漏れ、キャストによる切り捨てという複数のCriticalが重なっており、いずれも請求額・売上の正しさとデータ整合性に直結するため、現状のままでは出せない。