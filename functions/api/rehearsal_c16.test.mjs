// C16 (Extended, judged in CI, not per run): the shipped newsletter-send.js
// and nurture.js make 0 Resend calls to a synthetic payer.
//
//   node functions/api/rehearsal_c16.test.mjs
//
// TEST METHOD: each shipped file is copied byte for byte into a temp dir with
// a {"type":"module"} package.json; ONLY _github-oidc.js is replaced, by a stub
// that says ok. The fake R2 holds a synthetic payer (active in
// subscribers.json) who is ALSO a confirmed newsletter reader and a due
// nurture prospect, plus one non-payer control who must be mailed (so the test
// is not vacuous). Every fetch goes to the throwing stub; the Resend URL and
// the feed URLs are fixture routes, recorded and never sent.
//
// Drill I-08 (payer on the newsletter list): the fault is the same run over a
// temp copy whose payer suppression is removed; the check must then see a
// Resend call to the payer.

import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { makeRunner, makeFetchStub, resendFixture, fakeR2, API_DIR } from "../../test/rehearsal/harness.mjs";

const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
const FEED = { items: [{ _town: "Testville", _trade: "Roofing", date_published: "2026-09-20", title: "Reroof" },
  { _town: "Testville", _trade: "Roofing", date_published: "2026-09-21", title: "Reroof" }], _window_total: 2 };
const stub = makeFetchStub({ [RESEND]: rs.handler, "https://masspermits.com/feed/*": () => FEED });
globalThis.fetch = stub.fetch;
const { check, done } = makeRunner("rehearsal_c16.test.mjs");

async function load(file, mutate) {
  const dir = mkdtempSync(join(tmpdir(), "mp-c16-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const src = readFileSync(join(API_DIR, file), "utf8");
  const out = mutate ? mutate(src) : src;
  if (mutate && out === src) throw new Error("mutation did not apply to " + file);
  writeFileSync(join(dir, file), out);
  writeFileSync(join(dir, "_github-oidc.js"), "export async function verifyGitHubOIDC() { return { ok: true, payload: {} }; }\n");
  const mod = await import(pathToFileURL(join(dir, file)).href + "?v=" + randomUUID());
  return { mod, identical: out === src };
}

const PAYER = "payer.one@example.com";
const CONTROL = "reader.two@example.com";
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
function world(subs) {
  const init = {
    "refresh-status.json": { ok: true, ran_at: iso(now - 3600_000) },
    [`newsletter/${encodeURIComponent(PAYER)}`]: { __r2: { customMetadata: { c: "1", tok: "t1", town: "" } }, value: "" },
    [`newsletter/${encodeURIComponent(CONTROL)}`]: { __r2: { customMetadata: { c: "1", tok: "t2", town: "" } }, value: "" },
    [`prospects/${encodeURIComponent(PAYER)}`]: { __r2: { customMetadata: { stage: "1", ts: iso(now - 4 * 86400_000), trade: "Roofing" } }, value: "{}" },
    [`prospects/${encodeURIComponent(CONTROL)}`]: { __r2: { customMetadata: { stage: "1", ts: iso(now - 4 * 86400_000), trade: "Roofing" } }, value: "{}" },
  };
  if (subs !== undefined) init["subscribers.json"] = subs;
  return fakeR2(init);
}
// The payer as the Stripe webhook writes them (active: true), with the case
// and whitespace a hand edit can leave.
const PAYER_ROW = [{ email: " Payer.One@Example.com ", name: "Pat Testperson", customer: "cus_TEST1", active: true, since: "2026-08-01" }];
const ENV = (w) => ({ BUNDLES: w.bucket, RESEND_API_KEY: "re_test_key", FROM_EMAIL: "news@example.com" });

async function run(mod, w, path) {
  const before = rs.sent.length;
  const r = await mod.onRequest({ request: new Request("https://masspermits.com" + path, { method: "POST" }), env: ENV(w) });
  const text = await r.text();
  const to = rs.sent.slice(before).flatMap((m) => m.to.map((t) => String(t).trim().toLowerCase()));
  return { status: r.status, text, to };
}

const SENDERS = [
  ["newsletter-send.js", "/api/newsletter-send",
    (s) => s.replace("const kept = readers.filter(r => !payers.has(", "const kept = readers.filter(r => true || !payers.has(")],
  ["nurture.js", "/api/nurture",
    (s) => s.replace("if (payers.has(String(email).trim().toLowerCase())) { suppressed++; continue; }",
      "if (false) { suppressed++; continue; }")],
];

const table = [];
for (const [file, path, mutate] of SENDERS) {
  const shipped = await load(file);
  check(`${file}: loaded byte for byte (only _github-oidc.js stubbed)`, shipped.identical);
  const ok = await run(shipped.mod, world(PAYER_ROW), path);
  const pass = ok.to.filter((t) => t === PAYER).length === 0 && ok.to.includes(CONTROL);
  check(`C16 ${file}: 0 Resend calls to the synthetic payer, the non-payer control IS mailed`, pass, ok.to.join(","));

  const fault = await (await load(file, mutate)).mod;
  const f = await run(fault, world(PAYER_ROW), path);
  const caught = f.to.includes(PAYER);
  check(`I-08 ${file}: with the suppression removed (temp copy), the check sees a call to the payer`, caught, f.to.join(","));
  table.push(["I-08", file, `${caught ? "NO-GO (payer mailed)" : "missed"}; twin ${pass ? "PASS" : "FAIL"}`, caught && pass ? "Y" : "N"]);

  for (const [label, subs] of [["missing", undefined], ["corrupt", "{\"a\":"], ["an object", { email: PAYER }]]) {
    const x = await run(shipped.mod, world(subs), path);
    check(`C16 ${file}: subscribers.json ${label} -> fails closed, 0 Resend calls`, x.status === 500 && x.to.length === 0, x.to.join(","));
  }
  const inactive = await run(shipped.mod, world([{ ...PAYER_ROW[0], active: false, cancelled: "2026-09-01" }]), path);
  check(`C16 ${file}: a CANCELLED former payer is marketing again (active:false is not suppressed)`, inactive.to.includes(PAYER));

  // Recorded, not asserted: a payer row with no `active` field at all. The
  // rehearsal counts such a row as active (active !== false); these senders
  // suppress only active === true.
  const legacy = await run(shipped.mod, world([{ ...PAYER_ROW[0], active: undefined }]), path);
  console.log(`NOTE ${file}: a payer row with no "active" field is ${legacy.to.includes(PAYER) ? "MAILED" : "not mailed"}`);
}
check("10 0 non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));

console.log("\nDRILL TABLE (C16)");
for (const [id, c, r, y] of table) console.log(`${id.padEnd(16)} | C16 ${c.padEnd(20)} | ${r} | ${y}`);
done();
