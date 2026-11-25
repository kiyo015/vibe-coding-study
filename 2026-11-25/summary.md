# Day57 学習記録（2026-11-25）— 繰越の請求と支払期限

基幹システム開発計画の43日目。段階3（販売の完結）の8日目で、2週目の3日目。

- **決めたこと:** 作業の前に本人に4件を聞き、AI レビューの指摘から1件を追加で聞いた。どれも推奨の案に決まった。
- **作ったこと:**
  - 請求額を繰越の形式（前回請求額 − 入金額 ＋ 今回売上 ＋ 消費税）にした。
  - 締めた時に、前受を未回収の請求書に充てる。
  - 得意先に回収条件（何か月後の何日）を持たせ、締めた時に支払期限を決める。
  - 得意先の画面で回収条件を選べる。請求書の画面に支払期限と「今回分の未回収」を出す。
- **確かめたこと:**
  - 10月〜2月の締めを API で通し、手で計算した値と比べた。入金の前後・一部入金・過入金・返品だけの月を含む。
  - 誤りを入れる対照実験は34通りで、32通りが落ちた。Day55 から持ち越していた T6（上限を請求額にする）も、繰越のある請求書で落ちた。

**完了条件「入金の前後・一部入金・過入金・返品だけの月で、請求額が手で計算した値と一致し、繰越の計算を外す対照実験で落ちる」は達成した。**
- AI レビューは2回で、最後はマージ可（Critical・Important なし）。費用は計 $1.6125。
- CI の1回目は、画面のテスト2件が落ちた。直した2回目は成功した。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 繰越の「入金額」の数え方 | **まだどの請求書にも数えていない入金。** 締め日以前の入金日の入金の合計から、前の請求書で数えた入金額の合計を引く |
| 前受で請求額が0円以下になる時 | **今回分が正なら作る**（支払い不要）。今回分が0円以下（返品だけの月）は作らず、売上を次に回す。返品の清算（返金）は作らない |
| 回収条件の形 | **何か月後の何日。** 回収月は当月〜3か月後、回収日は5〜25日・月末から選ぶ。土日祝の調整はしない。今ある得意先は翌月末 |
| 今日の範囲 | **繰越・前受・支払期限まで。** PR #29 の Minor 2件も直す |

なぜ入金日の期間で数えないのか。
- 締めた後に過去の日付で入金を登録すると、期間で数える方法ではどの請求書にも出ない。繰越が売掛金の残高とずれる。
- 「まだ数えていない入金」なら、遡って登録した入金も、締めと同時に登録された入金も、次の請求書で数えられる。

### 2. 繰越の請求（Domain）

- **`Invoice.Create` は、請求先のこれまでの請求書と入金を必ず受け取る。**
  - 前回請求額は、締め日の一番新しい請求書の請求額。
  - 入金額 ＝ 締め日以前の入金の合計 − 前に数えた入金額の合計。
  - 別の請求先の請求書や入金、今回以後の請求書は拒む。
- **前の請求書も入金も受け取らない入口（4引数）は消した。**
  - 最初は残していた。しかし、ユースケースが繰越を渡し忘れても通ってしまう。
  - そこで、テストの呼び出し25か所を機械的に直した。
- **締めない条件を「請求額が0円以下」から「今回分が0円以下」に変えた。**
- **`Receipt.AllocateAdvances`:** 締めた時に、前受を未回収の請求書に充てる。
  - 入金は入金日の古い順、請求書は締め日の古い順に充てる。入金の取消で未回収に戻った古い請求書があれば、そちらが先。
  - 取り消した入金は充てない。
- **回収条件と支払期限:**
  - 支払期限 ＝ 締め日の月から回収月だけ後の月の回収日。
  - 支店の売上でも、請求先の回収条件で決める。
  - 当月の回収は、回収日が締め日より後の時だけ選べる。

### 3. 手で計算した値と比べる（`CarryOverApiTests`）

| 締め | 前回請求額 | 入金額 | 繰越 | 今回分 | 請求額 | 何を確かめるか |
|---|---:|---:|---:|---:|---:|---|
| 10月 | 0 | 0 | 0 | 1,155 | 1,155 | 最初の請求書 |
| 11月 | 1,155 | 500 | 655 | 231 | 886 | 一部入金 |
| 12月 | 886 | 2,100 | −1,214 | 116 | −1,098 | 過入金、締めた後に遡って登録した 100円 |
| 1月 | — | — | — | −231 | 締めない | 返品だけの月 |
| 2月 | −1,098 | 0 | −1,098 | 2,079 | 981 | 1月に回した返品を含む、前受 1,098円を充てる |

繰越のある11月（請求額 886円）に 2,000円を充てても、充てるのは今回分の 231円まで。Day55 から持ち越していた T6 が、ここで確かめられた。

### 4. 表（マイグレーション `AddCollectionTerms`）

- `customers.collection_months`（既定値1）・`collection_day`（既定値31）と、検査制約 `ck_customers_collection` を足した。
- SQL を読んでから当てた。消す操作・型の変更・削除の連鎖は無い。開発用 DB の未適用は0件。
- **EF の既定値の罠を実測で見つけた。**
  - `HasDefaultValue(1)` だけだと、EF は int の 0（当月）を「値を入れていない」と見なして INSERT から外す。そのため DB の既定値1（翌月）で保存された。
  - 当月で登録した得意先が翌月で保存され、`MasterTests` が落ちて分かった。
  - `ValueGeneratedNever()` を付けて、値を常に送る形にした（対照実験 V26 で確かめた）。

### 5. RED を見てから作った

- Domain は型が無く、ビルドが通らなかった。
- 結合は列が無く、保存で落ちた。
- AI レビューの指摘から足した分も、Domain 2件・結合 1件の RED を見てから直した。

テストは Domain `CarryOverTests` 33件と、結合 `CarryOverApiTests` 5件を足した。マスタ・請求書の画面のテストにも足した。

### 6. 対照実験（34通り、32通り検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| V1 前回請求額を0にする | Domain 7件・結合 4件 |
| V2 前回を一番古い請求書にする | Domain 4件・結合 2件 |
| V3 前の請求書で数えた入金を引かない | Domain 3件・結合 2件 |
| V4 入金日の期間で数える（採らなかった案） | Domain 1件・結合 1件 |
| V5 締め日より後の入金日の入金も数える | Domain 1件 |
| V6 打ち消しの入金を数えない | Domain 1件・結合 1件 |
| V7 繰越の符号を誤る | Domain 5件・結合 3件 |
| V8 請求額が0円以下なら作らない（段階1のまま） | Domain 3件・結合 2件 |
| V9 今回分が0円以下でも作る | Domain 3件・結合 1件 |
| V10〜V12 別の請求先・今回以後の請求書と入金 | Domain 1件ずつ |
| V13 支払期限を決めない | Domain 1件・結合 4件 |
| V14 回収月を見ない | Domain 3件 |
| V15 回収日を月の末日に丸めない | **未検出**（誤りになっていない。下） |
| V16・V17 当月の回収日・回収月の範囲を見ない | Domain 2〜3件・結合 1件 |
| V18 取り消した入金の前受も充てる | Domain 1件 |
| V19 前受が正の条件を外す | **最初は未検出** → テストのデータを直して Domain 1件 |
| V20 前受を入金日でなく登録の順で充てる | 実験の前に弱さに気付いて直し、Domain 1件 |
| V21 前受を新しい請求書から充てる | Domain 1件 |
| V22〜V24 締めで前受を充てない・前の請求書や入金を渡さない | 結合 1〜4件 |
| V25 締めで別の請求先の入金も読む | **最初は未検出** → テストを足して結合 1件 |
| V26 `ValueGeneratedNever` を外す | 結合 1件 |
| V27 ユースケースの前回の締め日の検査を外す | 結合 2件 |
| V28〜V30 見出し・支払い不要・回収条件を送らない | 画面 1件ずつ |
| V31 入金の画面で、選び直した後の古い結果を入れる | **未検出**（テストが無い） |
| V32 上限を今回分でなく請求額にする（Day55 の T6） | Domain 3件・結合 1件 |
| V33 打ち消しを取り消した日で数える | Domain 2件・結合 1件 |
| V34 元の入金の読み込み漏れを見ない | Domain 1件 |

- **V15 は誤りになっていなかった。** 選べる回収日は5〜25日と月末だけで、2月に無い日（29〜30日）は選べない。そのため「月末だけ末日にする」式は、元の `Math.Min` と同じ結果になる。
- **V19 で、届かない条件が見つかった。**
  - 打ち消しの入金は負の額なので、前受は必ず0以下になり、「前受が正」の条件で外れる。打ち消しを別に除く条件は届かないので、消した。
  - その「前受が正」の条件を外しても、最初は落ちなかった。打ち消しの日付が遅く、充てる前に請求書が消し終わっていたため。打ち消しの日付を前受の入金より前にして落ちる形にした。
- **V25:** どのテストでも、締める時にほかの請求先の入金が無かった。別の会社の入金がある時に締めるテストを足した。

### 7. CI と AI レビュー（PR #30）

| 回 | 判定 | 費用 | 主な指摘と対応 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.7907 | **Important 1:** 締め日より後・締めの前に取り消した入金を、その請求書で入金済みと出す。本人に聞き「元の入金日で数える」に決めた（`Receipt.CountedOn`）。**Important 2:** V31 のテストが無い。テストのためだけの差し替えの口が要るので作らず、未検証と書いた。**Minor 4件:** 文書・文言・コメントで直した |
| 2回目 | マージ可 | $0.8218 | Minor 5件。Day58 へ回した（次回予告） |

CI の1回目は、画面のテスト2件が `A command is already in progress` で落ちた。
- 原因: 画面がまだ DB を読んでいる途中に、テストが同じ接続で DB を使った。
- 1件は今日触っていない単価の画面のテストだった。画面が読み終えるのを待ってから DB を使う形に、3か所直した。

### 確認

- テストは 682件 → **721件**（Domain 320・Web 47・アーキテクチャ 20・結合 322・端から端まで 12）。
- Release ビルドの警告は0件。

## 今日学んだこと

- **「入口を1つにする」は、渡し忘れを型で止める。**
  - 4引数の入口を残すと、ユースケースが繰越を渡し忘れても通ってしまう。
  - 呼び出し25か所を直す手間はあったが、機械的に直せた。
- **EF の既定値は、C# の既定値（0）と重なると黙って値を変える。** 当月（0）が翌月（1）で保存された。テストに「0を選ぶ」場面を入れていたので見つかった。
- **対照実験で未検出だった理由は3種類あった。**
  1. 誤りになっていない（V15）。選択肢が限られていて、どの式でも同じ結果になる。
  2. 届かない条件（V19）。ほかの条件が先に外すので、消してよい。
  3. データが誤りを見せない（V19 の2回目、V20、V25）。データを直せば見える。
- **AI レビューは、作った決まりが想定していない順序を見つけた。** 「締め日の後・締めの前に取り消す」は、決定の文言どおりに動いても業務として困る。決まりの穴なので、本人に聞いて決め直した。

## つまずき

- **ヒアドキュメントでスクリプトが壊れた（3回目）**
  - 症状: Domain を直すスクリプトが `unexpected EOF` で止まった。
  - 原因: シェルのヒアドキュメントで、引用符の入ったスクリプトを書いた。Day53・Day55 と同じ失敗。
  - 対策: Write でファイルに書いてから流した。
- **乱数のテストが、締め日に `DateOnly.MaxValue` を使っていた**
  - 症状: 支払期限の計算（翌月）があふれた。
  - 対策: 締め日を 9999-01-31 にした。
- **sed で対照実験の名前が入れ替わった**
  - 症状: V18 と V19 の中身が逆になった。
  - 対策: 結果を読む前に気付き、ファイルを直してから流し直した。
- **全体を流した時に `ApiAuthenticationTests` が1回だけ落ちた**
  - 単独で流すと通った。今日は触っていない所なので、CI で出るかを見る。

## 気づき・発見

- **前日の AI レビューの Minor（「今回分の未回収」の見出し）は、繰越を作る日に直して正解だった。** 11月の請求書は請求額 886円で、未回収は今回分の 231円の分だけ。見出しが「未回収」のままだと、「886 − 231 ＝ 入金済み」と読まれる。
- **ガードの実効性テストを、ログインし直してから流し直した。** 7セルすべて合格した（$0.1580）。前日の締めの時は、CLI のログインが切れていて判定できなかった。

## 成果物

**sales-core**（タグ `day57`）
- [src/SalesCore.Domain/Invoice.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Domain/Invoice.cs)
- [src/SalesCore.Domain/Receipt.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Domain/Receipt.cs)
- [src/SalesCore.Domain/Customer.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Domain/Customer.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Application/InvoiceUseCases.cs)
- [src/SalesCore.Application/MasterContracts.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Application/MasterContracts.cs)
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261125043745_AddCollectionTerms.cs](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Infrastructure/Persistence/Migrations/20261125043745_AddCollectionTerms.cs)（新規）
- [src/SalesCore.Web/Components/Pages/Masters/Customers.razor](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Web/Components/Pages/Masters/Customers.razor)
- [src/SalesCore.Web/Components/Pages/Invoices/InvoiceDetail.razor](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Web/Components/Pages/Invoices/InvoiceDetail.razor)
- [src/SalesCore.Web/Components/Pages/Receipts/NewReceipt.razor](https://github.com/kiyo015/sales-core/blob/day57/src/SalesCore.Web/Components/Pages/Receipts/NewReceipt.razor)
- [tests/SalesCore.Domain.Tests/CarryOverTests.cs](https://github.com/kiyo015/sales-core/blob/day57/tests/SalesCore.Domain.Tests/CarryOverTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/CarryOverApiTests.cs](https://github.com/kiyo015/sales-core/blob/day57/tests/SalesCore.Integration.Tests/CarryOverApiTests.cs)（新規）
- [docs/migrations/2026-11-25-AddCollectionTerms.sql](https://github.com/kiyo015/sales-core/blob/day57/docs/migrations/2026-11-25-AddCollectionTerms.sql)（新規）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day57/docs/domain/business-rules.md)
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day57/docs/domain/er-diagram.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day57/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-25.md](https://github.com/kiyo015/sales-core/blob/day57/docs/decisions/2026-11-25.md)（新規。本人の決定5件）
- [kiyo015/sales-core#30](https://github.com/kiyo015/sales-core/pull/30)

**Study**（タグ `day57`）
- [2026-11-25/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day57/2026-11-25/summary.md)
- [2026-11-25/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day57/2026-11-25/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day57/study_plan_next_month.md)

## 次回予告

**Day58 — 月次締めと売掛金の残高。** 年月ごとに締め、請求先 × 年月の売掛金の残高（期首 ＋ 売上 − 入金 ＝ 期末）を確定する。締めた月の日付の売上・入金を止める。

- **作業の前に本人に聞く:** 最初に締められる月、残高の「売上」は税込か、未請求の売上の税の扱い、月次締めの取消を作るか。
- **持ち越し（PR #30 の AIレビュー2回目の Minor）:**
  1. 請求書の取消を作る時に、取り消した請求書を前回請求額と「数えた入金額」から外す（業務ルール集「9.」に書き足す）。
  2. 締め日より後の入金日の入金は入金額に数えないが、前受として締めた請求書に充てる。「入金額0・今回分の未回収0」の請求書ができることを業務ルール集に例として書き、テストを足す。
  3. V31（入金の画面で選び直した後の古い結果）のテスト。
  4. `MasterTests` の `ThrowsAnyAsync<Exception>` を `PostgresException` に絞る。
  5. 同じ請求先の締めが同時に走った時の結合テスト（月次締めの前に）。
- **ほかの持ち越し:**
  - V31（入金の画面で、選び直した後の古い結果）のテスト。
  - 締めと入金の登録・取消が同時の時の 409（版数で止まるはずだが、締めについては試していない）。
  - `ApiAuthenticationTests` の一時的な失敗（見張る）。
- **これまでの持ち越し:**
  - PR #27 の Minor 4件、PR #16 の残り、PR #19 の Minor 3件。
  - 一覧のページ分け、Swagger の Bearer の定義、`Routes.razor` の「権限がありません」のテスト。
  - 入金の画面の型の流用、請求書の一覧がエンティティを丸ごと読む。
  - 出荷・返品の数量の桁、DB の接続の時間切れ（見張る）。
  - ガードの実効性テストで、認証切れを「判定できず」と区別するか。
