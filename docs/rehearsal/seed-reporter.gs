/**
 * MassPermits monday rehearsal: the seed reporter (C20). Google Apps Script.
 *
 * Runs in the Google account of ONE seed inbox (an address listed in the
 * Function's REHEARSAL_SEEDS). It looks for Sunday's seed email, whose subject
 * ends "(preview MMDD)", and reports where it landed to the rehearsal-seed
 * route: {run, placement, has_attachment}, nothing else. It sends no email,
 * reads no other message and reports no address, subject or content.
 *
 * Setup (once, in the seed account):
 *   1. script.google.com > New project, paste this file.
 *   2. Project Settings > Script Properties: add REHEARSAL_SEED_TOKEN with the
 *      same value as the Pages secret REHEARSAL_SEED_TOKEN. The token lives
 *      only there; never paste it into this file.
 *   3. Run installTrigger() once and accept the Gmail (read-only search) and
 *      external-request permissions. It runs report() every hour.
 *
 * What it posts:
 *   run             whole hours from 00:00Z of that Sunday (0-48). Outside
 *                   that window it posts nothing.
 *   placement       "inbox" if found in the inbox, else "spam" if found in
 *                   spam, else "missing" (posted only from hour 36, Monday
 *                   12:00Z, so a late Sunday run is not reported missing).
 *   has_attachment  true when the message carries a .zip attachment.
 * It posts only when the placement or attachment state changes for that
 * Sunday. The route stores the report under that Sunday's date, which it
 * computes from its own clock, never from this body.
 */

var SEED_ROUTE = "https://masspermits.com/api/rehearsal-seed";
var DAY_MS = 24 * 3600 * 1000;
var MISSING_FROM_HOUR = 36;

// The most recent Sunday (UTC) at or before `now`, as a Date at 00:00Z.
function sundayOf_(now) {
  var d0 = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return new Date(d0 - new Date(d0).getUTCDay() * DAY_MS);
}

function pad2_(n) { return (n < 10 ? "0" : "") + n; }

// The subject marker for that Sunday: "(preview MMDD)".
function marker_(sunday) {
  return "(preview " + pad2_(sunday.getUTCMonth() + 1) + pad2_(sunday.getUTCDate()) + ")";
}

// Threads in one place whose subject carries the marker, received in the
// last 3 days.
function find_(where, mark) {
  return GmailApp.search('in:' + where + ' subject:"' + mark + '" newer_than:3d', 0, 5);
}

function hasZip_(threads) {
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var atts = msgs[j].getAttachments();
      for (var k = 0; k < atts.length; k++) {
        if (/\.zip$/i.test(atts[k].getName())) return true;
      }
    }
  }
  return false;
}

function report() {
  var now = new Date();
  var sunday = sundayOf_(now);
  var run = Math.floor((now.getTime() - sunday.getTime()) / 3600000);
  if (run < 0 || run > 48) return;
  var mark = marker_(sunday);

  var placement = "missing";
  var threads = find_("inbox", mark);
  if (threads.length) placement = "inbox";
  else {
    threads = find_("spam", mark);
    if (threads.length) placement = "spam";
  }
  if (placement === "missing" && run < MISSING_FROM_HOUR) return;
  var hasAttachment = placement === "missing" ? false : hasZip_(threads);

  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("REHEARSAL_SEED_TOKEN");
  if (!token) { console.log("seed reporter: REHEARSAL_SEED_TOKEN is not set"); return; }
  var stateKey = "posted-" + sunday.toISOString().slice(0, 10);
  var state = placement + "/" + hasAttachment;
  if (props.getProperty(stateKey) === state) return;

  var res = UrlFetchApp.fetch(SEED_ROUTE, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ run: run, placement: placement, has_attachment: hasAttachment }),
    muteHttpExceptions: true,
    followRedirects: false
  });
  var code = res.getResponseCode();
  // Status code only: never log the token, the response body or the message.
  console.log("seed reporter: " + placement + ", status " + code);
  if (code === 200) props.setProperty(stateKey, state);
}

function installTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "report") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("report").timeBased().everyHours(1).create();
}
