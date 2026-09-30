// 分納と返品の金額の決め方を比べる。金額は円、単価は銭(1/100円)の整数で持ち、誤差を出さない。
// 四捨五入は 0 から遠い側へ(Money.Round と同じ)。
const roundYen = sen => Math.sign(sen) * Math.floor((Math.abs(sen) + 50) / 100);
const lineAmount = (priceSen, qty) => roundYen(priceSen * qty);

// 方式A(今日決めた規則): 途中の出荷は単価×数量を四捨五入、残数量がゼロになる出荷は差額。返品は単価×数量を四捨五入
function methodA(priceSen, orderQty, moves) {
  const orderAmount = lineAmount(priceSen, orderQty);
  let net = 0, sum = 0;
  return moves.map(q => {
    let amount;
    if (q > 0 && net + q === orderQty) amount = orderAmount - sum; // 最後の出荷
    else amount = Math.sign(q) * lineAmount(priceSen, Math.abs(q));
    net += q; sum += amount;
    return amount;
  });
}

// 方式C(折衷): 方式Aに「残数量が0になる返品は、残っている売上の全額を戻す」を足す
function methodC(priceSen, orderQty, moves) {
  const orderAmount = lineAmount(priceSen, orderQty);
  let net = 0, sum = 0;
  return moves.map(q => {
    let amount;
    if (q > 0 && net + q === orderQty) amount = orderAmount - sum;
    else if (q < 0 && net + q === 0) amount = -sum;
    else amount = Math.sign(q) * lineAmount(priceSen, Math.abs(q));
    net += q; sum += amount;
    return amount;
  });
}

// 方式B(累計差分): 動いた後の累計数量の金額 − 動く前の累計数量の金額。出荷も返品も同じ式
function methodB(priceSen, orderQty, moves) {
  let net = 0;
  return moves.map(q => {
    const amount = lineAmount(priceSen, net + q) - lineAmount(priceSen, net);
    net += q;
    return amount;
  });
}

const price = 3333, order = 3;
const cases = [
  ['1個ずつ出荷', [1, 1, 1]],
  ['1個ずつ出荷 → 1個ずつ全部返品', [1, 1, 1, -1, -1, -1]],
  ['一括出荷 → 1個ずつ全部返品', [3, -1, -1, -1]],
  ['一括出荷 → 1個返品 → 1個再出荷', [3, -1, 1]],
  ['1個ずつ出荷 → 2個返品', [1, 1, 1, -2]],
];
for (const [name, moves] of cases) {
  const net = moves.reduce((a, b) => a + b, 0);
  const expected = lineAmount(price, net); // 手元に残った数量の正しい売上
  for (const [label, fn] of [['A', methodA], ['B', methodB]]) {
    const amounts = fn(price, order, moves);
    const total = amounts.reduce((a, b) => a + b, 0);
    const ok = total === expected ? 'OK' : `NG(${total - expected > 0 ? '+' : ''}${total - expected}円)`;
    console.log(`${label} ${name.padEnd(22)} 各回=[${amounts.join(', ')}] 合計=${total} 残数量${net}個の正しい金額=${expected} ${ok}`);
  }
}

// ランダムな出荷・返品の並びで、合計が「残数量の正しい金額」と一致するかを数える
let seed = 20260930;
const rand = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
const trials = 10000;
const ng = { A: 0, B: 0, C: 0 };
// 途中の状態(1回動くたび)でも「残数量の正しい金額」と一致しているか
const ngStep = { A: 0, B: 0, C: 0 };
for (let t = 0; t < trials; t++) {
  const priceSen = 1 + rand(99999), orderQty = 1 + rand(9);
  let net = 0; const moves = [];
  for (let i = 0; i < 1 + rand(8); i++) {
    const canShip = orderQty - net, canReturn = net;
    if (canShip > 0 && (canReturn === 0 || rand(2) === 0)) { const q = 1 + rand(canShip); moves.push(q); net += q; }
    else if (canReturn > 0) { const q = 1 + rand(canReturn); moves.push(-q); net -= q; }
  }
  const expected = lineAmount(priceSen, net);
  for (const [label, fn] of [['A', methodA], ['B', methodB], ['C', methodC]]) {
    const amounts = fn(priceSen, orderQty, moves);
    if (amounts.reduce((a, b) => a + b, 0) !== expected) ng[label]++;
    let n = 0, s = 0, stepNg = false;
    moves.forEach((q, i) => { n += q; s += amounts[i]; if (s !== lineAmount(priceSen, n)) stepNg = true; });
    if (stepNg) ngStep[label]++;
  }
}
console.log(`\nランダム ${trials}件（最終状態が不一致）: A ${ng.A}件 / B ${ng.B}件 / C ${ng.C}件`);
console.log(`ランダム ${trials}件（途中のどこかで不一致）: A ${ngStep.A}件 / B ${ngStep.B}件 / C ${ngStep.C}件`);
