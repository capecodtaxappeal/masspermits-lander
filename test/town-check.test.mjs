// "Check your towns" (homepage) and the town list it is built on.
//
// What this file proves:
//  * js/ma-towns.json and functions/api/_ma_towns.js are exactly what
//    scripts/build-ma-towns.mjs makes from admin/mission-towns.json, hold all
//    351 towns and carry no geometry;
//  * the status function in js/town-check.js, on an invented coverage file:
//    weekly, monthly, paused, errored and absent towns, the 10 and 55 day band
//    edges, alias resolution from the source aliases map, and a null (box
//    hidden) for any unexpected shape;
//  * it reads only source and last from each coverage row, and no shipped
//    file in this change reads owner, contractor or address fields;
//  * index.html: the Web3Forms call is byte for byte what it was, the extras
//    ride only on /api/request-sample, email is the only required field, the
//    role select has exactly the three options;
//  * no em or en dash in anything this change added.
//
// Every date and town status here is invented.
//
//   node --test test/town-check.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { buildPublic, buildServer, readSource, PUBLIC_OUT, SERVER_OUT } from "../scripts/build-ma-towns.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const DASH = new RegExp("[" + EM + EN + "]|&[mn]dash;|&#0*821[12];|&#[xX]0*201[34];");

// ---- the generated town list ----------------------------------------------------
test("ma-towns: both outputs match the source and hold 351 towns", async () => {
  const src = readSource();
  assert.equal(Object.keys(src.towns).length, 351);
  assert.equal(read(PUBLIC_OUT), buildPublic(src), PUBLIC_OUT + " is stale: run node scripts/build-ma-towns.mjs");
  assert.equal(read(SERVER_OUT), buildServer(src), SERVER_OUT + " is stale: run node scripts/build-ma-towns.mjs");

  const pub = JSON.parse(read(PUBLIC_OUT));
  assert.deepEqual(Object.keys(pub.towns), Object.keys(src.towns));
  for (const [n, t] of Object.entries(src.towns)) assert.equal(pub.towns[n], t.c, n);
  assert.deepEqual(pub.aliases, src.aliases);
  for (const a of Object.values(pub.aliases)) assert.ok(pub.towns[a], "alias target " + a);
  assert.doesNotMatch(read(PUBLIC_OUT), /"d":|"l":|viewBox/, "no geometry in the public copy");

  const { MA_TOWN_NAMES } = await import("../functions/api/_ma_towns.js");
  assert.equal(MA_TOWN_NAMES.length, 351);
  assert.deepEqual([...MA_TOWN_NAMES], Object.keys(src.towns));
  assert.ok(Object.isFrozen(MA_TOWN_NAMES));
});

// ---- the status function -----------------------------------------------------------
function loadApi() {
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("js/town-check.js"), ctx, { filename: "town-check.js" });
  return ctx.mpTownCheck;
}
const api = loadApi();
const TOWNS = api.checkTowns(JSON.parse(read(PUBLIC_OUT)));

const row = (source, last) => ({ source, rows: 1, first: "2025-01-01", last });
// Newest last date in the table: 2026-05-20.
const FIXTURE = {
  stats: {
    table: [
      row("Acton, MA", "2026-05-20"),        // weekly, the newest
      row("Ashby, MA", "2026-05-10"),        // weekly, exactly 10 days
      row("Boxborough, MA", "2026-05-09"),   // not monthly, 11 days: paused
      row("Adams, MA", "2026-04-10"),        // monthly, 40 days
      row("Alford, MA", "2026-03-26"),       // monthly, exactly 55 days
      row("Agawam, MA", "2026-03-25"),       // monthly, 56 days: paused
      row("Amesbury, MA", "2026-05-19"),     // errored this run: paused
      row("Salem, MA", "2026-05-18"),        // weekly, Essex
      row("Beverly, MA", "2026-05-01"),      // monthly, Essex
      row("Lynn, MA", "2026-01-02"),         // stale, Essex: not "covered"
      row("Foxboro, MA", "2026-05-15"),      // source named by its alias
    ],
    monthly: ["Adams, MA", "Alford, MA", "Agawam, MA", "Beverly, MA"],
    errors: ["Amesbury, MA", "Amherst, MA"],
  },
};
const CV = api.checkCoverage(FIXTURE, TOWNS);
const status = (q) => api.townStatus(api.resolveTown(q, TOWNS), CV, TOWNS);

test("status: weekly, monthly, paused, errored and absent towns", () => {
  assert.equal(api.WEEKLY_DAYS, 10);
  assert.equal(api.MONTHLY_DAYS, 55);
  assert.equal(CV.newest, "2026-05-20");

  assert.deepEqual({ ...status("Acton") }, { status: "weekly", last: "2026-05-20", label: "In the weekly file" });
  assert.equal(status("Ashby").label, "In the weekly file");
  assert.equal(status("Boxborough").label, "Paused, newest permit 2026-05-09");

  assert.equal(status("Adams").label, "Arrives monthly, newest permit 2026-04-10");
  assert.equal(status("Alford").label, "Arrives monthly, newest permit 2026-03-26");
  assert.equal(status("Agawam").label, "Paused, newest permit 2026-03-25");

  assert.equal(status("Amesbury").status, "paused");
  assert.equal(status("Amesbury").label, "Paused, newest permit 2026-05-19");
  assert.equal(status("Amherst").label, "Paused", "errored with no row: no date to show");

  const abs = status("Andover");
  assert.equal(abs.status, "absent");
  assert.equal(abs.label, "Not covered yet");
  assert.equal(abs.county, "Essex");
  assert.deepEqual([...abs.nearby], ["Beverly", "Salem"], "covered Essex towns only, not paused or errored ones");
  assert.deepEqual([...status("Gosnold").nearby], [], "no covered town in the county");
});

test("status: aliases resolve from the source aliases map", () => {
  const src = readSource();
  for (const [alias, canon] of Object.entries(src.aliases)) {
    assert.equal(api.resolveTown(alias, TOWNS), canon, alias);
    assert.equal(api.resolveTown("  " + alias.toUpperCase() + " ", TOWNS), canon, alias + " in caps");
  }
  assert.equal(api.resolveTown("foxboro", TOWNS), "Foxborough");
  assert.equal(status("foxboro").label, "In the weekly file", "a source named by its alias still counts");
  assert.equal(api.resolveTown("salem", TOWNS), "Salem");
  assert.equal(api.resolveTown("Springfield, IL", TOWNS), "");
  assert.equal(api.resolveTown("<script>", TOWNS), "");
  assert.equal(api.resolveTown("", TOWNS), "");
});

test("status: an unexpected coverage shape hides the box (null)", () => {
  const bad = [
    null, {}, { stats: {} }, { stats: { table: [], monthly: [], errors: [] } },
    { stats: { table: "x", monthly: [], errors: [] } },
    { stats: { table: [row("Acton, MA", "2026-05-20")], errors: [] } },
    { stats: { table: [row("Acton, MA", "2026-05-20")], monthly: [], errors: {} } },
    { stats: { table: [row("Acton, MA", "May 20")], monthly: [], errors: [] } },
    { stats: { table: [{ source: 5, last: "2026-05-20" }], monthly: [], errors: [] } },
    { stats: { table: [null], monthly: [], errors: [] } },
  ];
  for (const c of bad) assert.equal(api.checkCoverage(c, TOWNS), null, JSON.stringify(c));
  assert.equal(api.checkTowns({ towns: { Acton: "017" } }), null, "a truncated town list is refused");
  assert.equal(api.checkTowns(null), null);
});

test("status: nothing reads owner, contractor or address fields", () => {
  const seen = new Set();
  const spy = (r) => new Proxy(r, { get(t, k) { if (typeof k === "string") seen.add(k); return t[k]; } });
  const cov = { stats: { ...FIXTURE.stats, table: FIXTURE.stats.table.map((r) =>
    spy({ ...r, owner: "x", contractor: "x", address: "x", addr: "x" })) } };
  const cv = api.checkCoverage(cov, TOWNS);
  for (const n of ["Acton", "Andover", "Adams"]) api.townStatus(n, cv, TOWNS);
  assert.deepEqual([...seen].sort(), ["last", "source"]);

  const FIELD = /\b(owner|contractor|address|addr)\b\s*[:\]'"]|\.(owner|contractor|address|addr)\b/i;
  for (const rel of ["js/town-check.js", "scripts/build-ma-towns.mjs", SERVER_OUT]) {
    assert.doesNotMatch(read(rel), FIELD, rel);
  }
  const rs = read("functions/api/request-sample.js");
  assert.doesNotMatch(rs, /b\.(owner|contractor|address|addr)\b/, "request-sample reads no such field from the form");
});

// ---- index.html ----------------------------------------------------------------------
const HTML = read("index.html");
const blocks = () => {
  const out = [];
  const re = /<!-- ===== TOWN CHECK[^\n]*begin[\s\S]*?TOWN CHECK[^\n]*end ===== -->/g;
  let m;
  while ((m = re.exec(HTML))) out.push(m[0]);
  return out;
};

test("index.html: marked blocks, three roles, email the only required field", () => {
  const b = blocks();
  assert.equal(b.length, 2, "check box block and sample extras block");
  assert.match(b[0], /id="town-check" hidden/);
  assert.match(b[0], /Check your towns/);
  assert.match(b[0], /src="\/js\/town-check\.js"/);
  const roles = [...b[1].matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]);
  assert.deepEqual(roles, ["", ...api.ROLES]);
  assert.deepEqual([...api.ROLES], ["Owner or on the tools", "Office, sales or estimating", "Supplier or distributor"]);

  const form = HTML.match(/<form id="signup-form">[\s\S]*?<\/form>/)[0];
  assert.deepEqual([...form.matchAll(/<(input|select)\b[^>]*\brequired\b/g)].map((m) => m[0].match(/id="([^"]+)"/)[1]), ["email"]);
  assert.match(read("js/town-check.js"), /"Get a free sample for these towns"/);
});

test("index.html: Web3Forms call is unchanged; extras go only to /api/request-sample", () => {
  const w3 = HTML.match(/const resp = await fetch\("https:\/\/api\.web3forms\.com\/submit",\{[\s\S]*?\}\);/)[0];
  const sha = crypto.createHash("sha256").update(w3).digest("hex");
  // sha256 of this block on main before the town check landed; any edit to the call fails here.
  assert.equal(sha, "80c356b8d401406e78280faccfab189e3900abcf8d3847f6e4a2960517967094", "Web3Forms block changed");
  assert.doesNotMatch(w3, /mpSampleExtras|towns|role/);
  const rs = HTML.match(/fetch\("\/api\/request-sample"[\s\S]*?\}catch\(_e\)\{\}/)[0];
  assert.match(rs, /window\.mpSampleExtras \? window\.mpSampleExtras\(\) : \{\}/);
  assert.equal((HTML.match(/mpSampleExtras\(\)/g) || []).length, 1, "called in the request-sample call only");
});

test("no em or en dash in anything this change added", () => {
  for (const rel of ["js/town-check.js", "js/ma-towns.json", "scripts/build-ma-towns.mjs", SERVER_OUT,
    "functions/api/request-sample.js", "test/town-check.test.mjs", "test/request-sample-towns.test.mjs",
    "test/town-check-layout.test.mjs", "test/_request_sample_harness.mjs"]) {
    assert.doesNotMatch(read(rel), DASH, rel);
  }
  for (const b of blocks()) assert.doesNotMatch(b, DASH, "index.html TOWN CHECK block");
  const line = HTML.split("\n").find((l) => l.includes("TOWN CHECK: optional towns and role"));
  assert.ok(line);
  assert.doesNotMatch(line, DASH);
});
