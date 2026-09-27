# MassPermits reliability handoff

Branch: claude/codex-revenue-harness.
Published implementation checkpoint: 39023cb6081646aed1f5956fdb63de00b4dd0832. The current closing documentation commit is identified by git rev-parse HEAD.
Source main: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Physical worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/revenue-harness.
Never read the neighboring private project or unrelated base-checkout files.

## Completed evidence

S1, S2, S3 and S6 are published. S7 is complete as an offline verification checkpoint.
Full suite: 715 tests, 644 pass, four known hard failures, 67 executed TODO, zero skipped/cancelled and zero unexpected hard failures. Twenty local workerd comparison cases pass. Evidence: evidence/S7-full.json.
A fresh full mutation run completed 2026-09-27T07:21:46.565Z against frozen tests and the corrected harness: requested paying path 1323/1435 valid killed (92.2%); combined lifecycle 1680/1814 (92.6%). Eight invalid are excluded; two unclassified errors and three timeouts remain unresolved in the denominator. The mutation runner exits 1 for those unresolved outcomes.
MUTATION_REPORT.md and evidence/S7-final-exhaustive.json record one complete run, not accumulated earlier kills. Earlier rounds remain historical evidence. No mutation process is still active.
Ten isolated fix branches are published. FIX_STATUS.md lists exact heads, dependencies, decisions and branch-specific test counts. None is merged into this branch or deployed. C05 depends on C02. A published branch is not a PR.

## Exact next action

    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

Then finish S8 immediately: promote the reviewed ignored S8-RUNBOOK-REVIEWED.md, S8-SOURCES-REVIEWED.md and S8-REMAINING-WORK.md from test/harness/.runtime into docs/codex; update the guide to 644 passes and the C18 queue to published; promote the unexecuted S8-INBOX-PROPOSAL.yml.txt only under docs/codex/proposals. Verify text and source links, append SESSION_LOG.md, commit and push, then continue any independent authorized work.
No tests or background mutation jobs are in progress. Ordinary command: node test/harness/run.mjs --label review-full.
If main moved, inspect source changes before tests, rebase with explicit LF flags, and rerun. Do not reuse this snapshot's mutation score for changed production source.

## Approvals and blockers

D-1: gh CLI only for create/update/read of own claude/codex-* draft PRs. gh is absent from PATH and the checked standard location. The executable-path question remains pending. No draft PR exists; bodies are prepared in PR_DESCRIPTION.md and each fix's note. Do not use another API client or unauthorized download. Attach every created PR.
D-2: keep missing-active rows eligible, leave their field unchanged, and flag them for review. Tests only until incoming sender changes arrive.
Isolated one-finding draft fixes are preauthorized. Merge, deployment, live service reads, billing operations and sends are not.
D-3 refund/risk-review recovery policy and D-4 stale-access policy questions remain unanswered. Do not invent an answer.
weekly-send.js and send-status.js remain frozen until both incoming once-per-week and counts-only changes are verified on origin/main. Last fetch still showed neither. Queue dependent fixes and continue other work.
Wider product scope, subscription/event ordering and accepted-but-unrecorded delivery require explicit contracts. Live Stripe completeness/provider guarantees cannot be established with this task's offline access. The program is not complete merely because S7 exceeds 80%.

## Known failures

Never edit test/mission/. Preserve these four owner-known names:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Certain fix branches also fail P1-14 no real email address in any added file because the scanner inspects unchanged static literals in modified files. This fifth failure is unexpected, not waived and not green. See FIX_STATUS.md. Tests marked TODO execute; they do not enforce or close open findings.

## Operating boundaries and surprises

No workflow edits or runs, real service calls, credentials, customer data, wrangler, main push or merge. Network is only package registries, git fetch/push and the narrow gh exception. No allowlist expansion, root package.json or test dependency imported by production.
Use LF/no BOM and no en/em dashes in new owner/customer/PR text. Effective Git core.autocrlf is true, contrary to the original clone claim; use -c core.autocrlf=false -c core.eol=lf for checkouts. Two worktrees needed exact-HEAD byte restoration after CRLF broke baseline text checks. Evidence is retained; no workflow or mission test changed.
Stage explicit paths with hooks disabled. Check UTC before every push: Monday 11:00-19:00 UTC is forbidden.
The storage fake's numeric list-limit mismatch was corrected after actual local binding comparisons. Nonnumeric/nonfinite coercions and other untested platform behavior remain outside fidelity claims.
Original stop conditions remain mandatory. Program completion needs reviewed/accepted findings, legitimate green PR checks and the operator guide, not just a mutation score. Report directly to the owner; do not contact the main Claude session.
