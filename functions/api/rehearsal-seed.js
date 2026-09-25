// MassPermits monday rehearsal: where Sunday's seed email landed (C20).
//
// POST only. The owner's seed reporter finds the "(preview MMDD)" email in a
// seed inbox and posts one small JSON body here:
//   {run: 0-48, placement: "inbox" | "spam" | "missing", has_attachment: bool}
// The Sunday core run, and the next Saturday's, read it back and judge C20.
//
// What this route can do, and nothing more:
//   - 404 when REHEARSAL_SEED_TOKEN is unset (the route does not exist yet).
//   - The bearer token is compared with REHEARSAL_SEED_TOKEN FIRST, in
//     constant time (both are hashed, then every byte is compared). A wrong
//     token is a 401 with no R2 operation at all.
//   - The body is at most 256 bytes. Unknown keys are dropped; a missing or
//     wrongly typed field is a 400 with nothing written.
//   - It writes exactly one key, rehearsal/seed-<date>.json, where <date> is
//     the most recent Sunday (UTC) at or before this Function's own clock. The
//     date never comes from the body or the query, so a caller cannot name
//     another day or another key. Every write goes through roBucket with
//     allowPrefix "rehearsal/".
//   - The response is {ok} only.
//
// REPORT-ONLY: it sends nothing, calls nothing and reads nothing from R2.

import { roBucket } from "./_ro_bucket.js";

const MAX_BODY = 256;
const DAY = 86400_000;
const PLACEMENTS = ["inbox", "spam", "missing"];

const out = (status, ok) => new Response(JSON.stringify({ ok }),
  { status, headers: { "content-type": "application/json" } });

async function digest(s) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
// Constant time in the length and content of both values: two fixed-length
// digests, every byte compared, no early exit.
async function sameSecret(given, secret) {
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The one shape stored. null for anything else.
function shape(b) {
  if (b === null || typeof b !== "object" || Array.isArray(b)) return null;
  const { run, placement, has_attachment } = b;
  if (!Number.isInteger(run) || run < 0 || run > 48) return null;
  if (!PLACEMENTS.includes(placement)) return null;
  if (typeof has_attachment !== "boolean") return null;
  return { run, placement, has_attachment };
}

// The most recent Sunday at or before `now`, as YYYY-MM-DD (UTC).
export function sundayOf(now) {
  const d0 = Math.floor(now / DAY) * DAY;
  return new Date(d0 - new Date(d0).getUTCDay() * DAY).toISOString().slice(0, 10);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const secret = typeof env.REHEARSAL_SEED_TOKEN === "string" ? env.REHEARSAL_SEED_TOKEN : "";
  if (!secret) return out(404, false);
  const h = request.headers.get("authorization") || "";
  const given = /^Bearer /i.test(h) ? h.slice(7) : "";
  if (!(await sameSecret(given, secret))) return out(401, false);

  let rec;
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > MAX_BODY) return out(400, false);
    rec = shape(JSON.parse(new TextDecoder().decode(buf)));
  } catch { return out(400, false); }
  if (!rec) return out(400, false);

  const date = sundayOf(Date.now());
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return out(500, false);
  const rw = roBucket(env.BUNDLES, { allowPrefix: "rehearsal/" });
  try {
    const r = await rw.put(`rehearsal/seed-${date}.json`, JSON.stringify(rec),
      { httpMetadata: { contentType: "application/json" } });
    if (!r) return out(500, false);
  } catch { return out(500, false); }
  return out(200, true);
}
