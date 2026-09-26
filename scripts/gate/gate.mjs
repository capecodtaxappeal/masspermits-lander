#!/usr/bin/env node
// Public Output Gate CLI. Warn-only and read-only: it lints the built public
// site under --root against the site's own evidence files and writes a report
// OUTSIDE --root. It exits 0 whenever it ran, findings or not.
//
//   node scripts/gate/gate.mjs --root <checkout> --out <report.md> [--json <findings.json>] [--stale-days N]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STALE_DAYS,
  REGION_SUFFIXES,
  SITEWIDE_FILES,
  CODE_LEVEL,
  loadEvidence,
  resolveSource,
  resolveTown,
  extractSurfaces,
  extractTextSurfaces,
  lintPage,
  pageState,
  renderReport,
  renderStdout,
  slugify,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COVERAGE_REL = 'research/evidence/coverage.json';
const DATA_REL = 'data.json';

class GateExit extends Error {
  constructor(code, line) {
    super(line);
    this.exitCode = code;
    this.line = line;
  }
}

function parseArgs(argv) {
  const a = { root: null, out: null, json: null, staleDays: STALE_DAYS };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--root') { a.root = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--json') { a.json = v; i++; }
    else if (k === '--stale-days') { a.staleDays = Number(v); i++; }
    else throw new GateExit(2, `gate: unknown argument ${String(k).replace(/[^\w.-]/g, '')}`);
  }
  if (!a.root || !a.out) throw new GateExit(2, 'gate: usage: --root <dir> --out <report.md> [--json <file>] [--stale-days N]');
  if (!Number.isInteger(a.staleDays) || a.staleDays < 0) throw new GateExit(2, 'gate: --stale-days must be a whole number');
  return a;
}

function realish(p) {
  // realpath of the deepest existing ancestor, with the rest appended
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  let base = cur;
  try { base = fs.realpathSync(cur); } catch { /* keep resolved */ }
  return path.join(base, ...rest);
}

function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function readJson(root, rel) {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    throw new GateExit(2, `gate: evidence unreadable: ${rel}`);
  }
  return obj;
}

function readLocalJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));
  } catch {
    return null;
  }
}

function readSha(root) {
  try {
    const gitDir = path.join(root, '.git');
    if (!fs.statSync(gitDir).isDirectory()) return 'unknown';
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(head)) return head;
    const m = /^ref:\s*(\S+)$/.exec(head);
    if (!m) return 'unknown';
    const refFile = path.join(gitDir, m[1]);
    if (fs.existsSync(refFile)) {
      const v = fs.readFileSync(refFile, 'utf8').trim();
      if (/^[0-9a-f]{40}$/.test(v)) return v;
    }
    const packed = path.join(gitDir, 'packed-refs');
    if (fs.existsSync(packed)) {
      for (const line of fs.readFileSync(packed, 'utf8').split('\n')) {
        const [sha, ref] = line.trim().split(/\s+/);
        if (ref === m[1] && /^[0-9a-f]{40}$/.test(sha)) return sha;
      }
    }
  } catch { /* fall through */ }
  return 'unknown';
}

function listHtml(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.html')).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

// Which files to lint, and how.
export function collectPages(root) {
  const pages = [];
  const seen = new Set();
  const push = (rel, kind, extra = {}) => {
    if (seen.has(rel)) return;
    if (!fs.existsSync(path.join(root, rel))) return;
    seen.add(rel);
    pages.push({ rel, kind, ...extra });
  };
  for (const rel of SITEWIDE_FILES) push(rel, 'sitewide');
  for (const f of listHtml(path.join(root, 'permits'))) push(`permits/${f}`, 'town');
  for (const f of listHtml(path.join(root, 'guides'))) {
    if (/-building-permits\.html$/.test(f)) push(`guides/${f}`, 'town');
  }
  for (const d of listDirs(path.join(root, 'news'))) {
    for (const f of listHtml(path.join(root, 'news', d))) push(`news/${d}/${f}`, 'town');
  }
  for (const f of listHtml(root)) {
    const m = /^[a-z0-9-]+-leads-([a-z0-9-]+)\.html$/.exec(f);
    if (!m) continue;
    const suffix = Object.keys(REGION_SUFFIXES).find((s) => m[1] === s);
    if (!suffix) continue;
    const label = REGION_SUFFIXES[suffix];
    if (label) push(f, 'region', { regionLabel: label });
    else push(f, 'sitewide');
  }
  return pages;
}

export function run(argv) {
  let stdout = '';
  try {
    const a = parseArgs(argv);
    const root = realish(a.root);
    for (const o of [a.out, a.json]) {
      if (o && inside(realish(o), root)) throw new GateExit(2, 'gate: --out inside --root refused');
    }

    const coverage = readJson(root, COVERAGE_REL);
    if (!coverage || typeof coverage !== 'object' || !coverage.stats || !Array.isArray(coverage.stats.table)) {
      throw new GateExit(2, `gate: evidence unreadable: ${COVERAGE_REL}`);
    }
    const data = readJson(root, DATA_REL);
    if (!data || typeof data !== 'object' || !Array.isArray(data.areas)) {
      throw new GateExit(2, `gate: evidence unreadable: ${DATA_REL}`);
    }

    const ev = loadEvidence(coverage, data, readLocalJson('aliases.json'), readLocalJson('town-county.json'));
    const pages = collectPages(root);

    const knownSlugs = new Set(ev.names.keys());
    for (const f of listHtml(path.join(root, 'guides'))) {
      const m = /^(.+)-building-permits\.html$/.exec(f);
      if (m) knownSlugs.add(m[1]);
    }
    for (const d of listDirs(path.join(root, 'news'))) knownSlugs.add(d);

    const findings = [];
    let unmapped = 0;
    for (const p of pages) {
      const raw = fs.readFileSync(path.join(root, p.rel), 'utf8');
      const info = p.rel.endsWith('.txt') ? extractTextSurfaces(raw) : extractSurfaces(raw);
      let town = null;
      let res = null;
      if (p.kind === 'town') {
        town = resolveTown(p.rel, info.h1, ev, knownSlugs);
        if (town) knownSlugs.add(slugify(town));
        res = town ? resolveSource(ev, town) : null;
      }
      const state = pageState(info, ev, a.staleDays);
      for (const bad of info.ldErrors) {
        findings.push({ code: 'G0.ld_unparseable', level: CODE_LEVEL['G0.ld_unparseable'], page: p.rel, line: bad.line, surface: 'ld', town: town || '', state, evidence: 'JSON.parse failed', excerpt: '' });
      }
      if (p.kind === 'town' && !town) {
        unmapped++;
        findings.push({ code: 'G0.unmapped', level: CODE_LEVEL['G0.unmapped'], page: p.rel, line: 1, surface: 'page', town: '', state, evidence: 'no town from h1 or file name', excerpt: '' });
        continue;
      }
      findings.push(...lintPage({ rel: p.rel, kind: p.kind, info, town, res, regionLabel: p.regionLabel, rawHtml: raw, knownSlugs, staleDays: a.staleDays }, ev));
    }

    const report = renderReport({ sha: readSha(root), ev, staleDays: a.staleDays, findings, pagesLinted: pages.length, unmapped });
    fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
    fs.writeFileSync(path.resolve(a.out), report);
    if (a.json) {
      fs.mkdirSync(path.dirname(path.resolve(a.json)), { recursive: true });
      fs.writeFileSync(path.resolve(a.json), JSON.stringify({ evidence: { corpus_last: ev.corpusLast, n_sources: ev.nSources, no_valuation: ev.noValuation, stale_days: a.staleDays }, findings }, null, 1) + '\n');
    }
    stdout = renderStdout(findings);
    return { code: 0, stdout, stderr: '', findings };
  } catch (e) {
    if (e instanceof GateExit) return { code: e.exitCode, stdout, stderr: e.line + '\n', findings: [] };
    return { code: 2, stdout, stderr: 'gate: internal error\n', findings: [] };
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  const r = run(process.argv.slice(2));
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
