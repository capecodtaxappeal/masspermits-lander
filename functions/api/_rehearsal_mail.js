// MassPermits monday rehearsal: the weekly email, rendered without sending it.
//
// A byte-for-byte mirror of ONLY the html and subject expressions of
// sendEmail() in weekly-send.js (lines 179-225, the subject ternary at
// 231-232 and the attachment filename template at 234). Nothing else is
// copied: there is no network call in this file. The one deliberate change is
// `d`, which takes the date it is given so a rehearsal can render a chosen day.
//
// Do NOT improve the copy. The mirror must reproduce today's shipped text
// exactly, stale sentences included; rehearsal_mirror.test.mjs fails the moment
// the two differ.

export function renderWeekly({ name, token, coverage, date }) {
  name = name || "";
  token = token || "";
  coverage = coverage || null;
  const first = name ? " " + name.split(" ")[0] : "";
  const d = date || new Date().toISOString().slice(0, 10);
  // Self-serve download button — the always-works fallback when a spam filter
  // strips or quarantines the attachment (see functions/api/my-leads.js).
  const dl = token
    ? '<p style="margin:18px 0"><a href="https://masspermits.com/api/my-leads?t=' + token + '" ' +
      'style="background:#0e7c6b;color:#fff;font-weight:700;padding:11px 20px;border-radius:8px;' +
      'text-decoration:none;display:inline-block">Download this week\'s leads &rarr;</a></p>' +
      '<p style="color:#667;font-size:12.5px">Attachment not showing? Use the button above — same file, ' +
      'straight from masspermits.com. Add leads@masspermits.com to your contacts so it always reaches your inbox.</p>'
    : "";
  // Stated ABOVE the file, not buried under it. A subscriber should learn what
  // is missing from us, in the same email — not by counting rows themselves.
  const note = coverage ? (
    '<div style="background:#fff8e1;border:1px solid #f0b429;border-radius:10px;padding:14px 16px;margin:0 0 18px">' +
    '<p style="margin:0 0 8px;font-weight:700;color:#8a5a00">Reduced coverage this week — please read</p>' +
    `<p style="margin:0 0 8px;color:#5c4300;font-size:14px">This file covers <b>${coverage.live_sources || "fewer"} of ` +
    `${coverage.expected_sources || "our usual"}</b> town sources. On 1 August our largest upstream provider closed ` +
    'public access to its permit records. We are rebuilding town by town from municipal sources — ' +
    'Worcester, Cambridge, Lexington and Chatham are back as of 11 August.</p>' +
    (coverage.monthly_sources && coverage.monthly_sources.length
      ? '<p style="margin:0 0 8px;color:#5c4300;font-size:14px">Note: ' +
        coverage.monthly_sources.map((m) => m.replace(", MA", "")).join(", ") +
        ' publish their permits <b>monthly</b>, so their new rows arrive in a batch early each month ' +
        'rather than weekly. Every row shows its issue date.</p>'
      : "") +
    '<p style="margin:0;color:#5c4300;font-size:14px">Everything in the attached file is real and current. ' +
    'We are rebuilding the missing towns from their own municipal sources and will tell you as they come back. ' +
    // The coverage shortfall is disclosed because hiding it would be dishonest.
    // The unprompted REFUND offer is a separate thing and it is removed: it went
    // to every subscriber on every disclosing send, putting money on the table
    // that nobody had asked for. Standing rule, set 2026-09-15: refunds are not
    // raised unless the customer raises them. The invitation to reply stays, so
    // anyone unhappy still has an obvious way to say so.
    'If a reduced feed is not worth your subscription in the meantime, reply and tell me.</p></div>'
  ) : "";
  const html =
    '<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;color:#0e1622">' +
    '<h2 style="color:#0e7c6b">This week\'s MassPermits leads 📋</h2>' +
    note +
    `<p>Hi${first}, your building-permit leads for the week are attached.</p>` +
    '<p><b>Open MassPermits-Leads.html</b> in any browser — interactive dashboard: live charts, ' +
    'filter by trade &amp; town, look up any contractor\'s active jobs, and click any permit for the ' +
    'full record. CSVs included too.</p>' +
    dl +
    '<p style="color:#667;font-size:13px">Sourced from public municipal building-permit records. ' +
    'Just reply with any questions.<br>— MassPermits · masspermits.com</p></div>';
  const subject = coverage ? "Your weekly MassPermits leads — reduced coverage, please read"
                        : "Your weekly MassPermits leads";
  const attachmentName = `MassPermits-weekly-${d}.zip`;
  return { subject, html, attachmentName };
}
