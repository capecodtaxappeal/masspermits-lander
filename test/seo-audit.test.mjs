// scripts/seo/audit.mjs against a tiny synthetic site built in a temp dir.
// Every check in the audit has at least one page here that should trip it and
// one that should not. Town names are invented ("alpha", "beta", "gamma").
//
//   node --test test/seo-audit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  audit, assertOutsideRepo, thinFromDistribution, parsePage, fileToUrl, normUrl,
  jaccard, shingles, words, mulberry32, summaryMarkdown,
} from "../scripts/seo/audit.mjs";

const DASH = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "seo", "audit.mjs");

const VOCAB = ("permit roof deck porch kitchen bath window door siding solar panel heat pump boiler furnace " +
  "electric service upgrade plumbing gas line fence shed garage addition basement insulation chimney stove " +
  "sprinkler alarm sign pool spa demolition foundation framing drywall paint tile cabinet counter").split(" ");
function prose(seed, n) {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => VOCAB[Math.floor(r() * VOCAB.length)]).join(" ");
}

function page({ title, desc, canonical, robots, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
${title != null ? `<title>${title}</title>` : ""}
${desc != null ? `<meta name="description" content="${desc}">` : ""}
${canonical ? `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'></svg>"><link rel="canonical" href="${canonical}">` : ""}
${robots ? `<meta name="robots" content="${robots}">` : ""}
<style>body{color:red}</style></head><body>
<header class="site"><a href="/">Brand</a> header words that are not content</header>
<script>var hidden = "script words must not count";</script>
<p>${body}</p>
<footer>footer words that are not content</footer></body></html>`;
}

const D = "A fair length description of the permits on this page, written for the fixture site here.";
const ORIGIN = "https://masspermits.com";

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seo-audit-site-"));
  const w = (rel, s) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), s); };
  const shared = prose(7, 400);
  const pages = {
    // hand-written, in sitemap, clean
    "index.html": page({ title: "Massachusetts building permits for contractors", desc: D, canonical: `${ORIGIN}/`, body: prose(1, 400) }),
    // generated (0.6), clean apart from the near duplicate pair below
    "permits/alpha.html": page({ title: "Alpha building permits and contractor leads", desc: D + " Alpha hub.", canonical: `${ORIGIN}/permits/alpha`, body: prose(2, 400) }),
    // near duplicates of each other (same tier), plus weekly wording on a live town
    "permits/alpha-plumbing.html": page({ title: "Alpha plumbing permits for contractors in MA", desc: D + " Alpha plumbing.", body: shared + " plumbing weekly" }),
    "permits/alpha-roofing.html": page({ title: "Alpha roofing permits for contractors in MA", desc: D + " Alpha roofing.", body: shared + " roofing weekly" }),
    // title too long, description too long
    "permits/alpha-solar.html": page({ title: "Alpha solar permits and contractor leads for every solar installer in the state", desc: D.repeat(3), body: prose(3, 400) }),
    // title too short, description missing
    "permits/alpha-gas.html": page({ title: "Alpha gas", body: prose(4, 400) }),
    // duplicate title and description pair
    "permits/alpha-hvac.html": page({ title: "Alpha HVAC permits for MA heating contractors", desc: D + " Same.", body: prose(5, 400) }),
    "permits/alpha-heat.html": page({ title: "Alpha HVAC permits for MA heating contractors", desc: D + " Same.", body: prose(6, 400) }),
    // noindex page listed in sitemap (conflict)
    "permits/alpha-electrical-cost.html": page({ title: "Alpha electrical cost of permitted work in MA", desc: D, robots: "noindex,follow", body: prose(8, 400) }),
    // noindex page not in sitemap (fine)
    "permits/alpha-fence-cost.html": page({ title: "Alpha fence cost of permitted work in MA towns", desc: D, robots: "noindex,follow", body: prose(9, 400) }),
    // canonical elsewhere while in sitemap (conflict)
    "permits/alpha-sign.html": page({ title: "Alpha sign permits for contractors in MA towns", desc: D + " Sign.", canonical: `${ORIGIN}/permits/alpha-sign-awning`, body: prose(10, 400) }),
    // frozen (0.3), monthly town, freshness wording in title and body, title lacks town
    "permits/beta-building.html": page({ title: "Building contractor leads, updated weekly", desc: D + " Beta.", body: prose(11, 400) + " New permits every Monday." }),
    // frozen because absent from sitemap and not noindexed (orphan)
    "guides/orphan.html": page({ title: "An orphan guide page that nobody links in the map", desc: D + " Orphan.", body: prose(12, 400) }),
    // dark town (failing, no rows), generated, thin
    "permits/gamma.html": page({ title: "Gamma building permits and contractor leads", desc: D + " Gamma.", body: "only a few words here" }),
    // town index so news/<town>/ marks the slugs
    "news/alpha/index.html": page({ title: "Alpha weekly permit briefs and archive in MA", desc: D + " News.", body: prose(13, 400) }),
    "news/beta/index.html": page({ title: "Beta permit briefs and archive for Massachusetts", desc: D + " Beta news.", body: prose(14, 400) }),
    "news/gamma/index.html": page({ title: "Gamma permit briefs and archive for Massachusetts", desc: D + " Gamma news.", body: prose(15, 400) }),
    // noindexed by _headers, not by meta
    "docs/notes.html": page({ title: "Internal notes page for the fixture site only", desc: D + " Docs.", body: prose(16, 400) }),
  };
  for (const [rel, html] of Object.entries(pages)) w(rel, html);
  const sm = [
    ["/", "1.0"], ["/permits/alpha", "0.8"], ["/permits/alpha-plumbing", "0.6"], ["/permits/alpha-roofing", "0.6"],
    ["/permits/alpha-solar", "0.6"], ["/permits/alpha-gas", "0.6"], ["/permits/alpha-hvac", "0.6"], ["/permits/alpha-heat", "0.6"],
    ["/permits/alpha-electrical-cost", "0.6"], ["/permits/alpha-sign", "0.6"], ["/permits/beta-building", "0.3"],
    ["/permits/gamma", "0.6"], ["/news/alpha/", "0.6"], ["/news/beta/", "0.6"], ["/news/gamma/", "0.6"],
    ["/permits/ghost", "0.6"],
  ];
  w("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    sm.map(([u, p]) => `<url><loc>${ORIGIN}${u}</loc><lastmod>2026-10-01</lastmod><priority>${p}</priority></url>`).join("\n") + "\n</urlset>\n");
  w("_headers", "/*\n  X-Content-Type-Options: nosniff\n\n# docs are not pages\n/docs/*\n  X-Robots-Tag: noindex, nofollow\n");
  w("research/evidence/coverage.json", JSON.stringify({
    stats: { monthly: ["Beta, MA"], errors: ["Gamma, MA"], table: [{ source: "Alpha, MA", rows: 50 }, { source: "Beta, MA", rows: 10 }] },
  }));
  return root;
}

const root = buildFixture();
const r = audit(root, { thin: 50, cluster: 0.8 });
const byPath = Object.fromEntries(r.pages.map((p) => [p.path, p]));
const has = (p, f) => byPath[p].flags.includes(f);

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("1. path classes", () => {
  assert.equal(byPath["index.html"].class, "hand-written");
  assert.equal(byPath["permits/alpha.html"].class, "generated");
  assert.equal(byPath["permits/beta-building.html"].class, "frozen");
  assert.equal(byPath["guides/orphan.html"].class, "frozen");
  assert.equal(byPath["permits/alpha-fence-cost.html"].class, "noindexed");
  assert.equal(byPath["docs/notes.html"].class, "noindexed");
  assert.match(byPath["docs/notes.html"].noindexSource, /_headers/);
  assert.equal(byPath["permits/gamma.html"].owner, "dark-branch");
  assert.equal(byPath["permits/alpha.html"].owner, "generator");
  assert.equal(byPath["permits/beta-building.html"].owner, "frozen-retrofit");
});

test("2. titles and descriptions", () => {
  assert.ok(has("permits/alpha-solar.html", "title-long"));
  assert.ok(has("permits/alpha-solar.html", "description-long"));
  assert.ok(has("permits/alpha-gas.html", "title-short"));
  assert.ok(has("permits/alpha-gas.html", "description-missing"));
  assert.ok(has("permits/alpha-hvac.html", "title-duplicate"));
  assert.ok(has("permits/alpha-heat.html", "description-duplicate"));
  assert.ok(has("permits/beta-building.html", "title-lacks-town"));
  assert.ok(!has("permits/alpha.html", "title-lacks-town"));
  assert.ok(!has("index.html", "title-long") && !has("index.html", "description-missing"));
  const blank = audit(root, { thin: 50 });
  assert.equal(blank.checks["title-missing"].total, 0);
  assert.equal(parsePage("<html><body>x</body></html>").title, null);
});

test("3. conflicts", () => {
  assert.ok(has("permits/alpha-electrical-cost.html", "noindex-in-sitemap"));
  assert.ok(!has("permits/alpha-fence-cost.html", "noindex-in-sitemap"));
  assert.ok(has("permits/alpha-sign.html", "canonical-elsewhere-in-sitemap"));
  assert.ok(!has("permits/alpha.html", "canonical-elsewhere-in-sitemap"));
  assert.deepEqual(r.sitemapNoFile.map((e) => e.loc), [`${ORIGIN}/permits/ghost`]);
  assert.ok(has("guides/orphan.html", "not-in-sitemap-not-noindexed"));
  assert.ok(!has("docs/notes.html", "not-in-sitemap-not-noindexed"));
  assert.equal(fileToUrl("news/alpha/index.html"), "/news/alpha/");
  assert.equal(normUrl("https://masspermits.com/permits/x.html?a=1"), "/permits/x");
});

test("4. thin pages, and the threshold from the distribution", () => {
  assert.ok(has("permits/gamma.html", "thin"));
  assert.ok(!has("permits/alpha.html", "thin"));
  // header, footer and script words are not counted
  assert.equal(byPath["permits/gamma.html"].words, 5);
  const bimodal = [...Array(60).fill(180), ...Array(5).fill(290), ...Array(80).fill(450)];
  const t = thinFromDistribution(bimodal);
  assert.equal(t.threshold, 200);
  assert.match(t.rule, /valley/);
  assert.match(thinFromDistribution([1, 2, 3]).rule, /fallback/);
  assert.equal(r.options.thinThreshold, 50);
});

test("5. near duplicate clusters and tier medians", () => {
  assert.ok(has("permits/alpha-plumbing.html", "near-duplicate"));
  assert.ok(has("permits/alpha-roofing.html", "near-duplicate"));
  assert.ok(!has("permits/alpha-solar.html", "near-duplicate"));
  const c = r.clusters.top.find((x) => x.sample.includes("permits/alpha-plumbing.html"));
  assert.equal(c.size, 2);
  assert.equal(c.tier, "permits/town-trade");
  const tier = r.tiers.find((x) => x.tier === "permits/town-trade");
  assert.ok(tier.medianJaccard != null && tier.medianJaccard < 0.5);
  const a = shingles(words("one two three four five six seven"));
  assert.equal(jaccard(a, a), 1);
});

test("6. freshness words on monthly or failing towns only", () => {
  assert.ok(has("permits/beta-building.html", "freshness-claim"));
  assert.ok(has("permits/beta-building.html", "freshness-claim-snippet"));
  const f = r.freshness.pages.find((x) => x.path === "permits/beta-building.html");
  assert.equal(f.status, "monthly");
  assert.ok(f.hits.includes("weekly@title") && f.hits.includes("every monday@body"));
  // a live town may say weekly
  assert.ok(!has("permits/alpha-plumbing.html", "freshness-claim"));
  assert.deepEqual(r.freshness.watchedTowns, ["beta", "gamma"]);
});

test("fixes are ranked and the summary renders", () => {
  for (let i = 1; i < r.fixes.length; i++) assert.ok(r.fixes[i - 1].pages >= r.fixes[i].pages);
  const md = summaryMarkdown(r);
  assert.match(md, /# SEO audit/);
  assert.ok(!DASH.test(md));
});

test("refuses an output path inside the checkout, writes outside it", () => {
  assert.throws(() => assertOutsideRepo(root, path.join(root, "out")), /inside the checkout/);
  assert.throws(() => assertOutsideRepo(root, root), /inside the checkout/);
  const bad = spawnSync(process.execPath, [SCRIPT, "--root", root, "--out", path.join(root, "seo-out")], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.ok(!fs.existsSync(path.join(root, "seo-out")));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "seo-audit-out-"));
  try {
    const ok = spawnSync(process.execPath, [SCRIPT, "--root", root, "--out", out], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    const j = JSON.parse(fs.readFileSync(path.join(out, "audit.json"), "utf8"));
    assert.equal(j.totals.htmlFiles, r.totals.htmlFiles);
    assert.ok(fs.existsSync(path.join(out, "summary.md")));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("no em or en dashes in the script or this test", () => {
  for (const f of [SCRIPT, fileURLToPath(import.meta.url)]) assert.ok(!DASH.test(fs.readFileSync(f, "utf8")), f);
});
