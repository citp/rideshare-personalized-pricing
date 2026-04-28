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
  await updateBadge(state);
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

let _prolificIdSavedDebounceTimer = null;

function handleProlificIdSaved() {
  void ensureLoginCheckAlarm();
  if (_prolificIdSavedDebounceTimer != null) clearTimeout(_prolificIdSavedDebounceTimer);
  _prolificIdSavedDebounceTimer = setTimeout(() => {
    _prolificIdSavedDebounceTimer = null;
    checkUberLogin();
  }, 2500);
}

async function promptForProlificId() {
  const promptUrl = getProlificIdPromptUrl();
  const tabs = await chrome.tabs.query({ url: `${STUDY_EXTENSION_PAGES_BASE}/install.html*` });
  if (tabs.length > 0) {
    const tab = tabs[0];
    try {
      await chrome.tabs.reload(tab.id);
    } catch (_) {
      /* tab may be in a bad state */
    }
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
  await updateBadge(state);
}

async function clearProlificIdRequiredState() {
  const stored = await chrome.storage.local.get(["tripState"]);
  const state = stored.tripState;
  if (!state || !state.prolificIdRequired) return;
  state.prolificIdRequired = false;
  await chrome.storage.local.set({ tripState: state });
  await updateBadge(state);
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

/** Serialize login checks: overlapping runs stack history + Uber tab work and can freeze Chrome. */
let _checkUberLoginChain = Promise.resolve();

function checkUberLogin() {
  _checkUberLoginChain = _checkUberLoginChain.then(
    () => runCheckUberLogin(),
    () => runCheckUberLogin()
  );
}

async function runCheckUberLogin() {
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
      "activityVerificationCompleted",
      "activityVerificationResult",
      "eligibilityVerified",
      "screenedOut",
    ]);
    const normalized = normalizeTripState(stored.tripState);
    const state = normalized.state;
    if (normalized.changed) {
      await chrome.storage.local.set({ tripState: state });
    }
    let activityVerificationCompleted = !!stored.activityVerificationCompleted;
    let activityVerificationResult = stored.activityVerificationResult || null;
    const eligibilityVerified = !!stored.eligibilityVerified;
    const screenedOut = !!stored.screenedOut;

    if (screenedOut) return;

    let profileVerification;
    if (eligibilityVerified) {
      profileVerification = activityVerificationResult && activityVerificationResult.passed
        ? activityVerificationResult
        : {
            passed: true,
            minActions: 500,
            lookbackDays: 7,
            minActionsPerActiveDay: 100,
            requiredActiveDays: 4,
            activeDays: 4,
            totalLocalActions: 500,
          };
      activityVerificationCompleted = true;
      activityVerificationResult = profileVerification;
    } else if (activityVerificationCompleted && activityVerificationResult) {
      profileVerification = activityVerificationResult;
    } else {
      const installMeta = await chrome.storage.local.get([EXTENSION_INSTALLED_AT_KEY]);
      const installedAt =
        typeof installMeta[EXTENSION_INSTALLED_AT_KEY] === "number" ? installMeta[EXTENSION_INSTALLED_AT_KEY] : 0;
      if (installedAt > 0 && Date.now() - installedAt < 4 * 60_000) {
        await wait(8000);
      }
      try {
        profileVerification = await verifyActiveChromeProfile();
      } catch (err) {
        console.error("Profile verification failed:", err);
        profileVerification = {
          passed: false,
          error: String(err),
          minActions: 500,
          lookbackDays: 7,
          minActionsPerActiveDay: 100,
          requiredActiveDays: 4,
          activeDays: 0,
          totalLocalActions: 0,
        };
      }
      activityVerificationCompleted = true;
      activityVerificationResult = profileVerification;
    }

    if (!profileVerification.passed) {
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

    let tripHistoryVerification = {
      passed: false,
      cutoffDateISO: "2025-03-01",
      minTripsRequired: 5,
      totalTripsSinceCutoff: 0,
      profileSummaries: [],
    };

    if (hasSession && !eligibilityVerified) {
      await wait(1500);
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

      if (!tripHistoryVerification.passed) {
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
    }

    const nextEligibilityVerified =
      eligibilityVerified || (hasSession && profileVerification.passed && tripHistoryVerification.passed);

    await chrome.storage.local.set({
      tripState: state,
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
        await startSearch();
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
        await updateBadge(workingState);
        if (nextSlot >= TOTAL_SLOTS) {
          await markDayComplete(workingState);
        } else {
          await scheduleNextSlot(workingState);
          console.log(`✅ Login detected — next trip at ${TRIPS[nextSlot].scheduledISO}`);
        }
      } else if (workingState.running) {
        await scheduleNextSlot(workingState);
      } else {
        // Verified + logged in, but idle state exists (e.g. setup state).
        // If the day is already over, preserve completed statuses instead of resetting them.
        const now = Date.now();
        const nextSlot = getNextTripIndex(now);
        if (nextSlot >= TOTAL_SLOTS) {
          workingState.running = false;
          workingState.loginRequired = false;
          await chrome.storage.local.set({ tripState: workingState });
          await updateBadge(workingState);
          return;
        }
        // Otherwise start scheduler now.
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
