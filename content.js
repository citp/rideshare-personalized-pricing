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
