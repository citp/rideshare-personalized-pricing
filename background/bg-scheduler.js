function buildBlockedState(profileVerification, tripHistoryVerification) {
  const now = Date.now();
  const currentSlot = getCurrentTripIndex(now);
  const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
  for (let i = 0; i <= currentSlot && i < TOTAL_SLOTS; i++) {
    tripStatuses[i] = "skipped";
  }

  return {
    running: false,
    dayStart: SCHEDULE_START_MS,
    endTime: SCHEDULE_END_MS + 1000,
    currentSlot,
    totalSlots: TOTAL_SLOTS,
    results: [],
    capturedForCurrent: false,
    tripStatuses,
    loginRequired: false,
    startTime: now,
    profileVerification,
    profileVerificationFailed: !profileVerification?.passed,
    tripHistoryVerification,
    tripHistoryVerificationFailed: !tripHistoryVerification?.passed,
    timingMetrics: [],
    searchHealth: null,
  };
}

const SCHEDULER_CONFIG_KEY = "schedulerConfig";
const TIMING_LOG_KEY = "timingLog";
const DEFAULT_EARLY_WAKE_SEC = 180;
const DEFAULT_LATE_FIRE_GRACE_MS = 30000;
const MAX_TIMING_LOG_ROWS = 2000;
const FAILURE_WINDOW_SIZE = 10;
const FAILURE_RATE_THRESHOLD = 0.5;
const AWS_UPLOAD_LAMBDA_URL = "https://sywq97zasl.execute-api.us-east-2.amazonaws.com/upload";
const AWS_UPLOAD_STUDY_TYPE = "pricing";
const AWS_UPLOAD_MAX_ROWS_PER_FILE = 100;
const APPROX_COORD_DECIMALS = 2;
const SCHEDULER_ALARM_PREFIX = `${ALARM_NAME}:slot:`;
const CAPTURE_TIMEOUT_ALARM_PREFIX = `${ALARM_NAME}:capture-timeout:slot:`;
const PREWARM_OFFSETS_MS = [5 * 60 * 1000, 3 * 60 * 1000, 90 * 1000, 30 * 1000];
const STUDY_UBER_TAB_ID_KEY = "studyUberTabId";
const DETAIL_CAPTURE_TIMEOUT_MS = 30000;
/** Install-time snapshot on study site; used only when trip-time Uber geolocation is unavailable. */
const STUDY_GEO_SNAPSHOT_KEY = "studyGeoSnapshot";

/** Serializes get/create so concurrent prewarm alarms cannot each open a new window. */
let _studyUberMutex = Promise.resolve();

function withStudyUberMutex(fn) {
  const run = _studyUberMutex.then(() => fn());
  _studyUberMutex = run.catch(() => {});
  return run;
}

async function persistStudyUberTabId(tabId) {
  await chrome.storage.local.set({ [STUDY_UBER_TAB_ID_KEY]: tabId });
}

/**
 * Returns a single m.uber.com tab for the study: reuse stored id, any existing m.uber tab, or one new minimized window.
 * Safe to call from prewarm and runTrip; concurrent calls are serialized.
 */
async function getOrCreateStudyUberTab() {
  return withStudyUberMutex(async () => {
    const data = await chrome.storage.local.get([STUDY_UBER_TAB_ID_KEY]);
    const storedId = data[STUDY_UBER_TAB_ID_KEY];
    if (typeof storedId === "number") {
      try {
        const tab = await chrome.tabs.get(storedId);
        if (tab?.id != null && !tab.discarded) {
          return { tabId: tab.id };
        }
      } catch (_) {}
    }
    const existing = await chrome.tabs.query({ url: "https://m.uber.com/*" });
    const usable = existing.find((t) => t.id != null && !t.discarded) || existing.find((t) => t.id != null);
    if (usable?.id != null) {
      await persistStudyUberTabId(usable.id);
      return { tabId: usable.id };
    }
    const win = await chrome.windows.create({
      url: "https://m.uber.com/",
      focused: false,
      state: "minimized",
    });
    const tabId = win.tabs?.[0]?.id;
    if (tabId == null) {
      throw new Error("study_uber_window_missing_tab");
    }
    await persistStudyUberTabId(tabId);
    return { tabId };
  });
}

function sanitizeSchedulerConfig(raw) {
  const earlyWakeSecNum = Number(raw?.earlyWakeSec);
  const lateFireGraceMsNum = Number(raw?.lateFireGraceMs);
  const earlyWakeSec = Number.isFinite(earlyWakeSecNum) ? Math.min(600, Math.max(5, Math.floor(earlyWakeSecNum))) : DEFAULT_EARLY_WAKE_SEC;
  const lateFireGraceMs = Number.isFinite(lateFireGraceMsNum) ? Math.min(300000, Math.max(1000, Math.floor(lateFireGraceMsNum))) : DEFAULT_LATE_FIRE_GRACE_MS;
  return { earlyWakeSec, lateFireGraceMs };
}

async function getSchedulerConfig() {
  const data = await chrome.storage.local.get([SCHEDULER_CONFIG_KEY]);
  return sanitizeSchedulerConfig(data[SCHEDULER_CONFIG_KEY]);
}

async function getStoredProlificId() {
  const stored = await chrome.storage.local.get(["prolificId"]);
  return typeof stored.prolificId === "string" ? stored.prolificId.trim() : "";
}

function buildSchedulerAlarmName(slot, phase, offsetMs) {
  return `${SCHEDULER_ALARM_PREFIX}${slot}:phase:${phase}:offset:${offsetMs}`;
}

function parseSchedulerAlarmName(name) {
  if (name === ALARM_NAME) return { slot: null, phase: "exact", offsetMs: 0 };
  const match = /^uber-trip-scheduler:slot:(\d+):phase:(prewarm|exact):offset:(\d+)$/.exec(name || "");
  if (!match) return null;
  return {
    slot: Number(match[1]),
    phase: match[2],
    offsetMs: Number(match[3]),
  };
}

function buildCaptureTimeoutAlarmName(slot) {
  return `${CAPTURE_TIMEOUT_ALARM_PREFIX}${slot}`;
}

function parseCaptureTimeoutAlarmName(name) {
  const match = /^uber-trip-scheduler:capture-timeout:slot:(\d+)$/.exec(name || "");
  if (!match) return null;
  return Number(match[1]);
}

async function clearCaptureTimeoutAlarm(slot) {
  await chrome.alarms.clear(buildCaptureTimeoutAlarmName(slot));
}

async function ensureUberTabWarmup(nextSlot) {
  try {
    const { tabId } = await getOrCreateStudyUberTab();
    await chrome.tabs.update(tabId, { active: false });
    console.log(`🔥 Prewarm: Uber tab ready for slot ${nextSlot}`);
  } catch (err) {
    console.warn("Prewarm failed:", err);
  }
}

async function scheduleSlotAlarms(slot, cfg) {
  const targetTime = getTripTimestamp(slot);
  const now = Date.now();
  const warmOffsets = Array.from(new Set([...PREWARM_OFFSETS_MS, cfg.earlyWakeSec * 1000]));
  for (const offsetMs of warmOffsets) {
    const when = targetTime - offsetMs;
    if (when <= now + 250) continue;
    const name = buildSchedulerAlarmName(slot, "prewarm", offsetMs);
    chrome.alarms.create(name, { when });
  }
  chrome.alarms.create(buildSchedulerAlarmName(slot, "exact", 0), { when: targetTime });
  console.log(`⏰ Slot ${slot} alarms scheduled for ${TRIPS[slot].scheduledISO}`);
}

async function appendTimingLog(entry) {
  const data = await chrome.storage.local.get([TIMING_LOG_KEY]);
  const current = Array.isArray(data[TIMING_LOG_KEY]) ? data[TIMING_LOG_KEY] : [];
  current.push(entry);
  const trimmed = current.length > MAX_TIMING_LOG_ROWS ? current.slice(current.length - MAX_TIMING_LOG_ROWS) : current;
  await chrome.storage.local.set({ [TIMING_LOG_KEY]: trimmed });
}

function upsertSlotMetric(state, slot, patch) {
  if (!Array.isArray(state.timingMetrics)) state.timingMetrics = [];
  const idx = state.timingMetrics.findIndex((m) => m.slot === slot);
  const base = idx >= 0 ? state.timingMetrics[idx] : { slot };
  const merged = { ...base, ...patch, slot };
  if (idx >= 0) {
    state.timingMetrics[idx] = merged;
  } else {
    state.timingMetrics.push(merged);
  }
  return merged;
}

function isCompletedOutcome(outcome) {
  return outcome === "success" || outcome === "no_data" || outcome === "no_prices" || outcome === "missed_late";
}

function isFailedOutcome(outcome) {
  return outcome === "no_data" || outcome === "no_prices" || outcome === "missed_late";
}

function buildSearchHealth(rows) {
  const allCompleted = rows.filter((r) => isCompletedOutcome(r?.outcome));
  const n = allCompleted.length;
  if (n === 0) {
    return {
      sampleSize: 0,
      successCount: 0,
      failedCount: 0,
      failureRate: 0,
      threshold: FAILURE_RATE_THRESHOLD,
      isFailing: false,
    };
  }
  const windowRows = n < FAILURE_WINDOW_SIZE ? allCompleted : allCompleted.slice(-FAILURE_WINDOW_SIZE);
  const sampleSize = windowRows.length;
  const failedCount = windowRows.filter((r) => isFailedOutcome(r?.outcome)).length;
  const successCount = sampleSize - failedCount;
  const failureRate = failedCount / sampleSize;
  const successRate = successCount / sampleSize;
  return {
    sampleSize,
    successCount,
    failedCount,
    failureRate,
    threshold: FAILURE_RATE_THRESHOLD,
    isFailing: successRate < 0.5,
  };
}

function buildAwsUploadBatches(rows, maxRowsPerBatch = AWS_UPLOAD_MAX_ROWS_PER_FILE) {
  if (!Array.isArray(rows) || rows.length === 0) return [[]];
  const batches = [];
  for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
    batches.push(rows.slice(i, i + maxRowsPerBatch));
  }
  return batches;
}

/** Lowercase alphanumeric only — words run together, no separators inside a place name. */
function slugifyRideLocationSegment(segment) {
  if (typeof segment !== "string") return "unknown";
  const s = segment.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return s.slice(0, 80) || "unknown";
}

function parseTripLabelForUploadFilename(label) {
  if (typeof label !== "string" || !label.trim()) {
    return { start: "unknown", end: "unknown" };
  }
  const parts = label.split(/\s*→\s*/);
  if (parts.length >= 2) {
    return {
      start: slugifyRideLocationSegment(parts[0]),
      end: slugifyRideLocationSegment(parts.slice(1).join(" ")),
    };
  }
  const fallback = label.split(/\s*->\s*/);
  if (fallback.length >= 2) {
    return {
      start: slugifyRideLocationSegment(fallback[0]),
      end: slugifyRideLocationSegment(fallback.slice(1).join(" ")),
    };
  }
  return { start: slugifyRideLocationSegment(label), end: "unknown" };
}

/** Local wall-clock yymmdd_hhmmss for upload filenames (not UTC). */
function formatUploadFilenameTimestamp(d = new Date()) {
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yy}${mm}${dd}_${hh}${mi}${ss}`;
}

function buildRideSearchUploadFileName({ trip, batchIndex, batchCount }) {
  const { start, end } = parseTripLabelForUploadFilename(trip?.label);
  const ts = formatUploadFilenameTimestamp();
  const randomSeed = Math.random().toString(36).slice(2, 8);
  return `ride_search_${start}_${end}_part_${batchIndex}_of_${batchCount}_${ts}_${randomSeed}.json`;
}

/** Rounded lat/lng for privacy; stored and uploaded as strings with fixed decimal places (default 2). */
function toApproxCoordinate(value, decimals = APPROX_COORD_DECIMALS) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const precision = Math.pow(10, decimals);
  const rounded = Math.round(num * precision) / precision;
  return rounded.toFixed(decimals);
}

async function saveStudyGeoSnapshotFromInstall({ latitude, longitude }) {
  const existing = await chrome.storage.local.get([STUDY_GEO_SNAPSHOT_KEY]);
  const prev = existing[STUDY_GEO_SNAPSHOT_KEY];
  if (prev?.approxUserLat && prev?.approxUserLng) {
    return { ok: true, skipped: true };
  }
  const lat = toApproxCoordinate(latitude);
  const lng = toApproxCoordinate(longitude);
  if (!lat || !lng) {
    return { ok: false, reason: "invalid_coords" };
  }
  await chrome.storage.local.set({
    [STUDY_GEO_SNAPSHOT_KEY]: {
      approxUserLat: lat,
      approxUserLng: lng,
      capturedAt: new Date().toISOString(),
    },
  });
  return { ok: true };
}

async function tryGetLocationFromUberTab() {
  try {
    const storage = await chrome.storage.local.get([STUDY_UBER_TAB_ID_KEY]);
    let uberTabId = typeof storage[STUDY_UBER_TAB_ID_KEY] === "number" ? storage[STUDY_UBER_TAB_ID_KEY] : null;
    if (uberTabId != null) {
      try {
        await chrome.tabs.get(uberTabId);
      } catch (_) {
        uberTabId = null;
      }
    }
    if (uberTabId == null) {
      const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
      uberTabId = tabs[0]?.id ?? null;
    }
    if (uberTabId == null) return null;

    const response = await chrome.tabs.sendMessage(uberTabId, { type: "GET_BROWSER_LOCATION" });
    if (!response?.ok) return null;
    const lat = toApproxCoordinate(response.latitude);
    const lng = toApproxCoordinate(response.longitude);
    if (!lat || !lng) return null;
    return {
      approxUserLat: lat,
      approxUserLng: lng,
      locationSource: "browser_geolocation",
    };
  } catch (_) {
    return null;
  }
}

function locationFromStudyInstallSnapshot(snap) {
  if (snap?.approxUserLat == null || snap?.approxUserLng == null) return null;
  const alat = toApproxCoordinate(snap.approxUserLat);
  const alng = toApproxCoordinate(snap.approxUserLng);
  if (!alat || !alng) return null;
  return {
    approxUserLat: alat,
    approxUserLng: alng,
    locationSource: "study_install_snapshot",
  };
}

/** Trip-time location from Uber tab when possible; else install snapshot; else unavailable. */
async function getApproxBrowserLocationForCapture() {
  try {
    const live = await tryGetLocationFromUberTab();
    if (live) return live;

    const snapData = await chrome.storage.local.get([STUDY_GEO_SNAPSHOT_KEY]);
    const fallback = locationFromStudyInstallSnapshot(snapData[STUDY_GEO_SNAPSHOT_KEY]);
    if (fallback) return fallback;

    return { approxUserLat: "", approxUserLng: "", locationSource: "unavailable" };
  } catch (_) {
    return { approxUserLat: "", approxUserLng: "", locationSource: "unavailable" };
  }
}

async function tryCaptureVisibleProductsFromDom() {
  try {
    const storage = await chrome.storage.local.get([STUDY_UBER_TAB_ID_KEY]);
    const tabId = storage[STUDY_UBER_TAB_ID_KEY];
    if (typeof tabId !== "number") return { ok: false, rows: [], reason: "missing_tab_id" };
    const response = await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_VISIBLE_PRODUCTS" });
    if (!response?.ok || !Array.isArray(response.rows)) {
      return { ok: false, rows: [], reason: response?.reason || "capture_failed" };
    }
    return { ok: true, rows: response.rows };
  } catch (err) {
    return { ok: false, rows: [], reason: String(err) };
  }
}

function buildDomFallbackCapturedRow({ prolificId, slot, trip, locationSnapshot, domRow }) {
  return {
    prolificId,
    slot,
    scheduledISO: trip.scheduledISO,
    scheduledET: trip.etTime,
    tripLabel: trip.label,
    searchTime: new Date().toISOString(),
    tier: "",
    productName: domRow.productName ?? "",
    productType: "",
    estimatedTripTime: "",
    etaStringShort: domRow.etaStringShort ?? "",
    fare: domRow.fare ?? "",
    preAdjustmentValue: "",
    discountPrimary: "",
    discountedFare: "",
    hasBenefitsOnFare: "",
    hasPromo: "",
    hasRidePass: "",
    fareEstimateInfo: "",
    ezpzFareBreakdown: "",
    multiplier: "",
    surgeSuppressionThreshold: "",
    approxUserLat: locationSnapshot.approxUserLat,
    approxUserLng: locationSnapshot.approxUserLng,
    approxUserLocationSource: `${locationSnapshot.locationSource || "unavailable"}_dom_fallback`,
    originLat: "",
    originLng: "",
    destinationLat: "",
    destinationLng: "",
    capacity: "",
    issuedAt: "",
    isSobriety: "",
    baseFare: "",
    minimumFare: "",
    perMinute: "",
    perMile: "",
    estimatedSurcharges: "",
    bookingFee: "",
    waitTimeDetail: "",
    breakdownCaptureStatus: "not_attempted",
    breakdownCaptureError: "graphQL_products_payload_missing",
  };
}

async function tryPromoteSearchingSlotToSuccessFromDom({ state, slot, trip, prolificId }) {
  const domFallback = await tryCaptureVisibleProductsFromDom();
  if (!domFallback.ok || domFallback.rows.length === 0) {
    return { ok: false, reason: domFallback.reason || "no_dom_rows" };
  }
  const locationSnapshot = await getApproxBrowserLocationForCapture();
  const slotRowsForUpload = domFallback.rows.map((r) =>
    buildDomFallbackCapturedRow({
      prolificId,
      slot,
      trip,
      locationSnapshot,
      domRow: r,
    })
  );
  state.results.push(...slotRowsForUpload);
  state.capturedForCurrent = true;
  state.tripStatuses[slot] = "success";
  await clearCaptureTimeoutAlarm(slot);
  const awsResult = await uploadSearchRowsToAws({
    slot,
    trip,
    outcome: "success",
    rows: slotRowsForUpload,
    searchContext: getSlotSearchContext(state, slot, trip),
  });
  if (!awsResult.ok) {
    console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
  } else {
    console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
  }
  const metric = upsertSlotMetric(state, slot, {
    captureEndedAt: Date.now(),
    outcome: "success",
    capturedRows: slotRowsForUpload.length,
  });
  await appendTimingLog({
    ...metric,
    timestamp: new Date().toISOString(),
    tripLabel: trip.label,
    scheduledISO: trip.scheduledISO,
    prolificId,
  });
  await updateSearchHealthAndMaybeNotify(state);
  await chrome.storage.local.set({ tripState: state });
  await updateBadge(state);
  return { ok: true, rows: slotRowsForUpload.length };
}

function getSlotSearchContext(state, slot, trip) {
  const slotKey = String(slot);
  const slotContext = state?.searchContextBySlot?.[slotKey] || {};
  const defaultRideParams = {
    pickupLat: trip?.pickupLat ?? "",
    pickupLng: trip?.pickupLng ?? "",
    dropoffLat: trip?.dropoffLat ?? "",
    dropoffLng: trip?.dropoffLng ?? "",
    tripLabel: trip?.label ?? "",
    scheduledISO: trip?.scheduledISO ?? "",
    scheduledET: trip?.etTime ?? "",
  };
  return {
    ...slotContext,
    rideSearchParameters: slotContext.rideSearchParameters || defaultRideParams,
  };
}

async function uploadSearchRowsToAws({ slot, trip, outcome, rows, searchContext = null }) {
  try {
    const pid = await getStoredProlificId();
    if (!pid) {
      console.warn("AWS upload skipped: prolificId missing");
      return { ok: false, reason: "missing_prolific_id" };
    }

    const batches = buildAwsUploadBatches(rows);
    let uploadedFiles = 0;
    for (let index = 0; index < batches.length; index++) {
      const batchRows = batches[index];
      const fileName = buildRideSearchUploadFileName({
        trip,
        batchIndex: index + 1,
        batchCount: batches.length,
      });

      const signedRes = await fetch(AWS_UPLOAD_LAMBDA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pid,
          fileName,
          studyType: AWS_UPLOAD_STUDY_TYPE,
        }),
      });
      if (!signedRes.ok) {
        const errorText = await signedRes.text();
        throw new Error(`signed_url_failed: ${signedRes.status} ${errorText}`);
      }

      const signedJson = await signedRes.json();
      const uploadUrl = signedJson?.uploadUrl;
      if (!uploadUrl) {
        throw new Error("signed_url_missing_upload_url");
      }

      const payload = {
        capturedAt: new Date().toISOString(),
        prolificId: pid,
        slot,
        scheduledISO: trip?.scheduledISO || "",
        scheduledET: trip?.etTime || "",
        tripLabel: trip?.label || "",
        searchContext: searchContext || null,
        outcome,
        batchIndex: index + 1,
        batchCount: batches.length,
        rows: batchRows,
      };

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!uploadRes.ok) {
        throw new Error(`upload_failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }

      uploadedFiles += 1;
    }

    return { ok: true, uploadedFiles };
  } catch (err) {
    console.error("AWS upload error:", err);
    return { ok: false, reason: String(err) };
  }
}

async function updateSearchHealthAndMaybeNotify(state) {
  const data = await chrome.storage.local.get([TIMING_LOG_KEY, EXTENSION_INSTALLED_AT_KEY]);
  const rows = Array.isArray(data[TIMING_LOG_KEY]) ? data[TIMING_LOG_KEY] : [];
  const rawInstalled = data[EXTENSION_INSTALLED_AT_KEY];
  const installedAtMs = typeof rawInstalled === "number" && Number.isFinite(rawInstalled) ? rawInstalled : 0;
  const filteredRows = filterTimingLogRowsAfterInstall(rows, installedAtMs);
  const health = buildSearchHealth(filteredRows);
  state.searchHealth = health;
  await chrome.storage.local.set({ tripState: state });
}

function requestSearchKeepAwake() {
  try {
    if (chrome.power && chrome.power.requestKeepAwake) {
      chrome.power.requestKeepAwake("system");
      console.log("🔋 Power lock enabled (system)");
    }
  } catch (err) {
    console.warn("Failed to request keep-awake:", err);
  }
}

function releaseSearchKeepAwake() {
  try {
    if (chrome.power && chrome.power.releaseKeepAwake) {
      chrome.power.releaseKeepAwake();
      console.log("🔋 Power lock released");
    }
  } catch (err) {
    console.warn("Failed to release keep-awake:", err);
  }
}

async function handleNotLoggedIn(state) {
  if (!state) {
    state = (await chrome.storage.local.get(["tripState"])).tripState;
  }

  if (!state) {
    const now = Date.now();
    const currentSlot = getCurrentTripIndex(now);
    const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
    for (let i = 0; i <= currentSlot && i < TOTAL_SLOTS; i++) tripStatuses[i] = "skipped";

    state = {
      running: false,
      dayStart: SCHEDULE_START_MS,
      endTime: SCHEDULE_END_MS + 1000,
      currentSlot,
      totalSlots: TOTAL_SLOTS,
      results: [],
      capturedForCurrent: false,
      tripStatuses,
      loginRequired: true,
      startTime: now,
    };
    await chrome.storage.local.set({ tripState: state });
    await updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (state.running) {
    state.running = false;
    state.loginRequired = true;
    chrome.alarms.clear(ALARM_NAME);
    releaseSearchKeepAwake();
    await chrome.storage.local.set({ tripState: state });
    await updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (!state.loginRequired) {
    state.loginRequired = true;
    await chrome.storage.local.set({ tripState: state });
    await updateBadge(state);
    sendLoginNotification();
  }
}

async function startSearch() {
  const now = Date.now();
  const endTime = SCHEDULE_END_MS + 1000;
  const nextSlot = getNextTripIndex(now);
  console.log(`▶ Starting schedule: next trip is #${nextSlot} (${nextSlot < TOTAL_SLOTS ? TRIPS[nextSlot].scheduledISO : "none"}), ends at ${new Date(endTime).toISOString()}`);
  const existing = await chrome.storage.local.get(["tripState"]);
  const previousState = existing.tripState || null;

  const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
  for (let i = 0; i < nextSlot; i++) tripStatuses[i] = "skipped";

  const state = {
    running: true,
    dayStart: SCHEDULE_START_MS,
    endTime,
    // Keep this at -1 before the first scheduled slot so slot 0 is fired first.
    currentSlot: nextSlot - 1,
    totalSlots: TOTAL_SLOTS,
    results: [],
    capturedForCurrent: true,
    tripStatuses,
    loginRequired: false,
    profileVerification: previousState?.profileVerification || null,
    tripHistoryVerification: previousState?.tripHistoryVerification || null,
    profileVerificationFailed: previousState?.profileVerification ? !previousState.profileVerification.passed : false,
    tripHistoryVerificationFailed: previousState?.tripHistoryVerification ? !previousState.tripHistoryVerification.passed : false,
    startTime: now,
    timingMetrics: [],
    searchHealth: null,
  };

  await chrome.storage.local.set({ tripState: state });
  requestSearchKeepAwake();
  await updateBadge(state);

  if (nextSlot >= TOTAL_SLOTS) {
    await markDayComplete(state);
  } else {
    const cfg = await getSchedulerConfig();
    await scheduleSlotAlarms(nextSlot, cfg);
    console.log(`⏰ First trip: ${TRIPS[nextSlot].scheduledISO} — exact at ${new Date(getTripTimestamp(nextSlot)).toISOString()}`);
  }
}

async function scheduleNextSlot(state) {
  const nextSlot = state.currentSlot + 1;
  if (nextSlot >= TOTAL_SLOTS) {
    chrome.alarms.create(ALARM_NAME, { when: state.endTime + 1000 });
    console.log(`⏰ Final alarm at ${new Date(state.endTime + 1000).toISOString()}`);
    return;
  }
  const cfg = await getSchedulerConfig();
  await scheduleSlotAlarms(nextSlot, cfg);
  console.log(`⏰ Next: ${TRIPS[nextSlot].scheduledISO} — exact at ${new Date(getTripTimestamp(nextSlot)).toISOString()}`);
}

let _pendingSlot = -1;
const _captureSlotsInProgress = new Set();

async function onSlotAlarm(alarmName = ALARM_NAME) {
  try {
    const timeoutSlot = parseCaptureTimeoutAlarmName(alarmName);
    if (Number.isInteger(timeoutSlot)) {
      const stored = await chrome.storage.local.get(["tripState"]);
      const s = stored.tripState;
      if (!s || !s.running) return;
      if (s.currentSlot !== timeoutSlot) return;
      if (s.capturedForCurrent || s.tripStatuses[timeoutSlot] !== "searching") return;
      const trip = TRIPS[timeoutSlot];
      const prolificId = await getStoredProlificId();
      const domRescue = await tryPromoteSearchingSlotToSuccessFromDom({
        state: s,
        slot: timeoutSlot,
        trip,
        prolificId,
      });
      if (domRescue.ok) return;

      console.warn(`⏰ Capture timeout for trip #${timeoutSlot} (${trip.scheduledISO}) — marking no_data`);
      s.tripStatuses[timeoutSlot] = "no_data";
      await clearCaptureTimeoutAlarm(timeoutSlot);
      const awsResult = await uploadSearchRowsToAws({
        slot: timeoutSlot,
        trip,
        outcome: "no_data",
        rows: [],
        searchContext: getSlotSearchContext(s, timeoutSlot, trip),
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${timeoutSlot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${timeoutSlot}: ${awsResult.uploadedFiles} file(s)`);
      }
      const metric = upsertSlotMetric(s, timeoutSlot, {
        captureEndedAt: Date.now(),
        outcome: "no_data",
      });
      await appendTimingLog({
        ...metric,
        timestamp: new Date().toISOString(),
        tripLabel: trip.label,
        scheduledISO: trip.scheduledISO,
        prolificId,
      });
      await updateSearchHealthAndMaybeNotify(s);
      await chrome.storage.local.set({ tripState: s });
      await updateBadge(s);
      return;
    }

    const alarmInfo = parseSchedulerAlarmName(alarmName);
    const phase = alarmInfo?.phase || "exact";
    const alarmSlot = Number.isInteger(alarmInfo?.slot) ? alarmInfo.slot : null;
    const alarmFiredAt = Date.now();
    const cfg = await getSchedulerConfig();
    const data = await chrome.storage.local.get(["tripState"]);
    const state = data.tripState;
    if (!state || !state.running) return;

    if (!state.capturedForCurrent && state.tripStatuses[state.currentSlot] === "searching") {
      const activeMetric = Array.isArray(state.timingMetrics)
        ? state.timingMetrics.find((m) => m?.slot === state.currentSlot)
        : null;
      const captureStartedAt = Number(activeMetric?.captureStartedAt);
      const searchAgeMs = Number.isFinite(captureStartedAt) ? Date.now() - captureStartedAt : Infinity;
      if (searchAgeMs < CAPTURE_TIMEOUT_MS) {
        // The active slot is still within capture window; do not prematurely mark no_data.
        return;
      }
      const prolificId = await getStoredProlificId();
      const currentTrip = TRIPS[state.currentSlot];
      const domRescue = await tryPromoteSearchingSlotToSuccessFromDom({
        state,
        slot: state.currentSlot,
        trip: currentTrip,
        prolificId,
      });
      if (!domRescue.ok) {
        state.tripStatuses[state.currentSlot] = "no_data";
        const awsResult = await uploadSearchRowsToAws({
          slot: state.currentSlot,
          trip: currentTrip,
          outcome: "no_data",
          rows: [],
          searchContext: getSlotSearchContext(state, state.currentSlot, currentTrip),
        });
        if (!awsResult.ok) {
          console.warn(`⚠ AWS upload failed for slot ${state.currentSlot}: ${awsResult.reason || "unknown_error"}`);
        } else {
          console.log(`☁️ AWS upload complete for slot ${state.currentSlot}: ${awsResult.uploadedFiles} file(s)`);
        }
      }
      try {
        const storage = await chrome.storage.local.get([STUDY_UBER_TAB_ID_KEY]);
        let tab = null;
        const sid = storage[STUDY_UBER_TAB_ID_KEY];
        if (typeof sid === "number") {
          try {
            tab = await chrome.tabs.get(sid);
          } catch (_) {}
        }
        if (!tab?.url?.includes("m.uber.com")) {
          const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
          tab = tabs[0] || null;
        }
        if (tab?.url && !tab.url.includes("product-selection")) {
          console.warn("⚠ Tab redirected — login required");
          await handleNotLoggedIn(state);
          return;
        }
      } catch (_) {}
      if (!domRescue.ok) {
        // Must persist before the fresh read below; otherwise storage still has "searching"
        // and the next block overwrites this fix (orphan ⏳ row + wrong popup highlight).
        await chrome.storage.local.set({ tripState: state });
      }
    }

    if (Date.now() >= state.endTime) {
      await markDayComplete(state);
      return;
    }

    const nextSlot = state.currentSlot + 1;
    if (nextSlot >= TOTAL_SLOTS) {
      await markDayComplete(state);
      return;
    }

    if (alarmSlot !== null && alarmSlot !== nextSlot) return;

    const targetTime = getTripTimestamp(nextSlot);
    if (phase === "prewarm") {
      if (Date.now() < targetTime + cfg.lateFireGraceMs) {
        await ensureUberTabWarmup(nextSlot);
      }
      return;
    }

    if (_pendingSlot === nextSlot) return;
    _pendingSlot = nextSlot;
    try {
      const firedAt = Date.now();
      const driftMs = firedAt - targetTime;
      const fresh = await chrome.storage.local.get(["tripState"]);
      const s = fresh.tripState;
      if (!s || !s.running) return;
      if (s.currentSlot >= nextSlot) return;

      if (driftMs > cfg.lateFireGraceMs) {
        const prolificId = await getStoredProlificId();
        s.currentSlot = nextSlot;
        s.capturedForCurrent = true;
        s.tripStatuses[nextSlot] = "missed_late";
        const metric = upsertSlotMetric(s, nextSlot, {
          targetTime,
          alarmFiredAt,
          tripTriggeredAt: firedAt,
          driftMs,
          outcome: "missed_late",
          thresholdMs: cfg.lateFireGraceMs,
        });
        await appendTimingLog({
          ...metric,
          timestamp: new Date().toISOString(),
          tripLabel: TRIPS[nextSlot].label,
          scheduledISO: TRIPS[nextSlot].scheduledISO,
          prolificId,
        });
        await updateSearchHealthAndMaybeNotify(s);
        await updateBadge(s);
        await scheduleNextSlot(s);
        console.warn(`⚠ Skipped slot ${nextSlot} as late by ${driftMs}ms (threshold ${cfg.lateFireGraceMs}ms)`);
        return;
      }

      console.log(`🎯 Firing trip #${nextSlot} (${TRIPS[nextSlot].scheduledISO}) at ${new Date().toISOString()}`);
      s.currentSlot = nextSlot;
      s.capturedForCurrent = false;
      upsertSlotMetric(s, nextSlot, {
        targetTime,
        alarmFiredAt,
        tripTriggeredAt: firedAt,
        driftMs,
        outcome: "triggered",
        thresholdMs: cfg.lateFireGraceMs,
      });
      await chrome.storage.local.set({ tripState: s });
      await updateBadge(s);
      runTrip(s);
      await scheduleNextSlot(s);
    } finally {
      _pendingSlot = -1;
    }
  } catch (err) {
    console.error("onSlotAlarm error:", err);
  }
}

/**
 * When the scheduler advanced currentSlot but a prior slot stayed "searching" in storage
 * (e.g. cleanup was not persisted before the next alarm saved), normalize for UI and counts.
 */
async function repairOrphanSearchingTripStatuses(state) {
  if (!state?.running || !Number.isInteger(state.currentSlot)) return;
  const cur = state.currentSlot;
  const statuses = state.tripStatuses;
  if (!Array.isArray(statuses)) return;
  let changed = false;
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] === "searching" && i !== cur) {
      statuses[i] = "no_data";
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ tripState: state });
  }
}

/**
 * Heal stale terminal states from previous study windows so users are not stuck in
 * "not logged in" after the schedule has already ended.
 */
function normalizeTripState(state, now = Date.now()) {
  if (!state || typeof state !== "object") return { state, changed: false };
  let changed = false;
  const endTime = Number(state.endTime);
  const isExpired = Number.isFinite(endTime) && now >= endTime;
  if (!isExpired) return { state, changed };

  if (state.running) {
    state.running = false;
    changed = true;
  }
  if (state.loginRequired) {
    state.loginRequired = false;
    changed = true;
  }
  if (Array.isArray(state.tripStatuses)) {
    for (let i = 0; i < state.tripStatuses.length; i++) {
      const status = state.tripStatuses[i];
      if (status === "pending" || status === "searching") {
        state.tripStatuses[i] = "skipped";
        changed = true;
      }
    }
  }

  return { state, changed };
}

async function markDayComplete(state) {
  state.running = false;
  state.loginRequired = false;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (state.tripStatuses[i] === "pending" || state.tripStatuses[i] === "searching") {
      state.tripStatuses[i] = "skipped";
    }
  }
  await chrome.storage.local.set({ tripState: state });
  if (Number.isInteger(state.currentSlot)) {
    await clearCaptureTimeoutAlarm(state.currentSlot);
  }
  await updateBadge(state);
  chrome.alarms.clear(ALARM_NAME);
  releaseSearchKeepAwake();
  const successCount = state.tripStatuses.filter((s) => s === "success").length;
  const errorCount = state.tripStatuses.filter((s) => s === "no_data" || s === "no_prices").length;
  const skippedCount = state.tripStatuses.filter((s) => s === "skipped").length;
  const missedLateCount = state.tripStatuses.filter((s) => s === "missed_late").length;
  console.log(
    `✅ Day complete: ${successCount} succeeded, ${errorCount} errors, ${missedLateCount} missed late, ${skippedCount} skipped, ${state.results.length} result rows`
  );
}

async function runTrip(state) {
  const slot = state.currentSlot;
  const trip = TRIPS[slot];
  console.log(`🚗 Trip #${slot} (${trip.scheduledISO}): ${trip.label}`);

  state.tripStatuses[slot] = "searching";
  upsertSlotMetric(state, slot, {
    captureStartedAt: Date.now(),
    outcome: "searching",
  });
  await chrome.storage.local.set({ tripState: state });

  const pickupObj = { latitude: trip.pickupLat, longitude: trip.pickupLng, addressLine1: "Pickup" };
  const dropoffObj = { latitude: trip.dropoffLat, longitude: trip.dropoffLng, addressLine1: "Dropoff" };

  const url =
    "https://m.uber.com/go/product-selection?action=setPickup" +
    `&pickup=${encodeURIComponent(JSON.stringify(pickupObj))}` +
    `&drop%5B0%5D=${encodeURIComponent(JSON.stringify(dropoffObj))}`;

  try {
    const { tabId } = await getOrCreateStudyUberTab();
    let preSearchPromo = null;
    try {
      const promoResp = await chrome.tabs.sendMessage(tabId, { type: "CAPTURE_PRESEARCH_PROMO" });
      if (promoResp?.ok && promoResp.promo) {
        preSearchPromo = promoResp.promo;
      }
    } catch (_) {}
    const slotKey = String(slot);
    if (!state.searchContextBySlot || typeof state.searchContextBySlot !== "object") {
      state.searchContextBySlot = {};
    }
    state.searchContextBySlot[slotKey] = {
      capturedAt: new Date().toISOString(),
      rideSearchParameters: {
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        dropoffLat: trip.dropoffLat,
        dropoffLng: trip.dropoffLng,
        tripLabel: trip.label,
        scheduledISO: trip.scheduledISO,
        scheduledET: trip.etTime,
      },
      preSearchPromo,
    };
    await chrome.storage.local.set({ tripState: state });
    await chrome.tabs.update(tabId, { url });
    chrome.alarms.create(buildCaptureTimeoutAlarmName(slot), { when: Date.now() + CAPTURE_TIMEOUT_MS });
  } catch (err) {
    console.error("runTrip error:", err);
  }
}

function applyDetailBreakdownToRow(row, detail) {
  if (!row || !detail) return;
  row.baseFare = detail.baseFare ?? row.baseFare ?? "";
  row.minimumFare = detail.minimumFare ?? row.minimumFare ?? "";
  row.perMinute = detail.perMinute ?? row.perMinute ?? "";
  row.perMile = detail.perMile ?? row.perMile ?? "";
  row.estimatedSurcharges = detail.estimatedSurcharges ?? row.estimatedSurcharges ?? "";
  row.bookingFee = detail.bookingFee ?? row.bookingFee ?? "";
  row.waitTimeDetail = detail.waitTimeDetail ?? row.waitTimeDetail ?? "";
  row.breakdownCaptureStatus = detail.breakdownCaptureStatus ?? row.breakdownCaptureStatus ?? "";
  row.breakdownCaptureError = detail.breakdownCaptureError ?? row.breakdownCaptureError ?? "";
  row.detailClickAttempted = detail.detailClickAttempted ?? row.detailClickAttempted ?? "";
  row.detailClickMatchedNode = detail.detailClickMatchedNode ?? row.detailClickMatchedNode ?? "";
  row.detailGraphqlEventsSeenAfterClick =
    detail.detailGraphqlEventsSeenAfterClick ?? row.detailGraphqlEventsSeenAfterClick ?? "";
  row.detailProductWasPreselected = detail.detailProductWasPreselected ?? row.detailProductWasPreselected ?? "";
  row.detailClickDispatchCount = detail.detailClickDispatchCount ?? row.detailClickDispatchCount ?? "";
}

async function tryCaptureDetailedBreakdowns(slotRowsForUpload) {
  if (!Array.isArray(slotRowsForUpload) || slotRowsForUpload.length === 0) {
    return { ok: false, reason: "no_rows" };
  }

  const productNames = Array.from(
    new Set(
      slotRowsForUpload
        .map((r) => (typeof r?.productName === "string" ? r.productName.trim() : ""))
        .filter(Boolean)
    )
  );
  if (productNames.length === 0) {
    return { ok: false, reason: "no_product_names" };
  }

  try {
    const storage = await chrome.storage.local.get([STUDY_UBER_TAB_ID_KEY]);
    const tabId = storage[STUDY_UBER_TAB_ID_KEY];
    if (typeof tabId !== "number") {
      return { ok: false, reason: "missing_tab_id" };
    }
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "CAPTURE_PRODUCT_BREAKDOWNS",
      productNames,
      timeoutMs: DETAIL_CAPTURE_TIMEOUT_MS,
    });
    if (!response?.ok || !response?.breakdowns) {
      return { ok: false, reason: response?.reason || "capture_failed" };
    }

    for (const row of slotRowsForUpload) {
      const key = typeof row.productName === "string" ? row.productName.trim() : "";
      const detail = key ? response.breakdowns[key] : null;
      if (detail) {
        applyDetailBreakdownToRow(row, detail);
      } else if (!row.breakdownCaptureStatus) {
        row.breakdownCaptureStatus = "not_attempted";
      }
    }
    return { ok: true, failedProducts: response.failedProducts || [] };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}

async function handleProductsCapture(productsData) {
  const stored = await chrome.storage.local.get(["tripState"]);
  const state = stored.tripState;
  if (!state || !state.running) return;
  if (state.capturedForCurrent) return;
  const slot = state.currentSlot;
  if (_captureSlotsInProgress.has(slot)) {
    console.log(`ℹ️ Duplicate products payload ignored for slot ${slot}`);
    return;
  }
  _captureSlotsInProgress.add(slot);

  try {
    state.capturedForCurrent = true;
    await clearCaptureTimeoutAlarm(slot);
    // Persist capture lock immediately to avoid race with another products payload.
    await chrome.storage.local.set({ tripState: state });

    const trip = TRIPS[slot];
    const prolificId = await getStoredProlificId();
    const locationSnapshot = await getApproxBrowserLocationForCapture();
    const tiers = productsData?.data?.products?.tiers || [];
    let count = 0;
    let hasValidFare = false;
    const slotRowsForUpload = [];

    for (const tier of tiers) {
      for (const product of tier.products || []) {
        for (const fare of product.fares || []) {
          let meta = {};
          try {
            meta = JSON.parse(fare.meta);
          } catch (_) {}

          const uf = meta?.upfrontFare || {};
          const dynFare = uf?.dynamicFareInfo || {};
          const sig = uf?.signature || {};
          if (fare.fare && fare.fare !== "" && fare.fareAmountE5 > 0) {
            hasValidFare = true;
          }

          const capturedRow = {
            prolificId,
            slot,
            scheduledISO: trip.scheduledISO,
            scheduledET: trip.etTime,
            tripLabel: trip.label,
            searchTime: new Date().toISOString(),
            tier: tier.title,
            productName: product.displayName,
            productType: product.productClassificationTypeName,
            estimatedTripTime: product.estimatedTripTime ?? "",
            etaStringShort: product.etaStringShort ?? "",
            fare: fare.fare ?? "",
            preAdjustmentValue: fare.preAdjustmentValue ?? "",
            discountPrimary: fare.discountPrimary ?? "",
            discountedFare: uf.discountedFare ?? "",
            hasBenefitsOnFare: product.hasBenefitsOnFare ?? "",
            hasPromo: fare.hasPromo ?? "",
            hasRidePass: fare.hasRidePass ?? "",
            fareEstimateInfo: JSON.stringify(meta.fareEstimateInfo ?? ""),
            ezpzFareBreakdown: JSON.stringify(uf.ezpzFareBreakdown ?? ""),
            multiplier: dynFare.multiplier ?? "",
            surgeSuppressionThreshold: dynFare.surgeSuppressionThreshold ?? "",
            approxUserLat: locationSnapshot.approxUserLat,
            approxUserLng: locationSnapshot.approxUserLng,
            approxUserLocationSource: locationSnapshot.locationSource,
            originLat: uf.originLat ?? "",
            originLng: uf.originLng ?? "",
            destinationLat: uf.destinationLat ?? "",
            destinationLng: uf.destinationLng ?? "",
            capacity: uf.capacity ?? "",
            issuedAt: sig.issuedAt ?? "",
            isSobriety: dynFare.isSobriety ?? "",
            baseFare: "",
            minimumFare: "",
            perMinute: "",
            perMile: "",
            estimatedSurcharges: "",
            bookingFee: "",
            waitTimeDetail: "",
            breakdownCaptureStatus: "not_attempted",
            breakdownCaptureError: "",
            detailClickAttempted: "",
            detailClickMatchedNode: "",
            detailGraphqlEventsSeenAfterClick: "",
            detailProductWasPreselected: "",
            detailClickDispatchCount: "",
          };
          state.results.push(capturedRow);
          slotRowsForUpload.push(capturedRow);
          count++;
        }
      }
    }

    if (hasValidFare) {
      const detailCapture = await tryCaptureDetailedBreakdowns(slotRowsForUpload);
      if (!detailCapture.ok) {
        console.warn(`⚠ Detailed breakdown capture skipped/failed for slot ${slot}: ${detailCapture.reason}`);
      } else if (detailCapture.failedProducts?.length) {
        console.warn(
          `⚠ Detailed breakdown capture partial for slot ${slot}; failed products: ${detailCapture.failedProducts.join(", ")}`
        );
      }
      state.tripStatuses[slot] = "success";
      const metric = upsertSlotMetric(state, slot, {
        captureEndedAt: Date.now(),
        outcome: "success",
        capturedRows: count,
      });
      await appendTimingLog({
        ...metric,
        timestamp: new Date().toISOString(),
        tripLabel: trip.label,
        scheduledISO: trip.scheduledISO,
        prolificId,
      });
      await updateSearchHealthAndMaybeNotify(state);
      console.log(`💾 Slot ${slot} captured: ${count} products, ${state.results.length} total rows`);
      const awsResult = await uploadSearchRowsToAws({
        slot,
        trip,
        outcome: "success",
        rows: slotRowsForUpload,
        searchContext: getSlotSearchContext(state, slot, trip),
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
      }
    } else {
      state.tripStatuses[slot] = "no_prices";
      await clearCaptureTimeoutAlarm(slot);
      state.loginRequired = true;
      state.running = false;
      state.results.splice(state.results.length - count, count);
      chrome.alarms.clear(ALARM_NAME);
      releaseSearchKeepAwake();
      const metric = upsertSlotMetric(state, slot, {
        captureEndedAt: Date.now(),
        outcome: "no_prices",
        capturedRows: 0,
      });
      await appendTimingLog({
        ...metric,
        timestamp: new Date().toISOString(),
        tripLabel: trip.label,
        scheduledISO: trip.scheduledISO,
        prolificId,
      });
      await updateSearchHealthAndMaybeNotify(state);
      console.warn(`⚠ Slot ${slot}: no prices — not logged in`);
      sendLoginNotification();
      const awsResult = await uploadSearchRowsToAws({
        slot,
        trip,
        outcome: "no_prices",
        rows: [],
        searchContext: getSlotSearchContext(state, slot, trip),
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
      }
    }

    await chrome.storage.local.set({ tripState: state });
    await updateBadge(state);
  } finally {
    _captureSlotsInProgress.delete(slot);
  }
}
