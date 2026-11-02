# Phone layout at 375 px, 2026-11-02

Follow-up to `docs/audit/FUNNEL_AUDIT_2026-11-01.md` (branch `claude/funnel-audit`), findings 10 and 11.

## Result in one line

Pages with horizontal overflow at 375 px, across all 5,436 HTML files in the repo: **453 before, 452 after** this branch. Applying the engine template fix below (simulated in the browser, not committed) brings the 453 to **0**.

## The premise did not hold: there is no shared stylesheet

The task was to fix overflow in the shared stylesheet the pages already load. No public page loads one. Every public page carries its CSS in an inline `<style>` block; the only `.css` files in the repo are the three under `admin/`, each loaded by one admin page. No shared script is loaded site wide either (`js/buy-click.js` is on 4 pages). Cloudflare Pages has no way to inject a stylesheet from `_headers` that Chromium or Safari would honour, and the middleware route would need `functions/`, which is out of scope.

So a single CSS change cannot reach the generated pages. Every overflowing page except one is bot generated, which means the fix belongs in the private engine templates (section "Engine template fixes"). This branch edits only the two hand-maintained pages that had a problem.

## Method

- Local static server on 127.0.0.1 serving the repo checkout; Playwright Chromium (pre-installed in the session, nothing added to the site build), viewport 375 by 812, mobile emulation, every request that was not to the local server aborted.
- Overflow: `document.documentElement.scrollWidth > clientWidth + 1` after `load`.
- Culprit: the outermost element whose right edge passes 376 px, then a second probe for elements whose own content overflows them (needed for long unbroken words, which do not move their box).
- Before = `origin/main` at `3883df10f`. After = this branch.
- Projected engine fix = the same pages with, injected at run time: every `<table>` that has no scrolling ancestor wrapped in `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">`, plus `p,li,dd{overflow-wrap:anywhere}`.

## Counts at 375 px

| Group | Overflowing before | Total pages | After this branch | After projected engine fix |
|---|---|---|---|---|
| Regional `*-leads-*.html` | 64 | 87 | 64 | 0 |
| `permits/` (town and town-trade pages) | 362 | 3,549 | 362 | 0 |
| `projects/` | 22 | 50 | 22 | 0 |
| `research/` | 3 | 8 | 3 | 0 |
| `guides/` | 1 | 143 | 1 | 0 |
| `widget/` | 1 | 374 | 0 | 0 |
| `news/`, `report/`, `offer/`, `admin/`, root pages (home, offer, 404, agents, ops) | 0 | 1,225 | 0 | 0 |
| **All HTML** | **453** | **5,436** | **452** | **0** |

The home page, the sample form on it, `/offer/` and `offer.html` do not overflow (the home page already wraps its preview table).

Widest pages before: `widget/index.html` 720 px, `projects/fire-alarm-permits-massachusetts.html` 546 px, `new-construction-leads-massachusetts.html` and `projects/demolition-permits-massachusetts.html` 539 px.

## Exact culprits

| Culprit | Pages | Where the CSS lives |
|---|---|---|
| Five-column preview `<table>` (`Issued, Town, Trade, Street, Project value`, or the project-type variant) not wrapped in a scroll box; `table{width:100%}` cannot shrink below its content | 449 (64 regional, 362 permits, 22 projects, `research/coverage.html`) | generated page markup |
| Long unbroken URL in an `<a>` inside `.card p.muted` (canonical link text) | `research/methodology.html` (410 px), `research/corrections.html` (397 px), `research/coverage.html` (381 px) | generated page |
| Long single word in `.guidebody p`: Chargoggagoggmanchauggagoggchaubunagungamaugg (Webster Lake) | `guides/webster-building-permits.html` (454 px) | generated page |
| `.grid` two-column layout collapses to one column, but grid items keep `min-width:auto`, so the `<pre>` code samples and the attribute table push the column to 720 px | `widget/index.html` | hand-maintained, fixed here |

`permits/boston.html` also reports an SVG `<g>` past the edge; it is clipped by its `<svg>` and does not cause scroll. The table is the real cause there.

## Form fields under 16 px (iPhone zoom on focus)

| Field | Before | After | Where |
|---|---|---|---|
| Home hero `.controls select` (`#sel-trade`, `#sel-area`) | 14 px | 16 px | `index.html`, fixed here |
| Home sample form `.capture input` (`#email`) | 15 px | 16 px | `index.html`, fixed here |
| Home digest `#digest-email` (inline style) | 14 px | 16 px | `index.html`, fixed here |
| Widget builder `select` | 14.5 px | 16 px | `widget/index.html`, fixed here |
| `.alertform input[type=email]` on regional, town, project and guide pages | 15 px | unchanged | generated template, engine fix |

## Changes on this branch

- `index.html`: three font sizes set to 16px (the two selects, the sample email field, the digest email field). Nothing else.
- `widget/index.html`: `select` font size 16px, and one rule `.grid>*{min-width:0}` so the code blocks and table scroll inside their own boxes (both already sit in `overflow-x:auto` containers).

No file under `functions/`, `.github/`, `data/` or any bot-regenerated page was touched. `js/promo-switch.js` was not touched.

## Engine template fixes (for the private engine)

1. Wrap every preview `<table>` in the regional, town (`permits/*`), project (`projects/*`) and research templates:
   `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table>...</table></div>`
   This is the same fix `index.html` already carries. Alternative in the shared inline `<style>` block: a `.tablewrap{overflow-x:auto}` class on the wrapper.
2. Add `p,li,dd{overflow-wrap:anywhere}` (or scope it to `.card p` and `.guidebody p`) to the inline `<style>` of the research and guide templates, for long URLs and long place names.
3. In the inline `<style>` of every template that prints the Monday roundup form, change `.alertform input[type=email]{... font-size:15px}` to `font-size:16px`.
4. Longer term: emit one shared `/site.css` from the engine and link it from every template, so the next layout fix is one file instead of a full regeneration.

Projected effect of 1 and 2, measured on all 453 overflowing pages: 0 overflow.

## Screenshots (375 px, cropped to the problem area, full scroll width)

| Page | Before | After |
|---|---|---|
| Home, sample form selects | `home-before.png` | `home-after.png` (this branch) |
| Widget builder | `widget-before.png` (720 px wide) | `widget-after.png` (this branch) |
| `roofing-leads-cape-cod-islands.html` | `regional-roofing-cape-before.png` (406 px) | `regional-roofing-cape-after-projected.png` (engine fix, simulated) |
| `permits/boston.html` | `town-boston-before.png` (451 px) | `town-boston-after-projected.png` (engine fix, simulated) |
| `guides/webster-building-permits.html` | `guide-webster-before.png` (454 px) | `guide-webster-after-projected.png` (engine fix, simulated) |

The three generated pages are unchanged on this branch; their "after" images show what the engine fix will do, rendered from the same repo files with the fix injected in the browser.
