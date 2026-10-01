// MassPermits manual intake: the decision and storage logic of the email Worker.
//
// Kept apart from index.js so the tests can hand it a parser and a message
// without a network, a bucket or a mail server. index.js wires in postal-mime.
//
// THE RULES
//   1. Nothing is ever sent back. No reply(), no forward(), no setReject():
//      a rejection is a bounce, and a bounce is a message to the sender.
//      Everything that is not accepted is dropped in silence.
//   2. Authentication comes from ONE header: the topmost Authentication-Results
//      (or ARC-Authentication-Results) whose authserv-id is TRUSTED_AUTHSERV_ID
//      (default mx.cloudflare.net), the one the receiving edge prepends. A
//      sender can write any header it likes lower down; only the top one
//      counts. No such header at all means no mail is accepted.
//   3. A message is accepted when the envelope sender or the From address is
//      on ALLOWED_SENDERS (an exact address, or a whole domain) AND that
//      header shows dkim=pass or spf=pass for that address's domain.
//   4. A forward is accepted only from OWNER_FORWARDER, authenticated the same
//      way. Then the original sender is looked for, in this order: the From
//      header (a filter forward keeps it), an attached message's From, and the
//      "Forwarded message" block of the body. It must be on ALLOWED_SENDERS.
//   5. Each csv, xlsx or pdf attachment is checked by content and stored by
//      _manual_store.js exactly as the drop box stores it, with via "email".
//   6. Logs carry counts and a fixed outcome word only: no address, no name,
//      no subject, no file name.

import { parseSources, sniff, ingest, MAX_UPLOAD_BYTES, SLUG_RX } from "../../../functions/api/_manual_store.js";

export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
const DEFAULT_AUTHSERV = "mx.cloudflare.net";

export const OUTCOMES = new Set(["accepted", "too-large", "parse-error", "no-trusted-auth",
  "sender-not-allowed", "no-attachments", "not-configured", "error"]);

const ASCII_ADDR = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export function normAddr(a) {
  const s = String(a == null ? "" : a).trim().replace(/^<|>$/g, "").toLowerCase();
  return ASCII_ADDR.test(s) ? s : "";
}
const domainOf = (a) => (a ? a.slice(a.lastIndexOf("@") + 1) : "");

// A whole-domain entry for a public mail service would let anyone with a free
// account in. Those domains are accepted only as part of an exact address.
export const FREEMAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "msn.com", "yahoo.com", "ymail.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "gmx.com", "mail.com", "zoho.com", "comcast.net", "verizon.net", "att.net"]);

// ALLOWED_SENDERS: {"<exact address>": "town-a", "<whole domain>": "town-b"}
export function parseAllowed(raw) {
  let obj;
  try { obj = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_) { return new Map(); }
  const out = new Map();
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, slug] of Object.entries(obj)) {
    const key = String(k).trim().toLowerCase();
    if (typeof slug !== "string" || !SLUG_RX.test(slug)) continue;
    if (key.includes("@") ? normAddr(key) : /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(key) && !FREEMAIL.has(key)) out.set(key, slug);
  }
  return out;
}

export function lookupSlug(allowed, addr) {
  const a = normAddr(addr);
  if (!a) return null;
  return allowed.get(a) || allowed.get(domainOf(a)) || null;
}

// The owner's address, with a Gmail-style "+tag" on the local part allowed,
// since a filter forward goes out with an envelope like owner+caf_=...@host.
export function isOwner(owner, addr) {
  const o = normAddr(owner), a = normAddr(addr);
  if (!o || !a) return false;
  const [ol, od] = [o.slice(0, o.lastIndexOf("@")), domainOf(o)];
  const al = a.slice(0, a.lastIndexOf("@")).split("+")[0];
  return od === domainOf(a) && ol === al;
}

// ------------------------------------------------------------ auth header

function stripComments(s) {
  let out = "", depth = 0;
  for (const c of s) {
    if (c === "(") depth++;
    else if (c === ")" && depth > 0) depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

// headers: [{ key, value }] in message order (postal-mime's shape).
// -> { dkim: [domain], spf: [domain] } from the one trusted header, or null.
export function trustedAuth(headers, authservId = DEFAULT_AUTHSERV) {
  const want = String(authservId || DEFAULT_AUTHSERV).toLowerCase();
  for (const h of headers || []) {
    const key = String(h && h.key || "").toLowerCase();
    if (key !== "authentication-results" && key !== "arc-authentication-results") continue;
    let v = stripComments(String(h.value || "")).replace(/\s+/g, " ").trim();
    if (key === "arc-authentication-results") v = v.replace(/^i=\d+\s*;\s*/i, "");
    const parts = v.split(";").map((p) => p.trim()).filter(Boolean);
    const id = (parts[0] || "").split(" ")[0].toLowerCase();
    if (id !== want) continue;
    const res = { dkim: [], spf: [] };
    for (const p of parts.slice(1)) {
      const m = p.match(/^(dkim|spf)\s*=\s*([a-z]+)\b(.*)$/i);
      if (!m || m[2].toLowerCase() !== "pass") continue;
      const method = m[1].toLowerCase();
      const props = {};
      for (const kv of m[3].trim().split(" ")) {
        const i = kv.indexOf("=");
        if (i > 0) props[kv.slice(0, i).toLowerCase()] = kv.slice(i + 1).replace(/^"|"$/g, "").toLowerCase();
      }
      if (method === "dkim") {
        const d = props["header.d"] || (props["header.i"] || "").split("@").pop();
        if (d) res.dkim.push(d.replace(/\.$/, ""));
      } else {
        const mf = props["smtp.mailfrom"] || props["smtp.helo"] || "";
        const d = mf.includes("@") ? mf.split("@").pop() : mf;
        if (d) res.spf.push(d.replace(/\.$/, ""));
      }
    }
    return res; // the topmost trusted header decides; later ones are ignored
  }
  return null;
}

function aligned(d, domain) {
  if (!d || !domain) return false;
  if (d === domain) return true;
  return d.split(".").length >= 2 && domain.endsWith("." + d);
}

export function authPasses(auth, addr) {
  const d = domainOf(normAddr(addr));
  if (!auth || !d) return false;
  return auth.dkim.some((x) => aligned(x, d)) || auth.spf.some((x) => aligned(x, d));
}

// ------------------------------------------------------------ the decision

function forwardedFrom(text) {
  const s = String(text || "");
  const at = s.search(/-{2,}\s*Forwarded message\s*-{2,}/i);
  if (at < 0) return "";
  const m = s.slice(at, at + 4000).match(/^\s*From:\s*(.*)$/im);
  if (!m) return "";
  const angle = m[1].match(/<([^<>\s]+)>/);
  if (angle) return angle[1];
  const bare = m[1].match(/[^\s<>"]+@[^\s<>"]+/);
  return bare ? bare[0] : "";
}

// -> { slug, route: "direct" | "forward" } | { reason }
export function decide({ envelopeFrom, email, nested }, env) {
  const auth = trustedAuth(email.headers, env.TRUSTED_AUTHSERV_ID);
  if (!auth) return { reason: "no-trusted-auth" };
  const allowed = parseAllowed(env.ALLOWED_SENDERS);
  const fromHdr = email.from && email.from.address;

  for (const addr of [envelopeFrom, fromHdr]) {
    const slug = lookupSlug(allowed, addr);
    if (slug && authPasses(auth, addr)) return { slug, route: "direct" };
  }

  const owner = env.OWNER_FORWARDER;
  const byOwner = [envelopeFrom, fromHdr].some((a) => isOwner(owner, a) && authPasses(auth, a));
  if (byOwner) {
    const candidates = [];
    if (fromHdr && !isOwner(owner, fromHdr)) candidates.push(fromHdr);
    for (const n of nested || []) if (n.from && n.from.address) candidates.push(n.from.address);
    candidates.push(forwardedFrom(email.text));
    for (const c of candidates) {
      const slug = lookupSlug(allowed, c);
      if (slug) return { slug, route: "forward" };
    }
  }
  return { reason: "sender-not-allowed" };
}

// ------------------------------------------------------------ the handler

function log(o) {
  // Fixed keys, numbers and one word from OUTCOMES. Nothing from the message.
  const safe = {
    event: "manual-intake",
    outcome: OUTCOMES.has(o.outcome) ? o.outcome : "error",
    stored: o.stored | 0, duplicate: o.duplicate | 0, skipped: o.skipped | 0,
  };
  console.log(JSON.stringify(safe));
  return safe;
}

async function readCapped(stream, cap) {
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) { try { await reader.cancel(); } catch (_) { /* ignore */ } return null; }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const PARSE_OPTS = { forceRfc822Attachments: true, maxRfc822NestingDepth: 0, attachmentEncoding: "arraybuffer" };
const isRfc822 = (a) => String(a.mimeType || "").toLowerCase() === "message/rfc822";

// handleEmail(message, env, { parse }) -> the logged summary. Never throws,
// never calls a method on message other than reading from, rawSize and raw.
export async function handleEmail(message, env, { parse, now } = {}) {
  try {
    if (!env || !env.BUNDLES || !env.ALLOWED_SENDERS || !env.MANUAL_SOURCES) return log({ outcome: "not-configured" });
    if (!(Number(message.rawSize) <= MAX_MESSAGE_BYTES)) return log({ outcome: "too-large" });
    const raw = await readCapped(message.raw, MAX_MESSAGE_BYTES);
    if (!raw) return log({ outcome: "too-large" });

    let email;
    const nested = [];
    try {
      email = await parse(raw, PARSE_OPTS);
      // One level of attached message (a forward sent "as attachment").
      for (const a of (email.attachments || []).filter(isRfc822).slice(0, 3)) {
        nested.push(await parse(a.content, PARSE_OPTS));
      }
    } catch (_) {
      return log({ outcome: "parse-error" });
    }

    const d = decide({ envelopeFrom: message.from, email, nested }, env);
    if (!d.slug) return log({ outcome: d.reason });

    const sources = parseSources(env.MANUAL_SOURCES);
    const source = sources[d.slug];
    if (!source) return log({ outcome: "not-configured" });

    const files = [email, ...nested].flatMap((m) => (m.attachments || []).filter((a) => !isRfc822(a)));
    if (!files.length) return log({ outcome: "no-attachments" });

    let stored = 0, duplicate = 0, skipped = 0;
    for (const a of files.slice(0, MAX_ATTACHMENTS)) {
      const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content)
        : a.content instanceof Uint8Array ? a.content : null;
      if (!bytes || bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES) { skipped++; continue; }
      const s = await sniff(bytes);
      if (!s.ok || !source.accept.includes(s.ext)) { skipped++; continue; }
      const r = await ingest(env.BUNDLES, {
        slug: d.slug, bytes, ext: s.ext, name: a.filename || "", via: "email", now: now ? now() : new Date(),
      });
      if (r.status === "stored") stored++;
      else if (r.status === "duplicate") duplicate++;
      else skipped++;
    }
    skipped += Math.max(0, files.length - MAX_ATTACHMENTS);
    return log({ outcome: "accepted", stored, duplicate, skipped });
  } catch (_) {
    return log({ outcome: "error" });
  }
}
