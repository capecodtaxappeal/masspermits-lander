# Mutation test report

The final tests catch 92.2% of generated faults in the paying path.
The full suite has 644 passes, four known failures and 67 executed TODO cases.
All 20 local runtime comparison cases pass.
Production code is unchanged on this branch.
Remaining defects and simulation limits stay visible for review.

## Final evidence

This report uses ONE fresh exhaustive run against the final frozen tests and corrected harness. It started 2026-09-27T07:10:34.227Z and finished 07:21:46.565Z. All 1822 catalog candidates were selected. No earlier kill is carried forward to compute this final score.

Source: origin/main 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. Test/harness checkpoint: 39023cb6081646aed1f5956fdb63de00b4dd0832, committed while the already-frozen run was active. The evidence records the actual source, test and harness hashes, and the runner verified test hashes again at completion.

Raw final evidence: evidence/S7-final-exhaustive.json. Summary and complete candidate outcomes: evidence/S7-final-mutation.json. The only removed raw field is the machine-local sourceRoot path. Earlier exhaustive and survivor rounds are preserved as development history, including S7-accumulated-before-fidelity.json; they are not the basis of this final score.

## Method

The Acorn-based runner mutates copied modules in clone-confined scratch, then runs the actual handler tests in fresh Node processes. External transport is closed. Tracked production files, mission tests and workflows are unchanged.

Operators flip comparisons/logical operators, remove awaits, invert conditions/negation, flip booleans and increment numeric literals. Replacements are raw source tokens; normal JavaScript precedence applies. This is a defined homemade mutation catalog, not all possible faults or a probability that production is reliable.

Only ordinary failing assertions kill mutants. Executed TODO failures do not. Eight syntax-invalid candidates are excluded. Two unclassified process errors and three bounded timeouts remain unresolved in the denominator; none is a kill. The runner exits 1 because those unresolved results remain. Timed-out child processes are confined and terminated.

## Results

| Scope | Valid | Killed | Survived | Unresolved | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Requested paying path | 1435 | 1323 | 110 | 2 | 92.2% |
| Supplemental lifecycle | 379 | 357 | 19 | 3 | 94.2% |
| Combined | 1814 | 1680 | 129 | 5 | 92.6% |

| File | Valid | Killed | Survived | Unresolved | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| functions/api/stripe-webhook.js | 391 | 359 | 30 | 2 | 91.8% |
| functions/api/_presend.js | 248 | 248 | 0 | 0 | 100% |
| functions/api/pre-send-check.js | 32 | 24 | 8 | 0 | 75% |
| functions/api/weekly-send.js | 123 | 109 | 14 | 0 | 88.6% |
| functions/api/send-status.js | 158 | 136 | 22 | 0 | 86.1% |
| functions/api/my-leads.js | 56 | 56 | 0 | 0 | 100% |
| functions/leads.js | 182 | 164 | 18 | 0 | 90.1% |
| functions/leads/out.js | 1 | 1 | 0 | 0 | 100% |
| functions/api/_notice.js | 21 | 21 | 0 | 0 | 100% |
| functions/api/upload-bundle.js | 34 | 30 | 4 | 0 | 88.2% |
| functions/api/get-object.js | 12 | 12 | 0 | 0 | 100% |
| functions/api/_github-oidc.js | 65 | 58 | 7 | 0 | 89.2% |
| functions/api/_cf-access.js | 89 | 82 | 7 | 0 | 92.1% |
| functions/api/mail-owner.js | 23 | 23 | 0 | 0 | 100% |
| functions/api/_lifecycle.js | 379 | 357 | 19 | 3 | 94.2% |

The paying-path score exceeds 80%. pre-send-check remains at 75%: seven survivors concern a defensive outer catch not reached by ordinary binding faults because the helper catches them, and one changes an unused default response status while callers explicitly supply status. Those are documented limits, not excluded candidates.

## What improved

The contracts exercise actual authentication, signatures, payment/access boundaries, bundle checks, UTC day selection, provider failures, notices, limits and storage handling. Delayed-operation tests hold a storage promise, check acknowledgment ordering, then release and drain it in finally.

Forty-three presend, 27 gate, 38 access, 80 webhook, 65 operations and 40 lifecycle controls pass. The full suite, including original tests and 20 local workerd comparisons, is 715 tests: 644 pass, four known hard failures, 67 executed TODO, no skips/cancellations and no unexpected hard failures. Evidence: S7-full.json. TODOs include unresolved policies and concrete defects; they are not 67 independent bugs.

Final review added three missing/asynchronously failing metadata controls. They killed status mutants 10ad73d556d11a8d and 93a1b50c262bde6d, which could hide an independently stale HTML warning.

A local binding probe proved MemoryR2 incorrectly clamped an out-of-range listing limit. Eleven comparison cases establish the observed finite numeric behavior: truncation, the -1 default sentinel, omitted default and range rejection. Seven failed before the fake correction; all 20 platform cases pass afterward. Nonnumeric/nonfinite coercions remain unverified. This correction also killed status 79fe03a4fcc9484d and lifecycle 014fac5a0f3b2a1b. Exactly these four outcomes differ from the preceding accumulated report.

## Remaining gaps

The exhaustive webhook, access, operations and lifecycle review documents give candidate IDs and bounded reasons. Survivors include known-defect overlap, defensive branches, constrained equivalence, presentation differences, policy questions and lower-priority coverage. Five unresolved runs remain explicit. No survivor is discarded merely to raise the score.

Known skips reported as success, history eviction, diagnostic disclosure and swallowed evidence failures remain findings. Tests do not require known bad behavior just to kill a beneficial mutation. D-2 and the sender/status freeze remain in force.

These scores apply to the unchanged main-source snapshot, not the ten unmerged fix branches. The harness does not prove deployed settings, complete live billing scope, inbox receipt, provider retry guarantees or all cloud timing/R2/HTML behavior. Each fix has separate evidence and requires review.

## Reproduction

    node test/harness/run.mjs --label S7-review-full
    node test/harness/mutate.mjs --limit 2000 --jobs 3

Run one mutator at a time. Preserve results.json before another run and keep source/tests/harness stable during execution. To summarize a saved complete run:

    node test/harness/report-mutation.mjs docs/codex/evidence/S7-final-exhaustive.json

The four owner-known failures remain unchanged:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

No mission test was edited. Certain fix branches additionally fail a whole-file static-address check. FIX_STATUS.md records it as unexpected, not part of this baseline and not a green release.
