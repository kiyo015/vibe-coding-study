// post-edit-test.js のテスト。team-reviewer のレビュー(Day11)で見つかった不具合の再発防止を兼ねる。
//
// 実行: node --test plugins/dev-guard/hooks/post-edit-test.test.js
// フォルダごと `node --test plugins/dev-guard/hooks/` にしないこと。ファイル名が *-test.js に
// 一致する post-edit-test.js 本体までテストとして起動され、標準入力を待って止まるおそれがある。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findTestableProject, describeFailure, TEST_TIMEOUT_MS } = require('./post-edit-test.js');

// { 相対パス: 中身 } からファイル群を一時フォルダに作り、そのフォルダを返す
function makeTree(files) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-guard-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return base;
}

const WITH_TEST = { scripts: { test: 'node --test' } };

test('編集されたファイルに最も近いpackage.jsonのプロジェクトを返す', () => {
  const base = makeTree({ 'app/package.json': WITH_TEST, 'app/src/a.js': '' });
  assert.equal(findTestableProject(path.join(base, 'app/src/a.js'), base), path.join(base, 'app'));
});

test('入れ子: 内側のpackage.jsonにtestが無ければ、外側のテストは探しに行かない', () => {
  const base = makeTree({
    'package.json': WITH_TEST,
    'inner/package.json': { scripts: {} },
    'inner/x.js': '',
  });
  assert.equal(findTestableProject(path.join(base, 'inner/x.js'), base), null);
});

test('npm init が作る既定のtestスクリプトは、テスト可能とみなさない', () => {
  const base = makeTree({
    'package.json': { scripts: { test: 'echo "Error: no test specified" && exit 1' } },
    'x.js': '',
  });
  assert.equal(findTestableProject(path.join(base, 'x.js'), base), null);
});

test('プロジェクトルートの表記(大文字小文字)がずれていても、ルートより上には遡らない', () => {
  // outer にはテストがあるが、ルートとして渡すのはその内側の proj。proj にはpackage.jsonが無い。
  const base = makeTree({ 'outer/package.json': WITH_TEST, 'outer/proj/src/x.js': '' });
  const root = path.join(base, 'outer/proj').toLowerCase();
  assert.equal(findTestableProject(path.join(base, 'outer/proj/src/x.js'), root), null);
});

test('プロジェクトルートの表記がずれていても、ルート内の正当なファイルはテスト対象になる', () => {
  // 上のテストの裏返し。ルートの内外判定が大文字小文字を区別してしまうと、
  // 全ファイルが「ルート外」扱いになり、フックが何も言わずに一切動かなくなる。
  const base = makeTree({ 'proj/package.json': WITH_TEST, 'proj/src/x.js': '' });
  const root = path.join(base, 'proj').toLowerCase();
  assert.equal(
    path.relative(findTestableProject(path.join(base, 'proj/src/x.js'), root), path.join(base, 'proj')),
    ''
  );
});

test('プロジェクトルートの外にあるファイルは対象外', () => {
  const base = makeTree({ 'other/package.json': WITH_TEST, 'other/x.js': '', 'proj/.keep': '' });
  assert.equal(findTestableProject(path.join(base, 'other/x.js'), path.join(base, 'proj')), null);
});

test('タイムアウトは「テストが失敗した」と区別して伝える', () => {
  // execSync はタイムアウト時に killed ではなく code: 'ETIMEDOUT' を持つ(実測済み)
  const { summary } = describeFailure({ code: 'ETIMEDOUT', signal: 'SIGTERM', stdout: '', stderr: '' });
  assert.match(summary, /打ち切/);
  assert.match(summary, new RegExp(String(TEST_TIMEOUT_MS / 1000)));
});

test('stdoutに見出しがあっても、stderrに出た失敗理由を落とさない', () => {
  const { summary, output } = describeFailure({ status: 1, stdout: '> app@1.0.0 test\n', stderr: 'REAL FAILURE' });
  assert.match(summary, /失敗/);
  assert.match(output, /REAL FAILURE/);
});

test('出力が長すぎる時は、末尾(失敗の要約が出る側)を残して切り詰める', () => {
  const { output } = describeFailure({ status: 1, stdout: 'x'.repeat(50000) + 'TAIL', stderr: '' });
  assert.ok(output.length < 10000, `出力が長すぎる: ${output.length}文字`);
  assert.match(output, /TAIL$/);
});
