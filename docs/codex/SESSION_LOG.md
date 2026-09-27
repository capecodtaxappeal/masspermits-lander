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
Closing fetch confirmed origin/main still at 1068e8070. Documentation is ready for the session commit; remote publication is recorded in the closing entry after push.
Draft PR: pending D-1 authorization because GitHub API access is prohibited by the current network rule. PR_DESCRIPTION.md contains the reviewable text; no PR was created.
No production, workflow, dependency, customer-data or credential change. No service request or workflow execution.
