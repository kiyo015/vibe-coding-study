#!/usr/bin/env node
// 会話の節目のフック(dev-guard の plugin.json の Stop・PreCompact から呼ぶ)。判断は下の関数で行い、テストする(session-hooks.test.js)。
//
//   node session-hooks.js stop
//     Stop(返事を終えたとき)。今回の返事で .cs を編集した後に dotnet test を流していなければ知らせ、
//     編集したリポジトリに未コミットの変更があれば件数を知らせる。止めはしない(systemMessage で知らせるだけ)
//   node session-hooks.js pre-compact <決定の記録を置くフォルダ>
//     PreCompact(会話を要約する前)。その日(日本時間)に本人に確認して決めたこと(AskUserQuestion の質問と回答)を、
//     <フォルダ>/<日付>.md に書き出す(フォルダはセッションを開いたリポジトリ(cwd)からの相対)。要約で決定の文脈が消える前に、ファイルに残すため
//
// 受け取る stdin は 2026-10-19 に実測した(evidence/2026-10-19-hook-input.jsonl)。
//   Stop: transcript_path・cwd・stop_hook_active・last_assistant_message など
//   PreCompact: transcript_path・cwd・trigger(manual / auto)・custom_instructions(/compact の引数。無ければ null)
// 会話の記録(transcript_path)は1ファイルで数十MBになるので、末尾だけを読む。
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TAIL_BYTES = 8 * 1024 * 1024;
const TEST_COMMAND = /\bdotnet\s+test\b/;

function readTail(file, bytes) {
  const { size } = fs.statSync(file);
  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return size > bytes ? text.slice(text.indexOf('\n') + 1) : text; // 途中から読んだ最初の行は捨てる
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(text) {
  return text.split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

const isUserPrompt = e => e.type === 'user' && typeof e.message?.content === 'string';
const toolUses = entries => entries.flatMap(e => (Array.isArray(e.message?.content) ? e.message.content : []).filter(c => c.type === 'tool_use'));

/** 最後の本人の発言より後(= 今回の返事でしたこと)。 */
function currentTurn(entries) {
  let start = -1;
  entries.forEach((e, i) => { if (isUserPrompt(e)) start = i; });
  return entries.slice(start + 1);
}

/** .cs を編集した後に dotnet test を流していなければ、最後に編集したファイルを返す。 */
function findUntestedCsEdit(turn) {
  let untested = null;
  for (const use of toolUses(turn)) {
    if (['Edit', 'Write'].includes(use.name) && /\.cs$/i.test(use.input?.file_path ?? '')) untested = use.input.file_path;
    if (['Bash', 'PowerShell'].includes(use.name) && TEST_COMMAND.test(use.input?.command ?? '')) untested = null;
  }
  return untested;
}

function editedFiles(turn) {
  return [...new Set(toolUses(turn).filter(u => ['Edit', 'Write'].includes(u.name)).map(u => u.input?.file_path).filter(Boolean))];
}

// 日本時間の日付と時刻(日本は夏時間が無いので +9時間で固定)
const jst = timestamp => new Date(new Date(timestamp).getTime() + 9 * 3600 * 1000).toISOString();

/** その日(日本時間)に AskUserQuestion で本人に確認して決めたこと。 */
function decisionsOn(entries, date) {
  return entries
    .filter(e => e.toolUseResult?.questions && e.toolUseResult?.answers && jst(e.timestamp).startsWith(date))
    .flatMap(e => e.toolUseResult.questions.map(q => ({
      time: jst(e.timestamp).slice(11, 16),
      header: q.header,
      question: q.question,
      answer: e.toolUseResult.answers[q.question] ?? '(回答なし)',
    })));
}

function renderDecisions(date, decisions) {
  return [
    `# 決定の記録 ${date}`,
    '',
    '会話を要約する前(PreCompact)に、その日に本人に確認して決めたことを自動で書き出した。時刻は日本時間。',
    '業務ルール集などに反映したかどうかは、ここでは分からない。反映先は各文書を見る。',
    '',
    ...decisions.flatMap(d => [`## ${d.time} ${d.header}`, '', `- 質問: ${d.question}`, `- 回答: ${d.answer}`, '']),
  ].join('\n');
}

// git のリポジトリごとに、未コミットの変更の件数
function uncommittedByRepo(files) {
  const counts = new Map();
  for (const file of files) {
    try {
      const root = execFileSync('git', ['-C', path.dirname(file), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: 'pipe' }).trim();
      if (counts.has(root)) continue;
      const status = execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', stdio: 'pipe' });
      counts.set(root, status.split('\n').filter(Boolean).length);
    } catch { /* リポジトリの外(一時フォルダなど)は数えない */ }
  }
  return counts;
}

function stop(input) {
  if (input.stop_hook_active) return null;
  const turn = currentTurn(parseLines(readTail(input.transcript_path, TAIL_BYTES)));
  const notes = [];
  const untested = findUntestedCsEdit(turn);
  if (untested) notes.push(`${path.basename(untested)} を編集した後に dotnet test を流していない(編集後の自動テストは、対応する1つのテストプロジェクトだけ)`);
  for (const [repo, count] of uncommittedByRepo(editedFiles(turn))) {
    if (count > 0) notes.push(`${path.basename(repo)} に未コミットの変更が ${count} 件`);
  }
  return notes.length ? { systemMessage: `[Stop] ${notes.join(' / ')}` } : null;
}

function preCompact(input, folder) {
  const date = jst(new Date().toISOString()).slice(0, 10);
  // 決定は1日の中で散らばるので、会話の記録を全部読む(要約の前に1回だけなので、数十MBでも許容)
  const decisions = decisionsOn(parseLines(fs.readFileSync(input.transcript_path, 'utf8')), date);
  if (decisions.length === 0) return null;
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, `${date}.md`);
  fs.writeFileSync(file, renderDecisions(date, decisions)); // その日の分を毎回書き直す(重ならない)
  return { systemMessage: `[PreCompact] 今日の決定 ${decisions.length} 件を ${file} に書き出した` };
}

function main() {
  const [event, folder] = process.argv.slice(2);
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (raw += chunk));
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw);
      const output = event === 'stop' ? stop(input) : event === 'pre-compact' ? preCompact(input, path.resolve(input.cwd ?? '.', folder ?? 'docs/decisions')) : null;
      if (output) process.stdout.write(JSON.stringify(output));
    } catch (err) {
      // フックの失敗でセッションを止めない。理由だけを知らせる
      process.stdout.write(JSON.stringify({ systemMessage: `[${event}] フックが失敗した: ${err.message}` }));
    }
  });
}

if (require.main === module) main();

module.exports = { currentTurn, findUntestedCsEdit, editedFiles, decisionsOn, renderDecisions };
