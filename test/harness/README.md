# Offline revenue harness

Run from the repository worktree:

    node test/harness/run.mjs

Install the pinned test tooling with npm ci --ignore-scripts in test/harness. The existing manual intake tests also require npm ci --ignore-scripts in workers/manual-intake to install its already-pinned postal-mime parser. Both installs use ignored node_modules; do not change production manifests. Without that parser, sixteen manual intake tests skip and the runner exits 1 with their names. Missing harness packages are ordinary hard failures.

This runs six test globs: test/*.test.mjs, test/mission/*.test.mjs, test/growth/*.test.mjs, test/manual/*.test.mjs, functions/api/*.test.mjs and test/revenue/*.test.mjs. The wrapper confines temporary files to this physical clone, removes credential and output override variables without inspecting their values, stores redacted diagnostics under ignored .runtime/, and records Node's actual exit code separately from the runner's result. A hard failure, cancellation, skipped test, or passing TODO makes the runner fail. There are no known-failure waivers. Every hard failure is reported as unexpected, including the mission tests that were historically listed as baseline failures.

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

The runner writes redacted diagnostics and summaries to test/harness/.runtime/. Runtime temporary files use a worktree-specific directory under the physical clone's common .git directory, resolved by local git metadata rather than parent-directory assumptions. The r3 runner has a separate hash namespace from legacy mutation tools, so its startup cleanup cannot clear their scratch. Mutation source copies stay in the worktree's ignored .runtime folder. The harness and revenue tests do not require audit documents.

Run selected cases by passing test paths to run.mjs. The --label option retains a named local result. Summaries retain an empty knownBaseline for compatibility, list unexpected hard failures, skippedTests and staleTodos by full nested test name, and report childExit separately from exit. A failing TODO remains expected debt; a passing TODO is stale and exits 1. An ok TODO suite with a failing descendant still represents a known defect and is not mistaken for a stale TODO. A skipped leaf or suite also exits 1. No timing-dependent TODO is suppressed. Missing or incomplete TAP counters cannot produce a successful run.

Before starting any test, the runner records layout (root, physical clone, scratch path, length and budget) and checks it. Unsupported layout or locked/unsafe scratch exits 2 with phase=preflight, childExit=null and null test counts. No test process has started in that case. A supported run reports phase=tests. Node failures keep their nonzero code; wrapper-only gates use exit 1.

Mutation testing changes only scratch copies of production files. A bounded smoke run is:

    node test/harness/mutate.mjs --file functions/leads/out.js --limit 1 --jobs 1

For a complete source catalog, select a sufficiently large limit (at most 2000). report-mutation.mjs accepts an exhaustive result followed by optional source-identical reruns, and writes its aggregate under test/harness/.runtime/mutation/final-summary.json. Every report records the actual source and test hashes. A score from another revision is not a score for this checkout. These tests do not certify deployment or inbox receipt.

The existing P3-2 mission demo test requires temporary output outside its worktree. Use a linked worktree located inside the physical clone, such as .git/codex-session-worktrees/harness. Its common .git scratch is outside the worktree while remaining in the physical clone. An ordinary checkout is refused before tests run because its scratch would sit inside its worktree root. Do not move scratch outside the clone or change P3-2 to bypass this limit.

The portable scratch-path budget is 104 characters, including separators. Offline measurements on Node v25.9.0, Miniflare 4.20260730.0 and workerd 1.20260730.1 found a deepest live R2 suffix of 147 characters: miniflare-<32 hex>/r2/miniflare-R2BucketObject/<64 hex>.sqlite-shm (or .sqlite-wal), including the leading separator. Scratch lengths 100 and 104 passed read/write, conditional and concurrent storage operations; 116, 120 and 124 failed on the first R2 write. The budget uses 259 minus 147 minus 8 safety characters. It is a conservative support bound for this pinned runtime, not a universal Windows limit. It is enforced on both lexical and canonical paths on every platform so the supported layout remains portable. Remeasure after runtime or storage-binding changes.

Before each supported run the runner locks its own hashed scratch namespace, verifies that its resolved absolute path stays inside the clone and outside the worktree, rejects symbolic links and junctions, then empties only that namespace. It never clears sibling worktree scratch or the legacy mutation scratch namespace. Concurrent runs against the same source root are refused. The lock is released after normal child completion; test-created files remain for diagnostics until the next run clears them. On a timeout, signal, or uncertain child exit the lock is retained because descendant termination is not guaranteed. Verify no runner or descendant is active before manually removing exactly the lock path named in the refusal. Existing locks are never automatically removed. The checks assume a stable local filesystem; they do not defend against another process deliberately swapping paths during cleanup. Report paths are also checked for links; an unsafe output directory produces a failing stdout summary without writing through the link.

Runner-contract subprocesses use distinct copies of the runner and scratch helper under ignored .runtime fixture roots. Their own derived scratch paths prevent child probes from clearing the active parent run. Contract tests cover ordinary and long-path refusal, scratch cleanup and lock safety, nested TODO/skip reporting, and honest hard-failure exits.
