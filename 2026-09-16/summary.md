# Day13 (2026-09-16 水) 学習成果物 — 総合演習

## Day12の持ち越し確認

昨日登録した2つのスケジュールが、**人の手なしで動いた**。

| 経路 | 実行時刻 | 結果 |
|---|---|---|
| アプリの定期タスク（平日9時） | 09:04 | 成功・2往復・約33秒 |
| Windowsのタスクスケジューラ | 09:30 | `exit=0`、ログに「異常なし」 |

昨日承認した許可がタスクに記憶され、2回目以降は確認なしで完走する。

## 今日の題材

`mini-game`（数当てゲーム）に**難易度選択**（やさしい／ふつう／むずかしい）を追加した。これまでの道具が全部通る題材を選んだ。

| 道具 | 今日どこで効いたか |
|---|---|
| CLAUDE.md（Day1） | 「ロジック層はDOMに触らない」の約束を守ったまま拡張 |
| `game-balance`スキル（Day4） | 定数変更の手順。参照資料が**設計の誤りを止めた** |
| `game-playtester`サブエージェント（Day5） | 勝率を3回測定（初期値・上限回数の総当たり・粗いヒント込み） |
| `dev-guard`プラグイン（Day6・10・11） | 編集ごとに自動テスト。**TDDのRED確認を代行** |
| `team-reviewer`サブエージェント（Day11） | Important 6件・Minor 5件の指摘 |
| 健康診断（Day12） | 最後に全体確認。未pushも検知 |
| MCP（Day8・9） | 再有効化し、セッション中の再接続で動作確認 |

## 進め方：要件 → 仕様書 → 計画 → 実装

superpowersの`brainstorming` → `writing-plans` → `executing-plans`の流れで進めた。

1. **要件を4問で固めた** — 難易度の軸（範囲と回数の両方）／選び方（画面のボタン）／API（`createGame(level, randomFn)`）／難しさの基準（勝率 9割・7割・4割）。入れないもの（難易度の記憶・ランキング・カスタム難易度）も決めた
2. **仕様書** `mini-game/docs/specs/2026-09-16-difficulty-levels-design.md`
3. **実装計画** `mini-game/docs/plans/2026-09-16-difficulty-levels.md` — タスク4つ、各ステップ2〜5分の粒度。計画を書いた直後の自己点検で、自分のテストの期待値の誤り（答え491に対して600を`low`としていた）を見つけた

## 今日学んだこと

### 1. フックとTDDは衝突せず、噛み合った

テストを先に書くと`dev-guard`のPostToolUseフックが「テストが失敗した」と差し戻す。一見TDDと衝突するが、差し戻しの内容がそのまま**RED確認**になった。

> `SyntaxError: The requested module '../src/game.js' does not provide an export named 'LEVELS'`

以降、テストを書くたびにフックが失敗理由を、実装するたびに「全件パス」を報告した。手動で`npm test`を打つ必要がなくなった。

### 2. 数値目標に合わせに行くと、運ゲーか過剰適合に落ちる

**最初の測定（範囲と上限だけを変える案）:**

| 難易度 | 実測勝率 | 目標 |
|---|---|---|
| easy（1〜100・8回） | 99.97% | 90% |
| normal（1〜500・10回） | 98.94% | 70% |
| hard（1〜1000・10回） | 82.4% | 40% |

上2段階に実質差がなく、3段階を名乗れていなかった。

**手数を削る案は、スキルの資料が止めた。** 上限回数を総当たりで測ると目標に最も近いのは easy 7／normal 9／hard 9。しかし`game-balance`の参照資料に「最悪手数−1以下は論理的に勝利不可能なケースが生まれる」とある。**これが実測で裏付けられた。** 1〜1000を9回の質問で特定するには区別できる答えが最大2⁹=512通りしかなく、約半分はどう打っても当たらない。実測49.48%はこの理論上限とほぼ一致した。

**逆に、資料の別の記述は間違っていた。** 「最悪手数ちょうどだと、最適戦略を知らないプレイヤーはほぼ確実に負ける」とあったが、実測は easy 93.3%／normal 84.2%／hard 82.4%。悲観的すぎる経験則だったので実測値の表に置き換えた。

**設計変更：難易度の軸を2つにした。** hardだけ「遠い間は方向を教えない」粗いヒントを入れた。

```js
if (game.nearRatio !== undefined) {
  const threshold = Math.floor((game.max - game.min + 1) * game.nearRatio);
  if (Math.abs(value - game.answer) > threshold) {
    return { result: "far", tries: game.tries };
  }
}
```

方向を完全に隠すと収束できず勝率が潰れるので、近づいたら`low`/`high`に戻す。

| nearRatio | 方向が出る距離 | 勝率 |
|---|---|---|
| 0.05 | ±50 | 51.5% |
| 0.10 | ±100 | 77.4% |
| 0.15 | ±150 | 86.1% |
| 0.20 | ±200 | 88.7% |

0.05を採用し、3段階が **93% / 84% / 51%** の明確な階段になった。0.03まで下げれば40%に届く可能性はあったが追わなかった。測定に使った戦略は人間よりかなり体系的な虱潰しで、そこへ合わせ込むのは過剰適合だから。**目標から外した理由は`docs/game-rules.md`に記録した**（書かないと次に調整する人が同じ測定をやり直す）。

### 3. AIの測定値も、戦略の定義を明記させて疑う

playtesterには毎回「どういう打ち方にしたかを必ず報告に明記せよ」と指示した。明記させたから「人間より体系的」と判断でき、過剰適合を避けられた。

### 4. レビューで直したのは、コードより文書の陳腐化の方が多かった

`team-reviewer`の指摘を実測で確かめてから直した。

| 指摘 | 実測 | 対応 |
|---|---|---|
| `createGame("toString")`が例外にならない | **再現**（`answer: NaN`の壊れたゲームが返る） | `Object.hasOwn`で判定 |
| 「hardは手数が理論上足りている」は成立しない | 論理を検証し**妥当**。`far`中は1手で最大101通りしか消せず、1000通りを覆うだけで10手を使い切る | 文書と資料に注記 |
| 仕様書が自分自身と矛盾（`nearRatio 0.1`・旧上限回数） | **再現** | 「初期案」と明示し定義元を指す |
| テストのコメントが旧しきい値のまま | **再現** | 値を書かず「しきい値ちょうど／+1」に |
| 目標との差を据え置いた理由が無い | そのとおり | 理由を記録 |
| テストの保護不足（lose優先・上側境界・farが答えを漏らさない） | 現状は正しいが保護が無い | 3件追加 |

**コードは実行すれば嘘が暴かれるが、文書は誰も実行しないので嘘のまま残る。** レビュー役に「ドキュメントとコードの食い違いも見て」と明示的に頼んだのが効いた。

### 5. 健康診断のレポートが壊れていた、本当の原因は2つあった

健康診断が異常を検知した時のAI要約が「失敗項目と出力、まだ貼られてない。内容貼って。」と返った。最初は「haikuの品質」と見ていたが、どちらも違った。

**原因1：運搬。** `claude`はnpmの`claude.cmd`なのでcmd.exe経由でしか起動できず、引数はエスケープされずに空白で連結される。Claudeが受け取っていたのは次だけだった。

```
["-p", "健康診断の結果。以下を要約して。"]
```

プロンプトは最初の改行で打ち切られ、後ろの`--model haiku`と`--tools ""`は丸ごと消えていた。**Day12で入れた「ツール禁止」は、スクリプト経由では一度も効いていなかった。** Day12の単体試験はGit Bashから直接起動していたので、この経路を通っていなかった。→ プロンプトを**標準入力**で渡す形に修正。

**原因2：中身。** 運搬を直しても「失敗の出力が見当たらない」と返った。フックの干渉を疑い、フックを切って1変数だけ変えて試したが同じ結果——**仮説は外れ**。`未コミット 0件 / 未push 7件`は状態の要約で、**基準を渡していないと失敗に見えない**。基準を1行添えたら、(1)壊れているもの (2)原因の推測 (3)次の確認 がそろった報告書になった。

どちらも最初の見立てが外れていた。「モデルの品質」で片付けていたら、ツール禁止が効いていない問題は隠れたままだった。

### 6. テストは「狙った理由で落ちる」ことまで確かめる

- 修正前に健康診断のテストを走らせたら「1件成功」と出た。テストが`health-check.js`を読み込んだ瞬間に本体が走り、`process.exit(0)`でテストごと終了していた。**1件も実行されていない偽りの成功**
- 表示文のテストも、「ファイルが無い」で落ちるだけでは何も確かめていない。わざと`far`を抜いた表を置き、「応答 "far" の表示文が無い」で落ちることを見てから足した

## 実践内容

### 実装（`mini-game`）

- `src/game.js`: 定数3つを`LEVELS`表に集約（easy 1〜100/7回、normal 1〜500/9回、hard 1〜1000/10回＋`nearRatio` 0.05）。`createGame(level, randomFn)`。未知の難易度は`Object.hasOwn`で判定して例外
- `web/app.js`・`web/index.html`: 難易度ボタンを`LEVELS`から生成。表示と入力制限は`game`の値から引く。既定難易度はUI側に書かない
- `web/messages.js`: 応答ごとの表示文を切り出し（DOMに触れないのでテストできる）
- `test/game.test.js`: 15件（難易度ごとの範囲・上限・粗いヒントの境界・lose優先など）
- `test/messages.test.js`: 全難易度で決定的に1500回遊ばせ、実際に出た応答すべてに表示文があるか確認。応答の一覧を別に持たないので、ロジック側で応答が増えれば自動的に検知できる
- `docs/game-rules.md`: 難易度表・粗いヒント・目標との差を据え置いた理由・調整時の注意を全面改訂

ブラウザで実際に動かして確認した（難易度の切り替え、範囲外入力が弾かれること、むずかしいの`かなり離れている`表示、コンソールエラーなし）。

### 健康診断（`checks/`）

- `health-check.js`: プロンプトを標準入力で渡す／失敗項目ごとに基準と出力を並べる`buildPrompt`を追加／読み込んだだけでは実行しない形に
- `health-check.test.js`: **本番と同じ`.cmd`経由**で、引数と標準入力が壊れずに届くことを検証（4件）。健康診断の項目にも追加（全8項目）
- 未pushの状態をわざと作って本物の`claude`で異常経路を通し、正しい報告書が出ることを確認

### その他

- `game-balance`スキルの参照資料を実測値で改訂（余裕±0でも8〜9割勝てる／余裕+1は段階にならない／粗いヒントの下では最悪手数の保証が成立しない）
- MCPサーバー`study-progress`を再有効化。セッション中に再接続され、`study_progress`が「12/14日完了、次はDay13」と正しく返した
- `.claude/launch.json`: ブラウザ確認用に`mini-game`の起動設定を追加

## 気づき・発見

- **道具は「気づかせる」ために置いてある。** スキルの参照資料がなければ「目標勝率に合わせて9回にする」で終わり、半分勝てないゲームができていた
- **ドキュメントは書いた瞬間から嘘になりうる。** 今日直した誤りのうち3件が、自分が数時間前に書いた文書の陳腐化だった
- **数値目標は物差しであって正解ではない。** 外した値を採用し、なぜ外したかを残すのが正しい着地
- **「動いた」と確かめた時の経路と、本番の経路は違うことがある。** Git Bashで動いたものがcmd.exe経由では壊れていた
- **最初の見立ては外れる前提で、1変数ずつ確かめる。** 今日の不具合調査は、2つの仮説のうち1つが外れた

## 成果物

リンクはタグ`day13`に固定している。

- [`mini-game/src/game.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/src/game.js)（`LEVELS`表・粗いヒント）
- [`mini-game/web/app.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/web/app.js) ／ [`web/index.html`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/web/index.html) ／ [`web/messages.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/web/messages.js)
- [`mini-game/test/game.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/test/game.test.js)（15件） ／ [`test/messages.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/test/messages.test.js)
- [`mini-game/docs/game-rules.md`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/docs/game-rules.md)（難易度表・据え置いた理由）
- [`mini-game/docs/specs/2026-09-16-difficulty-levels-design.md`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/docs/specs/2026-09-16-difficulty-levels-design.md)（仕様書）
- [`mini-game/docs/plans/2026-09-16-difficulty-levels.md`](https://github.com/kiyo015/vibe-coding-study/blob/day13/mini-game/docs/plans/2026-09-16-difficulty-levels.md)（実装計画）
- [`.claude/skills/game-balance/references/difficulty-math.md`](https://github.com/kiyo015/vibe-coding-study/blob/day13/.claude/skills/game-balance/references/difficulty-math.md)（実測で改訂）
- [`checks/health-check.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/checks/health-check.js) ／ [`checks/health-check.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day13/checks/health-check.test.js)
- [`.claude/launch.json`](https://github.com/kiyo015/vibe-coding-study/blob/day13/.claude/launch.json)
- [`study_plan_2weeks.md`](https://github.com/kiyo015/vibe-coding-study/blob/day13/study_plan_2weeks.md)
- [`2026-09-16/summary.html`](https://github.com/kiyo015/vibe-coding-study/blob/day13/2026-09-16/summary.html)（配布用HTML版）

## 次回（Day14）予告

最終日。14日分の学習記録を読み返して要点をまとめ、「まだ弱い」領域を3つ特定して次の学習テーマを決める。再接続できたMCPの`search_learnings`で過去の記録を横断検索しながら進める。
