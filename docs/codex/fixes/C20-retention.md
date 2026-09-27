A failed summary save now preserves the source download records.
A successful recovery saves the rebuilt summary before removing old records.
Both regressions fail before this patch and pass afterward.
The full suite has 342 passes, four known failures and 66 TODO cases; monitoring findings remain open.
D-9: Approve this retention fix for merge? Recommend: yes after review, because failed storage no longer destroys its recovery evidence.

# C20 retention fix evidence

No PR exists yet. HANDOFF.md records the current publication state.

## Scope

Base: S6 commit ba5eee54f027c09c99e4d84461ec09b711d923a7. Branch: `claude/codex-fix-c20-retention`.

The production change in [functions/api/_lifecycle.js](../../../functions/api/_lifecycle.js) is one guard on the retention key selection, plus a comment. Only a successful `engagement.json` put enables the existing bounded deletion loop. On a rejected put the response continues to report `stored:false`, now with `pruned:0` and the outstanding stale-event count in `prune_remaining`.

The 400-day age threshold, 200-key per-run cap, 100-key deletion batches, response status, rollup classification, and successful-save pruning behavior are unchanged. No billing/access, inbox monitor, alert handler, sender/status, workflow, mission-test, or other worktree file was changed.

## Regression evidence

[test/revenue/weekly-watchdog.test.mjs](../../../test/revenue/weekly-watchdog.test.mjs) promotes the existing failed-save TODO and adds one ordinary regression. All calls use the real engagement handler, synthetic R2 state, and the real OIDC verifier against the offline fixture. No live service or customer data is involved.

| Exact case | Before | After |
| --- | --- | --- |
| `I30 future retention: failed aggregate persistence retains attributed source telemetry for a rebuild` | Expected zero pruned; actual one | Pass: source remains after rejected save |
| `I30 future retention: repeated save failures preserve clicks until successful recovery` | Expected zero pruned; actual two on the first rejected save | Pass: two rejected saves retain evidence, followed by complete recovery |

The new case first seeds two attributed historical clicks. Two aggregate puts are queued to fail. A third historical click and one recent click arrive between attempts. Each failed attempt must preserve the previous aggregate byte-for-byte, retain all events, report the full stale backlog, and perform no delete.

After the queued failures are exhausted, a successful attempt must save four downloads with the correct first/last dates, report one recent download, and then prune exactly the three aged events. The recent event remains. The operation trace requires aggregate put before deletion. Subscriber and send-log bytes are unchanged, and no mail is attempted.

The unchanged positive and fault controls also pass:

- `I30 future retention: successful save may prune an attributed event without mailing or billing mutation`
- `I27/I30 failed event listing is a visible rollup error and performs no retention writes`
- `S6 I30 engagement reads all 1005 metadata events across the R2 page boundary`
- `S6 I27/I30 second-page list failure cannot publish a partial aggregate or prune evidence`

These retention fixtures use the future clock 2027-11-01. Their old attributed events are after the recorded instrumentation start and older than the retention threshold. This is a reproduced future failure path, not evidence of an observed present-day retention incident.

## Commands and results

Runtime: Node v25.9.0. Times are UTC from the wrapper summaries. No skips or cancellations.

| Run | Command | Time | Tests | Pass | Hard fail | TODO | Exit |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Failing before | `node test/harness/run.mjs test/revenue/weekly-watchdog.test.mjs test/revenue/failure-injection.test.mjs` | 2026-09-27 05:40:48 | 71 | 46 | 2 intended retention failures | 23 | 1 |
| Focused after | Same command | 2026-09-27 05:41:28 | 71 | 48 | 0 | 23 | 0 |
| Full after | `node test/harness/run.mjs` | 2026-09-27 05:41:43 | 412 | 342 | 4 known | 66 | 1 |

The four full-run failures are unchanged historical branch/documentation checks; they remain visible, and this is not a green full suite:

- `P2-5 _headers gains exactly the /admin/mission block, outside the widget block`
- `P2-12 branch hygiene: since the P1 tip only P2 files and test/mission/ files changed; nothing under docs/`
- `P1-14 the diff from main lists only allowed paths`
- `P1-14 route strings never appear in non-test added files`

Ignored local evidence under `test/harness/.runtime/` uses the prefixes `C20-retention-before`, `C20-retention-focused-after`, and `C20-retention-full-after`, each with `.tap.txt` and `-summary.json` files.

Tested SHA-256 values:

- Lifecycle helper: `d9cb63acdb780bf357bbb70a79ba437e37e14f5e7b281b29a22faa919273433d`
- Weekly/watchdog tests: `e471378c873df146d3a984d098446a66f17074b60ca0c85c7ae1ed5732b094bc`

## Risks, limits, and still-open C20 work

When persistence keeps failing, aged events remain beyond the normal pruning age. That is the intended tradeoff: temporary extra storage preserves the inputs needed for a later rebuild. The endpoint still exposes save failure through `stored:false`; this patch does not alter monitoring or alert propagation.

The recovery proof ends at the first successful persisted rollup. It does not redefine lifetime counters after later normal retention cycles, change the retention policy, recover previously deleted events, or make aggregate writes/deletion a transaction across concurrent invocations. A thrown save, including an uncertain outcome, conservatively preserves source records.

The remaining monitoring TODOs are unchanged and still fail:

- `I27 inbox read failure stays distinguishable from never installed`
- `I27 inbox invalid JSON stays distinguishable from never installed`
- `I27 unusable heartbeat timestamp cannot look like a healthy live monitor`

Owner-alert caller behavior and workflow alert propagation are also outside this fix. C20 as a whole is not closed. Mission tests remain frozen pending the owner's branch. Offline platform contracts cover a subset of local workerd behavior, not complete Cloudflare fidelity.

## Draft review body

Title: Preserve download evidence when engagement persistence fails

The lifecycle rollup currently prunes aged download events even when saving their engagement aggregate fails. This change allows the existing retention loop to delete events only after the aggregate put succeeds. Failed saves leave the previous aggregate and source records available for retry while reporting `stored:false`, `pruned:0`, and the outstanding backlog.

The promoted failed-save regression and a new two-failure/recovery scenario fail before the change and pass afterward. Recovery saves all four synthetic clicks before deleting the three aged events. Successful-save pruning and initial/late-page listing-failure controls still pass. Focused results: 48 pass, 23 unrelated TODO, zero hard failures. Full results: 342 pass, four known mission branch/documentation failures, 66 TODO, and no unexpected hard failure.

This is a retention-only change. It preserves existing age/batch limits and does not change billing/access, monitoring, or alert policy. The remaining C20 monitoring findings stay open.

D-9: Should the owner merge this isolated retention fix after root review? Recommend: yes, keeping the reviewed scope limited to the lifecycle helper, its regression tests, and this note. No PR has been created; root owns the later commit and any publication decision.
