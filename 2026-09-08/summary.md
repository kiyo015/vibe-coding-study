# Day7 (2026-09-08 火) 学習成果物 — 週次振り返り＋統合実践

## 前半: 週次振り返り

Day1〜6の記録を読み返し、「実物を触って実証したこと」と「説明しただけで手を動かしていないこと」を仕分けた。後者が5つ残っていた。

| 未実践だった要素 | 対応 |
|---|---|
| CLAUDE.mdのimport構文（`@path`記法） | **今日実践・実証済み** |
| スキルの付属リソース（`references/`） | **今日実践・実証済み** |
| サブエージェントのmodel指定の効果 | 未実施（別モデルでの比較検証が必要） |
| hooksの他イベント（`Stop`・`SubagentStop`・`PreCompact`） | 未実施 |
| ユーザーグローバルCLAUDE.md（`~/.claude/CLAUDE.md`） | 未実施 |

## 後半: 新規プロジェクトへの4機構ゼロ導入

`mini-game`（数当てゲーム）を新規作成し、CLAUDE.md・スキル・サブエージェント・hooksを一式導入した。

### 作ったもの

- `src/game.js` — ゲームロジック層。DOMに触れない。乱数を引数注入にしてテストを決定的にした
- `web/` — UI層。`src/game.js`をESモジュールで直接import
- `server.js` — 動作確認用の静的配信のみ（ESモジュールは`file://`で動かないため）
- `test/game.test.js` — 6件

**設計判断:** vibe-practiceの`frontend/`は「ESモジュール不使用」規約だったが、mini-gameでは使う。**同じ人が作る別プロジェクトでも規約が違っていい**——Day2のスコープ設計そのものの実例。また`server.js`はvibe-practiceのものを流用せず新規に書いた（別プロジェクト間で依存させない）。

### 機構1: CLAUDE.md（import構文）

`docs/conventions.md`（規約）と`docs/game-rules.md`（ゲーム仕様）に分割し、CLAUDE.mdから`@docs/conventions.md`の形で参照。

正直、この規模なら分割は不要（Day1の「書きすぎるな」からすると1ファイルで足りる）。今日は「import構文を実際に使う」のが目的なので意図的に分割した。

**盲検で実証:** `src/game.js`しか読ませていないサブエージェントに「MAX_TRIES=8の根拠は？」「src/の規約は？」と質問。`docs/`両ファイルの内容を正確に回答し、自分から「CLAUDE.mdの`@docs/...`参照によるインポートで自動的にコンテキストに読み込まれていた」と説明した。Day2から未検証だった要素がこれで埋まった。

### 機構2: スキル（`references/`付き）

`game-balance`スキル（難易度定数を変える時の手順）＋`references/difficulty-math.md`（範囲ごとの推奨試行回数、手数を削るとどこから運ゲーになるか）。

`references/`を使う理由が自然にあった——難易度計算の数学的背景は本文には長すぎるが、実際に調整する時だけ必要。Progressive Disclosureの3段階目。

### 機構3: サブエージェント

`game-playtester`（`tools: Read, Bash`）。Day5の`vibe-code-locator`（`Read/Grep/Glob`）とは逆の設計——**実行は許すが変更はさせない**。シミュレーションを走らせて数値で報告する役割。

### 機構4: hooks（既存を拡張）

`post-edit-test.js`の正規表現を`(vibe-practice|mini-game)`に拡張し、編集されたファイルからプロジェクト名を判定して該当プロジェクトで`npm test`を走らせる形に。新しいhookは作らず既存を拡張（「package.jsonを探して自動判別」のような汎用化は今の規模では過剰）。mini-gameの編集で発火することを実測確認。

## 統合検証: 5日分の学びを1つの検証に重ねる

「mini-gameを難しくして、範囲を1〜500に」という依頼をサブエージェントに投げた（自分で呼ぶと盲検にならないため）。`isolation: worktree`で隔離した上で実行。

**成功した3点:**

1. **スキルが自発的に発火** — エージェントは「起動前に読めたのはスキル一覧の説明文だけ」と明言。descriptionだけを見て起動を判断し、それから本文を読んだ（Day3のトリガー機構の実地確認）
2. **`references/`が"必要な時だけ"読まれた** — スキル本文の「曖昧な要望の場合は読むこと」に従って`difficulty-math.md`を開き、「1〜500なら推奨MAX_TRIES=10」という根拠を採用
3. **import経由の規約も効いた** — `docs/conventions.md`の「マジックナンバー禁止」に基づき、UIに直書きされていた`1〜100`/`max="100"`を定数参照に修正。スキル本文が予告していた「`web/`を直す必要が出たらそれは設計上の問題」というケースが実際に的中した

**重大な発見: worktree隔離が効いていなかった**

`isolation: worktree`で起動したのに、エージェントは本体を直接編集していた。理由は本人の報告通り、`mini-game`がまだgit管理下になかった（未コミット）ため、worktreeに複製されなかった。

> **worktree isolationはgit管理下のファイルにしか効かない。** 未追跡ファイルはworktreeに存在しないので、隔離したつもりが素通しになる。

Day5で成功したのは`vibe-practice`がコミット済みだったから。Day1の「バージョン管理前に上書きして復元不能」と根っこが同じ——**git管理外のファイルには、gitベースの安全機構が一切効かない**。対処として`mini-game`をgit管理下に入れた。

## Day5の結論を修正

Day5で「サブエージェントは次回セッション開始時に反映される」と結論づけたが、**言い過ぎだった**。今日作成した`game-playtester`は、作成直後は認識されなかったが、**同一セッション内で数ターン後に自動出現**した。

正しくは「即時ではないが、次回セッションを待つ必要もない。定期的に再スキャンされる」。CLAUDE.md/スキル（即時）より1テンポ遅れる、という点だけが確か。Day5・Day6の記録も修正済み。

## バランス変更の実測検証

採用した「1〜500・10回」が妥当か、`game-playtester`で8戦略×1万回シミュレーション。

| 戦略 | 勝率 | 平均手数 |
|---|---|---|
| 最適戦略（厳密な二分探索） | 100.0% | 8.02 |
| 中央狙い±15%誤差 | 98.6% | 8.15 |
| 中央狙い±30%誤差 | 81.8% | 8.07 |
| 絞り込みが10%甘い | 69.7% | 8.31 |
| 絞り込みが20%甘い | 39.3% | 8.14 |
| 完全ランダム | 2.0% | 5.28 |

**洞察:** 勝敗を最も左右するのは「中央を正確に狙えるか」ではなく「フィードバックを受けて範囲を正確に絞り込めるか」。絞り込みが20%甘いだけで勝率が39%まで落ちる——ヒント表示を見落としやすいUIだと体感難易度が跳ね上がる、という設計への示唆が得られた。

## 追記: 作ったゲームが実際には動かなかった件

クローズ後、「数当てゲームが動かない」との指摘。調べるとHTMLファイルを直接開いており、ESモジュールのCORS制約で`file://`では読み込めず**無言で壊れていた**（画面は表示されるが数字が全部空になる）。

**何が問題だったか:**

- `npm test`は6件パス、サーバー経由の動作確認も済ませていた。**それでも「ユーザーが実際にやる操作」では動かなかった**
- 「HTMLをダブルクリックすれば動く」と期待するのが自然なのに、サーバー必須であることをどこにも書いていなかった——テストが通ることと、使えることは別問題

**対処:**

1. モジュールが読み込めなかった場合に警告を表示（`npm run dev`して`localhost:3100`を開くよう案内）
2. `mini-game/CLAUDE.md`に「直接開いても動かない」を理由付きで明記

**実装で判断を変えた点:** 最初は`location.protocol === "file:"`で判定したが、それだと検証環境では警告が出なかった（プレビューが`data:`URLとして描画するため）。プロトコル判定は「たぶん`file://`なら動かないだろう」という**間接的な推測**でしかない。「`app.js`が実際に実行されたか」を直接見る方式に変えたところ、確実に検出できた。パス誤りなど他の読み込み失敗も同じ警告で拾える。

Day1の`game/CLAUDE.md`にあった「新しい発見の多くは錯覚・局所のみで判断」という戒めと同じ構図——**症状の代理指標でなく、症状そのものを見る**。

## 成果物

- [`mini-game/`](https://github.com/kiyo015/vibe-coding-study/tree/master/mini-game) 一式（`CLAUDE.md`・`docs/`・`src/`・`web/`・`test/`・`server.js`）
- [`.claude/skills/game-balance/SKILL.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/skills/game-balance/SKILL.md) ＋ [`references/difficulty-math.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/skills/game-balance/references/difficulty-math.md)
- [`.claude/agents/game-playtester.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/agents/game-playtester.md)
- [`.claude/hooks/post-edit-test.js`](https://github.com/kiyo015/vibe-coding-study/blob/5612ad6/.claude/hooks/post-edit-test.js)（2プロジェクト対応に拡張。Day10でプラグインへ移したため、このDay時点のコミット`5612ad6`に固定したリンクに差し替えた）

## 次回（Day8）予告

MCP概要。MCPサーバーとは何か・何ができるか（外部API/DB/ブラウザ操作等）、接続方法・設定ファイルの場所。実際に使えるMCPサーバーを1つ呼び出して、ツール定義と結果を照らし合わせる。
