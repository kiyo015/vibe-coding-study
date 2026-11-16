# Day51 学習記録（2026-11-16）— 得意先別単価（期間つき）

基幹システム開発計画の37日目で、段階3（販売の完結）の2日目。

- **決めたこと:** 単価の改定・誤登録・支店の扱いを、作業の前に本人に4件聞いた。作業の途中で、AI レビューの指摘から1件（特価の後）を聞いた。5件とも推奨の案に決まった。
- **作ったこと:** 得意先別単価（得意先 × 商品 × 期間）。受注の単価は「明細で指定 → 受注日に有効な請求先の得意先別単価 → 商品の標準単価」の順で決め、受注明細に写す。単価の一覧・登録・無効化の画面も作った。
- **直したこと:** 受注の画面で、見ていない単価で受注できる誤りを3つ（E2E で1つ、AI レビューで2つ見つかった）。
- **片付けたこと:** Day50 の締めで健康診断を止めた、取り残された Web アプリ。次の E2E の始めに止める形にし、同じ状況を再現して確かめた。

**完了条件「受注日に有効な得意先別単価が受注明細に写り、期間の境目のテストが対照実験付きで合格している」は達成した。** CI は成功した。AI レビューは4回で、3回目からはマージ可（Important なし）。

## 今日行った処理

### 1. 作業の前に、単価の決まりを本人に聞いた

Day50 で業務ルール集「9.」に「作る日の前に聞くこと」として置いた問いを、作業の前に聞いた。

| 問い | 決定 |
|---|---|
| 単価の改定 | **新しい登録で前を閉じる。** 末日が空（無期限）の前の単価を、新しい初日の前日で自動で閉じる。ほかの重なりは拒む |
| 誤って登録した単価 | **無効にする操作を作る**（管理者だけ）。無効の単価は受注で使わず、重なりの判定からも外す |
| 支店への登録 | **拒む。** エラーで本来の請求先を示す |
| 支店の受注で見る請求先 | **受注を登録する時の請求先**（得意先マスタは請求先の履歴を持たない） |
| 末日つき（特価など）を登録した後 | **特価の翌日から前の単価を続ける**（AI レビュー1回目の指摘から聞いた） |

最後の1件は、作業の前には気付けなかった穴だった。前の決まりのままだと、無期限の 90円（4/1〜）に特価 80円（10/1〜10/31）を登録すると、90円が 9/30 で閉じ、**11/1 から黙って標準単価に戻る。** 決定は業務ルール集と段階3の設計に書いた。

### 2. 得意先別単価を作った

| 層 | 作ったもの |
|---|---|
| Domain | `CustomerPrice`。登録は「登録した単価」と「続けた単価」の2つを返す。単価の検査（0以上・小数2桁・整数部13桁）は、商品の標準単価と共通にした（`MasterInput.UnitPrice`） |
| DB | `customer_prices`。期間の重なりは、排他制約 `ex_customer_prices_no_overlap`（有効な行だけ）でも止める。2人が同時に登録しても重ならない |
| ユースケース | 単価の一覧・登録・無効化。受注の登録は得意先別単価を使う。画面の単価の初期値のために `UnitPriceForAsync`（受注の登録と同じ権限） |
| 画面 | `/masters/customer-prices`。得意先の選択肢は有効な請求先だけ。無効化は押した後にもう一度確かめる。登録の後に、閉じた単価と続けた単価を知らせる |
| 役割の表 | 「得意先別単価の登録・無効化」は管理者だけ。単価の参照は、マスタの参照の行（全員）に入れた |

- **期間の境目:** 初日の前日・初日・末日・翌日、無期限を、Domain と受注の登録（結合）の両方で確かめた。
- **RED を先に見た:**
  - Domain のテストは、`CustomerPrice` が無いのでビルドで落ちた。
  - 役割の表の行の名前を変えると、`PermissionTests` が3件落ちた。
  - 受注の画面のテストは、標準単価が入ったので落ちた。
- マイグレーションの SQL は `docs/migrations/2026-11-16-AddCustomerPrices.sql` に出して読んでから、テスト用 DB と開発用 DB に当てた。データを消す操作・型の変更・削除の連鎖は無い。
- **計画にあった単価の API は作らなかった。** ほかのマスタも画面だけのため（設計に書いた）。

### 3. 受注の画面で、見ていない単価で受注できる誤りを3つ直した

単価を、得意先・商品・受注日を変えるたびに DB に問い合わせて入れ直す形にした。問い合わせが非同期なので、利用者の操作と競合した。

| 見つけた場所 | 誤り |
|---|---|
| E2E | 得意先を変えた直後に登録を押すと、入れ直す前の単価（標準単価）で送れた |
| AI レビュー1回目（Important） | 問い合わせの途中で手で直した単価（値引き）を、返ってきた単価で上書きした。登録を押した後に入れ直された単価で、そのまま送った |
| AI レビュー2回目（Critical） | 明細が2行以上の時、2行目の入れ直しを待たずに送った |

直し方は次のとおり。

- 手で直した単価は上書きしない（問い合わせた時の入力と、今の入力が違えば入れない）。
- 得意先・受注日を変えた時の入れ直しは、全行で1つの仕事にし、最初の `await` より前に待つ一覧へ入れる。
- 登録は、待つ仕事が無くなるまで待つ。待つ間に単価が変わったら、送らずに「単価を入れ直しました。確かめてから、もう一度登録してください。」と見せる。

この競合はタイミングで起きるので、そのままではテストで再現できない。問い合わせを止めておけるテストの部品 **`GatedSessions`** を作った。次の1回の DB の文脈の作成を、テストが門を開けるまで止める。これで「問い合わせの途中で押す」「途中で手で直す」「1行目を止めている間に押す」を決まった順で再現できた。3つとも、直す前は指摘どおりの理由で落ちた（手で入れた 30 が 90 で上書きされた、見ていない 90 で受注された）。

全行を同時に問い合わせる案は採らなかった。テストの DB の文脈は1つの接続を共有していて、同時に問い合わせると失敗するため。1行ずつ順に問い合わせる。

### 4. 持ち越しを片付けた

**取り残された Web アプリ（Day50 の健康診断が600秒で打ち切られた原因）**

- E2E のテストの組み立て（`WebAppFixture`）は、Web アプリを別のプロセスで起動する。テストのプロセスが打ち切られると、Web アプリだけが残り、dll を掴んで次の発行を止めていた。
- 申し送りでは Windows のジョブオブジェクトも候補にしたが、もっと簡単な形にした。起動した Web アプリの PID と起動時刻を `web.pid` に残し、次の実行の始めに、同じ PID・同じ起動時刻のプロセスが残っていれば止める（起動時刻を見るので、PID を再利用した別のプロセスは止めない）。
- **再現して確かめた:** E2E の途中でテストのプロセスだけを止めると、Web アプリが残った。次の実行は、残ったアプリを止めてから11件すべて合格し、`web.pid` も消えた。

**PR #23 の Minor**

- `RazorMoneyRuleTests` の時間の上限を、終了と読み取りを合わせて2分にした（最大4分になっていた）。
- XML の属性値をエスケープする（`SecurityElement.Escape`）。出力先がリポジトリの中にある前提を、コメントに書いた。
- 業務ルール集の「表を変えたらそちらも直す」を画面のある行に限り、「9.」の締めの文を節の先頭に移した。

`Routes.razor` の「権限がありません」の bUnit テストは、まだ書けない（役割を指定した画面が無い）。持ち越した。

### 5. 対照実験（23通り、すべて検出）

誤りを1つずつ入れて、テストが落ちることを確かめた。入れた誤りは元に戻してある。

| 番号 | 入れた誤り | 落ちたテスト |
|---|---|---|
| C1 | 改定で閉じる日を初日にする（1日ずれ） | Domain 1件 |
| C2・C3 | 受注日の判定で末日を含めない／初日を含めない | Domain 各1件 |
| C4 | 無効の単価も受注で使う | Domain 1件 |
| C5 | 支店の受注で支店の単価を探す | Domain 1件 |
| C6 | 支店にも登録できる | Domain 1件 |
| C7 | 重なりの判定で無効の単価も数える | Domain 1件 |
| C8 | 受注の登録が得意先別単価を見ない | 結合 5件 |
| C9・C10 | 単価の問い合わせに権限の検査が無い／無効化の入口を参照の検査に誤る | `PermissionTests` 各1件 |
| C11・C12 | DB の排他制約が無い／無効の行も数える | 結合 各1件 |
| C13〜C16 | 画面: 得意先・受注日を変えても入れ直さない、登録の時に待たない、商品を選ぶと標準単価 | 画面 1〜3件 |
| C17・C18 | 問い合わせの途中で手で直した単価を上書きする／待つ間に入れ直されても送る | 画面 各1件 |
| C19 | 特価の翌日から前の単価を続けない | Domain 4件 |
| C20 | 得意先・商品を参照の同一性で照らす | Domain 1件 |
| C21 | 排他制約の違反を、名前を見ずに単価の理由にする | 結合 1件（税率の重なり） |
| C22 | 入れ直しを全行で1つの仕事として入れない | 画面 3件 |
| C23 | 末日が日付の最大値でも続きを作る | Domain 1件 |

**C23 は最初は検出できなかった。** テストは同じ「前の単価」を使い回して3つの場合を確かめていた。1つ目の確かめで前の単価が閉じてしまい、3つ目（末日が最大の日付）は、閉じる分岐を通らないまま「続きを作らない」に合格していた。確かめるごとに前の単価を作り直し、閉じる分岐を通ったこと（前の単価の末日が 9/30 になった）も確かめる形にして、検出できた。

### 6. CI と AI レビュー（PR #24）

| 回 | 判定 | 費用 | 主な指摘 |
|---|---|---|---|
| 1回目 | 修正後マージ可 | $0.7510 | 見ていない単価で受注される（Important）、特価の後に標準単価に戻る（業務の確認） |
| 2回目 | 修正後マージ可 | $0.8033 | 2行目の入れ直しを待たない（Critical）、問い合わせ中に明細を足すと列挙が壊れる（Important） |
| 3回目 | マージ可 | $0.7725 | Minor 4件（Day52 へ） |
| 4回目 | マージ可 | $0.8091 | 決定の書き出しを足したコミット。Minor は3回目と同じ3件と、単価の画面の知らせの1件（Day52 へ） |

合計 $3.1359。

### 確認

- `dotnet test`: 479件 → **539件**（Domain 221・Web 47・アーキテクチャ 20・結合 240・端から端まで 11）。
- Release ビルドの警告は0件。
- CI（`build-and-test`・`ai-review`）は全回成功。

## 今日学んだこと

- **非同期の入力補助は、送信と競合する。** 単価を「選んだら入れる」だけなら同期で済んだ。DB に問い合わせる形にした途端、「押した時に見えている値」と「送る値」がずれる道が3つできた。送る直前に待つだけでは足りず、待った後で値が変わったら送らない（利用者に見せ直す）ところまでが必要だった。
- **タイミングの誤りは、タイミングを固定する部品で再現する。** `GatedSessions` で問い合わせを止めておくと、競合が毎回同じ順で起き、直す前に確実に落ちるテストが書けた。待ち時間を入れて祈る形にしなくて済んだ。
- **対照実験は、テストが確かめたい分岐を通っているかまで見る。** C23 は「誤りを入れてもテストが通った」ことで、テストが前の確かめの副作用で分岐を通っていないと分かった。合格しているテストでも、通っている道が想定どおりとは限らない。
- **作業の前に聞いても、業務の穴は残る。** 4件を先に聞いたが、「特価の後」は AI レビューが具体例（11/1 に黙って標準単価に戻る）を出すまで気付けなかった。具体の日付と金額で動きを書くと、穴が見える。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| 無効化のテストが、誤りを入れても合格した | ボタンの文字「無効にする」に「無効」が含まれ、状態の列でなく行全体を見ていた | 状態の列（6列目）だけを見る |
| 画面のテストで「105」を期待して「105.00」が返った | DB の `numeric(15,2)` の桁で読まれる | 期待値を「105.00」に |
| 画面のテストが、同時に問い合わせて失敗した | テストの DB の文脈は1つの接続を共有する | 1行ずつ順に問い合わせる。テストも1手ごとに値が変わる形に |
| 業務ルール集の置き換えが、同じ文を2回入れた | 置き換えの順で、挿入した文が次の置き換えの対象になった | 置き換えの順を入れ替え、1か所だけ一致することを確かめる |

## 成果物

**sales-core**（タグ `day51`）
- [src/SalesCore.Domain/CustomerPrice.cs](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Domain/CustomerPrice.cs)（新規）
- [src/SalesCore.Application/MasterUseCases.cs](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Application/MasterUseCases.cs)
- [src/SalesCore.Application/SalesOrderUseCases.cs](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Application/SalesOrderUseCases.cs)
- [src/SalesCore.Infrastructure/Persistence/Migrations/20261116010151_AddCustomerPrices.cs](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Infrastructure/Persistence/Migrations/20261116010151_AddCustomerPrices.cs)（新規）
- [docs/migrations/2026-11-16-AddCustomerPrices.sql](https://github.com/kiyo015/sales-core/blob/day51/docs/migrations/2026-11-16-AddCustomerPrices.sql)（新規）
- [src/SalesCore.Web/Components/Pages/Masters/CustomerPrices.razor](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Web/Components/Pages/Masters/CustomerPrices.razor)（新規）
- [src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor](https://github.com/kiyo015/sales-core/blob/day51/src/SalesCore.Web/Components/Pages/Orders/NewSalesOrder.razor)
- [tests/SalesCore.Domain.Tests/CustomerPriceTests.cs](https://github.com/kiyo015/sales-core/blob/day51/tests/SalesCore.Domain.Tests/CustomerPriceTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/CustomerPriceTests.cs](https://github.com/kiyo015/sales-core/blob/day51/tests/SalesCore.Integration.Tests/CustomerPriceTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/CustomerPricePageTests.cs](https://github.com/kiyo015/sales-core/blob/day51/tests/SalesCore.Integration.Tests/CustomerPricePageTests.cs)（新規）
- [tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs](https://github.com/kiyo015/sales-core/blob/day51/tests/SalesCore.Integration.Tests/SalesOrderPageTests.cs)（`GatedSessions`）
- [tests/SalesCore.E2E.Tests/WebAppFixture.cs](https://github.com/kiyo015/sales-core/blob/day51/tests/SalesCore.E2E.Tests/WebAppFixture.cs)（取り残された Web アプリを止める）
- [docs/domain/business-rules.md](https://github.com/kiyo015/sales-core/blob/day51/docs/domain/business-rules.md)
- [docs/specs/2026-11-13-stage3-sales-completion-design.md](https://github.com/kiyo015/sales-core/blob/day51/docs/specs/2026-11-13-stage3-sales-completion-design.md)
- [docs/decisions/2026-11-16.md](https://github.com/kiyo015/sales-core/blob/day51/docs/decisions/2026-11-16.md)（新規。本人の決定5件）
- [kiyo015/sales-core#24](https://github.com/kiyo015/sales-core/pull/24)

**Study**（タグ `day51`）
- [2026-11-16/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day51/2026-11-16/summary.md)
- [2026-11-16/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day51/2026-11-16/summary.html)
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day51/study_plan_next_month.md)

## 次回予告

**Day52 — 見積（Domain と永続化）**
- 見積と見積明細。状態は作成中 → 提出済 → 受注済／失注。金額と税は受注と同じ計算。
- 有効期限。過ぎた見積は受注にできない（日本時間の今日で判定）。
- マイグレーション（SQL をレビューしてから）。
- 完了条件: 見積の状態×操作の全組み合わせと金額がテストで固定され、マイグレーションがテスト用DBで確かめてある。

**作業の前に本人に聞くこと**
- 見積の状態ごとにできる操作、見積の単価と税率（受注にする時に引き直すか）（Day50 からの申し送り）。
- 過去の日付を初日にした単価の改定を許すか（今は許し、過去の末日を書き換える。AI レビュー3回目の Minor）。
- 受注の画面で手で値引きした単価が、得意先や受注日を変えると入れ直される。手で直した行は入れ直さないか、入れ直した時に知らせるか（AI レビュー3回目の Minor）。

**持ち越し（Day52 の先頭に書いた）**
- 単価の初日に `0001-01-01` を入れると、理由の無いエラー（500）になる（AI レビュー3回目の Minor）。
- 単価の画面の、閉じた・続けた単価の知らせが、同じ時にほかの管理者が登録した単価も拾う（登録の前後の一覧の差で作っている。ユースケースが閉じた・続けた単価を返す形にする。AI レビュー4回目の Minor）。
- 2人が同じ無期限の単価を同時に改定する場面のテストが無い（AI レビュー3回目の Minor）。
- 待つ間に得意先・商品・受注日が変わった時に、古い単価を入れないこと（テストが通らない経路）。
- `Routes.razor` の「権限がありません」の bUnit テスト（役割を指定した画面を作る日まで）。
- DB の接続の時間切れ（見張る）。
