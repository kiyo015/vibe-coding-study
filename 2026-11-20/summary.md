# Day55 学習記録（2026-11-20）— 入金と消込（Domain と永続化）

基幹システム開発計画の41日目。段階3（販売の完結）の6日目で、2週目の初日。

- **決めたこと:** 作業の前に本人に4件を聞いた。どれも推奨の案に決まった。
  - 消込と繰越をどう両立させるか（Day50 から残っていた未決）。
  - 前受の扱い。
  - 入金日と取消の日付。
  - 入金の方法を記録するか。
- **作ったこと:**
  - 入金の Domain（`Receipt`）。登録すると、請求先の未回収の請求書に締め日の古い順に充てる。取消は赤黒で表す。
  - 請求書に、今回分・消し込んだ額・未回収を持たせた。
  - 入金と割当の表（マイグレーション `AddReceipts`）。開発用 DB にも当てた。
- **確かめたこと:** 誤りを入れる対照実験を26通り行い、25通りがテストで落ちた。落ちなかった1通り（T6）は、繰越がまだ0なので今は確かめようがない（Day57 で確かめる）。

**完了条件「充て方（全額・一部・複数の請求書にまたがる・過入金・取消）がテストで固定され、合計の決まりを外す対照実験で落ちる」は達成した。**
- AI レビューは2回で、最後はマージ可（Critical・Important なし）。費用は計 $1.1947。
- CI は2回とも成功した。

## 今日行った処理

### 1. 作業の前に、本人に4件を聞いた

| 問い | 決定 |
|---|---|
| 「古い請求書から充てる」と繰越の形式が両立しない件（Day50 からの未決。PR #23 の AIレビュー4回目の Important） | **消込の上限は請求書の今回分（今回売上＋消費税）。** 繰越は請求書に出すだけで、充てる対象にしない |
| 前受（どの請求書にも充てていない入金の残り）が残った後に、新しい請求書を締めた時 | **締めた時に、古い入金から自動で充てる**（作るのは Day57） |
| 入金日と取消の日付 | **入金日は日本時間の今日まで**（過去は入れられる）。**打ち消しの入金は取り消した日の日付** |
| 入金の方法（振込・現金・手形・相殺） | **記録しない。** 今は振込だけを扱う |

なぜ請求額でなく今回分を上限にするのか。
- 繰越の形式では、払われなかった前の請求額が、次の請求書にも繰越として入る。
- 請求額を上限にすると、同じ未回収を2つの請求書で数え、2回消し込んでしまう。
- 例: 請求書1が1,000円（未入金）、請求書2が繰越1,000円＋今回500円＝1,500円。1,500円の入金は、請求書1に1,000円、請求書2に500円を充てて、どちらも未回収0円になる。請求額を上限にすると、請求書2に1,000円が残って見える。

業務ルール集、ER 図、段階3の設計、sales-core の `docs/decisions/2026-11-20.md` に記録した。

### 2. 入金の Domain（`Receipt`）

- **登録（`Receipt.Register`）:** 未回収の請求書に、締め日の古い順（同じ日なら Id の順）に充てる。1件ごとに、入金の残りと請求書の未回収の小さい方を充てる。充て切れない分は前受（`Unallocated`）として残す。
- **入力の検査:** どれも、請求書を書き換える前に止める。
  - 支店では受けない（入金は請求先で受ける）。
  - 金額は1円以上・15桁まで。
  - 入金日は今日まで。
  - 別の請求先の請求書が渡されたら止める。
- **取消（`Cancel`）:**
  - 今日の日付で、負の額の打ち消しの入金を作る。元の割当を、同じ請求書・同じ額で打ち消す。
  - 取り消せるのは1回だけ。打ち消しの入金は取り消せない。
  - 割当・割当の請求書・請求先を読み込まずに呼ぶと、何も変えずに理由つきで止める。
- **請求書（`Invoice`）:**
  - 今回分（`ChargedAmount`）、消し込んだ額（`AllocatedAmount`）、未回収（`Outstanding`）を足した。
  - 上限の検査は Domain に書かなかった。登録・取消のどの道からも届かず、テストで確かめられないため。最後は DB の検査制約が止める。

### 3. 表（マイグレーション `AddReceipts`）

マイグレーションの手順（ER 図を直す → SQL を書き出して読む → テスト用 DB → 開発用 DB）で進めた。開発用 DB の未適用は0件。

- `receipts`:
  - 番号は `RC-000001` の形。
  - 打ち消しの入金は `reverses_id` で元の入金を指す（一意インデックス）。
  - 取り消された元の入金には `is_cancelled` の印を立てる。
- `receipt_allocations`: どの入金をどの請求書にいくら充てたか。
- `invoices.allocated_amount`: 既存の請求書には既定値0で入る。

割当の合計を、入金と請求書の行にも持たせた（`allocated_amount`）。理由は3つある。
1. 割当を全部読まなくても、未回収と前受が分かる。
2. 充てるたびに請求書の行を更新するので、同じ請求書に2人が同時に充てると、版数で後の方が止まる。
3. 上限を DB の検査制約でも止められる。
   - `ck_invoices_allocated`: 0以上・今回分以下。
   - `ck_receipts_allocated`: 入金額と同じ符号で、入金額以下。

### 4. RED を見てから作った

- Domain は `Receipt` が無く、ビルドが通らなかった。
- 結合テストは `Db.Receipts` が無く、ビルドが通らなかった。

テストの組み方で、誤った実装が見えるようにした（2週目で試すこと「日付を2つずらす」も当てた）。
- Domain のテストは、渡す請求書をわざと締め日の新しい順にした。渡した順に充てる誤りが見える。
- 結合テストは、11月の請求書を先に作り、Id の順と締め日の順を逆にした。Id の順に充てる誤りが見える。
- 今日（2030-12-10）と入金日（2030-12-05）をずらした。打ち消しの入金を入金日の日付にする誤りが見える。

Domain `ReceiptTests` 15件、結合 `ReceiptPersistenceTests` 12件を足した。

### 5. 対照実験（26通り、25通り検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| T1 渡した順に充てる | Domain 4件・結合 2件 |
| T2 Id の順に充てる | Domain 4件・結合 2件 |
| T3 消し終えた請求書も対象にする | Domain 1件 |
| T4 入金の残りで止めない | Domain 4件 |
| T5 請求書の未回収で止めない | Domain 5件 |
| T6 上限を今回分でなく請求額にする | **未検出**（下） |
| T7 請求書の消し込んだ額を更新しない | Domain 4件・結合 3件 |
| T8 取消で元の割当を打ち消さない | Domain 2件・結合 1件 |
| T9 打ち消しの入金を入金日の日付にする | Domain 1件・結合 1件 |
| T10 取り消した印を立てない | Domain 2件・結合 1件 |
| T11 打ち消しの一意インデックスを外す | 結合 1件 |
| T12 印も一意インデックスも外す | 結合 3件（同時の取消を含む） |
| T13 打ち消しの入金も取り消せる | Domain 1件 |
| T14 請求書の版数を見ない | 結合 1件（同時に充てる） |
| T15 請求書の検査制約を外す | 結合 2件 |
| T16 入金の検査制約を外す | 結合 2件 |
| T17 割当を読み込まなくても取り消せる | 結合 1件 |
| T18 入金日の今日も拒む | Domain 1件 |
| T19 入金日を見ない | Domain 1件 |
| T20 0円の入金を許す | Domain 1件 |
| T21 15桁ちょうども拒む | Domain 1件 |
| T22 15桁を超えても受け付ける | Domain 1件 |
| T23 支店でも入金を登録できる | Domain 1件 |
| T24 別の請求先の請求書にも充てる | Domain 1件 |
| T25 割当の請求書の読み込み漏れを見ない | 結合 1件 |
| T26 請求先の読み込み漏れを見ない | 結合 1件 |

- **T6 が未検出の理由:** 請求書の繰越はまだ常に0（Day57 で作る）。今回分と請求額が同じ値なので、どちらを上限にしても結果が変わらない。Day57 で、繰越のある請求書で確かめる。
- **同時の取消は二重に守っている。** T10（印だけ外す）と T11（一意インデックスだけ外す）では、同時の取消のテストは落ちなかった。T12（両方外す）で落ちた。
  - 最初は、このテストを請求書に充てた入金で書いていて、T12 でも落ちなかった。取消は請求書の行も更新するので、請求書の版数という3つ目の柵が止めていた。
  - 入金の柵だけを確かめるため、前受だけの入金（請求書の無い得意先 C003）に直した。
- **T14 は、検査制約だけでは足りないことを示した。** 2人とも残り全額（1,155円）を同じ請求書に充てても、消し込んだ額は 1,155円で上限を超えないので、制約は止めない。止めるのは版数。
- **DB の制約を外す実験（T11・T12・T15・T16）は、テストの中で `DROP` した。** テスト用 DB はマイグレーション済みなので、モデルを書き換えても制約は外れない。

### 6. CI と AI レビュー（PR #28）

| 回 | 判定 | 費用 | 主な指摘と対応 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.5839 | **Important:** 業務ルール集の「繰越は入金を作った日に終える」が、繰越がまだ0の実装と食い違った。Day57 からと書き直し、Day56〜57 の間の扱いも書いた。**Minor:** 取消で割当の請求書や請求先を読み込み忘れると、途中の請求書まで書き換えてから落ちた。RED（`NullReferenceException`）を見てから、何も変えずに止める形に直した（T25・T26）。ほか2件は業務ルール集に書いた |
| 2回目 | マージ可 | $0.6108 | Minor 3件。Day56・57 へ回した（次回予告） |

### 確認

- テストは 634件 → **661件**（Domain 287・Web 47・アーキテクチャ 20・結合 295・端から端まで 12）。
- Release ビルドの警告は0件。

## 今日学んだこと

- **決まりの中心が、今日のデータでは確かめられないことがある。**
  - 「上限は今回分」は今日の一番大事な決定だった。しかし繰越がまだ常に0なので、今回分と請求額が同じ値になり、誤りを入れても落ちない（T6）。
  - 落ちないことを「テストが弱い」と片付けず、理由を書いて、確かめられるようになる日（Day57）の完了条件に入れる。
- **柵は重なっていると、片方を外しても落ちない。**
  - 同時の取消は、取り消した印・一意インデックス・請求書の版数の3つが止めていた。どれか1つを外しても落ちない。
  - 確かめたい柵だけが効くデータ（前受だけの入金）に変えて、初めて二重の守りだと言えた。
- **検査制約は「合計が上限を超えない」しか見ない。**
  - 同時に充てる2人がどちらも上限以内なら、制約は通す。後から書いた方が先の割当を上書きする（失われた更新）を止めるのは版数だった（T14）。
- **DB の制約の対照実験は、モデルではなく DB を変える。** テスト用 DB はマイグレーション済みなので、テストの中で `DROP` して確かめた。

## つまずき

- **対照実験のスクリプトが壊れた（Day53 に続いて2回目）**
  - 症状: 書き換えの文字列の `'\n'` が改行に化けた。
  - 原因: シェルのヒアドキュメントでスクリプトを書いた。1週目の振り返りで挙げた失敗と同じ。
  - 対策: ファイルを直接直した。スクリプトはファイルとして書いてから流す。
- **同時の取消のテストが、想定と違う例外で止まった**
  - 症状: 版数の例外（`DbUpdateConcurrencyException`）を期待したが、`DbUpdateException` だった。
  - 原因: 打ち消しの入金を足す INSERT が、元の入金の UPDATE より先に走り、一意インデックスに先に当たった。
  - 対策: どちらの柵で止まってもよいように `DbUpdateException` の仲間で受け、件数（1件）も確かめる形にした。
- **意味の無いテストと検査を書いていた**
  - 「取消の日付は今日より先にできない」の検査とテストを書いたが、取消の日付は呼ぶ側が今日を渡すので、先の日付になる道が無い。両方消した。
- **要約の前の自動書き出しが、決定の記録を上書きした（3日続けて）**
  - 症状: `docs/decisions/2026-11-20.md` の見出しが「09:34」になり、前書きの文も書き換わった。本人が答えたのは 00:35。
  - 対応: PR にはコミット済みの正しい版（00:35）が入る。上書きされた版は作業ツリーに残したまま、戻すかを本人に任せた（今日は自分では戻さなかった）。

## 気づき・発見

- **入金を前受だけにすると、請求書を巻き込まずに入金の柵だけを試せる。** 請求書の無い得意先（C003）が、テストのデータとして役に立った。
- **2週目で試すこと3つは、初日から使えた。**
  1. 「省いた時」の行: 入金日を省くと既定値 0001-01-01 になり、過去の日付として通る。通らない経路に書き、Day56 の API で省けない形にする。
  2. 日付を2つずらす: 今日と入金日をずらし、打ち消しの入金の日付の誤り（T9）を見えるようにした。
  3. 止めた柵を名指しする: T12 の請求書の版数、T14 の版数。

## 成果物

**sales-core**（タグ `day55`）
- [src/SalesCore.Domain/Receipt.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Domain/Receipt.cs)（新規）
- [src/SalesCore.Domain/Invoice.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Domain/Invoice.cs)
- [src/SalesCore.Infrastructure/Persistence/Configurations.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Infrastructure/Persistence/Configurations.cs)
- [src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261120004717_AddReceipts.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Infrastructure/Persistence/Migrations/20261120004717_AddReceipts.cs)（新規）
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day55/src/SalesCore.Application/OperationError.cs)
- [tests/SalesCore.Domain.Tests/ReceiptTests.cs](https://github.com/kiyo015/sales-core/blob/day55/tests/SalesCore.Domain.Tests/ReceiptTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ReceiptPersistenceTests.cs](https://github.com/kiyo015/sales-core/blob/day55/tests/SalesCore.Integration.Tests/ReceiptPersistenceTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/MigrationTests.cs](https://github.com/kiyo015/sales-core/blob/day55/tests/SalesCore.Integration.Tests/MigrationTests.cs)
- [docs/migrations/2026-11-20-AddReceipts.sql](https://github.com/kiyo015/sales-core/blob/day55/docs/migrations/2026-11-20-AddReceipts.sql)（新規）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day55/docs/domain/business-rules.md)
- [docs/domain/er-diagram.md](https://github.com/kiyo015/sales-core/blob/day55/docs/domain/er-diagram.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day55/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-20.md](https://github.com/kiyo015/sales-core/blob/day55/docs/decisions/2026-11-20.md)（新規。本人の決定4件）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day55/CLAUDE.md)
- [kiyo015/sales-core#28](https://github.com/kiyo015/sales-core/pull/28)

**Study**（タグ `day55`）
- [2026-11-20/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day55/2026-11-20/summary.md)
- [2026-11-20/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day55/2026-11-20/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day55/study_plan_next_month.md)

## 次回予告

**Day56 — 入金の画面と API。** 経理が入金を登録・取消できるようにし、請求書に未回収の残高を出す。

- **持ち越し（PR #28 の AIレビュー2回目の Minor）:**
  1. `Receipt.Register` は請求書の請求先を参照で比べる。請求先を読み込んでいないと `NullReferenceException` で落ちるか、同じ請求先なのに「別の請求先」として拒む。入金を登録するユースケースを書く時に、理由つきで止める形に直す。
  2. 業務ルール集「締めた後に誤りが見つかったら」に、「消し込んだ額は回収の状態で、請求額ではない。確定した請求書でも更新する」を足す。
- **Day56 で決める・確かめること:**
  - 入金日を API で省けない形にする（省くと 0001-01-01 で通る）。
  - 同時の取消で一意インデックスが止めた時の 409 の文言。
  - 役割の表の「入金の登録・取消」を、ユースケースのある行に移す。
- **Day57 へ:** 繰越のある請求書で「今回分を超えて充てない」のテスト（T6）。前受を新しい請求書に充てる時、取り消した入金と打ち消しの入金を除く。請求書の上限を Domain でも止めるかを決める。
- **これまでの持ち越し:** PR #27 の Minor 4件（見積の詳細の入れかけ、受注化の後の読み直し、数でない値の理由、手で直した単価の知らせのテスト）、`Routes.razor` の「権限がありません」のテスト、PR #19 の Minor 3件、出荷・返品の数量の桁、一覧のページ分け、DB の接続の時間切れ（見張る）。
