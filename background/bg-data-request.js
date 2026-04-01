const UBER_DATA_REQUEST_ALARM = "uber-data-request";
const UBER_DATA_REQUEST_URL = "https://myprivacy.uber.com/exploreyourdata/download";
const UBER_DATA_REQUEST_TARGET_ET = "2026-04-03T09:00:00-04:00";
const UBER_DATA_REQUEST_TARGET_MS = Date.parse(UBER_DATA_REQUEST_TARGET_ET);
const UBER_DATA_REQUEST_RETRY_MS = 60 * 60 * 1000;
const UBER_DATA_REQUEST_STATE_KEY = "uberDataRequestState";
const UBER_DATA_REQUEST_CLICK_TIMEOUT_MS = 120000;
const UBER_DATA_REQUEST_TEST_MODE_IMMEDIATE = false;
let uberDataRequestWindowId = null;

function getUberDataRequestEndMs() {
  return Number.isFinite(SCHEDULE_END_MS) ? SCHEDULE_END_MS : UBER_DATA_REQUEST_TARGET_MS;
}

function isWithinUberDataRequestWindow(nowMs = Date.now()) {
  return nowMs <= getUberDataRequestEndMs();
}

async function getUberDataRequestState() {
  const data = await chrome.storage.local.get([UBER_DATA_REQUEST_STATE_KEY]);
  const raw = data[UBER_DATA_REQUEST_STATE_KEY] || {};
  return {
    status: raw.status || "pending",
    attempts: Number.isFinite(raw.attempts) ? raw.attempts : 0,
    lastAttemptAt: Number.isFinite(raw.lastAttemptAt) ? raw.lastAttemptAt : 0,
    lastError: typeof raw.lastError === "string" ? raw.lastError : "",
    successAt: Number.isFinite(raw.successAt) ? raw.successAt : 0,
  };
}

async function setUberDataRequestState(nextState) {
  await chrome.storage.local.set({ [UBER_DATA_REQUEST_STATE_KEY]: nextState });
}

function computeNextUberDataRequestAttemptMs(state, nowMs = Date.now()) {
  if (state.status === "success") return null;
  if (UBER_DATA_REQUEST_TEST_MODE_IMMEDIATE) return nowMs + 1000;
  if (!isWithinUberDataRequestWindow(nowMs)) return null;
  if (nowMs < UBER_DATA_REQUEST_TARGET_MS) return UBER_DATA_REQUEST_TARGET_MS;
  if (state.attempts <= 0) return nowMs + 1000;
  const nextRetry = state.lastAttemptAt + UBER_DATA_REQUEST_RETRY_MS;
  return nextRetry <= getUberDataRequestEndMs() ? Math.max(nowMs + 1000, nextRetry) : null;
}

async function ensureUberDataRequestAlarm() {
  const now = Date.now();
  const state = await getUberDataRequestState();
  const nextAttemptMs = computeNextUberDataRequestAttemptMs(state, now);
  if (!nextAttemptMs) {
    await chrome.alarms.clear(UBER_DATA_REQUEST_ALARM);
    return;
  }
  chrome.alarms.create(UBER_DATA_REQUEST_ALARM, { when: nextAttemptMs });
  console.log(`⏰ Uber data request alarm set for ${new Date(nextAttemptMs).toISOString()}`);
}

async function ensureUberDataRequestWindow() {
  if (typeof uberDataRequestWindowId === "number") {
    try {
      await chrome.windows.get(uberDataRequestWindowId);
      return uberDataRequestWindowId;
    } catch (_) {
      uberDataRequestWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: "about:blank",
    focused: false,
    state: "minimized",
  });
  uberDataRequestWindowId = win?.id ?? null;
  if (typeof uberDataRequestWindowId !== "number") {
    throw new Error("Could not create hidden data request window");
  }
  return uberDataRequestWindowId;
}

async function openUberDataRequestPage() {
  const windowId = await ensureUberDataRequestWindow();
  const tabs = await chrome.tabs.query({ windowId, url: `${UBER_DATA_REQUEST_URL}*` });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url: UBER_DATA_REQUEST_URL, active: false });
    return tabs[0].id;
  }
  const tab = await chrome.tabs.create({ windowId, url: UBER_DATA_REQUEST_URL, active: false });
  return tab?.id ?? null;
}

async function onUberDataRequestAlarm() {
  const now = Date.now();
  if (!UBER_DATA_REQUEST_TEST_MODE_IMMEDIATE && !isWithinUberDataRequestWindow(now)) {
    await chrome.alarms.clear(UBER_DATA_REQUEST_ALARM);
    return;
  }

  const state = await getUberDataRequestState();
  if (state.status === "success") {
    await chrome.alarms.clear(UBER_DATA_REQUEST_ALARM);
    return;
  }

  const attemptAt = Date.now();
  const nextState = {
    ...state,
    status: "attempt_in_progress",
    attempts: state.attempts + 1,
    lastAttemptAt: attemptAt,
    lastError: "",
  };
  await setUberDataRequestState(nextState);

  try {
    await openUberDataRequestPage();
  } catch (err) {
    await setUberDataRequestState({
      ...nextState,
      status: "pending",
      lastError: `open_failed:${String(err)}`,
    });
    await ensureUberDataRequestAlarm();
    return;
  }

  setTimeout(async () => {
    const latest = await getUberDataRequestState();
    if (latest.status === "success") return;
    if (latest.status === "attempt_in_progress" && latest.lastAttemptAt === attemptAt) {
      await setUberDataRequestState({
        ...latest,
        status: "pending",
        lastError: "click_timeout",
      });
      await ensureUberDataRequestAlarm();
    }
  }, UBER_DATA_REQUEST_CLICK_TIMEOUT_MS);
}

async function handleUberDataRequestClickResult(msg) {
  const ok = Boolean(msg?.ok);
  const state = await getUberDataRequestState();
  if (ok) {
    await setUberDataRequestState({
      ...state,
      status: "success",
      successAt: Date.now(),
      lastError: "",
    });
    await chrome.alarms.clear(UBER_DATA_REQUEST_ALARM);
    console.log("✅ Uber data request submitted");
    return;
  }

  await setUberDataRequestState({
    ...state,
    status: "pending",
    lastError: typeof msg?.reason === "string" ? msg.reason : "click_failed",
  });
  await ensureUberDataRequestAlarm();
}
