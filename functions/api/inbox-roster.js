// MassPermits — subscriber roster as SALTED DIGESTS, for the inbox watchdog.
//
// WHAT PROBLEM THIS SOLVES
// The never-spam rule (KB/06 P3, SILENCE_AUDIT.md R1) says: mail from anyone on
// subscribers.json must never be filtered, ever. All 4 of 4 buyers in company
// history opened with a version of "I paid and I cannot find it", and buyer 1's
// first message was eaten by this mailbox's own spam filter and cost 9 days. So
// R1 has to run FIRST, above every suppression rule, and it needs the roster.
//
// But the roster cannot leave R2. subscribers.json is deliberately excluded from
// /api/upload-bundle's ALLOWED_KEYS and from /api/get-object's READABLE set
// (KB/02 L-9), and it must stay that way: it holds each buyer's email, name,
// Stripe customer id and their /api/my-leads token, which IS the auth for the
// paid product. Serving that file would be credential disclosure.
//
// THIS ENDPOINT NEVER SERVES IT. It returns only HMAC-SHA256 digests of the
// addresses. The watchdog hashes the sender of each inbound message with the
// same key and compares digests, so the watchdog can answer "is this a
// customer?" while never learning a single address. Nothing reversible, no
// name, no Stripe id, no token, ever leaves this function.
//
// WHY HMAC AND NOT A PLAIN SHA-256
// An email address has almost no entropy. sha256("firstname@hotmail.com") is
// reversible by anyone who can guess the address, which is the entire point of
// a customer list. HMAC keyed on INBOX_ROSTER_PEPPER — a Cloudflare secret that
// exists in no repo — makes the digests inert to anyone without the key. If the
// pepper is missing this endpoint FAILS CLOSED with a 503 rather than emitting
// unsalted hashes, because emitting unsalted hashes of a customer list is a
// leak wearing a hash's clothing.
//
// ACTIVE **AND** CANCELLED, DELIBERATELY
// `cancelled` is returned alongside `active`. A churned customer is still a
// human being writing to us, and the one cancellation in company history
// (2026-08-31) is the exact person whose mail must never be filtered again. He
// is `active:false` today. Suppressing him would be the original failure with
// extra steps. triage_rules.Roster.is_subscriber() unions both sets on purpose.
//
// AUTH: two callers, two mechanisms.
//   - GitHub Actions   -> OIDC, keyless, same gate as every other endpoint.
//   - The Apps Script watchdog -> a bearer token. Apps Script cannot mint a
//     GitHub OIDC JWT, so there is no keyless option for it. The token lives in
//     Cloudflare Secrets and in Google Script Properties and in NO repo, which
//     is the property that mattered when the old static trigger token had to be
//     killed (weekly-send.js:11) — that one was committed to this public repo.
//     Blast radius if it leaks: an attacker learns how many subscribers exist
//     and gets a list of digests they cannot reverse without the pepper. They
//     cannot read an address, write anything, or send anything. That is a
//     strictly smaller radius than any other authenticated endpoint here.
//
// Read-only. Sends no mail. Writes nothing. Cannot reach the paying-customer path.

import { verifyGitHubOIDC } from "./_github-oidc.js";

const DIGEST_HEX = 32; // 128 bits. 4 subscribers today; collision risk is nil.

export async function onRequestGet(context) {
  const { request, env } = context;

  const auth = await authorize(request, env);
  if (!auth.ok) return json({ error: "unauthorized", reason: auth.reason }, 401);

  // Fail closed. Without the pepper the only thing we could return is an
  // unsalted hash of a customer list, which is not a redaction.
  const pepper = env.INBOX_ROSTER_PEPPER || "";
  if (pepper.length < 16) {
    return json({
      ok: false,
      error: "INBOX_ROSTER_PEPPER is unset or too short — refusing to emit " +
             "unsalted digests of the subscriber list",
    }, 503);
  }

  let list;
  try {
    const o = await env.BUNDLES.get("subscribers.json");
    if (!o) return json({ ok: false, error: "no subscribers.json in R2" }, 503);
    list = JSON.parse(await o.text());
  } catch (e) {
    // Never leak the parse error verbatim — a JSON error message can quote the
    // offending bytes, and the offending bytes are the customer list.
    return json({ ok: false, error: "subscribers.json unreadable" }, 503);
  }
  if (!Array.isArray(list)) return json({ ok: false, error: "subscribers.json is not an array" }, 503);

  const active = new Set();
  const cancelled = new Set();
  let skipped = 0;

  for (const s of list) {
    const email = (s && typeof s.email === "string" ? s.email : "").trim().toLowerCase();
    if (!email || email.indexOf("@") < 1) { skipped++; continue; }

    // KB/02 L-2: `active` is checked as `!== false` everywhere in this codebase.
    // A row with the key MISSING is an active subscriber. Match that exactly —
    // a divergence here would silently drop a paying customer out of R1.
    const target = s.active === false ? cancelled : active;

    for (const v of variants(email)) target.add(await hmacHex(pepper, v));
  }

  return json({
    ok: true,
    alg: "hmac-sha256/" + (DIGEST_HEX * 4) + "-trunc-hex",
    generated_at: new Date().toISOString(),
    // Digests only. There is no code path in this function that can put an
    // address, a name, a Stripe id or a token into this response.
    active: [...active],
    cancelled: [...cancelled],
    counts: {
      rows: list.length,
      active_rows: list.filter((s) => s && s.active !== false).length,
      cancelled_rows: list.filter((s) => s && s.active === false).length,
      skipped_rows: skipped,
      digests: active.size + cancelled.size,
    },
  });
}

// The address as stored, plus its plus-address stripped form. A buyer who
// writes in from `name+permits@gmail.com` when Stripe recorded `name@gmail.com`
// is still that buyer. Both digests map to the same person, so a match on
// either is a match.
//
// Gmail dot-folding (j.smith@ == jsmith@) is deliberately NOT done: it is true
// for Gmail and false for most other providers, and there is no provider table
// here to tell them apart. Getting that wrong would fold two DIFFERENT people
// onto one digest, and R1 is the one rule where a wrong match is not harmless —
// it would label a stranger a paying customer.
function variants(email) {
  const out = new Set([email]);
  const at = email.lastIndexOf("@");
  const local = email.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) out.add(local.slice(0, plus) + email.slice(at));
  return out;
}

async function hmacHex(pepper, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, DIGEST_HEX);
}

async function authorize(request, env) {
  const hdr = (request.headers.get("authorization") || "");
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const presented = m ? m[1].trim() : "";

  const expected = env.INBOX_WATCHDOG_TOKEN || "";
  if (expected.length >= 24 && presented && timingSafeEqual(presented, expected)) {
    return { ok: true, via: "watchdog-token" };
  }
  // Fall through to OIDC so GitHub Actions can call this too (the status job
  // uses it to confirm the roster is non-empty without the Apps Script).
  const oidc = await verifyGitHubOIDC(request);
  return oidc.ok ? { ok: true, via: "oidc" } : { ok: false, reason: oidc.reason };
}

// Compare without leaking the answer through timing. Length is compared first
// and non-secretly, which is standard: the length of a random token is not the
// secret, its contents are.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
