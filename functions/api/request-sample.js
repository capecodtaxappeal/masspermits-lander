// MassPermits — free-sample signup + instant email delivery (Pages Function).
//
// The lander's form POSTs here: we store the prospect as its OWN R2 object
// (prospects/<email> — no shared-file read-modify-write races) and email them
// the sample via Resend. /api/nurture (daily cron) sends two opted-in
// follow-ups. Requested mail only — never cold outreach.
//
// Abuse hardening (public endpoint that triggers email):
//   - trade/area strictly whitelisted (kills HTML/content injection into email)
//   - per-prospect object + existence check: an address can only ever be
//     enrolled once; repeat submits never re-email anyone
//   - per-IP in-isolate rate limit + a hard DAILY cap on new enrollments
//     (legit volume is a handful/day; a bomber can't generate a bounce storm
//     that would burn the Resend domain the paying customers depend on)

const TRADES = new Set(["Solar","Roofing","HVAC","Electrical","Plumbing","Gas",
  "Kitchen/Bath","Windows/Doors/Siding","Pool/Spa","Deck/Porch","Addition",
  "New Construction","Demolition","Fire/Sprinkler","Sign/Awning",
  "Renovation/Remodel","Other","all"]);
const AREAS = new Set(["all","capecod","boston","southshore","Massachusetts",
  "Cape Cod","Greater Boston","South Shore"]);
const DAILY_CAP = 50;          // new enrollments per UTC day
const IP_CAP = 5;              // per IP per isolate lifetime (~hours)
const ipCounts = new Map();    // per-isolate; imperfect by design, raises attack cost

export async function onRequestPost(context) {
  const { request, env } = context;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!b || typeof b !== "object" || b.company) return json({ ok: true }); // honeypot/garbage

  const email = String(b.email || "").trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "invalid email" }, 400);
  }
  const trade = TRADES.has(b.trade) ? String(b.trade) : "";
  const area = AREAS.has(b.area) ? String(b.area) : "";

  // per-IP brake (in-isolate — approximate, but makes bursts expensive)
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const n = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, n);
  if (n > IP_CAP) return json({ ok: true });

  const key = "prospects/" + encodeURIComponent(email);
  try {
    if (await env.BUNDLES.head(key)) return json({ ok: true }); // already enrolled — never re-email

    // hard daily cap on NEW enrollments
    const day = new Date().toISOString().slice(0, 10);
    const capKey = "prospects-meta/day-" + day;
    const capObj = await env.BUNDLES.get(capKey);
    const used = capObj ? parseInt(await capObj.text(), 10) || 0 : 0;
    if (used >= DAILY_CAP) return json({ ok: true });
    await env.BUNDLES.put(capKey, String(used + 1));

    const ts = new Date().toISOString();
    await env.BUNDLES.put(key, JSON.stringify({ email, trade, area, ts, stage: 1 }), {
      httpMetadata: { contentType: "application/json" },
      // stage/ts/trade mirrored into metadata so /api/nurture can scan the whole
      // list WITHOUT a body-read per prospect (Workers subrequest budget)
      customMetadata: { stage: "1", ts, trade },
    });
  } catch (e) {
    return json({ ok: false, error: "store failed" }, 500);
  }

  try { await sendSample(env, email, trade); } catch (e) { /* enrolled; nurture continues */ }
  return json({ ok: true });
}

async function sendSample(env, to, trade) {
  const t = trade && trade !== "all" && trade !== "Other" ? trade : "your trade";
  const html = wrap(`
    <h2 style="color:#0e7c6b">Your free MassPermits sample 📋</h2>
    <p>Here's your free batch of real Massachusetts building-permit leads:</p>
    <p style="margin:18px 0"><a href="https://masspermits.com/api/sample"
      style="background:#14b8a6;color:#04201c;font-weight:700;padding:12px 22px;border-radius:8px;text-decoration:none">
      Download the free sample</a></p>
    <p>Open <b>MassPermits-Leads.html</b> in any browser — live charts, filter by
    trade &amp; town, and see the volume of ${t} work being permitted right now.
    The sample masks street numbers &amp; names; the full packs unlock everything.</p>
    <p style="color:#667">Any questions, just reply — a real person reads these.</p>`);
  await send(env, to, "Your free MassPermits sample", html);
}

function wrap(inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
    ${inner}
    <p style="color:#9aa;font-size:12px;margin-top:26px">— MassPermits · masspermits.com · public municipal permit records<br>
    Don't want these emails? Just reply "stop" and you're out.</p></div>`;
}

async function send(env, to, subject, html) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
