# Mission Control: design spec

Status: design, 2026-09-26. Build: Claude Code cloud sessions, planned as eight or nine
(section 10): P1, three competing page designs (P2-A, P2-B, P2-C), P3 polish of the owner's pick,
two independent reviews (P4-SEC, P4-COR), P5 only if a review leaves something open, and one
reserve. P1, P3, P4 and P5 work
on branch `claude/mission-control` with one draft PR against
`capecodtaxappeal/masspermits-lander` `main`; each design has its own branch and draft PR against
`claude/mission-control`. The paste-ready prompt is `CLOUD_PROMPT.md`, next to this file.

This file is written to be safe on the public seed branch: no customer data, no counts of
customers, no secrets, no private paths, no outreach town list. Code citations are
`file:line` on lander `origin/main` @ `84ee7ed74` unless a branch is named.

---

## 1. What it is

One private page, `https://masspermits.com/admin/mission`, that the owner opens on a phone.
It reads live data when he opens it. No Claude session is involved and nothing runs on a
schedule. It answers, top to bottom:

1. **A headline sentence**: the worst red or amber "needs you" line, or "Nothing is wrong that
   this page can see." Standing conditions (severity `known`, §6.1) never become the headline, so
   on an ordinary day the headline can actually say nothing is wrong.
2. **Eight status tiles** (green / amber / red, plus grey for "not connected",
   "unavailable", "unverified" or "not yet"; a tile is never green on a signal this page cannot
   confirm).
   All eight fit on one phone screen (2 columns x 4 rows):

   | # | Tile | Source without Stripe | Source with Stripe key |
   |---|---|---|---|
   | 1 | Paying customers | roster active count, labelled "roster" | entitled MassPermits subscriptions (active, trialing, past_due), trials shown separately |
   | 2 | Revenue | grey "not connected" (no R2 object holds an amount) | gross collected, last 30 days; list-price run rate as a second line |
   | 3 | Renewals, next 14 days | grey "not connected" | count, first date, how many end (cancel_at_period_end) |
   | 4 | Failed payments | roster `payment_failing` flags: red if any; a 0 is grey "unverified" with the 0 shown and "webhook flags only; registration not verified", never green | past_due/unpaid subscriptions + open invoices with a failed attempt; green only here, when the Stripe snapshot is `ok` |
   | 5 | Monday email | feed-send-log vs roster as of the send | same |
   | 6 | Data refresh (latest daily run) | refresh-status + bundle head | same |

   Why tile 4 is never green without Stripe: the `payment_failing` flag is written only by
   webhook handlers (`stripe-webhook.js:62` for `invoice.payment_failed`, `:118` for
   Radar/dispute events, both through `flagPaymentIssue`, `:415-435`). Nobody has confirmed
   those events are registered on the Stripe endpoint (`pipeline-now.js:210-213` lists the
   sibling `customer.subscription.deleted` as unknown), and this page can check the
   registration only through the Stripe `webhook_endpoints` read. So a roster 0 means "no
   failures" or "no signal", and the page cannot tell which.
   | 7 | New sales, 7 days | delivery-log `kind:"monthly"` count, no amounts | count + gross amount |
   | 8 | Free signups, 7 days | counts from three R2 prefixes | same |

3. **Massachusetts map**: all 351 towns coloured by status (section 5), legend with counts,
   tap a town for its facts, a "show as list" view for accessibility.
4. **Needs you**: a list of sentences, red first, then amber, each saying where to act; below
   them a collapsed "Known, not new" group (severity `known`). Every line's severity is fixed by
   §6.1, not left to the builder.
5. **Details** (collapsed sections): customers, renewals and failed payments, Monday
   recipients, sources in trouble, sales and signups by day, outreach by state, and
   "What this page cannot see".

Out of scope: unanswered customer email (no signal in R2), opens and bounces (no Resend
webhook), refunds and disputes, anything that writes to Stripe, sends mail, or retries a send.

## 2. Why a new page and not /admin/now

`/admin/now` + `/api/pipeline-now` already answer "is anything wrong?" with counts only, and
`/admin/pipeline` has a 351-town coverage tab with no colours and no map. Mission Control
supersedes `/admin/now` for the owner but does not edit it, because:

- It must read the customer list and Stripe. `pipeline.js:31-37` states, and a grep
  enforces, that nothing under `/api/pipeline*` reads the customer list. Putting the new API
  under `/admin/api/` keeps that invariant literally true.
- `/admin/now`'s timing rules go red on healthy days (section 6). Changing them means
  editing `pipeline-now.js`, which this build does not touch.

Mission Control links to `/admin/now` and `/admin/pipeline` for depth. **Owner decision
later:** retire `/admin/now`, or port the measured windows into it in a separate PR, so two
boards never disagree for long.

## 3. Architecture

```
phone ──> Cloudflare Access (edge, owner's email only)
      ──> functions/_middleware.js  (unchanged; /admin prefix 404s off-apex, :37, :62-72)
      ──> static  /admin/mission            admin/mission.html  (public-harmless shell)
                  /admin/mission-app.js     requests only; hands responses to render
                  /admin/mission-render.js  DOM building (textContent only, no request)
                  /admin/mission-view.js    pure view-model functions (unit-tested)
                  /admin/mission-app.css
                  /admin/mission-towns.json public geometry, 61 KB (23 KB gzip)
      ──> Function GET /admin/api/mission             tiles + needs-you + details
                   GET /admin/api/mission?view=map    351-town status projection
                   POST /admin/api/mission-outreach   OFF unless MISSION_OUTREACH_EDIT=1
```

New files under `functions/` (and only these):

| File | Role | Exports |
|---|---|---|
| `functions/api/_owner_gate.js` | apex pin + header-only Access JWT + identity pin + allowlist; wraps `verifyCfAccess` without editing `_cf-access.js` | `verifyOwner`, `denied`, `secHeaders` |
| `functions/api/_mission_r2.js` | read-only R2 view: exactly `get`, `head`, `list`; an op counter for budget tests | `readView` |
| `functions/api/_mission_stripe.js` | GET-only Stripe reader, key check, per-isolate 5-minute cache of the *projection* | `stripeSnapshot` |
| `functions/api/_mission_data.js` | pure: timing rules, tile rules, Monday reach, map categories, masking, privacy walk | many, no I/O |
| `functions/admin/api/mission.js` | the GET route | `onRequestGet` only |
| `functions/admin/api/mission-outreach.js` (P2) | the optional editor | `onRequestPost` only |

Imports allowed in those files: `_cf-access.js`, `_presend.js` (pure, no fetch; `gather`,
`evaluate`, `bestSince`, `dueAt`, `normalisePolicy`, `holdDeadline`; `_presend.js:50-205`) and
each other. Nothing mail-capable, no `_lifecycle.js`, no dynamic `import()`, no `node:`.

Nothing depends on the unmerged Monday Dress Rehearsal (PR #1). It shares env names with it
(`STRIPE_READ_KEY`, `MASSPERMITS_PRICE_IDS`; `claude/monday-rehearsal:functions/api/rehearsal.js:480-493`)
and the Stripe API version (`2026-08-26.dahlia`, `_reconcile.js:76` on that branch), and it
copies the stripeGet lock pattern (`rehearsal.js:170-176` there). Either PR can merge first.
Tests live in `test/mission/`, not `functions/api/`, so the two PRs never touch the same path.

### 3.1 The gate (every route, before any read)

`verifyOwner(request, env)`, in order, first failure wins:

0. hostname is exactly `masspermits.com`, else **404** (covers www, `*.pages.dev`, hash
   hosts, `heartbeat.*`; the heartbeat branch is main republished daily and does get a Pages
   build).
1. `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS` all non-empty, else 403
   `not-configured`. No default, no fallback to `OWNER_EMAIL`.
2. `Cf-Access-Jwt-Assertion` header present, else 403 `no-assertion-header`. The cookie is
   ignored (`_cf-access.js:52-56` falls back to it; the wrapper refuses before calling it).
3. `verifyCfAccess` ok (RS256, iss, aud, exp, kid, signature; `_cf-access.js:37-91`), else 403
   with its reason; any `verify-error:*` reason is reported as `verify-error` (never echo the
   exception text, `_cf-access.js:89`).
4. payload `type === "app"`, non-empty string `email`, non-empty `sub`, no `common_name`
   (service tokens pass `_cf-access.js:87` today), `nbf`/`iat` not more than 60 s in the future.
5. lowercased trimmed email is in `ADMIN_ALLOWED_EMAILS`, else 403 `not-owner`.
6. Route extras: header `X-MassPermits-Mission: 1`; if `Sec-Fetch-Site` is present it must
   be `same-origin` (the editor requires it present).

Every response, including 403/404: `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, no `Access-Control-Allow-*`. A thrown error before step 5
passes is a 403, never a 500 with a stack.

### 3.2 Display policy

Assume any script on masspermits.com can read the payload while the owner is signed in
(same origin serves CI-built HTML; `/leads` has no CSP). So:

- **Allowed:** counts, amounts, dates, statuses, town names; per customer a sanitised name
  (control and bidi characters stripped, 80 chars), a masked email `j… · example.com` (never an
  `@`), plan, amount, status, since, next renewal, `t8` (first 8 hex of the token), Stripe
  dashboard links built from validated `cus_`/`sub_`/`in_` ids.
- **Never:** full email addresses (customer, prospect, newsletter), 32-hex tokens, newsletter
  `tok`, any key shape (`sk_`, `rk_`, `whsec_`, `re_`), card/address/phone/IP/UA, R2 keys under
  `prospects/`, `agent-prospects/`, `newsletter/`, raw R2 or Stripe objects, contractor or
  owner names from permit rows. Free-sample signups are counts plus trade only, no identity at
  all, not even masked.
- **Never, in any form: engine text.** That is every `refresh-status.errors` value, source-health
  `last_error`, `recent[].err` and `last_unscored_why`, and the refresh-status `error`, `traceback`
  and `contracts`. A gate abort can quote a town's error inside the refresh `error`, and
  `_presend.js`'s `evaluate()` reasons and `headline()` quote that `error` on a failed run
  (`_presend.js:292-293`), so neither is emitted.
  The engine's owner-name guard quotes the owner's name in its own error message ("the owner name
  '…' reached a shipped row"), and that message lands in `errors` and `last_error`; the traceback
  holds runner paths. A name has no regex shape, so the privacy walk cannot catch it; the only
  protection is never emitting the text. The server classifies each string into a fixed `ek`
  code (`owner_name_gate`, `access_controlled`, `no_rows`, `timeout`, `http_error`, `parse`,
  `other`) and a failed refresh into `fail_kind` (`crash`, `gate`, `unknown`); the page turns each
  code into a fixed sentence.
- **Never, for a different reason: R2 object identifiers.** No `etag`, `httpEtag`,
  `bundle_etag` or `version` value in either view, whole or shortened. From R2 metadata the
  payload carries only `uploaded` (ISO) and `size`; etag comparisons happen server-side and
  come out as booleans. Production etags are 32-hex MD5s (a read-only R2 check on 2026-09-24
  found the etag equal to the body's MD5 on all 14 objects it downloaded), and
  `feed-send-log.json` entries carry `bundle_etag`
  (`weekly-send.js:126,135,169`), so one leaked etag would trip the walk below and turn the
  headline permanently red. `_presend.js:252` already follows this rule ("never echo the etag
  itself upward"); its `gather()` heads still carry `etag` (`_presend.js:152-162`), so the
  route projects named fields and never passes a head or log entry through.
- A final privacy walk over the finished payload (extends `scrub()`, `pipeline-now.js:280-299`)
  redacts the email regex, `\b[0-9a-f]{32}\b`, key shapes and those prefixes everywhere except
  `signed_in_as`, and sets `privacy_redactions`. Tests assert it stays 0 on hostile fixtures
  and on a healthy world whose fake R2 uses production-shaped (32-hex MD5) etags; a fake with
  short etags would let an etag leak pass offline and fail on every production load.

## 4. Data: what each tile reads

All R2 reads go through the `BUNDLES` binding via the read-only view. `get-object.js` READABLE
and `upload-bundle.js` ALLOWED_KEYS are not touched. The funnel route is never called (it
writes history, `funnel.js:107`); `funnel-metrics.json` is read instead.

| Need | R2 objects | Notes |
|---|---|---|
| Refresh | `refresh-status.json`, head `refresh-status.json`, head `latest-weekly.zip`, `latest-weekly.html` | status upload is best-effort and can miss while bundles ship; compare the heads server-side and emit only their `uploaded` times, never an etag (§3.2). Emit `ok`, `degraded`, `fail_kind`, coverage numbers and times only; never `error`, `traceback` or `contracts`. On a failed run `coverage` is null, and on "refresh crashed" every data member is null (§6): read null as absent, never as a crash |
| Sources in trouble (needs you) | head `source-health.json`, get only when its etag changed | per source `state`, `first_seen`, `last_good`, `consecutive_low` and the `ek` code, from the projection the map view also uses (one per-isolate cache); refresh-status alone cannot say when a source went down |
| Monday | `_presend.gather(env,{hash:false})` (policy, status, feed-send-log, last-send-attempt, bundle heads), `subscribers.json` | `bestSince(log, dueAt(now))`; roster as of the send |
| Customers, failing flags | `subscribers.json` (`email,name,customer,since,active,token,cancelled?,payment_failing?`; written at `stripe-webhook.js:324-334`) | join key for Stripe is `customer` |
| Paying trend, no-Stripe-id | `funnel-metrics.json` (newest first) | `paying`, `payment_failing`, `no_customer_id` |
| Sales | `delivery-log.json` (`{at,to,kind,bundle}`, `stripe-webhook.js:212-216`) | `monthly` = new checkout, `weekly` = renewal; no amounts |
| Signups | list `prospects/`, `agent-prospects/`, `newsletter/` with `include:["customMetadata"]` | keys are emails: count only. `ts`, `trade` (`request-sample.js:36,62`), `town` (`agent-sample.js:47`), `c`,`un` (`newsletter.js:61`). Page up to 3 list pages each; if still truncated say "at least N" |
| Engagement | `engagement.json` → `counts` only | rows carry `t8`; not needed |
| Setup lines | head `admin/outreach.json`, head `probe-map.json` | present / absent, registry date |
| Map | `refresh-status.json`, `source-health.json` (~220 KB), `probe-map.json` (~260 KB, registry only, never `sources`), `admin/outreach.json` | heads first; parse the two big objects only when their etag changes (per-isolate cache of the projection; the etag stays in the cache, `as_of` carries `uploaded` times). A town's error appears only as its `ek` code, never as text (§3.2) |

Stripe (only with a live restricted read key and `MASSPERMITS_PRICE_IDS`), all GET,
`Stripe-Version: 2026-08-26.dahlia`, never `expand[]=data.customer`:

| Call | Used for |
|---|---|
| `/v1/subscriptions?status=all&limit=100` | entitled set, trials, renewals (`items.data[].current_period_end`, not the Subscription), `cancel_at_period_end`, past_due/unpaid, list-price run rate |
| `/v1/invoices?status=paid&created[gte]=<30d>&limit=100` | gross collected (subscriptions), new-sale amounts (`billing_reason: subscription_create`) |
| `/v1/invoices?status=open&limit=100` | failed attempts (`attempt_count > 0`) |
| `/v1/checkout/sessions?status=complete&created[gte]=<30d>&limit=100&expand[]=data.line_items` | one-time pack sales (`mode: payment`, no invoice) |
| `/v1/webhook_endpoints?limit=100` | whether `invoice.payment_failed` and `customer.subscription.deleted` are registered |

Filter every object by price id in `MASSPERMITS_PRICE_IDS` (read `line.price.id` or
`line.pricing.price_details.price`, both shapes tested). Never filter by amount: the account
is shared with another product. `has_more: true` after the page cap makes the section
"partial", never complete. Unknown price ids on otherwise-matching customers are a needs-you
item. Key rule: only `rk_live_…`; `sk_*` or any `*_test_*` is "refused" with zero calls;
missing key or missing price list is "not connected", never $0.

## 5. Map categories

Join: production keys are `"<Town>, MA"`; strip `, MA`, exact match to the 351 map keys, then
the alias table in `mission-towns.json`. An unmatched production key is listed on the page,
never dropped. First match wins:

| Code | Legend | Rule |
|---|---|---|
| `dead` | Stale or dead source | production key present and (source-health state in dead, failing, collapsed, vanished, stale; or key in `refresh-status.errors`; or unscored with 0 rows); or registry `feasibility == "built_not_wired"` (paused) |
| `weekly` | Live, weekly | production key present, state ok (or unscored with rows > 0), no cadence |
| `monthly` | Live, monthly or slower | same, with a cadence value (`refresh-status.cadence` or source-health `cadence`) |
| `answered` | Outreach answered | outreach state `answered` or `declined` |
| `sent` | Outreach sent | outreach state `sent` |
| `locked` | Locked behind OpenGov | outreach object `locked: true`, or (not `locked: false` and registry `method == "opengov"`) |
| `none` | Not covered | everything else; `planned` outreach adds a dashed outline only |

A town's facts carry its error only as the `ek` code (§3.2). Never colour from registry
`already_live` (it disagrees with production in a dozen towns).
The legend shows both OpenGov numbers (registry method vs owner list). The registry comes
from `probe-map.json`, which is updated by hand; show its date.

**Outreach object** `admin/outreach.json` in R2 (never in the repo; which towns are worked is
strategy):

```json
{ "version": 1, "updated_at": "2026-09-26T00:00:00Z",
  "towns": { "Adams": { "outreach": "sent", "since": "2026-09-29", "locked": true, "note": "records request" } },
  "history": [ { "at": "…", "town": "Adams", "from": "planned", "to": "sent" } ] }
```

`outreach` in `planned | sent | answered | declined` (absent = none); `since` `YYYY-MM-DD`;
`locked` boolean; `note` at most 80 chars, and any email- or phone-shaped text in it is
redacted on read. Unknown towns are ignored and listed. Over 64 KB or unparseable: the map
says "outreach unreadable" and colours no outreach. The owner seeds it once with wrangler
from a local file (town names and flags only, no contact details).

**Editor (default off).** `POST /admin/api/mission-outreach`, 404 unless
`MISSION_OUTREACH_EDIT === "1"`; full gate; `Sec-Fetch-Site: same-origin` required;
`Content-Type: application/json`; body at most 512 bytes `{town, outreach}` (outreach may be
null to clear); `since` is the Function's UTC date. It reads the object with its etag;
absent or unparseable is 409 and nothing is written; it writes the one key
`admin/outreach.json` with `onlyIf: {etagMatches}` (a lost race is 409), keeps the newest 200
history entries, and answers `{ok:true}` only. Leaving it off means edits are a wrangler
command or a local Claude task.

## 6. Timing rules (measured, not copied)

Measured from R2 history, last 14 runs: the daily refresh landed 13:06-16:00 UTC (cron 09:00,
`weekly-refresh.yml:897,908`); Monday sends logged 15:20-18:46 UTC (cron 12:00,
`weekly-feed.yml:13`). The existing rules go red at 13:00 (`pipeline-now.js:53-54,94`) and
13:30 Monday (`pipeline-now.js:145`), so they are red on most healthy days. Mission Control
keeps one thing from `pipeline-now.js`: its due anchor, `lastDue(now, 9)` (`:93`, defined
`:256-261`), which is the most recent 09:00 UTC at or before now. It drops the 4 h grace.

Refresh `due` = the most recent 09:00 UTC at or before now. Between 00:00 and 08:59 UTC that is
yesterday 09:00, so a healthy run from yesterday afternoon stays green through the owner's
evening, and a red from a missed day stays red past midnight UTC. ("Today 09:00" would be in the
future before 09:00 UTC, which would make the tile grey every night and reset a real red to
grey at midnight.)

| Check | Green | Grey (not yet) | Amber | Red |
|---|---|---|---|---|
| Refresh | `ran_at` ≥ `due`, `ok` not false, not degraded | `ran_at` < `due` and now < `due` + 8 h (17:00 UTC; "usually 13:00-16:00 UTC"), and the latest status is not a failure | landed (`ran_at` ≥ `due`) with `degraded: true` (a reduced run: it ships and discloses); or `latest-weekly.zip` uploaded ≥ `due` but `ran_at` < `due` (status upload missed) | status file missing; or `ran_at` older than 36 h; or the latest status is `ok: false` without `degraded: true` (the run crashed or its quality gate aborted it: the state `weekly-send.js:61-63` refuses to send on), whenever it ran; or `ran_at` < `due` at or after `due` + 8 h |
| Monday | best entry since due delivered ok to every expected recipient | Monday before `hold_until_hour` (20:00 UTC from `_presend` policy) with nothing yet ("recent sends 15:20-18:46 UTC") | a duplicate ok delivery to one address in the window; roster unreadable but a delivery exists | failed entry; expected recipient missing; skipped-only; nothing by the hold hour; an attempt with no result |

Monday "expected" = active roster rows with `since` before the Monday date, joined on the
normalised email server-side. Rows with `since` equal to the Monday are listed as "joined on
send day" and never red; rows after it are "new since Monday". Tuesday to Sunday show the
last Monday's result. All constants live at the top of `_mission_data.js` with the measurement
as a comment.

Refresh evaluation order (first match wins): missing or unparseable → red; older than 36 h →
red; `ok: false` and not `degraded: true` → red; landed → amber if degraded, else green; bundles
shipped but status missed → amber; before `due` + 8 h → grey "not yet"; otherwise red. Drills D15
(02:00 UTC, yesterday's 14:20 run ok → green), D16 (02:00 UTC, last run two days ago at 14:20,
which is 35 h 40 min old and so under the 36 h floor → red from the anchor alone) and D17 (00:30
UTC, same data → red, not grey) pin the overnight behaviour. D18 (a Monday 15:00 UTC, that day's
run `ok: false`, `degraded: false`, nothing delivered since 12:00 UTC → red, and the needs-you line
says Monday's email will not send while this is the latest run), D19 (10:00 UTC, yesterday's
failed run → red, not grey) and D20 (`degraded: true` → amber) pin the failure colours. Why a failed run is red and never amber: the
engine writes `ok: false` with `degraded: false` only when the refresh or the bundle build crashed
or a quality gate aborted the run; a reduced run is written `ok: false` *with* `degraded: true`.
The status file is uploaded even when the run fails (the upload step is `if: always()`,
`weekly-refresh.yml:1151-1152`). The prompt lists all of these drills.

**What a failed status looks like.** The engine fills every data member from the run's result,
and a failed run has a partial result or none:

| Failure | `coverage` | `count`, `sources`, `errors`, `cadence`, `newest` | `contracts` |
|---|---|---|---|
| "refresh crashed" | null | all null | null |
| "ABORT: …" (a quality gate) | null | as far as the scrape got | null, or set by the contracts floor |
| "bundle build crashed" | null | set | set |

Only a run that passed every gate (`ok: true`, or `degraded: true`) carries a `coverage` object.
On a crash, `source-health.json` is still re-uploaded, but the engine does not score the run.
Every per-source record and the totals stay as the last scored run left them. Only `updated_at`
and the run counters move, and `last_unscored_at` and `last_unscored_why` are added.

Every reader treats a null member as absent. There are no source facts from
`refresh-status.json`, no `coverage_disclosed` line, and `detail.refresh.coverage` is null. So on
the crash day both views still answer 200, the refresh tile is red, and the map keeps its colours
from `source-health.json`. A reader that dereferences a null here would send the route to its 503
catch on exactly the day the red tile matters. D18, D19, P1-15 M2 and the P1-8 crash canary
therefore use these exact shapes, never a healthy status with three fields flipped, and assert 200
on both views.

### 6.1 Needs-you severity (fixed, not the builder's call)

Every line has a fixed `id` and one severity: **red**, **amber** or **known**. Red and amber
lines are what the headline picks from, red first, in a fixed table order. **Known** lines are
standing conditions, or conditions below the engine's own alert threshold. They are listed in a
collapsed "Known, not new" group and never become the headline. Two rules tie lines to tiles.
Every red or amber tile produces one line of the same colour. A grey "unavailable" tile (a read
failed) produces an amber "could not read" line. Grey "not yet", "not connected" and "unverified"
tiles produce none. So "Nothing is wrong that this page can see." means that no tile is red,
amber or unreadable.

| Severity | Lines |
|---|---|
| red | privacy redactions > 0; refresh tile red; Monday tile red; failed-payments tile red |
| amber | refresh or Monday tile amber; paid but not on the roster; **sources down in the last 7 days (one line for all of them)**; a tile could not be read; paying count fell against 7 days ago (roster count vs `funnel-metrics` `paying`, like with like); a renewal will end; on the roster but not paying (Stripe only); unknown price ids; webhook events missing; a roster row with no Stripe customer id; portal stale or drift; Stripe key refused; outreach object unreadable |
| known | coverage disclosed to subscribers (`coverage.disclose`, on until coverage returns, `weekly-send.js:65-70`); vanished sources; sources blocked by the town's site (`ek` `access_controlled`: an authorization decision, never retried, and the page never suggests a retry); sources down for more than 7 days; sources that failed only their latest run; stale sources; registry older than 30 days; Stripe not connected; Stripe lists cut at 3 pages; outreach object absent; customers never downloaded or lapsed |

**Which sources count as "down in the last 7 days".** First match wins.

1. An `access_controlled` error is known, whatever its age.
2. Vanished, failing and stale sources are known. The engine calls a source dead only after 3
   failed runs and 48 h, and it emails the owner at that point and when a window freezes.
3. A dead source is recent if its `last_good` (or, if it never worked, its `first_seen`) is
   within 7 days.
4. A collapsed source is recent if `consecutive_low` ≤ 3 + 7. The engine needs 3 low runs to call
   a source collapsed, and the refresh runs daily.

A missing or unparseable field counts as recent. `alerted_at` and `alert_kind` are never used,
because the engine rewrites them every 7 days while a source stays down, so a months-old outage
would look new one day in seven.

**Quiet day.** Every synthetic fixture was healthy, so no test saw the conditions that production
carries every day. P1-15 builds that world from the production shapes:

- disclosure on
- four vanished sources
- a 403 source
- an old dead source whose alert was just re-sent
- one source that failed once
- an old registry
- Stripe unset
- no outreach object
- one never-downloaded customer
- a healthy refresh and Monday

That world must headline exactly "Nothing is wrong that this page can see." at 18:00, at 10:00
(refresh not yet) and on a Monday afternoon before the send. Single changes must move the
headline: a newly dead source, a crashed refresh (in the real crash shape, §6), a new collapse. Two changes must not move it: a
re-sent alert, and a fresh 403.

## 7. Budget and speed

Design for the Workers Free limits (10 ms CPU, 50 subrequests; the account's plan is not
verified). Targets, enforced by tests with an op-counting fake:

| View | R2 ops | Stripe calls | Payload |
|---|---|---|---|
| default | ≤ 25 (worst case exactly 25: `gather` 6, eight single reads, `source-health.json` head + get, 3 prefixes × 3 list pages) | ≤ 6 at page 1, ≤ 15 with paging | ≤ 16 KB with 20 synthetic customers |
| `?view=map` cold | ≤ 6 | 0 | ≤ 30 KB |
| `?view=map` warm (etags unchanged) | ≤ 4 | 0 | same |

Stripe results are cached per isolate for 5 minutes as the projection, never the raw object.
Page weight: shell + JS + CSS ≤ 45 KB uncompressed, geometry 61 KB. The page requests the
default view, the map view and the geometry in parallel and paints tiles first. No framework,
no CDN, no fonts, no beacon.

## 8. Security hardening for the page

- `_headers` gains exactly one block, `/admin/mission`, outside the generated widget block
  (`_headers:38-84`): `Content-Security-Policy: default-src 'none'; script-src 'self';
  style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none';
  base-uri 'none'; form-action 'none'`, `X-Frame-Options: DENY`, `X-Robots-Tag`,
  `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`.
- No `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval`, inline script or
  `style=` in `admin/mission*`. SVG paths are created with `createElementNS`.
- Nothing is kept on the phone: no `localStorage`, `sessionStorage`, IndexedDB, Cache API,
  service worker or cookie write in `admin/mission*`, because the payload holds customer rows.
- "Signed in as {verified email}" in the header. If it is missing, the gate is broken.
- Attribution on the page: "Boundaries: U.S. Census Bureau, TIGER/Line Shapefiles 2024".

## 9. Files the session must never edit

`functions/api/stripe-webhook.js`, `weekly-send.js`, `my-leads.js`, `send-status.js`,
`_presend.js`, `_github-oidc.js`, `upload-bundle.js`, `get-object.js`, `_notice.js`,
`inbox-status.js`, `funnel.js`, `_cf-access.js`, `pipeline.js`, `pipeline-now.js`,
`pipeline-probe.js`, `pipeline-lifecycle.js`, `health.js`, `cold-status.js`, `traffic.js`,
`live.js`, `sample.js`, `cf-traffic.js`; `functions/leads.js`, `functions/_middleware.js`;
`admin/now.html`, `admin/pipeline.html`; anything under `.github/`. No middleware change is
needed: `/admin` is already a guarded prefix (`_middleware.js:37`).

## 10. Phases, tests, cost

Every phase is a fresh cloud session given the same `CLOUD_PROMPT.md` with its PHASE line set
(and, for P3, the owner's WINNER and optional OWNER NOTES).

| Phase | Session | Branch | Delivers | Est. credits |
|---|---|---|---|---|
| P1 | cloud 1 | `claude/mission-control` | gate, R2 view, Stripe reader, data module, GET route (both views), offline harness, tests 1-15; opens the main draft PR | $8-13 |
| P2-A | cloud 2 | `claude/mission-design-a` | the whole page (page, render module, map, view model, `_headers` block, geometry copy, optional editor, their tests) in the "instrument panel" direction, plus `docs/mission/demo.html`; its own draft PR into `claude/mission-control` | $6-11 |
| P2-B | cloud 3 | `claude/mission-design-b` | the same, "trading desk" direction | $6-11 |
| P2-C | cloud 4 | `claude/mission-design-c` | the same, "morning briefing" direction | $6-11 |
| owner | none | | compares the three demos on his phone; picks A, B or C, with optional notes | $0 |
| P3 | cloud 5 | `claude/mission-control` | merges the pick, deletes the demo, polishes phone layout, speed, light and dark readability, accessibility, empty and error states | $5-10 |
| P4-SEC | cloud 6 | `claude/mission-control` | fresh-context security review: the 11 attack areas; fixes with regression tests | $4-9 |
| P4-COR | cloud 7 | `claude/mission-control` | fresh-context correctness review: every number traced by an independent oracle, every timing drill plus boundary cases, map truth over 200 generated worlds; fixes with regression tests | $5-10 |
| P5 | cloud 8, only if a P4 report leaves an item open | `claude/mission-control` | final fixes, final owner checklist | $4-8 |
| reserve | cloud 9, only if needed | the phase's own | one re-run of a phase that stopped short | $4-13 |

Seven sessions always run: about **$40-75**. Plan for **8 to 9**: with P5, 8 sessions, about
**$44-83**; with the reserve, 9 sessions, up to about **$96**. At the observed $4-13 per session
the outer bounds are $32-104 for 8 sessions and $36-117 for 9. The three P2 sessions may run at
the same time (separate branches). P4-SEC and P4-COR push to the same branch, so they run one
after the other, security first by default. The acceptance tests are in `CLOUD_PROMPT.md`.

### 10.1 Three designs

The page's look is the one part no test can judge, and credit is cheap, so three independent
sessions build the same page in three directions. Data, words, section order, behaviour and every
security rule are the same in all three, held by the same P2 acceptance tests; only layout,
density, typography and colour differ.

- **A, "Instrument panel"** (calm): few, large numerals, generous space, colour only in a small
  state mark beside the word, a 2 x 4 grid of equal tiles, a large map, nothing that moves.
- **B, "Trading desk"** (dense): tabular figures, value, sub line and as-of time on every tile,
  state as a coloured edge plus the word, needs-you as a tight table, a smaller map.
- **C, "Morning briefing"** (editorial): the headline set as a large serif sentence, tiles as an
  "at a glance" box of short lines, needs-you as numbered sentences, the map as a captioned
  figure.

A P2 session never reads the other two design branches, so the three stay independent.

### 10.2 The offline demo, and how the owner compares

Each design branch ships `docs/mission/demo.html`: one self-contained file, built from that
branch's own page code and from payloads produced by running the real route on synthetic worlds.
It has five scenarios (quiet day, bad day, all good, cannot read, not set up) and a
Light / Dark / Device switch. It carries a CSP that forbids every network request, a noindex tag,
and the banner "Demo with invented data. Nothing on this page is real."

To compare, a local session copies the three files out read-only
(`git show origin/claude/mission-design-a:docs/mission/demo.html`, then b and c) and shows them to
the owner privately. He opens each on his phone, tries the scenarios in both themes, and replies
A, B or C with any notes. Nothing is deployed.

The demo never reaches main. Every file on main is a public URL on masspermits.com, and a page of
invented revenue there would read as real. P3 deletes the demo when it merges the winner and makes
the structure test refuse any path under `docs/`. The generator stays in `test/mission/`, so a later
session can build a fresh demo outside the repo for a final look (`MISSION_DEMO_OUT`). If Pages
does build previews for `claude/*` branches (not verified), a design-branch preview would serve the
demo: it is invented data, not indexed, and makes no request, and every Function still 404s off
the apex.

### 10.3 The two reviews

P4-SEC tries the 11 attack areas: access without a valid owner token, reads before auth, leaks
(including engine text, etags and anything persisted on the phone), writes, false greens and false
timing colours, XSS, the paying path and the Functions build, the map, the editor, the subrequest
budget, and public hygiene on all four branches. P4-COR writes an independent oracle from the
prompt's rules, compares it with the route on every fixture world and on 200 generated map worlds,
re-runs every timing drill with its boundary cases, and checks that the page shows exactly the
payload's numbers. Each fixes only files this build added, with a regression test per fix, and
reports in the main PR body. A weakness found in a never-edit file appears in public text only as
a count and a one-word area; the owner re-checks it with a local session.

## 11. Seed branch (before P1)

A local Claude session creates `claude/seed-mission-control` from `origin/main` with exactly:

- `docs/mission/mission-towns.json`: 61,330 bytes, SHA-256
  `e8df13d21be725a5fb3403815da92970d3ab737770cbbcc423ee1cf4fdb9f303`. 351 towns:
  `{v, viewBox "0 0 2000 1272", fill_rule "evenodd", attribution, source, note, counties,
  aliases, towns: {key: {d, l:[x,y], c:"<county fips>"}}}`. Census TIGER/Line 2024, no status,
  no private provenance.
- `docs/mission/SPEC.md` (this file) and `docs/mission/CLOUD_PROMPT.md`.

Before pushing, grep the three files for any address other than `@example.com` (the privacy
regex in the prompt is expected), `C:`, `Users`, a Windows path, and any customer count. `claude/*` branches get no Pages preview build.

## 12. Owner setup after merge (about 20 minutes)

1. Zero Trust → Access → Applications → Self-hosted "MassPermits admin". Destinations
   `masspermits.com/admin`, `masspermits.com/admin/*`, `masspermits.com/api/pipeline*`. Never
   the bare domain and never `/api/*` (that would sit in front of the Stripe webhook).
   Policy: Allow → Include → Emails → his one login address.
2. Pages → masspermits-lander → Settings → Variables and Secrets → **Production only**:
   `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS` (secret). Never Preview.
3. Stripe → Developers → API keys → Create restricted key, read-only: Subscriptions, Invoices,
   Checkout Sessions, Prices, Webhook Endpoints (Customers only if the rehearsal shares the
   key; Mission Control never expands customers). Set `STRIPE_READ_KEY` (secret, Production)
   and `MASSPERMITS_PRICE_IDS` (every MassPermits price id, comma-separated).
4. Upload the outreach seed once:
   `npx wrangler r2 object put masspermits-bundles/admin/outreach.json --file outreach.json --content-type application/json --remote`
5. Retry the latest production deployment (or wait for the daily bot deploy) so variables
   take effect.
6. Checks from the phone and a private window: signed out → Access login; signed in → data
   and "Signed in as …"; `www.` and `masspermits-lander.pages.dev` `/admin/api/mission` → 404;
   the next Monday send log is normal.
7. Optional: `MISSION_OUTREACH_EDIT=1` to edit outreach from the page. Add the page to the home
   screen.
8. Close the two losing design PRs and delete the three `claude/mission-design-*` branches. They
   hold only invented demo data, but every branch of this repo is public.
