(function () {
  console.log("🚀 Uber interceptor (MAIN world) loaded");

  // --- Prevent Uber from detecting minimized/background tab ---
  Object.defineProperty(document, "hidden", { get: () => false });
  Object.defineProperty(document, "visibilityState", { get: () => "visible" });
  document.addEventListener("visibilitychange", (e) => e.stopImmediatePropagation(), true);

  // --- Intercept fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    let requestBodyText = "";
    try {
      const req = args[0];
      const init = args[1];
      if (typeof init?.body === "string") {
        requestBodyText = init.body;
      } else if (req && typeof req !== "string" && typeof req.text === "function") {
        requestBodyText = await req.clone().text();
      }
    } catch (_) {}
    const response = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
      if (url.includes("/graphql")) {
        response
          .clone()
          .json()
          .then((data) => {
            console.log("🔥 Intercepted fetch GraphQL:", url, data);
            window.postMessage(
              {
                type: "UBER_GRAPHQL_INTERCEPTED",
                url,
                payload: data,
                requestBodyText,
                transport: "fetch",
                interceptedAt: Date.now(),
              },
              "*"
            );
          })
          .catch(() => {});
      }
    } catch (e) {
      // ignore
    }
    return response;
  };

  // --- Intercept XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._interceptUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this._interceptBodyText = typeof body === "string" ? body : "";
    this.addEventListener("load", function () {
      try {
        if (this._interceptUrl && this._interceptUrl.includes("/graphql")) {
          const data = JSON.parse(this.responseText);
          console.log("🔥 Intercepted XHR GraphQL:", this._interceptUrl, data);
          window.postMessage(
            {
              type: "UBER_GRAPHQL_INTERCEPTED",
              url: this._interceptUrl,
              payload: data,
              requestBodyText: this._interceptBodyText || "",
              transport: "xhr",
              interceptedAt: Date.now(),
            },
            "*"
          );
        }
      } catch (e) {
        // ignore
      }
    });
    return origSend.apply(this, arguments);
  };
})();
