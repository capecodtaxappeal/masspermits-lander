GUARDRAILS (verbatim, non-negotiable)
- Branches depend on the PHASE (see PHASES). P1, P3, P4-SEC, P4-COR and P5 work ONLY on branch
  claude/mission-control (P1 creates it from main if absent; every later phase continues it) and
  open or update ONE pull request into main, as a draft. P2-A, P2-B and P2-C each work ONLY on
  their own branch (claude/mission-design-a, claude/mission-design-b, claude/mission-design-c),
  cut from claude/mission-control after P1, and open ONE draft pull request into
  claude/mission-control. NEVER push to main, NEVER merge a pull request, NEVER force-push,
  NEVER mark a pull request ready for review. The one merge this build ever makes is P3's local
  git merge of the owner's chosen design branch into claude/mission-control. Touch no other
  branch (you may READ branch claude/seed-mission-control; P3 may also READ the losing design
  branches; a P2 session never reads the other two design branches).
- Make NO change under .github/. This build adds no workflow.
- NEVER edit these files: functions/api/stripe-webhook.js, weekly-send.js, my-leads.js,
  send-status.js, _presend.js, _github-oidc.js, upload-bundle.js, get-object.js, _notice.js,
  inbox-status.js, funnel.js, functions/leads.js, functions/_middleware.js.
- READ-ONLY. This build fixes nothing in production. No job you write may hold
  "actions: write". Nothing you write may dispatch, re-run or cancel any GitHub workflow, by any
  means (REST path, gh CLI, or anything else). No send is ever retried.
- The repo is PUBLIC, and the site is served from the repo root, so EVERY file you add is also a
  public URL on masspermits.com. Branches, commits, PR text, fixtures and docs must contain no
  customer, subscriber, homeowner or contractor data. Synthetic fixtures only: @example.com,
  cus_TEST..., tokens like "a" repeated 32 times; towns may be real names, people and streets must
  be invented. No secrets.
- During this session make NO network call to masspermits.com, *.pages.dev, api.stripe.com,
  api.resend.com, api.github.com, *.cloudflareaccess.com or any town site. Tests make zero network
  calls; a fetch stub throws on any unexpected URL. Never run gh workflow run, gh run, gh api, or
  wrangler against Cloudflare. Never send email.
- In any NON-test file you add (anything not named *.test.mjs), including comments, never write
  these route strings: /api/weekly-send, /api/mail-owner, /api/newsletter-send, /api/newsletter,
  /api/nurture, /api/lifecycle-send, /api/request-sample, /api/agent-sample, /api/upload-bundle,
  /api/funnel, /api/hit, or "force=1". Refer to those modules by file name (e.g. funnel.js).
- If you see a secret or personal data anywhere, report path:line only, never the value. Say what
  you verified and how.

ADDITIONS FOR THIS BUILD (same force as the guardrails)
- Also NEVER edit: functions/api/_cf-access.js, pipeline.js, pipeline-now.js, pipeline-probe.js,
  pipeline-lifecycle.js, health.js, cold-status.js, traffic.js, live.js, sample.js, cf-traffic.js,
  admin/now.html, admin/pipeline.html, robots.txt. Wrap, never modify. Add no field to any
  unauthenticated route and add no unauthenticated route.
- _headers may gain EXACTLY ONE block, for the exact path /admin/mission, placed outside the
  generated widget block (the lines between "# >>> widget tier" and "# <<< widget tier"). No
  other line of _headers changes.
- Do not add package.json, package-lock.json, node_modules, wrangler.toml or _routes.json anywhere.
- No real email address anywhere, including the owner's. Test owner: owner@example.com. Test
  stranger: stranger@example.com. Test Access team domain: example-team.cloudflareaccess.com.
  Test JWTs are signed with an RSA key generated inside the test (node:crypto).
- Never write a literal that matches (sk|rk)_(live|test)_[A-Za-z0-9]{10,} or whsec_[A-Za-z0-9]{10,}
  in any file (GitHub secret scanning would flag it). Build test keys at run time, e.g.
  "rk_" + "live_" + "T".repeat(24).
- Do not import anything from the unmerged claude/monday-rehearsal branch. This build ships its
  own read-only R2 view and Stripe reader.
- Outreach town lists, contact details and the owner's strategy never enter the repo. The
  outreach object lives only in R2 and is seeded by the owner.

PHASE: P1
WINNER: (P3 only: A, B or C, the design the owner chose)
OWNER NOTES: (P3 only, optional: what the owner wants changed after comparing the three demos;
about the look only, never names, numbers or strategy, because the P3 report paraphrases them in
the public PR)
(Set these lines before pasting. Order: P1; then P2-A, P2-B and P2-C, three sessions that may
run at the same time; then the owner compares the three demos and picks one; then P3; then
P4-SEC and P4-COR, one after the other, never at the same time; then P5 only if a P4 report
leaves an item open. Every phase is a FRESH session. Read the main PR body first (the PR from
claude/mission-control into main) to see what is done, but do not trust its claims: re-run the
tests. Each phase
ends with: all tests green, a push to that phase's branch, and a PR-body section "Phase <name>
report" appended to that phase's PR, never overwriting earlier phases' sections.)

WHAT THIS IS
"Mission Control" for MassPermits: one private phone page at https://masspermits.com/admin/mission
that the owner opens to see, live, with no Claude involved: paying customers, revenue, upcoming
renewals and failed payments, whether Monday's weekly email reached every subscriber, today's data
refresh health, new sales and free-sample signups, a map of all 351 Massachusetts towns coloured by
status, and a list of things that need him. Real subscribers pay through this repo and nobody else
reviews it. The page reads R2 through the BUNDLES binding (read-only) and, only when a read-only
Stripe key is configured, makes GET calls to Stripe. It writes nothing, except an optional outreach
editor (P2) that is OFF by default and can write exactly one R2 key.

WHERE THINGS ARE
- Design notes: branch claude/seed-mission-control, docs/mission/SPEC.md (read it; this prompt wins
  where they differ). Do not copy the seed's docs/mission/* files into any branch except as stated
  below. The only docs/ file this build ever writes is docs/mission/demo.html, on the three design
  branches only (DEMO); P3 deletes it, so nothing under docs/ reaches main.
- Map geometry: branch claude/seed-mission-control, docs/mission/mission-towns.json, 61,330 bytes,
  SHA-256 e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303. Public Census
  TIGER/Line 2024 geometry for all 351 towns: {v, viewBox "0 0 2000 1272", fill_rule "evenodd",
  attribution, source, note, counties {fips: name}, aliases {lowercase variant: key}, towns {key:
  {d: svg path, l: [x, y] label point, c: county fips}}}. In P2 copy it byte for byte to
  admin/mission-towns.json (git show origin/claude/seed-mission-control:docs/mission/mission-towns.json
  > admin/mission-towns.json) and verify the hash. Never add status or outreach data to it.
- Code you reuse by import (do not edit): functions/api/_cf-access.js (verifyCfAccess,
  accessDenied), functions/api/_presend.js (gather, evaluate, headline, bestSince, dueAt,
  normalisePolicy, holdDeadline, POLICY_DEFAULTS; pure, no fetch; gather(env, {hash: false}) reads
  presend-policy.json, refresh-status.json, feed-send-log.json, last-send-attempt.json and heads
  latest-weekly.zip / latest-monthly.zip).
- Patterns to copy (read, do not import): functions/api/pipeline-now.js scrub() (the privacy walk)
  and its "not measured" list; functions/api/pipeline.js lazy ?view=coverage and its per-town state
  rules; functions/api/health.js portal stale/drift rule (8 days, 15 minutes).

R2 OBJECTS (shapes only; production values are never available to you)
- refresh-status.json: ok, degraded, error, traceback, contracts, count, ran_at, coverage{
  live_sources, expected_sources, attempted_sources, lost_sources, rows, disclose, monthly_sources[]},
  sources{"Town, MA": rows}, errors{"Town, MA": str}, cadence{"Town, MA": "monthly"},
  newest{"Town, MA": "YYYY-MM-DD"}, source_health{tracked, by_state{}, dead[], failing[], collapsed[],
  vanished[], stale[], events[]}. Its upload is best-effort and can miss while the bundles ship, but
  it is also uploaded when the run fails. The engine writes ok:false with degraded:false ONLY when
  the refresh crashed, the bundle build crashed, or a quality gate aborted the run (error "refresh
  crashed", "bundle build crashed", or starting "ABORT:"); a degraded run is written ok:false WITH
  degraded:true. weekly-send.js:61-63 refuses to send on exactly ok === false && !degraded.
  FAILURE SHAPES. The objects above are what a run that passed every gate writes. The engine fills
  every data member from the run's result, and a failed run has a partial result or none. Its
  status still reaches R2, because the upload step is if: always() (weekly-refresh.yml:1151-1152).
    "refresh crashed":      coverage, count, sources, errors, cadence, newest and contracts are ALL
                            null. Set: ok false, degraded false, error, traceback, ran_at, runner.
    "ABORT: ..." (a gate):  coverage null. count, sources, errors, cadence and newest are as far as
                            the scrape got; contracts is null, or an object for the contracts floor.
    "bundle build crashed": coverage null. count, sources, errors, cadence, newest, contracts set.
  Only ok:true and degraded:true runs carry a coverage object. source_health is present on every
  shape when the engine's health step ran, and absent when it did not.
  NULL RULE. Every reader treats a member that is null, missing or not the expected type (object,
  number) as absent, and never dereferences it. So on a failure shape: no source facts come from
  this file (the map's production union, sourceTriage and ek then come from source-health.json
  alone), there is no coverage_disclosed line, and detail.refresh.coverage is null (count too, when
  it is null). A null member never turns a tile grey and never reaches the top-level catch. On the
  crash day both views answer 200 with the refresh tile red; a 503 there would hide the one state
  the refresh tile exists to show (P1-12 D18/D19).
- source-health.json (~220 KB): version, updated_at, last_scored_at, totals{by_state, dead, failing,
  stale, collapsed, vanished, tracked}, sources{"Town, MA": {state, cadence, first_seen, last_good,
  last_good_rows, consecutive_failures, consecutive_low, last_error, last_error_at, alerted_at,
  alert_kind, newest_seen, newest_advanced_at, recent[{at, rows, ok, err}], ...}}. States seen: ok,
  dead, failing, vanished, collapsed, stale. last_good is written on every run that returned rows
  (so for a dead or failing source it is when it last worked); alerted_at is RE-WRITTEN every 7 days
  while a source stays down, so it never says when a problem started. Do not use it for recency.
  After a run the engine cannot score (the "refresh crashed" shape: no sources and no errors) it
  leaves sources{} and totals exactly as the last scored run wrote them, bumps runs_seen, and adds
  runs_unscored, last_unscored_at and last_unscored_why (a copy of the refresh error). updated_at
  moves; last_scored_at does not. So the map keeps its colours on the crash day.
- ENGINE TEXT: refresh-status error, traceback, contracts and every errors{} value, and source-health
  last_error, recent[].err and last_unscored_why, are free text written by the scraper engine. They
  can hold anything a town's site returned, runner paths, and PROPERTY OWNERS' NAMES: the engine's
  own owner-name guard raises "the owner name '<NAME>' reached a shipped row ..." and that message
  lands in errors{} and last_error, and a gate abort can quote a town's error inside the refresh
  error. Read them ONLY as input to errKind() / failKind() (see ENGINE TEXT RULE); never emit them,
  whole, cut, redacted or hashed.
- probe-map.json (~260 KB, uploaded by hand): generated_at, registry{available, generated, towns[{
  name, county, method, feasibility, already_live, ...}]}. It also has a "sources" member holding
  private endpoint detail: never read it into the payload, never log it.
- feed-send-log.json: array, newest first, max 12: [{at, subscribers, sent[{to, ok, error?}],
  skipped?, bundle_etag, coverage{...}}]. sent[].to is a customer email.
- last-send-attempt.json: {at, subscribers, degraded}.
- subscribers.json: array [{email, name, customer, since "YYYY-MM-DD", active, token (32 hex),
  cancelled?, payment_failing?, payment_detail?}]. No product, price or renewal date. name is set
  by whoever buys (attacker-controlled).
- delivery-log.json: array, max 50: [{at, to, kind: "monthly"|"weekly", bundle}]. monthly = a new
  checkout (pack, feed or trial start), weekly = a renewal invoice. No amounts.
- funnel-metrics.json: array, newest first: [{at, paying, paying_total, payment_failing,
  no_customer_id, newsletter{...}, prospects{...}}]. Read it; never call the funnel route (it writes).
- engagement.json: {at, counts{cancelled, payment-failing, unattributable, warming,
  never-downloaded, lapsed, healthy}, rows[...]}. Use counts only.
- Prefixes whose KEYS ARE EMAIL ADDRESSES: prospects/ (customMetadata {stage, ts, trade}),
  agent-prospects/ ({ts, town, stage}), newsletter/ ({c "0"|"1", un "0"|"1", ts, tok, town?}; tok is
  a credential). Count only. Never emit a key, never emit tok.
- latest-weekly.zip, latest-weekly.html, latest-monthly.zip: head() only, never get().
- admin/outreach.json (NEW, owner-seeded, may be absent): see OUTREACH.
- Never read: cold-queue.json, suppression.json, referral/*, dl/*, portal-access/*, engine*.tar.gz.

TEST METHOD (use it everywhere)
Tests live ONLY in test/mission/*.test.mjs plus shared helpers in test/mission/_harness.mjs and
(from P2) test/mission/_demo.mjs (a pure HTML assembler for DEMO: no fetch, no stub, no file
write, no top-level side effect), run
with `node --test test/mission/` (Node 20+, built-in node:test and node:assert, no dependencies).
Test the SHIPPED source, never an edited copy: the harness copies every file under test and each
file it imports (functions/api/_cf-access.js, functions/api/_presend.js and your new files, keeping
their relative layout) byte for byte into a temp dir with a {"type":"module"} package.json and
imports from there. Fakes: an in-memory R2 (get/head/list/put/delete; every op recorded with key;
objects carry etag, httpEtag, uploaded, size, customMetadata; list honours prefix, limit, cursor,
truncated and include). Etags are production-shaped: etag is the 32-hex lowercase MD5 of the object's
body (node:crypto createHash("md5")), httpEtag is the same value in double quotes, and every fixture
feed-send-log entry carries a 32-hex bundle_etag. Never a short or made-up etag: production R2 etags
are MD5 hex and the privacy walk's 32-hex rule matches them. A global fetch stub, installed only
inside test files, that serves the test JWKS at https://example-team.cloudflareaccess.com/cdn-cgi/access/certs and fixture Stripe URLs, records
every call, and THROWS on any other URL; an RS256 JWT minter (node:crypto generateKeyPairSync,
JWK export with a kid). _cf-access.js caches the JWKS per isolate keyed by issuer: a test that needs
a fresh fetch (e.g. "certs endpoint throws") uses a different team domain. Every clock in the code
under test comes from a `now` you can inject (Date.now() only as the default at the route edge).

FILE RULES
- New non-test files under functions/ may ONLY be: functions/api/_owner_gate.js,
  functions/api/_mission_r2.js, functions/api/_mission_stripe.js, functions/api/_mission_data.js,
  functions/admin/api/mission.js and (P2, editor) functions/admin/api/mission-outreach.js. Any other
  .js under functions/ becomes a public route bundled into the same Worker as the paid send.
- The four _-prefixed helpers export no onRequest* name. mission.js exports onRequestGet ONLY;
  mission-outreach.js exports onRequestPost ONLY.
- IMPORT ALLOWLIST for those files: ./_cf-access.js, ./_presend.js, ./_owner_gate.js,
  ./_mission_r2.js, ./_mission_stripe.js, ./_mission_data.js (from functions/admin/api/ the same
  files as ../../api/<name>). No node: import, no dynamic import(), nothing else. No
  "globalThis.fetch =" or "self.fetch =" in any non-test file.
- OUTBOUND: the regex (?<![A-Za-z0-9_$.])fetch\s*\( matches EXACTLY ONCE across the new non-test
  files under functions/, inside stripeGet() in _mission_stripe.js. \.fetch\s*\( matches 0 times.
  0 matches for "typeof fetch", "globalThis.fetch", "self.fetch" or [=:?(,]\s*fetch(?![A-Za-z0-9_$]).
  stripeGet(url) throws "outbound_blocked" (no call) unless new URL(url).origin ===
  "https://api.stripe.com" and the method is GET. The only other network read is the JWKS fetch
  inside the unedited _cf-access.js.
- WRITES: in P1 files, 0 matches for "\.put\(", "\.delete\(", "createMultipartUpload",
  "resumeMultipartUpload". Only mission-outreach.js (P2) may contain ".put(", exactly once.
- Static page files (P2) may ONLY be: admin/mission.html, admin/mission-app.js,
  admin/mission-render.js, admin/mission-view.js, admin/mission-app.css, admin/mission-towns.json.
- docs/mission/demo.html (DEMO) exists ONLY on the three design branches. P3 deletes it and makes
  the structure test refuse any path under docs/, so it never reaches main (every file on main is
  a public URL, and a page of invented revenue on masspermits.com would read as real).

ARCHITECTURE (build exactly this)
1. functions/api/_owner_gate.js: verifyOwner(request, env) -> {ok:true, email} or {ok:false,
   status, reason}, first failure wins, NOTHING else read before it passes:
   0. new URL(request.url).hostname.toLowerCase() !== "masspermits.com" -> 404 "Not found" (www,
      masspermits-lander.pages.dev, <hash>.masspermits-lander.pages.dev and
      heartbeat.masspermits-lander.pages.dev all 404; heartbeat is main republished daily and does
      get a Pages build).
   1. CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_ALLOWED_EMAILS each non-empty after trim, else
      403 not-configured. ADMIN_ALLOWED_EMAILS is a comma list, trimmed, lowercased, empties dropped.
      No default, no fallback to OWNER_EMAIL or any other variable.
   2. request.headers.get("cf-access-jwt-assertion") empty -> 403 no-assertion-header (a valid
      CF_Authorization cookie alone must fail; _cf-access.js would fall back to it).
   3. verifyCfAccess(request, env) not ok -> 403 with its reason; any reason starting
      "verify-error" is reported as exactly "verify-error" (never the exception text).
   4. payload.type !== "app" -> 403 token-type; email not a non-empty string, sub empty, or
      common_name present -> 403 not-a-person; nbf or iat more than 60 s in the future -> 403
      not-yet-valid.
   5. email (trim, lowercase) not in the allowlist -> 403 not-owner.
   Also export denied(auth, request) (an HTML navigation gets accessDenied(); a fetch gets JSON
   {error:"unauthorized", reason} with reason from the fixed set above) and secHeaders() used on
   EVERY response of both routes, 403 and 404 included: Content-Type, Cache-Control: private,
   no-store, X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, X-Content-Type-Options: nosniff,
   Referrer-Policy: no-referrer, and no Access-Control-Allow-* header. Any throw before step 5
   passes ends in 403 verify-error, never 500, never 200.
2. functions/api/_mission_r2.js: readView(bucket) returns a frozen plain object with exactly get,
   head, list (pass-through) and a non-enumerable ops counter. put, delete, createMultipartUpload do
   not exist on it. Every route reads R2 ONLY through it (the editor gets a separate one-key writer,
   see OUTREACH).
3. functions/api/_mission_stripe.js: stripeSnapshot(env, now, deps) -> {state: "not-connected" |
   "refused" | "partial" | "ok" | "unavailable", reason, ...projection}. Key rule, before any call:
   STRIPE_READ_KEY must match /^rk_live_[A-Za-z0-9]{10,}$/; missing -> not-connected; any other
   shape (sk_..., *_test_*, whitespace) -> refused, 0 calls. MASSPERMITS_PRICE_IDS (comma list)
   empty -> not-connected "price list missing", 0 calls. Headers: Authorization Bearer, Stripe-Version
   2026-08-26.dahlia, Accept application/json. Never expand customer. Calls (limit=100, follow
   has_more with starting_after = the last object's id only if it matches ^[a-z]+_[A-Za-z0-9]+$, at
   most 3 pages each; still has_more -> that section "partial"):
     GET /v1/subscriptions?status=all
     GET /v1/invoices?status=paid&created[gte]=<now-30d>
     GET /v1/invoices?status=open
     GET /v1/checkout/sessions?status=complete&created[gte]=<now-30d>&expand[]=data.line_items
     GET /v1/webhook_endpoints
   Keep an object only if one of its items/lines has a price id in MASSPERMITS_PRICE_IDS; read the
   id from line.price.id OR line.pricing.price_details.price (test both). Never filter by amount (the
   Stripe account also serves another product). Renewal dates come from
   items.data[].current_period_end (they are NOT on the Subscription object on this API version).
   Entitled = active | trialing | past_due. Projection only (ids, status, amounts, dates, price id,
   interval, cancel_at_period_end, trial_end, attempt_count, billing_reason, enabled_events
   membership); cache that projection per isolate for 5 minutes; never cache or return a raw object.
   A non-2xx or unparseable response -> that section "unavailable", never zero.
   Per-isolate caches (Stripe projection, map projections) are module-level and each module that
   holds one exports resetMissionCaches() so tests start clean; no other test hook in shipped files.
4. functions/api/_mission_data.js: PURE (no I/O, no Date.now()). Constants at the top, each with
   its reason. Exports at least: refreshState, mondayReach, tiles, needsYou, mapCategories,
   errKind, failKind, sourceTriage, maskEmail, cleanName, privacyWalk. Rules in TIMING, MONDAY,
   TILES, NEEDS YOU, MAP, ENGINE TEXT RULE, PRIVACY below.
5. functions/admin/api/mission.js: onRequestGet. verifyOwner first. Then require header
   X-MassPermits-Mission: 1 and, if Sec-Fetch-Site is present, "same-origin" (else 403). Query: only
   view, absent or "map"; anything else (or any other parameter) -> 400 {error:"bad_param"} with no
   R2 read. No parameter may change which identity fields are emitted. One top-level try/catch
   returns 503 {error:"unavailable"} after auth; never put e.message, e.stack or an R2 body in a
   response or a console line. console.* receives nothing from the payload.
   Build `const ro = readView(env.BUNDLES)` once and pass `{...env, BUNDLES: ro}` to gather() too,
   so every R2 op, including _presend.js's, goes through the view and is counted.
   Default view reads (≤ 25 R2 ops): gather(env,{hash:false}) (6 ops); head refresh-status.json;
   head latest-weekly.html; subscribers.json; funnel-metrics.json; delivery-log.json;
   engagement.json; head admin/outreach.json; head probe-map.json; head source-health.json and get
   it only when its etag differs from the cached projection (NEEDS YOU needs per-source last_good,
   first_seen and consecutive_low, which refresh-status does not carry); list prospects/,
   agent-prospects/, newsletter/ with include ["customMetadata"] (up to 3 pages each; still
   truncated -> "at least N"). Worst case is exactly 6 + 8 + 2 + 9 = 25. Plus stripeSnapshot.
   ?view=map reads (≤ 6 R2 ops cold, ≤ 4 warm): head + get source-health.json and probe-map.json
   (get only when the head etag differs from the per-isolate cached projection; the etag stays in
   that cache and never enters a payload), get refresh-status.json, get admin/outreach.json.
   Both views share ONE source-health projection (per key: state, cadence, first_seen, last_good,
   consecutive_low, ek) and its etag cache. Keep that cache and the probe-map cache in
   _mission_r2.js (it may export a helper such as cachedProjection(ro, key, project) plus
   resetMissionCaches()); route files hold no module state.

PAYLOAD (default view; exact top-level keys)
{ok, v:1, now, signed_in_as, outreach_edit, headline:{state:"red"|"amber"|"clear", text},
tiles:[8], needs_you:[{id, severity:"red"|"amber"|"known", text, where}], detail:{customers,
renewals, failed_payments, monday, refresh, sales, signups, engagement, not_measured, setup},
privacy_redactions}
Tile: {id, label, state:"green"|"amber"|"red"|"grey", grey?:"not-connected"|"unavailable"|
"unverified"|"pending" (present iff state is grey), value, sub, source:"stripe"|"r2"|"none", as_of}.
Unknown or unreadable is grey "unavailable", NEVER green, never 0: a grey tile's value is null, with
one exception, grey "unverified", which carries a measured count whose completeness this page cannot
confirm (only the failed tile uses it, see TILES). grey "pending" is "not yet" (refresh before
due + 8 h, Monday before the hold hour): it is never "unavailable" and never raises a needs-you line.
detail.refresh carries ONLY: ran_at, ok, degraded, fail_kind (failKind), coverage.{live_sources,
expected_sources, attempted_sources, lost_sources, rows, disclose}, count, the uploaded times of the
status file and the bundles, same_bundle_as_last_send (boolean), and sources:[{town, state, since,
ek, recent}] for every non-ok source. Never error, traceback, contracts, runner, or an errors{} value.
On a FAILURE SHAPE (R2 OBJECTS) detail.refresh.coverage is null, not an object of zeros, and count
is null whenever the status's count is null (NULL RULE).
Customer-level rows (customers, renewals, failed_payments, monday.missing, monday.failed, sales)
carry only: name
(cleanName), email_masked (maskEmail), t8, plan, status, since, date, amount_cents, currency,
stripe_url. setup lists: stripe (not-connected | refused | ok), price list, webhook events
(invoice.payment_failed and customer.subscription.deleted registered or not, or "unknown"),
outreach object (present | absent | unreadable), registry date.
Map view: {ok, v:1, now, as_of:{refresh, source_health, registry, outreach}, counts:{code: n},
towns:{key: {k: code, rows?, newest?, state?, cadence?, ek?, o?, os?, planned?, lk?}},
unmatched:[production keys], outreach_ignored:[names], opengov:{registry: n, owner_list: n},
privacy_redactions}. Towns with code "none" and no other fact are omitted (the page defaults them).
ek is errKind() of refresh-status.errors[key] when present, else of source-health last_error when the
state is not ok; it is one of the fixed ENGINE TEXT RULE codes, never text from the engine.
R2 METADATA IN PAYLOADS: from any R2 head or object, emit only uploaded (as an ISO string) and size.
Never emit an etag, httpEtag, bundle_etag or version value in either view, not whole, not shortened,
not hashed, not under another name. Production etags are 32-hex MD5, so one in a payload trips the
privacy walk and makes a permanent red line. Compare etags server-side and emit the result as a
boolean (e.g. same_bundle_as_last_send). as_of values in both views are ISO times. gather() returns
bundle heads carrying etag (functions/api/_presend.js:152-162) and log entries carrying bundle_etag
(weekly-send.js:126,135,169): project named fields from them, never spread or pass through a head, a
gather() result or a log entry.
ENGINE TEXT RULE (owner names): no engine text (see ENGINE TEXT under R2 OBJECTS) enters either view,
a needs-you line, a detail section or a console line, in any form. privacyWalk cannot catch a person's
name, so the only protection is never emitting the text. That includes _presend.js's own strings:
evaluate() puts status.error into its reasons on a failed run ("the last refresh FAILED (...)",
_presend.js:292-293) and headline() returns "Will not send: " + reasons[0], so neither evaluate()'s
reasons nor headline()'s text may enter either view. Classify server-side instead:
- errKind(s) -> exactly one of these codes, first matching rule wins, tested in this order:
    owner_name_gate    /owner name|rule 5/i   (checked first: its message also carries a row id)
    access_controlled  /\b40[13]\b|authori[sz]ation decision|login wall|requires_credentials|robots/i
    no_rows            /returned \d+ rows|no rows|silently dead/i
    timeout            /timed? ?out/i
    http_error         /\bHTTP\b|\b[45]\d\d\b|URLError|connection|SSL/i
    parse              /pars(e|ing|er)|column|header|decode|JSON/i
    other              anything else, including a non-string or empty value
- failKind(error), only for a run with ok === false && degraded !== true (absent otherwise) ->
  "crash" (/crashed/), "gate" (/^ABORT\b/), else "unknown".
The page turns each code into a fixed sentence (PAGE). access_controlled's sentence is "Blocked by
the town's site. That is an authorization decision: do not retry, it will not come back by itself."

TIMING (measured; do NOT copy pipeline-now.js's 4 h refresh grace or its 1.5 h send grace, which are
red on most healthy days: the refresh has landed 13:06-16:00 UTC and Monday sends have logged
15:20-18:46 UTC. DO copy its due anchor, lastDue(now, 9), pipeline-now.js:93,256-261)
- Refresh: due = the most recent 09:00 UTC at or before now (cron "0 9 * * *" via two lines). From
  00:00 to 08:59 UTC that is YESTERDAY 09:00, so yesterday's healthy run stays green overnight; never
  compute due as "today 09:00", which is still in the future before 09:00 UTC. Constants:
  REFRESH_DUE_HOUR_UTC 9, REFRESH_GREY_H 8 (due + 8 h = 17:00 UTC), REFRESH_MAX_AGE_H 36.
  Evaluate in this order, first match wins:
  1. refresh-status.json missing (head null) or ran_at unparseable -> red. (A read that throws is
     grey "unavailable", the general rule.)
  2. ran_at older than 36 h -> red.
  3. ok === false && degraded !== true -> RED "The data refresh failed" (failKind: crashed / stopped
     by its quality gate). This is the state weekly-send.js:61-63 refuses to send on, so it is red
     whenever it is the latest status, whether ran_at is before or after due; it is never amber and
     never grey "pending". If now is a Monday (UTC) and no feed-send-log entry has delivered since
     that Monday 12:00 UTC, the needs-you text adds "Monday's email will not send while this is
     the latest run."
  4. ran_at ≥ due: degraded === true -> amber "reduced run"; otherwise green.
  5. ran_at < due and latest-weekly.zip uploaded ≥ due -> amber "bundles shipped, status file did
     not upload".
  6. ran_at < due and now < due + 8 h -> grey "pending", "not landed yet, usually 13:00-16:00 UTC".
  7. ran_at < due and now ≥ due + 8 h -> red.
  So grey iff ran_at < due and now < due + 8 h and the latest status is not a failure (and rules
  1-3, 5 did not fire); red iff the file is missing, ran_at is older than 36 h, the latest run failed
  (ok false, not degraded), or ran_at < due at or after due + 8 h. A red from a missed day stays red
  across midnight UTC; it does not flip back to grey. Never emit refresh-status error, traceback or
  contracts (ENGINE TEXT RULE); fail_kind carries the reason.
- Monday: p = normalisePolicy(presend-policy); due = dueAt(now, p); hold = holdDeadline(now, p)
  (20:00 UTC Monday by default). best = bestSince(feed-send-log, due). Before hold with no delivered
  entry: grey "pending", "not sent yet; recent sends 15:20-18:46 UTC". Other days show the last
  Monday.
- Portal: health.js rule (html vs zip heads: older than 8 days = stale, more than 15 minutes apart =
  drift) -> amber needs-you.

MONDAY (who should have got it)
Normalise emails (trim, lowercase) server-side only. Delivered = ok:true entries in every log entry
at or after due. Expected = active roster rows with since < the Monday's date. missing = expected
not delivered; failed = ok:false entries with no later ok for the same address; duplicate = the
same address ok more than once since due. Rows with since == the Monday date and not delivered are
"joined on send day" (listed, never red); since > Monday are "new since Monday". red: any failed,
any missing, only skipped entries, nothing delivered by hold, or last-send-attempt.at ≥ due with
no result. amber: duplicates, or roster unreadable while a delivery exists ("cannot confirm
everyone"). green otherwise. Always carry the caveat: "Resend accepted it; there is no bounce or
open tracking."

TILES (ids and rules)
paying (Stripe: entitled MassPermits subscriptions, trials in sub; else roster active count with
source r2 and sub "roster: feed and radar mixed, trials included"; amber if lower than the
funnel-metrics snapshot about 7 days earlier); revenue (Stripe only: gross paid invoices + payment-
mode sessions without an invoice, last 30 days; sub "list-price run rate $X/mo"; else grey "not
connected"); renewals (Stripe only: entitled subs whose earliest items current_period_end is within
14 days; amber if any cancel_at_period_end); failed (see FAILED TILE below); monday; refresh;
sales (7 days: delivery-log monthly count; with Stripe add gross and split new-subscription vs pack;
green when readable); signups (7 days: prospects + agent-prospects + newsletter by customMetadata ts;
sub shows the split; green when readable).
FAILED TILE (never green on the roster alone):
- Stripe state "ok" (every section complete; partial, unavailable, refused and not-connected are not
  ok): value = past_due/unpaid MassPermits subscriptions + open MassPermits invoices with
  attempt_count > 0, source stripe. red if > 0, green if 0. Roster payment_failing rows still go in
  detail.failed_payments.
- Any other Stripe state: value = roster rows with payment_failing set, source r2. red if > 0. If 0:
  state grey, grey "unverified", value 0 (shown, not null), sub "webhook flags only; registration not
  verified". Reason: that flag is written only by stripe-webhook.js's event handlers
  (flagPaymentIssue, called at stripe-webhook.js:62 for invoice.payment_failed and :118 for
  Radar/dispute events), and nothing has confirmed those events are registered on the Stripe
  endpoint (pipeline-now.js:210-213 lists the sibling event as unknown). Only the webhook_endpoints
  read, which needs the Stripe key, can confirm it, so a 0 here can mean "no failures" or "no
  signal".
- Roster unreadable and Stripe not ok: grey "unavailable", value null.
paying_drop compares like with like, whatever source the tile's value uses: the roster active count
now (weekly-send.js:78 filter, s.email && s.active !== false) against funnel-metrics paying of the
entry nearest to now - 7 days (same filter, funnel.js:71). Never compare a Stripe count to it.
Headline: see NEEDS YOU. Only red and amber lines can be the headline.

NEEDS YOU (every line has a fixed id and a fixed severity; each names where to act)
- Severity is exactly one of red, amber, known, and comes from the table below, never from the
  builder's judgement: "refresh" and "monday" take their tile's colour (red or amber); every other
  id has the one severity shown. "known" = a standing condition, or one below the engine's own alert
  threshold: listed on the page (a collapsed "Known, not new" group under Needs you) but NEVER the
  headline, however many there are.
- Headline: the first red line in table order, else the first amber, else exactly "Nothing is wrong
  that this page can see." with headline.state "clear". Known lines are ignored by the headline.
- Every tile that is red or amber produces exactly one line of the same severity. A tile grey
  "unavailable" produces the "unreadable" line. Grey "pending", "not-connected" and "unverified"
  produce no red or amber line. So "clear" implies no tile is red, amber or grey "unavailable".
- Never raise a red or amber line from data that is only "not yet".
  id                   sev    fires when
  privacy              red    privacy_redactions > 0
  refresh              red    refresh tile red (text names which rule: missing, older than 36 h,
                              failed with fail_kind and the Monday clause, not landed by 17:00 UTC)
  monday               red    monday tile red
  failed_payments      red    failed tile red
  refresh              amber  refresh tile amber (reduced run; or bundles shipped, status missed)
  monday               amber  monday tile amber
  paid_not_served      amber  entitled Stripe subscription on a MassPermits price, no roster row with
                              that customer ("paid, maybe not served: check Stripe")
  sources_down         amber  ONE line for every source SOURCE TRIAGE marks recent: "N source(s) down
                              in the last 7 days: Town (dead since YYYY-MM-DD), Town (collapsed, N
                              runs), ... See the map." (at most 5 towns named, then "+k more")
  unreadable           amber  any tile grey "unavailable": "Could not read: <tile labels>. Reload; if
                              it stays, check /admin/pipeline."
  paying_drop          amber  paying tile amber
  renewals_ending      amber  renewals tile amber (cancel_at_period_end within 14 days)
  served_not_paid      amber  roster active row whose customer has no entitled MassPermits
                              subscription (Stripe state ok only)
  unknown_price        amber  unknown price ids on customers that also hold a MassPermits price
  webhook_events       amber  Stripe connected and invoice.payment_failed or
                              customer.subscription.deleted not in any enabled_events
  no_customer_id       amber  newest funnel-metrics no_customer_id > 0 (a cancellation cannot match)
  portal               amber  portal stale or drift
  stripe_refused       amber  STRIPE_READ_KEY set but not a restricted live read key (0 calls made)
  outreach_unreadable  amber  admin/outreach.json present but unreadable
  coverage_disclosed   known  coverage.disclose === true (weekly-send.js:65-70 tells subscribers
                              coverage is reduced and keeps saying so until coverage returns);
                              coverage is null on every FAILURE SHAPE, so no line then
  sources_blocked      known  sources with ek access_controlled; the ENGINE TEXT RULE sentence; the
                              page never suggests retrying (the engine's rule: never retried)
  sources_vanished     known  state vanished (dropped from the engine's registry, pipeline.js:339)
  sources_down_long    known  dead or collapsed, not recent: "down since YYYY-MM-DD"
  sources_failing      known  state failing: failed its latest run; the engine calls a source dead
                              only after 3 failed runs and 48 h, and emails the owner then
  sources_stale        known  state stale (frozen window; the engine emails once per episode)
  registry_age         known  probe-map.json uploaded more than 30 days ago (updated by hand)
  stripe_not_connected known  STRIPE_READ_KEY or MASSPERMITS_PRICE_IDS missing
  stripe_partial       known  a Stripe section still had has_more after 3 pages ("at least" totals)
  outreach_absent      known  admin/outreach.json absent (owner setup step 4 not done)
  engagement           known  engagement never-downloaded or lapsed > 0 (standing counts; this page
                              keeps no history, so it cannot tell a new case from an old one)
SOURCE TRIAGE: sourceTriage(projection, refreshStatus, now), pure. Per-source lines are collapsed by
id: one line per id, listing the towns, never one line per town. Constants: SOURCE_RECENT_DAYS 7;
COLLAPSE_ENTRY_RUNS 3 (the engine needs 3 low runs to call a source collapsed); one scored run per
day (the refresh cron is daily). A production key is triaged when its source-health state is not ok,
or it is in refresh-status.errors (a key in errors whose record is absent or "ok" is "failing"; a
null errors adds no key, NULL RULE). First match wins:
  1. ek access_controlled -> sources_blocked, whatever the state or age.
  2. vanished -> sources_vanished.  3. failing -> sources_failing.  4. stale -> sources_stale.
  5. dead: since = last_good, else first_seen. Recent iff since is within 7 days of now; missing or
     unparseable counts as recent. Recent -> sources_down, else sources_down_long.
  6. collapsed: recent iff consecutive_low <= 3 + 7 (missing or not an integer counts as recent).
     Recent -> sources_down, else sources_down_long.
Never use alerted_at or alert_kind for recency: the engine re-writes them every 7 days while a
source stays down, so a months-old outage would look new one day a week. A line's text carries town
names, states, dates and the fixed ek sentence only (ENGINE TEXT RULE).

MAP (per town; first match wins; codes and legend text are fixed)
Join: production keys are "Town, MA"; strip ", MA", exact match to mission-towns.json keys, then its
aliases (lowercased). A production key that still does not match goes to "unmatched" (never dropped).
Production = union of refresh-status.sources, refresh-status.errors and source-health.sources (a
null member adds nothing, NULL RULE; on the "refresh crashed" shape the map is source-health alone).
  dead     "Stale or dead source": in production and (state in dead|failing|collapsed|vanished|stale,
           or key in errors, or no source-health record and rows is 0 or absent); or registry
           feasibility "built_not_wired" (label "paused")
  weekly   "Live, weekly": in production, state ok (or no record and rows > 0), no cadence
  monthly  "Live, monthly or slower": same with a cadence value (refresh-status.cadence or record)
  answered "Outreach answered": outreach answered or declined
  sent     "Outreach sent": outreach sent
  locked   "Locked behind OpenGov": outreach locked === true, or locked !== false and registry
           method === "opengov"
  none     "Not covered"; outreach planned adds planned:1 (a dashed outline), never a colour
NEVER use registry already_live, meta already_live lists or feasibility "live" for colour. Report
opengov.registry (method opengov count) and opengov.owner_list (locked true count) side by side.

OUTREACH (admin/outreach.json; never in the repo)
{version:1, updated_at, towns:{Key:{outreach?: "planned"|"sent"|"answered"|"declined", since?:
"YYYY-MM-DD", locked?: boolean, note?: string}}, history?:[{at, town, from, to}]}. On read: ignore
unknown towns (list them), drop unknown fields and bad enums, truncate note to 80 chars and redact
anything email- or phone-shaped in it, and treat > 64 KB or unparseable as "unreadable" (no outreach
colours, a needs-you line). Fixtures use only the towns Adams, Alford and Ashfield for outreach.

PRIVACY
- maskEmail("jane.doe@example.com") -> "j… · example.com"; the output never contains "@"; a value
  without exactly one "@" -> "hidden".
- cleanName: strip U+0000-U+001F, U+007F-U+009F, U+200B-U+200F, U+202A-U+202E, U+2066-U+2069,
  collapse whitespace, cut to 80; empty -> "(no name)".
- t8 = first 8 chars of a 32-hex token, else null. stripe_url only from ids matching
  ^(cus|sub|in)_[A-Za-z0-9]{6,64}$ as https://dashboard.stripe.com/<customers|subscriptions|invoices>/<id>.
- Signups: counts by UTC day, trade counts (prospects), agent count, newsletter confirmed/pending
  (un "1" excluded). No identity at all, not even masked. Never emit tok.
- privacyWalk(payload): on every string except the value of signed_in_as, replace
  [^\s<>@"]+@[^\s<>@"]+\.[A-Za-z]{2,}, \b[0-9a-f]{32}\b, \b(sk|rk)_(live|test)_[A-Za-z0-9]+,
  \bwhsec_[A-Za-z0-9]+, \bre_[A-Za-z0-9]{8,}, and any "prospects/" or "newsletter/" substring;
  count replacements into privacy_redactions and add a red needs-you line if > 0. It runs last on
  every 200 response of both views.
- The 32-hex rule also matches production R2 etags (MD5 hex) and feed-send-log bundle_etag values.
  Keep the rule as written; the fix is upstream: no etag ever enters a payload (PAYLOAD, "R2 METADATA
  IN PAYLOADS"). Never exempt a key name such as etag from the walk.
- Names are not regex-shaped, so the walk cannot catch a homeowner's or contractor's name. Engine
  text is therefore never emitted at all (ENGINE TEXT RULE): per-town errors appear only as ek codes,
  a failed refresh only as fail_kind. No member named err, error (in a 200 body), traceback,
  last_error, last_unscored_why or contracts at any depth of either view.

PAGE (P2)
- admin/mission.html (served at /admin/mission): no inline script, no style= attribute, <meta
  name="robots" content="noindex,nofollow">, viewport meta, one <script type="module"
  src="/admin/mission-app.js">, one stylesheet /admin/mission-app.css. No beacon, no third-party
  anything, no fonts. A static "Setup needed" block the script reveals when the API says
  not-configured (Access application, three Production variables; no values).
- admin/mission-view.js: pure ES module (no DOM) that turns API JSON into view models: tile order,
  state -> class and word (OK / WATCH / ACT, and for grey by its grey field NOT CONNECTED /
  UNAVAILABLE / UNVERIFIED / NOT YET; colour is never the only signal), legend with counts, town sheet
  facts, list view grouped by category, money and date formatting (America/New_York for display).
  Needs you: red then amber lines; known lines in a collapsed "Known, not new (N)" group below them,
  never styled red or amber. ek -> fixed sentence: owner_name_gate "The engine's privacy guard
  stopped this town's rows (a parser fix is needed; nothing was published)"; access_controlled the
  ENGINE TEXT RULE sentence; no_rows "Returned no rows"; timeout "The town's site timed out";
  http_error "The town's site returned an error"; parse "The town's page changed shape (parser)";
  other and any unknown code "Failed (the reason is not shown on this page)". fail_kind -> "crashed" /
  "stopped by its quality gate" / "failed".
- admin/mission-app.js: the ONLY page file that makes a request. Fetches /admin/api/mission,
  /admin/api/mission?view=map (both with header X-MassPermits-Mission: 1, credentials same-origin)
  and /admin/mission-towns.json in parallel, and the editor's POST when it is on; hands every
  response (JSON or error status) to mission-render.js. Refresh button; re-fetch on
  visibilitychange when older than 5 minutes.
- admin/mission-render.js: DOM building only (no request, no storage, no timer), so the offline
  demo can reuse it unchanged: e.g. render(root, {main, map, towns}, {now, onRefresh, onEdit}),
  with the clock and every action injected. Paints tiles first; builds the SVG with
  createElementNS, one <path data-town> per key, fill-rule evenodd, fill by class, stroke in the
  surface colour; a tap on a town, or Enter on its entry in the list view, opens a sheet (the
  map adds at most one tab stop, never 351); "Show as list" toggles a grouped list.
  Header "Signed in as <signed_in_as>". Attribution line exactly "Boundaries: U.S.
  Census Bureau, TIGER/Line Shapefiles 2024". Every value set with textContent or setAttribute on a
  fixed attribute name; 0 matches in admin/mission* for innerHTML, insertAdjacentHTML, outerHTML,
  document.write, eval(, new Function, setAttribute("style" or setAttribute('on.
- Nothing is persisted on the phone: the payload holds customer rows. 0 matches in admin/mission*
  (and in docs/mission/demo.html) for localStorage, sessionStorage, indexedDB, caches.,
  serviceWorker or document.cookie.
- admin/mission-app.css: phone first (360 px wide: headline, all 8 tiles and the top of the map in
  the first screen), 16 px side gutters, no horizontal scroll, dark and light via
  prefers-color-scheme AND via a data-theme="light" or "dark" attribute on <html> that overrides
  it (the demo's switch uses it), seven map colours that are distinguishable for colour-blind
  viewers (legend always shows text and counts). System font stacks only: no font file, no
  @font-face, no @import. Each design variant styles it its own way (DESIGN DIRECTIONS).
- Order on the page: header, headline, tiles, map + legend + attribution, Needs you (then its
  collapsed "Known, not new" group), details (<details> sections: Customers, Renewals and failed
  payments, Monday delivery, Data refresh (sources in trouble: town, state, since, ek sentence), Sales
  and signups, Outreach, What this page cannot see, Setup), footer links to /admin/pipeline and
  /admin/now.
- _headers block (exactly):
  /admin/mission
    Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
    X-Frame-Options: DENY
    X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
    Referrer-Policy: no-referrer
    Cache-Control: private, no-store

OUTREACH EDITOR (P2; OFF by default)
functions/admin/api/mission-outreach.js, onRequestPost only. Order: env.MISSION_OUTREACH_EDIT !==
"1" -> 404 with 0 R2 ops; verifyOwner; X-MassPermits-Mission: 1; Sec-Fetch-Site must be present
and "same-origin"; Content-Type application/json; body ≤ 512 bytes, exactly {town, outreach} where
town is a mission-towns key (the route keeps the 351 keys as a constant generated from the geometry
file and a test proves they match) and outreach is one of the four states or null. Then get
admin/outreach.json: absent or unparseable -> 409, nothing written (the owner seeds it). Apply,
since = the Function's UTC date, append {at, town, from, to} to history (keep newest 200), size ≤ 64
KB, then ONE put of "admin/outreach.json" with {onlyIf: {etagMatches: <read etag>},
httpMetadata: {contentType: "application/json"}}; null result -> 409. Response {ok:true} or
{error:<fixed code>}. Writes go through writerFor(bucket) exposing only put for that one key (any
other key throws). The page shows edit buttons only when the default view says outreach_edit: true.

DESIGN DIRECTIONS (P2: three competing looks for the same page; the owner compares the demos on
his phone and picks one)
Held constant in all three (the tests enforce it): data, words and sentences (mission-view.js),
tile ids and order, section order (PAGE), legend codes and text, the state words OK / WATCH / ACT /
NOT CONNECTED / UNAVAILABLE / UNVERIFIED / NOT YET beside every colour, the map geometry and
attribution, behaviour (fetching, refresh, sheet, list view, editor), the _headers block, and every
security rule. Also constant: at 360x780 the headline, all 8 tiles (label, word, value) and the
top edge of the map are in the first screen; 16 px side gutters; no horizontal scroll; body text
at least 16 px; touch targets at least 44 px; contrast at least 4.5:1 for text and 3:1 for state
marks against their surface, in light and dark; system fonts only.
Free per variant, chosen on purpose and explained in the PR body: grid, spacing, type scale,
colour tokens, tile shape, how needs-you lines, details and the map are framed.
A  "Instrument panel" (calm). A quiet cockpit read in two seconds. Few, large numerals; generous
   spacing; neutral surfaces, colour only in a small state mark beside the word; a 2 x 4 grid of
   equal tiles; one accent colour; the map large and uncluttered; nothing moves or blinks. Dark
   mode feels like a night-flight panel, not an inverted page.
B  "Trading desk" (dense). Everything on one screen, built for scanning. Compact rows and small
   labels; tabular figures (font-variant-numeric: tabular-nums, a ui-monospace stack for
   numbers); every tile shows value, sub line and as-of time; state as a coloured edge plus the
   word; needs-you as a tight table (severity, what, where); the legend as a table with counts; a
   smaller map; thin rules instead of cards.
C  "Morning briefing" (editorial). Reads like a front page written for one person. The headline
   set large as a sentence in a serif system stack (ui-serif, Georgia, serif); tiles as a compact
   two-column "at a glance" box of short lines; needs-you as a numbered list of full sentences;
   details as short sections with subheads; the map as a captioned figure; a reading measure of
   about 60 to 70 characters on wide screens.

DEMO (P2 variants only: docs/mission/demo.html, so the owner can compare the designs before
anything is deployed; P3 deletes it)
- ONE self-contained HTML file: inline CSS and JS, payloads and geometry embedded in
  <script type="application/json"> blocks. No other file and no network request of any kind, on
  load or on any tap. It must work opened straight from a file (file://) on a phone or a laptop.
- It is the real page, not a look-alike: _demo.mjs assembles it from this branch's own
  admin/mission-app.css, mission-view.js, mission-render.js and admin/mission-towns.json plus a
  small demo boot that calls render() with embedded payloads. mission-app.js (the only file that
  fetches) is not in it.
- Payloads come from the REAL route, never typed by hand: test/mission/demo.test.mjs runs
  functions/admin/api/mission.js (both views) through the harness, with its fetch stub, on
  synthetic worlds at a fixed now, and embeds the responses, error responses included. The same
  five scenarios in all three variants, switched by buttons in a demo bar:
    1 Quiet day: the P1-15 Q1 world (headline "Nothing is wrong that this page can see.").
    2 Bad day: a Monday at 20:30Z; refresh-status in the "refresh crashed" FAILURE SHAPE; the
      Monday log with one ok:false and one expected recipient missing; Stripe connected (fixture,
      state ok) with one open invoice with attempt_count 1 and one cancel_at_period_end renewal
      within 14 days; one source newly dead; the hostile customer name from P1-8.
    3 All good: the healthy world with Stripe state ok, MISSION_OUTREACH_EDIT "1", and an
      outreach object with Adams sent, Alford answered and Ashfield planned.
    4 Cannot read: R2 get throws for subscribers.json and delivery-log.json (P1-11), and the map
      view answers 503.
    5 Not set up: both views answer 403 not-configured (the Setup needed block).
- In the demo the page's clock is each payload's now; every link keeps its look but goes nowhere;
  edit buttons change nothing and say "Demo: nothing is saved"; nothing is stored.
- The demo bar sits outside the page's root element and carries the exact text "Demo with
  invented data. Nothing on this page is real.", the scenario buttons, and a Light / Dark / Device
  switch that sets or removes data-theme on <html>.
- <head>: first a CSP meta tag: default-src 'none'; script-src with the sha256 of every inline
  executable script and nothing else; style-src with the sha256 of the inline style; img-src
  data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'. Then
  <meta name="robots" content="noindex,nofollow"> and <title>Mission Control demo, design
  A</title> (B, C). If a Pages preview ever serves a design branch, the file is still invented
  data that is not indexed and cannot reach the network.
- Embedded JSON escapes <, >, &, U+2028 and U+2029 as the six-character
  escapes \u003c, \u003e, \u0026, \u2028 and \u2029, so a hostile string can never form
  markup anywhere in the file.
- Synthetic only (GUARDRAILS): invented people and streets, @example.com addresses, cus_TEST style
  ids, real town names; outreach only for Adams, Alford and Ashfield.
- Written only by `MISSION_DEMO_WRITE=1 node --test test/mission/demo.test.mjs`. On a design
  branch, without that variable, the test builds a fresh demo and requires it to equal the
  committed file byte for byte (the demo is never stale). From P3 on there is no committed file:
  the test builds into the OS temp directory and runs the P2-10 checks there, and
  `MISSION_DEMO_OUT=<path outside the repo>` writes a copy for the owner's final look. Nothing
  else writes it.

PHASES (each one is a FRESH cloud session; the PHASE line at the top says which)
P1  Branch claude/mission-control. _harness.mjs (fake R2, fetch stub, JWT minter, temp-dir copy);
    _owner_gate.js; _mission_r2.js;
    _mission_stripe.js; _mission_data.js; functions/admin/api/mission.js (both views); synthetic
    fixtures (healthy world, hostile world, Stripe pages with has_more, both invoice line shapes);
    the production-shaped quiet-day world (P1-15); tests for acceptance P1-1 to P1-15. Push.
    Report.
P2-A, P2-B, P2-C  THREE COMPETING PAGE DESIGNS, one fresh session each (they may run at the same
    time). Start only if the main PR body has a "Phase P1 report" and `node --test test/mission/`
    passes on origin/claude/mission-control; otherwise stop and say so. Branch
    claude/mission-design-a (P2-A), claude/mission-design-b (P2-B) or claude/mission-design-c
    (P2-C): create it from origin/claude/mission-control if absent, otherwise continue it. Do not
    read or fetch the other two design branches; the three must be independent.
    Build everything P2 lists: admin/mission.html, mission-app.js, mission-render.js,
    mission-view.js, mission-app.css, mission-towns.json (byte copy), the _headers block,
    mission-outreach.js + writer, their tests, and the DEMO with its test, styled in your
    variant's direction (DESIGN DIRECTIONS). Every variant meets the same acceptance (P2-1 to
    P2-12) and every guardrail and security rule in this prompt. Do not change any P1 non-test
    file (functions/api/_owner_gate.js, _mission_r2.js, _mission_stripe.js, _mission_data.js,
    functions/admin/api/mission.js); if the page needs a P1 change, write it in your PR body as a
    question for P3 and work around it in the page. You may extend the
    P1 structure test's path allowlist for the P2 files. If a local headless Chrome already exists
    in the session (do not download one), open docs/mission/demo.html from a file at 360x780 and
    1280x800, light and dark, every scenario, and describe what you see in the report (not the
    images). Push. Open ONE draft PR, base claude/mission-control, head your branch, title
    "Mission Control design <A|B|C>: <direction name>". Report in its body. Stop: do not touch
    claude/mission-control or the main PR.
    (Owner step, no session: compare the three demos and choose. SPEC section 10.)
P3  POLISH THE WINNER. Branch claude/mission-control. WINNER must be A, B or C; otherwise stop and
    say so. git fetch; check out claude/mission-control; git merge --no-ff
    origin/claude/mission-design-<winner> (never force; resolve conflicts only in files this build
    added, else stop and report). In the same session delete docs/mission/demo.html and make the
    structure test refuse any path under docs/; keep _demo.mjs and demo.test.mjs, which from now
    on build the demo into the OS temp directory and check it there. Apply OWNER NOTES if given:
    re-implement anything borrowed from a losing variant inside the winner's files (read it with
    git show; never merge a second design branch). Answer the winner's questions for P3; change a
    P1 file only with a test that fails first. Then polish to ACCEPTANCE P3: phone layout,
    speed, light and dark readability, accessibility, empty and error states. Do not close, edit or
    delete the losing variants' PRs or branches (the owner does). Push. Append "Phase P3 report" to
    the main PR body, naming the winner and its design PR.
P4-SEC  SECURITY REVIEW. Branch claude/mission-control, after P3, never at the same time as
    P4-COR (both push to one branch; start from its latest commit). Do not trust earlier PR-body
    claims; re-run everything; write your own attempt log before reading P4-COR's section, if one
    exists. Try every attack in P4-SEC ATTACKS; fix what breaks, only in files this build added,
    each fix with a regression test that fails before it and passes after. Record every attempt
    -> result -> fix in the PR body. Push. Report.
P4-COR  CORRECTNESS REVIEW. Branch claude/mission-control, after P3, never at the same time as
    P4-SEC. Same independence rule. Work through every item in P4-COR CHECKS; fix only files this
    build added, each fix with a regression test that fails before it and passes after. Record
    every check -> expected -> got -> fix in the PR body. Push. Report.
    Whichever P4 session runs second ends its report with "Owner setup after merge" (REPORT).
P5  FINAL FIX AND OWNER CHECKLIST, only if a P4 report leaves an item open (an attack that got
    through and was not fixed, a trace that did not match, a red test, or a fix deferred). Branch
    claude/mission-control. Close each open item with a fix in files this build added and a
    regression test; an item that needs the owner or a NEVER-edit file becomes a checklist line
    instead. Re-run every acceptance test (P1, P2, P3). Append "Phase P5 report" and a final
    "Owner checklist" (setup steps, phone checks, owner decisions, what could not be verified
    offline) that supersedes the P4 one. Push. Leave the PR in draft: the owner marks it ready.

ACCEPTANCE P1 (all offline; paste output into the PR body)
P1-1  node --test test/mission/ exits 0; list per-file pass counts and the Node version.
P1-2  Host: www.masspermits.com, masspermits-lander.pages.dev, abc123.masspermits-lander.pages.dev,
      heartbeat.masspermits-lander.pages.dev -> 404 with 0 R2 ops and 0 fetch calls.
P1-3  Each of CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_ALLOWED_EMAILS missing (and whitespace-
      only) -> 403 not-configured, 0 R2 ops; OWNER_EMAIL=owner@example.com alone does not enable it.
P1-4  Valid owner JWT only in the CF_Authorization cookie -> 403 no-assertion-header.
P1-5  Header JWT for stranger@example.com -> 403 not-owner, 0 R2 ops, 0 Stripe calls; owner with
      mixed case and spaces in env and claim -> 200 (positive control).
P1-6  Service-token JWT (common_name, sub "", no email), type "org", nbf in 10 minutes -> 403.
      Expired, wrong aud, wrong iss, alg none, HS256, bad signature, unknown kid, malformed base64,
      certs endpoint throwing -> 403, and no response body contains an exception message.
P1-7  Missing X-MassPermits-Mission, Sec-Fetch-Site cross-site, view=other, an extra parameter
      -> 403/403/400/400 with 0 R2 ops. POST to the GET route -> not 200.
P1-8  Hostile fixtures (name "<img src=x onerror=alert(1)>‮", a prospect key
      "%3Cb%3Ex%3C%2Fb%3E%40example.com", token "a".repeat(32), newsletter tok, a vendor error
      containing an email, an outreach note with an email and a phone number) -> 200 and
      privacy_redactions === 0 (the projections are clean on their own); no string outside
      signed_in_as matches the email regex or contains "@"; no 32-hex; no "prospects/" or
      "newsletter/"; no newsletter tok value; no key shape; the name appears only cleaned. Then a mutation test:
      inject a raw email into one projection -> walk redacts it, privacy_redactions 1, red line.
      Etags (production shape, see TEST METHOD): with every fake R2 etag the 32-hex MD5 of its body
      and a 32-hex bundle_etag on every feed-send-log entry, the healthy-world default view, the map
      view cold and warm, and every P1-12 and P1-13 drill world each return privacy_redactions === 0
      and no red privacy line; no member named etag, httpEtag, bundle_etag or version at any depth;
      and no fixture etag or bundle_etag value (whole, or its first 8 characters) appears anywhere in
      the response body. Mutation test: put one head's etag into detail.refresh -> privacy_redactions
      1 and a red line (proves the walk would catch a regression).
      Owner names in engine text (the walk cannot catch these): in the hostile world put
      "Becket, MA: the owner name 'JANE Q HOMEOWNER' reached a shipped row (x-1). Owner names never
      ship at any aggregation (rule 5). Fix the parser; do not filter this downstream." into
      refresh-status.errors["Becket, MA"], source-health sources["Becket, MA"].last_error (state dead)
      and its recent[0].err; set refresh-status ok:false, degraded:true, error "only 3 towns
      produced data; CANARYERR Zebulon Quux" and traceback "Traceback ... /home/runner/CANARYTB".
      Assert on the default view AND the map view (cold and warm): neither body contains
      "HOMEOWNER", "JANE Q", "CANARYERR", "ZEBULON" or "CANARYTB" (case-insensitive);
      towns["Becket"].ek === "owner_name_gate"; no member named err, error, traceback, last_error,
      last_unscored_why or contracts at any depth; privacy_redactions === 0. Same assertions on the
      "refresh crashed" FAILURE SHAPE exactly (R2 OBJECTS: coverage, count, sources, errors, cadence,
      newest and contracts all null, the CANARYTB traceback; source-health.json keeps the Becket
      record and gains runs_unscored 1, last_unscored_at and last_unscored_why "refresh crashed") ->
      both views 200, fail_kind "crash", towns["Becket"].ek still "owner_name_gate" (now from
      source-health alone), no canary. Then the "ABORT:" shape with a town's error quoted inside the
      refresh error, as a gate abort can write it: error "ABORT: Becket, MA failed (" + the Becket
      string + "); not shipping", sources{} and errors{} as in the hostile world, coverage null,
      contracts null -> both views 200, fail_kind "gate", no canary (this catches a route that emits
      _presend.js evaluate() reasons or headline(), which quote status.error). A healthy status
      cloned with ok/degraded/error flipped is NOT either shape. Repeat with the same string under a
      403 wording ("HTTP 403 from https://example.invalid/x. That is an authorization decision ...")
      -> ek "access_controlled" and still no engine text in either body.
P1-9  STRIPE_READ_KEY sk-shaped, test-shaped, whitespace -> stripe "refused", 0 fetch calls;
      unset -> "not-connected", revenue and renewals tiles grey with value null (never 0); price
      list empty -> "not-connected".
      Failed tile (FAILED TILE rules): (a) Stripe unset, roster with no payment_failing row -> state
      grey, grey "unverified", value 0, source "r2", sub "webhook flags only; registration not
      verified", never green; (b) the same for Stripe refused, partial (subscriptions has_more after
      3 pages) and unavailable (a 500 on the open-invoices call); (c) any non-ok Stripe state with
      one payment_failing row -> red, value 1; (d) Stripe ok, no past_due/unpaid subscription and no
      open invoice with attempt_count > 0 -> green, source "stripe", even with webhook_endpoints
      lacking invoice.payment_failed; (e) Stripe ok with one open invoice attempt_count 1 -> red;
      (f) roster unreadable and Stripe unset -> grey "unavailable", value null. In every case the
      tile is green only in (d).
P1-10 stripeGet on https://masspermits.com/x, https://api.stripe.com.evil.example/x,
      http://api.stripe.com/v1/x, and a POST to https://api.stripe.com/v1/x -> throws
      outbound_blocked with 0 calls reaching the stub; every recorded Stripe call is a GET to one of
      the five paths; no request has expand[]=data.customer; starting_after injection from a fixture
      id "sub_1&expand[]=data.customer" is refused.
P1-11 R2 get throws after auth -> affected tiles grey "unavailable", headline not "Nothing is
      wrong" (the "unreadable" amber line), no tile green that depended on it; missing objects ->
      grey, not zero.
P1-12 Timing drills (inject now; D1-D3 use ran_at = yesterday 14:20Z, ok): D1 refresh not landed
      at 13:30Z -> grey "pending", no needs-you line; D2 not landed at 17:05Z -> red; D3 zip uploaded
      today, status yesterday -> amber; D4 Monday 16:00Z nothing sent -> grey "pending", no
      needs-you line; D5 Monday 20:30Z nothing -> red; D6 Monday 17:53Z all delivered -> green; D7 row since
      Wednesday -> not missing; D8 row since Monday, not delivered -> listed, not red; D9 skipped-only
      -> red; D10 one ok:false with no later ok -> red; D11 same address ok twice since due ->
      amber; D12 Tuesday shows Monday's green; D13 attempt after due with no log entry -> red;
      D14 roster unreadable with a delivery -> amber; D15 now 02:00Z, ran_at yesterday 14:20Z, ok,
      not degraded -> green (due is yesterday 09:00Z, not today's); D16 now 02:00Z, ran_at two days
      ago 14:20Z, latest-weekly.zip uploaded with that run -> red (35 h 40 min old, under the 36 h
      floor, so only the due anchor makes it red; a "today 09:00" due would show grey here); D17
      now 00:30Z, same ran_at and zip as D16 -> red, not grey (a red from a missed day must not
      reset at midnight UTC); D18 a MONDAY at 15:00Z, ran_at that Monday 14:10Z, refresh-status in
      the "refresh crashed" FAILURE SHAPE exactly (R2 OBJECTS: ok:false, degraded:false, error
      "refresh crashed", a traceback, and coverage, count, sources, errors, cadence, newest and
      contracts all null), source-health.json from the day before plus the unscored-run fields (at
      least one ok source, one ok source with cadence "monthly" and one dead source), no
      feed-send-log entry and no last-send-attempt since due -> refresh tile red (never amber),
      fail_kind "crash", headline is the red refresh line and its text contains "Monday's email will
      not send"; the same world on a Wednesday -> red, text without the Monday clause; the "ABORT:"
      shape (error "ABORT: only 12 permits scraped", sources and errors populated, coverage null,
      contracts null) -> fail_kind "gate"; the "bundle build crashed" shape (coverage null, the
      other members populated) -> fail_kind "crash". D19 now 10:00Z, ran_at yesterday 14:10Z, the
      "refresh crashed" shape -> red, not grey "pending" (a failed latest run stays red until a new
      run lands). For EVERY D18 and D19 world assert: the default view and the map view (cold and
      warm) both return 200, never 503; the refresh tile is red; the map still colours those towns
      from source-health.json (ok -> weekly, ok with cadence -> monthly, dead -> dead; counts sum to
      351; unmatched empty); no coverage_disclosed line; detail.refresh.coverage is null (and count
      is null in the "refresh crashed" shape). A healthy status cloned with ok/degraded/error flipped
      does NOT satisfy D18 or D19. D20 now 15:00Z, ran_at today 14:10Z, ok:false, degraded:true,
      coverage populated -> amber (the reduced-run control: degraded ships and discloses, it does
      not abort).
P1-13 Map drills: one fixture town per code; precedence (dead beats outreach; answered beats sent
      beats locked; locked:false beats registry opengov); already_live true with no production ->
      not live; "Nowhere, MA" -> unmatched; "Foxboro, MA" -> Foxborough; outreach for "Atlantis"
      -> outreach_ignored; 70 KB outreach -> unreadable; counts sum to 351.
P1-14 Structure: git diff --name-only origin/main lists only allowed paths (FILE RULES, test/mission/);
      none of the NEVER-edit files, nothing under .github/; import allowlist; outbound regex counts;
      write grep = 0; route-string grep (the GUARDRAILS list, in non-test files) = 0; key-shape
      literal grep = 0 in all added files; node --check on each new non-test file; budget test: R2
      ops ≤ 25 default (worst case: cold source-health cache and every list truncated after 3
      pages), ≤ 6 map cold, ≤ 4 map warm, Stripe calls ≤ 6 without paging and ≤ 15 with;
      payload ≤ 16 KB with 20 synthetic customers, map ≤ 30 KB.
P1-15 Quiet day, production-shaped (the synthetic healthy world never shows the standing conditions
      production carries every day, so this world does). One fixture world, all etags MD5-shaped:
      coverage.disclose true (live_sources below 75% of expected_sources); 4 sources in state
      vanished; one source dead with last_good 20 days before now AND alerted_at / alert_kind "dead"
      re-written 1 day before now (the engine's 7-day re-alert); one source in refresh-status.errors
      and state dead with the 403 wording from P1-8 (in errors{} AND as its source-health
      last_error, which is where the engine copies it) and last_good 3 days before now; every
      source's cadence on its source-health record as well as in refresh-status.cadence; one source
      failing after one failed run; about 60 ok sources, 2 of them with cadence "monthly";
      probe-map.json uploaded 45 days before now; STRIPE_READ_KEY unset; admin/outreach.json absent;
      engagement never-downloaded 1; a roster of 20 synthetic active rows (since weeks ago, no
      payment_failing) and funnel-metrics 7 days earlier with paying 20 and no_customer_id 0; last
      Monday's
      feed-send-log entry delivered ok to all 20, last-send-attempt that Monday; the latest refresh
      ran at 14:20Z on the most recent day it could have landed, ok, not degraded, with
      latest-weekly.zip and .html uploaded one minute later.
      Q1 a Wednesday 18:00Z -> headline.text exactly "Nothing is wrong that this page can see.",
         headline.state "clear"; no needs_you line is red or amber; the known ids are exactly
         coverage_disclosed, sources_vanished (one line, 4 towns), sources_down_long, sources_blocked
         (its text contains "do not retry"), sources_failing, registry_age, stripe_not_connected,
         outreach_absent, engagement; no tile is red or amber; the failed tile is grey "unverified";
         privacy_redactions 0.
      Q2 the same world at 10:00Z that Wednesday (ran_at and bundle uploads Tuesday 14:20-14:21Z)
         -> refresh grey "pending", headline still exactly the Q1 sentence.
      Q3 the same world on a Monday at 16:00Z (refresh that Monday 14:20Z; the newest feed-send-log
         entry and last-send-attempt are from the Monday before) -> monday grey "pending", headline
         still exactly the Q1 sentence.
      One change at a time from Q1, each must move the headline:
      M1 a further source dead, last_good 3 days before now, error "HTTP 500 ..." -> headline
         amber, id sources_down, text names that town; still ONE sources_down line when a second
         such source is added.
      M2 refresh-status replaced by the "refresh crashed" FAILURE SHAPE exactly (coverage, count,
         sources, errors, cadence, newest and contracts all null), source-health.json kept from Q1
         plus runs_unscored, last_unscored_at and last_unscored_why "refresh crashed" -> both views
         200; headline red, id refresh; the map colours every source town as in Q1, now from
         source-health.json alone; no coverage_disclosed line; the other known ids are unchanged
         (sources_blocked still present: its ek now comes from last_error); no amber line.
      M3 a source collapsed with consecutive_low 4 -> amber sources_down; with consecutive_low 30
         -> sources_down_long and the headline back to the Q1 sentence.
      And two that must NOT move it: M4 the old dead source's alerted_at set to 1 hour before now
      -> still Q1 (alerted_at is never recency); M5 the 403 source's last_good set to 1 day before
      now -> still Q1 (sources_blocked is known whatever its age).

ACCEPTANCE P2
P2-1  All P1 tests still pass.
P2-2  admin/mission-towns.json SHA-256 equals e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303
      and has 351 towns; the editor's town constant equals its keys.
P2-3  Page grep: in admin/mission*, none of the forbidden DOM sinks and none of the storage APIs
      (PAGE); in mission.html no inline <script> body, no style= , no <script src="http, no hit
      beacon path, robots meta present; attribution string present. mission-render.js and
      mission-view.js contain no fetch(, XMLHttpRequest, WebSocket, EventSource or sendBeacon;
      mission-app.js is the only page file that fetches.
P2-4  mission-view.js unit tests: every tile state maps to a word and class; legend counts match the
      map payload; unknown code -> "Not covered" never a live colour; grey tiles never render "0" or
      "$0", except a grey "unverified" tile, which renders its count beside the word UNVERIFIED and
      never OK; grey "pending" renders NOT YET; hostile strings pass through as plain text values;
      every ek code and every fail_kind maps to its fixed sentence, an unknown ek to the "other"
      sentence, and the access_controlled sentence contains "do not retry"; known lines render only
      inside the "Known, not new" group, never in the headline and never with a red or amber class;
      with the P1-15 Q1 payload the page's headline reads "Nothing is wrong that this page can see.";
      with the P1-12 D18 payload (detail.refresh.coverage null, count null) the view model does not
      throw, the refresh tile is red, and coverage and count render as "not reported", never 0.
P2-5  _headers diff is exactly the one block, outside the widget block.
P2-6  Editor: flag unset -> 404, 0 R2 ops; gate failures -> 403, 0 ops; missing or cross-site
      Sec-Fetch-Site -> 403; bad town, bad state, extra key, 513-byte body, wrong content type ->
      400, 0 writes; object absent or unparseable -> 409, 0 writes; etag race -> 409; success ->
      exactly one put, key "admin/outreach.json", with onlyIf etagMatches, history capped at 200,
      response {ok:true}; writerFor rejects any other key.
P2-7  Page weight: mission.html + mission-app.js + mission-render.js + mission-view.js +
      mission-app.css ≤ 45 KB.
P2-8  Structure checks of P1-14 re-run with the P2 files (".put(" exactly once, in
      mission-outreach.js).
P2-9  A manual phone checklist in the PR body for the owner (what to look at after setup).
P2-10 Demo (DEMO), checked by demo.test.mjs on docs/mission/demo.html:
      (a) it equals a fresh build byte for byte;
      (b) one file: no src attribute, no <link>, <iframe>, <object> or <embed>, every href is "#"
          or absent, every CSS url( is a data: URI; outside the embedded JSON no "http:" or
          "https:" at all, and inside it only stripe_url values ("https://dashboard.stripe.com/")
          and the geometry's own source.url (a Census download link, never fetched); the embedded
          geometry parses to exactly admin/mission-towns.json;
      (c) the CSP meta tag is the first child of <head> with exactly the DEMO directives, and each
          sha256 in it equals the test's own hash of the inline script or style body it covers;
      (d) 0 matches for fetch(, XMLHttpRequest, WebSocket, EventSource, sendBeacon, import(,
          importScripts, new Worker, the storage APIs and the forbidden DOM sinks;
      (e) privacy: the only email-shaped string in the file is "owner@example.com" (signed_in_as;
          CSS at-rules such as @media are not addresses); apart from it the privacy walk's regexes
          find 0 matches; no "<" followed by a letter inside a JSON block; the hostile name
          appears only escaped; names come only from the harness's invented list; Stripe ids only
          in the cus_TEST, sub_TEST, in_TEST shape; outreach towns only Adams, Alford and Ashfield;
      (f) with a minimal fake DOM added to _harness.mjs (no dependency; its innerHTML, outerHTML
          and insertAdjacentHTML throw), the demo boot renders each of the five scenarios without
          throwing and the theme switch sets and removes data-theme; in scenarios 1 to 4 the
          headline, the 8 tile words and the first needs-you line equal what mission-view.js gives
          for that payload (scenario 4 with no map colours); scenario 5 shows the Setup needed
          block and no tile;
      (g) the demo bar text, robots meta and title are exact;
      (h) size ≤ 400 KB.
P2-11 Design fidelity: the PR body names the direction (A, B or C) and says in about ten lines how
      the variant applies it (grid, type scale, colour tokens, tile form, needs-you form, map
      framing). A test reads the light and dark colour tokens from mission-app.css and asserts
      contrast ≥ 4.5:1 for text and ≥ 3:1 for state marks on their surfaces; the report lists the
      measured ratios. The first-screen rule at 360x780 is shown with headless Chrome if one
      already exists, otherwise by a height budget computed from the CSS in the report.
P2-12 Branch hygiene: git diff --name-only origin/claude/mission-control...HEAD lists only the P2
      files, test/mission/ files and docs/mission/demo.html; no P1 non-test file changed; nothing
      else under docs/; the PR's base is claude/mission-control; this session pushed only its own
      branch.

ACCEPTANCE P3 (polish; measure before and after, paste both into the report)
P3-1  After the merge every P1 and P2 test passes (P2-10 now runs on the temp-directory build);
      there is one merge commit of the winner's branch; the report lists the diff from the
      winner's branch to the final head (polish, demo removal and test changes only).
P3-2  docs/mission/demo.html is gone and the structure test refuses any path under docs/;
      MISSION_DEMO_OUT builds a demo outside the repo that passes every P2-10 check except (a).
P3-3  Phone layout: at 320, 360, 390 and 430 px wide and at 780x360 landscape, no horizontal
      scroll, 16 px gutters, and the first-screen rule at 360x780. Long values wrap without
      overflow: an 80-character cleaned name, "at least 300", "$12,345.67", a 40-key unmatched
      list, a sources_down line with 5 towns and "+k more", a known group of 30 towns. Checked with
      headless Chrome if one already exists; otherwise the report lists every fixed width,
      min-width and nowrap in the CSS with its reason.
P3-4  Speed: with the fake DOM and a fetch stub that records call order, all three requests start
      before any of them resolves; tiles render from the default view alone while the map view and
      the geometry are still pending (the map area shows a placeholder, never zeros); the SVG is
      assembled off-document and attached in one step; no polling and no timer except a 15 s
      per-request timeout; page files still ≤ 45 KB (P2-7), with the new total reported.
P3-5  Light and dark readability: a test reads every colour token from mission-app.css for light
      and dark (both prefers-color-scheme and data-theme) and checks, for every text, state mark
      and focus ring on every surface it is used on, WCAG contrast ≥ 4.5:1 for text and ≥ 3:1 for
      large text, state marks, the focus ring and map strokes against their fill. For the seven
      map colours the test simulates protanopia, deuteranopia and tritanopia (Machado et al. 2009
      matrices at severity 1.0) and reports the smallest CIEDE2000 difference between any two map
      colours per theme and vision type; any pair under 10 gets a non-colour cue (for example a
      hatch pattern for dead, built with createElementNS) and the numbers go in the report.
P3-6  Accessibility (fake-DOM tests for the attributes, the rest in the report): one h1, then an h2
      per section in page order; header, main and footer landmarks; tiles as a list, each with an
      accessible name such as "Paying customers: 12, OK"; the headline in a polite live region
      that updates on refresh; the map has an accessible name that sums up the legend counts and
      adds at most one tab stop (the list view is the keyboard route: each town is a button that
      opens the same sheet); the town sheet is a dialog: focus moves into it, Escape and a Close
      button close it, focus returns where it was; "Show as list" carries aria-pressed;
      <details> and <summary> for the details; a visible focus ring; prefers-reduced-motion
      honoured; targets ≥ 44 px; text zoom to 200% without horizontal scroll.
P3-7  Empty and error states, each a fixed sentence with a fake-DOM test:
      loading: tiles show "Loading", never 0 or $0;
      default view 403 not-configured: the Setup needed block;
      default view 403 for any other reason: "Not signed in as the owner. Reload to sign in again.";
      400, 503, a body that is not JSON, a network failure or the 15 s timeout: "Could not read
      the data. Reload; if it stays, check /admin/pipeline.";
      a refresh that fails after a good load keeps the earlier render (in memory only) under
      "Not updated. Showing data from <time>.";
      the map view or the geometry failing alone: tiles, needs-you and details still render, and
      the map area says "The map could not load. Reload." (the list toggle is hidden);
      zero customers: "No customers yet." instead of an empty table;
      no needs-you line: only the clear headline, and no empty "Known, not new (0)" group;
      an unknown tile id, state or grey kind: UNAVAILABLE, never OK.
      These sentences never replace or reword a sentence fixed elsewhere in this prompt.
P3-8  The report shows before and after for P3-3 to P3-7 and says how each OWNER NOTES item was
      handled.

P4-SEC ATTACKS (fresh context; the 11 areas; record attempt -> result -> fix)
(1) Get any data or any R2/Stripe op without a valid header JWT for an allowlisted email: cookie only,
service token, org token, stranger, missing env, OWNER_EMAIL only, www, pages.dev, hash host,
heartbeat, a Host header trick, a trailing-dot hostname, uppercase host. (2) Make either route read
before auth. (3) Leak an email, 32-hex token, tok, key shape, prospects/ or newsletter/ key, phone,
street or raw Stripe/R2 object through any response, error, console line or the page, using hostile
names, metadata, vendor errors, outreach notes or Stripe fields; get any R2 etag, httpEtag,
bundle_etag or version value (MD5-shaped, as in production) into either view on any path,
including the Monday duplicate path and the map cache; get an owner's or contractor's name, or any
other engine text (errors{} values, last_error, recent[].err, the refresh error, traceback or
contracts), into either view, a needs-you line, a detail section or a console line, on any path,
including the town sheet and the sources list; or make the page keep any of it on the phone
(storage APIs, a service worker, the Cache API). (4) Make any code path write to R2
(other than the editor's one key with the flag on) or call Stripe with a non-GET, another host, a
customer expand or an injected cursor. (5) Get a green tile or "$0" from missing, unreadable,
partial or unverifiable data (including a green failed tile with Stripe in any state but ok); get
a red from the healthy timing drills, or a grey refresh tile between 00:00 and 09:00 UTC after a
healthy run the day before; show a failed refresh (ok false, not degraded) as anything but red,
or turn either view into a 503 with a FAILURE SHAPE status (null coverage, sources, errors, count);
make the P1-15 quiet-day world headline anything but "Nothing is wrong that this page can see.",
or put a known line in the headline; make a months-old outage look new (alerted_at), or make the
page suggest retrying a 403. (6) XSS on the page with hostile strings, through mission-render.js,
the town sheet, the list view, the needs-you lines and a temp-directory demo build; confirm the
CSP header block would stop inline script. (7) Endanger the paying path: any diff to
NEVER-edit files, _middleware.js, .github/, a new route beyond the two, a node: import, a Buffer,
process. or require( use, a top-level statement other than a declaration in a new functions file
(it would run in the Worker that also serves the Stripe webhook), or anything else that could fail
the Pages Functions build. (8) Make the map lie: colour from already_live, drop an
unmatched key, colour a planned town, trust an outreach town not on the map. (9) Editor: write with
the flag off, write another key, overwrite an unparseable object, lose an update, write cross-site.
(10) Exceed 45 subrequests with worst-case fixtures (every R2 list still truncated after 3 pages,
every Stripe list has_more after 3 pages, JWKS refetch). (11) Find customer data, a real email, a private path, a customer count,
an outreach town list or a secret in any committed file, commit message or PR body, on
claude/mission-control AND on the three design branches and their PRs (all public), including the
losing variants' demos; confirm nothing under docs/ remains on claude/mission-control.

P4-COR CHECKS (fresh context; record check -> expected -> got -> fix)
(1) Every number traced. Write an independent oracle in the tests from the rules in this prompt
    (it does not import _mission_data.js or copy its code) and compare it with the route on every
    fixture world: healthy, hostile, quiet day Q1 to Q3 and M1 to M5, every D drill, every map
    drill and the five demo scenarios. Cover every tile value, sub and state; every detail count
    and amount; every needs-you id, severity and named town; the headline; every legend count and
    town fact; the opengov pair. Then check the page shows the same numbers (formatting only:
    cents to dollars with two decimals and thousands separators, "at least N" when partial,
    America/New_York dates). Put a trace table in the PR body: item -> R2 object or Stripe section
    -> rule (prompt section) -> code file:line -> fixture -> expected -> got -> Y/N.
(2) Every timing drill. Re-run D1 to D20, Q1 to Q3 and M1 to M5, then the edges: now exactly at
    due, at due + 8 h minus 1 ms and exactly at due + 8 h; ran_at exactly 36 h old and 36 h plus
    1 ms; a Monday at 11:59:59Z, at 12:00Z and exactly at the hold hour; Sunday 23:59Z and Monday
    00:00Z; the US clock changes (2026-11-01 and 2027-03-14) for displayed dates; month-end and
    year-end for the 7, 14 and 30 day windows; a roster since equal to the Monday date. Each
    expected result comes from the rules, never from running the code.
(3) Map truth. Counts sum to 351 on every world. A seeded pseudo-random generator written in the
    test (no dependency) builds 200 synthetic worlds that mix states, cadences, errors, registry
    methods and feasibility, outreach states and locked flags over random towns, plus aliases and
    unknown keys; the oracle and the route agree on every town's code, facts and ek. Every alias
    resolves; an unmatched key is listed and never dropped; already_live never colours; planned
    only outlines; the page's legend counts, town sheet and list view show exactly the payload's
    facts; a town has the same code and ek in the map view and in detail.refresh.sources.
(4) Money and Stripe. Gross, run rate, renewals from items current_period_end, trials and
    "at least" totals worked by hand on the fixtures, both invoice line shapes. Whether a past_due
    subscription and its own open invoice count once or twice in the failed tile: report what the
    rule says and what the code does as a question for the owner; do not change the rule.
(5) Monday reach on crafted rosters: case and whitespace in emails, active false, a cancelled row,
    a re-subscriber keeping an old since, since equal to and after the Monday, one address twice
    in one log entry, a log entry with no sent array.
(6) Words. Every fixed sentence and legend text in this prompt appears byte for byte in the
    shipped page code (a test lists them); no state word disagrees with its state, and no count in
    a sentence differs from the tile or payload it describes.

REPORT (append per phase in that phase's PR body: P2 variants in their own design PR, every other
phase in the main PR)
Files added, Node version, per-file pass counts, the drill tables (ID -> expected -> got -> Y/N),
budget numbers measured by the op counter, anything surprising in shipped code phrased as a
question for the owner (do not fix shipped files; for a NEVER-edit file the public PR body gets
only a count and a one-word area, such as "webhook: 1", never a file:line or a description of a
weakness; the owner re-checks it with a local session), and what could not be verified offline:
real Access tokens and the Access path match, the Cloudflare plan's CPU limit, Stripe's acceptance
of expand[]=data.line_items on the checkout sessions list, the real API version's field shapes,
whether Pages lets _headers detach its default Access-Control-Allow-Origin on static files, and the
owner setup below. A P2 report also gives: the direction and how it is applied (P2-11), the demo's
five scenarios, and "To view: download docs/mission/demo.html from this branch and open it; it
makes no network request." The P3 report names the winner, its design PR and the two losing PRs
for the owner to close. Whichever P4 session runs second ends its report with "Owner setup after
merge"; P5, if it runs, ends with the final "Owner checklist", which repeats and supersedes it:
1. Zero Trust Access self-hosted app: masspermits.com/admin, masspermits.com/admin/*,
   masspermits.com/api/pipeline*; never the bare domain or /api/*; policy Allow, Emails, one login.
2. Pages Production variables only: CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_ALLOWED_EMAILS
   (secret). Never in Preview.
3. Stripe restricted read-only key (Subscriptions, Invoices, Checkout Sessions, Prices, Webhook
   Endpoints): STRIPE_READ_KEY (secret) and MASSPERMITS_PRICE_IDS, Production only.
4. Upload admin/outreach.json once with wrangler from the owner's local seed file.
5. Redeploy production so the variables take effect.
6. Phone checks: signed out -> Access login; signed in -> data and "Signed in as"; www and pages.dev
   /admin/api/mission -> 404; next Monday's send log normal.
7. Optional: MISSION_OUTREACH_EDIT=1.
8. Close the two losing design PRs and delete the three claude/mission-design-* branches (they hold
   only invented demo data, but every branch of this repo is public).
