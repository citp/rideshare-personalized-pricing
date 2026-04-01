(() => {
  function markLoaded() {
    if (document.documentElement) {
      document.documentElement.setAttribute("data-trip-history-cs-loaded", "1");
      return true;
    }
    return false;
  }
  if (!markLoaded()) {
    const timer = setInterval(() => {
      if (markLoaded()) clearInterval(timer);
    }, 100);
    document.addEventListener("DOMContentLoaded", () => {
      markLoaded();
      clearInterval(timer);
    }, { once: true });
  }
  const collected = new Set();
  const isoRegex = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})\b/g;
  const monthNameDateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/g;
  const monthDayNoYearRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2}\b/g;
  const monthDayTimeRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)\s+\d{1,2}\s*[•\-]?\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi;
  const numericDateRegex = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
  const relativeAgoRegex = /\b(\d+)\s+(day|week|month|year)s?\s+ago\b/gi;
  const monthToIndex = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };

  function addTimestamp(val) {
    const normalized = String(val)
      .replace(/[•]/g, " ")
      .replace(/\s*-\s*/g, " ")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const ts = Date.parse(normalized);
    if (!Number.isNaN(ts)) collected.add(ts);
  }

  function inferYearForMonthDay(monthIndex, day, hour = 12, minute = 0) {
    const now = new Date();
    let year = now.getFullYear();
    let candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
    // If this would be in the future, it's most likely from previous year.
    if (candidate.getTime() > now.getTime() + 2 * 24 * 60 * 60 * 1000) {
      year -= 1;
      candidate = new Date(year, monthIndex, day, hour, minute, 0, 0);
    }
    return candidate.getTime();
  }

  function parseMonthDayNoYear(raw) {
    const m = String(raw).trim().match(/^([A-Za-z]+)\s+(\d{1,2})$/);
    if (!m) return null;
    const monthIndex = monthToIndex[m[1].toLowerCase()];
    const day = Number(m[2]);
    if (monthIndex == null || !Number.isFinite(day)) return null;
    return inferYearForMonthDay(monthIndex, day);
  }

  function parseMonthDayTimeNoYear(raw) {
    const normalized = String(raw).replace(/[•]/g, " ").replace(/\s+/g, " ").trim();
    const m = normalized.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    const monthIndex = monthToIndex[m[1].toLowerCase()];
    const day = Number(m[2]);
    let hour = Number(m[3]);
    const minute = Number(m[4]);
    const ampm = m[5].toUpperCase();
    if (monthIndex == null || !Number.isFinite(day) || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour === 12) hour = ampm === "AM" ? 0 : 12;
    else if (ampm === "PM") hour += 12;
    return inferYearForMonthDay(monthIndex, day, hour, minute);
  }

  function extractTripDateCandidates(html) {
    const keyRegex = /"(?:startTime|requestTime|dropoffTime|timestamp|dateTime|tripTime|pickupTime|completedAt|requestedAt|tripDate)"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = keyRegex.exec(html)) !== null) addTimestamp(m[1]);
    while ((m = isoRegex.exec(html)) !== null) addTimestamp(m[0]);
    return Array.from(collected).sort((a, b) => b - a);
  }

  function extractDateCandidatesFromText(text) {
    if (!text || typeof text !== "string") return;
    let m;
    while ((m = monthDayTimeRegex.exec(text)) !== null) {
      const ts = parseMonthDayTimeNoYear(m[0]);
      if (Number.isFinite(ts)) collected.add(ts);
    }
    while ((m = monthNameDateRegex.exec(text)) !== null) addTimestamp(m[0]);
    while ((m = monthDayNoYearRegex.exec(text)) !== null) {
      const ts = parseMonthDayNoYear(m[0]);
      if (Number.isFinite(ts)) collected.add(ts);
    }
    while ((m = numericDateRegex.exec(text)) !== null) addTimestamp(m[0]);
    while ((m = relativeAgoRegex.exec(text)) !== null) {
      const count = Number(m[1]);
      const unit = (m[2] || "").toLowerCase();
      if (!Number.isFinite(count) || count <= 0) continue;
      const now = new Date();
      if (unit === "day") now.setDate(now.getDate() - count);
      else if (unit === "week") now.setDate(now.getDate() - count * 7);
      else if (unit === "month") now.setMonth(now.getMonth() - count);
      else if (unit === "year") now.setFullYear(now.getFullYear() - count);
      collected.add(now.getTime());
    }
  }

  function tryClickLoadMore() {
    const controls = Array.from(document.querySelectorAll("button, a, [role='button']"));
    for (const el of controls) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (!text) continue;
      if (
        text.includes("show more") ||
        text.includes("load more") ||
        text.includes("view more") ||
        text.includes("see more")
      ) {
        try {
          el.click();
          return true;
        } catch (_) {}
      }
    }
    return false;
  }

  async function waitForTripData(maxWaitMs) {
    const start = Date.now();
    let sawLoadingText = false;
    let maxTripLinksSeen = 0;
    let lastBodySnippet = "";
    let loadMoreClicks = 0;
    while (Date.now() - start < maxWaitMs) {
      const html = document.documentElement?.outerHTML || "";
      extractTripDateCandidates(html);
      const bodyText = document.body?.innerText || "";
      if (bodyText.includes("Loading")) sawLoadingText = true;
      lastBodySnippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 220);
      extractDateCandidatesFromText(bodyText);
      const linksNow = extractTripLinks();
      if (linksNow.length > maxTripLinksSeen) maxTripLinksSeen = linksNow.length;
      const fromTimeEls = Array.from(document.querySelectorAll("time"))
        .map((el) => el.getAttribute("datetime") || el.textContent || "")
        .join(" ");
      extractDateCandidatesFromText(fromTimeEls);
      const deduped = Array.from(collected).sort((a, b) => b - a);
      if (deduped.length >= 3 || linksNow.length >= 5) {
        return { timestamps: deduped, sawLoadingText, maxTripLinksSeen, lastBodySnippet, loadMoreClicks };
      }
      if (loadMoreClicks < 6 && tryClickLoadMore()) {
        loadMoreClicks++;
      }
      try { window.scrollTo(0, document.body?.scrollHeight || 0); } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const html = document.documentElement?.outerHTML || "";
    extractTripDateCandidates(html);
    const bodyText = document.body?.innerText || "";
    if (bodyText.includes("Loading")) sawLoadingText = true;
    lastBodySnippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 220);
    extractDateCandidatesFromText(bodyText);
    const linksNow = extractTripLinks();
    if (linksNow.length > maxTripLinksSeen) maxTripLinksSeen = linksNow.length;
    const fromTimeEls = Array.from(document.querySelectorAll("time"))
      .map((el) => el.getAttribute("datetime") || el.textContent || "")
      .join(" ");
    extractDateCandidatesFromText(fromTimeEls);
    return {
      timestamps: Array.from(collected).sort((a, b) => b - a),
      sawLoadingText,
      maxTripLinksSeen,
      lastBodySnippet,
      loadMoreClicks,
    };
  }

  function extractTripLinks() {
    const links = new Set();
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    for (const a of anchors) {
      const href = a.getAttribute("href") || "";
      if (!href.includes("/trips/")) continue;
      if (href.includes("profile=")) continue;
      try {
        const abs = new URL(href, location.origin).toString();
        if (abs.startsWith("https://riders.uber.com/trips/")) {
          links.add(abs);
        }
      } catch (_) {}
    }
    return Array.from(links).slice(0, 10);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "EXTRACT_TRIP_HISTORY_TIMESTAMPS") return;
    const maxWaitMs = Number(msg?.maxWaitMs) > 0 ? Number(msg.maxWaitMs) : 8000;
    waitForTripData(maxWaitMs)
      .then((result) => {
        const timestamps = Array.isArray(result?.timestamps) ? result.timestamps : [];
        const bodyText = document.body?.innerText || "";
        const timeElements = Array.from(document.querySelectorAll("time"));
        const tripLinks = extractTripLinks();
        sendResponse({
          ok: true,
          finalUrl: location.href,
          httpStatus: 200,
          timestamps: timestamps.slice(0, 30),
          tripLinks,
          debug: {
            bodyTextLength: bodyText.length,
            timeElementCount: timeElements.length,
            anchorCount: document.querySelectorAll("a[href]").length,
            tripLinkCount: tripLinks.length,
            collectedCount: timestamps.length,
            sawLoadingText: !!result?.sawLoadingText,
            maxTripLinksSeen: result?.maxTripLinksSeen ?? tripLinks.length,
            bodySnippet: result?.lastBodySnippet || "",
            loadMoreClicks: result?.loadMoreClicks ?? 0,
          },
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          finalUrl: location.href,
          httpStatus: 200,
          error: String(err),
          timestamps: [],
          tripLinks: [],
        });
      });
    return true;
  });
})();
