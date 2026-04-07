const TOOLBAR_ICON_GOOD = "Icon.png";
const TOOLBAR_ICON_BAD = "IconBadState.png";
const TIMING_LOG_KEY_FOR_ICON = "timingLog";

/** Avoid redundant setIcon IPC when path unchanged (popup polls often). */
let _lastToolbarIconPathSet = null;

/** Popup GET_STATE must not await setIcon every 2s — backs up extension IPC and freezes Chrome. */
let _lastThrottledToolbarIconAt = 0;

function toolbarIconPathFromTimingLog(rows, installedAtMs) {
  const filtered = filterTimingLogRowsAfterInstall(rows, installedAtMs);
  const health = buildSearchHealth(filtered);
  if (health.sampleSize === 0) return TOOLBAR_ICON_GOOD;
  return health.isFailing ? TOOLBAR_ICON_BAD : TOOLBAR_ICON_GOOD;
}

function refreshToolbarIconThrottled(minIntervalMs) {
  const now = Date.now();
  if (now - _lastThrottledToolbarIconAt < minIntervalMs) return;
  _lastThrottledToolbarIconAt = now;
  void refreshToolbarIcon();
}

async function refreshToolbarIcon() {
  try {
    const data = await chrome.storage.local.get([TIMING_LOG_KEY_FOR_ICON, EXTENSION_INSTALLED_AT_KEY]);
    const rows = Array.isArray(data[TIMING_LOG_KEY_FOR_ICON]) ? data[TIMING_LOG_KEY_FOR_ICON] : [];
    const raw = data[EXTENSION_INSTALLED_AT_KEY];
    const installedAtMs = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    const path = toolbarIconPathFromTimingLog(rows, installedAtMs);
    if (path === _lastToolbarIconPathSet) return;
    _lastToolbarIconPathSet = path;
    await chrome.action.setIcon({ path: { 16: path, 32: path } });
  } catch (err) {
    console.warn("refreshToolbarIcon:", err);
  }
}

async function updateBadge(state) {
  if (!state) {
    chrome.action.setBadgeText({ text: "" });
    await refreshToolbarIcon();
    return;
  }
  if (state.loginRequired) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c53030" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
  // Must await: MV3 service workers can terminate before a fire-and-forget promise finishes,
  // so chrome.action.setIcon would never run.
  await refreshToolbarIcon();
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

