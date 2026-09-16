# 難易度選択 実装計画

> **作業者向け:** `superpowers:subagent-driven-development` または `superpowers:executing-plans` を使い、タスク単位で実装する。手順はチェックボックス（`- [ ]`）で追跡する。

**ゴール:** 数当てゲームに「やさしい／ふつう／むずかしい」の難易度選択を追加し、画面から選べるようにする。

**方針:** 難易度の定義を`src/game.js`の`LEVELS`表1つに集約し、範囲と上限を`game`自身に持たせる。UIは`LEVELS`を読んでボタンを生成する。既存の定数`MIN_NUMBER`・`MAX_NUMBER`・`MAX_TRIES`は削除し、互換用の迂回路は作らない。

**技術:** ESM（`"type": "module"`）、`node:test`、外部依存なし。

## 全体の制約

- 外部依存を追加しない（Node標準・ブラウザ標準APIのみ）
- `src/`はDOMに触れない（`document`・`window`を参照した時点で設計が壊れているとみなす）
- `web/`にルール判定を書かない（勝敗・残り回数の判断は`src/game.js`）
- マジックナンバーを使わず、名前付きでexportする
- 乱数は引数で注入できる形を保つ
- 難易度の値（仮）: `easy` 1〜100/8回、`normal` 1〜500/10回、`hard` 1〜1000/10回
- 仕様書: `mini-game/docs/specs/2026-09-16-difficulty-levels-design.md`
- 作業ディレクトリは`mini-game/`。コミットはリポジトリルート（`Study`）で行う

---

### Task 1: ロジック層に難易度を入れる

**ファイル:**
- 変更: `mini-game/src/game.js`
- テスト: `mini-game/test/game.test.js`

**インターフェース:**
- 提供: `LEVELS`（`{ easy, normal, hard }`、各要素は`{ label, min, max, maxTries }`）、`createGame(level = "normal", randomFn = Math.random)` → `{ level, min, max, maxTries, answer, tries, finished }`、`guess(game, value)` → 既存と同じ`{ result, tries, answer? }`
- 廃止: `MIN_NUMBER`・`MAX_NUMBER`・`MAX_TRIES`のexport

- [ ] **Step 1: テストを新しいAPIに書き換え、難易度のテストを追加する**

`mini-game/test/game.test.js` を次の内容にする。

```js
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

test("上限回数は難易度ごとに変わる（やさしいは8回で lose）", () => {
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
  assert.equal(guess(hard, 600).result, "high"); // ふつうなら範囲外だが、むずかしい(答え491)では有効
});

test("終了後の推測は例外", () => {
  const game = createGame("normal", fixedRandom);
  guess(game, 246);
  assert.throws(() => guess(game, 246));
});
```

- [ ] **Step 2: テストが失敗することを確認する**

実行: `cd mini-game && node --test test/game.test.js`
期待: `LEVELS`がexportされていないため失敗する（`LEVELS`が`undefined`で`Object.entries`が落ちる、または`unknown level`のテストが失敗する）。**「難易度が無いから落ちている」ことを出力で確かめる。**

- [ ] **Step 3: `src/game.js`を実装する**

```js
// 難易度の定義。ここを変える時は docs/game-rules.md とテストも合わせて見直すこと(手順はgame-balanceスキル)
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
```

- [ ] **Step 4: テストが通ることを確認する**

実行: `cd mini-game && npm test`
期待: 9件すべて成功。`dev-guard`のPostToolUseフックも編集のたびに走るので、その報告（`[dev-guard] mini-game: 編集後のnpm test 全件パス`）も確認する。

- [ ] **Step 5: コミットする**

```bash
git add mini-game/src/game.js mini-game/test/game.test.js
git commit -m "mini-game: 難易度をLEVELS表に集約し、範囲と上限をgameが持つ形にする"
```

---

### Task 2: 画面から難易度を選べるようにする

**ファイル:**
- 変更: `mini-game/web/index.html`（39〜45行目付近）
- 変更: `mini-game/web/app.js`

**インターフェース:**
- 消費: Task 1の`LEVELS`・`createGame(level, randomFn)`・`game.maxTries`
- 提供: なし（UI層で完結）

- [ ] **Step 1: `index.html`に難易度ボタンの置き場と難易度表示を足す**

39行目の`<p>`の**前**に次を挿入する。

```html
  <div id="levels"></div>
```

39行目の`<p>`を次に差し替える（現在の難易度を表示する`<span>`を追加）。

```html
  <p><span id="level-label"></span>：<span id="min"></span>〜<span id="max"></span>の数を当てる。残り<span id="remaining"></span>回。</p>
```

`<style>`に次の2行を足す（選択中のボタンを見て分かるようにする）。

```css
    #levels { margin-bottom: 0.5rem; }
    #levels button[aria-pressed="true"] { font-weight: bold; text-decoration: underline; }
```

- [ ] **Step 2: `app.js`を難易度対応に書き換える**

```js
import { createGame, guess, LEVELS } from "../src/game.js";

const formEl = document.getElementById("guess-form");
const inputEl = document.getElementById("guess-input");
const logEl = document.getElementById("log");
const remainingEl = document.getElementById("remaining");
const restartEl = document.getElementById("restart");
const levelsEl = document.getElementById("levels");
const levelLabelEl = document.getElementById("level-label");

let game;

const MESSAGES = {
  low: "もっと大きい",
  high: "もっと小さい",
  correct: "正解",
  lose: "失敗",
};

// 難易度ボタンはLEVELS表から作る(難易度を増やしてもUIは触らなくて済む)
for (const [level, def] of Object.entries(LEVELS)) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = def.label;
  button.dataset.level = level;
  button.onclick = () => start(level);
  levelsEl.appendChild(button);
}

// 出題範囲の表示・入力制限はgameから引く(UIに数値を埋め込まない)
function start(level = "normal") {
  game = createGame(level);
  levelLabelEl.textContent = LEVELS[level].label;
  document.getElementById("min").textContent = game.min;
  document.getElementById("max").textContent = game.max;
  inputEl.min = game.min;
  inputEl.max = game.max;
  for (const button of levelsEl.children) {
    button.setAttribute("aria-pressed", String(button.dataset.level === level));
  }
  logEl.innerHTML = "";
  inputEl.disabled = false;
  inputEl.value = "";
  remainingEl.textContent = game.maxTries;
  inputEl.focus();
}

function addLog(value, res) {
  const li = document.createElement("li");
  li.textContent = `${value} → ${MESSAGES[res.result]}`;
  if (res.result === "correct") {
    li.className = "correct";
    li.textContent += `（${res.tries}回で的中）`;
  }
  if (res.result === "lose") {
    li.className = "lose";
    li.textContent += `（答えは ${res.answer}）`;
  }
  logEl.appendChild(li);
}

formEl.onsubmit = (e) => {
  e.preventDefault();
  const res = guess(game, Number(inputEl.value));
  addLog(inputEl.value, res);
  remainingEl.textContent = game.maxTries - res.tries;
  inputEl.value = "";
  if (game.finished) inputEl.disabled = true;
};

// やり直すは今の難易度のまま作り直す
restartEl.onclick = () => start(game.level);

start();

// index.html側がこのフラグを見て「モジュールが読めなかった」場合に警告を出す
window.__gameReady = true;
```

- [ ] **Step 3: 実際に動かして確認する**

実行: `cd mini-game && npm run dev` → http://localhost:3100/ を開く

確認すること:
1. ボタンが3つ出ており、既定で「ふつう」が選択状態（太字＋下線）
2. 「やさしい」を押すと表示が「やさしい：1〜100の数を当てる。残り8回。」に変わり、ログが消える
3. 101を入力して送信するとエラーになる（`guess must be an integer between 1 and 100`）
4. 「むずかしい」で600を入力すると`low`か`high`が返る（範囲内として扱われる）
5. 進行中に別の難易度を押すと、その場で新しいゲームになる

- [ ] **Step 4: テストが壊れていないことを確認する**

実行: `cd mini-game && npm test`
期待: 9件すべて成功（UIの変更はロジックに影響しないことの確認）

- [ ] **Step 5: コミットする**

```bash
git add mini-game/web/index.html mini-game/web/app.js
git commit -m "mini-game: 難易度ボタンを追加し、表示と入力制限をgameから引く"
```

---

### Task 3: 勝率を測って難易度を調整する

**ファイル:**
- 変更（測定結果しだい）: `mini-game/src/game.js`の`LEVELS`
- 変更: `mini-game/docs/game-rules.md`
- 変更（値を変えた場合）: `mini-game/test/game.test.js`の固定乱数コメントと期待値

- [ ] **Step 1: `game-playtester`サブエージェントに測定を依頼する**

依頼に必ず含める内容:
- 対象は`mini-game/src/game.js`の`LEVELS`（easy・normal・hard）
- 「人間らしい打ち方」の定義を**エージェント側で1つに決めて明示する**こと（例: 二分探索の中央値から±10%ずらす、など）。完璧な二分探索だけの測定にはしない
- 各難易度1万回以上の試行で、**勝率・平均手数・負けた時の残り距離**を数値で返すこと
- コードは変更しないこと

- [ ] **Step 2: 目標と比べる**

目標: `easy` 9割 / `normal` 7割 / `hard` 4割（仕様書の表）。
判断:
- ±5ポイント以内なら調整せずStep 4へ
- 外れていれば、`maxTries`を1ずつ動かして再測定する（範囲は変えない。範囲を変えると二分探索の最悪手数が変わり、表の「余裕」の意味も変わるため）

- [ ] **Step 3: 値を変えた場合のみ、定数・テスト・ドキュメントを揃える**

`game-balance`スキルの手順に従い、次の3つを必ず同時に直す。
1. `src/game.js`の`LEVELS`
2. `test/game.test.js`（固定乱数から決まる答えのコメントと期待値。`easy`の答えは`1 + floor(0.49 * (max - min + 1))`で再計算する）
3. `docs/game-rules.md`

実行: `cd mini-game && npm test` → 9件成功を確認

- [ ] **Step 4: `docs/game-rules.md`を難易度対応に更新する**

次の内容を反映する。
- 難易度表（難易度・範囲・上限・二分探索の最悪手数・余裕・実測した勝率）
- 出題範囲と上限が`LEVELS`で決まること
- 調整時の注意（範囲を変えたら上限も見直す。`ceil(log2(max - min + 1))`）
- 測定日と測定方法（どの打ち方で何回試行したか）

- [ ] **Step 5: コミットする**

```bash
git add mini-game/src/game.js mini-game/test/game.test.js mini-game/docs/game-rules.md
git commit -m "mini-game: 勝率の実測に基づいて難易度を調整し、仕様書を更新する"
```

---

### Task 4: レビューと最終確認

**ファイル:**
- 変更（指摘しだい）: Task 1〜3で触ったファイル

- [ ] **Step 1: 差分を作る**

```bash
git diff day12..HEAD -- mini-game > "$SCRATCH/difficulty.diff"
```

（`$SCRATCH`はスクラッチパッドのパス。リポジトリには入れない）

- [ ] **Step 2: `team-reviewer`サブエージェントにレビューを依頼する**

渡すもの: 差分のパス、「何を実現する変更か」（難易度選択の追加。ロジック層の定数を`LEVELS`表に集約し、UIは表から生成する）、指摘には**再現手順か具体的な入力例を添えること**。
渡さないもの: これまでの会話の経緯、自分の見立て。

- [ ] **Step 3: 指摘を1件ずつ実測で確かめる**

コードを直す前に、指摘どおりの入力で実際に動かす。再現しなければ根拠を示して反論する。修正する場合はテストを先に書き、失敗を確認してから直す。

- [ ] **Step 4: 健康診断で全体を確認する**

実行: `node checks/health-check.js`（リポジトリルート）
期待: 7項目すべてOK（未pushのコミットがあれば`git の状態`がNGになるので、その場合はpush後に再実行する）

- [ ] **Step 5: コミットする**

```bash
git add -A
git commit -m "mini-game: レビュー指摘の修正"
```

（指摘がなく修正が不要なら、このコミットは作らない）

## 自己点検

- 仕様書の項目との対応: 難易度の軸（Task 1）／画面で選ぶ（Task 2）／API形（Task 1）／勝率で決める（Task 3）／テスト観点5つ（Task 1のStep 1に全部含む）／ドキュメント更新（Task 3）／YAGNI項目は計画に含めない——すべて対応済み
- 名前の一貫性: `LEVELS`・`createGame(level, randomFn)`・`game.maxTries`・`game.min`・`game.max`・`game.level`をTask 1で定義し、Task 2以降も同じ名前で参照している
- 「適切にエラー処理する」のような中身のない手順は書いていない（未知の難易度は`unknown level: ${level}`と明示）
