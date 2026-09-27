# Final operations mutation survivor review

This review records the authoritative final single-run outcomes and preserves the earlier 39-survivor classification as history. The final sender/status scope has 36 survivors. This final documentation update changes no source, tests, workflows or findings status. A qualified equivalence argument is not an executed kill or a release approval.

## Reproducible evidence

- Authoritative final run: [S7-final-exhaustive.json](evidence/S7-final-exhaustive.json), started 2026-09-27T07:10:34.227Z and completed 2026-09-27T07:21:46.565Z; SHA-256 `e90a7df474dfe5c5648d4f20177bd36582840a3d28dd7206d0d18f3eaaafdce2`.
- Authoritative final summary: [S7-final-mutation.json](evidence/S7-final-mutation.json), generated 2026-09-27T07:22:15.332Z; SHA-256 `d9c92105187d999852ee2c3c42c38818b8ca3d8e14d51a21aae7cbe40b1516de`.
- Historical accumulated snapshot: [S7-accumulated-before-fidelity.json](evidence/S7-accumulated-before-fidelity.json), generated 2026-09-27T06:47:15.824Z; SHA-256 `33721197341580c3dce27fa3a483382243effef5ffb9ad9952c910881fb5b83c`. The following 39-row classification originated in that snapshot.
- Current weekly-send.js SHA-256: `f164d93d09eba3116ea7e014fd5ebd7063e6302533ddc92e6d4bfd7211e861ae`.
- Current send-status.js SHA-256: `1c24f5289ce6db99ffc41602316e5abecc51d2d6efb18f53cdc031d33e875a36`.
- Both source hashes were recomputed and match the final evidence. Line numbers below refer to those exact files. Operator positions were resolved against the candidate IDs where a source line contains several operators.
- The authoritative result is one complete run against its recorded source, test and harness hash set. It does not merge outcomes from different harness revisions. TODO assertions never kill, and unresolved errors/timeouts remain unresolved. The historical accumulated snapshot used latest observed results. The later local parity work is described separately below; this final review update executed no tests or source.

## Historical accumulated totals before fidelity correction

| File | Candidates | Killed | Survived | Invalid | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| functions/api/weekly-send.js | 123 | 109 | 14 | 0 | 0 |
| functions/api/send-status.js | 161 | 133 | 25 | 3 | 0 |
| Combined | 284 | 242 | 39 | 3 | 0 |

Existing controls reviewed include [operations-mutation.test.mjs](../../test/revenue/operations-mutation.test.mjs) lines 54-123 and 207-401, [weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs) lines 127-175, 225-246 and 281-380, and [failure-injection.test.mjs](../../test/revenue/failure-injection.test.mjs) lines 177-215. The best-result and etag-selection definitions are [functions/api/_presend.js](../../functions/api/_presend.js) lines 122-142. These are local source/test assertions, not evidence of provider receipt or deployed service behavior.

## Historical weekly sender table: 14 survivors, unchanged in the final run

Each row separates an observable difference from its reason for remaining unasserted. Constrained equivalence always states its input/call-path limit.

| Mutant ID | Source line | Disposition | Reason and remaining boundary |
| --- | ---: | --- | --- |
| 337fe60c0d2973e6 | 55 | Constrained equivalence / date gap | Only the missing-or-falsy ran_at fallback changes from 0 to 1. Both numeric-string date fallbacks are stale at the contemporary Node test clock; valid ISO timestamps are unchanged. This is not date-parser equivalence for every runtime or historical clock. A deliberate malformed/missing timestamp contract is preferable to pinning coercion. |
| 7e215bba8195df81 | 59 | Diagnostic gap | The stale-refresh message changes its ran_at fallback selection. The blocking decision has already occurred and is unchanged. Useful missing/known-date wording is not asserted; exact arbitrary stored-value echo is also not a desirable privacy contract. |
| da35db56c009de6b | 63 | C19 overlap | The failed-refresh diagnostic chooses a different value instead of status.error or its fallback. HTTP 500, ok:false and the no-send gate remain. Unrestricted stored error text must not become a required response field merely to kill the mutant. |
| 9227e00bba2fdb79 | 79 | Policy | The explicit empty-roster no-op changes ok:true to false. weekly-watchdog lines 138-143 intentionally require the no-op note and no effects, not a fulfilled-customer claim. Define the machine outcome with consumers before choosing this bit; do not conflate a legitimate empty roster with all provider rejections. |
| bdf07804d058e27f | 97 | Constrained equivalence / fallback gap | The second OR becomes AND: file.etag OR (file.httpEtag AND empty string). A truthy primary etag bypasses the changed term, as in the R2 object fixtures. An httpEtag-only object would lose duplicate protection; that fallback path is unasserted. Do not claim equivalence for that alternate metadata shape. |
| c0ebca9431942b9a | 132 | Retention choice | Skip history retains 13 entries instead of 12. The passing history control checks new and prior outcomes, not an approved exact cap. One extra entry does not solve the existing C08 history-eviction TODO; more than 13 later entries can still discard accepted evidence. |
| 4e833c5f6e144e15 | 134 | Policy / C08 overlap | Duplicate-skip acknowledgement changes ok:true to false; the skip guard, zero sends and saved evidence remain. A distinct non-fulfillment outcome may be useful, but a previously delivered duplicate is not necessarily a failed obligation. Do not label this a complete C08 fix or require the current success-shaped acknowledgement solely for score. |
| 170edd761fd16ea6 | 172 | Retention choice | Successful-send history retains 13 rather than 12 entries. Operations tests retain three prior entries intact; the exact 12-entry cap is not the target reliability contract. The existing repeated-skip retention defect remains possible with either cap. |
| 4ce1081cc18f510f | 178 | C19 overlap | Changing the fallback operator removes ordinary recipient-domain diagnostics from failed_domains. Counts remain available. This is observably different and touches the still-open sender/status response-privacy scope; do not add an identity-echo assertion to kill it. |
| 1a6b7a35b5f4f754 | 180 | C19 overlap | The outer error response selects a different raw exception representation while retaining HTTP 500 and ok:false. Exact exception disclosure is an open privacy concern, not a string contract to freeze. |
| 4ff2711f735df088 | 180 | C19 overlap | The second outer-catch fallback operator changes the raw returned exception text. Failure status remains 500. This is observable privacy-sensitive diagnostic behavior, not equivalent output. |
| a3f507ab27c03dfe | 243 | Constrained equivalence | Provider body truncation grows from 160 to 161. sendEmail has one caller in this file; its caught error is truncated again to 120 characters at line 157 before storage. The newly retained character cannot survive that smaller outer cap. This does not approve the existing diagnostic privacy. |
| 10f31364acc5dbb5 | 273 | Constrained equivalence | The file guard becomes OR. Both call sites follow the missing-object return at line 88 and use an R2 object with numeric size, so both copy the same byte count. Malformed metadata outside that object contract could differ; this is not unrestricted Boolean equivalence. |
| 04df7092c61ce386 | 287 | Constrained equivalence | Base64 chunk size becomes 32769 instead of 32768. Each byte remains included once, in order, with the same final btoa input. This holds where both spread-call sizes are supported; the offline result does not certify a Worker argument-limit boundary. |

## Historical watchdog table: 25 survivors before the final run

This table deliberately preserves the earlier classification. IDs 10ad73d556d11a8d, 93a1b50c262bde6d and 79fe03a4fcc9484d are now killed in the final single run; only the other 22 rows remain surviving. See the exact outcome table below.

| Mutant ID | Source line | Disposition | Reason and remaining boundary |
| --- | ---: | --- | --- |
| 41041d0fef9ea391 | 56 | Low-priority rounding | The hours helper divisor grows from 3600000 to 3600001. Its outputs are used only for attempt/log age text, not due/grace comparisons or retry eligibility. Rounding can differ near a display boundary; this is not globally equivalent text. |
| 4a3240bee05d2dd3 | 60 | Constrained equivalence / schema gap | For nonempty array logs both expressions select log[0]; for empty arrays null versus undefined is subsequently treated as absent. A non-array object with length and a numeric entry can differ. bestSince rejects non-arrays, but newest does not fully validate them after mutation; malformed-log diagnostics remain outside this equivalence. |
| 975ce8dac3662448 | 125 | C08-adjacent coverage gap | The sentSinceDue predicate treats any non-null sent record as successful. An all-rejected entry is then classified partial instead of unknown/missed or the skipped branch; retry semantics can also differ when no durable attempt exists. A non-healthy diagnosis may be preferable, but the predicate still falsely represents acceptance. This survives because an all-rejected watchdog contract is missing; the sender C08 TODO alone cannot establish correctness. |
| 5a2d805732b5d7bd | 138 | Low-priority formatting | The successful-delivery age text uses two decimals rather than one. The chosen result and accepted-recipient count do not change; exact human precision is not the target contract. |
| c02143e27ef1e258 | 138 | Constrained equivalence | The successful-detail filter changes s AND s.ok to OR. This branch requires sentSinceDue and zero failed rows. Every well-formed sent record therefore already has truthy ok, so both counts match. Null sent entries fail earlier at line 73; malformed log handling is not certified by this argument. |
| a9c581a6e0cb3db6 | 140 | C08-adjacent coverage gap | The partial branch condition changes AND to OR. Earlier clean-success handling already consumes success/no-failure; the new difference is an entry with failed rows but no successes, including conflicting skipped-plus-failed evidence. The mutant calls this partial rather than the original later branch. Define and test all-rejected/malformed outcomes, not a score-driven endorsement of either label. |
| b7e6b6f11dfcac0d | 154 | Low-priority formatting | Unknown-attempt detail retains two decimal places instead of one. The readable-duration control explicitly accepts sensible nearby precision; verdict, attempt eligibility and retry_safe are unchanged. Exact precision is not a chosen reliability requirement. |
| 27a0bc80034e3780 | 192 | Constrained equivalence | The roster-gap detail counts all non-null records after the filter change. This branch can only follow verdict ok, which required no failed rows, and a non-alerting portal; all well-formed records already have truthy ok. Its accepted count is unchanged under that branch condition. |
| 0065733b44d1aff2 | 212 | C19 overlap | The inner failed-destination AND becomes OR, selecting the object representation rather than its destination. Exact identity/domain disclosure is deliberately not pinned as a required diagnostic. |
| cd16729f29a1fb8a | 212 | C19 overlap | The failed-recipient domain fallback becomes an empty-domain result for an ordinary populated destination. It changes identity echo while retaining failed-row count; the broader counts-only response work is still open. |
| 3e16a180e7d9b18e | 213 | C19 overlap | The failed-error fallback turns an ordinary error into an empty string. It may reduce disclosure but also discards diagnostic context; neither a complete privacy fix nor equivalent behavior is established. |
| f4194c18e2215db4 | 213 | C19 overlap | A failed-recipient error expression selects the record rather than its error string. The response changes, but preserving raw error or recipient content is not the desired privacy boundary; counts and verdict need their own assertions. |
| 8e2390c4c83c7d72 | 243 | Constrained equivalence | 15 times 60000 becomes 15 times 60001, so the comparison threshold is 15.00025 minutes instead of 15. Drift was rounded to an integer at line 265; the first alerting integer is still 16. Both null handling and the stale-first branch are unchanged. |
| 93a1b50c262bde6d | 263 | Coverage gap | The ZIP metadata AND becomes OR. With no ZIP head it dereferences null and falls into unknown/alert:false, instead of preserving the HTML age and a null drift. It can hide a stale HTML alert. With a truthy well-formed head it computes the same timestamp. Missing-ZIP watchdog coverage remains needed. |
| 6333a45995e6110a | 268 | Low-priority precision | Structured portal age_hours gains a second decimal place. This is observable numeric precision, but the staleness decision uses raw milliseconds rather than age_hours. More precise output is not made a failure solely for score. |
| c30290764d0d4e93 | 293 | Low-priority formatting | The healthy portal detail uses two decimal places for age rather than one. State, drift, publication time and stale threshold do not change. |
| 7938665ac7281239 | 300 | Policy / coverage gap | Unknown portal-check failures start alerting and can promote an otherwise ok/not_due verdict to portal_unknown. The source explicitly chooses non-alerting unknown at lines 297-300, but no required error-state policy is tested. This may improve visibility; it is not proof of a fixed C20 inbox finding or global equivalence. |
| 2480705950d2ac59 | 301 | C19 overlap | Portal catch fallback changes which raw exception value is echoed. Unknown state remains; this diagnostic privacy issue is not repaired by preserving either raw representation. |
| 345f6756f12e5313 | 301 | C19 overlap | Portal catch detail drops its first raw error character. State and alert policy remain unchanged. The sensitive diagnostic itself remains an open response-privacy boundary. |
| d28ca827b895ca10 | 301 | C19 overlap | Portal raw error truncation grows from 200 to 201 characters. There is no later response cap that makes this equivalent. Do not preserve sensitive diagnostic length as a required product contract. |
| f3d69858ba68124a | 301 | C19 overlap | Portal catch message selection changes the raw exception representation. The missing privacy contract should not be replaced with an assertion preserving the original exception. |
| 62589c686534f048 | 320 | Constrained equivalence | The same loop starts i at 1 instead of 0, allowing nine rather than ten iterations. The valid lastDueAt caller needs at most eight dates, so the enumerated prefixes are unchanged. This does not claim equivalence for arbitrary external dueAt inputs. |
| d1cfe52193959930 | 320 | Constrained equivalence | The portal-day loop cap grows from 10 to 11. Its only caller uses the most recent Monday 12:00 UTC at or before now; starting that Monday at midnight requires at most eight calendar-day iterations before the next due time rolls forward. Neither cap is reached for a valid caller clock. |
| 79fe03a4fcc9484d | 322 | R2 mock fidelity gap | The list limit becomes 1001. The final evidence reviewed above used a MemoryR2 that clamped requests to 1000, masking this mutation. The subsequent local workerd probe below rejects 1001 and proves that mismatch; the corrected fake and parity contracts now match that boundary. A fresh full-catalog result must establish its new outcome. Production pagination remains absent here; no pagination fix is claimed. |
| 10ad73d556d11a8d | 342 | Coverage gap | Dropping await from headSafe moves asynchronous head rejection past its local catch into portalHealth catch. An HTML failure changes not_shipped to unknown; a ZIP failure can suppress an independently stale HTML alert by returning unknown/alert:false. Add an asynchronous HEAD-failure contract when this frozen scope is reopened; existing list-failure tests do not cover it. |

## Follow-up boundaries

The historical asynchronous-HEAD and missing-ZIP test gaps were subsequently addressed by three additive contracts, and their two mutants are killed in the final run. This strengthens tests without changing production behavior. Remaining work includes defining complete, partial, rejected, skipped, empty-roster and unavailable-evidence outcomes together with their consumers. The current C08 sender TODO and C10 evidence-read TODOs remain open; changing a status bit or label is not a repair of recipient accounting, duplicate protection or retry safety.

The R2 limit issue was an explicit mock-fidelity gap in the reviewed snapshot. A later authorized local binding probe and focused correction are recorded below. No live account request or official-platform-contract certification occurred. The separate absence of pagination in countOpens is source evidence, not an incident established by this mutant.

Sender/status response privacy remains within the frozen C19 scope. The separate webhook/mail-owner patch does not change these files. Do not kill privacy-overlap mutants by requiring recipient domains, raw stored errors or raw exceptions to remain in machine responses. Exact history depth and human decimal precision are lower-priority choices; preserving useful evidence and truthful state matters more than snapshotting those constants.

No explanatory disposition by itself reclassifies a survivor as killed. The final section records actual observed kills from the new run; no TODO is waived and no production defect is declared closed. The three invalid send-status candidates remain excluded from valid-mutation scoring, not counted as successful tests. No customer data or real identities were read or included.


## Local R2 list-limit fidelity follow-up

The authorized local-only probe used Miniflare 4.20260730.0, workerd 1.20260730.1, compatibility date 2026-07-01, two synthetic objects, nonpersistent R2, an allowlisted child environment and an outboundService that rejects all external transport. External attempts were zero. [Tracked probe](evidence/S7-r2-list-limit-probe.json) records the observed behavior before changing the fake.

The binding accepted omitted limit and 1000; rejected 1001, 0, -2, 0.5 and 2000; accepted -1 and -1.5 with both objects returned; accepted 1.5 with one returned; and accepted 1000.5 with both returned. The finite numeric behavior observed here is truncation with a -1 default sentinel followed by the 1-1000 range boundary. These observations do not establish all string, object, nonfinite, integer-overflow or production-service coercions.

The existing MemoryR2 path now matches those finite numeric cases instead of clamping invalid supplied numbers. Omitted/default behavior is preserved. Untested nonnumeric/nonfinite behavior remains on the prior path; it is not newly certified. Eleven side-by-side contracts in [harness-contracts.test.mjs](../../test/revenue/harness-contracts.test.mjs) first establish the actual local binding result, then compare MemoryR2. Their shared cleanup asserts zero external attempts.

[Before summary](evidence/S7-r2-list-parity-before.json): 20 tests, 13 pass, seven fail, zero TODO/skip; exit 1. Failures were the fake's observed invalid-range/default-sentinel mismatches. [After summary](evidence/S7-r2-list-parity-after.json): the same 20 tests all pass, zero fail/TODO/skip; exit 0. No production source changed. The root subsequently completed the entire mutation-catalog rerun against this final harness. Its outcomes are recorded below; the earlier accumulated snapshot remains a separately named historical artifact.


## Authoritative final single-run outcomes

The recorded final run, not a recalculated score or a merger of old and new results, reports:

| File | Selected | Valid | Killed | Survived | Invalid | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| functions/api/weekly-send.js | 123 | 123 | 109 | 14 | 0 | 0 |
| functions/api/send-status.js | 161 | 158 | 136 | 22 | 3 | 0 |
| Combined operations scope | 284 | 281 | 245 | 36 | 3 | 0 |

Comparing every candidate ID in the archived accumulated snapshot with the final summary yields exactly four changed outcomes across the full catalog, all survived to killed:

| Mutant ID | File and source line | Final observed outcome | Relevant strengthening |
| --- | --- | --- | --- |
| 10ad73d556d11a8d | functions/api/send-status.js:342 | killed | Additive asynchronous HEAD rejection contracts preserve the independent HTML staleness/fallback diagnosis. |
| 93a1b50c262bde6d | functions/api/send-status.js:263 | killed | Missing/rejected ZIP metadata contracts preserve a stale HTML alert instead of falling into unknown. |
| 79fe03a4fcc9484d | functions/api/send-status.js:322 | killed | Corrected MemoryR2 list-limit fidelity rejects the mutated 1001 request. |
| 014fac5a0f3b2a1b | functions/api/_lifecycle.js:592 | killed | The same list-limit fidelity correction; supplemental lifecycle outcome, outside the sender/status tables above. |

The three additive operations contracts begin at operations-mutation.test.mjs lines 403, 418 and 441: independently stale HTML with missing ZIP metadata; independently stale HTML with asynchronously rejected ZIP metadata; and asynchronously rejected HTML metadata retaining the current fallback semantics. Their existence alone was not counted as a kill; the final run provides the observed outcomes.

All other candidate outcomes are unchanged from the accumulated archive. The remaining 14 sender and 22 watchdog survivors retain their individual historical dispositions above. Unknown-portal alert policy, all-rejected watchdog semantics, diagnostic privacy, history depth, formatting and the stated constrained-equivalence limits remain as documented. There are no unresolved sender/status candidates, but that does not remove unresolved outcomes elsewhere in the full catalog. No live service behavior, receipt guarantee, production fix or complete platform certification is inferred.
