const ALARM_NAME = "uber-trip-scheduler";
const LOGIN_CHECK_ALARM = "uber-login-check";
const PROLIFIC_SCREEN_OUT_URL = "https://app.prolific.com/submissions/complete?cc=C12ULBAL";
const EARLY_WAKE_SEC = 30;
const CAPTURE_TIMEOUT_MS = 120_000;

/** TRIPS, TOTAL_SLOTS, SCHEDULE_START_MS, SCHEDULE_END_MS — set in bg-trip-list.js when schedule loads. */

function getTripTimestamp(tripIndex) {
  return TRIPS[tripIndex].runAtMs;
}

function getNextTripIndex(now) {
  for (let i = 0; i < TRIPS.length; i++) {
    if (getTripTimestamp(i) > now) return i;
  }
  return TRIPS.length;
}

function getCurrentTripIndex(now) {
  let last = -1;
  for (let i = 0; i < TRIPS.length; i++) {
    if (getTripTimestamp(i) <= now) last = i;
  }
  return last;
}

const EXTENSION_INSTALLED_AT_KEY = "extensionInstalledAt";

/** Timing-log rows for scheduled slots at or after extension install (by slot run time). */
function filterTimingLogRowsAfterInstall(rows, installedAtMs) {
  const list = Array.isArray(rows) ? rows : [];
  if (!(installedAtMs > 0)) return list;
  return list.filter((r) => {
    const slot = r?.slot;
    if (!Number.isFinite(slot) || slot < 0 || slot >= TRIPS.length) return false;
    return TRIPS[slot].runAtMs >= installedAtMs;
  });
}
