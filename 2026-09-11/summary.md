# Day10 (2026-09-11 金) 学習成果物 — プラグイン化

## Day9の持ち越し: 自作ツールを実際の用途で使う

Day9で追加した`search_learnings`が新セッションで接続された。確認を兼ねて、今日のテーマ「プラグイン」について過去の学びを検索した——**Day9で作ったツールをDay10の準備に使う**、開発フローへの組み込みの実例そのもの。

検索して気づいたこと: Day6でgenshijinの`plugin.json`内に`hooks`キーがあるのを読んだのに、その記録がヒットしなかった。Day6の記録では`plugin.json`という語を使っていなかったため。**検索ツールを作ったことで、記録の書き方の抜けが見えた。**

## 今日学んだこと

### プラグインとは

これまで個別に置いてきた機構を、**1つの配布単位にまとめたもの**。`.claude/skills/`等に置いた資産はそのリポジトリ内でしか使えず、別プロジェクトではコピーするしかない。プラグインなら1回インストールで全部入る。

### 実例分析: genshijinの構造

全機構を同梱した完全版の実例:

| ディレクトリ | 中身 |
|---|---|
| `skills/` | 7個 |
| `agents/` | 3個 |
| `hooks/` | 複数（**Windows用`.ps1`とUnix用`.sh`を両方**用意） |
| `mcp-servers/` | 1個 |
| `.claude-plugin/` | `plugin.json`と`marketplace.json` |

さらに`.clinerules/`・`.cursor/rules/`・`.windsurf/rules/`・`.github/copilot-instructions.md`・`AGENTS.md`と、**他のAIツール用の設定ファイル**も並んでいた。Day8で学んだ「N×M問題」の実物——MCPは共通規格でN+Mに解決したが、ルールファイルは各ツールがバラバラの形式なので、全形式を個別に用意するしかない。

hooksが`.ps1`と`.sh`の両方ある点も示唆的。自分のhooksはNode.jsで書いたので最初からこの問題を回避できていた。**言語選択がそのまま可搬性に効く。**

### プラグインの2層構造

- **`plugin.json`** — 1つのプラグインの定義
- **`marketplace.json`** — 配布カタログ。`plugins: [...]`で複数を列挙できる

これで`~/.claude/settings.json`の`"genshijin@genshijin"`という記法が読める——`プラグイン名@マーケットプレイス名`。

### 実践前の重要な判断: 全部まとめても意味がない

作った資産を棚卸しすると、ほとんどが**このリポジトリ専用**だった:

| 資産 | 汎用性 |
|---|---|
| `pre-bash-guard` | ✅ どこでも使える |
| `post-edit-test` | ⚠️ `vibe-practice\|mini-game`を明示列挙 |
| `daily-closeout` / `study-progress` MCP | ⚠️ このリポジトリの運用専用 |
| `game-balance` / `game-playtester` / `vibe-code-locator` | ❌ 特定プロジェクト専用 |

**プラグイン化は「まとめる作業」ではなく「汎用化する作業」。** Day1のCLAUDE.mdのスコープ設計と同じ判断で、汎用的な2つだけをプラグインに出し、残りはプロジェクトに残した。

しかもDay7で`post-edit-test`について「package.jsonの自動判別は今の規模では過剰」とYAGNIで見送っていた。**プラグイン化という要件が来た今、まさにその汎用化が必要になった。** YAGNIは「今やらない」であって「永遠にやらない」ではない。

## 実践内容

### プラグイン`dev-guard`を作成

```
plugins/dev-guard/
├── .claude-plugin/plugin.json   ← hooksを${CLAUDE_PLUGIN_ROOT}で登録
└── hooks/
    ├── pre-bash-guard.js        ← 限界(ブロックリスト方式の漏れ)をコメントに明記
    └── post-edit-test.js        ← 汎用化
.claude-plugin/marketplace.json  ← カタログはプラグイン本体と分離
```

**マーケットプレイスとプラグインを分離した理由:** genshijinは同居形式で区別が見えにくかった。分離すると将来プラグインを増やしても`plugins/`に足してカタログに1行追加するだけで済み、しかもこのリポジトリ自体がGitHub経由の配布元になる。

### `post-edit-test`の汎用化

プロジェクト名のハードコードをやめ、**編集されたファイルから親を遡って最初に見つかったpackage.jsonでテストする**方式に変更。設計判断が3つ:

1. **最も近いpackage.jsonで止まる** — そこに`test`スクリプトが無ければ親を探しに行かない（ネストしたプロジェクトで親のテストを誤って走らせないため）
2. **プロジェクトルートより上に遡らない** — ホーム直下の無関係なpackage.jsonを拾わないため
3. **execSyncのtimeout(25秒) < hookのtimeout(30秒)** — 逆だとhookごと殺されて失敗の理由を何も報告できない

### 単体検証で踏んだ2つの罠

**罠1: テストの入力が壊れていた。** 最初の検証で出力が空になった。`silent fail`でエラーが握りつぶされていたので、スクラッチパッドのコピーでエラーを表に出すと`Bad escaped character in JSON`。**hook本体でなく、Git Bashの`printf`経由でWindowsパスの`\\`が崩れていた**。`JSON.stringify`で正しいJSONを生成して流し直すと4ケースすべて期待通りに動いた。

Day7の「テストが通っても使えない」の**逆パターン**——「テストが失敗しても本体は正しい」こともある。失敗を見たら、本体を疑う前にテスト自体を切り分ける。

**罠2: 壊したつもりが壊れていなかった。** 異常系検証で`MAX_TRIES`を10→3にしたが、テストが失敗しなかった。テストは`for (let i = 0; i < MAX_TRIES; i++)`と**定数を参照している**ので、変えても通る。怪我の功名で、**このテストは定数変更に強い良い設計**だと偶然実証された。確実に落とすため`MAX_NUMBER`（テストが答え246を決め打ちしている）を変えて、`decision: block`と失敗テスト名の報告を確認した。

### プロジェクトスコープで有効化

`claude plugin`コマンドで登録。**`--scope`のデフォルトは`user`**（全プロジェクトに効く）なので要注意——何も考えずに実行するとユーザーのグローバル設定に書き込まれる。今回は`--scope project`で、グローバル設定を触らずgit管理される（チーム共有できる）形にした。

| スコープ | 書き込み先 | 影響範囲 |
|---|---|---|
| `user`（デフォルト） | `~/.claude/settings.json` | 全プロジェクト |
| `project` | `.claude/settings.json` | このプロジェクト・git管理 |
| `local` | `.claude/settings.local.json` | このプロジェクト・git管理外 |

### 最大の収穫: 5機構のコンテキストコストが数値で揃った

`claude plugin details`でトークンコストの見積もりが見られる。

**dev-guard（hooksのみ）:**
```
Hooks (2)  PreToolUse, PostToolUse  (harness-only — no model context cost)
Always-on:   ~0 tok
```

**genshijin（全機構入り）:** 常時~448トークン。例えば`genshijin`スキルは**常駐~40トークン・発火時~920トークン**——本文は常駐の23倍。Day3で`systematic-debugging`を「frontmatter2行＋本文296行」と**行数で**実測したことの、**トークン数での裏付け**。

| 機構 | 常時コスト | 発火時コスト | 根拠 |
|---|---|---|---|
| CLAUDE.md | **全文** | — | Day1 |
| スキル | description分（30〜90tok） | 本文（80〜920tok） | Day3・今日 |
| サブエージェント | description分（40〜50tok） | 本文（190〜240tok） | 今日 |
| MCP | ツール定義全部（遅延ロードで緩和） | 実行結果 | Day8 |
| **hooks** | **ゼロ** | **ゼロ** | **今日** |

Day1から積み上げた理解が1つの表に収まった。**hooksだけが唯一のゼロ**——Day6で「モデルを介さず実行される」と学んだ性質が、そのままコストに表れている。

### 後始末で見つかった3つの問題

**1. ツールが絶対パスを自動で書き込んだ。** `claude plugin marketplace add`が`.claude/settings.json`に`"path": "C:\\Users\\sakaguchi\\Study"`を書いた。Day6で全ファイルから絶対パスを排除したのに、ツールの自動生成で元に戻った。`"path": "."`に直し、`marketplace update`で`Validating local marketplace`が通ることを確認。**ツールが自動生成した設定も中身を確認する。**

**2. 旧hooksとの二重発火。** プロジェクトの`settings.json`に書いた旧hooksとプラグインのhooksが両方発火する状態だったので、旧定義とスクリプトを削除した。

**3. 過去の記録のリンクが切れる。** 旧hooksを消す前に`search_learnings`で`.claude/hooks/`を検索すると、Day6・Day7の記録が`blob/master/...`でリンクしていた。しかも調べると、**`master`参照は最初から微妙にズレていた**——Day6の記録が指すべきはDay6時点のファイルなのに、Day7で拡張した版が見えていた。両Dayのリンクをその日のコミットハッシュに固定してから削除した。

### プラグインはキャッシュを経由する

インストールしたプラグインは`~/.claude/plugins/cache/vibe-study/dev-guard/1.0.0/`に**コピーされて、そちらが実行される**。つまり`plugins/dev-guard/`のソースを編集しても、`marketplace update`しない限り反映されない。Day8の「MCPサーバーのコードを書き換えても起動済みプロセスには反映されない」と同じ構図の、開発時の落とし穴。

## 運用の改善: 成果物リンクをタグ方式に

問題3を受けて`daily-closeout`スキルを修正した。Day4で`master`参照を選んだ理由は「commit前にはハッシュが確定しない」だったが、**タグ名ならcommit前から決まっている**。summaryに`blob/day10/...`と書き、コミット後に`git tag day10`を打てば、その時点に永続的に固定される。

ついでに、スキルに`Co-Authored-By: Claude Sonnet 5`と**モデル名を固定で書いていた**のも直した（現在の指示はOpus 5）。Day1で学んだ「すぐ陳腐化する情報を書くな」と同じ構図で、「その時点の指示に従う」と書くべきだった。

## 成果物

このDayから、リンクはタグ`day10`に固定している（以後この版を永続的に指す）。

- [`plugins/dev-guard/.claude-plugin/plugin.json`](https://github.com/kiyo015/vibe-coding-study/blob/day10/plugins/dev-guard/.claude-plugin/plugin.json)
- [`plugins/dev-guard/hooks/post-edit-test.js`](https://github.com/kiyo015/vibe-coding-study/blob/day10/plugins/dev-guard/hooks/post-edit-test.js)（汎用化）
- [`plugins/dev-guard/hooks/pre-bash-guard.js`](https://github.com/kiyo015/vibe-coding-study/blob/day10/plugins/dev-guard/hooks/pre-bash-guard.js)
- [`.claude-plugin/marketplace.json`](https://github.com/kiyo015/vibe-coding-study/blob/day10/.claude-plugin/marketplace.json)
- [`.claude/settings.json`](https://github.com/kiyo015/vibe-coding-study/blob/day10/.claude/settings.json)（プラグイン有効化のみに整理）
- [`.claude/skills/daily-closeout/SKILL.md`](https://github.com/kiyo015/vibe-coding-study/blob/day10/.claude/skills/daily-closeout/SKILL.md)（タグ方式に修正）

## 次回（Day11）予告

まず持ち越し: **プラグイン経由のhooksが実際に発火するか**（プラグインはセッション起動時に読み込まれるため今日は未検証）。その上でチーム運用設計——今日`--scope project`でgit管理される形にした設定、絶対パス問題、キャッシュ経由の反映タイミングは、そのままチームで共有する時の論点になる。
