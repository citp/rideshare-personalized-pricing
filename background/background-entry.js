importScripts(
  "study-pages.js",
  "bg-trip-list.js",
  "bg-trips.js",
  "bg-verification.js",
  "bg-ui.js",
  "bg-scheduler.js",
  "bg-data-request.js",
  "bg-auth.js"
);

/**
 * Full reset for a new extension session: first install, Web Store update, or reload on
 * chrome://extensions (new service worker). The service worker `install` event covers
 * reload when manifest version is unchanged; `runtime.onInstalled` with install/update
 * covers store updates. Same-worker dedupe avoids running twice when both fire.
 */
let _newExtensionSessionPromise = null;
let _extensionSessionResetDoneThisWorker = false;
function runNewExtensionSessionSetup(source) {
  if (_extensionSessionResetDoneThisWorker) {
    console.log("Skip duplicate extension session reset:", source);
    return Promise.resolve();
  }
  if (_newExtensionSessionPromise) return _newExtensionSessionPromise;
  _newExtensionSessionPromise = new Promise((resolve, reject) => {
    const keysToRemove = [
      "tripState",
      "prolificId",
      "activityVerificationCompleted",
      "activityVerificationResult",
      "lastLoginCheckAt",
      "screenedOut",
      "screenOutReason",
      "uberDataRequestState",
      "timingLog",
      "studyGeoSnapshot",
      RIDE_SCHEDULE_STORAGE_KEY,
      RIDE_SCHEDULE_LAST_FETCHED_AT_KEY,
      "studyUberTabId",
      "schedulerConfig",
    ];
    chrome.storage.local.remove(keysToRemove, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      console.log("🗑 New extension session:", source);
      const afterInstallStamp = () => {
        chrome.alarms.clear(LOGIN_CHECK_ALARM);
        try {
          chrome.power.releaseKeepAwake();
        } catch (_) {}
        void ensureRideScheduleRefreshAlarm();
        promptForProlificId();
        setProlificIdRequiredState();
        ensureUberDataRequestAlarm();
        void syncActionFromStorage();
      };
      const loadScheduleThen = (done) => {
        fetchPersistAndApplyRideSchedule()
          .catch((err) => console.error("Ride schedule from study site failed:", err))
          .finally(() => done());
      };
      chrome.storage.local.set({ [EXTENSION_INSTALLED_AT_KEY]: Date.now() }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        loadScheduleThen(() => {
          try {
            afterInstallStamp();
            _extensionSessionResetDoneThisWorker = true;
          } finally {
            resolve();
          }
        });
      });
    });
  }).finally(() => {
    _newExtensionSessionPromise = null;
  });
  return _newExtensionSessionPromise;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    runNewExtensionSessionSetup("serviceWorkerInstall").catch((err) =>
      console.error("New extension session (service worker install) failed:", err)
    )
  );
});

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
    (async () => {
      try {
        const data = await chrome.storage.local.get(["tripState", "timingLog", "extensionInstalledAt"]);
        const normalized = normalizeTripState(data.tripState || null);
        const state = normalized.state;
        if (normalized.changed) {
          await chrome.storage.local.set({ tripState: state });
        }
        let payload = null;
        if (state) {
          await repairOrphanSearchingTripStatuses(state);
          const rows = Array.isArray(data.timingLog) ? data.timingLog : [];
          const raw = data.extensionInstalledAt;
          const installedAtMs = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
          const filteredRows = filterTimingLogRowsAfterInstall(rows, installedAtMs);
          const searchHealth = buildSearchHealth(filteredRows);
          payload = { ...state, searchHealth };
        }
        sendResponse(payload);
        // Never block GET_STATE on badge+icon sync — causes extension IPC pile-up and whole-browser hangs.
        updateBadgeThrottledFromStorage(12000);
      } catch (err) {
        console.warn("GET_STATE failed:", err);
        sendResponse(null);
      }
    })();
    return true;
  }

  if (msg.type === "GET_TRIP_SCHEDULE") {
    ensureTripScheduleHydratedFromStorage().then(() => {
      sendResponse(TRIPS.map((t) => ({ runAtMs: t.runAtMs, etTime: t.etTime, label: t.label })));
    });
    return true;
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
      checkUberLogin();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "PROLIFIC_ID_SAVED") {
    handleProlificIdSaved();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "SAVE_STUDY_GEO_SNAPSHOT") {
    const pageUrl = sender.url || "";
    if (!pageUrl.startsWith("https://rideshare-study.cs.princeton.edu/")) {
      sendResponse({ ok: false, error: "wrong_origin" });
      return;
    }
    saveStudyGeoSnapshotFromInstall({
      latitude: msg.latitude,
      longitude: msg.longitude,
    })
      .then((r) => sendResponse(r))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === "SYNC_PROLIFIC_ID_FROM_STUDY_SITE") {
    const pageUrl = sender.url || "";
    if (!pageUrl.startsWith("https://rideshare-study.cs.princeton.edu/")) {
      return;
    }
    const value = typeof msg.prolificId === "string" ? msg.prolificId.trim() : "";
    if (!value) {
      sendResponse({ ok: false, error: "empty" });
      return;
    }
    chrome.storage.local.get(["prolificId"], (data) => {
      const current = typeof data.prolificId === "string" ? data.prolificId.trim() : "";
      if (current === value) {
        sendResponse({ ok: true, unchanged: true });
        return;
      }
      chrome.storage.local.set({ prolificId: value }, () => {
        handleProlificIdSaved();
        sendResponse({ ok: true });
      });
    });
    return true;
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
  if (
    alarm.name === ALARM_NAME ||
    alarm.name.startsWith(`${ALARM_NAME}:slot:`) ||
    alarm.name.startsWith(`${ALARM_NAME}:capture-timeout:slot:`)
  ) {
    onSlotAlarm(alarm.name);
  }
  if (alarm.name === LOGIN_CHECK_ALARM) {
    checkUberLogin();
  }
  if (alarm.name === UBER_DATA_REQUEST_ALARM) {
    onUberDataRequestAlarm();
  }
  if (alarm.name === RIDE_SCHEDULE_REFRESH_ALARM) {
    void maybeRefreshRideScheduleFromClock();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log("Princeton Rideshare Study onInstalled:", details.reason);
  if (details.reason === "install" || details.reason === "update") {
    void runNewExtensionSessionSetup(`onInstalled:${details.reason}`).catch((err) =>
      console.error("New extension session (onInstalled) failed:", err)
    );
    return;
  }
  const keysToRemove = [
    "tripState",
    "prolificId",
    "activityVerificationCompleted",
    "activityVerificationResult",
    "lastLoginCheckAt",
    "screenedOut",
    "screenOutReason",
    "uberDataRequestState",
  ];
  chrome.storage.local.remove(keysToRemove, () => {
    console.log("🗑 Cleared session keys (onInstalled:", details.reason, ")");
    const afterInstallStamp = () => {
      chrome.alarms.clear(LOGIN_CHECK_ALARM);
      try {
        chrome.power.releaseKeepAwake();
      } catch (_) {}
      void ensureRideScheduleRefreshAlarm();
      promptForProlificId();
      setProlificIdRequiredState();
      ensureUberDataRequestAlarm();
      void syncActionFromStorage();
    };
    const loadScheduleThen = (done) => {
      fetchPersistAndApplyRideSchedule()
        .catch((err) => console.error("Ride schedule from study site failed:", err))
        .finally(() => done());
    };
    loadScheduleThen(afterInstallStamp);
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Chrome started");
  void ensureRideScheduleRefreshAlarm();
  void maybeRefreshRideScheduleFromClock();
  void ensureTripScheduleHydratedFromStorage().then(async () => {
    const data = await chrome.storage.local.get(["tripState"]);
    const normalized = normalizeTripState(data.tripState || null);
    if (normalized.changed) {
      await chrome.storage.local.set({ tripState: normalized.state });
    }
    void syncActionFromStorage();
  });
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

void ensureTripScheduleHydratedFromStorage().then(() => {
  void syncActionFromStorage();
});
syncPowerLockWithState();
ensureUberDataRequestAlarm();
void ensureRideScheduleRefreshAlarm();
void maybeRefreshRideScheduleFromClock();
