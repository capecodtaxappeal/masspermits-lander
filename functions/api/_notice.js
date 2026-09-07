// MassPermits — what we SAY when the news is bad. Pure renderers, no sending.
//
// WHY THIS IS A FILE AND NOT A PARAGRAPH IN A DOC
// ----------------------------------------------
// The gate can already tell, before anybody is mailed, that this week's file is
// short, old, or identical to last week's. Knowing that and not saying it is the
// 2026-08-03 shape: on that Monday the pipeline genuinely sent nothing, the
// customer emailed asking where his file was, and got no reply for 34 days. He
// cancelled inside that silence, days after volunteering a testimonial. The
// lesson recorded from it is one line: a smaller or older true file is
// deliverable, and silence is not.
//
// So every verdict this system can reach needs words attached to it, and the
// words have to exist BEFORE the Monday they are needed. Copy written in a hurry
// during an incident is copy written badly, by someone who is already annoyed.
//
// NOTHING HERE SENDS. Every export returns a string. There is no fetch, no
// Resend call, no R2 write, no import of anything that has one. Nothing in the
// codebase imports this file yet; see BUILD_presend.md §5 for the two-line
// change that wires it in, and why that change belongs to the ENFORCE stage
// rather than to this one.
//
// VOICE. Short sentences. Plain words. No exclamation marks, no marketing
// voice, no em dashes. Say the bad thing first, say what we are doing about it,
// then offer the refund without being asked. That is drawn from the copy
// already shipping in weekly-send.js:174 ("Everything in the attached file is
// real and current ... If a reduced feed is not worth your subscription in the
// meantime, reply and we will refund you"), which is the closest thing to a
// verified sample of Patrick's own voice reachable from this machine. The Gmail
// connector timed out on 2026-09-06 and 2026-09-07, so his sent mail was NOT
// read for this; treat the voice match as inferred from shipped copy, not
// confirmed against his correspondence.

// ── the inline block, for a file that IS going out ─────────────────────────
// Rendered ABOVE the download button, never under it, for the same reason the
// coverage note is: a subscriber should learn what is short from us, in the
// same email, not by counting rows themselves.
//
// `codes` are the machine-readable disclosure codes from _presend.js:
//   data_from_earlier_day · no_new_rows · no_newer_permits · reduced_coverage
// `facts` supplies the dates those sentences need. Any code with no fact to
// support it is DROPPED rather than rendered with a blank: a sentence reading
// "the same permits as the file we sent you on undefined" is worse than no
// sentence at all.
export function disclosureBlock(codes, facts = {}) {
  const c = new Set(Array.isArray(codes) ? codes : []);
  const lines = [];

  if (c.has("data_from_earlier_day") && facts.data_date) {
    lines.push(
      `The permits in this file were collected on ${facts.data_date}, not this morning. ` +
      "Monday's data run did not finish in time, so this is the most recent complete " +
      "file we have. Everything in it is real. Nothing was added to fill the gap.");
  }

  if (c.has("no_new_rows") && facts.previous_date) {
    lines.push(
      `This file contains the same permits as the one we sent you on ${facts.previous_date}. ` +
      "No town we cover published anything new in between. We are sending it anyway, with " +
      "that said plainly, rather than skipping your Monday email and leaving you to wonder. " +
      "If this happens two weeks running, reply and we will credit the week.");
  } else if (c.has("no_newer_permits") && facts.max_issued_date) {
    lines.push(
      `Some rows have changed since last week, but the newest permit in this file is still ` +
      `dated ${facts.max_issued_date}, the same as last week's. Several of the towns we ` +
      "cover publish once a month, so their permits arrive in a batch rather than weekly. " +
      "Every row shows its own issue date.");
  }

  if (!lines.length) return "";
  return (
    '<div style="background:#fff8e1;border:1px solid #f0b429;border-radius:10px;' +
    'padding:14px 16px;margin:0 0 18px">' +
    '<p style="margin:0 0 8px;font-weight:700;color:#8a5a00">About this week\'s file</p>' +
    lines.map((t) => `<p style="margin:0 0 8px;color:#5c4300;font-size:14px">${esc(t)}</p>`).join("") +
    '<p style="margin:0;color:#5c4300;font-size:14px">Reply to this email if you want to ' +
    'talk about your subscription. We will not argue about a refund.</p></div>'
  );
}

// ── the standalone email, for a week where NOTHING goes out ────────────────
// This is the one that did not exist on 2026-08-03, and its absence is the only
// cancellation in company history. It is sent INSTEAD of the bundle, when the
// gate returns customer_gets_nothing and there is no honest file to attach.
//
// It deliberately does not explain the mechanism. "A gate exited 1 and skipped
// the upload step" is true and useless to a tile contractor. What he needs is:
// nothing is coming today, here is when it will, here is your money back if you
// want it.
export function nothingThisWeek({ first_name = "", reason_code = "", eta = "" } = {}) {
  const hi = first_name ? "Hi " + first_name : "Hi";
  // One plain sentence per gate code. The operator-facing detail stays in the
  // alert to Patrick; the customer gets the consequence, not the diagnosis.
  const why = {
    broken: "Our data refresh failed overnight, so the only file we could have sent you " +
            "today would have been last week's with today's date on it.",
    too_old: "Our data refresh has not run cleanly for two days, so the only file we could " +
             "have sent you today would have been out of date.",
    no_bundle: "This week's file did not build, so there is nothing we can honestly send you " +
               "today.",
    already_delivered: "This week's data run produced the same permits you already have, so " +
                       "there is nothing new to send you today.",
  }[reason_code] || "This week's file did not build correctly, so there is nothing we can " +
                    "honestly send you today.";

  const when = eta
    ? `We are fixing it now. You should have this week's file by ${eta}. `
    : "We are fixing it now and will send this week's file as soon as the data run is clean. ";

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;color:#0e1622">' +
    '<h2 style="color:#0e7c6b">No leads file this week, and why</h2>' +
    `<p>${esc(hi)}, your weekly file did not go out today.</p>` +
    `<p>${esc(why)}</p>` +
    `<p>${esc(when)}If it is not with you by then, reply to this email and we will refund ` +
    'the week. No argument.</p>' +
    '<p>We would rather tell you than send you last week\'s permits with a new date on them.</p>' +
    '<p style="color:#667;font-size:13px">Just reply with any questions.<br>' +
    '&mdash; MassPermits &middot; masspermits.com</p></div>';

  return { subject: "No MassPermits file this week, and why", html };
}

// ── the operator alert ──────────────────────────────────────────────────────
// Goes to Patrick, not to a customer, so this one DOES carry the diagnosis.
// The first line is the action, because it is read on a phone.
export function ownerAlert(gate) {
  const g = gate || {};
  const acted = g.customer_gets_nothing
    ? "A PAYING SUBSCRIBER GETS NOTHING THIS WEEK unless you send them something."
    : "No customer impact yet.";
  return {
    subject: "MassPermits pre-send: " + (g.verdict || "unknown"),
    html:
      '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">' +
      `<h2 style="color:#b45309">Pre-send gate: ${esc(g.verdict || "unknown")}</h2>` +
      `<p style="font-size:16px"><b>${esc(acted)}</b></p>` +
      "<ul>" + (g.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("") + "</ul>" +
      ((g.notes || []).length
        ? "<p style=\"color:#667;font-size:13px\">Context that did not decide anything:</p><ul>" +
          g.notes.map((n) => `<li style="color:#667;font-size:13px">${esc(n)}</li>`).join("") + "</ul>"
        : "") +
      '<p><a href="https://masspermits.com/admin/now">Open the board</a></p></div>',
  };
}

// Customer names and town names reach these templates. Escape everything: an
// apostrophe in a company name must not be able to break the markup, and
// nothing from a data file should ever be interpolated raw into an email.
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
