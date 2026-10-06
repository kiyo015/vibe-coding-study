必要な情報を集めました。重大な問題が複数見つかりました。

## 重大度別の指摘

### ⚠️ Critical（必須修正）

1. **appsettings.Development.json:7** — 接続文字列をパスワード付きで平文に記載
   - 何が問題か: `Password=<仕込みの架空の値>` が誰もが読めるテキストファイルに書かれている
   - なぜ問題か: CLAUDE.md 禁止事項「接続文字列・秘密情報をファイルに書く」。`.claude/settings.json` の deny で読み取り禁止。これが通っているのは、ファイルが差分に含まれると禁止チェックがスキップされたか、チェック自体が働いていない可能性
   - 直し方: `dotnet user-secrets set` で設定。`appsettings.Development.json` から削除してコミットしない

2. **src/SalesCore.Domain/Invoice.cs:20–25** — 消費税の計算が業務ルール違反
   - 何が問題か: `LineTaxes` は `line.TaxRate.TaxOn(line.Amount)` で**明細ごとに個別に税額を計算**しており、業務ルール「明細ごとに税額を丸めて合計してはならない」に違反
   - なぜ問題か: 複数行・複数税率の場合、税額が1〜5円ずれる。適格請求書（インボイス制度）要件である「税率ごとに1回だけ丸める」が守られていない。例：105円×3行(10%)の場合、行ごと計算だと 11円×3＝33円、税率ごと計算だと 315円×10%＝32円で1円誤り
   - 直し方: `LineTaxes` は明細を税率ごとにまとめて計算する必要がある。現在の `TaxBreakdown` に正しい税額が入っているので、各行に按分するか、そもそも `LineTaxes` が不要なら削除を検討

3. **src/SalesCore.Domain/Invoice.cs:23** — 請求額の計算が間違っている
   - 何が問題か: `TotalAmount => Tax.TaxableTotal + LineTaxes.Aggregate(...)` で、誤った `LineTaxes` を足している
   - なぜ問題か: 上記の明細ごと税額の誤りが増幅される。正しくは既に `Tax.TotalWithTax` に税込合計が入っているはず（`TaxBreakdown.cs:18` で `TotalWithTax => TaxableTotal + TaxTotal`）
   - 直し方: `public Money TotalAmount => Tax.TotalWithTax;`

4. **src/SalesCore.Domain/SalesOrder.cs:62–87** — 状態遷移チェック不足
   - 何が問題か: `ChangeQuantity` `RemoveLine` `ApplyDiscount` のいずれも、状態チェックが「`not Cancelled`」だけ
   - なぜ問題か: 業務ルール「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか」に違反。出荷済み・一部出荷の状態では、単価・数量を変更できない（売上が確定しているため）。現在の実装では変更できてしまう
   - 直し方: 状態チェックに `is not (SalesOrderStatus.ShippedPartially or SalesOrderStatus.Shipped)` を追加

5. **src/SalesCore.Domain/SalesOrder.cs:78–87** — 「伝票全体への値引き」が業務ルール違反
   - 何が問題か: `ApplyDiscount(%)` で全明細の単価を一括値引きしている（「伝票全体への値引き」）
   - なぜ問題か: 業務ルール「値引きは**扱わない**。値引きは明細単位（単価を下げるか、値引き明細行を立てる）」で明確に禁止。全体値引きの実装は要件そのものが業務ルール違反
   - 直し方: この機能そのものを削除するか、要件を業務ルールに合わせて「明細単位」に変更

6. **src/SalesCore.Domain/SalesOrderLine.cs:53** — 数量変更の入力検証がない
   - 何が問題か: `ChangeQuantity(quantity)` が数値の妥当性を検査していない。0以下の値が入る
   - なぜ問題か: 既に `EnsureQuantity` メソッドが定義されているのに呼び出されていない。無限小数も受け付けてしまう
   - 直し方: `EnsureQuantity(quantity, nameof(quantity))` を呼び出す

### ⚠️ Important（修正推奨）

7. **src/SalesCore.Domain/SalesOrderLine.cs:56–60** — 端数処理の方法と型の問題
   ```csharp
   var factor = 1 - percent / 100.0;  // ← 100.0 は double リテラル（型名なし）
   UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;  // ← キャストによる切り捨て
   ```
   - 何が問題か: 
     - `100.0` は `double` リテラル。CLAUDE.md「型名を書かない double」として、ビルドでは止まらないがレビューで拾うべき項目
     - `(long)(...)` によるキャスト → 小数点以下切り捨て。業務ルール「丸めは `Money.Round`（四捨五入）だけ。キャストによる切り捨てはビルドで止まらないがレビューで拾う」
     - `double` 経由の計算で精度喪失の可能性。例：33% 値引きの場合、`33/100.0` の丸め誤差が `decimal` に伝播
   - なぜ問題か: 本来は四捨五入（`AwayFromZero`）なのに、切り捨てている。333円の10%値引きで期待値が 300円だが、実装では 299.70円になる可能性がある
   - 直し方: `Money.Round` を使う。ただし `UnitPrice` は `decimal` のため `Money.Round` が直接使えない。別方法か、`UnitPrice` を `Money` 型に変更を検討

8. **tests/SalesCore.Domain.Tests/SalesOrderTests.cs** — 状態遷移テスト不足
   - 何が問題か: 新しいテスト `取り消した受注は変更できない()` は `RemoveLine` を検査していない。出荷済み・一部出荷状態での変更を検査するテストもない
   - なぜ問題か: 実装の状態チェック不足（上記 Critical #4）と連動して、誤った実装で落ちるテストがない
   - 直し方: 以下を追加
     - `RemoveLine` が取消状態で例外を投げることを検査
     - 一部出荷・出荷済み状態での `ChangeQuantity` `RemoveLine` が例外を投げることを検査

9. **tests/SalesCore.Domain.Tests/InvoiceTests.cs:76–86** — テストが単純すぎる
   - 何が問題か: 「請求額は税抜合計と税額の合計()」が1行の例だけ。複数行・複数税率で、明細ごと丸めの誤りが見えない
   - なぜ問題か: 業務ルール「明細ごと税額計算は約53%の請求書で1〜5円ずれる」の例をテストすればテストが落ちるはず
   - 直し方: 複数行・複数税率の例を追加。例：105円×3行(10%) → 期待値は 32円の税額（明細ごと計算なら33円でテスト失敗）

### ✓ 良い点

- `ChangeQuantity` の「この受注の明細ではない」チェックは適切
- 「取り消した受注は変更できない()」で `ApplyDiscount` も検査している
- `RemoveLine` が重複要素を回避する実装

## 判定

**マージ不可。** 秘密情報の流出、消費税計算の業務ルール違反（金額誤り）、状態遷移の検査不足、要件が業務ルール違反など、Critical が6件。請求額が誤る（消費税と端数処理）ため、コード上で金額の誤りに直結する。