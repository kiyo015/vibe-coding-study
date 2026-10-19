// node --test .claude/hooks/session-hooks.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { currentTurn, findUntestedCsEdit, editedFiles, decisionsOn, renderDecisions } = require('./session-hooks');

const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const toolUse = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const toolResult = () => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } });

test('今回の返事の範囲は、最後の本人の発言より後(ツールの結果は本人の発言ではない)', () => {
  const entries = [user('前の依頼'), toolUse('Edit', { file_path: 'a.cs' }), user('続けて'), toolUse('Bash', { command: 'ls' }), toolResult()];
  assert.deepEqual(currentTurn(entries).map(e => e.message.content[0]?.name ?? 'result'), ['Bash', 'result']);
});

test('.cs を編集した後に dotnet test を流していなければ、その編集を返す', () => {
  const turn = [toolUse('Bash', { command: 'dotnet test' }), toolUse('Edit', { file_path: 'C:/x/Invoice.cs' })];
  assert.equal(findUntestedCsEdit(turn), 'C:/x/Invoice.cs');
});

test('編集の後に dotnet test を流していれば何も返さない(PowerShell で流しても同じ)', () => {
  assert.equal(findUntestedCsEdit([toolUse('Write', { file_path: 'a.cs' }), toolUse('Bash', { command: 'cd x && dotnet test -c Release' })]), null);
  assert.equal(findUntestedCsEdit([toolUse('Edit', { file_path: 'a.cs' }), toolUse('PowerShell', { command: 'dotnet test' })]), null);
});

test('.cs 以外の編集は、テストを流さなくても言わない', () => {
  assert.equal(findUntestedCsEdit([toolUse('Edit', { file_path: 'docs/rules.md' })]), null);
});

test('編集したファイルを重ねずに集める', () => {
  const turn = [toolUse('Edit', { file_path: 'a.cs' }), toolUse('Write', { file_path: 'b.md' }), toolUse('Edit', { file_path: 'a.cs' })];
  assert.deepEqual(editedFiles(turn), ['a.cs', 'b.md']);
});

const asked = (timestamp, question, header, answer) => ({
  type: 'user', timestamp, toolUseResult: { questions: [{ question, header }], answers: { [question]: answer } },
});

test('決定は、その日(日本時間)に本人に確認したものだけを集める', () => {
  const entries = [
    asked('2026-10-18T14:59:00Z', '前日の質問', '前日', 'A'),      // 日本時間 10/18 23:59
    asked('2026-10-18T15:00:00Z', '番号はどう振る？', '番号', '通し番号（推奨）'), // 日本時間 10/19 0:00
  ];
  assert.deepEqual(decisionsOn(entries, '2026-10-19'), [{ time: '00:00', header: '番号', question: '番号はどう振る？', answer: '通し番号（推奨）' }]);
});

test('決定の記録は、時刻・見出し・質問・回答の Markdown にする', () => {
  const text = renderDecisions('2026-10-19', [{ time: '09:30', header: '番号', question: '番号はどう振る？', answer: '通し番号' }]);
  assert.match(text, /^# 決定の記録 2026-10-19/);
  assert.match(text, /## 09:30 番号\n\n- 質問: 番号はどう振る？\n- 回答: 通し番号/);
});
