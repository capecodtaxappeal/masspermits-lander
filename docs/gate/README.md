# Public Output Gate

A warn-only lint of the built public site as committed on main. It reads the
pages the site actually serves and flags promises that the site's own published
evidence cannot back. It does not fix anything, it does not block anything,
and it never writes to the repo.

Evidence it judges against (both committed on main by the daily refresh):

- `research/evidence/coverage.json`: `corpus_first`, `corpus_last`,
  `stats.n_sources`, `stats.no_valuation`, `stats.monthly`, `stats.errors`
  and `stats.table` (one row per source: rows, first, last, valued_pct, ...).
- `data.json`: `areas[].label` gives the region labels.
- `scripts/gate/town-county.json` and `scripts/gate/aliases.json`: town to
  county, and site place names (Boston neighbourhoods, Barnstable villages) to
  their source. Every row is marked "owner confirms" until the owner does.

## Nothing blocks

The gate exits 0 whenever it ran, with or without findings. Every finding is
WARN or UNJUDGED (G0 is information only). The workflow step also has
`continue-on-error: true`. It exits 2 only when it could not run at all:

- `gate: evidence unreadable: <relative path>` when coverage.json or data.json
  is missing, unparseable or the wrong shape.
- `gate: --out inside --root refused` when an output path is inside the
  linted tree. It checks this before writing anything.

## Run it

    node scripts/gate/gate.mjs --root <checkout> --out <report.md> [--json <findings.json>] [--stale-days N]

Node 22, built-ins only, no install. `--out` and `--json` must be outside
`--root`. Stdout carries counts per code only, never excerpts, because
Actions logs of a public repo are public.

Tests: `node --test scripts/gate/` (Node 22 resolves the directory through
`scripts/gate/index.js`, which only loads `gate.test.mjs`). Fixtures are
synthetic and written to the OS temp dir; no fixture page is committed.

## What is linted

- Town-scoped: `permits/*.html` (except `permits/index.html`),
  `guides/<town>-building-permits.html`, `news/<town>/*.html`.
- Sitewide: `index.html`, `offer.html`, `offer/index.html`, `llms.txt`,
  `llms-full.txt`, `permits/index.html`, `news/index.html`, the two statewide
  guides, and the root region pages `<trade>-leads-<region>.html`
  (`-massachusetts` is statewide).
- Surfaces: the first `<title>` in `<head>`, meta description, og:title,
  og:description, twitter:description, every string in every JSON-LD block
  (reported by JSON path, e.g. `ld:$.spatialCoverage.name`), and visible text.
- Masked, never linted or quoted: HTML comments, `<style>`, non-LD scripts,
  every tag with its attributes, and everything inside `<table>`. Masking
  replaces with spaces and keeps newlines, so every line number is the line in
  the real file.
- Also skipped: the site's own paused-coverage disclosure
  (`id="mp-coverage-note"`) and the "towns still reporting" card after it
  (`id="mp-live-routes"`), for cadence and region-link rules, because the
  towns and cadence they name are other towns.

Town resolution: guides and news from the path; permits from the `<h1>`
"<Town>, MA", else the longest known slug prefix of the file name. A town with
no coverage.json source and no alias is NO_SOURCE. Page state on each finding:
`frozen` if the page carries `mp-coverage-note` or its newest JSON-LD
dateModified is more than STALE_DAYS before corpus_last, else `generated`.

## Codes

| Code | Level | Meaning |
| --- | --- | --- |
| G1.no_value | WARN | Town page promises a declared/project value; the source's valued_pct is 0. |
| G1.low_value | WARN | Same, source valued_pct above 0 and below 50. |
| G1.no_source | WARN | Same, town has no source (or its source is in errors). |
| G1.sitewide | WARN | Sitewide value promise; cites no_valuation of n_sources, and on a region page K of the M linked towns with a source have valued_pct 0. |
| G2.owner_name | WARN | Owner or homeowner name promised as a lead field. Grounds: index.html comment (owner name is never shipped) and catalog.json rights. |
| G3.contractor | UNJUDGED | Contractor or permit holder promised as a lead field. coverage.json has no contractor field, so this is for owner review. |
| G4.region | WARN | Region label (JSON-LD spatialCoverage, JSON-LD keyword, visible "<Town>, <Region>", or a town linked from a region page) outside the labels allowed for the town's county. |
| G4.unjudged | UNJUDGED | Same claim, but the town or county is unknown to town-county.json. |
| G5.stale | WARN | Count-bearing recency phrase ("621 most recent", "live preview", "this week") on a town whose newest date is older than its limit: STALE_DAYS (14), or STALE_DAYS_MONTHLY (45) for monthly sources. |
| G5.no_source | WARN | Same phrase on a NO_SOURCE or errors town; notes a paused note when present. |
| G5.fresh_count | WARN | The homepage template renders the whole data.json count as "fresh ... permits available" while the corpus spans more than STALE_DAYS. Reports the span and the share of rows from stale sources. |
| G6.monthly | WARN | Cadence claim ("every week", "weekly", "every Monday", "daily", "updating") on a monthly source's page. Grounds: research/coverage.html. |
| G6.no_source | WARN | Cadence claim on a NO_SOURCE or errors town. |
| G6.unjudged | UNJUDGED | Sitewide cadence claim. The send log is private; delivery is judged elsewhere. |
| G7.count | WARN | "<N> Massachusetts towns", "<N> municipal permit sources" or "<N> sources" on a sitewide page differs from n_sources. |
| G7.unjudged | UNJUDGED | "<N> towns and neighbourhoods": not comparable to n_sources. |
| G0.ld_unparseable | INFO | A JSON-LD block that JSON.parse rejects. |
| G0.unmapped | INFO | A town-scoped page with no resolvable town. |

Product names are not cadence claims: "weekly feed", "weekly brief(s)",
"weekly data brief(s)", "weekly digest", "weekly roundup", "weekly activity
report". A negated cadence ("not updating") is not a claim either.

## Reading the report

Header: checkout sha (short), the evidence line, "Warn-only. Nothing here
blocks a build." Then a summary table (Code, level, pages, occurrences, frozen,
generated), then one section per code with the first 25 rows (Page, Line,
Surface, Town, Evidence, Excerpt) and "and N more". The full list is in the
JSON. Excerpts are the matched sentence, at most 120 characters; any excerpt
with "@", a 32-hex run, "cus_" or a house-number-and-street shape is replaced
by "[excerpt withheld]".

Most pages are regenerated daily by the refresh bot, so a finding is fixed in
the engine that writes the text, not in the built page.

## Installing the workflow

`docs/gate/public-output-gate.yml.txt` is the workflow. It is a .txt file
because this project may not add anything under `.github/`. To install, the
owner copies it by hand to `.github/workflows/public-output-gate.yml` on main.
It runs weekly (Tuesday 18:00 UTC, after the daily rebuild and away from
Monday's send) and on manual dispatch only; it has `contents: read` and
nothing else, checks out main without persisted credentials, writes the report
to `$RUNNER_TEMP`, puts the counts in the job summary and uploads the report
and JSON as an artifact kept 30 days.
