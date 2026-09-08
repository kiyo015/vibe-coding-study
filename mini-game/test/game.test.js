import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, guess, MAX_TRIES } from "../src/game.js";

// randomFnを固定して答えを決め打ちする(0.49 → 1 + floor(0.49*500) = 246)
const fixedRandom = () => 0.49;

test("createGame は固定乱数から答えを決める", () => {
  const game = createGame(fixedRandom);
  assert.equal(game.answer, 246);
  assert.equal(game.tries, 0);
  assert.equal(game.finished, false);
});

test("正解すると correct を返し finished になる", () => {
  const game = createGame(fixedRandom);
  const res = guess(game, 246);
  assert.equal(res.result, "correct");
  assert.equal(game.finished, true);
});

test("小さい推測は low、大きい推測は high", () => {
  const game = createGame(fixedRandom);
  assert.equal(guess(game, 10).result, "low");
  assert.equal(guess(game, 400).result, "high");
});

test("上限回数に達すると lose になり答えが返る", () => {
  const game = createGame(fixedRandom);
  let res;
  for (let i = 0; i < MAX_TRIES; i++) {
    res = guess(game, 1);
  }
  assert.equal(res.result, "lose");
  assert.equal(res.answer, 246);
  assert.equal(game.finished, true);
});

test("範囲外・非整数の推測は例外", () => {
  const game = createGame(fixedRandom);
  assert.throws(() => guess(game, 0));
  assert.throws(() => guess(game, 501));
  assert.throws(() => guess(game, 1.5));
});

test("終了後の推測は例外", () => {
  const game = createGame(fixedRandom);
  guess(game, 246);
  assert.throws(() => guess(game, 246));
});
