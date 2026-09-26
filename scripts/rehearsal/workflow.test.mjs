// The workflow files delivered as docs/rehearsal/*.yml.txt, and the caller
// job's script run for real (bash + jq) against a stand-in curl.
//
//   node scripts/rehearsal/workflow.test.mjs
//
// Acceptance 9 (every .yml.txt parses as YAML; no push: under on:), 11
// (workflow_run.workflows[0] equals the name: line of weekly-refresh.yml on
// main), 12 (jobs, permissions, the caller's guards, no "${{" in any run:
// block, checkout of main without credentials; pr-tests.yml.txt's rules), 14
// (no-dispatch grep on the workflow text), and 7 for the caller: its printed
// lines are identical with 3 and with 30 subscribers and hold no "@", 32-hex,
// "cus_" or street. The caller script is taken from the .yml.txt byte for
// byte; only curl is replaced (test/rehearsal/fake-curl.mjs, no network), and
// the responses it hands back are recorded from real in-process runs of
// rehearsal.js. Injected mode, part, date, trigger and run values must stop
// the script before any request. Without jq (looked up as the script would)
// those caller checks are SKIP locally and one FAIL when CI is set.

import { writeFileSync, mkdtempSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { makeRunner, makeFetchStub, resendFixture, HTMLRewriterStub, REPO, readText } from "../../test/rehearsal/harness.mjs";
import * as K from "../../test/rehearsal/rehearsal_kit.mjs";
import { parseYaml } from "../../test/rehearsal/yaml.mjs";

const { check, skip, done } = makeRunner("workflow.test.mjs");
const read = (p) => readText(join(REPO, p));
const MON = "docs/rehearsal/monday-rehearsal.yml.txt";
const PRT = "docs/rehearsal/pr-tests.yml.txt";
const mon = read(MON);
const Y = parseYaml(mon);

// ── 9. parses; no push: under on: ───────────────────────────────────────────
for (const p of [MON, PRT].filter((x) => existsSync(join(REPO, x)))) {
  let doc = null;
  try { doc = parseYaml(read(p)); } catch (e) { check(`9 ${p} parses as YAML`, false, e.message); continue; }
  check(`9 ${p} parses as YAML`, doc && typeof doc === "object");
  check(`9 ${p}: no push: key under on:`, doc.on && !("push" in doc.on));
}
{
  let threw = false;
  try { parseYaml("a: 1\n  b: 2\n"); } catch { threw = true; }
  let threw2 = false;
  try { parseYaml("a: x: y\n"); } catch { threw2 = true; }
  check("9 the parser is not vacuous: a bad indent and a \": \" in a plain scalar both throw", threw && threw2);
}

// ── 11. the workflow_run name equals weekly-refresh.yml's name on main ─────
{
  let mainName = null;
  try {
    const src = execFileSync("git", ["show", "origin/main:.github/workflows/weekly-refresh.yml"], { cwd: REPO, encoding: "utf8" });
    mainName = parseYaml(src).name;
  } catch { mainName = null; }
  check("11 workflow_run.workflows[0] === the name: of .github/workflows/weekly-refresh.yml on main",
    mainName && Y.on.workflow_run.workflows.length === 1 && Y.on.workflow_run.workflows[0] === mainName, mainName);
  check("11 workflow_run types: [completed]", JSON.stringify(Y.on.workflow_run.types) === '["completed"]');
}

// ── 12. monday-rehearsal.yml.txt ────────────────────────────────────────────
const jobs = Y.jobs;
const runner = jobs.runner, caller = jobs.caller;
const runBlocks = (job) => (job.steps || []).filter((s) => typeof s.run === "string").map((s) => s.run);
const script = runBlocks(caller)[0] || "";
{
  check("12 name is \"MassPermits monday rehearsal\"", Y.name === "MassPermits monday rehearsal");
  check("12 triggers: workflow_run, schedule, workflow_dispatch only", Object.keys(Y.on).sort().join() === "schedule,workflow_dispatch,workflow_run");
  check("12 schedules exactly the five crons", JSON.stringify(Y.on.schedule.map((s) => s.cron)) ===
    JSON.stringify(["0 20 * * 6", "0 20 * * 0", "0 10 * * 1", "30 20 * * 1", "0 13 * * 2"]));
  check("12 workflow_dispatch input mode, default dry", Y.on.workflow_dispatch.inputs.mode.default === "dry");
  check("12 exactly two jobs: runner and caller", Object.keys(jobs).sort().join() === "caller,runner");
  check("12 top-level permissions {}", Y.permissions && typeof Y.permissions === "object" && Object.keys(Y.permissions).length === 0);
  check("12 concurrency group monday-rehearsal, cancel-in-progress false",
    Y.concurrency.group === "monday-rehearsal" && Y.concurrency["cancel-in-progress"] === false);
  check("12 runner permissions exactly {contents: read, actions: read, checks: read}",
    JSON.stringify(runner.permissions) === JSON.stringify({ contents: "read", actions: "read", checks: "read" }));
  check("12 no secrets.* reference anywhere in the file", !/secrets\./.test(mon));
  const withIdToken = Object.entries(jobs).filter(([, j]) => j.permissions && j.permissions["id-token"] === "write").map(([k]) => k);
  check("12 exactly one job (caller) has id-token: write", withIdToken.join() === "caller");
  check("12 caller permissions exactly {id-token: write}", JSON.stringify(caller.permissions) === JSON.stringify({ "id-token": "write" }));
  check("12 no job has actions: write (text and parsed)", !/actions:\s*write/.test(mon) &&
    Object.values(jobs).every((j) => !j.permissions || j.permissions.actions !== "write"));
  check("12 no job holds any write permission other than the caller's id-token",
    Object.entries(jobs).every(([k, j]) => Object.entries(j.permissions || {}).every(([p, v]) => v !== "write" || (k === "caller" && p === "id-token"))));
  check("12 caller: needs runner, if: mode != idle", caller.needs === "runner" && caller.if === "needs.runner.outputs.mode != 'idle'");
  check("12 caller: no uses: step and no checkout", (caller.steps || []).every((s) => !("uses" in s)) && !/checkout/.test(JSON.stringify(caller)));
  const urls = mon.match(/https?:\/\/[^\s"'$]+/g) || [];
  check("12 the file holds one literal URL, https://masspermits.com/api/rehearsal, in the caller",
    urls.length === 1 && urls[0] === "https://masspermits.com/api/rehearsal?mode=" && script.includes("https://masspermits.com/api/rehearsal?"),
    urls.join(" "));
  check("12 caller env: MODE, DATE, TRIGGER, PARTS, FACTS from the runner outputs only",
    JSON.stringify(caller.env) === JSON.stringify({ MODE: "${{ needs.runner.outputs.mode }}", DATE: "${{ needs.runner.outputs.date }}",
      TRIGGER: "${{ needs.runner.outputs.trigger }}", PARTS: "${{ needs.runner.outputs.parts }}", FACTS: "${{ needs.runner.outputs.facts }}" }));
  check("12 RUN is GITHUB_RUN_ID copied into the script", /^RUN="\$GITHUB_RUN_ID"$/m.test(script));
  check("12 caller script: ::add-mask:: right after each mint", /OIDC=\$\(mint\)[^\n]*\n\s*echo "::add-mask::\$OIDC"/.test(script));
  const loopAt = script.indexOf("while :; do"), mintAt = script.indexOf("OIDC=$(mint)");
  check("12 caller script: the mint is inside the per-POST loop", loopAt > 0 && mintAt > loopAt && script.indexOf("curl -sS -o resp.json") > mintAt);
  const urlAt = script.indexOf("https://masspermits.com/api/rehearsal");
  const guards = [/case "\$MODE" in sat\|sun\|mon-pre\|mon-post\|dry\) ;; \*\) echo "bad mode"; exit 1;; esac/,
    /case "\$PART" in links\|seed\|core\) ;; \*\) echo "bad part"; exit 1;; esac/,
    /\[\[ "\$DATE" =~ \^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$ \]\]/,
    /\[\[ "\$TRIGGER" =~ \^\(\[0-9\]\{1,20\}\|sched\|dispatch\)\$ \]\]/,
    /\[\[ "\$RUN" =~ \^\[0-9\]\{1,20\}\$ \]\]/];
  check("12 caller script: the mode, part, date, trigger and run checks all come before the URL",
    guards.every((re) => { const m = script.match(re); return m && m.index < urlAt; }));
  check("12 caller script: set -euo pipefail, and none of set -x, xtrace, curl -v, --verbose, --trace",
    script.startsWith("set -euo pipefail") && !/set -x|xtrace|curl -v|--verbose|--trace/.test(script));
  check("12 no run: block in EITHER job contains \"${{\"", [...runBlocks(runner), ...runBlocks(caller)].every((r) => !r.includes("${{")));
  const uses = (runner.steps || []).filter((s) => s.uses).map((s) => s.uses.split("@")[0]);
  check("12 runner: the only uses: steps are actions/checkout and actions/setup-node", uses.join() === "actions/checkout,actions/setup-node");
  const co = runner.steps.find((s) => String(s.uses).startsWith("actions/checkout"));
  check("12 runner checkout: ref: main and persist-credentials: false", co.with.ref === "main" && co.with["persist-credentials"] === false);
  check("12 runner: no id-token, no secrets; GH_TOKEN is github.token on the facts step only",
    !("id-token" in runner.permissions) && runner.steps.filter((s) => s.env && "GH_TOKEN" in s.env).length === 1 &&
    runner.steps.find((s) => s.env && s.env.GH_TOKEN).env.GH_TOKEN === "${{ github.token }}");
  check("12 the file contains none of head_sha, head_ref, github.event.workflow_run.head, github.event.pull_request",
    !/head_sha|head_ref|github\.event\.workflow_run\.head|github\.event\.pull_request/.test(mon));
  check("12 the dispatch mode input never appears in the workflow text (it reaches mode.mjs through the event file)",
    !/inputs\.mode|github\.event\.inputs/.test(mon));
  check("12 runner outputs: mode, date, trigger, parts, facts", Object.keys(runner.outputs).sort().join() === "date,facts,mode,parts,trigger");
  check("12 runner steps run mode.mjs, then (unless idle) c14.mjs, mirror.mjs, c15.mjs, c22.mjs (R3b) and facts.mjs",
    runBlocks(runner).map((r) => (r.match(/scripts\/rehearsal\/(\w+)\.mjs/) || [])[1]).join() === "mode,c14,mirror,c15,c22,facts" &&
    runner.steps.filter((s) => s.run && !s.run.includes("mode.mjs")).every((s) => s.if === "steps.mode.outputs.mode != 'idle'"));
}

// ── 12. pr-tests.yml.txt (optional) ─────────────────────────────────────────
if (existsSync(join(REPO, PRT))) {
  const t = read(PRT);
  const P = parseYaml(t);
  check("12 pr-tests: on has pull_request and nothing else", Object.keys(P.on).join() === "pull_request");
  check("12 pr-tests: pull_request paths functions/** only", JSON.stringify(P.on.pull_request) === JSON.stringify({ paths: ["functions/**"] }));
  check("12 pr-tests: top-level permissions exactly {contents: read}", JSON.stringify(P.permissions) === JSON.stringify({ contents: "read" }));
  check("12 pr-tests: no job declares permissions", Object.values(P.jobs).every((j) => !("permissions" in j)));
  check("12 pr-tests: no id-token, no secrets., no pull_request_target anywhere", !/id-token|secrets\.|pull_request_target/.test(t));
  check("12 pr-tests: no workflow_run, push or schedule trigger", !/^\s*(workflow_run|push|schedule)\s*:/m.test(t));
  const steps = Object.values(P.jobs)[0].steps;
  const co = steps.find((s) => String(s.uses).startsWith("actions/checkout"));
  check("12 pr-tests: checkout sets persist-credentials: false", co && co.with["persist-credentials"] === false);
  check("12 pr-tests: steps are checkout, setup-node, node functions/api/all.test.mjs",
    steps.length === 3 && String(steps[1].uses).startsWith("actions/setup-node") && steps[2].run === "node functions/api/all.test.mjs");
}

// ── 14. no-dispatch grep on the workflow text ───────────────────────────────
for (const [p, t] of [[MON, mon], [PRT, existsSync(join(REPO, PRT)) ? read(PRT) : ""]]) {
  const hits = [/\/dispatches/, /\/rerun/, /\/cancel/, /\/force-cancel/, /actions: write/, /(^|[^A-Za-z0-9_])gh (workflow|run|api)/m]
    .filter((re) => re.test(t)).map(String);
  check(`14 ${p}: no dispatch, re-run or cancel`, hits.length === 0, hits.join(" "));
}

// ════════════════════════════════════════════════════════════════════════════
// 7. the caller script, run for real against recorded Function responses
// ════════════════════════════════════════════════════════════════════════════
const RESEND = "https://api.resend.com/emails";
const rs = resendFixture(RESEND);
const stub = makeFetchStub({ [RESEND]: rs.handler });
globalThis.fetch = stub.fetch;
globalThis.HTMLRewriter = HTMLRewriterStub;
const clock = K.installClock();
const L = await K.loadRehearsal();
async function record(n) {
  const now = K.at("2026-10-03T20:30:00Z");
  clock.set(now);
  const subs = K.roster(n);
  const w = K.world({ now, subs, refreshAt: K.at("2026-10-03T14:00:00Z"),
    log: [K.sendEntry(K.at("2026-09-28T14:00:00Z"), subs.map((s) => s.email))] });
  const x = await K.runMode(L.mod, K.baseEnv(w.bucket), { mode: "sat", date: "2026-10-03", run: String(5000 + n), body: K.facts() });
  const table = {};
  for (const r of x.responses) table[`${r.part}:${r.page}`] = r.json;
  return { table, pages: x.responses.filter((r) => r.part === "links").length };
}
// The caller script's PATH: a bin/ holding only the stand-in curl, then ours.
const callerPath = (bin) => bin + ":" + process.env.PATH;
function runCaller(table, envOver = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mp-caller-"));
  writeFileSync(join(dir, "responses.json"), JSON.stringify(table));
  writeFileSync(join(dir, "calls.jsonl"), "");
  const bin = join(dir, "bin");
  execFileSync("mkdir", ["-p", bin]);
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash\nexec "${process.execPath}" "${join(REPO, "test", "rehearsal", "fake-curl.mjs")}" "$@"\n`);
  chmodSync(join(bin, "curl"), 0o755);
  const env = { PATH: callerPath(bin), HOME: dir, FAKE_CURL_DIR: dir,
    MODE: "sat", DATE: "2026-10-03", TRIGGER: "sched", PARTS: "links core", FACTS: JSON.stringify(K.facts()),
    GITHUB_RUN_ID: "123456", ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.invalid/req?api-version=1",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-token-not-real", ...envOver };
  const r = spawnSync("bash", ["-c", script], { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
  const calls = readText(join(dir, "calls.jsonl")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}
// jq, looked up the way the script will: command -v in bash, on its PATH.
const jqBin = join(mkdtempSync(join(tmpdir(), "mp-jq-")), "bin");
execFileSync("mkdir", ["-p", jqBin]);
const hasJq = spawnSync("bash", ["-c", "command -v jq"], { env: { PATH: callerPath(jqBin) }, encoding: "utf8" }).status === 0;
const inCI = !!process.env.CI && process.env.CI !== "false";
if (!hasJq && inCI) check("jq missing in CI", false, "the caller script needs jq");
else if (!hasJq) {
  const why = "jq is not installed; the caller script did not run (CI always runs it)";
  skip("7 the caller script against recorded responses (3 vs 30 subscribers, printed lines, leak)", why);
  skip("11/12 the caller's POSTs, mints, masking, URL and body", why);
  skip("11 injected mode, date, trigger, run, parts and facts stop the script before any request", why);
} else {
  const r3 = await record(3), r30 = await record(30);
  check("7 the recorded runs are real: 30 subscribers take more links pages than 3", r30.pages > r3.pages, `${r3.pages} vs ${r30.pages}`);
  const a = runCaller(r3.table), b = runCaller(r30.table);
  check("7 the caller script exits 0 with 3 and with 30 subscribers", a.status === 0 && b.status === 0, a.stderr + b.stderr);
  // ::add-mask:: lines are workflow commands: the runner consumes them and the
  // log never shows them. Everything else is what the public log shows.
  const shown = (s) => s.split("\n").filter((l) => l !== "" && !l.startsWith("::add-mask::"));
  check("7 the printed lines are IDENTICAL with 3 and with 30 subscribers", JSON.stringify(shown(a.stdout)) === JSON.stringify(shown(b.stdout)),
    JSON.stringify([shown(a.stdout), shown(b.stdout)]));
  check("7 the caller prints exactly one line: the core projection {ok, verdict, codes, error}",
    shown(a.stdout).length === 1 && Object.keys(JSON.parse(shown(a.stdout)[0])).join() === "ok,verdict,codes,error", a.stdout);
  const street = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Ln|Lane|Dr|Drive|Way)\b/;
  const leak = [a.stdout, b.stdout, a.stderr, b.stderr].join("\n");
  check("7 caller output: no \"@\", 32-hex, \"cus_\", street or count", !leak.includes("@") && !/[0-9a-f]{32}/.test(leak) &&
    !leak.includes("cus_") && !street.test(leak) && !/"(count|counts|rows|subscribers|active)"/.test(leak));
  const posts = b.calls.filter((c) => c.out), mints = b.calls.filter((c) => !c.out);
  check("12 a fresh token per POST: as many mints as POSTs, each POST with the token minted just before it",
    posts.length === mints.length && b.calls.every((c, k) => (k % 2 === 0 ? !c.out : c.out &&
      c.headers.includes(`Authorization: Bearer oidc-token-${k / 2 + 0.5}-zzzzzzzzzzzzzzzzzzzz`))), b.calls.length);
  check("12 each minted token is masked (::add-mask::) before its POST", (b.stdout.match(/^::add-mask::oidc-token-/gm) || []).length === posts.length);
  const want = (part, page) => `https://masspermits.com/api/rehearsal?mode=sat&part=${part}&page=${page}&date=2026-10-03&trigger=sched&run=123456`;
  check("11/12 every POST goes to the one rehearsal URL with exactly the resolved parameters",
    posts.every((c) => c.method === "POST" && c.url === want(new URL(c.url).searchParams.get("part"), new URL(c.url).searchParams.get("page"))));
  check("12 the POST body is the facts, byte for byte", posts.every((c) => c.data === JSON.stringify(K.facts())));
  check("12 the mint asks the masspermits-cron audience", mints.every((c) => c.url.endsWith("&audience=masspermits-cron")));
  check("12 links pages walk 0..n while more:true, then core once", posts.filter((c) => c.url.includes("part=core")).length === 1 &&
    posts.filter((c) => c.url.includes("part=links")).length === r30.pages);
  // injected values stop the script before any request
  const inj = [["MODE", "sat&part=seed"], ["MODE", "sat run=1"], ["DATE", "2026-10-03&x=1"], ["TRIGGER", "sched;id"],
    ["TRIGGER", "1".repeat(21)], ["GITHUB_RUN_ID", "12a"], ["PARTS", "evil links"], ["FACTS", "[1]"],
    ["FACTS", JSON.stringify({ v: 2 })], ["FACTS", JSON.stringify({ v: 1, pad: "x".repeat(5000) })]];
  for (const [k, v] of inj) {
    const r = runCaller(r3.table, { [k]: v });
    check(`11 injected ${k}=${JSON.stringify(v).slice(0, 40)} -> exit 1 before any request`, r.status === 1 && r.calls.length === 0,
      `${r.status} ${r.calls.length} ${r.stdout.trim()}`);
  }
}
check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0, stub.unexpected.join(","));
done();
