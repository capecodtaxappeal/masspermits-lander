// Tests for the Public Output Gate. node:test and node:assert only; every
// fixture is synthetic and lives in os.tmpdir(). No network.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { run } from './gate.mjs';
import { STALE_DAYS, STALE_DAYS_MONTHLY, mask } from './lib.mjs';
import {
  CORPUS_LAST, coverage, row, daysBefore, ld, townPage, sitewidePage, makeSite, outDir, cleanup,
} from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const GATE = path.join(HERE, 'gate.mjs');
const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const twins = [];
const tmp = [];

function gate(root, extra = []) {
  const o = outDir();
  tmp.push(o);
  const out = path.join(o, 'gate.md');
  const json = path.join(o, 'gate.json');
  const r = run(['--root', root, '--out', out, '--json', json, ...extra]);
  assert.equal(r.code, 0, r.stderr);
  const findings = JSON.parse(fs.readFileSync(json, 'utf8')).findings;
  return { ...r, report: fs.readFileSync(out, 'utf8'), findings };
}

function codesOn(findings, page) {
  return new Set(findings.filter((f) => f.page === page).map((f) => f.code));
}

function twin(code, posDesc, negDesc, { files, cov, check }) {
  const root = makeSite({ files, cov });
  tmp.push(root);
  const { findings } = gate(root);
  const pos = codesOn(findings, 'pos' in check ? check.pos : null);
  const negs = [].concat(check.neg).map((p) => codesOn(findings, p));
  const ok = pos.has(code) && negs.every((n) => !n.has(code));
  twins.push({ code, posDesc, negDesc, ok });
  assert.ok(pos.has(code), `${code} positive: got ${[...pos].join(',')}`);
  for (const n of negs) assert.ok(!n.has(code), `${code} negative twin got ${[...n].join(',')}`);
  return findings;
}

after(() => {
  const lines = ['', 'TWINS', '| Code | Positive | Negative | Y/N |', '| --- | --- | --- | --- |'];
  for (const t of twins) lines.push(`| ${t.code} | ${t.posDesc} | ${t.negDesc} | ${t.ok ? 'Y' : 'N'} |`);
  console.log(lines.join('\n'));
  cleanup(...tmp);
});

// ---------------------------------------------------------------- 2. twins

test('G1.no_value: valued_pct 0 vs 80, and a table-only "Project value"', () => {
  twin('G1.no_value', 'Great Barrington (valued_pct 0) meta promises declared value', 'Lenox (valued_pct 80); value only in a <table> header', {
    files: {
      'permits/great-barrington.html': townPage({ town: 'Great Barrington', meta: 'Leads with the full address and declared value.' }),
      'permits/lenox.html': townPage({ town: 'Lenox', meta: 'Leads with the full address and declared value.' }),
      'permits/great-barrington-electrical.html': townPage({ town: 'Great Barrington', body: '<table><tr><th>Project value</th></tr><tr><td>$1</td></tr></table>' }),
    },
    check: { pos: 'permits/great-barrington.html', neg: ['permits/lenox.html', 'permits/great-barrington-electrical.html'] },
  });
});

test('G1.low_value and G1.no_source', () => {
  twin('G1.low_value', 'Lenox at valued_pct 20 promises project value', 'Lee at valued_pct 80', {
    cov: coverage({ table: [row('Lenox, MA', { valued_pct: 20 }), row('Lee, MA', { valued_pct: 80 })] }),
    files: {
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>Every lead has the project value.</p>' }),
      'permits/lee.html': townPage({ town: 'Lee', body: '<p>Every lead has the project value.</p>' }),
    },
    check: { pos: 'permits/lenox.html', neg: ['permits/lee.html'] },
  });
  twin('G1.no_source', 'Dennis (no source) promises declared value', 'Lenox (source, 80)', {
    files: {
      'permits/dennis.html': townPage({ town: 'Dennis', body: '<p>With the declared value.</p>' }),
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>With the declared value.</p>' }),
    },
    check: { pos: 'permits/dennis.html', neg: ['permits/lenox.html'] },
  });
});

test('G1.sitewide on a region page reports K of M', () => {
  const f = twin('G1.sitewide', 'region page promises declared value', 'region page without a value promise', {
    files: {
      'solar-leads-western-ma.html': sitewidePage({ body: '<p>Leads with address and declared value.</p><a href="/permits/great-barrington">GB</a> <a href="/permits/lenox-solar">Lenox</a>' }),
      'hvac-leads-western-ma.html': sitewidePage({ body: '<p>Leads with the address.</p>' }),
    },
    check: { pos: 'solar-leads-western-ma.html', neg: ['hvac-leads-western-ma.html'] },
  });
  const g = f.find((x) => x.code === 'G1.sitewide');
  assert.match(g.evidence, /2 of 3 sources publish no value/);
  assert.match(g.evidence, /1 of the 2 linked towns with a source have valued_pct 0/);
});

test('G2.owner_name: "homeowner name" vs "reaching an owner" and a commented "owner name"', () => {
  twin('G2.owner_name', '"homeowner name, exact address"', '"reaching an owner the week they file"; "owner name" in an HTML comment', {
    files: {
      'offer.html': sitewidePage({ body: '<p>Full contact detail: homeowner name, exact address, project type.</p>' }),
      'index.html': sitewidePage({ body: '<p>Nothing beats reaching an owner the week they file.</p><!-- owner name was removed -->' }),
    },
    check: { pos: 'offer.html', neg: ['index.html'] },
  });
  twin('G2.owner_name', '"with owner, address and project type" on a town page', '"reach owners" and "the owner has already committed"', {
    files: {
      'permits/lenox.html': townPage({ town: 'Lenox', meta: 'Leads with owner, address and project type.' }),
      'permits/lenox-solar.html': townPage({ town: 'Lenox', body: '<p>Reach owners early; the owner has already committed.</p>' }),
    },
    check: { pos: 'permits/lenox.html', neg: ['permits/lenox-solar.html'] },
  });
});

test('G3.contractor: "the contractor on file" is UNJUDGED, "contractor leads" is nothing', () => {
  const f = twin('G3.contractor', '"exact address and the contractor on file"', '"contractor leads"', {
    files: {
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>Each lead has the exact address and the contractor on file.</p>' }),
      'permits/lenox-solar.html': townPage({ town: 'Lenox', body: '<p>Solar contractor leads in Lenox.</p>' }),
    },
    check: { pos: 'permits/lenox.html', neg: ['permits/lenox-solar.html'] },
  });
  for (const x of f.filter((y) => y.code === 'G3.contractor')) assert.equal(x.level, 'UNJUDGED');
});

test('G4.region: Great Barrington as Greater Boston vs Western MA; region page links', () => {
  const gbLd = (label) => ({ '@context': 'https://schema.org', '@type': 'Dataset', name: 'x', spatialCoverage: { '@type': 'Place', name: `${label}, Massachusetts` } });
  twin('G4.region', 'GB spatialCoverage "Greater Boston, Massachusetts"', 'GB spatialCoverage "Western MA, Massachusetts"', {
    files: {
      'permits/great-barrington.html': townPage({ town: 'Great Barrington', ldObj: gbLd('Greater Boston') }),
      'permits/great-barrington-solar.html': townPage({ town: 'Great Barrington', ldObj: gbLd('Western MA') }),
    },
    check: { pos: 'permits/great-barrington.html', neg: ['permits/great-barrington-solar.html'] },
  });
  twin('G4.region', 'greater-boston region page links /permits/great-barrington-electrical', 'western-ma region page links the same town', {
    files: {
      'electrical-leads-greater-boston.html': sitewidePage({ body: '<a href="/permits/great-barrington-electrical">GB</a>' }),
      'electrical-leads-western-ma.html': sitewidePage({ body: '<a href="/permits/great-barrington-electrical">GB</a>' }),
    },
    check: { pos: 'electrical-leads-greater-boston.html', neg: ['electrical-leads-western-ma.html'] },
  });
});

test('G4.unjudged: a town absent from town-county.json is never G4.region', () => {
  const ldObj = { '@type': 'Dataset', name: 'x', spatialCoverage: { name: 'Greater Boston, Massachusetts' } };
  const f = twin('G4.unjudged', 'Springfield (not in town-county.json) labelled Greater Boston', 'Great Barrington labelled Western MA', {
    files: {
      'permits/springfield.html': townPage({ town: 'Springfield', ldObj }),
      'permits/great-barrington.html': townPage({ town: 'Great Barrington', ldObj: { ...ldObj, spatialCoverage: { name: 'Western MA, Massachusetts' } } }),
    },
    check: { pos: 'permits/springfield.html', neg: ['permits/great-barrington.html'] },
  });
  assert.ok(!codesOn(f, 'permits/springfield.html').has('G4.region'));
});

test('G5.stale: dateModified 40 days old vs 3 days; G5.no_source', () => {
  const cov = coverage({ table: [row('Lenox, MA', { last: daysBefore(CORPUS_LAST, 40) }), row('Lee, MA', { last: daysBefore(CORPUS_LAST, 40) })] });
  twin('G5.stale', 'Lenox, newest date 40 days old, "live preview of the 90 most recent"', 'Lee, page dateModified 3 days old', {
    cov,
    files: {
      'permits/lenox.html': townPage({ town: 'Lenox', dateModified: daysBefore(CORPUS_LAST, 40), body: '<p>Below is a live preview of the 90 most recent.</p>' }),
      'permits/lee.html': townPage({ town: 'Lee', dateModified: daysBefore(CORPUS_LAST, 3), body: '<p>Below is a live preview of the 90 most recent.</p>' }),
    },
    check: { pos: 'permits/lenox.html', neg: ['permits/lee.html'] },
  });
  const f = twin('G5.no_source', 'Dennis (no source) "315 recent" with paused note', 'Lenox (source, fresh)', {
    files: {
      'permits/dennis.html': townPage({ town: 'Dennis', note: true, body: '<p>A live preview of the 315 most recent.</p>' }),
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>A live preview of the 90 most recent.</p>' }),
    },
    check: { pos: 'permits/dennis.html', neg: ['permits/lenox.html'] },
  });
  const d = f.find((x) => x.code === 'G5.no_source');
  assert.match(d.evidence, /paused note present/);
  assert.equal(d.state, 'frozen');
});

test('G5.fresh_count: homepage live-count template over a long corpus span', () => {
  const tpl = '<script>$("live-count").innerHTML = `${n} <small>fresh ${w} permits available</small>`;</script>';
  twin('G5.fresh_count', 'index.html with the fresh-count template', 'offer.html with the same template (not the homepage)', {
    files: {
      'index.html': sitewidePage({ body: tpl }),
      'offer.html': sitewidePage({ body: tpl }),
    },
    check: { pos: 'index.html', neg: ['offer.html'] },
  });
});

test('G6.monthly: monthly source "every week" vs non-monthly, and vs "a weekly feed $99/mo"', () => {
  const cov = coverage({ table: [row('Provincetown, MA'), row('Lenox, MA')], monthly: ['Provincetown, MA'] });
  twin('G6.monthly', 'Provincetown (monthly) "filed every week"', 'Lenox (not monthly) "every week"; Provincetown "a weekly feed $99/mo"', {
    cov,
    files: {
      'permits/provincetown.html': townPage({ town: 'Provincetown', body: '<p>Permits are filed in Provincetown every week.</p>' }),
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>Permits are filed in Lenox every week.</p>' }),
      'permits/provincetown-solar.html': townPage({ town: 'Provincetown', body: '<p>Try a weekly feed $99/mo.</p>' }),
    },
    check: { pos: 'permits/provincetown.html', neg: ['permits/lenox.html', 'permits/provincetown-solar.html'] },
  });
});

test('G6.no_source and G6.unjudged', () => {
  twin('G6.no_source', 'Dennis (no source) "every week"', 'Lenox (source) "every week"', {
    files: {
      'permits/dennis.html': townPage({ town: 'Dennis', body: '<p>Filed in Dennis every week.</p>' }),
      'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>Filed in Lenox every week.</p>' }),
    },
    check: { pos: 'permits/dennis.html', neg: ['permits/lenox.html'] },
  });
  const f = twin('G6.unjudged', 'index.html "every Monday"', 'offer.html "Weekly Feed" product name only', {
    files: {
      'index.html': sitewidePage({ body: '<p>New permits in your trade, every Monday.</p>' }),
      'offer.html': sitewidePage({ body: '<p>The Weekly Feed, $99/mo.</p>' }),
    },
    check: { pos: 'index.html', neg: ['offer.html'] },
  });
  assert.equal(f.find((x) => x.code === 'G6.unjudged').level, 'UNJUDGED');
});

test('G7.count: 70 vs n_sources 71', () => {
  const table = [];
  for (let i = 0; i < 71; i++) table.push(row(i === 0 ? 'Lenox, MA' : `Sample Source ${i}, MA`));
  twin('G7.count', 'index.html meta "70 Massachusetts towns"', 'offer.html "71 Massachusetts towns"', {
    cov: coverage({ table }),
    files: {
      'index.html': sitewidePage({ meta: 'Building permits from 70 Massachusetts towns and counting.' }),
      'offer.html': sitewidePage({ meta: 'Building permits from 71 Massachusetts towns and counting.' }),
    },
    check: { pos: 'index.html', neg: ['offer.html'] },
  });
});

// ---------------------------------------------------------------- 3. boundaries

test('boundaries: age STALE_DAYS is fine, STALE_DAYS+1 is stale; monthly limit', () => {
  const cov = coverage({
    table: [row('Lenox, MA', { last: daysBefore(CORPUS_LAST, STALE_DAYS) }), row('Lee, MA', { last: daysBefore(CORPUS_LAST, STALE_DAYS + 1) }),
      row('Truro, MA', { last: daysBefore(CORPUS_LAST, STALE_DAYS_MONTHLY) }), row('Chatham, MA', { last: daysBefore(CORPUS_LAST, STALE_DAYS_MONTHLY + 1) })],
    monthly: ['Truro, MA', 'Chatham, MA'],
  });
  const body = '<p>A live preview of the 50 most recent.</p>';
  const files = {};
  for (const [t, d] of [['Lenox', STALE_DAYS], ['Lee', STALE_DAYS + 1], ['Truro', STALE_DAYS_MONTHLY], ['Chatham', STALE_DAYS_MONTHLY + 1]]) {
    files[`permits/${t.toLowerCase()}.html`] = townPage({ town: t, dateModified: daysBefore(CORPUS_LAST, d), body });
  }
  const root = makeSite({ cov, files });
  tmp.push(root);
  const { findings } = gate(root);
  assert.ok(!codesOn(findings, 'permits/lenox.html').has('G5.stale'));
  assert.ok(codesOn(findings, 'permits/lee.html').has('G5.stale'));
  assert.ok(!codesOn(findings, 'permits/truro.html').has('G5.stale'));
  assert.ok(codesOn(findings, 'permits/chatham.html').has('G5.stale'));
});

test('boundaries: valued_pct 0 no_value, 0.1 and 49.9 low_value, 50 none', () => {
  const pcts = { Lenox: 0, Lee: 0.1, Otis: 49.9, Stockbridge: 50 };
  const cov = coverage({ table: Object.entries(pcts).map(([t, v]) => row(`${t}, MA`, { valued_pct: v })) });
  const files = {};
  for (const t of Object.keys(pcts)) files[`permits/${t.toLowerCase()}.html`] = townPage({ town: t, body: '<p>With the declared value.</p>' });
  const root = makeSite({ cov, files });
  tmp.push(root);
  const { findings } = gate(root);
  const g1 = (p) => [...codesOn(findings, p)].filter((c) => c.startsWith('G1')).sort().join(',');
  assert.equal(g1('permits/lenox.html'), 'G1.no_value');
  assert.equal(g1('permits/lee.html'), 'G1.low_value');
  assert.equal(g1('permits/otis.html'), 'G1.low_value');
  assert.equal(g1('permits/stockbridge.html'), '');
});

// ---------------------------------------------------------------- 4. masking

test('masking: table, comment and script sentinels never surface; line numbers match', () => {
  const body = [
    '<table><tr><td>SENTINEL_TABLE declared value</td></tr></table>',
    '<!-- SENTINEL_COMMENT declared value -->',
    '<script>var s = "SENTINEL_SCRIPT declared value";</script>',
    '<p>First line.</p>',
    '<p>Here the lead has its',
    'declared value, promised.</p>',
  ].join('\n');
  const html = townPage({ town: 'Lenox', body });
  const cov = coverage({ table: [row('Lenox, MA', { valued_pct: 0 })] });
  const root = makeSite({ cov, files: { 'permits/lenox.html': html } });
  tmp.push(root);
  const { findings, report, stdout } = gate(root);
  const text = findings.filter((f) => f.surface === 'text' && f.code === 'G1.no_value');
  assert.equal(text.length, 1);
  const expected = html.split('\n').findIndex((l) => /^declared value, promised/.test(l)) + 1;
  assert.equal(text[0].line, expected);
  for (const s of ['SENTINEL_TABLE', 'SENTINEL_COMMENT', 'SENTINEL_SCRIPT']) {
    assert.ok(!report.includes(s), s);
    assert.ok(!stdout.includes(s), s);
    assert.ok(!JSON.stringify(findings).includes(s), s);
  }
  const m = mask(html);
  assert.equal(m.length, html.length);
  assert.equal(m.split('\n').length, html.split('\n').length);
});

// ---------------------------------------------------------------- 5. offline

test('offline: fetch stub records zero calls; no network imports in non-test files', () => {
  const saved = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('network call refused in tests'); };
  try {
    const root = makeSite({ files: { 'permits/lenox.html': townPage({ town: 'Lenox', body: '<p>With declared value, every week.</p>' }) } });
    tmp.push(root);
    gate(root);
  } finally {
    globalThis.fetch = saved;
  }
  assert.equal(calls, 0);
  for (const f of addedFiles().filter((p) => !p.endsWith('.test.mjs'))) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!s.includes('fetch('), f);
    assert.ok(!/node:(http|https|net|dns|child_process)\b/.test(s), f);
  }
});

// ---------------------------------------------------------------- 6. warn-only, read-only

function hashTree(root) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(root, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(root);
  return out;
}

function cli(args) {
  return spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
}

test('warn-only: a fixture full of findings exits 0 and the tree is unchanged', () => {
  const root = makeSite({
    files: {
      'index.html': sitewidePage({ meta: 'From 70 Massachusetts towns, with owner, address and declared value, every Monday.' }),
      'permits/dennis.html': townPage({ town: 'Dennis', note: true, body: '<p>Filed every week. A live preview of the 315 most recent, with owner, address and declared value.</p>' }),
    },
  });
  tmp.push(root);
  const before = hashTree(root);
  const o = outDir();
  tmp.push(o);
  const r = cli(['--root', root, '--out', path.join(o, 'r.md'), '--json', path.join(o, 'r.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hashTree(root), before);
});

test('evidence unreadable: missing, truncated, wrong-shape coverage.json exit 2 with one fixed line', () => {
  const rel = 'research/evidence/coverage.json';
  const cases = {
    missing: makeSite({ cov: null }),
    truncated: makeSite(),
    wrong: makeSite({ cov: { stats: { table: 'nope' } } }),
  };
  fs.writeFileSync(path.join(cases.truncated, rel), '{"stats": {"table": [');
  for (const [k, root] of Object.entries(cases)) {
    tmp.push(root);
    const o = outDir();
    tmp.push(o);
    const r = cli(['--root', root, '--out', path.join(o, 'r.md')]);
    assert.equal(r.status, 2, k);
    assert.equal(r.stderr, `gate: evidence unreadable: ${rel}\n`, k);
    assert.ok(!/\bat\s|Error/.test(r.stderr), k);
    assert.ok(!fs.existsSync(path.join(o, 'r.md')), k);
  }
  const noAreas = makeSite({ data: { generated: 'x' } });
  tmp.push(noAreas);
  const o = outDir();
  tmp.push(o);
  const r = cli(['--root', noAreas, '--out', path.join(o, 'r.md')]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'gate: evidence unreadable: data.json\n');
});

test('--out or --json inside --root is refused and writes nothing', () => {
  const root = makeSite({ files: { 'index.html': sitewidePage({}) } });
  tmp.push(root);
  const before = hashTree(root);
  const r = cli(['--root', root, '--out', path.join(root, 'report.md')]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'gate: --out inside --root refused\n');
  const o = outDir();
  tmp.push(o);
  const r2 = cli(['--root', root, '--out', path.join(o, 'r.md'), '--json', path.join(root, 'sub', 'f.json')]);
  assert.equal(r2.status, 2);
  assert.equal(r2.stderr, 'gate: --out inside --root refused\n');
  assert.ok(!fs.existsSync(path.join(o, 'r.md')));
  assert.deepEqual(hashTree(root), before);
});

// ---------------------------------------------------------------- 7. leak and style

test('leak: report and stdout carry no "@", no 32-hex token, no "cus_"', () => {
  const token = 'a'.repeat(32);
  const root = makeSite({
    files: {
      'offer.html': sitewidePage({ body: `<p>Mail someone@example.com for owner, address and declared value.</p><p>Ref ${token} gives the declared value.</p><p>Account cus_TEST123 has the project value every week.</p>` }),
    },
  });
  tmp.push(root);
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40) + '\n');
  const { report, stdout, findings } = gate(root);
  assert.ok(findings.length > 0);
  assert.match(report, new RegExp('Checkout: ' + 'b'.repeat(12) + '\\n'));
  for (const s of [report, stdout]) {
    assert.ok(!s.includes('@'));
    assert.ok(!/[0-9a-f]{32}/.test(s));
    assert.ok(!s.includes('cus_'));
    assert.ok(!s.includes(EM) && !s.includes(EN));
  }
  assert.match(report, /\[withheld\]/);
});

function addedFiles() {
  const out = [];
  for (const d of [HERE, path.join(REPO, 'docs', 'gate')]) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d)) out.push(path.join(d, e));
  }
  return out;
}

test('style: no em dash or en dash in any added file', () => {
  for (const f of addedFiles()) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!s.includes(EM) && !s.includes(EN), f);
  }
});

// ---------------------------------------------------------------- 8. route grep

test('route grep: no non-test file names a guarded route, force=1 or a pages.dev host', () => {
  const list = 'weekly-send|mail-owner|newsletter-send|newsletter|nurture|lifecycle-send|request-sample|agent-sample|upload-bundle|funnel|hit';
  const res = [
    new RegExp(`(?<![A-Za-z0-9_])/api/(${list})\\b`),
    new RegExp(`masspermits\\.com/api/(${list})\\b`),
    /force=1/,
    /[a-z0-9-]+\.pages\.dev/i,
  ];
  for (const f of addedFiles().filter((p) => !p.endsWith('.test.mjs'))) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of res) assert.ok(!re.test(s), `${path.basename(f)} matches ${re}`);
  }
});

// ---------------------------------------------------------------- 9. workflow lint

test('workflow: line rules', () => {
  const wf = fs.readFileSync(path.join(REPO, 'docs', 'gate', 'public-output-gate.yml.txt'), 'utf8');
  const lines = wf.split('\n');
  const body = lines.filter((l) => !/^\s*#/.test(l));
  const text = body.join('\n');
  // on: holds only schedule and workflow_dispatch
  const onAt = body.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(onAt >= 0);
  const onKeys = [];
  for (let i = onAt + 1; i < body.length && !/^\S/.test(body[i]); i++) {
    const m = /^ {2}([A-Za-z_]+):/.exec(body[i]);
    if (m) onKeys.push(m[1]);
  }
  assert.deepEqual(onKeys.sort(), ['schedule', 'workflow_dispatch']);
  assert.equal((text.match(/-\s*cron:/g) || []).length, 1);
  assert.match(text, /cron:\s*"0 18 \* \* 2"/);
  // permissions exactly contents: read, top level only
  const permLines = body.map((l, i) => [l, i]).filter(([l]) => /permissions\s*:/.test(l));
  assert.equal(permLines.length, 1);
  assert.match(permLines[0][0], /^permissions:\s*$/);
  const next = body.slice(permLines[0][1] + 1).filter((l) => l.trim() !== '');
  assert.match(next[0], /^ {2}contents: read\s*$/);
  assert.match(next[1], /^\S/);
  for (const bad of ['id-token', 'secrets.', 'actions: write', 'contents: write', 'git push', 'git commit', 'pull_request', 'workflow_run', 'push:']) {
    assert.ok(!wf.includes(bad), bad);
  }
  assert.match(text, /ref: main/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /continue-on-error: true/);
  const uses = [...text.matchAll(/uses:\s*([^@\s]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(uses)].sort(), ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
  // no run: block contains "${{"
  for (let i = 0; i < body.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(body[i]);
    if (!m) continue;
    const block = [m[2]];
    const ind = m[1].length;
    for (let j = i + 1; j < body.length; j++) {
      const lead = /^(\s*)/.exec(body[j])[1].length;
      if (body[j].trim() !== '' && lead <= ind + (body[i].includes('- run:') ? 2 : 0)) break;
      block.push(body[j]);
    }
    assert.ok(!block.join('\n').includes('${{'), `run block at line ${i + 1}`);
  }
});
