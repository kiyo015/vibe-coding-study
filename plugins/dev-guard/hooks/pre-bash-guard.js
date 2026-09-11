#!/usr/bin/env node
// PreToolUseフック。Bashで取り返しのつかないコマンド(force push・git reset --hard・rm -rf)を
// 実行"前"に検知してブロックする。PostToolUseでは実行後なので手遅れになる。
//
// 限界: ブロックリスト方式なので既知の書き方しか止められない。`rm -fr`や`rm -r -f`、
// 変数展開やシェル関数を経由した実行は素通りする。これは「うっかり」を防ぐ安全網であって、
// 悪意ある実行を防ぐ仕組みではない。確実に禁じたいならサブエージェントのtoolsからBashを外すこと。

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
