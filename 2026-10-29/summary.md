# Day40 学習記録（2026-10-29）— 受注の承認の金額の基準と承認待ち

基幹システム開発計画の26日目で、段階2（画面と権限）の6日目。2週目の始め。

- **決めたこと:** 本人が決めた。登録した時に、税抜合計が基準額以上なら「承認待ち」、未満なら「受付」で始まる。
- **作り:** 承認待ちを承認できるのは管理者だけ。基準額は設定から読み、既定は100万円。設定の誤りは起動の時に止める。
- **テスト:** 税抜 999,999円・1,000,000円・1,000,001円 × 営業・管理者で、境界を確かめた。

**完了条件「境界値のテストが通り、取り違えの誤りが検出される」は達成した。** 境界を `>=` から `>` に取り違えると、Domain 6件・結合 4件が落ちる。

## 今日行った処理

### 0. 定期実行の確認

- 朝 9:48 の健康診断は走り、14件すべて正常だった。

### 1. 決めたこと（業務ルール集「承認」）

| 質問 | 本人の決定 |
|---|---|
| 税抜合計100万円以上の受注は、いつ・どうやって「承認待ち」になる？（業務ルール集には「受付 →（承認待ち →）承認済」とだけある） | **登録の時に自動で承認待ち。** 未満なら今までどおり受付で始まる |

決定に合わせて、次のことを業務ルール集に書いた。

- 基準額ちょうど（100万円）は承認待ち。
- 比べるのは税抜合計。税込で100万円を超えても、税抜で未満なら受付（営業が承認できる）。
- 承認待ちを承認できるのは管理者だけ。営業が承認しようとすると拒む（API は 403）。
- 判定は登録の時の基準額。後で基準額を変えても、登録済みの受注の状態は変えない。
- 承認待ちも取り消せる（取り消せる人は「受注の取消」と同じ営業・管理者）。管理者が承認しない時（却下）も取消にする。
- 基準額は設定 `SalesCore:ApprovalThreshold`（円）。無ければ100万円。負の値・円未満の端数は設定の誤り。0 は「すべて承認待ち」として認める。
- 業務フローの状態の図は「受付 → 承認待ち」と描いてあった。決定と食い違うので「登録 → 承認待ち」に直した。

### 2. 作り

```
受注の登録 ── SalesOrder(明細, 基準額)
                ├ 税抜合計 ≥ 基準額 → 承認待ち
                └ 税抜合計 < 基準額 → 受付

承認 ── ApproveAsync
          ├ 入口: ApproveSalesOrder（営業・管理者）
          ├ 承認待ちなら、もう1つ ApprovePendingSalesOrder（管理者だけ）
          └ どちらに当たるかは状態で決める（承認の時に金額で判定し直さない）

出荷 ── 今までどおり承認済・一部出荷からだけ → 承認待ちのままでは出荷できない
```

- `ApprovalThreshold`: 設定を読む。API と画面は起動の直後に1回読む。設定の誤りを、最初の受注の登録（500）でなく起動で止める。
- 状態は文字列で保存しているので、マイグレーションは要らない。
- 承認の記録の表（`sales_order_approvals`）はまだ作らない。誰が承認したかは、更新者と監査ログに残る。

### 3. テスト

先に RED（Domain 7件・結合 3件・起動の確かめ 1件）を見てから実装した。

- **境界値（`ApprovalTests`）:**
  - 999,999円（税込 1,099,999円）は受付で、営業が承認できる。
  - 1,000,000円・1,000,001円は承認待ちで、営業は拒まれ、管理者は承認できる。
- 承認待ちは、管理者が承認するまで出荷を指示できない。承認の後は指示できる。
- 承認待ちは営業も取り消せる。
- 基準額を後で下げても、受付で登録した受注は営業が承認できる。
- 明細を合わせて基準額に届けば承認待ち（明細ごとでなく合計で比べる）。
- 状態×操作の表に承認待ちの4通りを足した（全24通り）。
- `PermissionTests` に「受注の承認（税抜合計100万円以上）」の行を足した。承認待ちの受注を毎回作って確かめる。管理者が承認すると承認済になり、次の利用者で確かめられないため。
- API: 設定が無ければ100万円。50万円に設定すると、50万円の受注が承認待ちになり、営業は 403、管理者なら承認済。設定が負なら API は起動しない。

| 対照実験（入れた誤り） | Domain | 結合 |
|---|---|---|
| **境界を `>=` から `>` にする** | 6 | 4 |
| 承認待ちの管理者の確かめを外す | 0 | 4 |
| 承認待ちを営業にも許す（表だけを変える） | 0 | 4 |
| 税込で比べる | 2 | 3 |
| 明細ごとに比べる | 1 | 0 |
| 承認の時に金額で判定し直す | 0 | 1 |
| 承認待ちでも出荷できる | 2 | 1 |
| 承認待ちを取り消せない | 1 | 1 |
| 設定を読まずに既定値を使う | 0 | 2 |
| 起動の時に設定を確かめない（API） | 0 | 1 |
| 負の設定を通す | 0 | 2 |

- 11通りすべて検出した。数字は、その誤りで落ちたテストの件数。
- **検出しない誤りが1つある:** 画面（Web）の起動の時の確かめを外しても、気付けるテストが無い。画面を起動するテストがまだ無いため。

### 4. 1週目の振り返りで決めたことを試した

- 決めたこと: 対照実験の前に「テストが手で並べている範囲」と「どのテストも通らない経路」を書き出し、その外側の誤りを1つは入れる。
- 書き出すと、「設定の誤りが、最初の受注の登録まで気付かれない」経路が見つかった。どのテストも、起動しただけでは設定を読まない。
- テストを足し、起動の直後に設定を読む作りにした。API 側は対照実験で検出する。画面側は上のとおり未検出。

### 5. 前日の持ち越し

- トークンの期限切れの 401 にも `WWW-Authenticate: Bearer` が付くことを、テストで確かめた（PR #12 の AI レビュー3回目の Minor）。
- 残りの持ち越しは Day41 の先頭に書き写した。

### 6. AI レビュー（PR #13）

マージ可（$0.4007、61秒、Important 0件・Minor 3件）。Minor はどれも今の差分の不具合ではないので、Day41 へ持ち越した。

| 指摘（Minor） | 対応 |
|---|---|
| 設定のキーが空文字だと、黙って既定の100万円で動く | Day41。誤りとして止めるか、「空文字は既定値」とテストで固定するか |
| 将来、明細を変える操作を作ると、合計が基準額を超えても受付のまま営業が承認できる | Day41。業務ルール集「9. この文書で決めていないこと」に書く |
| 画面の起動の時の確かめにテストが無い | 既知の限界。画面を起動するテストを作る時に、API と同じ確かめを足す |

### 確認

- Release ビルド（警告もエラー）: 警告0件
- `dotnet test`: すべて成功
  - Domain 157（前日 147）
  - アーキテクチャ 14
  - Web 19
  - 結合 106（前日 89）
- CI: 成功
- `CLAUDE.md` の強制の表に「100万円以上の受注を、管理者の承認なしに出荷する」の行を足した（対照実験11通り）。

## 今日学んだこと

- **「決定済み」と書いてあっても、決まっているのは一部だけのことがある。**
  - 計画には「Day16 に決定済み」とあった。決まっていたのは「100万円以上は管理者が承認する」ことだけで、いつ承認待ちになるかは決まっていなかった。
  - 業務フローの図には「受付 → 承認待ち」と描いてあった。そのまま作れば、決定と違う動きになっていた。
- **権限の分かれ目を、金額でなく状態で決める。**
  - 承認の時に金額で判定し直すと、基準額を変えた時に、登録済みの受注の扱いが変わる。
  - 登録の時に状態を決めておけば、承認の入口は状態を見るだけで済む。「後で基準額を変えても変えない」という決定も、そのまま守れる。
- **テストの外側を先に書き出すと、自分の思いつきの外が見える。**
  - 今までの対照実験は、思いついた誤りを入れて確かめていた。
  - 「どのテストも通らない経路」を書き出すと、起動の時に設定を読まない経路が見つかった。思いつきで並べた誤りでは出てこなかった。
- **状態が変わる操作を全組み合わせで試す時は、毎回新しい対象を作る。**
  - 管理者で承認すると承認済になり、同じ受注では次の利用者を試せない。
  - 行ごとに受注を作る形にして、6通りの利用者を同じ条件で確かめた。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| `PermissionTests` の編集が「File has not been read yet」で空振り | 編集の前に、この会話でファイルを読んでいなかった | 読んでから編集し直した |
| 決定の記録が Study 側にできた | 会話の作業場所の関係（前日と同じ） | 秘密情報が無いことを見てから sales-core の `docs/decisions/` へ移した |

## 成果物

**sales-core**（タグ `day40`）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day40/docs/domain/business-rules.md)（状態・承認・役割）
- [docs/domain/business-flow.md](https://github.com/kiyo015/sales-core/blob/day40/docs/domain/business-flow.md)（状態の図）
- [src/SalesCore.Domain/SalesOrder.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Domain/SalesOrder.cs)（承認待ち）
- [src/SalesCore.Application/ApprovalThreshold.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Application/ApprovalThreshold.cs)（新規）
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Application/SalesOrderUseCases.cs)（承認の入口）
- [src/SalesCore.Application/Permissions.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Application/Permissions.cs)（`ApprovePendingSalesOrder`）
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Api/Program.cs)・[src/SalesCore.Web/Program.cs](https://github.com/kiyo015/sales-core/blob/day40/src/SalesCore.Web/Program.cs)（起動の時の確かめ）
- [tests/SalesCore.Integration.Tests/ApprovalTests.cs](https://github.com/kiyo015/sales-core/blob/day40/tests/SalesCore.Integration.Tests/ApprovalTests.cs)（新規）
- [tests/SalesCore.Domain.Tests/SalesOrderTests.cs](https://github.com/kiyo015/sales-core/blob/day40/tests/SalesCore.Domain.Tests/SalesOrderTests.cs)（境界・状態×操作の表）
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day40/tests/SalesCore.Integration.Tests/PermissionTests.cs)
- [tests/SalesCore.Integration.Tests/SalesOrderApiTests.cs](https://github.com/kiyo015/sales-core/blob/day40/tests/SalesCore.Integration.Tests/SalesOrderApiTests.cs)（設定）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day40/CLAUDE.md)（強制の表）
- [docs/decisions/2026-10-29.md](https://github.com/kiyo015/sales-core/blob/day40/docs/decisions/2026-10-29.md)（新規）
- [kiyo015/sales-core#13](https://github.com/kiyo015/sales-core/pull/13)

**Study**（タグ `day40`）
- [2026-10-29/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day40/2026-10-29/summary.md)
- [2026-10-29/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day40/2026-10-29/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day40/study_plan_next_month.md)（Day40）

## 次回予告

**Day41 — 画面の共通部品とマスタの画面**
- 役割に応じたメニュー、エラーの表示（400・403・404・409）。マスタの一覧と登録（管理者だけ）。bUnit で部品のテスト。
- **画面からユースケースを呼ぶ前に、DbContext の寿命を決める。**

**持ち越し（Day41 の先頭に書き写した）**
- PR #13 の Minor: 設定の空文字、明細を変える操作と承認待ちの判定、画面の起動の確かめのテスト
- Swagger の Bearer の定義、`SignInManager` の上書きが登録の順に頼っている
- 変更の後の再読込に掛かる参照の検査 → 検査の無い private の読み込みに分ける
- `AccountUseCases.CreateUserAsync`・`EnsureUserAsync` を `internal` にする
- 画面で役割が足りない時の表示、「権限がありません」の分岐の bUnit テスト
- 画面でのログイン成功の確認（開発用 DB に初期の利用者が要る）
- `.razor` の SALES001 の自動化、Day47 の3件
- 開発用 DB の今日より前の受注は、金額にかかわらず受付のまま（判定は登録の時）
- 次の guard-e2e: 11/02 9:00
