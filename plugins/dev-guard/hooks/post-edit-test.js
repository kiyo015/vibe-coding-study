#!/usr/bin/env node
// PostToolUseフック。コードファイルが編集されたら、そのファイルが属するプロジェクトの
// テストを自動実行し、失敗していたらその場でモデルにフィードバックする(テスト忘れ防止)。
//
// 対象プロジェクトの判定: 編集されたファイルから親ディレクトリを遡り、最初に見つかった
// package.jsonのディレクトリをプロジェクトとみなす。プロジェクト名は一切ハードコードしない。

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// テストを走らせる価値があるファイルだけに絞る(ドキュメント編集で毎回テストしない)
const CODE_FILE = /\.(js|mjs|cjs|jsx|ts|tsx)$/i;

// execSyncの上限。plugin.jsonに書いたhook自体のtimeout(30秒)より短くすること。
// 逆だとhookプロセスごと強制終了され、失敗の理由を何も返せなくなる。
const TEST_TIMEOUT_MS = 25000;

// 編集されたファイルから上に遡ってpackage.jsonを探す。
// 見つかったpackage.jsonにtestスクリプトが無ければnullを返す(さらに上は探さない)。
// こうしないと、ネストしたサブプロジェクトの編集で親プロジェクトのテストを誤って走らせる。
function findTestableProject(filePath, stopAt) {
  const root = path.resolve(stopAt);
  let dir = path.dirname(path.resolve(filePath));

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.scripts && pkg.scripts.test ? dir : null;
      } catch {
        return null; // 壊れたpackage.jsonは対象外
      }
    }
    // プロジェクトルートより上には行かない(ホーム直下の無関係なpackage.jsonを拾わないため)
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // ファイルシステムのルートに到達
    dir = parent;
  }
}

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = (data.tool_input && data.tool_input.file_path) || '';

    if (!CODE_FILE.test(filePath)) return;
    if (/[\\/]node_modules[\\/]/.test(filePath)) return;

    const projectDir = findTestableProject(filePath, data.cwd || process.cwd());
    if (!projectDir) return;

    const projectName = path.basename(projectDir);

    try {
      execSync('npm test', {
        cwd: projectDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: TEST_TIMEOUT_MS,
      });
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[dev-guard] ${projectName}: 編集後のnpm test 全件パス (${filePath})`,
        },
      }));
    } catch (err) {
      const reason = err.killed
        ? `テストが${TEST_TIMEOUT_MS / 1000}秒以内に終わらず打ち切った`
        : 'npm testが失敗した';
      console.log(JSON.stringify({
        decision: 'block',
        reason: `[dev-guard] ${projectName}: ${reason} (${filePath})。修正するか、意図的な一時的失敗なら理由を説明すること。\n\n${err.stdout || err.message}`,
      }));
    }
  } catch (e) {
    // silent fail — hookの不具合で本編作業を止めない
  }
});
