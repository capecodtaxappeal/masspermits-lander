// OIDC test kit against the REAL functions/api/_github-oidc.js (not a stub).
//
//   node functions/api/oidc_harness.test.mjs
//
// A fresh RSA key pair is made with node:crypto; the fetch stub serves its
// public JWK at https://token.actions.githubusercontent.com/.well-known/jwks.
// This proves later tests (the rehearsal auth gate, acceptance 17) can sign
// RS256 tokens the shipped verifier accepts, and that it rejects the four
// shapes that must never pass. No network: the JWKS URL is the only fixture.

import { verifyGitHubOIDC } from "./_github-oidc.js";
import { makeFetchStub, makeOidcKit, makeRunner, JWKS_URL } from "../../test/rehearsal/harness.mjs";

const kit = makeOidcKit();
const stub = makeFetchStub({ [JWKS_URL]: kit.jwksHandler });
globalThis.fetch = stub.fetch;

const { check, done } = makeRunner("oidc_harness.test.mjs");
const req = (token) => new Request("https://rehearsal.test/x", {
  method: "POST", headers: token === undefined ? {} : { authorization: "Bearer " + token } });

const pos = await verifyGitHubOIDC(req(kit.sign()));
check("positive control: a valid token signed by the test key -> ok:true", pos.ok === true, pos.reason);
check("the JWKS was read from the fixture URL", stub.calls.some((c) => c.url === JWKS_URL));

const cases = [
  ["no Authorization header", undefined],
  ["aud \"other\"", kit.sign({ aud: "other" })],
  ["ref refs/heads/claude/x", kit.sign({ ref: "refs/heads/claude/x" })],
  ["exp in the past", kit.sign({ exp: Math.floor(Date.now() / 1000) - 60 })],
  ["repository someone/fork", kit.sign({ repository: "someone/fork" })],
  ["signed by a different key with the same kid", makeOidcKit().sign({}, { kid: kit.kid })],
  ["alg none", (() => { const [, p, s] = kit.sign().split("."); return Buffer.from('{"alg":"none"}').toString("base64url") + "." + p + "." + s; })()],
];
for (const [name, token] of cases) {
  const r = await verifyGitHubOIDC(req(token));
  check(`${name} -> ok:false`, r && r.ok === false, JSON.stringify(r && r.reason));
}
const r = await verifyGitHubOIDC(req(kit.sign()));
check("verifyGitHubOIDC always returns an object with a boolean ok", r && typeof r.ok === "boolean");

check("fetch stub: only the JWKS URL was called", stub.calls.every((c) => c.url === JWKS_URL));
check("fetch stub: 0 calls to non-fixture URLs", stub.unexpected.length === 0);
done();
