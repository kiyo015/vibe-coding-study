差分から重大な問題が複数見つかります。ファイルアクセスの権限制限があるため、差分の内容から直接指摘します。

---

## 良い点

- `SalesOrder.ChangeQuantity` / `RemoveLine` で既に取消済みの受注への変更を禁止している（一部）
- `SalesOrderLine.Quantity` / `UnitPrice` を `private set` に変更し、外部からの直接操作を防止
- テストで基本ケースを確認している

---

## 指摘

### Critical

#### 1. **appsettings.Development.json にパスワード記述** / 行4-7
**ファイル: `appsettings.Development.json` / 行 8**

接続文字列にパスワード「`<仕込みの架空の値>`」がベタ書きされています。

**何が問題か**: CLAUDE.md と business-rules.md で明記された禁止事項です。
- CLAUDE.md「秘密情報」: 「接続文字列・パスワード・APIキーをファイルに書かない。`dotnet user-secrets` か環境変数を使う」
- `.claude/settings.json` の deny で `appsettings*.json` は読み取り禁止になるべき

**リスク**: リポジトリにパスワードが残り、本番環境までもセキュリティが脆弱になります。

**直し方**: 
- このファイルから `ConnectionStrings` を削除
- `dotnet user-secrets set ConnectionStrings:SalesCore "Host=localhost;Port=5432;Database=salescore_dev;Username=salescore_dev;Password=..." --project src/SalesCore.Api` で設定

---

#### 2. **SalesOrder.ChangeQuantity / ApplyDiscount が出荷済み・一部出荷で実行できる** / 行 62-63, 76-82

`ChangeQuantity` と `ApplyDiscount` は `Status is not SalesOrderStatus.Cancelled` のみチェックし、出荷状態を検証していません。

**何が問題か**: business-rules.md 第3節に明記: 
> 出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか

出荷が確定している受注では、単価・数量の変更で売上が狂い、帳簿が不一致になります。例：
- 単価を変更 → 既に計上済みの売上額が変わる
- 数量を減らす → 受注数量 < 出荷済み数量 になり、データ不整合

**直し方**: 
```csharp
Require(Status is SalesOrderStatus.Accepted or SalesOrderStatus.Approved, 
    "受付または承認済の受注のみ変更可能");
```

---

#### 3. **SalesOrderLine.ApplyDiscount でキャストによる切り捨て** / 行 58

```csharp
UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;
```

**何が問題か**: 
- `(long)` キャストは四捨五入ではなく**切り捨て**です
- 小数第3位が出た場合、誤った単価になります。例：
  - UnitPrice = 333m, 30%割引 → `333 × 0.7 = 233.1`
  - キャスト: `(long)(23310) / 100 = 233m` (正しくは 233m だが、偶然一致)
  - 別例: `333 × 0.68 = 226.44` → `226m`（正しくは 226m、偶然一致）
  - 別例: `333 × 0.66 = 219.78` → `219m`（正しくは 220m、**誤り！**）
- CLAUDE.md: 「キャストによる切り捨てはビルドで止まらないのでレビューで拾う」

**直し方**: `Money.Round` を使用
```csharp
var discounted = Money.Of(UnitPrice) * (100 - percent) / 100;
UnitPrice = discounted.Amount;  // Money に丸め機能がある
```

---

#### 4. **SalesOrderLine.ApplyDiscount で `double` リテラル** / 行 58

```csharp
var factor = 1 - percent / 100.0;  // ← 100.0 は double
```

**何が問題か**: CLAUDE.md「型名を書かない double…はレビューで拾う」。金額計算では精度が必要です。

**直し方**: `100m` に変更

---

#### 5. **SalesOrder.RemoveLine が物理削除を実行** / 行 71-76

```csharp
public void RemoveLine(SalesOrderLine line)
{
    Require(Status is not SalesOrderStatus.Cancelled, "明細の削除");
    _lines.Remove(line);  // ← 削除
}
```

**何が問題か**: business-rules.md 第7節「データの扱い」:
> 物理削除しない。マスタは無効化し、取引データの取消は状態か赤黒で表す

2026-10-05から、アーキテクチャテストで強制される予定です。

**直し方**: 論理削除フラグ（例 `IsDeleted`）を持つ、または明細の状態を持つ。単純な削除ではなく、削除された明細の痕跡を保持。

---

### Important

#### 6. **Invoice.LineTaxes が「明細ごとの税額計算」の可能性** / 行 20-21

```csharp
public IReadOnlyList<Money> LineTaxes =>
    SalesRecords.SelectMany(record => record.Lines)
        .Select(line => line.TaxRate.TaxOn(line.Amount)).ToList();
```

**何が問題か**: 
- business-rules.md第2節に「明細ごとに税額を丸めて合計してはならない。税率ごとに対象額の合計 × 税率を1回だけ四捨五入」と明記
- 実測結果: 「ランダムな請求書1万件で約53%の請求書で税額が食い違い、差は最大5円」

この実装は各明細に対して個別に税額を計算し、合計しています。複数の税率がある請求書や、105円 × 3明細などのケースで誤ります。

**テストの欠落**: 複数明細・複数税率の組み合わせが無い

**直し方**: 
- 表示用の `LineTaxes` は計算で出す場合、`Tax`（既存・正確）の内訳を使う
- もしくは、内部で税率ごとに正確に計算した税額を保持し、それを明細に割り振る

---

#### 7. **SalesOrderLine.ChangeQuantity で入力値検証がない** / 行 53

```csharp
internal void ChangeQuantity(decimal quantity) => Quantity = quantity;
```

**何が問題か**: 
- 負数や 0 を許可する可能性
- 既存に `EnsureQuantity` メソッドがあるのに使われていない

**直し方**: 
```csharp
internal void ChangeQuantity(decimal quantity)
{
    EnsureQuantity(quantity, nameof(quantity));
    Quantity = quantity;
}
```

---

#### 8. **状態遷移テストの欠落** / SalesOrderTests

**何が問題か**: 以下のテストケースが無い：
- 「一部出荷」状態での `ChangeQuantity` / `ApplyDiscount` が例外を投げることの確認
- 「出荷済」状態での変更が拒否されることの確認
- 「受付」状態での変更が許可される確認

**直し方**: 各状態で操作を試み、許可/拒否を確認するテストを追加

---

#### 9. **ApplyDiscount の端数処理テストの欠落** / SalesOrderTests

**何が問題か**: 
```csharp
[Fact]
public void 値引きすると全明細の単価が下がる()
{
    var first = Line(10, 1000m);
    var second = Line(5, 200m);
    var order = Approved(first, second);
    order.ApplyDiscount(10);
    Assert.Equal(900m, first.UnitPrice);  // 1000 * 0.9 = 900 (偶然正確)
    Assert.Equal(180m, second.UnitPrice); // 200 * 0.9 = 180 (偶然正確)
}
```

単純なケースのみ。端数が出るケース（例：`Line(10, 333m)` に 30%割引 → 233.1円 → 丸め処理）をテストしていません。

---

### Minor

#### 10. **コメント「値引きで下がる」** / SalesOrderLine.cs 行 30

```csharp
/// <summary>受注時点の単価。値引きで下がる。</summary>
public decimal UnitPrice { get; private set; }
```

誤解の余地があります。より正確には「割引で下がる」「変更される」など。

---

## 判定

**マージ不可**

**理由**: 
1. **セキュリティリスク**（パスワード記述）とコード品質の重大な欠陥が複数あります。
2. **業務ルール違反**：出荷済み受注への変更許可、物理削除、明細ごとの税計算、キャストによる切り捨てなど、請求額の誤りや帳簿不一致に直結します。
3. テストが不十分で、状態遷移や端数処理の正確性が保証されていません。

修正後、再度レビューしてください。