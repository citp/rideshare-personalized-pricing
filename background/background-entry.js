importScripts(
  "bg-trips.js",
  "bg-verification.js",
  "bg-ui.js",
  "bg-scheduler.js",
  "bg-data-request.js",
  "bg-auth.js"
);

function syncPowerLockWithState() {
  chrome.storage.local.get(["tripState"], (data) => {
    const running = Boolean(data.tripState?.running);
    try {
      if (running) {
        chrome.power.requestKeepAwake("system");
      } else {
        chrome.power.releaseKeepAwake();
      }
    } catch (err) {
      console.warn("Power lock sync failed:", err);
    }
  });
}

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

  if (msg.type === "GET_SCHEDULER_CONFIG") {
    getSchedulerConfig()
      .then((cfg) => sendResponse({ ok: true, config: cfg }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "SET_SCHEDULER_CONFIG") {
    const cfg = sanitizeSchedulerConfig(msg.config || {});
    chrome.storage.local
      .set({ schedulerConfig: cfg })
      .then(() => sendResponse({ ok: true, config: cfg }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "GET_TIMING_LOG") {
    chrome.storage.local
      .get(["timingLog"])
      .then((data) => sendResponse({ ok: true, rows: Array.isArray(data.timingLog) ? data.timingLog : [] }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
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

  if (msg.type === "UBER_DATA_REQUEST_CLICK_RESULT") {
    handleUberDataRequestClickResult(msg);
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
  if (alarm.name === UBER_DATA_REQUEST_ALARM) {
    onUberDataRequestAlarm();
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
      "uberDataRequestState",
    ],
    () => {
      console.log("🗑 Cleared old tripState");
      chrome.alarms.clear(LOGIN_CHECK_ALARM);
      try {
        chrome.power.releaseKeepAwake();
      } catch (_) {}
      promptForProlificId();
      setProlificIdRequiredState();
      ensureUberDataRequestAlarm();
    }
  );
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started");
  syncPowerLockWithState();
  hasStoredProlificId().then((hasProlificId) => {
    if (!hasProlificId) {
      chrome.alarms.clear(LOGIN_CHECK_ALARM);
      promptForProlificId();
      setProlificIdRequiredState();
      return;
    }
    ensureLoginCheckAlarm();
    checkUberLogin();
    ensureUberDataRequestAlarm();
  });
});

syncPowerLockWithState();
ensureUberDataRequestAlarm();
