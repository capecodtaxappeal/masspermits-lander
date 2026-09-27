# C20-retention isolated fix checkpoint

Branch: claude/codex-fix-c20-retention.
Base: S6 harness ba5eee54f027c09c99e4d84461ec09b711d923a7.
Current closing head: resolve git rev-parse HEAD.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c20-retention
Source clicks survive failed aggregate saves, and successful recovery saves before pruning.
Full suite: 412 tests, 342 pass, four known failures and 66 TODO. No skips or cancellations.
Only C20 retention is fixed on this branch. Monitoring and input completeness remain open. No unexpected hard failure, and the four owner-known baseline failures remain visible.

Prepared description, exact tests and risk note: docs/codex/fixes/C20-retention.md.
Tracked evidence: docs/codex/evidence/C20-retention-before.json, C20-retention-focused.json, C20-retention-full.json.
Exact next command when the allowed CLI is available:
gh pr create --draft --base claude/codex-revenue-harness --head claude/codex-fix-c20-retention --title "Preserve download evidence after aggregate save failure" --body-file docs/codex/fixes/C20-retention.md

No PR exists while the authorized gh executable remains unavailable. Publish only this authorized branch, attach the eventual draft URL, and never merge or push main.
The continuing program is on claude/codex-revenue-harness in the sibling revenue-harness worktree. S7 strengthening/exhaustive mutation and S8 runbook remain in progress. All credential, network, workflow, frozen sender/status, mission-test and Monday push restrictions remain in force.
