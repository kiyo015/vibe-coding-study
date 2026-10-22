# Day35 学習記録（2026-10-22）— 段階2の設計と画面の骨格

基幹システム開発計画の21日目で、段階2（画面と権限）の1日目。設計の文書を書き、Blazor（Interactive Server）の画面の骨格と bUnit のテストを作った。画面から Domain を直接使う誤りはアーキテクチャテストで止める。画面を足したことで、金額の決まりと dev-guard に `.razor` の穴が2つ見つかり、塞いだ。

**完了条件「Web が起動し、空のページの bUnit テストとアーキテクチャテストが CI で通る。Web から Domain を直接呼ぶ誤りがテストで止まる」は達成した。**
- PR #8 の CI（`build-and-test`）が成功した。
- アーキテクチャテストは 14件（Web の物理削除の検査を含む）。
- 対照実験で、画面から `Money.Of` を呼ぶ誤りが検出された。

## 今日行った処理

### 1. 画面の骨格（`src/SalesCore.Web`）

| 項目 | 内容 |
|---|---|
| 作り方 | `dotnet new blazor --interactivity Server --empty --framework net8.0` |
| 参照 | Application だけ（Domain・Infrastructure は直接参照しない） |
| 依存の組み立て | DB とユースケースの登録を `SalesCoreServices.AddSalesCore`（Application）に移し、API と画面の両方がこれを呼ぶ。API から Infrastructure の `using` が消えた |
| 接続文字列 | API と同じ `UserSecretsId` で、同じ user-secrets を読む |
| 文言 | テンプレートの英語を日本語に（トップ・エラー画面・回線切れの表示・`lang="ja"`）。エラー画面には問い合わせ番号だけを出し、例外の中身は出さない |
| 起動の確認 | http://localhost:5159 で「販売管理」が出る。コンソールのエラーは無い |

### 2. 画面のテスト（bUnit、`tests/SalesCore.Web.Tests`）

- bunit 2.12.5（net8.0 に対応。脆弱なパッケージは無い）。
- トップページの見出しのテスト。RED（`Expected: "販売管理" / Actual: "Hello, world!"`）を見てから直した。

### 3. 画面から Domain・Infrastructure を直接使わない（`WebLayerTests`）

権限の検査をユースケースの入口に置くので、画面が Domain を直接触ると検査を素通りできてしまう。Web の DLL（`.razor` から生成されたコードも含む）を読んで確かめる。

| テスト | 調べること |
|---|---|
| メソッド・プロパティ | `SalesCore.Domain.*`・`SalesCore.Infrastructure.*` の呼び出しが無い |
| 型の参照 | `SalesCore.Infrastructure.*` の型が無い（DbContext を注入するだけで引っかかる） |
| 調べ方の確認 | 画面から `AddSalesCore` を呼んでいるのが見える（読み方が壊れて常に空、を防ぐ） |

| 対照実験（Home.razor に入れた誤り） | 結果 |
|---|---|
| `SalesCore.Domain.Money.Of(1m).Yen` | 失敗（`Money.Of`・`get_Yen` を検出） |
| `@inject SalesCoreDbContext Db` | 失敗 |
| `e is BusinessRuleException`（例外の型で判定するだけ） | 通る（許す） |
| Domain の**入れ子の型**のメソッド（`NestedProbe.Inner.Value()`） | **直す前は通ってしまった**（2回目の AI レビューの指摘）→ 直した後は失敗（`NestedProbe+Inner.Value`） |
| 画面に `"DELETE FROM sales_orders"` | 失敗（Web を物理削除の検査の対象に足した後） |

- DLL を読む部品を `AssemblyMetadata` に切り出した（AI レビューの Minor）。
- 切り出した後も、`Money.Of` の誤りと、Application に入れた `DbContext.Remove` の誤りを、どちらも検出することを確かめた。

### 4. 画面を足して見つかった穴（2つ）

| 穴 | 直す前 | 直した後 |
|---|---|---|
| `.razor` の `double`（金額の決まり SALES001） | **ビルドが通った**（`.razor` は `Compile` でなく `Content` に入る） | SALES001 で止まる（`Directory.Build.props` が `.razor` も調べる） |
| `.razor` の編集で、テストが走らない（dev-guard） | **走らない**（対象は `.cs` だけ） | dev-guard 1.3.2 で走る |

- `.razor` の `Math.Round`（RS0030）は、もともと止まっていた（アナライザは生成されたコードも見る）。
- dev-guard 1.3.2 は、テストを先に書き、`.razor` で `null` が返る RED を見てから直した。
- 確認: sales-core の新しいセッション（1.3.2 を GitHub から読み込む）で `.razor` を編集し、`[dev-guard] SalesCore.Web.Tests: 編集後のテスト 全件パス` と出た。
- 参照のタグを上げた時、各自の機械で行う入れ替え（`claude plugin marketplace add … --scope local` と `claude plugin update … --scope project`）を CLAUDE.md に書いた。

### 5. 設計の文書（`docs/specs/2026-10-22-stage2-screens-and-permissions-design.md`）

書いたことは次のとおり。
- 本人の決定（Interactive Server、Application を直接呼ぶ、承認は税抜100万円）
- 作るもの・作らないもの
- 強制することと、確かめた日
- 業務の画面の前に決めること

### 6. AI レビュー（[kiyo015/sales-core#8](https://github.com/kiyo015/sales-core/pull/8)）

**1回目の判定:** マージ可（$0.3719・66秒）。

| 指摘 | 対応 |
|---|---|
| **Important:** Interactive Server では、scoped の DbContext が回線（タブを開いている間）の1本の間ずっと生き続ける。版数の楽観ロックが効かない、失敗した変更が次の保存に混ざる、同時の操作で例外、が起こりうる | 設計の文書に「業務画面の前に決めること」として書いた。ユースケースを呼ぶ最初の画面（Day41）より前に決め、二重の操作が版数で止まることをテストする |
| Minor: app.css に英語の文言が残っている | 日本語にした |
| Minor: テスト同士が直接呼び合っている | `AssemblyMetadata` に切り出した |
| Minor: dev-guard の版上げで、何が変わったかが PR に無い | PR の本文に変更点と比較の URL を書いた |
| Minor: `.razor` の SALES001 の検査を自動で守っていない | 設計の文書に書き、持ち越した |
| Minor: 設計の文書に、業務ルール集に無い決まり（未満は営業が承認、役割の表）がある | Day37・38 に業務ルール集へ入れる（予定どおり） |

**2回目（指摘を直した後）の判定:** 修正後マージ可（$0.3940・65秒）。Important 2件を直し、**3回目はマージ可**（$0.3987・70秒、Important 無し）。3回目の Minor のうち、設計の文書の出典の書き方（「未満は営業でも承認できる」は業務ルール集に未反映）は Day36 に直す。

| 指摘 | 対応 |
|---|---|
| **Important:** 入れ子の型（`Outer.Inner`）は名前空間が空になり、画面の層の検査を素通りする | 対照実験で素通りを確かめてから、外側の型をたどって `Outer+Inner` の名前にした。直した後は検出 |
| **Important:** Web が物理削除の検査の対象に入っていない | 対象に足した。画面に `DELETE FROM` を書くと失敗することを確かめた |
| Minor: IIS Express の設定、使わない `System.Net.Http` の using | 消した |
| Minor: http で起動すると HTTPS のポートの警告が出る | 実害が無いので見送り |

## 今日学んだこと

- **新しい種類のファイルを足すと、既存の守りに穴が開く。** 金額の決まり（SALES001）も dev-guard も `.cs` を前提にしていた。どちらも、`.razor` に誤りを入れる対照実験で初めて穴が分かった。新しい種類のファイルを足したら、既存の守りがそれを見ているかを、誤りを入れて確かめる。
- **守りの種類ごとに、見ている範囲が違う。** RS0030（アナライザ）はコンパイル後のコードを見るので `.razor` も止まった。SALES001（ソースの文字列の検査）はファイルの一覧を見るので素通りした。
- **Interactive Server の「scoped」は、要求1回ではない。** API と同じ登録を使い回すと、回線の間ずっと同じ DbContext になる。AI レビューに指摘されるまで気付いていなかった。
- **自分で作った検査は、自分の思い付く誤りしか捕まえない。** 入れ子の型のすり抜けは、対照実験3通りでは見つからず、AI レビューが見つけた。検査を足したら、すり抜け方を別の目で探してもらう。
- **dev-guard は、セッションを開いたフォルダの外のファイルには働かない。** Study のセッションで sales-core のファイルを編集しても、テストは走らない（正しい動き）。確かめるなら、sales-core のセッションで行う。

## つまずき

- **csproj の参照パスのバックスラッシュが消えた**
  - **症状:** node -e で書いた `..\SalesCore.Application\...` が `..SalesCore.Application...` になり、CS0234 で失敗した。
  - **対策:** Edit ツールで直した。パスを含む書き換えは Edit で行う。
- **Edit が「ファイルが変わった」で失敗したのに、気付かずにテストを流した**
  - **症状:** 対照実験の1回目は、誤りが入っていない状態でテストした（全件成功）。
  - **対策:** 結果を見て気付き、読み直してから入れ直した。
- **プレビューのタブが、サーバーの起動前に開いて接続を拒否された**
  - **対策:** 応答が返るまで待ってから開き直した。

## 成果物

**sales-core**
- [SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day35/src/SalesCore.Application/SalesCoreServices.cs)
- [SalesCore.Web/Program.cs](https://github.com/kiyo015/sales-core/blob/day35/src/SalesCore.Web/Program.cs)
- [Home.razor](https://github.com/kiyo015/sales-core/blob/day35/src/SalesCore.Web/Components/Pages/Home.razor)
- [Error.razor](https://github.com/kiyo015/sales-core/blob/day35/src/SalesCore.Web/Components/Pages/Error.razor)
- [HomePageTests.cs](https://github.com/kiyo015/sales-core/blob/day35/tests/SalesCore.Web.Tests/HomePageTests.cs)
- [WebLayerTests.cs](https://github.com/kiyo015/sales-core/blob/day35/tests/SalesCore.Architecture.Tests/WebLayerTests.cs)
- [AssemblyMetadata.cs](https://github.com/kiyo015/sales-core/blob/day35/tests/SalesCore.Architecture.Tests/AssemblyMetadata.cs)
- [Directory.Build.props](https://github.com/kiyo015/sales-core/blob/day35/src/Directory.Build.props) — `.razor` も調べる
- [段階2の設計](https://github.com/kiyo015/sales-core/blob/day35/docs/specs/2026-10-22-stage2-screens-and-permissions-design.md)
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day35/CLAUDE.md)

**Study**
- [post-edit-test.js](https://github.com/kiyo015/vibe-coding-study/blob/day35/plugins/dev-guard/hooks/post-edit-test.js) — `.razor` 対応（1.3.2）
- [post-edit-test.test.js](https://github.com/kiyo015/vibe-coding-study/blob/day35/plugins/dev-guard/hooks/post-edit-test.test.js)
- [.claude/launch.json](https://github.com/kiyo015/vibe-coding-study/blob/day35/.claude/launch.json) — 画面のサーバー（sales-core-web）

## 次回予告

**Day36 — ASP.NET Core Identity**
- 利用者・役割の表（migration スキル）。
- ログイン・ログアウトの画面。
- パスワードの規則とロック。
- 初期利用者を user-secrets から作る。

**持ち越し**
- 設計の文書の承認の行の出典を正確にする（AI レビュー3回目の Minor）。
- DbContext の寿命の決め方（Day41 の前まで）。
- `.razor` の SALES001 を自動で守る。
- 10/26（月）9:00 の初めての定期実行を確かめる。
