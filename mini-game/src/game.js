// 難易度の定義。ここを変える時はdocs/game-rules.mdとテストも合わせて見直すこと(手順はgame-balanceスキル)
export const LEVELS = {
  easy: { label: "やさしい", min: 1, max: 100, maxTries: 8 },
  normal: { label: "ふつう", min: 1, max: 500, maxTries: 10 },
  hard: { label: "むずかしい", min: 1, max: 1000, maxTries: 10 },
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
  return { result: value < game.answer ? "low" : "high", tries: game.tries };
}
