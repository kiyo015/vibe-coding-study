// ゲームの応答(guessが返すresult)ごとの表示文。DOMに触れないので、テストから読める。
// 応答を増やしたら、ここにも表示文を足すこと(test/messages.test.jsが足し忘れを検知する)
export const MESSAGES = {
  low: "もっと大きい",
  high: "もっと小さい",
  far: "かなり離れている", // むずかしいだけ。遠い間は方向を教えない
  correct: "正解",
  lose: "失敗",
};
