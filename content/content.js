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

const _graphqlEvents = [];
const MAX_GRAPHQL_EVENTS = 120;

function pushGraphqlEvent(evt) {
  _graphqlEvents.push(evt);
  if (_graphqlEvents.length > MAX_GRAPHQL_EVENTS) {
    _graphqlEvents.splice(0, _graphqlEvents.length - MAX_GRAPHQL_EVENTS);
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "UBER_GRAPHQL_INTERCEPTED") return;

  pushGraphqlEvent({
    payload: event.data.payload,
    requestBodyText: typeof event.data.requestBodyText === "string" ? event.data.requestBodyText : "",
    interceptedAt: Number(event.data.interceptedAt) || Date.now(),
    url: event.data.url || "",
  });

  const payload = event.data.payload;

  if (payload?.data?.products) {
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
  }
});

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function collectElementsDeep(selector, root = document) {
  const results = [];
  const seen = new Set();
  const walk = (nodeRoot) => {
    if (!nodeRoot || typeof nodeRoot.querySelectorAll !== "function") return;
    const matches = nodeRoot.querySelectorAll(selector);
    for (const el of matches) {
      if (seen.has(el)) continue;
      seen.add(el);
      results.push(el);
    }
    const all = nodeRoot.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return results;
}

function normalizeProductToken(text) {
  return normalizeText(text)
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

function tokenizeProductWords(text) {
  const t = normalizeProductToken(text);
  return t ? t.split(/\s+/).filter(Boolean) : [];
}

/**
 * Tokens from primary CTAs on product-selection (e.g. "Request Car Seat") must never match product
 * names by substring (e.g. "car seat" inside "request car seat").
 */
function tokenLooksLikePrimaryRequestCta(token) {
  if (!token || typeof token !== "string") return false;
  const t = token.trim().toLowerCase();
  if (/^request\b/.test(t)) return true;
  if (/^book\b.*\b(ride|trip)\b/.test(t)) return true;
  if (/^confirm\b/.test(t)) return true;
  if (/^order\b/.test(t)) return true;
  return false;
}

/** True for the bottom (or any) primary ride-booking control — never click programmatically. */
function elementLooksLikePrimaryRideRequestCta(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return false;
  const tag = (el.tagName || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  const actionable = tag === "button" || tag === "a" || role === "button";
  const aria = normalizeText(el.getAttribute("aria-label") || "").toLowerCase();
  const tip = normalizeText(el.textContent || "").slice(0, 200).toLowerCase();
  const label = `${aria} ${tip}`.trim();
  if (!label) return false;
  if (/^request\s/.test(label)) return actionable || tag === "div";
  if (/^book\s/.test(label) && /\b(ride|trip)\b/.test(label)) return actionable;
  if (/^confirm\s/.test(label)) return actionable;
  if (/\b(visa|mastercard|amex)\b.*•/.test(label) && /\brequest\b/.test(label)) return actionable;
  return false;
}

function parseBreakdownFromOpenDialog() {
  const dialogs = collectElementsDeep('[role="dialog"], [aria-modal="true"]');
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

  const closeCandidate = collectElementsDeep("button,[role='button']", modal).find((el) =>
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

function readAmountCandidate(v) {
  if (typeof v === "number" && Number.isFinite(v)) return `$${v.toFixed(2)}`;
  if (typeof v !== "string") return "";
  const m = v.match(/\$[0-9]+(?:\.[0-9]{1,2})?/);
  return m ? m[0] : "";
}

function fillBreakdownByLabel(target, label, amount) {
  const l = normalizeText(label).toLowerCase();
  if (!l || !amount) return;
  if (l.includes("base fare")) target.baseFare = target.baseFare || amount;
  else if (l.includes("minimum fare")) target.minimumFare = target.minimumFare || amount;
  else if (l.includes("per minute")) target.perMinute = target.perMinute || amount;
  else if (l.includes("per mile")) target.perMile = target.perMile || amount;
  else if (l.includes("estimated surcharges")) target.estimatedSurcharges = target.estimatedSurcharges || amount;
  else if (l.includes("booking fee")) target.bookingFee = target.bookingFee || amount;
}

function extractBreakdownFromGraphqlPayload(payload) {
  const out = {
    baseFare: "",
    minimumFare: "",
    perMinute: "",
    perMile: "",
    estimatedSurcharges: "",
    bookingFee: "",
    waitTimeDetail: "",
  };
  if (!payload || typeof payload !== "object") return out;
  const stack = [payload];
  const seen = new Set();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const label = node.label || node.title || node.name || node.description || "";
    const amount =
      readAmountCandidate(node.amount) ||
      readAmountCandidate(node.value) ||
      readAmountCandidate(node.displayValue) ||
      readAmountCandidate(node.formattedValue) ||
      readAmountCandidate(node.localizedValue) ||
      readAmountCandidate(node.price) ||
      readAmountCandidate(node.fee);
    if (label && amount) fillBreakdownByLabel(out, label, amount);

    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (!out.baseFare && key.includes("base") && key.includes("fare")) out.baseFare = readAmountCandidate(v);
      if (!out.minimumFare && key.includes("minimum") && key.includes("fare")) out.minimumFare = readAmountCandidate(v);
      if (!out.perMinute && key.includes("per") && key.includes("minute")) out.perMinute = readAmountCandidate(v);
      if (!out.perMile && key.includes("per") && key.includes("mile")) out.perMile = readAmountCandidate(v);
      if (!out.estimatedSurcharges && key.includes("surcharge")) out.estimatedSurcharges = readAmountCandidate(v);
      if (!out.bookingFee && key.includes("booking") && key.includes("fee")) out.bookingFee = readAmountCandidate(v);
      if (!out.waitTimeDetail && typeof v === "string" && /wait time|waited \d+ minute/i.test(v)) out.waitTimeDetail = normalizeText(v);
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return out;
}

function hasBreakdownValues(detail) {
  if (!detail || typeof detail !== "object") return false;
  return Boolean(
    detail.baseFare ||
      detail.minimumFare ||
      detail.perMinute ||
      detail.perMile ||
      detail.estimatedSurcharges ||
      detail.bookingFee
  );
}

function eventLikelyForProduct(evt, productName) {
  const words = tokenizeProductWords(productName);
  if (words.length === 0) return false;
  const req = normalizeProductToken(evt?.requestBodyText || "");
  const payload = normalizeProductToken(JSON.stringify(evt?.payload || ""));
  const combined = `${req} ${payload}`;
  let hits = 0;
  for (const w of words) {
    if (w.length < 3) continue;
    if (combined.includes(w)) hits++;
  }
  return hits >= Math.max(1, words.length - 1);
}

function getLatestGraphqlBreakdownSince(startedAt, productName = "") {
  for (let i = _graphqlEvents.length - 1; i >= 0; i--) {
    const evt = _graphqlEvents[i];
    if ((evt?.interceptedAt || 0) < startedAt) break;
    if (productName && !eventLikelyForProduct(evt, productName)) continue;
    const parsed = extractBreakdownFromGraphqlPayload(evt.payload);
    if (hasBreakdownValues(parsed)) {
      return parsed;
    }
  }
  for (let i = _graphqlEvents.length - 1; i >= 0; i--) {
    const evt = _graphqlEvents[i];
    if ((evt?.interceptedAt || 0) < startedAt) break;
    const parsed = extractBreakdownFromGraphqlPayload(evt.payload);
    if (hasBreakdownValues(parsed)) {
      return parsed;
    }
  }
  return null;
}

function findClickableProductCard(productName) {
  const desired = normalizeProductToken(productName);
  const all = collectElementsDeep("*");
  const isClickable = (el) => {
    if (!el) return false;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (el.tagName === "BUTTON" || el.tagName === "A") return true;
    if (role === "button" || role === "option") return true;
    if (typeof el.onclick === "function") return true;
    return false;
  };
  const resolveClickableAncestor = (el) => {
    let cur = el;
    for (let i = 0; i < 8 && cur; i++) {
      if (isClickable(cur)) return cur;
      cur = cur.parentElement;
    }
    return null;
  };
  const candidates = [];
  for (const el of all) {
    const txt = normalizeText(el.textContent || "");
    if (!txt) continue;
    const token = normalizeProductToken(txt);
    if (!token || tokenLooksLikePrimaryRequestCta(token) || !token.includes(desired)) continue;
    const clickable = resolveClickableAncestor(el) || el;
    if (elementLooksLikePrimaryRideRequestCta(clickable)) continue;
    const rect = clickable.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    const score =
      (isClickable(clickable) ? 1000 : 0) +
      (txt.toLowerCase().startsWith(productName.toLowerCase()) ? 120 : 0) +
      Math.min(500, rect.width * rect.height * 0.01);
    candidates.push({ clickable, score });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].clickable;
}

function resolveProductClickTargets(productNames) {
  const targets = new Map();
  const wanted = productNames
    .map((name) => ({ raw: name, token: normalizeProductToken(name) }))
    .filter((x) => x.token);
  if (wanted.length === 0) return targets;

  const all = collectElementsDeep("li,[role='option'],button,[role='button'],a,div");
  const cards = [];
  for (const el of all) {
    const txt = normalizeText(el.textContent || "");
    if (!txt) continue;
    const token = normalizeProductToken(txt);
    if (!token || tokenLooksLikePrimaryRequestCta(token)) continue;
    if (elementLooksLikePrimaryRideRequestCta(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    cards.push({ el, token, area: rect.width * rect.height, top: rect.top, left: rect.left });
  }

  // Preserve UI order so top-visible rows (often Comfort/UberX/UberXL) get deterministic matches.
  cards.sort((a, b) => (a.top - b.top) || (a.left - b.left));
  const used = new Set();
  for (const w of wanted) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < cards.length; i++) {
      if (used.has(i)) continue;
      const c = cards[i];
      if (tokenLooksLikePrimaryRequestCta(c.token)) continue;
      if (!c.token.includes(w.token) && !w.token.includes(c.token)) continue;
      const score =
        (c.token === w.token ? 4000 : 0) +
        (c.token.startsWith(w.token) ? 1000 : 0) +
        Math.min(600, c.area * 0.01) -
        i * 2;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      targets.set(w.raw, cards[bestIdx].el);
    }
  }
  return targets;
}

function isLikelySelectedProductNode(el) {
  if (!el) return false;
  const ariaSelected = (el.getAttribute("aria-selected") || "").toLowerCase();
  if (ariaSelected === "true") return true;
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (role === "option" && ariaSelected === "true") return true;
  const cls = (el.className || "").toString().toLowerCase();
  if (cls.includes("selected") || cls.includes("active")) return true;
  return false;
}

function getOpenTargetsFromRow(rowEl) {
  if (!rowEl || typeof rowEl.querySelectorAll !== "function") return [rowEl];
  const candidates = Array.from(rowEl.querySelectorAll("button,[role='button'],a,[tabindex]"));
  const scored = [];
  for (const el of candidates) {
    if (elementLooksLikePrimaryRideRequestCta(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) continue;
    const role = (el.getAttribute("role") || "").toLowerCase();
    const score = rect.width * rect.height + (role === "button" || el.tagName === "BUTTON" ? 400 : 0);
    scored.push({ el, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const ordered = scored.map((x) => x.el);
  // Fall back to row itself as last attempt.
  ordered.push(rowEl);
  return Array.from(new Set(ordered));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureProductBreakdown(productName, perProductTimeoutMs, preferredClickable = null) {
  const captureWindowStartEvents = _graphqlEvents.length;
  const graphqlSinceCaptureStart = () => Math.max(0, _graphqlEvents.length - captureWindowStartEvents);

  const attemptClickAndWait = async () => {
    let detailClickDispatchCount = 0;
    const rowOpenClick = (el) => {
      if (!el || elementLooksLikePrimaryRideRequestCta(el)) return false;
      try {
        el.click();
        detailClickDispatchCount += 1;
        return true;
      } catch (_) {
        return false;
      }
    };

    const hasPreferred =
      preferredClickable &&
      preferredClickable.isConnected &&
      typeof preferredClickable.getBoundingClientRect === "function";
    const clickable = hasPreferred ? preferredClickable : findClickableProductCard(productName);
    if (!clickable) {
      return {
        done: true,
        result: {
          breakdownCaptureStatus: "click_not_found",
          breakdownCaptureError: "product_card_missing",
          detailClickAttempted: true,
          detailClickMatchedNode: "",
          detailGraphqlEventsSeenAfterClick: graphqlSinceCaptureStart(),
          detailClickDispatchCount: 0,
          detailProductWasPreselected: false,
        },
      };
    }
    const matchedNode = `${clickable.tagName.toLowerCase()}${clickable.id ? `#${clickable.id}` : ""}`;
    clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const started = Date.now();
    const eventsBeforeClick = _graphqlEvents.length;
    const wasPreselected = isLikelySelectedProductNode(clickable);
    let sawModalWithoutAmounts = false;
    let lastModalDetail = null;
    const pollForBreakdown = async (maxMs) => {
      const phaseStart = Date.now();
      while (Date.now() - phaseStart < maxMs) {
        const gqlBreakdown = getLatestGraphqlBreakdownSince(started, productName);
        if (gqlBreakdown) {
          return {
            done: true,
            result: {
              ...gqlBreakdown,
              breakdownCaptureStatus: "ok_graphql",
              breakdownCaptureError: "",
              detailClickAttempted: true,
              detailClickMatchedNode: matchedNode,
              detailGraphqlEventsSeenAfterClick: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
              detailClickDispatchCount,
              detailProductWasPreselected: wasPreselected,
            },
          };
        }
        const detail = parseBreakdownFromOpenDialog();
        if (detail) {
          const parsedAny = hasBreakdownValues(detail);
          if (parsedAny) {
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
                detailClickAttempted: true,
                detailClickMatchedNode: matchedNode,
                detailGraphqlEventsSeenAfterClick: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
                detailClickDispatchCount,
                detailProductWasPreselected: wasPreselected,
              },
            };
          }
          sawModalWithoutAmounts = true;
          lastModalDetail = detail;
        }
        await sleep(140);
      }
      if (sawModalWithoutAmounts && lastModalDetail) {
        if (lastModalDetail.closeCandidate) {
          lastModalDetail.closeCandidate.click();
        } else {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        }
        return {
          done: true,
          result: {
            baseFare: "",
            minimumFare: "",
            perMinute: "",
            perMile: "",
            estimatedSurcharges: "",
            bookingFee: "",
            waitTimeDetail: lastModalDetail.waitTimeDetail || "",
            breakdownCaptureStatus: "ok_modal_empty",
            breakdownCaptureError: "breakdown_modal_parse_empty",
            detailClickAttempted: true,
            detailClickMatchedNode: matchedNode,
            detailGraphqlEventsSeenAfterClick: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
            detailClickDispatchCount,
            detailProductWasPreselected: wasPreselected,
          },
        };
      }
      return { done: false };
    };

    // Step 1: select the row.
    await sleep(120);
    rowOpenClick(clickable);
    const firstPass = await pollForBreakdown(Math.min(1800, Math.floor(perProductTimeoutMs * 0.3)));
    if (firstPass.done) return firstPass;

    // Step 2: explicit "open details" action with multiple targets/retries.
    await sleep(180);
    try {
      clickable.focus?.();
      clickable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      clickable.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    } catch (_) {}
    const openTargets = getOpenTargetsFromRow(clickable).slice(0, 4);
    for (const target of openTargets) {
      if (!rowOpenClick(target)) continue;
      const secondPass = await pollForBreakdown(Math.min(2600, perProductTimeoutMs));
      if (secondPass.done) return secondPass;
      // If no signal yet, re-select row before trying the next target.
      rowOpenClick(clickable);
      await sleep(120);
    }

    while (Date.now() - started < perProductTimeoutMs + 500) {
      const gqlBreakdown = getLatestGraphqlBreakdownSince(started, productName);
      if (gqlBreakdown) {
        return {
          done: true,
          result: {
            ...gqlBreakdown,
            breakdownCaptureStatus: "ok_graphql",
            breakdownCaptureError: "",
            detailClickAttempted: true,
            detailClickMatchedNode: matchedNode,
            detailGraphqlEventsSeenAfterClick: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
            detailClickDispatchCount,
            detailProductWasPreselected: wasPreselected,
          },
        };
      }
      const detail = parseBreakdownFromOpenDialog();
      if (detail) {
        const parsedAny = hasBreakdownValues(detail);
        if (parsedAny) {
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
              detailClickAttempted: true,
              detailClickMatchedNode: matchedNode,
              detailGraphqlEventsSeenAfterClick: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
              detailClickDispatchCount,
              detailProductWasPreselected: wasPreselected,
            },
          };
        }
      }
      await sleep(140);
    }
    const eventsSeen = Math.max(0, _graphqlEvents.length - eventsBeforeClick);
    if (eventsSeen === 0) {
      // Targeted recovery: when no post-click events were seen at all, retry open flow once more.
      try {
        rowOpenClick(clickable);
        await sleep(180);
        clickable.focus?.();
        clickable.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        clickable.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      } catch (_) {}
      const openTargets = getOpenTargetsFromRow(clickable).slice(0, 3);
      for (const target of openTargets) {
        if (!rowOpenClick(target)) continue;
        const recovery = await pollForBreakdown(1800);
        if (recovery.done) return recovery;
      }
    }
    return {
      done: false,
      dispatchCount: detailClickDispatchCount,
      graphqlDelta: Math.max(0, _graphqlEvents.length - eventsBeforeClick),
    };
  };

  const first = await attemptClickAndWait();
  if (first.done) return first.result;
  let timeoutClickDispatches = first.dispatchCount ?? 0;
  // Retry once in case first click did not open the sheet.
  await sleep(220);
  const second = await attemptClickAndWait();
  if (second.done) return second.result;
  timeoutClickDispatches += second.dispatchCount ?? 0;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return {
    breakdownCaptureStatus: "timeout",
    breakdownCaptureError: "breakdown_dialog_timeout",
    detailClickAttempted: true,
    detailClickMatchedNode: "",
    detailGraphqlEventsSeenAfterClick: graphqlSinceCaptureStart(),
    detailClickDispatchCount: timeoutClickDispatches,
    detailProductWasPreselected: false,
  };
}

async function captureBreakdownsForProducts(productNames, timeoutMs) {
  const breakdowns = {};
  const failedProducts = [];
  const safeTimeout = Number.isFinite(Number(timeoutMs)) ? Math.max(8000, Number(timeoutMs)) : 30000;
  const perProductTimeoutMs = Math.min(12000, Math.max(6000, Math.floor(safeTimeout / Math.max(productNames.length, 1))));
  const preResolvedTargets = resolveProductClickTargets(productNames);

  for (const rawName of productNames) {
    const productName = normalizeText(rawName);
    if (!productName) continue;
    try {
      const directTarget = preResolvedTargets.get(productName) || null;
      const detail = await captureProductBreakdown(productName, perProductTimeoutMs, directTarget);
      breakdowns[productName] = detail;
      if (
        detail.breakdownCaptureStatus !== "ok" &&
        detail.breakdownCaptureStatus !== "ok_graphql" &&
        detail.breakdownCaptureStatus !== "ok_modal_empty"
      ) {
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
    if (!text || text.length < 6) continue;
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
