// Road to 100: paying subscribers at each week end, from Stripe's start and
// ended timestamps: active, trialing or past_due count; cancels stop counting
// when they end.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const D = g.data;
const S = (ms) => Math.floor(ms / 1000);
const T0 = H.T("2026-09-01T12:00:00Z");

test("payingAt: status and timestamps", () => {
  const at = T0;
  const cases = [
    [{ start: S(at - H.DAY), ended: null, status: "active" }, 1],
    [{ start: S(at - H.DAY), ended: null, status: "trialing" }, 1],
    [{ start: S(at - H.DAY), ended: null, status: "past_due" }, 1],
    [{ start: S(at + H.DAY), ended: null, status: "active" }, 0],                 // not started yet
    [{ start: S(at), ended: null, status: "active" }, 1],                         // started this instant
    [{ start: S(at - 9 * H.DAY), ended: S(at - H.DAY), status: "canceled" }, 0],  // cancelled and ended before
    [{ start: S(at - 9 * H.DAY), ended: S(at + H.DAY), status: "canceled" }, 1],  // ended later: still paying then
    [{ start: S(at - 9 * H.DAY), ended: S(at), status: "canceled" }, 0],          // ended at that instant
    [{ start: S(at - 9 * H.DAY), ended: null, status: "canceled" }, 0],           // cancelled with no end: never guess
    [{ start: S(at - H.DAY), ended: null, status: "incomplete" }, 0],
    [{ start: S(at - H.DAY), ended: S(at + H.DAY), status: "incomplete_expired" }, 0],
    [{ start: S(at - H.DAY), ended: null, status: "unpaid" }, 0],
    [{ start: S(at - H.DAY), ended: null, status: "paused" }, 0],
    [{ start: "yesterday", ended: null, status: "active" }, 0],
  ];
  for (const [s, want] of cases) assert.equal(D.payingAt([s], at), want, JSON.stringify(s));
  assert.equal(D.payingAt(cases.map((c) => c[0]), at), cases.reduce((a, c) => a + c[1], 0));
});

test("the weekly series with a cancel, a past_due, a trial and a scheduled cancel", async () => {
  const now = H.T("2026-09-27T18:00:00Z");
  const grid = D.weekGrid(now);
  const wk = (i) => grid.weeks[i];
  const subs = [
    H.sub(wk(0).start - 30 * H.DAY, "active"),                                   // all 13 weeks
    H.sub(wk(2).start + H.DAY, "canceled", { ended: wk(6).start + H.DAY, canceled: wk(5).start }), // weeks 2..5 at week end
    H.sub(wk(9).start + H.HOUR, "past_due"),                                       // weeks 9..12
    H.sub(now - 2 * H.DAY, "trialing"),                                            // this week only
    H.sub(wk(4).start + H.HOUR, "active", { cancelAt: now + 20 * H.DAY }),         // cancels next month: still paying
    H.sub(wk(3).start, "incomplete_expired"),                                      // never paid
    H.sub(wk(1).start, "active", { price: H.IRWATCH }),                            // another product
  ];
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [], subscriptions: subs });
  const r2 = new H.GrowthR2();
  const res = await call({ env: envOf(r2, H.stripeEnv()), now });
  const got = res.body.weeks.map((w) => w.subscribers);
  //            0  1  2  3  4  5  6  7  8  9 10 11 12
  const want = [1, 1, 2, 2, 3, 3, 2, 2, 2, 3, 3, 3, 4];
  assert.deepEqual(got, want);
  assert.equal(res.body.paying_now, 4);
});

test("the ended instant decides the week: ended just before a week end is out, just after is in", async () => {
  const now = H.T("2026-09-27T18:00:00Z");
  const grid = D.weekGrid(now);
  const end11 = grid.weeks[11].end;
  const subs = [
    H.sub(grid.weeks[0].start, "canceled", { ended: end11 - 1000 }),
    H.sub(grid.weeks[0].start, "canceled", { ended: end11 + 1000 }),
  ];
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [], subscriptions: subs });
  const res = await call({ env: envOf(new H.GrowthR2(), H.stripeEnv()), now });
  assert.equal(res.body.weeks[10].subscribers, 2);
  assert.equal(res.body.weeks[11].subscribers, 1);
  assert.equal(res.body.weeks[12].subscribers, 0);
  assert.equal(res.body.paying_now, 0);
});
