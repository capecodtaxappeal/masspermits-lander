// Content validation, key format, dedupe and index concurrency (_manual_store.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as H from "./_h.mjs";

const { store } = await H.load();
const NOW = new Date("2026-09-21T14:03:09.123Z");

test("sniff accepts each type by content", async () => {
  assert.deepEqual(await store.sniff(H.F.csv()), { ok: true, ext: "csv" });
  assert.deepEqual(await store.sniff(H.F.csvBom()), { ok: true, ext: "csv" });
  assert.deepEqual(await store.sniff(H.F.pdf()), { ok: true, ext: "pdf" });
  assert.deepEqual(await store.sniff(H.F.xlsx(true)), { ok: true, ext: "xlsx" });
  assert.deepEqual(await store.sniff(H.F.xlsx(false)), { ok: true, ext: "xlsx" });
});

test("sniff refuses a renamed exe, macros, encryption, nesting and junk", async () => {
  const cases = {
    exe: [H.F.exe(), "unrecognized"],
    xlsm: [H.F.xlsm(), "macro"],
    xlsmTypesOnly: [H.F.xlsmTypesOnly(), "macro"],
    zipEncrypted: [H.F.zipEncrypted(), "encrypted"],
    ole: [H.F.ole(), "encrypted"],
    pdfEncrypted: [H.F.pdfEncrypted(), "encrypted"],
    pdfJs: [H.F.pdf("2 0 obj << /S /JavaScript >> endobj\n"), "active-content"],
    pdfEmbedded: [H.F.pdf("2 0 obj << /Type /EmbeddedFile >> endobj\n"), "active-content"],
    pdfTruncated: [Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n"), "pdf-truncated"],
    nestedZip: [H.F.nestedZip(), "nested-archive"],
    embedding: [H.F.xlsxWithEmbedding(), "nested-archive"],
    docx: [H.F.docx(), "not-accepted"],
    zipSlip: [H.F.zipSlip(), "zip-path"],
    html: [H.F.html(), "no-header"],
    oneColumn: [H.F.oneColumn(), "no-header"],
    latin1: [H.F.latin1(), "unrecognized"],
    empty: [H.F.empty(), "empty"],
    oversize: [H.F.oversize(), "too-large"],
    gzip: [Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]), "unrecognized"],
    nul: [Buffer.from("a,b\n1,\u0000\n"), "unrecognized"],
  };
  for (const [name, [bytes, reason]] of Object.entries(cases)) {
    const r = await store.sniff(bytes);
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, reason, name);
  }
});

test("sniff at exactly 10 MB is allowed, one byte more is not", async () => {
  const head = Buffer.from("a,b\n");
  const exact = Buffer.concat([head, Buffer.alloc(10 * 1024 * 1024 - head.length, 0x31)]);
  assert.equal((await store.sniff(exact)).ok, true);
  assert.equal((await store.sniff(Buffer.concat([exact, Buffer.from("1")]))).reason, "too-large");
});

test("parseSources keeps only well formed entries", () => {
  const s = store.parseSources(JSON.stringify({
    "town-a": { label: "Town A", cadence: "weekly", accept: ["csv", ".PDF", "exe"] },
    "Bad Slug": { cadence: "weekly", accept: ["csv"] },
    "../x": { cadence: "weekly", accept: ["csv"] },
    "town-c": { cadence: "daily", accept: ["csv"] },
    "town-d": { cadence: "monthly", accept: ["zip"] },
  }));
  assert.deepEqual(Object.keys(s), ["town-a"]);
  assert.deepEqual(s["town-a"].accept, ["csv", "pdf"]);
  assert.deepEqual(store.parseSources("not json"), {});
  assert.deepEqual(store.parseSources(undefined), {});
});

test("sanitizeName: no path, no odd characters, at most 80", () => {
  assert.equal(store.sanitizeName("C:\\Users\\x\\Report (1).csv"), "Report (1).csv");
  assert.equal(store.sanitizeName("../../etc/passwd"), "passwd");
  assert.equal(store.sanitizeName("a<script>b.pdf"), "a_script_b.pdf");
  assert.equal(store.sanitizeName("x".repeat(200) + ".csv").length, 80);
  assert.equal(store.sanitizeName(""), "file");
  assert.equal(store.sanitizeName("..."), "file");
});

test("object keys: the documented format, and KEY_RX matches it", () => {
  const sha = "ab".repeat(32);
  const k = store.objectKey("town-a", NOW, sha, "csv");
  assert.equal(k, "manual-raw/town-a/20260921T140309Z-abababababab.csv");
  assert.ok(store.KEY_RX.test(k));
  assert.ok(store.KEY_RX.test("manual-raw/index.json"));
  assert.throws(() => store.objectKey("Town", NOW, sha, "csv"));
  assert.throws(() => store.objectKey("town-a", NOW, sha, "exe"));
});

async function ingest(r2, bytes, slug = "town-a", now = NOW, via = "drop") {
  const s = await store.sniff(bytes);
  return store.ingest(r2, { slug, bytes, ext: s.ext, name: "Some File.csv", via, now });
}

test("ingest stores once; the same bytes again answer duplicate and write nothing", async () => {
  const r2 = new H.FakeR2();
  const a = await ingest(r2, H.F.csv());
  assert.equal(a.status, "stored");
  assert.match(a.key, /^manual-raw\/town-a\/20260921T140309Z-[0-9a-f]{12}\.csv$/);
  const objects = r2.objects.size;
  const b = await ingest(r2, H.F.csv(), "town-a", new Date(NOW.getTime() + 3600_000));
  assert.equal(b.status, "duplicate");
  assert.equal(b.key, a.key);
  assert.equal(r2.objects.size, objects);
  const idx = JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());
  assert.equal(idx.schema, 1);
  assert.equal(idx.entries.length, 1);
  const e = idx.entries[0];
  assert.deepEqual(Object.keys(e).sort(), ["bytes", "ext", "key", "name", "received_at", "sha256", "slug", "via"]);
  assert.equal(e.via, "drop");
  assert.equal(e.name, "Some File.csv");
  assert.equal(e.bytes, H.F.csv().length);
  assert.equal(e.received_at, NOW.toISOString());
  assert.equal(r2.objects.get(a.key).customMetadata.sha256, e.sha256);
});

test("the stored object is never overwritten (If-None-Match on the data key)", async () => {
  const r2 = new H.FakeR2();
  const a = await ingest(r2, H.F.csv());
  // Lose the index entry, keep the object: the next put of the same key must refuse, not replace.
  r2.seed("manual-raw/index.json", JSON.stringify({ schema: 1, entries: [] }));
  const before = r2.objects.get(a.key).etag;
  const b = await ingest(r2, H.F.csv());
  assert.equal(b.status, "stored");
  assert.equal(r2.objects.get(a.key).etag, before);
  assert.ok(r2.putRefusals >= 1);
});

test("index concurrency: two interleaved writers both land, no entry is lost", async () => {
  for (let round = 0; round < 5; round++) {
    const r2 = new H.FakeR2({ yieldEvery: true });
    const one = Buffer.from("col_a,col_b\n1," + round + "\n");
    const two = Buffer.from("col_a,col_b\n2," + round + "\n");
    const [a, b] = await Promise.all([ingest(r2, one), ingest(r2, two)]);
    assert.equal(a.status, "stored");
    assert.equal(b.status, "stored");
    const idx = JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());
    assert.equal(idx.entries.length, 2);
    assert.ok(r2.putRefusals >= 1, "the second writer had to retry");
  }
});

test("index concurrency: with an existing index, three writers all land", async () => {
  const r2 = new H.FakeR2({ yieldEvery: true });
  await ingest(r2, Buffer.from("x,y\n0,0\n"));
  const rs = await Promise.all([1, 2, 3].map((i) => ingest(r2, Buffer.from("x,y\n" + i + "," + i + "\n"))));
  assert.deepEqual(rs.map((r) => r.status), ["stored", "stored", "stored"]);
  const idx = JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());
  assert.equal(idx.entries.length, 4);
});

test("the same file from two concurrent writers is stored once", async () => {
  const r2 = new H.FakeR2({ yieldEvery: true });
  const [a, b] = await Promise.all([ingest(r2, H.F.csv()), ingest(r2, H.F.csv(), "town-a", NOW, "email")]);
  assert.deepEqual([a.status, b.status].sort(), ["duplicate", "stored"]);
  const idx = JSON.parse(r2.objects.get("manual-raw/index.json").buf.toString());
  assert.equal(idx.entries.length, 1);
  const data = [...r2.objects.keys()].filter((k) => k !== "manual-raw/index.json");
  assert.equal(data.length, 1);
});

test("a corrupt index is never overwritten", async () => {
  const r2 = new H.FakeR2();
  r2.seed("manual-raw/index.json", "{not json");
  const r = await ingest(r2, H.F.csv());
  assert.deepEqual(r, { status: "error", reason: "index-unreadable" });
  assert.equal(r2.objects.get("manual-raw/index.json").buf.toString(), "{not json");
  assert.equal(r2.objects.size, 1);
});

test("a writer that cannot win the index leaves no orphan object", async () => {
  const r2 = new H.FakeR2();
  const realPut = r2.put.bind(r2);
  r2.put = async (k, v, o) => (k === "manual-raw/index.json" ? (r2.putRefusals++, null) : realPut(k, v, o));
  const r = await store.ingest(r2, { slug: "town-a", bytes: H.F.csv(), ext: "csv", name: "x", via: "drop", now: NOW, retries: 3 });
  assert.deepEqual(r, { status: "error", reason: "index-busy" });
  assert.equal(r2.objects.size, 0);
});

test("every R2 op of the store stays under manual-raw/, and there is no list", async () => {
  const r2 = new H.FakeR2();
  await ingest(r2, H.F.csv());
  await ingest(r2, H.F.pdf());
  await store.readIndex(r2);
  for (const k of r2.keysTouched()) assert.ok(k.startsWith("manual-raw/"), k);
  assert.ok(!r2.ops.some((o) => o[0] === "list"));
  for (const k of ["subscribers.json", "engine.tar.gz", "feed-send-log.json", "manual-raw/../subscribers.json",
    "manual-raw/x/../../engine.tar.gz", "manual-raw\\..\\subscribers.json", "manual-raw/town-a/notes.txt"]) {
    await assert.rejects(() => store.getManual(r2, k), /outside manual-raw/, k);
  }
  assert.ok(!r2.ops.some((o) => !o[1].startsWith("manual-raw/") || o[1].includes("..")));
});

test("ownerView: states from cadence, last 10 receipts, no names or hashes", () => {
  const sources = store.parseSources(H.SOURCES);
  const now = new Date("2026-09-30T12:00:00Z");
  const day = (d) => new Date(now.getTime() - d * 86400_000).toISOString();
  const entries = [];
  for (let i = 0; i < 12; i++) {
    entries.push({ key: "k" + i, slug: "town-a", sha256: "s" + i, bytes: 100 + i, ext: "csv", received_at: day(8 + i), via: "drop", name: "secret name" });
  }
  entries.push({ key: "kb", slug: "town-b", sha256: "b", bytes: 5, ext: "pdf", received_at: day(35), via: "email", name: "n" });
  const v = store.ownerView(sources, { schema: 1, entries }, now);
  const a = v.find((s) => s.slug === "town-a"), b = v.find((s) => s.slug === "town-b");
  assert.equal(a.days_since, 8);
  assert.equal(a.state, "due soon");
  assert.equal(a.receipts.length, 10);
  assert.equal(b.state, "due soon");
  const text = JSON.stringify(v);
  assert.ok(!text.includes("secret name") && !text.includes("sha256") && !text.includes('"key"'));
  assert.equal(store.stateFor("weekly", 7), "ok");
  assert.equal(store.stateFor("weekly", 9), "due soon");
  assert.equal(store.stateFor("weekly", 10), "overdue");
  assert.equal(store.stateFor("monthly", 31), "ok");
  assert.equal(store.stateFor("monthly", 40), "due soon");
  assert.equal(store.stateFor("monthly", 41), "overdue");
  assert.equal(store.stateFor("monthly", null), "overdue");
});
