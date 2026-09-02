import { test } from "node:test";
import assert from "node:assert/strict";
import { listMemos, addMemo, deleteMemo, resetMemos } from "../src/memo.js";

test("addMemo adds and listMemos returns it", () => {
  resetMemos();
  const memo = addMemo("hello");
  assert.equal(memo.text, "hello");
  assert.equal(listMemos().length, 1);
});

test("addMemo rejects empty text", () => {
  resetMemos();
  assert.throws(() => addMemo(""));
});

test("deleteMemo removes existing memo", () => {
  resetMemos();
  const memo = addMemo("to delete");
  assert.equal(deleteMemo(memo.id), true);
  assert.equal(listMemos().length, 0);
});

test("deleteMemo returns false for missing id", () => {
  resetMemos();
  const NONEXISTENT_ID = 999;
  assert.equal(deleteMemo(NONEXISTENT_ID), false);
});
