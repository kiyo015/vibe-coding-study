# Day56 学習記録（2026-11-24）— 入金の画面と API

基幹システム開発計画の42日目。段階3（販売の完結）の7日目で、2週目の2日目。

- **決めたこと:** 作業の前に本人に4件を聞いた。どれも推奨の案に決まった。
  - 登録の画面で、未回収の請求書を出すか。
  - 取り消した入金の、一覧での見せ方。
  - 無効にした請求先からの入金を受けるか。
  - 今日の範囲。
- **作ったこと:**
  - 入金の API（登録・一覧・詳細・取消）。
  - 入金の画面（一覧・登録・詳細）。メニューに「入金」を足した。
  - 請求書の一覧と詳細に、消し込んだ額と未回収を出した。
  - 前日の AI レビューの Minor 2件を直した。
- **確かめたこと:** 誤りを入れる対照実験を33通り行い、すべてテストで落ちた。1通り（U17）は最初は落ちず、テストを直してから落ちた。

**完了条件「経理が入金を登録すると古い請求書から消し込まれ、権限の無い役割は API でも画面でも拒まれる」は達成した。**
- AI レビューは1回でマージ可（Critical・Important なし）。費用は $0.6923。
- CI は1回で成功した。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 登録の画面で、請求先を選んだ時に未回収の請求書を出すか | **出す。** 充てる順（締め日の古い順）に、番号・締め日・未回収の額を出す。充てる先は選ばせない |
| 一覧での、取り消した入金の見せ方 | **両方を並べる。** 元の入金は「取消済」、打ち消しの入金は負の額で「RC-… の取消」 |
| 無効にした請求先からの入金 | **受ける。** 締め請求と同じ扱い（残った売掛金の回収） |
| 今日の範囲 | **入金に絞る。** 一覧のページ分け・Swagger の Bearer の定義・PR #16 と #27 の Minor は持ち越す |

業務ルール集の「入金の画面」、段階3の設計の決定の表、sales-core の `docs/decisions/2026-11-24.md` に記録した。

### 2. 入金のユースケースと API

- **`ReceiptUseCases`:**
  - 登録: 請求先と、その請求先の請求書をまとめて読み、Domain の `Receipt.Register` に渡す。
  - 取消: 日本時間の今日の日付で打ち消しの入金を立て、それを返す。
  - 一覧は新しい順。取消済の入金と打ち消しの入金を両方出す。
  - 詳細では、割当と、打ち消し元・打ち消し先へのリンクを出す。
  - 登録の画面だけが使う問い合わせ2つ: 請求先の一覧（無効も出す）と、未回収の請求書（充てる順）。
- **入力の検査（400）:**
  - 入金日・入金額を省くと「入れる」と求める。0001-01-01 や0円のまま通さない（前日の「省いた時」の行への答え）。
  - 円未満の入金額は止める。`Money` は端数を丸めずに例外を出すので、手前で止めないと 500 になる。
- **API `/receipts`:** `POST /`（201）、`GET /`、`GET /{id}`、`POST /{id}/cancel`（201、打ち消しの入金を返す）。
- **権限:**
  - 参照は全員。登録・取消は経理と管理者。
  - `PermissionTests` の「入金の登録・取消」を、まだ無い行の一覧からユースケースのある行へ移した。
- **同時の取消:** 一意インデックスが止めた時は、409 で「同じ入金の取消は、ほかの人が先に登録した。読み直してからやり直す。」と出す（前日からの宿題）。

### 3. 画面

| 画面 | 中身 |
|---|---|
| 一覧 | 番号・請求先・入金日・入金額・前受・状態。登録の入口は経理と管理者だけ |
| 登録 | 請求先を選ぶと、未回収の請求書を充てる順に出す。無ければ「すべて前受になります」。入金日の初期値は日本時間の今日 |
| 詳細 | 消し込んだ額、前受、割当の表。取消は「取り消す（戻せません）」で確かめてから。取り消すと打ち消しの入金の画面へ移る |
| 請求書 | 一覧と詳細に、消し込んだ額と未回収を出す（請求額は変わらない） |

### 4. 前日の AI レビューの Minor 2件

- `Receipt.Register` で、請求書の請求先を読み込んでいなければ先に止める。RED は `NullReferenceException` だった。
- 業務ルール集に「消し込んだ額は回収の状態で、確定した請求書でも更新する」を足した。

### 5. RED を見てから作った

- API・画面のテストは、`ReceiptUseCases` と画面が無く、ビルドが通らなかった。
- Domain の Minor は `NullReferenceException` だった。
- メニューのテストは、作る前に期待を直したので、落ちる所は見ていない。代わりに、メニューから入金の行を外す対照実験（U28）で落ちることを確かめた。

2週目で試すことを当てた。
- 時計は日本時間の 2030-12-10 0:30（UTC ではまだ 12/9）。入金日・取消の日付・入金日の初期値を UTC で決める誤りが見える。
- 「省いた時」は、入金日と入金額の両方に当てた。

結合 `ReceiptApiTests` 7件・`ReceiptPageTests` 11件、`ReceiptPersistenceTests` に1件を足した。E2E（本物のブラウザ）では、3つの役割で入金の一覧と登録の画面を確かめ、「経理が一部入金すると請求書に未回収 155円が残る」を足した。

### 6. 対照実験（33通り、すべて検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| U1・U2 登録・取消の入口の検査を外す | 結合 2件ずつ |
| U3 表で入金の登録を営業にも許す | 結合 4件 |
| U4 一覧を登録の役割で検査する | 結合 3件 |
| U5 入金日を省くと既定値で通す | 結合 1件 |
| U6 入金額を省くと0円にする | 結合 2件 |
| U7 円未満の端数を見ない | 結合 1件（500 になる） |
| U8・U9 入金日・取消の今日を UTC で決める | 結合 3件ずつ |
| U10 無効の請求先からの入金を拒む | 結合 1件 |
| U11 請求先の選択肢から無効を除く | 画面 1件 |
| U12 未回収の請求書を Id の順に出す | 画面 1件 |
| U13 消し終えた請求書も未回収に出す | 画面 1件 |
| U14 入金の一覧を古い順にする | 結合 2件 |
| U15 一覧に打ち消しの元の番号を出さない | 結合 2件 |
| U16 詳細で打ち消しの入金を読まない | 結合 1件 |
| U17 割当を読む順を指定しない | **最初は未検出**（下）→ テストを直して結合 2件 |
| U18〜U20 取消のボタンを役割・取消済・打ち消しで隠さない | 画面 1件ずつ |
| U21 確かめずに取り消す | 画面 2件 |
| U22 取り消した後、打ち消しの画面に移らない | 画面 1件 |
| U23 登録の画面の入金日の初期値を UTC にする | 画面 1件 |
| U24 請求先を選んでも未回収を出さない | 画面 3件 |
| U25 読めない値の時も前の値で送る | 画面 1件 |
| U26 一覧の登録の入口を役割で隠さない | 画面 1件 |
| U27 一覧に取消済と出さない | 画面 1件 |
| U28 メニューに入金が無い | Web 3件 |
| U29・U30 請求書の未回収を取り違える | 結合 1件・2件 |
| U31 請求書の請求先の読み込み漏れを見ない | 結合 1件 |
| U32 取消で割当の請求書を読み込まない | 結合 6件 |
| U33 登録で得意先の請求先を読み込まない | 結合 1件（支店が 500 になる） |

- **U17 が最初に落ちなかった理由:** 割当の行は書き換えないので、順を指定しなくても入れた順に返っていた（Day54 の S6 と同じ形）。
  - 10月の割当を SQL で書き換えた（`UPDATE … SET amount = amount`）。PostgreSQL は書き換えた行を表の後ろに置くので、順を指定しない読み込みでは11月が先に来る。
  - そのうえで、割当の並びを `Assert.Equal` で確かめる形にテストを直した。直した後は落ちた。
- **U7〜U9 は、対照実験の道具がテストの結果を読めなかった（「(no summary)」）。** 手で流し直して、落ちることを確かめた。

### 7. CI と AI レビュー（PR #29）

| 回 | 判定 | 費用 | 指摘 |
|---|---|---|---|
| 1回目 | マージ可 | $0.6923 | Critical・Important なし。Minor 4件は直さずに Day57 へ回した（次回予告） |

Minor を今日直すと、AI レビューがもう1回動く。どれも表示や読みやすさの話で、1件目は繰越を作る Day57 に直すのがちょうどよいので、回した。

### 確認

- テストは 661件 → **682件**（Domain 287・Web 47・アーキテクチャ 20・結合 316・端から端まで 12）。
- Release ビルドの警告は0件。

## 今日学んだこと

- **「順を指定しない」誤りは、データが並びを崩さないと見えない。**
  - 割当は書き換えない行なので、指定しなくても入れた順に返る。テストが通っても、順の指定が効いている証拠にはならない。
  - わざと行を書き換えて物理的な順を崩すと、指定の有無が初めてテストの結果を変えた。
- **`Assert.Equivalent` は並びを見ない。** 中身の一致と並びの一致は別のアサーションで確かめる。
- **日付の境目は「UTC ではまだ前日」の時刻で突く。** 日本時間 0:30 に時計を止めると、今日を UTC で決める誤りが3か所（入金日・取消の日付・画面の初期値）とも落ちた。
- **思い込みで「上書きされた」と書いていた。**
  - Git Bash の `TZ=Asia/Tokyo date` は、このマシンでは UTC を出す。
  - Day55 で手で書いた「00:35」は UTC で、自動の書き出しの「09:34」が正しかった。「自動の書き出しが誤って上書きした」という前日の報告は、私の誤りだった。
  - 日本時間は PowerShell の `Get-Date` で取る。

## つまずき

- **画面のテストで、同じ bUnit の部品を2回使えなかった**
  - 症状: 1つ目の画面を描いた後に、サービスを足して2つ目を開くと落ちる。
  - 原因: bUnit は最初に描いた後、サービスを足せない。
  - 対策: 画面を開くたびに新しい `BunitContext` を作る形にした。
- **請求書の一覧のテストが、列を足したら壊れた**
  - 症状: `td.amount` の2番目を請求額として読んでいたが、未回収の列が加わってずれた。
  - 対策: 請求額の列に `total-amount` の印を付け、それで読む形にした。
- **一覧の並びの期待を逆に書いていた**
  - 一覧は新しい Id から並ぶ。10月の請求書は後から作るので先に来る。期待を直した。
- **後ろで動いたテストが、ビルドの出力をつかんでいた**
  - 編集の後のフックが動かしたテストのプロセスが、結合テストの bin を一時的につかみ、ビルドがコピーで失敗した。終わるのを待って流し直した。

## 気づき・発見

- **前日の「省いた時」の行は、翌日の作業の入口として効いた。** 「入金日を省くと 0001-01-01 で通る」と書いて残したので、入金日・入金額を nullable で受け、省くと理由を返す形にすぐ決められた。対照実験（U5・U6）でも確かめた。
- **決定の記録の時刻（今日の分）:** 締めの時、自動の書き出しが見出しを「08:59」、前書きを「自動で書き出した」に書き換えていた。私が手で書いたのは「09:00」。中身（質問と回答）は同じ。今日の PR に入れると AI レビューがもう1回動くので、Day57 のブランチで入れる。

## 成果物

**sales-core**（タグ `day56`）
- [src/SalesCore.Application/ReceiptUseCases.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Application/ReceiptUseCases.cs)（新規）
- [src/SalesCore.Application/ReceiptContracts.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Application/ReceiptContracts.cs)（新規）
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Application/Permissions.cs)
- [src/SalesCore.Application/InvoiceContracts.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Application/InvoiceContracts.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Application/InvoiceUseCases.cs)
- [src/SalesCore.Domain/Receipt.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Domain/Receipt.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Api/Program.cs)
- [src/SalesCore.Web/Components/Pages/Receipts/NewReceipt.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Pages/Receipts/NewReceipt.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Receipts/ReceiptDetail.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Pages/Receipts/ReceiptDetail.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Receipts/ReceiptList.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Pages/Receipts/ReceiptList.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Invoices/InvoiceDetail.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Pages/Invoices/InvoiceDetail.razor)
- [src/SalesCore.Web/Components/Pages/Invoices/InvoiceList.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Pages/Invoices/InvoiceList.razor)
- [src/SalesCore.Web/Components/Layout/NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day56/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [tests/SalesCore.Integration.Tests/ReceiptApiTests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.Integration.Tests/ReceiptApiTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ReceiptPageTests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.Integration.Tests/ReceiptPageTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ReceiptPersistenceTests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.Integration.Tests/ReceiptPersistenceTests.cs)
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.Integration.Tests/PermissionTests.cs)
- [tests/SalesCore.Integration.Tests/TestScenario.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.Integration.Tests/TestScenario.cs)
- [tests/SalesCore.E2E.Tests/PermissionE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.E2E.Tests/PermissionE2ETests.cs)
- [tests/SalesCore.E2E.Tests/SalesFlowE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day56/tests/SalesCore.E2E.Tests/SalesFlowE2ETests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day56/docs/domain/business-rules.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day56/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-24.md](https://github.com/kiyo015/sales-core/blob/day56/docs/decisions/2026-11-24.md)（新規。本人の決定4件）
- [docs/decisions/2026-11-20.md](https://github.com/kiyo015/sales-core/blob/day56/docs/decisions/2026-11-20.md)（Day55 の時刻を日本時間に直した）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day56/CLAUDE.md)
- [kiyo015/sales-core#29](https://github.com/kiyo015/sales-core/pull/29)

**Study**（タグ `day56`）
- [2026-11-24/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day56/2026-11-24/summary.md)
- [2026-11-24/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day56/2026-11-24/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day56/study_plan_next_month.md)（Day55 の「上書きされた」の誤りも直した）

## 次回予告

**Day57 — 繰越の請求と支払期限。** 請求額を「前回請求額 − 前回からの入金額 ＋ 今回売上 ＋ 消費税」の形にし、前受を次の請求書に充てる。回収条件から支払期限を決める。

- **持ち越し（PR #29 の AI レビュー1回目の Minor）:**
  1. 請求書の「未回収（円）」の見出しを「今回分の未回収（円）」にする。繰越を作ると請求額とずれるので、Day57 で直す。
  2. 登録の画面で請求先を素早く選び直すと、前の請求先の未回収が出ることがある。結果を入れる前に、選んでいる請求先を確かめる。
  3. 入金の画面が、締め請求用の型（使わない締め日を含む）を流用している。
  4. 請求書の一覧が、エンティティを丸ごと読む（件数が増えた時に効く）。
- **Day55 からの申し送り:** 繰越のある請求書で「今回分を超えて充てない」（T6）。前受を充てる時、取り消した入金と打ち消しの入金を除く。`Invoice.Allocate` で上限を Domain でも止めるか決める。
- **Day57 のブランチで入れる:** 決定の記録 `2026-11-24.md` の自動の書き出しの版（見出し 08:59）。
- **これまでの持ち越し:** PR #27 の Minor 4件、PR #16 の残り、一覧のページ分け、Swagger の Bearer の定義、`Routes.razor` の「権限がありません」のテスト、PR #19 の Minor 3件、出荷・返品の数量の桁、DB の接続の時間切れ（見張る）。
