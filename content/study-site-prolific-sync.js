(function () {
  function applyInstallPageSuccessUi() {
    const path = location.pathname || "";
    if (!path.includes("install.html")) return;

    setTimeout(() => {
      const btn = document.getElementById("install-extension-btn");
      if (!btn || document.getElementById("extension-installed-msg")) return;

      btn.disabled = true;
      btn.classList.remove("is-link", "is-outlined");
      btn.classList.add("is-light");
      btn.title = "Extension is already installed.";

      const p = document.createElement("p");
      p.id = "extension-installed-msg";
      p.className = "help has-text-success mt-2";
      p.setAttribute("role", "status");
      p.textContent = "Extension installed successfully. Please return to the Qualtrics survey.";

      const field = btn.closest(".field");
      if (field) field.appendChild(p);
      else btn.parentElement.appendChild(p);
    }, 0);
  }

  function readStoredId() {
    try {
      const v = localStorage.getItem("prolific_id");
      return typeof v === "string" ? v.trim() : "";
    } catch (_) {
      return "";
    }
  }

  function sendToBackground(prolificId) {
    const id = typeof prolificId === "string" ? prolificId.trim() : "";
    if (!id) return;
    chrome.runtime.sendMessage(
      { type: "SYNC_PROLIFIC_ID_FROM_STUDY_SITE", prolificId: id },
      () => {
        if (chrome.runtime.lastError) {
          /* extension context invalid */
        }
      }
    );
  }

  sendToBackground(readStoredId());
  applyInstallPageSuccessUi();

  (function tryCaptureInstallSiteGeolocation() {
    const path = location.pathname || "";
    if (!path.includes("install.html")) return;
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos?.coords?.latitude;
        const lng = pos?.coords?.longitude;
        if (lat == null || lng == null) return;
        chrome.runtime.sendMessage(
          { type: "SAVE_STUDY_GEO_SNAPSHOT", latitude: lat, longitude: lng },
          () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          }
        );
      },
      () => {},
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
    );
  })();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== "rideshare-study-install" || d.type !== "PROLIFIC_ID") return;
    sendToBackground(d.prolificId);
  });
})();
