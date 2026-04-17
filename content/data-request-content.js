// Uber myprivacy "request your data" button automation — disabled.
// See background/bg-data-request.js for manifest.json host_permissions + content_scripts to restore.

/*
(function () {
  const BUTTON_TEXT = "request your data";
  const STATE_KEY = "uberDataRequestState";
  const MAX_WAIT_MS = 90000;
  const INTERVAL_MS = 1500;

  function findRequestButton() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    for (const el of candidates) {
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      const text = (el.textContent || "").trim().toLowerCase();
      if (aria.includes(BUTTON_TEXT) || text.includes(BUTTON_TEXT)) {
        return el;
      }
    }
    return null;
  }

  function sendResult(ok, reason) {
    try {
      chrome.runtime.sendMessage({ type: "UBER_DATA_REQUEST_CLICK_RESULT", ok, reason });
    } catch (_) {}
  }

  async function shouldAttemptClick() {
    try {
      const data = await chrome.storage.local.get([STATE_KEY]);
      const state = data[STATE_KEY] || {};
      return state.status !== "success";
    } catch (_) {
      return true;
    }
  }

  async function run() {
    if (!(await shouldAttemptClick())) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        clearInterval(timer);
        sendResult(false, "button_not_found");
        return;
      }
      const button = findRequestButton();
      if (!button) return;
      clearInterval(timer);
      try {
        button.click();
        sendResult(true, "");
      } catch (err) {
        sendResult(false, `click_error:${String(err)}`);
      }
    }, INTERVAL_MS);
  }

  run();
})();
*/
