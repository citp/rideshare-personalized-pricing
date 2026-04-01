const ALARM_NAME = "uber-trip-scheduler";
const LOGIN_CHECK_ALARM = "uber-login-check";
const PROLIFIC_ID_PAGE = "pages/prolific-id.html";
const PROLIFIC_SCREEN_OUT_URL = "https://app.prolific.com/submissions/complete?cc=C12ULBAL";
const TOTAL_SLOTS = TRIPS.length;
const EARLY_WAKE_SEC = 30;
const CAPTURE_TIMEOUT_MS = 120_000;

const SCHEDULE_START_MS = TRIPS[0]?.runAtMs ?? Date.now();
const SCHEDULE_END_MS = TRIPS[TOTAL_SLOTS - 1]?.runAtMs ?? SCHEDULE_START_MS;

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
