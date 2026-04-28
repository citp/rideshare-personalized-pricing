const TIMING_LOG_KEY_FOR_ICON = "timingLog";

/** Popup GET_STATE must not hit storage+badge every 2s — backs up extension IPC and freezes Chrome. */
let _lastThrottledActionSyncFromGetStateAt = 0;

/** Check if sample exists and search health is failing. */
async function timingIndicatesBadSearchHealth() {
  const data = await chrome.storage.local.get([TIMING_LOG_KEY_FOR_ICON, EXTENSION_INSTALLED_AT_KEY]);
  const rows = Array.isArray(data[TIMING_LOG_KEY_FOR_ICON]) ? data[TIMING_LOG_KEY_FOR_ICON] : [];
  const raw = data[EXTENSION_INSTALLED_AT_KEY];
  const installedAtMs = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  const filtered = filterTimingLogRowsAfterInstall(rows, installedAtMs);
  const health = buildSearchHealth(filtered);
  if (health.sampleSize === 0) return false;
  return health.isFailing;
}

function updateBadgeThrottledFromStorage(minIntervalMs) {
  const now = Date.now();
  if (now - _lastThrottledActionSyncFromGetStateAt < minIntervalMs) return;
  _lastThrottledActionSyncFromGetStateAt = now;
  void chrome.storage.local.get(["tripState"], (data) => {
    void updateBadge(data.tripState || null);
  });
}

async function syncActionFromStorage() {
  const data = await chrome.storage.local.get(["tripState"]);
  await updateBadge(data.tripState || null);
}

async function updateBadge(state) {
  const badTiming = await timingIndicatesBadSearchHealth();
  const showRedBang = Boolean(state?.loginRequired) || badTiming;
  if (showRedBang) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c53030" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

function sendLoginNotification() {
  console.warn("⚠ Not logged in — opening login-required page");
  const loginPageUrl = getLoginRequiredPageUrl();
  chrome.tabs.query({ url: `${STUDY_EXTENSION_PAGES_BASE}/login-required.html*` }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: loginPageUrl, active: true });
    }
  });
}

