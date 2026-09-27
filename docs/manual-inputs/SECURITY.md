# Manual inputs: adversarial review

What was attacked, what held, what was fixed, and what is left. Every "held"
line names the test that proves it; all tests run with `node --test` and no
network (`test/manual/`).

## The surfaces

| Surface | Who may use it | Gate in code |
|---|---|---|
| `admin/drop.html` (static page) | the owner | Cloudflare Access on `/admin/*`; `functions/_middleware.js` 404s `/admin` off the apex; the page holds no data |
| `/admin/api/drop` GET, POST | the owner | `verifyOwner` (`_owner_gate.js`): apex host, the Access JWT header, RS256, aud, iss, exp, a person's token, `ADMIN_ALLOWED_EMAILS`; then `X-MassPermits-Drop: 1` and `Sec-Fetch-Site` |
| `/api/get-drop` GET | the refresh job only | GitHub OIDC (`_github-oidc.js`) plus `workflow_ref` pinned to `weekly-refresh.yml@refs/heads/main`; `KEY_RX` |
| Email intake Worker | allowed senders, and the owner's forwards | the topmost trusted Authentication-Results header; `ALLOWED_SENDERS`; `OWNER_FORWARDER` |

All three writers and the one reader reach R2 only through
`functions/api/_manual_store.js`, whose every bucket call passes `scoped()`: a
key that is not `manual-raw/index.json` or does not match `KEY_RX` throws
before the binding is touched. There is no `list` call anywhere.

## Attacks tried

### Read or write any key outside `manual-raw/`

* **Held.** `get-drop` refuses, before any R2 op: `manual-raw/../subscribers.json`,
  `%2e%2e`, `%2E%2E%2F`, double-encoded `%252e`, `%5c` and raw backslashes,
  `manual-raw/x/../../engine.tar.gz`, NUL and newline suffixes, uppercase hex,
  uppercase slugs, leading or doubled slashes, trailing space, Cyrillic `e`,
  Unicode hyphen, division slash and fullwidth dots, two `key` parameters in
  either order, an extra parameter, `KEY=`, empty, and the bare names
  `subscribers.json`, `engine.tar.gz`, `feed-send-log.json`,
  `latest-weekly.zip`, `source-health.json`. Two layers: the raw query may only
  hold `A-Z a-z 0-9 . _ - /` and `%2F`, and the decoded value must match the
  anchored ASCII `KEY_RX`. (`get-drop.test.mjs`, "key attacks")
* **Held.** The store itself refuses the same keys even if a caller were
  wrong. (`store.test.mjs`, "every R2 op of the store stays under manual-raw/")
* **Held.** The drop box builds keys only from a slug that is in
  `MANUAL_SOURCES` and matches `SLUG_RX`, a server-side timestamp, the hash,
  and an extension chosen by content. `../subscribers`, `town-a/../x`,
  `manual-raw` and uppercase slugs are refused before any read.
  (`drop.test.mjs`, "a slug not in MANUAL_SOURCES")
* **Held.** `get-object.js` READABLE and `upload-bundle.js` ALLOWED_KEYS are
  unchanged and pinned by a test. (`repo.test.mjs`)

### Write without Access

* **Held.** No token, wrong audience, expired, wrong issuer, forged
  signature, hand-made header text, `alg: none`, a service token, a valid
  token for someone else, and the `CF_Authorization` cookie without the header:
  all 403 with zero R2 ops. Missing configuration fails closed.
  (`drop.test.mjs`)
* **Held.** `masspermits-lander.pages.dev`, a preview hash host and `www`:
  404 with zero R2 ops, from both the middleware and `verifyOwner`.
* **Held.** Cross-site: a form or `fetch` from another site cannot add
  `X-MassPermits-Drop`, the preflight gets a 405 with no
  `Access-Control-Allow-*`, and `Sec-Fetch-Site` other than `same-origin` is a
  400. (`drop.test.mjs`, "cross-site requests are refused")
* **Held.** The email Worker has no `fetch` handler and `workers_dev = false`,
  so it has no web address. (`intake.test.mjs`)

### List the bucket

* **Held.** No code path calls `list`; the fake bucket in the tests has no list
  method, so any call would throw. (`repo.test.mjs`, `store.test.mjs`)

### Reach `index.json` from the public site

* **Held.** It is not a static file; `get-object.js` does not serve it;
  `get-drop` requires the refresh job's OIDC token. Keep R2 public access
  (`r2.dev` and custom domains) **off** for the bucket; this change does not
  turn it on.
* **Held.** The drop box view returns labels, dates, sizes, types and
  "drop" or "email" only: never a key, hash or file name.
  (`drop.test.mjs`, "the API never returns it")

### Get a drop into the public build

* **Held by contract.** The engine writes downloads under `$RUNNER_TEMP`,
  never under `site/` (ENGINE_CONTRACT.md, "Rules for the engine").
* **Fixed.** `.gitignore` now ignores `manual-raw/`, so a copy pulled into this
  tree by hand cannot ride a `git add -A`.
* Nothing in this change writes to the repo or to the site build.

### Caching, CORS, logs

* **Held.** `/admin/api/drop`: `Cache-Control: private, no-store`, `nosniff`,
  `noindex`, `no-referrer`, no CORS header on any response, 403 and 404
  included. `/api/get-drop`: `no-store`, `noindex`, `nosniff`,
  `Content-Disposition: attachment`, no CORS. `admin/drop` page: CSP with
  `default-src 'none'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `private, no-store` via `_headers`.
* **Held.** No `console` call in the Pages code of this change. The Worker has
  one, which prints `{event, outcome, stored, duplicate, skipped}` with the
  outcome from a fixed set. A test runs every email case and checks no line
  holds an address, a domain, a slug or a file name, including when the parser
  throws with an address as its message. (`intake.test.mjs`, "logs")
* **Held.** Exceptions never reach a response body: the drop API answers
  `503 {"error":"unavailable"}`; `get-drop` reports OIDC failures as one word
  (the `verify-error:` detail is cut off).

### Content

* **Held.** Type by content only. Refused: a renamed exe, xlsm (by part name
  and by content type), a password-protected Office file (OLE2 wrapper), a zip
  with an encrypted entry, an encrypted PDF, a PDF with JavaScript or an
  embedded file, a truncated PDF, a zip inside, an xlsx with embedded objects,
  a docx, a zip-slip path, HTML saved as csv, a one-column "csv", non-UTF-8
  text, NUL bytes, gzip, empty, and over 10 MB (by `Content-Length` before the
  body is read, and again after). Only `[Content_Types].xml` is ever inflated,
  capped at 512 KB, and the declared total size is capped against a zip bomb.
  (`store.test.mjs`, `drop.test.mjs`)
* **Held.** The original file name is reduced to a basename of at most 80
  conservative characters and is only ever stored in the private index.

### Email

* **Held.** Disallowed sender; an unlisted address at a listed address's
  domain; a spoofed From with failing DKIM and SPF; a spoofed From where the
  attacker's own domain passes; a forged `Authentication-Results` placed below
  the real one; a header from another authserv-id; no header at all.
  (`intake.test.mjs`)
* **Held.** Forwards are honoured only from `OWNER_FORWARDER` with auth passing
  for the owner's domain. A forward from anyone else, a From claiming to be the
  owner without the owner's auth, and a lookalike owner domain are refused.
* **Held.** Nothing is ever sent back: the tests hand the Worker a message
  whose `reply`, `forward` and `setReject` record calls, and assert none was
  made, in every case. A source scan also refuses those names in the Worker.
* **Held.** Over 25 MB: dropped before it is read. Attachments over 10 MB,
  zips, exes, macros and types the source does not accept: skipped in silence.
  At most 20 attachments and one level of attached message are looked at.
* **Fixed.** A whole-domain entry for a public mail service (for example the
  big free webmail domains) is now ignored in `ALLOWED_SENDERS`; such an
  address must be listed exactly. Otherwise anyone with a free account there
  would have passed.

### OIDC

* **Held.** Wrong `workflow_ref` (another workflow file, another branch,
  missing), a `job_workflow_ref` from elsewhere, wrong `ref` (a feature branch,
  a pull request), wrong repository, wrong audience, wrong issuer, expired,
  forged signature, no token: 401 with zero R2 ops. Any other workflow in this
  repo, including the customer send, cannot read drops. (`get-drop.test.mjs`)

## Also fixed during the review

* `get-drop` wraps its one R2 read, so a failure is a 503 with no text.
* `_headers` marks `/docs/*` and `/workers/*` `noindex`. The Pages build
  output is the repo root, so these files are served like every other file in
  this public repo; they hold nothing that is not already on GitHub.
* SETUP.md no longer spells out a whole address, and the test harness no longer
  names routes that the Mission Control structure test forbids.

## What is left, and why it is acceptable

1. **The trusted header.** Cloudflare's documentation does not promise which
   authentication header an Email Worker sees. The Worker trusts only the
   topmost `Authentication-Results` or `ARC-Authentication-Results` with the
   configured authserv-id, and accepts nothing when there is none. If the edge
   ever stopped adding its own header, a forged one could become topmost. SETUP
   step 8 checks the real header once. The damage is bounded: the attacker also
   needs a sender address from `ALLOWED_SENDERS`, which is a secret, and a
   stored file is only an input the engine treats as untrusted; every email
   receipt is visible on the drop page with "email" in the Via column.
2. **Gmail filter forwards.** When the office's own signature does not
   survive and only the owner's mailbox authenticates, the Worker trusts the
   owner's Gmail filter to have matched a genuine message. A spoofed message
   that got past Gmail's spam filter and matched the filter would be accepted.
   SETUP step 10 keeps Gmail's spam check on. Where the office signs its mail,
   the direct path applies and this does not arise.
3. **R2 conditional writes.** The index is updated with `onlyIf: {etagMatches}`
   (documented R2 behaviour). New objects and the first index use
   `If-None-Match: *` through `onlyIf` Headers; if R2 ever ignored that header
   on a put, the worst case is rewriting a data key with identical bytes
   (same slug, same second, same hash prefix), or losing the very first index
   write to a simultaneous first write. Neither exposes data.
4. **Two copies of `MANUAL_SOURCES`.** The Pages project and the Worker each
   hold one. If they drift, the drop box and the email intake accept different
   types for a source. SETUP says to change both.
5. **Branch hygiene tests.** Three Mission Control tests compare the branch
   diff with that project's own file list (P1-14 "diff lists only allowed
   paths", P2-5, P2-12). The first two already fail on `main`; P2-12 fails on
   any branch that adds a file. They are not about this feature and were not
   edited.
