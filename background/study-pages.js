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
  return `${STUDY_EXTENSION_PAGES_BASE}/install.html`;
}

/** Qualtrics continuation after extension + Chrome + Uber login + ride-count checks pass.
 *
 * URL embedded data (EXTENSION_INSTALLED) must match Survey Flow field names exactly; see:
 * https://www.qualtrics.com/support/survey-platform/survey-module/survey-flow/standard-elements/passing-information-through-query-strings/
 *
 * If a Survey Flow branch on EXTENSION_INSTALLED never fires:
 * - In the first "Embedded Data" element, add a field literally named EXTENSION_INSTALLED, value source
 *   "Value will be set from Panel or URL", and do NOT "Set a Value Now" (a fixed value blocks the URL).
 * - Publish the survey after flow changes; test in a private/incognito window (resume cookies can reopen
 *   the survey without your query string).
 * - Email/personal links that include Q_DL can let the contact list override URL embedded data—test with
 *   the plain anonymous /jfe/form/… link plus ?EXTENSION_INSTALLED=1 manually appended.
 * - EXTENSION_INSTALLED is listed first in the query string so it is not lost if anything truncates long URLs.
 */
const QUALTRICS_POST_ELIGIBILITY_FORM_BASE =
  "https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_6KEXKaPqGzxrtAi";

function buildQualtricsPostEligibilitySurveyUrl(prolificId) {
  const q = new URLSearchParams();
  q.set("EXTENSION_INSTALLED", "1");
  q.set("PROLIFIC_PID", prolificId != null ? String(prolificId).trim() : "");
  return `${QUALTRICS_POST_ELIGIBILITY_FORM_BASE}?${q.toString()}`;
}
