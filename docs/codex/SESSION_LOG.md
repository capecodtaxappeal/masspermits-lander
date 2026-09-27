# Session log

## 2026-09-27, S1, map and invariants

Source main: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Branch: claude/codex-revenue-harness.
Worktree: the in-clone .git/codex-session-worktrees/revenue-harness directory.

Fetched origin, inspected prior work, and read the listed paying path plus four complete workflow definitions. Created a clean worktree to preserve 14 pre-existing untracked entries in the base checkout. Those entries were not read, moved or included.

Baseline before documentation edits: Node v25.9.0; exact requested three-glob command; 211 tests, 209 pass, 2 fail, 0 skipped, 0 todo, 0 cancelled; test exit 1. The two failures are the historical P2-5 headers append comparison and P1-14 branch allowed-path comparison. No test or production fix was made in S1.

Delivered REVENUE_PATH.md, INVARIANTS.md, REUSE.md, OFFLINE_TESTING.md and HANDOFF.md. Defined 30 rules and 20 source candidates with explicit future test targets, separate from any claim about production incidents.

Plan adaptation: main already has mission-control reconciliation and partial address masking. Reuse their tests and the unmerged rehearsal primitives. Keep weekly-send and send-status frozen until the incoming guard and final output changes are verified. Replace obsolete premerge test assumptions in a tests-only S2 step.

Final verification after docs: 211 tests, 207 pass, 4 fail, 0 skipped/todo/cancelled, test exit 1. Additional failures are P2-12 branch hygiene and P1-14 route strings, because the old mission scope forbids required docs and endpoint names in the map. No production behavior changed. LF, no BOM, no prohibited long dash characters, and unchanged functions/workflows/admin/tests were verified. Independent source reviews corrected event naming, active-row semantics and line citations.
Closing fetch confirmed origin/main still at 1068e8070. Content commit d2a1d35add5be05bed91a7602dc950dbe6c2b9d8 was pushed successfully to origin/claude/codex-revenue-harness at 2026-09-27T04:43:32Z. Local and remote-tracking heads matched. This closing handoff commit records that publication. Test scratch was removed from the confined session directory; no scratch is committed. The final session reply records the closing commit and its push result.
Draft PR: pending D-1 authorization because GitHub API access is prohibited by the current network rule. PR_DESCRIPTION.md contains the reviewable text; no PR was created.
No production, workflow, dependency, customer-data or credential change. No service request or workflow execution.

## 2026-09-27, S2, real-handler harness

Owner decisions persisted in OWNER_DECISIONS.md. D-1 permits only gh CLI draft-PR operations on our branches; D-2 keeps legacy rows served and reviewed. Continuous execution replaces pauses. test/mission is frozen by owner request.

Added 160 real-handler scenarios plus nine platform contract checks. Full result: 380 tests, 312 pass, four named known baseline failures, 64 executed TODOs, no skipped/cancelled or unexpected hard failures. Miniflare/workerd contract checks passed 9/9. No function or workflow was changed. Defect and policy TODO diagnostics were independently reviewed; corrected payment and retention fixtures were included.

Dependencies and npm cache are confined to test/harness. Install scripts were disabled. Real-handler imports, closed fetch, generated signature fixtures, fake R2 and fixed clock replace live service access. The worker uses only loopback and rejects external transport. Evidence: evidence/S2-full.json and evidence/S2-platform.json.

gh was not found on PATH or at its standard install path. The executable-path question remains pending while independent work continues. No alternate API was used. PR_DESCRIPTION.md is ready for the authorized draft. Next phase is S3 findings and test coverage, then S6/S7/S8 and separate preauthorized fix branches.

## 2026-09-27, S3, findings and named coverage

Published S2 head: 0e353e32741e4523994157a134071119368f06c5. Fetched origin/main remains 1068e8070.
FINDINGS.md ranks the source candidates with executable evidence, explicit policy boundaries and proposed changes. COVERAGE.md maps every I01-I30 to named evidence while retaining partial coverage rather than claiming full enforcement.
Full suite rerun: 380 tests, 312 pass, the same four known failures, 64 executed TODO, no skipped/cancelled or unexpected hard failures. Saved evidence/S3-full.json. No functions, workflows or mission tests changed.
Plan adaptation: narrow C17, C15 and C04a fixes can run independently of the frozen sender work, each on a separate draft branch based on the harness branch. Broader enrollment, concurrency and event recovery need distinct contracts. Next: S6 injection, S7 mutation, S8 runbook, plus the narrow fixes.
The permitted gh executable remains unavailable, so no draft PR has been created. The published branch and PR_DESCRIPTION.md remain reviewable; independent work continues.

## 2026-09-27, S6 failure injection

Added 31 cases:28 pass and 3 executed diagnostic TODOs. Full 411/340/4/67, no unexpected hard failure. S6-full.json and FAILURE_INJECTION.md record limits. Main remains 1068e8070. C17 independently pushed bf7b18a2d; C15/C04a remain in progress. No production change on harness branch. S7 next, then S8; continuous execution continues despite unavailable gh.

## 2026-09-27, S7 exhaustive mutation testing

Closing full suite: 701 tests, 630 pass, four exact owner-known failures, 67 executed TODO, zero unexpected hard failures. Saved evidence/S7-full.json. Exhaustive catalog plus source-identical strengthening rounds: paying path 1320/1435 valid killed (92.0%); combined lifecycle 1676/1814 (92.4%). Eight syntax-invalid excluded; two unclassified exits and three timeouts remain unresolved in denominator. All 26 final webhook gap targets were killed. Scores, IDs, hashes and limits are in MUTATION_REPORT.md and evidence/S7-final-mutation.json. No production, workflow or mission test changed on this branch.

Seven earlier isolated fixes remain published; C19 responses also published at 9762e4979. C20 inbox passed before/after and awaits publication. C18 optional preconditions are under source-only assessment. gh remains unavailable, so no draft PR exists. Main fetched again at 06:50 UTC remains 1068e8070. Next phase is S8 promotion and verification, without stopping.

## 2026-09-27, S7 final single-run checkpoint

Full suite after the final controls and bounded R2 correction: 715 tests, 644 pass, four known failures, 67 TODO, zero unexpected. Twenty local workerd cases pass. A fresh entire catalog ran 07:10:34 to 07:21:46 UTC: 1822 selected, 1680 killed, 129 survived, eight invalid, two unclassified exits and three timeouts. Requested paying path is 1323/1435 valid killed (92.2%); combined 92.6%. The runner exits 1 for unresolved outcomes. No earlier kills are carried into the final score. Current tests/harness are published at 39023cb60; final result and source hashes are in evidence/S7-final-exhaustive.json. The four newly killed candidates are two metadata-await/null cases and two out-of-range R2 list limits.

Ten separate fix branches are now published, most recently C18 at 559b63740. gh is still unavailable; no draft PR has been created. Source freezes and unresolved owner policies remain. S8 promotion follows immediately. No production source changed on the harness branch.

## 2026-09-27, S8 operator guide and final continuation checkpoint

S7 closing head 1b19bb3dd075d6edb3512a7662cdd9e5ab617273 was pushed. Fetched origin/main remains 1068e8070. Required S8 baseline at 07:30:15 UTC: 715 tests, 644 pass, four known hard failures, 67 executed TODO, no skips/cancelled/unexpected. Evidence/S8-full.json preserves it.

Promoted the independently reviewed 599-word RUNBOOK.md, checked controls/thresholds against source, and added RUNBOOK_SOURCES.md plus the complete REMAINING_WORK.md queue. The inbox workflow proposal is only a text fragment under docs/codex/proposals, explicitly unexecuted and incomplete at its remaining boundaries. It does not change any workflow or authorize execution. No production or test code changed in S8, so the unchanged full-suite baseline is retained rather than repeated for text-only edits.

All ten fix worktrees were checked in the repository owner's execution context: clean, with local heads matching their published remote-tracking heads. No mutation Node processes remained. A first sandbox-account status attempt failed ownership checks and is not evidence of cleanliness; the successful owner-context verification supplied these conclusions without changing Git security configuration.

gh remains absent; no PR exists. No main push, merge, deployment, customer send or live service call occurred. The remaining program is limited by the frozen sender/status files, prohibited live verification, unsettled delivery contracts and unanswered D-3/D-4 policies. All independent prepared work is saved. Continue from HANDOFF.md, not a prediction of Monday delivery.
