# Day54 学習記録（2026-11-19）— 見積の画面、1週目の振り返り

基幹システム開発計画の40日目。段階3（販売の完結）の5日目で、1週目の最後の日。

- **決めたこと:** 作業の前に本人に3件を聞いた。未来の見積日、作成中の見積の明細を画面で直すか、期限切れの見積の見せ方の3件で、どれも推奨の案に決まった。
- **作ったこと:**
  - 見積の一覧・登録・詳細の画面。営業が画面で見積を作り、提出して受注にするところまで通した。
  - 単価の入れ方を受注と見積の登録の画面で共通にした（`LinePricing`）。手で直した単価を入れ直した時は知らせる（Day52 の決定）。
  - API に見積の一覧と、未来の見積日を拒む検査を足した。
- **振り返ったこと:** 段階3の1週目（Day50〜54）を数字で振り返り、2週目で試すことを3つ決めた。

**完了条件「画面で見積を作って受注にでき、画面のテスト（bUnit）が通る。1週目の振り返りがある」は達成した。**
- AI レビューは4回で、最後はマージ可（Critical・Important なし）。費用は計 $2.6658。
- CI は最後の回で成功した。2回目は、今日触っていない画面のテストが CI でだけ落ちた。

## 今日行った処理

### 1. 作業の前に、本人に3件を聞いた

| 問い | 決定 |
|---|---|
| 見積日に今日より先の日付を入れられるか（PR #26 の AIレビュー3回目の Minor） | **拒む。** 見積日は日本時間の今日まで。過去の日付は入れられる |
| 作成中の見積の明細（数量・単価）を、画面で直せるようにするか | **直せる**（見積の詳細の画面） |
| 有効期限を過ぎた提出済の見積を、一覧や詳細でどう見せるか | **状態はそのままで「（期限切れ）」と出す。** 受注にするボタンは出さず、失注は人が押す |

業務ルール集、段階3の設計、sales-core の `docs/decisions/2026-11-19.md` に記録した。

### 2. 見積の画面（`Pages/Quotations`）

- **一覧（全員）:** 新しい順に並べる。有効期限を過ぎた作成中・提出済の見積には「（期限切れ）」と出す。登録の入口は営業と管理者にだけ出す。
- **登録（営業・管理者）:** 見積日の初期値は日本時間の今日にした。有効期限は空にして、必ず入れてもらう（Day53 の決定）。
- **詳細:**
  - 作成中の見積は、明細の数量・単価を1行ずつ直せる。
  - ボタン（提出・受注にする・失注）を出すかは、`QuotationActions` が状態・有効期限・役割から決める。
  - 受注にすると、できた受注の詳細の画面に移る。
- メニューに「見積」を足した（受注の前）。

### 3. 単価の入れ方を受注と共通にした（`LinePricing`）

- 受注の登録の画面にあった単価の入れ方を、共通の部品に切り出した。得意先・日付・商品で得意先別単価を引き、無ければ商品の標準単価を入れる。
- Day52 の決定「手で直した単価の後で得意先・日付を変えたら、入れ直して知らせる」を作った。手で直していない明細だけなら知らせない。
- 受注の画面でも同じように動く。

### 4. API・ユースケース

- 見積の一覧を足した（`GET /quotations`、`QuotationUseCases.ListAsync`）。役割の表の「参照」の行に入れた。
- 見積日が今日より先なら 400 を返す。文言は「見積日 2026-12-02 は、今日(2026-12-01)より先にできない。」。
- 見積の登録の画面が引く単価は、`QuotationUseCases.UnitPriceForAsync` で問い合わせる。見積の役割で検査し、決め方は受注と同じ関数を使う。
- Domain に `Quotation.IsExpired(validUntil, today)` を足した。期限切れの判定を、提出・受注化の検査と画面の表示で共有する。
- PR #26 の Minor 2件も直した。
  - 一意インデックスが止めた時の 409 の文言のテストを足した。
  - 受注化で見積明細を Id の順に読むようにした。

### 5. RED を見てから作った

- 未来の見積日は 201 で通っていた。
- 一覧の API は 405 だった。
- 受注の画面は、単価を入れ直しても知らせが無かった。
- 見積の画面は、まだ無いのでビルドが通らなかった。
- メニューに見積が無かった。

画面のテスト `QuotationPageTests` は15件。時計は日本時間の 2030-04-01 0:30 にした。UTC ではまだ 3/31 なので、「今日」を UTC で決める誤りがテストで見える。

### 6. 対照実験（26通り、25通り検出）

| 入れた誤り | 落ちたテスト |
|---|---|
| S1 見積日が今日より先でも登録できる | 結合 1件 |
| S2 見積日が今日でも拒む | 結合 15件 |
| S3 見積日の「今日」を UTC の日付にする | 結合 1件 |
| S4 一覧を古い順にする | 結合 1件・画面 1件 |
| S5 一意インデックスの理由が無い | 結合 1件 |
| S6 受注化で見積明細を読む順序を指定しない | **未検出**（下） |
| S7 手で直した単価を入れ直しても知らせない | 画面 1件 |
| S8 手で直していなくても知らせる | 画面 1件 |
| S9 期限切れでも受注にするボタンを出す | 画面 1件 |
| S10 期限切れでも提出のボタンを出す | 画面 1件 |
| S11 受注済・失注にも期限切れと出す | 画面 1件 |
| S12 有効期限の当日を期限切れにする | Domain 2件 |
| S13 明細を直す欄を役割で隠さない | 画面 1件 |
| S14 失注のボタンを役割で隠さない | 画面 1件 |
| S15 登録の画面を URL で開いた時に拒まない | 画面 1件 |
| S16 見積日の初期値を UTC の日付にする | 画面 2件 |
| S17 一覧に期限切れを出さない | 画面 3件 |
| S18 受注にした後、受注の画面に移らない | 画面 1件 |
| S19 有効期限に初期値（30日後）を入れる | 画面 2件 |
| S20 メニューに見積が無い | Web 3件 |
| S21 明細を直す時に空の単価を 0円で送る | 画面 1件 |
| S22 見積の単価の問い合わせを、見積の役割で検査しない | `PermissionTests` 1件 |
| S23 見積の単価の問い合わせを、参照の役割で検査する | `PermissionTests` 1件 |
| S24 一覧の番号を、別の見積の番号にする | 結合 1件 |
| S25 読み直すと、入れかけた行も新しい値にする | 画面 1件 |
| S26 読み直しても、触っていない行を古い値のまま残す | 画面 1件 |

**S6 が未検出の理由は、実測で確かめた。**
- PostgreSQL は、更新した行を表の後ろに書き直す。順序を指定しない SQL では、直した1行目が実際に後ろへ回った（Id 1451, 1450 の順）。
- ただ EF Core が、読み込みの SQL に明細の Id の `ORDER BY` を自分で付けていた（`ToQueryString` で確かめた）。このため、指定を外しても受注明細の順は変わらない。
- 明示の `OrderBy` は、EF Core の付け方が変わった時の柵として残した。テストもそのために残す。

### 7. CI と AI レビュー（PR #27）

| 回 | 判定 | 費用 | 主な指摘と対応 |
|---|---|---|---|
| 1回目 | マージ可 | $0.6322 | Minor 4件をすべて直した。見積の単価の問い合わせを見積の役割で検査する、端から端までのテストの期待を役割の表の見積の行から書き写す、ほか2件 |
| 2回目 | マージ可 | $0.6541 | 1行を直すと、ほかの行に入れかけた値が戻った（RED：7 が 1.000 に）。CI では、今日触っていない `MasterPageTests` が1件落ちた |
| 3回目 | 修正後マージ可 | $0.6864 | Important：2回目の直し方で、触っていない行の欄が古い値のまま残った。このため、ほかの人の変更を古い値で戻せた（RED：ほかの人が 9 にした数量が 1.000 のまま） |
| 4回目 | マージ可 | $0.6931 | Minor 4件。Day55 へ回した |

### 確認

- テストは 613件 → **634件**（Domain 272・Web 47・アーキテクチャ 20・結合 283・端から端まで 12）。
- Release ビルドの警告は0件。

## 今日学んだこと

- **指摘を直すと、逆向きの穴ができることがある。**
  - 2回目の指摘「入れかけた値が消える」は、読み直しても欄を更新しない形にして直した。
  - すると「触っていない行まで古い値が残る」という逆の穴ができた。
  - 守るべき性質は2つあった。入れかけた値は残すことと、触っていない値は新しくすること。片方だけのテストでは、もう片方を壊しても落ちない。直す時は、両方向のテストを一緒に足す（S25・S26）。
- **対照実験が通った時は、何が止めたのかを実測で名指しする。**
  - S6 は「テストが弱い」のではなく、EF Core が `ORDER BY` を自分で付けていた。
  - 生の SQL で、直した行が後ろに回ることも見た。順序の指定は要らないのではなく、今は二重になっている。
- **時計を UTC と日本時間で日付がずれる時刻に置くと、日付の誤りが見える。**
  - 画面のテストの時計を日本時間 0:30 にした。これで、見積日の初期値を UTC で決める誤り（S16）が2件で落ちた。
- **bUnit で、読み込みが2段ある画面は待ち方を誤ると CI でだけ揺れる。**
  - 商品の画面は、一覧の後で税区分を読む。一覧が出たところで入力を始めると、2段目の描き直しで操作の口が古くなる（`UnknownEventHandlerIdException`）。
  - 最後に読むもの（税区分の選択肢）が出るまで待ち、探してから入れるまでを `InvokeAsync` の1つの流れにした。

## つまずき

- **CI でだけ落ちる画面のテスト**
  - 症状: 今日触っていない `MasterPageTests` が CI で1件落ちた。1回目の CI と手元では通っていた。
  - 原因: 読み込みの途中で入力を始めていた（上記）。
  - 対策: 最後に読むものを待つ。見積の画面のテストも同じ書き方にそろえた。
- **一覧の金額の期待が 99.99円だった**
  - 症状: 一覧のテストで、33.33円×3 の金額を 99.99 と期待していた。
  - 原因: 明細金額は円に丸めるので 100円になる。
  - 対策: 期待を直した。
- **要約の前の自動書き出しが、決定の記録を上書きした（Day53 に続いて2回目）**
  - 症状: 締めの時、`docs/decisions/2026-11-19.md` の見出しに「09:55」と時刻が付いていた。締めた時はまだ 07:28 で、実際とは合わない時刻だった。
  - 対策: `git checkout` で戻し、PR は変えなかった。Day53 は合わせるためのコミットで AI レビューが1回多く動いたが、今回は避けた。
  - 申し送り: 締めの前に `git status` で確かめることを Day55 に書いた。
- **計画シートを相対パスで直そうとして失敗した**
  - 原因: 書き換えのスクリプトが sales-core に移動してから動く。
  - 対策: Study のファイルは絶対パスで指定した。

## 段階3 1週目（Day50〜54）の振り返り

| 指標 | 段階2の終わり（Day49） | 1週目の終わり（Day54） |
|---|---|---|
| sales-core のテスト | 476件 | 634件 |
| 本人の決定 | ― | 24件（Day50 4・Day51 5・Day52 8・Day53 4・Day54 3）。そのうち3件は AI レビューの指摘から聞いた |
| 対照実験 | ― | Day51 23通り・Day52 17通り・Day53 25通り・Day54 26通り。未検出は Day54 の S6 だけ |
| PR と AI レビュー | ― | PR 5本（#23〜#27）。AI レビュー21回・$12.3995 |

- **続けること:**
  - 業務の判断を作業の前に聞く。
  - 対照実験が通った時に、止めた柵を実測で確かめる。
  - 本物のブラウザのテストに、その日の画面を1本足す。
- **繰り返した失敗:**
  - 値型の項目を省くと、黙って既定値になる。
  - 決定の記録の書き方がそろわない。
  - ヒアドキュメントでスクリプトが壊れた。
  - 指摘への直し方が次の穴を作った。
  - 画面のテストが CI でだけ揺れた。
- **2週目で試すこと:**
  1. 数・日付の入力を足したら、「省いた時」の行を通らない経路に書く。
  2. 日付で値が変わる処理は、テストの日付を2つずらす。時計は日本時間 0:00〜9:00 にする。
  3. 対照実験が通ったら、止めた柵を実測で名指しする。

詳細は計画シートの Day54 の節に書いた。

## 成果物

**sales-core**（タグ `day54`）
- [src/SalesCore.Web/Components/Pages/Quotations/QuotationList.razor](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Pages/Quotations/QuotationList.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Quotations/NewQuotation.razor](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Pages/Quotations/NewQuotation.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Quotations/QuotationDetail.razor](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Pages/Quotations/QuotationDetail.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Quotations/QuotationStatusText.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Pages/Quotations/QuotationStatusText.cs)（新規）
- [src/SalesCore.Web/Components/Shared/LinePricing.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Shared/LinePricing.cs)（新規）
- [src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor)
- [src/SalesCore.Web/Components/Layout/NavMenu.razor](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Web/Components/Layout/NavMenu.razor)
- [src/SalesCore.Application/QuotationActions.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Application/QuotationActions.cs)（新規）
- [src/SalesCore.Application/QuotationUseCases.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Application/QuotationUseCases.cs)
- [src/SalesCore.Application/QuotationContracts.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Application/QuotationContracts.cs)
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Application/SalesOrderUseCases.cs)
- [src/SalesCore.Domain/Quotation.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Domain/Quotation.cs)
- [src/SalesCore.Api/Program.cs](https://github.com/kiyo015/sales-core/blob/day54/src/SalesCore.Api/Program.cs)
- [tests/SalesCore.Integration.Tests/QuotationPageTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Integration.Tests/QuotationPageTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/QuotationApiTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Integration.Tests/QuotationApiTests.cs)
- [tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs)
- [tests/SalesCore.Integration.Tests/MasterPageTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Integration.Tests/MasterPageTests.cs)（CI の揺れ）
- [tests/SalesCore.Integration.Tests/PermissionTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Integration.Tests/PermissionTests.cs)
- [tests/SalesCore.E2E.Tests/SalesFlowE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.E2E.Tests/SalesFlowE2ETests.cs)
- [tests/SalesCore.E2E.Tests/PermissionE2ETests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.E2E.Tests/PermissionE2ETests.cs)
- [tests/SalesCore.Web.Tests/SharedComponentTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Web.Tests/SharedComponentTests.cs)
- [tests/SalesCore.Web.Tests/RenderModeTests.cs](https://github.com/kiyo015/sales-core/blob/day54/tests/SalesCore.Web.Tests/RenderModeTests.cs)
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day54/docs/domain/business-rules.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day54/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-19.md](https://github.com/kiyo015/sales-core/blob/day54/docs/decisions/2026-11-19.md)（新規。本人の決定3件）
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day54/CLAUDE.md)
- [kiyo015/sales-core#27](https://github.com/kiyo015/sales-core/pull/27)

**Study**（タグ `day54`）
- [2026-11-19/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day54/2026-11-19/summary.md)
- [2026-11-19/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day54/2026-11-19/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day54/study_plan_next_month.md)（Day54 の振り返り）

## 次回予告

**Day55 — 入金と消込（Domain と永続化）。** 段階3の2週目の始まり。

- 作業の前に本人に聞く: 古い請求書から充てる消込と、繰越の形式が両立しない件。
- **持ち越し（PR #27 の AIレビュー4回目の Minor）:**
  1. 見積の詳細は「入れかけ」を行ごとに持つ。このため、数量だけ入れかけた行でも単価の欄が古いまま残り、ほかの人が直した単価を戻せる。
  2. 受注にした後の読み直しが失敗すると、誤りを出しつつ受注の画面に移る。
  3. 詳細の数量・単価の欄が、数でない値を入れた時の理由を出さない。
  4. 見積の登録の画面で、手で直した単価の知らせを確かめるテストが無い。
- **段階3 1週目からの持ち越し:**
  - `Routes.razor` の「権限がありません」のテスト。
  - PR #19 の Minor 3件。
  - 出荷・返品の数量の桁のテスト。
  - 見積と受注の一覧が全件を読む。
  - DB の接続の時間切れ（見張る）。
