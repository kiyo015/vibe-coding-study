## 良い点

- **Invoice.LineTaxes と TotalAmount** (Invoice.cs:20-25): 明細ごとの税額を明細欄用に計算し、請求額を正しく計算している。複数出荷での累計差分による金額でも、Tax.TaxableTotal + LineTaxes の合計で正しい請求額が得られる構造になっている。
- **SalesOrderLine の状態管理** (SalesOrderLine.cs:36-42): ShippedQuantity と ReturnedQuantity を分離し、返品しても RemainingQuantity の計算が正確である。
- **テスト構成** (SalesOrderTests.cs): 基本的な動作（ChangeQuantity の値変更、RemoveLine での削除、ApplyDiscount による単価計算）をテストしている。

## 指摘

### Critical

**1. 秘切情報の漏えい**
- appsettings.Development.json:10 / `"Password=<仕込みの架空の値>"` が平文で記録されている
- なぜ問題か：CLAUDE.md に「接続文字列・パスワード・APIキーを appsettings*.json に書いていないか」と明記。秘密情報は dotnet user-secrets を使うことが強制されている
- 直し方：接続文字列全体を削除し、ローカルで `dotnet user-secrets set` で設定する

**2. ChangeQuantity, RemoveLine, ApplyDiscount が出荷済み・一部出荷の状態で許される**
- SalesOrder.cs:63-88 / 各メソッドが `Status is not SalesOrderStatus.Cancelled` だけチェック
- なぜ問題か：business-rules.md「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか」が要件。実装では状態ごとの制約が不足している。例えば ChangeQuantity(line, 5) で既に 8 個出荷済みの明細の数量を 5 に変えると、RemainingQuantity = 5 - 8 = -3 になり矛盾
- 直し方：
  - ChangeQuantity は、新しい Quantity ≥ ShippedQuantity の確認と、Status が Approved のみを許す
  - RemoveLine は、ShippedQuantity > 0 の明細は削除不可、Status が Approved のみ
  - ApplyDiscount は、出荷済み・一部出荷では不可（Status が Approved のみ）

**3. ChangeQuantity で新しい数量の妥当性をチェックしない**
- SalesOrderLine.cs:53 / `internal void ChangeQuantity(decimal quantity) => Quantity = quantity;` が数量の妥当性（> 0、小数3桁以内）を検証していない
- なぜ問題か：コンストラクタには EnsureQuantity チェックがあるが、setter は無条件。ChangeQuantity(line, 0) や ChangeQuantity(line, -5) が通ってしまう
- 直し方：ChangeQuantity 内で EnsureQuantity(quantity, ...) を呼ぶ

**4. ApplyDiscount の単価計算が「切り捨て」で、四捨五入ではない**
- SalesOrderLine.cs:55-59 / `(long)(UnitPrice * (decimal)factor * 100) / 100m`
- なぜ問題か：
  - CLAUDE.md に「キャストによる切り捨て(`(long)x`)はビルドで止まらないのでレビューで拾う」と明記
  - business-rules.md に「端数処理は Money.Round（四捨五入、0.5 は 0 から遠い側）だけ」と定義
  - 単価も金額扱いなので、計算後は四捨五入すべき。テストに端数が出る例（例：単価 123.45m × 10% = 111.105 → 111.11m）がないため検出されていない
- 直し方：`UnitPrice = Money.Round(UnitPrice * (decimal)(100 - percent) / 100m)` に変更（Money.Round を使い、double との混在も避ける）

**5. 型の混在：percent / 100.0 で double を作る**
- SalesOrderLine.cs:57 / `var factor = 1 - percent / 100.0;`
- なぜ問題か：CLAUDE.md に「型名を書かない double は止まらないのでレビューで拾う」と明記。10/100.0 は double 型。その後 (decimal) でキャストしているが、精度ロスの危険性がある
- 直し方：`percent / 100m` と decimal リテラルにする（`decimal` 型のまま計算）

**6. business-rules.md が更新されていない**
- なぜ問題か：CLAUDE.md に「業務ルールを変える時は、コード・テスト・この文書を必ず一緒に直す」と明記。新しい操作（ChangeQuantity, RemoveLine, ApplyDiscount）が追加されているが、どの状態で許すかが定義されていない。業務ルール定義の一貫性が失われている
- 直し方：business-rules.md「3. 販売の流れ」の「状態ごとにできる操作」の表に、新しい3つの操作を追加し、各状態での許否を明記する

### Important

**7. テスト欠落：出荷済み・一部出荷の状態での変更不可テスト**
- SalesOrderTests.cs:26-72 / ChangeQuantity, RemoveLine, ApplyDiscount のテストが、Approved 状態（承認済）のみ
- なぜ問題か：
  - ChangeQuantity(line, 5) で出荷済み数量が 8 のとき、RemainingQuantity が -3 になる誤りが検出されない
  - RemoveLine で出荷済み数量のある明細を削除する誤りが検出されない
  - 業務ルール「状態ごとにできる操作」の表に基づき、PartiallyShipped、Shipped 状態での実行を禁止するテストが必要
- 直し方：例えば以下のテストを追加
  ```csharp
  [Fact]
  public void 一部出荷の受注は明細の数量を変更できない() {
      var line = Line(10);
      var order = Approved(line);
      Ship(order, line, 5);  // 5個出荷
      
      Assert.Throws<InvalidOperationException>(() => order.ChangeQuantity(line, 3));
  }
  ```

**8. ChangeQuantity のテストに境界条件がない**
- SalesOrderTests.cs:27-36 / Quantity を 10 から 5 に変更するテストのみ。ShippedQuantity より小さくする例がない
- 直し方：出荷済み 8 個の明細に対して、数量を 5 に変更しようとするテスト（期待値：InvalidOperationException）を追加

**9. ApplyDiscount のテストが端数処理を検証していない**
- SalesOrderTests.cs:51-61 / 単価 1000m と 200m（端数なし）のみ。端数処理が必要な単価（例：123.45m）のテストがない
- 直し方：例えば `Line(10, 123.45m)` に対して ApplyDiscount(7) を適用し、期待値（111.11m か 111.10m か、四捨五入の結果）を明記したテストを追加

**10. Invoice.TotalAmount のテストが単一行のみ**
- InvoiceTests.cs:76-86 / 複数行、複数税率、複数出荷（cumulative）のテストがない
- 直し方：複数出荷で cumulative 計算される場合、Tax.TotalTax と LineTaxes.Aggregate の合計が一致するテストを追加

### Minor

**11. RemoveLine の戻り値確認なし**
- SalesOrderLine.cs:77 / `_lines.Remove(line)` は bool を返すが、戻り値を使用していない
- 直し方：戻り値を確認して、削除できなかった場合を明示的に扱うか、テストで確認する（ただし、現在のテストは存在を確認しているので、実装としては問題ない）

**12. RemoveLine 削除後の明細数チェック**
- SalesOrderTests.cs:38-48 / RemoveLine 後に Lines が正しく減っているかテストしているが、**受注は最低1行要る** という要件が存在する場合、最後の1行を削除しようとしたときの動作がテストされていない
- SalesOrder コンストラクタに「受注には明細が1行以上要る」とあるが、RemoveLine で最後の1行を削除できるのか確認すべき

## 判定

**マージ不可**

秘密情報漏えい（Critical）、ビジネスルール違反（出荷済み・一部出荷での変更禁止が実装されていない、Critical）、丸め方の誤り（critical）、業務ルール文書未更新（Critical）があり、これらは修正なしではマージできません。特に秘密情報と業務ルール違反は、本番環境・請求額に直結する重大な問題です。