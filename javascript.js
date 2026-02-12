console.log("🚀 Uber interceptor loaded");

// Prevent double injection
if (!window.__UBER_INTERCEPTOR_INSTALLED__) {
  window.__UBER_INTERCEPTOR_INSTALLED__ = true;

  const originalFetch = window.fetch;

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);

    try {
      const url = args[0];

      if (typeof url === "string" && url.includes("/graphql")) {
        response.clone().json().then(data => {
          console.log("🔥 Intercepted Uber GraphQL:", data);

          chrome.storage.local.set({
            lastUberResponse: data
          });
        });
      }
    } catch (e) {
      console.log("Interceptor error:", e);
    }

    return response;
  };
}

