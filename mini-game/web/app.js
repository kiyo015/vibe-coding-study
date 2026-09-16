import { createGame, guess, LEVELS } from "../src/game.js";
import { MESSAGES } from "./messages.js";

const formEl = document.getElementById("guess-form");
const inputEl = document.getElementById("guess-input");
const logEl = document.getElementById("log");
const remainingEl = document.getElementById("remaining");
const restartEl = document.getElementById("restart");
const levelsEl = document.getElementById("levels");
const levelLabelEl = document.getElementById("level-label");

let game;


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
// 引数なしで呼ぶと createGame の既定難易度になる。UI側に既定値を書かない(定義元はgame.jsの1箇所)
function start(level) {
  game = createGame(level);
  levelLabelEl.textContent = LEVELS[game.level].label;
  document.getElementById("min").textContent = game.min;
  document.getElementById("max").textContent = game.max;
  inputEl.min = game.min;
  inputEl.max = game.max;
  for (const button of levelsEl.children) {
    button.setAttribute("aria-pressed", String(button.dataset.level === game.level));
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
