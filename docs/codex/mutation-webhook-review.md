# Webhook mutation survivor review

This is a test-only review of the webhook portion of `S7-initial-sample.json`. It adds [webhook-mutation.test.mjs](../../test/revenue/webhook-mutation.test.mjs) and this note. No production source, existing test, harness mapping, workflow, policy, or other worktree was edited by this agent. Root owns mapping the new file and running the later mutation/full-suite work.

## Pins and result

Worktree: `revenue-harness`, branch `claude/codex-revenue-harness`, observed HEAD `ba5eee54f027c09c99e4d84461ec09b711d923a7`.

- Initial sample SHA256: `4d7fb35769f20f7151375d1c6af43aed038405217ae179389029a2dbb035dfdf`.
- Sampled and current webhook SHA256: `313aa39ca34c6f6af6f96f61ce75cde58267c4d00f7a022b652c7076e3716fd5`.
- New test file SHA256: `fd4fc02346f40d602722fcc1a0c79b992e60a3d70953fd2659efaec17be3f912`.

The initial webhook sample selected **24 of 392 candidates**, with **13 killed and 11 surviving**, zero invalid and zero unresolved. Its 54.2% score is a sample result from the original mapping, not an exhaustive score or a result for this new file.

At `2026-09-27T05:54:36.627Z`, Node `v25.9.0` ran:

```text
node test/harness/run.mjs test/revenue/webhook-mutation.test.mjs
```

**33 tests passed, zero failed, zero TODO, zero skipped, zero cancelled; exit 0.** Only this file was run for this assignment. No new mutation kill count or full-suite result is claimed here. Nine of the eleven sampled survivors have direct new contract targets; that prediction remains subject to Root's mutation rerun. The other two are reasoned exclusions described below.

The handler imports use `loadHandlers({ sourceRoot: process.env.REVENUE_SOURCE_ROOT })`, allowing the existing runner to load isolated mutation copies without rewriting or extracting production functions in the tests. All records, events and addresses are synthetic. Actual exported handlers and HMAC verification run; fetch remains closed, storage is in memory, and the clock is fixed at a UTC month boundary. No network, customer data, service operation, workflow, send, commit or push was used.

## Contracts added

| Group | Cases | Observable contract |
| --- | ---: | --- |
| Signature and JSON boundaries | 13 | Absent/empty header, missing timestamp/v1, empty/short v1, missing secret variants, valid second v1 with padded configured secret, and signed invalid JSON. Rejections have no R2/provider effects. Public signature errors do not expose computed diagnostic prefixes. |
| UTC delivery evidence | 2 | New signup `since` and monthly/weekly attachment filenames use the complete UTC date at a month boundary. |
| Cancellation | 5 | Current-ID and legacy email paths, actual cancellation date, unchanged existing flags/token, duplicate deletion preserving the original cancellation date, no revocation without identity, and truthful bounded superseded-row diagnostics. |
| Failed-payment owner evidence | 2 | UTC next-attempt/date fields, no deactivation for a failed payment, one owner-only message, and clear missing-email/retry-time text. |
| Resolved risk compatibility | 3 | Explicit resolved identity lets each supported risk branch hold the matched row and describe the correct risk to the owner. Synthetic hostile reason text remains escaped. |
| Unresolved charge-only risk | 3 | No subscriber is guessed from an unresolved charge/payment-intent ID. The owner receives the no-match explanation. |
| Non-approved review | 4 | Non-approved or missing closure reasons do not clear payment flags or send an approval alert; the returned reason remains accurate. |
| Approved review owner transport | 1 | An already-active row's flags clear, and acknowledgment waits for the owner's transport attempt to finish. All pending work is released and awaited before restoring global test state. |

No test asserts a known defect as desirable behavior just to reject a mutant. Rejected-provider alert observability, replay/idempotency, product scoping, storage/concurrency failures, and unchosen refund or reactivation outcomes retain their existing separate TODOs/design work.

## Every sampled survivor

Line references below are to the pinned [stripe-webhook.js](../../functions/api/stripe-webhook.js). IDs identify the original sample, not a newly measured outcome.

| Mutant ID | Line / change | Review and contract target |
| --- | --- | --- |
| `0b91dff10fb0cd94` | 330, signup date slice boundary `10` to `11` | Real evidence-format gap. `I04 mutation contract stores the UTC signup date and dated monthly attachment` requires `2026-10-01`, excluding an appended ISO time delimiter. |
| `4971916e72c5972b` | 110, risk customer-details guard `&&` to `||` | Real guarded-field/identity gap. The resolved-identity compatibility cases and charge-only no-guess cases exercise both present and absent customer-details branches. The mutation must not turn an owner-visible unresolved event into a thrown field access or prevent a provided identity from being handled. |
| `664ee4511d42deba` | 573, absent-header rejection `ok: false` to `true` | Authentication gap in original tests. Absent/empty-header controls require 400 and zero storage/provider effects with a consequential checkout payload. |
| `7eed554b2d371a78` | 566, attachment date slice boundary `10` to `11` | Real customer attachment-name evidence gap. Monthly and weekly filename controls require the full UTC date without an extra character. |
| `ad5126ef2a4f09f1` | 153, review-reason fallback `||` to `&&` | Real result-contract gap. Non-approved/missing reason controls and the approved-review control require the actual closure reason or explicit `unknown`; they do not choose a new entitlement policy. |
| `9dffa56de4fed5a9` | 146, remove awaited approved-review owner notification | Real async-lifetime gap. The delayed closed transport proves the handler cannot acknowledge before this attempt completes. A race against handler completion prevents a removed notification from leaving the test waiting forever. The test does not claim inbox receipt or certify provider rejection handling. |
| `be7f61f871847e60` | 301, initialize `changed` to `true` instead of `false` | **Not targeted with an artificial no-put assertion.** For a healthy existing row needing no changes, this adds a redundant full-roster put without changing its fields, token, customer message, or response. It is not strictly equivalent: extra I/O can interact with R2 faults and C05 races. Those durability/concurrency defects are already separate work. No approved business contract here establishes exact write suppression, so a healthy-path operation-count test would primarily pin an optimization. Keep this survivor reasoned and visible. |
| `67b4c0b4741c8c11` | 595, private `gotPrefix` fallback `||` to `&&` | **Equivalent at the exported handler boundary for this code.** The field changes inside the private signature verdict, but lines 29-31 return only `error` and `reason`. Valid signatures return before this field. Both versions preserve the exported rejection and side effects. Do not expose/test private HMAC prefixes merely to increase the score. |
| `34878dfef58c90ca` | 113, invert review-risk label condition | Real owner triage gap. The three resolved risk controls require the corresponding review, dispute, or bank-fraud subject label. They assert meaningful distinctions, not the entire template. |
| `96c0ce669546611f` | 386, initialize superseded-row count to `1` | Real false-diagnostic/count gap. Matching-ID cancellation must emit no superseded diagnostic, while one conflicting row must report exactly one. Tests capture synthetic console output and assert event/count, without pinning the existing customer-ID field or endorsing its privacy policy. |
| `9d442e9a03fdc596` | 72, owner failed-payment identity fallback `||` to `&&` | Real owner explanation gap. Present email must appear as the identified party; absent email must show the missing-email explanation. The message goes only to the configured synthetic owner, with no customer attachment. |

## Unsupported, policy and known-defect limits

**Risk payloads:** The three positive risk controls deliberately provide flat, pre-resolved customer/email fields already accepted by the handler. They are compatibility fixtures. They do not establish that ordinary Stripe dispute, early-warning or review webhooks contain those fields, that expanded related charges are resolved, or that live events will identify a roster row. The separate charge-only controls exercise no fabricated identity and do not assert that the current success-shaped `held` response establishes a hold. C14's unresolved-outcome contract stays separate.

**Review recovery:** The approved-review test starts with `active: true`. It tests flag clearing and notification lifetime without asserting automatic reactivation of a held/inactive subscriber. That policy remains unchosen; a test requiring the current failure to reactivate would pin a known issue. Non-approved reasons must not be treated as approval, which is an independent valid boundary.

**Owner failure:** The delayed transport resolves normally. The test does not demand or accept a particular outcome for a rejected owner alert. `notifyOwner`'s ignored non-2xx result remains the C20 observability concern. Transport attempt completion is weaker than provider acceptance, and both are weaker than inbox receipt.

**Signature input limits:** The new hard-pass tests cover supported string header forms and missing configuration. A bare `v1` token without `=` can create an undefined candidate before the line-585 length access; a whitespace-only truthy secret reaches empty-key import. Those are source-inspected validation gaps, not new executed passing controls, and no rejection-exception behavior is enshrined as correct. The verifier also does not enforce signature timestamp age. These tests neither add a replay-age policy nor claim one exists.

**Dates and cancellation:** UTC fields are observed bookkeeping dates, not proof of paid-through entitlement or period-end enforcement. The tests do not settle C13 sibling-subscription/refund policy. An existing cancellation date is preserved on repeated deletion, while existing payment flags and token identity remain intact.

## Local evidence

The ignored local files are [final TAP](../../test/harness/.runtime/S7-webhook-contracts-final.tap.txt) and [final summary](../../test/harness/.runtime/S7-webhook-contracts-final-summary.json). They are not claimed as published artifacts. Earlier local captures were preserved.

- Final TAP SHA256: `7845693f539c442c91d56448b506ce32ecf2831c656d1c9ce0285ef029854a9e`.
- Final summary SHA256: `ed622adcf40bfa7a63c593bcb0ff53b19a980c3eafdaea148806b90ee52b2987`.

The original [initial sample](../../test/harness/.runtime/mutation/S7-initial-sample.json) remains unchanged. The next mutation/full-suite results must be reported independently; this note does not substitute expected kills for executed evidence.
