# Offline revenue harness

Run from the repository worktree:

    node test/harness/run.mjs

Install the pinned test tooling with npm ci --ignore-scripts in test/harness. The existing manual intake tests also require npm ci --ignore-scripts in workers/manual-intake to install its already-pinned postal-mime parser. Both installs use ignored node_modules; do not change production manifests. Without that parser, sixteen manual intake tests skip and the run is incomplete.

This runs six test globs: test/*.test.mjs, test/mission/*.test.mjs, test/growth/*.test.mjs, test/manual/*.test.mjs, functions/api/*.test.mjs and test/revenue/*.test.mjs. The wrapper confines temporary files to this physical clone, removes credential and output override variables without inspecting their values, stores redacted diagnostics under ignored .runtime/, and preserves the actual test exit code. There are no known-failure waivers. Every hard failure is reported as unexpected, including the mission tests that were historically listed as baseline failures.

## Real handlers and fake boundaries

index.mjs imports actual functions/ modules directly. No production function is copied or replaced for ordinary runs. Its loadHandlers source-root override is reserved for mutation copies inside this worktree.

The clock is fixed, R2 is an in-memory binding, Resend requests are captured, and GitHub OIDC tokens are signed using a freshly generated local RSA key. The real verifier executes against a local JWKS response. Unknown fetch URLs throw. There is no Stripe/Cloudflare/Resend account access.

The storage fake records operations and supports immutable read snapshots, MD5-style etags, metadata, conditional get/put, create-only writes, pagination, deletion and selected-operation failures. The request helper supplies Pages-style context and collects waitUntil work. Tests execute sequentially within each process because clock/fetch are process globals.

World fixtures are synthetic and set owner/from addresses explicitly so a default production recipient cannot leak into captures. Capture means an attempted provider request, not actual inbox receipt. Provider outcomes are selectable success, non-2xx or thrown errors.

## Platform fidelity

Twenty platform and boundary cases include eighteen comparisons with local workerd through Miniflare 4 and two fake-only transport/fault checks:
- Immutable body snapshots, body consumption, HTTP metadata and conditional storage results.
- Two conditional writers with one winner.
- Prefix pagination, custom metadata and deletion.
- Observed finite numeric list limits: truncation, the -1 default sentinel, omitted default, and range rejection. Nonnumeric/nonfinite coercions remain unverified.
- HTMLRewriter text escaping.
- Raw request bodies, headers and HMAC computed by crypto.subtle.
- Closed outbound transport and deterministic injected faults.

The worker has cf:false and an outbound service that rejects external requests. Worker control uses loopback only. Dependencies were downloaded from the package registry with install scripts disabled; caches remain inside this worktree.

The Node-side HTMLRewriter implementation comes from the older @miniflare/html-rewriter package. It is test-only, and the exercised escaping behavior is compared against current pinned workerd. This does not establish equivalence for every possible HTML document or parser feature.

The fake is intentionally not a full R2 implementation. Multipart uploads, range requests, delimiter listings, all conditional date/header variants, object limits, cloud timing and distributed consistency are not certified. Current tests use the explicitly compared subset. Extend the contract tests before relying on additional semantics.

## Honest defects and policies

TODO tests execute desired assertions and retain their diagnostics. They do not skip the faulty path. A failing TODO must be reviewed to confirm the intended production cause, not an import, mock or fixture mistake. Policy conflicts are labeled explicitly. D3 refund and review decisions and D4 dated-data access are owner-approved requirements. A passing limited fixture is not proof of historical payment linkage or complete policy enforcement.

The I08 control test requires the current once-per-week guard's exact skip reason: "every active subscriber already has this week's email". The settled-week loop in failure-injection uses that reason. Operations tests also retain the separate previous-week identical-byte skip path, including its awaited evidence write. A generic successful skip is not accepted. The C06 scenarios for a changed bundle within the same week and retrying a recipient whose provider attempt failed are now ordinary tests, rather than TODOs. The concurrent-send scenario remains a TODO; the sequential guard does not establish safe exclusion between overlapping requests.

Nothing under functions/ imports these dependencies. There is no root package.json. Do not run workflow code or the rehearsal branch's aggregate runner.

## Local diagnostics and mutation reports

The runner writes redacted diagnostics and summaries to test/harness/.runtime/. Runtime temporary files use a worktree-specific directory under the physical clone's common .git directory, resolved by local git metadata rather than parent-directory assumptions. Mutation source copies stay in the worktree's ignored .runtime folder. The harness and revenue tests do not require audit documents.

Run selected cases by passing test paths to run.mjs. The --label option retains a named local result. Full-suite summaries retain an empty knownBaseline field for compatibility, report every hard failure in unexpected, and preserve the real exit status. Runner contract tests execute real subprocesses to check the six default globs, failure reporting, redaction and scratch confinement. Passing TODO cases do not prove the corresponding policy has been implemented.

Mutation testing changes only scratch copies of production files. A bounded smoke run is:

    node test/harness/mutate.mjs --file functions/leads/out.js --limit 1 --jobs 1

For a complete source catalog, select a sufficiently large limit (at most 2000). report-mutation.mjs accepts an exhaustive result followed by optional source-identical reruns, and writes its aggregate under test/harness/.runtime/mutation/final-summary.json. Every report records the actual source and test hashes. A score from another revision is not a score for this checkout. These tests do not certify deployment or inbox receipt.

The existing P3-2 mission demo test requires temporary output outside its worktree. In a linked worktree inside this clone, common .git scratch satisfies both that contract and the no-outside-clone rule. In an ordinary checkout, the mission assertion conflicts with in-clone scratch and is reported as an unexpected failure. The runner never sends test data outside the clone to bypass that assertion.
