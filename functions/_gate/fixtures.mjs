// Synthetic mini-sites for the gate tests, written to os.tmpdir(). Town names
// are real; every street, person, number and id here is invented.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CORPUS_FIRST = '2026-01-05';
export const CORPUS_LAST = '2026-06-30';

export function daysBefore(date, n) {
  const t = Date.parse(date + 'T00:00:00Z') - n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function row(source, { rows = 100, first = '2026-02-02', last = daysBefore(CORPUS_LAST, 1), valued_pct = 90 } = {}) {
  return { source, rows, first, last, valued_pct, freetext_pct: 100, coords: false, capped: false };
}

export function coverage({ table, monthly = [], errors = [], n_sources, no_valuation } = {}) {
  const t = table || [
    row('Great Barrington, MA', { valued_pct: 0 }),
    row('Lenox, MA', { valued_pct: 80 }),
    row('Worcester, MA', { valued_pct: 0 }),
  ];
  return {
    corpus_first: CORPUS_FIRST,
    corpus_last: CORPUS_LAST,
    stats: {
      n_sources: n_sources ?? t.length,
      n_rows: t.reduce((a, r) => a + r.rows, 0),
      no_valuation: no_valuation ?? t.filter((r) => r.valued_pct === 0).length,
      monthly,
      errors,
      table: t,
    },
  };
}

export const DATA = {
  generated: CORPUS_LAST + 'T12:00:00Z',
  areas: [
    { key: 'all', label: 'Massachusetts', all: { count: 300 } },
    { key: 'capecod', label: 'Cape Cod & Islands', all: { count: 100 } },
    { key: 'boston', label: 'Greater Boston', all: { count: 100 } },
    { key: 'central', label: 'Central MA', all: { count: 50 } },
    { key: 'western', label: 'Western MA', all: { count: 50 } },
  ],
};

export function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

// A town page shaped like the built site: head, meta, LD, then body.
export function townPage({ town, h1, meta = 'Permit leads for this town.', ldObj, body = '<p>Nothing to see.</p>', dateModified = daysBefore(CORPUS_LAST, 1), note = false } = {}) {
  const dataset = ldObj || {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `Building Permits in ${town}, MA`,
    dateModified,
    spatialCoverage: { '@type': 'Place', name: 'Massachusetts' },
  };
  if (ldObj && dateModified && !ldObj.dateModified) dataset.dateModified = dateModified;
  return [
    '<!doctype html><html lang="en"><head>',
    '<meta charset="utf-8">',
    `<title>${town}, MA Building Permits | Example</title>`,
    `<meta name="description" content="${meta}">`,
    `<style>.x{color:red}</style>${ld(dataset)}`,
    '</head><body><div class="wrap">',
    `<h1>${h1 || `Building Permits in ${town}, MA`}</h1>`,
    note ? '<p id="mp-coverage-note">Coverage note. Data for this town is paused.</p>' : '',
    body,
    '<footer><p>Example footer.</p></footer>',
    '</div></body></html>',
    '',
  ].join('\n');
}

export function sitewidePage({ title = 'Example home', meta = 'Leads for contractors.', body = '<p>Welcome.</p>', extraHead = '' } = {}) {
  return [
    '<!doctype html><html lang="en"><head>',
    `<title>${title}</title>`,
    `<meta name="description" content="${meta}">`,
    extraHead,
    '</head><body>',
    body,
    '</body></html>',
    '',
  ].join('\n');
}

// Writes a site into a fresh temp dir. files: { relPath: content | object }.
export function makeSite({ cov = coverage(), data = DATA, files = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-site-'));
  const put = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  };
  if (cov !== null) put('research/evidence/coverage.json', cov);
  if (data !== null) put('data.json', data);
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  return root;
}

export function outDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gate-out-'));
}

export function cleanup(...dirs) {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}
