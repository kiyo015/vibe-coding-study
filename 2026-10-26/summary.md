# Day37 学習記録（2026-10-26）— 役割と操作した人

基幹システム開発計画の23日目で、段階2（画面と権限）の3日目。

- **役割:** 3つ（営業・経理・管理者）を作り、役割×操作の表を業務ルール集に書いた。どれも本人が決めた。
- **操作した人:** 作成者・更新者・監査ログに、ログインした利用者の Id が入るようにした。
- **定期実行:** 朝、初めての週1回の実行（guard-e2e）が、PC が寝ていたために飛ばされていたことを見つけた。設定を直し、本人のログインの後に無人で走らせた。

**完了条件「受注を登録すると、監査ログと作成者に、ログインした利用者が入ることを結合テストで確かめる」は達成した。** 先に null の RED を見てから直した。

## 今日行った処理

### 0. 定期実行の確認（前日からの持ち越し）

| 見たこと | 分かったこと | 対応 |
|---|---|---|
| 10/26 9:00 の guard-e2e と 9:30 の健康診断 | **どちらも走っていない**（missed=1）。PC は 10/15 から起動したままで、寝ていた。逃した回を後で行う設定（StartWhenAvailable）が無効だった | 本人の許可を得て、2つのタスクで有効にした（PC は起こさない） |
| 10/25 の健康診断の異常1件 | 未適用のマイグレーションの確認が **300秒で打ち切り**（出力は「Build started...」だけ）。翌日は 94秒＋35秒で成功し、原因は特定できなかった | 直前の `dotnet test` がビルド済みなので `--no-build` にした。**13秒＋12秒**になった |
| 同じ日の、異常時の AI の要約 | 「OAuth session expired」。10/20 のログインから5日で切れた | 本人の決定で `/login` のまま。本人が `/login` した |
| 1回目の `/login` の後 | まだ失敗。資格情報のファイル（`~/.claude/.credentials.json`）の更新日時は 10/23 のまま | ログインした先が、ターミナルの CLI ではなかった。ターミナルの `claude` でやり直してもらい、ファイルが 11:11 に更新されて成功した |
| guard-e2e を手で起動（タスクスケジューラから） | **7セルすべて合格**、11:13〜11:18、$0.0645 | 健康診断の「8日以内」も満たす |

### 1. 決めたこと（業務ルール集「8.」の「役割」）

**本人の決定**
- 役割は営業・経理・管理者の3つ。1人に複数付けられ、できる操作は付いた役割の合計。
- 役割×操作の表は推奨のとおり。返品は、AI レビューの指摘で足した（営業と管理者。出荷を扱う人にそろえる）。

| 操作 | 営業 | 経理 | 管理者 |
|---|---|---|---|
| 受注・出荷・請求書の参照 | ○ | ○ | ○ |
| 受注の登録・取消／承認（100万円未満） | ○ | ― | ○ |
| 受注の承認（100万円以上） | ― | ― | ○ |
| 出荷の指示・確定・取消、返品 | ○ | ― | ○ |
| 締め請求 | ― | ○ | ○ |
| マスタ・利用者の管理 | ― | ― | ○ |

- 「操作した人」には、ログインした利用者の Id を入れる（利用者名は変わりうるので使わない）。
- 設計の文書にあった役割の表は消し、業務ルール集を唯一の定義元にした。
- 前回の AI レビューの持ち越しで、「外部キーはすべて RESTRICT」を書き分けた。RESTRICT が止めるのは子の行がある時だけなので、「削除の操作を作らないことで守る」とした。

### 2. 操作した人

| 部品 | 置き場所 | すること |
|---|---|---|
| `ICurrentUserSource` | Infrastructure | 操作した人の出どころの口。業務の DbContext が保存の時に読む |
| `LoggedInUser` | Application | 画面の対話中は Blazor の認証の状態、それ以外は HTTP の利用者の `NameIdentifier`（= `AspNetUsers.Id`） |
| 登録 | `AddSalesCore` | 画面も API も同じ。API はまだログインが無いので空 |

- 口を Infrastructure、中身を Application に分けたのは、業務の DbContext（Infrastructure）が Application を参照できないため（依存の向き）。画面は Application を呼ぶだけなので、画面の層の検査（`WebLayerTests`）も通る。
- **テスト（RED の null を見てから直した）**
  - ログインした利用者で受注を登録すると、作成者と監査ログにその Id が入る。
  - ログインしていなければ空のまま。
  - `AddSalesCore` で作る DbContext が、登録した出どころを使う。
  - `LoggedInUser` は、対話中・HTTP・未ログイン・「Blazor の状態が未ログインなら HTTP の古い利用者に戻らない」の4件。

### 3. 役割と画面

- 役割は起動の時に用意する（どの環境でも。何度呼んでも増えない）。作成に失敗したら起動を止める。
- 初期の利用者に役割を付けられる（`InitialUsers:0:Roles:0`）。
  - 決めていない役割は拒む（利用者が既にいても）。
  - 重複は除く。
  - 役割がまだ無ければ、利用者を作る前に止まる。
- ログインした利用者の情報（クレーム）に表示名を足し、画面の上部に出す。
- `Routes.razor` を `AuthorizeRouteView` にした（対話的な画面遷移でも `[Authorize]` を効かせるため）。

### 4. 対照実験

| 入れた誤り | 結果 |
|---|---|
| 利用者の Id の代わりに利用者名を読む | `LoggedInUserTests` の2件が失敗 |
| 役割を付け忘れる | 役割のテストが失敗 |
| （AI レビューが見つけた誤り）役割を用意する前に役割付きの利用者を作る | 直す前は、役割の無い利用者が黙って残った（RED） |

### 5. AI レビュー（[kiyo015/sales-core#10](https://github.com/kiyo015/sales-core/pull/10)）

| 回 | 判定 | 主な指摘と対応 |
|---|---|---|
| 1回目（$0.3369・59秒） | 修正後マージ可 | **役割の付与・作成の失敗を握りつぶす**（直した）、**役割の表に返品が無い**（本人に確かめて足した）、Blazor の状態が未ログインでも HTTP の利用者に戻る（直した） |
| 2回目（$0.3533・62秒） | マージ可 | Minor 7件。PR の本文のテストの件数を直した。ほかは Day38 へ |

## 今日学んだこと

- **定期実行は「設定した時刻に PC が起きている」ことを前提にしていた。** 寝ていた回は黙って飛ばされ、ログにも何も残らない。毎日の健康診断が guard-e2e の古さ（8日）を見ているので、いずれ NG で気付けた。ただ、その前に `NumberOfMissedRuns` で見つけられた。
- **「ログインした」と「CLI がログインした」は別のことがある。** 資格情報のファイルの更新日時（中身は見ない）で、どちらにログインしたかを確かめられた。
- **成功を返す API の戻り値を見ないと、失敗が黙って消える。** Identity の `CreateAsync`・`AddToRolesAsync` は例外でなく結果を返す。役割の無い利用者が残る不具合を、AI レビューが見つけた。
- **口と中身を分けると、依存の向きを崩さずに済む。** DbContext（Infrastructure）が「今の利用者」を知る必要があったが、Application の型は参照できない。口を下の層に置いた。

## つまずき

- 1回目の `/login` が CLI に効いていなかった（上の表）。資格情報のファイルの更新日時で切り分けた。
- コードの書き換えを Edit ツールに寄せたので、シェル経由のエスケープの崩れは起きなかった。

## 成果物

**sales-core**
- [business-rules.md](https://github.com/kiyo015/sales-core/blob/day37/docs/domain/business-rules.md) — 「役割」
- [ICurrentUserSource.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Infrastructure/Persistence/ICurrentUserSource.cs)
- [SalesCoreDbContext.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Infrastructure/Persistence/SalesCoreDbContext.cs)
- [LoggedInUser.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Application/LoggedInUser.cs)
- [Roles.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Application/Roles.cs)
- [AccountUseCases.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Application/AccountUseCases.cs)
- [SalesCoreClaimsFactory.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Application/SalesCoreClaimsFactory.cs)
- [SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Application/SalesCoreServices.cs)
- [Web/Program.cs](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Web/Program.cs)
- [Routes.razor](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Web/Components/Routes.razor)
- [MainLayout.razor](https://github.com/kiyo015/sales-core/blob/day37/src/SalesCore.Web/Components/Layout/MainLayout.razor)
- [CurrentUserTests.cs](https://github.com/kiyo015/sales-core/blob/day37/tests/SalesCore.Integration.Tests/CurrentUserTests.cs)
- [AccountTests.cs](https://github.com/kiyo015/sales-core/blob/day37/tests/SalesCore.Integration.Tests/AccountTests.cs)
- [LoggedInUserTests.cs](https://github.com/kiyo015/sales-core/blob/day37/tests/SalesCore.Web.Tests/LoggedInUserTests.cs)
- [段階2の設計](https://github.com/kiyo015/sales-core/blob/day37/docs/specs/2026-10-22-stage2-screens-and-permissions-design.md)
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day37/CLAUDE.md)

**Study**
- [health-check.js](https://github.com/kiyo015/vibe-coding-study/blob/day37/checks/health-check.js) — `--no-build`

## 次回予告

**Day38 — 権限の検査（ユースケースの入口）**
- 役割の表を、ユースケースの入口で強制する。
- 役割×ユースケースの全組み合わせのテストと、対照実験。

**Day38 の前に決めること（AI レビュー2回目の Minor）**
- ログインの無い API（段階1）を、権限の検査で拒むか、Day39 まで除外するか。
- 表に無い参照（マスタ・売上・監査ログ）を、誰ができるか。表に無い操作の既定。

**持ち越し**
- 「決めていない役割」のテストで、利用者が作られていないことも確かめる。
- `CurrentUser = null` を明示しても出どころに戻ることを、コメントに書く。
- 認証の状態の Task が未完了の時に、HTTP の利用者に戻る理由をコメントに書く。
- 対話的な画面遷移で、未ログインならログインの画面へ送る。
- 前日からの持ち越し: 画面でのログイン成功の確認（初期の利用者が要る）、DbContext の寿命（Day41 の前）、`.razor` の SALES001 の自動化、Day47 の3件。
