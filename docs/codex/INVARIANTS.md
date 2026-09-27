# Revenue invariants and S1 candidate findings

Source snapshot: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5, 2026-09-27.
This is a specification for S2 tests, not a production certification or an approved change list.

ENFORCED means the stated source boundary exists; it still needs a real-handler test.
PARTIAL means only part of the rule is implemented.
UNENFORCED means the complete rule has no effective control in the reviewed path.
Candidate IDs C01 through C20 are stable reproduction targets, not confirmed live incidents.
Every test named below is planned unless explicitly marked existing.

## Rules

| ID | Rule that must hold | Source enforcement at this snapshot | Test target and candidate |
| --- | --- | --- | --- |
| I01 | An invalid webhook signature changes no storage and sends no mail. | ENFORCED: stripe-webhook.js:22-35,571-596; HMAC over raw body, multiple v1 signatures supported. Freshness/replay is separate. | webhook rejects tampered payload without side effects |
| I02 | The 500-cent promo floor is retained; a 435-cent sibling-product purchase gets no MassPermits delivery. | PARTIAL: stripe-webhook.js:238-283; existing decision-only test covers 435 and 990, not full handler at 500. State events and zero-value exceptions need separate identity protection. | promo at 500 delivers; 499 and 435 do not; C01 |
| I03 | Only an identified MassPermits product can create or mutate a paid entitlement, including zero-value trials and shared-customer cases. | UNENFORCED: webhook routes by amount/mode; earlier state-event branches precede classification (:41-186,243-283). Existing mission reader uses price IDs but does not govern webhook. | foreign price trial and state events do not affect Weekly Feed; C01 |
| I04 | A successful checkout acknowledgment includes durable roster registration and recoverable first-delivery evidence. | UNENFORCED: bundle precedes registration (:189-204); roster/log failures swallowed (:338-341,212-217). | checkout with R2 read/write failure never claims complete success; C02 |
| I05 | Repeated delivery of one event does not repeat mail, referral credit, or an entitlement transition. | UNENFORCED: no event-ID ledger or provider idempotency key; webhook:206-220,493,551. | same signed event twice has one effect; C03 |
| I06 | An older event cannot undo a newer customer or subscription state. | UNENFORCED: no event-time/version comparison; webhook:297-321,415-458. | deletion then older checkout stays revoked; recovery then older failure stays recovered; C04 |
| I07 | Concurrent roster mutations preserve both valid changes. | UNENFORCED: whole-list reads/writes without conditional etags, webhook:295-335,382-457. | overlapping checkouts and cancellation preserve independent rows; C05 |
| I08 | Each eligible subscriber receives at most one ordinary Monday send per UTC week, even after bundle refresh or concurrent triggers. | UNENFORCED: global etag check only, weekly-send.js:98-138; separate workflow concurrency groups. Frozen pending incoming guard. | changed bundle and simultaneous triggers do not double-send; C06 |
| I09 | A retry can reach an unserved recipient without repeating successful recipients. | UNENFORCED: identical global etag skips whole roster; force resends whole selected roster; weekly-send:115-159. | partial provider failure then retry targets only failures; C06 |
| I10 | Missing, corrupt, stale, or mismatched delivery inputs cause an explicit safe outcome before mail. | PARTIAL: sender checks some status conditions and missing ZIP (:50-88); _presend performs richer checks but is not invoked as a gate. Missing status is allowed. | stale ZIP, missing status, corrupt roster and hash mismatch block accurately; C07 |
| I11 | A skip or partial/all-failed send cannot be presented as successful fulfillment. | UNENFORCED: weekly-send:79,134,176-178 returns ok:true; weekly-feed.yml:38-40 uses HTTP status only. | zero recipients, identical ZIP and provider failures have distinct outcomes; C08 |
| I12 | Sender, portal and watchdog agree on which rows are active. | UNENFORCED: weekly-send:78 and my-leads:83 use !== false; send-status:111 uses === true; leads:532 also accepts absence. No fix without owner answer. | missing/null/false/true active flag has consistent membership; C09 |
| I13 | Unreadable roster, send log or attempt evidence cannot be reported as a healthy complete send or a known-safe retry. | UNENFORCED: send-status:58-59,101-119 and safe readers collapse missing/failure states. | read failure reports unknown instead of empty success; C10 |
| I14 | Every provider acceptance has durable per-recipient evidence and unknown outcomes stay distinguishable from failures. | UNENFORCED: attempt/result writes are best effort; provider IDs discarded; weekly-send:145-173,232-244; webhook:212-217,551-562. | accepted send followed by log failure remains uncertain and retry-safe state is false; C11 |
| I15 | Every active Weekly Feed subscription is compared with roster membership, and unavailable/incomplete payment data remains visibly unknown. | PARTIAL: merged _mission_stripe.js and mission data implement read-only reconciliation; monday-rehearsal adds a separate control. Sender/watchdog itself has no payment anchor. Runtime configuration and monitoring cadence unverified. | reuse existing reconcile oracles; test correct price scoping and incomplete pagination; C12 |
| I16 | Scheduled cancellation preserves access until the paid-through boundary, and refund/deletion cannot revoke a different still-paid subscription. | UNENFORCED as a full contract: customer-level row only; deletion processed immediately; no period-end/subscription-membership/refund state, webhook:41-44,285,326-334,367-408. | cancelled at period end, immediate deletion, partial/full refund and second active subscription; C13; owner decision required |
| I17 | A risk hold prevents further delivery, and approved recovery has an explicit entitlement outcome. | UNENFORCED: nonzero renewals ignore active/hold state; approved review clears flags without reactivation, webhook:141-186,283. | held renewal does not mail; approved review follows chosen policy; C14 |
| I18 | A conflicting customer ID cannot change another customer's flags or access through an email match. | PARTIAL: revocation guard at webhook:371; flag/clear OR matching at :424-425,447-448 lacks it. | differing customer ID plus same synthetic email leaves correct row unchanged; C04 |
| I19 | Unknown, inactive and malformed tokens cannot obtain private data; active tokens work and revocation is rechecked. | ENFORCED for ordinary array roster: my-leads:69-105; leads:85-119,510-533. Token logout is cookie-only by design. | valid, revoked, unknown, tampered tokens and stale cookie |
| I20 | Invalid roster schema and unavailable storage produce controlled errors consistently on both access routes. | PARTIAL: leads:528 checks array; my-leads:83 calls find without schema validation. | object-shaped JSON and throwing R2 return controlled unavailability; C15 |
| I21 | An explicit portal pause or untrustworthy artifact cannot silently serve stale paid content through a fallback. | PARTIAL: leads timestamp gate :160-205; switch read errors continue (:535-548); missing HTML redirects to ungated ZIP; my-leads:103-120 has no freshness check. Policy needs owner choice. | pause-read error, missing HTML, failed refresh, future timestamp and stale ZIP; C16 |
| I22 | Only explicitly declared artifact keys can be uploaded/read; subscriber roster stays excluded. | PARTIAL: get-object strict Set at :14-29; uploader in operator at :62 also accepts inherited properties at the gate. Do not widen either list. | reject subscribers.json, prototype names, unknown and encoded keys before put; C17 |
| I23 | Published ZIP, HTML and status describe one validated release, and stale writes cannot replace a newer release unnoticed. | UNENFORCED as a whole: upload-bundle:65-68 validates length only; weekly-refresh:1088-1100 writes separately and status can ship after upload failure. | invalid bytes, etag conflict and mixed-generation artifacts; C18 |
| I24 | Sensitive machine responses and public logs contain counts, never customer identity, addresses, bearer tokens or provider error text. | PARTIAL: send/status mask local parts but expose domains; webhook:222 returns purchaser email; mail-owner:29 returns owner destination; error passthrough persists. | all success/skip/error responses are identity-free; workflow response contract tested without running workflow; C19 |
| I25 | Every authorized service request is verified before storage/email effects, and private pages are not cached publicly. | ENFORCED within stated authority: _github-oidc:17-48; _cf-access:37-87; middleware:45-71; leads:471-479; get-object:19-31. Future JWT nbf/iat/workflow binding policy is additional, not silently assumed. | bad JWT, wrong issuer/repo/ref/audience/expiry, preview host, private headers |
| I26 | HTML renders hostile synthetic names and text as text, not executable markup. | PARTIAL: _notice:150-153 and paid template escape helpers; uploaded dashboard bytes not validated here. | unicode and markup in synthetic fields stay escaped; existing mission hostile-string tests are adjacent coverage |
| I27 | A failed owner alert or missing inbox monitor is observable as a monitoring failure. | UNENFORCED: webhook notifyOwner ignores non-2xx; inbox-status:62-77 folds unreadable into never; inbox-watchdog fallbacks alert:false and the never verdict exits successfully. | provider rejection, bad heartbeat JSON and failed heartbeat read cannot look healthy; C20 |
| I28 | No omitted weekly delivery is hidden by an unused explanation template. | UNENFORCED: _notice exports have no runtime call sites in reviewed path; sender does not enforce policy.notice. | blocked send reports explicit reason and chosen notice outcome; C07; owner policy required |
| I29 | Customer and owner wording contains neither prohibited long dash character. | PARTIAL: existing test/no-dash-outbound.test.mjs covers selected JS literals/renderers; workflow-generated owner subjects/body and some status text still contain them. Workflows are frozen. | expand safe source-text checks, never run workflows; C19 |
| I30 | A failed diagnostic aggregate save cannot destroy the source evidence needed to rebuild it. | UNENFORCED: _lifecycle:627-642 can prune old dl entries after a failed engagement save. No billing mutation involved. | engagement save failure prevents loss of required telemetry; C20 |

## Ranked candidate findings

Priority is provisional source-based impact, not measured incidence. No candidate is an approved fix. S2 attempts to reproduce each candidate. Confirmed defects get a failing behavioral reproduction recorded as todo with their ID; refuted or policy-dependent candidates are recorded explicitly. S3 assigns final likelihood and fix wording from that evidence.

| Rank | Candidate | Customer or owner consequence | Next evidence |
| --- | --- | --- | --- |
| 1 | C06 Weekly duplicate/retry boundary | Refresh, retries or overlapping senders can repeat mail or leave a failed recipient unserved. | Re-test incoming guard on origin/main; do not edit frozen files. |
| 2 | C02 Durable enrollment/acknowledgment | First mail can be accepted while later delivery/access membership was not saved. | Inject roster get/put and delivery-log failure through real webhook. |
| 3 | C01 Product routing | Amount and trial exceptions can entitle the wrong product/customer; preserve 500 floor. | Signed events with explicit synthetic price identities and trial/state cases. |
| 4 | C03 Event idempotency | Stripe retry can repeat first delivery or referral attribution. | Same event ID twice, including provider acceptance then handler failure. |
| 5 | C05 Concurrent roster writes | One buyer's change can erase another buyer's enrollment or cancellation. | Conditional-write-capable R2 harness with controlled interleaving. |
| 6 | C10 Unknown diagnostic inputs | A broken read can hide missing recipients or imply a safe retry. | Throwing reads, missing objects and malformed JSON, separately. |
| 7 | C09 Active flag disagreement | A person can be eligible for mail but invisible to missed-send checks. | Required S2 missing-active-field test; wait for owner policy. |
| 8 | C07 Send gate and notice integration | A richer safety diagnosis exists without stopping the sender or explaining a skip. | Real endpoint test rather than evaluator-only tests. |
| 9 | C08 Successful-looking skips/failures | A green job can conceal nondelivery. | Sender response and static workflow consumer contract. |
| 10 | C11 Durable delivery evidence | Lost log/provider ID makes safe retries and receipt investigation uncertain. | Provider acceptance plus persistence failure and unknown provider outcome. |
| 11 | C04 Event order and identity conflicts | Late or conflicting events can change the wrong entitlement or payment flags. | Permuted events and superseded-customer fixtures. |
| 12 | C13 Cancellation/refund contract | Paid-through access or another active subscription can be mishandled. | Owner policy, then subscription-ID/period-end fixtures. |
| 13 | C14 Risk hold/recovery | Held buyers can still receive renewals; approval can leave access disabled. | Hold, renewal, approval and payment-recovery sequence. |
| 14 | C19 Privacy and wording boundary | Public machine logs can still expose identity fragments or unfiltered error text. | Outbound/error capture plus source-only workflow scan; incoming change first. |
| 15 | C17 Upload key membership | The gate accepts undeclared inherited property names before storage. | Assert no put is reached; do not assume R2 accepts invalid metadata. |
| 16 | C18 Release coherence | A mixed release can pair status and dashboard with different ZIP bytes. | Synthetic object generations and invalid artifact bodies. |
| 17 | C15 Access error handling | Corrupt roster schema can make download fail uncontrolled. | Real download/portal handlers with non-array JSON. |
| 18 | C16 Portal/download freshness | Fallback can serve a file the portal would not display. | Freshness, pause and fallback policy matrix. |
| 19 | C12 Reconciliation operation | Existing reporting may be disconnected or incomplete despite present code. | Reuse mission/rehearsal tests; no second reconciliation implementation. |
| 20 | C20 Monitoring evidence | Owner alerts or telemetry retention can fail without a useful failure signal. | Fake provider and heartbeat/aggregate failure tests. |

## Existing baseline and honest coverage

The required command on pristine fetched main produced 211 Node test results: 209 pass, 2 fail, 0 cancelled, 0 skipped, 0 todo. The custom health, webhook-decision and outbound-render scripts count as file-level results under this command, not one Node test per internal assertion.

The two failures are historical branch-comparison assumptions, reproduced before any S1 file was created:
1. P2-5 _headers gains exactly the /admin/mission block, outside the widget block, test/mission/page.test.mjs:77. It expects main's headers plus another block even after that block is merged.
2. P1-14 the diff from main lists only allowed paths, test/mission/structure.test.mjs:55. It requires already-merged mission files to be changed and excludes the new documentation scope.

After adding the required S1 documentation, the same full command reports 211 tests: 207 pass and 4 fail, still with 0 skipped/todo/cancelled and exit 1. Two additional historical checks reject the newly required docs: P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/ (page.test.mjs:158), and P1-14 route strings never appear in non-test added files (structure.test.mjs:125). The latter rejects this map naming /api/weekly-send. These are documentation-scope incompatibilities; no runtime or workflow file changed.

These failures must not be hidden, deleted or called a green suite. Repair the obsolete branch acceptance assumptions in a tests-only step while retaining header-security and change-scope checks. No production change is needed to reproduce these failures.

Existing mission tests provide useful reconciliation/privacy/security examples. The decision-only webhook test extracts a private function and explicitly says its zero-value caller check is not covered. It is not a substitute for signed events reaching the real exported handler. S2 coverage is incomplete until every rule above has a named executable scenario or an explicitly approved, tested policy.

## S7 additional operational invariant

I31: Operator recovery instructions must not recommend unreviewed production triggers. UNENFORCED at main1068e8070, pipeline-now.js:111-112 and235. C21 reproduces this through the actual endpoint; the separate published claude/codex-fix-c21 branch contains the named test and narrow text correction. This addendum does not revise the historical S1 source map or claim a deployed fix.
