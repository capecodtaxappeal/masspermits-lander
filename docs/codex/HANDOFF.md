# C18 upload preconditions handoff

Branch: claude/codex-fix-c18-preconditions.
Base: e4f913765f7c241505fcff959d1617114dfedcea.
The checkpoint commit containing this file is the review head; resolve it with git rev-parse HEAD.
Intended draft base: claude/codex-revenue-harness.

Optional upload conditions are enforced atomically by one R2 put. A failed condition returns 412 and preserves the stored object. Existing unconditional callers and intended allowlist stay unchanged. Only functions/api/upload-bundle.js changes production behavior. C17 inherited-key protection is a separate draft; C18 format validation and coherent generation publication remain open.

Root reviewed the patch and its additional opaque-tag SDK comparison. See fixes/C18.md for the bounded header grammar, compatibility, risk and D-14 recommendation. The comparisons establish only the exercised storage primitive and punctuation cases; they do not certify all HTTP or R2 semantics.

Paired focused evidence: 117 tests, 73 pass/31 fail/13 TODO before; 104 pass/0 fail/13 TODO after.
Paired full evidence: 598 tests, 497 pass/35 fail/66 TODO before; 528 pass/4 fail/66 TODO after.
Three separate SDK punctuation controls then passed.
Final full: 601 tests, 531 pass, four known hard failures, 66 TODO, no skipped/cancelled or unexpected failures. The suite exits 1. All evidence is in docs/codex/evidence/C18/.

Known baseline:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

Next command:
    git -c core.hooksPath=.git/codex-disabled-hooks fetch origin

Inspect incoming main and harness changes before any rebase. Run node test/harness/run.mjs after a rebase. Keep explicit core.autocrlf=false and core.eol=lf for checkouts. No workflow or mission test edits, live services, credentials, main push, merge or deployment.

gh remains unavailable. No draft PR exists. Once its permitted executable is available, create this own-branch draft with fixes/C18.md as the body, then attach its URL. Do not substitute another API. Check UTC before any push; Monday 11:00-19:00 UTC is forbidden.

D-14: Merge the optional upload precondition fix after review? Recommend: yes, because callers need a real atomic rejection rather than a silently ignored write condition. Caller adoption and publication generation control remain separate reviewed work.
