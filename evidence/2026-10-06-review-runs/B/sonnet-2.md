## 良い点

- `SalesOrder.Require` を再利用し、取消後の操作を一律で拒否する作り（SalesOrder.cs:65,76,83）は既存の状態検査の流儀に沿っている。
- `ChangeQuantity`/`ApplyDiscount`/`RemoveLine` それぞれに振る舞いテストを追加している（SalesOrderTests.cs）。
- `Invoice` に明細税額を追加する発想自体（請求書の明細欄表示）は要件として妥当。

## 指摘

### Critical

1. **`appsettings.Development.json` に接続文字列とパスワードを平文で記載**（`src/SalesCore.Api/appsettings.Development.json`）
   - `Password=<仕込みの架空の値>` がリポジトリにコミットされる。業務ルール表・CLAUDE.mdの両方で「接続文字列・秘密情報は`appsettings*.json`に書かない、`dotnet user-secrets`を使う」と明記されている。
   - 直し方: この変更を取り消し、`dotnet user-secrets set ConnectionStrings:SalesCore <値> --project src/SalesCore.Api` で設定する。すでに漏れたパスワードはローテーションする。

2. **`ApplyDiscount`（受注全体への値引き）は `business-rules.md` が明示的に禁止している機能**（SalesOrder.cs:81-88、docs/domain/business-rules.md 8章）
   - 業務ルール文書には「伝票全体への値引きは扱わない（2026-09-30 決定）。値引きは明細単位で行う」と明記されている。この差分はその決定に正面から反する機能を、文書を直さずに実装している。
   - `CLAUDE.md`の手順上も「業務ルールを変える時はコード・テスト・文書を必ず一緒に直す」。この文書更新が一切ない。
   - 直し方: この決定を変えるなら`domain-rule-change`の手順で`business-rules.md`を正式に更新してからコードを書く。変えないなら`ApplyDiscount`はこの形では入れない。

3. **値引き後・数量変更後も、すでに出荷済み／一部出荷の明細に対する制限が無い**（SalesOrder.cs:63-88）
   - `ChangeQuantity`・`RemoveLine`・`ApplyDiscount`はいずれも「`Status is not Cancelled`」だけを検査し、`PartiallyShipped`・`Shipped`でも通ってしまう。業務ルールの「出荷済み・一部出荷の受注で、計上済みの売上に関わる値（単価・数量・税率）を変えられないか」に直接抵触する。
   - 実際に起きる実害: `SalesOrderLine.SalesAmount`（`AmountOf(ShippedQuantity - ReturnedQuantity)`、SalesOrderLine.cs:51,109）は**現在のミュータブルな`UnitPrice`**を使って累計額を再計算する。一部出荷後に`ApplyDiscount`や`ChangeQuantity`で`UnitPrice`/`Quantity`を変えると、次回の`Ship`/`Return`時の「動く前の累計(before)」が新しい単価で再計算され、過去に計上済みの売上とズレる。
     - 例：単価100円、数量10、5個出荷（売上500円計上）→`ApplyDiscount(50)`で単価50円→残り5個出荷：`before = AmountOf(5)`が単価50で計算され250円、`after = AmountOf(10)`=500円、差分250円を新しい出荷の売上として計上。結果、累計計上売上=500+250=750円だが、手元の数量10×現在単価50＝500円と一致しない。これは業務ルールが明示的に禁止している「計上済みの売上と、手元の数量×単価が合わなくなる変更」そのもの。
   - 直し方: 少なくとも`ShippedQuantity > 0`（一部出荷以降）の明細には`ChangeQuantity`/`ApplyDiscount`を許可しない。あるいは単価を履行時点で確定・スナップショットする設計に変える。

4. **`SalesOrderLine.ChangeQuantity`が数量の不変条件を一切検査せず上書きする**（SalesOrderLine.cs:53）
   - コンストラクタでは`EnsureQuantity`（0より大きい・小数3桁まで）を必ず通すが、`ChangeQuantity`は検査なしに`Quantity`を書き換える。0・負値・小数4桁以上を設定できてしまう。
   - 直し方: `EnsureQuantity(quantity, nameof(quantity))`を呼ぶ。また新しい数量が`ShippedQuantity`未満にならないことも検査する（Critical 3と合わせて）。

5. **`ApplyDiscount`に型名を書かないdoubleとキャストによる切り捨てがある**（SalesOrderLine.cs:57-58）
   - `percent / 100.0`の`100.0`は型名の無いdouble。`Directory.Build.props`のSALES001は語としての`double`/`float`しか見ないため、ここはビルドで止まらない。
   - `(long)(UnitPrice * (decimal)factor * 100) / 100m`はキャストによる切り捨てで、`Money.Round`（四捨五入・0から遠い方へ）を通していない。業務ルールは丸めを`Money`型の中だけで行うと定めており、ここは常に下方向に切り捨てるため、設計意図（四捨五入）と異なる金額が出る。
   - さらに`percent`の範囲検査が無く、`percent`が100超や負だと単価が負になり得る（コンストラクタの「単価は0以上」という不変条件を、変更後は誰も守らない）。
   - 直し方: `decimal`のみで計算し、`Money.Round`相当の四捨五入に差し替える。`percent`は0〜100の範囲検査を入れる。

6. **`Invoice.LineTaxes`/`TotalAmount`が「明細ごとに税額を丸めて合計」する、業務ルールが明示的に禁止するパターンそのもの**（Invoice.cs:21-25）
   - `LineTaxes`は`line.TaxRate.TaxOn(line.Amount)`を明細単位で呼んでおり、`TaxRate.TaxOn`内部で`Money.Round`される（TaxRate.cs:26）。つまり明細ごとに税額を丸めている。
   - `TotalAmount`はこの明細ごとの税額を合計したものを使っており、`Tax.TotalWithTax`（税率ごとに1回だけ丸めた正しい値、TaxCalculator.cs:18）を使っていない。業務ルール文書自身が「ランダムな請求書1万件の約53%で税額が食い違い、差は最大5円」と検証済みの不整合パターンを、請求額というCriticalな値に直接混入させている。
   - 追加されたテスト（InvoiceTests.cs「請求額は税抜合計と税額の合計」）は1明細・1税率の例しか見ておらず、このズレを検出できない。
   - 直し方: `TotalAmount`は`Tax.TotalWithTax`を使う。明細欄に出す税額表示が必要なら、`Tax`（税率ごとの集計）をそのまま明細欄の表示に使う形に設計し直し、明細ごとの個別丸めは行わない。

7. **`RemoveLine`が出荷済み・返品済みの明細も無条件に削除できる**（SalesOrder.cs:74-78）
   - `ShippedQuantity`や`ReturnedQuantity`が既にある明細をリストから`Remove`すると、`Order.Amount`や明細一覧から消え、受注側の記録と既存の売上記録（`SalesRecordLine`はこの`SalesOrderLine`を参照している）が整合しなくなる。削除ではなく取消・状態で表す方針（業務ルール7章）にも反する。
   - 直し方: `ShippedQuantity > 0`または`ReturnedQuantity > 0`の明細は`RemoveLine`を拒否する。

### Important

8. **状態×操作の表が更新されていない**（docs/domain/business-rules.md 3章の表）
   - 新規操作（数量変更・明細削除・値引き）がどの状態で許されるかが文書化されておらず、`SalesOrderTests`も「取消以外なら全部OK」という誤った前提のテストしかない。Critical 3と合わせて表を追記・テストを拡充すべき。

9. **境界値テストの欠落**
   - `ApplyDiscount(0)`、`ApplyDiscount(100)`、`ApplyDiscount(負数/101以上)`、`ChangeQuantity`に0・負値・小数4桁、出荷済み明細への適用、のテストが無い。Critical 3〜6の修正後、誤った実装で落ちるテストを追加すること。

## 判定

**マージ不可。** 業務ルール文書が明示的に禁止する機能（受注全体への値引き）の無断実装、出荷済み明細の単価・数量変更による計上済み売上の不整合、明細ごとの税額丸めによる請求額の誤り、秘密情報のコミットという複数のCriticalが残っており、請求額・売上額に直接影響するため現状ではマージできない。