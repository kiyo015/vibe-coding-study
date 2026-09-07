#!/usr/bin/env node
// PostToolUseフック。vibe-practice配下のsrc/test/frontendが編集されたら自動でnpm testを実行し、
// 失敗していたらその場でモデルにフィードバックする(テスト忘れ防止)。

const { execSync } = require('child_process');
const path = require('path');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = (data.tool_input && data.tool_input.file_path) || '';

    const isTargetFile = /vibe-practice[\\/](src|test|frontend)[\\/].*\.js$/i.test(filePath);
    if (!isTargetFile) return;

    // フック入力に含まれるcwd(プロジェクトルート)を使い、絶対パスをハードコードしない
    const projectDir = data.cwd || process.cwd();

    try {
      execSync('npm test', {
        cwd: path.join(projectDir, 'vibe-practice'),
        encoding: 'utf8',
        stdio: 'pipe',
      });
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[post-edit-test] ${filePath} 編集後のnpm test: 全件パス`,
        },
      }));
    } catch (err) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `[post-edit-test] ${filePath} 編集後のnpm testが失敗した。修正するか、意図的な一時的失敗なら理由を説明すること。\n\n${err.stdout || err.message}`,
      }));
    }
  } catch (e) {
    // silent fail — hookの不具合で本編作業を止めない
  }
});
