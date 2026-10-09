// Mail mirror drift test: _rehearsal_mail.js renderWeekly() against the SHIPPED
// weekly-send.js.
//
//   node functions/api/rehearsal_mirror.test.mjs
//
// weekly-send.js and _presend.js are copied byte for byte into a temp dir; only
// _github-oidc.js is replaced (stub verdict {ok:true}). onRequest runs against
// an in-memory R2 and a fetch stub that answers ONLY the Resend URL (captured,
// nothing leaves the process) and throws on anything else. Every captured
// subject+html must equal renderWeekly() for 3 synthetic subscribers, with and
// without a token, with and without coverage.
//
// Mutation proof: one character of the html in the temp COPY is changed and
// the same comparison must then FAIL. The shipped file is never edited.

import { renderWeekly } from "./_rehearsal_mail.js";
import {
  fakeR2, makeFetchStub, resendFixture, makeRunner, loadWeeklySend, tok, zipBytes,
} from "../../test/rehearsal/harness.mjs";

const resend = resendFixture("https://api.resend.com/emails");
const stub = makeFetchStub({ [resend.url]: resend.handler });
globalThis.fetch = stub.fetch;

const { check, done } = makeRunner("rehearsal_mirror.test.mjs");

const SUBS = [
  { email: "alex.testperson@example.com", name: "Alex Testperson", customer: "cus_TEST1",
    since: "2026-09-01", active: true, token: tok("a") },
  { email: "sam.fixture@example.com", name: "", customer: "cus_TEST2",
    since: "2026-09-02", active: true, token: "" },
  { email: "jo.sample@example.com", name: "Jo Q Sample", customer: "cus_TEST3",
    since: "2026-09-03", active: true, token: tok("b") },
  { email: "old.row@example.com", name: "Old Row", customer: "cus_TEST4",
    since: "2026-08-01", active: false, cancelled: "2026-09-10", token: tok("c") },
];
const COVERAGE = { live_sources: 39, expected_sources: 140, disclose: true,
                   monthly_sources: ["Springfield, MA", "Lowell, MA"] };

function world(coverage) {
  const status = { ok: true, ran_at: new Date(Date.now() - 3600_000).toISOString(),
                   ...(coverage ? { coverage } : { coverage: { ...COVERAGE, disclose: false } }),
                   bundle: { weekly: { rows: 120, rowset_sha256: "f".repeat(64) } } };
  return fakeR2({
    "refresh-status.json": status,
    "subscribers.json": SUBS,
    "latest-weekly.zip": { __r2: {}, value: zipBytes(128) },
  });
}

async function runOnce(ws, coverage) {
  const r2 = world(coverage);
  const before = resend.sent.length;
  const dates = [new Date().toISOString().slice(0, 10)];
  const res = await ws.mod.onRequest({
    request: new Request("https://rehearsal.test/weekly", { method: "POST" }),
    env: { BUNDLES: r2.bucket, RESEND_API_KEY: "re_test_x", FROM_EMAIL: "MassPermits <leads@example.com>" },
    waitUntil() {},
  });
  dates.push(new Date().toISOString().slice(0, 10));
  return { res, r2, bodies: resend.sent.slice(before), dates };
}

function compare(bodies, coverage, dates) {
  let mismatches = 0, compared = 0;
  for (const s of SUBS.filter((x) => x.active !== false)) {
    const b = bodies.find((x) => Array.isArray(x.to) && x.to.length === 1 && x.to[0] === s.email);
    if (!b) { mismatches++; continue; }
    const want = dates.map((date) => renderWeekly({ name: s.name || "", token: s.token || "", coverage, date }));
    const hit = want.find((w) => w.subject === b.subject && w.html === b.html &&
      b.attachments && b.attachments[0] && b.attachments[0].filename === w.attachmentName);
    compared++;
    if (!hit) mismatches++;
  }
  return { mismatches, compared };
}

// 1. unmutated copy: identical
{
  const ws = await loadWeeklySend();
  ws.setVerdict({ ok: true, payload: {} });
  check("temp copies of weekly-send.js and _presend.js are byte-identical to the shipped files",
    ws.byteIdentical());
  for (const coverage of [null, COVERAGE]) {
    const label = coverage ? "with coverage" : "without coverage";
    const { res, bodies, dates } = await runOnce(ws, coverage);
    check(`${label}: weekly-send.js returned 200`, res.status === 200, res.status);
    check(`${label}: exactly 3 Resend bodies (the inactive row is not mailed)`, bodies.length === 3, bodies.length);
    check(`${label}: no Resend body addressed to the inactive row`,
      !bodies.some((b) => JSON.stringify(b.to).includes("old.row@")));
    check(`${label}: every body has one recipient, no cc or bcc`,
      bodies.every((b) => Array.isArray(b.to) && b.to.length === 1 && !("cc" in b) && !("bcc" in b)));
    const { mismatches, compared } = compare(bodies, coverage, dates);
    check(`${label}: subject + html + attachment name === renderWeekly for all 3`,
      compared === 3 && mismatches === 0, `compared ${compared}, mismatches ${mismatches}`);
  }
  check("the token-less subscriber's email has no download button",
    !renderWeekly({ name: "", token: "", coverage: null, date: "2026-10-05" }).html.includes("my-leads"));
  check("the coverage render carries the monthly-sources sentence",
    renderWeekly({ name: "", token: "", coverage: COVERAGE, date: "2026-10-05" }).html.includes("Springfield, Lowell"));
}

// 2. mutation proof: one character of the html changed in the temp COPY
{
  const needle = "your building-permit leads for the week are attached.";
  const ws = await loadWeeklySend({
    mutate: (src) => {
      if (!src.includes(needle)) throw new Error("mutation needle not found in weekly-send.js");
      return src.replace(needle, needle.replace("attached.", "attached!"));
    },
  });
  ws.setVerdict({ ok: true, payload: {} });
  check("the mutated copy is NOT byte-identical (the mutation took)", !ws.byteIdentical());
  const { bodies, dates } = await runOnce(ws, null);
  const { mismatches } = compare(bodies, null, dates);
  check("MUTATION PROOF: the mirror comparison FAILS against the mutated copy",
    mismatches === 3, `mismatches ${mismatches}`);
  console.log(`MUTATION result: 1 character changed in the temp copy -> ${mismatches}/3 renders differ`);
}

// 3. the OIDC stub gates the copy exactly as the real module would be relied on
{
  const ws = await loadWeeklySend();
  ws.setVerdict({ ok: false, reason: "test" });
  const before = resend.sent.length;
  const r2 = world(null);
  const res = await ws.mod.onRequest({
    request: new Request("https://rehearsal.test/weekly", { method: "POST" }),
    env: { BUNDLES: r2.bucket }, waitUntil() {},
  });
  check("stub verdict ok:false -> 401 and 0 Resend calls", res.status === 401 && resend.sent.length === before);
  check("stub verdict ok:false -> 0 R2 operations", r2.ops.length === 0, r2.ops.length);
  ws.setVerdict(undefined);
}

check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
check("fetch stub: every call went to the Resend fixture",
  stub.calls.every((c) => c.url === resend.url && c.method === "POST"));
done();
