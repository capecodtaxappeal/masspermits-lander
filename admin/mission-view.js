// Mission Control view model. Pure: no DOM, request, storage or timer. Turns
// the API responses and the geometry into plain objects, and owns every fixed
// word and sentence on the page. Dates display in America/New_York.

export const TILE_ORDER = ["paying", "revenue", "renewals", "failed", "monday", "refresh", "sales", "signups"];
export const STATE_WORD = { green: "OK", amber: "WATCH", red: "ACT" };
export const GREY_WORD = {
  "not-connected": "NOT CONNECTED", unavailable: "UNAVAILABLE", unverified: "UNVERIFIED", pending: "NOT YET",
};
export const CLEAR_TEXT = "Nothing is wrong that this page can see.";
export const EK_SENTENCE = {
  owner_name_gate: "The engine's privacy guard stopped this town's rows (a parser fix is needed; nothing was published)",
  access_controlled: "Blocked by the town's site. That is an authorization decision: do not retry, it will not come back by itself.",
  no_rows: "Returned no rows",
  timeout: "The town's site timed out",
  http_error: "The town's site returned an error",
  parse: "The town's page changed shape (parser)",
  other: "Failed (the reason is not shown on this page)",
};
export const FAIL_SENTENCE = { crash: "crashed", gate: "stopped by its quality gate", unknown: "failed" };
export const MAP_CODES = ["dead", "weekly", "monthly", "answered", "sent", "locked", "none"];
export const LEGEND_TEXT = {
  dead: "Stale or dead source", weekly: "Live, weekly", monthly: "Live, monthly or slower",
  answered: "Outreach answered", sent: "Outreach sent", locked: "Locked behind OpenGov", none: "Not covered",
};
export const OUTREACH_STATES = ["planned", "sent", "answered", "declined"];
export const MSG = {
  title: "Mission Control", loading: "Loading", mapLoading: "Loading the map",
  notOwner: "Not signed in as the owner. Reload to sign in again.",
  unreadable: "Could not read the data. Reload; if it stays, check /admin/pipeline.",
  mapFailed: "The map could not load. Reload.",
  attribution: "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024",
  demoEdit: "Demo: nothing is saved", notReported: "not reported", noCustomers: "No customers yet.", none: "None.",
  showList: "Show as list", showMap: "Show as map",
};
export const SECTION_TITLES = [["customers", "Customers"], ["money", "Renewals and failed payments"],
  ["monday", "Monday delivery"], ["refresh", "Data refresh"], ["sales", "Sales and signups"], ["outreach", "Outreach"],
  ["cannot", "What this page cannot see"], ["setup", "Setup"]];
export const knownTitle = (n) => "Known, not new (" + n + ")";

const TZ = "America/New_York";
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export function fmtInt(n) {
  return isNum(n) ? Math.round(n).toLocaleString("en-US") : "—";
}

export function fmtMoney(cents, currency) {
  if (!isNum(cents)) return "—";
  const cur = typeof currency === "string" && /^[a-z]{3}$/i.test(currency) ? currency.toUpperCase() : "USD";
  const abs = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = cents < 0 ? "-" : "";
  return cur === "USD" ? sign + "$" + abs : sign + abs + " " + cur;
}

function toDate(iso) {
  if (typeof iso !== "string" || !iso) return null;
  // A bare YYYY-MM-DD is a calendar day: show it as written, never shifted.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function fmtDay(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US",
      { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function fmtTime(v) {
  const d = toDate(v);
  if (!d) return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDay(v) : "—";
  return d.toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Compact stamp for dense rows: "9/28 4:30 PM".
export function fmtStamp(v) {
  const d = toDate(v);
  if (!d) return "—";
  return d.toLocaleString("en-US", { timeZone: TZ, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })
    .replace(",", "");
}

// Colour is never the only signal: every class comes with its word.
export function stateOf(tile) {
  const s = tile && tile.state;
  if (s === "green" || s === "amber" || s === "red") return { cls: "s-" + s, word: STATE_WORD[s], grey: null };
  if (s === "grey" && tile && own(GREY_WORD, tile.grey)) {
    return { cls: "s-grey", word: GREY_WORD[tile.grey], grey: tile.grey };
  }
  return { cls: "s-grey", word: GREY_WORD.unavailable, grey: "unavailable" };
}

export function tileValue(tile) {
  const st = stateOf(tile);
  const v = tile ? tile.value : null;
  if (st.cls === "s-grey") return st.grey === "unverified" && isNum(v) ? fmtInt(v) : "—";
  if (!isNum(v)) return "—";
  return tile.id === "revenue" ? fmtMoney(v, "usd") : fmtInt(v);
}

export function tileView(tile) {
  const st = stateOf(tile);
  const id = tile && typeof tile.id === "string" ? tile.id : "";
  const label = (tile && typeof tile.label === "string" && tile.label) || id;
  return {
    id, label, cls: st.cls, word: st.word, value: tileValue(tile),
    sub: tile && typeof tile.sub === "string" ? tile.sub : "",
    asOf: tile && tile.as_of ? fmtStamp(tile.as_of) : "",
    aria: label + ": " + tileValue(tile) + ", " + st.word + (tile && tile.as_of ? ", as of " + fmtTime(tile.as_of) : ""),
  };
}

export function tilesView(list) {
  const byId = new Map();
  for (const t of Array.isArray(list) ? list : []) if (isObj(t) && typeof t.id === "string") byId.set(t.id, t);
  return TILE_ORDER.map((id) => tileView(byId.get(id) || { id, state: "grey", grey: "unavailable", value: null }));
}

export function headlineView(main) {
  const h = main && isObj(main.headline) ? main.headline : null;
  const s = h && h.state;
  if (s === "red") return { cls: "s-red", word: "ACT", text: str(h.text) };
  if (s === "amber") return { cls: "s-amber", word: "WATCH", text: str(h.text) };
  if (s === "clear") return { cls: "s-green", word: "OK", text: str(h.text) || CLEAR_TEXT };
  return { cls: "s-grey", word: "UNAVAILABLE", text: MSG.unreadable };
}

// Red, then amber; known lines only in their own group. An unexpected
// severity shows as WATCH, never dropped.
export function needsView(lines) {
  const red = [], amber = [], known = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!isObj(l)) continue;
    const row = { id: str(l.id), text: str(l.text), where: str(l.where) };
    if (l.severity === "red") red.push({ ...row, cls: "s-red", word: "ACT" });
    else if (l.severity === "known") known.push({ ...row, cls: "s-known", word: "KNOWN" });
    else amber.push({ ...row, cls: "s-amber", word: "WATCH" });
  }
  return { urgent: red.concat(amber), known, knownTitle: knownTitle(known.length) };
}

// resp: undefined (still loading) or {status, body}. status 0 = network error.
export function mainModel(resp) {
  if (!resp) return { kind: "loading", message: MSG.loading };
  const b = resp.body;
  if (resp.status === 200 && isObj(b) && b.ok === true) {
    return {
      kind: "ok", body: b, signedInAs: str(b.signed_in_as), now: str(b.now),
      headline: headlineView(b), tiles: tilesView(b.tiles), needs: needsView(b.needs_you),
      outreachEdit: b.outreach_edit === true,
    };
  }
  if (resp.status === 403 && isObj(b) && b.reason === "not-configured") return { kind: "setup" };
  if (resp.status === 403) return { kind: "denied", message: MSG.notOwner };
  return { kind: "error", message: MSG.unreadable };
}

export function codeOf(fact) {
  return isObj(fact) && MAP_CODES.includes(fact.k) ? fact.k : "none";
}

export function legendView(map) {
  const counts = map && isObj(map.counts) ? map.counts : {};
  const towns = map && isObj(map.towns) ? map.towns : {};
  return MAP_CODES.map((code) => ({
    code, text: LEGEND_TEXT[code], cls: "m-" + code,
    count: isNum(counts[code]) ? counts[code] : 0,
    planned: code === "none" ? Object.values(towns).filter((t) => codeOf(t) === "none" && isObj(t) && t.planned).length : 0,
  }));
}

export function mapModel(resp, geo) {
  if (!resp || !geo) {
    const failed = (resp && !(resp.status === 200 && isObj(resp.body) && resp.body.ok === true)) || geo === null;
    return failed ? { kind: "error", message: MSG.mapFailed } : { kind: "loading", message: MSG.mapLoading };
  }
  const b = resp.body;
  if (!(resp.status === 200 && isObj(b) && b.ok === true) || !isObj(geo) || !isObj(geo.towns)) {
    return { kind: "error", message: MSG.mapFailed };
  }
  const facts = isObj(b.towns) ? b.towns : {};
  const keys = Object.keys(geo.towns);
  const legend = legendView(b);
  const total = legend.reduce((a, l) => a + l.count, 0);
  const summary = "Map of " + keys.length + " towns: " +
    legend.map((l) => fmtInt(l.count) + " " + l.text.toLowerCase()).join(", ") + ".";
  return {
    kind: "ok", body: b, viewBox: str(geo.viewBox) || "0 0 2000 1272",
    towns: keys.map((k) => ({ key: k, d: str(geo.towns[k] && geo.towns[k].d), code: codeOf(facts[k]),
      planned: isObj(facts[k]) && !!facts[k].planned })),
    legend, total, summary,
    opengov: "OpenGov: registry " + fmtInt(b.opengov && b.opengov.registry) +
      " · owner list " + fmtInt(b.opengov && b.opengov.owner_list),
    asOf: asOfLines(b.as_of),
    unmatched: Array.isArray(b.unmatched) ? b.unmatched.map(str) : [],
    ignored: Array.isArray(b.outreach_ignored) ? b.outreach_ignored.map(str) : [],
    attribution: MSG.attribution,
  };
}

function asOfLines(a) {
  const x = isObj(a) ? a : {};
  return [
    ["Refresh", fmtTime(x.refresh)], ["Source health", fmtTime(x.source_health)],
    ["Registry", fmtTime(x.registry)], ["Outreach", x.outreach ? fmtTime(x.outreach) : "absent"],
  ];
}

export function ekSentence(code) {
  return own(EK_SENTENCE, code) ? EK_SENTENCE[code] : EK_SENTENCE.other;
}

export function failSentence(kind) {
  return own(FAIL_SENTENCE, kind) ? FAIL_SENTENCE[kind] : FAIL_SENTENCE.unknown;
}

const LOCK_TEXT = { paused: "paused (built, not wired)", owner: "owner list", opengov: "registry method OpenGov" };

// The facts a town sheet shows: [label, value] pairs, payload facts only.
export function townFacts(key, fact) {
  const f = isObj(fact) ? fact : {};
  const code = codeOf(f);
  const out = [["Town", str(key)], ["Status", LEGEND_TEXT[code]]];
  if (isNum(f.rows)) out.push(["Rows, latest run", fmtInt(f.rows)]);
  if (f.newest) out.push(["Newest permit", fmtDay(f.newest)]);
  if (f.state) out.push(["Source state", str(f.state)]);
  if (f.cadence) out.push(["Cadence", str(f.cadence)]);
  if (f.ek) out.push(["Problem", ekSentence(f.ek)]);
  if (f.o) out.push(["Outreach", str(f.o) + (f.os ? " since " + fmtDay(f.os) : "")]);
  if (f.planned) out.push(["Planned", "outreach planned (dashed outline)"]);
  if (f.lk) out.push(["Lock", LOCK_TEXT[f.lk] || str(f.lk)]);
  return out;
}

export function listGroups(mm) {
  if (!mm || mm.kind !== "ok") return [];
  return MAP_CODES.map((code) => {
    const towns = mm.towns.filter((t) => t.code === code).map((t) => t.key).sort();
    return { code, text: LEGEND_TEXT[code], cls: "m-" + code, count: towns.length, towns };
  }).filter((g) => g.count > 0);
}

// Each section is a list of blocks: {t:"kv", rows:[[k,v]]}, {t:"rows",
// rows:[person]}, {t:"text", text}, {t:"list", items:[text]}.
export function personView(r) {
  const x = isObj(r) ? r : {};
  const meta = [str(x.email_masked) || "hidden"];
  if (x.t8) meta.push("t8 " + str(x.t8));
  if (x.plan) meta.push(str(x.plan));
  if (x.status) meta.push(str(x.status));
  if (x.since) meta.push("since " + fmtDay(x.since));
  if (x.date) meta.push("date " + fmtDay(x.date));
  return {
    name: str(x.name) || "(no name)", meta: meta.join(" · "),
    amount: isNum(x.amount_cents) ? fmtMoney(x.amount_cents, x.currency) : "",
    href: typeof x.stripe_url === "string" && x.stripe_url ? x.stripe_url : "",
  };
}

const rowsBlock = (rows, empty) => (Array.isArray(rows) && rows.length
  ? { t: "rows", rows: rows.map(personView) } : { t: "text", text: empty || MSG.none });
const yesNo = (v) => (v === true ? "yes" : v === false ? "no" : str(v) || MSG.notReported);
const numOr = (v) => (isNum(v) ? fmtInt(v) : MSG.notReported);

export function detailsView(mainM, mapM) {
  const b = mainM && mainM.kind === "ok" ? mainM.body : null;
  const d = b && isObj(b.detail) ? b.detail : {};
  const o = (v) => (isObj(v) ? v : {});
  const NR = MSG.notReported;
  const kv = (rows) => ({ t: "kv", rows });
  const h = (text) => ({ t: "h", text });
  const txt = (text) => ({ t: "text", text });
  const at = (v) => (v ? fmtTime(v) : NR);
  const usd = (v, none) => (isNum(v) ? fmtMoney(v, "usd") : none);
  const sec = {};

  const c = o(d.customers);
  sec.customers = [kv([["Active", numOr(c.count)], ["Cancelled", numOr(c.cancelled)], ["Source", str(c.source) || "r2"]]),
    c.count === 0 ? txt(MSG.noCustomers) : rowsBlock(c.rows, isNum(c.count) ? MSG.none : MSG.unreadable)];
  if (c.more > 0) sec.customers.push(txt("+" + fmtInt(c.more) + " more"));
  if (isObj(d.engagement)) sec.customers.push(kv(Object.keys(d.engagement).map((k) => ["Engagement: " + k, numOr(d.engagement[k])])));

  sec.money = [h("Renewals, next 14 days"), isObj(d.renewals) ? rowsBlock(d.renewals.rows) : txt("Stripe is not connected."),
    h("Failed payments"), rowsBlock(o(d.failed_payments).rows)];

  const m = o(d.monday);
  sec.monday = [kv([["Monday", m.monday_date ? fmtDay(m.monday_date) : NR],
    ["Delivered", numOr(m.delivered) + " of " + numOr(m.expected)], ["Sent at", m.best_at ? fmtTime(m.best_at) : "not sent"],
    ["Hold deadline", at(m.hold)], ["Duplicates", numOr(m.duplicates)], ["New since Monday", numOr(m.new_since_monday)],
    ["Skipped only", yesNo(m.skipped_only)]]), h("Missing"), rowsBlock(m.missing), h("Failed"), rowsBlock(m.failed)];
  if (Array.isArray(m.joined_on_send_day) && m.joined_on_send_day.length) {
    sec.monday.push(h("Joined on send day"), rowsBlock(m.joined_on_send_day));
  }
  sec.monday.push(txt(str(m.caveat)));

  const r = o(d.refresh);
  const cov = isObj(r.coverage) ? r.coverage : null;
  const cv = (k) => (cov ? numOr(cov[k]) : NR);
  sec.refresh = [kv([["Ran at", at(r.ran_at)],
    ["Result", r.ok === true ? "ok" : r.degraded === true ? "reduced run" : r.ok === false ? failSentence(r.fail_kind) : NR],
    ["Coverage", cov ? cv("live_sources") + " of " + cv("expected_sources") + " sources live" : NR],
    ["Attempted", cv("attempted_sources")], ["Lost", cv("lost_sources")], ["Rows", numOr(r.count)],
    ["Reduced coverage told to subscribers", cov ? yesNo(cov.disclose) : NR],
    ["Status file uploaded", at(r.status_uploaded)], ["Weekly bundle uploaded", at(r.weekly_uploaded)],
    ["Portal page uploaded", at(r.portal_uploaded)], ["Same bundle as last send", yesNo(r.same_bundle_as_last_send)]]),
  h("Sources in trouble"), Array.isArray(r.sources) && r.sources.length ? { t: "src", rows: r.sources.filter(isObj)
    .map((x) => ({ town: str(x.town), state: str(x.state), since: x.since ? fmtDay(x.since) : "—", why: ekSentence(x.ek) })) }
    : txt(MSG.none)];

  const s = isObj(d.sales) ? d.sales : null;
  const g = isObj(d.signups) ? d.signups : null;
  sec.sales = s ? [kv([["New checkouts, 7 days", numOr(s.new_checkouts)],
    ["Renewal deliveries, 7 days", numOr(s.renewal_deliveries)], ["Gross", usd(s.gross_cents, "Stripe is not connected")],
    ["New subscriptions", usd(s.new_subscription_cents, "—")], ["Packs", usd(s.pack_cents, "—")]]), rowsBlock(s.rows)]
    : [txt(MSG.unreadable)];
  sec.sales.push(h("Signups, 7 days" + (g && g.at_least ? " (at least)" : "")));
  if (g) {
    const by = o(g.by_day), tr = o(g.trades);
    sec.sales.push(kv([...Object.keys(by).sort().map((k) => [fmtDay(k), numOr(by[k])]),
      ["Prospects", numOr(g.prospects)], ["Agents", numOr(g.agents)], ["Newsletter confirmed", numOr(g.newsletter_confirmed)],
      ["Newsletter pending", numOr(g.newsletter_pending)], ...Object.keys(tr).sort().map((k) => ["Trade: " + k, numOr(tr[k])])]));
  } else sec.sales.push(txt(MSG.unreadable));

  const su = o(d.setup);
  sec.outreach = [kv([["Outreach object", str(su.outreach) || NR]])];
  if (mapM && mapM.kind === "ok") {
    const f = mapM.body.towns;
    const worked = mapM.towns.filter((t) => isObj(f[t.key]) && f[t.key].o)
      .map((t) => t.key + ": " + str(f[t.key].o) + (f[t.key].os ? " since " + fmtDay(f[t.key].os) : ""));
    const n = (code) => fmtInt(mapM.legend.find((l) => l.code === code).count);
    sec.outreach.push(kv([["Answered", n("answered")], ["Sent", n("sent")], ["Locked", n("locked")],
      ["OpenGov", mapM.opengov.slice(9)]]), worked.length ? { t: "list", items: worked } : txt(MSG.none));
    if (mapM.ignored.length) sec.outreach.push(txt("Ignored (not a map town): " + mapM.ignored.join(", ")));
  } else sec.outreach.push(txt(MSG.mapFailed));

  sec.cannot = [kv((Array.isArray(d.not_measured) ? d.not_measured : []).filter(isObj).map((x) => [str(x.what), str(x.why)]))];

  const we = o(su.webhook_events);
  sec.setup = [kv([["Stripe", str(su.stripe) || NR], ["Price list", str(su.price_list) || NR],
    ["invoice.payment_failed registered", yesNo(we["invoice.payment_failed"])],
    ["customer.subscription.deleted registered", yesNo(we["customer.subscription.deleted"])],
    ["Outreach object", str(su.outreach) || NR], ["Registry uploaded", su.registry ? fmtDay(su.registry) : NR]])];

  return SECTION_TITLES.map(([id, title]) => ({ id, title, blocks: sec[id] }));
}
