The tests now catch 92% of generated paying-path faults offline.
The full suite has 644 passes, four known failures and 67 executed TODO cases.
Findings and separate fix branches retain their before-and-after evidence.
Production, workflows and mission tests are unchanged on this branch.
Sender fixes remain on hold, and no draft PR has been submitted without gh.

# Revenue reliability harness

This branch maps the actual revenue path, imports real handlers into a closed test harness, records ranked findings, injects failures and measures test strength. All fixtures are synthetic. Dependencies stay under test/harness. There is no production build or root package manifest.

S1 maps entry points, storage, mail and external calls. S2 and S3 add the harness, named invariant coverage and findings. S6 adds provider/storage faults, concurrency, large rosters, UTC boundaries and access checks. S7 adds exhaustive mutation evidence and focused regression controls. The operator guide follows in S8.

Validation: node test/harness/run.mjs. Final S7 record: 715 tests, 644 pass, four known hard failures, 67 executed TODO, no skipped/cancelled or unexpected hard failures. The process exits 1; this is not a green suite. Twenty local workerd cases compare the exercised storage/signing/HTML contracts.

Mutation score is 1323/1435 valid on the requested paying path (92.2%), or 1680/1814 including lifecycle (92.6%). The final evidence is one fresh exhaustive catalog run after test strengthening and a demonstrated harness fidelity correction. Invalid syntax is excluded; unresolved runs stay in the denominator. See MUTATION_REPORT.md for per-file scores, surviving gaps and reproducible commands.

The four owner-known baseline failures remain unchanged:
1. P1-14 the diff from main lists only allowed paths
2. P2-5 _headers gains exactly the /admin/mission block, outside the widget block
3. P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/
4. P1-14 route strings never appear in non-test added files

TODOs execute desired assertions and include explicitly unresolved policy cases. They do not mark fixes complete. Fixes are separate claude/codex-fix-* branches with their own results and review notes; none is merged here. Frozen sender/status work and the owner-approved legacy-active rule are in HANDOFF.md. FIX_STATUS.md distinguishes published branches from PRs and deployments.
