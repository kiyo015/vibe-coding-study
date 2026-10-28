# Day39 学習記録（2026-10-28）— API の認証と権限の実効性テスト、1週目の振り返り

基幹システム開発計画の25日目で、段階2（画面と権限）の5日目。1週目の最終日。

- **決めたこと:** 本人が決めた。
  - API のログインは、画面と同じ利用者名とパスワードで行い、トークンを受け取る。
  - トークンの有効期限は1時間。切れたらログインし直す。
- **作り:** `POST /account/login` を足した。画面と同じログインの処理を呼ぶ。拒むかどうかは、今までどおりユースケースの入口の1か所で決める。
- **テスト:** テストの利用者に差し替えず、本当にログインしてトークンを付けて呼ぶ。

**完了条件「権限の実効性テストが対照実験付きで合格している」は達成した。** 営業のトークンで締めると 403 で、請求書は作られない。締めの入口の検査を外すと、このテストが落ちる。

## 今日行った処理

### 0. 定期実行の確認

- 朝の健康診断は走り、14件すべて正常だった。

### 1. 決めたこと（業務ルール集「8. 利用者とログイン」）

| 質問 | 本人の決定 |
|---|---|
| API のログインはどの方式にする？（画面は Day36 の Cookie） | **画面と同じ利用者でトークン。** ASP.NET Core Identity の標準の Bearer トークン。パスワード・ロック・失敗の伝え方は画面と同じ。利用者を登録する口は作らない |
| トークンの有効期限と、切れた時の扱いは？ | **1時間・切れたらログインし直す。** 期限を延ばす口（更新用のトークン）は作らない |

- 役割を外しても、既に出たトークンは期限まで使える。遅くとも1時間で効く。これも業務ルール集に書いた。
- 前日の Minor から、役割の変更がいつ効くかを「9. この文書で決めていないこと」に足した。利用者の管理を作る時に、無効化と一緒に決める。

### 2. 作り

```
POST /account/login ── AccountUseCases.SignInAsync（画面と同じ）
                          ├ ロック（5回で15分）・ダミーのハッシュ（応答時間をそろえる）もそのまま効く
                          └ 成功 → Bearer の仕組みがトークンを応答に書く（1時間）

以降の呼び出し: Authorization: Bearer <トークン>
  → トークンから利用者を読む（API が足したのはここだけ）
  → ユースケースの入口の Permissions.Require で、401 か 403 か通すか
```

- `AddSalesCoreApiIdentity`（API だけが呼ぶ）で Bearer の方式を登録した。ログインの成功で、Cookie でなくトークンを出す。
- パスワードとロックの規則は、画面の `AddSalesCoreIdentity` と同じ `ConfigureIdentity` の1か所を使う。片方だけ規則がずれる余地をなくした。
- 401 の応答に `WWW-Authenticate: Bearer` を付けた（前日の AI レビューの Minor）。

### 3. テスト（`ApiAuthenticationTests`、10件）

先に RED（API にログインが無いので7件落ちる）を見てから実装した。

- **権限の実効性:** 営業のトークンで締めると 403 で、請求書は0件のまま。同じ要求を経理のトークンで送ると締められる（201）。
- 正しいパスワードで、1時間（3600秒）のトークンを受け取る。
- 59分後は使え、60分で 401。テストの時計を進めて確かめた。
- パスワード違いと、利用者が無い時は同じ 401（理由の文言も同じ）。
- 5回間違えると、正しいパスワードでもロックで 401。
- 利用者名かパスワードが無い・空でも、500 でなく同じ 401（AI レビュー1回目の Minor で足した）。
- 無効にした利用者は、正しいパスワードでもトークンを受け取れない（AI レビュー2回目の Important で足した）。
- トークンが無ければ 401 で、`WWW-Authenticate: Bearer` が付く。
- トークンを付けた操作では、作成者にその利用者の Id が入る。
- 期限を延ばす口（`/account/refresh`）は無い（404）。

| 対照実験（入れた誤り） | 結果 |
|---|---|
| 締めの入口の検査を外す | 検出（営業でも締められる） |
| トークンの読み取りの仕組みを外す | 検出（4件） |
| 有効期限を2時間にする | 検出（2件） |
| ログインの成功で Cookie を出したまま | 検出（4件） |
| 401 に `WWW-Authenticate` を付けない | 検出（1件） |
| ログインの入口の null の検査を外す | 検出（1件。500 になる） |
| ログインの無効の確認を外す | 検出（1件） |
| `app.UseAuthentication()` を外す | **未検出** |
| 既定の認証方式の指定を外す | **未検出** |

- 未検出の2通りは、テストの抜けではなく .NET の仕組みだった。
  - `WebApplication` は、認証を登録していれば認証の処理を自分で差し込む。
  - 登録した認証の方式が1つだけなら、.NET がそれを自動で既定にする。
  - 実測した日付と一緒に、`UseAuthentication` の行にコメントで残した。

### 4. テストの配線の穴

- API のテストで、業務の DB への接続に「操作した人」の出どころが渡っていなかった。
- これまで API 経由で保存すると、作成者が空のままだった。本当にログインしたのに作成者が入らないことで気付いた。
- テストの配線を直した（本番のコードは問題なし）。「作成者にその利用者の Id が入る」をテストに足した。

### 5. AI レビュー（PR #12）

1回目はマージ可（$0.3444、65秒、Important 0件・Minor 4件）。直した後の2回目は修正後マージ可（$0.3368、52秒、Important 1件・Minor 3件）。3回目はマージ可（$0.4045、81秒、Minor 4件。うち PR の本文の件数は、レビューが編集前の本文を読んだもので、既に直っていた。残り3件は Day40 へ）。

| 指摘（Minor） | 対応 |
|---|---|
| 使う口の無い更新用のトークンが、ログインの応答に入って配られる | 口を足さないこと・足すと期限を延ばせる資格情報を既に配っていたことになることを、コメントで強めた |
| テストのログインで、失敗しても前のトークンが残る | 失敗したら前のトークンを外す |
| 利用者名・パスワードが無い時の振る舞いを HTTP で確かめていない | テストを足した。入口の null の検査を外すと落ちることを確かめた |
| テスト用のパスワードの定数 | 本物の資格情報ではない。今のコメントで足りる（対応なし） |
| **2回目 Important:** API は SignInManager の作り方が画面と違うのに、無効にした利用者を API で拒むテストが無い | テストを足した。無効の確認を外すと落ちることを確かめた |
| 2回目 Minor: 更新の口を足すと、配り済みのトークンが期限を延ばせる資格情報になる | 404 のテストのコメントに理由と「落ちたら本人に確かめる」を書いた |
| 2回目 Minor: Swagger から Bearer を付けて呼べない | 使い勝手の話で守りには関係しない。見送り |

### 6. 1週目（Day35〜39）の振り返り

計画シートの「段階2 1週目の振り返り」に書いた。予定の作業はすべて完了した。

| 指標 | 1週目の始め | 1週目の終わり |
|---|---|---|
| sales-core のテスト | Domain 147・アーキテクチャ 9・結合 45 | Domain 147・アーキテクチャ 14・Web 19・結合 89 |
| 権限 | 無し（API は誰でも全部できた） | 役割×ユースケースの全60通りを表から確かめる。API は本当のログインで 403 を確かめる |
| 本人に決めてもらったこと | ― | 7件。すべて作業の前に聞いた |
| AI レビュー | ― | PR 5件で14回（#8 3回・#9 3回・#10 2回・#11 3回・#12 3回） |

- **続けること:** 業務の判断は作業の前に聞く（聞き直しは0回）。テストの期待は文書から機械的に作る。検出しなかった対照実験も記録する。
- **繰り返した失敗:** 自分の対照実験は、自分が思いついた誤りしか入れていない。AI レビューが、その外にある抜けを毎日見つけた。
  - 2週目に試すこと: 対照実験の前に「テストが手で並べている範囲」と「どのテストも通らない経路」を1行ずつ書き出し、その外側の誤りを1つは入れる。
- 未完了は Day40 の先頭に書き写した。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- `dotnet test`: すべて成功
  - Domain 147
  - アーキテクチャ 14
  - Web 19
  - 結合 89（前日 79）
- CI: 成功
- 開発用 DB に対してのログインは試していない。初期の利用者がまだ無いため（user-secrets の `InitialUsers` は本人の作業）。

## 今日学んだこと

- **権限の実効性は、本物の経路で確かめる。**
  - Day38 の API のテストは、テストの利用者に差し替えて通していた。それでは「トークンから利用者を読む」所が壊れても気付けない。
  - 本当にログインしてトークンを付けて呼ぶと、ログイン・トークン・入口の検査・保存の作成者まで一続きで確かめられる。
  - 実際に、作成者が空のままという配線の穴が見つかった。
- **検出しなかった対照実験は、抜けか仕組みかを切り分ける。**
  - `UseAuthentication` を外しても、既定の方式を外しても、テストは緑のままだった。
  - 調べると、どちらも .NET が代わりにやっていた。テストを足しても守るものが無い。
  - 切り分けた結果をコメントに残すと、後で「この行は要るのか」と迷わない。
- **ログインの規則を1か所にまとめると、方式が違っても規則がずれない。**
  - 画面は Cookie、API はトークン。違うのは「成功した時に何を出すか」だけ。
  - パスワード・ロック・失敗の伝え方は、同じユースケースと同じ設定を通る。
- **応答の中身は1回しか読めない。**
  - テストで同じ応答の中身を2回読むと、「閉じたストリーム」の例外で落ちた。
  - 期待は先に1回だけ読んで変数に入れる。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| テストのログインの後、呼んだ側で応答を読むと「Cannot access a closed Stream」 | ログインの中で応答をストリームで読んだので、閉じられていた | 文字列で読む形にした |
| API 経由の保存で作成者が空 | テストが業務の DB への接続を差し替える時、「操作した人」の出どころを渡していなかった | 差し替えに出どころを渡す形にした |
| 足したテストで、また「Cannot access a closed Stream」 | 期待の応答の中身を、繰り返しの中で毎回読んでいた | 期待を先に1回だけ読む |
| 決定の記録が Study 側にできた | 会話の作業場所の関係（前日と同じ） | 秘密情報が無いことを見てから sales-core の `docs/decisions/` へ移した |

## 成果物

**sales-core**（タグ `day39`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day39/docs/domain/business-rules.md)（API のログイン・1時間・役割の変更）
- [src/SalesCore.Application/SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day39/src/SalesCore.Application/SalesCoreServices.cs)（`AddSalesCoreApiIdentity`・`ConfigureIdentity`）
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day39/src/SalesCore.Api/Program.cs)（`/account/login`・`WWW-Authenticate`）
- [tests/SalesCore.Integration.Tests/ApiAuthenticationTests.cs](https://github.com/kiyo015/sales-core/blob/day39/tests/SalesCore.Integration.Tests/ApiAuthenticationTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ApiTest.cs](https://github.com/kiyo015/sales-core/blob/day39/tests/SalesCore.Integration.Tests/ApiTest.cs)（本当のログイン・時計・操作した人の配線）
- [tests/SalesCore.Integration.Tests/FixedClock.cs](https://github.com/kiyo015/sales-core/blob/day39/tests/SalesCore.Integration.Tests/FixedClock.cs)
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day39/CLAUDE.md)（API の呼び方）
- [docs/decisions/2026-10-28.md](https://github.com/kiyo015/sales-core/blob/day39/docs/decisions/2026-10-28.md)（新規）
- [kiyo015/sales-core#12](https://github.com/kiyo015/sales-core/pull/12)

**Study**（タグ `day39`）
- [2026-10-28/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day39/2026-10-28/summary.md)
- [2026-10-28/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day39/2026-10-28/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day39/study_plan_next_month.md)（Day39・1週目の振り返り）

## 次回予告

**Day40 — 受注の承認の金額の基準**（段階2の2週目の始め）
- 税抜100万円以上の受注は管理者だけが承認できる。`PermissionTests` にも足す。

**持ち越し（Day40 の先頭に書き写した）**
- PR #12 の3回目の Minor: 期限切れの 401 にも `WWW-Authenticate` が付くことのテスト、Swagger の Bearer の定義、`SignInManager` の上書きが登録の順に頼っている
- 変更の後の再読込に掛かる参照の検査 → 検査の無い private の読み込みに分ける
- 検査の無い `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする
- 画面のボタンで役割が足りない時の表示、「権限がありません」の分岐の bUnit テスト
- 画面でのログイン成功の確認（開発用 DB に初期の利用者が要る）
- DbContext の寿命（Day41 の前）
- `.razor` の SALES001 の自動化
- Day47 の3件
- 次の guard-e2e: 11/02 9:00
