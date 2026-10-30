# Day41 学習記録（2026-10-30）— 画面の共通部品とマスタの画面

基幹システム開発計画の27日目で、段階2（画面と権限）の7日目。

- **先に決めたこと:** 画面での DbContext の寿命。本人が「操作ごとに作る」に決めた。直す前は、別の人が取り消した受注に、同じ画面から出荷を指示できた。
- **作り:** 例外を状態コードと理由に直す `OperationError` を API と画面の共通にした。画面には、役割に応じたメニューとエラーの表示を足した。
- **マスタ:** 得意先・商品・倉庫の一覧と登録（登録は管理者だけ）。入力の誤りは 400、重複は 409 で、どちらも理由が画面に出る。

**完了条件「管理者だけがマスタを登録でき、入力の誤りと重複が画面に分かる文言で出る」は達成した。** bUnit の画面のテストで確かめた。ユースケースは本物を使い、DB はテストのトランザクションを使う。

## 今日行った処理

### 1. 決めたこと

| 質問 | 本人の決定 |
|---|---|
| 画面（Interactive Server）では、DbContext がタブを開いている間ずっと1つのまま使い回される。操作をまたいで古いデータが残ったり、二重クリックで例外になったりする。どう直す？ | **操作ごとに作る。** ユースケースが呼ばれるたびに、`IDbContextFactory` から作って捨てる |
| 得意先の請求先に、別の得意先を請求先に持つ得意先（支店など）も指定できる？ | **請求先を持たない得意先だけ。** 請求先は1段まで |

- 決定は `docs/decisions/2026-10-30.md`、設計の文書、業務ルール集に書いた。
- 業務ルール集には、新しく「マスタの登録」の節を作った。
- 会話の要約の前（PreCompact）に、フックが Study 側にも同じ決定を書き出した。sales-core 側と同じ内容なので消した。

### 2. DbContext の寿命

先に RED を見た。`CircuitLifetimeTests` で、画面の回線と同じく、1つのユースケースのインスタンスで操作を続ける。

1. 承認する。
2. 別の人が取り消す。
3. 出荷を指示する。

**直す前は、3. が通った。** 前に読んだ「承認済」の受注が DbContext に残っていたため。

```
直す前: 回線 ── ユースケース ── DbContext（回線の間ずっと1つ）
直した後: 回線 ── ユースケース ── 工場 ─┬ 操作1 の DbContext（作って捨てる）
                                         └ 操作2 の DbContext（作って捨てる）
```

- `AddDbContextFactory(..., ServiceLifetime.Scoped)` にした。工場を scoped にするのは、利用者（監査の記録に残す人）を接続ごとに分けるため。
- 各ユースケースの public の操作は、最初に `await using var db = await sessions.CreateDbContextAsync();` で DbContext を作る。
- 変更の後の読み直しは、参照の検査の無い private の読み込みに分けた（Day38 からの持ち越し）。
- 同じ操作が重なった時（二重に押した時）は、後の方の保存が版数で止まる（409）。
- `AddDbContextFactory` は DbContext そのものも DI に登録する。だから、ユースケースが DbContext を直接受け取ってもビルドも DI も通ってしまう。これは `UseCaseDbContextTests`（アーキテクチャテスト）で止める。AI レビュー2回目の指摘で足した。

### 3. 共通部品

| 部品 | 役割 |
|---|---|
| `OperationError`（Application） | 例外を状態コードと理由に直す。401・403・404・400・409、版数の衝突も 409。一意インデックスの違反は、制約ごとの理由で 409 にする。業務の誤りでないものは null を返し、API は 500 にする |
| `OperationPage`（画面の基底） | 操作を `RunAsync` で包む。誤りは `Error` に入れ、業務の誤りでない例外は中身を見せずに記録する |
| `ErrorMessage.razor` | 状態ごとの見出しと理由を出す。`data-status` に状態コードを持つ |
| `NavMenu.razor` | 役割に応じたメニュー。出すかどうかは、入口の検査と同じ表で決める（`Permissions.Allows`） |

- API の例外の扱いも `OperationError` に寄せた。画面と API で、同じ誤りが同じ状態コードと理由になる。
- 一意インデックスは11本ある。どれかの理由を書き忘れると `OperationErrorTests` が落ちる（段階1からの持ち越し）。

### 4. マスタ

- `MasterUseCases`: 得意先・商品・倉庫・税区分の一覧（全員が見られる）。得意先・商品・倉庫の登録（管理者だけ）。
- 入力の決まりは Domain に置く。誤りは `InvalidInputException`（400）にする（段階1からの持ち越し）。
  - 空にできない。
  - 長さは、コード20・名前100・単位10。文字数で数え、「𠮷」も1文字とする。
  - コードの前後に空白は入れられない。
  - 標準単価は0以上・小数2桁まで・整数部13桁まで（DB の列は `numeric(15,2)`）。
  - 締め日。
  - 請求先は1段まで。
- コードの重複は 409 にする。無効にしたマスタのコードも使えない。
  - 先に確かめて「得意先コード C001 は既に登録されている」と返す。
  - 同時に登録された時は DB の一意インデックスに当たる。この時も制約ごとの理由で 409 にする。
- 画面: `/masters/customers`・`/masters/products`・`/masters/warehouses`。
  - 登録の欄は管理者にだけ出す。
  - 請求先の選択肢には、請求先を持たない得意先だけを出す。
  - 標準単価が数でなければ、ユースケースを呼ばずに入力欄で止める。

### 5. テスト

- RED を見てから実装したもの:
  - DbContext の寿命: 1件
  - Domain の入力: 24件（AI レビューの後に、さらに4件）
  - マスタと誤りの扱い: 18件
  - 設定の空文字: 1件
- `MasterPageTests`（bUnit）:
  - 管理者が登録すると一覧に出る。
  - 重複は 409 で、「今の状態ではできません」の見出しと理由が出る。
  - コードが空なら 400 で理由が出る。
  - 営業・経理には登録の欄が出ず、一覧は見える。
  - 役割の無い利用者には 403 の理由が出る。
- `PermissionTests` に、マスタの参照・登録の行を足した。
- 振り返りで決めた「どのテストも通らない経路を先に書き出す」を今日も試し、2つ見つけてテストを足した。
  - ユースケースの DI の登録を忘れる経路: `ServiceRegistrationTests`
  - 画面が静的に描かれる経路（ボタンが動かない）: `RenderModeTests`

| 対照実験（入れた誤り） | Domain | Web | 結合 |
|---|---|---|---|
| **DbContext を操作をまたいで使い回す** | ― | ― | 2 |
| DbContext の工場を全員で共有する（singleton） | ― | ― | 1（テストを足す前は 0） |
| 長さを確かめない | 7 | 0 | 1 |
| 請求先の2段を許す | 1 | 0 | 2 |
| 重複の事前の確かめを外す | 0 | 0 | 4 |
| 登録を全員に許す | 0 | 0 | 3 |
| 一意の制約の扱いを外す | 0 | 0 | 3 |
| 制約ごとの理由を汎用にする | 0 | 0 | 1 |
| 登録の欄を全員に出す | 0 | 0 | 3 |
| 誤りを画面に出さない | 0 | 5 | 4 |
| メニューを全員に出す | 0 | 1 | 0 |
| ユースケースの登録を忘れる | 0 | 0 | 2 |
| 画面を静的に描く | 0 | 1 | 2 |
| 請求先の選択肢を絞らない | 0 | 0 | 2 |
| 単価の端数を確かめない | 1 | 0 | 0 |
| API の誤りの扱いを外す | 0 | 0 | 20 |
| ユースケースが DbContext を直接受け取る | ― | ― | アーキテクチャ 1 |

- 17通りすべてを検出した。数字は、その誤りで落ちたテストの件数。
- **工場の singleton は、最初は検出しなかった。** 利用者を接続ごとに分けることを確かめるテストが無かった。テストを足してから検出した。

### 6. 前日の持ち越し（PR #13 の Minor）

- 設定 `SalesCore:ApprovalThreshold` が空文字だった時、黙って既定の100万円で動いていた。起動の時に止めるようにした（空白、「百万」も同じ）。
- 明細を変える操作を作る時に、承認待ちの判定をし直すかどうかを決める。業務ルール集「9.」に書いた。
- 残りは Day42 の先頭に書き写した。

### 7. CI と AI レビュー（PR #14）

**CI の1回目で、`MasterPageTests` の商品の登録が落ちた。**

- 手元の Release で、5回中2回再現した。
- 画面の中身を書き出して見た。名前・単位・単価の入力が反映される前に、送信していた（bUnit の中で、入力の後の描き直しと次の操作が重なった）。
- 入力のたびに、値が画面に入ったのを見てから次へ進む形にした。直した後、Release で6回続けて通った。
- 待つ時間を10秒にしただけでは直らなかった。

AI レビューは3回で、どれもマージ可だった。

| 回 | 費用・時間 | Minor | 対応 |
|---|---|---|---|
| 1回目 | $0.7151・91秒 | 5件 | 4件を直した: コードの前後の空白、長さを文字数で数える、整数部13桁、コメントの節の名前。無効にした得意先を請求先にしてよいかは、無効にする操作を作る時に決める（業務ルール集「9.」） |
| 2回目 | $0.6823・72秒 | 3件 | すべて直した: `UseCaseDbContextTests`、税区分の一覧は全員が見られることを業務ルール集に書く、請求先の読み込みの前提をコメントに書く |
| 3回目 | $0.6813・75秒 | 4件 | Day42 に持ち越した（下の「次回予告」） |

- Important は3回とも0件。
- 直すたびに CI と AI レビューがもう1回まわるので、Day39 と同じく3回目で区切った。

### 確認

- Release ビルド（警告もエラー）: 警告0件
- `dotnet test`: すべて成功、合計370件（前日 296件）

  | 対象 | 件数 | 前日 |
  |---|---|---|
  | Domain | 181 | 157 |
  | アーキテクチャ | 16 | 14 |
  | Web | 31 | 19 |
  | 結合 | 142 | 106 |

- CI: 成功（3回目）
- `dotnet ef migrations list` は、工場で登録しても DbContext を見つけた。
- `CLAUDE.md` の禁止の表に「操作をまたいでデータを持ち越す」の行を足した（`CircuitLifetimeTests`・`UseCaseDbContextTests` で止める）。
- **ブラウザでの確認はしていない。** 開発用 DB に初期の利用者が無いため。user-secrets の `InitialUsers` を置くのは本人の作業。

## 今日学んだこと

- **長く生きる画面では、DB の接続の寿命が業務の誤りになる。**
  - API ではリクエストごとに DbContext ができるので、この問題は起きなかった。
  - 画面（Interactive Server）では回線の間ずっと同じ DbContext が生きる。別の人が取り消した受注を「承認済」のまま見て、出荷を指示できた。
  - 例外にもならず黙って通るので、テストで再現するまで気付けない。
- **便利な登録が、禁止したい形まで通してしまう。**
  - `AddDbContextFactory` は DbContext そのものも登録する。だから、DbContext を直接受け取る古い形に戻しても、ビルドも DI も通る。
  - 決めた形を守らせるには、アーキテクチャテストで止める。これは AI レビューが見つけた。
- **画面のテストの不安定さは、待つ時間でなく、待つ対象で直す。**
  - 待つ時間を延ばしても直らなかった。
  - 入れた値が画面に入ったのを待つようにして直った。CI の Release でだけ出る順の違いだった。
- **対照実験で0件になったら、まず確かめるテストが無いことを疑う。**
  - 工場を singleton にしても、最初はどのテストも落ちなかった。
  - 利用者が接続ごとに分かれることを確かめるテストが無かった。足すと検出した。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 編集用の Python をヒアドキュメントで渡すと途中で切れた | シェルの受け渡しで長い文字列が崩れた | スクリプトをスクラッチパッドにファイルで書いてから実行した |
| `decimal.Round` がビルドエラー（RS0030） | 段階1で丸めの API を禁止している | `* 100m % 1m` で端数を確かめる形にした |
| 監査の action を `Modified` で比べてテストが落ちた | 実際の値は `updated` | 実際の値に直した |
| bUnit で `UnknownEventHandlerIdException` | 描き直すと、前に探した要素の操作の口が無くなる | 入力のたびに要素を探し直した |
| CI で商品の登録のテストが落ちた | 入力が反映される前に送っていた | 値が入ったのを待つ形にした（上の「7.」） |
| デバッグで書き出した `markup-debug.html` をコミットした | 書き出し先を作業ツリーにしていた | 秘密情報が無いことを確かめてから、次のコミットで消した |
| 一度だけ、DB のテストがすべて準備の段階で落ちた | 不明（再現しない） | Day42 で見張る |

## 成果物

**sales-core**（タグ `day41`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day41/docs/domain/business-rules.md)（マスタの登録・9. 決めていないこと）
- [docs/specs/2026-10-22-stage2-screens-and-permissions-design.md](https://github.com/kiyo015/sales-core/blob/day41/docs/specs/2026-10-22-stage2-screens-and-permissions-design.md)（DbContext の寿命）
- [docs/decisions/2026-10-30.md](https://github.com/kiyo015/sales-core/blob/day41/docs/decisions/2026-10-30.md)（新規）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day41/CLAUDE.md)（禁止の表）
- [src/SalesCore.Application/SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Application/SalesCoreServices.cs)（工場）
- [src/SalesCore.Application/MasterUseCases.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Application/MasterUseCases.cs)・[MasterContracts.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Application/MasterContracts.cs)（新規）
- [src/SalesCore.Application/OperationError.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Application/OperationError.cs)（新規）
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Application/Permissions.cs)（`Allows`）
- [src/SalesCore.Domain/Masters.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Domain/Masters.cs)・[Customer.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Domain/Customer.cs)（入力の決まり）
- [src/SalesCore.Web/Components/Shared/OperationPage.cs](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Web/Components/Shared/OperationPage.cs)・[ErrorMessage.razor](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Web/Components/Shared/ErrorMessage.razor)・[NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day41/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [src/SalesCore.Web/Components/Pages/Masters/](https://github.com/kiyo015/sales-core/tree/day41/src/SalesCore.Web/Components/Pages/Masters)（得意先・商品・倉庫）
- [tests/SalesCore.Integration.Tests/CircuitLifetimeTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Integration.Tests/CircuitLifetimeTests.cs)・[MasterPageTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Integration.Tests/MasterPageTests.cs)・[MasterTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Integration.Tests/MasterTests.cs)・[OperationErrorTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Integration.Tests/OperationErrorTests.cs)・[ServiceRegistrationTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Integration.Tests/ServiceRegistrationTests.cs)
- [tests/SalesCore.Architecture.Tests/UseCaseDbContextTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Architecture.Tests/UseCaseDbContextTests.cs)・[tests/SalesCore.Web.Tests/SharedComponentTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Web.Tests/SharedComponentTests.cs)・[RenderModeTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Web.Tests/RenderModeTests.cs)
- [tests/SalesCore.Domain.Tests/MasterTests.cs](https://github.com/kiyo015/sales-core/blob/day41/tests/SalesCore.Domain.Tests/MasterTests.cs)
- [kiyo015/sales-core#14](https://github.com/kiyo015/sales-core/pull/14)

**Study**（タグ `day41`）
- [2026-10-30/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day41/2026-10-30/summary.md)
- [2026-10-30/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day41/2026-10-30/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day41/study_plan_next_month.md)（Day41）

## 次回予告

**Day42 — 受注の画面**
- 受注の一覧・詳細・登録（明細の入力。標準単価を既定にし、上書きできる）、承認・取消。
- DB の桁あふれを 400 にする、出力の型の整理（Day30 からの持ち越し）。
- 今日の共通部品（`OperationPage`・`ErrorMessage`・`Permissions.Allows`）をそのまま使う。

**持ち越し（Day42 の先頭に書き写した）**
- PR #14 の AI レビュー3回目の Minor:
  - 標準単価が空欄なら、画面で止める（0円そのものは正しい値として残す）。
  - `Products.razor` のコメントを直す（確かめるのは Domain）。
  - 税区分が空なら、先に「税区分を選ぶ」を返す。
  - 業務ルール集の「API も 400」を「API を作る時も同じ」に書き直す。
- 画面の起動の時の設定の確かめにテストが無い。
- Swagger の Bearer の定義。`SignInManager` の上書きが登録の順に頼っている。
- `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする。
- `Routes.razor` の「権限がありません」の分岐の bUnit テスト。
- 画面でのログイン成功の確認（本人が `InitialUsers` を置いてから）。
- `.razor` の SALES001 の自動化、Day47 の3件。
- 無効にした得意先を請求先にしてよいか（無効にする操作を作る時に決める）。
- 一度だけ起きた、DB のテストがすべて準備の段階で落ちた件（原因不明）。
- 次の guard-e2e: 11/02 9:00。
