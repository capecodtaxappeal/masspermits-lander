# S6 failure injection

Source main remains 1068e8070. No production files changed on the harness branch.
Full run: 411 tests, 340 pass, four known baseline failures, 67 executed TODO, zero skips/cancellations or unexpected hard failures. Evidence: evidence/S6-full.json.

## Added evidence

auth-portal.test.mjs adds 13 passing scenarios: genuine generated Access assertions through header and cookie; invalid signature/issuer/audience/expiry/algorithm/key; missing configuration/assertion; escaped denial wording; real HTMLRewriter portal rendering and Unicode/hostile watermark escaping; stale dashboard withholding; owner relay rejection/recovery.

failure-injection.test.mjs adds 18 scenarios: 15 pass and three executed failing TODOs. The passing controls exercise 0, 1, 50 and 250 recipients, mixed provider 429/500/200 outcomes, a thrown bundle-body read, Monday midnight/noon/grace transitions, spring/fall DST boundaries, both repeated fall-back local instants, and 1,005 telemetry events across an R2 listing boundary. A failed second page performs no partial aggregate save or pruning. These are bounded local scenarios, not a performance test or real account inspection.

The D2 TODO label now records the owner's approved policy. It no longer says the policy is unresolved.

## Additional C08/I13 diagnostic counterexamples

Each case uses the actual sender to create the log and the actual watchdog to read it:
- S6 I13 earlier complete then later partial: both recipients already have provider acceptance this week, but a later forced partial run makes the diagnostic verdict partial.
- S6 I13 disjoint accepted recipients across two partial runs: the union covers both recipients, but choosing one run still returns partial.
- S6 I13 twelve identical-bundle skips do not erase a known accepted weekly outcome: twelve skip entries discard the accepted entry in the twelve-entry log, so status says stale_bundle despite exactly one provider acceptance.

Proposed rule: distinguish recipient coverage for the week from the outcome of the latest attempt, retaining both facts. The desired TODO verdict is not a license to hide a later failed attempt or authorize an automatic retry. Explicit force is used only to construct the two multiple-run histories; no force policy is selected. These are diagnostic counterexamples with stated preconditions, not reports of live duplicate or missed mail.

All three fixes touch frozen sender/status behavior. Queue them with C08 and rerun against both incoming main changes. Do not replace those changes or weaken the tests.

## Remaining limits

Storage failures, conflicting writers and duplicate Stripe event retries already have S2 cases. Workerd tests establish selected conditional-write semantics. Neither phase proves cloud timing, mail receipt, all R2 APIs, or a durable transaction across provider and storage. The largest roster is 250 synthetic rows and the largest telemetry listing is 1,005, not an unlimited-capacity claim.
The harness branch contains no production fix. C17, C15 and C04a are separate review branches, and their test totals belong to their own source snapshots.
