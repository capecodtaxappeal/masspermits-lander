# Owner decisions and continuous execution

Recorded 2026-09-27 from the owner's explicit continuation message. This supersedes conflicting S1 handoff wording.

D-1: APPROVED. Use gh CLI only to create, update and read draft PRs for our own claude/codex-* branches. No other GitHub API use.
D-2: APPROVED. Continue serving rows with no active field and flag them for review. Tests only until the pending sender changes are on main.

Do not edit test/mission/. The owner identified a pending branch that re-anchors its four failures. Keep these exact known baseline names:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Continue S2, S3, S6, S7 and S8 in this task without stopping at checkpoints. Commit, push, update HANDOFF.md and the draft PR at each checkpoint, then continue.
S4/S5 fixes are preauthorized as separate draft PRs, one finding per branch, claude/codex-fix-<id>. Never merge.
Hold fixes touching weekly-send.js or send-status.js until both pending once-per-week and counts-only changes are on origin/main. Queue them and continue other work.
Stop only for an original stop condition, completion of the entire program, or the platform ending the task.
An unresolved product policy is recorded honestly rather than silently invented. Safe independent work continues.

At continuation start, origin/main remains 1068e8070. The gh executable is absent from PATH and the standard install path. An asynchronous question requests the existing command/path; offline work continues. No unauthorized GitHub API workaround is allowed.
