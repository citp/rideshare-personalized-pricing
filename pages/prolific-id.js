const input = document.getElementById("prolific-id");
const saveBtn = document.getElementById("save-btn");
const msg = document.getElementById("msg");

chrome.storage.local.get(["prolificId"], (data) => {
  if (typeof data.prolificId === "string" && data.prolificId.trim()) {
    input.value = data.prolificId.trim();
  }
});

function saveProlificId() {
  const value = input.value.trim();
  if (!value) {
    msg.textContent = "Prolific ID is required.";
    msg.className = "msg err";
    return;
  }

  chrome.storage.local.set({ prolificId: value }, () => {
    msg.textContent = "Saved.";
    msg.className = "msg";
    chrome.runtime.sendMessage({ type: "PROLIFIC_ID_SAVED" }, () => {
      chrome.tabs.getCurrent((tab) => {
        if (tab?.id) {
          chrome.tabs.remove(tab.id);
        } else {
          window.close();
        }
      });
    });
  });
}

saveBtn.addEventListener("click", saveProlificId);

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveProlificId();
  }
});
