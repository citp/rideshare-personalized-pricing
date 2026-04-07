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

function sendBrowserActivitySuccessNotification(profileVerification) {
  const totalLocalActions = profileVerification?.totalLocalActions ?? 0;
  const lookbackDays = profileVerification?.lookbackDays ?? 7;
  const activeDays = profileVerification?.activeDays ?? 0;
  const requiredActiveDays = profileVerification?.requiredActiveDays ?? 5;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "Icon.png",
    title: "Verification succeeded",
    message: `Chrome activity check succeeded: ${activeDays}/${requiredActiveDays} active days, ${totalLocalActions} local actions in ${lookbackDays} days.`,
    priority: 1,
  });
}

function sendUberLoginSuccessNotification() {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "Icon.png",
    title: "Verification succeeded",
    message: "Uber login check succeeded. Active Uber session detected.",
    priority: 1,
  });
}

function sendTripHistorySuccessNotification(verification) {
  const total = verification?.totalTripsSinceCutoff ?? 0;
  const minTripsRequired = verification?.minTripsRequired ?? 5;
  const cutoffDateISO = verification?.cutoffDateISO ?? "2025-03-01";
  chrome.notifications.create({
    type: "basic",
    iconUrl: "Icon.png",
    title: "Verification succeeded",
    message: `Uber trips check succeeded: ${total}/${minTripsRequired}+ trips since ${cutoffDateISO}.`,
    priority: 1,
  });
}

function sendTripHistoryFailureNotification(verification) {
  const total = verification?.totalTripsSinceCutoff ?? 0;
  const minTripsRequired = verification?.minTripsRequired ?? 5;
  const cutoffDateISO = verification?.cutoffDateISO ?? "2025-03-01";
  const profileSummaries = verification?.profileSummaries || [];
  const hadFetchError = profileSummaries.some((p) => p && p.fetched === false);
  const nonOkStatuses = profileSummaries
    .filter((p) => p && p.fetched && p.httpOk === false)
    .map((p) => `${p.profile}:${p.httpStatus}`);
  const reason = hadFetchError
    ? "Network/read error on one or more trip pages."
    : nonOkStatuses.length > 0
      ? `Trip pages returned non-OK status (${nonOkStatuses.join(", ")}).`
      : "Not enough trips found.";
  chrome.notifications.create({
    type: "basic",
    iconUrl: "Icon.png",
    title: "Verification failed",
    message: `Uber trips check failed: ${total}/${minTripsRequired} trips since ${cutoffDateISO}. ${reason} Open extension popup for details.`,
    priority: 1,
  });
}

function sendSearchReliabilityWarningNotification(health) {
  const failed = health?.failedCount ?? 0;
  const total = health?.sampleSize ?? 0;
  const percent = Math.round((health?.failureRate ?? 0) * 100);
  chrome.notifications.create({
    type: "basic",
    iconUrl: "Icon.png",
    title: "Search reliability warning",
    message: `High failure rate: ${failed}/${total} recent searches failed (${percent}%). Open extension popup for details.`,
    priority: 2,
  });
}
