#!/usr/bin/env node
// 定期実行する健康診断。テスト・ガードの自己診断・gitの状態を集め、
// 異常があった時だけ claude -p に渡して報告書を書かせる。
//
// 実行: node checks/health-check.js
// 設計の要点: 事実の収集は決定的な処理(ここ)で行い、AIは「異常の説明」だけに使う。
// 正常時はAIを呼ばないので、定期実行のコストは正常な日は0になる。

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 120000;

// [表示名, コマンド, 実行するディレクトリ(ROOTからの相対)]
const CHECKS = [
  ['mini-game のテスト', 'npm test', 'mini-game'],
  ['vibe-practice のテスト', 'npm test', 'vibe-practice'],
  ['ガードのテスト(pre-bash-guard)', 'node --test plugins/dev-guard/hooks/pre-bash-guard.test.js', '.'],
  ['フックのテスト(post-edit-test)', 'node --test plugins/dev-guard/hooks/post-edit-test.test.js', '.'],
  ['健康診断自体のテスト', 'node --test checks/health-check.test.js', '.'],
];
const TEST_CRITERION = '終了コードが0であること(テストが全件成功)';

function run(command, cwd) {
  try {
    const stdout = execSync(command, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: TIMEOUT_MS });
    return { ok: true, output: stdout };
  } catch (err) {
    const timedOut = err.code === 'ETIMEDOUT';
    const output = `${err.stdout || ''}${err.stderr || ''}` || err.message || '';
    return { ok: false, output, note: timedOut ? `${TIMEOUT_MS / 1000}秒で打ち切り` : undefined };
  }
}

// package.json に依存があるプロジェクトだけ更新を確認する(無ければ確認する意味がない)
function checkDependencies() {
  const results = [];
  for (const dir of ['mini-game', 'vibe-practice']) {
    const pkgPath = path.join(ROOT, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const count = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
    const criterion = '依存パッケージがすべて最新であること';
    if (count === 0) {
      results.push({ name: `${dir} の依存`, criterion, ok: true, output: '依存パッケージなし' });
      continue;
    }
    // npm outdated は更新があると終了コード1を返す。失敗ではなく「更新あり」として扱う
    const r = run('npm outdated', path.join(ROOT, dir));
    results.push({ name: `${dir} の依存`, criterion, ok: r.output.trim() === '', output: r.output.trim() || '最新' });
  }
  return results;
}

function checkGit() {
  const dirty = run('git status --porcelain', ROOT);
  const ahead = run('git rev-list --count @{u}..HEAD', ROOT);
  const lines = dirty.output.split('\n').filter(Boolean);
  const unpushed = ahead.ok ? Number(ahead.output.trim()) : null;
  // 未コミットは作業中なら常にあるので異常にしない(毎回鳴る警告は誰も見なくなる)。
  // 未pushのコミットは、このPCが壊れたら失われる分なので異常として扱う。
  return {
    name: 'git の状態',
    criterion: '未pushのコミットが0件であること(未コミットの変更は問わない)',
    ok: unpushed === 0,
    output: `未コミット ${lines.length}件 / 未push ${unpushed === null ? '不明(上流ブランチなし)' : unpushed + '件'}`,
  };
}

function main() {
  const results = CHECKS.map(([name, command, dir]) => ({
    name,
    criterion: TEST_CRITERION,
    ...run(command, path.join(ROOT, dir)),
  }));
  results.push(...checkDependencies(), checkGit());

  const failed = results.filter(r => !r.ok);
  const stamp = new Date().toISOString().slice(0, 10);

  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'NG  '}${r.name}${r.note ? `（${r.note}）` : ''}`);

  if (failed.length === 0) {
    fs.appendFileSync(path.join(__dirname, 'history.log'), `${new Date().toISOString()} 全${results.length}件 正常\n`);
    console.log('\n異常なし。claude は呼ばない（コスト0）。');
    return 0;
  }

  // 異常があった時だけAIに渡す。失敗した項目だけを渡し、判断材料を絞る
  const prompt = buildPrompt(failed);
  const detail = describeFailures(failed);
  const reportPath = path.join(__dirname, `report-${stamp}.md`);

  const r = askClaude(prompt);
  const body = r.stdout && r.stdout.trim() ? r.stdout.trim() : `（claudeの実行に失敗: ${r.stderr || r.error}）`;
  fs.writeFileSync(reportPath, `# 健康診断 ${stamp}\n\n異常 ${failed.length}件 / 全${results.length}件\n\n${body}\n\n---\n\n${detail}\n`);
  console.log(`\n異常 ${failed.length}件。報告書: ${path.relative(ROOT, reportPath)}`);
  return 1;
}

// 失敗した項目ごとに「基準」と「実際の出力」を並べる。出力だけだと、git の状態のような
// 状態の要約はエラーに見えず、AIが「失敗の出力が記載されていない」と返す(Day13で実測)
function describeFailures(failed) {
  return failed
    .map(r => `## 失敗した項目: ${r.name}\n- 基準: ${r.criterion}\n- 実際の出力:\n\`\`\`\n${r.output.slice(-2000)}\n\`\`\``)
    .join('\n\n');
}

function buildPrompt(failed) {
  return [
    '定期実行の健康診断で、次の項目が基準を満たさなかった。下に書いたものが失敗について分かっている情報のすべてで、追加の情報は無い。追加を求めずに、この情報だけで判断すること。',
    '',
    '日本語で、(1)何が壊れているか (2)考えられる原因 (3)次にすべき確認 の3点を、合計15行以内で簡潔にまとめて。推測は推測と明記すること。コードの修正はしなくてよい。',
    '',
    describeFailures(failed),
  ].join('\n');
}

// 異常時の要約をclaudeに頼む。command はテストで偽物に差し替えるための口
function askClaude(prompt, { command = 'claude' } = {}) {
  // プロンプトは引数でなく標準入力で渡す。claude は npm の claude.cmd なので shell 経由でしか起動できず、
  // shell では引数がエスケープされずに連結されるだけになる。以前は引数で渡していたため、
  // プロンプトは最初の改行で打ち切られ、後ろの --model と --tools は丸ごと消えていた(Day13で発見)。
  //
  // --tools "" で全ツールを禁止する。付けないと、無人実行のClaudeが自分でチェックを実行しようとして
  // 権限の確認で止まり、要約の代わりに「実行の承認がほしい」と返してくる(実測)。
  // シェルに渡す文字列を自分で組み立て、空文字は "" と明示する(配列で '' を渡すと連結時に消える)。
  return spawnSync(`"${command}" -p --model haiku --tools ""`, {
    cwd: ROOT, encoding: 'utf8', timeout: TIMEOUT_MS, shell: true, input: prompt,
  });
}

// 直接実行された時だけ診断する。テストから require した時は関数だけを使う
if (require.main === module) process.exit(main());

module.exports = { askClaude, buildPrompt };
