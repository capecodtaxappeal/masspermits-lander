// Shared harness for the /api/request-sample tests (not a test file itself).
//
// Imports a temp COPY of functions/ (the shipped files are never touched),
// with an in-memory R2 and a fetch stub that records every Resend call and
// refuses everything else. Nothing leaves this machine. Every address here is
// invented and assembled at run time.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AT = String.fromCharCode(64);
export const PROSPECT = "sample.reader" + AT + "example.com";
export const ENV_FROM = "MassPermits <hello" + AT + "example.org>";

export class FakeBucket {
  constructor() { this.objects = new Map(); }
  async head(key) { return this.objects.has(key) ? { key } : null; }
  async get(key) {
    const o = this.objects.get(key);
    return o ? { key, text: async () => o.body } : null;
  }
  async put(key, value, opts) { this.objects.set(key, { body: String(value), opts }); return { key }; }
  json(key) { const o = this.objects.get(key); return o ? JSON.parse(o.body) : null; }
}

// Load request-sample.js from a temp copy of functions/ as an ES module. Each
// post() uses a new private-range IP so the per-IP brake never trips.
export async function loadRequestSample() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "request-sample-"));
  fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
  // test-only hook on the COPY, so the owner mail builder can be called directly
  fs.appendFileSync(path.join(tmp, "functions", "api", "request-sample.js"), "\nexport const __test = { notifyOwner };\n");
  process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
  return import(pathToFileURL(path.join(tmp, "functions", "api", "request-sample.js")).href);
}

// POST a body to the Function; returns the response, the bucket and every
// Resend payload it sent.
let ipSeq = 0;
export async function post(mod, body, { bucket = new FakeBucket(), ip = "10.77." + Math.floor(++ipSeq / 250) + "." + (ipSeq % 250) } = {}) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      sent.push(JSON.parse(init.body));
      return new Response("{}", { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  };
  try {
    const request = new Request("https://example.test/api/request-sample", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    });
    const res = await mod.onRequestPost({ request, env: { BUNDLES: bucket, FROM_EMAIL: ENV_FROM, RESEND_API_KEY: "test-key" } });
    return { res, bucket, sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}
