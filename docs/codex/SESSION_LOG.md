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


## 2026-09-27, C20 inbox diagnostic draft checkpoint

Branch claude/codex-fix-c20-inbox, based on e4f913765f7c241505fcff959d1617114dfedcea; intended draft PR base claude/codex-revenue-harness. Root approved the source review before checkpoint preparation. The only production-content change is inbox-status.js: unreadable/malformed evidence returns static alerting unknown, while valid states and genuine missing/dry-only installations retain their behavior. No workflow, heartbeat producer, mission test or frozen sender/status implementation changed.

Promoted the three inbox diagnostic TODOs and added 36 synthetic cases. Exact before/after test bytes were identical. Focused before at 06:40:17.510 UTC: 88/42 pass/28 hard fail/18 TODO; focused after at 06:47:58.406: 88/70/0/18. Full before at 06:40:35.339: 601/505/32/64; full after at 06:48:16.914: 601/533/4/64. Both used Node v25.9.0, with zero skipped/cancelled tests. After-full has only the same four known structural failures and no unexpected hard failure. Four byte-identical summary copies are tracked as evidence/C20-inbox-*-summary.json; matching TAP remains ignored.

The worktree inherited CRLF checkout conversion. Root authorized exact HEAD-byte restoration of 60 proven-unmodified admin/functions/header paths before the baseline; 59 needed normalization. Generated widget/windows paths, workflows and mission tests were left untouched. After the paired runs, only changed checkpoint files were normalized to LF/no BOM; the weekly test normalization changes line endings alone and preserves its two annotation-removal hunks.

Automatic approval review initially rejected the source patch. Patrick's explicit draft-fix preauthorization was then supplied, and the same apply_patch operation succeeded on one retry. There was no alternate source-write attempt. D-13 asks whether to merge this reader diagnostic draft and recommends yes after review; no merge/deployment is authorized or performed here.

C20 remains partial: genuine-never suppression, workflow transport/non-JSON fallback behavior, owner-alert observability and mailbox installation are outside this patch; retention has a separate published fix. gh was not found on PATH, so no draft PR was created here and no alternate API client was used. Replaced the inherited harness HANDOFF with branch-specific state, exact next fetch/full commands, the four known failure names and publication constraints. No commit or push was performed by this checkpoint task.
