// 動作確認用の静的配信サーバー(ESモジュールをfile://で開けないため)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3100;

const MIME = { ".html": "text/html", ".js": "application/javascript" };

const server = createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];
  const relative = pathname === "/" ? "web/index.html" : pathname.slice(1);

  try {
    const body = await readFile(join(rootDir, relative));
    res.setHeader("Content-Type", MIME[extname(relative)] || "text/plain");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
});

server.listen(process.env.PORT || DEFAULT_PORT, () =>
  console.log(`listening on ${process.env.PORT || DEFAULT_PORT}`)
);
