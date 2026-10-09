// R3b, the runner side: ghJobLog (C15's log download, acceptance 10), the
// c15.feed_log_emails fact, the C15 repository scan (I-03, I-07), the C22 DNS
// baseline (I-23) and docs/rehearsal/seed-reporter.gs (C20's reporter).
//
//   node scripts/rehearsal/r3b_runner.test.mjs
//
// The global fetch is the throwing stub. No DNS query is made: c22.mjs gets
// an injected resolver, and node:dns's Resolver is patched to count (and
// refuse) any real lookup. The Apps Script runs in node:vm against fake
// GmailApp, UrlFetchApp, PropertiesService and ScriptApp objects.
// Every address below is synthetic (@example.com).

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dnsp } from "node:dns";
import vm from "node:vm";
import { makeRunner, makeFetchStub, fakeR2, readText } from "../../test/rehearsal/harness.mjs";
import * as G from "../../test/rehearsal/r3a_fixtures.mjs";
import { RUNNER_SCHEMA, validateRunnerFacts, fact } from "../../functions/api/_rehearsal.js";
import * as H from "./http.mjs";
import * as Fa from "./facts.mjs";
import * as C15 from "./c15.mjs";
import * as C22 from "./c22.mjs";
import * as Seed from "../../functions/api/rehearsal-seed.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..");
const { check, done } = makeRunner("r3b_runner.test.mjs");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const at = (s) => Date.parse(s);
const LEAK = /@|[0-9a-f]{32}|cus_|\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Ave|Avenue|Lane|Ln|Way|Drive|Dr)\b/;
const printed = [];
const realLog = console.log;
async function capture(fn) {
  const lines = [];
  console.log = (...x) => { lines.push(x.join(" ")); };
  try { return { value: await fn(), lines }; } finally { console.log = realLog; printed.push(...lines); }
}

// No real DNS: every lookup through node:dns's Resolver is counted and refused.
let realDns = 0;
for (const m of ["resolveTxt", "resolveMx", "resolve", "resolve4", "resolveAny"]) {
  dnsp.Resolver.prototype[m] = async () => { realDns++; throw Object.assign(new Error("no DNS in tests"), { code: "EREFUSED" }); };
}

// ── the fetch stub: the GitHub API and the one log host ────────────────────
const GH = "https://api.github.com/repos/capecodtaxappeal/masspermits-lander/";
const LOG = "https://" + H.LOG_HOST + "/";
let location = LOG + "abc/_apis/pipelines/1/runs/19/signedlogcontent?urlExpires=x&urlSignature=y";
let jobStatus = 302;
let logText = "2026-09-28T12:00:01Z plain log line\n";
let logStatus = 200;
const stub = makeFetchStub({
  [GH + "*"]: (url, init) => new Response(null, { status: jobStatus, headers: location ? { location } : {} }),
  [LOG + "*"]: (url, init, rec) => { rec.redirect = init.redirect; return new Response(logText, { status: logStatus }); },
});
globalThis.fetch = stub.fetch;
process.env.GH_TOKEN = "gh-test-token";

// ════════════════════════════════════════════════════════════════════════════
// 10. ghJobLog: the API request with the token, the log host without it
// ════════════════════════════════════════════════════════════════════════════
{
  const before = stub.calls.length;
  const r = await H.ghJobLog("4242");
  const [a, b] = stub.calls.slice(before);
  check("10 ghJobLog: exactly two requests", stub.calls.length - before === 2);
  check("10 ghJobLog: first a GET to .../actions/jobs/4242/logs with Authorization: Bearer $GH_TOKEN",
    a.method === "GET" && a.url === GH + "actions/jobs/4242/logs" && a.headers.authorization === "Bearer gh-test-token");
  check("10 ghJobLog: then ONE GET to the log host with NO Authorization header", b.method === "GET" &&
    new URL(b.url).host === H.LOG_HOST && !("authorization" in b.headers) && b.redirect === "error", JSON.stringify(b.headers));
  check("10 ghJobLog returns the text (in memory)", r.ok === true && r.text === logText);
  check("10 the log host is GitHub's, named once", H.LOG_HOST === "pipelines.actions.githubusercontent.com");

  const refused = [
    ["another host", "https://evil.example/x"],
    ["a look-alike suffix", "https://pipelines.actions.githubusercontent.com.evil.example/x"],
    ["plain http", "http://pipelines.actions.githubusercontent.com/x"],
    ["a userinfo part", (() => { const u = new URL(LOG + "x"); u.username = "user"; u.password = "pw"; return u.href; })()],
    ["another port", "https://pipelines.actions.githubusercontent.com:8443/x"],
    ["an Azure blob host", "https://productionresultssa0.blob.core.windows.net/x"],
    ["the API host itself", "https://api.github.com/x"],
    ["a relative Location", "/x"],
    ["no Location", null],
  ];
  for (const [what, loc] of refused) {
    location = loc;
    const n = stub.calls.length;
    const x = await H.ghJobLog("4242");
    check(`10 ghJobLog refuses ${what}: ok:false and no second request`, x.ok === false && stub.calls.length - n === 1, JSON.stringify(x));
  }
  location = LOG + "ok";
  jobStatus = 200;
  { const n = stub.calls.length; const x = await H.ghJobLog("4242");
    check("10 ghJobLog: a 200 with no redirect is not followed", x.ok === false && stub.calls.length - n === 1); }
  jobStatus = 302;
  logStatus = 404;
  { const x = await H.ghJobLog("4242"); check("10 ghJobLog: a 404 from the log host is ok:false", x.ok === false && x.reason === "status"); }
  logStatus = 200;
  logText = "x".repeat(16 * 1024 * 1024 + 10);
  { const x = await H.ghJobLog("4242"); check("10 ghJobLog: a log over 16 MB is refused (too_large)", x.ok === false && x.reason === "too_large"); }
  logText = "plain\n";
  const n = stub.calls.length;
  for (const bad of ["1/../x", "abc", "", "-1", "1?x", "12 3", "1".repeat(21), null, {}]) {
    let threw = false;
    try { await H.ghJobLog(bad); } catch { threw = true; }
    check(`10 ghJobLog refuses the id ${JSON.stringify(bad)}`, threw);
  }
  check("10 the refused ids made 0 requests", stub.calls.length === n);
  check("10 every request the stub saw was a GET, and none was unexpected",
    stub.calls.every((c) => c.method === "GET") && stub.unexpected.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// c15.feed_log_emails (facts.mjs): this week's weekly-feed.yml job logs
// ════════════════════════════════════════════════════════════════════════════
const SAT = "2026-10-03";
function feedWorld(o = {}) {
  const runs = [
    G.run({ file: "weekly-feed.yml", id: 501, created: "2026-09-28T12:00:00Z" }),           // this week's send
    G.run({ file: "weekly-feed.yml", id: 502, created: "2026-09-28T15:00:00Z", event: "workflow_dispatch" }),
    G.run({ file: "weekly-feed.yml", id: 400, created: "2026-09-21T12:00:00Z" }),           // last week: not read
    G.run({ file: "weekly-feed.yml", id: 503, created: "2026-09-29T12:00:00Z", repo: "someone/fork" }), // not trusted
    G.run({ file: "weekly-feed.yml", id: 504, created: "2026-09-29T13:00:00Z", event: "pull_request" }),
    ...(o.runs || []),
  ];
  const w = G.ghWorld({ runs, now: () => at(SAT + "T20:30:00Z") });
  const jobPaths = [];
  const gh = async (path) => {
    const m = path.match(/^actions\/runs\/(\d+)\/jobs/);
    if (m) {
      jobPaths.push(m[1]);
      if (o.jobsFail) return { status: 500, ok: false, json: null, rateLimited: false };
      const n = o.jobsPer ?? 1;
      return { status: 200, ok: true, json: { jobs: Array.from({ length: n }, (_, k) => ({ id: Number(m[1]) * 10 + k })) } };
    }
    return w.gh(path);
  };
  const logs = [];
  const log = async (id) => {
    logs.push(String(id));
    if (o.logFail) return { ok: false, reason: "host_refused" };
    return { ok: true, text: o.text ? o.text(id) : "no addresses here\n" };
  };
  return { gh, log, logs, jobPaths };
}
const clock = { now: () => at(SAT + "T20:30:00Z"), sleep: async () => {} };
// A GitHub bot identity (the noreply domain GitHub uses for commit authors),
// with a synthetic local part, joined at run time: this file keeps to
// @example.com literals.
const NOREPLY = "0+test-bot" + "@" + ["users", "noreply", "github", "com"].join(".");
const FEED_TEXT = (id) => (String(id) === "5010"
  ? "{\"ok\":true,\"sent\":[{\"to\":\"buyer1.testperson@example.com\"},{\"to\":\"buyer2.testperson@example.com\"}]}\n" +
    "Author: " + NOREPLY + "\n"
  : "done\n");
{
  const f = feedWorld({ text: FEED_TEXT });
  const facts = await Fa.collect({ gh: f.gh, log: f.log, date: SAT, mode: "sat", repository: G.REPO, runId: "9",
    ...clock, readText: () => null, workflowFiles: [] });
  check("C15 feed log: two synthetic addresses in this week's send log -> c15.feed_log_emails 2 (GitHub noreply not counted)",
    facts.c15 && facts.c15.feed_log_emails === 2, JSON.stringify(facts.c15));
  check("C15 feed log: only this week's trusted runs are read (501, 502), never last week's, a fork's or a PR's",
    f.jobPaths.sort().join() === "501,502" && f.logs.sort().join() === "5010,5020", f.jobPaths.join() + " | " + f.logs.join());
  const clean = feedWorld();
  const fc = await Fa.collect({ gh: clean.gh, log: clean.log, date: SAT, mode: "sun", repository: G.REPO, runId: "9",
    ...clock, readText: () => null, workflowFiles: [] });
  check("C15 feed log twin: logs without addresses -> 0", fc.c15.feed_log_emails === 0);
  for (const [what, o] of [["a log the host lock refused", { logFail: true }], ["a failed jobs read", { jobsFail: true }],
    ["more than 10 jobs", { jobsPer: 6 }]]) {
    const x = feedWorld(o);
    const fx = await Fa.collect({ gh: x.gh, log: x.log, date: SAT, mode: "dry", repository: G.REPO, runId: "9",
      ...clock, readText: () => null, workflowFiles: [] });
    check(`C15 feed log: ${what} -> -1 (the Function reads BLIND), never 0`, fx.c15.feed_log_emails === -1);
    check(`C15 feed log: ${what} leaves api "ok" (the other Actions facts stand)`, fx.api === "ok", fx.api);
  }
  const mp = feedWorld({ text: FEED_TEXT });
  const fm = await Fa.collect({ gh: mp.gh, log: mp.log, date: "2026-10-05", mode: "mon-pre", repository: G.REPO, runId: "9",
    now: () => at("2026-10-05T10:00:00Z"), sleep: clock.sleep, readText: () => null, workflowFiles: [] });
  check("C15 feed log: mon-pre (no Extended checks) reads no log and emits no c15 key", !("c15" in fm) && mp.logs.length === 0);
  check("countEmails: synthetic addresses count, GitHub noreply does not",
    Fa.countEmails(`a@example.com b.c+d@example.com ${NOREPLY} @ x@y`) === 2);

  // main(): one line, no address, although the logs held two.
  const m = feedWorld({ text: FEED_TEXT });
  const { value, lines } = await capture(() => Fa.main({ DATE: SAT, MODE: "sat", GITHUB_REPOSITORY: G.REPO, GITHUB_RUN_ID: "9" },
    [], { gh: m.gh, log: m.log, now: clock.now, sleep: clock.sleep }));
  check("7 facts.mjs main with address-bearing logs prints ONE line with the count and no address",
    lines.length === 1 && !LEAK.test(lines[0]) && JSON.parse(value).c15.feed_log_emails === 2, lines.join(" | "));
}

// ════════════════════════════════════════════════════════════════════════════
// C15 repository scan (c15.mjs): I-03, I-07, secrets, private files, ignores
// ════════════════════════════════════════════════════════════════════════════
const PIN = "b".repeat(40);
const INDEXNOW = "7".repeat(32);
function repo(o = {}) {
  const root = mkdtempSync(join(tmpdir(), "r3b-c15-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  const put = (p, s) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), s); };
  put(".gitignore", o.gitignore ?? ["# private", ...C15.REQUIRED_IGNORES, "node_modules/"].join("\n") + "\n");
  put("index.html", o.index ?? "<html><body><!-- NO ROUTE HOME note -->" +
    "<span>Already subscribed? Your leads are in your Monday email.</span></body></html>");
  put(".github/workflows/feed.yml", o.workflow ?? ["name: feed", "on:", "  schedule:", "    - cron: \"0 12 * * 1\"",
    "jobs:", "  send:", "    runs-on: ubuntu-latest", "    steps:", `      - uses: actions/checkout@${PIN}`,
    "      - run: |", "          curl -H \"Authorization: Bearer $OIDC\" https://example.com/x",
    `          KEY=${INDEXNOW}`, ""].join("\n"));
  put(`${INDEXNOW}.txt`, INDEXNOW);
  put("docs/notes.md", "Stripe restricted keys start rk_live_ and webhook secrets whsec_; never commit one.\n");
  for (const [p, s] of Object.entries(o.files || {})) put(p, s);
  return root;
}
{
  const ok = C15.scan(repo());
  check("C15 scan healthy: all counts 0 and route_home true (pinned action SHA, $OIDC bearer, a published IndexNow key and prose naming key prefixes are not hits)",
    JSON.stringify(ok) === JSON.stringify({ c15: { secrets: 0, workflow_tokens: 0, private_files: 0, ignore_missing: 0, route_home: true } }),
    JSON.stringify(ok));
  // I-03: a token string in a workflow
  const tokenWf = repo({ workflow: `name: x\njobs:\n  a:\n    steps:\n      - run: curl -H "x-token: ${"a".repeat(32)}" https://example.com\n` });
  check("I-03 fault: a 32-hex token in a workflow -> workflow_tokens 1", C15.scan(tokenWf).c15.workflow_tokens === 1);
  const bearerWf = repo({ workflow: `name: x\njobs:\n  a:\n    steps:\n      - run: curl -H "authorization: bearer ${"Zq9".repeat(8)}" x\n` });
  check("I-03 fault: a literal bearer value in a workflow -> workflow_tokens 1", C15.scan(bearerWf).c15.workflow_tokens === 1);
  const unpublished = repo({ files: { [`${INDEXNOW}.txt`]: "something else" } });
  check("I-03: the IndexNow exception holds only while <key>.txt at the root holds exactly that key",
    C15.scan(unpublished).c15.workflow_tokens === 1);
  check("I-03 twin: the healthy workflow -> workflow_tokens 0", ok.c15.workflow_tokens === 0);
  // secrets anywhere
  const sec = repo({ files: { "js/app.js": `const k = "${"sk_live_" + "Z9y8X7w6".repeat(3)}";\n`,
    "keys/id.pem": "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIB\n" } });
  check("C15 scan: a live Stripe key in a site file and a private-key block -> secrets 2", C15.scan(sec).c15.secrets === 2);
  check("C15 scan: each secret shape is counted", [
    "sk_live_" + "A1".repeat(12), "rk_live_" + "B2".repeat(12), "whsec_" + "C3d4".repeat(8), "re_" + "Abc123" + "_" + "D".repeat(20),
    "ghp_" + "E".repeat(36), "github_pat_" + "F".repeat(45), "AKIA" + "G".repeat(16), "AIza" + "H".repeat(35),
  ].every((s) => C15.countSecrets(" " + s + " ") === 1));
  // private files
  const priv = repo({ files: { "subscribers.json": "[]", "data/bundles/MassPermits-weekly.zip": "PK" } });
  check("C15 scan: subscribers.json and a bundle zip in the tree -> private_files 2", C15.scan(priv).c15.private_files === 2);
  // ignore rules
  const ign = repo({ gitignore: C15.REQUIRED_IGNORES.filter((x) => x !== "subscribers.json" && x !== "*.zip").join("\n") + "\n" });
  check("C15 scan: two required .gitignore lines missing -> ignore_missing 2", C15.scan(ign).c15.ignore_missing === 2);
  check("C15 scan: a commented-out line does not count", C15.ignoreMissing(C15.REQUIRED_IGNORES.map((x) =>
    x === "subscribers.json" ? "# subscribers.json" : x).join("\n")) === 1);
  // I-07: no route-home link
  const noHome = repo({ index: "<html><body><!-- keep: already subscribed? -> my leads, sign in, log in -->" +
    "<a class=\"cta\">Start the Monday feed</a><script>var t = 'already subscribed';</script></body></html>" });
  check("I-07 fault: the cue words only in a comment and a script -> route_home false", C15.scan(noHome).c15.route_home === false);
  check("I-07 twin: the visible \"Already subscribed?\" line -> route_home true", ok.c15.route_home === true);
  check("I-07: \"Can&rsquo;t find it? ... sign in\" style variants count",
    C15.hasRouteHome("<p>Existing customer? <a href=\"/leads\">Sign in</a></p>") && C15.hasRouteHome("<b>My leads</b>"));
  // main: one line, counts only; a failed scan is blind
  const { lines } = await capture(() => C15.main(tokenWf));
  check("7 c15.mjs prints ONE line of counts, no path and no value", lines.length === 1 && !LEAK.test(lines[0]) &&
    !lines[0].includes("feed.yml") && !lines[0].includes("x-token"), lines.join(" | "));
  const loop = repo();
  symlinkSync(loop, join(loop, "loop"));
  symlinkSync("/etc/hostname", join(loop, "outside.txt"));
  check("C15 scan: a symlink loop and a link out of the checkout are neither followed nor read",
    JSON.stringify(C15.scan(loop)) === JSON.stringify(ok));
  const { value: blind } = await capture(() => C15.main(join(tmpdir(), "r3b-no-such-dir-" + process.pid)));
  check("C15 scan: an unreadable checkout prints the blind facts (-1, route_home false)", blind.c15.secrets === -1 && blind.c15.route_home === false);
  // This branch's own checkout (local files only, no network).
  const self = C15.scan(REPO_ROOT);
  check("C15 scan of this repository's working tree: 0 secrets, 0 workflow tokens, 0 private files, 0 missing ignores, route_home true",
    self.c15.secrets === 0 && self.c15.workflow_tokens === 0 && self.c15.private_files === 0 &&
    self.c15.ignore_missing === 0 && self.c15.route_home === true, JSON.stringify(self));
  console.log("  note  this working tree scans as " + JSON.stringify(self));
}

// ════════════════════════════════════════════════════════════════════════════
// C22 DNS baseline (c22.mjs): I-23, with an injected resolver only
// ════════════════════════════════════════════════════════════════════════════
const BASE = {
  domain: "masspermits.com",
  records: {
    dmarc: { name: "_dmarc.masspermits.com", type: "TXT", prefix: "v=DMARC1", values: ["v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"] },
    spf: { name: "send.masspermits.com", type: "TXT", prefix: "v=spf1", values: ["v=spf1 include:mail.example.net ~all"] },
    dkim: { name: "resend._domainkey.masspermits.com", type: "TXT", prefix: "", values: ["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC" + "Q".repeat(40)] },
    mx: { name: "send.masspermits.com", type: "MX", values: ["10 feedback-smtp.example.net"] },
  },
};
function resolver(over = {}) {
  const calls = [];
  const zone = {
    "TXT _dmarc.masspermits.com": [["v=DMARC1;  P=quarantine ; rua=mailto:dmarc@example.com"]],
    "TXT send.masspermits.com": [["v=spf1 include:mail.example.net ~all"], ["google-site-verification=abc"]],
    "TXT resend._domainkey.masspermits.com": [["p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC", "Q".repeat(40)]],
    "MX send.masspermits.com": [{ priority: 10, exchange: "Feedback-SMTP.example.net." }],
    ...over,
  };
  const answer = (k) => {
    calls.push(k);
    const v = zone[k];
    if (v instanceof Error) throw v;
    if (v === undefined) throw Object.assign(new Error("nodata"), { code: "ENODATA" });
    return v;
  };
  return { calls, resolveTxt: async (n) => answer("TXT " + n), resolveMx: async (n) => answer("MX " + n) };
}
{
  const r = resolver();
  const same = await C22.compare({ baseline: BASE, resolver: r });
  check("C22 healthy: all four records same (DMARC case and spaces, DKIM chunks, MX case and trailing dot, extra non-SPF TXT ignored)",
    JSON.stringify(same.c22) === JSON.stringify({ dmarc: "same", spf: "same", dkim: "same", mx: "same" }), JSON.stringify(same));
  check("C22: exactly one lookup per record, all under masspermits.com", r.calls.length === 4 &&
    r.calls.every((c) => c.endsWith(".masspermits.com") || c.endsWith(" masspermits.com")), r.calls.join());
  const d = await C22.compare({ baseline: BASE, resolver: resolver({ "TXT _dmarc.masspermits.com": [["v=DMARC1; p=none"]] }) });
  check("I-23 fault: DMARC changed (p=quarantine -> p=none) -> c22.dmarc changed, the rest same",
    d.c22.dmarc === "changed" && d.c22.spf === "same" && d.c22.dkim === "same" && d.c22.mx === "same", JSON.stringify(d));
  const miss = await C22.compare({ baseline: BASE, resolver: resolver({ "TXT resend._domainkey.masspermits.com": undefined }) });
  check("C22: a DKIM record gone (ENODATA) -> missing", miss.c22.dkim === "missing");
  const err = await C22.compare({ baseline: BASE, resolver: resolver({ "MX send.masspermits.com": Object.assign(new Error("t"), { code: "ETIMEOUT" }) }) });
  check("C22: a timed-out lookup -> error, never same", err.c22.mx === "error");
  const onlyOther = await C22.compare({ baseline: BASE, resolver: resolver({ "TXT send.masspermits.com": [["google-site-verification=abc"]] }) });
  check("C22: no v=spf1 TXT left at the name -> spf missing", onlyOther.c22.spf === "missing");
  const foreign = JSON.parse(JSON.stringify(BASE));
  foreign.records.dmarc.name = "_dmarc.evil.example";
  foreign.records.spf.name = "masspermits.com.evil.example";
  const fr = resolver();
  const fo = await C22.compare({ baseline: foreign, resolver: fr });
  check("C22: a baseline name outside masspermits.com -> error, and it is never looked up",
    fo.c22.dmarc === "error" && fo.c22.spf === "error" && !fr.calls.some((c) => c.includes("evil")), fr.calls.join());
  // The delivered baseline: placeholders only, so every record is unset and nothing is looked up.
  const shipped = C22.readBaseline(REPO_ROOT);
  const pr = resolver();
  const ps = await C22.compare({ baseline: shipped, resolver: pr });
  check("C22: docs/rehearsal/dns-baseline.json parses, every record is 'unset' and 0 lookups are made",
    shipped && Object.values(ps.c22).every((v) => v === "unset") && pr.calls.length === 0, JSON.stringify(ps));
  check("C22: the delivered baseline holds PLACEHOLDER in every record and instructions",
    Object.values(shipped.records).every((e) => /PLACEHOLDER/.test(JSON.stringify(e))) && Array.isArray(shipped._readme));
  const halfFilled = JSON.parse(JSON.stringify(BASE));
  halfFilled.records.dkim.name = "PLACEHOLDER._domainkey.masspermits.com";
  const hr = resolver();
  const hf = await C22.compare({ baseline: halfFilled, resolver: hr });
  check("C22: a value filled in but the DKIM selector name still PLACEHOLDER -> unset, and that name is never looked up",
    hf.c22.dkim === "unset" && !hr.calls.some((c) => /placeholder/i.test(c)), hr.calls.join());
  const nob = await C22.compare({ baseline: null, resolver: resolver() });
  check("C22: no baseline file -> error on every record", Object.values(nob.c22).every((v) => v === "error"));
  const { lines, value } = await capture(() => C22.main({ baseline: BASE, resolver: resolver({ "TXT _dmarc.masspermits.com": [["v=DMARC1; p=none"]] }) }));
  check("7 c22.mjs prints ONE line of enums: no record value, no name", lines.length === 1 && !LEAK.test(lines[0]) &&
    !/DMARC1|masspermits|spf1/.test(lines[0]) && value.c22.dmarc === "changed", lines.join(" | "));
  const v = validateRunnerFacts({ v: 1, ...value });
  check("16 c22 facts validate against RUNNER_SCHEMA", v.dropped.length === 0 && fact(v.facts, "c22.dmarc") === "changed");
  const bad = validateRunnerFacts({ v: 1, c22: { dmarc: "p=none" }, c15: { secrets: "3", route_home: "yes" } });
  check("16 a c22 value outside the enum, and c15 facts of the wrong type, are dropped",
    ["c22.dmarc", "c15.secrets", "c15.route_home"].every((k) => bad.dropped.includes(k)));
  const { lines: shippedLines } = await capture(() => C22.main({ resolver: resolver() }));
  check("C22 main with the delivered (placeholder) baseline: all unset", JSON.parse(shippedLines[0]).c22.dmarc === "unset");
}
check("no real DNS query was made in this file", realDns === 0);

// ════════════════════════════════════════════════════════════════════════════
// Schema contract with every R3b fact (16)
// ════════════════════════════════════════════════════════════════════════════
{
  const f = feedWorld({ text: FEED_TEXT });
  const facts = await Fa.collect({ gh: f.gh, log: f.log, date: SAT, mode: "sat", repository: G.REPO, runId: "9",
    ...clock, readText: () => null, workflowFiles: [] });
  const merged = Fa.merge(facts, C15.scan(repo()), await C22.compare({ baseline: BASE, resolver: resolver() }));
  const line = Fa.finalize(merged);
  const v = validateRunnerFacts(JSON.parse(line));
  const r3b = Object.keys(RUNNER_SCHEMA).filter((k) => k.startsWith("c15.") || k.startsWith("c22."));
  check("16 facts.mjs + c15.mjs + c22.mjs: every R3b key present, 0 dropped, line <= 4 KB",
    v.dropped.length === 0 && r3b.every((k) => fact(v.facts, k) !== undefined) && r3b.length === 10 && line.length <= 4096,
    r3b.filter((k) => fact(v.facts, k) === undefined).join());
}

// ════════════════════════════════════════════════════════════════════════════
// docs/rehearsal/seed-reporter.gs in node:vm with fake Google services
// ════════════════════════════════════════════════════════════════════════════
const GS = readText(join(REPO_ROOT, "docs", "rehearsal", "seed-reporter.gs"));
function gas({ now, inbox = [], spam = [], token = "t".repeat(40), props = {} }) {
  const posts = [], searches = [], logs = [], triggers = [];
  const store = { ...(token ? { REHEARSAL_SEED_TOKEN: token } : {}), ...props };
  const thread = (atts) => ({ getMessages: () => [{ getAttachments: () => atts.map((n) => ({ getName: () => n })) }] });
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  const ctx = {
    Date: FakeDate, Math, JSON, console: { log: (s) => logs.push(String(s)) },
    GmailApp: { search: (q) => { searches.push(q); return (/in:inbox/.test(q) ? inbox : /in:spam/.test(q) ? spam : []).map(thread); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    UrlFetchApp: { fetch: (url, o) => { posts.push({ url, o }); return { getResponseCode: () => 200 }; } },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {},
      newTrigger: (f) => ({ timeBased: () => ({ everyHours: (h) => ({ create: () => triggers.push([f, h]) }) }) }) },
  };
  vm.createContext(ctx);
  vm.runInContext(GS, ctx);
  return { ctx, posts, searches, logs, triggers, store };
}
{
  const g = gas({ now: at("2026-10-04T21:10:00Z"), inbox: [["MassPermits-weekly.zip"]] });
  g.ctx.report();
  const p = g.posts[0];
  const body = p && JSON.parse(p.o.payload);
  check("seed reporter: Sunday 21:10Z, found in the inbox with the zip -> ONE POST {run:21, placement:inbox, has_attachment:true}",
    g.posts.length === 1 && JSON.stringify(body) === JSON.stringify({ run: 21, placement: "inbox", has_attachment: true }), JSON.stringify(body));
  check("seed reporter: POST to the rehearsal-seed route, Bearer token from Script Properties, no redirects followed",
    p.url === "https://masspermits.com/api/rehearsal-seed" && p.o.method === "post" &&
    p.o.headers.Authorization === "Bearer " + "t".repeat(40) && p.o.followRedirects === false);
  check("seed reporter: searches subject \"(preview 1004)\" in the inbox", g.searches[0].includes('subject:"(preview 1004)"') &&
    g.searches[0].includes("in:inbox"));
  check("seed reporter: logs the status only, never the token", g.logs.length === 1 && !g.logs[0].includes("t".repeat(40)));
  g.ctx.report();
  check("seed reporter: an unchanged state is not posted again", g.posts.length === 1);
  const s = gas({ now: at("2026-10-05T03:00:00Z"), spam: [["notes.txt"]] });
  s.ctx.report();
  check("seed reporter: Monday 03:00Z, found only in spam without a zip -> {run:27, placement:spam, has_attachment:false}",
    s.posts.length === 1 && s.posts[0].o.payload === JSON.stringify({ run: 27, placement: "spam", has_attachment: false }));
  const early = gas({ now: at("2026-10-05T06:00:00Z") });
  early.ctx.report();
  check("seed reporter: not found at hour 30 -> nothing posted yet (a late Sunday run is not 'missing')", early.posts.length === 0);
  const late = gas({ now: at("2026-10-05T13:00:00Z") });
  late.ctx.report();
  check("seed reporter: not found at hour 37 -> {placement:missing, has_attachment:false}", late.posts.length === 1 &&
    late.posts[0].o.payload === JSON.stringify({ run: 37, placement: "missing", has_attachment: false }));
  const out = gas({ now: at("2026-10-06T01:00:00Z"), inbox: [["a.zip"]] });
  out.ctx.report();
  check("seed reporter: Tuesday 01:00Z (hour 49) -> nothing posted", out.posts.length === 0);
  const nt = gas({ now: at("2026-10-04T21:00:00Z"), inbox: [["a.zip"]], token: null });
  nt.ctx.report();
  check("seed reporter: no token in Script Properties -> nothing posted", nt.posts.length === 0);
  const tr = gas({ now: at("2026-10-04T21:00:00Z") });
  tr.ctx.installTrigger();
  check("seed reporter: installTrigger() schedules report() hourly", tr.triggers.length === 1 && tr.triggers[0].join() === "report,1");
  // The reporter's body is exactly what the shipped rehearsal-seed.js stores.
  const r2 = fakeR2({});
  const token = "t".repeat(40);
  const r = await Seed.onRequestPost({ request: new Request(p.url, { method: "POST",
    headers: { authorization: p.o.headers.Authorization, "content-type": p.o.contentType }, body: p.o.payload }),
    env: { BUNDLES: r2.bucket, REHEARSAL_SEED_TOKEN: token } });
  const puts = r2.ops.filter((o) => o.op === "put");
  check("seed reporter -> rehearsal-seed.js: 200 {ok:true}, one write under rehearsal/seed-",
    r.status === 200 && (await r.text()) === "{\"ok\":true}" && puts.length === 1 && /^rehearsal\/seed-\d{4}-\d{2}-\d{2}\.json$/.test(puts[0].key),
    JSON.stringify(puts));
  check("seed-reporter.gs holds no token value and reads it only from Script Properties",
    !/[A-Za-z0-9]{32,}/.test(GS.replace(/https?:\/\/\S+/g, "")) && GS.includes('getProperty("REHEARSAL_SEED_TOKEN")'));
}

check("7 every line this file's scripts printed is free of addresses, 32-hex strings, cus_ and streets",
  printed.every((l) => !LEAK.test(l)), printed.find((l) => LEAK.test(l)));
check("the fetch stub saw no unexpected URL", stub.unexpected.length === 0, stub.unexpected.join());
done();
