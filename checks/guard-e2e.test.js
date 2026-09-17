// guard-e2e.js の判定ロジックのテスト。
//
// 実行: node --test checks/guard-e2e.test.js
//
// 検証用データ(fixtures/)は、2026-09-17に本物の claude -p のストリーム出力から、判定に使う行だけを
// 残したもの。構造を想像で作った偽データだと、本物と形がずれていても気づけないため。
// powershell-blocked-by-other.jsonl だけは、初回の出力を上書きしてしまったので、その時に実際に出た
// 文言をそのまま使って同じ形で作り直している。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { classify, judgeCell } = require('./guard-e2e.js');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('フックの差し戻し文言が返っていれば「ガードで止まった」', () => {
  assert.equal(classify(fixture('powershell-blocked-by-hook.jsonl'), '[pre-bash-guard]'), 'blocked-by-guard');
});

test('ツールが実際に動いた結果が返っていれば「実行された」', () => {
  assert.equal(classify(fixture('powershell-executed.jsonl'), '[pre-bash-guard]'), 'executed');
});

test('別の仕組み(怪しいパスの検知など)に止められたら、ガードの手柄にしない', () => {
  // これを blocked-by-guard と判定すると、フックが壊れていても緑になってしまう
  assert.equal(classify(fixture('powershell-blocked-by-other.jsonl'), '[pre-bash-guard]'), 'blocked-by-other');
});

test('ツールを呼ばずに終わったら「試行されなかった」(判定不能)', () => {
  const lines = '{"type":"assistant","message":{"content":[{"type":"text","text":"その操作は実行しません"}]}}\n{"type":"result","permission_denials":[]}\n';
  assert.equal(classify(lines, '[pre-bash-guard]'), 'not-attempted');
});

test('セルが合格するのは「ガードありで止まり、ガードなしで実行される」時だけ', () => {
  assert.equal(judgeCell({ withGuard: 'blocked-by-guard', withoutGuard: 'executed' }), 'pass');
  // ガードなしでも止まる → 別の仕組みが止めているだけかもしれない。ガードの効果を証明できていない
  assert.equal(judgeCell({ withGuard: 'blocked-by-guard', withoutGuard: 'blocked-by-other' }), 'inconclusive');
  assert.equal(judgeCell({ withGuard: 'executed', withoutGuard: 'executed' }), 'fail');
  assert.equal(judgeCell({ withGuard: 'not-attempted', withoutGuard: 'executed' }), 'inconclusive');
});
