# MassPermits alert runbook

This guide describes the inspected source, not a verified deployment. Draft fixes are not live.

## Start here

Open https://masspermits.com/admin/mission, sign in as owner and click **Refresh**. Open **Monday delivery**, **Data refresh** and **Setup**. Check the observation time: an older view can remain after a failed refresh. Read the existing alert's run and job logs. Do not click **Run workflow** or **Re-run jobs**.

A recorded delivery generally means the mail provider accepted a request. It does not prove inbox receipt or service to every payer. Inspect the recipient-gap and portal evidence as well as the headline.

## Alerts and next actions

- **Weekly missed:** No usable attempt or result was found after Monday's 12:00 UTC due time plus 90 minutes. Open the existing send-watchdog run log and compare due time, last attempt, last result and later runs. Missing evidence can produce an unsafe retry suggestion. Establish which recipients were accepted before requesting recovery.

- **Partial or unknown:** Some requests failed, or an attempt has no reliable result. Inspect failed recipients, all attempts in the window and available provider records. A timeout or lost log may follow acceptance. Request a recipient-specific recovery decision; do not force a whole-list resend.

- **Roster gap:** Some explicitly active roster entries are absent from the selected accepted-send record. This neither proves they are billed nor finds payers missing from the roster. Open **Customers** and **Renewals and failed payments**, then the affected row's **Stripe** link. Ask the maintainer to reconcile the complete approved product scope against the roster. Keep rows without an active flag eligible and flag them for review.

- **Stale bundle, stale portal or portal drift:** Open **Data refresh** and the existing refresh run log. The portal check flags age over eight days or rounded publication drift over 15 minutes. Timestamps alone do not prove good contents. Have the maintainer verify both artifacts before an approved republish. Sending again cannot repair the portal. Ignore the old board instruction to edit a workflow on main to force a refresh.

- **Stripe unknown, unavailable, unverified or at least:** Treat payment information as incomplete. Click **Refresh**, inspect the affected tiles and **Setup**, then the relevant **Stripe** row link. Setup saying ok is insufficient. Missing settings, rejected access and incomplete pagination need diagnosis before any billing or access change.

- **Inbox never, stale, unarmed, backlog or unknown:** Open the existing inbox-watchdog run log. Compare last live run, roster protection, safe mode, waiting count and oldest age. Stale means over 30 hours without a recorded live run; backlog escalates at 72 hours. On current main, unreadable state can misleadingly say never. A separate draft changes that to alerting unknown. Check the actual mailbox and ask the maintainer to inspect the installed trigger and authorization. No repair button exists; a heartbeat does not prove receipt.

- **Storage error or unavailable page:** Refresh once and retain the timestamp and error. Unreadable records do not mean empty, canceled or unsent. Ask for storage diagnosis. Do not replace objects with empty data or offer an attachment whose identity and date are unverified.

## Offline verification and limits

In the revenue-harness worktree, run:

    node test/harness/run.mjs --label operator-check

Read test/harness/.runtime/operator-check-summary.json. The saved S7 result is 644 pass, four named baseline failures and 67 executed TODO cases. Some fix branches also have an unexpected fifth source-address check; see FIX_STATUS.md. Neither result is a green release.

There is no approved one-click repair for these alerts. Recovery needs evidence and a reviewed change. Check UTC before any authorized push. No pushes Monday 11:00-19:00 UTC; no main push, merge, workflow edit/run or forced resend.
