# Day6 (2026-09-07 月) 学習成果物 — hooks(フック)

## 今日学んだこと

### hookの正体: stdin/stdoutによるプロセス間通信

Claude Code本体がhookコマンドを**子プロセス**として起動し、そのstdinにイベントのJSONを流し込む。スクリプトはstdoutにJSONを返す。ファイル監視でもポーリングでもAPIでもない、素朴なプロセス間通信。**だから言語は問わない**——stdinを読んでstdoutを書ければPythonでもシェルでもGoでも動く。

```
本体がイベント検知 → 子プロセス起動 → stdinにJSON書込
  → スクリプトが処理 → stdoutにJSON出力 → 本体が解釈
```

### hookイベントの全体像

| イベント | タイミング | 実例 |
|---|---|---|
| `SessionStart` | セッション起動時 | genshijinプラグインの`genshijin-activate.js` |
| `UserPromptSubmit` | ユーザー発言のたび | genshijinの`genshijin-mode-tracker.js` |
| `PreToolUse` | ツール実行**前** | 自作`pre-bash-guard.js` |
| `PostToolUse` | ツール実行**後** | 自作`post-edit-test.js` |

他に`Stop`（応答終了時）・`SubagentStop`・`PreCompact`（コンテキスト圧縮前）等。

### 実例分析: 毎ターン見ていた文言の出どころを特定

会話のたびに表示されていた「原始人モード有効 (通常)。敬語・クッション・前置き・ぼかし削除…」という文言の生成元コードを`genshijin-mode-tracker.js`内に特定した。

```js
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "原始人モード有効 (" + label + ")。..."
  }
}));
```

さらに`/genshijin-stats`の処理では`decision: 'block'`を返し、**モデルに一切推論させず**フック自身が計算した結果だけを返している。CLAUDE.md/スキルは自然言語ベースなので必ずモデル推論を経由するが、hookは真のコード実行なので決定的な計算をモデルバイパスで完結できる。

### 実測: hookが受け取るデータの中身

デバッグ用にstdinをそのままダンプして実物を確認した。

**PostToolUse(Edit)の場合:**
```json
{
  "session_id": "...", "transcript_path": "...jsonl",  ← 会話ログ全体へのパス
  "cwd": "...", "scratchpad_dir": "...", "permission_mode": "auto",
  "effort": {"level": "high"},
  "hook_event_name": "PostToolUse", "tool_name": "Edit",
  "tool_input":  { file_path, old_string, new_string, replace_all },
  "tool_response": { originalFile: "編集前の全文", structuredPatch: [...] },
  "tool_use_id": "...", "duration_ms": 177
}
```

**PreToolUse(Bash)との差分:**

| フィールド | PreToolUse | PostToolUse |
|---|---|---|
| session_id / transcript_path / cwd / permission_mode | ✔ | ✔ |
| tool_input（これから実行する内容） | ✔ | ✔ |
| **tool_response（実行結果）** | **✕ 無い** | ✔ 有り |
| **duration_ms** | **✕ 無い** | ✔ 有り |

`PreToolUse`に`tool_response`が無いのは当然——まだ実行していないから。これが「事前に止められる」ことの技術的裏付けそのもの。

→ **判断基準:** 実行させたくない＝`PreToolUse`（結果を見る術がない代わりに止められる）／結果を検証したい＝`PostToolUse`（止められない代わりに`originalFile`や`structuredPatch`まで全部見える）。

**繋がった点:** genshijinのコードが`data.transcript_path`を`genshijin-stats.js`に渡していたのは、この会話ログJSONLを解析してトークン数を集計するため。hookは会話ログ全体にアクセスできる。

### 安全性の考え方

hooksは「読むだけ」のCLAUDE.mdと違い**実際にコードが実行される**。上記の通り編集内容の全文も会話ログ全体も読めてしまうので、他人のリポジトリの`.claude/settings.json`に仕込まれたhookを無警戒に信頼するのは任意コード実行のリスクそのもの。

## 実践内容

1. **`post-edit-test.js`（PostToolUse）** — `vibe-practice/`配下のjsを編集したら自動で`npm test`を実行。成功なら`additionalContext`で報告、失敗なら`decision: 'block'`でテスト出力ごとフィードバック
   - 動作確認: 成功パターン→「全件パス」表示。意図的に`deleteMemo`を壊す→ブロッキングエラーでテスト失敗の詳細が返る→修正して復旧、まで一通り実演
   - **重要な発見:** hooksは**同一セッション内で即座に反映された**。Day5のサブエージェント（次回セッションまで反映されない）とは対照的

2. **`pre-bash-guard.js`（PreToolUse）** — Bashで`push --force`/`reset --hard`/`rm -rf`を検知したら実行前にブロック
   - 動作確認: 危険な文字列を含む無害な`echo`コマンドでテスト→実行前にブロックされ、コマンド自体が走らなかったことを確認

3. **絶対パスの排除** — 作成した4ファイルにハードコードされていた`C:\Users\sakaguchi\Study\...`を全て相対化
   - `settings.json` → `${CLAUDE_PROJECT_DIR}`（プラグインが`${CLAUDE_PLUGIN_ROOT}`を使っていたのと同じ発想）
   - `post-edit-test.js` → 今日ダンプで見つけた`data.cwd`を使い`path.join(projectDir, 'vibe-practice')`
   - `SKILL.md`・`vibe-code-locator.md` → 「プロジェクトルート直下の〜」表記に
   - 相対パス化後もフックが正常動作することを実動作で確認

4. **Day5の持ち越し課題を解決** — 新セッション開始時に`vibe-code-locator`が"New agent types"として自動出現。実際に呼び出して動作確認（8,211トークン・6.6秒・Grep1回で完結、`genshijin-investigator`の14,720トークンより軽量）

## Day1〜6の総まとめ: 4つの拡張機構の統一比較

| | CLAUDE.md | スキル | サブエージェント | hooks |
|---|---|---|---|---|
| 本質 | 常駐する設定 | オンデマンドの手順書(How) | 独立ワーカー(Who) | イベント駆動のコード実行 |
| 読み込み | 常時 | トリガー時 | 会話開始時（固定） | イベント発生時（動的） |
| 同一セッション内の変更反映 | ○ 即時(Day2実証) | ○ 即時(Day4実証) | △ 数ターン遅れて反映(Day5→Day7で修正) | ○ 即時(Day6実証) |
| 強制力 | 努力目標（お願い） | 努力目標 | tools制限で物理的に不可能にできる | コード実行なので確実に止められる |
| 何で書くか | 自然言語 | 自然言語＋手順 | 自然言語（ペルソナ） | **プログラム** |

hooksだけ「モデルを介さず確実に実行される」という他の3つにない性質を持つ——これが今日一番の学び。

## 成果物

- [`.claude/settings.json`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/settings.json)（PreToolUse/PostToolUseフック登録）
- [`.claude/hooks/post-edit-test.js`](https://github.com/kiyo015/vibe-coding-study/blob/f3a336c/.claude/hooks/post-edit-test.js)
- [`.claude/hooks/pre-bash-guard.js`](https://github.com/kiyo015/vibe-coding-study/blob/f3a336c/.claude/hooks/pre-bash-guard.js)

（Day10でhooksをプラグインへ移したため、このDay時点のコミット`f3a336c`に固定したリンクに差し替えた）
- [`.claude/skills/daily-closeout/SKILL.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/skills/daily-closeout/SKILL.md)（相対パス化）
- [`.claude/agents/vibe-code-locator.md`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/agents/vibe-code-locator.md)（相対パス化）

## 次回（Day7）予告

週次振り返り＋ミニ実践。Day1〜6の内容（CLAUDE.md・スキル・サブエージェント・hooks）を別プロジェクトにゼロから導入する統合実践。振り返り日なので新規インプットは少なめ、実装作業で時間を使う設計。
