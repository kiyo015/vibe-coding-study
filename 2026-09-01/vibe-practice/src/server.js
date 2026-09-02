import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { listMemos, addMemo, deleteMemo } from "./memo.js";

const frontendDir = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend");

const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html" },
  "/app.js": { file: "app.js", type: "application/javascript" },
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && STATIC_FILES[req.url]) {
    const { file, type } = STATIC_FILES[req.url];
    res.setHeader("Content-Type", type);
    res.end(await readFile(join(frontendDir, file)));
    return;
  }

  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/memos") {
    res.end(JSON.stringify(listMemos()));
    return;
  }

  if (req.method === "POST" && req.url === "/memos") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const { text } = JSON.parse(body || "{}");
      const memo = addMemo(text);
      res.statusCode = 201;
      res.end(JSON.stringify(memo));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  const match = req.url.match(/^\/memos\/(\d+)$/);
  if (req.method === "DELETE" && match) {
    const ok = deleteMemo(Number(match[1]));
    res.statusCode = ok ? 204 : 404;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`listening on ${PORT}`));
