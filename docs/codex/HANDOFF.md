# C15 isolated fix checkpoint

Branch: claude/codex-fix-c15.
Base: S3 harness 135db62d2414eab521a69ecaacac3ce8115527ae.
Current closing head: resolve git rev-parse HEAD.
Worktree: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/fix-c15
Five download-error regressions fail before the patch and pass afterward.
Full suite: 380 tests, 317 pass, four known failures and 59 TODO. No skips or cancellations.
No unexpected hard failure. The full suite still exits 1 for the four owner-known baseline tests.

Prepared body, risk note and exact test names: docs/codex/fixes/C15.md.
Tracked summaries: docs/codex/evidence/C15-before.json, C15-focused.json, C15-full.json.
Exact next command when the allowed CLI is available:
gh pr create --draft --base claude/codex-revenue-harness --head claude/codex-fix-c15 --title "Return controlled errors for unavailable paid downloads" --body-file docs/codex/fixes/C15.md

The authorized gh CLI remains unavailable. No draft PR exists yet; branch publication is not deployment. Attach any eventual PR to the task and keep it draft. Never merge or push main.
Continuous S7/S8 work remains on claude/codex-revenue-harness in the sibling revenue-harness worktree. Read its HANDOFF.md to continue the program.
All network, credential, synthetic-data, frozen sender/status/workflow and mission-test restrictions remain in force. Do not push Monday 11:00-19:00 UTC.
