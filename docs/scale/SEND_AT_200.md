# Can the Monday email reach 200 paying subscribers?

Short answer: not as it is built today.

* On the Cloudflare **free** plan the Monday send stops working at about **50 subscribers**.
* On Cloudflare **Workers Paid** it gets to about **999** before the same wall.
* At any size, a run that dies half way leaves no record, so the next try emails the
  people who already got it again (up to 4 copies, because of `curl --retry 3`).
* Nothing slows the sender down to Resend's 2 requests a second, and it never retries
  a 429. If Resend answers fast, most of a 200 person run is refused and never retried.

The numbers below come from `test/scale/send-scale.test.mjs`, which runs the real
`functions/api/weekly-send.js` (real OIDC check included) against a pretend R2 and a
pretend Resend. It sends nothing. Run it yourself with:

    SCALE_TABLE=1 node --test test/scale/send-scale.test.mjs

## How the send works today

One request to `/api/weekly-send` does the whole week:

1. Reads 5 things from R2 (refresh status, subscriber list, the zip, the send log twice).
2. Writes an "attempt started" marker.
3. Loops over every subscriber, **one at a time**, making **one Resend call each**, with
   the zip attached to every email.
4. Only after the loop ends, writes `feed-send-log.json` with who got it.

## What the replay measured

| Subscribers | Network calls in one request (cold) | Over free cap (50)? | Over paid cap (1,000)? | Time if Resend takes 0.3 s | Time at Resend's 2 per second | Send log, one week | Send log, 12 weeks kept |
|---|---|---|---|---|---|---|---|
| 200   | 201   | yes | no  | 60 s  | 100 s | 8 KB  | 100 KB |
| 500   | 501   | yes | no  | 150 s | 250 s | 20 KB | 244 KB |
| 1,000 | 1,001 | yes | yes | 300 s | 500 s | 40 KB | 484 KB |

"Cold" means the first request on a fresh Cloudflare server, which also fetches
GitHub's signing keys (one extra call). R2 reads and writes stay at 7 whatever the size.

Each Resend request carried the whole zip (a 256 KB test zip became a 352 KB request).
Local CPU for the whole loop was about 0.5 s at 200 and 1.8 s at 1,000 on this machine.
That is only a rough guide to Cloudflare's CPU meter.

## Where it breaks, and why

### 1. Cloudflare's cap on network calls per request (breaks at about 50 on free)

Every email is a separate `fetch()` to Resend. Cloudflare lets one request make
**50** of those on the free plan and (as last documented to us) **1,000** on Workers
Paid. The repo already sizes its other budgets against 50
(`test/mission/security.test.mjs`, "stays <= 45 subrequests").

With the cap enforced in the replay at 200 subscribers: the first 50 got the email
and the other 150 were marked failed with `Too many subrequests.` The reply still says
`ok: true`. The watchdog calls that `partial` and emails the owner, but does **not**
retry. Pressing re-run by hand three more times does finish the job, with no duplicates.

At 1,000 on the free cap it never finishes. It needs 20 runs, but the send log keeps
only the last 12 runs, and each run's entry is mostly that run's failures. So the
people who were mailed first drop out of the log, look unsent, and are mailed again.
After 25 runs the replay counted 600 people with duplicate copies and 350 still waiting.

### 2. A run that dies in the middle (breaks at any size; worse the bigger it gets)

The send log is written once, at the very end. If the request is killed part way
(CPU limit, Cloudflare restarting the server, a deploy), nothing records who already got
the email. The replay killed a 200 person run after 120 emails:

* `feed-send-log.json` was not written; only the "attempt started" marker was.
* The watchdog sees "unknown" and correctly does not retry.
* But `weekly-feed.yml` calls the sender with `curl --retry 3`, and curl retries on a
  5xx or a dropped connection. Each retry starts again from subscriber 1. The replay of
  that case: the first 120 people got **4 copies**, the last 80 got **none**.
* A human pressing re-run gets the same result: the first 120 get a second copy.

At 200 people the request has to stay open for 1 to 2 minutes. The longer it stays
open, the more likely something kills it.

### 3. Resend's rate limit (can bite at any size)

Resend's default limit is **2 requests per second** per account. The sender does not wait
between emails and does not retry a 429. In the replay, with Resend answering in 0.2 s,
**120 of 200** emails got a 429 and were marked failed. If Resend takes 0.6 s or longer
per email, the sender is slow enough by accident and all 200 go out (2 minutes).
So whether Monday works depends on how fast Resend happens to be that day.

The good part: when the log *does* get written, a re-run sends only to the people who
failed, never to the people who already have it. That ledger works.

### 4. The send log size is fine

12 weeks at 1,000 subscribers is under 0.5 MB. R2 does not care. It is not a problem.

## The smallest fix (not built here)

In order, smallest first. None of this touches `functions/` in this change.

1. **Stop duplicates.** Send an `Idempotency-Key` header with each Resend call, built
   from the delivery week and the subscriber address (for example
   `weekly-2026-11-02-<hash of address>`). Resend then refuses to send the same key twice,
   so a curl retry or a re-run after a crash cannot double-mail anyone. About 3 lines.
2. **Pace and retry.** Wait about 550 ms between emails (waiting does not use CPU time)
   and, on a 429 or 5xx, wait and try that one person again up to 2 times.
3. **Do the week in chunks, with a cursor.** Each request mails at most 40 people,
   writes the send log for those 40 before it returns, and replies `more: true`. The
   workflow calls again until `more` is false. 200 subscribers is 5 calls, 1,000 is 25.
   This fits the free plan's 50, never holds a request open for minutes, and a crash
   can only affect the 40 in flight (and step 1 covers those). Needs a small loop in
   `weekly-feed.yml` and in the watchdog retry.
4. **Keep the log by week, not by run.** Keep every entry from the current delivery
   week, and keep only successes in `sent`, so chunked runs cannot push this week's
   deliveries out of the log.

Resend's batch endpoint (up to 100 emails in one call) would cut 200 emails to 2 calls,
but as far as we know it does **not** allow attachments. Using it means the email
carries only the per-subscriber download button, not the zip. That is a product
decision, so it is listed as an option, not the recommendation.

A queue (Cloudflare Queues) also solves all of this, but it is more moving parts than
the business needs at 200.

## Assumptions to check

* Cloudflare plan for the Pages project: free (50 calls) or Workers Paid (1,000, or
  higher if Cloudflare has raised it). The fix above works for either.
* Resend plan: the default 2 per second. The Resend free plan also caps at 100 emails a
  day and 3,000 a month, which on its own would stop a 200 person Monday at 100.
* The size of `latest-weekly.zip`. The replay used 256 KB. Resend's limit is 40 MB per
  email including attachments, and a bigger zip means more CPU per email.
* Resend's `Idempotency-Key` support and its time window: check their current docs
  before relying on step 1.
