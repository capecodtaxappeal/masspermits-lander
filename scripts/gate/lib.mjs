// Public Output Gate: pure functions. Warn-only lint of the built public site,
// judged against the site's own published evidence (research/evidence/coverage.json
// and data.json). Nothing here writes to the linted tree or reaches the network.

export const STALE_DAYS = 14;
export const STALE_DAYS_MONTHLY = 45;
export const EXCERPT_MAX = 120;
export const ROWS_PER_CODE = 25;

export const REGION_SUFFIXES = {
  'cape-cod-islands': 'Cape Cod & Islands',
  'greater-boston': 'Greater Boston',
  'south-shore-south-coast': 'South Shore & South Coast',
  'metrowest-495': 'MetroWest & 495',
  'north-shore-merrimack': 'North Shore & Merrimack',
  'central-ma': 'Central MA',
  'western-ma': 'Western MA',
  massachusetts: null, // statewide
};

// Allowed region labels by county. The owner's call, kept in code on purpose.
export const COUNTY_LABELS = {
  Berkshire: ['Western MA'],
  Franklin: ['Western MA'],
  Hampshire: ['Western MA'],
  Hampden: ['Western MA'],
  Barnstable: ['Cape Cod & Islands'],
  Dukes: ['Cape Cod & Islands'],
  Nantucket: ['Cape Cod & Islands'],
  Suffolk: ['Greater Boston'],
  Worcester: ['Central MA', 'MetroWest & 495'],
  Middlesex: ['Greater Boston', 'MetroWest & 495', 'North Shore & Merrimack'],
  Essex: ['North Shore & Merrimack', 'Greater Boston'],
  Norfolk: ['Greater Boston', 'South Shore & South Coast', 'MetroWest & 495'],
  Plymouth: ['South Shore & South Coast', 'Greater Boston'],
  Bristol: ['South Shore & South Coast', 'MetroWest & 495'],
};

export const SITEWIDE_FILES = [
  'index.html',
  'offer.html',
  'offer/index.html',
  'llms.txt',
  'llms-full.txt',
  'permits/index.html',
  'news/index.html',
  'guides/building-permit-leads-massachusetts.html',
  'guides/massachusetts-building-permits-explained.html',
];

export const CODE_LEVEL = {
  'G1.no_value': 'WARN',
  'G1.low_value': 'WARN',
  'G1.no_source': 'WARN',
  'G1.sitewide': 'WARN',
  'G2.owner_name': 'WARN',
  'G3.contractor': 'UNJUDGED',
  'G4.region': 'WARN',
  'G4.unjudged': 'UNJUDGED',
  'G5.stale': 'WARN',
  'G5.no_source': 'WARN',
  'G5.fresh_count': 'WARN',
  'G6.monthly': 'WARN',
  'G6.no_source': 'WARN',
  'G6.unjudged': 'UNJUDGED',
  'G7.count': 'WARN',
  'G7.unjudged': 'UNJUDGED',
  'G0.ld_unparseable': 'INFO',
  'G0.unmapped': 'INFO',
};
export const CODE_ORDER = Object.keys(CODE_LEVEL);

// ---------------------------------------------------------------- helpers

const EM = '\u2014';
const EN = '\u2013';

export function slugify(name) {
  return String(name).toLowerCase().replace(/['.]/g, '').replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function titleFromSlug(slug) {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

export function daysBetween(a, b) {
  // whole days from date a to date b, both "YYYY-MM-DD" (or longer ISO strings)
  const da = Date.parse(String(a).slice(0, 10) + 'T00:00:00Z');
  const db = Date.parse(String(b).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round((db - da) / 86400000);
}

export function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

function blank(s) {
  return s.replace(/[^\n]/g, ' ');
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', mdash: EM, ndash: EN, rarr: '>', larr: '<', hellip: '.',
  middot: '.', rsaquo: '>', lsaquo: '<', copy: 'c', times: 'x',
};

function entityChar(ent) {
  const m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);$/i.exec(ent);
  if (!m) return null;
  const k = m[1];
  if (k[0] === '#') {
    const cp = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return null;
    const ch = String.fromCodePoint(cp);
    return ch.length === 1 ? ch : ' ';
  }
  const v = NAMED_ENTITIES[k.toLowerCase()];
  return v === undefined ? null : v;
}

// Same-length entity decode: "&amp;" becomes "&" plus four spaces, so every
// offset still maps to the same place in the original file.
export function decodeEntitiesPadded(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ent) => {
    const ch = entityChar(ent);
    return ch === null ? ent : ch + ' '.repeat(ent.length - 1);
  });
}

// Plain entity decode for attribute values.
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ent) => {
    const ch = entityChar(ent);
    return ch === null ? ent : ch;
  });
}

// MASK, DO NOT DELETE. Tables, comments, style, every script (LD is read
// separately) and every tag are replaced by spaces, newlines kept, so the
// masked text has the same length and line structure as the original.
export function mask(html) {
  let s = html;
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, blank);
  s = s.replace(/<table\b[\s\S]*?(<\/table\s*>|$)/gi, blank);
  s = s.replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, blank);
  s = s.replace(/<style\b[\s\S]*?(<\/style\s*>|$)/gi, blank);
  s = s.replace(/<(svg)\b[\s\S]*?(<\/svg\s*>|$)/gi, blank);
  s = s.replace(/<head\b[\s\S]*?(<\/head\s*>|$)/gi, blank);
  s = s.replace(/<[^>]*>?/g, blank);
  return decodeEntitiesPadded(s);
}

function attr(tag, name) {
  const re = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const m = re.exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? '';
}

// Every text surface of one HTML page: title, meta, og, twitter, each LD
// string (with JSON path), and the masked visible text.
export function extractSurfaces(html) {
  const lineOf = lineIndex(html);
  const surfaces = [];
  const ld = [];
  const ldErrors = [];
  const headEnd = (() => {
    const i = html.search(/<\/head\s*>/i);
    return i < 0 ? html.length : i;
  })();
  const head = html.slice(0, headEnd);

  const t = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head.replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, blank));
  if (t) surfaces.push({ surface: 'title', line: lineOf(t.index), text: decodeEntities(t[1]) });

  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(head))) {
    const tag = m[0];
    const name = (attr(tag, 'name') || attr(tag, 'property') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (content === null) continue;
    let surface = null;
    if (name === 'description') surface = 'meta';
    else if (name === 'og:title' || name === 'og:description') surface = 'og';
    else if (name === 'twitter:description' || name === 'twitter:title') surface = 'twitter';
    if (surface) surfaces.push({ surface, key: name, line: lineOf(m.index), text: decodeEntities(content) });
  }

  const ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  while ((m = ldRe.exec(html))) {
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const raw = m[1];
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      ldErrors.push({ line: lineOf(m.index) });
      continue;
    }
    ld.push({ line: lineOf(m.index), obj });
    walkStrings(obj, '$', (path, str) => {
      let line = lineOf(m.index);
      const probe = JSON.stringify(str).slice(1, -1).slice(0, 40);
      if (probe) {
        const at = raw.indexOf(probe);
        if (at >= 0) line = lineOf(bodyStart + at);
      }
      surfaces.push({ surface: 'ld:' + path, line, text: str, ldPath: path });
    });
  }

  const masked = mask(html);
  surfaces.push({ surface: 'text', line: 1, text: masked, masked: true, lineOf });

  let newestModified = null;
  for (const b of ld) {
    walkKeys(b.obj, (k, v) => {
      if (k === 'dateModified' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        const d = v.slice(0, 10);
        if (!newestModified || d > newestModified) newestModified = d;
      }
    });
  }

  const h1m = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html);
  const h1 = h1m ? decodeEntities(h1m[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim() : null;

  return {
    surfaces,
    ld,
    ldErrors,
    newestModified,
    h1,
    coverageNote: /\bid\s*=\s*["']?mp-coverage-note\b/i.test(html),
    noteRanges: coverageNoteRanges(html),
    lineOf,
  };
}

// Offsets [start, end) of the elements with id="mp-coverage-note" or
// id="mp-live-routes": the site's own paused-coverage disclosure and the
// "towns still reporting" card after it. The towns and cadence they name are
// other towns, not claims about this page's town or region.
export function coverageNoteRanges(html) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*["']?mp-(?:coverage-note|live-routes)\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    const tokRe = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    tokRe.lastIndex = m.index + m[0].length;
    let depth = 1;
    let end = html.length;
    let t;
    while ((t = tokRe.exec(html))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index + t[0].length; break; }
    }
    out.push([m.index, end]);
  }
  return out;
}

function inRanges(ranges, i) {
  return (ranges || []).some(([a, b]) => i >= a && i < b);
}

export function walkStrings(v, path, fn) {
  if (typeof v === 'string') fn(path, v);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, `${path}[${i}]`, fn));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) walkStrings(v[k], /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`, fn);
  }
}

function walkKeys(v, fn) {
  if (Array.isArray(v)) v.forEach((x) => walkKeys(x, fn));
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      fn(k, v[k]);
      walkKeys(v[k], fn);
    }
  }
}

// Text-file surfaces (llms.txt): every line.
export function extractTextSurfaces(text) {
  return {
    surfaces: [{ surface: 'text', line: 1, text, masked: true, lineOf: lineIndex(text) }],
    ld: [],
    ldErrors: [],
    newestModified: null,
    h1: null,
    coverageNote: false,
    noteRanges: [],
  };
}

// The sentence around a match, whitespace collapsed, at most EXCERPT_MAX chars,
// dashes normalised, and withheld if it looks like it carries an address or id.
export function excerptAt(text, index, length) {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '\n' || ((c === '.' || c === '!' || c === '?') && /\s/.test(text[i + 1] || ''))) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index + length; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') { end = i; break; }
    if ((c === '.' || c === '!' || c === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1]))) { end = i + 1; break; }
  }
  let before = text.slice(start, index).replace(/\s+/g, ' ').trimStart();
  const hit = text.slice(index, index + length).replace(/\s+/g, ' ');
  let after = text.slice(index + length, end).replace(/\s+/g, ' ').trimEnd();
  let out = before + hit + after;
  if (out.length > EXCERPT_MAX) {
    const room = Math.max(0, EXCERPT_MAX - hit.length - 6);
    const b = Math.min(before.length, Math.ceil(room / 2));
    const a = Math.min(after.length, room - b);
    const b2 = Math.min(before.length, room - a);
    before = before.length > b2 ? '...' + before.slice(before.length - b2) : before;
    after = after.length > a ? after.slice(0, a) + '...' : after;
    out = (before + hit + after).slice(0, EXCERPT_MAX);
  }
  return cleanExcerpt(out);
}

// A house number followed by a street suffix: never quote it, even when the
// match is a false alarm.
const RE_ADDRESS_LIKE = /\b\d+[A-Za-z]?\s+(?:[A-Z][\w'.-]*\s+){1,3}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Circle|Cir|Court|Ct|Place|Pl|Terrace|Ter|Boulevard|Blvd|Highway|Hwy|Parkway|Pkwy)\b/;

export function cleanExcerpt(s) {
  let out = String(s).split(EM).join('-').split(EN).join('-').replace(/\s+/g, ' ').trim();
  if (/@/.test(out) || /[0-9a-f]{32}/i.test(out) || /cus_/i.test(out) || RE_ADDRESS_LIKE.test(out)) return '[excerpt withheld]';
  out = out.replace(/\|/g, '/').replace(/`/g, "'");
  return out;
}

// ---------------------------------------------------------------- evidence

export function loadEvidence(coverage, data, aliasesDoc, countyDoc) {
  const stats = coverage.stats;
  const bySource = new Map();
  for (const r of stats.table) bySource.set(r.source, r);
  const monthly = new Set(stats.monthly || []);
  const errors = new Set(stats.errors || []);
  const labels = (data.areas || []).map((a) => a.label).filter((l) => typeof l === 'string' && l !== 'Massachusetts');
  const aliases = new Map();
  for (const a of (aliasesDoc && aliasesDoc.aliases) || []) aliases.set(a.name.toLowerCase(), a.source);
  const county = new Map();
  for (const r of (countyDoc && countyDoc.towns) || []) county.set(r.town.toLowerCase(), r.county);

  // Known place names: sources, errors, aliases, county rows.
  const names = new Map(); // slug -> display name
  const addName = (n) => { if (n) names.set(slugify(n), n); };
  for (const s of bySource.keys()) addName(s.replace(/, MA$/, ''));
  for (const s of errors) addName(s.replace(/, MA$/, ''));
  for (const a of (aliasesDoc && aliasesDoc.aliases) || []) addName(a.name);
  for (const r of (countyDoc && countyDoc.towns) || []) addName(r.town);

  return {
    corpusFirst: coverage.corpus_first,
    corpusLast: coverage.corpus_last,
    nSources: stats.n_sources,
    noValuation: stats.no_valuation,
    monthly,
    errors,
    bySource,
    labels,
    aliases,
    county,
    names,
    corpusRows: stats.n_rows ?? coverage.corpus_rows ?? null,
  };
}

// Town name -> { town, source, row, status } where status is
// "source" | "errors" | "no_source".
export function resolveSource(ev, town) {
  if (!town) return null;
  const direct = `${town}, MA`;
  let source = null;
  if (ev.bySource.has(direct) || ev.errors.has(direct)) source = direct;
  else {
    for (const k of [...ev.bySource.keys(), ...ev.errors]) if (k.toLowerCase() === direct.toLowerCase()) source = k;
    if (!source && ev.aliases.has(town.toLowerCase())) source = ev.aliases.get(town.toLowerCase());
  }
  if (!source) return { town, source: null, row: null, status: 'no_source' };
  if (ev.errors.has(source) || !ev.bySource.has(source)) return { town, source, row: null, status: 'errors' };
  return { town, source, row: ev.bySource.get(source), status: 'source' };
}

export function longestSlugPrefix(slug, knownSlugs) {
  let best = null;
  for (const k of knownSlugs) {
    if ((slug === k || slug.startsWith(k + '-')) && (!best || k.length > best.length)) best = k;
  }
  return best;
}

// Town for a page. rel is the posix path relative to the root.
export function resolveTown(rel, h1, ev, knownSlugs) {
  const nameFor = (slug) => ev.names.get(slug) || titleFromSlug(slug);
  let m;
  if ((m = /^guides\/(.+)-building-permits\.html$/.exec(rel))) return nameFor(m[1]);
  if ((m = /^news\/([^/]+)\/[^/]+\.html$/.exec(rel))) return nameFor(m[1]);
  if (/^permits\/[^/]+\.html$/.test(rel)) {
    if (h1) {
      const hm = /^(.*?),\s*MA\b/.exec(h1);
      if (hm) {
        const pre = hm[1].trim();
        let best = null;
        for (const n of ev.names.values()) {
          const low = pre.toLowerCase();
          const nl = n.toLowerCase();
          if ((low === nl || low.endsWith(' ' + nl)) && (!best || n.length > best.length)) best = n;
        }
        if (best) return best;
        const cm = /([A-Z][\w.'-]*(?:\s+(?:[A-Z][\w.'-]*|by|the|of))*)$/.exec(pre);
        if (cm) {
          // drop leading category words that are capitalised in headings
          const words = cm[1].split(/\s+/);
          const fileSlug = rel.slice('permits/'.length, -'.html'.length);
          for (let i = 0; i < words.length; i++) {
            const cand = words.slice(i).join(' ');
            const s = slugify(cand);
            if (fileSlug === s || fileSlug.startsWith(s + '-')) return ev.names.get(s) || cand;
          }
        }
      }
    }
    const slug = rel.slice('permits/'.length, -'.html'.length);
    const k = longestSlugPrefix(slug, knownSlugs);
    if (k) return nameFor(k);
  }
  return null;
}

export function pageState(info, ev, staleDays) {
  if (info.coverageNote) return 'frozen';
  if (info.newestModified) {
    const d = daysBetween(info.newestModified, ev.corpusLast);
    if (d !== null && d > staleDays) return 'frozen';
  }
  return 'generated';
}

// ---------------------------------------------------------------- rules

const RE_G1 = /\b(?:declared|project|job)\s+(?:project\s+)?values?\b|\bvalue\s+of\s+each\s+job\b/gi;

const FIELD = String.raw`(?:(?:the|a|an|their|its)\s+)?(?:(?:exact|full|property|street|mailing)\s+)?(?:address(?:es)?|project\s+types?|(?:declared\s+|project\s+|job\s+)?(?:project\s+)?values?|contractor(?!s|\s+(?:leads?|guides?)\b)|permit[\s-]+holders?|(?:home)?owners?(?:'s?)?(?:\s+names?)?|names?|issue\s+dates?)`;
const SEP = String.raw`\s*(?:,\s*(?:and\s+|&\s+)?|\s(?:and|&)\s|&)\s*`;
const RE_LIST = new RegExp(String.raw`\b${FIELD}(?:${SEP}${FIELD})+`, 'gi');
const RE_OWNER_NAME = /\b(?:home)?owner(?:'s|s'|s)?\s+names?\b/gi;
const RE_CONTRACTOR_PHRASE = /\b(?:the\s+contractor\s+on\s+file|contractor\s+(?:details?|names?|info(?:rmation)?|contact)|permit[\s-]+holder\s+(?:details?|names?))\b/gi;
const RE_NEGATED = /\b(?:withheld|never\s+shipped|not\s+(?:included|shipped|published)|omitted|removed|masked|redacted)\b/i;

const RE_G5 = /\b\d[\d,]*\+?\s+(?:most\s+)?recent\b|\blive\s+preview\b|\bmost\s+recent\s+permits\b|\blatest\s+permits\b|\bthis\s+week\b/gi;
const RE_G6 = /\b(?:every\s+week|each\s+week|weekly|every\s+monday|daily|updating)\b/gi;
const RE_G6_PRODUCT = /^weekly\s+(?:feed|(?:data\s+)?briefs?|digest|roundup|activity\s+report)\b/i;
const RE_G6_NEGATED = /\b(?:not|never|no\s+longer|stopped)\s+$/i;

const RE_G7 = /\b(\d[\d,]*)\s+(?:massachusetts\s+towns\b(?!\s+and\s+neighbou?rhoods)|municipal\s+permit\s+sources\b|municipal\s+sources\b|sources\b)/gi;
const RE_G7_UNJ = /\b(\d[\d,]*)\+?\s+towns\s+and\s+neighbou?rhoods\b/gi;

function* matches(re, text) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    yield m;
  }
}

function surfaceLine(s, index) {
  return s.masked ? s.lineOf(index) : s.line;
}

function sentenceAround(text, index, length) {
  let start = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '\n' || ((c === '.' || c === '!' || c === '?') && /\s/.test(text[i + 1] || ''))) { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = index + length; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' || ((c === '.' || c === '!' || c === '?') && /\s/.test(text[i + 1] || ''))) { end = i; break; }
  }
  return text.slice(start, end);
}

// Lead-field lists and single-phrase field promises, shared by G2 and G3.
export function fieldHits(text) {
  const out = [];
  for (const m of matches(RE_LIST, text)) {
    const items = m[0].split(new RegExp(SEP, 'i')).map((x) => x.trim().toLowerCase());
    const owner = items.some((x) => /^(?:(?:the|a|an|their|its)\s+)?(?:home)?owners?(?:'s?)?(?:\s+names?)?$|^(?:(?:the|a|an|their|its)\s+)?names?$/.test(x));
    const contractor = items.some((x) => /contractor|permit[\s-]+holder/.test(x));
    const other = items.filter((x) => !/owner|^(?:(?:the|a|an|their|its)\s+)?names?$/.test(x)).length;
    if (other === 0) continue; // "owner and name" alone is not a field list
    const neg = RE_NEGATED.test(sentenceAround(text, m.index, m[0].length));
    if (neg) continue;
    if (owner) out.push({ kind: 'owner', index: m.index, length: m[0].length });
    if (contractor) out.push({ kind: 'contractor', index: m.index, length: m[0].length });
  }
  for (const m of matches(RE_OWNER_NAME, text)) {
    if (RE_NEGATED.test(sentenceAround(text, m.index, m[0].length))) continue;
    if (out.some((h) => h.kind === 'owner' && m.index >= h.index && m.index < h.index + h.length)) continue;
    out.push({ kind: 'owner', index: m.index, length: m[0].length });
  }
  for (const m of matches(RE_CONTRACTOR_PHRASE, text)) {
    if (RE_NEGATED.test(sentenceAround(text, m.index, m[0].length))) continue;
    if (out.some((h) => h.kind === 'contractor' && m.index >= h.index && m.index < h.index + h.length)) continue;
    out.push({ kind: 'contractor', index: m.index, length: m[0].length });
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelRe(label) {
  return label.split(/\s+/).map(escapeRe).join('\\s+');
}

function countyAllowed(ev, town) {
  if (!town) return { county: null, allowed: null };
  const county = ev.county.get(town.toLowerCase()) || null;
  if (!county) return { county: null, allowed: null };
  return { county, allowed: COUNTY_LABELS[county] || null };
}

function g4Judge(ev, town, label) {
  const { county, allowed } = countyAllowed(ev, town);
  if (!county || !allowed) {
    return { code: 'G4.unjudged', evidence: town ? `${town} not in town-county.json` : 'town unknown' };
  }
  if (allowed.includes(label)) return null;
  return { code: 'G4.region', evidence: `town-county.json ${town}: ${county}; allowed ${allowed.join(', ')}` };
}

function limitFor(ev, source) {
  return ev.monthly.has(source) ? STALE_DAYS_MONTHLY : null;
}

// Lint one page. ctx: { rel, kind: 'town'|'sitewide'|'region', info, town,
// res (resolveSource), regionLabel, rawHtml, knownSlugs, staleDays }
export function lintPage(ctx, ev) {
  const { rel, kind, info, town, res } = ctx;
  const staleDays = ctx.staleDays ?? STALE_DAYS;
  const state = pageState(info, ev, staleDays);
  const findings = [];
  const add = (code, s, index, length, evidence, extra = {}) => {
    const excerpt = extra.excerpt ?? (s ? excerptAt(s.text, index, length) : '');
    findings.push({
      code,
      level: CODE_LEVEL[code],
      page: rel,
      line: extra.line ?? (s ? surfaceLine(s, index) : 1),
      surface: s ? s.surface : (extra.surface || 'text'),
      town: town || '',
      state,
      evidence,
      excerpt: cleanExcerpt(excerpt),
    });
  };

  const townScoped = kind === 'town';
  const src = res && res.source;
  const row = res && res.row;

  // Region page context for G1 and G4.
  let linked = null;
  if (kind === 'region' && ctx.rawHtml) {
    linked = new Map(); // town -> { line, slug }
    const linkRe = /href\s*=\s*["'](?:https?:\/\/[^"'/]+)?\/permits\/([a-z0-9-]+)(?:\.html)?\/?["'#?]/gi;
    const lineOf = info.lineOf;
    for (const m of matches(linkRe, ctx.rawHtml)) {
      if (inRanges(info.noteRanges, m.index)) continue;
      const slug = m[1].toLowerCase();
      const k = longestSlugPrefix(slug, ctx.knownSlugs);
      const tname = k ? ev.names.get(k) || titleFromSlug(k) : null;
      const key = tname || slug;
      if (!linked.has(key)) linked.set(key, { line: lineOf(m.index), slug, town: tname });
    }
  }

  let g1Sitewide = null;
  if (!townScoped) {
    g1Sitewide = `coverage.json: ${ev.noValuation} of ${ev.nSources} sources publish no value`;
    if (linked) {
      let withSource = 0;
      let zero = 0;
      for (const v of linked.values()) {
        const r = v.town ? resolveSource(ev, v.town) : null;
        if (r && r.row) {
          withSource++;
          if (Number(r.row.valued_pct) === 0) zero++;
        }
      }
      g1Sitewide += `; ${zero} of the ${withSource} linked towns with a source have valued_pct 0`;
    }
  }

  for (const s of info.surfaces) {
    const text = s.text;

    // G1
    for (const m of matches(RE_G1, text)) {
      if (townScoped) {
        if (!row) add('G1.no_source', s, m.index, m[0].length, res && res.status === 'errors' ? `coverage.json errors lists ${src}` : 'no source in coverage.json');
        else {
          const v = Number(row.valued_pct);
          if (v === 0) add('G1.no_value', s, m.index, m[0].length, `coverage.json valued_pct ${row.valued_pct.toFixed ? row.valued_pct.toFixed(1) : row.valued_pct}`);
          else if (v > 0 && v < 50) add('G1.low_value', s, m.index, m[0].length, `coverage.json valued_pct ${v}`);
        }
      } else {
        add('G1.sitewide', s, m.index, m[0].length, g1Sitewide);
      }
    }

    // G2 and G3
    for (const h of fieldHits(text)) {
      if (h.kind === 'owner') add('G2.owner_name', s, h.index, h.length, 'index.html:24-25 and catalog.json rights: owner names are never shipped');
      else add('G3.contractor', s, h.index, h.length, 'coverage.json has no contractor field');
    }

    // G4 (town-scoped: LD spatialCoverage, LD keywords, visible "<Town>, <Region>")
    if (townScoped && town) {
      if (s.ldPath && /\.spatialCoverage(?:\.name)?$/.test(s.ldPath)) {
        const mm = /^(.*?),\s*Massachusetts$/.exec(text.trim());
        const label = mm ? mm[1] : text.trim();
        if (ev.labels.includes(label)) {
          const j = g4Judge(ev, town, label);
          if (j) add(j.code, s, 0, text.length, j.evidence);
        }
      } else if (s.ldPath && /\.keywords(?:\[\d+\])?$/.test(s.ldPath) && ev.labels.includes(text.trim())) {
        const j = g4Judge(ev, town, text.trim());
        if (j) add(j.code, s, 0, text.length, j.evidence);
      } else {
        for (const label of ev.labels) {
          const re = new RegExp(`\\b${labelRe(town)},\\s+${labelRe(label)}`, 'g');
          for (const m of matches(re, text)) {
            const j = g4Judge(ev, town, label);
            if (j) add(j.code, s, m.index, m[0].length, j.evidence);
          }
        }
      }
    }

    // G5 (town-scoped phrases)
    if (townScoped) {
      for (const m of matches(RE_G5, text)) {
        if (!row) {
          add('G5.no_source', s, m.index, m[0].length,
            (res && res.status === 'errors' ? `coverage.json errors lists ${src}` : 'no source in coverage.json') + (info.coverageNote ? '; paused note present' : ''));
          continue;
        }
        let newest = row.last;
        if (info.newestModified && info.newestModified > newest) newest = info.newestModified;
        const age = daysBetween(newest, ev.corpusLast);
        const limit = limitFor(ev, src) ?? staleDays;
        if (age !== null && age > limit) {
          add('G5.stale', s, m.index, m[0].length, `newest ${newest} is ${age} days before corpus_last ${ev.corpusLast} (limit ${limit}${ev.monthly.has(src) ? ', monthly' : ''})`);
        }
      }
    }

    // G6
    for (const m of matches(RE_G6, text)) {
      if (RE_G6_PRODUCT.test(text.slice(m.index, m.index + 40))) continue;
      if (RE_G6_NEGATED.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
      if (s.masked && inRanges(info.noteRanges, m.index)) continue;
      if (townScoped) {
        if (!row) add('G6.no_source', s, m.index, m[0].length, res && res.status === 'errors' ? `coverage.json errors lists ${src}` : 'no source in coverage.json');
        else if (ev.monthly.has(src)) add('G6.monthly', s, m.index, m[0].length, `coverage.json monthly lists ${src}; research/coverage.html: most recent weeks always behind`);
      } else {
        add('G6.unjudged', s, m.index, m[0].length, 'sitewide cadence; send log is private');
      }
    }

    // G7 (sitewide counts)
    if (!townScoped) {
      for (const m of matches(RE_G7, text)) {
        const n = Number(m[1].replace(/,/g, ''));
        if (n !== ev.nSources) add('G7.count', s, m.index, m[0].length, `says ${n}; coverage.json n_sources ${ev.nSources}`);
      }
      for (const m of matches(RE_G7_UNJ, text)) {
        add('G7.unjudged', s, m.index, m[0].length, `towns and neighbourhoods count; coverage.json n_sources ${ev.nSources}`);
      }
    }
  }

  // G4 on region pages: each linked town against the page's region.
  if (kind === 'region' && ctx.regionLabel && linked) {
    for (const [key, v] of linked) {
      const j = g4Judge(ev, v.town, ctx.regionLabel);
      if (!j) continue;
      findings.push({
        code: j.code,
        level: CODE_LEVEL[j.code],
        page: rel,
        line: v.line,
        surface: 'link',
        town: v.town || key,
        state,
        evidence: v.town ? `${j.evidence}; page region ${ctx.regionLabel}` : `linked slug ${v.slug} has no known town`,
        excerpt: cleanExcerpt(`/permits/${v.slug} on a ${ctx.regionLabel} page`),
      });
    }
  }

  // G5 sitewide: the homepage live-count template.
  if (rel === 'index.html' && ctx.rawHtml) {
    const tm = /fresh\s[^`'"\n]{0,80}permits\s+available/i.exec(ctx.rawHtml);
    if (tm) {
      const span = daysBetween(ev.corpusFirst, ev.corpusLast);
      if (span !== null && span > staleDays) {
        let staleRows = 0;
        let total = 0;
        for (const [source, r] of ev.bySource) {
          total += Number(r.rows) || 0;
          const lim = limitFor(ev, source) ?? staleDays;
          const age = daysBetween(r.last, ev.corpusLast);
          if (age !== null && age > lim) staleRows += Number(r.rows) || 0;
        }
        const share = total ? ((100 * staleRows) / total).toFixed(1) : '0.0';
        findings.push({
          code: 'G5.fresh_count',
          level: 'WARN',
          page: rel,
          line: info.lineOf(tm.index),
          surface: 'script',
          town: '',
          state,
          evidence: `data.json count spans corpus_first ${ev.corpusFirst} to corpus_last ${ev.corpusLast} (${span} days); ${share}% of corpus rows come from sources whose last is stale`,
          excerpt: 'live-count template renders the data.json count as fresh permits available',
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------- report

function mdCell(s) {
  return cleanExcerpt(String(s ?? '')).replace(/\[excerpt withheld\]/, '[withheld]') || ' ';
}

export function summarize(findings) {
  const by = new Map();
  for (const f of findings) {
    if (!by.has(f.code)) by.set(f.code, { pages: new Set(), n: 0, frozen: 0, generated: 0 });
    const e = by.get(f.code);
    e.pages.add(f.page);
    e.n++;
    if (f.state === 'frozen') e.frozen++; else e.generated++;
  }
  return by;
}

export function renderStdout(findings) {
  const by = summarize(findings);
  const lines = ['gate: warn-only; counts per code (code level pages occurrences)'];
  for (const code of CODE_ORDER) {
    const e = by.get(code);
    if (!e) continue;
    lines.push(`${code} ${CODE_LEVEL[code]} ${e.pages.size} ${e.n}`);
  }
  lines.push(`total ${findings.length}`);
  return lines.join('\n') + '\n';
}

export function renderReport({ sha, ev, staleDays, findings, pagesLinted, unmapped }) {
  const out = [];
  const by = summarize(findings);
  out.push('# Public Output Gate report');
  out.push('');
  // Short sha: a full 40-hex sha would itself trip the report's 32-hex leak rule.
  out.push(`Checkout: ${sha && sha !== 'unknown' ? sha.slice(0, 12) : 'unknown'}`);
  out.push('');
  out.push(`Evidence: corpus_last ${ev.corpusLast}, n_sources ${ev.nSources}, no_valuation ${ev.noValuation}, monthly ${ev.monthly.size}, errors ${ev.errors.size}, STALE_DAYS ${staleDays}, STALE_DAYS_MONTHLY ${STALE_DAYS_MONTHLY}.`);
  out.push('');
  out.push(`Pages linted: ${pagesLinted}.`);
  out.push('');
  out.push('Warn-only. Nothing here blocks a build.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Code | WARN or UNJUDGED | Pages | Occurrences | Frozen | Generated |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const code of CODE_ORDER) {
    const e = by.get(code);
    if (!e) continue;
    out.push(`| ${code} | ${CODE_LEVEL[code]} | ${e.pages.size} | ${e.n} | ${e.frozen} | ${e.generated} |`);
  }
  out.push('');
  for (const code of CODE_ORDER) {
    const list = findings.filter((f) => f.code === code);
    if (!list.length) continue;
    out.push(`## ${code} (${CODE_LEVEL[code]})`);
    out.push('');
    out.push('| Page | Line | Surface | Town | Evidence | Excerpt |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (const f of list.slice(0, ROWS_PER_CODE)) {
      out.push(`| ${mdCell(f.page)} | ${f.line} | ${mdCell(f.surface)} | ${mdCell(f.town)} | ${mdCell(f.evidence)} | ${mdCell(f.excerpt)} |`);
    }
    if (list.length > ROWS_PER_CODE) out.push(`\nand ${list.length - ROWS_PER_CODE} more`);
    out.push('');
  }
  out.push('## Unjudged, for the owner');
  out.push('');
  for (const code of ['G3.contractor', 'G4.unjudged', 'G6.unjudged', 'G7.unjudged']) {
    const e = by.get(code);
    out.push(`- ${code}: ${e ? e.n : 0} occurrences on ${e ? e.pages.size : 0} pages`);
  }
  out.push('');
  out.push('## Unmapped pages');
  out.push('');
  out.push(`- Pages with no resolvable town (G0.unmapped): ${unmapped}`);
  const ldBad = by.get('G0.ld_unparseable');
  out.push(`- Unparseable JSON-LD blocks (G0.ld_unparseable): ${ldBad ? ldBad.n : 0}`);
  out.push('');
  return out.join('\n');
}
