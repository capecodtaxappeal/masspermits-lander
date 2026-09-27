# Continuous reliability handoff

Branch: claude/codex-revenue-harness.
Source main: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5, fetched again 2026-09-27 06:50 UTC.
Published prior checkpoint: e4f913765f7c241505fcff959d1617114dfedcea. This S7 closing checkpoint is identified by git rev-parse HEAD; its commit contains this handoff.
Physical worktree: .git/codex-session-worktrees/revenue-harness inside the public clone. Never read the neighboring private project or unrelated base-checkout files.

## Current result

S1, S2, S3 and S6 are published. S7 is complete as an offline test-strength checkpoint: 701 tests, 630 pass, four known hard failures, 67 executed TODO, zero skip/cancel and zero unexpected hard failures. Evidence: evidence/S7-full.json. This is not an all-green suite.
Mutation result: paying path 1320/1435 valid, 92.0%; combined with lifecycle 1676/1814, 92.4%. Eight invalid excluded, five unresolved kept in denominator. See MUTATION_REPORT.md and evidence/S7-final-mutation.json for actual per-file scores and all five rounds. No mutator process is still running.

Every historical rule has a named coverage entry, but open TODOs and operational gaps are not enforced behavior. COVERAGE.md preserves its S3 snapshot, with later addenda. I31 and C21 add the unsafe operator-guidance finding. FINDINGS.md is not a list of live incidents.
Published isolated fixes and their own evidence are in FIX_STATUS.md. Fixes are not merged into this branch or deployed. Each needs a separate draft. Source-dependent scores cannot be reused to certify those changed branches.

## Exact next action

    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

If main moved, inspect and rebase with the full suite. Otherwise promote the reviewed ignored S8-RUNBOOK-DRAFT.md and S8-RUNBOOK-SOURCES.md from test/harness/.runtime into docs/codex, update stale counts/source references, verify the guide and checkpoint S8. Continue independent preauthorized fixes after that. Do not stop just because S7 is checkpointed.
Current parallel work: C20-inbox published af369f90c5dbecc46c309ee8a30e2a381491322a after root review; C18 optional upload preconditions are being implemented in an isolated draft worktree. C19-responses published 9762e4979d7e60e746ddb9f1ccd15cd60d53f9e4.
Pending runner state: none. Full command: node test/harness/run.mjs --label review-full.
Never start two mutation runners sharing scratch workers.

## Owner instructions

D-1 permits only gh CLI create/update/read of our own claude/codex-* draft PRs. gh remains unavailable; the executable-path question is pending. No draft PR exists. PR_DESCRIPTION.md and each fix note are prepared. Do not substitute another API or unauthorized download. Attach every created PR URL once the CLI is available.
D-2: keep missing-active rows eligible and flag for review. Do not rewrite them. Tests only until pending sender changes are present.
S4/S5 fixes are preauthorized as isolated one-finding drafts. No merge or deployment. Decisions for final review remain in FIX_STATUS.md and each branch's note.
D-3 refund/risk-review entitlement policy and D-4 stale-access policy questions remain unanswered. Do not invent them.
weekly-send.js and send-status.js remain frozen: both incoming once-per-week and counts-only changes are absent from fetched main. Queue dependent fixes; do not overwrite incoming work.
Never edit test/mission/. Exact known failures:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Some webhook-changing fixes also fail P1-14 no real email address in any added file because of unchanged static source literals. This fifth failure is unexpected, not owner-waived and not green. See FIX_STATUS.md.

## Boundaries and surprises

No workflow edit/run, service request, real data, secret read, wrangler, main push or merge. Network is package registries, git fetch/push and the narrow gh exception. No allowlist expansion, root package.json or production dependency on test tooling.
Use LF with no BOM and no en/em dashes in new owner/customer/PR text. Create future worktrees with git -c core.autocrlf=false -c core.eol=lf. Windows CRLF checkout inflated and broke six historical mission checks in two fix worktrees; proven-unmodified source bytes were restored exactly to HEAD, with anomaly evidence retained. No mission test or workflow changed.
Use explicit paths for staging and disabled Git hooks. Before pushing check UTC; never Monday 11:00-19:00 UTC.
The closed harness strips credentials/source overrides from child environments. Local workerd checks nine bounded contracts, not the full platform. Provider acceptance is not inbox receipt.
Original stop conditions still apply. Program completion additionally needs findings closed or explicitly accepted, reviewed PRs with legitimate green checks, and the runbook. The mutation threshold alone is not completion.

## Current live continuation, 2026-09-27 after final review

S7 is receiving one final harness fidelity correction before its closing checkpoint; the earlier "complete" wording describes the prior measured snapshot only. Three additional status metadata contracts pass, bringing operations controls to 65. A local workerd probe proved limit 1001 is rejected while MemoryR2 clamped it. The bounded numeric-limit parity correction is in progress in the main harness, with no production source edit.

Next: after the harness agent freezes its files, run node test/harness/run.mjs --label S7-final-full. Preserve earlier full evidence separately, record actual new counts, then run the entire mutation catalog once with the final tests and harness. Do not run a mutator while files are changing. This avoids relying only on accumulated evidence across the harness correction. No mutator is currently running.

C20-inbox is now published af369f90c5dbecc46c309ee8a30e2a381491322a. C19-responses is published 9762e4979d7e60e746ddb9f1ccd15cd60d53f9e4. Both worktrees have clean content and index status after exact-HEAD hash checks refreshed stale Windows index entries. Effective Git core.autocrlf is true, contrary to the clone claim; continue using explicit false/LF flags for worktree creation and staging.

C18-preconditions is in an isolated worktree: focused after 117/104 pass/0 fail/13 TODO, full 598/528 pass/4 known fail/66 TODO. Root is checking opaque ETag SDK semantics before committing it. No PR exists; gh remains absent.

S8 reviewed guide and queue are saved under test/harness/.runtime/S8-RUNBOOK-REVIEWED.md and S8-REMAINING-WORK.md. Promote after S7 closes, using actual final counts. A source companion and workflow-proposal fragment are being prepared; workflow files remain unchanged and no workflow is run.

## Active final exhaustive verification

Full suite after the final metadata controls and numeric R2 parity correction: 715 tests, 644 pass, four known failures, 67 TODO, zero unexpected. Source/test/harness files are now frozen. The entire 1822-candidate catalog is running as exec_command session 93070, started 2026-09-27T07:10:34Z. Poll that process if still available; otherwise inspect .runtime/mutation/progress.json before starting another runner. Do not overlap mutation runners. Final raw output will be .runtime/mutation/results.json. Preserve it as evidence/S7-final-exhaustive.json after removing only the local sourceRoot field, then run node test/harness/report-mutation.mjs docs/codex/evidence/S7-final-exhaustive.json. That one fresh run will be the reported final score. Earlier accumulated evidence is preserved as S7-accumulated-before-fidelity.json. Update the report, handoff and PR body to actual final counts and checkpoint S7, then S8.
