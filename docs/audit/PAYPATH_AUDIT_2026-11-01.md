# Pay path audit, 2026-11-01

Scope: the money and delivery path, from Stripe checkout to the Monday email and
the portal links. Files reviewed against `main` at 3883df10f:

- `functions/api/stripe-webhook.js` (subscriber writes, welcome bundle, holds)
- `functions/api/weekly-send.js` and `functions/api/_presend.js` (Monday send)
- `functions/api/send-status.js` (watchdog verdict)
- `functions/api/my-leads.js`, `functions/leads.js` (token links, portal)
- `functions/api/get-object.js`, `functions/api/upload-bundle.js` (R2 allowlists)
- `functions/api/_github-oidc.js` (auth for every CI endpoint)

Method: every claim below is backed by a test under `test/paypath-audit/` that
runs the SHIPPED handler in process, with an in-memory R2, a recorded (never
sent) Resend, a stubbed OIDC verifier, and no network. Synthetic data only.

- `DEFECT ...` tests assert the correct behaviour, so they FAIL today and turn
  green when the fix lands.
- `OK ...` tests document behaviour that is correct today and must stay green.

No fix has been applied. `MIN_CENTS = 500` is unchanged and is pinned by a test.

```
node --test test/paypath-audit/*.test.mjs
```

## Summary

| # | Finding | Subscriber impact | Severity |
|---|---|---|---|
| F10 | R2 error during signup silently drops a new paying subscriber | paid, never gets a Monday email | High |
| F11 | Concurrent signups lose a subscriber row (read-modify-write race) | paid, never gets a Monday email | High |
| F7 | Cancelling a duplicate subscription cuts off the one still billing | paying $99, gets nothing | High |
| S1 | A logged total Resend outage is reported as `unknown`, never auto-retried | whole list gets nothing until the owner acts | High |
| W1 | Two overlapping send triggers mail everyone twice | duplicate Monday email (09-07 class) | Medium |
| F1 | No Stripe event id dedup: redelivery repeats the welcome mail and the referral credit | duplicate mail, owner pays $99 credit twice | Medium |
| F4 | Dispute, early fraud warning and Radar review holds stop nobody | none; fraud keeps receiving the feed | Medium |
| F3 | ACH checkout delivers before the money settles; a failed ACH is ignored | unpaid buyer keeps the feed | Medium |
| F12 | Missing monthly bundle at checkout: 500 before the row is written | paid, off the roster while Stripe retries | Medium |
| F5 | A held subscriber still gets the weekly bundle on the next renewal | none; hold is leaky | Medium |
| F6 | `charge.refunded` is not handled at all | none; refunded customer keeps the feed | Low |
| F8 | `customer.subscription.updated` to `unpaid`/`paused` is ignored | none; non-payer keeps the feed | Low |
| M1 | R2 error on the bundle read in my-leads escapes the handler | bare platform 500 on the download button | Low |
| W2 | No `refresh-status.json` means no freshness gate at all | could receive a 30 day old file | Low |
| F2 | Stripe signature has no timestamp tolerance (replay window is forever) | replayed event re-delivers | Low |
| S2 | Rows without `active` are mailed but invisible to the roster check | a missed send to them is not alarmed | Low |
| F9 | Email case/whitespace variant creates a second subscriber row | two tokens, confusing state | Low |
| U1 | upload-bundle allowlist accepts `constructor`, `__proto__`, `toString` | none directly; allowlist is not exact | Low |

Totals: 23 failing DEFECT tests (some findings have more than one), 18 passing OK tests.

## Findings, ranked by subscriber impact

### F10. R2 error during signup silently drops a new paying subscriber (High)

- Where: `functions/api/stripe-webhook.js:292-342`, the `catch` at `:338-340`;
  called at `:202-204`.
- Scenario: a buyer completes checkout. The R2 read (or write) of
  `subscribers.json` throws once. `addSubscriber` swallows it and returns `""`.
  The welcome email still goes out (with no download button), the webhook
  answers 200, so Stripe never retries. The buyer is not on the roster and
  never receives a Monday email. Nothing alerts. A corrupt `subscribers.json`
  has the same effect for every new buyer.
- Tests: `DEFECT F10a` (read failure), `DEFECT F10b` (write failure), in
  `stripe-webhook.audit.test.mjs`.
- Minimal fix: let `addSubscriber` throw for `mode=subscription` and return
  5xx before sending the email (Stripe retries; the existing-row path makes
  the retry idempotent). If the email must still go first, at minimum
  `notifyOwner` on that catch.

### F11. Concurrent signups lose a subscriber row (High)

- Where: `functions/api/stripe-webhook.js:295-335` (get, modify, put of the whole
  `subscribers.json`); the same pattern in `flagPaymentIssue` `:418-432`,
  `clearPaymentIssue` `:441-457`, `deactivateSubscriber` `:381-396`.
- Scenario: two checkouts (or a checkout plus an `invoice.paid` or
  `invoice.payment_failed` for someone else) land inside one R2 round trip.
  Both read the same list, each appends or edits, the last `put` wins, and the
  other change is gone. A launch, a promo email or a Monday renewal wave makes
  this more likely as the list grows toward 200. The webhook returned 200, so
  nothing retries.
- Test: `DEFECT F11` (two simultaneous checkouts, 5 ms R2 latency: one row lost).
- Minimal fix: conditional write. R2 `put` supports `onlyIf: { etagMatches }`;
  read the etag with the list, put with `onlyIf`, and on a precondition miss
  re-read and re-apply (small retry loop). Alternatively one object per
  subscriber (`subscribers/<id>.json`) with the list rebuilt on read.

### F7. Cancelling a duplicate subscription cuts off the one still billing (High)

- Where: `functions/api/stripe-webhook.js:41-45`, `:367-375`, `:377-410`;
  the id replacement at `:317-320`.
- Scenario: a customer subscribes twice (two Checkout sessions, so two Stripe
  customers `cus_A` and `cus_B`). The row now names `cus_B`. They notice and
  cancel the newer one. `customer.subscription.deleted` for `cus_B` matches the
  row by id and sets `active:false`, while the `cus_A` subscription keeps billing
  $99 a month. Same shape as the 2026-08-31 incident, from the other side.
- Test: `DEFECT F7`.
- Minimal fix: record subscription ids per row (`subs: ["sub_A", "sub_B"]`) from
  `checkout.session.completed.subscription`; on `deleted`, remove that id and
  deactivate only when the set is empty. For legacy rows, alert the owner
  instead of revoking when the row was touched by more than one checkout.

### S1. A logged total Resend outage is reported as `unknown` and never auto-retried (High)

- Where: `functions/api/send-status.js:141-170` (`sentSinceDue` false,
  `skippedSinceDue` false, `triedSinceDue` true, so `unknown`).
- Scenario: Resend is down on Monday. weekly-send tries everyone, every send
  fails, and `feed-send-log.json` records each failure. The watchdog then says
  "send was attempted ... but no results were recorded ... NOT retrying
  automatically". The results ARE recorded and they prove nobody received the
  file, so a retry is exactly safe. Subscribers get nothing until the owner
  reads a misleading alert and acts by hand: the 08-03 outcome by another route.
- Test: `DEFECT S1` in `weekly-send.audit.test.mjs`.
- Minimal fix: before the `triedSinceDue` branch, if `best` exists with a
  non-empty `sent` array and every entry is `ok:false`, return a `failed`
  verdict with `retry_safe: true` (weekly-send already skips anyone who has
  this week's email, so a retry cannot duplicate).

### W1. Two overlapping send triggers mail everyone twice (Medium)

- Where: `functions/api/weekly-send.js:109` and `:125-126` read the log once at
  the start; the log is written only after the whole loop at `:210-217`. The
  attempt marker at `:189-192` is written but never read by weekly-send itself.
- Scenario: the cron run and a watchdog retry (or a manual dispatch) start
  within the duration of one send loop. Both read a log with nobody served yet,
  both send to everyone. Each subscriber receives two Monday emails, the 09-07
  symptom through a different door. The window grows with the list: at 200
  subscribers the loop takes minutes.
- Test: `DEFECT W1` (two concurrent runs, 15 ms per Resend call: 6 emails for 3
  subscribers).
- Minimal fix: a lease. Read `last-send-attempt.json`; if it is younger than,
  say, 30 minutes and no log entry is newer, return 409 "send in progress".
  Write the lease with `onlyIf` so two runs cannot both take it. Optionally
  append to the log per recipient instead of once at the end.

### F1. No Stripe event id dedup (Medium)

- Where: `functions/api/stripe-webhook.js:22-225` (no use of `event.id`);
  referral credit at `:219-221` and `:486-510`.
- Scenario: Stripe redelivers an event (timeout, network, or its documented
  at-least-once delivery). The buyer gets a second welcome email; for a referral
  signup a second `referral/credits/` record is written and the owner is told a
  second time to apply a $99 credit.
- Tests: `DEFECT F1a` (duplicate welcome), `DEFECT F1b` (two credits, two owner
  emails).
- Minimal fix: at the top of the handler, `get("stripe-events/<event.id>")`;
  if present return 200 `{duplicate:true}`; write it (`onlyIf` absent) after a
  successful handling. Make the credit key `referral/credits/<event.id>`.

### F4. Dispute, early fraud warning and Radar review holds stop nobody (Medium)

- Where: `functions/api/stripe-webhook.js:105-137`, identity read at `:109-112`.
- Scenario: Stripe's Dispute, Radar Early Fraud Warning and Review objects carry
  `charge` and `payment_intent`, not `customer` or `customer_email` (a dispute
  has the address only under `evidence.customer_email_address`). So `who` and
  `cust` are empty, `deactivateSubscriber` returns 0, and the owner gets "No
  subscriber record matched ... may be a one-time pack buyer". The fraudulent
  subscriber keeps receiving the feed, and the alert points the owner the wrong
  way. `review.closed` (`:141-154`) has the same blind spot.
- Tests: `DEFECT F4` x3 (one per event type, real object shapes).
- Minimal fix: resolve the charge. Either call Stripe `GET /v1/charges/<charge>`
  (needs a restricted read key) to get `customer` and `billing_details.email`,
  or record `charge`/`payment_intent` ids on the row from `invoice.paid` and
  `checkout.session.completed` and match on those. Change the owner alert to
  say "could not resolve the customer" rather than "pack buyer".

### F3. ACH checkout delivers before money settles; failed ACH is ignored (Medium)

- Where: `functions/api/stripe-webhook.js:243-253` (no `payment_status` check);
  `checkout.session.async_payment_succeeded` and `async_payment_failed` fall
  through to `:164-165` as skipped.
- Scenario: a buyer pays by bank debit. `checkout.session.completed` arrives with
  `payment_status: "unpaid"`; the monthly bundle and an active row are created
  at once. If the debit fails days later, `async_payment_failed` is skipped and
  the row stays active. A one-time pack buyer keeps the file outright.
- Tests: `DEFECT F3a`, `DEFECT F3b`.
- Minimal fix: in `decideDelivery`, deliver on `completed` only when
  `payment_status` is `paid` or `no_payment_required`; handle
  `async_payment_succeeded` exactly like a paid `completed`, and
  `async_payment_failed` like `customer.subscription.deleted` plus an owner note.
  If ACH is not enabled in Checkout, this is latent; it becomes live the day it is.

### F12. Missing monthly bundle at checkout: 500 before the row is written (Medium)

- Where: `functions/api/stripe-webhook.js:189-190` returns before `:202-204`.
- Scenario: `latest-monthly.zip` is absent (a failed refresh, a rename). Every
  new buyer gets a 500, no email, and no roster row. Stripe retries for about
  3 days; until a retry succeeds the buyer misses Mondays, and if retries run
  out they are never added.
- Test: `DEFECT F12`.
- Minimal fix: write the subscriber row before fetching the bundle (the row
  write is already idempotent for an existing email), then 500 for the retry,
  plus `notifyOwner` on the missing bundle.

### F5. A held subscriber still gets the weekly bundle on renewal (Medium)

- Where: `functions/api/stripe-webhook.js:174-187` checks the roster only for
  $0 invoices; `:255-283` lets any paid renewal through.
- Scenario: a subscriber is held (`active:false`) after a dispute. Stripe keeps
  billing the subscription; the next `invoice.paid` emails them the weekly bundle,
  contradicting the owner alert "Nothing further ships to them until you decide".
- Test: `DEFECT F5`.
- Minimal fix: for `invoice.paid`, skip delivery when a matching row exists with
  `active:false` and a `payment_detail.radar` hold (or any `active:false`).

### F6. `charge.refunded` is not handled (Low)

- Where: falls through to `functions/api/stripe-webhook.js:164-165`.
- Scenario: the owner refunds a subscriber in full from the dashboard without
  cancelling; nothing records it, nothing alerts, the feed continues.
- Test: `DEFECT F6`.
- Minimal fix: handle `charge.refunded` like `invoice.payment_failed`: flag the
  row and `notifyOwner`; do not auto-deactivate on a partial refund.

### F8. Subscription `unpaid` / `paused` status is ignored (Low)

- Where: only `customer.subscription.deleted` is handled
  (`functions/api/stripe-webhook.js:41-45`).
- Scenario: if Stripe's dunning setting is "mark the subscription unpaid"
  rather than "cancel", or a subscription is paused, no `deleted` event ever
  arrives and the row stays active indefinitely.
- Test: `DEFECT F8`.
- Minimal fix: handle `customer.subscription.updated`; deactivate on `unpaid`,
  `paused`, `incomplete_expired`; reactivate on a return to `active`.

### M1. R2 error on the bundle read escapes my-leads (Low)

- Where: `functions/api/my-leads.js:105` (only the `subscribers.json` read at
  `:76-81` is in a try).
- Scenario: R2 is degraded when a subscriber clicks "Download your leads". The
  handler throws and the platform answers a bare 500, instead of the friendly
  "Temporarily unavailable. Please try the emailed attachment." 503.
- Test: `DEFECT M1` in `r2-endpoints.audit.test.mjs`.
- Minimal fix: wrap `:105` in the same try and return that 503.

### W2. No `refresh-status.json` means no freshness gate (Low)

- Where: `functions/api/weekly-send.js:52-73` (the whole gate is inside `if (st)`).
- Scenario: the status object is deleted or never written by a broken refresh;
  weekly-send mails whatever `latest-weekly.zip` holds, however old.
- Test: `DEFECT W2` (30 day old zip is mailed).
- Minimal fix: when `st` is null, fall back to `file.uploaded` age with the same
  8 day rule, or abort with 500 like the stale branch.

### F2. No timestamp tolerance on the Stripe signature (Low)

- Where: `functions/api/stripe-webhook.js:571-597` (`t` is parsed at `:576` and
  only fed into the HMAC).
- Scenario: anyone holding one signed payload (a copied dashboard request, a
  leaked log) can replay it forever. With F1 unfixed, every replay re-delivers.
- Test: `DEFECT F2` (an event signed for 2021 is accepted).
- Minimal fix: reject when `Math.abs(now - t) > 300` seconds, as Stripe's SDKs do.

### S2. Rows without `active` are invisible to the roster check (Low)

- Where: `functions/api/send-status.js:130` uses `active === true`;
  `weekly-send.js:78`, `my-leads.js:83` and `leads.js:532` use `active !== false`.
- Scenario: a legacy row with no `active` field is mailed every Monday, but if
  its send is skipped the watchdog's `roster_gap` does not count it.
- Test: `DEFECT S2`.
- Minimal fix: use `s.active !== false` at `send-status.js:130`.

### F9. Email case/whitespace variant creates a second row (Low)

- Where: `functions/api/stripe-webhook.js:297` (`s.email === email`, no trim or
  lower case), while every other matcher lower-cases.
- Scenario: a cancelled subscriber returns typing their address in a different
  case; a second row and a second token are created instead of reactivating the
  first. weekly-send dedups by `normEmail`, so no double mail, but the roster and
  the watchdog now carry two identities for one person.
- Test: `DEFECT F9`.
- Minimal fix: compare `normEmail(s.email) === normEmail(email)` and store the
  trimmed form.

### U1. upload-bundle allowlist accepts Object.prototype names (Low)

- Where: `functions/api/upload-bundle.js:296` (`key in ALLOWED_KEYS`).
- Scenario: an OIDC-valid caller (any workflow on `main`) can PUT
  `?key=constructor`, `toString`, `hasOwnProperty` or `__proto__`; all are
  written to R2. It cannot reach `subscribers.json`, so impact is small, but the
  allowlist is not the exact set it claims to be. `get-object.js` uses a `Set`
  and is exact (OK test).
- Test: `DEFECT U1`.
- Minimal fix: `Object.hasOwn(ALLOWED_KEYS, key)` or a `Map`.

## Observations (no failing test; design notes or risks)

- O1. Portal tokens never expire and never rotate. A token
  (`crypto.randomUUID`, 122 random bits, OK test) lives as long as the row is
  active, rides in every weekly email, and is reused when a cancelled row is
  reactivated (`stripe-webhook.js:303`). A forwarded email is permanent access
  while the subscriber pays. Acceptable by design; consider rotating on
  reactivation and adding an owner-side "rotate token" action.
- O2. OIDC is pinned to repo and `refs/heads/main` but not to a workflow
  (`_github-oidc.js:39-40`). Any workflow on main, including the
  `workflow_run`-triggered `monday-rehearsal.yml`, can call weekly-send.
  Only the carry store is workflow-pinned. Consider pinning weekly-send to
  `weekly-feed.yml` and `send-watchdog.yml`.
- O3. Webhook responses echo the subscriber address (`stripe-webhook.js:222`)
  and Resend error text (`:224`, `:562`) into Stripe's webhook delivery log.
  Stripe already holds the address, and the account is the owner's, so low.
- O4. One-time pack buyers (`mode=payment`) get no download link
  (`stripe-webhook.js:202`), only "reply to this email". Those are exactly the
  buyers whose ZIP a corporate filter strips.
- O5. Scale risk toward 200 subscribers: weekly-send mails sequentially with no
  per-call timeout (`weekly-send.js:195-202`, `:278`) and writes its log once at
  the end. A hung Resend call or a platform wall-clock/subrequest limit can end
  the run mid-loop with no log written, which the watchdog reports as `unknown`
  (no auto retry). Consider an `AbortSignal.timeout`, Resend batch sends, and
  per-recipient log writes.
- O6. Subscriber names are interpolated unescaped into the weekly HTML
  (`weekly-send.js:231`, `:271`). The name is buyer-supplied and lands only in
  their own email, so low.

## What a subscriber sees in each failure

| Failure | Subscriber sees | Owner sees |
|---|---|---|
| R2 error at signup (F10) | welcome email without download button, then no Mondays | nothing |
| Concurrent signup (F11) | welcome email, then no Mondays | nothing (roster gap cannot see a missing row) |
| Resend down at signup | nothing until a Stripe retry succeeds (row already written) | Stripe dashboard failures only |
| Monthly zip missing at signup (F12) | nothing until a retry after the file returns | Stripe dashboard failures only |
| Resend down on Monday (S1) | nothing | watchdog alert saying `unknown`, no auto retry |
| Two triggers overlap (W1) | the Monday email twice | `ok` |
| Weekly zip missing on Monday | nothing | Actions job fails (500), visible |
| Refresh stale > 8 days | nothing | Actions job fails (500), visible |
| R2 down on download click (M1) | bare platform error page | nothing |
| subscribers.json unreadable on click | "Temporarily unavailable" 503 | nothing |
| Cancelled or held, clicks link | "no longer active" 403, no names | dl/ event `inactive` |

## Correct today (pinned by OK tests)

- Bad, missing and tampered Stripe signatures: 400, no HMAC prefixes in the body.
- `MIN_CENTS = 500` unchanged; a $4.35 sibling-product charge ships nothing.
- A $0 renewal ships only to a known active subscriber.
- `invoice.payment_failed` flags, keeps active, alerts the owner.
- A cancellation for a superseded customer id does not revoke the live row.
- weekly-send: one email per subscriber per delivery week across sequential
  runs (09-07 holds), inactive rows skipped, case/whitespace duplicates deduped,
  401 without a bearer, 500 when the weekly zip is missing.
- weekly-send and send-status responses carry counts only: no address, no domain,
  no provider error text (the 07-06 to 09-21 Actions log leak stays closed).
- my-leads: exact 32-hex token gate; uppercase, padded, encoded and array forms
  rejected; `k` never becomes an R2 key; 403 names nobody; `no-store`.
- get-object: exact `Set` allowlist; traversal, encoding, case, padding,
  `subscribers.json`, the logs and the bundles are all refused; carry store only
  for `weekly-refresh.yml` on main.
- upload-bundle: refuses `subscribers.json`, traversal, case variants, GET,
  empty bodies, unauthenticated callers, and carry store writes from other
  workflows.

## Test counts

Existing suites (68 files, each run with `node --test`, outbound sockets blocked
by a preload), before and after this change: 459 pass, 0 fail, 16 skipped
(all 16 in `test/manual/intake.test.mjs`). This change adds no code under
`functions/` and edits no existing test.

New audit suite (`node --test test/paypath-audit/*.test.mjs`): 41 tests, 23 fail (DEFECT,
expected), 18 pass (OK).

| File | DEFECT (fail) | OK (pass) |
|---|---|---|
| `stripe-webhook.audit.test.mjs` | 17 | 6 |
| `weekly-send.audit.test.mjs` | 4 | 5 |
| `r2-endpoints.audit.test.mjs` | 2 | 7 |
