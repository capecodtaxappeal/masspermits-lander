// MassPermits monday rehearsal: C22, the DNS baseline (Node built-ins only).
//
//   node scripts/rehearsal/c22.mjs > "$RUNNER_TEMP/c22.json"
//
// Compares four mail records (DMARC, SPF, DKIM, MX) with the owner's baseline
// in docs/rehearsal/dns-baseline.json (read from the checkout of main) and
// prints ONE line of JSON, an enum per record and nothing else:
//   {"c22":{"dmarc":"same","spf":"same","dkim":"changed","mx":"same"}}
//   same     the live record set equals the baseline (after normalising)
//   changed  it differs
//   missing  the baseline has a value and DNS has no such record
//   unset    the baseline still holds PLACEHOLDER for this record
//   error    the lookup failed, or the baseline entry is malformed
// No record value is ever printed. This is not HTTP: the lookups are DNS
// queries through the runner's own resolver, one TXT or MX query per record,
// only for names under the baseline's domain (masspermits.com). The resolver
// is injected, so the tests make no DNS query at all.

import { readFileSync } from "node:fs";
import { promises as dnsp } from "node:dns";
import { join, resolve as resolvePath, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BASELINE_PATH = "docs/rehearsal/dns-baseline.json";
export const RECORDS = ["dmarc", "spf", "dkim", "mx"];
const DOMAIN = "masspermits.com";
const NAME_RE = /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9-]+\.[a-z]{2,}$/;

const collapse = (s) => String(s).replace(/\s+/g, " ").trim();
export const NORMALISE = {
  dmarc: (v) => collapse(v).split(";").map((t) => t.trim().toLowerCase().replace(/\s*=\s*/, "=")).filter(Boolean).join(";"),
  spf: (v) => collapse(v).toLowerCase(),
  dkim: (v) => String(v).replace(/\s+/g, ""),
  mx: (v) => {
    const m = collapse(v).toLowerCase().match(/^(\d+)\s+(\S+?)\.?$/);
    return m ? `${Number(m[1])} ${m[2]}` : collapse(v).toLowerCase();
  },
};
const setOf = (kind, values) => [...new Set(values.map(NORMALISE[kind]).filter(Boolean))].sort();

// Checks one baseline entry. -> {ok:true, name, type, prefix, values} or
// {state:"unset"|"error"}.
export function entryOf(baseline, kind) {
  const domain = baseline && typeof baseline.domain === "string" ? baseline.domain.toLowerCase() : "";
  const e = baseline && baseline.records && baseline.records[kind];
  if (!e || typeof e !== "object") return { state: "error" };
  const vals = Array.isArray(e.values) ? e.values : null;
  const name = typeof e.name === "string" ? e.name.toLowerCase().replace(/\.$/, "") : "";
  if (/placeholder/i.test(name) || (vals && vals.some((v) => /placeholder/i.test(String(v))))) return { state: "unset" };
  if (!vals || !vals.length || !vals.every((v) => typeof v === "string" && v.trim())) return { state: "unset" };
  if (domain !== DOMAIN || !NAME_RE.test(name) || !(name === domain || name.endsWith("." + domain))) return { state: "error" };
  const type = kind === "mx" ? "MX" : "TXT";
  if (e.type !== type) return { state: "error" };
  const prefix = typeof e.prefix === "string" ? e.prefix : "";
  return { ok: true, name, type, prefix, values: vals };
}

const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);
// One lookup. -> array of raw strings, [] for "no such record", null on error.
async function lookup(resolver, entry) {
  try {
    if (entry.type === "MX") {
      const mx = await resolver.resolveMx(entry.name);
      return mx.map((r) => `${r.priority} ${r.exchange}`);
    }
    const txt = await resolver.resolveTxt(entry.name);
    const joined = txt.map((chunks) => (Array.isArray(chunks) ? chunks.join("") : String(chunks)));
    return entry.prefix ? joined.filter((t) => t.trim().toLowerCase().startsWith(entry.prefix.toLowerCase())) : joined;
  } catch (e) {
    return e && NO_RECORD.has(e.code) ? [] : null;
  }
}

// compare({baseline, resolver}) -> {c22: {dmarc, spf, dkim, mx}}
export async function compare({ baseline, resolver }) {
  const out = {};
  for (const kind of RECORDS) {
    const e = baseline ? entryOf(baseline, kind) : { state: "error" };
    if (!e.ok) { out[kind] = e.state; continue; }
    const live = await lookup(resolver, e);
    if (live === null) { out[kind] = "error"; continue; }
    const want = setOf(kind, e.values);
    const got = setOf(kind, live);
    out[kind] = !got.length ? "missing" : want.join("\n") === got.join("\n") ? "same" : "changed";
  }
  return { c22: out };
}

export function readBaseline(root = REPO_ROOT) {
  try { return JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8")); } catch { return null; }
}

export async function main(deps = {}) {
  let out;
  try {
    const resolver = deps.resolver || new dnsp.Resolver({ timeout: 4000, tries: 2 });
    out = await compare({ baseline: deps.baseline !== undefined ? deps.baseline : readBaseline(), resolver });
  } catch {
    out = { c22: Object.fromEntries(RECORDS.map((k) => [k, "error"])) };
  }
  console.log(JSON.stringify(out));
  return out;
}

if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) main();
