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
const DEFAULT_EARLY_WAKE_SEC = 90;
const DEFAULT_LATE_FIRE_GRACE_MS = 15000;
const MAX_TIMING_LOG_ROWS = 2000;
const FAILURE_WINDOW_SIZE = 10;
const FAILURE_RATE_THRESHOLD = 0.5;

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

  const tripStatuses = new Array(TOTAL_SLOTS).fill("pending");
  for (let i = 0; i < nextSlot; i++) tripStatuses[i] = "skipped";

  const state = {
    running: true,
    dayStart: SCHEDULE_START_MS,
    endTime,
    currentSlot: nextSlot > 0 ? nextSlot - 1 : 0,
    totalSlots: TOTAL_SLOTS,
    results: [],
    capturedForCurrent: true,
    tripStatuses,
    loginRequired: false,
    profileVerificationFailed: false,
    tripHistoryVerificationFailed: false,
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
    const nextTime = getTripTimestamp(nextSlot);
    const wakeTime = nextTime - cfg.earlyWakeSec * 1000;
    chrome.alarms.create(ALARM_NAME, { when: wakeTime });
    console.log(`⏰ First trip: ${TRIPS[nextSlot].scheduledISO} — fires at ${new Date(nextTime).toISOString()}`);
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
  const nextTime = getTripTimestamp(nextSlot);
  const wakeTime = nextTime - cfg.earlyWakeSec * 1000;
  chrome.alarms.create(ALARM_NAME, { when: wakeTime });
  console.log(`⏰ Next: ${TRIPS[nextSlot].scheduledISO} — fires at ${new Date(nextTime).toISOString()}`);
}

function waitForExactMark(targetTime, callback) {
  function poll() {
    const remaining = targetTime - Date.now();
    if (remaining <= 0) {
      callback();
      return;
    }
    const delay = remaining > 2000 ? 1000 : remaining > 200 ? 50 : 5;
    setTimeout(poll, delay);
  }
  poll();
}

let _pendingSlot = -1;

async function onSlotAlarm() {
  try {
    const alarmFiredAt = Date.now();
    const cfg = await getSchedulerConfig();
    const data = await chrome.storage.local.get(["tripState"]);
    const state = data.tripState;
    if (!state || !state.running) return;

    if (!state.capturedForCurrent && state.tripStatuses[state.currentSlot] === "searching") {
      state.tripStatuses[state.currentSlot] = "no_data";
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

    if (_pendingSlot === nextSlot) {
      return;
    }
    _pendingSlot = nextSlot;

    const targetTime = getTripTimestamp(nextSlot);

    for (let i = state.currentSlot + 1; i < nextSlot; i++) {
      if (state.tripStatuses[i] === "pending") state.tripStatuses[i] = "skipped";
    }

    console.log(`⏳ Waiting for exact ${TRIPS[nextSlot].scheduledISO} (${targetTime - Date.now()}ms remaining)`);
    waitForExactMark(targetTime, async () => {
      try {
        const firedAt = Date.now();
        const driftMs = firedAt - targetTime;
        const fresh = await chrome.storage.local.get(["tripState"]);
        const s = fresh.tripState;
        if (!s || !s.running) {
          _pendingSlot = -1;
          return;
        }
        if (s.currentSlot >= nextSlot) {
          _pendingSlot = -1;
          return;
        }

        if (driftMs > cfg.lateFireGraceMs) {
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
          });
          await updateSearchHealthAndMaybeNotify(s);
          updateBadge(s);
          _pendingSlot = -1;
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
        _pendingSlot = -1;
        runTrip(s);
        await scheduleNextSlot(s);
      } catch (err) {
        _pendingSlot = -1;
        console.error("onSlotAlarm callback error:", err);
      }
    });
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
        console.warn(`⏰ Capture timeout for trip #${slot} (${trip.scheduledISO}) — marking no_data`);
        s.tripStatuses[slot] = "no_data";
        const metric = upsertSlotMetric(s, slot, {
          captureEndedAt: Date.now(),
          outcome: "no_data",
        });
        await appendTimingLog({
          ...metric,
          timestamp: new Date().toISOString(),
          tripLabel: trip.label,
          scheduledISO: trip.scheduledISO,
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

  state.capturedForCurrent = true;

  const trip = TRIPS[state.currentSlot];
  const tiers = productsData?.data?.products?.tiers || [];
  let count = 0;
  let hasValidFare = false;

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

        state.results.push({
          slot: state.currentSlot,
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
          requestLocationLat: meta?.pricingParams?.requestLocation?.latitude ?? "",
          requestLocationLng: meta?.pricingParams?.requestLocation?.longitude ?? "",
          originLat: uf.originLat ?? "",
          originLng: uf.originLng ?? "",
          destinationLat: uf.destinationLat ?? "",
          destinationLng: uf.destinationLng ?? "",
          capacity: uf.capacity ?? "",
          issuedAt: sig.issuedAt ?? "",
          isSobriety: dynFare.isSobriety ?? "",
        });
        count++;
      }
    }
  }

  if (hasValidFare) {
    state.tripStatuses[state.currentSlot] = "success";
    const metric = upsertSlotMetric(state, state.currentSlot, {
      captureEndedAt: Date.now(),
      outcome: "success",
      capturedRows: count,
    });
    await appendTimingLog({
      ...metric,
      timestamp: new Date().toISOString(),
      tripLabel: trip.label,
      scheduledISO: trip.scheduledISO,
    });
    await updateSearchHealthAndMaybeNotify(state);
    console.log(`💾 Slot ${state.currentSlot} captured: ${count} products, ${state.results.length} total rows`);
  } else {
    state.tripStatuses[state.currentSlot] = "no_prices";
    state.loginRequired = true;
    state.running = false;
    state.results.splice(state.results.length - count, count);
    chrome.alarms.clear(ALARM_NAME);
    releaseSearchKeepAwake();
    const metric = upsertSlotMetric(state, state.currentSlot, {
      captureEndedAt: Date.now(),
      outcome: "no_prices",
      capturedRows: 0,
    });
    await appendTimingLog({
      ...metric,
      timestamp: new Date().toISOString(),
      tripLabel: trip.label,
      scheduledISO: trip.scheduledISO,
    });
    await updateSearchHealthAndMaybeNotify(state);
    console.warn(`⚠ Slot ${state.currentSlot}: no prices — not logged in`);
    sendLoginNotification();
  }

  await chrome.storage.local.set({ tripState: state });
  updateBadge(state);
}
