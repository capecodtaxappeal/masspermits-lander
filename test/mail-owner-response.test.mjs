// D29 (Patrick, 2026-09-27): the owner's own address stays out of public logs.
//
// /api/mail-owner is called by send-watchdog.yml, inbox-watchdog.yml and
// weekly-refresh.yml, and each prints the response into a PUBLIC Actions log.
// It used to echo {ok, to, subject}, which published the owner's address.
// Run from a temp copy of functions/ with the OIDC check stubbed to pass and
// fetch stubbed (nothing is sent): the mail still goes to OWNER_EMAIL, and the
// response is exactly {ok:true}.
//
//   node --test test/mail-owner-response.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mail-owner-"));
fs.cpSync(path.join(REPO, "functions"), path.join(tmp, "functions"), { recursive: true });
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
fs.writeFileSync(path.join(tmp, "functions/api/_github-oidc.js"),
  "export async function verifyGitHubOIDC() { return { ok: true }; }\n");
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const OWNER = "owner.test@example.com";

async function call(status) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === "https://api.resend.com/emails") {
      sent.push(JSON.parse(init.body));
      return new Response(status === 200 ? JSON.stringify({ id: "test" }) : "error for " + OWNER, { status });
    }
    throw new Error("test fetch refused: " + url);
  };
  try {
    const mo = await import(pathToFileURL(path.join(tmp, "functions/api/mail-owner.js")).href);
    const req = new Request("https://masspermits.com/api/mail-owner?subject=Test%20alert",
      { method: "POST", headers: { "Content-Type": "text/html" }, body: "<p>hello</p>" });
    const res = await mo.onRequestPost({ request: req,
      env: { OWNER_EMAIL: OWNER, RESEND_API_KEY: "test", FROM_EMAIL: "MassPermits <leads@example.com>" } });
    return { res, text: await res.text(), sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("D29 mail-owner: mails the owner, answers exactly {ok:true}, prints no address", async () => {
  const { res, text, sent } = await call(200);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true });
  assert.ok(!text.includes("@"), text);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [OWNER], "still delivered to the owner, recipient locked server side");
  assert.equal(sent[0].subject, "Test alert");
});

test("D29 mail-owner: a provider failure answers with a status code only, no address", async () => {
  const { res, text } = await call(422);
  assert.equal(res.status, 502);
  assert.deepEqual(JSON.parse(text), { ok: false, error: "resend 422" });
  assert.ok(!text.includes("@"), text);
});
