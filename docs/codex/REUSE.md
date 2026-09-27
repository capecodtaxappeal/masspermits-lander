# Existing work to reuse

Reviewed source base: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
These are local fetched refs, not live PR status checks. No PR API was called.

| Ref | Pinned head | Relationship |
| --- | --- | --- |
| origin/claude/mission-control | 46974b5399ef5c6e04637351fbe72ed604472898 | Ancestor of main; merged implementation and tests present |
| origin/claude/monday-rehearsal | 455808d9f6c19b8b0cea2da7645584ac42f71b2a | Unmerged local remote ref |
| origin/claude/public-output-gate | 2b10901d0a9100c655dc3cca9748229368345605 | Unmerged local remote ref |

## Reuse before building

Mission control already supplies an independent oracle, fake storage, generated auth fixtures, privacy/security tests and price-ID-scoped Stripe read logic. Preserve this work. A new revenue harness should test the actual paying endpoints, not rebuild its reconciliation UI or reader.

Monday rehearsal has useful primitives in test/rehearsal/harness.mjs: fake storage, deny-by-default fetch routing, recorded Resend requests, Stripe signatures, collected waitUntil tasks and generated-key OIDC fixtures. Its purchase_render.test.mjs invokes signed events through the webhook. handlers_harness.test.mjs exercises customer access with captured telemetry. reconcile.test.mjs covers identity joins and incomplete evidence. Its product/entitlement policy must still be checked against the owner's current one-product contract.

The public output gate is a warning-only content linter. Reuse later for copy/privacy checks where applicable; it is not proof of delivery or a replacement for handler scenarios.

## Fidelity gaps to fill

Mission FakeR2 supports conditional writes but its put drops metadata. Monday FakeR2 preserves metadata but does not establish pagination or conditional-write behavior. Consolidate or adapt selected primitives with explicit contract tests, rather than asserting either fake fully represents R2.

Monday HTMLRewriterStub does not rewrite HTML. Synthetic ZIP bytes do not prove valid archives. loadWeeklySend substitutes authentication, so its tests cannot claim to verify the real OIDC helper. The read-only bucket wrapper discards writes and cannot prove persistence or idempotency.

The old webhook decision test extracts source text with eval. Keep its floor regression coverage but add signed events through the real exported handler. Do not implement behavior copies in the new harness.

Do not run functions/api/all.test.mjs from the rehearsal branch wholesale. It also loads scripts/rehearsal tests that rehearse workflow shell. This program forbids running workflow code. Read YAML as text only when testing response contracts or trigger definitions.

## Review scope

The source review covered the reusable helpers, interface contracts and relevant test inventories on these branches. It did not audit every assertion or execute the branch suites. Re-fetch and compare pins before adopting code. No cherry-pick, merge, production edit or duplicate control was performed in S1.
