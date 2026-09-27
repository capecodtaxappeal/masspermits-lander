# Remaining work after the offline reliability checkpoints

This is a review queue, not owner acceptance or a declaration that production is safe. The unchanged source snapshot is 1068e8070e88a436fbf5f86b88bf075e1f3a01c5. Every published fix remains unmerged. Exact branches, evidence and decisions are in FIX_STATUS.md.

## Safe continuation order

1. Make the permitted gh executable available, then create the harness draft and the separate fix drafts from the prepared bodies. Use only the owner's gh exception. No alternate GitHub API client is authorized.
2. Fetch origin. Inspect the pending once-per-week and counts-only changes when they arrive, rebase and rerun the actual scenarios. Only then design fixes to weekly-send.js or send-status.js.
3. Retain all four known mission failures until the separate re-anchor lands. The additional whole-file address failure on webhook-changing drafts is still unexpected and must be legitimately resolved, not relabeled.
4. Review the narrow fixes separately, honoring the C05 dependency on C02. Do not merge automatically or combine fixes into one review.
5. Resolve business and external-service contracts before broader state-machine changes. No live account inspection or credential access is authorized here.

## Finding disposition

| Finding | Current status and next required evidence |
| --- | --- |
| C01 product identity | Amount routing remains. Approved price scope, legacy product retirement and missing-payload resolution must be explicit before changing delivery or state-event routing. The existing mission configuration does not itself prove deployed values. |
| C02 enrollment/evidence | Durable enrollment prerequisite drafted. Post-provider acceptance with a failed evidence write remains open and must be designed with C03. Returning 500 alone can repeat accepted mail. |
| C03 event replay | Open. Needs durable effect progress, provider idempotency semantics and a recovery policy for acceptance with lost evidence. Closed fake transport cannot establish live provider guarantees. |
| C04a identity matching | Narrow payment-flag fix drafted; verify and review independently. |
| C04b event order | Open. Requires subscription/invoice provenance and transition precedence, not a customer-wide last-event timestamp. Coordinate C01/C13. |
| C05 lost updates | Four conditional roster mutators drafted on C02. Other unconditional writers and broader event ordering remain outside that patch. |
| C06 duplicates/retries | Frozen pending sender guard. Retest changed bytes, overlap and failed-recipient recovery. |
| C07 presend enforcement | Frozen sender/workflow integration. Customer notice or refund wording requires an explicit policy. |
| C08 outcomes/history | Frozen sender/status/consumer contract. Skips, all-rejected requests and history must remain distinguishable from success. |
| C09 legacy active flag | D-2 settles the rule: keep serving, flag for review. Implementation remains frozen. |
| C10 unknown evidence | Frozen sender/status readers and consumers. Missing, failed and malformed reads cannot be collapsed into healthy evidence. |
| C11 recipient evidence | Frozen sender/status durability. Accepted provider requests are not proof of inbox receipt. |
| C12 operational reconciliation | Reuse existing mission/rehearsal work. This task cannot certify installed configuration, complete live Stripe scope or actual customers without prohibited service access. |
| C13 subscription/refund access | Subscription-level identity and paid-through policy remain open. D-3 asks for refund/review policy; no answer is inferred. |
| C14 risk holds | Existing-hold enforcement and recovery require the same identity and risk-state contract. Do not equate every inactive row with a risk hold or silently choose recovery policy. |
| C15 controlled access errors | Narrow unknown-storage handling drafted; stale-access policy remains C16. |
| C16 stale/pause behavior | D-4 pending. Do not choose between unavailable and verified dated fallback by accident. |
| C17 upload membership | Own-property gate drafted, with exact allowlists unchanged. |
| C18 upload/publication | Optional atomic write preconditions are published on the separate C18 branch; review and caller adoption remain. Format/schema validation and coherent generation publication remain open; the latter needs producer/workflow coordination. |
| C19 privacy/wording | Response-only fix drafted. Sender/status logs remain frozen; other templates/auth diagnostics need distinct reviews. This is not blanket privacy completion. |
| C20 monitoring/retention | Retention prerequisite and inbox unknown-state reader are separate drafts. Workflow transport fallbacks, genuine never suppression, installed mailbox monitoring and alert receipt remain unverified. |
| C21 operator guidance | Narrow draft removes the suggestion to edit a workflow on main to force a run. |

## Completion boundary

The offline harness, findings, failure injection, mutation measurement and operator guide are review artifacts. A score above 80% does not mean every invariant is enforced. Open TODOs, policies, live configuration gaps, frozen source and unsubmitted drafts keep the program incomplete.

Original stop conditions apply to any next step that needs real credentials/network, would edit frozen sender files before incoming changes, encounters live data, or leaves uncertainty about sending customer mail. Do not work around them. Preserve the exact next command and reason in HANDOFF.md and continue other independent authorized work when available.

The C20 transport/schema workflow fragment is prepared at proposals/inbox-watchdog-evidence.yml.txt. It is deliberately unexecuted and incomplete at the HTML/grace-policy boundary. It does not authorize any workflow file edit or run.
