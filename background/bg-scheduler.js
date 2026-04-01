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
const FAILURE_ALERT_LAST_DAY_KEY = "failureAlertLastDay";
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
const PREWARM_OFFSETS_MS = [5 * 60 * 1000, 3 * 60 * 1000, 90 * 1000, 30 * 1000];

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

async function ensureUberTabWarmup(nextSlot) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
    if (tabs.length === 0) {
      await chrome.windows.create({
        url: "https://m.uber.com/",
        focused: false,
        state: "minimized",
      });
      console.log(`🔥 Prewarm: created Uber tab for slot ${nextSlot}`);
      return;
    }
    if (tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { active: false });
      console.log(`🔥 Prewarm: touched existing Uber tab for slot ${nextSlot}`);
    }
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

function getLocalDayKey(ms = Date.now()) {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isCompletedOutcome(outcome) {
  return outcome === "success" || outcome === "no_data" || outcome === "no_prices" || outcome === "missed_late";
}

function isFailedOutcome(outcome) {
  return outcome === "no_data" || outcome === "no_prices" || outcome === "missed_late";
}

function buildSearchHealth(rows) {
  const completed = rows.filter((r) => isCompletedOutcome(r?.outcome)).slice(-FAILURE_WINDOW_SIZE);
  const sampleSize = completed.length;
  const failedCount = completed.filter((r) => isFailedOutcome(r?.outcome)).length;
  const failureRate = sampleSize > 0 ? failedCount / sampleSize : 0;
  return {
    sampleSize,
    failedCount,
    failureRate,
    threshold: FAILURE_RATE_THRESHOLD,
    isFailing: sampleSize >= FAILURE_WINDOW_SIZE && failureRate >= FAILURE_RATE_THRESHOLD,
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

function toApproxCoordinate(value, decimals = APPROX_COORD_DECIMALS) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const precision = Math.pow(10, decimals);
  return Math.round(num * precision) / precision;
}

async function getApproxBrowserLocationForCapture() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
    const uberTab = tabs[0];
    if (!uberTab?.id) return { approxUserLat: "", approxUserLng: "", locationSource: "unavailable" };

    const response = await chrome.tabs.sendMessage(uberTab.id, { type: "GET_BROWSER_LOCATION" });
    if (!response?.ok) return { approxUserLat: "", approxUserLng: "", locationSource: "unavailable" };

    return {
      approxUserLat: toApproxCoordinate(response.latitude),
      approxUserLng: toApproxCoordinate(response.longitude),
      locationSource: "browser_geolocation",
    };
  } catch (_) {
    return { approxUserLat: "", approxUserLng: "", locationSource: "unavailable" };
  }
}

async function uploadSearchRowsToAws({ slot, trip, outcome, rows }) {
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
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const fileName = `price_search_slot_${slot}_part_${index + 1}_of_${batches.length}_${uniqueSuffix}.json`;

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
  const data = await chrome.storage.local.get([TIMING_LOG_KEY, FAILURE_ALERT_LAST_DAY_KEY]);
  const rows = Array.isArray(data[TIMING_LOG_KEY]) ? data[TIMING_LOG_KEY] : [];
  const health = buildSearchHealth(rows);
  state.searchHealth = health;
  await chrome.storage.local.set({ tripState: state });

  if (!health.isFailing) return;
  const today = getLocalDayKey();
  if (data[FAILURE_ALERT_LAST_DAY_KEY] === today) return;
  sendSearchReliabilityWarningNotification(health);
  await chrome.storage.local.set({ [FAILURE_ALERT_LAST_DAY_KEY]: today });
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
    updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (state.running) {
    state.running = false;
    state.loginRequired = true;
    chrome.alarms.clear(ALARM_NAME);
    releaseSearchKeepAwake();
    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
    sendLoginNotification();
    return;
  }

  if (!state.loginRequired) {
    state.loginRequired = true;
    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
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
  updateBadge(state);

  if (nextSlot >= TOTAL_SLOTS) {
    markDayComplete(state);
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
    const alarmInfo = parseSchedulerAlarmName(alarmName);
    const phase = alarmInfo?.phase || "exact";
    const alarmSlot = Number.isInteger(alarmInfo?.slot) ? alarmInfo.slot : null;
    const alarmFiredAt = Date.now();
    const cfg = await getSchedulerConfig();
    const data = await chrome.storage.local.get(["tripState"]);
    const state = data.tripState;
    if (!state || !state.running) return;

    if (!state.capturedForCurrent && state.tripStatuses[state.currentSlot] === "searching") {
      state.tripStatuses[state.currentSlot] = "no_data";
      const currentTrip = TRIPS[state.currentSlot];
      const awsResult = await uploadSearchRowsToAws({
        slot: state.currentSlot,
        trip: currentTrip,
        outcome: "no_data",
        rows: [],
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${state.currentSlot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${state.currentSlot}: ${awsResult.uploadedFiles} file(s)`);
      }
      try {
        const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
        if (tabs.length > 0 && !tabs[0].url.includes("product-selection")) {
          console.warn("⚠ Tab redirected — login required");
          await handleNotLoggedIn(state);
          return;
        }
      } catch (_) {}
    }

    if (Date.now() >= state.endTime) {
      markDayComplete(state);
      return;
    }

    const nextSlot = state.currentSlot + 1;
    if (nextSlot >= TOTAL_SLOTS) {
      markDayComplete(state);
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
        updateBadge(s);
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
      updateBadge(s);
      runTrip(s);
      await scheduleNextSlot(s);
    } finally {
      _pendingSlot = -1;
    }
  } catch (err) {
    console.error("onSlotAlarm error:", err);
  }
}

async function markDayComplete(state) {
  state.running = false;
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    if (state.tripStatuses[i] === "pending" || state.tripStatuses[i] === "searching") {
      state.tripStatuses[i] = "skipped";
    }
  }
  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
  chrome.alarms.clear(ALARM_NAME);
  releaseSearchKeepAwake();
  const successCount = state.tripStatuses.filter((s) => s === "success").length;
  const errorCount = state.tripStatuses.filter((s) => s === "no_data" || s === "no_prices").length;
  const skippedCount = state.tripStatuses.filter((s) => s === "skipped").length;
  const missedLateCount = state.tripStatuses.filter((s) => s === "missed_late").length;
  console.log(`✅ Day complete: ${successCount} succeeded, ${errorCount} errors, ${missedLateCount} missed late, ${skippedCount} skipped, ${state.results.length} CSV rows`);
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
    const tabs = await chrome.tabs.query({ url: "https://m.uber.com/*" });
    if (tabs.length > 0) {
      await chrome.tabs.update(tabs[0].id, { url });
    } else {
      await chrome.windows.create({
        url,
        focused: false,
        state: "minimized",
      });
    }
  } catch (err) {
    console.error("runTrip error:", err);
  }

  setTimeout(async () => {
    try {
      const stored = await chrome.storage.local.get(["tripState"]);
      const s = stored.tripState;
      if (!s) return;
      if (s.currentSlot === slot && !s.capturedForCurrent && s.tripStatuses[slot] === "searching") {
        const prolificId = await getStoredProlificId();
        console.warn(`⏰ Capture timeout for trip #${slot} (${trip.scheduledISO}) — marking no_data`);
        s.tripStatuses[slot] = "no_data";
        const awsResult = await uploadSearchRowsToAws({
          slot,
          trip,
          outcome: "no_data",
          rows: [],
        });
        if (!awsResult.ok) {
          console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
        } else {
          console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
        }
        const metric = upsertSlotMetric(s, slot, {
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
        updateBadge(s);
      }
    } catch (e) {
      console.error("Capture timeout error:", e);
    }
  }, CAPTURE_TIMEOUT_MS);
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
          };
          state.results.push(capturedRow);
          slotRowsForUpload.push(capturedRow);
          count++;
        }
      }
    }

    if (hasValidFare) {
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
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
      }
    } else {
      state.tripStatuses[slot] = "no_prices";
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
      });
      if (!awsResult.ok) {
        console.warn(`⚠ AWS upload failed for slot ${slot}: ${awsResult.reason || "unknown_error"}`);
      } else {
        console.log(`☁️ AWS upload complete for slot ${slot}: ${awsResult.uploadedFiles} file(s)`);
      }
    }

    await chrome.storage.local.set({ tripState: state });
    updateBadge(state);
  } finally {
    _captureSlotsInProgress.delete(slot);
  }
}
