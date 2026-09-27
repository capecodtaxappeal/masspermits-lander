The paying path is mapped without changing customer delivery.
The final suite has 207 passing tests and four obsolete branch checks failing.
Thirty rules and twenty candidate findings now have named test targets.
Existing reconciliation and rehearsal work will be reused.
D-1: Allow draft PR API access. Recommend: yes, so this review can remain a draft.

# S1: map the MassPermits paying path and define reliability tests

This documentation-only change establishes the source contract for a tests-first reliability program. It maps billing events, subscriber state, R2 objects, Monday delivery, paid access, alerts and external effects at main 1068e8070. It separates observed code from unverified deployment/customer claims.

INVARIANTS.md records I01-I30 and ranks C01-C20 as source-supported candidates for reproduction. No candidate has been marked a live incident or approved for a behavior change. REUSE.md prevents duplication of mission-control, Monday rehearsal and public-output work. HANDOFF.md and SESSION_LOG.md carry the next commands and decisions.

## Validation

The exact existing full command is:

    node --test test/*.test.mjs test/mission/*.test.mjs functions/api/*.test.mjs

Pristine baseline: 211 tests, 209 pass, 2 fail, 0 skipped/todo/cancelled, exit 1, Node v25.9.0. Final after docs: 211 tests, 207 pass, 4 fail, 0 skipped/todo/cancelled, exit 1.

The two baseline failures are premerge assumptions in existing mission tests: P2-5 expects a header block to be added to a main that already contains it; P1-14 requires the original mission files in the current diff and rejects documentation. Two additional tests now reject the required docs and route names in the map: P2-12 branch hygiene and P1-14 route strings. The suite is not green. S2 will repair all four historical assumptions while retaining security and scope coverage.

Only docs/codex/ files change. Functions, workflows, tests, static assets, dependencies and allowlists remain byte-for-byte unchanged from the source base. New text uses LF and neither prohibited long dash character. Tests use confined synthetic scratch and closed provider stubs.

## Review and risk

This is a map and handoff, not a deployment or a fix. No live service or customer object was queried. Source line references are pinned to the recorded commit and future tests must assert behavior. Current tests do not yet prove delivery correctness. Keep this PR a draft until the expanded harness and baseline repairs provide the required green suite.

## Decisions

D-2: How should missing active fields be treated? Recommend: preserve service and flag the ambiguity until roster evidence can be reviewed, rather than silently excluding a paying row.
D-3: What are the paid-through cancellation, refund and risk-hold recovery policies? Recommend: define them explicitly before changing entitlement.
D-4: What explanation and stale-download access should customers receive when weekly delivery is blocked? Recommend: decide before connecting notices or changing fallback behavior.
