# C02 isolated fix checkpoint

Branch: claude/codex-fix-c02.
Base: S6 harness ba5eee54f027c09c99e4d84461ec09b711d923a7.
Current closing head: resolve git rev-parse HEAD.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c02
Enrollment storage failures now stop before customer mail; nine regressions fail before and pass after.
Full suite: 422 tests, 352 pass, five failures and 65 TODO. No skips or cancellations.
C02 is only partly fixed. Post-provider evidence and C03 duplicate handling remain open. The fifth full-suite failure is the newly surfaced whole-file static-address scanner; keep it outside the four known baseline failures and do not call the suite green.

Prepared description, exact tests and risk note: docs/codex/fixes/C02.md.
Tracked evidence: docs/codex/evidence/C02-before.json, C02-focused.json, C02-full.json.
Exact next command when the allowed CLI is available:
gh pr create --draft --base claude/codex-revenue-harness --head claude/codex-fix-c02 --title "Require durable enrollment before first customer mail" --body-file docs/codex/fixes/C02.md

No PR exists while the authorized gh executable remains unavailable. Publish only this authorized branch, attach the eventual draft URL, and never merge or push main.
The continuing program is on claude/codex-revenue-harness in the sibling revenue-harness worktree. S7 strengthening/exhaustive mutation and S8 runbook remain in progress. All credential, network, workflow, frozen sender/status, mission-test and Monday push restrictions remain in force.
