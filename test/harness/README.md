# Offline revenue harness

Run from the repository worktree:

    node test/harness/run.mjs

This runs the original three test globs plus test/revenue/*.test.mjs. The wrapper confines temporary files to this physical clone, removes credential and output override variables without inspecting their values, stores redacted diagnostics under ignored .runtime/, and preserves the actual test exit code. Four historical mission tests remain known baseline failures. They are neither edited nor hidden.

## Real handlers and fake boundaries

index.mjs imports actual functions/ modules directly. No production function is copied or replaced for ordinary runs. Its loadHandlers source-root override is reserved for mutation copies inside this worktree.

The clock is fixed, R2 is an in-memory binding, Resend requests are captured, and GitHub OIDC tokens are signed using a freshly generated local RSA key. The real verifier executes against a local JWKS response. Unknown fetch URLs throw. There is no Stripe/Cloudflare/Resend account access.

The storage fake records operations and supports immutable read snapshots, MD5-style etags, metadata, conditional get/put, create-only writes, pagination, deletion and selected-operation failures. The request helper supplies Pages-style context and collects waitUntil work. Tests execute sequentially within each process because clock/fetch are process globals.

World fixtures are synthetic and set owner/from addresses explicitly so a default production recipient cannot leak into captures. Capture means an attempted provider request, not actual inbox receipt. Provider outcomes are selectable success, non-2xx or thrown errors.

## Platform fidelity

Twenty contract cases compare the fake with local workerd through Miniflare 4 (the original nine plus eleven numeric listing-limit cases):
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

TODO tests execute desired assertions and retain their diagnostics. They do not skip the faulty path. A failing TODO must be reviewed to confirm the intended production cause, not an import, mock or fixture mistake. Policy TODOs are labeled POLICY and kept separate from defects; one partial-refund policy scenario currently passes and is not evidence of a bug.

The I08 control test currently requires the deployed identical-bundle skip reason. It is a known upcoming update: after the once-per-week guard lands on main, its exact reason will be "every active subscriber already has this week's email". Keep the existing assertion until the source changes. The related skip assertions in failure-injection and operations-mutation need the same source-aware review. A generic successful skip is not accepted.

Nothing under functions/ imports these dependencies. There is no root package.json. Do not run workflow code or the rehearsal branch's aggregate runner.

## Local diagnostics and mutation reports

The runner writes redacted diagnostics and summaries to test/harness/.runtime/. Runtime temporary files use a worktree-specific directory under the physical clone's common .git directory, resolved by local git metadata rather than parent-directory assumptions. Mutation source copies stay in the worktree's ignored .runtime folder. The harness and revenue tests do not require audit documents.

Run selected cases by passing test paths to run.mjs. The --label option retains a named local result. Full-suite summaries separate the four historical mission baseline names from unexpected failures and preserve the real exit status. Passing TODO cases do not prove the corresponding policy has been implemented.

Mutation testing changes only scratch copies of production files. A bounded smoke run is:

    node test/harness/mutate.mjs --file functions/leads/out.js --limit 1 --jobs 1

For a complete source catalog, select a sufficiently large limit (at most 2000). report-mutation.mjs accepts an exhaustive result followed by optional source-identical reruns, and writes its aggregate under test/harness/.runtime/mutation/final-summary.json. Every report records the actual source and test hashes. A score from another revision is not a score for this checkout. These tests do not certify deployment or inbox receipt.

The existing P3-2 mission demo test requires temporary output outside its worktree. In a linked worktree inside this clone, common .git scratch satisfies both that contract and the no-outside-clone rule. In an ordinary checkout, the mission assertion conflicts with in-clone scratch and is reported as an unexpected failure. The runner never sends test data outside the clone to bypass that assertion.
