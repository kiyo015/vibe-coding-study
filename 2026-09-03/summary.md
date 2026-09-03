# Day4 (2026-09-03 木) 学習成果物 — 自作スキル作成

## 今日学んだこと

### スキルの仕組み（Day3の続き）

- 構成・トリガー方式・CLAUDE.md/カスタムコマンド/サブエージェントとの違いはDay3で整理済み
- `.claude/plugins`配下の実ファイルを読み、正式な`SKILL.md`形式（frontmatter2行+本文296行、常駐コストゼロを実測）とプラグインの`commands/`形式（実は`code-review`はこちら）の2パターンを比較確認

### スキル作成の詳細（`skill-creator`スキルから）

- **Anatomy of a Skill** — `SKILL.md`必須＋任意の付属リソース（`scripts/`実行コード、`references/`参考資料、`assets/`テンプレート等）
- **Progressive Disclosure（3段階ロード）** — メタデータ（常駐）→SKILL.md本文（発火時ロード、目安500行未満）→付属リソース（さらに必要時のみ）。500行超えそうなら階層を割り「次にどこを読むか」のポインタを残す
- **Writing Style** — ALWAYS/NEVERの多用は「黄色信号」。命令するだけでなく**なぜ重要かを説明する**方が、モデルの理解力を信頼した書き方として推奨される
- **description、pushyに書く** — モデルはスキルを「undertrigger（過小発火）」しがちなので、descriptionは発火を促す押しの強い書き方にする。同時にDay3の「隣接スキルとの誤発動リスクに比例した詳細度」の原則も併用し、範囲を絞る文言も入れる
- **トリガーの技術的仕組み** — Claudeは「自力で簡単にできるタスク」にはスキルを使わない傾向がある。単純な1ステップの依頼は完璧なdescriptionマッチでも発火しないことがあり、複雑・多段階・専門的なタスクほど確実に発火する
- **テストケースの考え方** — 客観的に検証可能なスキル（固定ワークフロー等）はassertion向き、主観的なスキル（文体等）は人間レビュー向き

### 進め方の判断

`skill-creator`のフルワークフロー（サブエージェント並列テスト・ベンチマーク・20件のトリガー精度最適化ループ）は、汎用スキルの厳密な品質保証には必要だが、今回のような「自分1人だけが使う超specificな運用スキル」には過剰と判断し省略。軽量版（SKILL.mdドラフト→実際に呼び出して動作確認→description手動調整）で進めた。

## 実践内容

Day1〜3で毎回手作業していた「学習セッションのクローズ作業」（vibe-practice側コミット→summary.md作成→学習計画シート更新→Study全体コミット・push）を`daily-closeout`スキルとしてスキル化。

- 配置先: `Study\.claude\skills\daily-closeout\SKILL.md`（プロジェクトスコープ。Day1-2で学んだ「CLAUDE.mdはプロジェクトスコープに置く」ロジックをスキルの配置にも応用）
- 作成の前に、学習計画シート（`study_plan_2weeks.md`）がセッション依存の一時スクラッチパッドに置きっぱなしだったことに気づき、`Study`配下の恒久パスに移動してから着手
- 実際に「今日はここまで」と発言してもらい、スキルが自動発火するか確認（Day2でサブエージェントを使った実証実験ほど厳密な盲検ではないが、実運用そのものでの検証）

### 実行中に見つかった不整合

`SKILL.md`のStep1「`vibe-practice`側で変更があればコミット」は、Day2時点（`vibe-practice`が独立git管理だった頃）の想定のまま。Day3後にStudy全体を1つのリポジトリに統合したため、`vibe-practice`はもう独立リポジトリでなく、この手順は実質Step4（Study全体コミット）に吸収されるべき内容になっていた。書いたばかりのスキルが早速、運用実態とのズレを露呈した——**スキルも育てるもの**という実感を得た良い実例。次回以降、この記述は修正対象。

## 成果物

- [`.claude/skills/daily-closeout/SKILL.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/skills/daily-closeout/SKILL.md)
- [`study_plan_2weeks.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/study_plan_2weeks.md)（恒久パスに移動）
- コミット: https://github.com/kiyo015/vibe-coding-study/commit/cdef3c3

## 次回（Day5）予告

サブエージェント設計。定義方法（frontmatter・tools制限・model指定）、「本体作業 vs サブエージェント委譲」の判断基準、並列実行・isolation（worktree）の概念。Day2の実証実験・Day4のスキル比較（「Who」を分離するサブエージェント vs 「How」を注入するスキル）を踏まえて理解を深める。
