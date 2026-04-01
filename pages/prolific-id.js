const input = document.getElementById("prolific-id");
const saveBtn = document.getElementById("save-btn");
const msg = document.getElementById("msg");

chrome.storage.local.get(["prolificId"], (data) => {
  if (typeof data.prolificId === "string" && data.prolificId.trim()) {
    input.value = data.prolificId.trim();
  }
});

saveBtn.addEventListener("click", () => {
  const value = input.value.trim();
  if (!value) {
    msg.textContent = "Prolific ID is required.";
    msg.className = "msg err";
    return;
  }
  chrome.storage.local.set({ prolificId: value }, () => {
    msg.textContent = "Saved. You can close this tab.";
    msg.className = "msg";
    chrome.runtime.sendMessage({ type: "PROLIFIC_ID_SAVED" });
  });
});
