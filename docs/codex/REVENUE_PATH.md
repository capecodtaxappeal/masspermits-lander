# MassPermits revenue path

Snapshot: 2026-09-27. Source: origin/main at 1068e8070e88a436fbf5f86b88bf075e1f3a01c5.
Branch: claude/codex-revenue-harness. Session: S1.

This is a source map, not a claim about deployed code, current customers, delivery receipts, or live service configuration. No service was queried. Git fetch was the only network operation used to obtain this source. Line references below belong to this snapshot and will move. Future tests must assert behavior rather than source positions.

## Scope and verified planning facts

The complete listed paying-path modules and all four workflow files were read. Supporting authentication, middleware, and workflow-called monitoring modules were also inspected. Workflow definitions were read as text only. The private engine, customer datasets, credentials, environment secret values and live R2 objects were not read.

There is no root package.json at this snapshot. Cloudflare Pages Functions and generated static pages coexist. DEPLOY.md:3 still calls this a pure static site, which is no longer an adequate description. The private engine is fetched at runtime by weekly-refresh.yml:932 and is not part of this review. No engine code was brought into this checkout.

The local origin remote identifies the intended repository. Public visibility, Pages production branch settings, preview exclusions, deployed revision, number of subscribers and installed secrets cannot be confirmed with the permitted offline checks. Main deployment and the branch exclusion are operating constraints supplied by the owner, not independently verified live facts.

The legacy product paths still exist: subscription checkout and one-time checkout select a monthly bundle; renewals select a weekly bundle. MIN_CENTS remains 500, not 1000. Retirement of the other offers has not been assumed complete.

The mission-control branch is merged. Main includes price-ID-scoped Stripe reading in functions/api/_mission_stripe.js. The assertion that there is no Stripe reconciliation anywhere is therefore stale. Its live configuration and completeness are not established here.

Commit 24bbbb771 removed full subscriber addresses from ordinary send/status responses, but domains and error-derived strings remain. The final counts-only change and per-subscriber weekly guard described in the brief are not established by this snapshot. weekly-send.js and send-status.js remain frozen for this program until both intended changes are verified on origin/main.

## Entry points and authority

| Entry point | Authority and input | Behavior and failure boundary |
| --- | --- | --- |
| POST /api/stripe-webhook | Stripe body HMAC, stripe-webhook.js:22-35,571-596 | Dispatches billing events, replaces roster, sends purchaser and owner mail, records delivery/referrals. No signature timestamp age check or event replay ledger. |
| /api/weekly-send | GitHub OIDC, weekly-send.js:26-30; no method restriction in handler | Reads status, roster and ZIP; attempts sequential email; stores attempt and result logs. Some skips and failures return HTTP 200 with ok:true. |
| /api/pre-send-check | GitHub OIDC, pre-send-check.js:37-67 | Read-only evaluation using _presend.js. Optional at and hash query fields affect diagnosis. No send or R2 write. |
| /api/send-status | GitHub OIDC, send-status.js:49-59 | Read-only delivery/roster/portal diagnosis. Cannot establish payment status from its own inputs. |
| GET /api/my-leads | 32 lowercase hex bearer token, my-leads.js:62-105 | Roster active !== false; streams selected monthly/weekly ZIP; best-effort download telemetry. |
| GET and HEAD /leads | Token or mp_sess cookie, leads.js:62-129,510-533 | Rechecks roster; renders or withholds dashboard; GET may write portal telemetry. HEAD suppresses that telemetry. |
| GET /leads/out | Unauthenticated; clears browser cookie, leads/out.js:15-24 | Clears cookie and redirects. Does not revoke bearer token or subscription. |
| PUT or POST /api/upload-bundle | GitHub OIDC plus key/body checks, upload-bundle.js:53-68 | Unconditional object replacement, nine declared keys, nonempty body up to 25 MiB. Does not validate artifact content. |
| GET /api/get-object | GitHub OIDC and strict Set membership, get-object.js:14-31 | Streams one of four allowed objects. subscribers.json is excluded. |
| POST /api/mail-owner | GitHub OIDC, mail-owner.js:13-29 | Sends caller-provided subject and HTML to fixed owner role; body length capped. Success response includes owner destination and subject. |
| GET /api/get-engine | GitHub OIDC, get-engine.js:13-27 | Streams engine.tar.gz. No engine execution in this endpoint. |
| /api/funnel | GitHub OIDC, funnel.js:22-107 | Reads aggregate inputs and writes daily metrics even on GET. Not a read-only probe. |
| /api/engagement | GitHub OIDC, engagement.js:27-62 | Writes lifecycle rollup and prunes old telemetry; digest=1 can send owner mail. |
| /api/inbox-status | GitHub OIDC, inbox-status.js:55-120 | Reads a stored heartbeat. Does not read the inbox. |
| GET /api/health | Public, health.js:68-226 | Reads refresh/portal metadata and returns diagnostics. No sends or writes. |

functions/_middleware.js:45-71 limits paid download/portal routes to the canonical apex and restricts operator hosts. It does not supply token authorization by itself.

_github-oidc.js:17-48 verifies RS256, issuer, audience, repository, main ref, expiry and signature. It fetches signing keys with a one-hour cache (:54-66). It does not pin the particular workflow/job/event or check nbf/iat.
_cf-access.js:37-87 verifies Access assertions using configured issuer/audience, expiry and signature. It fetches Access certificates (:93-106). Additional operator identity restrictions depend on the caller and configured Access policy. The paid token routes do not use this helper.

## Billing event transitions

All references in this table are to functions/api/stripe-webhook.js.

| Event | Transition or delivery | Evidence |
| --- | --- | --- |
| checkout.session.completed | Amount at least 500, or zero/falsy amount in subscription mode, selects latest-monthly.zip. Subscription mode adds/reactivates roster before email. | :164-204,243-253 |
| invoice.paid with subscription_cycle | Amount at least 500 selects weekly ZIP. Computed zero requires a known active roster email. Other sub-500 amounts skip. | :174-186,255-283 |
| invoice.paid or invoice.payment_succeeded | Clears payment-failure fields before classification. payment_succeeded has no delivery branch. | :158-165 |
| invoice.payment_failed | Sets payment_failing/payment_detail; retains active state; attempts owner alert. | :59-84,415-434 |
| customer.subscription.deleted | Deactivates matching customer rows immediately on processing. No customer notice. | :41-44,367-408 |
| radar.early_fraud_warning.created, charge.dispute.created, review.opened | Attempts deactivation and payment flags; attempts owner alert. Uses identity present in the event, with no related-charge lookup. | :105-136 |
| review.closed, approved | Clears payment flags and alerts owner. Does not reactivate despite an earlier comment. | :141-153 |
| Refund, customer.subscription.updated, other events | No implemented refund or period-end transition; acknowledged as skipped unless handled above. | :41-186,285 |

The renewal amount expression is amount_paid || total || 0 (:260). Zero amount_paid can fall through to nonzero total. Currency, price ID, product ID and paid/trial status are not part of delivery classification. Amount filtering does not apply uniformly to earlier state-event branches.

Delivery sequence: classify, optional zero-value roster check, load bundle, optionally mint referral code, optionally add subscriber, send purchaser mail, best-effort delivery log, optional referral credit. Missing ZIP fails before registration (:189-204). Roster helper failures are swallowed, so acknowledged mail is not proof of durable roster membership.

## Subscriber states and transitions

The roster is a collection of mutable rows, not a versioned subscription state machine.

| State | Entry | Exit and limitations |
| --- | --- | --- |
| No roster row | New visitor or failed registration | Qualified subscription checkout creates row only after bundle exists. |
| Active row | New checkout row sets active:true with email, customer, since and token (:292-337). Existing rows change active only when explicitly false; missing/null values stay as they were. | Deletion/risk handlers set active:false. No subscription ID or paid-through date is stored. |
| Legacy row without active | Existing malformed/legacy state | Sender and portal accept it; watchdog does not expect it. This discrepancy requires a test and an owner decision before fixing. |
| Payment problem | Failed invoice or risk event adds flags | Paid invoice/payment_succeeded/approved review clear flags. Flags alone do not stop ordinary active-row sends or paid renewals. |
| Inactive row | Deletion or risk event, with cancelled processing date | Later checkout reactivates and preserves existing token; may replace customer ID. Event chronology is not checked. |
| Unknown roster state | Missing, unreadable, malformed or wrong-schema object | Helpers disagree: some acknowledge/skip, some reject access, some return empty counts. Unknown is not a consistently modeled state. |
| Browser session | Valid token sets 14-day Secure, HttpOnly, SameSite=Lax cookie | Logout clears cookie; each portal request rechecks roster; underlying token remains valid while row is eligible. |

Existing-row registration uses exact case-sensitive email. Revocation uses customer ID precedence when both IDs exist, with case-insensitive email fallback. Payment flag/clear uses customer ID OR email without that conflict protection. Whole-roster writes have no conditional etag check. Overlapping events can overwrite changes; older events can override newer intent.

Period-end cancellation is a business requirement to specify and test. The implementation relies on receipt of a deletion event, without its own entitlement clock. Multiple subscriptions for one customer are not represented independently.

## Complete R2 inventory within reviewed boundaries

Every operation uses env.BUNDLES. These are code paths, not evidence that these objects currently exist. Private contents are intentionally omitted.

| Key or prefix | Readers | Writers or deleters |
| --- | --- | --- |
| subscribers.json | Webhook :177,295,382,419,442; weekly-send:76; send-status:103; my-leads:77; leads:513; funnel:68; _lifecycle:601 | Webhook :321,335,396,432,457 replaces entire object. No other writer in reviewed primary scope. |
| latest-weekly.zip | Webhook:189; weekly-send:87; _presend:184,197; my-leads:105; leads:148; send-status:249; health:81 | upload-bundle:68, declared :16; refresh workflow:1088 |
| latest-monthly.zip | Webhook:189; _presend:185; my-leads:105 | upload-bundle:68, declared :15; refresh:1099 |
| latest-sample.zip | No primary paying reader | upload-bundle:68, declared :17; refresh:1100 |
| latest-weekly.html | leads:147,255; send-status:248; health:80 | upload-bundle:68, declared :46; refresh:1094-1097 |
| refresh-status.json | weekly-send:52; _presend:181; leads:149,408; health:79 | upload-bundle:68; refresh:1258-1296, including after a failed build/upload |
| presend-policy.json | _presend:180 | No writer in reviewed scope |
| portal.json | leads:535-548 | No writer in reviewed scope |
| feed-send-log.json | weekly-send:99,123,168; send-status:59; _presend:182; _lifecycle:602 | weekly-send:132,172; newest 12 entries; write errors ignored |
| last-send-attempt.json | send-status:58; _presend:183 | weekly-send:145-149 before provider requests; write error ignored |
| delivery-log.json | Webhook:213-214 | Webhook:215-217; newest 50 entries; write error ignored |
| referral/codes/<code> | Webhook:488-490 | Webhook:477-483; deterministic 10-hex email hash; purchaser identity stored privately |
| referral/credits/<milliseconds>-<code> | No reader in reviewed scope | Webhook:493-496; attribution only, not a Stripe credit |
| dl/YYYY-MM-DD/<time>-<random> | _lifecycle:587-596,614 paginated LIST with metadata | my-leads:142-158 empty-object telemetry; _lifecycle:635-642 deletes up to 200 older than 400 days |
| portal-access/YYYY-MM-DD/<time>-<random> | send-status:317-328; day-prefix LIST, limit 1000, no continuation handling | leads:439-459 empty-object telemetry; HEAD suppresses writes |
| engagement.json | _lifecycle:562-568,603 | _lifecycle:627-630; aggregate save failure does not prevent subsequent pruning |
| newsletter/, prospects/ | funnel:33,52,115-122 paginated metadata LIST | No writers in reviewed scope |
| funnel-metrics.json | funnel:102 | funnel:107, same-day replacement, newest 180 snapshots |
| inbox-watchdog-state.json | inbox-status:62 | External heartbeat producer not reviewed |
| engine.tar.gz | get-engine:20 | No writer in reviewed scope; engine contents not inspected |
| source-health.json | get-object:14-29; refresh workflow:1198-1200 through that endpoint | upload-bundle:68; refresh:1208-1211 |
| run-log.txt | No reader in reviewed handlers | upload-bundle:68; refresh:1298-1301 |
| cold-state.json | get-object:14-29 | upload-bundle:68 |
| cold-log.txt | No reader in reviewed handlers | upload-bundle:68 |
| cold-queue.json, suppression.json | get-object:14-29 | No writers in reviewed scope |

upload-bundle.js:14-47 declares nine allowed keys. get-object.js:14-15 allows four. Do not widen either list. The uploader uses JavaScript in (:62), which admits inherited property names at the membership test. Actual storage success for those names is untested.

Other functions outside the listed paying path, and the existing mission-control/rehearsal tools, have additional objects. This inventory is exhaustive for the named primary modules and inspected workflow-called helpers, not a claim that the entire application uses no other keys. The private engine's internal reads, scraping sources and files are outside the permitted review.

## Monday sequence and diagnostic limits

1. weekly-refresh.yml:895-921 schedules daily 09:00 UTC, allows manual runs and fires on main changes to itself. It downloads the private engine, installs Python packages and runs hosted_refresh.py (:932-1074).
2. It publishes weekly ZIP, optionally HTML, monthly ZIP and sample ZIP in separate requests (:1079-1100). Optional fingerprint/source-health steps follow. Status upload runs even after failures (:1138-1302). Status read-back compares ran_at through public health; it does not make the release atomic.
3. weekly-feed.yml:11-40 schedules Monday 12:00 UTC, manual runs and self-file pushes on main. It POSTs weekly-send with curl retries. It checks HTTP success, not the JSON delivery outcome.
4. weekly-send checks status age when present and status failure unless degraded; missing status does not block (:50-70). It filters roster with active !== false, obtains ZIP, then compares one prior global etag. Same etag skips everyone; changed etag can resend in the same week. force=1 bypasses that guard (:75-138).
5. It best-effort writes an attempt marker, sequentially calls the provider, and best-effort writes a capped result list (:145-182). There is no per-recipient weekly claim/receipt or atomic concurrency guard in this snapshot.
6. send-watchdog.yml:24-115 schedules Monday 13:30 UTC and Tuesday 11:00 UTC, plus manual/self-file pushes. Its separate concurrency group cannot serialize weekly-feed against watchdog. It reads status, retries only missed plus retry_safe, reads again, sends owner alert and fails on non-ok outcome.
7. send-status uses Monday 12:00 UTC plus 90-minute grace, chooses one best log entry, and expects only active === true rows. Roster read/schema failures collapse to an empty gap. Portal metadata can change the top-level verdict. It does not combine all recipient receipts across runs or consult Stripe.
8. pre-send-check reports GO, GO_WITH_DISCLOSURE, HOLD or NO_GO. _presend reads policy, status, old logs and bundle metadata and optionally hashes bytes. The sender imports lastEtagEntry only. No call to gather/evaluate or _notice was found in this sender or the four workflows. Policy enforce/notice fields are reported, not evidence of enforced delivery gating.

UTC schedules are nominal. No live run history or future execution time was asserted.

## Email inventory

| Sender | Recipient role | Message and evidence |
| --- | --- | --- |
| Webhook sendEmail | Purchaser or renewing subscriber | Monthly/weekly ZIP, dashboard described in copy, optional subscription download token and referral link; stripe-webhook:206,512-562. |
| Webhook notifyOwner | Owner | Payment failure, risk hold and approved-review alerts; :68-83,120-135,146-151,463-470. Provider non-2xx is not checked. |
| Webhook creditReferrer | Owner | Referral attribution and manual-credit instruction; :486-509. No automatic refund or credit. |
| weekly-send sendEmail | Eligible roster recipient | Weekly ZIP, download link when token present, coverage text; weekly-send:151-159,185-244. Provider rejection is recorded per recipient. |
| mail-owner relay | Fixed owner | Authenticated HTML/subject from watchdogs or refresh; mail-owner:13-29. Provider non-2xx returns 502. |
| engagement digest | Owner | Only when digest=1 and an alert/configuration exists; engagement:43-57. Current send-watchdog call omits digest. |
| _notice renderers | Nobody by themselves | Disclosure, no-delivery and owner templates, _notice:45-153. No runtime/workflow call sites found in reviewed source. |

Refresh can call mail-owner for source-health alerts, Monday PR pitches and Monday Patch packs. send-watchdog calls it for delivery problems. inbox-watchdog calls it for stale/unarmed/backlog states, but exits successfully without mail for never. Every listed mail path uses Resend. Accepted HTTP response is not proof of inbox receipt. Current paid send helpers do not retain provider message IDs.

## External calls and workflow side effects

These are observed call sites, never requests made in this session.

| Caller | Destination or operation |
| --- | --- |
| Webhook, weekly-send, mail-owner, optional engagement digest | POST api.resend.com/emails; webhook :465,499,551; weekly-send:232; relay:23; engagement:49 |
| _github-oidc | GitHub Actions issuer JWKS; :54-66 |
| _cf-access | Configured Access issuer certificate endpoint; :93-106 |
| Four workflows | GitHub Actions token endpoint to mint OIDC; MassPermits API endpoints listed above |
| weekly-refresh | Package registry installation; private engine's town/network operations are not inspectable here |
| weekly-refresh:1318-1357,1463-1470 | Clones repository and may push generated site to main; separate forced heartbeat-branch push |
| weekly-refresh:1384-1386 | IndexNow submission |
| weekly-refresh:1404-1411 | WebSub hub publish notifications for three public feeds |
| weekly-refresh:1439-1448 | Package installation and private-engine Bluesky publication on Monday |
| Merged mission-control reader | GET-only Stripe API source exists; see _mission_stripe:25-48,204-229. Not used by webhook/sender and never invoked here. |

The watchdog additionally calls funnel, which writes metrics, and engagement, which writes aggregates and prunes telemetry. Their GET/POST appearance is not a read-only guarantee.

inbox-watchdog.yml:120 exits with a warning for never. HTTP/non-JSON fallbacks set alert:false, allowing a successful run without a working heartbeat. inbox-status also maps read failures to never. These are source-supported test candidates; this session did not inspect the actual inbox heartbeat.

## Evidence limits

R2 concurrency semantics, HTMLRewriter behavior and provider retry semantics have not been proved by this map. Existing tests have helpful stubs, but S2 must establish fidelity and run real exported handlers. No statement here certifies that a customer received mail or that the public deployment matches this commit.
