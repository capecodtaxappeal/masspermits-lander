// MassPermits — free weekly digest signup ("This Week in MA Permits").
//
// Double opt-in list, separate from prospects/ and subscribers.json:
//   POST {email}            -> store newsletter/<email> unconfirmed + send confirm email
//   GET  ?c=<email64>.<tok> -> confirm (activates weekly digest)
//   GET  ?u=<email64>.<tok> -> unsubscribe (one click, CAN-SPAM)
//
// Same abuse hardening as request-sample.js: honeypot, per-IP brake, daily cap,
// and an existence check so an address can never be re-mailed a confirm email.
// Token lives in customMetadata so the weekly sender never needs body reads.

const DAILY_CAP = 100;
const IP_CAP = 6;
const ipCounts = new Map();

export async function onRequestPost(context) {
  const { request, env } = context;
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!b || typeof b !== "object" || b.company) return json({ ok: true }); // honeypot

  const email = String(b.email || "").trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ error: "invalid email" }, 400);
  }
  const ip = request.headers.get("cf-connecting-ip") || "?";
  const n = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, n);
  if (n > IP_CAP) return json({ ok: true });

  const key = "newsletter/" + encodeURIComponent(email);
  try {
    if (await env.BUNDLES.head(key)) return json({ ok: true }); // never re-email a confirm

    const day = new Date().toISOString().slice(0, 10);
    const capKey = "newsletter-meta/day-" + day;
    const capObj = await env.BUNDLES.get(capKey);
    const used = capObj ? parseInt(await capObj.text(), 10) || 0 : 0;
    if (used >= DAILY_CAP) return json({ ok: true });
    await env.BUNDLES.put(capKey, String(used + 1));

    const tok = crypto.randomUUID().replace(/-/g, "");
    const ts = new Date().toISOString();
    await env.BUNDLES.put(key, JSON.stringify({ email, tok, ts, confirmed: false }), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { c: "0", ts, tok },
    });
    await sendConfirm(env, email, tok);
  } catch (e) {
    return json({ ok: false, error: "store failed" }, 500);
  }
  return json({ ok: true });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const c = url.searchParams.get("c"), u = url.searchParams.get("u");
  const parsed = parseToken(c || u);
  if (!parsed) return page("That link looks broken", "Try the signup form again at masspermits.com.");

  const key = "newsletter/" + encodeURIComponent(parsed.email);
  const obj = await env.BUNDLES.get(key);
  if (!obj) return page("Not on the list", "That address isn't signed up. Join at masspermits.com.");
  const meta = obj.customMetadata || {};
  if ((meta.tok || "") !== parsed.tok) return page("That link looks stale", "Use the newest email we sent you.");

  if (c) {
    await env.BUNDLES.put(key, JSON.stringify({ email: parsed.email, tok: parsed.tok,
      ts: meta.ts || "", confirmed: true }), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { ...meta, c: "1" },
    });
    return page("You're in ✅", "Every Monday morning: fresh Massachusetts permit activity — towns, trades and " +
      "notable projects. Want full leads (address + owner) now? <a style='color:#2dd4bf' " +
      "href='https://masspermits.com'>Grab a free sample →</a>");
  }
  // unsubscribe
  await env.BUNDLES.put(key, JSON.stringify({ email: parsed.email, tok: parsed.tok,
    ts: meta.ts || "", confirmed: false, unsubscribed: true }), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { ...meta, c: "0", un: "1" },
  });
  return page("Unsubscribed", "You won't get the weekly digest anymore. Changed your mind? Re-join anytime at masspermits.com.");
}

function parseToken(s) {
  if (!s || s.length > 300) return null;
  const i = s.lastIndexOf(".");
  if (i < 1) return null;
  try {
    const email = atob(s.slice(0, i).replace(/-/g, "+").replace(/_/g, "/"));
    const tok = s.slice(i + 1);
    if (!/^[a-f0-9]{16,64}$/.test(tok) || email.length > 120) return null;
    return { email: email.toLowerCase(), tok };
  } catch { return null; }
}

function b64url(s) { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function sendConfirm(env, to, tok) {
  const link = `https://masspermits.com/api/newsletter?c=${b64url(to)}.${tok}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0e1622">
    <h2 style="color:#0e7c6b">Confirm your weekly MA permits digest 📋</h2>
    <p>One click and you'll get "This Week in MA Permits" every Monday morning — where building
    activity is rising, which trades are filing, and the week's biggest projects.</p>
    <p style="margin:20px 0;text-align:center"><a href="${link}"
      style="background:#14b8a6;color:#04201c;font-weight:700;padding:12px 26px;border-radius:8px;text-decoration:none;display:inline-block">Confirm — send me the digest →</a></p>
    <p style="color:#667;font-size:13px">Didn't sign up at masspermits.com? Ignore this and nothing will ever arrive.</p>
    <p style="color:#9aa;font-size:12px">— MassPermits · masspermits.com · public municipal permit records</p></div>`;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to],
      subject: "Confirm: your weekly Massachusetts permits digest", html }),
  });
  if (!resp.ok) throw new Error("resend " + resp.status);
}

function page(h, sub) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MassPermits</title><body style="margin:0;background:#0e1622;color:#e8eef5;font-family:-apple-system,Segoe UI,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div style="max-width:460px;padding:40px 24px;text-align:center">
<div style="font-size:20px;font-weight:800;margin-bottom:18px">Mass<span style="color:#2dd4bf">Permits</span></div>
<h1 style="font-size:26px;margin:0 0 10px">${h}</h1>
<p style="color:#8aa0b6;line-height:1.6">${sub}</p></div></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
