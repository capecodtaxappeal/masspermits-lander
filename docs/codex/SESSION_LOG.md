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

## 2026-09-27, isolated C18 optional upload preconditions draft

Worktree: .git/codex-session-worktrees/fix-c18-preconditions. Branch: claude/codex-fix-c18-preconditions. Base: e4f913765f7c241505fcff959d1617114dfedcea. D-14 is the owner merge decision; implementation/offline testing was preauthorized, while this subtask permits no commit or push.

Read the upload receiver, current tests, R2 fake and local platform contracts, and the existing workflow/cold-state upload consumer text. All inspected upload consumers omit precondition headers. Added 33 synthetic real-handler/platform cases and promoted the stale conditional-write TODO after correcting it to allow an attempted atomic put and assert unchanged bytes/ETag. Corrected one initial test-helper key typo before the recorded baseline; the calibration output is retained in ignored scratch.

At 07:05 UTC the unchanged source produced focused 117/73 pass/31 hard fail/13 TODO, and full 598/497 pass/35 hard fail/66 TODO. The full failures are 31 new failing precondition contracts plus the four named historical mission gates. Modified only functions/api/upload-bundle.js in production source to parse one optional supported ETag condition, forward it to one R2 put, translate null to 412, and add a successful response ETag. No read-before-put or unconditional retry. Authentication, size/method gates and exact intended allowlist/content types are unchanged.

At 07:06-07:07 UTC the same focused tests produced 117/104 pass/0 fail/13 TODO; full 598/528 pass/4 known fail/66 TODO. A review challenged opaque ETag fidelity. Three additional local-workerd checks at 07:09 UTC confirmed comma-containing and backslash-suffixed tags are literal mismatches against a real current ETag for both match directions, preserving the original paired evidence. Final full at 07:10:21.282 UTC: 601 tests, 531 pass, four known hard failures, 66 executed TODO, zero skipped/cancelled/unexpected failures, exit 1.

Prepared docs/codex/fixes/C18.md, the current isolated handoff, and sanitized summaries/provenance under docs/codex/evidence/C18/. Raw sanitized TAP stays ignored in this worktree. All requests were synthetic and transport-closed; local workerd is ephemeral. No workflow, customer route, service, credential or main checkout was accessed or changed by the implementation. Sibling source and evidence were untouched; the preauthorized dependency junction reads shared test packages inside the clone.

The endpoint capability is partial C18: consumers remain unconditional; content validation, multi-object generations, and consumer ETag adoption remain open. The C17 inherited-key gate and C19 error handling remain separate. No mission tests were weakened, and the full suite is not represented as green. No commit, push, PR creation, merge or deployment occurred in this subtask.
