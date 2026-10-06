システムメッセージ内の `business-rules.md` を参照して、レビューを進めます。

## 良い点

- **テスト構造**: `InvoiceTests` と `SalesOrderTests` に新機能のテストが追加されている
- **明細構造**: `SalesOrderLine` に `ChangeQuantity` と `ApplyDiscount` を内部メソッドとして分離している

## 指摘

### Critical（必須修正）

**1. appsettings.Development.json に接続文字列とパスワードを書いている**

- ファイル: `src/SalesCore.Api/appsettings.Development.json` / 行7-9
- 問題: `Password=<仕込みの架空の値>` が含まれた接続文字列がリポジトリに入っている
- なぜ: CLAUDE.md「秘密情報をファイルに書く」が強制違反（`.claude/settings.json` の deny）。リポジトリに秘密情報が残る
- 直し方: `dotnet user-secrets set "ConnectionStrings:SalesCore" "Host=localhost;..."` で user-secrets に入れ、appsettings.json からは削除。接続文字列は記載しない

**2. ApplyDiscount で型名を書かない double リテラルを使っている**

- ファイル: `src/SalesCore.Domain/SalesOrderLine.cs` / 行56
- 問題: `percent / 100.0` で double 計算、`100.0` が型名を書かない double
- なぜ: CLAUDE.md「型名を書かない double はビルドで止まらないのでレビューで拾う」。double → decimal の変換は精度を失う。例: 33% 割引で正確な値が出ない可能性
- 直し方: `var factor = (decimal)(100 - percent) / 100m;` で decimal 計算に統一。さらに `UnitPrice = Money.Round(UnitPrice * factor);` で丸める

**3. 出荷済み・一部出荷の受注で `ChangeQuantity`・`RemoveLine`・`ApplyDiscount` が制限されていない**

- ファイル: `src/SalesCore.Domain/SalesOrder.cs` / 行62-87
- 問題: 3つのメソッドが `Status is not SalesOrderStatus.Cancelled` だけをチェック。出荷済み・一部出荷状態でも実行できる
- なぜ: 業務ルール「出荷済み・一部出荷の受注で、計上済みの売上に関わる値(単価・数量)を変えられないか」に違反。売上が計上済みの状態で数量・単価を変えると帳簿が狂う
- 直し方: 3メソッドで状態チェックを拡張: `Require(Status is SalesOrderStatus.Accepted or SalesOrderStatus.Approved, "操作名")` で受付・承認済みだけに限定

**4. `RemoveLine` が物理削除を行っている**

- ファイル: `src/SalesCore.Domain/SalesOrder.cs` / 行71 の `_lines.Remove(line)`
- 問題: リストから削除している。明細の状態で表すべき
- なぜ: 業務ルール「物理削除しない。取引データの取消は状態で表す」。削除されたことが監査証跡に残らない
- 直し方: `SalesOrderLine` に「削除」状態を追加し、状態で削除を表す。リストからは削除しない

**5. `TotalAmount` が明細ごとの税を合計している**

- ファイル: `src/SalesCore.Domain/Invoice.cs` / 行21-22
- 問題: `LineTaxes.Aggregate(...)` で各明細の税を丸めて合計している
- なぜ: 業務ルール「明細ごとに税額を丸めて合計してはならない。105円（10%）の明細3行なら、明細ごとでは 11円 × 3 ＝ 33円、税率ごとでは 315円 × 10% ＝ 32円で、1円ずれる」。これはインボイス制度の要件違反で、請求額が狂う
- 直し方: `public Money TotalAmount => Tax.TaxableTotal + Tax.TotalTax;` に変更。`Tax.TotalTax` は税率ごとに正しく計算されている。`LineTaxes` は表示用に留める

**6. 伝票全体への値引き（`ApplyDiscount`）を実装している**

- ファイル: `src/SalesCore.Domain/SalesOrder.cs` / 行79-87
- 問題: `ApplyDiscount(int percent)` で受注全体の値引きを実装
- なぜ: 業務ルール「伝票全体への値引きは扱わない（2026-09-30 決定）。値引きは明細単位で行う」。要件では「値引きは明細単位（単価を下げるか、税率を指定した値引きの明細行を立てる）」と決定済み
- 直し方: `ApplyDiscount` メソッドを削除するか、仕様を業務ルール文書に追記したうえで明細単位に実装し直す

### Important（修正推奨）

**7. `ChangeQuantity` と `ApplyDiscount` の入力値検証がない**

- ファイル: `src/SalesCore.Domain/SalesOrderLine.cs` / 行53、56-59
- 問題: `ChangeQuantity(quantity)` が負・0の値を受け付ける。`ApplyDiscount(percent)` が負・100以上の値を受け付ける
- なぜ: `SalesOrderLine.EnsureQuantity` メソッドが存在するのに使われていない。テストが見ていない境界条件で壊れる可能性
- 直し方: `ChangeQuantity` で `EnsureQuantity(quantity, nameof(quantity))` を呼ぶ。`ApplyDiscount` で `Require(percent >= 0 && percent < 100, "割引率は 0 以上 100 未満")` 追加

**8. テストが出荷済み・一部出荷状態の変更をカバーしていない**

- ファイル: `tests/SalesCore.Domain.Tests/SalesOrderTests.cs` / 行41-50
- 問題: テストは「取り消した受注は変更できない」だけ。出荷済み・一部出荷状態でも変更・削除できてしまう
- なぜ: Critical#3 と同じ。テストで誤った実装を検出できない
- 直し方: テストを追加: 一部出荷状態で `ChangeQuantity`・`RemoveLine` → 例外、出荷済み状態で `ApplyDiscount` → 例外

**9. `ApplyDiscount` の計算ロジックが複雑で精度に不安がある**

- ファイル: `src/SalesCore.Domain/SalesOrderLine.cs` / 行56-59
- 問題: `(long)(... * 100) / 100m` でキャスト。double 経由での変換は不正確
- なぜ: decimal 計算が混在。金額が 0.5 未満ずれる可能性
- 直し方: `Money.Round` を使う（Critical#2 の修正後）

## 判定

**マージ不可**

Critical な違反が 6 件あります：

1. 秘密情報（パスワード）がリポジトリに入る（セキュリティ侵害）
2. double 型リテラルで金額計算（業務ルール禁止）
3. 出荷済み状態で売上値を変更できる（帳簿狂う）
4. 明細を物理削除している（監査証跡喪失）
5. 請求額が誤った税計算に基づく（インボイス制度違反・請求額誤り）
6. 仕様にない伝票全体値引きを実装（業務ルール違反）

特に #3・#5 は請求額や売上に直結する誤りで、財務データの信頼性を損なうため直ちに修正が必須です。