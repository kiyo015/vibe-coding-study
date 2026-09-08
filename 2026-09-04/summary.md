# Day5 (2026-09-04 金) 学習成果物 — サブエージェント設計

## 今日学んだこと

### サブエージェント定義の仕組み

- frontmatterに`name`・`description`・`tools`（許可ツールのリスト）・`model`（使用モデル）を書く
- 本文はスキル（手順書中心）と違い、**ペルソナ設定＋専門領域の評価基準**が中心——スキル（How）とサブエージェント（Who）の構造的な違いがそのまま表れている

### 実例分析: ツール制限の設計思想比較

| エージェント | tools | 設計意図 |
|---|---|---|
| `code-reviewer`（feature-dev） | Glob, Grep, LS, Read, WebFetch, WebSearch, TodoWrite等（Edit/Write無し） | レビューだけさせて直接変更させない |
| `genshijin-builder` | Read, Edit, Write, Grep, Glob（Bash無し） | 編集は許すが、シェル実行・push・削除は物理的に不可能にする |
| `Explore`（組み込み） | 全ツール except Edit/Write/Agent等 | 探索専用、変更は一切させない |

**原則:** CLAUDE.mdの「禁止事項」は"言われたことを守る"努力目標。サブエージェントのtools制限は**そもそも呼び出せないので破りようがない**——技術的強制力がある。CLAUDE.mdが「お願い」なら、tools制限は「物理的に不可能にする」。

### 判断基準: 本体作業 vs サブエージェント委譲

- 同じコンテキストで完結する作業 → 本体でやる
- 大量の探索・試行錯誤の過程を本体の会話に残したくない → サブエージェント
- 誤操作リスクを構造的に消したい → サブエージェント＋tools制限
- 並列化したい独立タスクが複数ある → サブエージェントを複数同時起動

### model指定、なぜ変えるか

`code-reviewer`は`model: sonnet`を明示、`genshijin-builder`にはmodelフィールドなし——指定しなければ呼び出し元と同じモデルを継承するのが基本挙動。単純作業は軽量モデルで十分、複雑な判断（confidence scoring等）は高性能モデルが要る、というコスト/品質トレードオフで使い分ける。

### isolation: worktree、もう一つの隔離軸

`tools`制限が「何ができるか」を絞る隔離なら、`isolation: worktree`は「**どこで**作業するか」を隔離する仕組み。一時的な`git worktree`（別チェックアウト・別ブランチ）で作業させ、本体には一切影響しない。変更がなければ自動クリーンアップ、変更があればパスとブランチ名が返る。

**tools制限が「何をしていいか」の境界、worktreeは「どこまで影響していいか」の境界**——サブエージェントの隔離には両方の軸がある。

## 実践内容

1. **読み取り専用サブエージェントの自作** — `vibe-code-locator`（`tools: Read, Grep, Glob`のみ）を`Study\.claude\agents\`に作成
   - **想定外の壁:** 作成直後に呼び出そうとしたが「Agent type not found」——サブエージェント一覧は会話開始時に固定ロードされていて、新規追加ファイルは同一セッション内には反映されない。CLAUDE.md（Day2で同一セッション内でも即反映を実証）やスキル（Day4で同様）とは対照的
   - **【Day6冒頭で解決】** 翌日の新しいセッション開始時、`vibe-code-locator`が"New agent types"として自動出現。実際に呼び出すと8,211トークン・6.6秒・Grep1回のみで完結（`genshijin-investigator`の14,720トークンより軽量）
   - **【Day7で結論を修正】** 上記から「次回セッション開始時に反映される」と結論づけたが、これは**言い過ぎだった**。Day7で作成した`game-playtester`は、作成直後は認識されなかったものの、**同一セッション内で数ターン後に自動出現**した。正しくは「即時ではないが、次回セッションを待つ必要もない。定期的に再スキャンされる」。CLAUDE.md/スキル（即時）とは違い1テンポ遅れる、という点だけが確か

2. **既存の同系統エージェントで代替比較** — `genshijin:genshijin-investigator`（読み取り専用の圧縮出力）と`Explore`（自然文＋コードスニペット、CLAUDE.md文脈まで踏まえる）に同じ質問（削除処理の全箇所調査）を投げて比較。トークン効率と説明の厚さはトレードオフと確認

3. **並列実行の実演** — frontend調査とbackend調査を同一ターンでバックグラウンド並列起動。ほぼ同時（13〜15秒）に完了、体感の待ち時間は「一番遅い方」で済んだ
   - **副産物の発見:** backend調査で`server.js`（HTTPルーティング層）が無テストと判明。Day3のcode-reviewでも拾われなかった穴——俯瞰して構成を聞く並列調査の方が、この種の抜けを見つけやすい実例

4. **isolation: worktreeの実証実験** — 「メモに完了フラグを追加」という実験的機能を`isolation: worktree`で試作させ、本体（`vibe-practice/src/memo.js`）に`toggleDone`/`done`が一切混入していないことを`grep`で確認。完全に隔離されていることを実証
   - 実装は半端（API層・UI連携が未実装）だったため、本体への取り込みは見送り破棄。worktreeとブランチをクリーンアップ
   - 気づき: worktreeは変更ありだと自動クリーンアップされず`.claude/worktrees/`にリポジトリのコピーが残る。`.gitignore`に追加しないと次のコミットで実験ブランチごと丸呑みしてしまうところだった

## 成果物

- [`.claude/agents/vibe-code-locator.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/agents/vibe-code-locator.md)（自作サブエージェント、次回セッションで動作確認予定）
- [`.gitignore`](https://github.com/kiyo015/vibe-coding-study/blob/master/.gitignore)（`.claude/worktrees/`を除外に追加）

## 次回（Day6）予告

hooks(フック)。イベント種類（起動時・コマンド実行前後・ファイル編集後等）、settings.jsonでの設定方法、自動実行コマンドの安全性の考え方。
