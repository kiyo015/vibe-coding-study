import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, guess, LEVELS } from "../src/game.js";

// randomFnを固定して答えを決め打ちする
// normal(1〜500): 1 + floor(0.49*500) = 246 / easy(1〜100): 50 / hard(1〜1000): 491
const fixedRandom = () => 0.49;

test("createGame は固定乱数から答えを決める（既定はふつう）", () => {
  const game = createGame(undefined, fixedRandom);
  assert.equal(game.level, "normal");
  assert.equal(game.answer, 246);
  assert.equal(game.tries, 0);
  assert.equal(game.finished, false);
});

test("難易度ごとに範囲と上限が設定される", () => {
  for (const [level, def] of Object.entries(LEVELS)) {
    const game = createGame(level, fixedRandom);
    assert.equal(game.min, def.min);
    assert.equal(game.max, def.max);
    assert.equal(game.maxTries, def.maxTries);
  }
});

test("難易度が変わると答えの範囲も変わる", () => {
  assert.equal(createGame("easy", fixedRandom).answer, 50);
  assert.equal(createGame("hard", fixedRandom).answer, 491);
});

test("未知の難易度は例外", () => {
  assert.throws(() => createGame("insane", fixedRandom), /unknown level/);
});

test("正解すると correct を返し finished になる", () => {
  const game = createGame("normal", fixedRandom);
  const res = guess(game, 246);
  assert.equal(res.result, "correct");
  assert.equal(game.finished, true);
});

test("小さい推測は low、大きい推測は high", () => {
  const game = createGame("normal", fixedRandom);
  assert.equal(guess(game, 10).result, "low");
  assert.equal(guess(game, 400).result, "high");
});

test("上限回数は難易度ごとに変わる（やさしいは LEVELS.easy.maxTries 回で lose）", () => {
  const game = createGame("easy", fixedRandom);
  let res;
  for (let i = 0; i < LEVELS.easy.maxTries; i++) {
    res = guess(game, 1);
  }
  assert.equal(res.result, "lose");
  assert.equal(res.answer, 50);
  assert.equal(game.finished, true);
  assert.equal(res.tries, LEVELS.easy.maxTries);
});

test("範囲外・非整数の推測は、その難易度の範囲で例外", () => {
  const easy = createGame("easy", fixedRandom);
  assert.throws(() => guess(easy, 0));
  assert.throws(() => guess(easy, 101)); // ふつうなら範囲内だが、やさしいでは範囲外
  assert.throws(() => guess(easy, 1.5));

  const hard = createGame("hard", fixedRandom);
  assert.equal(guess(hard, 600).result, "far"); // ふつうなら範囲外だが、むずかしいでは有効な推測として処理される
});

test("むずかしいは、遠い推測に方向を教えず far を返す", () => {
  // hard(1〜1000)の答えは491。nearRatio 0.1 → 差100超で far
  const game = createGame("hard", fixedRandom);
  assert.equal(guess(game, 100).result, "far"); // 差391
  assert.equal(guess(game, 900).result, "far"); // 差409
});

test("むずかしいでも、近い推測には方向を返す", () => {
  const game = createGame("hard", fixedRandom);
  assert.equal(guess(game, 450).result, "low"); // 差41 → 近いので方向が出る
  assert.equal(guess(game, 530).result, "high"); // 差39
  assert.equal(guess(game, 591).result, "high"); // 差100ちょうどは「近い」側（境界は下のテストで確認）
});

test("far になる境界は範囲の広さ × nearRatio", () => {
  const game = createGame("hard", fixedRandom);
  const threshold = Math.floor((game.max - game.min + 1) * LEVELS.hard.nearRatio); // 100
  assert.equal(guess(game, game.answer - threshold).result, "low"); // 差100 → 近い
  assert.equal(guess(game, game.answer - threshold - 1).result, "far"); // 差101 → 遠い
});

test("やさしい・ふつうは常に方向を返す（粗いヒントは使わない）", () => {
  for (const level of ["easy", "normal"]) {
    const game = createGame(level, fixedRandom);
    assert.equal(guess(game, game.min).result, "low");
    assert.equal(LEVELS[level].nearRatio, undefined);
  }
});

test("終了後の推測は例外", () => {
  const game = createGame("normal", fixedRandom);
  guess(game, 246);
  assert.throws(() => guess(game, 246));
});
