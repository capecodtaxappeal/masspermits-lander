# Continuous reliability program handoff

## Five-line owner report

Thirty revenue rules now have a named coverage map and ranked findings.
The current full suite has 494 passes, four known baseline failures and 67 executed TODO cases.
Nine storage, HTML and signing comparisons pass against local workerd.
Production and the existing mission tests are unchanged.
Work continues into failure injection, mutation testing, small fixes and the runbook.

## Current state

Updated 2026-09-27. Phases S2, S3 and S6 complete. S7 mutation strengthening is in progress; S8 runbook is being prepared in ignored scratch.
Branch: claude/codex-revenue-harness.
Source base: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Previous published head: ba5eee54f027c09c99e4d84461ec09b711d923a7.
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

First command at S7:

    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

If main moved, read the changes, rebase this branch and rerun the full suite. Preserve the freeze unless both incoming changes are proved present.
1. S3 complete: FINDINGS.md ranks C01-C20 with exact reproductions, impact, conditional likelihood and disposition. C04a identity conflicts is separate from C04b event ordering.
2. S3 complete: COVERAGE.md maps I01-I30, retaining explicit partial and policy gaps. It attributes I15 to existing mission reconciliation oracles.
3. S6 complete: FAILURE_INJECTION.md, auth-portal.test.mjs and failure-injection.test.mjs. Evidence/S6-full.json: 411/340/4/67. Three new C08 diagnostic counterexamples stay queued behind frozen sender/status work. S7 next: implement homemade AST mutation copies with per-file scores, then strengthen tests and justify survivors.
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

## Isolated fix publication
C17 branch claude/codex-fix-c17 pushed bf7b18a2dbe0e3f59bae828f14221151e9570a6f. Three failing-before regressions pass afterward. Its own full result is 380/315/4/61. C15 and C04a remain independent in-progress worktrees based on S3. No PR yet while gh remains unavailable. Draft bases should be the harness branch so fixes stay narrow.

## Current S7 work before its closing checkpoint
The AST mutator smoke test passed. Initial operator-stratified sample: 321 selected, 192 killed, 5 syntax-invalid, 122 survived, 2 unclassified process exits; no timeout. This is below target and not a program completion claim. Saved ignored report: test/harness/.runtime/mutation/S7-initial-sample.json. Forty-three helper contracts, 19 gate tests and 34 operations tests pass separately. Webhook/access mutation test files are being added by independent agents. Exact next command after both pass: node test/harness/mutate.mjs --limit 2000 --jobs 3. This covers all current candidates rather than a sampled score. Do not count failing TODO cases as killed mutations.
Five separate fix branches are published: C17 bf7b18a2d; C15 33ced5f7b; C04a 330847c4b; C02 84a06d418; C20-retention 53e540033. No PR exists because gh is unavailable. All should target claude/codex-revenue-harness as drafts. C04a/C02 have the four known failures plus the new whole-file static-address structural check; it is not waived or relabeled baseline. C02 and C20 remain partial findings. Their sibling worktrees contain exact handoffs/evidence.
S8 draft is being prepared only under ignored test/harness/.runtime, pending review and promotion after S7 checkpoint. A source instruction in pipeline-now recommends editing weekly-refresh.yml to force a refresh; the runbook must supersede that unsafe operator instruction and retain the workflow prohibition.

## Live checkpoint 2026-09-27, S7 exhaustive run

This section supersedes the older in-progress fix list above. See FIX_STATUS.md for six published fix branches and C05 in progress. No draft PR exists while gh is unavailable. C21 has a separate published fix for operator guidance that suggested editing a workflow on main.

The strengthened baseline is 565 tests: 494 pass, four exact known baseline failures, 67 executed TODO, zero skipped/cancelled and zero unexpected hard failures. It passed again after ordinary test children were changed to inherit only executable/runtime settings; arbitrary environment values and REVENUE_SOURCE_ROOT are excluded. A synthetic one-case probe passed. Local evidence: test/harness/.runtime/S7-env-baseline.json and S7-runner-environment.json.

The exhaustive mutation run is active as exec session 8071. It selects 1822 candidates across 15 files, not 1922. Source and selected test files must remain stable until it finishes. Command: node test/harness/mutate.mjs --limit 2000 --jobs 3. Progress: test/harness/.runtime/mutation/progress.json; final: results.json. The initial sample remains S7-initial-sample.json. Do not infer a final score from partial progress. Poll the existing process if it is still available; otherwise inspect progress and process state before starting another runner that uses the same scratch workers.

Next: preserve the complete run, review every survivor, add meaningful missing contracts, rerun surviving/unresolved candidates with source hashes unchanged, and publish the S7 evidence and score. Then promote the prepared S8 runbook and source companion from ignored .runtime, verify links/text and checkpoint S8. Continue independent fixes. C05 is based on C02 and must target that branch as a draft; root review/final validation precedes its publication.

Latest fetch at this checkpoint: origin/main still 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. Frozen sender/status changes remain queued. Do not edit mission tests to change the four owner-known failures or the additional static-address structural failure on webhook-changing fix branches.
