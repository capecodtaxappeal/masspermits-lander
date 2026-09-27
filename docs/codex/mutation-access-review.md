# S7 access mutation review

This review adds passing contracts against the real handlers without promoting existing faults or unresolved access policy into expected behavior. It owns only [access-mutation.test.mjs](../../test/revenue/access-mutation.test.mjs) and this note. The exhaustive mutation result is a separate root-run artifact; targeted coverage below is not a claim that a mutant was killed.

## Baselines and validation

- Worktree source baseline: ba5eee54f027c09c99e4d84461ec09b711d923a7 (S6).
- Initial sample: test/harness/.runtime/mutation/S7-initial-sample.json, seed S7-v1, started 2026-09-27T05:39:15.013Z and completed 2026-09-27T05:40:36.097Z.
- Initial method: AST mutation, deterministic operator-stratified sample, at most 24 candidates per file, three jobs. TODOs never kill; timeouts and errors remain unresolved.
- The six files in scope have 40 initial surviving mutants, three invalid mutants and one unclassified-error mutant. These categories must remain separate.
- Focused command: node test/harness/run.mjs test/revenue/access-mutation.test.mjs.
- Focused result at 2026-09-27T05:58:49.851Z on Node v25.9.0: 25 tests, 25 pass, zero fail, TODO, skip or cancellation; exit 0; no unexpected errors.
- Focused evidence: test/harness/.runtime/S7-access-focused.tap.txt and S7-access-focused-summary.json. No full-suite or mutation rerun was performed for this review.

| Initial source file | SHA-256 |
| --- | --- |
| functions/api/my-leads.js | 75a9adecf6f47e1a7637b736d5e73e36d75cd7a393fabe882157c12f25b98332 |
| functions/leads.js | 7e596c1d0e551b23720a535d2b99fe35998d0187bd4da0a569788c445ea3db63 |
| functions/api/upload-bundle.js | 9776f47348292a6326b4b9db9f0ce1ade1fe48836c11134288f2f7e458fc1aaf |
| functions/api/get-object.js | 4a51958989fbcbfad8724b3a8f88a94c06927cd15e9a5a51e88c06d4cbcbd12d |
| functions/api/_github-oidc.js | 1e37c126141f717eff0fce157c098024e8c8ce39cb7e515dd81e83d08fc4b11c |
| functions/api/_cf-access.js | f2407a218c5f1c4afa427e46d5c71226608acfe41d0d067a1125581c7802d2b2 |

## Executable contract catalog

All names below are exact top-level cases in access-mutation.test.mjs. All 25 passed without TODO annotations.

| ID | Exact test name |
| --- | --- |
| T01 | S7 I19 download bytes, UTC filename and minimal device telemetry agree for both tiers |
| T02 | S7 I19 bot link scanners receive their authorized file without download telemetry |
| T03 | S7 I19 inactive and missing-file clicks keep distinct minimal telemetry |
| T04 | S7 I19 unknown-token telemetry is capped without suppressing known subscriber evidence |
| T05 | S7 I19 download waitUntil remains pending for deferred telemetry without delaying file response |
| T06 | S7 I19 missing waitUntil does not break an authorized download |
| T07 | S7 I22 declared reader key absent from storage returns an empty 404 object |
| T08 | S7 I22 authorized upload acknowledges exact persisted bytes |
| T09 | S7 I22 failed upload storage cannot claim successful acknowledgment |
| T10 | S7 I22 upload acknowledgment waits for storage completion |
| T11 | S7 I25 GitHub algorithm and malformed expiry claims fail before storage |
| T12 | S7 I25 Access rejects typed-invalid or expired claims and accepts audience arrays |
| T13 | S7 I25 structurally malformed signed claims stay denied by both verifiers |
| T14 | S7 I25 GitHub cached certificates are reused and refreshed after their lifetime |
| T15 | S7 I25 GitHub key rotation recovers through fresh signed certificates |
| T16 | S7 I25 unavailable certificate services fail closed without storage effects |
| T17 | S7 I25 Access certificate cache refreshes with time and isolates issuers |
| T18 | S7 I25 Access key rotation recovers without accepting the removed key |
| T19 | S7 I25 Access audience denial supplies the specific configuration remedy privately |
| T20 | S7 I19 I25 complete portal applies publication metadata and structured private-page injection |
| T21 | S7 I26 portal watermark bounds the local identifier and omits the email domain |
| T22 | S7 I20 missing portal roster returns private unavailability without artifact reads |
| T23 | S7 I21 stale portal explains its known age and records red telemetry without reading rows |
| T24 | S7 I21 portal drift notices respect the display threshold and retain accurate units |
| T25 | S7 I21 portal coverage disclosure uses supplied numeric counts and escaped source labels |

## Initial surviving mutants

Line numbers refer to the initial source hashes above. "Targeted" means a passing behavioral contract now exercises the distinction; the root's exhaustive rerun must establish the actual result.

### Download: functions/api/my-leads.js

| Mutant ID | Line | Distinction and new contract |
| --- | ---: | --- |
| bb385227069deed3 | 151 | Targeted T01: telemetry UTC date prefix length. |
| 7e21180997874aeb | 66 | Targeted T05/T06: function detection for waitUntil. |
| 60a24f8805b48a7a | 155 | Targeted T01/T03: tier metadata included when applicable. |
| dbc87c6c923bdf93 | 147 | Targeted T04: unknown-token event cap is enforced. |
| 3951f534e430f377 | 152 | Targeted T01/T04: telemetry suffix has the expected bounded length. |
| 59f3ee7240d07172 | 66 | Targeted T05/T06: supplied waitUntil receives the pending telemetry promise. |
| b679f368272d757b | 157 | Targeted T01/T03: device classification is on successful events, not error events. |
| 0221b7b8895679e1 | 158 | Targeted T05: logging lifetime includes completion of the deferred put. |
| 9febd48a0f2e6084 | 154 | Targeted T01/T03: only the short token prefix enters metadata. |
| 71b17f1e54a7b6a6 | 114 | Targeted T01: UTC date in the download filename. |
| cfb75c3547970819 | 147 | Targeted T04: 205 unknown requests produce exactly 200 event writes. |
| fdcb0f120b60b32a | 146 | Targeted T04: a known subscriber's event still writes after the unknown-token cap. |

### Portal: functions/leads.js

| Mutant ID | Line | Distinction and new contract or remaining limit |
| --- | ---: | --- |
| 786fb204917e8ff5 | 93 | Not targeted: query-token denial still denies access, but changing inactivePage(false) can clear an existing cookie. This observable cookie behavior needs a UX/policy decision; it is not globally equivalent. |
| b74f5deacbe60ea5 | 248 | Targeted T21: watermark identifier is bounded at 40 characters and omits the domain. |
| a4d6256d38827366 | 202 | Targeted T24: display drift notice starts above 15 minutes, not at exactly 15 minutes. This does not set an access-freshness policy. |
| 7b493eb96d9eaecb | 236 | Targeted T20: publication paragraph reflects actual stored artifact metadata. |
| 95f1604af91be92b | 521 | Targeted T22: missing roster gives private 503 without reading the artifact. |
| b6991b1453a1ba4c | 184 | Targeted T23: known stale age is described accurately. |
| e54ec6a7e020da4d | 570 | Targeted T25: supplied numeric coverage counts are retained rather than replaced by fallback text. |
| 7c9f5d4a44c71bd9 | 447 | Targeted T20/T23: portal telemetry date prefix. |
| febfe352335fa143 | 418 | Genuine remaining coverage gap: inactive-page aggregate preview count is not asserted. Existing denial controls do not verify this number. No equivalent or unreachable claim is made. |
| 3fe6f29b0131e679 | 286 | Targeted T20: private-page head injection creates actual HTML elements rather than escaped text. |
| dda7ccf7e611ebaf | 554 | Targeted T20/T25: asynchronous status JSON supplies the real dates and counts. |
| b3e8b4af494f5c06 | 566 | Targeted T24: minute/hour units retain their intended meaning. |

### Upload and declared object reader

| File | Mutant ID | Line | Distinction and new contract or remaining limit |
| --- | --- | ---: | --- |
| functions/api/upload-bundle.js | 8598a9b0bd5bf39e | 71 | Targeted T09: storage failure cannot acknowledge success. |
| functions/api/upload-bundle.js | 84ede343b386e570 | 69 | Targeted T08: valid persisted bytes receive successful acknowledgment. |
| functions/api/upload-bundle.js | 90577cedb63168d2 | 71 | Not pinned: mutation changes a raw exception string's slice start. The test requires 500 and ok:false, not disclosure of raw diagnostics. This is observably different, not equivalent. |
| functions/api/upload-bundle.js | af20b6b87b21ba01 | 71 | Not pinned: mutation changes raw error fallback selection. Raw diagnostic wording is not made a contract while the separate privacy concern remains open. |
| functions/api/get-object.js | bc9b9615d35ce608 | 30 | Targeted T07: an allowed but absent object returns 404 and an empty JSON object. |

### GitHub OIDC and Cloudflare Access

| File | Mutant ID | Line | Distinction and new contract or remaining limit |
| --- | --- | ---: | --- |
| functions/api/_github-oidc.js | 8795a6e6191bb084 | 50 | Not pinned: raw verification-exception slice. Fail-closed behavior is tested, exact exception wording is not. |
| functions/api/_github-oidc.js | 067e2557721da616 | 62 | Operating-time equivalence only: resetting cache time from 0 to 1 still forces refresh at contemporary timestamps. Not mathematically equivalent near the Unix epoch. T15 verifies rotation recovery without requiring a specific reset literal. |
| functions/api/_github-oidc.js | dfd7df28a622ebeb | 32 | Targeted T11: wrong algorithm cannot pass authentication or touch storage. |
| functions/api/_github-oidc.js | e4d76b87790e3040 | 50 | Not pinned: raw exception fallback wording. |
| functions/api/_github-oidc.js | 58580a23fb70e7dd | 55 | Targeted T14: cached certificates are reused while fresh and fetched after their lifetime. |
| functions/api/_cf-access.js | 8bed192385694630 | 89 | Targeted T13/T16: malformed signed claims and certificate-service failure remain denied. |
| functions/api/_cf-access.js | 32acce9b957a559e | 89 | Not pinned: raw exception fallback wording. |
| functions/api/_cf-access.js | 109e0df4386282f9 | 72 | Targeted T12: expiry uses seconds correctly; a token expiring now is denied. |
| functions/api/_cf-access.js | 63a15659e16fac46 | 94 | Exact-boundary policy difference, not pinned: refresh at exactly one hour versus immediately after. T17 proves reuse while fresh and refresh at one hour plus 1 ms. Not globally equivalent. |
| functions/api/_cf-access.js | f2bbd6241db36971 | 94 | Targeted T17: issuer changes cannot reuse another issuer's certificate set. |
| functions/api/_cf-access.js | fe88c6bd94fec1e5 | 117 | Targeted T19: audience rejection presents the specific private configuration remedy. |

Of the 40 initial survivors, 31 are targeted by the new contracts. The nine others comprise five raw diagnostic-string differences, one operating-time reset equivalence, one exact-hour cache policy boundary, one query-denial cookie UX/policy difference and one genuine inactive-preview count coverage gap. No initial survivor is asserted to be unreachable. This is a classification, not a new mutation score.

## Invalid and unresolved sample results

| Initial category | File | Mutant ID | Line | Treatment |
| --- | --- | --- | ---: | --- |
| unclassified-error | functions/api/upload-bundle.js | 8fb7699af2729c65 | 68 | Drop-await mutation. T10 now verifies that acknowledgment remains pending until storage completes. The exhaustive rerun must classify its result; it is not counted among the 40 survivors. |
| invalid | functions/api/upload-bundle.js | c062d8e0b0dca946 | 62 | Preserve the sample's invalid category; do not count as killed. |
| invalid | functions/api/_github-oidc.js | 8c95b2b06dbe3e3b | 41 | Preserve the sample's invalid category; do not count as killed. |
| invalid | functions/api/_cf-access.js | ff8b90160d03b8e0 | 76 | Preserve the sample's invalid category; do not count as killed. |

## Fidelity and intentional limits

The tests load the actual handlers through loadHandlers and honor REVENUE_SOURCE_ROOT. The only data are synthetic. RSA tokens are genuinely signed, rotated keys are generated in memory, and the normal verifier performs the cryptographic verification. Closed fetch fixtures cover only the declared certificate URLs and delegate other calls to the harness's closed fetch implementation. No live certificate, provider, customer, R2 or network call is made.

Case clocks advance between worlds so a cache created by a later synthetic timestamp cannot silently survive a reset to an earlier one. Certificate cache tests use explicit time advancement. Rotation tests allow immediate recovery or one kid rejection followed by recovery; they do not require an avoidable first-request outage. Removed keys still must be denied.

The download and upload deferred-write cases test promise lifetime and acknowledgment ordering. The portal cases consume the completed response through the existing offline HTMLRewriter implementation, checking structured injection, private headers, dates, rows, bounded identity display and minimal telemetry. These contracts are not a full Cloudflare platform certificate.

No expected-fault tests were added. The tests do not require missing download schemas to be served, invalid upload content to be accepted, raw internal error messages to be disclosed, or an owner entitlement choice to be made for a mutation score. Existing C15/C16/C18/C19 and other findings remain governed by their own evidence and fix scope. Missing portal roster handling is tested separately from the download handler's schema defect. Coverage notices are tested for supplied values and escaping without endorsing the marketing claim that all records are current.

The focused baseline is ready for exhaustive mapping to my-leads.js, leads.js, upload-bundle.js, get-object.js, _github-oidc.js and _cf-access.js. Actual mutant kills, remaining survivors, invalid candidates and unresolved runs must be reported from that run without treating TODOs as kills or denominator exclusions as passing evidence.
