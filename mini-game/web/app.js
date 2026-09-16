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
  far: "かなり離れている", // むずかしいだけ。遠い間は方向を教えない

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
