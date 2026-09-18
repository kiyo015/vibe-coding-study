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
const CODE_FILE = /\.(js|mjs|cjs|jsx|ts|tsx|cs)$/i;
const CSHARP_FILE = /\.cs$/i;

// C#はビルドを含むので時間がかかる。2026-09-18 実測(sales-core):
// ソリューション全体=編集直後30秒〜1分29秒 / 対応するテストプロジェクトだけ=12.3秒。
// 全体を走らせると上限を超えて毎回打ち切られるので、プロジェクト単位で走らせる。
const DOTNET_TEST_TIMEOUT_MS = 60000;

// 探索から外すフォルダ(ビルド生成物の中に .csproj の複製があるため)
const SKIP_DIRS = new Set(['bin', 'obj', 'node_modules', '.git', '.vs']);

// execSyncの上限。plugin.jsonに書いたhook自体のtimeout(30秒)より短くすること。
// 逆だとhookプロセスごと強制終了され、失敗の理由を何も返せなくなる。
const TEST_TIMEOUT_MS = 25000;

// 差し戻しに添えるテスト出力の上限。全部渡すとモデルのコンテキストを圧迫する。
const MAX_OUTPUT_CHARS = 4000;

// npm init が作る既定のtestスクリプト(必ず exit 1 する)。これをテスト可能とみなすと、
// テストをまだ書いていないプロジェクトでは編集のたびに差し戻してしまう。
const NO_TEST_SCRIPT = /no test specified/;

// dir が root 自身か、その内側か。文字列の完全一致で比べると、Windowsでは
// ドライブ文字や大文字小文字の表記ゆれで一致せず判定を誤る。path.relative は
// win32 では大文字小文字を区別しないので、これで比べる。
function isInside(root, dir) {
  const rel = path.relative(root, dir);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

// 編集されたファイルから上に遡ってpackage.jsonを探す。
// 見つかったpackage.jsonにtestスクリプトが無ければnullを返す(さらに上は探さない)。
// こうしないと、ネストしたサブプロジェクトの編集で親プロジェクトのテストを誤って走らせる。
function findTestableProject(filePath, stopAt) {
  const root = path.resolve(stopAt);
  let dir = path.dirname(path.resolve(filePath));

  // プロジェクトルートの外にあるファイル(一時フォルダなど)は対象外
  if (!isInside(root, dir)) return null;

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const testScript = pkg.scripts && pkg.scripts.test;
        return testScript && !NO_TEST_SCRIPT.test(testScript) ? dir : null;
      } catch {
        return null; // 壊れたpackage.jsonは対象外
      }
    }
    // プロジェクトルートより上には行かない(ホーム直下の無関係なpackage.jsonを拾わないため)
    if (path.relative(root, dir) === '') return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // ファイルシステムのルートに到達
    dir = parent;
  }
}

// dir 直下の .csproj を1つ返す(無ければ null)
function csprojIn(dir) {
  try {
    const found = fs.readdirSync(dir).find(name => name.toLowerCase().endsWith('.csproj'));
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
}

// root配下から名前で .csproj を探す(深さ制限つき)
function findCsprojByName(root, fileName, depth = 4) {
  const direct = path.join(root, fileName);
  if (fs.existsSync(direct)) return direct;
  if (depth === 0) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const hit = findCsprojByName(path.join(root, entry.name), fileName, depth - 1);
    if (hit) return hit;
  }
  return null;
}

// 編集されたC#ファイルに対応するテストプロジェクトを探す。
// 対応付けは命名規約 <プロジェクト名>.Tests による(SalesCore.Domain → SalesCore.Domain.Tests)。
// 見つからなければ null(テストの無いプロジェクトで、関係ないテストを走らせない)
function findDotnetTestProject(filePath, stopAt) {
  const root = path.resolve(stopAt);
  let dir = path.dirname(path.resolve(filePath));
  if (!isInside(root, dir)) return null;

  while (true) {
    const csproj = csprojIn(dir);
    if (csproj) {
      const name = path.basename(csproj, '.csproj');
      // テストプロジェクト自身の編集なら、それを走らせる
      if (name.toLowerCase().endsWith('.tests')) return csproj;
      return findCsprojByName(root, `${name}.Tests.csproj`);
    }
    if (path.relative(root, dir) === '') return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// 編集されたファイルに対して走らせるテストを決める。無ければ null
function findTestTarget(filePath, stopAt) {
  if (!CODE_FILE.test(filePath)) return null;
  if (/[\\/]node_modules[\\/]/.test(filePath)) return null;

  if (CSHARP_FILE.test(filePath)) {
    const testProject = findDotnetTestProject(filePath, stopAt);
    if (!testProject) return null;
    return {
      name: path.basename(testProject, '.csproj'),
      // --no-restore で復元を省く。復元が要る変更(パッケージ追加)は手元で一度走らせる前提
      command: `dotnet test "${testProject}" --no-restore`,
      cwd: path.dirname(testProject),
      timeoutMs: DOTNET_TEST_TIMEOUT_MS,
    };
  }

  const projectDir = findTestableProject(filePath, stopAt);
  if (!projectDir) return null;
  return { name: path.basename(projectDir), command: 'npm test', cwd: projectDir, timeoutMs: TEST_TIMEOUT_MS };
}

// npm test の失敗を、差し戻しの要約と添付する出力に分ける
function describeFailure(err, timeoutMs = TEST_TIMEOUT_MS) {
  // execSync のタイムアウトは err.killed ではなく code: 'ETIMEDOUT' で表される(実測で確認)。
  // killed は非同期の exec にしか無いプロパティで、以前はここを見ていたため打ち切りを判別できなかった。
  const timedOut = err.code === 'ETIMEDOUT';
  const summary = timedOut
    ? `テストが${timeoutMs / 1000}秒以内に終わらず打ち切った`
    : 'テストが失敗した';

  // npm は見出しを stdout に出すので、stdout だけを見ると stderr に出た失敗理由を落とす。両方つなげる。
  // 両方とも空(npm 自体を起動できなかった等)の時は、エラーメッセージを使う。
  const combined = `${err.stdout || ''}${err.stderr || ''}` || err.message || '';
  // テストランナーは失敗の要約を最後に出すので、切り詰める時は末尾を残す
  const output = combined.length > MAX_OUTPUT_CHARS
    ? `…(前略)\n${combined.slice(-MAX_OUTPUT_CHARS)}`
    : combined;

  return { summary, output };
}

function main() {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const filePath = (data.tool_input && data.tool_input.file_path) || '';

      const target = findTestTarget(filePath, data.cwd || process.cwd());
      if (!target) return;

      try {
        execSync(target.command, {
          cwd: target.cwd,
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: target.timeoutMs,
        });
        console.log(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `[dev-guard] ${target.name}: 編集後のテスト 全件パス (${filePath})`,
          },
        }));
      } catch (err) {
        const { summary, output } = describeFailure(err, target.timeoutMs);
        console.log(JSON.stringify({
          decision: 'block',
          reason: `[dev-guard] ${target.name}: ${summary} (${filePath})。修正するか、意図的な一時的失敗なら理由を説明すること。\n\n${output}`,
        }));
      }
    } catch (e) {
      // silent fail — hookの不具合で本編作業を止めない
    }
  });
}

// フックとして起動された時だけ標準入力を読む。テストから require した時は関数だけを使う。
if (require.main === module) main();

module.exports = { findTestableProject, findTestTarget, findDotnetTestProject, describeFailure, TEST_TIMEOUT_MS, DOTNET_TEST_TIMEOUT_MS };
