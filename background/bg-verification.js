function historySearch(query) {
  return new Promise((resolve) => chrome.history.search(query, resolve));
}

function historyGetVisits(url) {
  return new Promise((resolve) => chrome.history.getVisits({ url }, resolve));
}

function startOfLocalDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function getDailyLocalHistoryCount(dayStartMs, dayEndMs) {
  const items = await historySearch({
    text: "",
    startTime: dayStartMs,
    endTime: dayEndMs,
    maxResults: 10000,
  });

  let count = 0;
  for (const item of items) {
    if (!item?.url) continue;
    const visits = await historyGetVisits(item.url);
    for (const visit of visits) {
      const t = visit.visitTime ?? 0;
      if (t >= dayStartMs && t < dayEndMs && visit.isLocal) {
        count++;
      }
    }
  }
  return count;
}

async function verifyActiveChromeProfile(
  minActions = 600,
  lookbackDays = 7,
  minActionsPerActiveDay = 120,
  requiredActiveDays = 5
) {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = startOfLocalDay(Date.now());
  const dailyCounts = [];
  let totalLocalActions = 0;
  let activeDays = 0;

  for (let i = lookbackDays - 1; i >= 0; i--) {
    const dayStart = todayStart - i * dayMs;
    const dayEnd = dayStart + dayMs;
    const count = await getDailyLocalHistoryCount(dayStart, dayEnd);
    dailyCounts.push({
      dayStart,
      dayLabel: new Date(dayStart).toISOString().slice(0, 10),
      localActionCount: count,
    });
    totalLocalActions += count;
    if (count >= minActionsPerActiveDay) activeDays++;
  }

  return {
    passed: totalLocalActions >= minActions && activeDays >= requiredActiveDays,
    minActions,
    lookbackDays,
    minActionsPerActiveDay,
    requiredActiveDays,
    activeDays,
    totalLocalActions,
    dailyCounts,
  };
}

function extractTripDateCandidates(html) {
  const candidates = [];
  const seen = new Set();
  const keyRegex = /"(?:startTime|requestTime|dropoffTime|timestamp|dateTime|tripTime)"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = keyRegex.exec(html)) !== null) {
    const ts = Date.parse(m[1]);
    if (!Number.isNaN(ts) && !seen.has(ts)) {
      seen.add(ts);
      candidates.push(ts);
    }
  }

  const isoRegex = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
  while ((m = isoRegex.exec(html)) !== null) {
    const ts = Date.parse(m[0]);
    if (!Number.isNaN(ts) && !seen.has(ts)) {
      seen.add(ts);
      candidates.push(ts);
    }
  }

  return candidates.sort((a, b) => b - a);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let verificationWindowId = null;

async function ensureVerificationWindow() {
  if (typeof verificationWindowId === "number") {
    try {
      await chrome.windows.get(verificationWindowId);
      return verificationWindowId;
    } catch (_) {
      verificationWindowId = null;
    }
  }

  const win = await chrome.windows.create({
    url: "about:blank",
    focused: false,
    state: "minimized",
  });
  verificationWindowId = win?.id ?? null;
  if (typeof verificationWindowId !== "number") {
    throw new Error("Could not create dedicated verification window");
  }
  return verificationWindowId;
}

async function extractTripsFromBackgroundTab(url) {
  let tabId = null;
  const timeoutMs = 20000;

  try {
    const windowId = await ensureVerificationWindow();
    const tab = await chrome.tabs.create({
      windowId,
      url,
      active: false,
    });
    tabId = tab?.id ?? null;
    if (typeof tabId !== "number") {
      throw new Error(`Could not create background verification tab for ${url}`);
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        reject(new Error(`Timed out loading ${url}`));
      }, timeoutMs);

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
    });

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tabInfo = await chrome.tabs.get(tabId);
        const currentUrl = tabInfo?.url || "";
        if (!currentUrl.startsWith("https://riders.uber.com/")) {
          throw new Error(`Tab redirected before extraction: ${currentUrl}`);
        }
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "EXTRACT_TRIP_HISTORY_TIMESTAMPS",
          maxWaitMs: 30000,
        });
        if (response?.ok && Array.isArray(response.timestamps)) {
          return {
            ok: true,
            finalUrl: response.finalUrl || currentUrl || url,
            httpStatus: response.httpStatus || 200,
            timestamps: response.timestamps,
            tripLinks: Array.isArray(response.tripLinks) ? response.tripLinks : [],
            debug: response.debug || {},
          };
        }
        lastError = new Error(`No trip timestamps returned from tab (${currentUrl}).`);
      } catch (err) {
        let currentUrl = "";
        try {
          const tabInfo = await chrome.tabs.get(tabId);
          currentUrl = tabInfo?.url || "";
        } catch (_) {}
        lastError = new Error(`${String(err)}${currentUrl ? ` | currentTabUrl=${currentUrl}` : ""}`);
      }
      await sleep(300);
    }

    throw lastError || new Error("Failed to extract trip timestamps from tab.");
  } finally {
    if (typeof tabId === "number") {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {}
    }
    if (typeof verificationWindowId === "number") {
      try {
        await chrome.windows.get(verificationWindowId);
      } catch (_) {}
      try {
        await chrome.windows.update(verificationWindowId, { focused: false, state: "minimized" });
      } catch (_) {}
    }
  }
}

async function verifyUberTripHistory(cutoffDateISO = "2025-03-01", minTripsRequired = 5) {
  const cutoffMs = Date.parse(`${cutoffDateISO}T00:00:00Z`);
  const profiles = ["PERSONAL", "BUSINESS"];
  let totalTripsSinceCutoff = 0;
  const profileSummaries = [];

  for (const profile of profiles) {
    const url = `https://riders.uber.com/trips?profile=${profile}`;
    try {
      const extracted = await extractTripsFromBackgroundTab(url);
      let topFiveTripTimestamps = extracted.timestamps
        .filter((ts) => Number.isFinite(ts))
        .sort((a, b) => b - a)
        .slice(0, 5);

      if (topFiveTripTimestamps.length === 0 && Array.isArray(extracted.tripLinks) && extracted.tripLinks.length > 0) {
        const detailTimestamps = [];
        for (const link of extracted.tripLinks.slice(0, 5)) {
          try {
            const detail = await extractTripsFromBackgroundTab(link);
            const best = (detail.timestamps || [])
              .filter((ts) => Number.isFinite(ts))
              .sort((a, b) => b - a)[0];
            if (Number.isFinite(best)) detailTimestamps.push(best);
          } catch (_) {}
        }
        topFiveTripTimestamps = detailTimestamps.sort((a, b) => b - a).slice(0, 5);
      }

      const tripsSinceCutoff = topFiveTripTimestamps.filter((ts) => ts >= cutoffMs).length;
      totalTripsSinceCutoff += tripsSinceCutoff;
      const listTimestampCount = extracted.timestamps.filter((ts) => Number.isFinite(ts)).length;
      profileSummaries.push({
        profile,
        fetched: extracted.ok,
        httpStatus: extracted.httpStatus,
        httpOk: true,
        usedUrl: extracted.finalUrl || url,
        recentTripsFound: topFiveTripTimestamps.length,
        tripsSinceCutoff,
        usedDetailFallback: topFiveTripTimestamps.length > 0 && listTimestampCount === 0,
        listTimestampCount,
        tripLinksFound: Array.isArray(extracted.tripLinks) ? extracted.tripLinks.length : 0,
        debug: extracted.debug || {},
      });
    } catch (err) {
      profileSummaries.push({
        profile,
        fetched: false,
        error: String(err),
        usedUrl: url,
        recentTripsFound: 0,
        tripsSinceCutoff: 0,
      });
    }
  }

  return {
    passed: totalTripsSinceCutoff >= minTripsRequired,
    cutoffDateISO,
    minTripsRequired,
    totalTripsSinceCutoff,
    profileSummaries,
  };
}
