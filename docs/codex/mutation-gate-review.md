# S7 gate mutation review

Scope: the preserved first operator-stratified sample in `test/harness/.runtime/mutation/S7-initial-sample.json`, the real `_presend.js`, `pre-send-check.js`, and `_notice.js` helpers/endpoints, and the offline revenue harness. No production code or workflow was changed. The new complementary tests are `test/revenue/gate-mutation.test.mjs`; they import real exports through `loadHandlers()` so `REVENUE_SOURCE_ROOT` selects the copied mutant source.

## Initial sample, before complementary tests

| File | Selected | Killed | Survived | Invalid |
| --- | ---: | ---: | ---: | ---: |
| `_presend.js` | 24 | 18 | 5 | 1 |
| `pre-send-check.js` | 24 | 10 | 14 | 0 |
| `_notice.js` | 21 | 21 | 0 | 0 |

These counts are sampled mutation results, not overall branch coverage, proof of safety, or evidence of deployed behavior. No failing TODO assertion is counted as a kill. Notice tests cover pure rendering and escaping; neither these results nor the test fixtures approve notice delivery or dormant refund language. Gate tests do not prove that the frozen weekly sender enforces a gate result.

## Meaningful survivors addressed by tests

- `_presend.js:316`, `dafcdc71ac48d36f`: changing the build-time fallback from `||` to `&&` erases a known fingerprint build time. Test distinct build/upload/status clocks and unknown build time; do not substitute another clock as evidence.
- `_presend.js:369`, `a845af986bf65597`: changing the two numeric-count requirements from `&&` to `||` permits fabricated or nonfinite row deltas when either historical count is missing. Test missing, null and text counts separately, plus valid positive/zero/negative deltas. Missing counts can occur in historical evidence; wrong types are explicit robustness fixtures, not asserted current production incidents.
- `_presend.js:481`, `6ef36b76189cf98c` and `a3d9d340751a6a59`: reversing the null check erases real refresh failure text. Test retained diagnosis and explicit fallback for absent text. `da0b2e734de3fbff` changes the diagnostic limit from 160 to 161; the bounded-text regression test preserves the existing reporting contract. This last boundary is lower risk than a verdict or dispatch defect.
- `pre-send-check.js:83-85`: seven survivors change failed-result counts, nullable subscriber counts or the skipped flag. Tests exercise normal accepted/failed entries, empty skipped entries, unknown and zero counts, and null-slot robustness. A selected record is explicitly **not** treated as a full roster reconciliation or a union of recipient coverage across attempts.

The new tests also check the due boundary through the actual endpoint, replay versus observation clocks, explicit policy reporting, hash opt-out evidence, read-only behavior and absence of synthetic recipient identities in the response. These add useful contracts without asserting that an unverified bundle is safe or that a missing log proves no delivery occurred.

## Survivors deliberately not forced into artificial tests

Six initial `pre-send-check.js:62-64` survivors mutate the defensive `gather()` exception response (`51672fa5d62538ba`, `8d7aade497c7e991`, `60a4292f192e86d6`, `99d60845e75e8ae3`, `5cde9efd0fab017c`, `407970bd41bca6a3`). Ordinary binding read/head failures, JSON parse errors, metadata conversion failures and digest failures are already caught inside `_presend.js:145-162,193-202`. With JSON-decoded objects and the existing binding contract, these normal fault injections do not reach the endpoint's catch. Tests therefore check the actual normal-failure diagnosis, rather than monkeypatching global runtime primitives or fabricating a throwing JSON getter merely to kill this group. This is a bounded reachability justification, not a claim that unexpected runtime exceptions can never happen.

`63bcdd8c886b728a` changes the private `json()` helper's default status at `pre-send-check.js:92`. Every current call (`:40`, `:61-64`, `:71-89`) supplies an explicit status, so changing that unused default is equivalent for the current endpoint call graph. No export or fake call is added solely to reach it.

The invalid `_presend.js:333` candidate `258c2701a00ac20e` removes a unary operator and opening parenthesis together, leaving invalid syntax. It is correctly excluded from the denominator, not credited as a kill.

## Mutator credibility and limits

`test/harness/mutate.mjs` uses Acorn syntax nodes/token positions, deterministic seeded selection by operator group, a fresh Node subprocess for each mutant, isolated per-worker source copies and a clean baseline for each mapped suite. `loadHandlers()` resolves all mapped test imports from the requested copy; relative production imports remain within that copy. The child environment is an allowlist with synthetic harness credentials, and the test world's fetch stub rejects external requests. The runner itself has no service request or workflow execution path.

At `mutate.mjs:134`, top-level failing TAP entries annotated `# TODO` are filtered out. The current mapped cases are top-level tests. Timeouts and output/spawn errors remain unresolved rather than killed (`:179-180`); invalid syntax is separate (`:173-174`). The score (`:194`) excludes invalid candidates but retains unresolved outcomes in its denominator, so it is conservative in that respect. Tests are not snapshotted or individually hashed by this runner: the parent froze the test files during the initial run, and a checkpoint plus retained reports are needed for reproducibility. Passing a rerun after adding tests does not alter or replace the initial evidence.

The sample is not risk-weighted or exhaustive. Mutation kills caused by runtime/import breakage are still kills in this tool; they should not be described as proof of a specific business invariant without inspecting the failing assertion. Operator-equivalent survivors and unreachable defensive code must retain their stated justifications rather than being silently removed to improve a score.

## Focused validation

The complementary file passed **19/19 focused tests, with zero failures, TODOs, skips or cancellations**. TAP output: `test/harness/.runtime/S7-gate-mutation.tap.txt`. The parent owns any subsequent combined or exhaustive mutation run; this baseline pass alone does not establish which initial survivors are now killed. No production fix, live delivery, subscriber change, policy activation or workflow execution follows from these tests.
