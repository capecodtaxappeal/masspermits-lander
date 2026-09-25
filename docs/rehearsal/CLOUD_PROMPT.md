GUARDRAILS (verbatim, non-negotiable)
- Work ONLY on branch claude/monday-rehearsal (create it from main if absent; otherwise continue
  it). Open or update ONE pull request. NEVER push to main, NEVER merge, NEVER force-push, touch no
  other branch (you may READ branch claude/seed-rehearsal-inputs).
- Make NO change under .github/. Workflows are delivered as docs/rehearsal/*.yml.txt.
- NEVER edit these files: functions/api/stripe-webhook.js, weekly-send.js, my-leads.js,
  send-status.js, _presend.js, _github-oidc.js, upload-bundle.js, get-object.js, _notice.js,
  inbox-status.js, funnel.js, functions/leads.js, functions/_middleware.js.
- REPORT-ONLY. This build fixes nothing in production. No job you write may hold
  "actions: write". Nothing you write may dispatch, re-run or cancel any GitHub workflow, by any
  means (REST path, gh CLI, or anything else). No send is ever retried.
- The repo is PUBLIC, and the site is served from the repo root, so EVERY file you add is also a
  public URL on masspermits.com. Branches, commits, PR text, fixtures and docs must contain no
  customer, subscriber, homeowner or contractor data. Synthetic fixtures only: @example.com,
  cus_TEST..., tokens like "a" repeated 32 times; towns may be real names, people and streets must
  be invented. No secrets.
- During this session make NO network call to masspermits.com, *.pages.dev, api.stripe.com,
  api.resend.com, api.github.com or any town site. Tests make zero network calls; a fetch stub
  throws on any unexpected URL. Never run gh workflow run, gh run, gh api, or wrangler against
  Cloudflare. Never send email.
- In any NON-test file you add (anything not named *.test.mjs), including comments, never write
  these route strings: /api/weekly-send, /api/mail-owner, /api/newsletter-send, /api/newsletter,
  /api/nurture, /api/lifecycle-send, /api/request-sample, /api/agent-sample, /api/upload-bundle,
  /api/funnel, /api/hit, or "force=1". Refer to those modules by file name (e.g. funnel.js).
- If you see a secret or personal data anywhere, report path:line only, never the value. Say what
  you verified and how.

PHASE: R1   (then R2a, R3a, R4; R2b and R3b only if the owner says so. Read the PR body first to
see what is done.)

WHAT THIS IS
A "Monday Dress Rehearsal" for MassPermits' paid weekly email. On Saturday and Sunday it runs
Monday's delivery motions without emailing customers, then tells the owner GO or NO-GO. On Monday
it checks before and after the real send. Real subscribers pay through this code, and nobody else
reviews it. Monday's send is POST to functions/api/weekly-send.js from
.github/workflows/weekly-feed.yml. The pure send gate is functions/api/_presend.js (evaluate,
gather, normalisePolicy, bestSince, lastEtagEntry, headline, windowStart, dueAt). It is deployed,
and nothing calls it. v1 is REPORT-ONLY: every finding is a line in an email to the owner.

TEST METHOD (use it everywhere)
Test the SHIPPED source, never an edited copy. stripe-webhook.js, my-leads.js and functions/leads.js
import nothing and load as they are. weekly-send.js imports ./_github-oidc.js and ./_presend.js:
copy weekly-send.js AND _presend.js byte for byte into a temp dir with a {"type":"module"}
package.json, replace ONLY _github-oidc.js with a stub whose verdict each test sets, and import from
there. Fakes: an in-memory R2 (get/put/list/head/delete, every op recorded); a global fetch stub that
answers fixture URLs and THROWS on any other; a Stripe-Signature header computed with HMAC-SHA256 over
`${t}.${payload}` and a made-up secret; a context.waitUntil collector; a minimal global HTMLRewriter
stub (leads.js:285 uses the Workers global, which Node lacks). If functions/api/*.test.mjs harness
files already exist from an earlier PR, reuse them. One exception to the OIDC stub: the auth-gate
test (ACCEPTANCE 17) imports rehearsal.js with the REAL functions/api/_github-oidc.js and a test RSA
key whose JWK the fetch stub serves at https://token.actions.githubusercontent.com/.well-known/jwks.

FILE RULES
- New files under functions/ may ONLY be: functions/api/_ro_bucket.js, _rehearsal.js,
  _rehearsal_mail.js, _reconcile.js, rehearsal.js, (R2b only) rehearsal-seed.js, and *.test.mjs
  files. Any other new .js under functions/ would become a public route bundled into the same
  Worker as weekly-send.js.
- Test and harness code lives ONLY in *.test.mjs files or outside functions/ (shared harness in
  test/rehearsal/*.mjs). No non-test file may contain "globalThis.fetch =" or "self.fetch =".
  No *.test.mjs file under functions/ may export onRequest, onRequestGet, onRequestPost or any
  other onRequest* name (Pages would treat it as a route and bundle its node: imports; a failed
  build blocks every deploy).
- IMPORT ALLOWLIST: a non-test file you add under functions/ may import only ./_presend.js,
  ./_github-oidc.js, ./_ro_bucket.js, ./_rehearsal.js, ./_rehearsal_mail.js, ./_reconcile.js,
  ./my-leads.js and ../leads.js (rehearsal-seed.js, R2b only: ./_ro_bucket.js only). NOT
  ./inbox-status.js. No dynamic import(). (Ten shipped modules call api.resend.com, including the
  public ungated newsletter.js, request-sample.js and agent-sample.js; importing any of them would
  send mail.)
- OUTBOUND: a free fetch call (regex (?<![A-Za-z0-9_$.])fetch\s*\( ) appears EXACTLY TWICE in all
  non-test files you add under functions/, both inside outbound() in rehearsal.js: once in
  stripeGet, once in sendInternal. No added non-test file under functions/ refers to the global
  fetch any other way: 0 matches for "typeof fetch", "globalThis.fetch", "self.fetch" or
  [=:?(,]\s*fetch(?![A-Za-z0-9_$]) (so no "fetchImpl: fetch", "x ? fetch : null", "const f =
  fetch"). The literal "api.resend.com" appears EXACTLY ONCE in all non-test files you add, inside
  sendInternal. _rehearsal_mail.js has 0 fetch calls and no "api.resend.com".
  ONE member call is allowed, and only from R2b on: env.ASSETS.fetch(new Request(new URL(path,
  "https://masspermits.com"))) appears EXACTLY ONCE, inside readAsset(env, path) in rehearsal.js,
  which throws unless path is the literal "/index.html" or "/offer.html". The regex \.fetch\s*\(
  matches 0 times before R2b and exactly once (that line) after it. No other ".fetch(" anywhere.
- HEADERS: rehearsal.js and _rehearsal.js never touch request.headers. The incoming authorization
  header is read only inside verifyGitHubOIDC and is never copied, stored, logged or forwarded to
  any handler.

ARCHITECTURE (build exactly this)
- functions/api/_ro_bucket.js: roBucket(bucket, opts) returns a PLAIN OBJECT with exactly five
  methods, never a Proxy: get/head/list pass through; put/delete are recorded in .captured and NOT
  executed, unless opts.allowPrefix is set and the key starts with it; either way they return a
  resolved Promise (leads.js:458 chains .catch() on put). THE DEFAULT IS NO ALLOWED PREFIX:
  roBucket(bucket) with no opts drops every write, rehearsal/ included. Only rehearsal.js (and
  R2b's rehearsal-seed.js) pass {allowPrefix: "rehearsal/"}, for their own writes; the handlers in
  C6 get roBucket(env.BUNDLES). Any other method (e.g. createMultipartUpload,
  resumeMultipartUpload, which write) does not exist, so calling it throws. Exports the captured
  log.
- functions/api/_rehearsal_mail.js: renderWeekly({name, token, coverage, date}) -> {subject, html,
  attachmentName}. A byte-for-byte mirror of ONLY the html and subject expressions of sendEmail()
  in weekly-send.js: lines 179-225 (first, d, dl, note, html), the subject ternary at 231-232 and
  the attachment filename template at 234. Do NOT copy the Resend call at 226-237 (it posts to the
  subscriber, to: [to]). No fetch call and no "api.resend.com" in this file. Do not "improve" the
  copy: the mirror must reproduce today's text exactly, stale sentences included.
- functions/api/_rehearsal.js: pure checks (listed below). Each returns {id, code, result:
  PASS|WARN|WAIT|NO-GO|BLIND, counts, buyer_numbers, detail_private}. It also exports RUNNER_SCHEMA
  and validateRunnerFacts(obj) -> {facts, dropped[]} (see RUNNER FACTS), the verdict function,
  composeDigest(results) -> {subject, html}, no em dashes, first line "GO" or "NO-GO", and
  inboxVerdict(state, now) -> never|stale|unarmed|backlog|waiting|ok, a mirror of the rule in
  inbox-status.js lines 66-125 (STALE_HOURS 30, ESCALATE_HOURS 72; same order of tests). It also
  exports HANDLED_EVENTS (the 9 Stripe event types stripe-webhook.js compares event.type with; see
  C8) and RECONCILE_MAP (the table in C7, keyed by reconcile() finding type).
  Known-open: read R2 key rehearsal-ack.json ({code: "YYYY-MM-DD"}); only codes on a fixed ACKABLE
  list can be acked (C5.purchase_copy, C5.style_*, C9.guard1_late, C10.source_stale:<town>,
  C13.contracts_not_run, C15.feed_log_emails, C17.inbox_never, C17.inbox_stale, C19.no_open,
  C21.unattested); an ack
  lasts at most 28 days from the run date; an acked finding is listed as "Known open" and does not
  count toward NO-GO. Never ackable: C1-C4, C6, C7, the duplicate half of C9, C17 backlog.
  Verdict: WAIT if a run-level WAIT applies (see WAIT); else NO-GO if any un-acked NO-GO; else
  "GO, blind on N" if any of C1, C2, C3, C6, C7 is BLIND; else GO. Check-level WAIT items are
  listed as "Not yet confirmed".
- functions/api/rehearsal.js: POST, OIDC-gated via verifyGitHubOIDC (audience masspermits-cron,
  like the other cron endpoints). AUTH FIRST: `const auth = await verifyGitHubOIDC(request); if
  (auth.ok !== true) return 401 {ok:false, error:"unauthorized"}` BEFORE parsing any parameter,
  reading the body, or touching R2, Stripe or Resend. verifyGitHubOIDC ALWAYS returns an object
  ({ok:false, reason} on failure), so "if (!auth)" is the bug that opens the route to anyone.
  Never echo auth.reason (it can hold an exception message). Query: mode in
  sat|sun|mon-pre|mon-post|dry; part in
  links|seed|core; page an integer 0-24 (the caller always sends it: used by links, accepted and
  ignored for seed and core); date YYYY-MM-DD, rejected if more than 3 days
  before or 1 day after the Function's UTC date; trigger matching ^([0-9]{1,20}|sched|dispatch)$;
  run (the workflow run id that ties one run's parts together) matching ^[0-9]{1,20}$.
  Anything else: 400 {ok:false, error:"bad_param"}. Use the date it is given, never its own clock,
  to file the run. Body: the runner facts, at most 4 KB, passed through validateRunnerFacts.
  ONE top-level try/catch returns {ok:false, error:<code>} with code from a fixed list (bad_param,
  unauthorized, schema, roster_unreadable, status_unreadable, log_unreadable, internal).
  log_unreadable: rehearsal/log.json EXISTS but cannot be read, does not parse, or lacks the
  expected shape. Then end the request right after auth and params: run no check, send no mail,
  and do NOT overwrite the object (it is the mail cap's evidence; an "empty" log would reset the
  cap). A MISSING log.json is a fresh start. roster_unreadable and status_unreadable never end a
  request: they are check findings (the dependent checks, C1-C4 for
  a missing or corrupt refresh-status.json, are NO-GO) and the digest is still composed and sent,
  because a broken status file is exactly what C1-C3 exist to report. NEVER put e.message,
  e.stack, String(e), an R2 body, or any subject/detail/why string from _reconcile.js into a
  response, a console line or the digest (a JSON parse error can quote the roster).
  Roster: read subscribers.json once per request with a local readRoster() -> {ok, rows, code},
  code in missing|not_array|parse_error. If not ok: every roster-dependent check is NO-GO
  roster_unreadable, no seed is sent, and the owner digest is a fixed text ("The subscriber list
  could not be read; nothing that depends on it was checked.") with no buyer details.
  Uses env.BUNDLES only through roBucket. Keeps rehearsal/log.json (newest 200 records), one record
  per (date, mode, part, trigger, run). De-duplication looks only at CORE records (the verdicts) from
  OTHER runs: "dispatch" always runs; a workflow_run trigger skips only if a non-WAIT core record
  with the same (date, mode, trigger) exists (a re-run of the same event); a "sched" backstop skips
  only if a non-WAIT core record for (date, mode) exists. Parts run links (paged) then seed then
  core; core runs last, reads the links results stored under rehearsal/ for the same run, and is
  the ONLY part that composes or mails. Core records are {date, mode, part, trigger, run, verdict,
  code}; a non-WAIT mon-pre core record ALSO stores bundle_etag (head() etag of
  latest-weekly.zip it judged) and rowset_sha256 (status.bundle.weekly.rowset_sha256 or null) for
  mon-post step 4. These stay in R2 only (the etag is 32-hex). The response is EXACTLY {ok,
  verdict, more, codes, error}: codes = the un-acked NO-GO codes plus the rehearsal's own mail
  codes (C18.mail_capped, C18.mail_failed, C18.mail_refused). NO COUNTS of any kind (per-result
  counts showed the roster size in the public log), and no buyer number, email, name, token,
  address or handler header (the caller prints it into a public log).
  OUTBOUND, locked at run time (every POST here carries a token weekly-send.js would accept, so
  tests alone are not enough): build `const out = outbound(env, roster, log)` once per request.
  It returns exactly {stripeGet, sendInternal}, and these hold the only two fetch calls in the
  files you add.
    stripeGet(url, init): throw "outbound_blocked" (no fetch) unless new URL(url).origin ===
      "https://api.stripe.com" and init.method is absent or "GET". Pass it as fetchImpl on EVERY
      _reconcile.js call.
    sendInternal(to, subject, html, attachments?): RECIPIENT LOCK. Let norm(s) =
      String(s).trim().toLowerCase(). `to` must be a string whose norm is non-empty and contains
      EXACTLY ONE "@". Normalise the env values the same way; a value counts only if non-empty:
      env.REHEARSAL_TO, env.OWNER_EMAIL, and each comma-separated entry of env.REHEARSAL_SEEDS
      (empty entries dropped, at most 3). `to` is an OWNER address if norm(to) equals a counted
      REHEARSAL_TO or OWNER_EMAIL, a SEED if it equals a counted seed; anything else throws (so two
      undefined values can never match each other). Then compare norm(to) with norm(email) of
      EVERY roster row, active or not: any match throws. If the roster is unreadable, every seed
      throws. A refusal records mail: "refused" (WARN C18.mail_refused). It builds the Resend body
      itself: from env.FROM_EMAIL, to: [to] (one recipient, never cc or bcc), subject, html,
      attachments; and posts to the one literal URL https://api.resend.com/emails.
      No mail unless env.REHEARSAL_MAIL === "1" (record mail: "off"). DAILY CAP: before calling
      Resend, count the attempts in rehearsal/log.json for the Function's current UTC day and this
      kind (owner or seed, as above); at 3 or more, do not call, record mail: "capped" (WARN
      C18.mail_capped in the next digest). Record the attempt BEFORE the call; attempts count, not
      only successes. FAIL CLOSED: if the log could not be read or parsed, no send (the request has
      already ended with log_unreadable); if writing the attempt record throws or fails, do not call
      Resend and put C18.mail_capped in the response codes. Keep these mail records ({day, kind,
      run, result: sent|failed|capped|off|refused}, no address) in log.json for 8 days, outside the
      200-record trim. No retry: a Resend failure is recorded as mail: "failed". The owner digest
      goes to the first counted value of REHEARSAL_TO, then OWNER_EMAIL; if neither is set, nothing
      is sent (mail: "refused").
  The JWKS read to token.actions.githubusercontent.com happens only inside the unedited
  _github-oidc.js. Nothing in the Function can reach masspermits.com or api.github.com. (R2b only:
  readAsset(env, path), the one env.ASSETS.fetch, see FILE RULES.)
  Never call the funnel route (it writes history on every call); read funnel-metrics.json through
  the binding. Read refresh-status.json and head() of the bundles through the binding (the same
  objects health.js reads), never by fetching a URL.
- Links (C6): first read portal.json through the binding; if off === true, C6 is WARN
  C6.portal_paused (the kill switch 302s to the download, leads.js:74-77). Then, 4 active roster
  rows per page (response more:true until done; beyond 25 pages C6 is BLIND C6.too_many), build GET
  requests IN MEMORY and call the IMPORTED handlers in-process with context {request, env:
  {...env, BUNDLES: roBucket(env.BUNDLES)}, waitUntil: collector} (no allowPrefix: a handler can
  never persist anything). Never make an HTTP request to these routes.
  (1) new Request("https://masspermits.com/api/my-leads?t=" + token), AND again with
      "&k=monthly", for EVERY row (every roster row is created by a monthly subscription checkout,
      stripe-webhook.js:202-203, and the purchase email links &k=monthly, :518; there is no plan
      field) -> onRequestGet from ./my-leads.js. Assert status 200 and content-type
      application/zip. Assert ZERO captured dl/ writes: the user-agent below matches BOTS
      (my-leads.js:53) and logEvent returns at :145.
  (2) new Request("https://masspermits.com/leads", {headers: {cookie: "mp_sess=" + token}}) ->
      onRequestGet from ../leads.js. NOT /leads?t= (that returns a 302 with Set-Cookie and no
      beacon, leads.js:84-104). Assert status 200, EXACTLY ONE captured portal-access/ write with
      metadata {tok, ua, st} and ZERO persisted. Read st: "ok" passes, "red" is NO-GO (the red page
      also returns 200, leads.js:183). A 302 to /api/my-leads with the kill switch off means
      latest-weekly.html is missing: WARN C6.portal_html_missing. Never log response headers (a
      Location carries the token).
  These Requests carry ONLY user-agent "MassPermits-Rehearsal/1 (monitor; headless)",
  x-mp-synthetic: 1 and (for leads.js) the cookie. Never an authorization header. Do not assert
  content-length (my-leads.js sets none). Call body.cancel() and never read a body.
- Inbox (C17): do NOT import or call inbox-status.js, and forward no header to anything. Read
  inbox-watchdog-state.json through the binding (roBucket) and apply inboxVerdict(state, now).
  backlog = NO-GO (never ackable); never|stale|unarmed = WARN (ackable); waiting|ok = PASS. If the
  runner fact c17.inbox_mirror is not "ok", the inbox half is BLIND "inbox mirror drift".
- Reconciliation (C7 keyed half, C8): import ./_reconcile.js and call, in-process:
  stripeResult = await listStripeSubscriptions({key: env.STRIPE_READ_KEY, apiVersion,
  expandCustomer: env.STRIPE_NO_EXPAND !== "1", fetchImpl: out.stripeGet}); webhookResult = await
  listStripeWebhookEndpoints({key, apiVersion, fetchImpl: out.stripeGet}); recon = await reconcile({roster,
  rosterReadable, sendLog, sendLogReadable, stripeResult, webhookResult, products:
  {masspermits_prices, other_prices, masspermits, other} (comma lists from env
  MASSPERMITS_PRICE_IDS, OTHER_PRICE_IDS, MASSPERMITS_PRODUCT_IDS, OTHER_PRODUCT_IDS), siteHost:
  env.SITE_HOST || "masspermits.com", now}). Call reconcile() whenever the roster is readable, KEY
  OR NOT: without Stripe it still runs its tripwire and roster-only identity scan. Its findings
  carry `subject` built by maskEmail, which KEEPS THE DOMAIN (a business buyer's domain names them)
  and cannot tell two buyers on one mail provider apart, and `detail` strings that can carry
  e.message. So the port adds a private ref: {row, sub} to every finding and notice (row = index
  into the roster array passed in, or null; sub = index into stripeResult.subs, or null). Map each
  finding ONLY through RECONCILE_MAP (the table under C7): its result, its fixed code, and ref.row
  -> buyer number. NEVER read recon.verdict, recon.condition_verdicts, recon.alarms or recon.counts: that
  verdict is red whenever the tripwire fires, which is every legitimate cancellation for a week.
  subject, detail, why and ref never leave the Function. Do NOT port or create a stripe-reconcile
  route. No key -> the S comparison is BLIND; the table's no-key column still applies.
  C8 reads (all through out.stripeGet, GET only, pinned Stripe-Version, has_more must be a boolean,
  paged on starting_after up to MAX_PAGES, never throwing, returning {readable, items, status,
  reason}): listStripeWebhookEndpoints (exists); and three NEW readers you add to _reconcile.js in
  the same style: listStripePrices (GET /v1/prices?active=true&limit=100), listStripePromotionCodes
  (GET /v1/promotion_codes?active=true&limit=100; read each code's coupon percent_off, amount_off
  and applies_to from the object the pinned API version returns, requesting the expansion it needs;
  a code whose discount or scope cannot be read is reported, never assumed) and
  listStripePaymentLinks (GET /v1/payment_links?active=true&limit=100 with line items expanded; if
  the expansion is refused, at most 10 GET /v1/payment_links/{id}/line_items).
- CPU: the free tier allows 10 ms per request. No unzip and no CSV parse in the Function, and no
  bundle hashing: call gather(env, {hash: false}) (_presend.js:194). Content facts come from
  refresh-status.json fields (status.bundle.weekly.{rows, opens_as_zip, has_all_leads,
  rowset_sha256}, status.contracts, per-source newest and cadence). When a field is absent the check
  is BLIND with the reason, never PASS. The C20 seed send (base64 of the weekly zip) runs alone in
  part=seed.
- scripts/rehearsal/*.mjs (Node built-ins only), run in the RUNNER job only. ALL HTTP goes through
  one module, scripts/rehearsal/http.mjs, with exactly two functions: ghGet(path) (method GET
  hard-coded, https://api.github.com/repos/capecodtaxappeal/masspermits-lander/..., header
  Authorization: Bearer $GH_TOKEN from env) and getSample() (GET https://masspermits.com/api/sample).
  (R3b only adds a third, for C15's log download: GET with redirect "manual", then one GET of the
  Location WITHOUT the Authorization header, only if its host is the one GitHub-owned host you name.)
  No other runner file contains "fetch(". Nothing in the runner writes to GitHub.
  mode.mjs resolves mode, date and trigger from GITHUB_EVENT_NAME and GITHUB_EVENT_PATH:
    schedule "0 20 * * 6" sat, "0 20 * * 0" sun, "0 10 * * 1" mon-pre: date = latest date on or
    before now matching the cron's weekday. "30 20 * * 1" and "0 13 * * 2" mon-post: date = the send
    window's Monday = windowStart(now, {send_dow: 1}) from functions/api/_presend.js, as YYYY-MM-DD
    (so the Tuesday backstop, and a Monday run delayed past midnight, are Monday's mon-post).
    trigger "sched".
    workflow_run: FIRST the source guard. Resolve to idle (caller skipped, nothing called) unless
    ALL hold: workflow_run.path == ".github/workflows/weekly-refresh.yml";
    workflow_run.head_repository.full_name == GITHUB_REPOSITORY; workflow_run.head_branch ==
    "main"; workflow_run.event is schedule, push or workflow_dispatch. (Matching is by name, so a
    fork pull request could add a same-named workflow, or give weekly-refresh.yml a pull_request
    trigger, and fire this trigger on main.) THEN the weekday of workflow_run.created_at (UTC): Sat
    sat, Sun sun, Mon mon-pre, Tue-Fri idle; date = that day; trigger = workflow_run.id. Every idle
    prints one enum idle_reason: path|repo|branch|event|weekday.
    workflow_dispatch: the mode input; date = today UTC (the Monday rule for mon-post); trigger
    "dispatch".
    parts: sat, mon-pre, dry "links core"; sun "links seed core"; mon-post "core"; idle none.
  facts.mjs emits the RUNNER FACTS JSON (below) on one line. It lists workflow runs BY WORKFLOW
  FILE, never by name: ghGet("actions/workflows/weekly-refresh.yml/runs?..."), and likewise
  weekly-feed.yml, send-watchdog.yml and monday-rehearsal.yml. It counts only runs with
  head_branch "main", head_repository.full_name == GITHUB_REPOSITORY and an event that is not
  pull_request or pull_request_target, so a fork's run can neither fake a refresh nor hide one.
  refresh.shipped_min comes from the jobs/steps of each run created on date: the completed_at of
  the step whose name starts "Ship bundles to R2" when its conclusion is success. For C0 it finds
  F, the newest main
  commit touching functions/, and reads the "Cloudflare Pages" check-run on F and every later main
  commit; if none exists, it re-polls every 60 s for up to 5 min before reporting "missing" (the
  check-run appears only once complete, under a minute after a push, with started_at = completed_at).
  C14: public sample privacy scan (unzip with zlib; counts only). The mirror step runs two drift
  tests and the purchase-email render, and reports enums: (1) the mail mirror (mirror); (2) the
  inbox mirror (c17.inbox_mirror): copy the SHIPPED inbox-status.js byte for byte into a temp dir
  next to a stub _github-oidc.js that returns {ok:true}, run onRequest over fixture inbox-watchdog-state.json
  objects (one per verdict, plus the boundaries 30 h and 72 h), and assert its JSON verdict equals
  inboxVerdict() for each. It also reads the checked-out functions/api/stripe-webhook.js as TEXT
  (no import, no network): c8.min_cents = N from the single line "const MIN_CENTS = N;" (-1 unless
  exactly one), and c8.events_mirror = ok if the set of string literals compared with
  `event.type ===` equals HANDLED_EVENTS imported from functions/api/_rehearsal.js, drift if not,
  error if the file cannot be read. Test all of it against fixtures.
- docs/rehearsal/monday-rehearsal.yml.txt: name "MassPermits monday rehearsal". Triggers:
  workflow_run (workflows: ["MassPermits weekly data refresh"], types: [completed]) - this MUST equal
  the name: line of .github/workflows/weekly-refresh.yml; schedule "0 20 * * 6", "0 20 * * 0",
  "0 10 * * 1", "30 20 * * 1", "0 13 * * 2"; workflow_dispatch with input mode (default dry). NO
  push key. Top-level "permissions: {}". Top-level "concurrency: {group: monday-rehearsal,
  cancel-in-progress: false}". EXACTLY TWO jobs; no job has actions: write or any write permission
  other than the caller's id-token.
  runner: permissions {contents: read, actions: read, checks: read}; NO id-token; references no
    secrets.* (it uses github.token, passed as env GH_TOKEN to the facts step). Allowed steps:
    actions/checkout WITH ref: main AND persist-credentials: false (never head_sha, head_ref or any
    github.event value: under workflow_run that would run a fork's own mode.mjs and skip the source
    guard), and actions/setup-node. Its run: blocks contain no "${{" either: the dispatch mode
    input reaches mode.mjs only through GITHUB_EVENT_PATH, and ${{ }} appears only under env:, if:
    and outputs:. Runs mode.mjs, then (unless idle) facts.mjs, C14 and the mirror step. Outputs:
    mode, date, trigger, parts, facts. Prints counts and enums only.
  caller: needs runner; if: needs.runner.outputs.mode != 'idle'; permissions {id-token: write}
    ONLY; NO uses: step, NO checkout; runner outputs reach it ONLY via env: (MODE, DATE, TRIGGER,
    PARTS, FACTS; RUN is the default GITHUB_RUN_ID copied into env), never ${{ }} inside the script
    text. It prints nothing that shows the roster size. Use this script, keeping every guard:
      set -euo pipefail   # never set -x / xtrace; never curl -v, --verbose, --trace, --trace-ascii
      case "$MODE" in sat|sun|mon-pre|mon-post|dry) ;; *) echo "bad mode"; exit 1;; esac
      [[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad date"; exit 1; }
      [[ "$TRIGGER" =~ ^([0-9]{1,20}|sched|dispatch)$ ]] || { echo "bad trigger"; exit 1; }
      [[ "$RUN" =~ ^[0-9]{1,20}$ ]] || { echo "bad run"; exit 1; }
      [ "${#FACTS}" -le 4096 ] || { echo "facts too large"; exit 1; }
      printf '%s' "$FACTS" | jq -e 'type == "object" and .v == 1' >/dev/null || { echo "bad facts"; exit 1; }
      mint() { curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
               "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=masspermits-cron" | jq -r .value; }
      for PART in $PARTS; do
        case "$PART" in links|seed|core) ;; *) echo "bad part"; exit 1;; esac
        PAGE=0
        while :; do
          OIDC=$(mint)                 # a fresh token per POST: they last about 5 minutes
          echo "::add-mask::$OIDC"     # immediately, before anything else
          curl -sS -o resp.json -X POST -H "Authorization: Bearer $OIDC" \
            -H "content-type: application/json" --data-binary "$FACTS" \
            "https://masspermits.com/api/rehearsal?mode=$MODE&part=$PART&page=$PAGE&date=$DATE&trigger=$TRIGGER&run=$RUN"
          unset OIDC
          # print nothing that shows the roster size: no counts, no line per links page
          if [ "$PART" = core ]; then
            jq -c '{ok, verdict, codes, error}' resp.json
          elif [ "$(jq -r '.ok == true' resp.json)" != true ]; then
            jq -c '{ok, error}' resp.json
          fi
          if [ "$PART" = links ] && [ "$(jq -r '.more == true' resp.json)" = true ] && [ "$PAGE" -lt 24 ]
          then PAGE=$((PAGE+1)); else break; fi
        done
      done

RUNNER FACTS (the runner-to-Function contract; R2a defines RUNNER_SCHEMA, R3a emits it)
One JSON object, at most 4 KB. Values are ONLY enums, booleans, integers in [-1, 100000] (-1 = none
or unknown), fixed-length integer arrays, or one 7-hex short SHA. No names, messages or URLs.
Unknown keys are dropped. A key with a wrong type or value is dropped and every check needing it is
BLIND code "schema". Minutes count from 00:00Z of `date` (each c9.mon_* entry from 00:00Z of its own
Monday). Dotted names are nested objects (refresh.state is facts.refresh.state). Keys:
  v: 1
  api: ok|rate_limited|forbidden|error            (not ok -> checks needing Actions facts are BLIND)
  refresh.state: none|queued|in_progress|completed   newest weekly-refresh.yml run created on date
  refresh.conclusion: success|failure|cancelled|timed_out|skipped|none   newest COMPLETED run on date
  refresh.ship_step: success|failure|skipped|cancelled|absent   step named "Ship bundles to R2..."
  refresh.failed_at: none|before_ship|ship|after_ship   first failed step vs the ship step
  refresh.runs, refresh.started_min, refresh.completed_min: int
  refresh.shipped_min: [int, int, int, int]   for each run created on date whose "Ship bundles to
      R2" step concluded success, that step's completed_at in minutes; ascending; the earliest 4;
      -1 padding. Ordering in mon-pre and mon-post is judged against this, never the newest run.
  (All refresh.* and send.* facts count only runs on head_branch main, from this repo, with a
  non-pull_request event.)
  send.state: none|queued|in_progress|completed    newest weekly-feed.yml run created on date
  send.runs, send.started_min: int
  c0.fn_state: success|failure|missing|error   check-run on F or any later main commit: success if
      any success; failure if every completed one failed; missing if none after the re-poll
  c0.fn_age_min: int; c0.fn_sha7: ^[0-9a-f]{7}$; c0.head_state: success|failure|missing|error
  c9.guard1_present: bool   ("selectRecipients" in functions/api/weekly-send.js on main)
  c9.mon_refresh_start, c9.mon_send_start, c9.mon_watchdog_start: [int, int, int, int]  last 4
      Mondays before date; -1 missing
  c9.refresh_late_min: int (refresh.started_min - 540); c9.push_workflows: int;
  c9.push_commits, c9.push_runs: int (since this workflow's previous run, touching any workflow with
      a push: trigger); c9.monday_sensitive: int (commits on a Monday date touching weekly-feed.yml,
      send-watchdog.yml or weekly-refresh.yml before the send started, or before now if not yet)
  c17.refresh_ok_age_h: int; c17.watchdog_mon, c17.watchdog_tue: bool; c17.rehearsal_prev_h: int
  c17.inbox_mirror: ok|drift|error   (the inbox-verdict drift test)
  c14.fetched: bool; c14.house_numbers, c14.contractor_echo, c14.owner_cue, c14.email_like,
      c14.hex32: int
  mirror: ok|drift|error; purchase.render: ok|error; purchase.link_first, purchase.month_line: bool
  c8.min_cents: int   (N from the one "const MIN_CENTS = N;" line in stripe-webhook.js; -1 if not
      exactly one)
  c8.events_mirror: ok|drift|error   (event.type literals in stripe-webhook.js == HANDLED_EVENTS)

WAIT (a first-class RESULT, never an action)
WAIT means "what is being judged has not happened yet, and a later trigger will judge it". A WAIT
NEVER sends mail, NEVER counts toward NO-GO or "blind on N", is NEVER "worse than Sunday", and a WAIT
record NEVER satisfies de-duplication. Exactly these cases:
  run-level, sat/sun: refresh.state queued|in_progress (its completion fires workflow_run).
  run-level, mon-pre: refresh.state none|queued|in_progress AND send.state none|queued (the 10:00Z
      backstop, on time or 5-7 h late).
  run-level, mon-post: send.state queued|in_progress (the Tuesday backstop re-judges).
  check-level, C0 only: c0.fn_state missing AND c0.fn_age_min < 15. The run continues; C0 is
      listed under "Not yet confirmed".
A run-level WAIT evaluates no other check: record {date, mode, part, trigger, run, verdict:"WAIT", code}
and return {ok:true, verdict:"WAIT", more:false, codes:[], error:null}. NOT WAIT: in mon-pre, a send that has started (send.state in_progress or
completed) while the refresh is not completed; it is judged by the ordering rule in RUNS (a finding
only if no Monday bundle had shipped by send.started_min); in sat/sun, refresh.state none (the only triggers that see it run
at or after 20:00Z, so it is C1 NO-GO C1.no_refresh). In dry, a run-level WAIT condition is
reported as a check-level WAIT on C1 instead, every other check still runs, and nothing mails.

CHECKS (the ID is the contract; the text is the pass condition; tier in brackets)
C0 [Core] Judge F, the newest main commit touching functions/, not HEAD (bot commits never touch
   functions/). fn_state success PASS; failure NO-GO C0.fn_build_failed; missing with age >= 15
   NO-GO C0.fn_no_deploy; missing with age < 15 check-level WAIT C0.deploy_pending; error BLIND.
   head_state failure alone is WARN C0.head_build_failed; a missing HEAD check is ignored. If C0 is
   NO-GO, C3-C8 are BLIND. No BUILD_SHA constant.
C1 [Core] refresh.conclusion success and refresh.ship_step success for the newest completed run on
   date; status.ok true, or degraded with rows; status.error does not contain "bundle build
   crashed". refresh.state none: NO-GO C1.no_refresh in sat/sun (run-level WAIT rules otherwise).
C2 [Core] ran_at within 15 min of the weekly zip, weekly html and monthly zip uploads, IN BOTH
   DIRECTIONS (binding reads). At least 3 days of margin before the 8-day clocks. Monthly zip at
   most 48 h old.
C3 [Core] evaluate(now, inp) with inp = gather(env, {hash:false}) and inp.policy = {...inp.policy,
   send_dow: the UTC weekday of the RESOLVED `date` (never the Function's own weekday), send_hour:
   the current UTC hour if now falls on `date`, otherwise 23} is GO or GO_WITH_DISCLOSURE and
   customer_gets_nothing is false; BLIND if status.bundle is absent; BLIND C3.clock if now is
   before 00:00Z of `date`. `now` stays the real time. Why: crons run 5-7 h late, so the Sat/Sun
   20:00Z backstops run about 01:00-03:00Z the next day; with the clock's weekday, windowStart
   moved to the next day, the date's bundle fell outside it, now was before that day's 20:00Z hold
   deadline, and evaluate returned HOLD: a false NO-GO. With `date`'s weekday, windowStart is
   `date` 00:00Z and dueAt stays on `date` (_presend.js:102-112). mon-pre uses the real policy
   unchanged (send_dow 1).
C4 [Core] Build-time manifest: opens_as_zip, has_all_leads, rows > 0, rows within 60% of the last
   delivered bundle_rows, for weekly and monthly.
C5 [Core] renderWeekly for every active row: download link present and first; 32-hex token; no
   calendar date older than 21 days; no "upstream", "provider" or vendor names; attachment under
   2 MB; WARN if no /leads link. WARN (ackable C5.style_*) on em dash, emoji, or a missing
   text/plain part. Purchase email from the runner facts: purchase.link_first false or
   purchase.month_line true is NO-GO C5.purchase_copy (ackable; it FAILS on today's shipped code).
   mirror drift makes C5 BLIND ("mirror drift"). No "numbers equal coverage" check.
C6 [Core] In-process links as above.
C7 [Core] Sets: S = Stripe entitled (active|trialing|past_due on MassPermits price ids);
   R = roster rows with email && active !== false; M = the union of `to` with ok:true over EVERY
   feed-send-log.json entry whose `at` is in "that Monday's" window (real policy, send_dow 1:
   mon-post's own Monday; otherwise the newest Monday window at or before `date` holding an ok
   entry, at most 14 days back; none -> the M comparison is BLIND C7.no_recent_send). Do NOT use
   bestSince for M: it returns only the newest delivered entry. T = the `at` of the OLDEST entry
   in that window with an ok delivery (written after that run's sends; there is no per-recipient
   time); D = T's UTC date.
   NEW since Monday (N): an active row whose `since` (YYYY-MM-DD, set when the row is created) is
   after D, or, with the key, whose entitled Stripe subscription has `created` after T
   (stripeResult.subs are the raw Stripe objects; `created` is unix seconds; a re-subscription
   reactivates the old row and keeps its old `since`). `since` == D with no Stripe
   `created` to decide -> WARN C7.new_same_day, never NO-GO.
   CANCELLED since Monday (G): a row in M now inactive with `cancelled` on or after D (and, with
   the key, absent from S).
   "With the key" means STRIPE_READ_KEY is set AND the subscriptions read came back readable.
   PASS with the key: RECONCILE_MAP (below) yields no C7 NO-GO, R minus M is inside N, and M minus
   R is inside G. S = R is judged BY reconcile()'s direction A findings (S minus R) and direction B
   findings (R minus S), keyed on Stripe customer id with an email diagnostic; do not re-implement
   that match. N and G rows are listed in the digest ("New since Monday: buyer 6, first weekly Mon
   MM-DD"; "Cancelled since Monday: buyer 5"), never counted as a mismatch. Otherwise NO-GO naming
   the buyer and the sets ("buyer 4: in R since MM-DD, not in M"). One digest line per buyer, most
   severe code first.
   Without the key: the S comparison and the M rule are BLIND C7.no_key; the table's no-key column
   applies; a week-over-week drop in funnel-metrics paying with paying_total unchanged is WARN
   "confirm it was a real cancellation".
   C7's NO-GO comes ONLY from RECONCILE_MAP plus the M rule. NEVER from reconcile()'s verdict,
   condition_verdicts, alarms or counts. Why: reconcile()'s Stripe-independent tripwire pushes a
   RED recipient_dropped_between_runs into missing_payers for any ok recipient of the second-newest
   send who is missing from the newest and whose row is inactive, with or without the key, and
   nothing clears it when Stripe confirms the cancellation. That is every legitimate cancellation,
   for the week after the next Monday (buyer 5 cancels Wed 10-07, Mon 10-12 omits them, and until
   Mon 10-19 the tripwire compares 10-12 with 10-05). Read as NO-GO it would be a false,
   never-ackable NO-GO in mon-post 10-12 and the whole weekend 10-17/18.
   RECONCILE_MAP (finding type -> result with the key | result without the key or Stripe
   unreadable); locate the buyer with ref.row:
   - recipient_dropped_between_runs: "Cancelled" (listed "Cancelled: buyer 5 (MM-DD); Stripe shows
     no live subscription", NEVER counted) when ALL hold: ref.row is not null; that row has
     active === false; it has a `cancelled` date on or after the UTC date of
     recon.local_tripwire.prev_at; and no subscription in stripeResult.subs with a status in
     ENTITLED_STATUSES and a classifySub kind other than "other" has subCustomerId equal to the
     row's customer or (expanded read) subCustomerEmail equal to the row's email, case-folded.
     Otherwise NO-GO C7.dropped_recipient. | "Cancelled, unconfirmed" (listed "... not confirmed in
     Stripe (no key)", never counted) when the first three hold; otherwise NO-GO
     C7.dropped_recipient (no row, or a row switched off without a `cancelled` date, which
     deactivateSubscriber always writes, stripe-webhook.js:391-392).
   - payer_inactive_on_roster: NO-GO C7.paid_not_served (S minus R) | not produced.
   - payer_missing_from_roster: NO-GO C7.paid_no_row | not produced.
   - unclassified_payer_missing_from_roster: NO-GO C7.unknown_payer_no_row | not produced.
   - roster_active_no_live_subscription: NO-GO C7.served_not_paid (R minus S) | not produced.
   - no_enabled_webhook_endpoint_for_site: C8 NO-GO C8.no_endpoint | not produced.
   - churn_event_not_subscribed: C8 NO-GO C8.events_missing (same fact as C8 (a); one line) | not
     produced.
   - customer_id_conflict: NO-GO C7.customer_id_conflict | not produced.
   - duplicate_roster_rows_same_email, severity red: NO-GO C7.duplicate_active_rows | same.
     Severity amber: WARN C7.duplicate_rows_latent | same.
   - one_customer_id_on_several_emails: WARN C7.shared_customer_id | same.
   - active_row_without_customer_id: NO-GO C7.row_without_customer_id | same.
   - duplicate_stripe_customers_same_email (added by the change list): WARN
     C7.duplicate_stripe_customers | not produced.
   - entitled_subscription_unknown_price: NO-GO C7.unknown_price | not produced.
   - product_allowlist_unconfigured: BLIND C7.allowlist_unset | not produced.
   - read_failed roster: not reached (readRoster failed first: NO-GO roster_unreadable, and
     reconcile() is not called). read_failed send_log: BLIND C7.send_log_unreadable (M rule and
     tripwire). read_failed stripe_subscriptions: BLIND C7.no_key (reason no-key) or
     C7.stripe_unreadable (other reasons). read_failed stripe_webhook_endpoints: C8 (a) BLIND
     C8.endpoints_unreadable.
   - degraded_read: WARN C7.degraded_read | not produced.
   - webhook_endpoint_path_ambiguous (added by the change list): C8 (a) BLIND C8.endpoint_ambiguous.
   - notices: dropped_but_still_active -> no result (the M rule judges that row);
     stripe_returned_nothing -> a digest line under the C7.served_not_paid lines ("check that
     STRIPE_READ_KEY is a live-mode key"); unverifiable_no_id -> WARN C7.row_unverifiable;
     below_floor_unrostered, matched_by_email_only, trialing_and_served, pause_collection,
     cancel_at_period_end -> no C7 result.
   - any other type: BLIND C7.unmapped (ACCEPTANCE 19 makes this impossible to ship).
   So without the key C7's only NO-GOs are C7.dropped_recipient, C7.duplicate_active_rows,
   C7.row_without_customer_id and roster_unreadable.
C8 [Core] Inputs: the four reads under "Reconciliation" plus c8.min_cents and c8.events_mirror.
   HANDLED_EVENTS = the 9 types stripe-webhook.js compares event.type with (derive them from the
   file; today :41 customer.subscription.deleted, :59 invoice.payment_failed, :105-107
   radar.early_fraud_warning.created, charge.dispute.created, review.opened, :141 review.closed,
   :158 invoice.paid and invoice.payment_succeeded, :243 checkout.session.completed).
   (a) the enabled endpoint for siteHost (at /api/stripe-webhook, per the change list) subscribes to
       "*" or to every HANDLED_EVENTS type; missing any: NO-GO C8.events_missing naming them;
       c8.events_mirror not ok: (a) BLIND "event list drift".
   (b) every active MassPermits price (in MASSPERMITS_PRICE_IDS, or under MASSPERMITS_PRODUCT_IDS)
       with unit_amount > 0 is >= c8.min_cents, and so is its net after each active promotion code
       whose coupon applies to it (applies_to absent in a coupon read with that field = all
       products); below: NO-GO C8.below_floor; a coupon whose scope or discount cannot be read:
       WARN C8.promo_scope_unknown; c8.min_cents -1: (b) BLIND.
   (c) any active price that is NOT a MassPermits price and is >= c8.min_cents: WARN
       C8.sibling_over_floor (the webhook's floor would treat it as MassPermits, I-02).
   (d) at least one active Payment Link has a line item on a MassPermits price, else WARN
       C8.no_live_link.
   BLIND without the key. The key keeps Prices:Read.
C9 [Core] Duplicate half (never ackable): at most 1 ok delivery per recipient per Monday window.
   Forecast half (C9.guard1_late, ackable): NO-GO if guard1_present is false AND the predicted send
   (from c9.mon_send_start) > due + 1.5 h. Report push commits and runs; in mon-pre,
   c9.monday_sensitive > 0 is NO-GO.
C10 [Ext] Boston newest <= 4 days; every other source by cadence: daily 10, monthly 55, quarterly
    130 days, plus per-source overrides (put the table in _rehearsal.js with a comment naming the
    engine as its source).
C11 [Ext] status.window_loss per monthly source == 0; BLIND if absent.
C12 [Ext] live_sources not down by more than 3 against last Monday's coverage.live_sources, or the
    previous rehearsal record's live_sources when that is null; lost towns listed.
C13 [Ext] status.contracts.ran === true with 0 paid blocks; live <= attempted; dead-status rows 0.
C14 [Core] Sample (runner, unzip): house numbers, contractor echoes, owner-cue names, and any
    email-shaped or 32-hex string = 0 (counts only, from c14.*).
C15 [Ext] Secrets, ignore rules, route-home link; in-Function: no roster email or token prefix in
    index.html or offer.html, read ONLY via readAsset(env, "/index.html" | "/offer.html") (the one
    env.ASSETS.fetch). Runner: also count email-shaped strings in the logs of this week's
    weekly-feed.yml runs and emit only c15.feed_log_emails: int (> 0 is NO-GO C15.feed_log_emails,
    ackable): weekly-feed.yml:39-41 prints the weekly-send response, which lists every recipient.
    The log download redirects to a storage host: add ONE runner function for it, fetch the
    redirect target WITHOUT the Authorization header and only on a GitHub-owned host you name from
    GitHub's docs, keep the text in memory, print counts only.
C16 [Ext] CI: shipped newsletter-send.js and nurture.js make 0 Resend calls to a synthetic payer.
C17 [Core] From c17.*: refresh ok age < 30 h, send-watchdog Monday and Tuesday runs present,
    rehearsal previous run present; inbox verdict via inboxVerdict on the binding read, as above.
C18 [Core] Sunday always mails once per date after its first non-WAIT verdict, again only if a
    later Sunday run changes the verdict; Saturday and mon-pre only on NO-GO or a worsened verdict;
    a run-level WAIT never mails; the Resend id is logged; no retry; at most 3 owner and 3 seed
    attempts per UTC day (a refused send is mail: "capped", WARN C18.mail_capped); an existing but
    unreadable log.json or a failed attempt-record write means no send; a recipient failing the
    lock is mail: "refused", WARN C18.mail_refused; with REHEARSAL_MAIL unset every send is
    mail: "off", which is never a finding.
C19 [Ext] Every buyer has a dl/ or portal-access/ event within 72 h of purchase or the last Monday
    (list metadata only); C19.no_open ackable.
C20 [Ext] Seed send: sun only, part=seed, once per date, a synthetic subscriber "Rehearsal", token
    "REHEARSAL-LINK-DISABLED", the real latest-weekly.zip attached, subject + " (preview MMDD)".
    Refused if any seed equals a roster email, active or not, compared trim().toLowerCase() on
    both sides (NO-GO), or the roster is unreadable. A failed send is
    WARN C20.seed_send_failed, never retried. At most 3 seed attempts per UTC day (C18 cap).
C21 [Ext] Owner attestation env REHEARSAL_R20_DONE; otherwise C21.unattested.
C22 [Ext] DNS baseline.

RUNS
sat: the WAIT rule first. Then Core checks plus built Extended; mail only on NO-GO.
sun: the WAIT rule first. Then the same plus C20 if built; always mail once a non-WAIT verdict
    exists; write
    rehearsal/<date>.json (verdict, bundle_etag, rowset_sha256, live_sources, per-check results).
mon-pre: the WAIT rule first. Then C0-C4, C6, C9, C17 with send_dow 1, EXCEPT C3 once the send
    has started: if send.state is in_progress or completed, do not evaluate C3; record PASS
    C3.already_sent ("gate forecast not re-run: the send had started"). (Otherwise a late 10:00Z
    backstop, or a second refresh failing after the send, runs the real-policy evaluate, finds the
    delivered etag and returns NO_GO already_delivered, _presend.js:385-411, which would be mailed
    as "worse than Sunday". Whether the send used a Monday bundle is the ordering rule's question.)
    Store bundle_etag and rowset_sha256 in the mon-pre core record. Delta against the Sunday
    record (rows not down > 10%, nothing that passed Sunday now NO-GO, refresh.runs >= 2 reported);
    if the send has started (send.state in_progress|completed) and no refresh.shipped_min entry is
    >= 0 and <= send.started_min -> the ordering finding, then mon-post logic (judged against any
    earlier ship, not the newest run, so a refresh started after a good send is not misread);
    Sunday record missing, WAIT-only, or its email mail: "failed" or "capped" -> finding (mail:
    "off" is not); mail only if worse than Sunday or that Sunday finding.
mon-post (date = that Monday): the WAIT rule first. Then exactly one ok delivery from 00:00Z that
    Monday for every active subscriber EXCEPT those new since the send (C7's N rule; with no key,
    `since` > D excludes and `since` == D is WARN mon_post.new_same_day; known limit without the
    key: a re-subscription after the send keeps its old `since` and reads as a miss); two or more
    is a duplicate; zero for any other active row is a miss; sets equal with C7's N and G
    exclusions AND through RECONCILE_MAP (on the Monday after a cancellation the tripwire fires and
    the buyer is listed "Cancelled", never NO-GO); no skipped entry; some refresh.shipped_min
    entry for that Monday is >= 0 and <= T in minutes from 00:00Z that Monday (T = the first ok
    delivery, as defined in C7), i.e. judged
    against the refreshes that shipped BEFORE the send, never
    the newest one (a refresh run by hand after a good send must not read as "send before
    refresh"), and NOT status.ran_at (by Tuesday it is Tuesday's);
    an EMPTY roster is NO-GO (weekly-send.js returns 200 "no active subscribers" and logs nothing);
    sent etag matches mon-pre's record: "sent" = bundle_etag and bundle_rowset of the log entry at
    T (weekly-send.js:169, :262), "recorded" = bundle_etag and rowset_sha256 of any non-WAIT mon-pre
    core record for that Monday; PASS if one has the same etag (and the same rowset when both have
    one), else WARN mon_post.etag_unjudged naming refresh.runs >= 2 as the likely cause (no non-WAIT
    mon-pre record at all is the finding below instead); zero rehearsal-persisted beacons;
    "mon-pre never reached a verdict that Monday" is a finding; mail only on a problem.
dry: the sat check set with today's date (plus C20's render, if built, but no send), never mails.

PHASES
R1: the TEST METHOD harness, plus a test RSA key pair (node:crypto) whose JWK the fetch stub serves
    at https://token.actions.githubusercontent.com/.well-known/jwks, so tests can sign RS256
    tokens for the REAL _github-oidc.js; _ro_bucket.js (five methods only) and its tests;
    _rehearsal_mail.js plus
    rehearsal_mirror.test.mjs, which copies the SHIPPED weekly-send.js and _presend.js into a temp
    dir, stubs only _github-oidc.js, runs onRequest with a fake R2, captures the Resend bodies, and
    asserts subject+html === renderWeekly for 3 synthetic subscribers (with and without token, with
    and without coverage); a purchase-email CI render from the shipped stripe-webhook.js with a
    synthetic signed checkout.session.completed; presend_replay.mjs: if branch
    claude/seed-rehearsal-inputs exists, take scripts/rehearsal/presend_replay.mjs from it and run
    it (do not rewrite it); otherwise write one replaying four incident shapes through evaluate()
    (08-03 failed refresh, 08-09 duplicate, 09-07 new-etag duplicate, 09-23 status older than
    bundle). Never use its --live mode.
R2a: _rehearsal.js (lattice with WAIT, known-open, digest, RUNNER_SCHEMA and validateRunnerFacts,
    inboxVerdict, C0 judgement, C1-C7 in-Function with C3 on date's weekday and C7's N/G rule, C9
    duplicate half and forecast judgement, C17, C18); rehearsal.js (auth first, params,
    de-duplication, log with the fail-closed read, parts and paging, the counts-free response,
    top-level catch, readRoster, outbound() with stripeGet and sendInternal (recipient lock with
    trim/lowercase and non-empty env values), the daily mail cap with the fail-closed attempt
    write); mon-pre (C3 skipped once the send has started; bundle_etag and rowset_sha256 in its
    record), mon-post (ordering on refresh.shipped_min; step 4 against that record); drills and
    negative twins for those checks; the Function side of F1-F12; the grep, leak, write-set,
    mail-lock, file-allowlist, import-allowlist, auth-gate (17) and outbound-structure (18) tests.
R3a: scripts/rehearsal/* (http.mjs, mode.mjs with the workflow_run source guard, facts.mjs listing
    runs by workflow file with the C0 re-poll and refresh.shipped_min, C14, mirror step with the
    mail and inbox drift tests plus c8.min_cents and c8.events_mirror) and a test that validates
    facts.mjs output (from fixture API responses) against RUNNER_SCHEMA imported from
    functions/api/_rehearsal.js; the runner side of F1, F7 and F10; the .yml.txt (runner checkout
    ref: main, persist-credentials: false) and its tests; HANDLED_EVENTS and RECONCILE_MAP in
    _rehearsal.js with both columns of the C7 table, C8 rules (a)-(d), and drill F13; C7 keyed half
    and C8: if branch
    claude/seed-rehearsal-inputs exists, port its functions/api/_reconcile.js (the ONLY other file
    taken from it; do NOT create a stripe-reconcile route) and apply these fixes: has_more must be
    boolean or the read is bad-shape; churn coverage by exact endpoint path; duplicate Stripe
    customers on one email; the invariant stripe_entitled_total === considered +
    classified_other; fetchImpl REQUIRED (replace "opts.fetchImpl || (typeof fetch === 'function'
    ? fetch : null)" in both readers with "opts.fetchImpl || null", so a missing fetchImpl is
    unreadable "no-fetch" and never falls back to the global fetch); a private ref: {row, sub} on
    every push() and addNotice() (for the tripwire, row = the index of the roster row whose lc(email)
    equals the dropped address, or null); the three C8 readers listStripePrices,
    listStripePromotionCodes, listStripePaymentLinks. Build synthetic fixtures from scratch
    (scenarios 25-28, plus prices, promotion codes and Payment Links). If the branch is absent,
    implement C7/C8 minimally with GET-only calls through an injected, required fetchImpl, with the
    same finding types so RECONCILE_MAP applies. Their drills. Optional:
    docs/rehearsal/pr-tests.yml.txt: on: pull_request (paths functions/**) ONLY, never
    pull_request_target, workflow_run or push; top-level permissions {contents: read} and no other
    permission anywhere; no id-token; no secrets.* reference; steps: actions/checkout with
    persist-credentials: false, actions/setup-node, node functions/api/all.test.mjs.
R4: fresh-context adversarial review. Try to (1) make any mode call Resend for a roster email,
    (2) persist a dl/ or portal-access/ object, (3) write outside rehearsal/, (4) get a PASS from a
    fault fixture, (5) leak an email, a 32-hex token, cus_, a domain or a street into a response, an
    error, a runner log or the caller's printed projection, (6) reach a forbidden route by any
    string or URL construction, (7) give the runner job an id-token or the caller job a second URL,
    (8) make any job or script dispatch, re-run or cancel a workflow, or give any job actions:
    write, (9) make the caller print the OIDC token, (10) import a mail-capable module or forward
    any authorization header to any handler, (11) inject a mode, part, page, date, trigger or
    run value that changes the caller URL, (12) raise a false alarm from F1-F13's shapes (in
    particular a C7 NO-GO from reconcile()'s tripwire after a legitimate cancellation), (13) get
    past rehearsal.js's auth gate with no token, a wrong aud, a wrong ref or an expired token, or
    make it do any R2, Stripe or Resend work first, (14) make code inside the Function reach
    masspermits.com, api.github.com or any host other than api.stripe.com (GET) and Resend (via
    sendInternal), by any URL construction, (15) exceed 3 owner or 3 seed sends in one UTC day,
    (16) drive a non-idle run from a workflow_run whose path, head repository, head branch or event
    is not main's weekly-refresh.yml, (17) make _ro_bucket write through any method other than
    put/delete under rehearsal/, or make a handler write under rehearsal/ through the default
    roBucket, (18) get an owner or seed send past the recipient lock with mixed case, surrounding
    whitespace, two "@" or unset env values, (19) reset the mail cap by corrupting or failing
    rehearsal/log.json, (20) make the runner check out anything but main or put "${{" in any run:
    block, (21) make the caller's public output reveal the roster size. Fix what breaks, and record
    each attempt and result in the PR body.
R2b [Ext]: C10-C13, C15 in-Function (through readAsset, the one env.ASSETS.fetch), C16, C19, C20
    with functions/api/rehearsal-seed.js (POST;
    constant-time compare with env.REHEARSAL_SEED_TOKEN first, 401 with 0 R2 ops on a bad token,
    404 when unset; imports only ./_ro_bucket.js and writes ONLY through roBucket; writes exactly
    one key, rehearsal/seed-<date>.json, where <date> is the most recent Sunday at or before the
    Function's own UTC time, formatted YYYY-MM-DD and checked against ^[0-9]{4}-[0-9]{2}-[0-9]{2}$,
    never taken from the body or query; body at most 256 bytes; stores exactly {run, placement,
    has_attachment} with placement in inbox|spam|missing, has_attachment boolean, run an integer
    0-48; unknown keys dropped; a wrong type is 400 bad_param with nothing written; responds {ok}
    only; covered by acceptance 5 and 7), C21; their drills and twins.
R3b [Ext]: runner C15 (with c15.feed_log_emails and its one redirect-host function) and C22;
    docs/rehearsal/dns-baseline.json (PLACEHOLDER values plus
    instructions; do not query DNS); docs/rehearsal/seed-reporter.gs (finds subject:"(preview MMDD)"
    in inbox or spam, POSTs to the rehearsal-seed route, token from Script Properties); renewals:
    items.data[].current_period_end within 8 days (NOT on the Subscription object),
    cancel_at_period_end, past_due.

DRILLS (one per incident; the fixture stages the fault; write each in the phase that builds its
check; checks not yet built are reported as "not built", not as a miss)
I-01 no token -> C5,C6 | I-02 sibling price 4900c >= c8.min_cents -> C8 WARN C8.sibling_over_floor |
I-03 token string in a workflow -> C15 | I-04 promo 90% off the $99 MassPermits price (net 990) with
c8.min_cents 1000 -> C8 NO-GO C8.below_floor (twin: min_cents 500 passes; runner side: MIN_CENTS
mutated to 1000 in a temp copy of stripe-webhook.js gives c8.min_cents 1000; NOT C7: no component
reads charges or delivery-log.json) | I-05 c0.fn_state failure
-> C0 NO-GO (twin: head_state failure alone -> WARN) | I-06 seed "spam" -> C20; missing
per-recipient entry for a subscriber whose `since` is before the send -> mon-post | I-07 no route-home link -> C15 | I-08 payer on the newsletter
list -> C16 | I-09 live 23 vs 70 -> C3,C12 | I-10 ok:false + old bundle + no refresh today, as a
sat/sun backstop run -> C1,C2,C3 | I-11 two deliveries in one window -> C9,mon-post | I-12 skipped
entry, and an empty roster -> C3,mon-post | I-13 endpoint lacking invoice.payment_failed -> C8
NO-GO C8.events_missing (the past_due-without-payment_failing half is R3b renewals; NOT C7) | I-14
latest-monthly.zip missing, so every row's &k=monthly link 404s, + purchase render without a link
-> C6,C5 | I-15 late crons -> C9 report | I-16 Stripe 5 / roster 4 -> C7 C7.paid_not_served | I-17 Boston newest 6 d -> C10 | I-18 no
GUARD 1 + late send + Monday commit touching send-watchdog.yml -> C9 | I-19 status.error "bundle
build crashed" -> C1,C3,C4, plus a warn-mode twin where status is ok and every check passes
(recorded as the known miss) | I-20 house number in a description -> C14 | I-21 "the owners of
<invented name>" -> C14 | I-22 today's shipped copy at date 2026-10-04 -> C5 NO-GO | I-23 no
text/plain + DMARC changed -> C5 WARN, C22 | I-24 ran_at 24 h older than the zip -> C2 (reported,
nothing re-run) | I-25 window_loss field -> C11 (reader only) | I-26 dead and stale sources ->
C10,C12 | I-27 contracts.ran false, live > attempted -> C13 | I-28 "you both get a month" + missing
Radar events + an entitled subscription on a price in no allowlist -> C5,C8,C7 C7.unknown_price
(no "pack buyer" drill: a one-time purchase is not a subscription and nothing here reads it)
| I-29 no Sunday record, a WAIT-only Sunday, inbox "never", inbox "backlog" ->
mon-pre,C17 | I-30 roster email inside index.html fixture -> C15 | I-31 no /leads link, zero portal
events -> C5 WARN, C19.
FALSE-ALARM DRILLS (healthy worlds at awkward moments; each must NOT alarm)
F1 Tuesday 13:05Z mon-post backstop after a healthy Monday, Tuesday's refresh done at 12:51Z ->
   date = Monday, PASS, no mail. F2 Tuesday backstop when Monday's mon-post has a non-WAIT record ->
   skipped. F3 mon-pre 10:00Z, no refresh, no send -> WAIT, 0 Resend calls, later workflow_run not
   blocked. F4 mon-pre late, refresh in_progress, send not started -> WAIT. F5 sat backstop with
   refresh in_progress, then its workflow_run -> WAIT then a real verdict, mailing once on a NO-GO
   world. F6 corrupt subscribers.json (truncated JSON containing a synthetic @example.com address),
   and one that parses to an object -> fixed codes only, roster checks NO-GO, 0 seed sends, fixed
   owner text, no "@" in any response. F7 C0: F pushed 2 min ago, no check-run anywhere -> runner
   re-polls, C0 check-level WAIT, verdict unaffected. F8 C0: F 3 days old with success, HEAD bot
   commit 20 s old with no check-run -> C0 PASS. F9 mon-post while weekly-feed is in_progress ->
   WAIT, Tuesday backstop not blocked. F10 late weekend backstops in a healthy world, no earlier
   core record for their dates: the sat backstop run at Sunday 02:00Z (date = Saturday) and the
   sun backstop run at Monday 02:00Z (date = Sunday), each date's refresh succeeded and its bundle
   was uploaded about 14:00Z that day -> date keeps the cron's day; C3 PASS (never HOLD); sat 0
   Resend calls; sun exactly 1, to the owner, subject starting "GO" (the Sunday heartbeat) and
   nothing else; twin: the same late sun run with that day's refresh failed and Saturday's bundle
   in R2 -> NO-GO on C1. F11 new buyer since Monday: last Monday 5 ok recipients, roster 6 active,
   row 6 since the Wednesday after (with the key: Stripe 6 entitled, row 6 created Wednesday) ->
   C7 PASS with "New since Monday: buyer 6" listed, no alarm mail; and for mon-post a buyer who
   pays Monday 19:00Z after an 18:00Z send (since = that Monday) -> PASS with the key, WARN
   mon_post.new_same_day without it, never NO-GO; twin: row 6 since before the send and absent
   from M -> NO-GO. F12 cancellation since Monday: buyer 5 got Monday's email, row now inactive
   with cancelled Wednesday, absent from S -> C7 PASS with "Cancelled since Monday: buyer 5"
   listed; twin: same row while Stripe still bills it -> NO-GO "in S, not in R".
   F13 (R3a) cancellation BEFORE the most recent Monday: buyer 5 is an ok recipient of Mon 10-05
   (second-newest send) and absent from Mon 10-12 (newest); the row is inactive with cancelled
   10-07; with the key Stripe returns no subscription for buyer 5 (the list omits canceled ones).
   Run mon-post dated 10-12, sat 10-17 and sun 10-18, each with and without the key, through the
   PORTED reconcile(). First assert reconcile() reported recipient_dropped_between_runs for buyer 5
   (so the drill cannot pass vacuously). Then: C7 lists "Cancelled: buyer 5 (10-07)" (no key: "not
   confirmed in Stripe") and is NEVER NO-GO (PASS with the key, BLIND C7.no_key without); mon-post
   step 2 likewise; sat 0 Resend calls; sun exactly 1, subject starting "GO". Twins: (a) with the
   key, Stripe still bills buyer 5 (active subscription, MassPermits price, buyer 5's customer id)
   -> NO-GO naming buyer 5 (C7.paid_not_served and C7.dropped_recipient, one digest line); (b)
   without the key, the row's cancelled field removed -> NO-GO C7.dropped_recipient.

ACCEPTANCE (all must pass; paste the output into the PR body)
1. node functions/api/all.test.mjs (create it if absent) exits 0. List per-file pass counts.
2. Drills: every fault fixture makes its named (built) check non-PASS, and every negative twin
   returns PASS. F1-F13 all pass. Print a table ID -> check -> result -> Y/P/N. Do NOT assert a
   total: the owner reads the count.
3. Mirror drift test passes against the shipped weekly-send.js, and FAILS when one character of
   weekly-send.js's html is changed in the temp copy (mutation proof).
4. Route grep: no non-test file added by this PR (functions/, scripts/rehearsal/, docs/rehearsal/,
   test/rehearsal/), comments included, matches
   (?<![A-Za-z0-9_])/api/(weekly-send|mail-owner|newsletter-send|newsletter|nurture|lifecycle-send|request-sample|agent-sample|upload-bundle|funnel|hit)\b,
   masspermits\.com/api/(the same list), force=1, or a *.pages.dev hash host. *.test.mjs files are
   exempt.
5. Write-set test: across every mode and drill (and, once built, every rehearsal-seed.js request,
   including a body that tries to name another date or key), persisted R2 writes are only under
   "rehearsal/"; captured-but-dropped writes are exactly one portal-access/ per /leads call and
   zero dl/. Unit test: roBucket's own methods are exactly get, head, list, put, delete (plus the
   captured log); calling createMultipartUpload or resumeMultipartUpload on it throws, and the
   underlying fake bucket records 0 operations. roBucket(bucket) with NO options drops a put to
   "rehearsal/x" (captured, 0 persisted); only {allowPrefix: "rehearsal/"} persists it; every
   Request context passed to my-leads.js and leads.js carries the no-options roBucket.
6. Mail-lock test: across every drill, 0 Resend calls to any roster email; 0 Resend calls at all
   when REHEARSAL_MAIL is unset (recorded mail: "off"); 0 Resend calls in any run-level WAIT; a
   seed equal to a roster email refuses the seed send and yields NO-GO; an unreadable roster
   yields 0 seed sends. Daily cap: with 3 owner attempts already recorded for the current UTC day,
   a 4th owner send makes 0 Resend calls and records mail: "capped"; the same for seeds; the
   attempt record is written before the Resend call; a failed attempt counts toward the cap.
   Fail closed: an existing rehearsal/log.json holding invalid JSON, or valid JSON of the wrong
   shape, ends the request with error log_unreadable, 0 Resend calls and the object unchanged; a
   MISSING log.json is a fresh start; an attempt-record put that throws makes 0 Resend calls.
   Recipient lock (normalised both sides): the roster holds "Seed@Example.com" and
   REHEARSAL_SEEDS holds " seed@example.com " -> the seed send is refused and C20 is NO-GO; an
   INACTIVE roster row with the owner's address also refuses the owner send; with REHEARSAL_TO
   and OWNER_EMAIL both unset (or empty, or whitespace), sendInternal(undefined, ...) and
   sendInternal("", ...) make 0 Resend calls (mail: "refused"); "a@b@example.com" is refused;
   REHEARSAL_TO " Owner@Example.com " accepts to "owner@example.com" (the lock is symmetric).
7. Leak test: every rehearsal.js response (including error responses and F6), every runner stdout
   and the caller's printed output across all drills contain no "@", no /[0-9a-f]{32}/, no "cus_"
   and no street pattern. Every response has exactly the keys ok, verdict, more, codes, error; no
   response and no caller output contains a count or varies its line count with the number of
   subscribers (run the caller script against a stub server with 3 and with 30 subscribers and
   compare the printed lines: identical).
8. `git diff --name-only origin/main` lists no path under .github/, none of the NEVER-edit files,
   and no new functions/ path outside the FILE RULES allowlist.
9. Every .yml.txt parses as YAML (a small parser, no deps; or assert by line rules) and has no
   "push:" key under on: (a comment that mentions push is not a failure).
10. The fetch stub recorded 0 calls to non-fixture URLs; rehearsal.js's outbound hosts are a subset
    of {api.resend.com, api.stripe.com, token.actions.githubusercontent.com}; every runner request
    is a GET to api.github.com or to https://masspermits.com/api/sample, plus, from R3b, the one
    log-download redirect host C15 names, reached with no Authorization header. (The run-time lock
    itself is acceptance 18.)
11. The workflow_run.workflows[0] in monday-rehearsal.yml.txt equals the name: line of
    .github/workflows/weekly-refresh.yml on main.
12. In monday-rehearsal.yml.txt: exactly two jobs; top-level permissions {}; concurrency group
    monday-rehearsal with cancel-in-progress false; runner permissions exactly {contents: read,
    actions: read, checks: read} and no secrets.* reference; exactly one job (caller) has id-token:
    write, and it has no other permission, no uses: step, no checkout, and one literal URL,
    https://masspermits.com/api/rehearsal; NO job has actions: write; the caller script contains
    "::add-mask::", a mint inside the per-POST loop, the mode/part/date/trigger/run checks before
    the URL, and none of "set -x", "xtrace", "curl -v", "--verbose", "--trace". NO run: block in
    EITHER job contains "${{" (env:, if: and outputs: may). The runner's only uses: steps are
    actions/checkout and actions/setup-node; its checkout has "ref: main" and
    "persist-credentials: false"; the file contains none of "head_sha", "head_ref",
    "github.event.workflow_run.head", "github.event.pull_request" (under workflow_run a checkout of
    the triggering head would run a fork's own mode.mjs). If docs/rehearsal/pr-tests.yml.txt exists: its on: has
    pull_request and nothing else (no pull_request_target, workflow_run, push or schedule); its
    only permissions are top-level {contents: read}; no job declares permissions; the file contains
    no "id-token", no "secrets." and no "pull_request_target" anywhere; its checkout step sets
    persist-credentials: false.
13. mode.mjs: each schedule string maps to its mode; a late sat/sun backstop keeps its date; both
    mon-post crons (including a Tuesday run and a Monday run delayed past midnight) resolve to the
    Monday; a Tuesday-to-Friday workflow_run resolves to idle (idle_reason weekday). Source guard
    fixtures, each a Saturday workflow_run otherwise valid, must resolve to idle with the named
    reason: path ".github/workflows/other.yml" (path); head_repository "someone/fork" (repo);
    head_branch "claude/x" (branch); event "pull_request" and "pull_request_target" (event). The
    valid Saturday fixture (path .github/workflows/weekly-refresh.yml, this repo, main, event
    schedule; and again with push and workflow_dispatch) resolves to sat.
14. No-dispatch grep: no non-test file added by this PR (the .yml.txt files included), comments
    included, contains "/dispatches", "/rerun", "/cancel", "/force-cancel" or "actions: write", or
    matches (^|[^A-Za-z0-9_])gh (workflow|run|api). (*.test.mjs files are exempt because the lock tests hold these patterns;
    they run under the throwing fetch stub.)
15. Import and harness test: non-test files added under functions/ import only the allowlist (no
    inbox-status.js), use no dynamic import(), and contain no "globalThis.fetch =" or "self.fetch
    ="; no *.test.mjs file under functions/ matches export[^;\n]*\bonRequest (no onRequest*
    export in any form); rehearsal.js and _rehearsal.js contain no "request.headers"; a spy shows
    every Request passed to my-leads.js and leads.js carries no authorization header, and no
    handler is ever given one.
16. Contract test: facts.mjs output from fixtures validates against RUNNER_SCHEMA imported from
    _rehearsal.js; a fact with a bad type or enum is dropped and its checks are BLIND "schema";
    unknown keys are dropped; a body over 4 KB is rejected. facts.mjs requests runs only by
    workflow file (every runs request path contains "/actions/workflows/<file>.yml/runs"), and a
    fixture run from a fork, from a non-main branch or with a pull_request event is not counted.
17. Auth gate: import the REAL functions/api/_github-oidc.js (not the stub) through rehearsal.js;
    the fetch stub serves the test JWKS. POST /api/rehearsal with (a) no Authorization header, (b)
    a token signed by the test key with aud "other", (c) ref "refs/heads/claude/x", (d) exp in the
    past. Each returns 401 with body exactly {"ok":false,"error":"unauthorized"} (no reason), and
    the R2 op log has 0 entries, the fetch stub has 0 calls to api.stripe.com and 0 to
    api.resend.com (the JWKS URL is the only call allowed). Run the four with otherwise VALID
    parameters and again with invalid ones: both must be 401, not bad_param. Positive control: a
    valid token with valid parameters returns 200 (the test is not vacuous).
18. Outbound structure: (a) the regex (?<![A-Za-z0-9_$.])fetch\s*\( (the lookbehind excludes "."
    so a member call is counted separately) matches exactly 2 times across the non-test files
    added under functions/, both inside outbound() in rehearsal.js; (a') the regex \.fetch\s*\(
    matches 0 times before R2b and exactly once after it, on env.ASSETS inside readAsset() in
    rehearsal.js, and readAsset(env, p) throws for any p other than "/index.html" and
    "/offer.html" (unit test: "/api/x", "index.html", "/index.html?x", "//evil.example/" all
    throw with 0 ASSETS calls); (b) 0 matches there for "typeof fetch", "globalThis.fetch",
    "self.fetch" or [=:?(,]\s*fetch(?![A-Za-z0-9_$]); (c) "api.resend.com" appears exactly once
    across all non-test files added, inside sendInternal; (d) _rehearsal_mail.js has 0 fetch calls
    and no "api.resend.com"; (e) unit tests: stripeGet on https://masspermits.com/api/x,
    https://api.github.com/x, https://api.stripe.com.evil.example/x and a POST to
    https://api.stripe.com/v1/x each throws outbound_blocked with 0 calls reaching the fetch stub;
    sendInternal to a roster email (any case, any whitespace, active or not), to an address on no
    env list, to undefined or "" with both owner env values unset, to a two-"@" string, over the
    cap, with an unreadable log, after a failed attempt-record write, or with REHEARSAL_MAIL unset
    makes 0 fetch calls; _reconcile.js's readers (all five) called without fetchImpl return
    unreadable "no-fetch" and make 0 fetch calls, and every request they make through stripeGet is
    a GET to https://api.stripe.com/v1/{subscriptions,webhook_endpoints,prices,promotion_codes,
    payment_links...}.
19. Reconcile mapping: every string literal assigned to `type:` in functions/api/_reconcile.js
    (findings and notices, including the change-list additions) is a key of RECONCILE_MAP in
    _rehearsal.js, and every key maps to a result for both columns (with the key; without it or
    with Stripe unreadable). No added non-test file reads reconcile()'s verdict,
    condition_verdicts, alarms or counts: bind its return value ONLY to a variable named recon
    (a name used for nothing else), and assert 0 matches for
    \brecon\.(verdict|condition_verdicts|alarms|counts)\b and for a destructuring of any of those
    four names from recon. A finding type
    injected into a stubbed reconcile() result that is not in the map makes C7 BLIND C7.unmapped,
    never PASS and never NO-GO. F13 and its two twins pass.
REPORT in the PR body: files added, Node version, pass counts, the mutation result, the drill
table, anything surprising in the shipped code quoted as file:line and phrased as a question for
the owner (do not fix shipped files), and what could not be verified offline (anything needing
production, Stripe, Resend, R2 or the GitHub API, including whether the runner's github.token can
read check-runs with checks: read).
