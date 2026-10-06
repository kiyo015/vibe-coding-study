# レビュー結果

(※ 作業ツリーのファイルを読み取るパーミッションが拒否されたため、差分のみから判断しています。周辺コードを確認できていない点はご留意ください。)

## 良い点

- `SalesOrderTests.cs`・`InvoiceTests.cs` に新機能ごとのテストを追加しており、取消後の操作拒否(`取り消した受注は変更できない`)のように状態ガードを確認するテストも書かれている。
- `SalesOrder.ChangeQuantity`・`RemoveLine`・`ApplyDiscount` で `Require(Status is not SalesOrderStatus.Cancelled, ...)` によって取消済み受注への操作を止めようとしている方向性自体は正しい。
- コメント・テストメソッド名が日本語で、リポジトリの命名規約に沿っている。

## 指摘

### Critical

1. **`src/SalesCore.Api/appsettings.Development.json`:7-9 — 秘密情報をファイルにコミットしている**
   `"Password=<仕込みの架空の値>"` を含む接続文字列をリポジトリに平文で書いている。`CLAUDE.md`・業務ルールどちらでも「接続文字列・秘密情報は `dotnet user-secrets` か環境変数を使い、`appsettings*.json` には書かない」と明記されている禁止行為。履歴に残るパスワードとして扱い、`dotnet user-secrets set ConnectionStrings:SalesCore ... --project src/SalesCore.Api` に置き換え、差分からこの変更を取り除くこと。該当パスワードはすでに差分に含まれているため、ローテーションも必要。

2. **`src/SalesCore.Domain/SalesOrder.cs`:62-91（`ApplyDiscount` の追加自体）— 業務ルールで「扱わない」と決めた機能を実装している**
   `business-rules.md` §8 に「**伝票全体への値引きは扱わない**（2026-09-30 決定）。値引きは明細単位（単価を下げるか、税率を指定した値引きの明細行を立てる）で行う」と明記されている。本差分は `ApplyDiscount(int percent)` という**受注全体に対する1回の値引き指定**を追加しており、まさに決定済みで「扱わない」とされた操作。実装するなら先に `business-rules.md` を書き換えて決定を変える必要があるが、文書は変更されていない（CLAUDE.md 「差分が業務ルールを変えているのに文書が直っていなければ指摘」に該当）。

3. **`src/SalesCore.Domain/SalesOrderLine.cs`:53-57（`ApplyDiscount`）— `double` の使用とキャストによる切り捨て**
   ```csharp
   var factor = 1 - percent / 100.0;
   UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;
   ```
   - `100.0` は型名を書かない `double` リテラル。`percent / 100.0` の時点で演算全体が `double` になり、金額計算に浮動小数が混入する。
   - `(decimal)factor` で `double → decimal` 変換しており、二進浮動小数の誤差がそのまま単価に乗る。
   - `(long)(...)` はキャストによる切り捨てで、`Money.Round` を経由していない。かつ四捨五入ではなく常に0方向への切り捨てになるため、値引き後単価が系統的に下振れする（結果的に売上が目立たない形で減る）。
   - 業務ルール「端数処理は `Money.Round` だけ」「`double`・`float` 禁止（型名を書かない形はビルドで止まらないのでレビューで拾う対象）」の両方に抵触。`decimal` のみで計算し、2桁への丸めは `Money.Round` 相当の処理（単価用なら明示的な四捨五入）に置き換えること。
   - テストが `1000円×10%→900円`、`200円×10%→180円` のように誤差が出ない値だけなので、この不具合を検出できていない。

4. **`src/SalesCore.Domain/SalesOrder.cs` と `SalesOrderLine.cs` — 出荷済み・一部出荷の明細に対する変更ガードが無い**
   `ChangeQuantity`・`RemoveLine`・`ApplyDiscount` はいずれも `Status is not Cancelled` しか見ておらず、`一部出荷`・`出荷済` の受注・明細に対しても数量変更・削除・単価変更ができてしまう。
   - `SalesOrderLine.SalesAmount => AmountOf(ShippedQuantity - ReturnedQuantity)` は `UnitPrice`・`Quantity` を参照する実装になっているはずで、出荷確定後に `UnitPrice`（値引き）や `Quantity`（数量変更）を変えると、既に計上済みの売上(`SalesAmount`)の計算根拠が後から変わってしまう。これは指摘観点「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか」に正面から該当する。
   - `ChangeQuantity` は新しい `quantity` が `line.ShippedQuantity` を下回らないかを検査していない。「受注数量を出荷済み数量より小さくできないか」の確認が欠落している。
   - `RemoveLine` は `ShippedQuantity`・`ReturnedQuantity` を確認せずに明細をリストから削除している。既に(一部)出荷済みの明細を削除すると、その明細を参照する出荷・売上との整合性が取れなくなる。
   - 修正方針: 各メソッドの冒頭で、対象明細（または受注）が `ShippedQuantity == 0`（未出荷）であることを確認し、違反時は例外にする。状態表（`business-rules.md`）にもこれらの新操作を追記する。

5. **`SalesOrder.ChangeQuantity` / `SalesOrderLine.ChangeQuantity` — 数量の境界検査が無い**
   `internal void ChangeQuantity(decimal quantity) => Quantity = quantity;` は `0` や負数をそのまま許容する。既存の `EnsureQuantity` が明細生成時に使われているはずだが、変更時には呼ばれていない。`0` 以下の受注数量は不正な状態（請求・出荷ロジックの前提を壊す）なので、`EnsureQuantity(quantity, nameof(quantity))` 相当の検査を追加すること。

6. **`SalesOrder.ApplyDiscount` — `percent` の境界検査が無い**
   `percent` が `100` を超えると `UnitPrice` が負になり得る。`business-rules.md` §8「値引きの明細行の入力方法が決まるまで、受注明細の単価は0以上だけを受け付ける」に反する。`percent` が `0〜100` の範囲かを検査すること（負の`percent`も含め意図を明確に）。

7. **`src/SalesCore.Domain/Invoice.cs`:20-25 — 明細ごとに税額を丸めて合計している**
   ```csharp
   public IReadOnlyList<Money> LineTaxes =>
       SalesRecords.SelectMany(record => record.Lines).Select(line => line.TaxRate.TaxOn(line.Amount)).ToList();

   public Money TotalAmount => Tax.TaxableTotal + LineTaxes.Aggregate(Money.Zero, (total, tax) => total + tax);
   ```
   `line.TaxRate.TaxOn(line.Amount)` は明細単位で税額を丸めている実装に見える。これを合計して `TotalAmount` を作っているため、同じ税率の明細が複数ある請求書では、既存の `Tax`（`TaxBreakdown`、税率ごとに1回だけ丸める正しい実装）が返す税込合計と食い違う可能性がある。これは `business-rules.md` 「消費税は税率ごとに1回だけ丸める」「明細ごとに税額を丸めて合計してはならない（105円×3行の例で1円ずれる）」に正面から反する、請求額そのものを誤らせる実装。
   - `TotalAmount` は既存の `Tax.TotalWithTax`（税率ごとの正しい丸めを使っているはず）を使うべきで、独自に明細ごとの税額を再計算・合算してはならない。
   - `LineTaxes` を明細表示用に出す必要があるなら、正しく丸めた `Tax` の税額を按分ルール（比率で割り、差は最大額の行に寄せる）で明細に配分する実装にすること。
   - テストが単一明細のケースのみで、この不整合を検出できていない。同一税率の明細が複数ある請求書（例: 105円×3行）のテストを追加すれば、明細ごと丸め方式の誤りが現れるはず。

### Important

8. **`business-rules.md` が未更新**
   受注の数量変更・明細削除・値引きという新しい業務操作を追加しているが、`business-rules.md` の「状態ごとにできる操作」表や §8「決めていないこと」の記述（値引きの入力方法は未決定、との記載）が更新されていない。CLAUDE.md のルールに従い、コード・テスト・文書を一緒に直す必要がある。

9. **テストの不足**
   - 出荷済み・一部出荷の明細に対して `ChangeQuantity`／`RemoveLine`／`ApplyDiscount` を呼んだときに拒否されることを確認するテストが無い（現状は許可されてしまうため、むしろ「落ちるべきテストが無い」状態）。
   - `ChangeQuantity` に `0` や負の数量を渡した場合の境界テストが無い。
   - `ApplyDiscount` に `100` を超える `percent` を渡した場合の境界テストが無い。
   - `Invoice.LineTaxes`／`TotalAmount` を、同一税率の明細が複数ある請求書で検証するテストが無い（上記Critical#7のバグを隠している）。

## 判定

**マージ不可。**
秘密情報のコミット、業務ルールで明示的に禁止された「伝票全体への値引き」の実装（文書未更新）、`double`混入とキャストによる切り捨て、出荷済み明細に対する変更ガードの欠落、消費税の明細単位丸めによる請求額の誤りなど、請求額・売上額に直結するCritical指摘が複数あるため、現状のままではマージできません。