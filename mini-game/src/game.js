// 難易度の定義。ここを変える時はdocs/game-rules.mdとテストも合わせて見直すこと(手順はgame-balanceスキル)
// 上限回数は実測した勝率で決めている(測定方法と結果はdocs/game-rules.md)。
// hardのnearRatioは「答えとの差が範囲の広さ×この割合を超える間は方向を教えない」しきい値。
// 手数を削って難しくすると、1〜1000を9回では約半分の出題が論理的に当てられなくなるため、
// 手数は残したままヒントの粒度で難しさを作っている。
export const LEVELS = {
  easy: { label: "やさしい", min: 1, max: 100, maxTries: 7 },
  normal: { label: "ふつう", min: 1, max: 500, maxTries: 9 },
  hard: { label: "むずかしい", min: 1, max: 1000, maxTries: 10, nearRatio: 0.1 },
};

// 難易度を指定してゲームを作る。乱数生成は外から差し替えられる(テストで固定値を使うため)
export function createGame(level = "normal", randomFn = Math.random) {
  const def = LEVELS[level];
  if (!def) {
    throw new Error(`unknown level: ${level}`);
  }
  const answer = def.min + Math.floor(randomFn() * (def.max - def.min + 1));
  return {
    level,
    min: def.min,
    max: def.max,
    maxTries: def.maxTries,
    nearRatio: def.nearRatio, // 粗いヒントを使わない難易度では undefined
    answer,
    tries: 0,
    finished: false,
  };
}

export function guess(game, value) {
  if (game.finished) {
    throw new Error("game is already finished");
  }
  if (!Number.isInteger(value) || value < game.min || value > game.max) {
    throw new Error(`guess must be an integer between ${game.min} and ${game.max}`);
  }

  game.tries++;

  if (value === game.answer) {
    game.finished = true;
    return { result: "correct", tries: game.tries };
  }
  if (game.tries >= game.maxTries) {
    game.finished = true;
    return { result: "lose", tries: game.tries, answer: game.answer };
  }
  // 粗いヒントを使う難易度では、答えから遠い間は方向を教えない。
  // 完全に方向を隠すと絞り込めず勝率が潰れるので、近づいたらlow/highに戻す。
  if (game.nearRatio !== undefined) {
    const threshold = Math.floor((game.max - game.min + 1) * game.nearRatio);
    if (Math.abs(value - game.answer) > threshold) {
      return { result: "far", tries: game.tries };
    }
  }

  return { result: value < game.answer ? "low" : "high", tries: game.tries };
}
