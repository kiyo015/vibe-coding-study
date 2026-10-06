## レビュー結果

(周辺ファイル `SalesOrder.cs`・`SalesOrderLine.cs`・`Money.cs` などは今回の環境でブロックされ読めなかったため、差分に表示されている内容とコメント、`InvoiceTests.cs`/`SalesOrderTests.cs` に見える既存API(`Tax.TotalWithTax`、`Require`、`EnsureQuantity` など)から読み取れる範囲で評価しています。)

### 良い点
- `SalesOrderLine.cs`: `Quantity`・`UnitPrice` を `private set` にし、変更を `internal` メソッド経由に限定する設計方向自体は妥当。
- `SalesOrder.cs`: `ChangeQuantity`/`RemoveLine`/`ApplyDiscount` のいずれも、取消済み受注への操作を `Require` で止めている。
- `SalesOrderTests.cs`: 取消後は変更できないことをテストで確認している(L63-70)。

### 指摘

#### Critical

1. **`appsettings.Development.json:7-9`** — 接続文字列にパスワード平文(`Password=<仕込みの架空の値>`)をコミットしている。
   - なぜ問題か: `CLAUDE.md` に明記された「接続文字列・秘密情報をファイルに書く」の禁止そのもの。開発用とはいえ、リポジトリに残ったパスワードは漏えいした時点で無効化が必要になる。
   - 直し方: この行を削除し、`dotnet user-secrets set ConnectionStrings:SalesCore ... --project src/SalesCore.Api` で設定するよう、本人(手順提示のみ)に委ねる。

2. **`SalesOrder.cs`(ChangeQuantity/ApplyDiscount) と `SalesOrderLine.cs`** — 出荷済み・一部出荷の受注でも数量変更・値引きができる。
   - `ChangeQuantity`/`ApplyDiscount` の状態チェックは `Status is not SalesOrderStatus.Cancelled` のみで、「一部出荷」「出荷済」を素通りさせる。
   - `SalesOrderLine.SalesAmount => AmountOf(ShippedQuantity - ReturnedQuantity)` は `UnitPrice`(・`Quantity`経由の判定)に依存しているため、確定済みの出荷の後で単価を書き換えると、計上済みの売上額が事後的に変わってしまう。
   - なぜ問題か: `business-rules.md`「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量・税率)を変えられないか」に明確に違反する。既に請求・売上計上済みの金額が黙って変わるのは帳簿不整合に直結する。
   - 直し方: `ChangeQuantity`/`ApplyDiscount` は「受付」「承認済」など未出荷の状態のみ許可するようガードし、状態表(`business-rules.md`)に新操作を追記する。また`ChangeQuantity`で`Quantity`を`ShippedQuantity`未満にできないようにする(`EnsureQuantity`も未使用で境界チェックが抜けている)。

3. **`SalesOrder.cs` `RemoveLine`** — 状態・出荷状況を問わず `_lines.Remove(line)` で明細を物理的に取り除いている。
   - なぜ問題か: 出荷済み・返品済みの明細を削除すると、受注からその明細が見えなくなり、受注の合計金額・状態判定(「すべての明細で残りが0なら出荷済」)が崩れる。`business-rules.md`「取消は状態か赤黒で表す」「物理削除しない」に反する。
   - 直し方: 出荷済み数量・返品数量が0の明細のみ削除可能にする、または論理フラグで表現する。

4. **`Invoice.cs` `LineTaxes`/`TotalAmount`** — 明細ごとに税額を丸めて合計している。
   - `LineTaxes` は `line.TaxRate.TaxOn(line.Amount)` を明細単位で計算し、`TotalAmount` はこれを合計して税込金額を出している。既存の `Tax.TotalWithTax`(=税率ごとに1回だけ丸めた正しい税込合計、`InvoiceTests.cs` の既存テストに現れる)とは別経路の独自計算。
   - なぜ問題か: `business-rules.md`「消費税は税率ごとに1回だけ丸める」「明細ごとに丸めて合計してはならない」に直接違反。追加されたテスト(`請求額は税抜合計と税額の合計`)は明細1行のみで、丸めのずれが出ないケースしか検証していないため、誤りが素通りする。
   - 直し方: `TotalAmount` は `Tax.TotalWithTax` を使う。`LineTaxes` を明細表示用に残すなら、税率ごとの税額を按分ルール(最大額に差を寄せる)で明細に配分し、合計が `Tax.TotalWithTax` と必ず一致するようにする。

5. **`SalesOrderLine.cs` `ApplyDiscount`** — `double` の使用とキャストによる切り捨て。
   ```csharp
   var factor = 1 - percent / 100.0;
   UnitPrice = (long)(UnitPrice * (decimal)factor * 100) / 100m;
   ```
   - なぜ問題か: `100.0` は型名を書かない `double`(ビルドでは止まらない禁止事項)。`(long)(... * 100) / 100m` は0.5を四捨五入せず切り捨てる処理で、`Money.Round` を経由していない(キャストによる切り捨てもビルドで止まらない禁止事項)。単価の丸め方針(四捨五入・0から遠い側)に反し、値引き後の単価が系統的に低くなる。
   - 直し方: `decimal` のみで計算し(`var factor = 1m - percent / 100m;`)、丸めは `Money.Round` 相当の処理(またはそれに準ずる `decimal` の四捨五入)で行う。

#### Important

- **`SalesOrderLine.ApplyDiscount`**: `percent` の境界チェックがない。負値や100超を渡すと単価が負になり得る。`business-rules.md` 8章「値引きの明細行の入力方法が決まるまで、受注明細の単価は0以上だけを受け付ける」に反する余地がある。`0 <= percent <= 100` を検証すべき。
- **`business-rules.md` が未更新**: 今回追加した3操作(`ChangeQuantity`/`RemoveLine`/`ApplyDiscount`)は、状態ごとにできる操作の表に載っていない。さらに8章には「伝票全体への値引きは扱わない」「値引きは明細単位で行う」という既存決定があるが、`ApplyDiscount(int percent)` は受注全体へ一律掛けるAPIであり、この決定と矛盾しないか文書上で明確化されていない。CLAUDE.mdの規約上、業務ルールを変える・追加する変更は本文書を一緒に直す必要がある。
- **テストの境界漏れ**: 一部出荷・出荷済み状態での `ChangeQuantity`/`RemoveLine`/`ApplyDiscount` 拒否を確認するテストがない(取消状態のみ検証)。`ChangeQuantity` に0以下の数量を渡した場合のテストもない。

#### Minor

- `SalesOrderLine.cs` のコメント「値引きで下がる」は実装の丸め誤差(切り捨て)まで踏まえると誤解を招く。四捨五入で下がる旨にする(直し方は上記Critical 5の修正後)。

### 判定
**マージ不可。** 接続文字列の秘密情報漏洩、出荷済み・一部出荷の受注で計上済み売上に関わる単価・数量を変更できてしまう状態遷移漏れ、明細削除による計上済み明細の消失、消費税の明細ごと丸めという4つの業務ルール違反(いずれもCritical)があり、請求額・売上の誤りに直結するため。