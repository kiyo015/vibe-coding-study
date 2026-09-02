let memos = [];
let nextId = 1;

export function listMemos() {
  return memos;
}

export function addMemo(text) {
  if (!text || typeof text !== "string") {
    throw new Error("text is required");
  }
  const memo = { id: nextId++, text };
  memos.push(memo);
  return memo;
}

export function deleteMemo(id) {
  const before = memos.length;
  memos = memos.filter((m) => m.id !== id);
  return memos.length < before;
}

export function resetMemos() {
  memos = [];
  nextId = 1;
}
