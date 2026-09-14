// pre-bash-guard.js のテスト。Day11の実測で「止まらない」と分かった書き方と、
// team-reviewer のレビューで見つかった誤検知・抜けの再発防止を兼ねる。
//
// 実行: node --test plugins/dev-guard/hooks/pre-bash-guard.test.js
// フックを実際に別プロセスで起動し、標準入力にClaude Codeと同じ形のJSONを渡して判定を見る。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const path = require('path');

const HOOK = path.join(__dirname, 'pre-bash-guard.js');

function isBlocked(command) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });
  // フックが例外で落ちると標準出力が空になり「通過」に見える。落ちていないことも確かめる。
  assert.equal(r.status, 0, `フックが異常終了した: ${r.stderr}`);
  assert.equal(r.stderr, '', `フックが標準エラーに出力した: ${r.stderr}`);
  return r.stdout.trim() !== '' && JSON.parse(r.stdout).decision === 'block';
}

const MUST_BLOCK = [
  // 以前から止まっていた書き方(回帰防止)
  'git reset --hard HEAD',
  'git -C . reset --hard HEAD',
  'git push --force origin main',
  'git push origin main --force',
  'rm -rf node_modules',
  'sudo rm -rf build',
  'find . -name dist -exec rm -rf {} +',
  // Day11の実測で素通りしていた書き方
  'git push -f origin main',
  'git push origin main -f',
  'git push -uf origin main',
  'git push origin +main',
  'git push --force-with-lease origin main',
  'git reset HEAD~1 --hard',
  'rm -fr node_modules',
  'rm -r -f node_modules',
  'rm -Rf node_modules',
  'rm --recursive --force node_modules',
  // 連結されたコマンドの後ろ側にあっても止める
  'npm test && git push origin main -f',
  // 引用符で包んで別のシェルに渡しても止める
  'bash -c "git push -f origin main"',
  // PowerShellツールの書き方(フックのmatcherにPowerShellを足して、同じ判定を通す)
  'Remove-Item -Recurse -Force node_modules',
  'rm -Recurse -Force node_modules',
  // レビュー指摘2: 行の継続
  'git push \\\n  --force origin main',
  'rm -r \\\n  -f node_modules',
  'Remove-Item node_modules `\n  -Recurse -Force',
  // レビュー指摘3: PowerShellの別名とcmdの削除
  'del -Recurse -Force dist',
  'rmdir -Recurse -Force node_modules',
  'ri -r -fo node_modules',
  'cmd /c rd /s /q node_modules',
  // レビュー指摘4: 括弧・コマンド置換
  '(rm -rf build)',
  'echo $(git reset --hard)',
  // レビュー指摘5: PowerShellの省略形(大文字)
  'Remove-Item -Rec -Fo node_modules',
];

const MUST_ALLOW = [
  'git push origin main',
  'git push --follow-tags origin main',
  'git push -u origin main',
  'git reset --soft HEAD~1',
  'git status',
  // 再帰でも強制でなければ通す。Bashツールは端末ではないのでrmは確認を出さずに消すが、
  // 作業ディレクトリの掃除で日常的に使うため、止めると作業を妨げる
  'rm -r tmp',
  'rm -f file.txt', // 再帰でなければ消えるのは指定したファイルだけ
  'grep -rf patterns.txt src',
  // 別々のコマンドのフラグを混ぜて誤検知しない
  'git push origin main && ls -f',
  'rm -r tmp; ls -f',
  'Remove-Item file.txt',
  'Remove-Item -Force file.txt',
  // レビュー指摘1: 引用符の中の文字列はコマンドではない
  'git commit -m "dev-guard: git push -f を止める"',
  'grep -rn "rm -rf" plugins',
  'git commit -m "reset --hard の検知を追加"',
  "git commit -m \"$(cat <<'EOF'\nguard\n\n- rm -fr / git push -f を検知\nEOF\n)\"",
  // レビュー指摘6: git rm はインデックスから外すだけ(--cached)の用途がある
  'git rm -r -f --cached node_modules',
];

for (const command of MUST_BLOCK) {
  test(`止める: ${JSON.stringify(command)}`, () => {
    assert.equal(isBlocked(command), true);
  });
}

for (const command of MUST_ALLOW) {
  test(`通す: ${JSON.stringify(command)}`, () => {
    assert.equal(isBlocked(command), false);
  });
}
