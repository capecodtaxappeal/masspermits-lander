# Exhaustive access mutation review

This is an independent source-and-test review of all valid surviving access mutations from the completed S7 run. No production module was edited. Initial observations were read-only while that run was active. After completion and explicit authorization, 13 passing real-handler/helper contracts were added to [access-mutation.test.mjs](../../test/revenue/access-mutation.test.mjs); all original 25 cases remain.

## Evidence boundary

- Source baseline: ba5eee54f027c09c99e4d84461ec09b711d923a7. The six source hashes are recorded in [the initial access review](mutation-access-review.md) and match this run.
- Historical first-run artifact: [S7-first-exhaustive.json](evidence/S7-first-exhaustive.json), the tracked sanitized snapshot. The mutable .runtime file is not the durable evidence reference.
- Run started 2026-09-27T06:00:38.555Z; completed 2026-09-27T06:13:54.503Z. Seed S7-v1, limit 2000, jobs 3.
- Tracked sanitized first-run SHA-256: `735942c25a1b6420d1fbf2a43a2f437eaeebc82c0190666216a4e092a455a21b`. The earlier recorded raw runtime hash was `f348fc12f8d5106145d8f823d45334020ba3d729157988a34971e7b5c5aa4957`; it identifies different bytes and is retained only as historical provenance, not the tracked snapshot hash.
- Global raw outcome: 1,822 candidates; 1,308 killed, 501 survived, eight invalid, three unclassified errors and two timeouts. This note classifies only the six access files below.
- Access outcome before the 13 added contracts: 441 candidates, 370 killed, 68 survived, three invalid, zero unresolved. No access candidate is excluded as a timeout or unclassified error.
- Focused validation after the additions: 2026-09-27T06:18:01.745Z, Node v25.9.0, node test/harness/run.mjs test/revenue/access-mutation.test.mjs; 38 tests, 38 pass, zero fail/TODO/skip/cancelled, exit 0.
- No survivor rerun or full-suite execution was performed by this reviewer. The root owns the subsequent mutation rerun. A new passing contract does not itself establish a mutant kill.

| File | Candidates | Killed | Survived | Invalid | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| functions/api/my-leads.js | 56 | 56 | 0 | 0 | 0 |
| functions/leads.js | 182 | 141 | 41 | 0 | 0 |
| functions/api/upload-bundle.js | 35 | 30 | 4 | 1 | 0 |
| functions/api/get-object.js | 12 | 12 | 0 | 0 | 0 |
| functions/api/_github-oidc.js | 66 | 57 | 8 | 1 | 0 |
| functions/api/_cf-access.js | 90 | 74 | 15 | 1 | 0 |

The most important gaps were missing false-authorization assertions for malformed/configuration branches, the real portal HEAD entry point, asynchronous metadata failures, partial freshness disclosures and inactive aggregate previews. These are test gaps demonstrated by mutated code, not claims that the unmodified implementation currently authorizes malformed requests.

## New executable contracts

| Reference | Exact top-level test name |
| --- | --- |
| T26 | S7 exhaustive I25 malformed GitHub JWT encodings reject before any storage or fetch |
| T27 | S7 exhaustive I25 missing and malformed Access assertions have false authorization |
| T28 | S7 exhaustive I25 each missing Access configuration value fails before certificate lookup |
| T29 | S7 exhaustive I25 Access common-name identity survives a valid token without email |
| T30 | S7 exhaustive I25 Access missing-assertion remedy is distinct from ordinary sign-in rejection |
| T31 | S7 exhaustive I19 I25 real portal HEAD retains GET access status and private headers with no body |
| T32 | S7 exhaustive I20 portal handles asynchronous metadata lookup rejection as a controlled response |
| T33 | S7 exhaustive I20 missing ZIP metadata cannot turn a fresh portal request into an exception |
| T34 | S7 exhaustive I21 incomplete refresh metadata discloses the remaining timestamp basis |
| T35 | S7 exhaustive I19 inactive previews retain only available numeric aggregate counts |
| T36 | S7 exhaustive I21 degraded coverage tolerates absent empty and non-list monthly metadata |
| T37 | S7 exhaustive I21 non-finite JSON coverage numbers use the unavailable-count wording |
| T38 | S7 exhaustive I19 portal country telemetry stays coarse even with malformed metadata |

The HEAD namespace is imported only after loadHandlers validates the source root; its GET export must equal h.portal, so the test follows the same real or mutated module. Its response status, private headers, empty body and lack of customer-open telemetry are checked. Underlying transformed-stream cancellation remains a separate unasserted resource-lifetime distinction.

The missing-ZIP and asynchronous-HEAD cases require a controlled private response and do not choose stale-ZIP fallback policy. The incomplete-refresh cases identify the available timestamp basis and inspect the badge element rather than finding a publication date elsewhere. Preview tests assert only available numeric aggregates, not the claim that the corpus consists of permits from the current week. Malformed country metadata and an out-of-range JSON number are explicitly defensive synthetic fixtures, not observations of live Cloudflare/R2 values.

## Historical first-run survivor classifications

Classification: G = meaningful uncovered behavioral contract; P = existing finding/policy or an observable low-impact choice deliberately not pinned for score; E = no observable change under the stated call graph or operating domain. None is labelled wholly unreachable without a proof. Equivalent mutations stay in the raw denominator; this review does not recalculate a flattering score.

There are 36 G, 24 P and 8 E classifications. The new cases target 32 of the 68 initial valid survivors. Remaining G entries are retained as gaps, not excused as policy.

### functions/leads.js

| Mutant ID | Line | Class | Source-supported distinction and disposition | New contract |
| --- | ---: | --- | --- | --- |
| 786fb204917e8ff5 | 93 | P | false to true clears an existing cookie on a denied query-token link. Access stays denied. This query-link cookie UX choice is not pinned for score. | None |
| febfe352335fa143 | 418 | G | Inverts whether the available live-source count appears in the inactive preview. | T35 |
| 774c1bbefeb67a83 | 195 | G | OR to AND omits the freshness caveat when exactly one timestamp is unavailable. | T34 |
| 348b3b9dc7306f55 | 559 | G | Dropping await bypasses the local catch when an asynchronous R2 HEAD rejects, turning metadata failure into an escaped exception. | T32 |
| 68b7cbb1a795bfb9 | 418 | G | Negates the inactive preview's live-count branch; numeric source counts disappear or null appears. | T35 |
| de7380c31641890e | 415 | G | OR to AND hides an inactive preview when only one of its aggregate counts is available. | T35 |
| a0db0df669cc11a5 | 583 | P | The warn comparison changes default accent color for ordinary pages. It is observable, although no caller selects warn; exact decorative color is not made a test contract. | None |
| 68dc2a9bea78f539 | 408 | G | Dropping the status read's await removes inactive-page aggregate values. | T35 |
| 75163d1ad4ce45ba | 76 | P | Changes query-token selection while the portal is paused. C16 leaves pause/download fallback policy open; do not bless its redirect path merely to kill this. | None |
| c7f6c66a77e612d1 | 566 | G | Dividing by 61 instead of 60 can understate the rounded hour gap, for example 150 minutes becomes 2 rather than 3 hours. Existing 180-minute control misses this. Low-priority display-accuracy gap remains. | None |
| e4e8b44b738f7e58 | 130 | G | HEAD uses an unresolved GET promise, losing the real response status/private headers. The new case invokes the exported HEAD handler, including denial, redirect and completed page paths. | T31 |
| 6f7cfaa05932034a | 220 | G | The first monthly-metadata AND becomes OR, bypassing array validation or dereferencing absent coverage in a degraded status. | T36 |
| 32b553f2545b8cd7 | 240 | G | Swaps amber and grey banner classes even when a caveat exists. Text assertions do not verify the visual warning distinction. A visual warning contract remains unasserted; no exact CSS snapshot was added. | None |
| cf5badf741d2162e | 583 | P | Negates the warn branch and changes default decorative accent color. This is not unreachable or globally equivalent, but exact color selection is unchosen. | None |
| 4300674c361721c2 | 583 | P | Inverts the bad-tone color comparison; the stale warning text still appears. Exact accent-color policy is not pinned as a security assertion. | None |
| 05c312bb35382910 | 566 | P | At exactly 120 minutes, 2 hours becomes 120 minutes. The duration is unchanged; the exact unit-switch boundary is a formatting choice. | None |
| 138af37a1ee0e93d | 283 | G | Swaps the freshness badge's warning and neutral colors. A visible warning-state check is a remaining low-priority UI coverage gap, not proof of incorrect data. | None |
| 5a9361fd3c1abc83 | 497 | P | Generic GET redirects use 303 instead of 302. Status is observably different while the destination is preserved. Do not freeze this redirect-status choice, especially on unresolved C16 fallback paths. | None |
| 26cb2271dfdf331f | 207 | G | AND to OR dereferences status.coverage when the status record is null, causing an exception instead of the missing-record disclosure. | T34 |
| b5d48706d1a5eac7 | 565 | P | Divisor 60000 to 60001 changes minute rounding only around half-minute boundaries. The chosen tests verify useful drift values, not exact half-minute rounding boundaries. | None |
| 383516fa3c0ab1f9 | 113 | P | Inverts whether an invalid or absent cookie receives a deletion header. Access remains denied. Cookie cleanup UX is observable but is not chosen solely for score. | None |
| 716572b27d006694 | 415 | G | Inverts the live-count presence check in the preview headline condition; partial and empty aggregate inputs diverge. | T35 |
| e33584941ac3c06b | 455 | G | Country metadata's two-character cap becomes three. The normal two-letter fixture cannot distinguish it; the new defensive malformed-metadata case verifies coarse bounded telemetry. | T38 |
| 07a4420c7ae80665 | 413 | G | Inverts the numeric live-count type check, dropping numbers and admitting nonnumeric preview values. | T35 |
| a65ade30d7d80d87 | 160 | G | AND to OR dereferences ran_at on a null status record. Missing status must not create a runtime exception. | T34 |
| 8daea91498222358 | 197 | G | The one-missing-timestamp explanation points to the wrong unavailable record. | T34 |
| f2ffd7f8ac30806f | 58 | P | Changes the eight-day limit by 8 ms. Stale-day handling is tested, but an exact millisecond cutoff is not elevated into a release requirement for score. | None |
| 90c63535d8eff805 | 280 | G | The actual freshness badge claims an unknown publication date despite valid metadata. Earlier assertions found the date elsewhere in the page; the new case checks the badge element itself. | T34 |
| 76416c9e3dcc47f6 | 417 | G | Negates the row-count preview branch, dropping a valid count or dereferencing null. | T35 |
| 67ab909feec8376a | 415 | G | Negates the aggregate headline condition; present and empty preview cases are reversed. | T35 |
| 0f04f4656759a70e | 490 | E | i < 0 becomes i < 1. The extra skipped case has an empty cookie name (equals sign at index zero), which cannot match mp_sess in the original loop either. Both continue without an effect. | None |
| 6ed356daffb60208 | 220 | G | The outer monthly-metadata AND becomes OR, rendering an empty monthly note or evaluating absent/non-list values unsafely. | T36 |
| b71c7485bf7848b9 | 162 | G | AND to OR dereferences uploaded on null ZIP metadata. The new case requires a controlled private response without approving a missing-file availability policy. | T33 |
| cf5f7a86c57c1d99 | 234 | E | Only changes the grey banner's fallback refreshed string. If ran_at is invalid, the missing-record note makes notes nonempty and grey is discarded; if both dates are invalid, the earlier red response returns; if ran_at is valid, this nested branch is unused. No changed value reaches the response. | None |
| 3c533855e47edb1d | 131 | G | HEAD no longer cancels an existing GET body. New HEAD status/body tests do not observe disposal of the underlying transformed stream. A resource-lifetime test remains; no equivalent claim is made. | None |
| 047a58d3bc23399f | 417 | G | Inverts the row-count null comparison in the inactive preview. | T35 |
| be79fc72939b8ade | 415 | G | Inverts row-count presence in the preview headline condition; partial counts expose the difference. | T35 |
| ee304d52650f0d44 | 570 | G | AND to OR allows nonfinite numeric coverage values to render. Valid JSON with an out-of-range exponent parses to Infinity, so the fixture uses raw synthetic JSON rather than JSON.stringify. | T37 |
| 2626a0d6b1e61e80 | 76 | P | Changes cookie-token selection while the portal is paused. It shares the unresolved C16 fallback boundary; neither direct ZIP access nor denial is newly selected here. | None |
| 72bc6ed331c2dbad | 197 | G | Inverts which missing timestamp the freshness explanation identifies. | T34 |
| aa73a5dbcc70fd10 | 583 | P | Negates the bad-tone color branch. It changes visible styling, but exact page-accent color is not an approved authorization/data contract. | None |

### functions/api/upload-bundle.js

| Mutant ID | Line | Class | Source-supported distinction and disposition | New contract |
| --- | ---: | --- | --- | --- |
| 90577cedb63168d2 | 71 | P | Drops the first character of a raw storage exception. C19 requires privacy work; do not canonize this raw diagnostic response. | None |
| af20b6b87b21ba01 | 71 | P | Changes raw error-message fallback selection. Failure still returns 500 and ok:false; exact provider/internal text is deliberately unpinned. | None |
| 7eea0b19781da33c | 71 | P | Raw exception truncation grows from 200 to 201 characters. The privacy finding is not solved by preserving either limit. | None |
| 00172b96184f105a | 71 | P | Changes the exception message-versus-object choice while retaining failure status. This is a raw-diagnostic privacy boundary, not equivalent text. | None |

### functions/api/_github-oidc.js

| Mutant ID | Line | Class | Source-supported distinction and disposition | New contract |
| --- | ---: | --- | --- | --- |
| 8795a6e6191bb084 | 50 | P | Changes the first retained character of raw verification diagnostics; fail-closed authorization is checked, raw error wording is not pinned. | None |
| 067e2557721da616 | 62 | E | Resetting cache time to 1 instead of 0 forces the same refresh at contemporary operating timestamps. This is qualified operating-time equivalence, not mathematical equivalence near the Unix epoch. | None |
| e4d76b87790e3040 | 50 | P | Changes raw exception fallback text. No authorization outcome changes; C19-style diagnostic privacy remains separate. | None |
| 3b2fed4f2bf08920 | 66 | E | Marks an imported public verification key extractable. This helper never exports or returns the CryptoKey, only verifies with it; raw public JWK bytes were already obtained. No observable verifier API change in this call graph. | None |
| f7a6b2619a9f2e42 | 50 | P | Raw verification diagnostics retain 81 rather than 80 characters. Do not make sensitive exception truncation a required product contract. | None |
| c6edeb091a8753b2 | 30 | G | bad-encoding incorrectly returns ok:true. Existing malformed fixtures did not exercise invalid JSON inside a three-part JWT; new verifier and real reader-route assertions require denial and no effects. | T26 |
| 72b9d256cc3e277e | 15 | E | Initial cache time 0 becomes 1 while keys remains null. Every first attempt must fetch due to !cache.keys; success replaces the timestamp, failure leaves keys null. Initial timestamp has no observable effect. | None |
| 8b714fbc2d1e4fcf | 50 | P | Changes the raw verification-error fallback expression. Exact exception wording is not pinned. | None |

### functions/api/_cf-access.js

| Mutant ID | Line | Class | Source-supported distinction and disposition | New contract |
| --- | ---: | --- | --- | --- |
| 32acce9b957a559e | 89 | P | Changes raw exception fallback text while retaining false authorization. No diagnostic-string snapshot was added. | None |
| c5231e00b786e537 | 57 | G | No assertion returns ok:true. The prior test checked only reason. The new cases assert false authorization and no certificate/storage/mail effects. | T27 |
| ca14b95bbb806afc | 106 | E | Public CryptoKey extractability changes, but this private helper never exports or returns the key. Verification and public helper outputs are unchanged within the reviewed call graph. | None |
| b0319ed83ba23b8a | 89 | P | Raw verification diagnostic length increases from 80 to 81. Do not freeze a privacy issue as expected behavior. | None |
| 3a9da594268cfd1f | 43 | G | Missing configuration returns ok:true. Prior assertions checked the reason but not authorization; new cases check both and no effects. | T28 |
| b2f7001893e5de41 | 102 | E | Unknown-key reset time changes 0 to 1; both expire the cache at contemporary timestamps. The near-epoch qualification matches the GitHub reset case. | None |
| 095b4374a6e62427 | 60 | G | Malformed part count returns ok:true. New malformed-token cases assert denial before certificates or storage. | T27 |
| 3fa2b68e2b04b7d3 | 35 | E | Initial at:1 instead of at:0 is masked by keys:null until a fetch replaces the cache. No observable effect in this initialization flow. | None |
| 5fa80f2f79c07433 | 89 | P | Drops the first character of raw diagnostics. False authorization is the required behavior, not the internal exception text. | None |
| f66933dc86211c5a | 68 | G | Malformed JSON within a JWT returns ok:true. This was not covered by the signed-null outer-catch test; new malformed encodings require false authorization. | T27 |
| 0e2beb360221b901 | 121 | G | Missing-assertion advice and generic sign-in advice are swapped. The new authored-message test distinguishes the relevant remedies without pinning raw exceptions. | T30 |
| e9b52c141c46e2e0 | 42 | G | OR to AND fails to reject exactly one missing configuration field. The new table tests missing team, missing audience and both, including a token with empty audience. | T28 |
| 14d0f022ee0ee3fb | 121 | G | Inverts the same missing-assertion remedy comparison. It is a separate candidate with the same required user-facing distinction. | T30 |
| 39d20b159e3f7e35 | 87 | G | The common_name fallback becomes empty despite a valid token. This identity is used as signedInAs in the admin API, not as a new entitlement rule. | T29 |
| 7c3ee547d3dda296 | 89 | P | Changes the raw exception object/message choice. False authorization is tested; raw diagnostic wording remains unpinned. | None |

## Invalid and unresolved results

The three syntactically invalid candidates are upload-bundle c062d8e0b0dca946 at line 62, GitHub OIDC 8c95b2b06dbe3e3b at line 41, and Cloudflare Access ff8b90160d03b8e0 at line 76. They are not kills or meaningful survivor evidence. All are unary-not removals that produce an invalid transformed parse.

There are no valid unclassified-error, timeout or runner-error access candidates in this completed run. In particular, upload drop-await 8fb7699af2729c65 at line 68, previously an unclassified sample result, is now recorded as killed. This conclusion comes from the stable exhaustive output, not inference from the test name.

## Limits and next decision

The test fixtures use genuine locally signed RSA tokens, actual handler imports, synthetic rows and the closed offline harness. There is no service request, production write, scraper, workflow run or customer data access. The additional focused test run is the only execution performed during this review.

Retain the remaining resource-lifetime and visible-warning gaps for deliberate follow-up. Do not require raw error disclosures, choose C16 availability behavior, assert exact decorative color values or move time cutoffs by policy merely to inflate a mutation result. Cache/public-key equivalence arguments are bounded as stated in each row. Duplicate behavioral mutants remain individually listed and counted. The final-outcome section below records the root-owned post-strengthening evidence; TODOs are never counted as kills.


## Historical accumulated outcomes before the final fidelity rerun

The historical rows above retain their original pre-strengthening dispositions. The intermediate result is archived as [S7-accumulated-before-fidelity.json](evidence/S7-accumulated-before-fidelity.json), generated 2026-09-27T06:47:15.824Z, SHA-256 `33721197341580c3dce27fa3a483382243effef5ffb9ad9952c910881fb5b83c`. It accumulated source-identical reruns and used the latest observed outcome per ID. Its six-file access outcomes are unchanged in the authoritative final single run recorded below. This paragraph identifies historical evidence, not a new execution by this reviewer.

| Access file | Candidates | Final killed | Final survived | Invalid | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| functions/api/my-leads.js | 56 | 56 | 0 | 0 | 0 |
| functions/leads.js | 182 | 164 | 18 | 0 | 0 |
| functions/api/upload-bundle.js | 35 | 30 | 4 | 1 | 0 |
| functions/api/get-object.js | 12 | 12 | 0 | 0 | 0 |
| functions/api/_github-oidc.js | 66 | 58 | 7 | 1 | 0 |
| functions/api/_cf-access.js | 90 | 82 | 7 | 1 | 0 |
| Combined six-file access scope | 441 | 402 | 36 | 3 | 0 |

All 32 initial survivors targeted by the 13 added contracts are now recorded as killed: 23 in leads.js, one in GitHub OIDC and eight in Cloudflare Access. The other source groups did not change outcomes. The final 36 survivors remain individually identified in the historical exact-ID tables above; their surviving status is not removed by explanation.

- Four remaining meaningful gaps are portal body disposal `3c533855e47edb1d` (line 131), hour-display accuracy `c7f6c66a77e612d1` (566), warning-banner distinction `32b553f2545b8cd7` (240), and freshness-badge warning distinction `138af37a1ee0e93d` (283). These are genuine unasserted resource or visible-output boundaries, not claims of current authorization bypass.
- Eight have the bounded equivalence arguments already stated above: portal `0f04f4656759a70e`, `cf5f7a86c57c1d99`; GitHub `067e2557721da616`, `3b2fed4f2bf08920`, `72b9d256cc3e277e`; Access `ca14b95bbb806afc`, `b2f7001893e5de41`, `3fa2b68e2b04b7d3`. The contemporary-clock, private-call-graph and initialization qualifications still apply.
- The remaining 24 are the existing P dispositions: 12 portal availability/cookie/style/precision choices, four upload error disclosures, four GitHub diagnostics and four Access diagnostics. P does not mean no observable change. Preserve unresolved C16 policy and avoid pinning sensitive diagnostics for score.

No valid access candidate has a final timeout or unclassified error. The three invalid candidates remain invalid; they are not kills. No production/source fix, live authorization check, Cloudflare certification, or complete coverage claim follows from these mutation results.


## Authoritative final single-run access outcomes

The final complete run is [S7-final-exhaustive.json](evidence/S7-final-exhaustive.json), started 2026-09-27T07:10:34.227Z and completed 2026-09-27T07:21:46.565Z, SHA-256 `e90a7df474dfe5c5648d4f20177bd36582840a3d28dd7206d0d18f3eaaafdce2`. Its [final summary](evidence/S7-final-mutation.json), generated 2026-09-27T07:22:15.332Z, has SHA-256 `d9c92105187d999852ee2c3c42c38818b8ca3d8e14d51a21aae7cbe40b1516de`. One recorded source, test and harness hash set governs this run; outcomes are not combined across earlier harness versions.

| Access file | Selected | Valid | Final killed | Final survived | Invalid | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| functions/api/my-leads.js | 56 | 56 | 56 | 0 | 0 | 0 |
| functions/leads.js | 182 | 182 | 164 | 18 | 0 | 0 |
| functions/api/upload-bundle.js | 35 | 34 | 30 | 4 | 1 | 0 |
| functions/api/get-object.js | 12 | 12 | 12 | 0 | 0 | 0 |
| functions/api/_github-oidc.js | 66 | 65 | 58 | 7 | 1 | 0 |
| functions/api/_cf-access.js | 90 | 89 | 82 | 7 | 1 | 0 |
| Combined six-file access scope | 441 | 438 | 402 | 36 | 3 | 0 |

A candidate-by-candidate comparison confirms zero access outcome changes from the accumulated archive. The four catalog-wide changes concern three send-status IDs and one supplemental lifecycle ID; none is an access candidate. All 32 targeted initial access survivors remain recorded as killed. The final 36 survivors and their four meaningful gaps, eight bounded-equivalence arguments and 24 policy/diagnostic dispositions remain as listed above.

These are observed final outcomes, not a score inferred from added test names. TODOs never kill; invalid candidates remain invalid. There are no unresolved access candidates, but this does not waive unresolved outcomes elsewhere or certify all runtime behavior. No tests, source or production services were executed for this final documentation update.
