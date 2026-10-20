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

// ガード実効性テスト(guard-e2e.js)の対照実験のために、同じ呼び出し経路のまま --tools "" だけを外せるようにする。
// 別の呼び方で確かめると、Day13のように「試した経路と本番の経路が違う」ことになるため。
test('対照実験用に --tools と --strict-mcp-config を外し、追加の引数を付けられる(それでも経路は同じ)', () => {
  const r = askClaude(PROMPT, { command: makeFakeClaude(), tools: null, strictMcp: false, extraArgs: '--allowedTools Write --output-format json' });
  const received = JSON.parse(r.stdout);
  assert.deepEqual(received.args, ['-p', '--model', 'haiku', '--allowedTools', 'Write', '--output-format', 'json']);
  assert.equal(received.stdin, PROMPT);
});

test('追加の引数を付けても、ツール禁止は既定のまま届く', () => {
  const r = askClaude(PROMPT, { command: makeFakeClaude(), extraArgs: '--allowedTools Write' });
  const received = JSON.parse(r.stdout);
  assert.deepEqual(received.args, ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config', '--allowedTools', 'Write']);
});

// 背景(2026-09-17 guard-e2e で発見): --tools "" が禁止するのは組み込みツールだけで、MCPツールは残る。
// 起動時の記録(init)では、--tools "" のみだと MCPツールが10個(claude.ai の Claude Docs の create/delete を含む)
// 使える状態だった。--strict-mcp-config を足すと0個になった。
test('モデル指定・組み込みツールの禁止・MCPの遮断が、すべて消えずに届く', () => {
  const r = askClaude(PROMPT, { command: makeFakeClaude() });
  const received = JSON.parse(r.stdout);
  assert.deepEqual(received.args, ['-p', '--model', 'haiku', '--tools', '', '--strict-mcp-config']);
});

// ── C#(sales-core)の項目。出力の形は 2026-10-19 に実測した ──
const { pendingMigrations, vulnerableProjects } = require('./health-check.js');

test('未適用のマイグレーションは (Pending) の付いた行', () => {
  const output = '20261009002125_AddCommonColumns\n20261015011137_AddDocumentNumberSequences (Pending)\n20261016001848_AddInvoices (Pending)\n';
  assert.deepEqual(pendingMigrations(output), ['20261015011137_AddDocumentNumberSequences', '20261016001848_AddInvoices']);
  assert.deepEqual(pendingMigrations('20261016001848_AddInvoices\n'), []);
});

test('脆弱なパッケージのあるプロジェクトを、日本語と英語の出力から拾う', () => {
  const ja = [
    "指定されたプロジェクト 'SalesCore.Api' には、現在のソースが指定された脆弱なパッケージはありません。",
    "プロジェクト 'SalesCore.Domain.Tests' には次の脆弱なパッケージがあります",
    '   > System.Net.Http                     4.3.0   High   https://github.com/advisories/GHSA-7jgj-8wvc-jh57',
  ].join('\n');
  const en = "The given project `SalesCore.Api` has no vulnerable packages given the current sources.\nProject `SalesCore.Tests` has the following vulnerable packages\n";
  assert.deepEqual(vulnerableProjects(ja), ['SalesCore.Domain.Tests']);
  assert.deepEqual(vulnerableProjects(en), ['SalesCore.Tests']);
  assert.deepEqual(vulnerableProjects("指定されたプロジェクト 'SalesCore.Api' には、現在のソースが指定された脆弱なパッケージはありません。"), []);
});

// --- ガードの実効性テスト(週1回)の結果を、毎日の健康診断で見る ---
// 週1回の定期実行が失敗しても、誰もログを見なければ気づけない。最後の行の日時と結果で判定する
test('guard-e2e: 8日以内に全セル合格していれば OK、古い・不合格・記録なしは NG', () => {
  const { guardE2eStatus } = require('./health-check.js');
  const now = new Date('2026-10-28T00:00:00Z');
  const line = (iso, result) => `${iso} ${result} pass,pass cost=$0.5000`;
  assert.equal(guardE2eStatus(line('2026-10-20T00:30:00Z', '全セル合格'), now).ok, true);
  assert.equal(guardE2eStatus(line('2026-10-27T00:30:00Z', '不合格あり'), now).ok, false);
  assert.equal(guardE2eStatus(line('2026-10-19T23:59:00Z', '全セル合格'), now).ok, false); // 8日を過ぎた
  assert.equal(guardE2eStatus('', now).ok, false);
});
