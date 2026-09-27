# C17 fix checkpoint

The upload gate rejects undeclared inherited property names before storage.
The three promoted regressions pass after failing against unchanged source.
The full suite has 315 passes, four known failures and 61 TODO cases.
No keys were added and no workflow or sender file changed.
D-5: Approve C17 for merge? Recommend: yes, because it narrows the existing gate.

Branch: claude/codex-fix-c17.
Base: claude/codex-revenue-harness S3 checkpoint 135db62d2414eab521a69ecaacac3ce8115527ae.
Current closing head: resolve git rev-parse HEAD on this branch.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c17
Prepared draft body and risk note: docs/codex/fixes/C17.md.
Evidence: docs/codex/evidence/C17-before.json, C17-focused.json, C17-full.json.
Exact next command: gh pr create --draft --base claude/codex-revenue-harness --head claude/codex-fix-c17 --title "Reject undeclared upload keys before storage" --body-file docs/codex/fixes/C17.md

The permitted gh executable is unavailable. No PR has been created. The branch can be pushed under the authorized prefix without deployment; keep the eventual PR a draft and attach its URL to the task. Never merge or push main.
The ongoing program lives on claude/codex-revenue-harness in the sibling revenue-harness worktree. Continue S6/S7/S8 there; do not treat this completed patch as program completion.

Four unchanged known baseline failures:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Read OWNER_DECISIONS.md. Network, credential, synthetic-data, workflow, mission-test and Monday push restrictions still apply. Frozen sender/status changes stay queued. C18 publication validity is outside this patch.
