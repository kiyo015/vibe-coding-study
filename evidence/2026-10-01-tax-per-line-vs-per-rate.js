// 消費税を「明細ごとに丸めて合計」した場合と「税率ごとに1回だけ丸める」場合で、
// 請求書の税額がどれだけ食い違うかを数える。金額は円の整数、税率は1万分率で持ち、誤差を出さない。
// 四捨五入は 0 から遠い側へ(Money.Round と同じ)。
const roundHalfAway = (numerator, denominator) =>
  Math.sign(numerator) * Math.floor((Math.abs(numerator) * 2 + denominator) / (denominator * 2));

// 乱数は mulberry32(種を固定)。最初は線形合同法の剰余を使ったが、下位ビットの周期が短く、
// 差の分布に不自然な山(+5円だけ30件など)が出たので替えた。
let state = 20261001;
function random01() {
  state = (state + 0x6D2B79F5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = n => Math.floor(random01() * n);

const RATES = [1000, 800, 0]; // 10%・8%・0%
const invoices = 10000;

function run(label, minYen, maxYen) {
  let differ = 0, maxDiff = 0, sumAbsDiff = 0;
  const histogram = {};
  for (let i = 0; i < invoices; i++) {
    const lineCount = 1 + rand(30);
    const taxableByRate = {};
    let perLine = 0;
    for (let j = 0; j < lineCount; j++) {
      const bp = RATES[rand(RATES.length)];
      const yen = minYen + rand(maxYen - minYen + 1);
      taxableByRate[bp] = (taxableByRate[bp] || 0) + yen;
      perLine += roundHalfAway(yen * bp, 10000);
    }
    const perRate = Object.entries(taxableByRate).reduce((t, [bp, yen]) => t + roundHalfAway(yen * bp, 10000), 0);
    const diff = perLine - perRate;
    if (diff !== 0) differ++;
    maxDiff = Math.max(maxDiff, Math.abs(diff));
    sumAbsDiff += Math.abs(diff);
    histogram[diff] = (histogram[diff] || 0) + 1;
  }
  const keys = Object.keys(histogram).map(Number).sort((a, b) => a - b);
  console.log(`${label}`);
  console.log(`  食い違う請求書: ${differ} / ${invoices} 件 (${(differ / invoices * 100).toFixed(1)}%)`);
  console.log(`  差の最大: ${maxDiff}円 / 差の平均(絶対値): ${(sumAbsDiff / invoices).toFixed(2)}円`);
  console.log(`  差の分布(明細ごと − 税率ごと): ${keys.map(k => `${k > 0 ? '+' : ''}${k}円=${histogram[k]}件`).join(', ')}`);
}

run('明細 1〜30行、1行 -50,000〜500,000円(赤伝を含む)', -50000, 500000);
run('明細 1〜30行、1行 1〜3,000円(小口の商品)', 1, 3000);
