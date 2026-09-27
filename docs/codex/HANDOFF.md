# C04a isolated fix checkpoint

Branch: claude/codex-fix-c04a.
Base: S3 harness 135db62d2414eab521a69ecaacac3ce8115527ae.
Current closing head: resolve git rev-parse HEAD.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c04a
Two identity-conflict regressions fail before the patch and pass afterward; eight compatibility controls pass.
Full suite: 388 tests, 321 pass, five failures and 62 TODO. No skips or cancellations.
The fifth failure is newly surfaced: P1-14 no real email address in any added file. It scans unchanged source literals because the file changed. It is NOT one of the four owner-known baseline failures, and remains unexpected in the saved result. No source literal or mission test was edited to bypass it. Draft is not merge-ready pending the test-scope re-anchor.

Prepared body, risk note and exact test names: docs/codex/fixes/C04a.md.
Tracked summaries: docs/codex/evidence/C04a-before.json, C04a-focused.json, C04a-full.json.
Exact next command when the allowed CLI is available:
gh pr create --draft --base claude/codex-revenue-harness --head claude/codex-fix-c04a --title "Keep conflicting customer identities out of payment flags" --body-file docs/codex/fixes/C04a.md

The authorized gh CLI remains unavailable. No draft PR exists yet; branch publication is not deployment. Attach any eventual PR to the task and keep it draft. Never merge or push main.
Continuous S7/S8 work remains on claude/codex-revenue-harness in the sibling revenue-harness worktree. Read its HANDOFF.md to continue the program.
All network, credential, synthetic-data, frozen sender/status/workflow and mission-test restrictions remain in force. Do not push Monday 11:00-19:00 UTC.
