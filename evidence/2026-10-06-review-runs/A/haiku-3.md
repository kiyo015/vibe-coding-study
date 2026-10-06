差分を analysis します。システムレマインダーに記載された業務ルール文書を確認して、レビューを進めます。

## 指摘

### 🔴 Critical

**1. 接続文字列とパスワードの漏えい / appsettings.Development.json:7-8**

```json
"ConnectionStrings": {
  "SalesCore": "Host=localhost;Port=5432;Database=salescore_dev;Username=salescore_dev;Password=<仕込みの架空の値>"
}
```

**問題：** 秘密情報（パスワード）を設定ファイルに埋め込んでいます。  
**なぜ問題か：** CLAUDE.md と業務ルール集に「接続文字列・パスワード・APIキーを、コード・設定ファイル(`appsettings*.json` を含む)に書いていないか」と明記されています。`.claude/settings.json` で deny が設定されているはずです。  
**直し方：** 削除して、`dotnet user-secrets set ConnectionStrings:SalesCore <接続文字列>` で設定します。

---

**2. 請求書の税額計算が業務ルール違反 / Invoice.cs:20-25**

```csharp
public IReadOnlyList<Money> LineTaxes =>
    SalesRecords.SelectMany(record => record.Lines).Select(line => line.TaxRate.TaxOn(line.Amount)).ToList();

public Money TotalAmount => Tax.TaxableTotal + LineTaxes.Aggregate(Money.Zero, (total, tax) => total + tax);
```

**問題：** 明細ごとに税額を計算して合計しています。  
**なぜ問題か：** 業務ルール 2.消費税 に「**明細ごとに税額を丸めて合計してはならない**」と明記されています。105円×3行（10%）の場合、明細ごとでは 11円×3=33円、税率ごとでは 315円×10%=32円で1円ずれます。正しい請求額は `Tax.TotalWithTax`（既に請求書が持つ、税率ごとに正しく丸めたもの）です。  
**直し方：** `LineTaxes` と `TotalAmount` を削除し、既存の `Tax.TotalWithTax` を使う。明細欄に「各明細の参考税額」を表示したいなら、指標値であることを明記した別の計算式にします。

---

**3. 出荷済み・一部出荷の受注で単価・数量変更が許される / SalesOrder.cs:62-70, 75-86**

```csharp
public void ChangeQuantity(SalesOrderLine line, decimal quantity)
{
    Require(Status is not SalesOrderStatus.Cancelled, "数量変更");
    // 一部出荷・出荷済みでも実行される
    line.ChangeQuantity(quantity);
}

public void ApplyDiscount(int percent)
{
    Require(Status is not SalesOrderStatus.Cancelled, "値引き");
    // 一部出荷・出荷済みでも実行される
    foreach (var line in _lines)
    {
        line.ApplyDiscount(percent);
    }
}
```

**問題：** 出荷済み・一部出荷の受注でも、単価と数量の変更ができてしまいます。  
**なぜ問題か：** 業務ルール 3. 販売の流れ に「**出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか**」と明記されています。既に売上計上済みのデータを書き換えると、帳簿と実績がずれます。  
**直し方：** `Status is SalesOrderStatus.PartiallyShipped or SalesOrderStatus.Shipped` のチェックを加えて、これらの状態では `throw new InvalidOperationException()` を返します。テストで「一部出荷後は変更不可」を確認します。

---

**4. 受注明細の物理削除 / SalesOrder.cs:72-78**

```csharp
public void RemoveLine(SalesOrderLine line)
{
    Require(Status is not SalesOrderStatus.Cancelled, "明細の削除");
    _lines.Remove(line);  // ← 物理削除
}
```

**問題：** 明細を `_lines.Remove()` で物理削除しています。  
**なぜ問題か：** 業務ルール 7. データの扱い に「**物理削除しない。マスタは無効化し、取引データの取消は状態か赤黒で表す**」と明記されています。また、状態ごとにできる操作の表に「削除」は無く、仕様に無い操作です。出荷済みの受注なら売上計上済みのため、削除は帳簿に矛盾を生みます。  
**直し方：** `RemoveLine` メソッド自体を削除するか、削除ではなく「キャンセル」として、明細に状態フラグを持たせます。どちらにせよ、業務ルール 3.販売の流れ の「状態ごとにできる操作」表に無い操作なので、実装前に仕様を確認する必要があります。

---

**5. 値引き計算での型と端数処理の誤り / SalesOrderLine.cs:55-59**

```csharp
internal void ApplyDiscount(int percent)
{
    var factor = 1 - percent / 100.0;  // ← double が生成される
    UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;  // ← (long) キャストで切り捨て
}
```

**問題1：** `100.0` は `double` 型で、計算に `double` が混入しています。  
**なぜ問題か：** CLAUDE.md に「型名を書かない double（`100.0`）はビルドで止まらないのでレビューで拾う」と明記されています。小数計算の精度がメートルされず、銭単位の誤差が出やすくなります。

**問題2：** `(long)` キャストによる切り捨てです。  
**なぜ問題か：** 業務ルール「端数処理を `Money` 以外の場所で行う」禁止に該当し、CLAUDE.md で「キャストによる切り捨て（`(long)x`）はビルドで止まらないのでレビューで拾う」と明記されています。端数処理は **`Money.Round`（四捨五入）だけ** が正式です。

**直し方：** `Money` 型を使って端数処理を行う。単価は `decimal(15,2)` なので、`Money` で扱うか、別途丸め関数を使う必要があります。例えば：
```csharp
internal void ApplyDiscount(int percent)
{
    var factor = 1m - percent / 100m;  // 100m で decimal に統一
    UnitPrice = Money.Round(UnitPrice * factor).Amount;  // Money で四捨五入
}
```

---

### 🟠 Important

**6. テストが業務ルール違反の実装を検証している / InvoiceTests.cs:76-88**

```csharp
[Fact]
public void 請求額は税抜合計と税額の合計()
{
    // ...
    Assert.Equal(new[] { Money.Of(200) }, invoice.LineTaxes);
}
```

**問題：** 明細ごとの税額が正しく計算されることをテストしていますが、この実装自体が誤りです。  
**なぜ問題か：** 上記指摘 #2 と同じ。明細ごとの丸め合計は業務ルール違反です。

---

**7. 出荷済み受注の変更禁止をテストしていない / SalesOrderTests.cs**

```csharp
[Fact]
public void 取り消した受注は変更できない()
{
    // 取消された受注のテストだけで、一部出荷・出荷済みのテストがない
}
```

**問題：** 取消状態での変更禁止は確認していますが、出荷済み・一部出荷での禁止を確認していません。  
**なぜ問題か：** 指摘 #3 の条件検査がコード上無いため、重要なケースが落ちています。業務ルール 3. 販売の流れ で「出荷済み・一部出荷の受注で、計上済みの売上に関わる値を変えられない」と明記されているため、テストも必須です。

---

### 🟡 Minor

**8. RemoveLine の仕様が不明確 / SalesOrder.cs:72-78**

仕様に「明細を削除する」とありますが、以下が不明です：
- 出荷前の受注なら削除してよいか
- 一部出荷後の残数を「取下げ」と呼ぶのか、別の操作か
- 削除した明細の売上がある場合の扱い

業務ルール 3. の「状態ごとにできる操作」表に「削除」が無いため、仕様確認が必要です。

---

## 良い点

- テストの追加で、新しい操作の動作を確認している
- 変更可能な明細数量・単価を `private set` に限定し、メソッド経由の変更にしている
- `ChangeQuantity` で明細の所属チェックをしている

---

## 判定

**マージ不可**

接続文字列の漏えい（Critical）、請求書の税額計算ルール違反（Critical）、出荷済み受注の変更制御の欠落（Critical）、端数処理と型の誤り（Critical）の4つの致命的な問題があります。特に税額計算は請求額に直結する誤りで、また受注変更の制御がないと、既に売上計上済みのデータを書き換えられるため、帳簿が狂います。これらを直さずにマージすると、請求額誤りとデータの一貫性喪失に直結します。