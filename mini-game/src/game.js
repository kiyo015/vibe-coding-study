// 難易度に関わる定数。変更時はdocs/game-rules.mdとテストも合わせて見直すこと(手順はgame-balanceスキル)
export const MIN_NUMBER = 1;
export const MAX_NUMBER = 500;
export const MAX_TRIES = 10;

// 乱数生成を外から差し替えられるようにする(テストで固定値を使うため)
export function createGame(randomFn = Math.random) {
  const answer = MIN_NUMBER + Math.floor(randomFn() * (MAX_NUMBER - MIN_NUMBER + 1));
  return { answer, tries: 0, finished: false };
}

export function guess(game, value) {
  if (game.finished) {
    throw new Error("game is already finished");
  }
  if (!Number.isInteger(value) || value < MIN_NUMBER || value > MAX_NUMBER) {
    throw new Error(`guess must be an integer between ${MIN_NUMBER} and ${MAX_NUMBER}`);
  }

  game.tries++;

  if (value === game.answer) {
    game.finished = true;
    return { result: "correct", tries: game.tries };
  }
  if (game.tries >= MAX_TRIES) {
    game.finished = true;
    return { result: "lose", tries: game.tries, answer: game.answer };
  }
  return { result: value < game.answer ? "low" : "high", tries: game.tries };
}
