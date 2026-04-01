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
  if (msg?.type !== "GET_BROWSER_LOCATION") return;
  getBrowserLocation()
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, reason: String(err) }));
  return true;
});
