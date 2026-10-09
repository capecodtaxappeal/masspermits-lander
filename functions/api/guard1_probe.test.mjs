// GUARD 1 behaviour probe: does the SHIPPED weekly-send.js leave out a
// subscriber who already has this delivery week's email?
//
//   node functions/api/guard1_probe.test.mjs
//
// GUARD 1 is the rehearsal's name for "one weekly email per subscriber per
// delivery week" (the 2026-09-07 double send, incident I-18). The rehearsal
// first detected it by the string "selectRecipients", a name that never
// shipped: main shipped the guard as deliveredSince() and deliveryWeekStart()
// in _presend.js (2199b6d77), so C9 called it absent and gave a false NO-GO
// C9.guard1_late every weekend. This probe asks the behaviour instead of a
// name, so a rename cannot fool it either way.
//
// weekly-send.js and _presend.js are copied byte for byte into a temp dir;
// only _github-oidc.js is replaced (stub verdict {ok:true}). onRequest runs
// against an in-memory R2 whose send log says subscriber A was delivered one
// second ago and subscriber B was not. The send log entry carries no
// bundle_etag, so the older etag guard cannot be what stops a second send.
// fetch is a stub that answers ONLY the Resend URL (captured, nothing leaves
// the process) and throws on anything else.
//
// Prints "GUARD1 probe: present" or "GUARD1 probe: absent". The mirror step
// (scripts/rehearsal/mirror.mjs) turns that line into c9.guard1_present.
// Mutation proof: the same run against a temp COPY with the guard's filter
// removed must print absent. The shipped file is never edited.

import {
  fakeR2, makeFetchStub, resendFixture, makeRunner, loadWeeklySend, tok, zipBytes,
} from "../../test/rehearsal/harness.mjs";

const resend = resendFixture("https://api.resend.com/emails");
const stub = makeFetchStub({ [resend.url]: resend.handler });
globalThis.fetch = stub.fetch;

const { check, done } = makeRunner("guard1_probe.test.mjs");

const HAD = { email: "had.it@example.com", name: "Had It", customer: "cus_TEST1",
  since: "2026-09-01", active: true, token: tok("a") };
const NOT_YET = { email: "not.yet@example.com", name: "Not Yet", customer: "cus_TEST2",
  since: "2026-09-02", active: true, token: tok("b") };

function world(now) {
  return fakeR2({
    "refresh-status.json": { ok: true, ran_at: new Date(now - 3600_000).toISOString(),
      coverage: { live_sources: 39, expected_sources: 140, disclose: false },
      bundle: { weekly: { rows: 120, rowset_sha256: "f".repeat(64) } } },
    "subscribers.json": [HAD, NOT_YET],
    "latest-weekly.zip": { __r2: {}, value: zipBytes(128) },
    "feed-send-log.json": [{ at: new Date(now - 1000).toISOString(), subscribers: 2,
      sent: [{ to: HAD.email, ok: true }] }],
  });
}

async function probe(ws) {
  const now = Date.now();
  const r2 = world(now);
  const before = resend.sent.length;
  ws.setVerdict({ ok: true, payload: {} });
  const res = await ws.mod.onRequest({
    request: new Request("https://rehearsal.test/weekly", { method: "POST" }),
    env: { BUNDLES: r2.bucket, RESEND_API_KEY: "re_test_x", FROM_EMAIL: "MassPermits <leads@example.com>" },
    waitUntil() {},
  });
  ws.setVerdict(undefined);
  const bodies = resend.sent.slice(before);
  const to = (e) => bodies.filter((b) => Array.isArray(b.to) && b.to.includes(e)).length;
  const toHad = to(HAD.email), toNotYet = to(NOT_YET.email);
  return { status: res.status, toHad, toNotYet, present: toHad === 0 && toNotYet === 1 };
}

// 1. the shipped code
{
  const ws = await loadWeeklySend();
  check("temp copies of weekly-send.js and _presend.js are byte-identical to the shipped files", ws.byteIdentical());
  const p = await probe(ws);
  console.log("GUARD1 probe: " + (p.present ? "present" : "absent"));
  check("the shipped weekly-send.js answered 200", p.status === 200, p.status);
  check("GUARD 1: a subscriber delivered one second ago is not mailed again this week", p.toHad === 0, p.toHad);
  check("GUARD 1: a subscriber not yet delivered this week is still mailed, once", p.toNotYet === 1, p.toNotYet);
}

// 2. mutation proof: the guard's recipient filter removed in the temp COPY
{
  const needle = "const todo = subs.filter((s) => !haveIt.has(normEmail(s.email)));";
  let found = false;
  const ws = await loadWeeklySend({
    mutate: (src) => {
      found = src.includes(needle);
      return found ? src.replace(needle, "const todo = subs;") : src;
    },
  });
  check("mutation needle found in weekly-send.js (re-anchor this probe if the guard's line moved)", found);
  if (found) {
    const p = await probe(ws);
    check("MUTATION PROOF: without the filter the probe reads absent", !p.present && p.toHad === 1,
      JSON.stringify(p));
  }
}

check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
done();
