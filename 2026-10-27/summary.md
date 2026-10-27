# Day38 学習記録（2026-10-27）— 権限の検査（ユースケースの入口）

基幹システム開発計画の24日目で、段階2（画面と権限）の4日目。

- **決めたこと:** 本人が決めた。
  - ログインしていなければ、画面も API も、どの操作もできない。
  - 表に無い操作は管理者だけができる。
  - 参照の行を足した。
- **入口の検査:** 業務ルール集の役割の表を、すべての公開ユースケース（10）の最初の行で強制した。画面も API も同じユースケースを通るので、両方の経路に効く。
- **テスト:** 業務ルール集の表をそのまま読んで期待を作る。全組み合わせ（60通り）を確かめる。

**完了条件「役割×ユースケースの全組み合わせのテストが通り、仕込んだ誤りがすべて検出される」は達成した。** 対照実験は10通りで、すべて検出した。

## 今日行った処理

### 0. 定期実行の確認

- 9:30 の健康診断は走り、14件すべて正常だった。
- 前日に「逃した回を後で行う」を有効にしてから、逃した回は 0。

### 1. 決めたこと（業務ルール集「8.」の「役割」）

前日の AI レビューで「最初に本人に決めてもらう」とされた2点を、作業の前に聞いた。

| 質問 | 本人の決定 |
|---|---|
| 入口で検査すると、ログインの仕組みがまだ無い API は全部拒まれる。どうする？ | **今日から API も拒む。** API は Day39 でログインを付けるまで使えない |
| 表に無い参照（マスタ・売上・監査ログ）と、表に無い操作の扱いは？ | **マスタと売上の参照は全員、監査ログの参照は管理者だけ。** 表に無い操作は管理者だけ（書き忘れた時に、拒む側に倒す） |

- 承認の金額の基準（税抜100万円以上は管理者）は Day40 で強制する。それまでは、営業も金額を問わず承認できる。この扱いも業務ルール集に書いた。
- 返品の行の注記は表の外へ移した。テストが表を機械的に読むため。

### 2. 入口の検査

```
画面（Blazor） ─┐
                 ├→ ユースケースの最初の行で Permissions.Require(利用者, 操作)
API ────────────┘     ├ ログインしていない → UnauthenticatedException → API は 401
                      └ 役割が足りない     → ForbiddenException      → API は 403
```

- `ICurrentUser`（ログインしているか・役割）は、前日の `ICurrentUserSource`（操作した人の Id）を広げたもの。
  - `LoggedInUser` 1つが両方を担う。
  - 権限を検査する利用者と、作成者として記録する利用者がずれない。
- 判定は「付いた役割のどれかが許されていれば通す」（できる操作は役割の合計）。
- 承認と取消は共通の処理を通る。この処理は操作を引数で受け、DB を読む前に検査する。
- API のテストは、テストの利用者（既定は管理者）を差し替えて通す。

### 3. テスト（業務ルール集の表をそのまま読む）

- `PermissionTests` は `business-rules.md` の表から期待を作る。
- 10 のユースケース × 6 通りの利用者で **60 通り**。
  - 利用者: 営業・経理・管理者・営業＋経理・役割なし・未ログイン
- 権限の検査を通れば、存在しない id などで別の例外になる。それで「通った」と分かる。
- 次のどれをしても、テストが止める。
  - 表の行を足したのに、ユースケースへの対応を書いていない
  - 公開メソッドを足したのに、どの行に当たるかを書いていない
  - 表に無い操作（今は無いので、テストの中で作る）を管理者以外に許す
  - ユースケースのクラスを新しく足したのに、対応を書いていない
- 先に RED（検査が何もしない状態）で落ちることを見てから実装した。

| 対照実験（入れた誤り） | 結果 |
|---|---|
| 締めの入口の検査を外す | 検出 |
| 締めを営業にも許す | 検出 |
| ログインの確認を外す | 検出 |
| 「どれかの役割」を「全部の役割」にする（Any→All） | 検出 |
| 出荷の参照で別の操作を検査する | 検出 |
| 承認で別の操作を検査する | 検出 |
| 業務ルール集の表だけを変える | 検出 |
| 公開メソッドを足し、表との対応を書かない | 検出 |
| 表に無い操作の既定を「全員」にする | 検出（AI レビュー1回目の後に足した） |
| 新しいユースケースのクラスを足し、表との対応を書かない | 検出（AI レビュー2回目の後に足した） |

- HTTP の段階でも確かめた。
  - 未ログインは 401。
  - 経理が受注を登録しようとすると 403。理由に「営業・管理者」と出る。

### 4. 前日の AI レビューの Minor

- 対話的な画面遷移で未ログインなら、元の画面を戻り先にしてログインの画面へ送る（`RedirectToLogin`）。
  - bUnit のテストで確かめた: `/sales-orders/1?tab=lines` → `account/login?ReturnUrl=%2Fsales-orders%2F1%3Ftab%3Dlines`
  - ログインしていて役割が足りない場合は「権限がありません」と出す。
- 「決めていない役割」のテストで、利用者が作られていないことも確かめる。
- コメントを2か所足した。

### 5. AI レビュー（PR #11）

1回目はマージ可（$0.4180、81秒、Minor 5件）。直した後の2回目は修正後マージ可（$0.4051、73秒、Important 1件・Minor 3件）。3回目はマージ可（$0.4226、84秒、Minor 6件。すべて Day39 へ持ち越し）。

| 指摘 | 対応 |
|---|---|
| PR の本文の件数が違う（11 → 10、66 → 60） | 直した。締めの前の報告も同じ誤りだった |
| 「表に無い操作は管理者だけ」を守るテストが無い。全操作が表にあるので、既定の経路を通らない | テストを足した。既定を全員にする対照実験で検出した |
| `IsInRole` が、利用者を2回取り直す | 1回だけ取ってから判定する形にした |
| `CurrentUserTests` の2つ目は、本番では起きない組み合わせ | 「操作した人のいない保存」（起動時の処理など）として、名前とコメントで位置づけを書いた（2回目でも指摘） |
| 画面のボタンで役割が足りない時の表示を確かめてほしい | Day39 へ持ち越し |
| **2回目 Important:** 公開メソッドの足し忘れの検査が、手書きの2クラスだけ。新しいクラスを作ると検査が漏れる | 名前が `UseCases` で終わる公開クラスをすべて集める形にした。検査を掛けないメソッド（ログインそのもの・起動時の処理）は、メソッドごとに理由を付けて書く |
| 2回目 Minor: 変更の後の再読込にも参照の検査が掛かる。参照を絞ると「保存されたのに 403」になりうる | Day39 へ持ち越し |
| 2回目 Minor: 役割を外しても、Cookie の再検証までは前の役割で操作できる | 業務ルール集「9.」に足す。利用者の管理を作る日に決める |

### 6. 決定の記録の置き場所

- 会話を要約する前に、決定の記録が自動で書き出された。
- 会話の作業場所の関係で、Study 側（`docs/decisions/`）にできていた。
- 中身に秘密情報が無いことを見てから、sales-core の `docs/decisions/` へ移した（決定の記録の正しい置き場所）。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- `dotnet test`: すべて成功
  - Domain 147
  - アーキテクチャ 14
  - Web 19（前日 18）
  - 結合 79（前日 73）
- CI: 成功

## 今日学んだこと

- **期待を、業務ルール集の表から機械的に作る。**
  - テストの中に期待を手で書き写すと、文書とコードのずれを見逃す。
  - 表を読めば、表だけを変えた時も落ちる（対照実験で確かめた）。
  - 文書が「唯一の定義元」であることを、テストが守る形になる。
- **「全組み合わせ」は、組み合わせの元の漏れも止めて初めて全部になる。**
  - 元を手で並べると、並べた範囲しか守れない。2回目のレビューで、新しいクラスが漏れることを指摘された。元はアセンブリから集める。
  - 表の行の漏れと、公開メソッドの漏れを、別のテストで止めた。
  - 新しいユースケースを足した日に、検査を書き忘れても気付ける。
- **決めたのに、通らない経路がある。**
  - 「表に無い操作は管理者だけ」は、全操作が表にある今は、どのテストも通らない。
  - 既定を壊してもテストは緑のままだった。AI レビューに言われて気付いた。
  - 通らない経路は、テストの中で作って通す。
- **数を数えて報告する時は、数えた結果を見る。**
  - 承認と取消は、共通の処理で1回検査する。
  - そのため、検査の行の数（9）・公開メソッドの数（10）・自分の思い込み（11）がずれた。
  - テストが確かめた件数を、そのまま報告に使えばよかった。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| ユースケースのファイルの置き換えが空振りした | 改行が CRLF だった | 改行に合わせて流し直した。空振りの時点では、どのファイルも変わっていない |
| 報告と PR の本文で、件数が 11・66 になった | 公開メソッドの数を数えず、検査の箇所から思い込みで数えた | AI レビューで気付いて直した。件数はテストの結果から書く |

## 成果物

**sales-core**（タグ `day38`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day38/docs/domain/business-rules.md)（役割の表・未ログイン・表に無い操作）
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Application/Permissions.cs)（新規）
- [src/SalesCore.Application/ICurrentUser.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Application/ICurrentUser.cs)（新規）
- [src/SalesCore.Application/LoggedInUser.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Application/LoggedInUser.cs)
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Application/SalesOrderUseCases.cs)
- [src/SalesCore.Application/InvoiceUseCases.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Application/InvoiceUseCases.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Api/Program.cs)（401・403）
- [src/SalesCore.Web/Components/Account/RedirectToLogin.razor](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Web/Components/Account/RedirectToLogin.razor)（新規）
- [src/SalesCore.Web/Components/Routes.razor](https://github.com/kiyo015/sales-core/blob/day38/src/SalesCore.Web/Components/Routes.razor)
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day38/tests/SalesCore.Integration.Tests/PermissionTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/ApiPermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day38/tests/SalesCore.Integration.Tests/ApiPermissionTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/TestUser.cs](https://github.com/kiyo015/sales-core/blob/day38/tests/SalesCore.Integration.Tests/TestUser.cs)（新規）
- [tests/SalesCore.Web.Tests/RedirectToLoginTests.cs](https://github.com/kiyo015/sales-core/blob/day38/tests/SalesCore.Web.Tests/RedirectToLoginTests.cs)（新規）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day38/CLAUDE.md)（禁止事項に「役割の表に無いことをする」）
- [docs/decisions/2026-10-27.md](https://github.com/kiyo015/sales-core/blob/day38/docs/decisions/2026-10-27.md)（新規）
- [kiyo015/sales-core#11](https://github.com/kiyo015/sales-core/pull/11)

**Study**（タグ `day38`）
- [2026-10-27/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day38/2026-10-27/summary.md)
- [2026-10-27/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day38/2026-10-27/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day38/study_plan_next_month.md)

## 次回予告

**Day39 — API の認証と権限の実効性テスト、1週目の振り返り**
- API に認証を付ける。
- 「営業が経理の締めの API を呼ぶと 403」を、検査を外した場合と比べて確かめる（対照実験の形）。
- 1週目の振り返りをする。

**持ち越し**
- AI レビューの Minor
  - 変更の後の再読込に掛かる参照の検査
  - 役割を外した時の反映の遅れ（業務ルール集「9.」）
  - 3回目: `LoggedInUser` のコメントの言い過ぎ、検査の無い `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にして入口を狭める、決定の記録の答え漏れ（表に無い操作は管理者だけ）、401 の `WWW-Authenticate`
  - 画面のボタンで役割が足りない時の表示
  - 「権限がありません」の分岐の bUnit テスト
- 画面でのログイン成功の確認（開発用 DB に初期の利用者が要る）
- DbContext の寿命（Day41 の前）
- `.razor` の SALES001 の自動化
- Day40 の金額の基準（PermissionTests にも足す）
- Day47 の3件
- 次の guard-e2e: 11/02 9:00
