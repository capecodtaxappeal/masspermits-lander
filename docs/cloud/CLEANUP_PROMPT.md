GUARDRAILS (verbatim, non-negotiable)
- Work ONLY on branch claude/monday-rehearsal (create it from main if absent; otherwise continue
  it). Open or update ONE pull request. NEVER push to main, NEVER merge, NEVER force-push, touch no
  other branch (you may READ branch claude/seed-rehearsal-inputs).
- Make NO change under .github/. Workflows are delivered as docs/rehearsal/*.yml.txt.
- NEVER edit these files: functions/api/stripe-webhook.js, weekly-send.js, my-leads.js,
  send-status.js, _presend.js, _github-oidc.js, upload-bundle.js, get-object.js, _notice.js,
  inbox-status.js, funnel.js, functions/leads.js, functions/_middleware.js.
- REPORT-ONLY. This build fixes nothing in production. No job you write may hold
  "actions: write". Nothing you write may dispatch, re-run or cancel any GitHub workflow, by any
  means (REST path, gh CLI, or anything else). No send is ever retried.
- The repo is PUBLIC, and the site is served from the repo root, so EVERY file you add is also a
  public URL on masspermits.com. Branches, commits, PR text, fixtures and docs must contain no
  customer, subscriber, homeowner or contractor data. Synthetic fixtures only: @example.com,
  cus_TEST..., tokens like "a" repeated 32 times; towns may be real names, people and streets must
  be invented. No secrets.
- During this session make NO network call to masspermits.com, *.pages.dev, api.stripe.com,
  api.resend.com, api.github.com or any town site. Tests make zero network calls; a fetch stub
  throws on any unexpected URL. Never run gh workflow run, gh run, gh api, or wrangler against
  Cloudflare. Never send email.
- In any NON-test file you add (anything not named *.test.mjs), including comments, never write
  these route strings: /api/weekly-send, /api/mail-owner, /api/newsletter-send, /api/newsletter,
  /api/nurture, /api/lifecycle-send, /api/request-sample, /api/agent-sample, /api/upload-bundle,
  /api/funnel, /api/hit, or "force=1". Refer to those modules by file name (e.g. funnel.js).
- If you see a secret or personal data anywhere, report path:line only, never the value. Say what
  you verified and how.

PHASE: CLEANUP. Read the PR body first. Go on only if its phase table shows R2b done, and shows
R3b either done or not started (a row like "R3b | only if the owner says so" means not started;
then ITEM 1's R3b clause is moot). If R2b is not done, or R3b is started but not done, stop.

WHAT THIS IS
Draft PR #1 (capecodtaxappeal/masspermits-lander, PUBLIC) holds the Monday Dress Rehearsal. Make
exactly the four cleanups below: no refactor, rename, reformat or new check, no change to a result,
code or rule an item does not name. Every existing test stays green; the one allowed edit to an
existing assertion is a verdict ITEM 1 changes by design (missing runner facts), with before/after.

PIN origin/main BEFORE EVERY SUITE RUN (a local ref only; never push it)
rehearsal_static.test.mjs:26 diffs against the TIP of origin/main (git diff --name-only
origin/main), not the merge base, and the refresh bot commits to main daily. Once main has moved
past this branch's base, "this branch only ADDS files" fails on the bot's files (catalog.json,
data.json, feed/*, the lead pages) and the hygiene checks run over them. Do not change that diff
(ITEM 3's readText edits to the file are still wanted) and do not merge. After your first git
fetch, record the real tip: TIP=$(git rev-parse origin/main).
Then, after any fetch and before every suite run (and in each /tmp clone below), run
  git update-ref refs/remotes/origin/main $(git merge-base HEAD origin/main)
If merge-base prints nothing, the clone is shallow: git fetch --unshallow, then retry. Say in the
report that every run used origin/main pinned to the merge base, with both SHAs.

LEAVE FOR THE OWNER (do not touch; list both in the PR body as still open)
- R2a question 8, the weekly email's reduced-coverage paragraph (C5.stale_date, C5.vendor_words,
  drill I-22): no change to C5's reduced-coverage rules (the C5.stale_date and C5.vendor_words
  lines), the ACKABLE list, _rehearsal_mail.js or the mail mirror.
- R3a question 21, WARN C8.sibling_over_floor (C8 rule (c), drill I-02): no change to C8 rule (c).
Marking the factsBlind-fed BLIND lines inside checkC5 and checkC8 is part of ITEM 1 and touches
neither question.

ITEM 1. Missing runner facts count as blind (the owner approved R4 question 24's recommendation).
Today only BLIND_COUNTS ids count toward "GO, blind on N", so C0, C5, C8, C9, C14, C17 (and any
R2b/R3b check fed by runner facts) can be BLIND for lack of facts under a plain GO. Change: a BLIND
caused by runner facts counts toward N whatever its check id. That means a fact the check needs is
absent, was dropped by validateRunnerFacts, or is unusable because api is not "ok" (today: code
"schema" and every "<id>.actions_api"); a missing or dropped c17.inbox_mirror counts too (today
BLIND C17.inbox_mirror, "inbox mirror drift"), while a present "drift" or "error" keeps today's
result. Mark them where the facts are judged (factsBlind or its equivalent), never by parsing
text. factsBlind returns only a code and never learns the check id, and rehearsal.js passes one
ctx to C0, C5, C9, C14 and C17, so mark at each call site that turns a factsBlind code into a
BLIND. At fc9074a36 those are _rehearsal.js:281 (C0), 299 (C1), 441 (C5, purchase and mirror),
729 (C9), 756 (C14), 768 and 777-778 (C17), 812 (mon_pre), 883 (mon_post), 1117 (C8 rule (a),
c8.events_mirror) and 1148 (C8, c8.min_cents: mark it only when factsBlind fed it; a present -1
that gives C8.min_cents_unknown keeps today's rule). Re-find them if lines moved. The checkC5 and
checkC8 lines are part of this item. N stays the number of distinct check ids; every other BLIND
keeps today's rule (so rehearsal_unit's "BLIND on C4 or C9 does not count" stays green). No new
result or NO-GO; WAIT, acks, shouldMail and the response shape unchanged.
Tests, in a new functions/api/rehearsal_cleanup.test.mjs built on test/rehearsal/rehearsal_kit.mjs:
(a) sun, healthy R2 plus the keyed baseline's Stripe fixtures (nothing else can blind it), body
{"v":1}: verdict starts "GO, blind on", never exactly "GO"; exactly 1 Resend call, to the owner,
subject starting "GO, blind on". (b) Same, healthy facts with api "rate_limited". (c) Same, healthy
facts minus only c0.*, then c14.*, then c17.inbox_mirror, then purchase.* (C5), then c8.min_cents
(C8): never plain GO. (d) Twin: healthy facts give exactly "GO". (e) Unit: verdictOf on a C9 BLIND
marked facts-caused is "GO, blind on 1"; an unmarked one is still "GO".

ITEM 2. The link handlers get only BUNDLES (R4 question 26).
rehearsal.js callHandler passes env {BUNDLES: roBucket(env.BUNDLES)} (the no-options view), never
{...env, BUNDLES: ...}. First confirm on the current main (git show $TIP:<path>, not the pinned
ref) that functions/api/my-leads.js and functions/leads.js read nothing from env but env.BUNDLES
(every "env" in both, destructuring and helpers included); if either reads anything else, change
nothing here and ask in the PR body.
Test (same new file): extend rehearsal_kit.mjs's spy wrapper to record the handler's env keys. Run
part=links with an env that also holds made-up RESEND_API_KEY, STRIPE_READ_KEY, OWNER_EMAIL,
REHEARSAL_TO, REHEARSAL_SEEDS, FROM_EMAIL, REHEARSAL_SEED_TOKEN and SENTINEL_SECRET values (plain
strings like "sentinel-resend-not-real" and @example.com addresses, nothing the static secret-shape
check flags) and an ASSETS stub that counts fetch calls. Every handler call: env keys exactly
["BUNDLES"], BUNDLES is the no-options roBucket and not the raw bucket, no sentinel reachable, 0
ASSETS calls. Mutation proof: the old spread in the kit's temp copy of rehearsal.js fails the test.

ITEM 3. Line endings: the suite must pass on a Windows checkout with core.autocrlf=true.
(a) Add readText(p) = readFileSync(p, "utf8").replace(/\r\n/g, "\n") to test/rehearsal/harness.mjs.
Audit every file read in the tests and helpers this PR added: one that feeds a regex, split("\n"),
a line rule, a YAML parse or the extracted caller script uses readText. Known breaker: the comment
strip l.replace(/\/\/.*$/, "") in rehearsal_static and reconcile tests misses a line ending "\r".
Leave raw each byte-for-byte copy comparison (rehearsal_kit byteIdentical, inbox_mirror, the
harness copy check) and each file copied for import. The runner readers these tests drive
(mirror.mjs c8Facts, facts.mjs readText, readWorkflowDir) normalise too, a no-op on Linux. Do not
edit a test file that exists on main (stripe-webhook.test.mjs); if one fails on CRLF, ask.
(b) Add ONE root .gitattributes (a copy under functions/ would fail acceptance 8's allowlist): a
one-line comment, then "text eol=lf" for ONLY this PR's files: scripts/rehearsal/**,
test/rehearsal/**, docs/rehearsal/**, and each file this PR added under functions/ by exact path
(git diff --name-only --diff-filter=A origin/main -- functions/). No "*" rule, no text=auto, no
path that exists on main: nobody else's checkout of the site may change.
Proof, after committing:
  SRC=$(git rev-parse --show-toplevel); rm -rf /tmp/crlf
  git clone -q -c core.autocrlf=true --branch claude/monday-rehearsal "$SRC" /tmp/crlf
  git -C /tmp/crlf fetch -q "$SRC" +refs/remotes/origin/main:refs/remotes/origin/main
  (cd /tmp/crlf && git update-ref refs/remotes/origin/main $(git merge-base HEAD origin/main))
(The "+" matters: the clone's origin/main starts at $SRC's local main when $SRC has one, and moving
it back to the pinned base is not a fast-forward, so a plain fetch is rejected.) Prove a real CRLF
checkout (count CR bytes with node: weekly-send.js has some, the .gitattributes files none); then
node functions/api/all.test.mjs in /tmp/crlf exits 0. Also report which files fail in such a clone
(pinned the same way) of the pre-cleanup commit, so the proof is not vacuous.

ITEM 4. The caller-script test without jq.
In scripts/rehearsal/workflow.test.mjs, before the checks that run the caller script (acceptance 7,
11 and 12 there), look for jq as the script will: command -v jq in bash, with the script's PATH.
Found: run as today. Not found, CI env var unset or "false": run none of those checks, report them
as SKIP with the reason "jq is not installed; the caller script did not run (CI always runs it)",
exit 0. Not found with CI set: one FAIL "jq missing in CI", exit 1. Skip nothing else. Add
skip(name, reason) to makeRunner in test/rehearsal/harness.mjs. Its RESULT line stays
byte-identical when nothing was skipped (scripts/rehearsal/mirror.mjs runTest parses it at run time
for the mirror, purchase and inbox facts and must keep working unedited); only when K > 0 append
" skip=K". all.test.mjs parses that optional field, adds a skip column and prints every skip reason
under the table ("all files passed, K skipped: ..."). A skip never changes an exit code.
Proof: jq present, the caller checks run and pass; jq hidden (e.g. a PATH of symlinks to node, bash
and the few tools the test calls), CI unset: SKIP, exit 0; jq hidden, CI=true: FAIL, exit 1.

ACCEPTANCE (paste every output into the PR body)
1. node functions/api/all.test.mjs, with origin/main pinned as above, exits 0, per-file
   pass/fail/skip; every earlier check still runs and passes (leak and 3-vs-30 caller tests
   included); each existing test file touched, with why.
2. ITEM 1 (a)-(e), ITEM 2's test and mutation, ITEM 3's two CRLF runs, ITEM 4's three runs.
3. git diff --stat <pre-cleanup sha>..HEAD: only files the items name, the new test file and
   .gitattributes; nothing under .github/, no NEVER-edit file; C5's reduced-coverage rules
   (C5.stale_date, C5.vendor_words), the ACKABLE list, C8 rule (c) and drill fixtures intact;
   inside checkC5 and checkC8 only ITEM 1's marking lines change.
REPORT: a "Cleanup report" at the TOP of the PR body (earlier reports unchanged): phase row
"Cleanup | done"; per item, file:line of each change; new tests by name with results; the outputs
above; Node version; the pinned origin/main SHA and the real tip ($TIP); R4 questions 24 and 26
resolved; 8 and 21 still open; what was not verified.
