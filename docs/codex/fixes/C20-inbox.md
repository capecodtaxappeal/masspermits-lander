Unreadable or malformed inbox evidence now reports an alerting unknown state.
Missing installations, dry-only runs and valid existing states retain their behavior.
All 28 reproduced failures pass with the same tests after the fix.
The full suite retains four known structural failures and has no unexpected failures.
This is a local draft; C20 remains partial and nothing was deployed.

## D-13 - Merge this C20 inbox diagnostic draft?

Recommend: Yes, after review. Draft implementation is already authorized by Patrick's instruction, “Fixes (S4 and S5) are pre-authorized as DRAFT PRs only”; merge remains the owner's review point. Branch: `claude/codex-fix-c20-inbox`; base: `e4f913765f7c241505fcff959d1617114dfedcea`; intended PR base: `claude/codex-revenue-harness`. The four known structural failures below remain disclosed rather than waived or presented as a green suite.

The only source change is `functions/api/inbox-status.js`. The three existing inbox TODOs are promoted, and `test/revenue/inbox-diagnostics.test.mjs` adds 36 synthetic cases. No workflow, mission file, producer, billing operation or customer-delivery implementation is changed. Published C20 retention work is separate.

## Reviewable change and compatibility

The reader preserves missing-object versus failed/malformed evidence. Unknown state returns HTTP 200, `verdict: "unknown"`, `alert: true`, static diagnostic text and null untrusted counts/times. Exceptions and malformed values are not echoed. Authentication remains before storage access (`inbox-status.js:57-99`).

Validation covers the state's record shape, supplied history shape, usable live timestamp and numeric/boolean summary (`inbox-status.js:181-205`). Optional legacy metadata remains optional. A producer-shaped first dry run with no live history remains `never`; retained live history with a lost timestamp is unknown. Valid offset timestamps remain accepted. The patch introduces no future-clock tolerance, repair action or mailbox access.

The intended behavior change is additional owner-alert eligibility when stored evidence is unavailable or malformed. A legacy/manual object missing required counts is conservatively unknown even if its timestamp is recent; the current producer emits those counts. Static detail identifies uncertainty rather than claiming an unanswered customer or a dead script. Missing R2 objects continue to use the existing pre-installation behavior.

The source-only consumer `.github/workflows/inbox-watchdog.yml:114-121` suppresses non-alerts and separately suppresses `never`. Its default heading at line 128 accepts other verdicts; alerting unknown enters its existing owner-mail attempt and failed-job path. No workflow edit or execution is required for this compatibility finding. HTTP/non-JSON fallbacks at 97-101 and genuine `never` suppression remain open. Provider acceptance or a workflow attempt is not proof of owner receipt.

`functions/api/inbox-heartbeat.js:69-91,115-123` writes server-clock timestamps and allowlisted counts. Dry runs preserve the live timestamp/summary. Fixtures represent both states without calling the producer service. C20 remains partial: workflow fallbacks, owner-alert observability, mailbox installation and retention are outside this patch.

## Identical before/after evidence

Promoted cases at `test/revenue/weekly-watchdog.test.mjs:423-438`: read failure, invalid JSON and invalid timestamp. New cases cover producer-shaped live/dry states, later dry activity preserving stale live evidence, body-read failure, persisted null/scalar/array/empty/malformed state, timestamp and summary types, error privacy, authentication, optional metadata, offset dates and unchanged 30h/72h boundaries. There are no real customer records or credentials.

Commands: `node test/harness/run.mjs test/revenue/weekly-watchdog.test.mjs test/revenue/inbox-diagnostics.test.mjs` and `node test/harness/run.mjs`. No source override was used.

| Run | UTC | Tests | Pass | Hard fail | TODO | Exit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Focused before | 2026-09-27 06:40:17.510 | 88 | 42 | 28 | 18 | 1 |
| Full before | 2026-09-27 06:40:35.339 | 601 | 505 | 32 | 64 | 1 |
| Focused after | 2026-09-27 06:47:58.406 | 88 | 70 | 0 | 18 | 0 |
| Full after | 2026-09-27 06:48:16.914 | 601 | 533 | 4 | 64 | 1 |

Node `v25.9.0`; zero skipped/cancelled. The 28 hard failures on unchanged source are 25 new negative controls plus the three promoted reproductions. Both after-runs pass those same assertions. The full after-run has only four known structural failures: P2-5 header append, P2-12 branch hygiene, P1-14 allowed paths, and P1-14 route strings in non-test added files. There are no unexpected hard failures. The test-file hashes are identical before and after; no assertion was changed between runs.

Four sanitized summary files are copied byte-for-byte to `docs/codex/evidence/` with these same filenames and hashes. Matching TAP and the original summaries remain under `test/harness/.runtime/`:

- `C20-inbox-before-focused-summary.json` and matching TAP; summary SHA-256 `f04a846444c95923d505ca53f1b4629042ade8613d53c05c508a2d4c94ef41b0`.
- `C20-inbox-before-full-summary.json` and matching TAP; summary SHA-256 `43c6250781d13b10973088af1aa263e35cf15d6f81532456a74b60e9653d5237`.
- `C20-inbox-after-focused-summary.json` and matching TAP; summary SHA-256 `f6e7c15fb96b5819fc93e1e47ec3823e8e70eaaa31a38ecf693ae874bb8b6fcb`.
- `C20-inbox-after-full-summary.json` and matching TAP; summary SHA-256 `6445cacf373284a012ba0f8adc21101c411c969217e5e082b55c127da2a330e6`.
- `C20-inbox-before-inputs.json` records source/test hashes.
- Before source SHA-256: `651332dfd48ff3137c3a15ec04ae864ab85d768489af0d60c6d24ffc344d0a9a`.
- After source SHA-256: `49e08994ee38ddcf7793ec003738c0a08e0dece597499801702386bb270a59ce`.
- Executed existing test SHA-256 before and after: `803fecaa6fc7a0c985a911d0a5b60b8312289901f3c64e84a432d77d427b6d06`. Its later checkpoint normalization changes CRLF to LF only; the semantic diff remains the two annotation removals representing three cases.
- Checkpoint LF-normalized existing test SHA-256: `1638769e5c4fc2e93883dc04de6f93d0f8882af280748e7860a03538fd0e241f`.
- New test SHA-256: `83e4c76d786633e90d70976a31f5f40cb21046808e23a4db2e073a6dc417dce5`.

## Checkout and approval limits

With global/system Git configuration disabled, initial status reported 461 generated widget/windows paths; root's ordinary status was clean. Checkout CRLF conversion explained the discrepancy. Generated files were not opened or changed. Before baseline, 60 authorized admin/functions/header paths were verified against HEAD; 59 had CRLF bytes. Git restore skipped rewriting clean paths. Root authorized exact HEAD-byte restoration, and every normalized path was verified before writing. Workflows and mission tests were excluded. Tests then had only the four known structural failures plus the reproduced C20 cases.

Automatic approval review initially rejected the source patch because it could not find Patrick's explicit authorization. Root then supplied the latest owner's quoted instruction authorizing isolated draft fixes and preserving the weekly-send/send-status freeze. The same `apply_patch` operation was retried once with that evidence and succeeded; no alternate source-write mechanism was used. Production source and test semantics have not changed since the after-runs. The existing weekly test's checkpoint normalization is line-ending-only, after the identical-byte before/after runs. This documentation records the resolved approval boundary, not a pending request. Root approved the source review; checkpoint preparation does not deploy, merge, commit or push.
