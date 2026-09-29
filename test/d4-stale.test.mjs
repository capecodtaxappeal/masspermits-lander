import test, { after } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as portal, onRequestHead } from "../functions/leads.js";
import { onRequestGet as download } from "../functions/api/my-leads.js";

const TOKEN = "a".repeat(32);
const NOW = Date.parse("2026-09-29T14:00:00Z");
const OLD = "2026-09-14T10:00:00Z";
const FRESH = "2026-09-28T10:00:00Z";
const originalNow = Date.now, originalFetch = globalThis.fetch;
const originalRewriter = globalThis.HTMLRewriter;
Date.now = () => NOW;
globalThis.fetch = async () => { throw new Error("Unexpected network in D4 test"); };

// This adapter exercises the three selectors on synthetic HTML only. It is not
// a browser or a claim about arbitrary HTML parsing.
globalThis.HTMLRewriter = class {
  constructor() { this.rules = []; }
  on(selector, handler) { this.rules.push([selector, handler]); return this; }
  transform(response) {
    const rules = this.rules;
    const body = new ReadableStream({ async start(controller) {
      let html = await response.text();
      for (const [selector, handler] of rules) {
        handler.element({
          append(value) { html = html.replace("</head>", value + "</head>"); },
          prepend(value) { html = html.replace("<body>", "<body>" + value); },
          setInnerContent(value) {
            assert.equal(selector, "span.fresh");
            html = html.replace(/(<span class="fresh"[^>]*>)[\s\S]*?(<\/span>)/, "$1" + value + "$2");
          },
          setAttribute(name, value) {
            html = html.replace('<span class="fresh"', '<span class="fresh" ' + name + '="' + value + '"');
          },
        });
      }
      controller.enqueue(new TextEncoder().encode(html)); controller.close();
    }});
    return new Response(body, { status: response.status, headers: response.headers });
  }
};
after(() => { Date.now = originalNow; globalThis.fetch = originalFetch; globalThis.HTMLRewriter = originalRewriter; });

function world({ uploaded = OLD, ran = OLD, active = true, pause, pauseFailure,
  missingHtml = false, missingZip = false, bodyFailure = false, coverage = false,
  headUploaded = uploaded, statusFailure } = {}) {
  const calls = [], pending = [];
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const html = '<html><head></head><body><span class="fresh">updated TEST</span><p>TEST LAST GOOD ROWS</p></body></html>';
  const meta = (date) => ({ uploaded: date === null ? null : new Date(date), etag: "etag_TEST" });
  const r2 = {
    async get(key) {
      calls.push(["get", key]);
      if (key === "subscribers.json") return { text: async () => JSON.stringify([{ email: "casey@example.com", customer: "cus_TEST_policy", token: TOKEN, active }]) };
      if (key === "portal.json") {
        if (pauseFailure === "get") throw new Error("TEST read unavailable");
        if (pause === undefined && !pauseFailure) return null;
        return { text: async () => {
          if (pauseFailure === "body") throw new Error("TEST body unavailable");
          return pauseFailure === "json" ? "{" : JSON.stringify(pause);
        }};
      }
      if (key === "refresh-status.json") {
        if (statusFailure === "get") throw new Error("TEST refresh read unavailable");
        return ran === null ? null : { text: async () => {
          if (statusFailure === "body") throw new Error("TEST refresh body unavailable");
          return statusFailure === "json" ? "{" : JSON.stringify({ ran_at: ran,
            coverage: coverage ? { disclose: true, live_sources: 2, expected_sources: 4 } : null });
        }};
      }
      if (key === "latest-weekly.html") {
        if (bodyFailure) throw new Error("TEST HTML unavailable");
        return missingHtml ? null : { ...meta(uploaded), body: html };
      }
      if (/^latest-(weekly|monthly)\.zip$/.test(key)) return missingZip ? null : { ...meta(uploaded), body: bytes };
      throw new Error("Unexpected R2 key: " + key);
    },
    async head(key) { calls.push(["head", key]); return key.endsWith(".html") && missingHtml ? null : meta(headUploaded); },
    async put(key) { assert.match(key, /^(portal-access|dl)\//); },
  };
  const context = (url = "https://unit.invalid/leads", method = "GET") => ({
    request: new Request(url, { method, headers: { cookie: "mp_sess=" + TOKEN, "user-agent": "TEST browser" } }),
    env: { BUNDLES: r2 }, waitUntil: p => pending.push(p),
  });
  return { calls, context, async settle() { await Promise.all(pending); } };
}

for (const age of [OLD, FRESH]) test("D4 serves dated last good portal rows from " + age.slice(0, 10), async () => {
  const w = world({ uploaded: age, ran: age });
  const r = await portal(w.context()), text = await r.text();
  assert.equal(r.status, 200); assert.match(text, /TEST LAST GOOD ROWS/);
  assert.ok(text.includes("Data as of " + age.slice(0, 10)));
  assert.doesNotMatch(text, /updated TEST|Your rows are hidden/);
  assert.match(r.headers.get("cache-control"), /private.*no-store/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  if (age === OLD) assert.match(text, /has not refreshed|older data/i);
  await w.settle();
});

test("D4 dates the returned HTML object instead of a raced head", async () => {
  const w = world({ uploaded: OLD, ran: FRESH, headUploaded: FRESH });
  const r = await portal(w.context()), text = await r.text();
  assert.match(text, /TEST LAST GOOD ROWS/); assert.match(text, /Data as of 2026-09-14/);
  assert.doesNotMatch(text, /Data as of 2026-09-28/);
});

test("D4 a newer refresh record does not relabel older rows as fresh", async () => {
  const w = world({ uploaded: OLD, ran: FRESH });
  const text = await (await portal(w.context())).text();
  assert.match(text, /Data as of 2026-09-14/); assert.match(text, /older data|has not refreshed/i);
});

test("D4 an older refresh date is disclosed even on newly published HTML", async () => {
  const w = world({ uploaded: FRESH, ran: OLD });
  const text = await (await portal(w.context())).text();
  assert.match(text, /TEST LAST GOOD ROWS/); assert.match(text, /Data as of 2026-09-14/);
});

test("D4 missing refresh record uses and explains the object's publication date", async () => {
  const w = world({ uploaded: OLD, ran: null });
  const text = await (await portal(w.context())).text();
  assert.match(text, /TEST LAST GOOD ROWS/); assert.match(text, /Data as of 2026-09-14/);
  assert.match(text, /publish|publication/);
});

for (const uploaded of [null, "bad-date", "2027-01-01T00:00:00Z"]) {
  test("D4 never exposes rows with an untrustworthy object date " + String(uploaded), async () => {
    const w = world({ uploaded, ran: FRESH });
    const r = await portal(w.context()), text = await r.text();
    assert.equal(r.status, 503); assert.doesNotMatch(text, /TEST LAST GOOD ROWS/);
    assert.match(text, /date|temporarily unavailable/i);
  });
}

for (const pauseFailure of ["get", "body", "json"]) {
  test("D4 unreadable pause " + pauseFailure + " preserves paid dated access", async () => {
    const w = world({ pauseFailure });
    const r = await portal(w.context()), text = await r.text();
    assert.equal(r.status, 200); assert.match(text, /TEST LAST GOOD ROWS/);
    assert.match(text, /Data as of 2026-09-14/);
  });
}
for (const pause of [null, [], "off", { off: "true" }, { off: false }]) {
  test("D4 only an explicit boolean pause can redirect " + JSON.stringify(pause), async () => {
    const w = world({ pause });
    const r = await portal(w.context());
    assert.equal(r.status, 200); assert.match(await r.text(), /TEST LAST GOOD ROWS/);
  });
}
test("D4 explicit pause retains the established authenticated download fallback", async () => {
  const w = world({ pause: { off: true } });
  const r = await portal(w.context());
  assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/api/my-leads?t=" + TOKEN);
});
test("D4 inactive subscriber cannot obtain stale or fresh rows", async () => {
  const w = world({ active: false });
  const r = await portal(w.context());
  assert.equal(r.status, 403); assert.doesNotMatch(await r.text(), /TEST LAST GOOD ROWS/);
});
test("D4 coverage disclosure cannot call stale rows current", async () => {
  const w = world({ coverage: true });
  const text = await (await portal(w.context())).text();
  assert.match(text, /Reduced coverage/); assert.match(text, /Data as of 2026-09-14/);
  assert.doesNotMatch(text, /Everything on this page is real and current/);
});
test("D4 failed HTML read returns a controlled error without unlabeled content", async () => {
  const w = world({ bodyFailure: true });
  const r = await portal(w.context()); assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /TEST LAST GOOD ROWS/);
});
test("D4 HEAD retains the same status and private headers without a body", async () => {
  const w = world(); const r = await onRequestHead(w.context(undefined, "HEAD"));
  assert.equal(r.status, 200); assert.equal(await r.text(), "");
  assert.match(r.headers.get("cache-control"), /no-store/);
});
for (const kind of ["weekly", "monthly"]) test("D4 download labels " + kind + " data with its object date", async () => {
  const w = world(); const r = await download(w.context("https://unit.invalid/api/my-leads?t=" + TOKEN + "&k=" + kind));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-masspermits-data-as-of"), "2026-09-14");
  assert.equal(r.headers.get("content-disposition"), 'attachment; filename="MassPermits-' + kind + '-data-as-of-2026-09-14.zip"');
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), new Uint8Array([80,75,3,4]));
});
for (const uploaded of [null, "bad-date", "2027-01-01T00:00:00Z"]) {
  test("D4 unknown download date cannot silently serve an undated ZIP " + String(uploaded), async () => {
    const w = world({ uploaded });
    const r = await download(w.context("https://unit.invalid/api/my-leads?t=" + TOKEN));
    assert.equal(r.status, 503); assert.notEqual(r.headers.get("content-type"), "application/zip");
  });
}

for (const statusFailure of ["get", "body", "json"]) {
  test("D4 failed refresh evidence " + statusFailure + " keeps dated paid access", async () => {
    const w = world({ statusFailure });
    const r = await portal(w.context()), text = await r.text();
    assert.equal(r.status, 200); assert.match(text, /TEST LAST GOOD ROWS/);
    assert.match(text, /Data as of 2026-09-14/); assert.match(text, /publish/);
  });
}
for (const ran of ["bad-date", "2027-01-01T00:00:00Z"]) {
  test("D4 invalid refresh date falls back to the dated object " + ran, async () => {
    const w = world({ ran });
    const r = await portal(w.context()), text = await r.text();
    assert.equal(r.status, 200); assert.match(text, /TEST LAST GOOD ROWS/);
    assert.match(text, /Data as of 2026-09-14/);
  });
}
