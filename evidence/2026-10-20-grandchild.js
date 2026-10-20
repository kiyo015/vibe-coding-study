// タイムアウトで打ち切った後、孫プロセスが動き続けるかの実測(2026-10-20、Day33)。
// post-edit-test.js と同じく execSync(shell 経由)に timeout を付けて、
// cmd.exe(子) → node(孫) を起動する。孫は4秒後に目印のファイルを書く。上限は1秒。
//
// 実行: node evidence/2026-10-20-grandchild.js
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const marker = path.join(os.tmpdir(), `grandchild-probe-${process.pid}.txt`);
const grandchild = `node -e "setTimeout(()=>require('fs').writeFileSync(process.argv[1], String(process.pid)), 4000)" "${marker}"`;

const started = Date.now();
let code;
try {
  execSync(grandchild, { timeout: 1000, stdio: 'pipe' });
} catch (err) {
  code = err.code;
}
const returnedAfter = Date.now() - started;
console.log(`execSync が返るまで: ${returnedAfter}ms (code=${code})`);

setTimeout(() => {
  const alive = fs.existsSync(marker);
  console.log(`6秒後に目印のファイル: ${alive ? `ある → 孫(pid ${fs.readFileSync(marker, 'utf8')})は打ち切り後も動き続けた` : '無い → 孫も止まった'}`);
  if (alive) fs.unlinkSync(marker);
}, 6000);
