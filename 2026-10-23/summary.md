# Day36 学習記録（2026-10-23）— ASP.NET Core Identity

基幹システム開発計画の22日目で、段階2（画面と権限）の2日目。ASP.NET Core Identity で、ログイン・ログアウト・ロックを作った。パスワードの規則とロックの回数は本人が決めた。利用者の表は業務とは別の DbContext に置いた。SQL のレビューで `ON DELETE CASCADE` を見つけて作り直した。AI レビューは、戻り先の判定に、外のサイトへ飛ばせる穴があることを見つけた。

**完了条件「ログイン・ログアウト・ロックを結合テストで確かめる。DB にパスワードがハッシュでしか入っていないことを SQL で確かめる」は達成した。**
- 結合テストは18件。
- 利用者の行全体に平文が無く、v3 形式のハッシュだけが入ることを SQL で確かめた。

## 今日行った処理

### 1. 決めたこと（業務ルール集「8. 利用者とログイン」）

| 項目 | 決定 |
|---|---|
| パスワード | 12文字以上。文字の種類は問わない（本人。長さを重んじる NIST SP 800-63B に合わせる） |
| ロック | 5回続けて間違えると15分（本人。Identity の既定値と同じ）。成功すると回数は0に戻る |
| 無効な利用者 | 正しいパスワードでも入れない。利用者も物理削除しない |
| 失敗の伝え方 | ロック中かどうかだけ。利用者名が無いのか、パスワードが違うのかは区別しない |
| Identity の表 | 「7. データの扱い」の例外（共通の列・監査ログの対象外、役割を外す時は割り当ての行を消す）。理由も書いた |

今の「8. この文書で決めていないこと」は「9.」に繰り下げ、参照2か所を直した。

### 2. 利用者の表（migration スキル）

- **別の DbContext（`SalesCoreIdentityDbContext`）に置いた。** 業務の保存の決まり（削除の禁止・監査ログの JSON・共通の列）を当てると、パスワードのハッシュが監査ログに写り、役割を外す操作が止められるため。
- **SQL のレビュー（`docs/migrations/2026-10-23-AddIdentity.sql`）**

| 確かめたこと | 結果 |
|---|---|
| データを消す・型を変える | 無し |
| 削除の連鎖 | **`ON DELETE CASCADE` が6か所**（Identity の既定）→ すべての外部キーを `RESTRICT` にして作り直した（未適用だったので作り直せた） |
| 一意 | 利用者名・役割名に一意のインデックス |
| 名前 | Identity の既定（`AspNetUsers`・`PasswordHash`）。足した `display_name`・`is_active` だけ snake_case（ER 図に理由を書いた） |
| INSERT | EF 自身の履歴の1行だけ |

- テスト用DB・開発用DBに適用した。2つの DbContext とも `has-pending-model-changes` は変更なし。
- `MigrationTests` に、Identity のマイグレーションをまっさらなスキーマに当てて巻き戻すテストを足した。
- **DbContext が2つになって起きたこと:** `dotnet ef migrations list` が `--context` 無しでは「More than one DbContext was found」で止まった。CLAUDE.md・migration スキル・Study の健康診断（DbContext ごとに調べる）を直した。

### 3. ログインの入口と結合テスト（18件）

入口は Application の `AccountUseCases`。画面は Infrastructure の利用者の型を触らない（`WebLayerTests` は通過）。

| テスト | 確かめること |
|---|---|
| ログイン／ログアウト | ログインで認証の Cookie が出る、ログアウトで消える（サーバーを立てず、画面と同じ登録と HTTP のコンテキストで） |
| 失敗 | パスワードの誤りと利用者名の無しが同じ失敗。空・null の入力も例外でなく失敗。応答時間もそろえた（下記） |
| ロック | 4回なら入れる、5回でロック、成功すると回数が0に戻る、期限はちょうど15分後で過ぎれば入れる |
| 無効な利用者 | 正しいパスワードでも入れない。無効のまま作った利用者は無効のまま保存される |
| パスワードの規則 | 11文字・空は作れない、12文字なら英小文字だけでも通る |
| 初期の利用者 | 既にいれば作り直さず、パスワードも変えない |
| DB | 行全体に平文が無く、ハッシュは v3 形式（`AQAAAA…`） |

**対照実験（5通り、すべて狙ったテストが落ちた）**
- 長さ 12 → 11
- 回数 5 → 6
- 期限 15 → 14 分
- 無効の判定を外す
- 失敗を数えない

**.NET 8 の Identity はロックに差し替えた時計を使わない。** 時計を15分進めてもロックが解けず、DLL（8.0.31）に `TimeProvider` が無いことを確かめた。そこで、期限の値と、期限の前後での動きを分けて確かめる形にした。

### 4. 画面

- **ログイン:** `/account/login`。Cookie を出すので静的なフォーム。
- **ログアウト:** `POST /account/logout`。偽のリクエストを防ぐ印を確かめる。
- **すべての画面にログインを求める:** `_Imports.razor` の `[Authorize]`。ログインとエラーの画面だけ `[AllowAnonymous]`。付け忘れは `PageAuthorizationTests` が止める（トップページで RED を見てから直した）。
- **全部を拒む既定の方針（FallbackPolicy）は使わない。** 試したら、画面の部品のスクリプト（`_framework/blazor.web.js`）の配信までログインを求めた。
- **開発用の初期の利用者:** user-secrets の `InitialUsers` から、いなければ作る。設定が足りない時は、どこが足りないかを言って止める。
- **ブラウザで確かめたこと:**
  - 未ログインでトップページを開くとログインへ回る（302）。
  - スクリプト・ログイン・エラーはログインしなくても読める。
  - 間違った値では「利用者名かパスワードが違います。」と出る。

### 5. AI レビュー（[kiyo015/sales-core#9](https://github.com/kiyo015/sales-core/pull/9)）

1回目は修正後マージ可（$0.5098・95秒）。Important 5件のうち4件を直した。

| 指摘 | 対応 |
|---|---|
| 業務ルール集の「7.」と Identity の表の扱いが食い違う | 「8.」に例外と理由を書いた |
| 無効にしても、ログイン中の利用者は追い出されない | 無効にする操作はまだ無い。作る時の決まり（セキュリティスタンプの更新など）を「9.」に書いた |
| 成功で回数が0に戻ることと、戻り先の制限のテストが無い | テストを足した。**戻り先の判定に穴があった**（下記） |
| 空の入力で例外になる | RED（`ArgumentNullException`）を見てから直した |
| 画面でのログイン成功を確かめていない | 持ち越し（開発用 DB に利用者が要る） |

**見つかった穴: 外のサイトへ飛ばせる戻り先（オープンリダイレクト）**
- 画面に手書きした判定は、`"/"` で始まり `"//"`・`"/\"` で始まらなければ通していた。
- そのため `/<タブ>/evil.example` を通していた。ブラウザはタブを取り除くので、`//evil.example`（外のサイト）になる。
- 判定を `LocalReturnUrl.OrRoot` に出し、テストを11件書いた。
- 以前の判定のままテストを流すと、タブと改行の2件が落ちた。それを確かめてから、制御文字を拒むように直した。

**2回目は修正後マージ可（$0.5074・82秒）。**

| 指摘 | 対応 |
|---|---|
| **Important: 応答時間で利用者名を探られる** | 実測で確かめた。利用者が無い時 **3.1ms**、パスワード違い **192.4ms**（ハッシュの計算の有無）。無い・無効な時もダミーのハッシュで同じ計算をするようにし、**181.0ms と 183.1ms** にそろった |
| Minor: `is_active` の DB の既定値（true）で、false が INSERT から省かれる | テストを書いたが、EF Core 8.0.31 では**再現しなかった**（false で保存された）。版を上げた時に気付けるよう、テストとして残した |
| Minor: ロックの表示で利用者の有無が分かる | 本人の決定（ロックを伝える）に伴う限界として、業務ルール集に書き添えた |
| Minor: 表示名が100文字を超えると DB の例外 | 利用者の管理画面を作る時に入力検査を足す（持ち越し） |

**3回目はマージ可**（$0.5224・90秒、Important 無し）。Minor 4件は持ち越した。

## 今日学んだこと

- **フレームワークの既定値は、このシステムの決まりと合っているとは限らない。** Identity の既定は `ON DELETE CASCADE` で、利用者を消さない決まりと合わなかった。生成された SQL を読む手順（migration スキル）が、その場で拾った。
- **差し替えたつもりの時計が、使われていないことがある。** .NET 8 の Identity は `UtcNow` を直接使う。テストが失敗して初めて気付いた。時刻に頼るテストは、時計を差し替えて結果が変わることを一度見ておく。
- **「全部を拒む」既定の方針は、思った以上に広く効く。** 画面の部品のスクリプトの配信まで拒んだ。守る範囲は、画面ごとの属性と、付け忘れを止めるテストで決める方が見通しがよい。
- **指摘は実測してから採る。** 応答時間の差は、測ると約60倍で、指摘どおりだった。既定値の落とし穴は、テストを書くと再現しなかった。どちらも、測らなければ「直したつもり」か「直さなくてよかったもの」になっていた。
- **手書きのセキュリティの判定は、自分で思い付く入力しか試していない。** 戻り先の判定は、私の試した書き方は全部止めていた。タブを使う書き方は、AI レビューが挙げて初めて試した。

## つまずき

- **プレビューのサーバーが exe を握ったまま、ビルドが失敗した**
  - **症状:** `MSB3027: ... SalesCore.Web.exe ... ロックされています`
  - **対策:** サーバーを止めてからテストを流し、また起動した。
- **Error.razor の先頭に BOM があり、sed の置き換えが当たらなかった**
  - **対策:** Edit ツールで直した。
- **テストの中で、別の DbContext から利用者を無効にしたのに、ログインの入口は古い値を見ていた**
  - **原因:** 入口の DbContext が、作った時の利用者を覚えていた。
  - **対策:** 同じ DbContext で無効にする形に直した。Day35 で指摘された「DbContext が長く生きると古い値が残る」問題と同じ種類のもの。

## 成果物

**sales-core**
- [business-rules.md](https://github.com/kiyo015/sales-core/blob/day36/docs/domain/business-rules.md) — 「8. 利用者とログイン」
- [er-diagram.md](https://github.com/kiyo015/sales-core/blob/day36/docs/domain/er-diagram.md)
- [2026-10-23-AddIdentity.sql](https://github.com/kiyo015/sales-core/blob/day36/docs/migrations/2026-10-23-AddIdentity.sql)
- [SalesCoreIdentityDbContext.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Infrastructure/Persistence/Identity/SalesCoreIdentityDbContext.cs)
- [SalesCoreUser.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Infrastructure/Persistence/Identity/SalesCoreUser.cs)
- [AccountUseCases.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Application/AccountUseCases.cs)
- [SalesCoreServices.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Application/SalesCoreServices.cs)
- [Login.razor](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Web/Components/Pages/Account/Login.razor)
- [LocalReturnUrl.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Web/Components/Pages/Account/LocalReturnUrl.cs)
- [Web/Program.cs](https://github.com/kiyo015/sales-core/blob/day36/src/SalesCore.Web/Program.cs)
- [AccountTests.cs](https://github.com/kiyo015/sales-core/blob/day36/tests/SalesCore.Integration.Tests/AccountTests.cs)
- [MigrationTests.cs](https://github.com/kiyo015/sales-core/blob/day36/tests/SalesCore.Integration.Tests/MigrationTests.cs)
- [PageAuthorizationTests.cs](https://github.com/kiyo015/sales-core/blob/day36/tests/SalesCore.Web.Tests/PageAuthorizationTests.cs)
- [LocalReturnUrlTests.cs](https://github.com/kiyo015/sales-core/blob/day36/tests/SalesCore.Web.Tests/LocalReturnUrlTests.cs)
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day36/CLAUDE.md)
- [migration スキル](https://github.com/kiyo015/sales-core/blob/day36/.claude/skills/migration/SKILL.md)

**Study**
- [health-check.js](https://github.com/kiyo015/vibe-coding-study/blob/day36/checks/health-check.js) — DbContext ごとに未適用のマイグレーションを調べる

## 次回予告

**Day37 — 役割と操作した人**
- 3つの役割と、役割×ユースケースの表を業務ルール集に書く。
- `CurrentUser` をログインした利用者にし、監査ログと作成者・更新者に入れる。

**持ち越し**
- 画面でログインに成功し、元の画面へ戻ることを確かめる（開発用 DB に初期の利用者を置いてから。AI レビューの Important）。
- 対話的な画面遷移での `[Authorize]`（`Routes.razor` に `AuthorizeRouteView`）を、役割の `[Authorize(Roles=…)]` を足す前に確かめる。
- 防ぐ印の無いログアウトの POST が 500 で返るのを 400 に（Day47）。
- 「15分」が画面の文言と設定の2か所にある。
- 表示名の長さの入力検査（利用者の管理画面を作る時）。
- 業務ルール集「8.」の「外部キーはすべて RESTRICT」を、「削除の操作を作らないことで守る（RESTRICT は子の行がある時だけ止める）」と書き分ける（3回目の AI レビューの Minor）。
- ヘッダーに利用者名ではなく表示名を出すか（3回目の Minor）。
- 未ログインの 302・印の無いログアウト・スクリプトの配信を、HTTP の段階のテストにする（Day47）。
- 前日からの持ち越し: DbContext の寿命（Day41 の前）、`.razor` の SALES001 を自動で守る、10/26 の定期実行。
