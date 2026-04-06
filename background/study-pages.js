/* Hosted study UI (production site). Local unpacked extensions load these URLs. */
const STUDY_EXTENSION_PAGES_BASE = "https://rideshare-study.cs.princeton.edu/pricing/extension";

function studyExtensionPage(filename) {
  return `${STUDY_EXTENSION_PAGES_BASE}/${filename}`;
}

function getLoginRequiredPageUrl() {
  return studyExtensionPage("login-required.html");
}

function getScreenOutWarningPageUrl() {
  return studyExtensionPage("screen-out-warning.html");
}

function getProlificIdPromptUrl() {
  return `${STUDY_EXTENSION_PAGES_BASE}/prolific-id.html?ext=${encodeURIComponent(chrome.runtime.id)}`;
}
