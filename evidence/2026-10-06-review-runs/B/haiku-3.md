ビジネスルールと実装を確認しました。以下、複数の重大な問題を指摘します。

## 良い点

- `SalesOrderLine.Quantity` と `UnitPrice` のセッターを `private` にして、変更を統制している（52-53行）
- 値引き・数量変更のテストを追加している（`SalesOrderTests.cs`）
- `Invoice.TotalAmount` の概念を追加して、請求額の明確化を試みている

---

## 指摘

### Critical（必須修正）

**1. appsettings.Development.json にパスワードが直接記載**  
`src/SalesCore.Api/appsettings.Development.json:8-10`

秘密情報（接続文字列のパスワード）をコードに書いている。  
CLAUDE.md に「強制（読み取りを禁止）」で明記されている違反。リポジトリに記録される。  
**直し方**: `dotnet user-secrets set ConnectionStrings:SalesCore "Host=localhost;Port=5432;Database=salescore_dev;Username=salescore_dev;Password=..."` で設定し、`appsettings.Development.json` からは接続文字列全体を削除。

---

**2. Invoice.TotalAmount が明細ごとの税額を合計している（ビジネスルール違反）**  
`src/SalesCore.Domain/Invoice.cs:21-25`

明細ごとに税額を計算して合計している（`LineTaxes.Aggregate(...)`）。

```csharp
// 現在の実装
public Money TotalAmount => Tax.TaxableTotal + LineTaxes.Aggregate(Money.Zero, (total, tax) => total + tax);

// LineTaxes は
SalesRecords.SelectMany(record => record.Lines).Select(line => line.TaxRate.TaxOn(line.Amount)).ToList();
```

Business-rules.md で「**明細ごとに税額を丸めて合計してはならない。** 105円（10%）の明細3行なら、明細ごとでは 11円 × 3 ＝ 33円、税率ごとでは 315円 × 10% ＝ 31.5 → 32円で、1円ずれる」と明記。請求書に複数の税率がある場合、差は最大5円。

`TaxBreakdown` には既に `TaxTotal`（税率ごとに正しく計算した税額）があり、`TotalWithTax` プロパティがある。  
**直し方**: `TotalAmount` を `Tax.TotalWithTax` または `Tax.TaxableTotal + Tax.TaxTotal` に変更。テストも複数税率を含めて追加。

---

**3. ApplyDiscount で型名なし double と キャストによる切り捨て**  
`src/SalesCore.Domain/SalesOrderLine.cs:56-60`

```csharp
internal void ApplyDiscount(int percent)
{
    var factor = 1 - percent / 100.0;  // double型の式
    UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m; // キャスト切り捨て
}
```

- `percent / 100.0` で `double` 型が出現。CLAUDE.md 「型名を書かない double（…`Math.Sqrt` の戻り値）はビルドで止まらないのでレビューで拾う」
- `(long)(...)` でキャスト。CLAUDE.md 「**キャストによる切り捨て（`(long)x`）はビルドで止まらない**のでレビューで拾う」
- 端数処理は `Money.Round` だけで行う（BannedSymbols.txt）

**直し方**: 
```csharp
internal void ApplyDiscount(int percent)
{
    var discountFactor = (100 - percent) / 100m;  // decimal 同士の演算
    UnitPrice = Money.Round(UnitPrice * discountFactor).Yen;  // Money.Round を使う
}
```

---

**4. 受注の変更が一部出荷・出荷済み状態で許可されている（ビジネスルール違反）**  
`src/SalesCore.Domain/SalesOrder.cs:62-90` の `ChangeQuantity`・`RemoveLine`・`ApplyDiscount`

現在は取消状態のみ禁止。しかし Business-rules.md で以下を明記：
> 出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか

状態遷移表（Day22）で、「一部出荷・出荷済」状態では出荷指示と返品しかできない。

- `ChangeQuantity`：数量を変えると出荷済み数量に矛盾。許可すべき状態は「受付・承認済」のみ
- `RemoveLine`：明細を削除は数量削減と同じ。許可すべき状態は「受付・承認済」のみ
- `ApplyDiscount`：単価を変えると計上済み売上の原価が変わる。許可すべき状態は「受付・承認済」のみ

テストが取消後のみで、一部出荷・出荷済み状態を検証していない。

**直し方**: 
```csharp
public void ChangeQuantity(SalesOrderLine line, decimal quantity)
{
    Require(Status is SalesOrderStatus.Accepted or SalesOrderStatus.Approved, "数量変更は未出荷の受注でのみ可能");
    // ...
}
```
同じく `RemoveLine`・`ApplyDiscount` も修正。テストで一部出荷・出荷済み状態での変更試行が `InvalidOperationException` を投げることを確認。

---

**5. 受注全体への値引き（ApplyDiscount）はビジネスルール外**  
`src/SalesCore.Domain/SalesOrder.cs:78-88`

Business-rules.md「8. この文書で決めていないこと」に明記：
> - 値引きの入力方法。**伝票全体への値引きは扱わない**（2026-09-30 決定）。値引きは明細単位（単価を下げるか、税率を指定した値引きの明細行を立てる）で行う

`ApplyDiscount(percent)` で全明細に一律 % 割引をかけるのは、決定に反する。  
**対応**: この機能を削除するか、要件に「伝票全体への値引きを扱う」という変更を追加し、Business-rules.md に記載を加える。

---

### Important（修正推奨）

**6. Invoice.LineTaxes のテストが1行の明細のみ**  
`tests/SalesCore.Domain.Tests/InvoiceTests.cs:76-86`

複数の税率が混在した請求書でテストしていない。明細ごと税額合計と税率ごと税額の差が出る場面を検証すべき。

---

### Minor

**7. コメント "明細欄の税額と合うように" は誤解を招く**  
`src/SalesCore.Domain/Invoice.cs:24`

> 請求額(税込)。明細欄の税額と合うように、明細ごとの税額を足して出す。

「明細欄の税額と合う」というコメントだが、実装は明細ごと税額を足している。正しくは「税率ごとの税額を足して出す」。現在の実装自体が間違っているので、修正時にコメントも直す。

---

## 判定

**マージ不可。** 秘密情報の漏えい（Critical）、ビジネスルール違反による税額誤差（Critical）、キャスト切り捨てと型エラー（Critical）、状態遷移保護の欠落（Critical）、要件外の機能追加（Critical）が複数存在します。修正後、再レビューをお願いします。