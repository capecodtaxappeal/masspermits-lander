# C20 inbox diagnostic draft handoff

Unreadable or malformed inbox evidence now returns an alerting unknown verdict.
Genuine missing, dry-only and valid existing states retain their behavior.
The same 28 failing assertions pass after the fix.
The full suite has 533 passes, four known failures and 64 executed TODOs.
This is a reviewed local draft, with no deployment or merge.

## Branch and source scope

Prepared 2026-09-27 in:
C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c20-inbox

Branch: claude/codex-fix-c20-inbox.
Base commit: e4f913765f7c241505fcff959d1617114dfedcea.
Intended draft PR base: claude/codex-revenue-harness.
Implementation checkpoint: fab744215. The following documentation checkpoint records the implementation head; git rev-parse HEAD identifies the current review head.

Only functions/api/inbox-status.js changes production content. Three existing inbox TODOs are promoted in test/revenue/weekly-watchdog.test.mjs; test/revenue/inbox-diagnostics.test.mjs adds 36 synthetic cases. The producer, frozen weekly-send/send-status handlers, workflows and mission tests are unchanged. Root approved the source review; root owns commit and publication after checking this checkpoint.

D-13: Merge this C20 inbox diagnostic draft?
Recommend: Yes, after review. Draft implementation is covered by Patrick's explicit preauthorization of separate draft fix branches; merge remains the owner's decision. See fixes/C20-inbox.md for validation details and compatibility risks.

## Reproducible evidence

Four tracked summaries under docs/codex/evidence retain the exact before/after results:

| Run | Tests | Pass | Hard fail | Executed TODO |
| --- | ---: | ---: | ---: | ---: |
| C20-inbox-before-focused-summary.json | 88 | 42 | 28 | 18 |
| C20-inbox-after-focused-summary.json | 88 | 70 | 0 | 18 |
| C20-inbox-before-full-summary.json | 601 | 505 | 32 | 64 |
| C20-inbox-after-full-summary.json | 601 | 533 | 4 | 64 |

Node v25.9.0. No skipped or cancelled tests. After-focused exits 0; full exits 1 with exactly these four owner-known structural failures:

1. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
2. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
3. P1-14 the diff from main lists only allowed paths
4. P1-14 route strings never appear in non-test added files

No unexpected hard failure remains. The same source-relative test files ran before and after with identical bytes. Only the existing weekly test's line endings were subsequently normalized for the checkpoint; assertions and their two annotation-removal hunks are unchanged. Matching TAP remains in ignored test/harness/.runtime. This is not a full-green or deployed-delivery claim.

## Exact next commands

From this worktree, fetch through the permitted Git transport with hooks disabled:

    git -c core.hooksPath=C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-disabled-hooks fetch origin

Review any changes to origin/main and origin/claude/codex-revenue-harness before rebasing or publishing. No remote freshness claim is made by this docs-only checkpoint task. Keep the sender/status freeze until both incoming guard/counts-only changes are verified on origin/main.

Full offline validation:

    node test/harness/run.mjs

Focused validation:

    node test/harness/run.mjs test/revenue/weekly-watchdog.test.mjs test/revenue/inbox-diagnostics.test.mjs

Stage only the ten paths listed in the parent checkpoint review: the one handler, two tests, HANDOFF.md, SESSION_LOG.md, fixes/C20-inbox.md and the four named evidence JSONs. Generated widget/windows checkout files are excluded. Use LF without BOM. Check UTC before any push; Monday 11:00-19:00 UTC remains a push blackout. Disable repository hooks, never push main, never merge, and never run a workflow or deployment.

## Partial C20 and publication limits

Unknown is compatible with the existing inbox-watchdog generic alert branch. The workflow's genuine-never suppression and unreachable/non-JSON fallback behavior remain unchanged and open. The published retention fix is separate. This patch neither installs a mailbox monitor nor proves script health, customer receipt or owner receipt; it reports when stored evidence is insufficient.

The permitted gh executable was not found on PATH in this task. No draft PR was created here. Use only the authorized gh CLI for our own draft branches once available; do not substitute another GitHub API client or download a tool from an unauthorized service. Parent publication can proceed separately from draft-PR creation.

The initial source-edit rejection was resolved by supplying Patrick's explicit draft-fix authorization and retrying the same apply_patch operation once. No alternate source-write mechanism was used. The checkout line-ending anomaly and exact source/test hashes are documented in fixes/C20-inbox.md. No service call, credential read, real customer data, workflow edit or workflow execution occurred.
