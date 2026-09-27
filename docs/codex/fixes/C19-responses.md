Webhook acknowledgments no longer include a purchaser address.
Owner-mail acknowledgments no longer echo the destination or subject.
Unexpected webhook failures return a fixed message while keeping HTTP 500.
The actual mail payloads and authorization decisions are unchanged.
Focused checks pass; the full suite still reports five structural failures.

# C19 response-only fix

Base: e4f913765f7c241505fcff959d1617114dfedcea.
Branch: claude/codex-fix-c19-responses.
Status: local checkpoint prepared for publication; draft creation awaits gh. No PR or deployment exists.

## D-12: owner recommendation

Question: Advance these four response changes as a separate draft fix for review?

Recommend: Yes. They remove unnecessary sensitive response content while preserving successful delivery fields, the actual mail and HTTP failure behavior. Keep all five full-suite structural failures explicit. This note does not waive the fifth static-address check or certify a green release; final merge disposition remains a separate review decision.

## Four production changes

| Source | Before | After |
| --- | --- | --- |
| [stripe-webhook.js:222](../../../functions/api/stripe-webhook.js#L222) | Successful delivery acknowledgment contains purchaser destination. | Returns only ok, delivered and bundle. |
| [stripe-webhook.js:224](../../../functions/api/stripe-webhook.js#L224) | Outer catch returns the exception message verbatim, including provider body snippets or storage/network diagnostics. | Returns HTTP 500 with exactly {ok:false,error:"webhook_failed"}. |
| [mail-owner.js:16](../../../functions/api/mail-owner.js#L16) | Unauthorized response includes auth.reason; the shared verifier can include raw exception text. | Returns the same HTTP 401 with only {error:"unauthorized"}. |
| [mail-owner.js:29](../../../functions/api/mail-owner.js#L29) | Success echoes the owner destination and caller-supplied subject. | Returns only {ok:true}. |

The owner-mail provider rejection path still returns HTTP 502 with its numeric provider-status diagnostic. The webhook missing-bundle path still returns HTTP 500 with its bounded internal bundle key. Successful mail requests keep the existing recipient, sender, subject, HTML and attachment bytes. No enrollment, payment, retry, referral, recipient selection or delivery-log behavior was changed.

## Regressions and controls

Two existing executed TODOs are promoted to ordinary assertions in [webhook.test.mjs](../../../test/revenue/webhook.test.mjs):

- I24 C19 successful webhook machine response contains no recipient identity.
- I24 C19 provider error response does not echo identity or bearer material.

Two [operations-mutation.test.mjs](../../../test/revenue/operations-mutation.test.mjs) checks now assert a safe acknowledgment shape and verify subjects through the actual outbound mail payload. The existing sender/recipient/body and default/160-character subject controls remain.

Seven ordinary cases in [response-privacy.test.mjs](../../../test/revenue/response-privacy.test.mjs) cover:

- Monthly and weekly successful webhook acknowledgments, with unchanged outbound destinations, attachment bytes and delivery-log records.
- A throwing bundle get and a throwing bundle body read, both before delivery.
- A provider network exception, with one attempted request and no successful delivery log.
- Owner-mail success with synthetic sensitive text in the requested subject and body, preserved in the intended mail but omitted from the response.
- Owner-mail authentication failure from a throwing certificate fetch, using a genuinely signed synthetic JWT; no body read, storage or mail occurs and no verifier exception reaches the response.

All fixtures are synthetic. Provider and certificate traffic stays inside the closed offline harness. A successful stubbed request proves the emitted request, not real inbox receipt.

## Before and after evidence

The focused command was identical before and after:

node test/harness/run.mjs test/revenue/webhook.test.mjs test/revenue/response-privacy.test.mjs test/revenue/operations-mutation.test.mjs test/revenue/auth-portal.test.mjs

The full command was identical before and after:

node test/harness/run.mjs

Node v25.9.0. No skipped or cancelled cases occurred in these runs.

| Run | UTC time on 2026-09-27 | Tests | Pass | Hard fail | TODO | Exit |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Before focused | 06:32:39.029 | 112 | 74 | 11 | 27 | 1 |
| Before full, committed LF bytes | 06:37:02.672 | 572 | 492 | 15 | 65 | 1 |
| After focused | 06:37:48.592 | 112 | 85 | 0 | 27 | 0 |
| After full | 06:38:03.943 | 572 | 502 | 5 | 65 | 1 |

The eleven intended privacy failures pass after the patch. The full pass count grows by ten because modifying mail-owner makes an additional static-address rule inspect an unchanged pre-existing fallback literal. That rule was not disabled, reclassified as passing or added to the runner's knownBaseline list.

Saved evidence under test/harness/.runtime has the same names for the JSON summary and corresponding .tap.txt file:

| Summary | SHA-256 |
| --- | --- |
| C19-before-focused-summary.json | be8302e2dda7c924b6d7186106e6c9c280b9680e092b1455ba423d6f04b095c5 |
| C19-before-full-summary.json | d44d06148b7cfd4e9296cbb4fe7fa7c6ed76e8bb86437097c86c1cddd93d1477 |
| C19-after-focused-summary.json | e8093e8a47b5077da75e4ba91a4ec25072955d1370a8131eb78ba09a88e039ec |
| C19-after-full-summary.json | dc490a13536b650b0fa367214bb3a0092443e1cef36d3590ad4922cf8bab8320 |

The retained five hard failures are:

1. P2-5 _headers gains exactly the /admin/mission block, outside the widget block.
2. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/.
3. P1-14 the diff from main lists only allowed paths.
4. P1-14 route strings never appear in non-test added files.
5. P1-14 no real email address in any added file.

The runner labels the first four knownBaseline and the fifth unexpected. The fifth reports mail-owner's existing fallback destination literal. Its source bytes are unchanged by this patch; printing or removing that address is outside this response-only change. The full suite remains nonzero.

## Checkout correction, preserved evidence

The new Windows checkout initially materialized CRLF while committed admin/functions/_headers blobs use LF. That caused newline-sensitive mission tests to fail before any production response edit: the demo module could not be parsed by its text extractor, source extraction and header regexes failed, and page byte size inflated.

With explicit root authorization, all 60 tracked paths in those three locations were first proven equal to HEAD after only CRLF-to-LF conversion. Git restore with the requested LF settings skipped the clean/stat-cached files; exact verified HEAD bytes were then written to 59 paths and all 60 paths were rechecked byte-for-byte. This introduced no Git source diff. No workflow or test/mission file was edited.

The two anomalous runs are retained separately rather than hidden:

| Summary | Tests / pass / fail / TODO | SHA-256 |
| --- | --- | --- |
| C19-before-full-crlf-summary.json | 564 / 478 / 21 / 65 | 67aab55351a3ae3549373f779bd116c39289e8f12b7993243157d1b2d2402317 |
| C19-before-full-restore-attempt-summary.json | 564 / 478 / 21 / 65 | 9bec0dacc212f1a4d7e1d2efe8d9e01761408c329af7570f2c0dc01d7451c44d |

Corresponding TAP files are preserved. The corrected before-full run and after-full run use the same committed LF source bytes apart from the four intentional response edits.

## Consumer evidence and compatibility

The five tracked workflow call sites use curl -fsS and leave the JSON response on stdout. They do not parse destination, subject or verifier-reason fields:

- [inbox-watchdog.yml:145](../../../.github/workflows/inbox-watchdog.yml#L145).
- [send-watchdog.yml:106](../../../.github/workflows/send-watchdog.yml#L106).
- [weekly-refresh.yml:1217](../../../.github/workflows/weekly-refresh.yml#L1217), :1422 and :1435.

These workflows were inspected only as source text and were not edited or executed. No tracked production consumer was found depending on the removed webhook destination field. External integrations are unverified; a consumer that depended on an omitted field must migrate to the retained operational fields or the HTTP status. The two local tests that depended on the echoed subject are adjusted as described above.

## Risks and partial scope

This reduces diagnostic detail in the machine response. It does not add a private diagnostics channel. Existing HTTP failures remain failures; mail-owner transport/body-read exceptions retain their previous behavior, and errors outside the webhook's existing outer try are not newly caught.

C19 remains open for its other surfaces: logs, sender/status responses, workflow wording, customer/owner templates, and other endpoints using shared auth diagnostics. This patch does not remove owner fallback literals, change source privacy policy, certify provider receipt or repair enrollment/idempotency behavior. It does not waive structural checks.

## Draft review body

Successful webhook responses currently echo the purchaser destination, and caught delivery errors can echo provider or storage details. The owner relay also echoes its destination, subject and authentication exception reason. This change removes those response fields and uses a fixed webhook failure code while preserving HTTP statuses and the actual outbound mail.

Validation: eleven intended privacy regressions now pass. The focused run is 85 pass, zero hard failures and 27 existing TODO; the full run is 502 pass, five explicitly retained structural failures and 65 TODO across 572 cases. No services or workflows ran. This is a response-only C19 improvement, not completion of the broader privacy finding.
