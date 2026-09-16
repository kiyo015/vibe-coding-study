import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, guess, LEVELS } from "../src/game.js";
import { MESSAGES } from "../web/messages.js";

// 決定的な疑似乱数(テストが毎回同じ手順で遊ぶようにする)
function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

// UIのテストが無い代わりに、「ロジックが返しうる応答すべてに表示文がある」ことを確かめる。
// 応答の一覧を別に持たず、実際に大量に遊ばせて出てきた応答を集める。ロジック側で応答が
// 増えれば(例: Day13で追加した far)、遊んだ中に現れた時点でこのテストが落ちる。
test("ゲームが返す応答には、すべて画面の表示文がある", () => {
  const random = lcg(42);
  const seen = new Set();

  for (const level of Object.keys(LEVELS)) {
    for (let i = 0; i < 500; i++) {
      const game = createGame(level, random);
      while (!game.finished) {
        const value = game.min + Math.floor(random() * (game.max - game.min + 1));
        seen.add(guess(game, value).result);
      }
    }
  }

  for (const result of seen) {
    assert.ok(MESSAGES[result], `応答 "${result}" の表示文が web/messages.js に無い`);
  }
  // 遊ばせ方が弱くて応答を拾えていない、を防ぐ(現時点で存在する5種類は必ず出ること)
  for (const expected of ["low", "high", "far", "correct", "lose"]) {
    assert.ok(seen.has(expected), `遊ばせた中に "${expected}" が一度も出なかった`);
  }
});
