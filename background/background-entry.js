importScripts(
  "bg-trips.js",
  "bg-verification.js",
  "bg-ui.js",
  "bg-scheduler.js",
  "bg-auth.js"
);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_STATE") {
    chrome.storage.local.get(["tripState"], (data) => {
      sendResponse(data.tripState || null);
    });
    return true;
  }

  if (msg.type === "GET_TRIP_SCHEDULE") {
    sendResponse(TRIPS.map((t) => ({ runAtMs: t.runAtMs, etTime: t.etTime, label: t.label })));
    return;
  }

  if (msg.type === "CHECK_LOGIN_NOW") {
    hasStoredProlificId().then((hasProlificId) => {
      if (!hasProlificId) {
        promptForProlificId()
          .then(() => setProlificIdRequiredState())
          .then(() => {
            sendResponse({ ok: false, reason: "prolific_id_required" });
          });
        return;
      }
      checkUberLogin(false);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "PROLIFIC_ID_SAVED") {
    ensureLoginCheckAlarm();
    checkUberLogin(true);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "UBER_PRODUCTS_CAPTURED") {
    handleProductsCapture(msg.data);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "UBER_REDIRECT_DETECTED") {
    console.warn("⚠ Content script detected redirect to:", msg.url);
    chrome.storage.local.get(["tripState"], async (data) => {
      const state = data.tripState;
      if (state && state.running && !state.capturedForCurrent) {
        await handleNotLoggedIn(state);
      }
    });
    sendResponse({ ok: true });
    return;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    onSlotAlarm();
  }
  if (alarm.name === LOGIN_CHECK_ALARM) {
    checkUberLogin();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Uber Personalized Prices Aggregator installed");
  chrome.storage.local.remove(
    [
      "tripState",
      "browserVerificationSuccessNotified",
      "uberLoginSuccessNotified",
      "tripHistorySuccessNotified",
      "tripHistoryFailureNotified",
      "activityVerificationCompleted",
      "activityVerificationResult",
      "screenedOut",
      "screenOutReason",
    ],
    () => {
      console.log("🗑 Cleared old tripState");
      chrome.alarms.clear(LOGIN_CHECK_ALARM);
      promptForProlificId();
      setProlificIdRequiredState();
    }
  );
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started");
  hasStoredProlificId().then((hasProlificId) => {
    if (!hasProlificId) {
      chrome.alarms.clear(LOGIN_CHECK_ALARM);
      promptForProlificId();
      setProlificIdRequiredState();
      return;
    }
    ensureLoginCheckAlarm();
    checkUberLogin();
  });
});
