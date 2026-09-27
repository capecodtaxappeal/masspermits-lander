# C05 handoff

Concurrent roster changes preserve each other's fields through conditional writes.
Four retries are bounded; storage failure stops before this invocation reaches customer or owner mail.
Focused checks: 73 pass, zero hard fail, 25 existing TODO; 28 assertions fail before the fix.
Full suite: 383 pass, five disclosed structural failures, 63 TODO; not merge-ready.
D-10: Merge C05 after its dependency and checks are reviewed? Recommend: yes, because concurrent events otherwise overwrite valid changes.

## Current state
Branch: claude/codex-fix-c05.
Head: refs/heads/claude/codex-fix-c05; resolve git rev-parse HEAD after this closing commit.
Base and intended draft target: claude/codex-fix-c02 at 84a06d41860349095170915a588f7cc12481b141.
Source main remains 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c05.
Read OWNER_DECISIONS.md and fixes/C05.md for scope, evidence, risk and owner authorization.
No draft PR exists while gh is unavailable. No merge, deployment or live request occurred.

## Verification
node test/harness/run.mjs test/revenue/webhook.test.mjs test/revenue/roster-concurrency.test.mjs
node test/harness/run.mjs

Same focused tests before: 98 tests, 45 pass, 28 fail, 25 TODO.
After: 98 tests, 73 pass, zero fail, 25 TODO.
Full: 451 tests, 383 pass, five hard failures, 63 TODO, zero skipped/cancelled.
Tracked summaries: evidence/C05-before.json, C05-focused.json, C05-full.json.
The nine bounded local workerd comparisons pass. They cover the same etag and conditional-write primitives used here.

## Exact next step
When the permitted gh CLI is available:
gh pr create --draft --base claude/codex-fix-c02 --head claude/codex-fix-c05 --title "Preserve concurrent subscriber roster updates" --body-file docs/codex/fixes/C05.md

First read any existing draft for this branch to avoid creating a duplicate, then create/update only this branch's draft. Attach a successfully created PR to the task. Do not use another API client.
Return to the harness worktree for continuous S7/S8 work. This fix does not combine C04a identity matching or C03 idempotency.

## Disclosed structural failures
The four owner-known failures remain:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

The fifth is unexpected and not waived: P1-14 no real email address in any added file.
It scans the whole changed webhook including three pre-existing static address occurrences, unchanged from C02. No address was added to production. Do not modify test/mission or existing literals to evade this check.

## Limits
Conditional writes protect cooperating roster writers, not outside unconditional writes, event-time order, provider idempotency or multi-step transactions. Radar has two roster updates; the first may persist before the second fails. Retry completes bookkeeping before owner mail, but no event-wide atomicity is claimed. C02's post-provider log handling remains unchanged to avoid duplicate-mail retries.
The two pending sender changes are absent on origin/main; weekly-send.js and send-status.js remain frozen. No workflow edit/run, real credentials/data, billing action, automatic repair or new customer-notice policy.
Before any push enforce Monday 11:00-19:00 UTC blackout. Branch pushes only, never main or merge.
