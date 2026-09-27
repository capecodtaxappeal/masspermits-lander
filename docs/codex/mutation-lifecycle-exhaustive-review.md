# S7 exhaustive lifecycle and gate review

This records the preserved first exhaustive **operator-candidate** review and the final single whole-catalog measurement, not every possible program change. The historical review added tests of real exported helpers and the real pre-send endpoint. Production source, workflows, mission tests and service state were not changed. No live request or delivery was attempted.

## Preserved evidence and source identity

`docs/codex/evidence/S7-first-exhaustive.json` has SHA-256 `735942c25a1b6420d1fbf2a43a2f437eaeebc82c0190666216a4e092a455a21b`. Its recorded `at` is `2026-09-27T06:00:38.555Z`; that report field is not asserted to be the completion time. The source hashes in the report matched the files read for this review:

| Source | SHA-256 | Candidates | Killed | Survived | Other |
| --- | --- | ---: | ---: | ---: | --- |
| `functions/api/_lifecycle.js` | `79c93ed2929056a18ffa1bb4910823b676e58c2bf5f0e9dc659b37c36c6c6714` | 379 | 195 | 181 | 2 timeouts, 1 unclassified error |
| `functions/api/_presend.js` | `e865bf885b57bd07967ccc920f914ed5d1e42321538d8ea2e65b3178fe321f0d` | 249 | 236 | 12 | 1 invalid syntax |
| `functions/api/pre-send-check.js` | `3dfaaf350d8662455049483e18ea83d6814123a098d730d56e83195fdf37acdb` | 32 | 23 | 9 | none |

These are the original results, before the tests below. Failing TODOs never count as kills. Unresolved outcomes are not equivalent mutants and are not credited as kills. In the full first exhaustive report, the unresolved total is **three unclassified errors and two timeouts**, rather than five unclassified errors.

## Meaningful lifecycle gaps addressed

The original lifecycle survivors were concentrated in event/recipient aggregation and presentation rather than the already-tested classifier's main state choices. This is a static grouping of all 181 survivor locations; it is not a post-test survival count.

| Source region | Original survivors | Added evidence |
| --- | ---: | --- |
| Thresholds and day conversion, lines 1-119 | 5 | Two-cycle warm-up, two-minute scanner boundary, exact day thresholds, 400-day retention and 200-record cap |
| Classifier, lines 120-219 | 1 | `never_sent` requires at least one due cycle |
| Input/event aggregation, lines 220-294 | 15 | Valid versus absent history, scanner timing, denial/missing-file attribution and strict recent counts |
| Delivery/previous joins, lines 295-335 | 32 | Case-insensitive recipient join; accepted outcome dominates failed/skipped results; completed cycles 1-4; unrelated, missing and null records |
| Row facts, lines 336-422 | 34 | Dedupe, observation dates, explicit missing values, D2 active semantics, billing metadata, transition counts and date-derived boundaries |
| Fleet/counts/alerts, lines 423-485 | 27 | Quiet positive control; isolated actionable conditions; fleet boundary; transition and referral signals |
| Digest, lines 486-549 | 34 | Escaped identity, dated facts/flags, fallback identity, quiet/empty sections, action counts and unchanged inputs |
| Aggregate read/lookup, lines 550-585 | 15 | Valid round-trip; malformed/missing/read-failed input; matching prefix and null-slot handling |
| Storage/retention, lines 586-649 | 18 | Explicit clock and monotonic instrumentation floor; save failure; bounded deletion, partial failure, retention boundary and awaited acknowledgements |

The 36 new cases are in `test/revenue/lifecycle-mutation.test.mjs`. Useful entry points are lines 45-98 (classification/delivery), 106-184 (events, dates and rows), 193-211 (fleet/alerts), 219-263 (digest/read/lookup), and 271-342 (storage).

Several controls deliberately refute easy false-positive tests:

- A healthy, fully covered synthetic subscriber is quiet. One accepted recipient result preserves that cycle despite later failed or skipped records. These controls do not say an acceptance proves human receipt.
- Recent requests from a cancelled row remain a distinct signal; they are not counted as successful downloads. The approved missing-`active` behavior is preserved. No trial, identity, billing or notification policy is added.
- Unknown logs do not fabricate known delivery history. Null slots and wrong types are robustness cases, not asserted current production incidents.
- An isolated saved-state failure reports `stored: false` and preserves the previous object. That case has **no stale events**: it does not endorse C20's deletion-after-failed-save behavior. Existing C20 tests remain executed TODOs outside mutation kills.
- Deferred, eventually successful `put` and `delete` fixtures prove that a completed-storage response awaits acknowledgement. They do not force an ambiguous request to be retried or simulate a service call. A failed second deletion batch reports only the first completed batch.
- Existing `failure-injection.test.mjs:223-255` already covers 1,005 events across two pages and second-page failure without partial publication. That mapped suite remains part of lifecycle coverage; the new file does not duplicate it.

These are contracts of the current helper, not approval to send its owner digest or act automatically on its advice. A request marker cannot distinguish a human, operator, link scanner or attachment-only reader. The module's scanner heuristic is tested at its configured boundary; it is not validated as a human-detection algorithm.

## Gate survivors

Eight complementary cases at `test/revenue/gate-mutation.test.mjs:268-344` address the normal-path or evidence gaps among the 21 gate survivors:

| Source | Original IDs | Contract |
| --- | --- | --- |
| `_presend.js:138-139` | `c828cd751026c382`, `695fd8769cd3df10`, `76d00b13039b4a85` | Retain the first accepted result, otherwise first explicit skip, within an already ordered retained log |
| `_presend.js:158` | `00f7c7265d4fc207` | Prefer raw `etag`; preserve the explicit `httpEtag` fallback |
| `_presend.js:250` | `53e81aa833ea0041`, `488483c1a8c0d7ae` | Unknown age stays null; a known zero age stays numeric |
| `_presend.js:263-264` | `86f6b34f1213a746`, `4aa00ef33152491b`, `411830ba883808ca` | Monthly warning after eight days, truthful day count, no blocking of a healthy weekly |
| `_presend.js:345` | `852e000a24b75b8e` | Report the actual configured percentage in a size-band failure |
| `_presend.js:387` | `793b563aacdc9e3f` | A null-slot robustness case must not erase a genuine accepted duplicate entry |
| `_presend.js:443` | `baeaa73f845020f2` | Retain a useful nonempty clean explanation |
| `pre-send-check.js:40` | `f0bae1f1ab38c0d4` | Missing authentication returns 401 before storage or mail activity |

The percentage and wording checks protect useful diagnosis; their risk is lower than a verdict or recipient-selection failure. The fallback metadata test exercises a supported helper branch, not an allegation that normal R2 metadata omits `etag`. The selected-entry gate summary still is not a reconciliation or union of coverage for every recipient.

The other eight endpoint survivors keep their explicit limitations:

- `pre-send-check.js:62-64`: `51672fa5d62538ba`, `8d7aade497c7e991`, `a39dcc14a8ed6d5c`, `99d60845e75e8ae3`, `5cde9efd0fab017c`, `60a4292f192e86d6`, `407970bd41bca6a3` mutate a defensive gather-error response. Normal binding, body, JSON, metadata and digest faults are caught inside `_presend.js:145-162,193-202`. No global runtime sabotage or fabricated throwing JSON property is added solely to reach this catch. This is bounded normal-path reachability, not proof that unexpected runtime exceptions are impossible.
- `pre-send-check.js:92`: `63bcdd8c886b728a` changes the private JSON helper's default HTTP status. All current calls pass an explicit status. That change is equivalent for the current call graph; no production export is added to reach it.

The original invalid presend mutation `258c2701a00ac20e` removes part of a parenthesized unary expression at line 333 and fails syntax validation. It stays invalid, not killed.

## Historical lifecycle cautions and review priorities

At the first focused baseline, the remaining lifecycle candidates could not be blanket-labeled equivalent; a later mutation report was still needed to identify their actual outcome. In particular, action ranking in the owner digest (`_lifecycle.js:499-503`) was not comprehensively asserted by those cases. Adjacent priority changes can matter when multiple actionable rows occur together; numerical changes that preserve every reachable ordering may be equivalent, but that requires a case-specific argument. This was a lower-priority presentation gap, not evidence that a current customer action occurred. The closing result below supersedes the historical outcome counts.

Some narrow arithmetic/default candidates can be equivalent within the real domain: changing the zero fallback in `Math.max(parsed enrollment, instrumentation)` to one millisecond cannot change the result when the enforced instrumentation floor is in 2026. The first review also suggested that list limits of 1,000 and 1,001 might be capped identically because the original fake capped both. That suggestion is withdrawn: a later local workerd check confirmed rejection of numeric 1,001, and the corrected fake now rejects numeric limits outside the observed supported range (`test/harness/index.mjs:127-134`). The closing result records the resulting kill; this is binding-fidelity evidence, not a claimed live outage.

Original unresolved lifecycle IDs are `a13ae0c9c8e3b86c` (inverted cursor-loop condition, line 596), `b52ab5dcc0c196d2` (inverted retention-loop comparison, line 638), and `874a8dadc7e8abf4` (dropped save await, line 627). The first two timed out, and the last produced an unclassified error. None is a passing equivalence justification. The new successful-acknowledgement cases provide ordinary assertions relevant to the last mutation without making a failing TODO or unhandled rejection itself a kill.

The helper's current comments sometimes describe provider acceptance as delivery and fleet silence as corroborated failure. This review does not upgrade those comments to historic proof. A response can report incomplete storage or uncertain observation without establishing a missed customer email.

## Historical focused validation and reproducibility

Command: `node test/harness/run.mjs test/revenue/lifecycle-mutation.test.mjs test/revenue/gate-mutation.test.mjs`.

Result at `2026-09-27T06:22:26.334Z`, Node `v25.9.0`: **63 tests, 63 passes, zero failures, TODOs, skips or cancellations**. The new lifecycle file contributes 36; the gate file has 27, including its existing 19. `git diff --check` passed for the changed tests. This is a focused baseline result, not a full-suite or new mutation score.

- Lifecycle test SHA-256: `cd0812c551c4a6411532ec860e37d4bbea16f1f7a5b08ee1807fcac9ba69e303`.
- Gate test SHA-256: `0a460382557a6cea92bbc546351d2f7f20266cc058227b06db4328d638b68ebf`.
- Summary: `test/harness/.runtime/S7-lifecycle-gate-strengthening-summary.json`, SHA-256 `b0d93466ca99abe572e03fe00d3f30cb368f6517c5c3a2459c1526d3cbdbf7dc`.
- TAP: `test/harness/.runtime/S7-lifecycle-gate-strengthening.tap.txt`.

Both files use `loadHandlers()` and honor `REVENUE_SOURCE_ROOT`; ordinary tests use the real modules and the mutation runner uses its source copy. All examples are synthetic. Storage-only tests explicitly verify no mail/fetch activity. The parent started the survivor rerun after the files became stable; its later report owns any new kill count. The preserved first report is not overwritten or relabeled.

## Closing observed result

The authoritative closing measurement is [S7-final-exhaustive.json](evidence/S7-final-exhaustive.json), summarized in [S7-final-mutation.json](evidence/S7-final-mutation.json). It is one complete whole-catalog run against a single recorded source, test and harness hash set, started at `2026-09-27T07:10:34.227Z` and completed at `2026-09-27T07:21:46.565Z`. Lifecycle has **357 killed, 19 surviving and three unresolved timeouts across 379 valid candidates (94.2%)**. Presend remains **248/248 valid killed**, with one invalid-syntax candidate excluded; pre-send-check remains **24/32**, with eight survivors.

The newly confirmed lifecycle kill is `014fac5a0f3b2a1b`, the line 592 numeric list-limit mutation from 1,000 to 1,001. After the binding-fidelity correction, its recorded `killedBy` includes `S6 I30 engagement reads all 1005 metadata events across the R2 page boundary` and `S7 lifecycle storage respects a monotonic instrumentation floor and an explicit observation clock`, among the recorded assertions. The tests distinguish usable aggregate evidence from a rejected list operation; no new production behavior or live service call was introduced.

The earlier accumulated result is preserved as [S7-accumulated-before-fidelity.json](evidence/S7-accumulated-before-fidelity.json). Its 356/379 lifecycle result and the five additional kills following four root-added controls are historical, not the final measurement. No timeout or failing TODO is credited as a kill. Historical groupings above remain source explanations, not a claim that every original survivor still survives. [MUTATION_REPORT.md](MUTATION_REPORT.md) records the final limitations and reproduction method.
