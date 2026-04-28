// content.js — runs in ISOLATED world, has access to chrome APIs
console.log("✅ Uber content script (ISOLATED) loaded on:", window.location.href);

// ── Redirect detection ──
// If we land on m.uber.com but NOT on product-selection, Uber redirected us
// (probably to login). Wait a few seconds for client-side routing to settle.
setTimeout(() => {
  const url = window.location.href;
  if (url.includes("m.uber.com") && !url.includes("product-selection")) {
    console.warn("⚠ Page is NOT product-selection:", url);
    try {
      chrome.runtime.sendMessage(
        { type: "UBER_REDIRECT_DETECTED", url: url },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn("Failed to send redirect detection:", chrome.runtime.lastError.message);
          }
        }
      );
    } catch (e) {
      // Extension context invalidated — ignore
    }
  }
}, 5000);

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "UBER_GRAPHQL_INTERCEPTED") return;

  const payload = event.data.payload;

  // Only forward the products/pricing response — ignore status polling
  if (!payload?.data?.products) {
    return;
  }

  console.log("📦 Products data detected — forwarding to background");

  try {
    chrome.runtime.sendMessage(
      { type: "UBER_PRODUCTS_CAPTURED", data: payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Failed to send to background:", chrome.runtime.lastError.message);
          return;
        }
        console.log("✅ Background acknowledged products data");
      }
    );
  } catch (e) {
    console.warn("Extension context invalidated — reload the page.", e.message);
  }
});

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseBreakdownFromOpenDialog() {
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  let modal = dialogs.find((el) => /price breakdown/i.test(normalizeText(el.textContent || "")));
  if (!modal) {
    modal = dialogs[dialogs.length - 1] || null;
  }
  if (!modal) return null;

  const rawText = normalizeText(modal.textContent || "");
  if (!rawText) return null;

  const readMoneyAfterLabel = (label) => {
    const rx = new RegExp(`${label}\\s*\\$([0-9]+(?:\\.[0-9]{1,2})?)`, "i");
    const match = rawText.match(rx);
    return match ? `$${match[1]}` : "";
  };

  const closeCandidate = Array.from(modal.querySelectorAll("button,[role='button']")).find((el) =>
    /close/i.test(normalizeText(el.textContent || ""))
  );

  return {
    baseFare: readMoneyAfterLabel("Base Fare"),
    minimumFare: readMoneyAfterLabel("Minimum Fare"),
    perMinute: readMoneyAfterLabel("\\+?\\s*Per Minute"),
    perMile: readMoneyAfterLabel("\\+?\\s*Per Mile"),
    estimatedSurcharges: readMoneyAfterLabel("Estimated Surcharges"),
    bookingFee: readMoneyAfterLabel("Booking Fee"),
    waitTimeDetail: rawText.includes("Additional wait time charges may apply") ? rawText : "",
    closeCandidate,
  };
}

function findClickableProductCard(productName) {
  const targets = Array.from(document.querySelectorAll("button,[role='button'],a,div")).filter((el) => {
    const txt = normalizeText(el.textContent || "");
    if (!txt) return false;
    if (!txt.toLowerCase().includes(productName.toLowerCase())) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 20 && rect.height > 20;
  });
  if (targets.length === 0) return null;
  return targets.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureProductBreakdown(productName, perProductTimeoutMs) {
  const attemptClickAndWait = async () => {
    const clickable = findClickableProductCard(productName);
    if (!clickable) {
      return { done: true, result: { breakdownCaptureStatus: "click_not_found", breakdownCaptureError: "product_card_missing" } };
    }
    clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    await sleep(120);
    clickable.click();

    const started = Date.now();
    while (Date.now() - started < perProductTimeoutMs) {
      const detail = parseBreakdownFromOpenDialog();
      if (detail) {
        if (detail.closeCandidate) {
          detail.closeCandidate.click();
        } else {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        return {
          done: true,
          result: {
            baseFare: detail.baseFare,
            minimumFare: detail.minimumFare,
            perMinute: detail.perMinute,
            perMile: detail.perMile,
            estimatedSurcharges: detail.estimatedSurcharges,
            bookingFee: detail.bookingFee,
            waitTimeDetail: detail.waitTimeDetail,
            breakdownCaptureStatus: "ok",
            breakdownCaptureError: "",
          },
        };
      }
      await sleep(140);
    }
    return { done: false };
  };

  const first = await attemptClickAndWait();
  if (first.done) return first.result;
  // Retry once in case first click did not open the sheet.
  await sleep(220);
  const second = await attemptClickAndWait();
  if (second.done) return second.result;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return { breakdownCaptureStatus: "timeout", breakdownCaptureError: "breakdown_dialog_timeout" };
}

async function captureBreakdownsForProducts(productNames, timeoutMs) {
  const breakdowns = {};
  const failedProducts = [];
  const safeTimeout = Number.isFinite(Number(timeoutMs)) ? Math.max(8000, Number(timeoutMs)) : 30000;
  const perProductTimeoutMs = Math.min(12000, Math.max(6000, Math.floor(safeTimeout / Math.max(productNames.length, 1))));

  for (const rawName of productNames) {
    const productName = normalizeText(rawName);
    if (!productName) continue;
    try {
      const detail = await captureProductBreakdown(productName, perProductTimeoutMs);
      breakdowns[productName] = detail;
      if (detail.breakdownCaptureStatus !== "ok") {
        failedProducts.push(productName);
      }
      await sleep(120);
    } catch (err) {
      breakdowns[productName] = {
        breakdownCaptureStatus: "error",
        breakdownCaptureError: String(err),
      };
      failedProducts.push(productName);
    }
  }
  return { ok: true, breakdowns, failedProducts };
}

function extractVisibleProductRowsFromDom() {
  const seen = new Set();
  const rows = [];
  const candidates = Array.from(document.querySelectorAll("button,[role='button'],a,div"));
  for (const el of candidates) {
    const text = normalizeText(el.textContent || "");
    if (!text || text.length < 6 || text.length > 260) continue;
    const moneyMatches = text.match(/\$[0-9]+(?:\.[0-9]{1,2})?/g);
    if (!moneyMatches || moneyMatches.length === 0) continue;
    const etaMatch = text.match(/\b\d+\s*mins?\b/i);
    const lines = text
      .split(/(?=\$)|(?=\d+\s*mins?\b)/i)
      .map((s) => normalizeText(s))
      .filter(Boolean);
    const firstLine = lines[0] || text;
    const productName = normalizeText(firstLine.replace(/\$[0-9]+(?:\.[0-9]{1,2})?.*$/g, "")).slice(0, 80);
    if (!productName || productName.length < 2) continue;
    if (/\b(cheaper|newer cars|affordable rides|for you and your pet|luxury rides)\b/i.test(productName)) continue;
    const fare = moneyMatches[0] || "";
    const key = `${productName}|${fare}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      productName,
      fare,
      etaStringShort: etaMatch ? normalizeText(etaMatch[0]) : "",
      source: "dom_fallback",
    });
  }
  return rows;
}

function extractPreSearchPromoFromDom() {
  const bodyText = normalizeText(document.body?.innerText || "");
  if (!bodyText) return null;
  const promoSentenceMatch = bodyText.match(/([0-9]{1,2}%\s+off[^.]*\.)/i);
  if (!promoSentenceMatch) return null;
  const rawText = normalizeText(promoSentenceMatch[1]);
  const percentMatch = rawText.match(/([0-9]{1,2})%\s+off/i);
  const maxMatch = rawText.match(/up to\s+\$([0-9]+(?:\.[0-9]{1,2})?)/i);
  return {
    rawText,
    percentOff: percentMatch ? Number(percentMatch[1]) : "",
    maxDiscount: maxMatch ? `$${maxMatch[1]}` : "",
    capturedAt: new Date().toISOString(),
  };
}

function getBrowserLocation(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
      resolve({ ok: false, reason: "geolocation_unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          ok: true,
          latitude: pos?.coords?.latitude,
          longitude: pos?.coords?.longitude,
          accuracyMeters: pos?.coords?.accuracy,
        });
      },
      (err) => {
        resolve({
          ok: false,
          reason: `geolocation_error:${err?.code || "unknown"}`,
          message: err?.message || "",
        });
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60 * 1000 }
    );
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_BROWSER_LOCATION") {
    getBrowserLocation()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  }

  if (msg?.type === "CAPTURE_PRODUCT_BREAKDOWNS") {
    const names = Array.isArray(msg.productNames) ? msg.productNames : [];
    captureBreakdownsForProducts(names, msg.timeoutMs)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, reason: String(err), breakdowns: {}, failedProducts: names }));
    return true;
  }

  if (msg?.type === "CAPTURE_VISIBLE_PRODUCTS") {
    try {
      const rows = extractVisibleProductRowsFromDom();
      sendResponse({ ok: true, rows });
    } catch (err) {
      sendResponse({ ok: false, reason: String(err), rows: [] });
    }
    return true;
  }

  if (msg?.type === "CAPTURE_PRESEARCH_PROMO") {
    try {
      const promo = extractPreSearchPromoFromDom();
      sendResponse({ ok: true, promo: promo || null });
    } catch (err) {
      sendResponse({ ok: false, reason: String(err), promo: null });
    }
    return true;
  }
});
