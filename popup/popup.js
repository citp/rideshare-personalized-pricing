// Trip schedule: background TRIPS (loaded from study ride-searches.html at install, then chrome.storage).
let TRIP_SCHEDULE = [];

function formatLocalDateTime(ms) {
  const date = new Date(ms);
  const dateLabel = date.toLocaleDateString([], { month: "short", day: "numeric" });
  const timeLabel = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${dateLabel} ${timeLabel}`;
}

function formatLocalTimeWithDayLabel(ms) {
  const date = new Date(ms);
  const now = new Date();
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  let dayLabel = "on " + date.toLocaleDateString([], { month: "short", day: "numeric" });
  if (dateOnly === todayOnly) {
    dayLabel = "today";
  } else if (dateOnly === todayOnly + dayMs) {
    dayLabel = "tomorrow";
  }

  const timeLabel = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${timeLabel} ${dayLabel}`;
}

function getNextUpcomingPendingIndex(statuses, schedule, nowMs = Date.now()) {
  if (!Array.isArray(statuses) || !Array.isArray(schedule)) return -1;
  for (let i = 0; i < statuses.length; i++) {
    if (statuses[i] !== "pending") continue;
    const runAtMs = schedule[i]?.runAtMs;
    if (Number.isFinite(runAtMs) && runAtMs >= nowMs) {
      return i;
    }
  }
  return -1;
}

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
  const failureAlertDiv = document.getElementById("failure-alert");
  const exportTimingLink = document.getElementById("export-timing-link");
  const verificationNoteDiv = document.createElement("div");
  verificationNoteDiv.id = "verification-note";
  verificationNoteDiv.style.cssText = "margin:8px 0 10px;font-size:12px;color:#4a5568;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;padding:6px 8px;white-space:pre-wrap;";
  tripListDiv.before(verificationNoteDiv);
  let refreshTimer = null;
  let refreshIntervalMs = 3000;

  function scheduleRefresh(ms) {
    if (refreshIntervalMs === ms && refreshTimer) return;
    refreshIntervalMs = ms;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshUI, refreshIntervalMs);
  }

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

      const {
        running,
        totalSlots,
        results,
        loginRequired,
        tripStatuses,
        prolificIdRequired,
        screenedOut,
        screenOutReason,
        profileVerificationFailed,
        profileVerification,
        tripHistoryVerificationFailed,
        tripHistoryVerification,
        searchHealth,
      } = state;
      const hasResults = results && results.length > 0;
      const successCount = (tripStatuses || []).filter(s => s === "success").length;
      const errorCount = (tripStatuses || []).filter(s => s === "no_data" || s === "no_prices").length;
      const missedLateCount = (tripStatuses || []).filter(s => s === "missed_late").length;
      const skippedCount = (tripStatuses || []).filter(s => s === "skipped").length;
      const pendingCount = (tripStatuses || []).filter(s => s === "pending").length;
      const searchingCount = (tripStatuses || []).filter(s => s === "searching").length;
      const isDone = !running && !loginRequired && pendingCount === 0;
      const hasVerificationResult =
        !!profileVerification ||
        !!tripHistoryVerification ||
        !!profileVerificationFailed ||
        !!tripHistoryVerificationFailed;
      const verificationInProgress =
        !prolificIdRequired &&
        !screenedOut &&
        !hasVerificationResult;
      const verificationCompleted =
        !prolificIdRequired &&
        !screenedOut &&
        !!profileVerification?.passed &&
        !!tripHistoryVerification?.passed;
      const canShowNextRide =
        !prolificIdRequired &&
        !screenedOut &&
        !!profileVerification?.passed &&
        !!tripHistoryVerification?.passed;
      const loginStatusLine = `Uber login status: ${loginRequired ? "not logged in" : "logged in"}`;
      const chromeVerificationStatus = prolificIdRequired
        ? "in-progress"
        : profileVerificationFailed
          ? "failed"
          : profileVerification?.passed
            ? "success"
            : "in-progress";
      const uberHistoryVerificationStatus = prolificIdRequired
        ? "in-progress"
        : tripHistoryVerificationFailed
          ? "failed"
          : tripHistoryVerification?.passed
            ? "success"
            : "in-progress";
      const verificationLines = [
        loginStatusLine,
        `Chrome activity verification: ${chromeVerificationStatus}`,
        `Uber history verification: ${uberHistoryVerificationStatus}`,
      ];
      if (searchHealth?.isFailing) {
        const n = searchHealth.sampleSize || 0;
        const ok = searchHealth.successCount ?? Math.max(0, n - (searchHealth.failedCount || 0));
        const pct = n > 0 ? Math.round((ok / n) * 100) : 0;
        failureAlertDiv.style.display = "block";
        failureAlertDiv.textContent = `Low success rate: ${ok}/${n} of the last ${n} completed searches succeeded (${pct}%).`;
      } else {
        failureAlertDiv.style.display = "none";
        failureAlertDiv.textContent = "";
      }

      const tripSummaries = tripHistoryVerification?.profileSummaries || [];
      const nonOkSummaries = tripSummaries.filter((s) => s && s.fetched && s.httpOk === false);
      const fetchFailures = tripSummaries.filter((s) => s && s.fetched === false);

      const hasVerificationFailure =
        !!profileVerificationFailed ||
        !!tripHistoryVerificationFailed ||
        fetchFailures.length > 0 ||
        nonOkSummaries.length > 0 ||
        !!profileVerification?.error ||
        !!tripHistoryVerification?.error;

      const detailParts = [];
      if (hasVerificationFailure) {
        if (profileVerification) {
          const activeDays = profileVerification?.activeDays ?? 0;
          const requiredActiveDays = profileVerification?.requiredActiveDays ?? 4;
          const totalLocal = profileVerification?.totalLocalActions ?? 0;
          detailParts.push(`Chrome activity: ${activeDays}/${requiredActiveDays} active days, ${totalLocal} local actions`);
          if (profileVerification?.error) detailParts.push(`Profile verification error: ${profileVerification.error}`);
        }
        if (tripHistoryVerification) {
          const trips = tripHistoryVerification?.totalTripsSinceCutoff ?? 0;
          const minTrips = tripHistoryVerification?.minTripsRequired ?? 5;
          const cutoff = tripHistoryVerification?.cutoffDateISO ?? "2025-03-01";
          let tripDetail = `Uber trips since ${cutoff}: ${trips}/${minTrips}`;
          if (fetchFailures.length > 0) {
            tripDetail += " (page fetch error)";
          } else if (nonOkSummaries.length > 0) {
            tripDetail += ` (non-OK: ${nonOkSummaries.map((s) => `${s.profile}:${s.httpStatus}`).join(", ")})`;
          }
          detailParts.push(tripDetail);
          if (tripHistoryVerification?.error) detailParts.push(`Trip history verification error: ${tripHistoryVerification.error}`);
          const summaries = tripHistoryVerification?.profileSummaries || [];
          for (const s of summaries) {
            if (!s) continue;
            const dbg = s.debug || {};
            detailParts.push(
              `${s.profile}: fetched=${s.fetched} listTs=${s.listTimestampCount ?? 0} links=${s.tripLinksFound ?? 0} found=${s.recentTripsFound ?? 0} sinceCutoff=${s.tripsSinceCutoff ?? 0} bodyText=${dbg.bodyTextLength ?? 0} timeEls=${dbg.timeElementCount ?? 0} loadingSeen=${dbg.sawLoadingText ? "yes" : "no"} maxLinksSeen=${dbg.maxTripLinksSeen ?? 0} loadMoreClicks=${dbg.loadMoreClicks ?? 0}${s.usedUrl ? ` url=${s.usedUrl}` : ""}${s.error ? ` error=${s.error}` : ""}`
            );
            if (dbg.bodySnippet) {
              detailParts.push(`  snippet: ${dbg.bodySnippet}`);
            }
          }
        }
      }
      if (detailParts.length > 0) {
        verificationNoteDiv.style.display = "block";
        verificationNoteDiv.textContent = detailParts.join("\n");
      } else {
        verificationNoteDiv.style.display = "none";
        verificationNoteDiv.textContent = "";
      }

      // Remove login button if not needed
      const existingBtn = document.getElementById("login-btn");

      if (screenedOut) {
        statusDiv.textContent =
          `⚠ Screened out (${screenOutReason || "verification_failed"}).\n\n` +
          `Please remove this extension: open chrome://extensions in the address bar, ` +
          `find "Princeton Uber Pricing Study", then click Remove.`;
        statusDiv.className = "login-warning";
        if (existingBtn) existingBtn.remove();
      } else if (prolificIdRequired) {
        statusDiv.textContent = `⚠ Prolific ID required. Enter it in the opened setup tab.\n${verificationLines.join("\n")}`;
        statusDiv.className = "login-warning";
        if (existingBtn) existingBtn.remove();
      } else if (loginRequired) {
        statusDiv.textContent = `⚠ Not logged in.\n${verificationLines.join("\n")}`;
        statusDiv.className = "login-warning";
        if (!existingBtn) {
          const loginBtn = document.createElement("button");
          loginBtn.id = "login-btn";
          loginBtn.textContent = "Log in to Uber";
          loginBtn.style.cssText = "width:100%;padding:10px;margin-top:8px;margin-bottom:6px;cursor:pointer;font-size:14px;border:none;border-radius:4px;background:#2b6cb0;color:white;font-weight:600;";
          loginBtn.addEventListener("click", () => {
            chrome.tabs.create({ url: STUDY_LOGIN_REQUIRED_URL, active: true });
          });
          statusDiv.after(loginBtn);
        }
      } else if (profileVerificationFailed) {
        const totalLocal = profileVerification?.totalLocalActions ?? 0;
        const minActions = profileVerification?.minActions ?? 500;
        const lookbackDays = profileVerification?.lookbackDays ?? 7;
        const activeDays = profileVerification?.activeDays ?? 0;
        const requiredActiveDays = profileVerification?.requiredActiveDays ?? 4;
        const minPerActiveDay = profileVerification?.minActionsPerActiveDay ?? 100;
        statusDiv.textContent = `⚠ Profile check failed: ${activeDays}/${requiredActiveDays} active days (>=${minPerActiveDay}/day) and ${totalLocal}/${minActions} local actions in last ${lookbackDays} days.\n${verificationLines.join("\n")}`;
        statusDiv.className = "login-warning";
        if (existingBtn) existingBtn.remove();
      } else if (tripHistoryVerificationFailed) {
        const totalTrips = tripHistoryVerification?.totalTripsSinceCutoff ?? 0;
        const minTrips = tripHistoryVerification?.minTripsRequired ?? 5;
        const cutoffDate = tripHistoryVerification?.cutoffDateISO ?? "2025-03-01";
        const summaries = tripHistoryVerification?.profileSummaries || [];
        const fetchErrors = summaries.filter((s) => s && s.fetched === false);
        const nonOk = summaries.filter((s) => s && s.fetched && s.httpOk === false);
        let reason = "";
        if (fetchErrors.length > 0) {
          reason = " Could not fetch one or more trips pages.";
        } else if (nonOk.length > 0) {
          const statuses = nonOk.map((s) => `${s.profile}:${s.httpStatus}`).join(", ");
          reason = ` Trips pages returned non-OK status (${statuses}).`;
        }
        statusDiv.textContent = `⚠ Uber trips check failed: found ${totalTrips}/${minTrips} trips since ${cutoffDate}.${reason}\n${verificationLines.join("\n")}`;
        statusDiv.className = "login-warning";
        if (existingBtn) existingBtn.remove();
      } else if (running) {
        if (existingBtn) existingBtn.remove();
        // Find next upcoming trip for status display
        const searchingIdx = (tripStatuses || []).indexOf("searching");
        const nextPendingIdx = searchingIdx >= 0
          ? searchingIdx
          : getNextUpcomingPendingIndex(tripStatuses || [], TRIP_SCHEDULE);
        const nextTrip = nextPendingIdx >= 0 ? TRIP_SCHEDULE[nextPendingIdx] : null;
        const nextLabel = canShowNextRide
          ? (nextTrip ? `Next ride search will happen at ${formatLocalTimeWithDayLabel(nextTrip.runAtMs)}` : "Waiting for next scheduled ride search")
          : "";
        const nextSentence = nextLabel ? `\n\n${nextLabel}.` : "";
        statusDiv.textContent = `${verificationLines.join("\n")}${nextSentence}`;
        statusDiv.className = "";
      } else if (isDone) {
        if (existingBtn) existingBtn.remove();
        statusDiv.textContent = `${verificationLines.join("\n")}\nDone: ${successCount} captured, ${errorCount} errors, ${missedLateCount} missed late, ${skippedCount} skipped.`;
        statusDiv.className = "done";
      } else {
        if (existingBtn) existingBtn.remove();
        const nextPendingIdx = getNextUpcomingPendingIndex(tripStatuses || [], TRIP_SCHEDULE);
        const nextTrip = nextPendingIdx >= 0 ? TRIP_SCHEDULE[nextPendingIdx] : null;
        const nextRideLabel = canShowNextRide
          ? (nextTrip ? ` Next ride search will happen at ${formatLocalTimeWithDayLabel(nextTrip.runAtMs)}.` : "")
          : "";
        const summaryLine = verificationCompleted
          ? "Verification completed."
          : `${successCount} captured so far.`;
        statusDiv.textContent = `${verificationLines.join("\n")}\n${summaryLine}${nextRideLabel}`;
        statusDiv.className = "";
      }

      downloadBtn.disabled = !hasResults;
      downloadBtn.textContent = isDone ? "Download CSV" : "Download CSV (partial)";

      const shouldPollFast =
        running ||
        loginRequired ||
        prolificIdRequired ||
        searchingCount > 0 ||
        pendingCount > 0;
      // 1s polling + heavy verification debug rebuilds stressed the popup renderer; 2s is enough for UX.
      scheduleRefresh(shouldPollFast ? 2000 : 3000);

      renderTripList(state);
    });
  }

  function renderTripList(state) {
    const totalSlots = state?.totalSlots || TRIP_SCHEDULE.length;
    const statuses = state?.tripStatuses || [];
    const currentSlot = Number.isInteger(state?.currentSlot) ? state.currentSlot : null;
    // Find the "active" row: searching only counts if it matches currentSlot (avoids orphan ⏳
    // when storage was not updated after advancing). If currentSlot is unknown, keep old behavior.
    let activeRow = -1;
    for (let i = 0; i < totalSlots; i++) {
      if (statuses[i] !== "searching") continue;
      if (currentSlot !== null && i !== currentSlot) continue;
      activeRow = i;
      break;
    }
    if (activeRow === -1) {
      const now = Date.now();
      for (let i = 0; i < totalSlots; i++) {
        if (statuses[i] !== "pending") continue;
        const runAtMs = TRIP_SCHEDULE[i]?.runAtMs;
        if (Number.isFinite(runAtMs) && runAtMs >= now) {
          activeRow = i;
          break;
        }
      }
    }
    if (activeRow === -1) {
      // Fallback for stale state: if all pending rows are already past due,
      // still highlight the first pending row.
      for (let i = 0; i < totalSlots; i++) {
        if (statuses[i] === "pending") {
          activeRow = i;
          break;
        }
      }
    }

    if (TRIP_SCHEDULE.length === 0) {
      tripListDiv.innerHTML = '<div style="font-size:12px;color:#666;">Loading trip schedule…</div>';
      return;
    }
    const capturedCount = statuses.filter((s) => s === "success").length;
    const remainingCount = statuses.filter((s) => s === "pending" || s === "searching").length;
    const progressLabel = `${capturedCount} captured, ${remainingCount} remaining`;

    let html = '<div style="font-size:12px;color:#666;margin-bottom:6px;">';
    html += `${progressLabel} · ${TRIP_SCHEDULE.length} trips · shown in your local time`;
    html += '</div>';

    html += '<div class="trip-table-wrapper"><table><tr><th>Time</th><th>Trip</th><th>Status</th></tr>';
    for (let i = 0; i < totalSlots; i++) {
      const ts = statuses[i] || "pending";
      const sched = TRIP_SCHEDULE[i] || { runAtMs: null, label: "Unknown" };
      const localTime = Number.isFinite(sched.runAtMs) ? formatLocalDateTime(sched.runAtMs) : "Unknown time";
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
        case "missed_late":
          statusText = "⏱ missed";
          cssClass = "error";
          break;
        default:
          statusText = "";
          cssClass = "pending";
      }
      const rowClass = isCurrent ? ' class="current-row"' : '';
      html += `<tr${rowClass}><td>${localTime}</td><td>${label}</td><td class="${cssClass}">${statusText}</td></tr>`;
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
  function getCsvHeaders(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const headers = [];
    for (const row of rows) {
      for (const key of Object.keys(row || {})) {
        if (!headers.includes(key)) headers.push(key);
      }
    }
    return headers;
  }

  downloadBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (!state || !state.results || state.results.length === 0) {
        statusDiv.textContent = "No results to download.";
        return;
      }

      const rows = state.results;
      const headers = getCsvHeaders(rows);
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

  function downloadCsv(rows, filenamePrefix) {
    if (!rows || rows.length === 0) {
      statusDiv.textContent = "No data to download.";
      return;
    }
    const headers = getCsvHeaders(rows);
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
    a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportTimingLink.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.runtime.sendMessage({ type: "GET_TIMING_LOG" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        statusDiv.textContent = `Could not export timing log: ${chrome.runtime.lastError?.message || resp?.error || "unknown error"}`;
        statusDiv.className = "login-warning";
        return;
      }
      downloadCsv(resp.rows, "uber_timing");
    });
  });

  // Trigger immediate login check
  chrome.runtime.sendMessage({ type: "CHECK_LOGIN_NOW" });

  // Initial render + auto-refresh
  refreshUI();
  scheduleRefresh(3000);
});
