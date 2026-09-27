# C19 response privacy handoff

Branch: claude/codex-fix-c19-responses. Base and pre-fix head: e4f913765f7c241505fcff959d1617114dfedcea. The checkpoint commit containing this file is the current review head; obtain it with git rev-parse HEAD. Intended draft base: claude/codex-revenue-harness.

Done: four response expressions in stripe-webhook.js and mail-owner.js remove unnecessary identity and raw error text. Actual mail, HTTP statuses, authorization decisions and retained success fields are unchanged. C19 remains partial. Review note and D-12: docs/codex/fixes/C19-responses.md.

Focused before: 112 tests, 74 pass, 11 hard failures, 27 TODO.
Focused after: 112 tests, 85 pass, zero hard failures, 27 TODO.
Full corrected-LF before: 572 tests, 492 pass, 15 hard failures, 65 TODO.
Full after: 572 tests, 502 pass, 5 hard failures, 65 TODO.
No skipped/cancelled tests. Evidence is committed under docs/codex/evidence/C19-*.json.

Known baseline:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Additional unexpected failure: P1-14 no real email address in any added file. The scope scanner now reads unchanged static literals in changed source files. It is not waived and this is not a green suite. No mission test was changed. The CRLF checkout anomaly and exact HEAD-byte restoration are retained in the review note and separate evidence.

Next command:
    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

Check main and incoming harness changes before any rebase. Do not modify frozen weekly-send.js/send-status.js or workflows. Do not run live endpoints or read credentials. There is no production deployment or merge. Preserve all tests that check actual outgoing mail; do not restore removed response fields to satisfy stale consumer tests.

The permitted gh CLI is unavailable. Draft creation is pending, not complete. Once an executable path is supplied, create the own-branch draft with docs/codex/fixes/C19-responses.md as its body, base claude/codex-revenue-harness, then attach its URL. No alternate API client is authorized. Never push Monday 11:00-19:00 UTC or to main.

D-12: Merge the response privacy fix after checks and compatibility are reviewed? Recommend: yes, because response bodies need not expose identities or raw provider details. Wider C19 logging and sender/status work stays open. The owner preauthorized draft preparation, not deployment.
