# Day3 (2026-09-02 水) 学習成果物 — スキル(Skills)概要

`vibe-practice`のコミット: `7e8698c`（`git show 7e8698c`で内容確認可）

## 今日学んだこと

### スキルの仕組み

- **構成** — `SKILL.md`（frontmatter: `name`・`description` ＋ 手順本文）＋必要なら補助ファイル
- **トリガー方式** — `description`をモデルが読んで自律的に「関連しそうか」を判断し、該当すれば自動的に本文を読み込む。ユーザーが`/skill-name`で明示的に呼ぶこともできるが、本質はモデル起点の自動発火
- **CLAUDE.mdとの違い** — CLAUDE.mdは常にコンテキストに常駐（固定コスト）。スキルはトリガーされるまで本文は読み込まれず、常駐するのは`description`の1行だけ。「めったに使わないが複雑な手順」はスキル化すればコストゼロで待機できる
- **カスタムコマンドとの違い** — カスタムコマンドはユーザー起点の固定手順。スキルはモデル起点の自動判断
- **サブエージェントとの違い** — スキルは「やり方(How)」を同じコンテキストに追加。サブエージェントは「誰がやるか(Who)」を分離し、別コンテキスト・別ツール制限を持つ別ワーカーに投げる（詳細はDay5）

### 実例分析: descriptionの書き方比較

`ListSkills`を実際に呼んで気づいたこと——結果は`claude.ai`側のスキル一覧で、システムに元々出ていたClaude Code側（`superpowers`/`genshijin`等）とは別系統だった。スキルには複数の登録経路があると実地で確認。

`docx`のdescriptionが作り込まれている:

> Use this skill whenever the user wants to create, read, edit, or manipulate Word documents... **Do NOT use for PDFs, spreadsheets, Google Docs, or coding unrelated to document generation.**

`pptx`も同様に「形式未指定なら別を使う」という優先順位の裁定まで書いている。対して`using-superpowers`（Claude Code側）は「Use when starting any conversation」と条件1つのみ。

**原則:** descriptionの作り込み度は、隣接スキルとの誤発動リスクに比例させる。似た者同士が多い領域（`docx`/`pptx`/`xlsx`/`pdf`のようなファイル形式系）ほど、否定条件・優先順位の裁定を厚く書く必要がある。

### 深掘り: スキルの実装ファイルを実際に読む

`.claude/plugins`配下を探索し、2パターンの実装を比較。

**本物の`SKILL.md`形式**（`superpowers`の`systematic-debugging`）
- frontmatterは`name`・`description`の2行だけ。常駐するのはここだけ
- 本文296行（Overview / Iron Law / When to Use / Don't skip when / Phase 1〜4...）。トリガーされるまでこの296行はコンテキストに一切乗らない——「常駐コストゼロ」を行数で裏付け確認
- 同ディレクトリに`condition-based-waiting.md`・`root-cause-tracing.md`等の補助ファイルあり。本文からさらに必要な時だけ参照される、もう一段のオンデマンド構造
- 「**Don't skip when:** 簡単に見えても／急いでいても／上司に今すぐ言われても」——サボりたくなる状況を先回りして名指しし、言い訳の余地を潰す書き方が印象的

**実は`SKILL.md`ではなかった`code-review`**
`Skill`ツールで呼んだが、実体はプラグインの`commands/code-review.md`（スラッシュコマンド形式）。`.claude-plugin/plugin.json`は`name`/`description`/`author`だけの薄い登録情報で、ロジックは全部コマンドファイル側にある。

**発見:** `Skill`ツールというユーザー向けインターフェースは統一されているが、内部実装は「正式なSKILL.md形式」と「プラグインのスラッシュコマンドを流用したもの」が混在している。呼ぶ側からは区別がつかない。自分でスキルを作る（Day4）時は正式なSKILL.md形式に従うのが素直な選択。

### ベストプラクティス/アンチパターン

| | 良い | 悪い |
|---|---|---|
| 条件の書き方 | 「Use when X」と状況を具体的に | 一般論すぎる文言 |
| 隣接衝突対策 | 「Do NOT use for Y」で明示的に線引き | 書かない→誤発動 or 発動漏れ |
| 優先順位 | 「Xが未指定ならYを使う」と裁定まで書く | 書かない→どちらが勝つか運次第 |

## 実践内容

`code-review`スキルを`vibe-practice`全体に対して実際に実行（`Skill`ツールでトリガー、effort levelはmedium）。

- 8角度（correctness×3・reuse・simplification・efficiency・altitude・conventions）でレビュー。コード規模が小さいため8体のサブエージェント並列は使わず、自分で8角度を順に検討
- 指摘3件、いずれもPLAUSIBLE級の軽微なもの:
  1. 静的ファイルルーティングがクエリ文字列付きURLにマッチしない（`server.js`）
  2. 削除ボタンのfetch失敗時にエラーハンドリングがなく無言で一覧が再描画される（`frontend/app.js`）
  3. ルートCLAUDE.mdの「マジックナンバー禁止」ルールに対し、`3000`・`999`がリテラルのまま（conventions違反）
- 全て修正、`npm test`4件パス確認、コミット（`7e8698c`）

**気づき:** `frontend/CLAUDE.md`のルール（バンドラー不使用）は違反ゼロだったが、ルートCLAUDE.mdの「マジックナンバー禁止」は指摘が出た。厳密なルールほど実運用でグレーゾーンが生まれやすい実例。

## 成果物

- [`vibe-practice/src/server.js`](https://github.com/kiyo015/vibe-coding-study/blob/master/vibe-practice/src/server.js)（クエリ文字列対応・PORT定数化）
- [`vibe-practice/frontend/app.js`](https://github.com/kiyo015/vibe-coding-study/blob/master/vibe-practice/frontend/app.js)（削除失敗時エラーハンドリング追加）
- [`vibe-practice/test/memo.test.js`](https://github.com/kiyo015/vibe-coding-study/blob/master/vibe-practice/test/memo.test.js)（マジックナンバー修正）
- コミット: https://github.com/kiyo015/vibe-coding-study/commit/7e8698c

## 次回（Day4）予告

自作スキル作成。SKILL.mdのdescription精度がトリガー精度に直結する点を意識しながら、自分専用スキルを1つ作り切る。
