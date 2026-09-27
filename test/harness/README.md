# Offline revenue harness

Run from the repository worktree:

    node test/harness/run.mjs

This runs the original three test globs plus test/revenue/*.test.mjs. The wrapper confines temporary files to this physical clone, removes credential and output override variables without inspecting their values, stores redacted diagnostics under ignored .runtime/, and preserves the actual test exit code. Four historical mission tests remain known baseline failures. They are neither edited nor hidden.

## Real handlers and fake boundaries

index.mjs imports actual functions/ modules directly. No production function is copied or replaced for ordinary runs. Its loadHandlers source-root override is reserved for mutation copies inside this clone.

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

The worker has cf:false and an outbound service that rejects external requests. Worker control uses loopback only. Dependencies were downloaded from the package registry with install scripts disabled; caches remain inside this clone.

The Node-side HTMLRewriter implementation comes from the older @miniflare/html-rewriter package. It is test-only, and the exercised escaping behavior is compared against current pinned workerd. This does not establish equivalence for every possible HTML document or parser feature.

The fake is intentionally not a full R2 implementation. Multipart uploads, range requests, delimiter listings, all conditional date/header variants, object limits, cloud timing and distributed consistency are not certified. Current tests use the explicitly compared subset. Extend the contract tests before relying on additional semantics.

## Honest defects and policies

TODO tests execute desired assertions and retain their diagnostics. They do not skip the faulty path. A failing TODO must be reviewed to confirm the intended production cause, not an import, mock or fixture mistake. Policy TODOs are labeled POLICY and kept separate from defects; one partial-refund policy scenario currently passes and is not evidence of a bug.

S2 evidence: 160 handler scenarios plus 9 platform contracts. Full suite: 380 tests, 312 pass, 4 known baseline failures, 64 TODO, no skips/cancellations or unexpected hard failures. See docs/codex/evidence/S2-full.json and FINDINGS.md as it develops.

Nothing under functions/ imports these dependencies. There is no root package.json. Do not run workflow code or the rehearsal branch's aggregate runner.

S7 closing full suite: 715 tests, 644 pass, four known hard failures and 67 executed TODO cases. Twenty platform contract cases pass. The final mutation report uses a fresh complete run after correcting the demonstrated R2 numeric-limit mismatch. See docs/codex/MUTATION_REPORT.md and evidence/S7-full.json. These results do not certify deployment or inbox receipt.
