# Mutation test report

The strengthened tests catch 92.0% of the generated paying-path faults.
The full suite has 630 passes, four known failures and 67 executed TODO cases.
No production code changed on this branch.
Open defects, uncertain runs and simulation limits remain visible.
The results support review of the separate fixes, not a production release.

## Source and method

Source: origin/main 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. Node v25.9.0. The homemade Acorn-based runner changes copied modules inside clone-confined scratch directories and runs the actual handler tests in fresh Node processes. External transport is closed. Tracked production files, mission tests and workflows are unchanged.

The complete catalog contains 1822 candidates: 1443 in the 14 requested paying-path files and 379 in the supplemental lifecycle helper. Operators flip comparisons and logical operators, remove awaits, invert conditions or negation, flip booleans and increment numeric literals. These are raw source-token replacements; JavaScript precedence applies, so changing the final operator in A || B || C is not equivalent to rewriting an abstract syntax tree with added parentheses.

The first exhaustive round tested every candidate. Additive test strengthening was followed by source-identical survivor reruns. The latest observed result for a repeated candidate wins. Earlier kills remain evidence from their recorded test checkpoint, not a claim that all 1822 ran again against the final tests. Round source hashes, test manifests, timestamps and report hashes are retained in evidence/S7-final-mutation.json. The combiner rejects source or candidate catalog changes.

Only an ordinary failing assertion kills a mutant. Executed TODO assertions do not. Eight syntax-invalid candidates are excluded. Two unclassified process errors and three timeouts remain unresolved in the score denominator; none is credited as a kill. A timeout is bounded at 30 seconds and confined child processes are terminated.

## Results

| Scope | Valid | Killed | Survived | Unresolved | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| Paying path | 1435 | 1320 | 113 | 2 | 92.0% |
| Supplemental lifecycle | 379 | 356 | 20 | 3 | 93.9% |
| Combined | 1814 | 1676 | 133 | 5 | 92.4% |

Per-file counts and scores are in the following table. Invalid syntax is not in the valid column.

| File | Valid | Killed | Survived | Unresolved | Score |
| --- | ---: | ---: | ---: | ---: | ---: |
| stripe-webhook.js | 391 | 359 | 30 | 2 | 91.8% |
| _presend.js | 248 | 248 | 0 | 0 | 100% |
| pre-send-check.js | 32 | 24 | 8 | 0 | 75% |
| weekly-send.js | 123 | 109 | 14 | 0 | 88.6% |
| send-status.js | 158 | 133 | 25 | 0 | 84.2% |
| my-leads.js | 56 | 56 | 0 | 0 | 100% |
| leads.js | 182 | 164 | 18 | 0 | 90.1% |
| leads/out.js | 1 | 1 | 0 | 0 | 100% |
| _notice.js | 21 | 21 | 0 | 0 | 100% |
| upload-bundle.js | 34 | 30 | 4 | 0 | 88.2% |
| get-object.js | 12 | 12 | 0 | 0 | 100% |
| _github-oidc.js | 65 | 58 | 7 | 0 | 89.2% |
| _cf-access.js | 89 | 82 | 7 | 0 | 92.1% |
| mail-owner.js | 23 | 23 | 0 | 0 | 100% |
| _lifecycle.js | 379 | 356 | 20 | 3 | 93.9% |

The score exceeds the program's aggregate 80% threshold. pre-send-check remains at 75%: seven surviving changes affect a defensive outer catch not reached through ordinary binding failures because the helper already catches them, and one changes an unused default response status while callers supply an explicit status. These are bounded coverage limits, not excluded candidates.

## What the stronger tests establish

The new controls exercise real authentication, signature verification, payment and access boundaries, bundle checks, exact UTC day selection, partial-provider results, notices, limits, and storage failure handling. Delayed-operation controls race acknowledgment against a held storage operation, then release and drain it in finally. This tests awaited durability without relying only on an instantly resolved mock.

Forty-three presend contracts, 27 gate controls, 38 access controls, 80 webhook controls, 62 operations controls and 40 lifecycle controls all pass in the closing full suite. Existing failure scenarios remain executed TODOs; tests do not pin known bad behavior merely to increase the mutation score.

## Remaining gaps and justification

See mutation-webhook-exhaustive-review.md, mutation-access-exhaustive-review.md, mutation-operations-exhaustive-review.md and mutation-lifecycle-exhaustive-review.md for candidate IDs, source reasoning and test references. The original mutation-gate-review.md records the defensive gate boundary.

Some survivors overlap confirmed open findings, including skipped sends reported as ok, public diagnostic detail, bounded history eviction and swallowed storage errors. Some are equivalent under the exercised platform contract, while others concern presentation, unsupported shapes or narrow timing boundaries. Those categories remain separate from proved correctness. The R2 list limit mutation from 1000 to 1001 is an explicit mock-fidelity gap, not a claim of platform equivalence.

The closing round killed 37 additional candidates: 26 webhook, six send-status and five lifecycle. The lifecycle review predates the final four added controls; those controls cover delayed log reads, single-log summaries, priority of delivery/dunning over engagement, and continuing winback with no adverse transition. Twenty lifecycle survivors and three bounded timeouts remain in the final evidence.

These scores apply to the unchanged harness source snapshot. They do not score any unmerged fix branch or prove live configuration, inbox receipt, billing completeness, provider idempotency, cloud races, or every R2/HTML behavior. Nine local workerd comparisons establish only their named contract subset.

## Reproduction and evidence

Run the full suite:

    node test/harness/run.mjs --label S7-review-full

Run all mutation candidates:

    node test/harness/mutate.mjs --limit 2000 --jobs 3

Preserve results.json before starting another runner. Run at most one mutator using the shared scratch workers. To strengthen a surviving set, pass the saved report with --rerun-survivors. Source and selected tests must remain stable during a run.

The saved five rounds are S7-first-exhaustive.json, S7-second-survivors.json, S7-status-final.json, S7-weekly-final.json and S7-closure-survivors.json under docs/codex/evidence. The combined report is S7-final-mutation.json. S7-full.json records 701 tests, 630 pass, four known hard failures, 67 TODO, no skipped/cancelled tests and zero unexpected hard failures. The suite exits 1 honestly.

The four known failures remain unchanged:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

No test/mission file was edited. The additional static-address structural failure on certain fix branches is separately recorded in FIX_STATUS.md and is not part of this four-failure baseline.
