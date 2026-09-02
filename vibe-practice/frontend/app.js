const listEl = document.getElementById("memo-list");
const formEl = document.getElementById("memo-form");
const inputEl = document.getElementById("memo-text");

async function loadMemos() {
  const res = await fetch("/memos");
  const memos = await res.json();
  listEl.innerHTML = "";
  for (const memo of memos) {
    const li = document.createElement("li");
    li.textContent = memo.text + ` (${memo.text.length}文字) `;
    const btn = document.createElement("button");
    btn.textContent = "削除";
    btn.onclick = async () => {
      const res = await fetch(`/memos/${memo.id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("削除に失敗しました");
        return;
      }
      loadMemos();
    };
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

formEl.onsubmit = async (e) => {
  e.preventDefault();
  await fetch("/memos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: inputEl.value }),
  });
  inputEl.value = "";
  loadMemos();
};

loadMemos();
