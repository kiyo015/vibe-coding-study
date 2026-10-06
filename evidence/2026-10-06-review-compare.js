// Day24: team-reviewer を haiku / sonnet / opus で動かし、誤りを仕込んだ同じ差分をレビューさせる。
// 使い方: node evidence/2026-10-06-review-compare.js <誤りを仕込んだ作業ツリー> <出力先> [回数]
// 変えるのは --model だけ。エージェントの定義は sales-core の .claude/agents/team-reviewer.md をそのまま渡す。
// ユーザー設定(個人のプラグイン・フック)は混ぜない(--setting-sources project)。
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [worktree, outDir, runsArg] = process.argv.slice(2);
if (!worktree || !outDir) {
  console.error('使い方: node review-compare.js <作業ツリー> <出力先> [回数]');
  process.exit(2);
}
const RUNS = Number(runsArg || 3);
const MODELS = (process.env.MODELS || 'haiku,sonnet,opus').split(',');
fs.mkdirSync(outDir, { recursive: true });

// エージェント定義(frontmatter と本文)を --agents の JSON にする
const agentMd = fs.readFileSync(path.join(worktree, '.claude', 'agents', 'team-reviewer.md'), 'utf8');
const m = agentMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
const front = Object.fromEntries(m[1].split(/\r?\n/).map(l => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
const agentsFile = path.join(outDir, 'agents.json');
fs.writeFileSync(agentsFile, JSON.stringify({
  'team-reviewer': { description: front.description, tools: front.tools.split(',').map(s => s.trim()), prompt: m[2] },
}));

const diff = spawnSync('git', ['-C', worktree, 'diff', '--', 'src', 'tests'], { encoding: 'utf8' }).stdout;
const prompt = [
  '次の差分をレビューしてください。',
  '',
  '## 何を実現する変更か',
  '受注の変更機能を追加する。',
  '- 明細の数量変更(ChangeQuantity)',
  '- 明細の削除(RemoveLine)',
  '- 受注全体への値引き(ApplyDiscount、% 指定)',
  'あわせて、請求書に明細ごとの税額(LineTaxes)と請求額(TotalAmount)を追加し、開発環境の設定を更新する。',
  '作業ツリーにはこの差分が当たっている。',
  '',
  '## 差分',
  '```diff',
  diff,
  '```',
].join('\n');
fs.writeFileSync(path.join(outDir, 'prompt.md'), prompt);

const summary = [];
for (let run = 1; run <= RUNS; run++) {
  for (const model of MODELS) {
    const started = Date.now();
    const r = spawnSync('claude', [
      '-p', '--output-format', 'json',
      '--model', model,
      '--agents', agentsFile, '--agent', 'team-reviewer',
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--max-budget-usd', '2',
    ], { cwd: worktree, input: prompt, encoding: 'utf8', timeout: 15 * 60 * 1000, shell: process.platform === 'win32' });
    const wall = (Date.now() - started) / 1000;
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* 下で記録する */ }
    const name = `${model}-${run}`;
    fs.writeFileSync(path.join(outDir, `${name}.json`), r.stdout || '');
    if (json && typeof json.result === 'string') fs.writeFileSync(path.join(outDir, `${name}.md`), json.result);
    const row = {
      name, model, run,
      ok: !!json && !json.is_error,
      costUsd: json ? json.total_cost_usd : null,
      durationSec: json ? json.duration_ms / 1000 : null,
      wallSec: wall,
      turns: json ? json.num_turns : null,
      models: json && json.modelUsage ? Object.keys(json.modelUsage) : [],
      error: json ? null : (r.error ? String(r.error) : (r.stderr || '').slice(0, 300)),
    };
    summary.push(row);
    console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
