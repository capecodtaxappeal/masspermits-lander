# Operator guide source checks

The guide was checked against main source 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. These are local code references, not proof of current deployment, installed configuration or real customer receipt. No URL in the guide was opened during this work.

## Existing owner controls

- admin/mission-render.js:68 supplies Refresh and :256 supplies per-row Stripe links.
- admin/mission-view.js:248-255 names Customers, Renewals and failed payments, Monday delivery, Data refresh and Setup.
- admin/mission-view.js:154-155 constrains Stripe links to dashboard customer/subscription/invoice pages.
- admin/mission-app.js:39-67 performs refresh reads and can retain an older successful render after an error.
- functions/admin/api/mission.js:219-257 authenticates GET views and returns a controlled unavailable response.
- The guide does not present the separate outreach POST as a recovery action.

## Alert contracts

- functions/api/send-status.js:36-38 and :121-160 set the Monday 12:00 UTC due time and 1.5-hour grace. :65-74 selects evidence. :101-119 uses active === true for roster comparison, so it still conflicts with D-2 eligibility.
- send-status.js:173-196 applies portal and roster overrides. A headline can conceal another condition; nested evidence matters.
- send-status.js:242-300 checks portal age over eight days and rounded drift over 15 minutes. functions/leads.js:146-189 handles stale HTML and missing-HTML fallback. Neither publication time nor fallback proves correct file contents.
- functions/api/_mission_stripe.js:196-242 reads configured product scope and completeness. functions/api/_mission_data.js:759-762 and :1425-1427 supply coarse Setup text. Setup alone is not proof of complete Stripe data.
- functions/api/inbox-status.js:47-53 and :75-124 implement the 30-hour and 72-hour thresholds. In this main snapshot, :60-64 collapses failed reads/parse into missing state. The separate C20-inbox draft improves that distinction; it is not deployed by this task.
- functions/api/inbox-heartbeat.js writes the monitoring record. Its existence does not prove an installed trigger, mailbox access or receipt.
- functions/api/pipeline-now.js:150-157 explicitly distinguishes provider acceptance from receipt.
- D-2 in OWNER_DECISIONS.md keeps rows without an active field eligible and flags them for review.

## Unsafe old guidance

functions/api/pipeline-now.js:111-112 recommends pushing an edit to the refresh workflow on main to force a run. :235 exposes it as what_to_do and admin/now.html:147 renders that field. The guide explicitly supersedes this instruction. The isolated C21 draft removes it, but this task does not deploy that draft or run a workflow.

The runbook contains no invented repair command. Investigating ambiguous acceptance before recovery is deliberate: a whole-list resend can duplicate customer mail. Restoring stale access and sending notices remain policy decisions in REMAINING_WORK.md.

## Verification and publication

test/harness/run.mjs keeps ordinary children on the worktree source, allowlists executable/runtime environment values, confines scratch to the clone, saves labeled sanitized summaries and preserves nonzero exit status. No credential is required. Use the actual counts in evidence/S7-full.json rather than a historical phase snapshot.

The four exact owner-known structural failures remain in HANDOFF.md. Some independent fix branches additionally fail the whole-file address scan on unchanged source literals. FIX_STATUS.md records that as unexpected, not green or waived.

The push blackout is Monday 11:00-19:00 UTC. Branch publication, draft creation and production deployment are separate states. No main push, merge or deployment is authorized by this guide.
