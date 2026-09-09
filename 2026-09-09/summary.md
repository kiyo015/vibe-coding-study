# Day8 (2026-09-09 水) 学習成果物 — MCP概要

## 今日学んだこと

### MCPとは

**Model Context Protocol** — AIモデルに外部の能力を接続するための共通規格。

規格が必要な理由: 各AIツールが独自方式で外部サービスと繋ぐと、ツールN個 × サービスM個で **N×M** 通りの実装が要る。共通規格があれば **N+M** で済む。USBと同じ発想。

### 提供できるもの3種類

| 種類 | 内容 |
|---|---|
| **Tools** | モデルが呼べる関数。副作用のある操作も可 |
| **Resources** | モデルが読めるデータ。URI形式で公開 |
| **Prompts** | 定型プロンプトのテンプレート |

現在このセッションで使えている`mcp__Claude_Browser__*`等は全部Tools。

### 通信の仕組み

JSON-RPC 2.0。Transportは2種類——**stdio**（子プロセス＋標準入出力、ローカル用）と**HTTP/SSE**（ネットワーク越し）。

接続の流れ:
1. `initialize` — 握手、互いの対応バージョンと能力を交換
2. `tools/list` — サーバーがツール一覧を返す。**これがモデルに見えるツール定義になる**
3. `tools/call` — モデルがツールを呼ぶ

### 実例分析: 設定ファイルの実物を追跡

`~/.claude/settings.json`にMCP設定がなかったので、`~/.claude.json`（57KB）を調べた。判明したこと——**MCPサーバーの供給経路が3つある**。

1. **ローカル設定** — `.claude.json`の`projects[パス].mcpServers`。ホームディレクトリに1件だけ実例があった:
   ```json
   "gemini-media": { "type": "stdio", "command": "uv", "args": ["run", "gemini_media_server.py"], "env": {} }
   ```
   `command`＋`args`で子プロセス起動——**Day6のhooksと構造が同じ**
2. **claude.ai側のコネクタ** — `claudeAiMcpEverConnected: ['claude.ai Google Drive']` の記録あり（現在は未接続、`list_connectors`は0件）
3. **アプリ組み込み** — `Claude_Browser`・`visualize`・`ccd_session`等。設定ファイルに一切書かれていないのに使える

Studyプロジェクトの`mcpServers`は空なのに多数のMCPツールが使えていた謎はこれで解けた。Day3で「スキルには複数の登録経路がある」と発見したのと同じ構図。

### エラーレスポンスの設計

存在しないタブIDを渡して異常系を実測。単に失敗を返すのでなく、**次に何をすべきかの案内が含まれていた**（「`preview_start`か`navigate`を使え」）。Day3のスキルdescription設計（「いつ使うか」を明示）と同じ思想。

### 5機構の関係整理

| | 何を提供するか | 誰が実行するか | いつ動くか |
|---|---|---|---|
| CLAUDE.md | 知識（テキスト） | — | 常時読まれる |
| スキル | 手順（テキスト） | モデル自身 | トリガー時 |
| サブエージェント | 別ワーカー | 別のモデル | 委譲した時 |
| hooks | コード実行 | Claude Code本体 | **イベント時（モデルの意思と無関係）** |
| **MCP** | **能力（ツール）** | **外部プロセス** | **モデルが呼びたい時** |

**hooksとMCPは実装が似ているのに役割が正反対** — どちらも外部プロセスをstdioで動かすが、hooksは強制（モデルの意思と無関係に発火）、MCPは選択肢の提供（モデルの裁量）。

### セキュリティ

2つのリスク:
1. **任意コード実行** — 外部プロセスを起動する点でhooksと同じ
2. **プロンプトインジェクションの入り口** — これはhooksにない固有のリスク。MCPは外部データ（Web・DB・チケット）を持ち込む経路でもあり、そのデータに指示めいた文言が混ざっていても**データであって指示ではない**

## 実践内容: MCPサーバーを自作

Day4スキル・Day5サブエージェント・Day6hookと同じ流れで、MCPサーバーを自作した。**外部SDKを使わず素のNode.jsでJSON-RPCを実装**——プロトコルの中身が見える形にするため。

**作ったもの:** `study_plan_2weeks.md`を解析して学習進捗を集計して返すサーバー（ツール1つ: `study_progress`）。ファイルを読むだけならReadツールで足りるが、**解析・集計する部分**をツール化する意義がある。

**手でプロトコルを叩いて検証** — これが素で書いた最大の利点。3段階を順に送り込んで確認した:

```
{"jsonrpc":"2.0","id":1,"method":"initialize",...}
  → {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},...}}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
  → {"result":{"tools":[{"name":"study_progress","description":"...","inputSchema":{...}}]}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"study_progress",...}}
  → {"result":{"content":[{"type":"text","text":"進捗: 7/14 日完了..."}]}}
```

**設定は`.mcp.json`（プロジェクトルート）に書いた** — git管理下に置けるのでチームで共有できる形式。`.claude.json`に`enabledMcpjsonServers`というキーがあったことから、この仕組みの存在が裏付けられていた（Day11のチーム運用に直結する）。

**実装上の判断:** 最初は`process.cwd()`をプロジェクトルートとみなしていたが、**クライアントがどのcwdでサーバーを起動するか保証がない**。Day6で絶対パスを排除した時と同じ考え方で、`__dirname`（ファイル自身の位置）を基準にする形へ変更。ホームディレクトリから起動しても正常動作することを検証済み。

**持ち越し:** 設定を書いたが、このセッションではまだ接続されていない（`ToolSearch`で`study-progress`が出てこない）。MCPサーバーはセッション起動時に接続されるため——Day5のサブエージェントと同じパターン。Day9冒頭で接続を確認する。

## 成果物

- [`.claude/mcp/study-progress-server.js`](https://github.com/kiyo015/vibe-coding-study/blob/master/.claude/mcp/study-progress-server.js) — 自作MCPサーバー（素のJSON-RPC実装）
- [`.mcp.json`](https://github.com/kiyo015/vibe-coding-study/blob/master/.mcp.json) — プロジェクトスコープのMCP設定

## 次回（Day9）予告

MCP活用実践。まず自作サーバーの接続確認から。用途別MCPサーバーの種類、権限設定・信頼境界の考え方（外部データは指示でなくデータとして扱う原則）、自分の開発フローへの組み込み。
