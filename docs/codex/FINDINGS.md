# DRAFT - S3 reliability findings

Source snapshot: origin/main 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. S2 checkpoint supplied by the parent session: 0e353e327. Prepared 2026-09-27.

This is an offline reliability review, not a report of live customer incidents or a production certification. All scenario data is synthetic. Actual exported handlers and signature checks run against closed transports and in-memory storage; local workerd contract tests check selected platform behavior. No workflow, live payment operation, customer send, deploy or production read was performed for these findings.

Code fixes are preauthorized as DRAFT work on isolated branches where the business rule is settled. That authorization does not lift the sender/status/workflow freeze or decide the policy cases below. No main merge or deployment is part of this findings document.

## Evidence and counts

The saved full-suite record is `test/harness/.runtime/S2-full.tap.txt`: **380 results, 312 pass, 4 hard failures, 64 TODO, 0 skipped and 0 cancelled**. This local runtime evidence may be ignored by Git; the linked test sources are the reproducible contract. It is not an all-green full suite.

The four hard failures are the already identified historical branch/documentation acceptance checks:

- `P2-5 _headers gains exactly the /admin/mission block, outside the widget block`
- `P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/`
- `P1-14 the diff from main lists only allowed paths`
- `P1-14 route strings never appear in non-test added files`

The new handler scenarios comprise **160 results: 96 hard passes, 64 TODO and no hard failures**. Nine additional harness-contract controls pass, giving **169 new results: 105 hard passes and 64 TODO**.

| Area | Hard pass | Concrete failing counterexample scenarios | Policy/contract scenarios | Total |
| --- | ---: | ---: | ---: | ---: |
| Access/storage | 36 | 11 | 3 failing | 50 |
| Webhook/notices | 29 | 23 | 5 failing, 1 passing | 58 |
| Weekly/watchdog/monitoring | 31 | 21 | 0 | 52 |
| Harness contracts | 9 | 0 | 0 | 9 |
| Total | 105 | 55 | 8 failing, 1 passing | 169 |

**64 TODO does not mean 64 bugs.** There are 55 concrete failing scenario assertions across grouped findings, plus nine explicitly policy-dependent scenarios. One of those nine already passes. Several scenarios reproduce different surfaces of the same defect; some overlap categories. C12 has passing scope controls and an operational evidence gap. C04 is deliberately split into C04a identity matching and C04b event ordering without inventing another independent incident count.

All TODO assertions execute. Error/schema scenarios may deliberately expose uncaught production exceptions; a TODO marker is not a skip and does not certify the selected behavior. Provider acceptance is not inbox receipt. Controlled interleavings demonstrate possible races, not their live frequency. The private generator, live objects, catalog, installed configuration and customer population are outside this evidence.

## Ranking and selected next work

The order below ranks potential consequence and breadth under the stated preconditions, not measured incidence or immediate execution order. All likelihood statements are conditional.

The selected small implementation stack is **C17, then C15, then C04a**, each as a one-purpose DRAFT change with its own regressions. This sequence is chosen for narrow scope and clear boundaries, not because the frozen delivery findings are less consequential. A changed diagnostic or return value alone must not be presented as repairing every member of its finding family.

**Frozen queue:** C06, C07, C08, C09, C10, C11 and the sender/status/workflow-dependent portions of C19 must wait for the incoming guard/counts-only changes to be verified and the freeze lifted. Workflow-dependent C18/C20 changes are also outside the selected stack. Do not overwrite incoming work or weaken a reproducer to make the suite green.

**D2 is settled:** an absent active field continues to serve, stays absent in storage and must be flagged diagnostically. C09 is not pending a policy answer. Historical TODO wording that says otherwise is stale.

**PR delivery status:** preparation/pending creation only. The session lacks the gh CLI; no PR has been created and there is no PR URL to report. A prepared description is not a submitted draft PR.

## 1. C06 - Weekly duplicate and retry boundary

**Invariant:** I08, I09.

**Evidence:** Three desired assertions fail: changed bytes and overlapping handlers repeat requests, while an ordinary same-bundle retry does not reach the rejected recipient. The identical-bundle control passes. These tests do not establish the behavior of any incoming per-subscriber guard.

**Exact reproduction/control names:**

- `I08 changed bytes in one UTC week do not repeat an ordinary Monday delivery` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I08 overlapping handlers cannot both send after reading the same prior log` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I09 a retry of a partially accepted bundle reaches only the failed recipient` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** A recipient can receive duplicate weekly mail or remain unserved after another recipient succeeds.

**Likelihood:** Conditional on a second trigger, changed bundle, overlap, or partial provider rejection; current occurrence is unknown.

**Proposed fix in words:** Use durable recipient-and-UTC-week claims and accepted/failed/unknown outcomes, retaining artifact identity as evidence; retry only recipients with a known unserved outcome and preserve concurrency protection.

**Disposition:** FROZEN QUEUE. Rebase and re-test the incoming sender guard before designing a competing change. No sender, status or workflow edit in the selected patch stack.

## 2. C02 - Checkout acknowledgment without durable enrollment or evidence

**Invariant:** I04.

**Evidence:** Four injected read/write faults still permit a complete-success acknowledgment without the required saved roster or first-delivery record. Missing-bundle and rejected-provider controls pass. Log-write failure is caught; it does not itself cause a Stripe retry.

**Exact reproduction/control names:**

- `I04 C02 roster get failure cannot be acknowledged as durable signup` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I04 C02 roster put failure cannot be acknowledged as durable signup` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I04 C02 delivery-log get failure cannot claim complete recoverable delivery` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I04 C02 delivery-log put failure cannot claim complete recoverable delivery` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** A buyer can receive the first attachment while later access or delivery evidence is missing.

**Likelihood:** Conditional on the named R2 fault during checkout; fault frequency and current affected buyers were not measured.

**Proposed fix in words:** Make enrollment and delivery progress durable and distinguish accepted-but-not-recorded outcomes; couple retry behavior to C03 idempotency so a new error response cannot simply duplicate an already accepted email.

**Disposition:** DRAFT DESIGN, preauthorized after the durability/idempotency contract is reviewable. Do not fix this only by returning 500 after an accepted email.

## 3. C01 - Amount-based product routing and unscoped state events

**Invariant:** I02, I03, I16.

**Evidence:** Four fixtures with explicit synthetic foreign product/price relationships fail the desired isolation assertions. The real-handler controls at 500, 990 and 9900 pass; 499 and 435 checkout controls and the 435 renewal control send no bundle. Expanded line items in a fixture are not a claim that ordinary checkout webhooks always carry them.

**Exact reproduction/control names:**

- `I03 C01 foreign-price zero-value trial cannot enroll a Weekly Feed subscriber` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I03 C01 foreign product above the amount floor cannot receive the bundle` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I03 I16 C01 foreign subscription deletion cannot revoke the same customer Weekly Feed` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I03 C01 foreign-product invoice cannot clear Weekly Feed payment failure` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** An unrelated product event can grant delivery or change the correct product subscription state.

**Likelihood:** Conditional on a shared-account foreign event clearing the amount exception or sharing a customer; no current product catalog or event population was read.

**Proposed fix in words:** Identify the intended product and subscription before delivery or roster mutation, including zero-value events; use the existing configured identity conventions where suitable and define unresolved-identity handling. Preserve the 500-cent promotion boundary and do not replace it with 1000.

**Disposition:** DRAFT DESIGN. Product configuration and missing-payload identity resolution are dependencies; no live price IDs are inferred from the synthetic fixtures.

## 4. C03 - Webhook replay repeats external effects

**Invariant:** I05.

**Evidence:** Three repeat-event assertions fail. The referral assertion captures both owner-alert count and attribution-write count. The fixed clock can reuse a credit object key, so repeated writes/alerts are proved; two distinct persisted credit objects are not asserted.

**Exact reproduction/control names:**

- `I05 C03 duplicate accepted checkout event sends only one customer message` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I05 C03 duplicate renewal event sends only one weekly message` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I05 C03 duplicate referral event credits and alerts only once` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** A repeated event can repeat a customer email or referral-credit instruction.

**Likelihood:** Conditional on replay or redelivery of the same event; transport retry incidence and actual provider receipt are outside this run.

**Proposed fix in words:** Persist event/business-effect progress and use a stable provider idempotency key, with explicit handling of unknown provider outcomes and resumable evidence writes rather than an early mark-as-done that loses recovery.

**Disposition:** DRAFT DESIGN, coordinated with C02 and C05; one duplicate event must not suppress a genuinely unfinished effect.

## 5. C05 - Concurrent whole-roster replacements lose valid changes

**Invariant:** I07.

**Evidence:** Both deterministic interleavings fail. Each reader receives captured snapshot bytes before either continues; the resulting whole-object replacement loses an enrollment or restores a cancellation. Harness snapshot and conditional-writer controls agree with local workerd behavior.

**Exact reproduction/control names:**

- `I07 C05 simultaneous independent checkouts preserve both subscribers` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I07 C05 concurrent enrollment and cancellation preserve both valid changes` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** Overlapping events can erase one buyer enrollment or undo a valid cancellation.

**Likelihood:** Conditional on overlapping reads of the same roster generation; overlap frequency was not observed.

**Proposed fix in words:** Serialize entitlement mutations or implement conditional object replacement with bounded reload/reapply retries and durable event progress. Keep conflict recovery free of repeated email/referral side effects.

**Disposition:** DRAFT DESIGN. Coordinate the storage boundary with C02/C03; changing one put call without conflict handling is insufficient.

## 6. C10 - Unreadable delivery evidence becomes an empty or healthy state

**Invariant:** I13.

**Evidence:** Five fault cases fail: sender history can be treated as absent, membership errors can retain an apparent clean result, and unavailable history/attempt evidence can allow retry_safe:true. A real durable attempt plus failed result write correctly produces unknown with retry disabled.

**Exact reproduction/control names:**

- `I13 a failed prior-log read cannot open the duplicate guard` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I13 unavailable roster evidence cannot certify a complete send` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I13 malformed roster evidence cannot certify a complete send` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I13 unavailable feed-send-log.json cannot authorize a retry` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I13 unavailable last-send-attempt.json cannot authorize a retry` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** A storage problem can hide an omitted recipient or permit an unsafe resend.

**Likelihood:** Conditional on specific read/parse failures; missing evidence and failed reads must not be treated as equivalent.

**Proposed fix in words:** Represent absent, invalid and unavailable evidence separately, keep verification failure visible, and disable automatic retry whenever prior acceptance cannot be excluded.

**Disposition:** FROZEN QUEUE for sender/status and their consumers. Re-test after incoming changes.

## 7. C09 - Missing-active eligibility disagrees with watchdog membership

**Invariant:** I12.

**Evidence:** The test first proves that the real sender selects the absent-active row and preserves its bytes, then shows the watchdog omits that same member from the gap check. D2 is APPROVED: keep the row eligible, preserve the absent field, and flag the data-quality condition. Older TODO text saying policy remains unresolved is superseded.

**Exact reproduction/control names:**

- `I12 watchdog membership agrees with sender for the preserved missing-active row` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** A legacy eligible subscriber can be omitted without appearing in the watchdog recipient gap.

**Likelihood:** Conditional on a roster row lacking active and being absent from the relevant send; no current such omission was established.

**Proposed fix in words:** Align watchdog expected membership with the approved eligibility rule, preserve the original missing field, and report the data-quality flag without converting the row to inactive or rewriting it to true.

**Disposition:** FROZEN QUEUE, POLICY RESOLVED by D2. This is not waiting for another owner answer.

## 8. C07 - Pre-send diagnosis does not govern the sender or notice path

**Invariant:** I10, I28.

**Evidence:** Each fixture first receives enforcing:true and NO_GO from the real pre-send handler, then the real sender still calls the provider. Existing missing-ZIP, stale-refresh, failed-refresh and invalid-roster boundaries pass. Pure notice rendering and disabled default notice-policy controls pass; they do not establish integration.

**Exact reproduction/control names:**

- `I10 enabled pre-send policy blocks actual sender on missing status` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I10 enabled pre-send policy blocks actual sender on hash mismatch` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I10 enabled pre-send policy blocks actual sender on invalid archive` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I10 enabled pre-send policy blocks actual sender on stale object` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** A file rejected by the configured diagnostic policy can still be mailed, while an unused explanation template provides no customer notice.

**Likelihood:** Conditional on the named bad input with enforce enabled; no live policy values or actual file defects were read.

**Proposed fix in words:** Make the approved pre-send result an enforced boundary in the actual delivery path and record a truthful terminal outcome. Choose and test any customer-notice activation/content separately; do not activate dormant refund wording as a side effect.

**Disposition:** FROZEN QUEUE for sender/workflow integration. Notice policy remains a separate decision, not permission to send a new message.

## 9. C08 - All-rejected delivery returns a success-shaped outcome

**Invariant:** I11.

**Evidence:** The handler reports delivered:0 and failed:2 but still returns ok:true. The zero-subscriber scenario is deliberately a passing characterization of an explicit no-op, not a new failed test or proof of paid fulfillment. Workflow HTTP-only outcome consumption is source evidence, not an executed workflow.

**Exact reproduction/control names:**

- `I11 all provider rejections do not claim successful fulfillment` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** An operator can see a successful request while no recipient was accepted by the provider.

**Likelihood:** Conditional on provider rejection or a consumer equating transport success with fulfillment.

**Proposed fix in words:** Define distinct no-op, skipped, partial, complete and failed outcomes and ensure the workflow interprets that contract, preserving counts and avoiding blind retry of partial/unknown delivery.

**Disposition:** FROZEN QUEUE. Endpoint and consumer contract must be reviewed together; no workflow execution occurred.

## 10. C11 - Accepted mail lacks durable recipient evidence

**Invariant:** I14.

**Evidence:** Two cases fail: loss of both markers permits a safe-retry diagnosis after a configured provider acceptance, and the successful provider message ID is discarded. A separate control proves that losing only the result while retaining the attempt correctly yields unknown and forbids retry.

**Exact reproduction/control names:**

- `I14 lost attempt and result writes cannot coexist with provider acceptance and a safe retry` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I14 provider acceptance identity survives in durable per-recipient evidence` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** A recipient can be mailed twice or a delivery complaint can lack the provider evidence needed to investigate safely.

**Likelihood:** Conditional on the two failed writes for unsafe retry; provider-ID omission occurs on the tested successful path. Neither proves inbox receipt.

**Proposed fix in words:** Require durable attempt/claim state before external effects, retain provider acceptance IDs and explicit unknown outcomes, and preserve recoverable per-recipient records across result-write failures.

**Disposition:** FROZEN QUEUE for weekly sender/status; coordinate the shared durability contract with C02/C03.

## 11. C04b - Out-of-order events override newer entitlement intent

**Invariant:** I06.

**Evidence:** All four ordered-sequence assertions fail. The existing replacement-customer/stale-deletion control passes. These tests establish the provided permutations, not a universal chronological ordering contract for all invoices or subscriptions.

**Exact reproduction/control names:**

- `I06 C04 older checkout cannot replace a newer customer identity` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I06 C04 deletion followed by older checkout remains revoked` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I06 C04 older failed invoice cannot undo newer payment recovery` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I06 C04 older payment recovery cannot clear newer failed invoice` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** An old event can reactivate canceled access, restore a stale customer identity, or reverse current payment flags.

**Likelihood:** Conditional on reordered delivery or later replay of an older event; current occurrence is unknown.

**Proposed fix in words:** Define state precedence per subscription/invoice, persist event provenance or versions, and reconcile ambiguous state. A single customer-wide timestamp is not automatically a correct substitute for the underlying billing relationship.

**Disposition:** DRAFT DESIGN, separate from the small C04a patch. C04a must not be described as fixing event ordering.

## 12. C13 - Customer-level entitlement cannot distinguish sibling subscriptions

**Invariant:** I16.

**Evidence:** One concrete same-customer/sibling-subscription counterexample fails. Scheduled cancellation before period end, sole-subscription deletion, and refund of another invoice are passing controls. Full and partial sole-subscription refund behavior remains the separate policy matrix below.

**Exact reproduction/control names:**

- `I16 C13 deleting an older same-customer subscription preserves the newer paid subscription` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** Deleting one subscription can revoke a different subscription that remains entitled.

**Likelihood:** Conditional on multiple relevant subscriptions for one customer; the tests do not assert that any current customer has that arrangement.

**Proposed fix in words:** Track entitlement by subscription and derive customer access from the remaining valid relationships; implement paid-through and refund transitions only after their business policy is explicit.

**Disposition:** DRAFT DESIGN for sibling-subscription isolation; REFUND POLICY PENDING. A passing scheduled-update control does not certify the full paid-through contract.

## 13. C14 - A recorded risk hold does not stop renewal delivery

**Invariant:** I17.

**Evidence:** The concrete held-row renewal case calls the provider despite inactive/risk-held state. Four additional risk/review scenarios are policy/response-contract probes, not four more confirmed defects; they are listed separately below.

**Exact reproduction/control names:**

- `I17 C14 nonzero renewal cannot deliver through an existing risk hold` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** A held subscriber can receive another paid bundle before the hold has an approved resolution.

**Likelihood:** Conditional on a nonzero renewal arriving while the row is held; no current held customer or delivery was observed.

**Proposed fix in words:** Separate risk hold from ordinary payment failure, enforce the hold in every delivery path, and define how identity resolution and approved review alter entitlement without accidentally clearing an unrelated hold.

**Disposition:** DRAFT DESIGN for existing-hold enforcement; REVIEW RECOVERY and unresolved-risk response policy remain pending.

## 14. C19 - Response privacy and outbound wording are incomplete

**Invariant:** I24, I29.

**Evidence:** Three desired assertions fail: webhook success exposes the synthetic recipient, provider error passthrough exposes injected sensitive text, and owner-facing status wording contains a prohibited long dash. The actual weekly customer mail wording control passes. Sender/status domains and workflow-generated text are additional source concerns, not evidence of an observed public disclosure.

**Exact reproduction/control names:**

- `I24 C19 successful webhook machine response contains no recipient identity` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I24 C19 provider error response does not echo identity or bearer material` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I29 owner-facing watchdog grace text contains neither prohibited long dash` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** Machine output can retain unnecessary customer details, and operator messages can violate the approved wording rule.

**Likelihood:** Conditional on those responses being retained or exposed by a consumer; the tested strings are synthetic and no real disclosure was established.

**Proposed fix in words:** Return counts and stable error codes, retain necessary sensitive diagnostics only behind an appropriate private boundary, and normalize approved outbound wording. Do not discard operational evidence indiscriminately.

**Disposition:** FROZEN QUEUE for sender/status/workflow-dependent changes until incoming counts-only work is verified. Webhook/relay-specific changes can be a separate DRAFT; no blanket privacy completion claim.

## 15. C17 - Uploader accepts inherited names at its key gate

**Invariant:** I22.

**Evidence:** All three desired no-put assertions fail after valid offline OIDC authorization. Declared upload keys, strict get-object membership, roster exclusion, and invalid-key controls pass. This proves the gate reaches put; it does not assert that production R2 accepts function/prototype-derived metadata or that an unauthenticated caller can exploit it.

**Exact reproduction/control names:**

- `I22 upload own-key allowlist rejects inherited property constructor before put` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I22 upload own-key allowlist rejects inherited property toString before put` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I22 upload own-key allowlist rejects inherited property __proto__ before put` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).

**Customer/owner impact:** An authorized upload caller can reach storage with an undeclared key.

**Likelihood:** Conditional on an authorized caller supplying an inherited property name; normal declared-key uploads are unaffected in the controls.

**Proposed fix in words:** Replace prototype-inclusive membership with an own-property or Set check before metadata lookup and put. Preserve exactly the nine upload keys, existing authentication, size/method checks, and the separate four-key reader allowlist.

**Disposition:** SELECTED NEXT: DRAFT patch 1, preauthorized, small and independent. Add no new allowed key.

## 16. C18 - Artifact upload does not enforce content or write preconditions

**Invariant:** I23.

**Evidence:** Three cases fail: non-ZIP bytes, malformed status JSON and an obsolete If-Match can reach replacement behavior. The harness verifies conditional-object semantics separately. Cross-artifact atomicity is a source/workflow design gap; no whole refresh workflow or private generator ran in this suite.

**Exact reproduction/control names:**

- `I23 invalid latest-weekly.zip bytes cannot replace a published artifact` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I23 invalid refresh-status.json bytes cannot replace a published artifact` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I23 stale conditional upload cannot replace a newer object unnoticed` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).

**Customer/owner impact:** An invalid or stale upload can replace the file a customer would download.

**Likelihood:** Conditional on an authorized bad/stale upload or mixed publication; no current release corruption was inspected.

**Proposed fix in words:** Validate the declared artifact format/schema, honor conditional writes and expose conflicts, then design a generation manifest/publish boundary for coherent ZIP, HTML and status publication.

**Disposition:** DRAFT DESIGN for endpoint hardening. Workflow-dependent coherent publication remains frozen and needs a separate change.

## 17. C15 - Download route handles unknown storage state inconsistently

**Invariant:** I20.

**Evidence:** Five cases fail. Object/string roster values escape as TypeError; null/missing roster is treated as ordinary denial rather than unavailable evidence; a thrown bundle get escapes. The portal already controls the tested wrong-schema cases, and both routes control roster read and JSON parse errors.

**Exact reproduction/control names:**

- `I20 download controls object-shaped roster JSON` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I20 download controls null-shaped roster JSON` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I20 download controls string-shaped roster JSON` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I20 missing roster is unavailable on both access routes` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).
- `I20 throwing bundle read produces controlled download unavailability` in [test/revenue/access-storage.test.mjs](../../test/revenue/access-storage.test.mjs).

**Customer/owner impact:** A valid subscriber can receive an uncontrolled error or misleading access denial during a storage/schema fault.

**Likelihood:** Conditional on the tested missing/corrupt state or thrown artifact read; normal token access and explicit revocation controls pass.

**Proposed fix in words:** Validate roster presence and array shape before membership lookup, return controlled unavailability for unknown storage state, and catch artifact read/body failures without revealing exception text. Preserve valid-empty-roster denial, absent-bundle not-ready, token checks and D2 eligibility.

**Disposition:** SELECTED NEXT: DRAFT patch 2, preauthorized. Keep portal freshness/pause policy C16 out of this error-handling patch.

## 18. C04a - Email match bypasses payment-flag customer-ID conflict protection

**Invariant:** I18.

**Evidence:** Both fixtures supply a different customer ID and the same synthetic email; one overwrites flags and the other clears them. Correct-ID failure/recovery and the original stale-deletion protection have passing controls.

**Exact reproduction/control names:**

- `I18 C04 conflicting customer identity cannot replace current payment flags` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).
- `I18 C04 conflicting customer identity cannot clear current payment flags` in [test/revenue/webhook.test.mjs](../../test/revenue/webhook.test.mjs).

**Customer/owner impact:** An event belonging to an older billing identity can alter the current customer payment flags.

**Likelihood:** Conditional on same-email, conflicting nonempty customer IDs; occurrence among current payers was not checked.

**Proposed fix in words:** Use matchesForRevoke(...) === true in both flagPaymentIssue and clearPaymentIssue, or an equivalently tested shared identity predicate. Preserve matching-ID precedence and missing-ID email fallback/backfill. The strict comparison is essential because the helper also returns the truthy string superseded.

**Disposition:** SELECTED NEXT: DRAFT patch 3, preauthorized. Add matching-ID/changed-email and legacy missing-ID backfill controls. No event ledger, timestamp policy, active-state or notification redesign in this patch.

## 19. C16 - Portal pause and stale-file fallback policy is unresolved

**Invariant:** I21.

**Evidence:** All three access policy probes below fail the proposed strict outcomes. Existing stale-portal withholding, malformed pause JSON and private-access controls pass. These policy failures are not counted as three approved production defects.

**Exact reproduction names:** the three C16 entries in the policy matrix below; no additional defect reproducer is claimed.

**Customer/owner impact:** A subscriber may receive a stale fallback or gain a session while the pause decision could not be read.

**Likelihood:** Conditional on pause-read failure, missing HTML with old ZIP, or direct stale ZIP access; no live instance was observed.

**Proposed fix in words:** Choose the intended unavailable/pause/fallback and stale-download behavior first, then encode it consistently across portal and direct download with an explicit customer outcome.

**Disposition:** POLICY PENDING. Do not fold this choice into C15 or silently remove access as an incidental reliability fix.

## 20. C20 - Monitoring and retention lose distinctions or evidence

**Invariant:** I27, I30.

**Evidence:** Four cases fail. Read/JSON failures still return alert:true but are mislabeled never; they do NOT prove the endpoint suppressed its alert. The workflow separately suppresses never by source inspection. Invalid timestamp acceptance requires corrupted/invalid stored state, not an ordinary healthy heartbeat. Retention uses a future 2027-11-01 clock and a correctly shaped attributed event older than 400 days; a failed aggregate save still prunes it.

**Exact reproduction/control names:**

- `I27 inbox read failure stays distinguishable from never installed` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I27 inbox invalid JSON stays distinguishable from never installed` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I27 unusable heartbeat timestamp cannot look like a healthy live monitor` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `I30 future retention: failed aggregate persistence retains attributed source telemetry for a rebuild` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).

**Customer/owner impact:** Monitoring can misdiagnose an outage, and an old source event can be lost before its replacement aggregate is durable.

**Likelihood:** Conditional on read/parse faults, corrupted heartbeat data, or the explicitly future retention-age threshold plus failed save; no present retention incident or installed-inbox condition was established.

**Proposed fix in words:** Preserve absent versus unavailable/invalid monitor states, reject unusable dates, and prune attributed source events only after successful aggregate persistence. Keep diagnostics and retention as separate small patches; check consumer behavior before altering verdicts.

**Disposition:** DRAFT follow-up candidates. Owner relay rejection is a passing control; webhook notifyOwner ignoring non-2xx is still source-only in this suite, not a reproduced relay failure. Workflow edits remain frozen.

## 21. C12 - Operational payment reconciliation is not established by sender health

**Invariant:** I15.

**Evidence:** These are PASSING scope/control tests, not a reproduced global-absence defect. The merged mission reader and existing oracles already scope payment inputs and preserve several unknown/partial states. The sender/status result alone still lacks that independent payment anchor.

**Exact reproduction/control names:**

- `I15 scope control: a clean roster verdict performs no payment reconciliation` in [test/revenue/weekly-watchdog.test.mjs](../../test/revenue/weekly-watchdog.test.mjs).
- `connected: numbers from both invoice line shapes, other product never counted` in [test/mission/stripe.test.mjs](../../test/mission/stripe.test.mjs).
- `P1-9 failed tile (b): refused, partial and unavailable Stripe -> grey unverified as well` in [test/mission/stripe.test.mjs](../../test/mission/stripe.test.mjs).

**Customer/owner impact:** An operator relying only on delivery health could miss a payer absent from the delivery roster.

**Likelihood:** Conditional on the independent reconciliation being disconnected, incomplete or unobserved; live configuration and operational cadence were not read.

**Proposed fix in words:** Reuse the existing mission reconciliation and oracles, verify complete/unknown classification and the approved operational observation path, and connect the resulting obligation evidence to the review process without building a duplicate payment engine.

**Disposition:** VERIFICATION GAP, not a finding that reconciliation exists nowhere. No new live request, credential access or unverified configuration change is authorized by this document.

## Policy matrix: keep separate from confirmed counterexamples

These nine scenarios execute assertions about proposed behavior. They do not choose the policy, and a failure is not independent authorization to change paid access or send new notices.

| Candidate | Exact scenario name | Saved result | Policy boundary |
| --- | --- | --- | --- |
| C13 | `I16 C13 POLICY partial refund preserves paid-through access if that policy is selected` | Passing TODO | Partial-refund entitlement is not approved by this pass. |
| C13 | `I16 C13 POLICY full sole-subscription refund revokes access if that policy is selected` | Failing TODO | Decide the full-refund access rule before coding revocation. |
| C14 | `I17 C14 POLICY charge-only charge.dispute.created has an explicit unresolved outcome if that response contract is selected` | Failing TODO | No resolved customer is provided; do not infer a missed customer hold from this fixture. |
| C14 | `I17 C14 POLICY charge-only radar.early_fraud_warning.created has an explicit unresolved outcome if that response contract is selected` | Failing TODO | An event acknowledgment may remain 2xx with an explicit unresolved result; forced retries are not the only design. |
| C14 | `I17 C14 POLICY charge-only review.opened has an explicit unresolved outcome if that response contract is selected` | Failing TODO | Specify the unresolved-identity response/owner-review contract. |
| C14 | `I17 C14 POLICY approved review restores held access if automatic recovery is selected` | Failing TODO | Automatic reactivation is unchosen; the expanded-charge fixture also requires identity resolution and does not isolate reactivation alone. |
| C16 | `I21 failed pause-switch read cannot silently establish an active portal session` | Failing TODO | Choose pause-read uncertainty behavior rather than silently imposing access denial. |
| C16 | `I21 missing HTML cannot redirect a subscriber to a known stale ZIP` | Failing TODO | Choose whether and how a stale fallback is allowed. |
| C16 | `I21 direct download gives a controlled outcome for a known stale ZIP` | Failing TODO | Choose the direct-download freshness contract. |

C13/C14 scenarios are in [webhook.test.mjs](../../test/revenue/webhook.test.mjs); C16 scenarios are in [access-storage.test.mjs](../../test/revenue/access-storage.test.mjs). Customer-notice content/activation is an additional unchosen C07 policy; pure rendering tests do not approve it.

## Controls that must survive every selected patch

- Invalid HMAC, tampered body and missing signing configuration cause no storage/mail effect; multiple v1 signatures remain supported.
- Subscription purchases at 500, 990 and 9900 retain successful behavior; 499 and 435 do not gain delivery. One-time and renewal paths remain distinct.
- Replacing the customer ID protects the original stale-deletion case. Explicit revocation is rechecked by portal/download; missing-active D2 eligibility is preserved.
- Valid empty roster remains an access denial, absent bundle remains not-ready, and malformed/unavailable storage remains a different state.
- Exactly the declared upload/read keys remain accepted; roster and encoded unknown keys stay excluded. Real OIDC verification runs before effects.
- Successful, known-rejected and unknown provider outcomes remain distinct. Durable attempt plus lost result must continue to prevent a safe-retry claim.
- Hostile synthetic template values remain escaped. Notice renderers remain side-effect-free until separately approved integration.
- Existing mission reconciliation remains reused; no global-absence claim or duplicate reconciliation implementation is introduced.

No source, harness, workflow, dataset or service state was changed in preparing this S3 document. Later patches must report their own focused tests and the remaining full-suite failures/TODOs without converting unresolved cases into silent skips.


## Follow-up C21 - Operator guidance suggests a production workflow trigger

**Invariant:** I31, added during S7: operator recovery instructions must not recommend unreviewed production triggers.

**Evidence:** At main 1068e8070, functions/api/pipeline-now.js:111-112 tells the operator to force a refresh by pushing an edit to the refresh workflow on main. The endpoint exposes the selected row detail as what_to_do at line235. This is a source/test finding, not a claim that an operator followed the advice.

**Reproduction:** `C21 overdue refresh guidance requires evidence review without a workflow-edit trigger` in test/revenue/operator-guidance.test.mjs on branch claude/codex-fix-c21. The actual Access-authenticated endpoint is exercised with synthetic storage. The test fails before the text change and passes after it; healthy-data and unauthorized-request controls also pass.

**Customer impact:** Following the old instruction can start production work without first checking whether a recipient already received a delivery.

**Likelihood:** Conditional on a delayed refresh and an operator following the displayed instruction; no live occurrence was observed.

**Proposed fix:** Direct the operator to inspect existing run and artifact evidence, then obtain maintainer review before triggering a workflow. Do not add a repair button or execute a workflow.

**Disposition:** Narrow fix published at acbf5a01120f0a432f4b602d56a2eb2184471cc9. Intended draft base is claude/codex-revenue-harness. No PR exists while gh is unavailable; nothing is deployed. Focused before3/2pass/1fail, after3/3pass. Branch full414/343pass/4knownfail/67TODO. See FIX_STATUS.md and that branch's fixes/C21.md.

## Current review status

The ranked S3 findings above retain their historical evidence. See FIX_STATUS.md for published partial and narrow fixes and the additional C21 operator-guidance finding. Closing S7 evidence has 630 passes, four known hard failures and 67 executed TODO across 701 cases. MUTATION_REPORT.md records 92.0% for the requested paying path. Neither TODO assertions, mutation kills nor published branches establish production remediation or owner acceptance.
