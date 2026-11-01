# Funnel audit, 2026-11-01

Scope: the whole path from a first visit to a paid $99 a month Weekly Feed, read as a skeptical contractor or supplier on a phone. Everything below was read from the repo at commit `3883df10f` (main) and rendered locally with headless Chromium at 375 px, with all outside network requests blocked. No live endpoint, Stripe, Resend, R2 or Cloudflare call was made. Nothing in this PR changes a page; it is a findings document only.

Notation: where current site text contains an em dash, it is written here as `[em dash]` (this document does not use the character itself). Real names, personal email addresses and the mailing address are referred to by role, not written out.

## What the funnel is today

1. Visit. Most search traffic lands on a generated page (`permits/<town>-<trade>.html`, or `<trade>-leads-<region>.html`). Its main button is "See a free sample", linking to `/?trade=..&area=..#sample` on the home page. The home page hero button goes straight to the Stripe payment link.
2. Sample request. The home page form (`index.html`, `#signup-form`) asks for an email only. Trade and area are taken from the two dropdowns in the hero, about 2,600 px higher on a phone. It posts to `/api/request-sample` and to Web3Forms.
3. What the requester gets. `functions/api/request-sample.js` emails a link to `/api/sample`, which serves `latest-sample.zip` from R2: a ZIP holding `MassPermits-Leads.html` plus CSVs, about a thousand statewide permits, street numbers and names masked. The email says "~45 towns". The on-page success state links to the same ZIP.
4. Nurture. `functions/api/nurture.js` sends two emails: day 3 ("3 ways contractors turn permits into jobs") and day 7 ("Want fresh MA permit leads every Monday?"). Then nothing.
5. Checkout. One Stripe payment link, `buy.stripe.com/dRmd...gg01`, $99 a month. Its product description (set in Stripe, not in this repo) still promises homeowner names.
6. After purchase. `stripe-webhook.js` sends the bundle email; `_lifecycle_mail.js` sends a welcome (link, no attachment), a day 3 trade-fit email, a day 14 rescue and a 30 day win-back. The paid customer gets a hosted browser view (`functions/leads.js`); the prospect does not.

## What the data can and cannot back

From `research/coverage.html` and `research/evidence/coverage.json` (current build):

- 85,477 permit records from 91 municipal sources, 7 regions in `data.json`.
- 51 of 91 sources publish no declared project value at all.
- 21 of 91 publish category labels only, not a description of the work (Pittsfield, Attleboro, Mashpee, Chicopee, Easton, Ludlow, North Reading and others are at 0 percent description).
- 20 sources publish monthly, so their newest weeks always lag.
- 7 sources returned nothing on the latest run.
- There is no per-source figure anywhere in the repo for how often a permit holder (contractor or applicant) is present. The site promises "the permit holder where the town lists one", which is honest, but 1,253 generated pages drop the qualifier (see change 9).
- Owner names are never shipped (`index.html` comment near line 25, `catalog.json` rights, the G2.owner_name gate).

## Weight and speed of key pages (local render, 375 px)

| Page | Total bytes | Requests | Scripts | Images | Notes |
|---|---|---|---|---|---|
| `index.html` | 161,506 | 5 | promo-switch.js 1.9 KB, buy-click.js 1.4 KB | 0 | HTML 41.6 KB, `data.json` 116 KB fetched for the teaser table |
| `offer.html` | 10,074 | 4 | same two | 0 | lightest page |
| `offer/index.html` | 130,910 | 5 | same two | 0 | downloads the 116 KB `data.json` to print one number |
| `roofing-leads-cape-cod-islands.html` | 22,034 | 2 | inline only | 0 | page scrolls sideways (406 px) |
| `permits/falmouth-roofing.html` | 21,052 | 2 | inline only | 0 | fits |
| `permits/boston.html` | 98,927 | 2 | inline only | 0 | inline SVG map; page scrolls sideways (451 px) |
| `permits/index.html` | 41,246 | 2 | inline only | 0 | fits |
| `agents.html` | 13,461 | 3 | buy-click.js | 0 | fits |
| `research/coverage.html` | 28,415 | 2 | inline only | 0 | scrolls sideways (381 px) |

No page loads a third-party script, font or image. Weight is not the problem; layout and the sample are.

## Mobile layout at 375 px

- 64 of 87 regional `*-leads-*.html` pages are wider than the screen (up to 539 px on `new-construction-leads-massachusetts.html`), so the whole page drags sideways under a thumb. A spread sample of 236 `permits/*.html` pages found 31 that do the same (about 13 percent). Cause: the five-column preview `<table>` is not wrapped. The home page already fixed this with `<div style="overflow-x:auto">`; the generated pages never got it.
- Form fields are below 16 px (home email input 15 px, hero selects 14 px, the `.alertform` email inputs 15 px). iOS Safari zooms the page when a field under 16 px is focused, so the sample form jumps on every iPhone.
- On the home page the sample form starts at about 3,300 px (four phone screens down). The hero link to it, "Or see a free sample first, no card needed", is a 20 px tall text link, under the 44 px tap target guideline.
- On `permits/boston.html` the free digest form (1,547 px) sits above the sample button (2,588 px), so the free weekly roundup, which never converts to a sample, gets the first ask.

## Dead links

A static check of every `href` on 5,058 pages (all `permits/`, all `*-leads-*`, `guides/`, `projects/`, `news/`, `report/`, `research/`, home, offer pages, agents, 404) found one broken internal link: `/permits/west-end-electrical` on `electrical-leads-massachusetts.html` (no such page). Everything else resolves. Link hygiene is good.

## Claims the data cannot back, or that read wrong to a skeptic

| Where | Current text | Problem |
|---|---|---|
| Stripe product description (outside repo) | promises homeowner names | We never ship owner names. Read at the moment of paying. |
| `functions/api/request-sample.js` | "~45 towns" | Coverage page says 91 sources. Undersells, and disagrees with the site. |
| `functions/api/nurture.js` email3 | "(Boston, Cape Cod, the South Shore)" | Coverage is 7 regions statewide. Undersells. |
| `functions/api/nurture.js` email2 | "The "By contractor" view shows every competitor's active job count and value." | 51 of 91 sources publish no value; permit holder is not on every row. "every" and "value" overclaim. |
| 1,253 `permits/*.html` pages | "Exact addresses, the permit holder, and a sortable file" | Drops "where the town lists one". No coverage figure for permit holder exists. |
| 754 `permits/*.html` meta descriptions, and `permits/boston.html` body | "with the full address, project type and permit holder" / "every one into a ready-to-work lead with the exact address, permit holder and project type" | Same missing qualifier, in the Google snippet. |
| Many emails and pages | "the name on the permit where the town lists one" | A contractor reads "the name on the permit" as the homeowner. Ambiguous on exactly the point the checkout gets wrong. |
| Generated town and region pages | "Each is a homeowner who just got approved for work" | Includes commercial permits; and for a roofing permit the roofer is usually already hired. |
| `index.html` hero | "the owner is spending on it right now, and your trade is next" | For the trade on the permit, the job is usually already sold. This is the first objection a contractor raises. |
| `index.html` price box | "BEST VALUE" badge | There is one plan. A badge with nothing to compare against reads as sales copy. |

## The 15 changes, ranked

Ranked by expected effect on sample to paid and visit to sample, highest first. Each one keeps to what the data ships.

### 1. Fix the Stripe checkout description (sample to paid, refunds)

- File: Stripe Dashboard, Product for payment link `dRmd...gg01`, field "Description". Not in this repo, so this PR cannot change it.
- Current text: promises homeowner names (known open issue; the exact wording lives only in Stripe).
- Proposed text: `Every Monday: Massachusetts building permits from the towns we cover, filterable by trade and town. Full street address, permit date and project type, plus the permit holder (usually the contractor or applicant) and declared value where the town publishes them. No homeowner names. Cancel anytime.`
- Why: the checkout is the last thing a skeptic reads, and it is the one place the product is described wrongly. Either it closes a sale on a promise we break (refund, chargeback, bad word of mouth in a small trade), or a careful buyer notices it disagrees with the site and leaves. Cheapest high-value fix in this list.

### 2. Make the free sample open on a phone

- Files: `functions/api/request-sample.js` (sample email), `functions/api/sample.js` (download), `index.html` (success state).
- Current text (`request-sample.js`): `Open MassPermits-Leads.html in any browser (names &amp; street numbers masked in the free one).` and the link `↓ Download the free sample` pointing at `/api/sample`, which returns `MassPermits-FREE-SAMPLE.zip`.
- Current text (`index.html`): `Got it! Your free sample is ready [em dash] download it here (also check your inbox).`
- Proposed: serve the sample dashboard as a web page (for example `/api/sample?view=1` streaming the HTML file from the same R2 object, `Content-Type: text/html`, exactly as `functions/leads.js` already does for paying customers), keep the ZIP as a second link.
  - Email: `<a href="https://masspermits.com/api/sample?view=1">Open the free sample in your browser</a> (works on a phone, nothing to install). On a computer you can also <a href="https://masspermits.com/api/sample">download the ZIP</a> with the spreadsheets.`
  - Page: `Got it. <a href="/api/sample?view=1">Open your free sample</a> (opens in this browser). A copy is on its way to your inbox.`
- Why: buyers are on phones, and a ZIP containing an HTML file is close to unopenable on an iPhone. The repo already records this for paying customers ("another bought on a phone and cannot open a ZIP", `functions/leads.js` header; the welcome email says "or the zip will not open on your phone"). The prospect, who has less reason to persist, gets only the ZIP. A sample that never opens cannot convert.

### 3. Make the sample about the requester's trade and towns

- Files: `index.html` (`#signup-form`), `functions/api/request-sample.js` (`TRADES`, `AREAS`, `sendSample`).
- Current text (`index.html`): form holds only `<label for="email" class="flabel">Your email address, for the free sample</label>` and the email input; trade and area are silently read from the hero dropdowns far above.
- Current text (`request-sample.js`): `Around a thousand recent Massachusetts building permits, ~45 towns and every trade. Open it and filter to ${t}.` and a `TRADES` list that lacks `Septic`, `Building` and `Asbestos`, which are in `data.json` `trade_list` (a septic installer who picks Septic is stored with no trade).
- Proposed:
  - Add two selects inside the form, labelled `Your trade` and `Your area`, prefilled from the hero values, using the same option lists as the hero (`data.json` `trade_list` and `areas`). Add `Septic`, `Building`, `Asbestos` to `TRADES` and the seven region keys (`metrowest`, `northshore`, `central`, `western` are missing) to `AREAS`.
  - Email first paragraph: `Your sample: ${trade} permits in ${area}. ${count} are on file for your slice, the newest dated ${newest}. The full file covers 91 town sources statewide; this sample shows your slice so you can judge it on your own patch.` (numbers from `data.json` segment `count` and `newest`, the same figures the home page already shows.)
- Why: a roofer on the Cape gets a statewide pile and has to do the filtering on a phone before seeing anything relevant. The agents page (`agents.html` and `agent-sample.js`) already sends a town-specific sample; the contractor path should be at least as specific. The numbers are ones the build already computes.

### 4. Let a sample row be checked

- Files: the sample build (outside repo, publishes `latest-sample.zip`) and `request-sample.js`.
- Current text (`request-sample.js`): `(names &amp; street numbers masked in the free one)` and `This batch goes stale in a week: permits are a flow, not a list.`
- Proposed (owner decision): include five unmasked rows (full street address, date, type, permit holder where listed; never owner names) from the requester's trade and area, each at least 30 days old, and say so: `Five rows are shown in full so you can check them against the town's own records or drive past. Every other row has the house number hidden. The paid feed shows every row in full, every Monday.`
- Why: the sample asks a skeptic to judge "data quality" with the one field that makes a lead workable removed. Nothing in it can be verified, so "is this real?" stays open. Five old, public, owner-name-free rows give away almost nothing and answer the question. The street-only preview is already public on every town page, so the masked sample adds little beyond it.

### 5. Answer "the job is already sold" honestly, on the home page

- File: `index.html` (hero paragraph and FAQ).
- Current text (hero): `When a building permit is filed on a home, the owner is spending on it <em>right now</em>, and your trade is next.`
- Proposed (hero): `A building permit is a dated public record of real work at a real address. The trade on the permit is usually already hired; the value is in everyone who comes next (insulation, drywall, gutters, flooring, septic, dumpsters, materials) and in seeing who is winning the work in your towns.`
- Add FAQ:
  - Q: `If a permit is filed, isn't the job already sold?`
  - A: `Often, for the trade named on the permit. That is why most subscribers use it one step over: an addition or a gut remodel needs insulation, drywall, windows, a dumpster and materials after the framing permit; a new septic or new house needs sitework; a supplier sells to the contractor who pulled it. The file shows the address, the project type, the date, and the permit holder where the town lists one, so you can reach the job or the contractor before the next trade is picked.`
- Why: this is the first objection a contractor raises and the site never addresses it; the current hero makes the opposite claim. Answering it plainly is both more honest and more persuasive to a skeptic, and it fits the buyer list (suppliers and follow-on trades).

### 6. Speak to suppliers by name

- File: `index.html` (How it works, step 3, and the trade link list).
- Current text: `<h3>You reach out</h3><p>Full address and project type, plus the permit holder and declared value where the town lists them. Every row shows its date.</p>`
- Proposed: `<h3>You reach out</h3><p>Contractors: reach the property before the next trade is picked. Suppliers (lumber yards, insulation, drywall, roofing supply, septic and sitework, kitchens, dumpsters): reach the permit holder, where the town lists one, the week the job starts. Every row shows its date.</p>`
- Why: half the stated buyer list (lumber yards, supply houses, dumpsters, insulation, drywall) is never mentioned on the home page, offer pages or generated pages, which speak only to "your trade". A supply-house rep who lands on the site sees nothing that says this is for them.

### 7. Correct the stale coverage numbers in the sample and nurture emails

- Files: `functions/api/request-sample.js`, `functions/api/nurture.js`.
- Current text (`request-sample.js`): `Around a thousand recent Massachusetts building permits, ~45 towns and every trade.`
- Proposed: `Around a thousand recent Massachusetts building permits from across the 91 town sources we cover, every trade.`
- Current text (`nurture.js`, email3): `Every Monday morning the newest building permits across Massachusetts (Boston, Cape Cod, the South Shore) go out to our subscribers as the full, unmasked batch, in their inbox before the week starts.`
- Proposed: `Every Monday morning the newest permits from the 91 Massachusetts town sources we cover, in seven regions from Cape Cod to the Berkshires, go out to subscribers as the full file. Some towns publish monthly, so their permits arrive in batches; every row shows its date.`
- Why: the emails undersell coverage by half and contradict the coverage page, which a careful buyer will check. A Worcester or Western MA contractor reading "Boston, Cape Cod, the South Shore" concludes the product is not for them. Better still, read the count from the build instead of hard-coding it.

### 8. Say "permit holder", never "the name on the permit"

- Files: `functions/api/request-sample.js`, `functions/api/nurture.js`, `functions/api/agent-sample.js`, `functions/api/newsletter.js`, `functions/api/newsletter-send.js`, and the generated-page footer note.
- Current text (`request-sample.js`): `The $99/mo Weekly Feed unlocks every full address, plus the name on the permit where the town lists one, fresh every Monday.` (and the same phrase in `nurture.js` email2, `agent-sample.js`, `newsletter.js`, `newsletter-send.js`; generated pages: `the name on the permit where the town lists one`).
- Proposed: `The $99/mo Weekly Feed has every full address, plus the permit holder (usually the contractor or applicant) where the town lists one, fresh every Monday. We never include homeowner names.`
- Why: "the name on the permit" is exactly the phrase a buyer reads as "the homeowner's name", which is the same misunderstanding the Stripe description creates. Removing the ambiguity before checkout prevents the disappointed first download that leads to a refund or a quiet cancel. `agent-sample.js` already adds "(not always the owner)", which shows the problem was noticed once.

### 9. Restore the "where the town lists one" qualifier on generated pages

- Files: 1,253 `permits/*.html` pages (body card) and 754 `permits/*.html` meta descriptions, plus `permits/boston.html`-style town hubs. These are generated by the SEO build, which is not in this repo; fix the template there.
- Current text (body card, for example `permits/falmouth-roofing.html`): `Exact addresses, the permit holder, and a sortable file [em dash] plus a free sample so you can see the quality first.`
- Proposed: `Exact addresses, the permit holder where the town lists one, and a sortable file. See a free sample first.`
- Current text (meta description, for example `permits/falmouth-roofing.html`): `Roofing contractor leads in Falmouth, MA [em dash] 175 recent roofing building permits with the full address, project type and permit holder. Free sample.`
- Proposed: `175 Falmouth, MA roofing permits, newest dated 2026-10-30. Full address and project type, permit holder where the town lists it. Free sample, no card.`
- Why: honesty first; the regional pages already carry the qualifier and the town pages dropped it. The proposed meta description also leads with the newest date, which is the thing a contractor scanning results cares about and which no competitor snippet shows; that is the honest lever on the 1.3 percent click-through. Also add a "with a permit holder" percentage column to `research/coverage.html` so the claim can be checked per town.

### 10. Stop generated pages scrolling sideways on phones

- Files: generated `*-leads-*.html` and `permits/*.html` (template outside repo); `research/coverage.html`.
- Current text: `<h2>Most recent roofing permits in Cape Cod &amp; Islands</h2><table><thead>...` (the table sits directly in the page; CSS `table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}`)
- Proposed: `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><table>...</table></div>`, the same fix `index.html` already carries with its comment "The five-column preview is wider than a phone (484px on a 375px screen), and it pushed the whole page sideways. It scrolls inside its own box now."
- Why: 64 of 87 regional pages and about 13 percent of town pages move sideways under the thumb at 375 px. On a phone that reads as a broken site, on exactly the pages search traffic lands on, before the visitor reaches the sample button.

### 11. Stop iPhones zooming into the forms

- Files: `index.html` and the generated pages' `.alertform` CSS.
- Current text (`index.html` line 99 to 100): `.capture input{flex:1;min-width:210px;padding:13px 15px;border-radius:9px;border:1px solid var(--border); background:var(--bg);color:var(--text);font:inherit;font-size:15px}` (and the hero `select` elements compute to 14 px).
- Proposed: `font-size:16px` on `.capture input`, on `.controls select`, on `#digest-email`, and on `.alertform input[type=email]` in the generated template.
- Why: iOS Safari zooms the page when a field under 16 px gains focus, so tapping the sample email box shoves the layout sideways and the submit button off screen. One CSS value per rule.

### 12. Move the sample ask up on the home page and make it a real button

- File: `index.html`.
- Current text: `<a class="subcta inl" id="hero-sample" href="#sample" style="color:var(--teal)">Or see a free sample first, no card needed</a>` (20 px tall text link; the form is about 3,300 px down).
- Proposed: render it as a secondary button directly under the $99 button: `<a class="cta sm" id="hero-sample" href="#sample" style="background:transparent;border:2px solid var(--teal);color:var(--teal);display:block;margin-top:10px">Free sample for your trade and town, no card</a>`, and place the `#sample` block directly after the live preview table instead of after the price box.
- Why: most visitors arrive cold and will not pay $99 on a first visit; the sample is the realistic next step, and on a phone it is four screens away behind a link that is hard to tap. Sample requests are the input to everything else in this list.

### 13. Give the /offer/ page a route to the sample

- File: `offer/index.html` (and `offer.html`).
- Current text (`offer/index.html`): the page has two $99 buttons and no sample link at all; the footer says `Compiled from public municipal building-permit records.`
- Proposed: under each `Start the weekly feed: $99/mo →` button add `<a href="/?#sample" style="display:block;margin-top:10px;font-size:15px">Not ready? Get a free sample for your trade and town first →</a>`. Replace the `data.json` fetch (116 KB to print one count) with the count written at build time.
- Why: `/offer/` is the paid-traffic landing page (it logs `utm_source`). A visitor who is not ready to pay has nowhere to go but back. `offer.html` has a small "See a free sample" text link at 1,240 px; `/offer/` has none. Dropping 116 KB also speeds the first paint on a weak phone signal.

### 14. Make the nurture emails specific and true

- File: `functions/api/nurture.js`.
- Current text (email2): `<b>2. GCs: market intel.</b> The <b>"By contractor"</b> view shows every competitor's active job count and value. Know your market before you bid.`
- Proposed (email2): `<b>2. Suppliers and GCs: who is busy.</b> Where the town lists a permit holder, the "By contractor" view counts each contractor's recent permits in your towns. That is who is buying materials and hiring subs this month.`
- Proposed (sequence): for prospects with a trade on file, send the computed trade-fit email that `_lifecycle_mail.js` (`tradefitEmail`) already writes for subscribers ("You picked ${trade} in ${area}, so here is where the work actually is", with upper and lower counts and the monthly-town caveat) as the day 3 email, in place of the generic tips. Keep email3 as the day 7 close.
- Why: the subscriber trade-fit email is the best copy in the repo: specific, computed, honest about blind towns. Prospects, who most need to see their own numbers, get a generic tip list with an overclaim in it ("every competitor's ... value" while 51 of 91 sources publish no value). Reusing a renderer that already exists is a small change.

### 15. Do not show an error after the sample was already sent

- File: `index.html` (`#signup-form` submit handler).
- Current text: `else { $("signup-err").style.display="block"; $("signup-err").textContent = d?.message||"Something went wrong: please email us directly."; }` shown when the Web3Forms call fails, even though `/api/request-sample` (fire and forget, above it) has already enrolled the address and sent the sample.
- Proposed: await `/api/request-sample` and show success on its `ok`; treat Web3Forms as a background notification only (`request-sample.js` already notifies the business inbox, per its own comment). Error text, only when `/api/request-sample` itself fails: `That didn't go through. Try again, or reply to any MassPermits email and we'll send the sample by hand.`
- Why: a third-party outage or rate limit currently tells a real requester the form failed. If they retry, `request-sample.js` silently does nothing (address already enrolled), so they see the same error and give up, while a sample sits unopened in their inbox. Success should track the system that actually sends the sample.

## Also found (lower priority)

- Dormant promo markup: `index.html` (FOUNDER2026, $49 banner and price-box line) and `offer.html`, `offer/index.html` (FIRST90, $9.90) still carry the promo templates, switched off in `js/promo-switch.js`. Policy is $99 only, no promos; delete the templates and the switch so a one-line edit cannot put a promo back on the page.
- `index.html` price box: remove the `BEST VALUE` badge; there is one plan.
- `index.html` "Already subscribed?" line links to the founder's personal mailbox by name; use the public business inbox so a real name and personal address are not on the home page.
- Trust signals: there is no business identity on the home page beyond a first-name signature. The business mailing address already printed in the `nurture.js` footer could go in the site footer; the sample email (`request-sample.js` `wrap`) is missing it, though both emails carry the same pitch.
- Dead link: `/permits/west-end-electrical` on `electrical-leads-massachusetts.html`.
- Generated pages say "Each is a homeowner who just got approved for work"; many rows are commercial. Suggest "Each is a dated permit for approved work at a real address."
- North Shore and Merrimack has 1,161 permits and $0 declared value in `data.json`; the home page shows a blank value line for that area. A short "these towns do not publish project values" line would read better than nothing.
- 932 of 3,549 `permits/*.html` pages carry `noindex,follow` already; the roughly 875 pages Google declines to index are a separate, likely thin-page, question for the SEO build and are not ranked here.
- `index.html` fetches 116 KB of `data.json` on every visit to fill a 6-row teaser. Splitting it per area would cut the home page to about 50 KB.

## Method

- Text read: `index.html`, `offer.html`, `offer/index.html`, `agents.html`, `404.html`, `research/coverage.html`, a spread of `permits/*.html` and all `*-leads-*.html`; `functions/api/request-sample.js`, `sample.js`, `nurture.js`, `agent-sample.js`, `_lifecycle_mail.js`, `stripe-webhook.js`, `functions/leads.js`, `js/promo-switch.js`, `js/buy-click.js`; `data.json`, `catalog.json`, `research/evidence/coverage.json`.
- Rendering: local static server bound to 127.0.0.1, Playwright Chromium, 375 by 812 viewport, mobile emulation, every non-local request aborted. Overflow measured as `document.documentElement.scrollWidth` above 376.
- Links: every relative and root `href` on 5,058 pages resolved against the repo tree using Cloudflare Pages clean-URL rules (`/x` to `x.html` or `x/index.html`); `/api/*`, `/leads`, `/r/*`, `/s/*` skipped as Functions.
