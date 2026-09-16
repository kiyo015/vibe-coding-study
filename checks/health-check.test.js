// health-check.js のテスト。異常時にclaudeへ渡す引数とプロンプトが、シェルを経由しても壊れないことを確かめる。
//
// 実行: node --test checks/health-check.test.js
//
// 背景(Day13で発見): 以前はプロンプトを引数で渡し、spawnSync に shell: true を付けていた。
// Windowsでは引数がエスケープされず空白で連結されるだけなので、プロンプトは最初の改行で打ち切られ、
// その後ろの --model と --tools "" は丸ごと消えていた。Claudeは導入文しか受け取れず
// 「内容が貼られていない」と返し、ツール禁止も一度も効いていなかった。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { askClaude, buildPrompt } = require('./health-check.js');

// 本物の claude.cmd と同じく「.cmd 経由で node を起動する」偽物を作り、受け取った内容を表示させる
function makeFakeClaude() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  const echoJs = path.join(dir, 'echo.js');
  fs.writeFileSync(echoJs, [
    'let stdin = "";',
    'process.stdin.on("data", d => stdin += d).on("end", () => {',
    '  console.log(JSON.stringify({ args: process.argv.slice(2), stdin }));',
    '});',
  ].join('\n'));
  const cmd = path.join(dir, 'claude.cmd');
  fs.writeFileSync(cmd, `@node "${echoJs}" %*\r\n`);
  return cmd;
}

const PROMPT = [
  '健康診断の結果。以下を要約して。',
  '',
  '## git の状態',
  '',
  '```',
  '未push 7件 / "引用符" & 記号 | < >',
  '```',
].join('\n');

test('プロンプトは改行・空白・記号を含めて全文そのまま届く', () => {
  const r = askClaude(PROMPT, { command: makeFakeClaude() });
  const received = JSON.parse(r.stdout);
  assert.equal(received.stdin, PROMPT);
});

// 背景(Day13で発見): 失敗の「出力」だけを渡していた時、git の状態の出力
// 「未コミット 0件 / 未push 7件」は状態の要約でエラーには見えず、haiku は
// 「失敗した項目と出力が記載されていない」と返した。基準を添えたら正しく要約した(実測)。
test('プロンプトには失敗した項目ごとに、基準と実際の出力が入る', () => {
  const prompt = buildPrompt([
    { name: 'git の状態', criterion: '未pushのコミットが0件であること', output: '未コミット 0件 / 未push 7件' },
  ]);
  assert.match(prompt, /git の状態/);
  assert.match(prompt, /未pushのコミットが0件であること/);
  assert.match(prompt, /未push 7件/);
});

test('プロンプトは、渡した情報がすべてで追加を求めないよう明示する', () => {
  const prompt = buildPrompt([{ name: 'x', criterion: 'y', output: 'z' }]);
  assert.match(prompt, /追加の情報は無い/);
});

test('モデル指定とツール禁止(--tools に空文字)が消えずに届く', () => {
  const r = askClaude(PROMPT, { command: makeFakeClaude() });
  const received = JSON.parse(r.stdout);
  assert.deepEqual(received.args, ['-p', '--model', 'haiku', '--tools', '']);
});
