import { createGame, guess, MIN_NUMBER, MAX_NUMBER, MAX_TRIES } from "../src/game.js";

const formEl = document.getElementById("guess-form");
const inputEl = document.getElementById("guess-input");
const logEl = document.getElementById("log");
const remainingEl = document.getElementById("remaining");
const restartEl = document.getElementById("restart");

// 出題範囲の表示・入力制限はロジック側の定数から引く(UIに数値を埋め込まない)
document.getElementById("min").textContent = MIN_NUMBER;
document.getElementById("max").textContent = MAX_NUMBER;
inputEl.min = MIN_NUMBER;
inputEl.max = MAX_NUMBER;

let game;

const MESSAGES = {
  low: "もっと大きい",
  high: "もっと小さい",
  correct: "正解",
  lose: "失敗",
};

function start() {
  game = createGame();
  logEl.innerHTML = "";
  inputEl.disabled = false;
  remainingEl.textContent = MAX_TRIES;
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
  remainingEl.textContent = MAX_TRIES - res.tries;
  inputEl.value = "";
  if (game.finished) inputEl.disabled = true;
};

restartEl.onclick = start;

start();
