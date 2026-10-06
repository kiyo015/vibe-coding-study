# レビュー結果

## 良い点

- `SalesOrderLine.ChangeQuantity`・`ApplyDiscount` を `internal` にして、呼び出しを必ず `SalesOrder` 経由にしている構造は既存のカプセル化方針（`SalesOrderLine.cs:53,55` / `SalesOrder.cs:63,74,81`）に沿っている。
- `SalesOrder.RemoveLine`・`ChangeQuantity`・`ApplyDiscount` のいずれも `Require` で `Cancelled` 状態をまず拒否しており、既存の状態検査パターン（`Require`）を踏襲している点は良い（`SalesOrder.cs:65,76,83`）。
- `取り消した受注は変更できない()`（`SalesOrderTests.cs`）のように、新操作に対する状態検査のテストを追加した姿勢自体は正しい方向。

## 指摘

### Critical

1. **`src/SalesCore.Api/appsettings.Development.json:7-9` — パスワード付き接続文字列をリポジトリにコミット**
   `"Password=<仕込みの架空の値>"` を平文でファイルに書いている。`CLAUDE.md`／業務ルールとも「接続文字列・秘密情報をファイルに書く」ことを強制的に禁止しており、`dotnet user-secrets` で各自が設定する決まり。パスワードが人によって異なる前提（READMEの手順）にも反し、他の開発者の環境を壊すうえ秘密情報の漏えいになる。この変更は削除し、代わりに手順書通り `dotnet user-secrets set` を各自実行する。

2. **`src/SalesCore.Domain/Invoice.cs:21-25` — 消費税を明細ごとに丸めて合計している**
   `LineTaxes` は `SalesRecordLine` 単位で `TaxRate.TaxOn(line.Amount)`（= `Money.Round` を1回ずつ呼ぶ）を実行し、`TotalAmount` はその合計を使っている。これは `business-rules.md` が名指しで禁止している「明細ごとに税額を丸めて合計する」パターンそのもの。同じ税率の明細が複数あると `Tax.TotalWithTax`（税率ごとに1回だけ丸めた正しい値、`TaxCalculator.cs:28-37`）とずれる。
   例：10%の明細が105円・105円の2行なら、明細ごとは `11円+11円=22円`、税率ごとは `210円×10%=21円` で1円ずれる（まさに `TaxCalculator.cs:25-26` のコメントに書かれている反例）。
   追加されたテスト（`InvoiceTests.cs`）は明細1行のみなので、このズレを検出できない。
   直し方：`TotalAmount` は既存の `Tax.TotalWithTax` をそのまま使う。明細ごとの税額を「表示」したいなら、税率ごとに1回丸めた税額を明細の金額比で**按分**し、差額は最大額の明細に寄せる（`business-rules.md`「按分」のルール）必要がある。単純な `TaxOn` の明細呼び出しでは成立しない。

3. **`src/SalesCore.Domain/SalesOrderLine.cs:57` — 型名を書かないdouble**
   `var factor = 1 - percent / 100.0;` は `100.0`（`m`なしのdouble直書き）により `percent / 100.0` がdouble演算になり、`factor` もdoubleになる。金額計算に浮動小数点を混在させており、ビルドのSALES001はソース文字列検査のため `src` 配下の `double`・`float` 語を検出するはずだが、この書き方（型名を書かないdouble）はすり抜ける想定どおりの穴。`100m` を使い、全体をdecimalで計算する。

4. **`src/SalesCore.Domain/SalesOrderLine.cs:58` — キャストによる切り捨て**
   `(long)(UnitPrice * (decimal)factor * 100) / 100m` は常に0方向へ切り捨てる（四捨五入ではない）。業務ルールは端数処理を `Money.Round` に限定しており、キャスト切り捨てはビルドで止まらないため明示的にレビューで拾う対象。例えば単価333.335円を10%引きすると正しくは四捨五入で300.00円相当になるべきところ、切り捨てで値がずれる。`Money.Round` を使うよう書き直す（丸め対象が「円」ではなく「単価(銭)」である点の取り扱いもこの場で定義し直す必要がある）。

5. **`src/SalesCore.Domain/SalesOrder.cs:81-88`／`SalesOrderLine.cs:55-59` — `ApplyDiscount` に percent の範囲検査がない**
   `percent` が100を超える、または負の値でも検査なしに単価計算へ渡る。100を超える値を渡すと `UnitPrice` が負になり、コンストラクタで保証している「単価は0以上」という不変条件（`SalesOrderLine.cs:13-16`）が、値引き経由では破られる。0〜100の範囲チェックと、結果が0以上であることの保証を追加する。

6. **`src/SalesCore.Domain/SalesOrder.cs:63-71` — `ChangeQuantity` に数量検証・出荷済み数量との比較がない**
   `SalesOrderLine.ChangeQuantity(decimal quantity) => Quantity = quantity;` は値をそのまま代入するだけで、`EnsureQuantity`（0より大きい・小数3桁まで）を一切呼んでいない。0・負値・小数4桁以上でも素通りする。
   さらに重大なのは、**`ShippedQuantity` との比較がない**こと。例えば `ShippedQuantity=5`、`Quantity=10` の明細に `ChangeQuantity(line, 3)` を呼べると `Quantity(3) < ShippedQuantity(5)` になり、「受注数量を出荷済み数量より小さくできない」という業務ルールに正面から違反する（レビュー観点に明記された項目）。`RemainingQuantity` が負になるなど後続処理の前提も崩れる。
   直し方：`EnsureQuantity` を呼ぶ、かつ `quantity < ShippedQuantity` を拒否する。

7. **`src/SalesCore.Domain/SalesOrder.cs:74-78` — `RemoveLine` が明細を物理的にリストから削除している**
   `_lines.Remove(line)` は、レビュー観点が名指しで警戒する「リストからの`Remove`」そのもの。出荷済み数量・返品数量を一切確認せずに削除できるため、`ShippedQuantity > 0` の明細を削除すると：
   - `Order.Amount`（`_lines` の集計）がその明細の分だけ消え、計上済み売上と受注側の金額が食い違う
   - その後 `RecordReturn` → `Validate` の `_lines.Contains(l.Line)` チェック（`SalesOrder.cs:141`）に失敗し、**出荷済みで得意先の手元にある数量の返品が二度とできなくなる**（業務上、返品できる数量が消滅する）
   業務ルール集は「取消は状態か赤黒で表し、削除しない」と明記している。明細の取り下げも、出荷済み数量がある場合は削除禁止にし、未出荷の明細は「削除済み」フラグや取消状態で表現すべき。少なくとも `ShippedQuantity > 0 || ReturnedQuantity > 0` の明細の削除は拒否するガードが必要。

8. **業務ルール文書が更新されていない（出荷済み状態での変更許可／全体値引きの矛盾）**
   - `business-rules.md`「状態ごとにできる操作」の表に `数量変更`・`明細削除`・`値引き` が無い。現在の実装は `Cancelled` 以外の**全状態**（受付・承認済・一部出荷・**出荷済**を含む）でこれらを許可してしまう。出荷済み・一部出荷の受注で単価・数量を変えられないかはレビュー観点に明記された確認事項であり、現状は検査が存在しない。
   - `business-rules.md` 8章は「**伝票全体への値引きは扱わない（2026-09-30決定）**。値引きは明細単位で行う」と明記している。しかし今回追加された `ApplyDiscount(int percent)` は、受注（伝票）全体に対して一律の割合を指定し、全明細の単価を一度に下げる機能であり、文書が明示的に「扱わない」とした「伝票全体への値引き」に相当する。実装するなら、まずこの決定を見直すPR（文書の更新）を先に通す必要がある。文書と実装が矛盾したまま入ると、後続の開発者が「全体値引きは未対応」という前提で別の実装を重ねる危険がある。

### Important

9. **`SalesOrder.RemoveLine` — 残り明細が0件になる可能性**
   明細を全て `RemoveLine` すると `_lines` が空になり得るが、コンストラクタが保証する「受注には明細が1行以上要る」という不変条件のチェックが削除時には無い。最後の1行の削除を禁止する、または明細0件の受注を別途禁止するガードが必要。

10. **テスト不足**
    - 出荷済み・一部出荷の受注に対して `ChangeQuantity`／`RemoveLine`／`ApplyDiscount` を呼んだときに拒否されることを確認するテストがない（現状は許可されてしまうバグなので、本来は「落ちるべきテスト」を先に書いて検出できたはず）。
    - `ChangeQuantity` で `ShippedQuantity` 未満への変更がエラーになることを確認するテストがない。
    - `ApplyDiscount` に100%超・負の値を渡した境界値のテストがない。
    - `Invoice.LineTaxes`／`TotalAmount` を、同一税率の明細が複数ある請求書（例：10%の明細2行）でテストしていない。現在のテストは1明細のみなので、Critical項目2のズレを検出できない。

## 判定

**マージ不可**。消費税を明細ごとに丸めて合計している実装（Critical #2）は請求額の誤りに直結する業務ルール違反で、`ChangeQuantity`/`RemoveLine` には出荷済み数量との整合性チェックが欠落しており売上データの不整合・返品不能を招く（#6, #7）。さらに秘密情報の平文コミット（#1）、double・キャスト切り捨て（#3, #4）もあり、現状のままでは出荷済み受注の変更禁止や全体値引きの業務ルール上の位置づけも未整理（#8）。これらをすべて直し、対応するテストを追加してから再レビューが必要。