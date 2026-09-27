# S1 handoff

## Five-line owner report

The paying path is mapped without changing how customers are served.
The final suite has 207 passing tests and four failures in obsolete branch checks.
Thirty rules and twenty candidate findings now have specific test targets.
Existing reconciliation and rehearsal work will be reused in S2.
No fix is approved, and draft PR creation needs the narrow permission described in D-1.

## Current checkout

Date: 2026-09-27.
Branch: claude/codex-revenue-harness.
Current head reference: refs/heads/claude/codex-revenue-harness. Resolve with git rev-parse HEAD. The final session reply records the published closing commit.
Source/base head: 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
The handoff is part of the closing commit. Its own commit hash cannot be embedded in itself; the exact branch reference above is authoritative.
Working directory: C:/Users/patri/OneDrive/Desktop/masspermits-lander/.git/codex-session-worktrees/revenue-harness

The base checkout had 14 pre-existing untracked entries. A clean worktree was created inside this clone's .git directory so none needed to be moved, cleaned, read or committed. Work only in the named worktree. Do not operate in the original task working directory or other projects.

## Done and evidence

1. Fetched origin and created the requested branch from fetched main. No rebase was needed because this branch began at that head.
2. Read every listed paying-path file and all four workflow definitions in full. Supporting source review included middleware, get-engine, funnel, engagement, _lifecycle, inbox-status and health.
3. Wrote REVENUE_PATH.md with entry points, complete primary-scope R2 inventory, emails, external calls, states and limits.
4. Wrote INVARIANTS.md with I01-I30, candidate C01-C20, source enforcement and named S2 test targets.
5. Reviewed in-flight branch interfaces and reusable harness pieces before proposing a new harness. REUSE.md records the pins and limitations.
6. Ran the exact requested full suite against pristine fetched main using Node v25.9.0. Result: 211 tests, 209 pass, 2 fail, 0 skipped, 0 todo, 0 cancelled. No live request or workflow was executed.
7. The failing names are P2-5 _headers gains exactly the /admin/mission block, outside the widget block, and P1-14 the diff from main lists only allowed paths. Both compare against a premerge branch shape that no longer exists. Details are in INVARIANTS.md.
8. Final verification after documentation: 211 tests, 207 pass, 4 fail, no skipped/todo/cancelled, exit 1. Two extra historical checks reject the required docs and route names in the map. Exact names and cause are in INVARIANTS.md. Remote publication status is recorded in SESSION_LOG.md. The suite must not be described as green.

No files under functions/, .github/, admin/ or test/ were changed. No root package.json or new dependency was added. No customer dataset, live object, credential file or secret value was read. All scratch stayed physically inside this clone; synthetic test scratch is removed at close.

## Next session: exact start and work

First command, in the working directory above:

    git fetch origin

Then read this file, SESSION_LOG.md, REUSE.md and INVARIANTS.md. Compare git rev-parse origin/main with the source/base head and rebase the working branch if main moved. Read incoming changes before designing tests. Use OFFLINE_TESTING.md to run the full suite with a confined scratch directory and scrubbed override variables.

S2 priorities:
1. Preserve honest baseline reporting. Replace historical branch-diff assumptions in tests with current header-security assertions and a program-appropriate scope check. Do not delete coverage or alter production to make these tests green.
2. Re-evaluate I08/I09 and I24 on new main. Do not edit weekly-send.js or send-status.js before the promised changes land and are inspected. Tests against them are permitted.
3. Selectively reuse the existing rehearsal signature, provider and request primitives. Extend one faithful R2 fake with metadata, etags, conditional puts, pagination and controlled faults. Do not copy a second production implementation.
4. Build test/harness/ with real-handler imports and fake credentials only. Prove platform fidelity; no remote platform/account validation is authorized.
5. Write test/revenue/*.test.mjs for I01-I30. Pin the active-flag disagreement with a todo test using C09; do not choose a changed activation policy in production.
6. Mark demonstrated bugs as todo with their candidate ID; record exact failing behavior for S3. A source candidate alone is not a reproduced incident.
7. Once added, include test/revenue/*.test.mjs in the verification command and record both baseline and expanded-suite counts.

No finding is approved for a behavior change. S4/S5 must wait for explicit answers recorded here or in an authorized PR thread. If none are approved, proceed to failure injection as planned.

## Decisions for the owner

D-1: May this task use GitHub PR APIs solely to create and update its draft PR and read its review thread? Recommend: allow that narrow scope, because the required draft PR step conflicts with the current network rule allowing only registries and git fetch/push. No API call has been made to work around that rule.

D-2: Should a roster row without active be treated as eligible for service or require explicit active:true? Recommend: preserve service temporarily and flag unknown rows for review, because silently excluding a paying row could cut off delivery. Only a test is planned until answered.

D-3: Which cancellation, refund and risk-review events should end or restore paid access? Recommend: keep ordinary scheduled cancellations entitled through paid period end, distinguish refunds and risk holds explicitly, and restore only the verified remaining entitlement, because customer-level flags cannot represent all of those cases.

D-4: Should a blocked weekly send generate a customer explanation, and should a stale download remain available with a warning? Recommend: specify these outcomes before wiring notices or changing fallback access, because both change what customers receive.

Only D-1 blocks the session's draft PR operation. The other decisions do not block safe S2 harness and reproduction work.

## Surprises and changes to the supplied plan

Main already contains the address-masking commit and merged mission-control reconciliation. Final counts-only logging and once-per-subscriber guard are still not assumed complete. Keep the file freeze.

The richer pre-send evaluator and no-delivery notice renderers are not called by the current sender. Presence of those files does not establish enforcement.

The active flag mismatch remains. Status can also turn a roster read failure into an empty gap.

The two baseline failures are post-merge test defects; two more historical scope tests fail once the required docs are present. None is a newly observed runtime failure. S1 ends with all four recorded; fix their assumptions in S2 while preserving real security checks.

The existing Monday harness has useful signed-event and provider primitives, but its R2 and HTMLRewriter stubs do not establish all requested platform semantics.

Authenticated funnel and engagement endpoints have writes or deletes. Never use them as read-only probes.

## Standing safety boundaries

Only package-registry network and git fetch/push are allowed until D-1 is answered. Never use a live credential, service, customer dataset, deployment command, or workflow execution. Never edit .github/workflows/. Proposals belong under docs/codex/proposals/ as text.

Use branches claude/codex-<topic>. Never push main or merge. Draft PRs only. Never push Monday 11:00-19:00 UTC. Recheck UTC immediately before pushing.

Do not widen either storage allowlist, add a root package.json, import test tooling from functions/, add private engine code, or copy real data into fixtures. New test identities use the approved synthetic conventions.

Use LF and UTF-8 without a BOM for new files. The shared repository config reports core.autocrlf=true, so use git -c core.autocrlf=false for staging/commits and verify bytes. Do not change shared configuration for the other session.
