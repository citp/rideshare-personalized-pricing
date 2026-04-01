function updateBadge(state) {
  if (!state) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  if (state.loginRequired) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#c53030" });
  } else {
    const done = state.tripStatuses.filter((s) => s === "success").length;
    const eligible = state.tripStatuses.filter((s) => s !== "skipped").length;
    if (state.running) {
      chrome.action.setBadgeText({ text: `${done}/${eligible}` });
      chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
    } else {
      chrome.action.setBadgeText({ text: `${done}/${eligible}` });
      chrome.action.setBadgeBackgroundColor({ color: "#276749" });
    }
  }
}

function sendLoginNotification() {
  console.warn("⚠ Not logged in — opening login-required page");
  const loginPageUrl = chrome.runtime.getURL("pages/login-required.html");
  chrome.tabs.query({ url: loginPageUrl }, (tabs) => {
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
    iconUrl: "icon.png",
    title: "Verification succeeded",
    message: `Chrome activity check succeeded: ${activeDays}/${requiredActiveDays} active days, ${totalLocalActions} local actions in ${lookbackDays} days.`,
    priority: 1,
  });
}

function sendUberLoginSuccessNotification() {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon.png",
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
    iconUrl: "icon.png",
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
    iconUrl: "icon.png",
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
    iconUrl: "icon.png",
    title: "Search reliability warning",
    message: `High failure rate: ${failed}/${total} recent searches failed (${percent}%). Open extension popup for details.`,
    priority: 2,
  });
}
