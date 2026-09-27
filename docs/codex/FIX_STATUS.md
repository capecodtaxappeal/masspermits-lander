# Isolated draft fix queue

These are published branches for review, not deployed fixes. No draft pull request exists yet: the permitted gh CLI is unavailable and its executable-path question remains unanswered. Do not replace it with another API client.

| Finding | Branch | Published head | Intended draft base | Full suite: pass / hard fail / TODO |
| --- | --- | --- | --- | --- |
| C17 inherited upload keys | claude/codex-fix-c17 | bf7b18a2dbe0e3f59bae828f14221151e9570a6f | claude/codex-revenue-harness | 315 / 4 known / 61 |
| C15 controlled download failures | claude/codex-fix-c15 | 33ced5f7b6d87aaefb9d5e73aa4ce8c2448ed8b9 | claude/codex-revenue-harness | 317 / 4 known / 59 |
| C04a customer identity precedence | claude/codex-fix-c04a | 330847c4b09d5f3a3df2c5b7ae0d423a2f27442d | claude/codex-revenue-harness | 321 / 5 / 62 |
| C02 durable enrollment before mail, partial | claude/codex-fix-c02 | 84a06d41860349095170915a588f7cc12481b141 | claude/codex-revenue-harness | 352 / 5 / 65 |
| C20 preserve source after failed aggregate save, partial | claude/codex-fix-c20-retention | 53e54003372646b6eec31cae434b975dcd49abb0 | claude/codex-revenue-harness | 342 / 4 known / 66 |
| C21 remove unsafe refresh guidance | claude/codex-fix-c21 | acbf5a01120f0a432f4b602d56a2eb2184471cc9 | claude/codex-revenue-harness | 343 / 4 known / 67 |
| C05 conditional roster updates | claude/codex-fix-c05 | In progress, uncommitted | claude/codex-fix-c02 | Pending final verification |

Each sibling worktree under .git/codex-session-worktrees/fix-<id> contains its own exact HANDOFF.md, SESSION_LOG.md, review body at docs/codex/fixes/<ID>.md, and before/after evidence. Test totals differ by branch because these are separate snapshots, not a merged fixes branch. All changes require owner review at merge. No merge is performed here.

## Additional structural failure

C04a and C02 have the four approved baseline failures plus "P1-14 no real email address in any added file". That test scans entire changed files and now scans the webhook's unchanged static addresses. The source diffs add no address, but this is an unexpected fifth failure, not an approved baseline or a green suite. Do not modify test/mission/ or remove source literals merely to evade it. These branches are not merge-ready until the scope check is legitimately re-anchored.

## Review decisions

D-5: Merge the narrow C17 upload membership fix after checks are re-anchored? Recommend: yes, because inherited object names must not enter an exact key allowlist.
D-6: Merge C15 controlled download failures? Recommend: yes, because unreadable storage must not be reported as a canceled subscriber.
D-7: Merge C04a identity precedence? Recommend: yes, because an old customer event must not change the replacement customer's payment flag.
D-8: Merge the C02 enrollment prerequisite? Recommend: yes, because a purchase must not be acknowledged after its roster update failed before any customer mail.
D-9: Merge C20 retention prerequisite? Recommend: yes, because source events must survive a failed replacement save.
D-10: Review C05 after conflict tests pass. Recommend: conditional roster writes with bounded recomputation, because concurrent events otherwise overwrite unrelated changes.
D-11: Merge C21 operator guidance? Recommend: yes, because suggesting a workflow edit on main can trigger an unplanned production run.

These are review recommendations, not claims that Patrick has accepted the remaining findings. The latest owner preauthorization allows creating draft fixes; it does not authorize deployment, customer mail, billing changes or policy choices.

## Held work

Main remains 1068e8070e88a436fbf5f86b88bf075e1f3a01c5 as fetched 2026-09-27. The pending once-per-week and counts-only changes are absent, so weekly-send.js and send-status.js remain frozen. D-2 remains tests only there. Broader C02/C03 delivery recovery, product scope, event ordering, refund/risk recovery and stale-access policy are not solved by these small patches.
