/** Canonical schedule: https://rideshare-study.cs.princeton.edu/pricing/extension/ride-searches.html */
const RIDE_SCHEDULE_STORAGE_KEY = "rideScheduleBaseTrips";
const RIDE_SCHEDULE_LAST_FETCHED_AT_KEY = "rideScheduleLastFetchedAt";
const RIDE_SCHEDULE_REFRESH_ALARM = "ride-schedule-refresh";
const RIDE_SCHEDULE_REFRESH_INTERVAL_MINUTES = 24 * 60;

var TRIPS = [];
var TOTAL_SLOTS = 0;
var SCHEDULE_START_MS = Date.now();
var SCHEDULE_END_MS = Date.now();

function applyTripScheduleBase(baseTrips) {
  TRIPS = baseTrips
    .map((trip) => {
      const runAtMs = Date.parse(trip.etTime);
      return {
        ...trip,
        runAtMs,
        scheduledISO: new Date(runAtMs).toISOString(),
      };
    })
    .sort((a, b) => a.runAtMs - b.runAtMs);
  TOTAL_SLOTS = TRIPS.length;
  SCHEDULE_START_MS = TRIPS[0]?.runAtMs ?? Date.now();
  SCHEDULE_END_MS = TOTAL_SLOTS > 0 ? TRIPS[TOTAL_SLOTS - 1].runAtMs : SCHEDULE_START_MS;
}

function validateBaseTripArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("ride schedule: expected non-empty array");
  }
  for (let i = 0; i < arr.length; i++) {
    const t = arr[i];
    if (!t || typeof t !== "object") throw new Error("trip " + i + ": not an object");
    if (typeof t.etTime !== "string" || !Number.isFinite(Date.parse(t.etTime))) {
      throw new Error("trip " + i + ": invalid etTime");
    }
    if (typeof t.label !== "string" || !t.label) throw new Error("trip " + i + ": invalid label");
    ["pickupLat", "pickupLng", "dropoffLat", "dropoffLng"].forEach((k) => {
      if (!Number.isFinite(t[k])) throw new Error("trip " + i + ": invalid " + k);
    });
  }
}

function parseRideSearchesHtml(html) {
  const m = html.match(/<script[^>]*\bid\s*=\s*["']ride-searches-data["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error("ride-searches-data script not found in page");
  const arr = JSON.parse(m[1].trim());
  validateBaseTripArray(arr);
  return arr;
}

async function fetchRideSearchesFromStudySite() {
  const url = studyExtensionPage("ride-searches.html");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("ride-searches HTTP " + res.status);
  const html = await res.text();
  return parseRideSearchesHtml(html);
}

async function fetchPersistAndApplyRideSchedule() {
  const base = await fetchRideSearchesFromStudySite();
  await chrome.storage.local.set({
    [RIDE_SCHEDULE_STORAGE_KEY]: base,
    [RIDE_SCHEDULE_LAST_FETCHED_AT_KEY]: Date.now(),
  });
  applyTripScheduleBase(base);
}

async function hydrateTripScheduleIfStored() {
  try {
    const data = await chrome.storage.local.get([RIDE_SCHEDULE_STORAGE_KEY]);
    const base = data[RIDE_SCHEDULE_STORAGE_KEY];
    if (Array.isArray(base) && base.length > 0) {
      validateBaseTripArray(base);
      applyTripScheduleBase(base);
    }
  } catch (err) {
    console.warn("hydrateTripScheduleIfStored:", err);
  }
}

/** One in-flight hydrate per worker so GET_TRIP_SCHEDULE cannot run before TRIPS is loaded from storage. */
let _ensureTripScheduleHydratedPromise = null;
function ensureTripScheduleHydratedFromStorage() {
  if (!_ensureTripScheduleHydratedPromise) {
    _ensureTripScheduleHydratedPromise = hydrateTripScheduleIfStored();
  }
  return _ensureTripScheduleHydratedPromise;
}

async function ensureRideScheduleRefreshAlarm() {
  await chrome.alarms.clear(RIDE_SCHEDULE_REFRESH_ALARM);
  chrome.alarms.create(RIDE_SCHEDULE_REFRESH_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: RIDE_SCHEDULE_REFRESH_INTERVAL_MINUTES,
  });
}

async function maybeRefreshRideScheduleFromClock(nowMs = Date.now()) {
  const data = await chrome.storage.local.get([RIDE_SCHEDULE_LAST_FETCHED_AT_KEY]);
  const lastFetchedAt = Number(data[RIDE_SCHEDULE_LAST_FETCHED_AT_KEY]);
  const maxAgeMs = RIDE_SCHEDULE_REFRESH_INTERVAL_MINUTES * 60 * 1000;
  const shouldRefresh = !Number.isFinite(lastFetchedAt) || nowMs - lastFetchedAt >= maxAgeMs;
  if (!shouldRefresh) return { ok: true, refreshed: false };
  try {
    await fetchPersistAndApplyRideSchedule();
    return { ok: true, refreshed: true };
  } catch (err) {
    console.warn("Scheduled ride schedule refresh failed:", err);
    return { ok: false, refreshed: false, error: String(err) };
  }
}
