// No em or en dash in anything we send to a customer, prospect or reader.
//
// STANDING RULE (Patrick, 2026-09-15, reaffirmed 2026-09-26): no em dash
// (U+2014) or en dash (U+2013) in outbound copy, ever. That includes the HTML
// entities (&mdash; &ndash; &#8212; &#8211; &#x2014; &#x2013;) and the JS
// escapes (backslash-u2014, backslash-u2013). Hyphens are fine.
//
// Two layers, both read the SHIPPED source so they cannot drift:
//
//  1. SCAN. Every string, template and regex literal in functions/** (tests
//     excluded) must be dash-free. Default-deny: a new file is covered the day
//     it lands. The only exemptions are
//       - two parse sites that SPLIT the engine's feed title on its dash
//         (logic, never printed; coupled to the engine's seo_build.py), and
//       - operator-only files whose strings go to the owner's dashboards and
//         Actions logs, never to a customer, prospect or reader. They are
//         listed by name, so moving customer copy into one of them is a
//         review decision, not an accident.
//  2. RENDER. The email and page builders are imported from a temp copy of
//     functions/ (a test-only re-export line is appended to the COPY, the
//     shipped files are untouched), fetch is stubbed so nothing leaves the
//     machine, and every subject and body they produce is checked.
//
//   node test/no-dash-outbound.test.mjs
//
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUNCS = path.join(REPO, "functions");

const EM = String.fromCharCode(0x2014), EN = String.fromCharCode(0x2013);
const BS = String.fromCharCode(92);
const DASH = new RegExp(
  "[" + EM + EN + "]|&[mn]dash;|&#0*821[12];|&#[xX]0*201[34];|" + BS + BS + "u201[34]", "i");

// Operator-only surfaces (owner dashboards, Actions logs, the pre-send gate's
// reasons). Not customer, prospect or reader copy. Kept as a named list.
const OPERATOR_ONLY = new Set([
  "functions/api/_cf-access.js",
  "functions/api/_presend.js",
  "functions/api/send-status.js",
  "functions/api/pipeline.js",
  "functions/api/pipeline-now.js",
  "functions/api/pipeline-probe.js",
  "functions/api/inbox-status.js",
  "functions/api/inbox-roster.js",
  "functions/api/cf-traffic.js",
  "functions/api/funnel.js",
]);
// Parse sites: the engine builds every feed title as "<trade> permit <dash> <addr>, <city>".
// These two lines take it apart; they never print the dash.
const PARSE_SITES = [
  ["functions/api/agent-sample.js", '.split("' + EM + '")[1]'],
  ["functions/api/newsletter-send.js", ".replace(/ " + EM + " .*$/, \"\")"],
];

let failed = 0;
function t(name, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}` + (ok || detail === undefined ? "" : `\n        ${detail}`));
}

// ---------------------------------------------------------------- 1. SCAN
// A small JS lexer: enough to tell comments from string/template/regex
// literals. Template ${...} code is lexed recursively.
function lex(s) {
  const out = []; let i = 0; const n = s.length; let prev = "";
  const REGEX_PREV = "(,=:[!&|?{};+-*%<>~^";
  const KW = new Set(["return", "typeof", "case", "in", "of", "new", "delete", "void", "throw"]);
  function tmpl(k) {
    let j = k + 1;
    while (j < n) {
      if (s[j] === BS) { j += 2; continue; }
      if (s[j] === "`") return j + 1;
      if (s.startsWith("${", j)) { j = code(j + 2); continue; }
      j++;
    }
    return n;
  }
  function code(j) {
    let d = 1;
    while (j < n && d > 0) {
      const ch = s[j];
      if (ch === '"' || ch === "'") {
        j++; while (j < n && s[j] !== ch) { if (s[j] === BS) j++; j++; } j++; continue;
      }
      if (ch === "`") { j = tmpl(j); continue; }
      if (ch === "{") d++; else if (ch === "}") d--;
      j++;
    }
    return j;
  }
  while (i < n) {
    const c = s[i];
    if (s.startsWith("//", i)) { let j = s.indexOf("\n", i); if (j < 0) j = n; out.push(["comment", i, j]); i = j; continue; }
    if (s.startsWith("/*", i)) { let j = s.indexOf("*/", i + 2); j = j < 0 ? n : j + 2; out.push(["comment", i, j]); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n && s[j] !== c && s[j] !== "\n") { if (s[j] === BS) j++; j++; }
      out.push(["string", i, j + 1]); i = j + 1; prev = "a"; continue;
    }
    if (c === "`") { const j = tmpl(i); out.push(["template", i, j]); i = j; prev = "a"; continue; }
    if (c === "/" && (prev === "" || REGEX_PREV.includes(prev))) {
      let j = i + 1, cls = false;
      while (j < n && s[j] !== "\n") {
        if (s[j] === BS) { j += 2; continue; }
        if (s[j] === "[") cls = true; else if (s[j] === "]") cls = false; else if (s[j] === "/" && !cls) break;
        j++;
      }
      out.push(["regex", i, j + 1]); i = j + 1; prev = "a"; continue;
    }
    const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 64));
    if (m) { prev = KW.has(m[0]) ? "(" : "a"; i += m[0].length; continue; }
    if (!/\s/.test(c)) prev = /[\d)\]]/.test(c) ? "a" : c;
    i++;
  }
  return out;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(m?js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
}

console.log("SCAN: string, template and regex literals in functions/**");
{
  const files = walk(FUNCS);
  const offenders = [];
  let scanned = 0, parseSitesSeen = 0;
  for (const abs of files) {
    const rel = path.relative(REPO, abs).split(path.sep).join("/");
    if (OPERATOR_ONLY.has(rel)) continue;
    scanned++;
    const src = fs.readFileSync(abs, "utf8");
    if (!DASH.test(src)) continue;
    const lines = src.split("\n");
    const spans = lex(src).filter((x) => x[0] !== "comment");
    for (const [kind, a, b] of spans) {
      const text = src.slice(a, b);
      if (!DASH.test(text)) continue;
      const line = src.slice(0, a).split("\n").length;
      // a template may span many lines: report each offending line
      const endLine = src.slice(0, b).split("\n").length;
      for (let L = line; L <= endLine; L++) {
        const lt = lines[L - 1];
        if (!DASH.test(lt)) continue;
        const site = PARSE_SITES.find(([f, snip]) => f === rel && lt.includes(snip));
        if (site) {
          // the parse snippet is allowed; nothing ELSE on that line may carry a dash
          const rest = lt.replace(site[1], "");
          if (!DASH.test(rest)) { parseSitesSeen++; continue; }
        }
        offenders.push(`${rel}:${L} [${kind}] ${lt.trim().slice(0, 140)}`);
      }
    }
  }
  t(`scanned ${scanned} shipped function files (${OPERATOR_ONLY.size} operator-only files exempt by name)`, scanned > 20);
  t("no em/en dash (or entity/escape) in any outbound literal",
    offenders.length === 0, offenders.join("\n        "));
  t("both title-parse sites are still where the engine coupling expects them", parseSitesSeen === 2,
    `found ${parseSitesSeen}; if the engine title separator changed, update PARSE_SITES and the parsers together`);
  for (const f of OPERATOR_ONLY) t(`operator-only file still exists: ${f}`, fs.existsSync(path.join(REPO, f)));
}

// ---------------------------------------------------------------- 2. RENDER
// Temp copy of functions/ as an ES-module package, with test-only re-exports
// appended to the COPY so private builders can be called directly.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nodash-test-"));
fs.cpSync(FUNCS, path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
const SHIMS = {
  "functions/api/weekly-send.js": "sendEmail",
  "functions/api/stripe-webhook.js": "sendEmail, notifyOwner",
  "functions/api/request-sample.js": "sendSample, notifyOwner",
  "functions/api/nurture.js": "email2, email3",
  "functions/api/newsletter.js": "sendConfirm",
  "functions/api/newsletter-send.js": "sendDigest, buildDigest",
  "functions/api/agent-sample.js": "sendTownSample, notifyOwner",
  "functions/leads.js": "unavailable, inactivePage",
};
for (const [rel, names] of Object.entries(SHIMS)) {
  fs.appendFileSync(path.join(tmp, rel), `\nexport { ${names} };\n`);
}
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);

// fetch stub: record every Resend call, serve the two public feeds with
// titles in the ENGINE's shape (which carries a dash), refuse everything else.
const sent = [];
const ENGINE_TITLE = (trade, addr, city) => `${trade} permit ${EM} ${addr}, ${city}`;
const feedItems = [
  { title: ENGINE_TITLE("Roofing", "12 M*** St", "Exampleton"), _town: "Exampleton", _trade: "Roofing",
    _value: 48000, date_published: "2026-09-21T00:00:00Z" },
  { title: ENGINE_TITLE("Solar", "4 O** Rd", "Exampleton"), _town: "Exampleton", _trade: "Solar",
    _value: 31000, date_published: "2026-09-22T00:00:00Z" },
  { title: ENGINE_TITLE("HVAC", "9 E*** Ave", "Sampleville"), _town: "Sampleville", _trade: "HVAC",
    _value: 12000, date_published: "2026-09-23T00:00:00Z" },
  { title: ENGINE_TITLE("Kitchen & Bath", "7 P*** Ln", "Exampleton"), _town: "Exampleton",
    _trade: "Kitchen & Bath", _value: 0, date_published: "2026-09-24T00:00:00Z" },
];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === "https://api.resend.com/emails") {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ id: "test" }), { status: 200 });
  }
  if (u.startsWith("https://masspermits.com/feed/")) {
    return new Response(JSON.stringify({ items: feedItems, _window_total: 42,
      _window_from: "2026-09-21", _window_to: "2026-09-24" }), { status: 200 });
  }
  throw new Error("test fetch refused: " + u);
};
const env = { RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>", BUNDLES: {
  get: async () => null, head: async () => null, put: async () => null, list: async () => ({ objects: [] }) } };

function checkText(name, text) {
  const s = String(text == null ? "" : text);
  const lines = s.split("\n").filter((l) => DASH.test(l)).map((l) => l.trim().slice(0, 140));
  t(name, lines.length === 0, lines.join("\n        "));
}
function checkSent(label, from) {
  const mails = sent.slice(from);
  t(`${label}: produced ${mails.length} email(s)`, mails.length > 0);
  mails.forEach((m, k) => {
    checkText(`${label} #${k + 1} subject`, m.subject);
    checkText(`${label} #${k + 1} html`, m.html);
    if (m.text) checkText(`${label} #${k + 1} text`, m.text);
  });
}
async function render(label, fn) {
  const from = sent.length;
  try { await fn(); } catch (e) { t(`${label}: builder ran`, false, String(e && e.stack || e)); return; }
  checkSent(label, from);
}

console.log("\nRENDER: paying-customer mail (weekly-send.js, stripe-webhook.js)");
{
  const ws = await load("functions/api/weekly-send.js");
  await render("weekly email, full coverage", () =>
    ws.sendEmail(env, "casey@example.com", "Casey Example", "UEsDBA==", "a".repeat(32), null));
  await render("weekly email, reduced coverage", () =>
    ws.sendEmail(env, "casey@example.com", "Casey Example", "UEsDBA==", "a".repeat(32),
      { live_sources: 27, expected_sources: 45, monthly_sources: ["Exampleton, MA"], disclose: true }));
  const sw = await load("functions/api/stripe-webhook.js");
  const bytes = new Uint8Array([80, 75, 3, 4]);
  await render("purchase email, new monthly buyer with referral + link", () =>
    sw.sendEmail(env, "casey@example.com", "monthly", "roofing__cape-cod", bytes,
      "MassPermits.zip", "ref-casey1", "b".repeat(32)));
  await render("renewal email, weekly, no link", () =>
    sw.sendEmail(env, "casey@example.com", "weekly", "", bytes, "MassPermits.zip", "", ""));
}

console.log("\nRENDER: prospect mail (request-sample, nurture, agent-sample)");
{
  const rs = await load("functions/api/request-sample.js");
  await render("free-sample email", () => rs.sendSample(env, "pat@example.com", "Roofing"));
  await render("free-sample email, no trade", () => rs.sendSample(env, "pat@example.com", ""));
  await render("free-sample owner notify, empty trade/area", () =>
    rs.notifyOwner(env, "pat@example.com", "", ""));
  const nu = await load("functions/api/nurture.js");
  checkText("nurture email 2", nu.email2({ trade: "Roofing" }));
  checkText("nurture email 3", nu.email3({}));
  const ag = await load("functions/api/agent-sample.js");
  await render("agent town sample", () => ag.sendTownSample(env, "agent@example.com", "Exampleton"));
  await render("agent statewide sample", () => ag.sendTownSample(env, "agent@example.com", "Nowhere"));
  await render("agent owner notify", () => ag.notifyOwner(env, "agent@example.com", "Exampleton"));
}

console.log("\nRENDER: reader mail (newsletter confirm + digest; engine titles carry a dash)");
{
  const nl = await load("functions/api/newsletter.js");
  await render("digest confirm email", () => nl.sendConfirm(env, "reader@example.com", "tok"));
  const nd = await load("functions/api/newsletter-send.js");
  const d = nd.buildDigest(feedItems, { _window_total: 42, _window_from: "2026-09-21", _window_to: "2026-09-24" });
  await render("statewide digest", () => nd.sendDigest(env, { email: "reader@example.com", tok: "t" }, d));
  await render("town digest", () =>
    nd.sendDigest(env, { email: "reader@example.com", tok: "t", town: "exampleton" }, { ...d, town: "exampleton" }));
  const dUnknown = nd.buildDigest(feedItems, null);
  await render("digest, unknown total", () => nd.sendDigest(env, { email: "reader@example.com", tok: "t" }, dUnknown));
}

console.log("\nRENDER: customer pages and notices");
{
  const ld = await load("functions/leads.js");
  const un = ld.unavailable();
  checkText("/leads unavailable page", await un.text());
  const ina = await ld.inactivePage(env, true);
  checkText("/leads subscription-ended page", await ina.text());
  const nt = await load("functions/api/_notice.js");
  checkText("no-file-this-week notice", JSON.stringify(nt.nothingThisWeek({ first_name: "Casey", reason_code: "", eta: "" })));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
