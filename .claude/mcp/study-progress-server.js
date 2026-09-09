#!/usr/bin/env node
// バイブコーディング学習の進捗を返すMCPサーバー(stdio transport)。
//
// 外部SDKを使わず、JSON-RPC 2.0を素で実装している。学習目的でプロトコルの中身を
// 見えるようにするため。実務でサーバーを書くなら @modelcontextprotocol/sdk を使う方が早い。
//
// stdio transportの約束事: 1メッセージ = 1行のJSON(改行区切り)。
// stdoutはプロトコル専用なので、デバッグ出力はstderrに書くこと(stdoutを汚すと通信が壊れる)。

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const PROTOCOL_VERSION = "2024-11-05";

// このサーバーが公開するツールの定義。tools/listでそのまま返す。
// descriptionとinputSchemaがモデルに見える情報 = スキルのdescriptionと同じ役割を持つ。
const TOOLS = [
  {
    name: "study_progress",
    description:
      "バイブコーディング学習(2週間計画)の進捗を集計して返す。完了したDay数・残りDay数・各Dayのトピックと完了状態の一覧を得られる。「学習はどこまで進んだ」「次は何をやる」といった質問に使う。",
    inputSchema: {
      type: "object",
      properties: {
        only_incomplete: {
          type: "boolean",
          description: "trueにすると未完了のDayだけ返す",
        },
      },
    },
  },
];

// 学習計画シートを解析してDay一覧を組み立てる。
// 見出し行(## Day1 (日付 曜日) — トピック)と完了チェック(- [x] 完了)が対になっている前提。
function parseStudyPlan(projectDir) {
  const planPath = path.join(projectDir, "study_plan_2weeks.md");
  const lines = fs.readFileSync(planPath, "utf8").split(/\r?\n/);

  const days = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s*Day(\d+)\s*\(([^)]+)\)\s*—\s*(.+)$/);
    if (heading) {
      current = {
        day: Number(heading[1]),
        date: heading[2].trim(),
        topic: heading[3].trim(),
        done: false,
      };
      days.push(current);
      continue;
    }
    if (current && /^-\s*\[x\]\s*完了/.test(line)) {
      current.done = true;
      current = null; // 1つの見出しにつき完了チェックは1つ
    }
  }
  return days;
}

function runStudyProgress(projectDir, args) {
  const days = parseStudyPlan(projectDir);
  const done = days.filter((d) => d.done);
  const remaining = days.filter((d) => !d.done);
  const listed = args && args.only_incomplete ? remaining : days;

  const lines = [
    `進捗: ${done.length}/${days.length} 日完了 (残り${remaining.length}日)`,
    "",
    ...listed.map((d) => `${d.done ? "[x]" : "[ ]"} Day${d.day} (${d.date}) ${d.topic}`),
  ];

  if (remaining.length > 0) {
    lines.push("", `次にやるDay: Day${remaining[0].day} — ${remaining[0].topic}`);
  }
  return lines.join("\n");
}

// --- JSON-RPC の入り口 ---

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handle(request) {
  const { id, method, params } = request;

  // 1. 握手。お互いの対応バージョンと機能を交換する
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} }, // このサーバーはtoolsのみ提供(resources/promptsは無し)
        serverInfo: { name: "study-progress", version: "1.0.0" },
      },
    };
  }

  // 2. 提供するツールの一覧。ここで返した内容がモデルのツールとして見えるようになる
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  // 3. 実際の呼び出し
  if (method === "tools/call") {
    const toolName = params && params.name;
    if (toolName !== "study_progress") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `未知のツール: ${toolName}` },
      };
    }
    try {
      // このファイル(.claude/mcp/配下)から2つ上がプロジェクトルート。
      // 起動時のcwdが何になるかはクライアント任せなので、cwdに依存せず自分の位置を基準にする。
      const text = runStudyProgress(path.join(__dirname, "..", ".."), params.arguments);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (err) {
      // ツール実行時のエラーはprotocolエラーでなくisErrorで返すのが作法
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `集計に失敗した: ${err.message}` }],
          isError: true,
        },
      };
    }
  }

  // 通知(idなし)には応答しない
  if (id === undefined) return null;

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `未対応のメソッド: ${method}` } };
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  try {
    const response = handle(JSON.parse(line));
    if (response) send(response);
  } catch (err) {
    process.stderr.write(`[study-progress] 解析失敗: ${err.message}\n`);
  }
});
