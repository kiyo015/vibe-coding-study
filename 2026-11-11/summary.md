# Day48 学習記録（2026-11-11）— 段階2の仕上げ

基幹システム開発計画の34日目で、段階2（画面と権限）の14日目（最終の作業日）。

- **確かめたこと:** 段階2の完了条件を、会話の前提を持たない新しいセッション（`claude -p`）に調べさせ、テストも流させた。1回目は「画面の対照実験は判断できない」。記録を直した2回目は「すべて満たす」。
- **直したもの:** 文書を段階2の形にした（CLAUDE.md・業務フロー・onboarding・設計）。PR #20 の Minor 4件と、「15分」の二重の定義も片付けた。端から端までのテストの揺らぎ（9回に2回落ちる）の原因も突き止めた。
- **判断したこと:** guard-e2e に権限のセルは足さない。

**完了条件「段階2の完了条件を、新しいセッション（文脈を切った状態）で確かめた記録がある」は達成した。** CI は成功し、AI レビューは2回ともマージ可（Important なし）。

## 今日行った処理

### 1. 新しいセッションで段階2の完了条件を確かめた

段階2の完了条件は「3つの役割それぞれでログインし、許された操作だけができる。権限の実効性テストが、API と画面の両方で対照実験付きで合格している」。

依頼文の中身:

- 前提: 「sales-core に初めて来た開発者として、文書とテストだけを根拠にする」。
- 調べさせること: 完了条件のそれぞれを、どのテストが確かめるか。対照実験の記録はどこにあるか。
- 流させるテスト: 結合テストと端から端までのテストの権限の分。
- 実行の条件: モデルは sonnet。使える道具は読み取りと `dotnet test` だけ。

| 回 | 費用・時間 | 判定 | 指摘と対応 |
|---|---|---|---|
| 1回目 | $0.51・202秒 | API・画面の操作は満たす。**画面の対照実験は判断できない** | 対照実験の記録が、設計・CLAUDE.md・テストのコメント・PR に散らばり、対応表が無かった → 設計に「段階2の完了の確かめ方」の表（完了条件 → テスト → 対照実験の結果）を足した。テストのコメントの参照先の誤り2件（「PR に記録」、存在しない節「確かめ方」）を直した。役割の表のうち操作がまだ無い行（監査ログの参照・返品・利用者の管理）を業務ルール集に書いた |
| 2回目 | $0.36・197秒 | **すべて満たす**（対照実験は依頼文で再実行を禁じたので、記録を根拠にした） | HTTP で確かめるのは代表の操作だけで、全組み合わせは結合テストが見ることを書いた。CLAUDE.md から対応表へ辿れるようにした |

- 2回とも、sales-core のセッションで dev-guard 1.4.0 が読み込まれていた（起動時の `plugins` で確認）。
- 結合テスト16件・端から端までのテスト6件が、新しいセッションでも合格した。
- 新しいセッションは、許していない PowerShell で `dotnet test` を試み、Bash に切り替えて流した。

### 2. 文書を段階2の形に直した

| 文書 | 変えたこと |
|---|---|
| `CLAUDE.md` | このプロジェクトの節（段階2で作った画面、次は段階3、利用者の管理の画面はまだ無い）。`CurrentUser` が null になる場合。アーキテクチャテストの一覧。取り消した利用者の決まり（1秒以上1分以内、回線の部品は Web）。dev-guard 1.4.0 |
| 業務フロー | 「5. 誰が操作するか（段階2）」を足した。営業・管理者・経理の流れの図と説明 |
| onboarding | 「6. 画面を動かす（段階2）」を足した。初期の利用者を役割ごとに作る手順、起動のコマンド、http で開けるのは `localhost` と `127.0.0.1` だけ、役割ごとの見え方（主なもの） |
| 業務ルール集 | 「8.」の間隔を「1秒以上1分以内」にそろえた。役割の表のうち操作がまだ無い行を書いた |
| 設計 | 回線の部品の置き場。「段階2の完了の確かめ方（2026-11-11）」の表 |

### 3. 持ち越しを片付けた（RED を見てから直した）

**PR #20 の Minor 4件**

1. **確かめ直す間隔は1秒以上にした。** ごく短い正の値を入れると、半分にした時に0になり、DB に問い合わせ続ける。`00:00:00.0000001` と `00:00:00.999` を起動で止める。
2. **ログインしていない扱いの画面は、読み込みを始める前にログインの画面へ送る。** `OperationPage.SetParametersAsync` で、値を受け取ってすぐに確かめる。送る時は、読み込みを始めずに戻る。bUnit のテスト（`OperationPageTests`）で、読み込みが動かないことを確かめた。
3. **開いたままの画面を確かめ直す部品を、Web へ移した。** 部品は `RevalidatingUserStateProvider`。判定の決まりは、Application の `UserRevalidation.IsStillSignedInAsync` に残した。新しい `ApplicationLayerTests` が、Application が `Microsoft.AspNetCore.Components.Server` に依存しないことを確かめる。
4. **業務ルール集「8.」の書き方の揺れをそろえた。**

**「15分」の二重の定義**

- ロックの時間を `AccountUseCases.LockoutDuration` の1か所に置いた。
- Identity の設定（`DefaultLockoutTimeSpan`）と、画面・API の文言をそこから作る。
- テストでは、定数が15分であることと、Identity の設定が定数と一致することを確かめる。

**dev-guard の参照を 1.3.2 → 1.4.0 に上げた**

- sales-core の会話でも、決定を書き出す時に秘密の形をした値を伏せる。

### 4. 揺らぐテストの原因を突き止めた

印の無いログアウトのテスト（`SecurityE2ETests`）が、全体を9回流して2回落ちた。

- **原因:** 端から端までのテストでは、Cookie を1秒ごとに確かめ直す（設定2秒の半分）。ログインから1秒を超えて要求を送ると、拒む段階より前に認証の段階で Cookie が作り直され、値のある Set-Cookie が付く。テストは「Set-Cookie が無いこと」を見ていたので、ログアウトしていないのに落ちた。
- **確かめ方:** 2.5秒待たせると、毎回付いた。
- **直し方:** 「Cookie を消させる応答（`名前=;` の形）」だけを拒むようにした。
- **対照実験:** 印の検査を外すと、本当のログアウトの応答を見つけて落ちた。

### 5. 対照実験（6通り、すべて検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| 回線の部品を登録しない | 端から端まで 2 |
| 読み込んでから送る（元の形） | Web 1 |
| Identity のロックの時間を定数から外す | Web 1 |
| ロックの時間を30分にする | Web 1・端から端まで 1 |
| 間隔の下限を外す（元の形） | Web 2 |
| 回線の部品を Application に置く（元の形） | アーキテクチャ 1 |

### 6. 判断したこと

- **guard-e2e に権限のセルは足さない。**
  - guard-e2e は「Claude Code の安全柵が、この機械のセッションで実際に効くか」を週1回見るもの。CI では見えないものだけを見る。
  - 画面と API の権限は `dotnet test` の中にあり、CI（PR ごと）と健康診断（毎日）で流れている。
  - 足すと、同じ確認を claude の呼び出しの費用付きで重ねるだけになる。
- **AI レビューの「引数を `SignInManager<SalesCoreUser>` に」は採らない。** Web が Infrastructure の型を参照することになり、`WebLayerTests` の決まりに反する。

### 7. CI と AI レビュー（PR #21）

| 回 | 判定 | 主な指摘と対応 |
|---|---|---|
| 1 | マージ可 | Minor: テスト名と中身が合っていない → 名前を直した。コメントの回数が PR 本文と違う → 9回に2回にそろえた。onboarding の営業の見え方が業務ルール集より少ない → 足して「主なもの」と書いた。引数の形 → 採らない（上記）。1.4.0 の中身はこの差分から見えない → 新しいセッションで読み込まれたことを記録した |
| 2 | **マージ可** | Important なし。Minor: Set-Cookie を文字列の先頭で判定している。設計と業務ルール集で、操作がまだ無い行の挙げ方が違う（マスタの変更の扱い）→ Day49 へ |

### 確認

- Release ビルド（警告もエラー）: 警告0件。
- `dotnet test`: Domain 192・アーキテクチャ 17・Web 47・結合 209・端から端まで 11（合計476件。前回はアーキテクチャ 16・Web 41）。

## 今日学んだこと

- **「対照実験をした」と「対照実験をしたと分かる」は別のこと。** 6日分の対照実験はすべて記録してあったのに、新しいセッションは「判断できない」と言った。記録が散らばっていて、完了条件から辿る道が無かったから。対応表を1つ置いたら、2回目は「満たす」になった。文脈を切ったセッションは、文書の抜けを見つける道具になる。
- **揺らぐテストは、時間の設定の副作用を疑う。** 1秒ごとの確かめ直しは、権限の取り消しを速く効かせるために入れたもの。その副作用で、関係のないログアウトのテストが、ログインからの経過時間しだいで落ちた。待つ時間をわざと延ばすと、毎回再現した。
- **テストは「起きてほしくないこと」をそのまま確かめる。** 「Set-Cookie が無い」はログアウトの代わりの目印にすぎなかった。確かめたいのは「Cookie を消させない」こと。
- **層の決まりは、部品を移すたびに守り直す。** Application に Blazor Server の型が入っていたのを、Web へ移した。テスト（`ApplicationLayerTests`）にすれば、次に入れた時に落ちる。テストは、参照の読み方を誤った時に何でも通るテストにならないよう、Identity を参照していることを先に確かめる。
- **確認を足すかは、何を見る仕組みかで決める。** guard-e2e は「この機械の安全柵」、`dotnet test` は「アプリの権限」。同じ権限を両方で見ても、費用が増えるだけ。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 印の無いログアウトのテストが、9回中2回落ちた | 1秒ごとの確かめ直しで Cookie が作り直され、値のある Set-Cookie が付いた | Cookie を消させる応答だけを拒む。2.5秒待たせて毎回再現し、対照実験でも確かめた |
| 新しいセッションが「画面の対照実験は判断できない」 | 記録が設計・CLAUDE.md・テストのコメント・PR に散らばり、対応表が無かった | 設計に完了の確かめ方の表を置いた |
| テストのコメントが、存在しない節や PR を指していた | 書いた時の呼び名のまま残っていた | 新しいセッションが見つけた。実在する節の名前に直した |
| PR 本文とテストのコメントで、落ちた回数が違った | 途中で数え直した値を片方にしか書かなかった | 9回に2回にそろえた（AI レビューの指摘） |

## 成果物

**sales-core**（タグ `day48`）
- [src/SalesCore.Application/UserRevalidation.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Application/UserRevalidation.cs)・[AccountUseCases.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Application/AccountUseCases.cs)・[SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Application/SalesCoreServices.cs)
- [src/SalesCore.Web/Components/Account/RevalidatingUserStateProvider.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Web/Components/Account/RevalidatingUserStateProvider.cs)（新規）・[OperationPage.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Web/Components/Shared/OperationPage.cs)・[Program.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Web/Program.cs)・[Login.razor](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Web/Components/Pages/Account/Login.razor)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day48/src/SalesCore.Api/Program.cs)
- [tests/SalesCore.Architecture.Tests/ApplicationLayerTests.cs](https://github.com/kiyo015/sales-core/blob/day48/tests/SalesCore.Architecture.Tests/ApplicationLayerTests.cs)（新規）・[tests/SalesCore.Web.Tests/OperationPageTests.cs](https://github.com/kiyo015/sales-core/blob/day48/tests/SalesCore.Web.Tests/OperationPageTests.cs)（新規）・[UserRevalidationTests.cs](https://github.com/kiyo015/sales-core/blob/day48/tests/SalesCore.Web.Tests/UserRevalidationTests.cs)・[SecurityE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day48/tests/SalesCore.E2E.Tests/SecurityE2ETests.cs)
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day48/CLAUDE.md)・[docs/onboarding.md](https://github.com/kiyo015/sales-core/blob/day48/docs/onboarding.md)・[docs/domain/business-flow.md](https://github.com/kiyo015/sales-core/blob/day48/docs/domain/business-flow.md)・[docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day48/docs/domain/business-rules.md)・[設計](https://github.com/kiyo015/sales-core/blob/day48/docs/specs/2026-10-22-stage2-screens-and-permissions-design.md)
- [kiyo015/sales-core#21](https://github.com/kiyo015/sales-core/pull/21)

**Study**（タグ `day48`）
- [2026-11-11/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day48/2026-11-11/summary.md)
- [2026-11-11/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day48/2026-11-11/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day48/study_plan_next_month.md)（Day48）

## 次回予告

**Day49 — 段階2の振り返りと段階3の展開**
- 段階2の振り返り（予定と実際、効いたやり方、繰り返した失敗）。
- `templates/team-CLAUDE.md` に画面と権限の決まりを足す。
- 段階3（販売の完結）を日単位に展開する。
- 完了条件: 段階3の計画が、この形式（日単位・完了条件つき）で書けている。

**持ち越し（Day49 の先頭に書き写した）**
- PR #21 の AI レビュー2回目の Minor:
  1. ログアウトのテストは Set-Cookie を文字列の先頭で判定している。解析して確かめる形にする。
  2. 設計と業務ルール集で、操作がまだ無い行の挙げ方が違う（マスタの変更の扱い）。
- 役割の変更と無効にしたことを監査ログに残すか（利用者の管理の画面を作る時に決める）。
- PR #19 の Minor 3件、PR #16 の残り、請求書・受注の一覧のページ分け。
- 前からの持ち越し: 桁あふれの文言、`InitialUsers` の文言と明細を消すボタンのテスト、Swagger の Bearer、`CreateUserAsync`・`EnsureUserAsync` を `internal` に、`Routes.razor` の bUnit テスト、.razor の SALES001、無効にした得意先を請求先にしてよいか、DB の接続の時間切れ。
