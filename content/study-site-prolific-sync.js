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

      const wrap = document.createElement("div");
      wrap.id = "extension-installed-msg";
      wrap.className = "notification is-light mt-4 mb-0";
      wrap.setAttribute("role", "status");
      wrap.innerHTML = `
        <div class="icon-text mb-3">
          <span class="icon has-text-success"><i class="fas fa-circle-check" aria-hidden="true"></i></span>
          <div>
            <p class="title is-6 has-text-black mb-1">Extension installed.</p>
            <p class="is-size-6 has-text-grey-dark mb-2">
              Verification checks are running in the background.
              <span class="tag is-info is-light is-rounded ml-1">This may take up to ~5 min</span>
            </p>
            <p class="is-size-6 has-text-grey-dark mb-0">
              If verification succeeds, you will be automatically redirected to complete the Qualtrics survey.
            </p>
          </div>
        </div>
      `;

      const field = btn.closest(".field");
      if (field) field.appendChild(wrap);
      else btn.parentElement.appendChild(wrap);
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
