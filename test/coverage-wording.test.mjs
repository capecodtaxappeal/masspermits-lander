// D26 and D27 (Patrick, 2026-09-27).
//
// D26: the reduced-coverage note must be true for every town it names. The
// towns come from the engine's cadence list (coverage.monthly_sources), which
// holds quarterly Needham and late-publishing Lowell and Waltham as well as
// monthly towns, so the note may not say "monthly", "a batch early each
// month" or "real and current". It says how often, never how the data is
// gathered. Rendered from a temp copy of functions/ (test-only re-exports are
// appended to the COPY; the shipped files are untouched), with fetch stubbed
// so nothing leaves the machine.
//
// D27: no customer's name or handle in a shipped function file, comments
// included (the repo is public).
//
//   node --test test/coverage-wording.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-wording-"));
fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
fs.appendFileSync(path.join(tmp, "functions/api/weekly-send.js"), "\nexport { sendEmail };\n");
fs.appendFileSync(path.join(tmp, "functions/leads.js"), "\nexport { renderPortal };\n");
const load = (rel) => import(pathToFileURL(path.join(tmp, rel)).href);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const COVERAGE = { live_sources: 77, expected_sources: 140, disclose: true,
  monthly_sources: ["Needham, MA", "Lowell, MA", "Waltham, MA"] };
const FALSE_CLAIMS = [/early each month/i, /a batch early/i, /real and current/i, /\bcurrent\b/i,
  /<b>monthly<\/b>/i, /publish their permits <b>monthly<\/b>/i];

function checkNote(html, where) {
  for (const re of FALSE_CLAIMS) assert.ok(!re.test(html), where + " still says " + re);
  assert.ok(html.includes("Needham, Lowell, Waltham publish their permits <b>monthly or less often</b>"), where);
  assert.ok(html.includes("so their new rows arrive in batches when each town publishes, not every week."), where);
  assert.ok(html.includes("Every row shows its date."), where);
}

test("D26 weekly email: the reduced-coverage box is true for quarterly and late towns", async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "test" }), { status: 200 });
    }
    throw new Error("test fetch refused: " + url);
  };
  try {
    const ws = await load("functions/api/weekly-send.js");
    const env = { RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>" };
    await ws.sendEmail(env, "casey@example.com", "Casey Example", "UEsDBA==", "a".repeat(32), COVERAGE);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.length, 1);
  const html = sent[0].html;
  checkNote(html, "weekly email");
  assert.ok(html.includes("Every row in the attached file is a real permit."));
});

test("D26 /leads portal: the mirrored note says the same, and never 'real and current'", async () => {
  // HTMLRewriter is a Workers global. This stand-in runs each element handler
  // once against a recorder, which is enough to capture the injected banner.
  const captured = [];
  globalThis.HTMLRewriter = class {
    constructor() { this.h = []; }
    on(sel, h) { this.h.push(h); return this; }
    transform(res) {
      for (const h of this.h) {
        h.element({ append: (x) => captured.push(x), prepend: (x) => captured.push(x),
          setInnerContent() {}, setAttribute() {} });
      }
      return res;
    }
  };
  const now = Date.now();
  const status = { ran_at: new Date(now - 3600_000).toISOString(), ok: true, coverage: COVERAGE };
  const env = { BUNDLES: {
    head: async (k) => (k === "latest-weekly.html" || k === "latest-weekly.zip" ? { uploaded: new Date(now - 3600_000) } : null),
    get: async (k) => (k === "refresh-status.json" ? { text: async () => JSON.stringify(status) }
      : k === "latest-weekly.html" ? { body: "<html><body></body></html>" } : null),
    put: async () => null,
  } };
  const ld = await load("functions/leads.js");
  const req = new Request("https://masspermits.com/leads", { method: "GET" });
  const res = await ld.renderPortal({ request: req, env, waitUntil() {} }, "a".repeat(32), { email: "casey@example.com" });
  assert.equal(res.status, 200);
  const banner = captured.join("");
  checkNote(banner, "/leads");
  assert.ok(banner.includes("Every row on this page is a real permit."));
});

test("D27 no customer name or handle in any shipped function file, comments included", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []);
  // SHA-256 of the lower-cased words seen in these files before 2026-09-27, stored
  // as hashes so this public repo does not carry the words themselves.
  const NAMES = new Set(["d7c73fb39f70b2d80b3b1268f607b092ffc35f96fbdc10a5f7b689ed7abdd048",
    "193639b2c559dde372485c6be31955c42d59b0e49a5b0f403d23a8066188f8af",
    "bf6d4e43f780d5137284bad3061596a6bf79e908997d6a441444661d762e6377"]);
  const sha = (w) => crypto.createHash("sha256").update(w).digest("hex");
  const hits = walk(path.join(REPO, "functions")).filter((f) =>
    (fs.readFileSync(f, "utf8").toLowerCase().match(/[a-z0-9]+/g) || []).some((w) => NAMES.has(sha(w))))
    .map((f) => path.relative(REPO, f));
  assert.deepEqual(hits, []);
});
