# Day58 学習記録（2026-11-26）— 月次締めと売掛金の残高

基幹システム開発計画の44日目。段階3（販売の完結）の9日目で、2週目の4日目。

- **決めたこと:** 作業の前に本人に4件を聞いた。どれも推奨の案に決まった。聞かずに進めることも3つ、質問の前に伝えた。
- **作ったこと:**
  - 年月ごとの月次締め。請求先ごとの売掛金の残高（期首 ＋ 売上 ＋ 消費税 − 入金 ＝ 期末）を確定する。
  - 締めた月の日付の出荷の確定・入金・請求の締めを止める。止める所は3つの層にした（Domain の判断・DB のトリガー・表のロック）。
  - PR #30 の Minor 4件。
- **確かめたこと:**
  - Day57 の10月〜2月を月次締めし、5か月とも手で計算した残高と一致した。履歴から計算し直した値とも一致した。
  - 誤りを入れる対照実験は40通りで、最終的にすべて落ちた。最初の39通りでは36通りだった。

**完了条件「月次締めで残高が確定し、締めた月の日付の売上・入金が止まることを対照実験付きで確かめてある」は達成した。**
- AI レビューは3回で、最後はマージ可（Critical・Important なし）。費用は計 $2.4368。
- CI は3回とも成功した。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 最初に締められる月 | **取引（売上・入金）の一番古い月。** 期首は0 |
| 残高の「売上」に消費税をどう入れるか | **税は請求書の締め日の月。** 売上は売上日の月に税抜で入れる。まだ請求していない売上は税抜のまま残高に入る |
| その月の締め日の請求書を締めていない請求先 | **月次締めを止める。** 理由に請求先と締め日を出す。今回分が0円以下で次に回す売上は止めない |
| 今日の範囲 | **月次締め ＋ PR #30 の Minor 4件。** 入金の画面の V31 のテストは Day59 |

なぜ税を締め日の月にしたのか。
- 消費税は請求書ごと・税率ごとに1回だけ丸める（Day47 の決定）。まだ請求していない売上の税額は、まだ決まっていない。
- 売上1件ごとに税を出して足すと、請求書の税額と1円ずれることがある。

質問の前に、次の3つは聞かずに進めると伝えた（異論なし）。
- 締めた月の判定に使う日付は、売上日（出荷を確定した日・返品日）・入金日・請求書の締め日。
- 締められるのは終わった月だけ（月の末日が日本時間の今日より前）。
- 月次締めの取消は作らない。誤りは翌月の日付で赤黒にして直す（2026-11-12 の決定）。

### 2. 月次締めの判断（Domain `MonthlyClosing`）

- **`MonthlyClosing.Close` が、締めるかどうかと残高を決める。** 次の順に確かめる。
  1. 年月の範囲。
  2. 終わった月か。
  3. 前の月を締めてあるか、同じ月を二度締めていないか。最初の月次締めなら、取引の一番古い月か。
  4. 締め忘れの請求先が無いか。
- **締め忘れの検査（`EnsureBilled`）:** 未請求の売上を請求先ごとにまとめ、その月の締め日を求める。次の3つがそろった時に止める。
  - 締め日以前の未請求の売上がある。
  - その請求先に、締め日がその日以後の請求書が無い。
  - 今回分（税込）が正。
- **残高:** 請求先ごとに、期首 ＋ 売上 ＋ 消費税 − 入金 ＝ 期末。
  - 打ち消しの入金は、取り消した日の月に負の額で入る。
  - すべてが0の請求先の行は作らない。
- **`MonthlyClosing.EnsureOpen`:** 日付が締めた月の末日以前なら止める。理由は「締めた月の誤りは翌月の日付で赤黒にして直す」。

### 3. 締めた月の日付を止める所（3つの層）

| 層 | 何を止めるか | なぜ要るか |
|---|---|---|
| Domain `EnsureOpen` | 出荷の確定・入金の登録・請求の締めの3つのユースケースが呼ぶ | 理由のある 409 を返す |
| DB のトリガー `reject_closed_month` | 売上・入金・請求書の INSERT | 返品のように操作がまだ無い経路と、確かめた後に月次締めが先に済んだ場面 |
| 表のロック | 月次締めが読んでから保存するまでの書き込み | 月次締めが読んだ後に書かれた売上は、トリガーでは止まらない（まだ締めていない） |

- 月次締めは、`monthly_closings` を EXCLUSIVE、売上・入金・請求書を SHARE でロックしてから読む。
- トリガーの例外（検査制約の名前 `ck_closed_month`）とデッドロック（40P01）は 409 にした。
- **Domain の各操作の引数に「締めた月」を渡す形にはしなかった。** 呼び出しが約90か所あり、書く経路はユースケースだけなので、テストと対照実験で止める。

### 4. 表（マイグレーション `AddMonthlyClosings`）

- `monthly_closings`（月は1日で持つ検査制約 `ck_monthly_closings_first_day`、月の一意インデックス）。
- `receivable_balances`（期末の式を DB でも止める検査制約 `ck_receivable_balances_closing`、月次締め × 請求先の一意インデックス）。
- トリガー関数 `reject_closed_month`。日付の列は `to_jsonb(NEW) ->> TG_ARGV[0]` で読み、3つの表で1つの関数を使う。
- SQL を読んでから当てた。消す操作・型の変更・削除の連鎖は無い。開発用 DB の未適用は0件。

### 5. 手で計算した残高と比べる（結合 `MonthlyClosingTests`）

| 月 | 期首 | 売上 | 消費税 | 入金 | 期末 |
|---|---:|---:|---:|---:|---:|
| 10月 | 0 | 1,050 | 105 | 0 | 1,155 |
| 11月 | 1,155 | 210 | 21 | 600 | 786 |
| 12月 | 786 | 105 | 11 | 2,000 | −1,098 |
| 1月 | −1,098 | −210 | 0 | 0 | −1,308 |
| 2月 | −1,308 | 2,100 | 189 | 0 | 981 |

- 11月の期末は請求額（886円）より100円少ない。請求の締めの後に 11/28 付けで登録した100円の入金が、残高には入り、請求書では12月に数えられるため。
- 1月は返品だけの月なので請求書を作らず、消費税はまだ0円。
- 履歴から計算し直しても一致した。すべての売上 3,255 ＋ すべての税 326 − すべての入金 2,600 ＝ 981。
- 境目も確かめた。末日と翌月1日、日本時間の 12/1 0時（UTC ではまだ 11/30）、締めた後の 11/30 の出荷・入金・締めは止まり 12/1 は通る。

### 6. PR #30 の Minor 4件

1. 業務ルール集「9.」の請求書の取消の項に、取り消した請求書を前回請求額と「数えた入金額」から外すことを書き足した。
2. 締め日より後の入金日の前受は、入金額に数えないが締めた請求書に充てる。「入金額0・今回分の未回収0」の請求書ができる例を業務ルール集に書き、Domain のテストを足した。
3. `MasterTests` の例外の型を `PostgresException` に絞り、制約の名前も確かめる形にした。
4. 同じ請求先の締めが同時に走った時、後の方が売上の版数で止まり 409 になる結合テストを足した。

### 7. RED を見てから作った

- Domain・結合ともに、型が無くビルドが通らない状態から。
- AI レビューの指摘から足したテストも、誤りを入れて通ってしまうことを先に確かめてから足した（U10・W19）。

### 8. 対照実験（40通り、すべて検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| W1 売上を月で絞らない | Domain 3件 |
| W2・W3 月の末日を含めない・前の月の末日も含める | Domain 2〜3件・結合 1件 |
| W4 消費税を入れない | Domain 5件・結合 1件 |
| W5 入金を元の入金日の月で数える | Domain 1件 |
| W6 期首を見ない | Domain 5件・結合 1件 |
| W7・W8 0の行も作る・期首だけの請求先の行を作らない | Domain 1件ずつ |
| W9 今日が末日でも締められる | Domain 1件・結合 1件 |
| W10〜W12 前の月を飛ばす・同じ月を二度・最初の月を見ない | Domain 1件ずつ |
| W13〜W17 締め忘れの検査の各条件を外す・変える | Domain 1〜4件・結合 0〜1件 |
| W18 締めた月の末日を通す | Domain 1件・結合 1件 |
| W19 締め忘れで請求書の締め日を見ない | **最初は未検出** → AI レビュー2回目で Domain のテストを足して検出 |
| U1〜U3 出荷の確定・入金・請求の締めで月次締めを見ない | 結合 1件ずつ |
| U4〜U9 前の月の選び方・残高の読み込み・今日を UTC に・最初の月の入金・前の月の未請求 | 結合 1〜2件 |
| U10 表のロックを外す | **最初は未検出** → AI レビュー1回目で別の接続のテストを足して検出 |
| U11・U12 入金・売上を月の1日から読まない | **最初は未検出** → テストのデータを 11/1 にして検出 |
| U13・U14 権限の表・入口の検査 | 結合 1件ずつ |
| U15 トリガーの例外を 409 にしない | 結合 2件 |
| T1〜T3 入金・売上のトリガーを外す、トリガーで末日を通す | 結合 1件ずつ |
| T4 残高の検査制約を外す | 結合 1件 |
| T5 締めの同時実行のテストで、割り込みを別の請求先にする | 結合 1件 |
| T6 締め日より後の入金日の前受を充てない | Domain 2件 |

**最初に未検出だった4通りは、理由が3種類あった。**
- **テストのデータに境目が無かった（U11・U12）:** 月の1日の取引がデータに無かった。11月の出荷と入金を 11/1 にして検出した。
- **1つの接続の中ではテストが作れなかった（U10）:** テストは全部1つのトランザクションの中で動く。自分の接続とトランザクションで月次締めし（コミットしない）、保存の直前に別の接続から `NOWAIT` でロックを取りに行き、売上・入金・請求書・月次締めの4つとも 55P03 で待たされることを確かめた。
- **止める側のテストが偏っていた（W19）:** 締め忘れで止める側のテストが、請求書が1枚も無い請求先だけだった。「10月は締めて11月を忘れた」場面のテストで検出した。

### 9. CI と AI レビュー（PR #31）

| 回 | 判定 | 費用 | 主な指摘と対応 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.7925 | **Important:** 表のロックのテストが無い → 別の接続で確かめるテストを足し U10 を検出。**Minor:** デッドロックが 500 → 409 に。`docs/decisions/2026-11-25.md` の書き換え → 元に戻した。締め忘れの検査の限界 → 業務ルール集に。誤った年月でもロックする → 直さない（年月の検査は Domain が決める。ロックは一瞬） |
| 2回目 | 修正後マージ可 | $0.7947 | **Important:** 先月は締めて今月を忘れた場面のテストが無い → W19 が通ることを確かめてからテストを足して検出。**Minor:** 最初の月に請求書の締め日を見ない理由をコメントに、ロックは更新も待たせることを業務ルール集に |
| 3回目 | マージ可 | $0.8496 | Minor 3件。前の月の残高の読み込み漏れを Domain で気づけない、2月の月末締めのテスト、PR 本文の件数（直し済み）。前の2件は Day59 へ |

### 確認

- テストは 721件 → **746件**（Domain 335・Web 47・アーキテクチャ 20・結合 332・端から端まで 12）。
- Release ビルドの警告は0件。

## 今日学んだこと

- **止める所は、届かない経路で分けて重ねる。**
  - Domain の判断は理由のある 409 を返すが、操作の無い経路（返品）や、確かめた後に月次締めが先に済んだ場面は止められない。そこを DB のトリガーが止める。
  - トリガーは「月次締めが読んだ後に書かれた売上」を止められない。その時点ではまだ締めていないから。そこを表のロックが止める。
  - 3つとも同じ境界（締めた月の末日まで）を使う。
- **1つのトランザクションで動くテストでも、ロックは別の接続から確かめられる。** 待たずに取りに行く（`NOWAIT`）と、待たされる代わりにすぐ 55P03 で失敗する。コミットしないので後片付けも要らない。
- **対照実験で未検出だった理由は、Day57 と違う3種類だった。** データに境目が無い、1つの接続では作れない、止める側のテストの場面が偏っている。どれもテストを足せば見えた。
- **残高と請求額は、同じ入金でも数える月が違う。** 請求の締めの後に登録した入金は、残高ではその月に、請求書では次の月に入る。11月で100円ずれるのは誤りではない。

## つまずき

- **Domain のテストで、期首が手で計算した値と合わなかった**
  - 原因: 前の月の月次締めを作る時に、その月の入金を渡し忘れていた（テストの誤り。実装は正しかった）。
  - 対策: テストを直した。
- **`MigrationTests` が落ちた**
  - 原因: 表の一覧の期待に、新しい2つの表が入っていなかった。
  - 対策: 期待に足した。
- **インラインの Python と、締めの HTML を書くヒアドキュメントで、引用符が壊れた**
  - 対策: Write でファイルに書いてから流した（Day53・Day55・Day57 と同じ種類の失敗で4回目）。
- **コミットメッセージの件名に BOM が入った**
  - 原因: PowerShell の `Set-Content` でメッセージのファイルを書いた。ヒアドキュメントで `git commit -F -` に流す方法も失敗していた。
  - 対策: 以後は Write でファイルに書いて `git commit -F` に渡した。スカッシュマージでは PR のタイトルが件名になるので、そのままにした。
- **会話を要約する前のフックが、決定の記録を書き換えた（2回）**
  - 1回目は `docs/decisions/2026-11-25.md`（AI レビュー1回目の Minor）。元に戻した。
  - 2回目は締めの時の `docs/decisions/2026-11-26.md`。自動の書き出しの版で、「聞かずに進めた3つ」の注記が消えている。作業ツリーに残し、Day59 で扱いを決める。

## 気づき・発見

- **締め忘れの検査には限界がある。** 次の締め日の請求書を先に締めると、その請求書の締め日が「締め日以後の請求書」に当たり、止められない。業務ルール集に限界として書いた。
- **月次締めのロックは、書く側も待たせる。** 月次締めの間は出荷の確定・入金・請求の締めが待つ。読み終えるまでの一瞬なので、業務ルール集に書くだけにした。

## 成果物

**sales-core**（タグ `day58`）
- [src/SalesCore.Domain/MonthlyClosing.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Domain/MonthlyClosing.cs)（新規）
- [src/SalesCore.Application/MonthlyClosingUseCases.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/MonthlyClosingUseCases.cs)（新規）
- [src/SalesCore.Application/MonthlyClosingContracts.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/MonthlyClosingContracts.cs)（新規）
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/OperationError.cs)
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/Permissions.cs)
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/SalesOrderUseCases.cs)
- [src/SalesCore.Application/ReceiptUseCases.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/ReceiptUseCases.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Application/InvoiceUseCases.cs)
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261126035832_AddMonthlyClosings.cs](https://github.com/kiyo015/sales-core/blob/day58/src/SalesCore.Infrastructure/Persistence/Migrations/20261126035832_AddMonthlyClosings.cs)（新規）
- [tests/SalesCore.Domain.Tests/MonthlyClosingTests.cs](https://github.com/kiyo015/sales-core/blob/day58/tests/SalesCore.Domain.Tests/MonthlyClosingTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/MonthlyClosingTests.cs](https://github.com/kiyo015/sales-core/blob/day58/tests/SalesCore.Integration.Tests/MonthlyClosingTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/BeforeSave.cs](https://github.com/kiyo015/sales-core/blob/day58/tests/SalesCore.Integration.Tests/BeforeSave.cs)（新規）
- [tests/SalesCore.Integration.Tests/CarryOverApiTests.cs](https://github.com/kiyo015/sales-core/blob/day58/tests/SalesCore.Integration.Tests/CarryOverApiTests.cs)
- [docs/migrations/2026-11-26-AddMonthlyClosings.sql](https://github.com/kiyo015/sales-core/blob/day58/docs/migrations/2026-11-26-AddMonthlyClosings.sql)（新規）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day58/docs/domain/business-rules.md)
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day58/docs/domain/er-diagram.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day58/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-26.md](https://github.com/kiyo015/sales-core/blob/day58/docs/decisions/2026-11-26.md)（新規。本人の決定4件）
- [kiyo015/sales-core#31](https://github.com/kiyo015/sales-core/pull/31)

**Study**（タグ `day58`）
- [2026-11-26/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day58/2026-11-26/summary.md)
- [2026-11-26/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day58/2026-11-26/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day58/study_plan_next_month.md)

## 次回予告

**Day59 — 月次締めの画面と売掛金の一覧、2週目の振り返り。** 経理が画面と API で月次締めし、請求先ごと・月ごとの残高の一覧を見る。2週目を振り返り、未完了を3週目の先頭に書き写す。

- **持ち越し（PR #31 の AI レビュー3回目の Minor）:**
  1. 前の月の残高を読み込まずに渡すと、期首が黙って0になる（Domain では気づけない。今は結合テストと対照実験 U6 で守っている）。
  2. 2月の月末締め（うるう年と平年）で、締め忘れを止める Domain のテスト。
- **持ち越し（PR #30 の Minor の残り）:** V31（入金の画面で、選び直した後の古い結果）のテスト。
- **決定の記録:** 作業ツリーに残した `docs/decisions/2026-11-26.md` の自動の書き出しの版（「聞かずに進めた3つ」の注記が消えた）を入れるか、元に戻すか。
- **確かめていないこと:** 書く側と月次締めの順番が逆になった時のデッドロックを、実際に起こすテスト。
- **ほかの持ち越し:**
  - 締めと入金の登録・取消が同時の時の 409（締めについては試していない）。
  - `ApiAuthenticationTests` の一時的な失敗（今日の CI 3回では出ていない。見張る）。
- **これまでの持ち越し:**
  - PR #27 の Minor 4件、PR #16 の残り、PR #19 の Minor 3件。
  - 一覧のページ分け、Swagger の Bearer の定義、`Routes.razor` の「権限がありません」のテスト。
  - 入金の画面の型の流用、請求書の一覧がエンティティを丸ごと読む。
  - 出荷・返品の数量の桁、DB の接続の時間切れ（見張る）。
  - ガードの実効性テストで、認証切れを「判定できず」と区別するか。
