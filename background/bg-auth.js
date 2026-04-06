function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LAST_LOGIN_CHECK_AT_KEY = "lastLoginCheckAt";
const LOGIN_CHECK_LEAD_MS = 30 * 60 * 1000;
const LOGIN_CHECK_MIN_INTERVAL_MS = 60 * 60 * 1000;

function computeNextLoginCheckWhen(now, lastLoginCheckAt) {
  const minAllowedAt = Number.isFinite(lastLoginCheckAt)
    ? lastLoginCheckAt + LOGIN_CHECK_MIN_INTERVAL_MS
    : -Infinity;
  const startIdx = getNextTripIndex(now);

  for (let i = startIdx; i < TOTAL_SLOTS; i++) {
    const tripTs = getTripTimestamp(i);
    if (!Number.isFinite(tripTs) || tripTs <= now) continue;
    let candidate = tripTs - LOGIN_CHECK_LEAD_MS;
    if (candidate < now) candidate = now + 2000;
    if (candidate < minAllowedAt) continue;
    return candidate;
  }

  return null;
}

function buildScreenOutFailureMessage(reason, profileVerification, tripHistoryVerification) {
  if (reason === "chrome_activity_failed") {
    const activeDays = profileVerification?.activeDays ?? 0;
    const requiredActiveDays = profileVerification?.requiredActiveDays ?? 5;
    const totalLocal = profileVerification?.totalLocalActions ?? 0;
    const minActions = profileVerification?.minActions ?? 600;
    return `Chrome activity check failed (${activeDays}/${requiredActiveDays} active days; ${totalLocal}/${minActions} local actions). Redirecting to Prolific screen-out.`;
  }

  if (reason === "uber_history_failed") {
    const totalTrips = tripHistoryVerification?.totalTripsSinceCutoff ?? 0;
    const minTrips = tripHistoryVerification?.minTripsRequired ?? 5;
    const cutoff = tripHistoryVerification?.cutoffDateISO ?? "2025-03-01";
    return `Uber trips check failed (${totalTrips}/${minTrips} trips since ${cutoff}). Redirecting to Prolific screen-out.`;
  }

  return "Verification check failed. Redirecting to Prolific screen-out.";
}

function showPreScreenOutFailurePopup(reason, profileVerification, tripHistoryVerification) {
  return new Promise((resolve) => {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "Icon.png",
      title: "Verification failed",
      message: buildScreenOutFailureMessage(reason, profileVerification, tripHistoryVerification),
      priority: 2,
    }, () => resolve());
  });
}

async function openScreenOutWarningPage(reason, profileVerification, tripHistoryVerification) {
  const warningUrl = getScreenOutWarningPageUrl();
  await chrome.tabs.create({ url: warningUrl, active: true });

  // Open Prolific in a separate tab so the warning page stays visible
  // even if Prolific auto-closes or navigation fails.
  await wait(3000);
  try {
    await chrome.tabs.create({ url: PROLIFIC_SCREEN_OUT_URL, active: true });
  } catch (err) {
    console.warn("Could not open Prolific screen-out tab:", err);
  }

  // Keep a visible signal in case notifications are enabled.
  await showPreScreenOutFailurePopup(reason, profileVerification, tripHistoryVerification);
}

async function triggerProlificScreenOut(reason, profileVerification, tripHistoryVerification) {
  const existing = await chrome.storage.local.get(["screenedOut"]);
  if (!existing.screenedOut) {
    await openScreenOutWarningPage(reason, profileVerification, tripHistoryVerification);
  }

  const state = buildBlockedState(
    profileVerification || { passed: false },
    tripHistoryVerification || {
      passed: false,
      cutoffDateISO: "2025-03-01",
      minTripsRequired: 5,
      totalTripsSinceCutoff: 0,
      profileSummaries: [],
    }
  );
  state.screenedOut = true;
  state.screenOutReason = reason;
  state.loginRequired = false;
  state.prolificIdRequired = false;

  await chrome.storage.local.set({
    screenedOut: true,
    screenOutReason: reason,
    tripState: state,
  });
  updateBadge(state);

  try {
    chrome.management.uninstallSelf({ showConfirmDialog: false }, () => {
      if (chrome.runtime.lastError) {
        console.error("Self-uninstall failed:", chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.error("Self-uninstall threw:", err);
  }
}

async function ensureProlificIdPresent() {
  const hasProlificId = await hasStoredProlificId();
  if (hasProlificId) return true;
  await promptForProlificId();
  return false;
}

async function hasStoredProlificId() {
  const stored = await chrome.storage.local.get(["prolificId"]);
  const prolificId = typeof stored.prolificId === "string" ? stored.prolificId.trim() : "";
  return !!prolificId;
}

function handleProlificIdSaved() {
  ensureLoginCheckAlarm();
  checkUberLogin(true);
}

async function promptForProlificId() {
  const promptUrl = getProlificIdPromptUrl();
  const tabs = await chrome.tabs.query({ url: `${STUDY_EXTENSION_PAGES_BASE}/prolific-id.html*` });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: promptUrl, active: true });
}

async function setProlificIdRequiredState() {
  const now = Date.now();
  const currentSlot = getCurrentTripIndex(now);
  const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
  for (let i = 0; i <= currentSlot && i < TOTAL_SLOTS; i++) {
    tripStatuses[i] = "skipped";
  }
  const state = {
    running: false,
    dayStart: SCHEDULE_START_MS,
    endTime: SCHEDULE_END_MS + 1000,
    currentSlot,
    totalSlots: TOTAL_SLOTS,
    results: [],
    capturedForCurrent: false,
    tripStatuses,
    loginRequired: false,
    prolificIdRequired: true,
    startTime: now,
  };
  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
}

async function clearProlificIdRequiredState() {
  const stored = await chrome.storage.local.get(["tripState"]);
  const state = stored.tripState;
  if (!state || !state.prolificIdRequired) return;
  state.prolificIdRequired = false;
  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
}

async function ensureLoginCheckAlarm() {
  const now = Date.now();
  const stored = await chrome.storage.local.get([LAST_LOGIN_CHECK_AT_KEY]);
  const lastLoginCheckAt = Number(stored[LAST_LOGIN_CHECK_AT_KEY]);
  const when = computeNextLoginCheckWhen(now, lastLoginCheckAt);
  await chrome.alarms.clear(LOGIN_CHECK_ALARM);
  if (!Number.isFinite(when)) return;
  chrome.alarms.create(LOGIN_CHECK_ALARM, { when });
}

async function checkUberLogin(forceNotify = false) {
  const checkStartedAt = Date.now();
  try {
    const hasProlificId = await ensureProlificIdPresent();
    if (!hasProlificId) {
      await setProlificIdRequiredState();
      return;
    }
    await clearProlificIdRequiredState();

    const stored = await chrome.storage.local.get([
      "tripState",
      "browserVerificationSuccessNotified",
      "uberLoginSuccessNotified",
      "tripHistorySuccessNotified",
      "tripHistoryFailureNotified",
      "activityVerificationCompleted",
      "activityVerificationResult",
      "eligibilityVerified",
      "screenedOut",
    ]);
    const state = stored.tripState;
    let browserVerificationSuccessNotified = !!stored.browserVerificationSuccessNotified;
    let uberLoginSuccessNotified = !!stored.uberLoginSuccessNotified;
    let tripHistorySuccessNotified = !!stored.tripHistorySuccessNotified;
    let tripHistoryFailureNotified = !!stored.tripHistoryFailureNotified;
    let activityVerificationCompleted = !!stored.activityVerificationCompleted;
    let activityVerificationResult = stored.activityVerificationResult || null;
    const eligibilityVerified = !!stored.eligibilityVerified;
    const screenedOut = !!stored.screenedOut;
    let justNotifiedBrowserCheck = false;
    let justNotifiedUberLogin = false;

    if (screenedOut) return;

    let profileVerification;
    if (eligibilityVerified) {
      profileVerification = activityVerificationResult && activityVerificationResult.passed
        ? activityVerificationResult
        : {
            passed: true,
            minActions: 600,
            lookbackDays: 7,
            minActionsPerActiveDay: 120,
            requiredActiveDays: 5,
            activeDays: 5,
            totalLocalActions: 600,
            dailyCounts: [],
          };
      activityVerificationCompleted = true;
      activityVerificationResult = profileVerification;
      browserVerificationSuccessNotified = true;
    } else if (activityVerificationCompleted && activityVerificationResult) {
      profileVerification = activityVerificationResult;
    } else {
      try {
        profileVerification = await verifyActiveChromeProfile();
      } catch (err) {
        console.error("Profile verification failed:", err);
        profileVerification = {
          passed: false,
          error: String(err),
          minActions: 600,
          lookbackDays: 7,
          minActionsPerActiveDay: 120,
          requiredActiveDays: 5,
          activeDays: 0,
          totalLocalActions: 0,
          dailyCounts: [],
        };
      }
      activityVerificationCompleted = true;
      activityVerificationResult = profileVerification;
    }

    if (profileVerification.passed) {
      if (!browserVerificationSuccessNotified) {
        sendBrowserActivitySuccessNotification(profileVerification);
        browserVerificationSuccessNotified = true;
        justNotifiedBrowserCheck = true;
      }
    } else {
      browserVerificationSuccessNotified = false;
      await triggerProlificScreenOut("chrome_activity_failed", profileVerification, null);
      return;
    }

    if (state) {
      state.profileVerification = profileVerification;
      state.profileVerificationFailed = !profileVerification.passed;
    }

    const sid = await chrome.cookies.get({ url: "https://m.uber.com", name: "sid" });
    const hasSession = sid !== null;
    console.log(`🔐 Login check: sid cookie ${hasSession ? "FOUND" : "NOT FOUND"}`);

    if (hasSession) {
      if (forceNotify || !uberLoginSuccessNotified) {
        if (justNotifiedBrowserCheck) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          sendUberLoginSuccessNotification();
        } else {
          sendUberLoginSuccessNotification();
        }
        justNotifiedUberLogin = true;
        uberLoginSuccessNotified = true;
      }
    } else {
      uberLoginSuccessNotified = false;
    }

    let tripHistoryVerification = {
      passed: false,
      cutoffDateISO: "2025-03-01",
      minTripsRequired: 5,
      totalTripsSinceCutoff: 0,
      profileSummaries: [],
    };

    if (hasSession && !eligibilityVerified) {
      try {
        tripHistoryVerification = await verifyUberTripHistory("2025-03-01", 5);
      } catch (err) {
        tripHistoryVerification = {
          passed: false,
          cutoffDateISO: "2025-03-01",
          minTripsRequired: 5,
          totalTripsSinceCutoff: 0,
          profileSummaries: [],
          error: String(err),
        };
      }

      if (tripHistoryVerification.passed) {
        if (forceNotify || !tripHistorySuccessNotified) {
          if (justNotifiedUberLogin) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          sendTripHistorySuccessNotification(tripHistoryVerification);
          tripHistorySuccessNotified = true;
        }
        tripHistoryFailureNotified = false;
      } else {
        tripHistorySuccessNotified = false;
        if (forceNotify || !tripHistoryFailureNotified) {
          if (justNotifiedUberLogin) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
          sendTripHistoryFailureNotification(tripHistoryVerification);
          tripHistoryFailureNotified = true;
        }
        await triggerProlificScreenOut("uber_history_failed", profileVerification, tripHistoryVerification);
        return;
      }
    } else if (hasSession && eligibilityVerified) {
      tripHistoryVerification = state?.tripHistoryVerification?.passed
        ? state.tripHistoryVerification
        : {
            passed: true,
            cutoffDateISO: "2025-03-01",
            minTripsRequired: 5,
            totalTripsSinceCutoff: 5,
            profileSummaries: [],
          };
      tripHistorySuccessNotified = true;
      tripHistoryFailureNotified = false;
    } else {
      tripHistorySuccessNotified = false;
      tripHistoryFailureNotified = false;
    }

    const nextEligibilityVerified =
      eligibilityVerified || (hasSession && profileVerification.passed && tripHistoryVerification.passed);

    await chrome.storage.local.set({
      tripState: state,
      browserVerificationSuccessNotified,
      uberLoginSuccessNotified,
      tripHistorySuccessNotified,
      tripHistoryFailureNotified,
      activityVerificationCompleted,
      activityVerificationResult,
      eligibilityVerified: nextEligibilityVerified,
      [LAST_LOGIN_CHECK_AT_KEY]: checkStartedAt,
    });

    let workingState = state;
    if (!workingState && hasSession && !tripHistoryVerification.passed) {
      workingState = buildBlockedState(profileVerification, tripHistoryVerification);
    }
    if (workingState) {
      workingState.tripHistoryVerification = tripHistoryVerification;
      workingState.tripHistoryVerificationFailed = !tripHistoryVerification.passed;
      workingState.profileVerification = profileVerification;
      workingState.profileVerificationFailed = !profileVerification.passed;
      await chrome.storage.local.set({ tripState: workingState });
    }

    if (!hasSession) {
      await handleNotLoggedIn(workingState);
    } else {
      if (!workingState) {
        if (!tripHistoryVerification.passed) {
          return;
        }
        startSearch();
      } else if (workingState.loginRequired) {
        if (!tripHistoryVerification.passed) {
          return;
        }
        const now = Date.now();
        if (now >= workingState.endTime) {
          markDayComplete(workingState);
          return;
        }
        const nextSlot = getNextTripIndex(now);
        const currentSlot = Number.isInteger(workingState.currentSlot) ? workingState.currentSlot : -1;
        for (let i = Math.max(0, currentSlot + 1); i < nextSlot && i < TOTAL_SLOTS; i++) {
          if (workingState.tripStatuses[i] === "pending") workingState.tripStatuses[i] = "skipped";
        }
        workingState.loginRequired = false;
        workingState.profileVerificationFailed = false;
        workingState.tripHistoryVerificationFailed = false;
        workingState.running = true;
        // Keep this at -1 before the first scheduled slot so slot 0 is fired first.
        workingState.currentSlot = nextSlot - 1;
        workingState.capturedForCurrent = true;
        await chrome.storage.local.set({ tripState: workingState });
        updateBadge(workingState);
        if (nextSlot >= TOTAL_SLOTS) {
          markDayComplete(workingState);
        } else {
          await scheduleNextSlot(workingState);
          console.log(`✅ Login detected — next trip at ${TRIPS[nextSlot].scheduledISO}`);
        }
      } else if (workingState.running) {
        scheduleNextSlot(workingState);
      } else {
        // Verified + logged in, but idle state exists (e.g. setup state). Start scheduler now.
        if (!tripHistoryVerification.passed) {
          return;
        }
        await startSearch();
      }
    }
  } catch (err) {
    console.error("Login check error:", err);
  } finally {
    try {
      await chrome.storage.local.set({ [LAST_LOGIN_CHECK_AT_KEY]: checkStartedAt });
      await ensureLoginCheckAlarm();
    } catch (scheduleErr) {
      console.warn("Could not schedule next login check:", scheduleErr);
    }
  }
}
