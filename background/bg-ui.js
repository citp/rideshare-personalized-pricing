const TOOLBAR_ICON_GOOD = "Icon.png";
const TOOLBAR_ICON_BAD = "icon_bad_state.png";
const TIMING_LOG_KEY_FOR_ICON = "timingLog";

function toolbarIconPathFromTimingLog(rows, installedAtMs) {
  const filtered = filterTimingLogRowsAfterInstall(rows, installedAtMs);
  const completed = filtered.filter((r) => {
    const o = r?.outcome;
    return o === "success" || o === "no_data" || o === "no_prices" || o === "missed_late";
  });
  const n = completed.length;
  if (n === 0) return TOOLBAR_ICON_GOOD;
  const windowRows = n < 10 ? completed : completed.slice(-10);
  const successes = windowRows.filter((r) => r?.outcome === "success").length;
  return successes / windowRows.length >= 0.5 ? TOOLBAR_ICON_GOOD : TOOLBAR_ICON_BAD;
}

async function refreshToolbarIcon() {
  try {
    const data = await chrome.storage.local.get([TIMING_LOG_KEY_FOR_ICON, EXTENSION_INSTALLED_AT_KEY]);
    const rows = Array.isArray(data[TIMING_LOG_KEY_FOR_ICON]) ? data[TIMING_LOG_KEY_FOR_ICON] : [];
    const raw = data[EXTENSION_INSTALLED_AT_KEY];
    const installedAtMs = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    const path = toolbarIconPathFromTimingLog(rows, installedAtMs);
    await chrome.action.setIcon({ path: { 16: path, 32: path } });
  } catch (err) {
    console.warn("refreshToolbarIcon:", err);
  }
}

function updateBadge(state) {
  if (!state) {
    chrome.action.setBadgeText({ text: "" });
    void refreshToolbarIcon();
    return;
  }
  if (state.loginRequired) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c53030" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
  void refreshToolbarIcon();
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

