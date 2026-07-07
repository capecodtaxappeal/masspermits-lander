// MassPermits — agent free-town-sample (Farm Town Permit Radar funnel).
//
// The /agents form POSTs {email, town}: we store the prospect (agent-prospects/
// prefix, own R2 object per address — same race-free pattern as prospects/) and
// instantly email a masked CSV of last week's permits for THEIR town, built from
// our own public /feed/permits.json. Free sample stays masked (street name only);
// the paid Radar unmasks name + exact address. Same abuse hardening as
// request-sample.js: honeypot, per-IP brake, daily cap, never re-emails.

const DAILY_CAP = 40;
const IP_CAP = 5;
const ipCounts = new Map();
const RADAR_LINK = "https://buy.stripe.com/8x2bJ0gLqc8L79sefZ4gg02";

export async function onRequestPost(context) {
  const { request, env } = context;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!b || typeof b !== "object" || b.company) return json({ ok: true }); // honeypot

  const email = String(b.email || "").trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "invalid email" }, 400);
  }
  const town = String(b.town || "").trim().slice(0, 40).replace(/[<>"'`]/g, "");
  if (!town || !/^[a-zA-Z .'-]{2,40}$/.test(town)) return json({ error: "invalid town" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "?";
  const n = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, n);
  if (n > IP_CAP) return json({ ok: true });

  const key = "agent-prospects/" + encodeURIComponent(email);
  try {
    if (await env.BUNDLES.head(key)) return json({ ok: true }); // never re-email

    const day = new Date().toISOString().slice(0, 10);
    const capKey = "agent-prospects-meta/day-" + day;
    const capObj = await env.BUNDLES.get(capKey);
    const used = capObj ? parseInt(await capObj.text(), 10) || 0 : 0;
    if (used >= DAILY_CAP) return json({ ok: true });
    await env.BUNDLES.put(capKey, String(used + 1));

    const ts = new Date().toISOString();
    await env.BUNDLES.put(key, JSON.stringify({ email, town, ts }), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { ts, town: town.slice(0, 30), stage: "1" },
    });
  } catch (e) {
    return json({ ok: false, error: "store failed" }, 500);
  }

  try { await sendTownSample(env, email, town); } catch (e) { /* enrolled; non-fatal */ }
  try { await notifyOwner(env, email, town); } catch (e) { /* non-fatal */ }
  return json({ ok: true });
}

const OWNER_EMAIL = "patrick@masspermits.com";

// Heads-up to the owner on every new sample request — the prospect already got
// their CSV + trial link automatically; this is for personal follow-up.
async function notifyOwner(env, email, town) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: [OWNER_EMAIL],
      subject: `Agent sample request: ${town}`,
      html: `<p><b>${esc(email)}</b> requested the free <b>${esc(town)}</b> sample on /agents.</p>
        <p>They already received the masked town CSV + trial link automatically.
        Reply to them from your inbox if you want to follow up personally.</p>`,
    }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

async function sendTownSample(env, to, town) {
  // build the sample from our own public feed (already masked, no house numbers)
  let items = [];
  try {
    const r = await fetch("https://masspermits.com/feed/permits.json");
    if (r.ok) items = (await r.json()).items || [];
  } catch (e) { /* fall through to statewide-empty handling */ }

  const tLower = town.toLowerCase();
  let rows = items.filter(i => (i._town || "").toLowerCase() === tLower);
  let scope = town;
  if (rows.length < 3) { rows = items; scope = "Massachusetts (statewide sample)"; }
  rows = rows.slice(0, 40);

  const esc = s => String(s == null ? "" : s).replace(/"/g, '""');
  const csv = ["date,town,project_type,declared_value,street"]
    .concat(rows.map(i => {
      const street = ((i.title || "").split("—")[1] || "").split(",")[0].trim();
      return `"${esc((i.date_published || "").slice(0, 10))}","${esc(i._town)}","${esc(i._trade)}","${esc(i._value || "")}","${esc(street)}"`;
    })).join("\n");
  const b64 = btoa(unescape(encodeURIComponent(csv)));

  const slug = town.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const escH = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
    <h2 style="color:#0e7c6b">Your ${escH(scope)} permit sample 🏡</h2>
    <p>Attached: ${rows.length} recent building permits${scope === town ? ` in <b>${escH(town)}</b>` : ""} —
    date, project type, declared value, and street (this free sample masks house numbers and homeowner names).</p>
    <p><b>The paid Radar unmasks everything:</b> homeowner name + exact address for every permit in your
    farm towns, delivered every Monday. That's your door-knock list and postcard file, current to the week.</p>
    <div style="background:#e9fbf6;border:1px solid #14b8a6;border-radius:10px;padding:16px;margin:18px 0;text-align:center">
      <p style="margin:0 0 10px;font-weight:600">Farm Town Permit Radar — $49/mo, no contract</p>
      <a href="${RADAR_LINK}" style="background:#14b8a6;color:#04201c;font-weight:700;padding:11px 22px;border-radius:8px;text-decoration:none;display:inline-block">Start your free 7-day trial →</a>
      <p style="margin:10px 0 0;font-size:12px;color:#667">Cancel anytime · SmartZip charges $396 setup + a 12-month contract for AI guesses. This is the actual permit record.</p>
    </div>
    <p style="color:#667;font-size:13px">Also useful: this week's <a href="https://masspermits.com/report/" style="color:#0e7c6b">MA Building Activity Report</a>
    and the live <a href="https://masspermits.com/permits/${slug}" style="color:#0e7c6b">${escH(town)} permit page</a>.
    Questions? Just reply — a real person reads these.</p>
    <p style="color:#9aa;font-size:12px">— MassPermits · masspermits.com · public municipal permit records<br>
    Don't want these emails? Reply "stop" and you're out.</p></div>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL, to: [to],
      subject: `Your ${scope === town ? town : "MA"} permit sample — Farm Town Permit Radar`,
      html,
      attachments: [{ filename: `MassPermits-${slug || "ma"}-sample.csv`, content: b64 }],
    }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
