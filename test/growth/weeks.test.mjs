// Road to 100: weeks run Monday 00:00 to Monday 00:00 in America/New_York.
// The UTC edges, the clock changes and the year end.
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_harness.mjs";

const { g, stub, call, envOf } = await H.growthSetup();
const D = g.data;
const iso = (t) => new Date(t).toISOString();

test("13 weeks, oldest first, the last one is this week and holds now", () => {
  const now = H.T("2026-09-27T18:00:00Z"); // Sunday afternoon in Boston
  const grid = D.weekGrid(now);
  assert.equal(grid.weeks.length, 13);
  assert.equal(grid.weeks[12].week, "2026-09-21");
  assert.equal(grid.weeks[12].last_day, "2026-09-27");
  assert.equal(grid.weeks[12].current, true);
  assert.equal(grid.weeks[0].week, "2026-06-29");
  assert.equal(iso(grid.weeks[12].start), "2026-09-21T04:00:00.000Z");
  assert.equal(iso(grid.weeks[12].end), "2026-09-28T04:00:00.000Z");
  assert.equal(grid.before.week, "2026-06-22");
  for (let i = 1; i < 13; i++) assert.equal(grid.weeks[i].start, grid.weeks[i - 1].end, "weeks touch");
  assert.equal(D.weekIndex(grid, now), 12);
});

test("Sunday late evening in Boston is already Monday in UTC: it stays in Sunday's week", () => {
  const grid = D.weekGrid(H.T("2026-09-27T18:00:00Z"));
  // 23:30 Sunday 2026-09-20 in Boston = 03:30 Monday UTC
  assert.equal(D.weekIndex(grid, H.T("2026-09-21T03:30:00Z")), 11);
  assert.equal(D.weekIndex(grid, H.T("2026-09-21T03:59:59.999Z")), 11);
  assert.equal(D.weekIndex(grid, H.T("2026-09-21T04:00:00Z")), 12);
  // 00:30 Monday UTC is still Sunday 20:30 in Boston
  assert.equal(D.weekIndex(grid, H.T("2026-09-21T00:30:00Z")), 11);
  // before the first week and after this week: outside
  assert.equal(D.weekIndex(grid, H.T("2026-06-29T03:59:00Z")), -1);
  assert.equal(D.weekIndex(grid, H.T("2026-09-28T04:00:00Z")), -1);
});

test("winter weeks start at 05:00 UTC, summer weeks at 04:00 UTC", () => {
  const winter = D.weekGrid(H.T("2026-12-02T12:00:00Z"));
  assert.equal(winter.weeks[12].week, "2026-11-30");
  assert.equal(iso(winter.weeks[12].start), "2026-11-30T05:00:00.000Z");
  // Sunday 23:59 in Boston = 04:59 Monday UTC in winter
  assert.equal(D.weekIndex(winter, H.T("2026-11-30T04:59:00Z")), 11);
  assert.equal(D.weekIndex(winter, H.T("2026-11-30T05:00:00Z")), 12);
});

test("the week the clocks go back is 7 days and 1 hour; the week they go forward is 7 days less 1 hour", () => {
  const fall = D.weekGrid(H.T("2026-11-04T12:00:00Z"));
  const oct26 = fall.weeks.find((w) => w.week === "2026-10-26");
  assert.equal(iso(oct26.start), "2026-10-26T04:00:00.000Z");
  assert.equal(iso(oct26.end), "2026-11-02T05:00:00.000Z");
  assert.equal(oct26.end - oct26.start, 7 * H.DAY + H.HOUR);
  // Sunday 2026-11-01 23:30 EST = 04:30 UTC Monday: still the week of Oct 26
  assert.equal(fall.weeks[D.weekIndex(fall, H.T("2026-11-02T04:30:00Z"))].week, "2026-10-26");
  const spring = D.weekGrid(H.T("2027-03-17T12:00:00Z"));
  const mar8 = spring.weeks.find((w) => w.week === "2027-03-08");
  assert.equal(iso(mar8.start), "2027-03-08T05:00:00.000Z");
  assert.equal(iso(mar8.end), "2027-03-15T04:00:00.000Z");
  assert.equal(mar8.end - mar8.start, 7 * H.DAY - H.HOUR);
});

test("now exactly at Monday 00:00 in Boston opens a new week; the year end keeps ISO Monday weeks", () => {
  const monday = H.T("2026-09-28T04:00:00Z");
  const grid = D.weekGrid(monday);
  assert.equal(grid.weeks[12].week, "2026-09-28");
  assert.equal(grid.weeks[12].start, monday);
  const ny = D.weekGrid(H.T("2027-01-01T15:00:00Z")); // Friday
  assert.equal(ny.weeks[12].week, "2026-12-28");
  assert.equal(ny.weeks[12].last_day, "2027-01-03");
  // New Year's Eve 23:30 in Boston = 04:30 UTC Jan 1: same week either way
  assert.equal(D.weekIndex(ny, H.T("2027-01-01T04:30:00Z")), 12);
});

test("through the route: visits, clicks and checkouts land in the Boston week, not the UTC day", async () => {
  const now = H.T("2026-09-27T18:00:00Z");
  const r2 = new H.GrowthR2();
  r2.hit(H.T("2026-06-01T12:00:00Z"));                 // data start, long before the window
  const lateSunday = H.T("2026-09-21T03:30:00Z");       // Sunday 23:30 in Boston, Monday in UTC
  const earlyMonday = H.T("2026-09-21T04:30:00Z");      // Monday 00:30 in Boston
  r2.hit(lateSunday); r2.hit(earlyMonday); r2.hit(earlyMonday + 1);
  r2.click(H.T("2026-09-14T12:00:00Z"));                // clicks data start
  r2.click(lateSunday); r2.click(earlyMonday);
  // before the window: Sunday 2026-06-28 23:30 in Boston is Monday 03:30 UTC, the first key day
  r2.hit(H.T("2026-06-29T03:30:00Z"));
  r2.hit(H.T("2026-06-29T04:30:00Z"));                  // Monday 00:30: inside the first week
  g.stripe.resetGrowthCaches();
  stub.stripe = H.stripeServer({ sessions: [H.session(lateSunday, "complete"), H.session(earlyMonday, "expired")], subscriptions: [] });
  const res = await call({ env: envOf(r2, H.stripeEnv()), now });
  const w = res.body.weeks;
  assert.equal(w[12].visits, 2);
  assert.equal(w[11].visits, 1);
  assert.equal(w[0].visits, 1, "the Sunday before the window is not counted");
  assert.equal(w[12].buy_clicks, 1);
  assert.equal(w[11].buy_clicks, 2);
  assert.equal(w[12].checkouts, 1);
  assert.equal(w[12].abandoned, 1);
  assert.equal(w[11].paid, 1);
});
