// Day28: 手元と CI の結果(trx)を、テスト1件ごとの「名前 → 成否」で突き合わせる。
// 使い方: node compare-trx.js <手元の trx のフォルダ> <CI の trx のフォルダ>
// 差が無ければ終了コード 0、あれば 1。
const fs = require('fs');
const path = require('path');

function load(dir) {
  const results = new Map();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.trx'))) {
    const xml = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of xml.matchAll(/<UnitTestResult [^>]*?testName="([^"]*)"[^>]*?outcome="([^"]*)"/g)) {
      const name = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      if (results.has(name)) throw new Error(`同じ名前のテストが2つある: ${name}`);
      results.set(name, m[2]);
    }
  }
  return results;
}

const [local, ci] = process.argv.slice(2).map(load);
const names = [...new Set([...local.keys(), ...ci.keys()])].sort();
const diffs = names.filter(n => local.get(n) !== ci.get(n));
const count = (r, o) => [...r.values()].filter(v => v === o).length;

console.log(`手元: ${local.size}件(成功 ${count(local, 'Passed')})  CI: ${ci.size}件(成功 ${count(ci, 'Passed')})`);
for (const prefix of ['SalesCore.Architecture', 'SalesCore.Domain', 'SalesCore.Integration']) {
  const n = r => [...r.keys()].filter(k => k.startsWith(prefix)).length;
  console.log(`  ${prefix}: 手元 ${n(local)}  CI ${n(ci)}`);
}
console.log(`違い: ${diffs.length}件`);
for (const n of diffs) console.log(`  ${n}: 手元=${local.get(n) ?? '無し'} CI=${ci.get(n) ?? '無し'}`);
process.exit(diffs.length === 0 ? 0 : 1);
