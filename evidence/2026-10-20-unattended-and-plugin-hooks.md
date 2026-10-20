# 週1回の guard-e2e の無人実行と、プラグインから呼ぶ Stop・PreCompact の発火（2026-10-20）

## 1. タスクスケジューラからの guard-e2e

- タスク: `vibe-study-guard-e2e`
  - 実行するもの: `checks/guard-e2e.cmd`
  - 毎週月曜 9:00、ログオン中だけ動く（`Interactive`）
- 確かめ方: 本人が `/login` した後、`Start-ScheduledTask` で今すぐ起動した。cmd → node → claude -p の経路は、本番の定期実行と同じ。
- 実行時刻: 10:02:55 に開始し、10:10:37 に終了した（約7分40秒）。exit=0。

`checks/schtasks-guard-e2e.log` の出力:

```
pass         PowerShellツール × dev-guardフック（ガードあり: blocked-by-guard / ガードなし: executed）
pass         Bashツール × dev-guardフック(DBを壊すコマンド)（ガードあり: blocked-by-guard / ガードなし: executed）
pass         Bashツール × dev-guardフック(DBを壊すコマンド・sales-core・GitHub配布)（ガードあり: blocked-by-guard / ガードなし: executed）
pass         Readツール × permissionsのdeny(秘密情報ファイル・sales-core)（ガードあり: blocked-by-guard / ガードなし: executed）
pass         PowerShellツール × permissionsのdeny(PowerShell(...)の書式)（ガードあり: blocked-by-guard / ガードなし: executed）
pass         サブエージェント(team-reviewer) × tools制限（ガードあり: blocked-by-guard / ガードなし: executed）
pass         ヘッドレス(健康診断のaskClaude) × --tools "" ＋ --strict-mcp-config（ガードあり: blocked-by-guard / ガードなし: executed）

費用: $0.0631
[2026/10/20 10:10:37.93] exit=0
```

`checks/guard-e2e.log` の最後の行（毎日の健康診断がこの行を読む）:

```
2026-10-20T01:10:37.816Z 全セル合格 pass,pass,pass,pass,pass,pass,pass cost=$0.0631
```

- 前回（2026-09-29、6セル）は $0.5336 だった。今回は1セル多いのに約8分の1の費用で済んだ。理由は確かめていない。

## 2. プラグイン（dev-guard 1.3.1）から呼ぶ Stop・PreCompact

前日（Day32）の実測は `Study/.claude/settings.json` から呼んだものだった。今回はプラグインに移した後の版で確かめた。新しいセッションを `claude -p` で起動し、プラグインを読み込み直させた。

### 新しいセッションの起動時の記録（`system:init` の `plugins`）

```
{"name":"dev-guard","path":"C:\\Users\\sakaguchi\\Study\\plugins\\dev-guard","source":"dev-guard@vibe-study","version":"1.3.1"}
```

Study では、作業中のソース（`plugins/dev-guard`）がそのまま読み込まれる。キャッシュは使われない。

### Stop

`stop-probe-7f3a.txt`（未追跡のファイル）を Write させて、返事を終わらせた。会話の記録（`4628440e-….jsonl`）には次の2行が残った。

```
2026-10-20T01:11:13.506Z hook_success Stop node "${CLAUDE_PLUGIN_ROOT}/hooks/session-hooks.js" stop {"systemMessage":"[Stop] Study に未コミットの変更が 1 件"}
2026-10-20T01:11:13.508Z hook_system_message Stop  [Stop] Study に未コミットの変更が 1 件
```

作らせたファイルは、確かめた後に消した。

### PreCompact

同じセッションを `--resume` で再開し、`/compact` を実行した。出力:

```
Compacted PreCompact [node "${CLAUDE_PLUGIN_ROOT}/hooks/session-hooks.js" pre-compact docs/decisions] completed successfully
```

- 記録の `compact_boundary` は `trigger: "manual"` で、要約の前後のトークン数は 12227 → 2828 だった。
- このセッションには本人に確認した決定が無いので、何も書き出さない。`Study/docs/decisions/` も作られなかった（意図どおり）。
- 出力の無いフックは、会話の記録に `hook_success` を残さない。発火の証拠は、`/compact` の出力に出る上の1行だけ。
