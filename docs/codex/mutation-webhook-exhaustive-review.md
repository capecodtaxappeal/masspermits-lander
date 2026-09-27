# Exhaustive webhook mutation review

The final single-run webhook result is **359 killed of 391 valid candidates (91.8%), with 30 survivors and two unresolved errors**. It independently confirms the earlier accumulated result under the final frozen test/harness hashes. All 26 meaningful G gaps from the prior survivor run were killed by the 18 closure controls. The 30 surviving cases retain their documented dispositions: **20 known-TODO/contract decisions, nine bounded equivalent changes, and one unreachable capability change**. They are not all benign, and neither unresolved exit is counted as a kill. The final confirmation below records the fresh catalogue and exact pins; earlier tables remain dated intermediate checkpoints.

The first exhaustive catalogue contained **392 webhook candidates: 249 killed, 140 survived, two unclassified errors, and one invalid**, with no pending webhook result. This review accounts for every one of the **142 surviving or unclassified, syntactically valid mutations** from that first run, plus their measured later disposition. A surviving mutation is a coverage observation, not a newly established production defect or customer incident.

After the first run finished, 29 real-handler controls were added to the existing 33 in [webhook-mutation.test.mjs](../../test/revenue/webhook-mutation.test.mjs). The focused offline run at **2026-09-27T06:19:18.227Z** passed **62/62**, with zero failures, TODOs, skips or cancellations; Node v25.9.0, exit 0. Root's survivor rerun subsequently measured **84 additional kills**. No production source or pre-existing test was changed. The mapped rerun contains the same strengthened test-file hash recorded below.

## Evidence and bounds

- Whole first catalogue: **1822**, correcting the earlier 1922 summary typo.
- [Archived sanitized first exhaustive result](evidence/S7-first-exhaustive.json), run start `2026-09-27T06:00:38.555Z`; artifact records test checkpoint `e4f913765f7c241505fcff959d1617114dfedcea`.
- Archived report SHA256: `735942c25a1b6420d1fbf2a43a2f437eaeebc82c0190666216a4e092a455a21b`.
- Pinned [stripe-webhook.js](../../functions/api/stripe-webhook.js) SHA256: `313aa39ca34c6f6af6f96f61ce75cde58267c4d00f7a022b652c7076e3716fd5`. All source line references below use this unchanged source.
- SHA256 of `JSON.stringify(report.results.filter(r => r.file === "functions/api/stripe-webhook.js"))`, in report order: `9dba409c22e0bb81543561c3792f139d38fc1b3b16673768877b8f38462c54c9`. The archived local and sanitized report subsets agree.
- First strengthened test file SHA256 (62 tests, used by the measured first survivor rerun): `217315f8b9ab323f6fb5a725f5a5e6f6751157962ce158a24829a295def9dc2f`.
- Latest closure test file SHA256 (80 tests): `db1edbedfc66542b21f3bcc733bf0cc819724f9590267da0f38922ae1a611e5e`.
- The first-run mapped webhook suite had 91 tests: 62 hard passes and 29 TODOs on the surviving/unclassified rows. TODO failures do not kill mutations. The later 62-test focused file result is a different scope and checkpoint.
- The focused command was `node test/harness/run.mjs test/revenue/webhook-mutation.test.mjs`. Its returned summary is recorded above. The runner's shared `last.*` files can be overwritten by Root's later runs; their current contents are not represented here as immutable evidence of that focused run.
- All execution used synthetic records, actual exported handlers, the isolated source override, fixed clock, in-memory R2 and closed transport. No network, live data, credentials, production operation, workflow or external send was used. Risk fixtures with pre-resolved flat identities are compatibility checks, not claims about standard provider event schemas.

## Measured survivor rerun

The [archived first survivor rerun](evidence/S7-second-survivors.json) ran from **2026-09-27T06:23:18.118Z** to **06:26:51.536Z**. The sanitized archive SHA256 is `6afc9ab8e2bb40cb9743e174d796ac4c89cc49c6394af9c661e8b55c64025634`; its 143 webhook result rows hash to `e50ba249a855576871805c89a33976beeae8efdfb221d04459581893b4243b24` using the same JSON-array method. The original local raw rerun SHA256 was `260918d95d3aba74ba348e62a254f9b6bee99972e5f72780e43740ffb3510475`. It selected 143 webhook candidates: the 142 previously surviving/unclassified valid candidates and the prior invalid candidate. Outcomes were **84 killed, 56 survived, two unclassified errors, one invalid**.

The combined 333 kills carry forward the original 249 and add the measured 84. This is a combined two-run result, not a claim that all 391 valid candidates were freshly executed against the strengthened tests. Source hashes agree, and the original tests were preserved. The runner records the strengthened test hash `217315f8b9ab323f6fb5a725f5a5e6f6751157962ce158a24829a295def9dc2f`, original webhook test hash `944cbd7450f341e14cc45889e4fc04501da3630950f4db305b82ca5201430f75`, and harness/runner hashes. Remaining valid rows show **120 mapped tests: 91 hard passes and 29 TODOs**, zero parsed hard failures.

| Current disposition | Count | Treatment |
| --- | ---: | --- |
| Killed on rerun | 84 | Measured additional kills; detailed rows below retain the first-run contract review. |
| G: meaningful uncovered contract | 26 | Remains a genuine coverage gap. Not a policy/equivalence exclusion. |
| K: existing failing TODO or contract decision | 20 | Keep visible until its underlying issue or supported contract is resolved. |
| E: bounded equivalent exported effect | 9 | Scope of equivalence is stated per ID; no universal exclusion. |
| R: capability not reached by current handler | 1 | Private HMAC-key extraction capability differs; handler cannot exercise it. |
| X: unclassified nonzero outcome | 2 | Repeatedly unresolved. Neither killed nor equivalent. |
| Total reviewed valid remainder | 142 | Includes all originally surviving/unclassified valid IDs. |

The remaining **26 G** cases are 13 asynchronous completion boundaries, five machine-result indicators, four owner identity/date presentation branches, two missing-object state results, one address-object recipient guard, and one current-ID-only recovery path. The U table below shows these remaining cases first and marks them **G: survived**, followed by the newly killed cases. The later closure controls below now target all 26 G cases. Their baseline pass does not change these recorded mutation outcomes.

## Priority and disposition

The strongest uncovered contracts were a first-character-only HMAC mismatch, unrelated subscriber isolation in flag/clear helpers, fail-closed zero-value eligibility reads, fallback-only/legacy identities, token persistence, and a successful single referral. The new controls target those directly. **The HMAC issue is in the mutant, not the unchanged source**; the original compares every character.

At the first survivor checkpoint, meaningful open coverage remained around delayed successful state writes and notifications, ID-only recovery, missing-object state results, machine success/error indicators, and complete owner evidence. The subsequent D1-D18 controls use bounded gates that always release and drain, and the closing run killed all 26 G IDs. Such tests must not declare an ignored storage/provider failure correct just to reject a mutant.

Several survivors overlap known failing C01/C02/C04a/C05/C19/C20 contracts or require a business decision. Those remain separate from equivalent changes. In particular, the backfill OR mutations on lines 428 and 450 require a conflicting present-ID/same-email path already covered by a failing C04a TODO; healthy missing-ID controls do not distinguish them.

The two unclassified rows, `8dd302a16916021e` and `30f21bd8f9cd8bf2`, remain unclassified on the strengthened rerun: 120 tests, 91 passes, 29 TODOs and zero parsed hard failures, but a nonzero runner outcome. The first run had the analogous 91/62/29 counts. Neither result row preserves the underlying diagnostic body/status needed to explain these exits. Their removed-await effects are valid candidates, but **neither a mutation kill nor an equivalent change is established**. Root owns diagnostic resolution.

## Exact token semantics

The mutator finds AST locations but replaces raw tokens without adding parentheses. JavaScript reparses operator precedence. For example, changing the last OR in `a || b || ""` produces `a || b && ""`, which means `a || (b && "")`.

This matters for `f699e42f99d582cc`: the emitted checkout expression is `o.customer_details?.email || o.customer_email && ""`. For `c4efe27b1431e9de`, it is `o.customer_email || (o.customer_details && o.customer_details.email) && ""`. Each preserves the first truthy identity and loses only the fallback. An early concern about a runner contradiction was withdrawn after inspecting these exact expressions. No runner discrepancy is asserted for either.

The same review was applied to the multi-line risk expression at line 109 and the referral condition at line 219. The tables describe emitted behavior, not an imagined parenthesized replacement.

## Controls added after the first run

Control labels below are shorthand for these actual test groups. They are not new invariant IDs.

| Label | Cases | Exact test name or shared name prefix and contract |
| --- | ---: | --- |
| T1 | 1 | [L356](../../test/revenue/webhook-mutation.test.mjs#L356): `I01 exhaustive contract rejects a full-length HMAC differing only in its first character`. Consequential signed checkout; one nibble changed; 400 and zero effects. |
| T2 | 2 | [L374](../../test/revenue/webhook-mutation.test.mjs#L374): `I02 exhaustive contract does not treat ... as the zero-value trial exception`, for a zero-value one-time payment and one-cent subscription payment. |
| T3 | 1 | [L387](../../test/revenue/webhook-mutation.test.mjs#L387): `I04 exhaustive compatibility contract enrolls a checkout using customer_email alone`. Stored identity/string name, token and actual download link. |
| T4 | 5 | [L406](../../test/revenue/webhook-mutation.test.mjs#L406), [L422](../../test/revenue/webhook-mutation.test.mjs#L422), [L438](../../test/revenue/webhook-mutation.test.mjs#L438), [L538](../../test/revenue/webhook-mutation.test.mjs#L538): failed-invoice details-email-only identity; current-ID/changed-email plus bystander; missing stored-ID backfill; no identity and unrelated identity negatives. The latter two use `I18 exhaustive contract does not claim to flag a failed invoice with ...`. |
| T5 | 4 | [L451](../../test/revenue/webhook-mutation.test.mjs#L451), [L463](../../test/revenue/webhook-mutation.test.mjs#L463), [L474](../../test/revenue/webhook-mutation.test.mjs#L474), [L484](../../test/revenue/webhook-mutation.test.mjs#L484): recovery with changed email/bystander; details-email-only recovery; persisted legacy backfill with no old flags; email-only approved review starting active. None selects automatic reactivation policy. |
| T6 | 4 | [L504](../../test/revenue/webhook-mutation.test.mjs#L504): `I17 I18 exhaustive compatibility contract holds ... using its email fallback without a customer ID`, one each for review, dispute and early warning. [L520](../../test/revenue/webhook-mutation.test.mjs#L520): resolved risk by customer ID with no email fields. Flat identities are explicit compatibility fixtures. |
| T7 | 3 | [L550](../../test/revenue/webhook-mutation.test.mjs#L550): `I02 exhaustive contract cannot deliver a zero-value renewal after roster ...`, for get failure, malformed JSON and non-array JSON. Requires no bundle/provider effect; deliberately does not pin the current success-shaped error explanation. |
| T8 | 3 | [L570](../../test/revenue/webhook-mutation.test.mjs#L570), [L581](../../test/revenue/webhook-mutation.test.mjs#L581), [L595](../../test/revenue/webhook-mutation.test.mjs#L595): legitimate current re-enrollment, durable missing-token backfill, and preservation of an existing customer ID when checkout omits it. Does not settle older-event ordering. |
| T9 | 5 | [L605](../../test/revenue/webhook-mutation.test.mjs#L605): `I05 exhaustive contract records one valid referral and sends its instruction only to the configured owner`. [L637](../../test/revenue/webhook-mutation.test.mjs#L637): no credit for case-insensitive self-referral, unknown code, invalid short code even if seeded, or ordinary trade selection with a seeded sliced suffix. Requires a usable stored buyer share link without fixing its hash algorithm. |
| T10 | 1 | [L652](../../test/revenue/webhook-mutation.test.mjs#L652): `I02 I04 exhaustive contract appends renewal evidence and renders weekly wording without a referral block`. Healthy append preserves an existing row; it does not endorse swallowed logging failures. |

Referral tests prove saved attribution and a configured-owner instruction in the closed transport. They do not prove a financial credit was applied, that a provider delivered to an inbox, or that duplicate events are idempotent. The C03 replay TODO stays separate. Names/addresses in all tests are synthetic.

## Closure controls for all 26 remaining G gaps

At **2026-09-27T06:40:14.611Z**, the same focused command passed **80/80**, zero failures, TODOs, skips or cancellations, exit 0 on Node v25.9.0. This adds 18 cases to the prior 62. The source hash is unchanged. The 80-test count comes from the direct returned runner summary; another agent subsequently overwrote the shared `last.*` files, so their later contents are not attributed to this run.

The eleven delayed cases hold successful in-memory writes or the closed owner transport, race operation entry against handler completion, inspect the visible persisted state/provider messages while held, and unconditionally release and drain in `finally`. The selected write is identified by its business state/key, not by a brittle nth-operation count. The tests keep the real handler and original fake operation; they do not copy its business decision logic. An event-loop turn allows detached closed effects to finish before checking acknowledgment. No gate tests manufacture a provider acceptance/rejection rule or settle an existing storage-error TODO.

The helper is at [L673](../../test/revenue/webhook-mutation.test.mjs#L673) and the race/cleanup at [L710](../../test/revenue/webhook-mutation.test.mjs#L710). If a mutant bypasses the selected operation, handler completion wins the race and fails the assertion; cleanup still releases the hold. Detached controlled promises are observed and drained before global world state is restored.

| Label and exact case | Target mutation IDs | Observable contract |
| --- | --- | --- |
| D1 [L740](../../test/revenue/webhook-mutation.test.mjs#L740): `I17 closure contract awaits the failed-payment owner transport and identifies an ID-only customer` | `2d8ce569d238e5f6`<br>`ecdfc9b664ad8ff5`<br>`6a9f93fa0c1d4420` | Holds owner transport after the flag is durable; requires the available customer ID in the subject/body. |
| D2 [L754](../../test/revenue/webhook-mutation.test.mjs#L754): `I17 closure compatibility contract awaits the resolved-risk owner transport after persisting its hold` | `5f2d3da5ac27a223` | Resolved flat identity is explicit compatibility input; the persisted hold/flag is visible before the owner transport finishes. |
| D3 [L770](../../test/revenue/webhook-mutation.test.mjs#L770): `I17 closure contract persists a failed-payment flag before acknowledging or describing it to the owner` | `e5464b5b580f4f4c`<br>`e89e3508a954ffe1` | Holds flag persistence, requires no premature owner notice, then extracts the complete next-retry date rather than accepting a substring. |
| D4 [L788](../../test/revenue/webhook-mutation.test.mjs#L788): `I17 closure compatibility contract persists a resolved-risk flag before acknowledgment and owner notice` | `22dd962c3ab53b58` | Selects the risk-detail write by its state contents; deactivation is already stored but no completed flag/owner claim is allowed yet. |
| D5 [L805](../../test/revenue/webhook-mutation.test.mjs#L805): `I17 I18 closure contract awaits ID-only review.closed recovery persistence` | `62b137c45ea4db12`<br>`87eb26327eb25e2c`<br>`04833ef26bb3ca01` | Holds clearing of flags on an already-active row; the owner instruction follows durable clearing and uses the available ID. |
| D6 [L805](../../test/revenue/webhook-mutation.test.mjs#L805): `I17 I18 closure contract awaits ID-only invoice.payment_succeeded recovery persistence` | `a53b9815b9590795`<br>`36e897437475ae56` | Current customer ID is the only matching identity; success cannot precede durable recovery. No customer mail or reactivation policy is asserted. |
| D7 [L827](../../test/revenue/webhook-mutation.test.mjs#L827): `I04 closure contract persists existing-row re-enrollment before the customer provider attempt` | `5bc25fa64e958003` | A current successful checkout waits for its active/token state to persist before sending the token-bearing customer link. |
| D8 [L842](../../test/revenue/webhook-mutation.test.mjs#L842): `I16 closure contract acknowledges cancellation only after the changed roster is persisted` | `ef915a3da5d30655`<br>`0e028ac165d65504` | Requires persisted cancellation plus a truthful success/count response; the old active row remains visible while the put is held. |
| D9 [L857](../../test/revenue/webhook-mutation.test.mjs#L857): `I04 I05 closure contract persists the referral lookup before emailing its customer link` | `1a836d1efaf7b9ec` | Holds the share-code lookup write; the customer must not receive its usable link before that lookup exists. |
| D10 [L872](../../test/revenue/webhook-mutation.test.mjs#L872): `I05 closure contract persists referral attribution before the owner instruction and acknowledgment` | `7cd13ab3470d8351`<br>`87edd57c2b99b7db` | Holds credit-instruction storage after customer delivery; no owner instruction or handler completion may outrun it. |
| D11 [L893](../../test/revenue/webhook-mutation.test.mjs#L893): `I05 closure contract awaits the referral owner transport after attribution is stored` | `1c6b5f7ec72d5608` | Holds the owner-only instruction transport after credit attribution exists; does not assert a real financial credit or inbox receipt. |
| D12 [L912](../../test/revenue/webhook-mutation.test.mjs#L912): `I04 closure contract acknowledges a checkout with missing recipient without attempting delivery` | `cbaf9fd9e17b9533` | A recognized event with no recipient has a successful no-delivery acknowledgment and zero storage/provider effects. |
| D13 [L924](../../test/revenue/webhook-mutation.test.mjs#L924): `I02 closure contract acknowledges a zero-value renewal without a known subscriber as a no-delivery result` | `fd94f5366bc02241` | Uses a successfully read empty roster, not a storage error; requires a truthful acknowledged skip and no bundle/provider effect. |
| D14 [L941](../../test/revenue/webhook-mutation.test.mjs#L941): `I04 closure contract exposes a missing bundle as both HTTP and machine failure before mail` | `acc6dde12428b8af` | A missing bundle returns HTTP 500 plus ok:false without enrollment or mail. |
| D15 [L953](../../test/revenue/webhook-mutation.test.mjs#L953): `I04 closure contract exposes a bundle read exception as a machine failure without pinning raw error text` | `e4b5cfe3eb8e09b9` | A bundle preflight read error returns HTTP 500 plus ok:false; the existing C19 raw error-text defect is not blessed. |
| D16 [L966](../../test/revenue/webhook-mutation.test.mjs#L966): `I16 closure contract reports zero changed rows when cancellation finds no roster object` | `d65dece1e2667d0b` | Successful missing-object read cannot claim a fictitious changed row. A thrown read and corrupt existing object are distinct cases. |
| D17 [L977](../../test/revenue/webhook-mutation.test.mjs#L977): `I17 closure contract reports no payment flag when the roster object is absent` | `9cb46c55f57f3a57` | Requires no fictitious flag or created roster, with an owner no-match explanation. |
| D18 [L988](../../test/revenue/webhook-mutation.test.mjs#L988): `I02 I04 closure contract never treats an invoice address object as a recipient email` | `6439b5c4c4c66fed` | An address without email cannot cause a provider attempt. No customer_address.email extension or provider response behavior is invented. |

These 26 IDs exactly match the G remainder from the first survivor rerun, with no equivalence or policy reclassification used to remove a gap. The closing outcome below now establishes all 26 kills. The two unclassified exits and the K/E/R cases retain their separate dispositions.

## Complete survivor classification

Every ID below is from the first valid remainder and appears in exactly one first-review disposition group. Multiple IDs on one row share the stated basis, but each retains its source line. The separate rerun column gives its measured outcome at the first survivor rerun. D labels are later closure targets; they do not yet assert final kills. `Open` records that no specific new hard control was predicted for that row; it is not an override of a measured kill. A T group identifies the intended discriminating new control, while the archived rerun contains the actual failing test names.

| Class | Count | Meaning |
| --- | ---: | --- |
| U | 110 | Meaningful uncovered observable contract in the first run; some now have new hard-pass controls. |
| K | 22 | Known failing TODO, unchosen/unsupported contract, or unclassified error requiring separate resolution. Not excused as equivalent. |
| E | 9 | Equivalent/no observable exported-handler change under the explicitly stated domain. |
| R | 1 | Changed capability is not reachable through the current exported handler; no universal security-equivalence claim. |

### U: First-run observable contracts, with remaining G gaps first

| Mutant IDs and pinned source lines | Precise basis | New controls / disposition | Measured rerun |
| --- | --- | --- | --- |
| `0e028ac165d65504` [L44](../../functions/api/stripe-webhook.js#L44) | Cancellation result says ok:false after a successful persisted revocation. Existing tests inspect the count/state but not this success indicator. | D8 (closure target) | **G: survived** |
| `2d8ce569d238e5f6` [L68](../../functions/api/stripe-webhook.js#L68) | Failed-payment acknowledgment can detach the owner transport. Needs a delayed transport control for this entrypoint; the existing approved-review timing test covers another call site. | D1 (closure target) | **G: survived** |
| `ecdfc9b664ad8ff5` [L69](../../functions/api/stripe-webhook.js#L69) | With no email, a real customer ID is replaced by the unknown-customer subject fallback. Existing absent-email test checks the body but not this subject. | D1 (closure target) | **G: survived** |
| `6a9f93fa0c1d4420` [L73](../../functions/api/stripe-webhook.js#L73) | The failed-payment owner body hides a supplied customer ID and can print an absent one. Add present/absent ID body checks without requiring any real identifier. | D1 (closure target) | **G: survived** |
| `e89e3508a954ffe1` [L77](../../functions/api/stripe-webhook.js#L77) | Retry-date text includes an extra ISO delimiter. The existing test only searches for the date substring; an exact extracted date field would detect the inaccurate presentation. | D3 (closure target) | **G: survived** |
| `22dd962c3ab53b58` [L118](../../functions/api/stripe-webhook.js#L118) | Risk handling can acknowledge before payment-flag persistence completes. Needs a delayed R2 put, released and drained even on assertion failure. | D4 (closure target) | **G: survived** |
| `5f2d3da5ac27a223` [L120](../../functions/api/stripe-webhook.js#L120) | Risk acknowledgment can detach the owner transport. Needs a delayed owner-only transport for this branch. | D2 (closure target) | **G: survived** |
| `62b137c45ea4db12` [L145](../../functions/api/stripe-webhook.js#L145) | Approved-review flag clearing can be detached before acknowledgment. Needs delayed state persistence, distinct from the existing delayed owner-transport test. | D5 (closure target) | **G: survived** |
| `04833ef26bb3ca01` [L146](../../functions/api/stripe-webhook.js#L146) | Approved-review subject substitutes the generic customer label when only a customer ID exists. Add ID-only owner-subject evidence. | D5 (closure target) | **G: survived** |
| `a53b9815b9590795` [L160](../../functions/api/stripe-webhook.js#L160) | Payment recovery can detach flag clearing before acknowledgment. A delayed R2 write would distinguish completion from mere invocation. | D6 (closure target) | **G: survived** |
| `cbaf9fd9e17b9533` [L168](../../functions/api/stripe-webhook.js#L168) | A recognized event with no usable delivery email returns ok:false. Need a supported missing-recipient fixture; do not send to an address object to force coverage. | D12 (closure target) | **G: survived** |
| `fd94f5366bc02241` [L183](../../functions/api/stripe-webhook.js#L183) | An unknown zero-value recipient skip returns ok:false. Its acknowledgment boolean lacks a hard assertion; storage-error controls deliberately avoid endorsing the current not-ours explanation. | D13 (closure target) | **G: survived** |
| `acc6dde12428b8af` [L190](../../functions/api/stripe-webhook.js#L190) | Missing-bundle HTTP 500 carries ok:true. Existing status checks do not fully constrain the machine-readable error indicator. | D14 (closure target) | **G: survived** |
| `87edd57c2b99b7db` [L220](../../functions/api/stripe-webhook.js#L220) | Referral attribution and owner notification can outlive the checkout acknowledgment. Needs a delayed valid-referral storage/transport gate; default immediate fakes can conceal the lost await. | D10 (closure target) | **G: survived** |
| `e4b5cfe3eb8e09b9` [L224](../../functions/api/stripe-webhook.js#L224) | The outer HTTP 500 response carries ok:true. Hard error tests currently constrain status more strongly than the machine error indicator. | D15 (closure target) | **G: survived** |
| `6439b5c4c4c66fed` [L259](../../functions/api/stripe-webhook.js#L259) | Without primary email, customer_address can become the recipient object, or absent address can throw. A normal address-without-email negative fixture should require no delivery to an object; it need not endorse the nonstandard address.email path. | D18 (closure target) | **G: survived** |
| `5bc25fa64e958003` [L321](../../functions/api/stripe-webhook.js#L321) | Existing-row enrollment may send before its put completes. C02 also has broader failure TODOs; a delayed successful put can test this distinct sequencing contract without pinning swallowed failure. | D7 (closure target) | **G: survived** |
| `d65dece1e2667d0b` [L383](../../functions/api/stripe-webhook.js#L383) | Cancellation claims one deactivation when the roster object is missing. A missing-roster negative control should require no fictitious changed row, without claiming readable-empty and read-error are equivalent. | D16 (closure target) | **G: survived** |
| `ef915a3da5d30655` [L396](../../functions/api/stripe-webhook.js#L396) | Cancellation acknowledgment can precede the roster put. Needs a delayed successful write and final persisted-state check. | D8 (closure target) | **G: survived** |
| `9cb46c55f57f3a57` [L420](../../functions/api/stripe-webhook.js#L420) | Missing roster falsely returns flagged=true. Add a missing-object control; the new unmatched-existing-roster case exercises a different path. | D17 (closure target) | **G: survived** |
| `e5464b5b580f4f4c` [L432](../../functions/api/stripe-webhook.js#L432) | Flag persistence can be detached. Use a delayed successful put before acknowledging, while retaining the separate storage-error contract. | D3 (closure target) | **G: survived** |
| `36e897437475ae56` [L440](../../functions/api/stripe-webhook.js#L440) | Removing ! from the customer-ID guard makes an ID-only recovery return before clearing flags. The new changed-email and email-only controls do not isolate absent email; a current-ID-only recovery fixture is still needed. | D6 (closure target) | **G: survived** |
| `87eb26327eb25e2c` [L457](../../functions/api/stripe-webhook.js#L457) | Recovery put can outlive the acknowledgment. Needs a controlled delayed successful write; immediate in-memory persistence masks timing. | D5 (closure target) | **G: survived** |
| `1a836d1efaf7b9ec` [L480](../../functions/api/stripe-webhook.js#L480) | The customer share link may be sent before its lookup object is persisted. A delayed successful code put should precede the customer provider call. | D9 (closure target) | **G: survived** |
| `7cd13ab3470d8351` [L493](../../functions/api/stripe-webhook.js#L493) | Owner referral instruction may precede attribution persistence. Needs delayed successful credit put and an owner-call observation at that boundary. | D10 (closure target) | **G: survived** |
| `1c6b5f7ec72d5608` [L499](../../functions/api/stripe-webhook.js#L499) | Referral owner transport can be detached before acknowledgment. Needs a delayed owner call restricted to the credit message, with cleanup/drain. | D11 (closure target) | **G: survived** |
| `c4efe27b1431e9de` [L61](../../functions/api/stripe-webhook.js#L61) | Raw-token precedence produces primaryEmail \|\| (detailsEmail && empty). A details-only failed invoice loses its email; redundant customer IDs masked the path. | T4 | killed |
| `a35f113dd2c5b890` [L63](../../functions/api/stripe-webhook.js#L63) | Missing attempt_count is stored as attempt 1 instead of unknown/default 0. A failed-invoice fixture omitting this field now checks the saved detail. | T4 | killed |
| `40d19c5ca2d7e998` [L69](../../functions/api/stripe-webhook.js#L69) | Owner subject chooses the customer ID when both identity fields exist, or loses the supplied email when customer is absent. New fallback-only owner-subject checks make the identified party observable. | T4 | killed |
| `812161d017cd3b8a` [L79](../../functions/api/stripe-webhook.js#L79) | The owner explanation reverses whether a row was found/flagged. New unmatched and no-identity cases require the NOT FOUND explanation. | T4 | killed |
| `70bb00cb29150a6a` [L84](../../functions/api/stripe-webhook.js#L84) | A successfully flagged failed-payment event returns ok:false. The fallback-only positive control now checks this success indicator. | T4 | killed |
| `72f9759d47f0978b` [L109](../../functions/api/stripe-webhook.js#L109) | The risk expression becomes primaryEmail \|\| (detailsEmail && billingEmail) \|\| empty. A details-only resolved compatibility event loses its identity. | T6 | killed |
| `93c6748fe2c14034` [L109](../../functions/api/stripe-webhook.js#L109) | The final risk fallback becomes billingEmail && empty. A billing-details-only resolved compatibility event loses its only email. | T6 | killed |
| `b5d8f40f2b89c90c` [L109](../../functions/api/stripe-webhook.js#L109) | The risk expression becomes (primaryEmail && detailsEmail) \|\| billingEmail \|\| empty. A primary-email-only resolved compatibility event loses its identity. | T6 | killed |
| `7e3c029069c56225` [L112](../../functions/api/stripe-webhook.js#L112) | A present risk customer ID becomes null. Existing email-bearing fixtures hide this; the ID-only resolved compatibility control now requires the actual hold. | T6 | killed |
| `15bbcb3eb1e830f3` [L121](../../functions/api/stripe-webhook.js#L121) | Risk owner subject replaces an available customer ID with unknown when email is absent. | T6 | killed |
| `7d3ea5f6fe181542` [L121](../../functions/api/stripe-webhook.js#L121) | Risk owner subject loses email-only identity or substitutes the ID for the supplied email. | T6 | killed |
| `0a5bc5f326a952d1` [L124](../../functions/api/stripe-webhook.js#L124) | Risk owner body replaces a provided email with the no-email placeholder. | T6 | killed |
| `1e0794e01d7b8ca2` [L125](../../functions/api/stripe-webhook.js#L125) | Risk owner body hides a supplied customer ID and can render an absent one. | T6 | killed |
| `05b0a055336559d6` [L136](../../functions/api/stripe-webhook.js#L136) | A resolved, persisted risk hold returns ok:false. New resolved compatibility cases check success; they do not select the unresolved-charge response policy. | T6 | killed |
| `2cb12606c1adc9ca` [L143](../../functions/api/stripe-webhook.js#L143) | Approved review discards customer_email. ID-bearing fixtures hide the lost email-only match; an already-active email-only row now checks flag clearing. | T5 | killed |
| `1cb28929d8bf1e71` [L146](../../functions/api/stripe-webhook.js#L146) | Approved-review subject loses the email-only party. New email-only recovery checks require that identity in the owner subject. | T5 | killed |
| `9f88eeb534c10f2d` [L153](../../functions/api/stripe-webhook.js#L153) | Completed approved review returns ok:false. The new already-active email-only recovery control checks success without choosing reactivation policy. | T5 | killed |
| `bdf40a306c23923b` [L161](../../functions/api/stripe-webhook.js#L161) | Recovery discards a details-only email because the last fallback changes precedence. | T5 | killed |
| `e38140b939a621b1` [L161](../../functions/api/stripe-webhook.js#L161) | Recovery now requires primary and details email together before using that path. A details-only fallback fixture demonstrates the missing match. | T5 | killed |
| `36ece2cac5ada178` [L161](../../functions/api/stripe-webhook.js#L161) | Recovery can pass the customer_details object instead of its email, or access a missing object. Fallback-only compatibility input exercises the guard. | T5 | killed |
| `aa179ec8082b1b88` [L165](../../functions/api/stripe-webhook.js#L165) | A harmless below-floor checkout skip returns ok:false. New negative floor controls check successful acknowledgment plus zero effects. | T2 | killed |
| `895ffdf26916d187` [L181](../../functions/api/stripe-webhook.js#L181) | The zero-value renewal gate fails open after a roster read/parse/schema error. New controls fail both the earlier recovery read and the independent gate read where needed, and require zero delivery effects. | T7 | killed |
| `0d7cf8447824ce41` [L196](../../functions/api/stripe-webhook.js#L196)<br>`aad0d8ac541800dd` [L196](../../functions/api/stripe-webhook.js#L196) | Referral-code minting moves from initial monthly purchase to weekly renewal. Positive referral-link and weekly-no-referral controls check the intended distinct behavior. | T9,T10 | killed |
| `85469a1ea7afcac1` [L197](../../functions/api/stripe-webhook.js#L197) | The customer share link receives a Promise rather than the generated stored code. The new positive attribution case requires a usable link resolving to the buyer's synthetic code record. | T9 | killed |
| `b4efe4fb875ba6ae` [L214](../../functions/api/stripe-webhook.js#L214) | An existing delivery log is parsed before its text resolves, so append fails silently. The new healthy append control retains an older entry and adds the new accepted delivery. | T10 | killed |
| `14a5077d79ccdd16` [L219](../../functions/api/stripe-webhook.js#L219)<br>`64b8994990fda8aa` [L219](../../functions/api/stripe-webhook.js#L219) | Valid monthly referrals no longer reach attribution. The new one-event positive test requires one stored credit instruction and one configured-owner message. | T9 | killed |
| `1c3d807033981bc9` [L219](../../functions/api/stripe-webhook.js#L219)<br>`ea45c0b4a15fa321` [L219](../../functions/api/stripe-webhook.js#L219) | Raw-token OR precedence admits ordinary monthly selection strings to referral handling. The new plumbing selection fixture seeds its otherwise-valid sliced suffix and requires no credit or owner instruction. | T9 | killed |
| `01e1d51d1c5ad995` [L220](../../functions/api/stripe-webhook.js#L220) | Referral prefix slicing drops the first code character, so a valid stored code is not credited. | T9 | killed |
| `d8746b13d04e9018` [L248](../../functions/api/stripe-webhook.js#L248) | A zero-value one-time payment is incorrectly treated as a trial, while genuine subscription trials are excluded. The new zero-value one-time negative control detects the former without endorsing unscoped trial enrollment. | T2 | killed |
| `0cfca29bd5717aa3` [L248](../../functions/api/stripe-webhook.js#L248) | A one-cent subscription becomes the special zero-value trial. The new one-cent negative control preserves the explicit floor without choosing product-specific trial entitlement. | T2 | killed |
| `f699e42f99d582cc` [L250](../../functions/api/stripe-webhook.js#L250) | Raw-token expression is details?.email \|\| customer_email && empty. A customer_email-only checkout loses its recipient; the new compatibility test omits details entirely. | T3 | killed |
| `a8529bd874120bb0` [L302](../../functions/api/stripe-webhook.js#L302)<br>`c8b0ba0bac814afa` [L302](../../functions/api/stripe-webhook.js#L302)<br>`0a3be8681320e286` [L302](../../functions/api/stripe-webhook.js#L302) | A legitimate same-customer re-enrollment either misses inactive state, keeps it inactive, or fails to persist the transition. The new current checkout control requires active=true, removal of cancellation, and preserved token. | T8 | killed |
| `be80f1965df3661a` [L303](../../functions/api/stripe-webhook.js#L303) | A generated token on an otherwise unchanged existing row is not persisted. The new missing-token control compares the stored token with the customer download link. | T8 | killed |
| `be8011bbf53c3088` [L317](../../functions/api/stripe-webhook.js#L317) | A repeated checkout lacking customer ID can erase the existing association because the guard becomes OR. The new omission fixture requires preservation of the current ID and portal token. | T8 | killed |
| `08cbc6f5bfb04c85` [L322](../../functions/api/stripe-webhook.js#L322) | Existing subscribers receive an empty download token even though their stored token remains valid. Re-enrollment/repeated-checkout controls now assert the actual token-bearing link. | T8 | killed |
| `a00ec9e5b2f8c501` [L328](../../functions/api/stripe-webhook.js#L328) | A supplied signup name becomes empty in the saved row. Existing tests check enrollment identity/date/token but omit the supplied name; a minimal field-integrity assertion remains available. | Open | killed |
| `8e3807690944f604` [L328](../../functions/api/stripe-webhook.js#L328) | Signup can store the whole details object as name, or throw when details is absent. The customer_email-only checkout now requires a successful record with a string empty-name fallback. | T3 | killed |
| `d4f83193ffbee472` [L416](../../functions/api/stripe-webhook.js#L416)<br>`e870a99816a0f62c` [L417](../../functions/api/stripe-webhook.js#L417) | Email-only payment failure loses its usable identity or returns before matching. The new details-email-only fixture removes incoming customer ID and checks flag persistence. | T4 | killed |
| `2029b76d15bcaeab` [L417](../../functions/api/stripe-webhook.js#L417) | An identity-free failed invoice falsely reports flagged=true. The new no-identity control checks false, no changed subscriber, and owner no-match wording. | T4 | killed |
| `ea23abbff3395255` [L422](../../functions/api/stripe-webhook.js#L422) | An unmatched invoice is reported flagged and can cause an unnecessary put. New unrelated/no-identity negatives require no fictitious flag. | T4 | killed |
| `e3464ed6a826e976` [L424](../../functions/api/stripe-webhook.js#L424)<br>`0bb61e811eaa8abd` [L425](../../functions/api/stripe-webhook.js#L425)<br>`d5a4cbc49d06e97a` [L425](../../functions/api/stripe-webhook.js#L425) | Broadened/inverted flag predicates can mutate unrelated subscriber rows. New two-row controls require the addressed customer's flag and byte-equivalent unrelated row, separately from the known same-email conflicting-ID C04a TODO. | T4,T6 | killed |
| `c8c0dfd4cdd8d0b3` [L425](../../functions/api/stripe-webhook.js#L425) | Email-only flag matching turns a nonempty stored email into empty. The new legacy/fallback-only controls exercise matching without a redundant current-ID match. | T4 | killed |
| `6c214a552a1eed50` [L428](../../functions/api/stripe-webhook.js#L428)<br>`f2e6d7bee81ed068` [L428](../../functions/api/stripe-webhook.js#L428) | Payment-failure ID backfill can be skipped or replace an existing ID with an absent value. New missing-stored-ID and missing-incoming-ID controls require backfill/preservation respectively; known conflicting-present-ID C04a stays separate. | T4 | killed |
| `6d19aab26c65a9c7` [L439](../../functions/api/stripe-webhook.js#L439)<br>`6afb7ef179a66c8e` [L440](../../functions/api/stripe-webhook.js#L440)<br>`085c2d999c77d206` [L440](../../functions/api/stripe-webhook.js#L440) | Recovery clears only when an altered combination of identifiers passes the guard. New email-only and changed-email current-ID controls isolate each supported identity path. | T5 | killed |
| `83b159a28a01637f` [L447](../../functions/api/stripe-webhook.js#L447) | Recovery requires both ID and email to match, so a current customer with a changed email retains stale flags. The new current-ID/changed-email control detects it. | T5 | killed |
| `19445c2bbbad3559` [L447](../../functions/api/stripe-webhook.js#L447)<br>`4bb721c9555efcb8` [L447](../../functions/api/stripe-webhook.js#L447)<br>`9604b4e7e6685f5c` [L448](../../functions/api/stripe-webhook.js#L448)<br>`5bfe061bfd9ca20f` [L448](../../functions/api/stripe-webhook.js#L448) | Broadened/inverted recovery predicates clear an unrelated customer's flags. The new two-flagged-row control requires the bystander to remain unchanged. | T5 | killed |
| `80464b48eb840a96` [L448](../../functions/api/stripe-webhook.js#L448) | Recovery's stored-email fallback discards its value. New email-only recovery requires flag clearing without relying on current-ID equality. | T5 | killed |
| `b70fdf083b303d75` [L450](../../functions/api/stripe-webhook.js#L450)<br>`0dd5387c51dff8c7` [L450](../../functions/api/stripe-webhook.js#L450)<br>`da2431dcf8f4c87a` [L450](../../functions/api/stripe-webhook.js#L450) | Recovery can miss ID backfill, overwrite an existing ID with an absent value, or leave backfill unpersisted when no old flags exist. New legacy-no-flag and incoming-ID-absent fixtures check the separate state effects. | T5 | killed |
| `13a7d7c2bc6ecebf` [L478](../../functions/api/stripe-webhook.js#L478) | Without awaited digest, code generation receives a Promise and can produce an empty code. The new positive referral case requires a usable link that resolves to its saved buyer record. | T9 | killed |
| `3152b03d3a83a750` [L487](../../functions/api/stripe-webhook.js#L487)<br>`c7f4c403f3c7981c` [L487](../../functions/api/stripe-webhook.js#L487) | Valid referral codes are rejected and malformed codes can proceed. Positive valid attribution and seeded-short-code rejection now cover both sides. | T9 | killed |
| `e82380dc2d6ee571` [L488](../../functions/api/stripe-webhook.js#L488) | Unawaited referral lookup is treated as an R2 object and text access fails, silently losing valid attribution. | T9 | killed |
| `1970d900ded8eccb` [L489](../../functions/api/stripe-webhook.js#L489)<br>`798aba26345cf50c` [L489](../../functions/api/stripe-webhook.js#L489) | An existing referral object returns early, so a valid referral receives no attribution. | T9 | killed |
| `27c7b2b2cde8f918` [L490](../../functions/api/stripe-webhook.js#L490) | Referral JSON is parsed before text resolves, silently dropping the credit instruction. | T9 | killed |
| `20c6903c9c80562f` [L491](../../functions/api/stripe-webhook.js#L491)<br>`69ef2fc3f3410a02` [L491](../../functions/api/stripe-webhook.js#L491)<br>`6bf1c3e41c5ae217` [L491](../../functions/api/stripe-webhook.js#L491)<br>`c3ed2e46623d5d7b` [L491](../../functions/api/stripe-webhook.js#L491)<br>`5c23f43d4ee79411` [L491](../../functions/api/stripe-webhook.js#L491) | Self-referral and valid-referral boundaries are inverted or weakened. New positive attribution and case-insensitive self-referral negative controls distinguish the intended effects without assuming actual financial credit application. | T9 | killed |
| `7ac9cceaf707f5dd` [L498](../../functions/api/stripe-webhook.js#L498) | Referral instruction ignores the configured owner destination. The positive test now requires the synthetic configured owner, without exposing or pinning the fallback address. | T9 | killed |
| `450f550f00d19d4c` [L527](../../functions/api/stripe-webhook.js#L527)<br>`bab7e93a3630790c` [L527](../../functions/api/stripe-webhook.js#L527) | Monthly/weekly wording is reversed. The new renewal control requires the weekly freshness wording. | T10 | killed |
| `3286e679ded9d312` [L529](../../functions/api/stripe-webhook.js#L529) | A referral code can appear as an ordinary customer selection. Positive referral attribution now requires no selection paragraph; ordinary plumbing selection still renders. | T9 | killed |
| `83c0b0eec7547a38` [L530](../../functions/api/stripe-webhook.js#L530) | A valid generated share code loses its link and missing codes can produce an empty link. The positive referral control requires a usable saved link. | T9 | killed |
| `876a9a06a8ae9857` [L557](../../functions/api/stripe-webhook.js#L557)<br>`8d8123ec3dc64579` [L557](../../functions/api/stripe-webhook.js#L557) | Weekly delivery receives the monthly subject. The new renewal control checks the meaningful weekly/monthly distinction. | T10 | killed |
| `7c966d3b1d1a0302` [L587](../../functions/api/stripe-webhook.js#L587) | Skipping signature character zero admits a full-length signature differing only there. The new negative signs the consequential checkout with the harness, changes exactly its first HMAC nibble, and requires 400 with zero effects. | T1 | killed |

### K: Existing TODOs, contract decisions and unresolved errors

| Mutant IDs and pinned source lines | Precise basis | New controls / disposition | Measured rerun |
| --- | --- | --- | --- |
| `8dd302a16916021e` [L216](../../functions/api/stripe-webhook.js#L216) | UNCLASSIFIED ERROR: removing await from delivery-log put produced no parsed hard failure but a nonzero process outcome. This touches the existing C02 evidence-failure boundary; raw diagnostics are absent, so neither a kill nor equivalence is established. | Unresolved runner diagnostic | **X: unclassified** |
| `f1469ac2d4427fa7` [L216](../../functions/api/stripe-webhook.js#L216) | Retention changes from 50 to 51 entries. No approved contract establishes exactly 50 as correct; pinning this count would preserve an arbitrary limit rather than settle C20 evidence retention. | Open | K: survived |
| `9d3941708ff28adc` [L224](../../functions/api/stripe-webhook.js#L224)<br>`d550d5610ac8eada` [L224](../../functions/api/stripe-webhook.js#L224) | This changes raw exception-string selection. C19 already requires a safe error contract; do not add a passing test that pins leakage of the current exception text. | Open | K: survived |
| `ccb87e5ff1146120` [L248](../../functions/api/stripe-webhook.js#L248) | Changing the fallback zero to one suppresses all zero/absent-amount subscription trials. Positive trial entitlement cannot be promoted without C01 product identity; testing arbitrary zero-value enrollment as good would pin the known product-routing gap. | Open | K: survived |
| `761f68f19e19b72a` [L259](../../functions/api/stripe-webhook.js#L259) | Only the customer_address.email fallback is lost. This is a nonstandard compatibility field, not evidence about ordinary Stripe invoice addresses. Keep the existing compatibility limitation explicit before adding a hard policy-dependent recipient contract. | Open | K: survived |
| `34031eb3f66a057f` [L260](../../functions/api/stripe-webhook.js#L260) | Raw expression amount_paid \|\| total && 0 changes zero/missing-paid invoices with nonzero total into the known-subscriber route. Decide authoritative amount/product semantics before asserting that total alone authorizes delivery; C01 remains open. | Open | K: survived |
| `8f87e715e0416434` [L260](../../functions/api/stripe-webhook.js#L260) | Raw expression amount_paid && total \|\| 0 substitutes total for nonzero amount_paid. Tests currently use equal paid/total amounts. A supported differing-fields contract needs explicit amount semantics; do not invent ordinary provider payload guarantees. | Open | K: survived |
| `be7f61f871847e60` [L301](../../functions/api/stripe-webhook.js#L301) | Initializing changed=true adds a redundant whole-roster put when enrollment changes nothing. Healthy outputs match, but faults/races can differ (C02/C05). Exact write suppression is not an approved customer contract, so no artificial operation-count assertion was added. | Open | K: survived |
| `30f21bd8f9cd8bf2` [L335](../../functions/api/stripe-webhook.js#L335) | UNCLASSIFIED ERROR: removing await from new-roster put produced a nonzero process outcome with zero parsed hard failures. C02 fault handling is already a TODO; a saved diagnostic and isolated rerun are required before attributing the exit. | Unresolved runner diagnostic | **X: unclassified** |
| `a67fa6eadba99464` [L408](../../functions/api/stripe-webhook.js#L408) | A caught cancellation storage error reports one changed row instead of zero. Baseline also returns success without proving the operation; specify an explicit unresolved/durability outcome rather than pinning zero as correct under a failed read/write. | Open | K: survived |
| `bbf4b0d080f627c4` [L428](../../functions/api/stripe-webhook.js#L428) | Changing backfill AND to OR overwrites a present stored ID when a different incoming ID reaches the same-email match. That path is already the failing C04a identity-conflict TODO. Healthy missing-ID fixtures do not distinguish it; do not claim they cover this mutation. | Known C04a TODO | K: survived |
| `3710bf0fd8d8d26a` [L434](../../functions/api/stripe-webhook.js#L434) | A caught flag-storage error reports success. Baseline's false return still does not expose the storage failure distinctly; require a designed durable/unresolved result rather than bless either misleading acknowledgment. | Open | K: survived |
| `e566a89fc1ee59dd` [L445](../../functions/api/stripe-webhook.js#L445) | Initializing recovery changed=true adds an otherwise redundant full-roster put. Healthy field outputs match, but faults/races can differ; exact write count is not the business requirement (C02/C05). | Open | K: survived |
| `12412d8f4077e4af` [L450](../../functions/api/stripe-webhook.js#L450) | Changing recovery backfill AND to OR can overwrite a conflicting present customer ID through the existing same-email C04a defect. Equal-ID and one-ID-missing controls do not distinguish this case. Preserve the desired conflict TODO rather than pinning the partially broken path. | Known C04a TODO | K: survived |
| `cebff55ed835a23d` [L479](../../functions/api/stripe-webhook.js#L479)<br>`9d3348725fd127f0` [L479](../../functions/api/stripe-webhook.js#L479)<br>`5cb87317a51d3eec` [L479](../../functions/api/stripe-webhook.js#L479)<br>`9404189765bf9803` [L479](../../functions/api/stripe-webhook.js#L479) | The generated referral identifier changes radix/padding/slice, while link and newly stored key can still agree. No approved requirement fixes this algorithm or exact length. Existing-link compatibility, collision/entropy and cross-release identity stability need their own contract; no present broken link is established merely by changed bytes. | Open | K: survived |
| `b9286d430eed84d5` [L562](../../functions/api/stripe-webhook.js#L562)<br>`9e6a374380dda01c` [L562](../../functions/api/stripe-webhook.js#L562)<br>`a56669617dd62ae8` [L562](../../functions/api/stripe-webhook.js#L562) | These change the provider-error TypeError/text window. C19's desired privacy assertion already fails on raw provider text; do not hard-pin the leaked body, exact slice, or its replacement TypeError just to count a kill. | Open | K: survived |

### E: Equivalent at the stated observable boundary

| Mutant IDs and pinned source lines | Precise basis | New controls / disposition | Measured rerun |
| --- | --- | --- | --- |
| `57f92b20bf20ed39` [L175](../../functions/api/stripe-webhook.js#L175) | Initial known=true is overwritten by list.some(...) on every successful try path, or by catch known=false on every thrown path, before the only later use. | Open | E: survived |
| `08a417aea4413285` [L249](../../functions/api/stripe-webhook.js#L249) | Only falsy amounts change from zero to one at the separate floor expression. Both values remain below MIN_CENTS=500, and isTrialStart is computed independently, so the resulting branch is unchanged. | Open | E: survived |
| `825e0faa4c1fa316` [L594](../../functions/api/stripe-webhook.js#L594)<br>`7d4189d4232409b3` [L594](../../functions/api/stripe-webhook.js#L594)<br>`67b4c0b4741c8c11` [L595](../../functions/api/stripe-webhook.js#L595)<br>`09edd90541994b9d` [L595](../../functions/api/stripe-webhook.js#L595)<br>`af361928a5b39ea4` [L595](../../functions/api/stripe-webhook.js#L595)<br>`a1723db62dd52ad3` [L595](../../functions/api/stripe-webhook.js#L595) | Only private mismatch diagnostic prefix bytes change. The exported handler at lines 29-31 returns error and reason, not these fields; accepted signatures return earlier. No key/prefix exposure or private helper test is added. | Open | E: survived |
| `1dc8c1481b66bbd1` [L602](../../functions/api/stripe-webhook.js#L602) | Changing chunk size 32768 to 32769 still partitions every byte once, in order, and concatenates the same binary string before base64. This is equivalent within supported argument-count capacity; no assertion is made about an unverified engine/resource boundary one argument apart. | Open | E: survived |

### R: Capability not reached by the handler

| Mutant IDs and pinned source lines | Precise basis | New controls / disposition | Measured rerun |
| --- | --- | --- | --- |
| `c76617b857b44716` [L581](../../functions/api/stripe-webhook.js#L581) | The HMAC key becomes extractable, but this private handle is used only by sign and is neither returned nor supplied to exportKey/wrapKey. Extraction is unreachable through the current exported handler; spying on an internal flag would not demonstrate a changed public effect. This is a defense-in-depth distinction, not universal cryptographic equivalence. | Open | R: survived |

## What this review does not establish

This review does not certify billing correctness or resolve the existing failing TODOs. There is no new observation of affected live customers. The source stayed at its pinned hash; no runtime code, policy, workflow, service state or another worktree was changed by this review. Existing initial-sample evidence remains a separate historical report.

The measured rerun is now recorded separately from the first-run review. Any later result must retain both checkpoints and leave unclassified errors unresolved unless actual diagnostics justify another classification. All 26 G cases were killed in the closing run recorded below. They were not waived or reclassified for score. The 20 K survivors are not equivalent exclusions. Do not treat the nine E plus one R cases as unconditional exclusions from every future threat model or runtime domain.

## Closing measured outcome

The [local closing survivor result](../../test/harness/.runtime/mutation/S7-closure-survivors.json) ran from **2026-09-27T06:42:11.520Z** through **2026-09-27T06:43:33.926Z**. Raw report SHA256: `62ac2c5b2315be08b6b0344a2c49876f6fd32810c388143f4ed03d8912085599`. Only its webhook rows were inspected for this closing reconciliation; the report's other source files and global totals are outside this section.

The webhook selection was **59 candidates: 26 killed, 30 survived, two unclassified errors, one invalid, zero timeouts and zero pending**. All 26 previously classified G IDs were selected and killed. No G ID was missing, reclassified or counted as equivalent. The two unclassified exits stayed unclassified. The prior invalid candidate stayed invalid and is excluded only from the valid-candidate denominator.

The result records unchanged source SHA256 `313aa39ca34c6f6af6f96f61ce75cde58267c4d00f7a022b652c7076e3716fd5` and the final 80-test file SHA256 `db1edbedfc66542b21f3bcc733bf0cc819724f9590267da0f38922ae1a611e5e`. Its surviving/unclassified valid rows show **138 mapped tests: 109 hard passes, 29 TODOs, zero parsed hard failures**. The extra 58 tests are the separately mapped original webhook scenario file; 138 is not the size of the focused 80-test file.

Combined accounting is **249 first-run kills + 84 first-strengthening kills + 26 closure kills = 359/391 valid (91.8%)**. This carries forward earlier measured kills with the same source hash and preserved tests. It is not a claim that all 391 valid candidates were freshly rerun in the closing pass. The historical combined summary is preserved as [S7-accumulated-before-fidelity.json](evidence/S7-accumulated-before-fidelity.json), generated at `2026-09-27T06:47:15.824Z`, SHA256 `33721197341580c3dce27fa3a483382243effef5ffb9ad9952c910881fb5b83c`. It is distinct from the later single-run final evidence below. No adjusted score discards K, E, R or unresolved valid cases.

### Exact G reconciliation

D labels resolve to the exact test names and line links in the closure-control table above. The labels below are derived from the closing result's actual `killedBy` values, not predicted associations. Some mutants fail more than one control.

| Target ID and pinned source line | Closing result | Actual failing closure cases |
| --- | --- | --- |
| `0e028ac165d65504` [L44](../../functions/api/stripe-webhook.js#L44) | killed | D8 |
| `2d8ce569d238e5f6` [L68](../../functions/api/stripe-webhook.js#L68) | killed | D1 |
| `ecdfc9b664ad8ff5` [L69](../../functions/api/stripe-webhook.js#L69) | killed | D1 |
| `6a9f93fa0c1d4420` [L73](../../functions/api/stripe-webhook.js#L73) | killed | D1 |
| `e89e3508a954ffe1` [L77](../../functions/api/stripe-webhook.js#L77) | killed | D3 |
| `22dd962c3ab53b58` [L118](../../functions/api/stripe-webhook.js#L118) | killed | D4 |
| `5f2d3da5ac27a223` [L120](../../functions/api/stripe-webhook.js#L120) | killed | D2 |
| `62b137c45ea4db12` [L145](../../functions/api/stripe-webhook.js#L145) | killed | D5 |
| `04833ef26bb3ca01` [L146](../../functions/api/stripe-webhook.js#L146) | killed | D5 |
| `a53b9815b9590795` [L160](../../functions/api/stripe-webhook.js#L160) | killed | D6 |
| `cbaf9fd9e17b9533` [L168](../../functions/api/stripe-webhook.js#L168) | killed | D12 |
| `fd94f5366bc02241` [L183](../../functions/api/stripe-webhook.js#L183) | killed | D13 |
| `acc6dde12428b8af` [L190](../../functions/api/stripe-webhook.js#L190) | killed | D14 |
| `87edd57c2b99b7db` [L220](../../functions/api/stripe-webhook.js#L220) | killed | D10, D11 |
| `e4b5cfe3eb8e09b9` [L224](../../functions/api/stripe-webhook.js#L224) | killed | D15 |
| `6439b5c4c4c66fed` [L259](../../functions/api/stripe-webhook.js#L259) | killed | D18 |
| `5bc25fa64e958003` [L321](../../functions/api/stripe-webhook.js#L321) | killed | D7 |
| `d65dece1e2667d0b` [L383](../../functions/api/stripe-webhook.js#L383) | killed | D16 |
| `ef915a3da5d30655` [L396](../../functions/api/stripe-webhook.js#L396) | killed | D8 |
| `9cb46c55f57f3a57` [L420](../../functions/api/stripe-webhook.js#L420) | killed | D17 |
| `e5464b5b580f4f4c` [L432](../../functions/api/stripe-webhook.js#L432) | killed | D3, D4 |
| `36e897437475ae56` [L440](../../functions/api/stripe-webhook.js#L440) | killed | D5, D6 |
| `87eb26327eb25e2c` [L457](../../functions/api/stripe-webhook.js#L457) | killed | D5, D6 |
| `1a836d1efaf7b9ec` [L480](../../functions/api/stripe-webhook.js#L480) | killed | D9 |
| `7cd13ab3470d8351` [L493](../../functions/api/stripe-webhook.js#L493) | killed | D10 |
| `1c6b5f7ec72d5608` [L499](../../functions/api/stripe-webhook.js#L499) | killed | D11 |

### Remaining survivors and unresolved exits

The existing precise per-ID reasoning in the earlier tables still applies. No still-meaningful G survivor is hidden in these groups, and a K classification is not an equivalence claim or a production fix.

| Disposition | Count | Remaining IDs and source lines |
| --- | ---: | --- |
| Known failing TODO / contract decision | 20 | `f1469ac2d4427fa7` (L216)<br>`9d3941708ff28adc` (L224)<br>`d550d5610ac8eada` (L224)<br>`ccb87e5ff1146120` (L248)<br>`761f68f19e19b72a` (L259)<br>`34031eb3f66a057f` (L260)<br>`8f87e715e0416434` (L260)<br>`be7f61f871847e60` (L301)<br>`a67fa6eadba99464` (L408)<br>`bbf4b0d080f627c4` (L428)<br>`3710bf0fd8d8d26a` (L434)<br>`e566a89fc1ee59dd` (L445)<br>`12412d8f4077e4af` (L450)<br>`5cb87317a51d3eec` (L479)<br>`9404189765bf9803` (L479)<br>`9d3348725fd127f0` (L479)<br>`cebff55ed835a23d` (L479)<br>`9e6a374380dda01c` (L562)<br>`a56669617dd62ae8` (L562)<br>`b9286d430eed84d5` (L562) |
| Bounded equivalent exported effect | 9 | `57f92b20bf20ed39` (L175)<br>`08a417aea4413285` (L249)<br>`7d4189d4232409b3` (L594)<br>`825e0faa4c1fa316` (L594)<br>`09edd90541994b9d` (L595)<br>`67b4c0b4741c8c11` (L595)<br>`a1723db62dd52ad3` (L595)<br>`af361928a5b39ea4` (L595)<br>`1dc8c1481b66bbd1` (L602) |
| Capability not reached by current handler | 1 | `c76617b857b44716` (L581) |
| Unclassified nonzero outcome | 2 | `8dd302a16916021e` (L216)<br>`30f21bd8f9cd8bf2` (L335) |

The unresolved IDs `8dd302a16916021e` (delivery-log put await removal) and `30f21bd8f9cd8bf2` (new-roster put await removal) again have no named hard failure in their saved result rows. Their nonzero outcomes are not successful test evidence, and the available row summaries do not establish the underlying diagnostic cause. They remain unresolved rather than being promoted to kills or waived as equivalent. No webhook timeout occurred in this closing selection.

This closing reconciliation changed documentation only. No additional test execution, source modification, service action or policy decision was performed. The unchanged production TODOs, provider-schema limits and actual-delivery/credit boundaries described earlier remain in force.

## Final single-run confirmation

The [final exhaustive catalogue](evidence/S7-final-exhaustive.json) ran from **2026-09-27T07:10:34.227Z** through **07:21:46.565Z**, with seed `S7-v1`, limit 2000 and three jobs. The saved catalogue contains all **1822 candidates**; every file's selected count equals its candidate count. This is one fresh run against one recorded source/test/harness hash set, not carried-forward kills from the earlier rounds. The [final mutation summary](evidence/S7-final-mutation.json), generated at **07:22:15.332Z**, summarizes that run.

The webhook portion freshly selected **392 unique candidates**: **359 killed, 30 survived, two unclassified errors, one invalid, zero timeouts and zero pending**. The valid denominator is **391** and the unadjusted score is **91.8%**. An ID-by-ID comparison with the historical accumulated summary found the exact same 392 IDs and no changed webhook outcome. All 26 IDs in the G reconciliation table above are killed in this fresh run. The K/E/R and unresolved classifications remain historical analytical judgments with their stated limits; the final run confirms their measured outcomes without widening those judgments.

Exact final evidence pins:

| Artifact or input | SHA256 |
| --- | --- |
| S7-final-exhaustive.json | `e90a7df474dfe5c5648d4f20177bd36582840a3d28dd7206d0d18f3eaaafdce2` |
| S7-final-mutation.json | `d9c92105187d999852ee2c3c42c38818b8ca3d8e14d51a21aae7cbe40b1516de` |
| Final exhaustive webhook rows, JSON-array method defined above | `26ba4c8dc83d11bfd04f354dac814f8d40b09b0d99f18af97a3594cb97f958e2` |
| functions/api/stripe-webhook.js | `313aa39ca34c6f6af6f96f61ce75cde58267c4d00f7a022b652c7076e3716fd5` |
| test/revenue/webhook.test.mjs | `944cbd7450f341e14cc45889e4fc04501da3630950f4db305b82ca5201430f75` |
| test/revenue/webhook-mutation.test.mjs | `db1edbedfc66542b21f3bcc733bf0cc819724f9590267da0f38922ae1a611e5e` |
| test/harness/index.mjs | `c05e5fbe06853c8d121564088a93836f0df85c177d2c3fbaacb7edf4fc2d2209` |
| test/harness/mutate.mjs | `35fb8047e7273654c41835d16f3f6da78ca5eeaf0b6d5a37a3b7222a24a6489c` |
| test/harness/package-lock.json | `0456d93f5aa0a9a96e643b00402ac6e7750f223d84c347de822f205552c33df0` |

The final mapped webhook baseline has **138 tests: 109 hard passes, 29 TODOs, zero hard failures**, exit 0. Both unresolved IDs, `8dd302a16916021e` and `30f21bd8f9cd8bf2`, again report 138/109/0/29 with nonzero unclassified outcomes and no named hard failure. The saved final rows still lack the underlying diagnostic cause. They remain unresolved and stay in the valid denominator; neither is a kill, a timeout, an equivalence waiver or proof of a production incident.

This update inspected saved results and changed this document only. It did not execute tests or mutations, change source/harness/tests, or access any service. The earlier accumulated artifact, hashes and dated tables are retained separately from the final single-run evidence.
