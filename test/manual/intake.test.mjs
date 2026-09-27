// The email intake Worker (workers/manual-intake/src/intake.js), fed real MIME
// through postal-mime when it is installed (npm ci in workers/manual-intake).
// Every address is built at run time under the reserved .example domain.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as H from "./_h.mjs";

const { intake, store } = await H.load();

const PM_PATH = path.join(H.REPO, "workers/manual-intake/node_modules/postal-mime/dist/esm/postal-mime.js");
const havePM = fs.existsSync(PM_PATH);
const PostalMime = havePM ? (await import(pathToFileURL(PM_PATH).href)).default : null;
const skip = havePM ? false : "postal-mime not installed: run npm ci in workers/manual-intake";
const parse = (raw, opts) => PostalMime.parse(raw, opts);

const TOWN = H.addr("clerk", "town-a.example");
const TOWN_OTHER = H.addr("someone", "town-a.example");
const OWNER = H.addr("owner", "mail-owner.example");
const OWNER_CAF = H.addr("owner+caf_=drop=in.intake.example", "mail-owner.example");
const STRANGER = H.addr("stranger", "elsewhere.example");
const INTAKE = H.addr("drop", "in.intake.example");

const ENV_BASE = () => ({
  ALLOWED_SENDERS: JSON.stringify({ [TOWN]: "town-a", "town-b.example": "town-b" }),
  OWNER_FORWARDER: OWNER,
  MANUAL_SOURCES: JSON.stringify(H.SOURCES),
});

const b64 = (buf) => Buffer.from(buf).toString("base64").replace(/(.{76})/g, "$1\r\n");

function mime({ auth, from, extraHeaders = [], text = "See attached.", files = [], nested }) {
  const B = "b-" + Math.random().toString(16).slice(2);
  const lines = [];
  if (auth !== null) lines.push("Authentication-Results: " + auth);
  lines.push(...extraHeaders, "From: Sender <" + from + ">", "To: " + INTAKE, "Subject: file",
    "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="' + B + '"', "", "--" + B,
    "Content-Type: text/plain; charset=utf-8", "", text);
  for (const f of files) {
    lines.push("--" + B, "Content-Type: " + (f.type || "application/octet-stream") + '; name="' + f.name + '"',
      'Content-Disposition: attachment; filename="' + f.name + '"', "Content-Transfer-Encoding: base64", "", b64(f.data));
  }
  if (nested) {
    lines.push("--" + B, "Content-Type: message/rfc822", 'Content-Disposition: attachment; filename="orig.eml"', "", nested);
  }
  lines.push("--" + B + "--", "");
  return Buffer.from(lines.join("\r\n"));
}

const pass = (d, mf) => `mx.cloudflare.net; dkim=pass header.d=${d} header.s=s1; spf=pass smtp.mailfrom=${mf}; dmarc=pass header.from=${d}`;
const fail = (d, mf) => `mx.cloudflare.net; dkim=fail header.d=${d}; spf=fail smtp.mailfrom=${mf}; dmarc=fail header.from=${d}`;

function message(envelopeFrom, raw) {
  const calls = [];
  return {
    calls,
    from: envelopeFrom, to: INTAKE, rawSize: raw.length,
    raw: new Blob([raw]).stream(),
    headers: new Headers(),
    setReject: (...a) => calls.push(["setReject", a]),
    forward: async (...a) => calls.push(["forward", a]),
    reply: async (...a) => calls.push(["reply", a]),
  };
}

const logs = [];
const realLog = console.log;
async function run(envelopeFrom, raw, { r2 = new H.FakeR2(), env: over = {}, rawSize } = {}) {
  const m = message(envelopeFrom, raw);
  if (rawSize !== undefined) m.rawSize = rawSize;
  const env = { ...ENV_BASE(), BUNDLES: r2, ...over };
  const lines = [];
  console.log = (s) => { lines.push(String(s)); logs.push(String(s)); };
  let out;
  try { out = await intake.handleEmail(m, env, { parse }); } finally { console.log = realLog; }
  assert.deepEqual(m.calls, [], "the Worker never replies, forwards or rejects");
  assert.equal(lines.length, 1, "exactly one log line");
  return { out, r2, m, line: lines[0] };
}
const dataKeys = (r2) => [...r2.objects.keys()].filter((k) => k !== "manual-raw/index.json");
const index = (r2) => JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());

test("allowed sender, each attachment type: stored with via email", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN), from: TOWN, files: [
    { name: "a.csv", data: H.F.csv() }, { name: "b.xlsx", data: H.F.xlsx() }, { name: "c.pdf", data: H.F.pdf(), type: "application/pdf" },
  ] });
  const { out, r2 } = await run(TOWN, raw);
  assert.deepEqual(out, { event: "manual-intake", outcome: "accepted", stored: 3, duplicate: 0, skipped: 0 });
  assert.deepEqual(dataKeys(r2).map((k) => k.split(".").pop()).sort(), ["csv", "pdf", "xlsx"]);
  assert.ok(dataKeys(r2).every((k) => k.startsWith("manual-raw/town-a/")));
  assert.ok(index(r2).entries.every((e) => e.via === "email" && e.slug === "town-a"));
  // The same message again: all three duplicate, nothing new.
  const again = await run(TOWN, raw, { r2 });
  assert.equal(again.out.duplicate, 3);
  assert.equal(dataKeys(r2).length, 3);
});

test("a whole allowed domain, authenticated by SPF only", { skip }, async () => {
  const from = H.addr("records", "town-b.example");
  const raw = mime({ auth: "mx.cloudflare.net; dkim=none; spf=pass smtp.mailfrom=" + from, from, files: [{ name: "x.pdf", data: H.F.pdf() }] });
  const { out, r2 } = await run(from, raw);
  assert.equal(out.stored, 1);
  assert.ok(dataKeys(r2)[0].startsWith("manual-raw/town-b/"));
});

test("disallowed sender: nothing stored", { skip }, async () => {
  const raw = mime({ auth: pass("elsewhere.example", STRANGER), from: STRANGER, files: [{ name: "a.csv", data: H.F.csv() }] });
  const { out, r2 } = await run(STRANGER, raw);
  assert.equal(out.outcome, "sender-not-allowed");
  assert.equal(r2.ops.length, 0);
});

test("an unlisted address at a listed address's domain is refused", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN_OTHER), from: TOWN_OTHER, files: [{ name: "a.csv", data: H.F.csv() }] });
  const { out, r2 } = await run(TOWN_OTHER, raw);
  assert.equal(out.outcome, "sender-not-allowed");
  assert.equal(r2.ops.length, 0);
});

test("spoofed From with failing DKIM and SPF: refused", { skip }, async () => {
  const raw = mime({ auth: fail("town-a.example", TOWN), from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  assert.equal((await run(TOWN, raw)).out.outcome, "sender-not-allowed");
  // Spoofed From, attacker's own domain passes: still refused.
  const raw2 = mime({ auth: pass("elsewhere.example", STRANGER), from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  const r = await run(STRANGER, raw2);
  assert.equal(r.out.outcome, "sender-not-allowed");
  assert.equal(r.r2.ops.length, 0);
});

test("a forged pass lower down, or from another authserv-id, is ignored", { skip }, async () => {
  const raw = mime({ auth: fail("town-a.example", TOWN), from: TOWN,
    extraHeaders: ["Authentication-Results: " + pass("town-a.example", TOWN),
      "Authentication-Results: evil.example; dkim=pass header.d=town-a.example"],
    files: [{ name: "a.csv", data: H.F.csv() }] });
  assert.equal((await run(TOWN, raw)).out.outcome, "sender-not-allowed");
  const raw2 = mime({ auth: null, from: TOWN,
    extraHeaders: ["Authentication-Results: evil.example; dkim=pass header.d=town-a.example; spf=pass smtp.mailfrom=" + TOWN],
    files: [{ name: "a.csv", data: H.F.csv() }] });
  const r = await run(TOWN, raw2);
  assert.equal(r.out.outcome, "no-trusted-auth");
  assert.equal(r.r2.ops.length, 0);
});

test("no Authentication-Results at all: nothing accepted", { skip }, async () => {
  const raw = mime({ auth: null, from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  assert.equal((await run(TOWN, raw)).out.outcome, "no-trusted-auth");
});

test("a filter forward from the owner (original From kept) is accepted", { skip }, async () => {
  // The town's own signature did not survive; the owner's mailbox authenticates.
  const raw = mime({ auth: "mx.cloudflare.net; dkim=pass header.d=mail-owner.example; spf=pass smtp.mailfrom=" + OWNER_CAF + "; dkim=fail header.d=town-a.example",
    from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  const { out, r2 } = await run(OWNER_CAF, raw);
  assert.equal(out.outcome, "accepted");
  assert.equal(out.stored, 1);
  assert.equal(index(r2).entries[0].slug, "town-a");
});

test("a manual forward from the owner: original sender read from the forwarded block", { skip }, async () => {
  const text = "FYI\r\n\r\n---------- Forwarded message ---------\r\nFrom: Clerk <" + TOWN + ">\r\nDate: Mon\r\nSubject: file\r\n";
  const raw = mime({ auth: pass("mail-owner.example", OWNER), from: OWNER, text, files: [{ name: "a.pdf", data: H.F.pdf() }] });
  const { out } = await run(OWNER, raw);
  assert.equal(out.outcome, "accepted");
  assert.equal(out.stored, 1);
});

test("a forward as an attached message: original From and its attachments", { skip }, async () => {
  const inner = mime({ auth: null, from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] }).toString();
  const raw = mime({ auth: pass("mail-owner.example", OWNER), from: OWNER, nested: inner });
  const { out, r2 } = await run(OWNER, raw);
  assert.equal(out.outcome, "accepted");
  assert.equal(out.stored, 1);
  assert.equal(index(r2).entries[0].slug, "town-a");
});

test("a forward from someone else is refused, whatever it quotes", { skip }, async () => {
  const text = "---------- Forwarded message ---------\r\nFrom: <" + TOWN + ">\r\n";
  const raw = mime({ auth: pass("elsewhere.example", STRANGER), from: STRANGER, text, files: [{ name: "a.csv", data: H.F.csv() }] });
  const r = await run(STRANGER, raw);
  assert.equal(r.out.outcome, "sender-not-allowed");
  assert.equal(r.r2.ops.length, 0);
  // Someone claiming to be the owner without passing auth for the owner's domain.
  const raw2 = mime({ auth: pass("elsewhere.example", STRANGER), from: OWNER, text, files: [{ name: "a.csv", data: H.F.csv() }] });
  assert.equal((await run(STRANGER, raw2)).out.outcome, "sender-not-allowed");
  // A lookalike owner address.
  const look = H.addr("owner", "mail-owner.example.elsewhere.example");
  const raw3 = mime({ auth: pass("mail-owner.example.elsewhere.example", look), from: look, text, files: [{ name: "a.csv", data: H.F.csv() }] });
  assert.equal((await run(look, raw3)).out.outcome, "sender-not-allowed");
});

test("no attachment", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN), from: TOWN });
  const r = await run(TOWN, raw);
  assert.equal(r.out.outcome, "no-attachments");
  assert.ok(!r.r2.ops.some((o) => o[0] === "put"));
});

test("oversize: a message over 25 MB is dropped unread; an attachment over 10 MB is skipped", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN), from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  const big = await run(TOWN, raw, { rawSize: 26 * 1024 * 1024 });
  assert.equal(big.out.outcome, "too-large");
  assert.equal(big.r2.ops.length, 0);
  const raw2 = mime({ auth: pass("town-a.example", TOWN), from: TOWN, files: [{ name: "big.csv", data: H.F.oversize() }, { name: "ok.pdf", data: H.F.pdf() }] });
  const r = await run(TOWN, raw2);
  assert.deepEqual([r.out.stored, r.out.skipped], [1, 1]);
});

test("nested zip, exe, xlsm and a type the source does not accept are dropped silently", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN), from: TOWN, files: [
    { name: "data.zip", data: H.F.nestedZip() }, { name: "report.pdf", data: H.F.exe() },
    { name: "book.xlsx", data: H.F.xlsm() }, { name: "enc.xlsx", data: H.F.ole() },
  ] });
  const r = await run(TOWN, raw);
  assert.deepEqual([r.out.outcome, r.out.stored, r.out.skipped], ["accepted", 0, 4]);
  assert.equal(dataKeys(r.r2).length, 0);
  const from = H.addr("records", "town-b.example");
  const raw2 = mime({ auth: pass("town-b.example", from), from, files: [{ name: "a.csv", data: H.F.csv() }] });
  const r2 = await run(from, raw2);
  assert.deepEqual([r2.out.stored, r2.out.skipped], [0, 1]);
});

test("not configured: nothing accepted", { skip }, async () => {
  const raw = mime({ auth: pass("town-a.example", TOWN), from: TOWN, files: [{ name: "a.csv", data: H.F.csv() }] });
  for (const k of ["ALLOWED_SENDERS", "MANUAL_SOURCES", "BUNDLES"]) {
    const r = await run(TOWN, raw, { env: { [k]: undefined } });
    assert.equal(r.out.outcome, "not-configured", k);
  }
});

test("a parser crash is caught and logged as a word, never a throw", async () => {
  const m = message(TOWN, Buffer.from("x"));
  const lines = [];
  console.log = (s) => lines.push(String(s));
  let out;
  try {
    out = await intake.handleEmail(m, { ...ENV_BASE(), BUNDLES: new H.FakeR2() }, { parse: async () => { throw new Error(TOWN); } });
  } finally { console.log = realLog; }
  assert.equal(out.outcome, "parse-error");
  assert.ok(!lines.join("").includes("@"));
  assert.deepEqual(m.calls, []);
});

test("logs: counts and a fixed word only, never an address, name or file name", { skip }, () => {
  assert.ok(logs.length > 10);
  for (const l of logs) {
    const o = JSON.parse(l);
    assert.deepEqual(Object.keys(o), ["event", "outcome", "stored", "duplicate", "skipped"]);
    assert.ok(intake.OUTCOMES.has(o.outcome));
    assert.ok(!l.includes("@") && !l.includes(".csv") && !l.includes("town-a") && !l.includes("example"), l);
  }
});

test("header parsing units", () => {
  const h = (value, key = "authentication-results") => [{ key, value }];
  const a = intake.trustedAuth(h("mx.cloudflare.net; dkim=pass (ok) header.d=Town-A.example; spf=pass smtp.mailfrom=" + TOWN));
  assert.deepEqual(a, { dkim: ["town-a.example"], spf: ["town-a.example"] });
  assert.equal(intake.trustedAuth(h("other.example; dkim=pass header.d=town-a.example")), null);
  assert.deepEqual(intake.trustedAuth(h("i=2; mx.cloudflare.net; dkim=pass header.d=x.example", "arc-authentication-results")), { dkim: ["x.example"], spf: [] });
  assert.equal(intake.isOwner(OWNER, OWNER_CAF), true);
  assert.equal(intake.isOwner(OWNER, H.addr("owner2", "mail-owner.example")), false);
  assert.equal(intake.isOwner(OWNER, H.addr("owner", "evil.example")), false);
  assert.equal(intake.normAddr(H.addr("owոer", "mail-owner.example")), "");
  const allowed = intake.parseAllowed({ [TOWN]: "town-a", "town-b.example": "town-b", "bad key": "town-c", [H.addr("x", "y.example")]: "Bad Slug" });
  assert.deepEqual([...allowed.keys()], [TOWN, "town-b.example"]);
  const free = intake.parseAllowed({ "gmail.com": "town-a", "Outlook.com": "town-a", [H.addr("office", "gmail.com")]: "town-a" });
  assert.deepEqual([...free.keys()], [H.addr("office", "gmail.com")], "a free-mail domain only as an exact address");
  assert.equal(intake.lookupSlug(allowed, H.addr("any", "sub.town-b.example")), null, "domains match exactly, not by suffix");
  assert.equal(intake.authPasses({ dkim: ["example"], spf: [] }, TOWN), false, "a one-label parent never aligns");
  assert.equal(intake.authPasses({ dkim: ["town-a.example"], spf: [] }, H.addr("x", "mail.town-a.example")), true);
});

test("the Worker source never calls reply, forward or setReject, and has no fetch handler", () => {
  for (const f of ["workers/manual-intake/src/intake.js", "workers/manual-intake/src/index.js"]) {
    const src = fs.readFileSync(path.join(H.REPO, f), "utf8").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\.reply\(|\.forward\(|setReject/.test(src), f);
    assert.ok(!/fetch\s*\(|async fetch|fetch:/.test(src), f);
  }
  const toml = fs.readFileSync(path.join(H.REPO, "workers/manual-intake/wrangler.toml"), "utf8");
  assert.match(toml, /^workers_dev = false$/m);
  assert.ok(!/\[vars\]/.test(toml), "no vars in the public toml");
  assert.ok(store.MAX_UPLOAD_BYTES === 10 * 1024 * 1024);
});
