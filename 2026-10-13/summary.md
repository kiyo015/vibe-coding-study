# Day28 学習記録（2026-10-13）— CI（ビルドとテスト）

基幹システム開発計画の14日目。GitHub Actions で、PR ごとにビルドとテストを流す CI を作った。main にルールを付け、CI が通らない PR はマージできないようにした。Day26 から持ち越した「結合テストが CI でも手元と同じ結果になる」も、テスト1件ごとに突き合わせて確かめた。

**完了条件「PR を作ると CI でテストが走り、失敗すればマージできない」は達成した。** sales-core の進め方は、この日から「main へ直接 push」でなく「ブランチ → PR → CI → マージ」になった。

## 今日行った処理

### 1. CI の定義（`.github/workflows/ci.yml`）

| 項目 | 内容 |
|---|---|
| いつ動くか | PR と、main への push。ジョブ名 `build-and-test` |
| ビルド | `dotnet build --configuration Release -warnaserror`（警告もエラー） |
| テスト | `dotnet test --no-build --configuration Release --logger trx`。テストごとの成否（trx）を成果物 `test-results` に残す |
| DB | PostgreSQL 18 のサービスコンテナ（`salescore_test`）。ジョブの間だけの使い捨て。公式イメージに `btree_gist` が入っている。マイグレーションは結合テストが最初に当てる |
| 接続文字列 | 環境変数 `ConnectionStrings__SalesCoreTest`（手元の user-secrets の `ConnectionStrings:SalesCoreTest` に当たる）。パスワードはこのコンテナ専用で、秘密情報ではない |
| SDK | `global.json` で 8.0.421 にそろえた（計画に無かった追加。下の「学んだこと」） |

### 2. 手元と CI の突き合わせ（Day26 からの持ち越し）

件数だけでなく、**テスト1件ごとの「名前 → 成否」**を比べるスクリプトを書いた（`evidence/2026-10-13-compare-trx.js`）。手元は CI と同じコマンド（Release・`-warnaserror`）で流した。

| | アーキテクチャ | Domain | 結合 | 手元との違い |
|---|---|---|---|---|
| 手元 | 9 | 125 | 22 | — |
| CI 1回目（a054975、71秒） | 9 | 125 | 22 | **0件** |
| CI 最後（66a41fb、53秒） | 9 | 125 | 22 | **0件** |

結合テスト22件には、まっさらなスキーマに全マイグレーションを当てる `MigrationTests` も入っている。CI のまっさらな DB でも、手元の適用済みの DB と同じ結果になった。

比較スクリプト自体も確かめた。CI の結果の1件を「失敗」に書き換えた写しと比べると、その1件を差として報告し、終了コード1になった。

CI の時間の内訳（1回目）: DB コンテナの起動 21秒、restore 10秒、build 11秒、test 6秒。

### 3. main のルール

選んだのは「PR 必須＋CI 必須（管理者も例外なし）」。GitHub の API でルールセット「main: PR and CI required」を作った。

| ルール | 内容 |
|---|---|
| PR 必須 | main へは PR でしか入れられない。承認は0件でよい（一人で開発しているため） |
| CI 必須 | `build-and-test` が成功していないとマージできない。main の最新を取り込んでいることも必須 |
| 禁止 | 強制 push、main の削除 |
| 例外 | なし（管理者も同じ） |

### 4. 対照実験

| 状態 | CI | PR |
|---|---|---|
| ルールを付ける前（1回目の CI の実行中） | 実行中 | `CLEAN`（マージできた） |
| ルールを付けた後、CI の実行中 | 実行中 | `BLOCKED` |
| わざと落ちるテスト（`SELECT 1` が 2 であること）を足して push | **失敗**。落ちたのはそのテスト1件だけ（9・125・22 は全件成功） | **`BLOCKED`** |
| そのテストを消して push | 成功 | `CLEAN` |

### 5. 自動モードの分類器に止められた操作

| しようとしたこと | 止めた理由（分類器） | 代わりにしたこと |
|---|---|---|
| 製品コードの安全策（保存のときの削除の禁止）を外して push する | 安全策のテストの除去 | わざと落ちるテストを足す形にした。製品コードは触らない |
| 失敗した PR を実際にマージする（`--admin` を含む）、main へ直接 push する | CI の迂回 | ルールの中身と `BLOCKED` を API で読んで確かめた |

どちらも回避はしていない。公開リポジトリの main に、安全策を外したコードや CI の迂回が入る危険がある操作なので、止められて当然の内容だった。

### 6. 文書

- **sales-core の CLAUDE.md**
  - 「CI」の節を足した（ワークフロー、DB、SDK の固定、突き合わせの結果）
  - 禁止事項に「ビルドかテストが落ちた変更を main に入れる＝強制（GitHub のルール）」の行を足した
  - 開発の進め方の先頭に「main に直接 push しない。ブランチ → PR → CI が通ってからスカッシュマージ」を足した
- **daily-closeout スキル**: sales-core の締めを、CI の成功を確かめる → スカッシュマージ → main を取り込む → main のコミットにタグ `day{N}`、に書き換えた。CI が失敗していたらマージせず、締めを止めて報告する

## 今日学んだこと

### 「同じ結果」は件数でなく、1件ごとに比べる

件数（156件成功）が同じでも、別のテストが成功して別のテストが落ちていれば同じ結果ではない。テストの名前と成否の対応で比べると、違いがあればどのテストかまで出る。比べる仕組みが差を見落とさないことも、わざと差を作って確かめた。

### SDK の版は、そろえないと CI で勝手に変わる

GitHub の ubuntu の実行環境には、新しい SDK も最初から入っている。`global.json` が無いと、手元の 8.0.421 でなく新しい SDK でビルドされる。Day23 で、アナライザはコンパイラの版によって黙って読み込まれないことを見ている。CI のログで 8.0.421 が入ったことを確認した。

### CI を作っただけでは、失敗してもマージできる

ルールを付ける前は、CI の実行中でも PR は `CLEAN`（マージできる）だった。「失敗すればマージできない」は CI ではなく、main のルールが作る。

### 自動モードの分類器は、CI や安全策を弱める操作を止める

対照実験のつもりでも、公開リポジトリに安全策を外したコードを push する操作や、マージの迂回を試す操作は止められた。対照実験は「安全策を外す」でなく「わざと落ちるものを足す」形にすると、同じことを確かめられる。

## つまずき

| 症状 | 原因 | 対策 |
|---|---|---|
| main のルールを API で調べると「Branch not found」 | 既定のブランチは `master` でなく `main` だった | `main` で調べ直した |
| 手元の作業フォルダを `rm -rf` で作り直そうとして止まった | dev-guard のフックが再帰かつ強制の削除を止めた（正しい動作） | 消さずに新しいフォルダ名を使った |
| アプリの PR の状態が、新しい CI の実行を反映していなかった | アプリのキャッシュ | `gh pr view` で1回だけ直接確かめた（繰り返しの問い合わせはしない） |

## 気づき・発見

- CI は公開リポジトリなので GitHub Actions の費用は0。1回の実行は約1分（DB コンテナの起動が3割）
- 一人で開発しているので、承認の数は0件にした。1件以上にすると、自分の PR を自分で承認できず、マージできなくなる
- Day29 の AI レビューは PR に結果を残す。必須のチェックにするか（失敗したらマージできないか）は Day29 で決める

## 成果物

### sales-core（製品コード）

- [.github/workflows/ci.yml](https://github.com/kiyo015/sales-core/blob/day28/.github/workflows/ci.yml) — CI の定義
- [global.json](https://github.com/kiyo015/sales-core/blob/day28/global.json) — SDK の版
- [CLAUDE.md](https://github.com/kiyo015/sales-core/blob/day28/CLAUDE.md) — CI の節、禁止事項、開発の進め方
- [PR #1](https://github.com/kiyo015/sales-core/pull/1) — CI の失敗と成功の記録

### Study（学習記録）

- [evidence/2026-10-13-ci-results.txt](https://github.com/kiyo015/vibe-coding-study/blob/day28/evidence/2026-10-13-ci-results.txt) — 突き合わせ、ルールの中身、対照実験
- [evidence/2026-10-13-compare-trx.js](https://github.com/kiyo015/vibe-coding-study/blob/day28/evidence/2026-10-13-compare-trx.js) — 手元と CI の結果を比べるスクリプト
- [.claude/skills/daily-closeout/SKILL.md](https://github.com/kiyo015/vibe-coding-study/blob/day28/.claude/skills/daily-closeout/SKILL.md) — sales-core の締めを PR 経由に
- [study_plan_next_month.md](https://github.com/kiyo015/vibe-coding-study/blob/day28/study_plan_next_month.md) — Day28 の実測値
- [2026-10-13/summary.md](https://github.com/kiyo015/vibe-coding-study/blob/day28/2026-10-13/summary.md) ／ [2026-10-13/summary.html](https://github.com/kiyo015/vibe-coding-study/blob/day28/2026-10-13/summary.html)

## 付録：検証の中身

スクリプト本体はメールに添付しない（`.js` は危険な添付と扱われる）。要点と結果をここに載せる。

### 比べ方（compare-trx.js の要点）

```
trx の <UnitTestResult testName="..." outcome="..."> を全部読み、名前 → 成否 の表を手元と CI で作る
名前の和集合の中で、成否が違う(片方に無いも含む)ものを「違い」として出す。違いがあれば終了コード 1
```

### 結果

```
== 手元と CI(1回目 a054975)
手元: 156件(成功 156)  CI: 156件(成功 156)
  SalesCore.Architecture: 手元 9  CI 9
  SalesCore.Domain: 手元 125  CI 125
  SalesCore.Integration: 手元 22  CI 22
違い: 0件

== 比較スクリプトの自己確認(CI の1件を Failed に書き換え)
違い: 1件
  SalesCore.Integration.Tests.PersistenceMappingTests.得意先コードは重複できない: 手元=Passed CI=Failed
exit=1

== わざと落ちるテストを足した CI(57b5287)
build-and-test = FAILURE
Architecture 9/9、Domain 125/125、Integration 22/23
失敗: SalesCore.Integration.Tests.CiProbeTests.わざと落ちる
PR: BLOCKED

== テストを消した後(66a41fb)
build-and-test = SUCCESS、PR: CLEAN、手元との違い 0件

== main のルール(gh api repos/kiyo015/sales-core/rules/branches/main)
deletion / non_fast_forward / pull_request(承認 0) / required_status_checks [build-and-test](strict)
bypass_actors なし
```

今日の費用は0（`claude -p` を使っていない。CI は公開リポジトリなので無料）。

## 次回予告

**Day29 — CI（AIレビュー）**

- `claude -p` による PR レビュー。Day12・13・14 の教訓をそのまま使う（プロンプトは標準入力／`--tools ""` と `--strict-mcp-config`／失敗の基準も渡す／1回の費用を記録）
- APIキー（GitHub Secrets）の登録は本人が行う
- 申し送り: PR の作り方と CI はできている。AI レビューを必須のチェックにするかを決める。レビュー結果にパスワードなどが写り込まないようにする

**完了条件:** PR に AI レビューの結果が残り、1回あたりの費用が記録されている

**持ち越し:** Day28 の分は無し。
