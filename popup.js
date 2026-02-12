// Trip schedule is fetched from background.js TRIPS — single source of truth.
let TRIP_SCHEDULE = [];

document.addEventListener("DOMContentLoaded", () => {
  // Fetch the schedule once on popup open
  chrome.runtime.sendMessage({ type: "GET_TRIP_SCHEDULE" }, (schedule) => {
    if (chrome.runtime.lastError || !schedule) {
      console.warn("Could not fetch trip schedule:", chrome.runtime.lastError?.message);
      return;
    }
    TRIP_SCHEDULE = schedule;
    refreshUI(); // re-render now that we have the schedule
  });
  const downloadBtn = document.getElementById("download-btn");
  const statusDiv = document.getElementById("status");
  const tripListDiv = document.getElementById("trip-list");

  function refreshUI() {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (chrome.runtime.lastError || !state) {
        statusDiv.textContent = "Waiting for searches to begin…";
        statusDiv.className = "";
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Download CSV";
        tripListDiv.innerHTML = "";
        return;
      }

      const { running, totalSlots, results, loginRequired, tripStatuses, currentSlot, endTime } = state;
      const hasResults = results && results.length > 0;
      const successCount = (tripStatuses || []).filter(s => s === "success").length;
      const errorCount = (tripStatuses || []).filter(s => s === "no_data" || s === "no_prices").length;
      const skippedCount = (tripStatuses || []).filter(s => s === "skipped").length;
      const pendingCount = (tripStatuses || []).filter(s => s === "pending").length;
      const isDone = !running && !loginRequired && pendingCount === 0;

      // Remove login button if not needed
      const existingBtn = document.getElementById("login-btn");

      if (loginRequired) {
        statusDiv.textContent = "⚠ Not logged in.";
        statusDiv.className = "login-warning";
        if (!existingBtn) {
          const loginBtn = document.createElement("button");
          loginBtn.id = "login-btn";
          loginBtn.textContent = "Log in to Uber";
          loginBtn.style.cssText = "width:100%;padding:10px;margin-top:8px;margin-bottom:6px;cursor:pointer;font-size:14px;border:none;border-radius:4px;background:#2b6cb0;color:white;font-weight:600;";
          loginBtn.addEventListener("click", () => {
            chrome.tabs.create({ url: chrome.runtime.getURL("login-required.html"), active: true });
          });
          statusDiv.after(loginBtn);
        }
      } else if (running) {
        if (existingBtn) existingBtn.remove();
        // Find next upcoming trip for status display
        const searchingIdx = (tripStatuses || []).indexOf("searching");
        const nextPendingIdx = searchingIdx >= 0 ? searchingIdx : (tripStatuses || []).indexOf("pending");
        const nextTrip = nextPendingIdx >= 0 ? TRIP_SCHEDULE[nextPendingIdx] : null;
        const nextLabel = nextTrip ? `next: ${nextTrip.utcTime} UTC` : "waiting…";
        statusDiv.textContent = `Running — ${nextLabel} | ${successCount} captured, ${pendingCount} remaining`;
        statusDiv.className = "";
      } else if (isDone) {
        if (existingBtn) existingBtn.remove();
        statusDiv.textContent = `Done. ${successCount} captured, ${errorCount} errors, ${skippedCount} skipped.`;
        statusDiv.className = "done";
      } else {
        if (existingBtn) existingBtn.remove();
        statusDiv.textContent = `${successCount} captured so far.`;
        statusDiv.className = "";
      }

      downloadBtn.disabled = !hasResults;
      downloadBtn.textContent = isDone ? "Download CSV" : "Download CSV (partial)";

      renderTripList(state);
    });
  }

  function renderTripList(state) {
    const totalSlots = state?.totalSlots || TRIP_SCHEDULE.length;
    const statuses = state?.tripStatuses || [];
    // Find the "active" row: the first searching or pending trip (i.e., next to fire)
    let activeRow = -1;
    if (state.running) {
      for (let i = 0; i < totalSlots; i++) {
        if (statuses[i] === "searching") { activeRow = i; break; }
      }
      if (activeRow === -1) {
        for (let i = 0; i < totalSlots; i++) {
          if (statuses[i] === "pending") { activeRow = i; break; }
        }
      }
    }

    if (TRIP_SCHEDULE.length === 0) {
      tripListDiv.innerHTML = '<div style="font-size:12px;color:#666;">Loading trip schedule…</div>';
      return;
    }
    let html = '<div style="font-size:12px;color:#666;margin-bottom:6px;">';
    html += `${TRIP_SCHEDULE.length} trips · ${TRIP_SCHEDULE[0].utcTime}–${TRIP_SCHEDULE[TRIP_SCHEDULE.length-1].utcTime} UTC`;
    html += '</div>';

    html += '<div class="trip-table-wrapper"><table><tr><th>Time (UTC)</th><th>Trip</th><th>Status</th></tr>';
    for (let i = 0; i < totalSlots; i++) {
      const ts = statuses[i] || "pending";
      const sched = TRIP_SCHEDULE[i] || { utcTime: "??:??", label: "Unknown" };
      const utcTime = sched.utcTime;
      const label = sched.label;
      let statusText, cssClass;
      const isCurrent = (i === activeRow);

      switch (ts) {
        case "success":
          statusText = "✓";
          cssClass = "done";
          break;
        case "searching":
          statusText = "⏳";
          cssClass = "active";
          break;
        case "no_prices":
          statusText = "✗ no prices";
          cssClass = "error";
          break;
        case "no_data":
          statusText = "✗ no data";
          cssClass = "error";
          break;
        case "skipped":
          statusText = "–";
          cssClass = "skipped";
          break;
        default:
          statusText = "";
          cssClass = "pending";
      }
      const rowClass = isCurrent ? ' class="current-row"' : '';
      html += `<tr${rowClass}><td>${utcTime}</td><td>${label}</td><td class="${cssClass}">${statusText}</td></tr>`;
    }
    html += "</table></div>";
    // Preserve scroll position across refreshes
    const wrapper = tripListDiv.querySelector(".trip-table-wrapper");
    const prevScroll = wrapper ? wrapper.scrollTop : null;

    tripListDiv.innerHTML = html;

    const newWrapper = tripListDiv.querySelector(".trip-table-wrapper");
    if (newWrapper) {
      if (prevScroll !== null) {
        // Restore previous scroll position
        newWrapper.scrollTop = prevScroll;
      } else {
        // First render — scroll to current row
        const currentRow = newWrapper.querySelector(".current-row");
        if (currentRow) {
          currentRow.scrollIntoView({ block: "center" });
        }
      }
    }
  }

  // ── Download CSV ──
  downloadBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (!state || !state.results || state.results.length === 0) {
        statusDiv.textContent = "No results to download.";
        return;
      }

      const rows = state.results;
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(",")];

      for (const row of rows) {
        const values = headers.map((h) => {
          let v = row[h] ?? "";
          v = String(v).replace(/"/g, '""');
          if (/[,"\n]/.test(v)) v = `"${v}"`;
          return v;
        });
        csvLines.push(values.join(","));
      }

      const csv = csvLines.join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `uber_prices_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  // Trigger immediate login check
  chrome.runtime.sendMessage({ type: "CHECK_LOGIN_NOW" });

  // Initial render + auto-refresh
  refreshUI();
  setInterval(refreshUI, 3000);
});
