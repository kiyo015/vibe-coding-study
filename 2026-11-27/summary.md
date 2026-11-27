# Day59 学習記録（2026-11-27）— 月次締めの画面と売掛金の残高の一覧、2週目の振り返り

基幹システム開発計画の45日目。段階3（販売の完結）の10日目で、2週目の最終日。

- **決めたこと:** 作業の前に本人に4件を聞いた。どれも推奨の案に決まった。
- **作ったこと:**
  - 月次締めの API と画面。経理と管理者が「次に締める月」を締める。
  - 売掛金の残高の一覧。締めた月の一覧、月の請求先ごとの残高と合計、請求先の月ごとの推移。
  - PR #31 の Minor（2月の月末締めのテスト）と、Day57 で「テストで作れない」とした V31 の画面のテスト。
  - Study の dev-guard のフック修正（手で書いた決定の記録を書き直さない）。
- **確かめたこと:**
  - 対照実験は sales-core 23通りとフック3通りで、すべて落ちた。
  - Day57 で未検出だった V31 も、問い合わせを DB に送る直前で止める仕掛けで落とせた。

**完了条件「画面で月次締めができ、残高の一覧が出る。2週目の振り返りがある」は達成した。**
- AI レビューは2回で、最後はマージ可（Critical・Important なし）。費用は計 $1.1873。
- CI は2回とも成功した。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 一覧の形 | **月を選んで請求先ごと（合計行つき）。** 請求先を選ぶと、その請求先の月ごとの推移 |
| 締めていない月 | **一覧には出さない（見込みは作らない）。** 月次締めの画面に「次に締める月」を出す |
| 前日にフックが書き換えた `docs/decisions/2026-11-26.md` | **マージした版に戻し、フックを直す** |
| 今日の範囲 | **計画 ＋ Minor 2件**（2月の月末締め、V31）。前の月の残高の読み込み漏れ（PR #31 の Minor 1）は直さず、結合テストと対照実験 U6 で守る |

### 2. Application と API

- **参照は全員（`Operation.ViewReceivableBalance` を新設）。**
  - `ListAsync`: 締めた月の一覧。新しい順で、期末の合計つき。
  - `GetAsync(年, 月)`: 月の請求先ごとの残高。締めていない月・範囲外の年月は 404。
  - `GetHistoryAsync(請求先)`: 請求先の推移。古い順。支店のコード・無い請求先は 404（支店の残高は請求先の残高に入る）。
- **次に締める月（`NextAsync`）は締めと同じ行（経理と管理者）。**
  - 最後に締めた月の翌月。まだ締めていなければ、取引（売上・入金）の一番古い月。
  - 「終わったか」は、その月の末日が日本時間の今日より前か。
  - 取引が無ければ null。API は 204 で返す（AI レビュー1回目の Important）。
- **API:**

| 経路 | 応答 |
|---|---|
| `POST /monthly-closings` | 201。場所は `/monthly-closings/{年}/{月}` |
| `GET /monthly-closings` | 締めた月の一覧 |
| `GET /monthly-closings/next` | 次に締める月。取引が無ければ 204 |
| `GET /monthly-closings/{年}/{月}` | 月の残高。締めていなければ 404 |
| `GET /receivable-balances/{請求先}` | 推移。支店・無い請求先は 404 |

### 3. 画面（Blazor）

- **売掛金の残高（`/monthly-closings`）:**
  - 締めの欄は経理と管理者だけに出す。営業には出さず、次に締める月も問い合わせない。
  - 終わっていない月は、ボタンを押せず「月末を過ぎてから締められます。」と出す。
  - 取引が無ければ「締める取引（売上・入金）がありません。」と出す。
  - 締めると、その月の画面に移る。締められない理由（締め忘れの請求先など）は画面に出して移らない。
- **月の残高（`/monthly-closings/{年}/{月}`）:** 請求先ごとの期首・売上・消費税・入金・期末と合計行。前受は負の額で出す。請求先のコードから推移へ移れる。
- **請求先の推移（`/receivable-balances/{請求先}`）。**
- メニューの「入金」の後に「売掛金の残高」を足した。

### 4. 手で計算した値と比べる

画面のテスト（`MonthlyClosingPageTests`）の11月:

| 請求先 | 期首 | 売上 | 消費税 | 入金 | 期末 |
|---|---:|---:|---:|---:|---:|
| C001 本社 | 1,155 | 2,100 | 210 | 1,000 | 2,465 |
| C003 別の会社 | 0 | 0 | 0 | 300 | −300 |
| 合計 | 1,155 | 2,100 | 210 | 1,300 | 2,165 |

- C003 は請求書の無い入金だけなので、前受として負の額になる。合計行にも負の額のまま入る。
- API のテスト（`MonthlyClosingApiTests`）は別のデータで、10月の合計 971、11月の合計 702。

### 5. 作る前に書き出した「通らない経路」

- 日本時間 12/1 0:30（UTC ではまだ 11/30）には、11月は終わっている。
- 末日 11/30 23:59 には、11月はまだ終わっていない。**このテストは書き出しから足したもので、末日を終わった扱いにする誤り（X9）が落ちた。**
- 締めていない月の URL、支店のコードで推移を開く、合計と前受（負の額）、選び直した後に前の問い合わせが返る、月末締めの2月（平年・うるう年）。

### 6. Minor 2件

- **2月の月末締め:** 月末締めの得意先で、2027年は2/28、2028年は2/29 に未請求の売上を止め、末日締めの請求書があれば通す Domain のテスト（Theory 2件）。
- **V31（入金の画面で、請求先を選び直した後に前の問い合わせが返る）:**
  - Day57 では「テストで作れない」として未検出だった。
  - `DbCommandInterceptor` で、前の請求先の問い合わせを DB に送る直前で止める。選び直した後の問い合わせを先に返してから、止めた問い合わせを流す。
  - この順で、前の請求先の請求書が画面に出ないことを確かめた。

### 7. フックの修正（Study の dev-guard）

- **症状:** 会話を要約する前のフックが、手で書いた・書き足した決定の記録を、自動の書き出しの版で上書きしていた（Day53・Day58 の2回）。
- **直し方:** 既にあるファイルが、書き出す内容の先頭と一致しなければ書き直さない（`canOverwrite`）。代わりに「手で書いた（書き足した）記録なので書き直さない。今日の決定 N 件が載っているか確かめる」と知らせる。
- **確かめ:** テスト5件と対照実験3通り。今日の要約の時、実際にこの知らせが出て、`2026-11-27.md`（手で書いた4件）は残った。

### 8. RED

- 画面のテストは、画面が無くビルドが通らない状態から。
- `PermissionTests` は、新しいユースケースを役割の表に対応させる前に落ちた。
- AI レビュー1回目の後に足した API のテストは、200 のままで落ちることを先に確かめた。
- **最初の API のテストは、RED を確かめずに実装まで進めた。** 代わりに、各テストが誤りで落ちることを対照実験 X1〜X12 で確かめた。PR 本文にもそう書いた。

### 9. 対照実験（sales-core 23通り、すべて検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| F1・F2 2月の締め日を28日・29日に固定 | Domain 1件ずつ |
| X1 締めた月の一覧を古い順に | 結合 2件 |
| X2 一覧の合計に期首を足す | 結合 3件 |
| X3 締めていない月を開くと一番新しい締めを出す | 結合 1件 |
| X4 推移で支店も請求先として探す | 結合 1件 |
| X5・X6 推移を新しい順に・ほかの請求先の行も出す | 結合 2件ずつ |
| X7 次に締める月を締めた月のままに | 結合 3件 |
| X8 終わったかを UTC の日付で決める | 結合 2件 |
| X9 末日の当日に終わった扱い | 結合 1件（書き出しから足した 23:59 のテスト） |
| X10 次に締める月の検査を参照の行に | 結合 2件 |
| X11 残高の参照を経理と管理者だけに | 結合 5件 |
| X12 締めの API の場所を誤る | 結合 1件 |
| S1 締めの欄を役割で隠さない | 結合 1件 |
| S2 終わっていない月でもボタンを押せる | 結合 1件 |
| S3 締めた後に月の画面へ移らない | 結合 1件 |
| S4 合計の期末を最初の行にする | 結合 1件 |
| S5 推移へのリンクを張らない | 結合 1件 |
| S6 メニューに出さない | Web 3件 |
| S7 V31 選び直した後の古い結果を入れる | 結合 1件 |
| X13 取引が無い時も 200 で返す（AI レビューの後） | 結合 1件 |
| S8 取引が無い時の文言を出さない（AI レビューの後） | 結合 1件 |

フックの対照実験3通り（H1 常に書き直す・H2 CRLF を直さずに比べる・H3 ファイルがあれば必ず書き直さない）もすべて落ちた。

### 10. CI と AI レビュー（PR #32）

| 回 | 判定 | 費用 | 主な指摘と対応 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.5981 | **Important:** 取引が無い時の次に締める月にテストが無く、API の応答も決まっていない → 204 にし、API と画面のテストを足した。**Minor:** 二度押し（`CloseAsync` の先頭でも止める）、推移へのリンクの URL の符号化、`Permissions.cs` の古いコメントを直した。全部の月の残高を読むことは直さない（ponytail のコメントで記録済み） |
| 2回目 | マージ可 | $0.5892 | Minor 4件。範囲外の年月の 404 の API テスト、一覧と次に締める月の読み込みを分ける、9999年12月の `AddMonths`、二度押しの印のテスト。Day60 へ |

### 確認

- テストは 746件 → **761件**（Domain 337・Web 47・アーキテクチャ 20・結合 345・端から端まで 12）。CI のログで件数を確かめた。
- Release ビルドの警告は0件。

## 2週目（Day55〜59）の振り返り

計画シートに書いた。要点:

- **試したこと3つの結果:**
  1. 数・日付の入力を足したら「省いた時」を通らない経路に書く → 効いた（入金日の既定値、EF の既定値で当月が翌月になる罠）。
  2. テストの時計を日本時間 0:00〜9:00 にする → 効いた（Day56・58・59 で UTC の誤りがどれも落ちた）。
  3. 対照実験が通ったら、止めた柵を名指しする → 続けた。
- **効いたやり方:** 手で計算した値の表を先に作る。止める所を届かない経路で分けて重ねる。「テストで作れない」と書いた順序も作り方を探す。
- **繰り返した失敗:** ヒアドキュメントの引用符（段階3で5回目）。フックが決定の記録を消した（今日直した）。編集で BOM・改行が変わった。画面の操作が終わる前に次の画面で DB を使った。
- **3週目に試すこと:**
  1. AI レビューの前に、止める側と通す側の両方のテストがあるかを自分で見る。
  2. 画面の操作の後は、結果（移った URL・出た文言）を待ってから次の操作をする。
  3. 本物のブラウザのテストで、DB に残る操作（月次締め）をどう扱うかを先に決める。

## 今日学んだこと

- **非同期の順序は、DB に送る直前で止めれば作れる。** `DbCommandInterceptor` で前の問い合わせを待たせると、「後の問い合わせが先に返る」場面をテストの中で決まった順に作れる。Day57 で「作れない」と書いたのは、作り方を探していなかっただけだった。
- **作る前に書き出した境目は、そのままテストになる。** 「末日の当日 23:59」は書き出しの時に気付いたもので、そのテストが無ければ X9（`<` を `<=` にする誤り）は落ちなかった。
- **「無い」場合の応答は、決めないと決まらない。** 次に締める月が無い時、実装は null の 200 を返していた。API は 204、画面は文言、と決めてテストで固定した（AI レビュー1回目の Important）。
- **参照と操作で権限の行を分ける。** 同じ画面でも、一覧は全員、次に締める月は締めと同じ行。営業の画面では次に締める月を問い合わせないことまでテストで確かめた。

## つまずき

- **`NextAsync` がビルドできなかった**
  - 原因: `??` と `is` のパターンを1つの式で混ぜ、優先順位で型が合わなかった。
  - 対策: `FirstDayOfMonth` の補助関数に分けた。
- **API のテストの準備で、経理が受注を登録できなかった**
  - 原因: 受注は営業・管理者の操作。テストの準備を経理で行っていた。
  - 対策: 準備は管理者で行い、月次締めの操作だけ `Accounting()` で役割を切り替えた。
- **営業の参照のテストで 409 になった**
  - 原因: テストのデータで C003 の請求を締め忘れていた。実装は正しく締め忘れを止めていた。
  - 対策: テストのデータに請求の締めを足した。
- **画面のテストで、締めの途中に次の画面を開いた**
  - 対策: 締めた後の URL を `WaitForAssertion` で待ってから次の画面を開いた（2週目の振り返りの「繰り返した失敗」）。
- **C# ファイル2つに BOM が入った**
  - 原因: Python で `utf-8-sig` で書いた。
  - 対策: 差分で気付いて BOM を外した。以後は BOM・CRLF を保つ `ed.py` を使った。
- **締めの HTML をヒアドキュメントで書こうとして引用符が壊れた**（前日まで）。今日は最初から Write で書いた。

## 気づき・発見

- **端から端までのテストの DB は、実行をまたいで残る。** 本物のブラウザで月次締めを押すと、その月の日付の出荷・入金が次の実行から止まる。Day60 の作業の前に扱いを本人に聞く。
- **フックの修正は Study の中だけで効いている。** sales-core を Study 以外で開いたセッションは、GitHub のタグ `dev-guard-v1.4.0` から入れた版で動く。配るには新しいタグを打って入れ直す必要がある（本人が決める）。

## 成果物

**sales-core**（タグ `day59`）
- [src/SalesCore.Application/MonthlyClosingUseCases.cs](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Application/MonthlyClosingUseCases.cs)
- [src/SalesCore.Application/MonthlyClosingContracts.cs](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Application/MonthlyClosingContracts.cs)
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Application/Permissions.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Api/Program.cs)
- [src/SalesCore.Web/Components/Pages/MonthlyClosings/MonthlyClosingList.razor](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Web/Components/Pages/MonthlyClosings/MonthlyClosingList.razor)（新規）
- [src/SalesCore.Web/Components/Pages/MonthlyClosings/MonthlyClosingDetail.razor](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Web/Components/Pages/MonthlyClosings/MonthlyClosingDetail.razor)（新規）
- [src/SalesCore.Web/Components/Pages/MonthlyClosings/ReceivableHistory.razor](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Web/Components/Pages/MonthlyClosings/ReceivableHistory.razor)（新規）
- [src/SalesCore.Web/Components/Layout/NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day59/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [tests/SalesCore.Integration.Tests/MonthlyClosingApiTests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.Integration.Tests/MonthlyClosingApiTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/MonthlyClosingPageTests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.Integration.Tests/MonthlyClosingPageTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ReceiptPageTests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.Integration.Tests/ReceiptPageTests.cs)
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.Integration.Tests/PermissionTests.cs)
- [tests/SalesCore.Domain.Tests/MonthlyClosingTests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.Domain.Tests/MonthlyClosingTests.cs)
- [tests/SalesCore.E2E.Tests/PermissionE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day59/tests/SalesCore.E2E.Tests/PermissionE2ETests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day59/docs/domain/business-rules.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day59/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-27.md](https://github.com/kiyo015/sales-core/blob/day59/docs/decisions/2026-11-27.md)（新規。本人の決定4件）
- [kiyo015/sales-core#32](https://github.com/kiyo015/sales-core/pull/32)

**Study**（タグ `day59`）
- [2026-11-27/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day59/2026-11-27/summary.md)
- [2026-11-27/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day59/2026-11-27/summary.html)
- [plugins/dev-guard/hooks/session-hooks.js](https://github.com/kiyo015/vibe-coding-study/blob/day59/plugins/dev-guard/hooks/session-hooks.js)
- [plugins/dev-guard/hooks/session-hooks.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day59/plugins/dev-guard/hooks/session-hooks.test.js)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day59/study_plan_next_month.md)（2週目の振り返り）

## 次回予告

**Day60 — 端から端までのテスト（段階3）。** Playwright で、営業が見積 → 受注 → 出荷、経理が締め → 入金 → 次の締めで繰越 → 月次締めで残高、までを1本通す。金額が結合テストと同じ値になることを確かめる。

- **作業の前に本人に聞く:** 端から端までのテストの DB は実行をまたいで残る。月次締めを押すと、その月の日付の出荷・入金が次の実行から止まる。毎回 DB を作り直すか、実行ごとに日付をずらすか、など。
- **持ち越し（PR #32 の AI レビュー2回目の Minor）:**
  1. 範囲外の年月（`/2026/13`・`/0/1`）で 404 になる API のテスト。
  2. 一覧の読み込みと次に締める月の問い合わせを分ける（今は次に締める月が失敗すると一覧も出ない）。
  3. 最後に締めた月が 9999年12月の時の `AddMonths`（締めの側で 9998年までに止めているので起きない）。
  4. 締めの二度押しを止める印のテスト。
- **フックの配布:** sales-core のセッションへ。新しいタグを打って入れ直すかは本人が決める。
- **確かめていないこと:** 書く側と月次締めの順番が逆の時のデッドロックを実際に起こすテスト、締めと入金の登録・取消が同時の時の 409。`ApiAuthenticationTests` の一時的な失敗（見張る。今日の CI 2回では出ていない）。
- **これまでの持ち越し:**
  - PR #27 の Minor 4件、PR #16 の残り、PR #19 の Minor 3件。
  - 一覧のページ分け、Swagger の Bearer の定義、`Routes.razor` の「権限がありません」のテスト。
  - 入金の画面の型の流用、請求書の一覧がエンティティを丸ごと読む。
  - 出荷・返品の数量の桁、DB の接続の時間切れ（見張る）。
  - ガードの実効性テストで、認証切れを「判定できず」と区別するか。
