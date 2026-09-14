#!/usr/bin/env node
// PreToolUseフック(Bash・PowerShell)。取り返しのつかないコマンド(force push・git reset --hard・
// 再帰かつ強制の削除)を実行"前"に検知してブロックする。PostToolUseでは実行後なので手遅れになる。
//
// 判定の仕方: 行の継続をつないでから && || ; | 改行で区切り、区切った1つずつを単語に分ける。
// そのうち「コマンド名の位置」にある単語だけを見る(先頭、sudo・xargs・-exec・-c・/c の直後、
// $( や ( や ` の直後)。こうしないと git commit -m "rm -rf を検知" のような引用符の中の文字列や、
// git rm の rm まで危険なコマンドと読んでしまう(Day11 team-reviewer の指摘)。
//
// 限界: それでもブロックリスト方式なので既知の書き方しか止められない。変数展開・gitのエイリアス・
// スクリプトファイル経由の実行は素通りする。逆に、ヒアドキュメントの本文で行頭に危険なコマンドを
// 書くと誤検知する。これは「うっかり」を防ぐ安全網であって、悪意ある実行を防ぐ仕組みではない。
// 確実に禁じたいならサブエージェントのtoolsからBash・PowerShellを外すこと。

// この単語の直後はコマンド名の位置になる
const COMMAND_PREFIXES = new Set([
  'sudo', 'xargs', 'command', 'exec', 'nohup', 'time', 'env',
  '-exec', '-execdir', // find
  '-c', '-command', // bash -c / sh -c / pwsh -Command
  '/c', // cmd /c
]);

// 削除コマンドの名前。PowerShellの別名(del・erase・rd・rmdir・ri)とcmdの削除(del・rd)を含む
const DELETE_COMMANDS = new Set(['rm', 'remove-item', 'del', 'erase', 'rd', 'rmdir', 'ri']);

// ponytail: 引用符やエスケープは解釈せず、単語の前後の記号を剥がすだけ。引用符の中に区切り文字が
// あると分割がずれる。取りこぼしが実際に問題になったら、シェルの構文解析ライブラリに置き換える。
function splitCommands(command) {
  return command
    .replace(/[\\`]\r?\n/g, ' ') // 行の継続(Bashの \ とPowerShellの `)をつなぐ
    .split(/&&|\|\||[;|\n]/)
    .map(part => part.trim().split(/\s+/).filter(Boolean));
}

function strip(word) {
  return word.replace(/^[$("'`]+|["'`)]+$/g, '');
}

// -uf や -Rf のような1文字フラグのまとめ書きに、letters のどれかが含まれるか。
// 4文字までに限るのは、PowerShellの -Force を「-F -o -r -c -e」と読んで -r と誤認しないため。
// (-Rec や -Fo のようなPowerShellの省略形は、まとめ書きとして読んでも意味が合う)
function hasShortFlag(args, letters) {
  return args.some(w => /^-[A-Za-z]{1,4}$/.test(w) && [...letters].some(c => w.includes(c)));
}

// git の後ろの単語から判定する。-C <dir> や -c <設定> のようなgit自体のオプションは読み飛ばす
function gitDanger(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  const subcommand = args[i];
  const rest = args.slice(i + 1);
  // --force-with-lease も含める。+main のように + で始まる refspec も force push になる
  if (subcommand === 'push' && (rest.some(w => w.startsWith('--force') || w.startsWith('+')) || hasShortFlag(rest, 'f'))) {
    return 'force push';
  }
  if (subcommand === 'reset' && rest.includes('--hard')) return 'git reset --hard';
  return null;
}

// 削除コマンドの後ろの単語から判定する。Unix(-rf)・PowerShell(-Recurse -Force)・cmd(/s /q)の3系統
function deleteDanger(args) {
  const lower = args.map(w => w.toLowerCase());
  const recursive = lower.some(w => ['--recursive', '-recurse', '/s'].includes(w)) || hasShortFlag(args, 'rR');
  const force = lower.some(w => ['--force', '-force', '/q'].includes(w)) || hasShortFlag(args, 'fF');
  return recursive && force ? 'rm -rf' : null;
}

// 危険なら種類を、安全なら null を返す
function findDanger(command) {
  for (const raw of splitCommands(command)) {
    const words = raw.map(strip);
    for (let i = 0; i < raw.length; i++) {
      const atCommandPosition = i === 0 || COMMAND_PREFIXES.has(words[i - 1].toLowerCase()) || /^["']*[$(`]/.test(raw[i]);
      if (!atCommandPosition) continue;

      const name = words[i].toLowerCase();
      const args = words.slice(i + 1);
      const danger = name === 'git' ? gitDanger(args) : DELETE_COMMANDS.has(name) ? deleteDanger(args) : null;
      if (danger) return danger;
    }
  }
  return null;
}

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = (data.tool_input && data.tool_input.command) || '';

    const danger = findDanger(command);
    if (danger) {
      console.log(JSON.stringify({
        decision: 'block',
        reason: `[pre-bash-guard] 危険なコマンド(${danger})を検知、実行前にブロックした: "${command}"。本当に必要ならユーザーに確認を取ること。`,
      }));
    }
  } catch (e) {
    // フックの不具合で本編作業は止めない(通す)。ただし黙って無効になるとガードが効いていないことに
    // 誰も気づけないので、標準エラーには残す。
    process.stderr.write(`[pre-bash-guard] 判定中にエラー: ${e}\n`);
  }
});
