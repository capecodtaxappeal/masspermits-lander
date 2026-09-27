The new tests exercise real purchase, delivery and access code offline.
There are 312 passes, four known baseline failures and 64 executed TODO cases.
Nine comparisons against local workerd check storage, HTML and signing behavior.
Production, workflows and the existing mission tests are unchanged.
The owner approved separate draft fixes; sender and status changes remain on hold.

# Revenue reliability harness and evidence

S1 mapped the paying path and defined I01-I30. S2 now imports the actual handlers with a fixed clock, in-memory storage, captured mail and genuine synthetic Stripe/OIDC signatures. The 160 handler scenarios execute healthy cases and desired behavior at identified gaps. Nine additional tests compare the harness with local workerd. No request reaches a live service.

## Verification

    node test/harness/run.mjs

At main source 1068e8070: 380 tests, 312 pass, 4 known baseline failures, 64 TODO, 0 skipped/cancelled, no unexpected hard failures. The process correctly exits 1 for the known failures. Evidence is in docs/codex/evidence/S2-full.json.

The four known failures are retained by explicit owner instruction while another branch re-anchors them:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

TODO cases execute assertions. They are not skipped, and policy scenarios are separate from confirmed defects. One partial-refund policy TODO currently passes; it is not counted as a defect. Diagnostic review corrected fixtures and confirmed intended assertion failures.

Dependencies live only under test/harness and are not imported by production. Workerd runs locally with cf:false and external transport denied. The compared API subset and remaining simulation limits are documented in test/harness/README.md.

## Continuing work and review

This branch remains a draft throughout findings, failure injection, mutation testing and the operator runbook. Read HANDOFF.md and OWNER_DECISIONS.md for the current checkpoint, exact next commands and owner approvals.

Fixes use separate claude/codex-fix-<id> draft branches. weekly-send.js and send-status.js are frozen until both pending incoming changes are verified on origin/main. test/mission/ is not edited. No workflow, allowlist expansion, live data, deployment or production change belongs in this harness PR.
