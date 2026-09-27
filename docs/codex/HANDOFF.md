# Continuous reliability program handoff

## Five-line owner report

Thirty revenue rules now have a named coverage map and ranked findings.
The full suite has 312 passes, four known baseline failures and 64 executed TODO cases.
Nine storage, HTML and signing comparisons pass against local workerd.
Production and the existing mission tests are unchanged.
Work continues into failure injection, mutation testing, small fixes and the runbook.

## Current state

Updated 2026-09-27. Phases S2 and S3 complete; S6 next, with independent small fix branches in parallel.
Branch: claude/codex-revenue-harness.
Source base: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Previous published head: 0e353e32741e4523994157a134071119368f06c5.
Current closing head: refs/heads/claude/codex-revenue-harness; resolve git rev-parse HEAD.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/revenue-harness

Read OWNER_DECISIONS.md first. It overrides the old S1 approvals. Do not pause between phases. Commit, push and update the draft PR at each checkpoint, then continue.
The base checkout's pre-existing files remain untouched. All new test scratch and dependencies stay inside this clone.

## Authorization and pending conditions

D-1 approved: gh CLI only, for create/update/read of our own claude/codex-* draft PRs. No other GitHub API use.
D-2 approved: keep serving missing-active rows and flag them; tests only until incoming sender changes land.
Fixes preauthorized as separate draft PRs, one finding per claude/codex-fix-<id> branch. Never merge.
Do not edit test/mission/. Another branch will re-anchor its four known failures.
weekly-send.js and send-status.js remain frozen. Both pending guards must appear on origin/main before any fix to either file. Latest fetch still shows 1068e8070.
D-3/D-4 business outcomes for refunds/risk-review recovery/customer notices and stale-access policy remain unspecified. Policy scenarios are not claimed as defects.

gh is not on PATH or at its standard install path. An asynchronous question requests the command/path used by the other session. Continue independent offline work; do not substitute a different GitHub API client or download from an unauthorized service.
Draft PR body: docs/codex/PR_DESCRIPTION.md. The branch is published; draft creation awaits the permitted CLI. No unauthorized API workaround was attempted.

## Done with evidence

S1: REVENUE_PATH.md, INVARIANTS.md, REUSE.md and the original source map.
S2: test/harness/index.mjs, run.mjs, platform.mjs and isolated dependency manifest/lock.
Real-handler scenarios: access-storage.test.mjs, webhook.test.mjs, weekly-watchdog.test.mjs.
Platform comparison: harness-contracts.test.mjs, nine passing cases using local workerd with external transport blocked.
Evidence: docs/codex/evidence/S2-baseline.json, S2-scenarios.json, S2-platform.json, S2-full.json.

Full command:

    node test/harness/run.mjs

S2 full result: 380 tests, 312 pass, 4 known fail, 64 TODO, 0 skip/cancelled, exit 1, unexpected hard failures 0.
The 64 TODOs execute; 63 failed and one policy case passed in the initial diagnostic review. They are not 64 independent defects. Detailed grouping belongs in FINDINGS.md.
Independent reviews found no loader/auth/mock errors in TODO failures. Corrected payment, retention and timestamp fixtures were included in the final full run.
The nine fidelity tests pass after moving native Headers mutation inside workerd, rather than sending a Node Headers object across its RPC boundary.

Known failures, unchanged:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

## Exact next steps

First command at S6:

    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

If main moved, read the changes, rebase this branch and rerun the full suite. Preserve the freeze unless both incoming changes are proved present.
1. S3 complete: FINDINGS.md ranks C01-C20 with exact reproductions, impact, conditional likelihood and disposition. C04a identity conflicts is separate from C04b event ordering.
2. S3 complete: COVERAGE.md maps I01-I30, retaining explicit partial and policy gaps. It attributes I15 to existing mission reconciliation oracles.
3. Continue S6 now. Add provider faults, large rosters, UTC/DST boundaries, auth and rendered-portal controls. S3 evidence is evidence/S3-full.json: 380/312/4/64, no unexpected hard failures.
4. Add genuine failure injection beyond existing cases, then mutation tests with per-file scores and justified survivors. Mutation copies must stay inside clone scratch, never in deployed source.
5. Implement preauthorized minimal fixes on separate branches with failing-before/passing-after evidence. First fixes: C17 own-key gate, C15 controlled access errors, C04a conflicting-customer payment flags. Each branch is based on the harness branch and should target it as a stacked draft so production diffs remain small. Do not mix broader event-ordering work into C04a.
6. Write the short operator runbook and continue resolving nonfrozen findings. Queue frozen and policy-dependent items with exact reasons.

## Boundaries

Network only package registries and git fetch/push, plus the explicit gh draft-PR exception above. No live service calls, credentials, real data, deployment commands or workflows. Do not run wrangler.
Never read outside this clone. Installed runtimes are invoked normally; no unrelated workspace files are read.
Do not change .github/workflows/. Workflow proposals go under docs/codex/proposals/ as text.
Never widen upload/read allowlists, add root package.json, import test dependencies into functions/, copy private engine code or real data.
Use LF, no BOM and no prohibited long dash characters in new owner/customer wording.
Before every push, check UTC and refuse Monday 11:00-19:00 UTC. Never main push or merge.
Use explicit staged paths and disable repository hooks for commits/pushes so unrelated automation is not executed.
Stop only for original stop conditions, whole-program completion, or platform termination; otherwise checkpoint and continue.

## Honest remaining limits

Node/runtime tests and local workerd do not establish current deployment configuration or customer inbox receipt.
Fidelity covers the APIs exercised, not every R2/HTML feature or cloud timing property.
The older Node HTMLRewriter dependency is test-only and checked against pinned workerd for the exercised behavior.
No defect is closed merely because its test is marked TODO or its PR is a draft.
