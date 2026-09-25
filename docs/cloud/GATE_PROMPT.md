GUARDRAILS (verbatim from docs/rehearsal/CLOUD_PROMPT.md, non-negotiable)
- Make NO change under .github/. Workflows are delivered as docs/gate/*.yml.txt. [path adapted]
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

GUARDRAILS (this project, same force)
- Work ONLY on a NEW branch claude/public-output-gate, created from origin/main. Open ONE DRAFT
  pull request. NEVER push to main, NEVER merge, NEVER force-push, touch no other branch. Nothing
  here depends on claude/monday-rehearsal or claude/seed-rehearsal-inputs; do not merge them in.
- Add files ONLY under scripts/gate/ and docs/gate/. Edit NO existing file of any kind (pages,
  JSON, llms.txt, functions/, _headers, .gitignore). Commit NO .html file: fixtures are written to
  os.tmpdir() by the tests, because a committed fixture page would be a live public page.
- WARN-ONLY. The gate never fails a build, never blocks a deploy, never writes the repo, and is
  never wired to push or pull_request. Findings are reported, never fixed: most pages are
  regenerated daily by the refresh bot, and the owner fixes generated text in the engine.
- Node built-ins only. No package.json, no npm install, no dependency.
- No em dash and no en dash in any file you add, in the report text, commits or PR text.

WHAT THIS IS
The "Public Output Gate": a warn-only lint of the BUILT public site as committed on main, judged
against the site's own published evidence. It flags promises the data cannot back. The daily bot
commits the built pages to main, so the gate judges every page whichever generation path wrote
it. Privacy scans, secret scans, roster-in-homepage checks and the public sample are OUT of scope
(another project owns them); so are data-vendor names and feed/*.csv.

EVIDENCE (read on origin/main 84ee7ed74, 2026-09-25; the bot commits daily, so re-find every
anchor on your checkout and report which moved. Never hard-code a number: an older note said
"51 of 72 sources", today it is 50 of 71.)
- research/evidence/coverage.json: corpus_first :7, corpus_last :8 ("2026-09-25"), n_sources :21
  (71), no_valuation :24 (50), monthly :29-44 (14 towns), errors :45-48 (Townsend, Waltham),
  table :49 onward, one row per source with keys source, rows, first, last, valued_pct,
  freetext_pct, coords, capped. There is NO contractor, owner or region field.
  Great Barrington :411-415 (621 rows, valued_pct 0.0); Provincetown :591-595 (last 2026-08-01).
- data.json :1 (one line): areas[].label gives the region labels: Cape Cod & Islands, Greater
  Boston, South Shore & South Coast, MetroWest & 495, North Shore & Merrimack, Central MA,
  Western MA ("Massachusetts" is statewide). areas[].all.count is the homepage count.
- catalog.json:1882 says Great Barrington's "source publishes no project value, so the valuation
  column is empty on every row"; catalog.json:1886 says owner and contractor names are withheld.
- index.html:22-25 is an HTML comment: "name" was removed because it read as owner name, "which
  is never shipped". It also says the town count is hand-maintained and will drift.
- research/coverage.html:91 says monthly sources' "most recent weeks are always behind".
Live claims to catch (value, owner, contractor, region, recency, cadence):
- permits/great-barrington.html: :4 meta description and :7 og:description promise "declared
  value"; :82 JSON-LD spatialCoverage and keywords say Greater Boston; :84 FAQ answer promises
  declared value; :91 visible text says "Great Barrington, Greater Boston", "621 most recent",
  and "exact address, contractor and project type". permits/lee, lenox, stockbridge and
  new-marlborough .html also carry Greater Boston in spatialCoverage at :82.
- electrical-leads-greater-boston.html:91 links /permits/great-barrington-electrical.
- news/great-barrington/2026-09-20.html:33 promises "owners and project values included".
- llms.txt:4 "property address, contractor, project type and project value"; :12 "every week".
- index.html: :11 og:description and :26 meta description promise declared value; :26 says "70
  Massachusetts towns"; :158 "the name, address, and project value"; :200 "Name, address, project
  value, permit-holder"; :164 and :241 "every Monday"; :384 is a JS template that renders the
  data.json count as "fresh ... permits available".
- offer.html:51 "homeowner name ... declared value"; offer.html:46 "every Monday".
  offer/index.html :7 and :89 "name, (full) address ... project value", :108 "Name, full address".
- permits/dennis.html (town absent from coverage.json): :3 title "(315 recent)"; :4 "with owner,
  address and project type"; :79 JSON-LD dateModified 2026-07-30 and "Coverage of this town is
  paused"; :87 id="mp-coverage-note"; :88 "every week", "live preview", "owner, contractor".
- permits/provincetown.html (a monthly source): :82 dateModified 2026-08-01; :91 "every week" and
  "live preview of the 226 most recent".

WHAT TO LINT (read-only, from --root)
- Town-scoped: permits/*.html (flat; permits/<town>.html and permits/<town>-<suffix>.html),
  guides/<town>-building-permits.html, news/<town>/*.html.
- Sitewide: index.html, offer.html, offer/index.html, llms.txt, llms-full.txt, permits/index.html,
  news/index.html, guides/building-permit-leads-massachusetts.html,
  guides/massachusetts-building-permits-explained.html, and the root region pages
  <trade>-leads-<region>.html (region suffix -> label: cape-cod-islands, greater-boston,
  south-shore-south-coast, metrowest-495, north-shore-merrimack, central-ma, western-ma;
  -massachusetts is statewide).
- Text surfaces: document <title> (the first one, in <head>; SVG <title> tooltips are not it),
  meta description, og:title, og:description, twitter:description, every string in every
  application/ld+json block (parse with JSON.parse; report the JSON path), and visible text.
  MASK, DO NOT DELETE: replace HTML comments, <style>, non-LD <script>, every tag with its
  attributes (the meta and LD surfaces above are read separately), and everything inside
  <table>...</table> with spaces (keep newlines) so every match maps back to file:line. Tables
  hold permit rows (streets); they are never linted and never quoted. llms*.txt: every line.
- Town resolution: guides and news from the path; permits from the <h1> "<Town>, MA", else the
  longest known-slug prefix of the filename. Match the town to coverage.json source "<Town>, MA".
  scripts/gate/aliases.json maps Boston neighbourhoods and Barnstable villages to their source,
  every row marked "owner confirms"; leave any doubtful name out. A town with no source and no
  alias is NO_SOURCE (it is a claim with nothing behind it, e.g. permits/dennis.html).
- Page state, on every finding: "frozen" if the page has id="mp-coverage-note" or its newest
  JSON-LD dateModified is more than STALE_DAYS before corpus_last; else "generated". The engine's
  dark branch cannot be seen in built HTML: never label one.

RULES (the code is the contract; every finding is WARN or UNJUDGED, never an error)
G1 value promise: /\b(declared|project|job)\s+(project\s+)?values?\b/i or "value of each job".
  Town-scoped: valued_pct 0 -> G1.no_value; 0 < valued_pct < 50 -> G1.low_value; >= 50 -> none;
  NO_SOURCE -> G1.no_source. Sitewide -> G1.sitewide citing "no_valuation of n_sources sources
  publish no value"; on a region page also "K of the M linked towns with a source have
  valued_pct 0".
G2 owner-name promise: "owner name", "homeowner name", or "owner"/"owners" or a bare "name"
  inside a list of lead fields (address, project type, value, contractor, permit holder), e.g.
  "with owner, address and project type", "the name, address, and project value", "owners and
  project values included" -> G2.owner_name on any page. Grounds: index.html:24-25 and
  catalog.json:1886. NOT a finding: "reach owners", "reaching an owner the week they file", "the
  owner has already committed", "contractor leads", and the index.html:22-25 comment itself.
G3 contractor promise: "contractor" or "permit holder"/"permit-holder" as a lead field ("address,
  contractor", "contractor details", "the contractor on file") -> G3.contractor UNJUDGED:
  coverage.json has no contractor field. Listed for owner review with counts, never a WARN.
  "contractor leads" and "contractor guide" are not lead fields.
G4 region label: labels from data.json areas[].label. Where: JSON-LD spatialCoverage.name
  ("<Region>, Massachusetts"), JSON-LD keywords equal to a label, visible "<Town>, <Region>", and
  on region pages each linked /permits/<slug> town against the page's region. Truth:
  scripts/gate/town-county.json (town -> county) for exactly the towns in coverage.json plus
  aliases, written by you, every row "owner confirms"; Great Barrington, Lee, Lenox, Stockbridge,
  New Marlborough, Otis and Pittsfield are Berkshire. Allowed labels by county, in the script:
  Berkshire, Franklin, Hampshire, Hampden -> Western MA; Barnstable, Dukes, Nantucket -> Cape
  Cod & Islands; Suffolk -> Greater Boston; Worcester -> Central MA, MetroWest & 495; Middlesex
  -> Greater Boston, MetroWest & 495, North Shore & Merrimack; Essex -> North Shore & Merrimack,
  Greater Boston; Norfolk -> Greater Boston, South Shore & South Coast, MetroWest & 495;
  Plymouth -> South Shore & South Coast, Greater Boston; Bristol -> South Shore & South Coast,
  MetroWest & 495. Label outside the set -> G4.region; town or county unknown -> G4.unjudged.
G5 recency (count-bearing phrases only): /\b\d[\d,]*\+?\s+(most\s+)?recent\b/i, "live
  preview", "most recent permits", "latest permits", "this week". Generic copy such as "a permit
  is only fresh for a few days" is not a claim. Newest date = the page's newest JSON-LD
  dateModified, or for a mapped town the source's last, whichever is newer. STALE_DAYS = 14
  and STALE_DAYS_MONTHLY = 45 (owner decision: towns that publish monthly always run behind, so
  a source whose cadence in the evidence files is monthly uses 45; both exported constants,
  printed in the report). Town-scoped: corpus_last minus newest > the town's limit
  -> G5.stale (report days); NO_SOURCE or source in errors -> G5.no_source (note
  "paused note present" when mp-coverage-note exists). Sitewide: the homepage script at
  index.html:384 (masked from text rules) renders the data.json count as "fresh ... permits
  available"; read the raw index.html for that template, and if present and corpus_last minus
  corpus_first > STALE_DAYS -> G5.fresh_count, reporting the span and the share of corpus rows
  from sources whose last is stale.
G6 cadence: "every week", "each week", "weekly", "every Monday", "daily", "updating". Product
  names are not cadence claims about a town: "weekly feed", "weekly brief(s)", "weekly digest",
  "weekly activity report". Town-scoped on a source listed in coverage.json monthly ->
  G6.monthly (grounds: research/coverage.html:91); NO_SOURCE or errors -> G6.no_source.
  Sitewide cadence claims -> G6.unjudged (the send log is private; delivery is judged
  elsewhere), listed with counts.
G7 count drift (build last): "<N> Massachusetts towns", "<N> municipal permit sources", "<N>
  sources" on sitewide pages vs coverage.json n_sources -> G7.count when they differ (index.html
  :26 says 70, n_sources is 71). "towns and neighbourhoods" counts are UNJUDGED.
G0 (info): unparseable JSON-LD blocks, pages with no resolvable town. Counted, never a WARN.

FILES
- scripts/gate/gate.mjs: CLI. node scripts/gate/gate.mjs --root <checkout> --out <report.md>
  [--json <findings.json>] [--stale-days N]. Imports only node:fs, node:path, node:process,
  node:url and ./lib.mjs. Exit 0 whenever it ran, findings or not. Exit 2 with exactly one fixed
  line "gate: evidence unreadable: <relative path>" (no stack, no file content) if coverage.json
  or data.json is missing, unparseable or lacks stats.table / areas; exit 2 "gate: --out inside
  --root refused" if an output path is inside --root, before writing anything. Stdout: counts per
  code only, no excerpts (Actions logs are public).
- scripts/gate/lib.mjs: pure functions (mask, extract surfaces, resolve town, rules, render).
- scripts/gate/town-county.json, scripts/gate/aliases.json (as above).
- scripts/gate/fixtures.mjs: builds synthetic mini-sites in os.tmpdir() (coverage.json,
  data.json, pages). Real town names allowed; streets, people and numbers invented.
- scripts/gate/gate.test.mjs: node:test and node:assert only.
- docs/gate/public-output-gate.yml.txt and docs/gate/README.md (what each code means, how to
  install the workflow, how to read the report, that nothing blocks).

REPORT FORMAT (markdown, no em or en dash)
Header: checkout sha if readable from .git without running git, else "unknown"; evidence line
(corpus_last, n_sources, no_valuation, monthly count, errors count, STALE_DAYS); "Warn-only.
Nothing here blocks a build." Then a summary table: Code | WARN or UNJUDGED | Pages | Occurrences
| Frozen | Generated. Then one section per code: Page | Line | Surface (title, meta, og, ld:<path>,
text) | Town | Evidence (e.g. "coverage.json valued_pct 0.0") | Excerpt. First 25 rows per code,
then "and N more"; the full list goes to --json. Excerpts: the matched sentence, at most 120
chars; an excerpt containing "@" or /[0-9a-f]{32}/ is replaced by "[excerpt withheld]". Last:
"Unjudged, for the owner" (G3, G4.unjudged, G6.unjudged) and "Unmapped pages" counts.

WORKFLOW (docs/gate/public-output-gate.yml.txt; the owner installs it by hand)
name: MassPermits public output gate. on: schedule, one weekly cron "0 18 * * 2" (Tuesday, after
the daily rebuild, away from Monday's send), and workflow_dispatch. Nothing else under on:.
Top-level permissions: contents: read, and no permissions key anywhere else. No id-token, no
secrets.* reference, no push, no git commit. One job: actions/checkout (ref: main,
persist-credentials: false), actions/setup-node (node-version "22"), a run step with
continue-on-error: true that writes to $RUNNER_TEMP, a step that appends the stdout counts to
$GITHUB_STEP_SUMMARY, and actions/upload-artifact of the report and JSON (retention-days: 30).
No run: block contains "${{". A header comment says it is warn-only and why it is a .txt file.

ACCEPTANCE (all must pass; paste the output into the PR body)
1. node --test scripts/gate/ exits 0. List each test and the pass count.
2. Twins: every code in G1-G7 has a positive fixture that yields that code and a negative twin
   that yields no finding of that code. Include: G1 valued_pct 0 vs 80, and "Project value" only
   in a <table> header -> none; G2 "homeowner name" vs "reaching an owner the week they file" and
   vs "owner name" inside an HTML comment; G3 "the contractor on file" -> UNJUDGED vs
   "contractor leads" -> none; G4 Great Barrington labelled Greater Boston in spatialCoverage,
   and linked from a -greater-boston region page, vs Western MA; a town absent from
   town-county.json -> G4.unjudged, never G4.region; G5 dateModified 40 days old vs 3 days, and a
   NO_SOURCE page; G6 monthly source "every week" vs a non-monthly source, and vs "a weekly
   feed $99/mo" on the monthly source's page; G7 70 vs 71. Print a
   table code -> positive -> negative -> Y/N. Do NOT assert a total.
3. Boundaries: age STALE_DAYS -> none, STALE_DAYS+1 -> G5.stale; valued_pct 0 -> no_value, 0.1
   -> low_value, 49.9 -> low_value, 50 -> none.
4. Masking: a fixture puts SENTINEL_TABLE, SENTINEL_COMMENT and SENTINEL_SCRIPT next to "declared
   value" inside a table, a comment and a non-LD script: no finding and no sentinel in the report.
   A finding's file:line equals the line of the match in the original file.
5. Offline: a test sets globalThis.fetch to a stub that throws and runs the gate on a fixture: 0
   calls. No non-test file you add contains "fetch(" or imports node:http, node:https, node:net,
   node:dns or node:child_process.
6. Warn-only and read-only: a fixture full of findings exits 0; missing, truncated and wrong-shape
   coverage.json each exit 2 with the fixed line and no stack; hash every file under the fixture
   root before and after a run: identical; --out inside --root exits 2 and writes nothing.
7. Leak and style: the report and stdout contain no "@", no /[0-9a-f]{32}/, no "cus_"; no file you
   add contains an em dash or en dash.
8. Route grep: no non-test file you add, comments included, matches
   (?<![A-Za-z0-9_])/api/(weekly-send|mail-owner|newsletter-send|newsletter|nurture|lifecycle-send|request-sample|agent-sample|upload-bundle|funnel|hit)\b,
   masspermits\.com/api/(the same list), force=1, or a *.pages.dev host.
9. Workflow lint by line rules (no YAML dependency): on: holds only schedule and
   workflow_dispatch; exactly one cron; permissions exactly contents: read, top level only; the
   file has no "id-token", "secrets.", "actions: write", "contents: write", "git push",
   "git commit", "pull_request", "workflow_run" or "push:"; checkout has ref: main and
   persist-credentials: false; the gate step has continue-on-error: true; the only uses: are
   actions/checkout, actions/setup-node and actions/upload-artifact; no run: block has "${{".
10. git diff --name-only origin/main...HEAD lists only scripts/gate/* and docs/gate/*, no .html
    and nothing under .github/.
11. Live run on your checkout: node scripts/gate/gate.mjs --root . --out <tmp>/gate.md --json
    <tmp>/gate.json exits 0 in under 60 s (report the time). Every anchor in EVIDENCE either
    appears with its code or is explained (line moved, claim gone, rule gap). Report the number of
    distinct permits/ pages with G1.no_value; an unverified note claimed 321; report your number
    and do not tune rules to reach it.

IF CREDIT RUNS SHORT
Build in this order and stop cleanly: G1, G2, G4, the workflow .txt, acceptance 1-10; then G5,
G6, G3; G7 last. A draft PR that says what is not built beats a half-built rule.

REPORT in the PR body: files added, Node version, per-test pass counts, the twins table, the live
summary table and the first 10 rows of G1.no_value, G2.owner_name and G4.region, the G1.no_value
page count, every EVIDENCE anchor that moved, the town-county.json and aliases.json rows as a
table for the owner to confirm, and anything surprising quoted as file:line and phrased as a
question for the owner (do not fix pages). Say plainly what you could not verify offline,
including whether Pages serves scripts/gate/ and docs/gate/ as public URLs.
