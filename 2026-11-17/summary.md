# Day52 学習記録（2026-11-17）— 見積（Domain と永続化）

基幹システム開発計画の38日目で、段階3（販売の完結）の3日目。

- **決めたこと:** 作業の前に本人に7件を聞いた。見積の状態ごとの操作と単価・税率が5件、PR #24 から持ち越した単価の論点が2件。作業の途中で、AI レビューの指摘から1件（見積の明細を直せる役割）を聞いた。8件とも推奨の案に決まった。
- **作ったこと:** 見積と見積明細の Domain と DB（`quotations`・`quotation_lines`）。状態は作成中 → 提出済 → 受注済／失注。金額と税は受注と同じ計算。
- **直したこと:** 明細の数量・単価・明細金額の桁を Domain で止める（Day42 からの持ち越し）。DB の桁あふれは入力の誤り（400）として扱わない。
- **片付けたこと:** PR #24 の Minor 3件（単価の初日が日付の最小値だと 500、同時の改定のテスト、単価の画面の知らせがほかの管理者の登録を拾う）。

**完了条件「見積の状態×操作の全組み合わせと金額がテストで固定され、マイグレーションがテスト用DBで確かめてある」は達成した。** CI は成功した。AI レビューは3回で、2回目からマージ可（Critical・Important なし）。

## 今日行った処理

### 1. 作業の前に、見積の決まりを本人に聞いた

| 問い | 決定 |
|---|---|
| 受注にできる見積 | **提出済だけ**（作成中は先に提出する） |
| 提出済の見積を直せるか | **直せない。** 新しい見積を作り、前の見積は失注にする（直せるのは作成中だけ） |
| 失注にできる見積 | **作成中と提出済** |
| 見積の単価 | **見積日の得意先別単価**（明細で指定 → 見積日の得意先別単価 → 標準単価。受注と同じ順） |
| 受注にする時の税率 | **受注日の税率で決め直す**（単価は見積のまま） |
| 過去の日付を初日にした単価の改定（PR #24 の Minor） | **許す**（今のまま。登録済みの受注は単価を写しているので変わらない） |
| 手で直した単価の後で得意先・受注日を変えた時（PR #24 の Minor） | **入れ直して知らせる**（Day54 に見積の画面と合わせて作る） |
| 見積の明細を直せる役割（AI レビュー1回目の指摘から） | **営業と管理者**。役割の表の行を「見積の登録・変更・提出・失注・受注化」にした |

決定は業務ルール集「3.」に書き、見積の状態×操作の表（4状態 × 4操作の16マス）を足した。段階3の設計の決定の表と、完了の確かめ方の表の行も埋めた。

明細を消す操作は作らなかった。物理削除しない決まりがあり、要らない明細があれば新しい見積を作ればよい。これは私の判断で、業務ルール集に書いた。

### 2. 見積を作った

| 層 | 作ったもの |
|---|---|
| Domain | `Quotation`・`QuotationLine`・`QuotationStatus`・`QuotationStatusRules`。有効期限は見積日より前にできない。受注にできるのは有効期限の当日まで（「日本時間の今日」は呼ぶ側が決める） |
| 金額 | 受注と同じ計算。明細金額は単価 × 数量の四捨五入、税は税率ごとに1回だけ四捨五入する |
| DB | `quotations`・`quotation_lines`。番号は `QT-000001`（シーケンス `quotation_number_seq`）。検査制約 `ck_quotations_valid_period`（有効期限 ≥ 見積日）。外部キーはすべて RESTRICT |
| 同時の更新 | 版数（楽観ロック）。明細を直したら見積の版数も上げる（受注で使っていた仕組みを、受注と見積の両方に使える形にした） |

**状態×操作の表**（○ができる、× は拒む。拒んだ時は状態も明細も変えない）

| 状態 | 直す | 提出 | 失注 | 受注 |
|---|---|---|---|---|
| 作成中 | ○ | ○ | ○ | × |
| 提出済 | × | × | ○ | ○（有効期限の当日まで） |
| 受注済 | × | × | × | × |
| 失注 | × | × | × | × |

- 16マスすべてを Domain のテスト1つ（`StatusOperations` の16件）で固定した。
- **日付の境目:** 有効期限の判定は、見積日・有効期限の当日・翌日で確かめた。有効期限が見積日と同じ日の見積も作れることを確かめた。
- **税:** 105円 × 3（10%）と 100円（8%）で、税は 32円と 8円になる。明細ごとに丸めると 33円になるので、計算の違いがテストで分かる。
- **マイグレーション:** 先に ER 図を直してから作った。SQL を `docs/migrations/2026-11-17-AddQuotations.sql` に出して読んだ。データを消す操作・型の変更・削除の連鎖は無い。数の型は規定どおり。Down は表を消してからシーケンスを消す。テスト用 DB の結合テストで確かめ、開発用 DB に当てた（未適用0件）。
- **保存して読み直す:** 金額 365円・税 36円・番号の形、直した明細と提出済の状態が残ることを確かめた。

### 3. 明細の桁を Domain で止めた（Day42 からの持ち越し）

DB の列は数量 `numeric(15,3)`・単価 `numeric(15,2)` なので、整数部は数量 12桁・単価 13桁まで入る。これまでは Domain で桁を見ていなかった。超えた値は DB の桁あふれ（22003）になり、`OperationError` がそれを入力の誤り（400）に変えていた。

- `SalesOrderLine.EnsureLine` を作った。受注明細と見積明細で共通に使う。数量は整数部12桁まで、単価は整数部13桁まで、明細金額は15桁まで。
- 数量の整数部の確かめは、小数の桁の確かめ（×1000）より前に置く。decimal の最大値を入れると、×1000 で計算があふれて別の例外になるため。
- DB の桁あふれ（22003）は、`OperationError` の 400 から外した。入力は Domain が先に止める。それでも DB で桁があふれるのは集計など入力でない値で、利用者の誤りではないため。
- 受注の API の桁のテストは、Domain が止める形で 400 のまま通る。

### 4. PR #24 の Minor を片付けた

- **単価の初日に `0001-01-01` を入れると 500 になった。** 前の単価を閉じる日（初日の前日）を、閉じる単価がある時だけ計算するようにした。
- **2人が同じ無期限の単価を同時に改定するテストを足した。** 後の方は 409 になる。
- **単価の画面の「閉じた・続けた単価」の知らせ。** これまでは、登録の前後の一覧の差から作っていた。ユースケースが登録の結果（`CustomerPriceRegistration`）を返す形にしたので、ほかの管理者の登録を拾わない。

### 5. 対照実験（17通り、すべて検出）

誤りを1つずつ入れて、テストが落ちることを確かめた。入れた誤りは元に戻してある。

| 番号 | 入れた誤り | 落ちたテスト |
|---|---|---|
| Q1 | 提出済も直せる | Domain 1件 |
| Q2 | 提出済をもう一度提出できる | Domain 1件 |
| Q3 | 作成中は失注にできない | Domain 5件 |
| Q4 | 作成中から受注にできる | Domain 1件 |
| Q5 | 有効期限の当日を含めない | Domain 1件 |
| Q6 | 有効期限を見ない | Domain 1件 |
| Q7 | 有効期限が見積日と同じ日を拒む | Domain 1件 |
| Q8 | 税を明細の税率で分けない | Domain 1件 |
| Q9 | 別の見積の明細も直せる | Domain 1件 |
| Q10 | 直す時に数量・単価の決まりを見ない | Domain 4件 |
| Q11 | DB の有効期限の制約が無い | 結合 1件 |
| Q12 | 版数で同時の更新を止めない | 結合 1件 |
| Q13 | 数量の整数部の桁を見ない | 結合 1件（受注の API が 500） |
| Q14 | 明細金額の桁を見ない | Domain 1件 |
| Q15 | 明細を直しても見積の版数を上げない | 結合 1件 |
| Q16 | 数量の桁の確かめを、小数の確かめの後にする | Domain 2件 |
| Q17 | 役割の表の見積の行に「変更」が無い | `PermissionTests` 1件 |

**Q12 で分かったこと:** 版数を外しても、得意先別単価の同時の改定のテストは通った。後の方は排他制約が止めていた。単価の同時の改定は、版数と排他制約の二重で守られている。

### 6. CI と AI レビュー（PR #25）

| 回 | 判定 | 費用 | 主な指摘 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.6285 | 明細を直すのと提出が同時だと両方通る（Important）、役割の表に見積の明細を直す行が無い（Important） |
| 2回目 | マージ可 | $0.6018 | Minor 4件（Day53 へ） |
| 3回目 | マージ可 | $0.6243 | 決定の記録を足したコミット。業務ルール集に古い一文「受注にする前に見積を直す」が残り、今日の決定と食い違う（Minor。Day53 へ） |

合計 $1.8546。

1回目の Important の1件目は、更新する行が別々（`quotation_lines` と `quotations`）なので、見積の版数で止まらなかった。テストで再現し、指摘どおり両方通ることを見てから（RED）、明細を直したら見積の版数も上げる形にした。

### 確認

- `dotnet test`: 539件 → **585件**（Domain 259・Web 47・アーキテクチャ 20・結合 248・端から端まで 11）。
- Release ビルドの警告は0件。
- CI（`build-and-test`・`ai-review`）は全回成功。

## 今日学んだこと

- **「親の版数」は、子の行だけを更新すると上がらない。** 明細を直すのは `quotation_lines` の UPDATE、提出は `quotations` の UPDATE で、行が違うので楽観ロックがぶつからない。集約の中の更新は、子を変えたら親の版数も上げる約束にしないと、「提出済の見積の明細が変わる」が起きる。受注で作ってあった仕組みを、見積を足した時に広げ忘れていた。
- **DB の制約は、Domain の検査を外しても残る第2の柵になる。** Q12 で版数を外しても、単価の同時の改定は排他制約が止めた。逆に言えば、そのテストは版数を確かめたことにならない。何がテストを合格させているかは、対照実験で1つずつ外すまで分からない。
- **桁の検査は、順番も決まりのうち。** 小数の桁の確かめ（×1000）を先にすると、decimal の最大値で計算があふれ、桁の誤りでなく別の例外になる。1回目は 10^25 で確かめていて、×1000 してもあふれないので、順番の誤りを検出できなかった（AI レビュー1回目の Minor）。
- **「入力の誤り」と「システムの誤り」を混ぜない。** DB の桁あふれを一律 400 にすると、集計のあふれまで利用者のせいになる。入力は Domain で先に止め、DB まで来た桁あふれは 500 として気付けるようにした。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 対照実験のスクリプトが構文エラーになった | 置き換える文字列に入れた `\n` が、本物の改行になった | 置き換える文字列を `'//'` に変えた |
| 「計算があふれない」のテストが、誤りを入れても合格した | 数量 10^25 は ×1000 してもあふれなかった | decimal の最大値にし、単価の側の行も足した |

## 成果物

**sales-core**（タグ `day52`）
- [src/SalesCore.Domain/Quotation.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Domain/Quotation.cs)（新規）
- [src/SalesCore.Domain/SalesOrderLine.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Domain/SalesOrderLine.cs)（`EnsureLine`）
- [src/SalesCore.Domain/CustomerPrice.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Domain/CustomerPrice.cs)
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs)（`TouchRoots`）
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261117040837_AddQuotations.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Infrastructure/Persistence/Migrations/20261117040837_AddQuotations.cs)（新規）
- [docs/migrations/2026-11-17-AddQuotations.sql](https://github.com/kiyo015/sales-core/blob/day52/docs/migrations/2026-11-17-AddQuotations.sql)（新規）
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Application/OperationError.cs)
- [src/SalesCore.Application/MasterUseCases.cs](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Application/MasterUseCases.cs)
- [src/SalesCore.Web/Components/Pages/Masters/CustomerPrices.razor](https://github.com/kiyo015/sales-core/blob/day52/src/SalesCore.Web/Components/Pages/Masters/CustomerPrices.razor)
- [tests/SalesCore.Domain.Tests/QuotationTests.cs](https://github.com/kiyo015/sales-core/blob/day52/tests/SalesCore.Domain.Tests/QuotationTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/QuotationPersistenceTests.cs](https://github.com/kiyo015/sales-core/blob/day52/tests/SalesCore.Integration.Tests/QuotationPersistenceTests.cs)（新規）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day52/docs/domain/business-rules.md)
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day52/docs/domain/er-diagram.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day52/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-17.md](https://github.com/kiyo015/sales-core/blob/day52/docs/decisions/2026-11-17.md)（新規。本人の決定8件）
- [kiyo015/sales-core#25](https://github.com/kiyo015/sales-core/pull/25)

**Study**（タグ `day52`）
- [2026-11-17/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day52/2026-11-17/summary.md)
- [2026-11-17/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day52/2026-11-17/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day52/study_plan_next_month.md)

## 次回予告

**Day53 — 見積から受注**
- 見積の全明細を1つの受注に写す。`sales_orders.quotation_id` に元の見積を残し、見積は受注済になる。
- 同じ見積から2回受注できない（Domain の状態と DB の一意の制約）。
- 見積の登録・提出・失注・受注化の API と、入口の権限の検査。
- 完了条件: 見積から受注が API で作れ、期限切れ・受注済・同時の受注化が止まることを対照実験付きで確かめてある。

**持ち越し（Day53 の先頭に書いた）**
- **最初に直す:** 業務ルール集の古い一文「数量を変える時は、受注にする前に見積を直す」が、今日の決定と食い違う（AI レビュー3回目の Minor）。
- PR #25 の AI レビュー2回目の Minor 4件（明細金額のあふれのエラーの欄、上限ちょうどの値のテスト、見積の作成で得意先が空・同じ明細を2つの見積に渡せる、新しい数値の入力には桁のテストを足す決まり）。
- 見積明細の商品は、今はシャドウプロパティ。受注にする時に Domain が商品を持つ形にする。
- 見積の単価を見積日の得意先別単価で決めること、有効期限の判定に使う「日本時間の今日」（どちらも見積を登録・受注にするユースケースで作る）。
- 受注にする時の検査（見積の後にマスタが無効になった、受注日の税率が無い）を、受注の登録と同じにする。
- `Routes.razor` の「権限がありません」の bUnit テスト（役割を指定した画面を作る日まで）。DB の接続の時間切れ（見張る）。
