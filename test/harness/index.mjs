// Offline revenue harness. Adapted from the existing rehearsal primitives.
// Normal runs import unchanged production modules. No service request can escape.
import { createHash, createHmac, generateKeyPairSync, createSign } from "node:crypto";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { HTMLRewriter } from "@miniflare/html-rewriter";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_NOW = "2026-09-28T14:00:00Z";
export const TEST_WEBHOOK_SECRET = "whsec_" + "TEST_only_secret";
const NativeDate = globalThis.Date;
const NativeResponse = globalThis.Response;
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "revenue_TEST_key";
export const TEST_JWK = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
const encode = new TextEncoder();
const decode = new TextDecoder();
const copy = (x) => structuredClone(x);

function bytes(value) {
  if (value == null) return new Uint8Array();
  if (typeof value === "string") return encode.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  return encode.encode(JSON.stringify(value));
}
function stripQuotes(value) { return String(value).replace(/^"|"$/g, ""); }
function conditionsPass(object, condition) {
  if (!condition) return true;
  const c = condition instanceof Headers ? {
    etagMatches: condition.get("if-match") ?? undefined,
    etagDoesNotMatch: condition.get("if-none-match") ?? undefined,
  } : condition;
  if (c.etagMatches !== undefined) {
    const match = stripQuotes(c.etagMatches);
    if (!object || (match !== "*" && object.etag !== match)) return false;
  }
  if (c.etagDoesNotMatch !== undefined) {
    const match = stripQuotes(c.etagDoesNotMatch);
    if (object && (match === "*" || object.etag === match)) return false;
  }
  if (c.uploadedBefore && object && object.uploaded >= new NativeDate(c.uploadedBefore)) return false;
  if (c.uploadedAfter && (!object || object.uploaded <= new NativeDate(c.uploadedAfter))) return false;
  return true;
}

export class MemoryR2 {
  constructor(initial = {}) {
    this.store = new Map();
    this.ops = [];
    this.faults = [];
    for (const [key, value] of Object.entries(initial)) {
      if (value && Object.hasOwn(value, "__r2")) this.set(key, value.value, value.__r2);
      else this.set(key, value);
    }
  }
  set(key, value, options = {}) {
    const data = bytes(value);
    this.store.set(String(key), {
      key: String(key), bytes: data, size: data.byteLength,
      etag: options.etag || createHash("md5").update(data).digest("hex"),
      uploaded: new NativeDate(options.uploaded ?? Date.now()),
      customMetadata: copy(options.customMetadata || {}),
      httpMetadata: copy(options.httpMetadata || {}),
    });
    return this;
  }
  text(key) { const o = this.store.get(key); return o ? decode.decode(o.bytes) : null; }
  json(key) { const s = this.text(key); return s === null ? null : JSON.parse(s); }
  failNext(op, key, error = new Error("TEST injected storage failure")) {
    this.faults.push({ op, key, error });
    return this;
  }
  record(op, key, detail = {}) {
    this.ops.push({ op, key, ...detail });
    const i = this.faults.findIndex((f) => f.op === op && (f.key === undefined || f.key === key));
    if (i >= 0) { const [fault] = this.faults.splice(i, 1); throw fault.error; }
  }
  metadata(o) {
    const m = {
      key: o.key, size: o.size, etag: o.etag, httpEtag: '"' + o.etag + '"',
      uploaded: new NativeDate(o.uploaded), customMetadata: copy(o.customMetadata),
      httpMetadata: copy(o.httpMetadata),
    };
    m.writeHttpMetadata = (headers) => {
      const names = { contentType: "Content-Type", contentLanguage: "Content-Language",
        contentDisposition: "Content-Disposition", contentEncoding: "Content-Encoding",
        cacheControl: "Cache-Control", cacheExpiry: "Expires" };
      for (const [key, value] of Object.entries(m.httpMetadata)) if (names[key]) headers.set(names[key], String(value));
    };
    return m;
  }
  async get(key, options = {}) {
    this.record("get", key);
    const o = this.store.get(String(key));
    if (!o) return null;
    const m = this.metadata(o);
    if (!conditionsPass(o, options.onlyIf)) return m;
    // Capture bytes now. Later writes cannot change an outstanding read.
    const response = new NativeResponse(o.bytes.slice());
    const result = Object.assign(m, {
      body: response.body,
      text: () => response.text(), json: () => response.json(),
      arrayBuffer: () => response.arrayBuffer(), blob: () => response.blob(),
    });
    Object.defineProperty(result, "bodyUsed", { get: () => response.bodyUsed });
    return result;
  }
  async head(key) { this.record("head", key); const o = this.store.get(String(key)); return o ? this.metadata(o) : null; }
  async put(key, value, options = {}) {
    this.record("put", key, { onlyIf: options.onlyIf });
    const data = value instanceof ReadableStream ? new Uint8Array(await new NativeResponse(value).arrayBuffer()) : bytes(value);
    const current = this.store.get(String(key));
    if (!conditionsPass(current, options.onlyIf)) return null;
    this.set(key, data, options);
    return this.metadata(this.store.get(String(key)));
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) { this.record("delete", key); this.store.delete(String(key)); }
  }
  async list(options = {}) {
    const prefix = options.prefix || "";
    this.record("list", prefix, { cursor: options.cursor });
    const after = options.cursor ? Buffer.from(options.cursor, "base64url").toString("utf8") : "";
    let limit = Math.max(1, Math.min(1000, options.limit ?? 1000));
    // Observed local workerd numeric behavior: truncate, then use -1 as default.
    // Leave unobserved nonnumeric/nonfinite coercions on the existing path.
    if (typeof options.limit === "number" && Number.isFinite(options.limit)) {
      const supplied = Math.trunc(options.limit);
      if (supplied === -1) limit = 1000;
      else if (supplied < 1 || supplied > 1000)
        throw new Error("list: MaxKeys params must be positive integer <= 1000. (10022)");
      else limit = supplied;
    }
    const found = [...this.store.values()].filter((o) => o.key.startsWith(prefix) && o.key > after)
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const selected = found.slice(0, limit);
    const objects = selected.map((o) => {
      const m = this.metadata(o);
      if (!options.include?.includes("customMetadata")) delete m.customMetadata;
      if (!options.include?.includes("httpMetadata")) delete m.httpMetadata;
      return m;
    });
    const truncated = found.length > selected.length;
    return { objects, truncated, delimitedPrefixes: [],
      ...(truncated ? { cursor: Buffer.from(selected.at(-1).key).toString("base64url") } : {}) };
  }
}

export function stripeEvent(type = "checkout.session.completed", overrides = {}) {
  const baseObject = {
    id: "cs_TEST_checkout", customer: "cus_TEST_casey", mode: "subscription",
    amount_total: 9900, amount_paid: 9900, total: 9900, currency: "usd",
    customer_details: { email: "casey@example.com", name: "Casey Test" },
    customer_email: "casey@example.com", billing_reason: "subscription_cycle",
    subscription: "sub_TEST_weekly", payment_status: "paid",
    line_items: { data: [{ price: { id: "price_TEST_weekly", unit_amount: 9900 } }] },
  };
  const objectOverrides = overrides.data?.object || overrides.object || {};
  const result = { id: "evt_TEST_event", type, created: Math.floor(Date.now() / 1000),
    livemode: false, ...overrides, data: { ...(overrides.data || {}), object: { ...baseObject, ...objectOverrides } } };
  delete result.object;
  return result;
}
export function signedRequest(event, options = {}) {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const t = options.timestamp ?? Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", options.secret ?? TEST_WEBHOOK_SECRET).update(String(t) + "." + body).digest("hex");
  return new Request("https://masspermits.com/api/stripe-webhook", { method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": options.signature ?? ("t=" + t + ",v1=" + mac) }, body });
}
function signOIDC(claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID, ...header })).toString("base64url");
  const p = Buffer.from(JSON.stringify({
    iss: "https://token.actions.githubusercontent.com", aud: "masspermits-cron",
    repository: "capecodtaxappeal/masspermits-lander", ref: "refs/heads/main",
    iat: now - 5, nbf: now - 5, exp: now + 300, ...claims,
  })).toString("base64url");
  return h + "." + p + "." + createSign("RSA-SHA256").update(h + "." + p).sign(privateKey).toString("base64url");
}

export function createWorld(options = {}) {
  let now = new NativeDate(options.now ?? DEFAULT_NOW).getTime();
  const original = { Date: globalThis.Date, fetch: globalThis.fetch, HTMLRewriter: globalThis.HTMLRewriter };
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  globalThis.Date = ClockDate;
  globalThis.HTMLRewriter = HTMLRewriter;
  const r2 = new MemoryR2(options.objects || {});
  const mail = [], fetchCalls = [], pending = [], replies = [...(options.mailResponses || [])];
  const world = {
    r2, mail, fetchCalls, pending, mailResponses: replies,
    env: { BUNDLES: r2, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      RESEND_API_KEY: "re_TEST_only", FROM_EMAIL: "casey@example.com", OWNER_EMAIL: "owner@example.com",
      CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", CF_ACCESS_AUD: "aud_TEST_only", ...options.env },
    setNow(value) { now = new NativeDate(value).getTime(); },
    get now() { return now; },
    waitUntil(p) { pending.push(Promise.resolve(p)); },
    async drain() { while (pending.length) await Promise.all(pending.splice(0)); },
    request(path, opts = {}) {
      const url = new URL(path, "https://masspermits.com");
      const body = opts.body === undefined ? undefined : typeof opts.body === "string" || ArrayBuffer.isView(opts.body) || opts.body instanceof ArrayBuffer ? opts.body : JSON.stringify(opts.body);
      return new Request(url, { ...opts, method: opts.method || (body === undefined ? "GET" : "POST"), body });
    },
    async call(handler, path, opts = {}) {
      const request = path instanceof Request ? path : world.request(path, opts);
      const res = await handler({ request, env: world.env, waitUntil: (p) => world.waitUntil(p),
        next: async () => new NativeResponse("TEST next"), params: {}, data: {} });
      await world.drain();
      return res;
    },
    async oidcHeaders({ claims = {}, header = {} } = {}) { return { authorization: "Bearer " + signOIDC(claims, header) }; },
    restore() {
      globalThis.Date = original.Date; globalThis.fetch = original.fetch;
      if (original.HTMLRewriter === undefined) delete globalThis.HTMLRewriter;
      else globalThis.HTMLRewriter = original.HTMLRewriter;
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = String(init.method || input?.method || "GET").toUpperCase();
    fetchCalls.push({ url, method });
    if (url === "https://token.actions.githubusercontent.com/.well-known/jwks" ||
        url === "https://test.cloudflareaccess.com/cdn-cgi/access/certs") {
      return new NativeResponse(JSON.stringify({ keys: [TEST_JWK] }), { headers: { "content-type": "application/json" } });
    }
    if (url === "https://api.resend.com/emails" && method === "POST") {
      const raw = init.body ?? await input.clone().text();
      mail.push(JSON.parse(raw));
      const reply = replies.shift() || { status: 200, body: { id: "mail_TEST_" + mail.length } };
      if (reply.throw) throw reply.throw;
      return new NativeResponse(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? { id: "mail_TEST_" + mail.length }),
        { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    }
    throw new Error("TEST blocked external request: " + new URL(url).origin + new URL(url).pathname);
  };
  return world;
}
export async function withWorld(fn, options = {}) {
  const world = createWorld(options);
  try { return await fn(world); }
  finally { try { await world.drain(); } finally { world.restore(); } }
}

const moduleCache = new Map();
export async function loadHandlers(options = {}) {
  const sourceRoot = resolve(options.sourceRoot || process.env.REVENUE_SOURCE_ROOT || REPO);
  const rel = relative(REPO, sourceRoot);
  if (rel.startsWith(".." + sep) || rel === ".." || isAbsolute(rel)) throw new Error("Source root must stay inside this worktree");
  if (moduleCache.has(sourceRoot)) return moduleCache.get(sourceRoot);
  const load = (file) => import(pathToFileURL(resolve(sourceRoot, file)).href);
  const entries = {
    webhook: ["api/stripe-webhook.js", "onRequestPost"], weeklySend: ["api/weekly-send.js", "onRequest"],
    sendStatus: ["api/send-status.js", "onRequest"], download: ["api/my-leads.js", "onRequestGet"],
    portal: ["leads.js", "onRequestGet"], logout: ["leads/out.js", "onRequestGet"],
    upload: ["api/upload-bundle.js", "onRequest"], getObject: ["api/get-object.js", "onRequestGet"],
    preSend: ["api/pre-send-check.js", "onRequest"], mailOwner: ["api/mail-owner.js", "onRequestPost"],
    inboxStatus: ["api/inbox-status.js", "onRequest"], engagement: ["api/engagement.js", "onRequest"],
    middleware: ["_middleware.js", "onRequest"], presend: ["api/_presend.js"], notice: ["api/_notice.js"],
    lifecycle: ["api/_lifecycle.js"], githubOIDC: ["api/_github-oidc.js"], cfAccess: ["api/_cf-access.js"],
  };
  const result = {};
  for (const [name, [file, exp]] of Object.entries(entries)) { const m = await load("functions/" + file); result[name] = exp ? m[exp] : m; }
  moduleCache.set(sourceRoot, result);
  return result;
}
