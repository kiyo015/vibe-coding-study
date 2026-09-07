#!/usr/bin/env node
// PreToolUseフック。Bashで危険なコマンド(force push・git reset --hard等)を
// 実行"前"に検知してブロックする実演用。

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = (data.tool_input && data.tool_input.command) || '';

    const dangerous = /push\s+.*--force|reset\s+--hard|rm\s+-rf/;
    if (dangerous.test(command)) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `[pre-bash-guard] 危険なコマンドを検知、実行前にブロックした: "${command}"。本当に必要ならユーザーに確認を取ること。`,
      }));
    }
  } catch (e) {
    // silent fail
  }
});
