# Conversion upgrade of the hand-maintained pages, 2026-11-03

Branch `claude/conversion-1103`, one draft pull request. Base: `main` at `cf81b6abd` (refresh bot, 2026-11-02).

Notation, as in the sibling docs: where old site text had an em dash it is written `[em dash]`, and an exclamation mark is written `[!]`. The founder's mailbox is referred to by role. No customer, subscriber or private person is named, and no business figures are repeated here (this repo is public).

## What this does, in one paragraph

The home page now opens on the trades and suppliers who sell **after** a permit is filed, with one primary action (get the free sample) and one secondary (subscribe, $99 a month) on the first screen at 375 px and at 1280 px. The sample form is in that first screen instead of four phone screens down, asks for the visitor's trade, area and towns, and checks each town against the build's own coverage file as it is typed ("Falmouth: 2,400 permits on file, newest dated 2026-11-02"). Below it, a proof section shows what the file contains (one real row field by field), how fresh it is and which towns it covers, all read live from files the build already writes. The FAQ answers the four objections the audits found (is the job already sold, which towns, how fresh, what if my town is missing) plus names, format, price and cancelling. The two offer pages get the same positioning and a route to the sample. Every visible em dash and exclamation mark on these pages is gone, and every form field is 16 px.

## Rules kept

- Edited only hand-maintained pages: `index.html`, `offer.html`, `offer/index.html`, `agents.html` (one line), `404.html` (two lines). Plus this document and its screenshots under `docs/conversion/`.
- Nothing under `functions/`, `.github/` or `data/`; no bot-generated page; no test file. `js/promo-switch.js` untouched, every code still `false`, and the dormant promo templates are left exactly as they were (see "Not changed").
- The free-sample form posts to `/api/request-sample` with the same field names as before (`email`, `trade`, `area`, `company`). One field is added (`towns`); the function ignores unknown fields, so this needs no server change to be safe. Storing and using it is listed under server changes.
- Visitor copy: no em or en dashes, no exclamation marks, $99 a month is the only price, no promos or discounts, no homeowner-name promise (the page now says plainly there is no homeowner name column), nothing about how data is collected beyond "public municipal permit records", no call or Zoom offers.
- No request to masspermits.com or any production endpoint. Every render was a local static server on 127.0.0.1 with every other request aborted (Web3Forms included); `/api/*` answered by a local stub.

## Inputs read

- `docs/audit/FUNNEL_AUDIT_2026-11-01.md` (branch `claude/funnel-audit`): changes 2, 3, 5, 6, 11, 12, 13 and 15 are acted on here for the hand pages; 1, 4, 7, 8, 9, 10 and 14 are server, Stripe or engine work and are carried into the lists below.
- `docs/home-copy/HOME_COPY_2026-11-02.md` (branch `claude/home-copy`): H1, H2, H3, H4, H6, O1, F1, F2, F3 and A1 are folded in (some reworded); H5, O2, F4 and its test change are not (see "Relationship to the open branches").
- `docs/phone-layout/PHONE_LAYOUT_2026-11-02.md` (branch `claude/phone-layout`): the `index.html` 16 px field fix is folded in and extended to the new fields; the `widget/index.html` fix is left to that branch; its engine template list is repeated in E5.
- The competitor map in the private townlab repo (branch `claude/market-landscape`) was read. Its contents are not reproduced in this public repo. Three of its points shaped this change: show the price on the page instead of behind a quote, answer "which towns?" right at the point of action, and let a buyer see the data for their own town before paying.

## Result, measured

Rendered with Playwright (installed Chrome), 375 by 812 with mobile emulation and 1280 by 800, reduced motion, all non-local requests aborted. Before = `main` at `cf81b6abd`; after = this branch.

| Measure | Before | After |
|---|---|---|
| Free-sample form, top of the card, 375 px | 2,981 px (fourth screen) | 582 px (first screen) |
| "Send my free sample" button, 375 px | 3,258 px | 1,000 px |
| Free-sample form, top of the card, 1280 px | 2,088 px | 117 px |
| "Send my free sample" button, 1280 px | 2,213 px | 518 px (first screen) |
| First-screen sample action, 375 px | text link, 20 px tall | filled button, 56 px tall, at 387 px |
| First-screen $99 action, 375 px | filled button (primary), 81 px tall | outlined button (secondary), 60 px tall, at 453 px |
| Form field font size (iOS zooms under 16 px) | 14, 14, 15, 14 px | 16 px on every field |
| Sideways scroll at 375 px (`scrollWidth`) | none (375) on all three pages | none (375) on all three pages |
| Em dashes a visitor can read | home 8 (+1 in the success message), `offer.html` 1, `/offer/` 3, 404 title 1 | 0 |
| Exclamation marks a visitor can read | 1 ("Got it[!]" after a sample request) | 0 |
| `/offer/` page weight | 131,223 bytes, 4 requests (data.json 116,895) | 33,819 bytes, 4 requests (coverage.json 17,710) |
| Home page weight | 163 KB (HTML 41.6 KB + data.json 117 KB) | 206 KB (HTML 66.7 KB + data.json 117 KB + coverage.json 17.7 KB, fetched after the page loads) |
| Home page height, 375 px | 5,597 px | 6,927 px (proof section and FAQ answers added) |

Byte counts are uncompressed, as served by the local server; Cloudflare compresses HTML and JSON on the wire.

## Changes, by ID

Each change has a before, an after and a reason, and can be kept or dropped on its own except where noted.

### C1. First screen (index.html)

**C1.1 Title and descriptions**
- Before, `<title>` and `og:title`: `MassPermits: building-permit leads for MA contractors`
- After: `MassPermits: Massachusetts building-permit leads for trades and suppliers`
- Before, meta description: `Building permits from towns across Massachusetts, sorted by trade and town, delivered as ready-to-work leads. Roofing, solar, HVAC, pools, remodels and more, with the full address and project type, plus the permit holder and declared value where the town lists them. Weekly feed $99/mo, free sample first.`
- After: `New Massachusetts building permits, sorted by trade and town, in one file every Monday, for the trades and suppliers who sell after the permit. Full address, date and project type, plus the permit holder and declared value where the town lists them. Free sample first, then $99 a month.`
- `og:description` rewritten the same way.
- Why: the search result and the shared link are the first screen before the first screen. It now names the buyer this page is written for, keeps the "building-permit leads" phrase the page ranks on, and puts the free sample before the price. JSON-LD blocks are untouched (the refresh bot maintains the Organization and WebSite ones).

**C1.2 Header: a route home for subscribers**
- Before: `<div class="loc">Massachusetts building-permit leads</div>` (a label), and a five-line "Already subscribed?" paragraph inside the hero.
- After: `<a class="navlink" href="#subscribers">Already subscribed?</a>` in the header, linking to its own block (C6.3).
- Why: the hero paragraph for paying customers took a phone screen of space between the buttons and the data. The route home stays one tap away on the first screen, and the hero is left to new visitors. The page comment that says to keep this route is kept and updated.

**C1.3 Eyebrow line, filled from the visitor's selection**
- Before: the H1 carried two spans, `<span id="h-area">` and `<span id="h-trade">`, so it read for example "Cape Cod &amp; Islands building permits, sorted into roofing leads and sent every Monday."
- After: the same two spans move to a small line above the headline: `Massachusetts building permits, every Monday`, which becomes for example `Cape Cod & Islands roofing permits, every Monday`. For a trade with no permit type of its own (C2.3) it stays `Cape Cod & Islands building permits, every Monday`, so it never reads as if insulation had permits of its own.
- Why: visitors from the generated pages arrive with `?trade=&area=` and should still see their trade and area at once, but the headline itself now has a job of its own (C1.4).

**C1.4 Headline**
- Before: `Massachusetts building permits, sorted into contractor leads and sent every Monday.`
- After: `Sell to the job after the permit is filed.` (the second half in teal)
- Why: the brief is to speak to the trades and suppliers who sell after a permit is filed. That buyer reads "contractor leads" as "jobs already sold to someone else". The new line says who it is for and why a permit is useful to them, in seven words that fit two lines at 375 px.

**C1.5 Lede**
- Before: `When a building permit is filed on a home, the owner is spending on it <em>right now</em>, and your trade is next. We collect building permits from the Massachusetts towns we cover, sort them by trade and town, and hand you the full address and project type, plus the permit holder and declared value where the town lists them.`
- After: `The trade named on a permit is usually hired already. Insulation, drywall, flooring, cabinets, gutters, sitework, dumpsters and the supply yard usually are not. Every Monday you get an updated file of permits from the towns we cover, sorted by trade and town.`
- Why: answers the first objection (audit change 5, home-copy H1) in the first two sentences instead of making the opposite claim, names the follow-on trades and the supply yard (audit change 6), and drops "on a home" and "the owner is spending", which overclaimed (commercial permits are in the file). "Updated file" because the file is refreshed weekly; it does not claim to hold only this week's permits.

**C1.6 One primary action, one secondary**
- Before: a filled $99 button, `Start the Monday feed [em dash] $99/mo &rarr;`, then a 20 px text link, `Or see a free sample first, no card needed`, then `A new file every Monday. Cancel anytime.`
- After: a filled button `Get a free sample` (`#hero-sample`, 56 px, scrolls to the form), an outlined button `Subscribe: $99 a month` (`#buy-hero`, same Stripe link, still given `client_reference_id` by `wireBuyButtons()`), and `Sample: no card. Subscription: month to month, cancel anytime.` From 900 px wide the form is beside the copy, so `#hero-sample` is hidden there and the form's own filled button is the primary action.
- Why: most visitors arrive cold, and the sample is the realistic first step (audit change 12); the buyers who are ready still have the $99 button on the first screen, now visually second. Both are full-size tap targets.

**C1.7 Four facts beside the form (new)**
- After: `Street address and permit date of each permit, sorted by trade and town` / `Work description and declared value, where the town publishes them` / `Permit holder (usually the contractor or applicant) where the town lists one. No homeowner name column.` / `A dashboard that opens in your web browser, plus spreadsheets you can sort and filter`
- Why: what the file contains, on the first screen at 1280 px and right under the form on a phone, with the qualifiers the data needs (51 of 81 sources publish no value; the permit holder is not on every row).

**C1.8 Layout**
- After: a two-column first screen from 900 px (copy and facts on the left, the sample card on the right), one column below that in the order eyebrow, headline, lede, the two actions, the sample card, the facts. Side gutter 16 px on phones (was 20).
- Why: puts the form in the first screen at both widths without hiding the explanation.

### C2. The free-sample path (index.html)

**C2.1 The form moves into the first screen**
- Before: `#sample` sat after the price box: card top at 2,981 px on a phone, 2,088 px at 1280.
- After: card top at 582 px on a phone, 117 px at 1280. `id="sample"` moves with it, so every existing `/#sample` and `/?trade=..&area=..#sample` link from the generated pages, `offer.html` and the price box lands on the form.
- Why: the sample is the step most website buyers took before paying (owner's figures, not repeated here). It was four phone screens away.

**C2.2 The form asks for trade, area and towns**
- Before: email only. Trade and area were read silently from two unlabelled dropdowns about 2,600 px higher, so a visitor never saw what was being sent.
- After: `Your trade` and `Your area` (the same two selects, `#sel-trade` and `#sel-area`, moved into the form with visible labels; they still drive the live preview, the eyebrow and the Stripe `client_reference_id`), `Towns you work in (optional)` (`#sample-towns`, new), and `Your email, for the sample`. One field is required.
- Why: audit change 3. The visitor states the patch they will judge the sample on; the owner learns it with the request (C2.9). The towns box also powers the town check (C2.4).

**C2.3 Trades and suppliers who have no permit type**
- Before: the trade list was the 19 permit types in `data.json` (`Addition` ... `Windows/Doors/Siding`). Insulation, drywall, flooring, a lumber yard and a dumpster company found nothing that named them.
- After: a first option group, `Trades and suppliers after the permit`: Insulation, Drywall and plaster, Flooring and tile, Cabinets and countertops, Painting, Gutters, Sitework and excavation, Dumpsters and hauling, Lumber and building supply. Picking one shows the permit types that work follows, summed, and says which: for Insulation in Cape Cod &amp; Islands the box reads `1,790 addition, renovation/remodel and new construction permits` and `The permit types insulation work usually follows. Not every one of them will need it.` The price box says `which you filter to the permit types insulation follows`. The permit types stay in a second group, `Permit types`. `?trade=` accepts both lists.
- Why: these are the buyers this page is now written for. The count is a sum of whole permit types and is labelled with those types, never as "permits for insulation", and the line under it says not every one will need the trade. (A first draft labelled it "permits for insulation"; the review below caught that as an overclaim.) The map is in one `FOLLOW` constant in `index.html`, commented; see owner check K3.

**C2.4 Town check as you type (new)**
- After: each town typed into `#sample-towns` gets one line, read from `/research/evidence/coverage.json` (the file `/research/coverage` is built from):
  - `✓ Falmouth: 2,400 permits on file, newest dated 2026-11-02.`
  - `✓ Hyannis is filed under Barnstable: 619 permits on file, newest dated 2026-08-31. Publishes monthly or less often, so new permits arrive in batches.`
  - `Bourne: no permits in the file right now.` (the 17 towns that returned nothing on the latest run have no rows in the file, so the page says exactly that)
  - `Wellfleet: not in the file yet. Leave it in the box; it tells us where people want coverage.`
  - Villages are mapped to their own town only: Boston neighbourhoods; the Barnstable villages (Hyannis, Osterville, Centerville, Cotuit, Marstons Mills, West Barnstable and others); Falmouth's (East, North and West Falmouth, Woods Hole, Teaticket, Waquoit, Hatchville); Yarmouth's (South and West Yarmouth, Yarmouth Port, Bass River); Harwich's (Harwich Port, East, West and North Harwich, Pleasant Lake); East Sandwich and Forestdale; New Seabury. Apostrophes are ignored (Marston's Mills). One town is never mapped to another: `West Boylston` answers "not in the file yet", not Boylston. `Foxboro` finds Foxborough (a unique prefix of four or more letters).
  - If the file cannot be read: `The town check is not available just now. See every town in the file.` (linked).
- Why: "which towns?" is the first question a buyer asks, and the honest answer differs per town. Answering it at the moment of asking, from the build's own numbers, beats a paragraph. A visitor whose town is missing finds out before paying, not after.

**C2.5 What the sample is**
- Before: `See the data first [em dash] free sample` / `Drop your email for a free sample file: around a thousand recent Massachusetts permits, filterable by trade and town, that opens in any browser.`
- After: `Get a free sample` / `Recent permits from the file, with house numbers and permit-holder names hidden, so you can judge it on your own trade and towns before you pay. No card.`
- Why: no typed count (home-copy H6; the sample build sets the size); says what is hidden, as the sample email already does ("names &amp; street numbers masked"), so the download is not a surprise; drops "opens in any browser", which is not true of a ZIP on a phone (C2.8).

**C2.6 What happens after you press the button (new)**
- After: `You get a download link right here, and the sample by email, then two short follow-ups over the next week. Reply stop to end them.`
- Why: removes the fear of a mailing list. Matches what the code does: `request-sample.js` sends the sample and the page shows the link; `nurture.js` sends exactly two follow-ups (day 3 and day 7); the sample email already says to reply "stop". Edge cases where no email goes out (an address enrolled before, more than five requests from one address, more than 50 new requests in a day) still get the download link on the page; see S6 and owner check K7.

**C2.7 Success follows the system that sends the sample**
- Before: `/api/request-sample` was fired and forgotten; the page showed success only when Web3Forms (the owner notification) said so, and otherwise showed `d?.message||"Something went wrong: please email us directly."`, even though the sample had already gone out. A retry then did nothing, because an address is only ever enrolled once.
- After: both calls run together. Either one confirming shows success at once. A 400 from the function shows `Please check the email address.` and keeps the form. Only when neither confirms: `That did not go through. Please try again, or write to hello@masspermits.com for the sample.` The email is checked first with the same pattern the function uses, the button reads `Sending...` and is disabled while waiting, and its label comes back on failure.
- Why: audit change 15. An ad blocker or a Web3Forms outage no longer turns a sent sample into an error message.

**C2.8 Success message**
- Before: `&#10003; Got it[!] Your free sample is ready [em dash] download it here (also check your inbox).` then `Keep them coming [em dash] Weekly Feed, $99/mo &rarr;` and `A new file arrives every Monday. Cancel anytime.`
- After: `&#10003; Got it. Your free sample is ready.`, a full-width button `Download the free sample` (`/api/sample`, unchanged), `It is a ZIP file. Open MassPermits-Leads.html inside it in any web browser; that is easiest on a computer. Check your inbox for a copy too.`, then `The weekly file has every full address, every Monday.`, an outlined `Subscribe: $99 a month` (still the Stripe link with the selection) and `Month to month. Cancel anytime.`
- Why: the download is a real button, the ZIP is described honestly so a phone user is not stranded (the fix is server change S1), and the next step to the paid file is offered without pressure.

**C2.9 What the request carries**
- `/api/request-sample` body: `{email, trade, area, towns, company: ""}`. The first four names are unchanged; `towns` is new and ignored by the function today.
- Web3Forms body: as before plus `towns`; subject `MassPermits free-sample request: <trade> / <area>` (was an em dash).
- `towns` is tidied in the page first: letters, spaces, apostrophes, hyphens and periods only, at most ten towns and 160 characters.
- Why: the owner sees the towns in the notification today, with no server change.

**C2.10 `?town=` prefill (new)**
- After: `/?trade=Roofing&area=capecod&town=Falmouth#sample` opens with `Falmouth` in the towns box and its town check already shown. The value is tidied as in C2.9 and written as a field value, never as HTML.
- Why: lets a generated town page hand its town to the form (engine change E1), so a visitor from `/permits/falmouth-roofing` sees "Falmouth: 2,400 permits on file" next to the button without typing.

### C3. Trust and proof (index.html)

**C3.1 Section heading (new)**: `What is in the file` / `Live from the current file. This page hides house numbers; the weekly file shows them.`

**C3.2 The live box**
- Before: lock row inside the table, `+ 72,160 more [em dash] full addresses unlocked in the weekly feed 🔒`; empty state `No permits in this selection yet [em dash] try another trade or area.`; freshness line ending `From public municipal building-permit records. New file every Monday.`
- After: the lock line sits under the table, `+ 72,160 more. Full addresses are in the weekly file. 🔒`, so a phone reads it without scrolling the table; `No permits in this selection yet. Try another trade or area.`; `From public municipal permit records. New file every Monday.`; the count label and a types line for the follow-on trades (C2.3); the date column no longer wraps. The preview values from `data.json` are now escaped before they are written into the table (they come from town records; they were written raw before).
- Why: dashes out, readable on a phone, wording held to "public municipal permit records", and one less way for odd town data to break the page.

**C3.3 One row, field by field (new)**
- After: a card filled from the first preview row of the visitor's selection that has a declared value (else the newest): `Permit date 2026-11-02`, `Town Boston`, `Address [house no.] Commonwealth Av`, `Project type Gas`, `Declared value $50,000` (or `Not published by this town`), then `Work description: In the weekly file, in the town's own words, where the town publishes one`, `Permit holder: In the weekly file where the town lists one: usually the contractor or the applicant`, `Homeowner name: Not a column in the file`.
- Why: the brief asks for an example row. A real one, live, beats a made-up one; the fields this public page cannot show (house number, description, permit holder) are labelled as what the paid file adds, so nothing is invented and no person's name is published.

**C3.4 Three proof cards (new)**
- `How fresh`: `A new file every Monday. The newest permit on file is dated 2026-11-02. 6 towns publish monthly or less often, so theirs arrive in batches. Every row shows its permit date.` (date from `data.json`, count from `coverage.json`).
- `Which towns`: `81 Massachusetts cities and towns have permits in the current file, 72,166 permits in all. Massachusetts has 351 cities and towns, so check yours in the sample form.` plus a link to `/research/coverage` (fallback in the HTML: `Cities and towns from Cape Cod to the Berkshires. Not every town publishes permit records we can include, so check yours in the sample form.`).
- `What it costs`: `$99 a month for the whole file, every trade and every town we cover. Month to month, no contract, cancel anytime. Files already sent are yours to keep.`
- Each has a plain-words fallback in the HTML if a file cannot be read. No number is typed into the page (the head comment explaining why is kept and updated).
- Why: freshness, coverage stated honestly, and cancel anytime, as the brief asks. Saying "81 of 351" out loud costs less than a buyer discovering it after paying, and the town check is right there.

**C3.5 How it works**
- Step 1 before: `Building permits from the Massachusetts towns we cover, pulled from public records and sorted by trade.` After: `New building permits from the Massachusetts towns we cover, from public municipal permit records, sorted by trade and town.` (no method words beyond the allowed phrase)
- Step 2 before: `Roofing, solar, HVAC, pools, remodels [em dash] every town we cover in one file, ...` After: `Roofing, solar, HVAC, remodels, additions, new houses: every town we cover in one file, sorted by trade and filterable to exactly your patch.`
- Step 3 before: `Full address and project type, plus the permit holder and declared value where the town lists them. Every row shows its date.` After: `Trades: reach the property before the next trade is picked. Suppliers: reach the contractor on the permit, where the town lists one, while the job is new. Every row shows its date.`
- Why: audit change 6, suppliers by name; dash out.

**C3.6 Price box**
- `BEST VALUE` badge removed (home-copy H4; one plan, nothing to compare).
- Button before: `Start my weekly feed [em dash] $99/mo &rarr;`. After: `Subscribe: $99 a month` (`#buy-feed` unchanged; same words as the first screen).
- `Not sure yet? See a free sample first &rarr;` (13.5 px muted link) becomes `Not sure yet? Get a free sample first` in teal with a 47 px tap area; it scrolls up to the form.
- `Not ready? Grab a free sample below first.` (overwritten by script on load) is now `Secure checkout via Stripe.` in the HTML too; the no-checkout fallback `Checkout opening soon [em dash] grab a free sample below in the meantime.` becomes `Checkout opening soon. Get a free sample above in the meantime.`
- Kept as they were: `$99 / month`, `&asymp; $23 a week, for every trade and town we cover.`, the three ticks, and "The MassPermits promise" paragraph signed Pat.

**C3.7 Footer**: `Building-permit lead intelligence · Massachusetts` becomes `Building-permit leads for Massachusetts trades and suppliers · From public municipal permit records`.

### C4. FAQ (index.html)

**C4.1 Format**: the nine answers sit in `<details>` with the first one open, a 44 px row per question, so a phone reader scans the questions and opens the one they have.

**C4.2 New, open by default: `If a permit is filed, isn't the job already sold?`**
`Often, for the trade named on the permit. The rest of the job usually is not. An addition or a gut remodel still needs insulation, drywall, flooring and cabinets after the framing permit. A new house needs sitework, gutters and often solar. Every one of those jobs buys lumber and materials from a supply yard. The file gives you the address, project type and date, plus the permit holder (usually the contractor or applicant) where the town lists one, so you can reach the job, or the contractor who pulled the permit, before the next trade is picked.` (home-copy H2, adjusted)

**C4.3 New: `Which towns are in it?`**
`Massachusetts cities and towns from Cape Cod to the Berkshires. 81 of them have permits in the current file. Not every town publishes permit records we can include, so check yours before you pay: type it into the sample form above, or see every town in the file, with its dates.` (the count is live; the sentence reads correctly without it)

**C4.4 Rewritten: `How fresh is it?`** (was `How recent are they?`)
Before: `The weekly feed arrives every Monday, and you filter it to your trade and towns. Each town publishes on its own schedule, and some publish monthly or less often, so their permits arrive in batches when the town publishes. Every row shows its date, and the coverage page names the towns that publish monthly and shows each town's date range.`
After: `A new file arrives every Monday. Most towns publish as they issue permits. Some publish monthly or less often, so their permits arrive in batches when the town publishes. Every row shows its permit date, so you always know how old a lead is. The newest permit on file is dated 2026-11-02.` (date live)

**C4.5 New: `What if my town is missing?`**
`Then check before you pay, not after: the sample form shows which of your towns are in the file. Look at the towns around it too, since the subscription is the whole statewide file and many trades work a radius. Leave your towns in the form either way; it tells us where people want coverage. New towns show up on the coverage page and in the Monday file as they are added.`
Why: honest (no promise to add a town), and it turns a missing town into a reason to use the form rather than to leave.

**C4.6 New: `Do I get homeowner names?`**
`No. There is no homeowner name column. Where the town lists one, the file carries the permit holder, which is usually the contractor or whoever applied for the permit.`
Why: the Stripe product description still promises homeowner names (audit change 1, outside this repo); the site should say the truth before checkout. Worded as "no homeowner name column" because an owner who pulls their own permit can appear as the permit holder.

**C4.7 Rewritten: `What exactly do I get?`** (was `What do I actually get?`)
Before: `An interactive dashboard that opens in any browser, filterable by trade and town, plus spreadsheets (one master CSV and one per trade): the full property address and project type, plus the permit holder and declared value where the town lists them.`
After: `Every Monday, by email: a dashboard that opens in your web browser (search it, filter by trade and town, sort by project value) and spreadsheets, one master CSV and one per trade. Each row has the full street address, the permit date and the project type, plus the town's description of the work, the permit holder and the declared value where the town publishes them. The email's download button always serves the current file.`
Why: matches the welcome email's own description of the product; adds the work description, which the file carries.

**C4.8 Merged: `What does it cost, and can I cancel?`** (was `Do I have to subscribe?`)
Before: `For the full list, yes: it comes as the $99/mo weekly feed, and you can cancel anytime. Towns keep filing permits, so the feed is a new file every Monday rather than a one-time list. Not sure yet? The free sample costs nothing and needs no card.`
After: `$99 a month for the whole statewide file, every trade and every town we cover. It is month to month with no contract, and you can cancel anytime by writing to hello@masspermits.com. Files you already received are yours to keep. The sample is free and needs no card.`
Why: price and cancelling are the two things a burned buyer checks. See owner check K1 on the cancel route.

**C4.9 Kept: `What if the leads don't pan out?`** Unchanged.

**C4.10 Rewritten: `Where do the permits come from?`** (was `Where do the leads come from?`)
Before: `Public municipal building-permit records [em dash] the same filings towns publish, gathered and organized so you don't have to.`
After: `Public municipal permit records. Every row shows its town and date, so you can check any permit against the town's own records.`
Why: the rule allows "public municipal permit records" and nothing about how; "gathered and organized" went further. The new second sentence is a trust point instead.

### C5. Phone layout at 375 px (index.html)

- **C5.1** Every form field is 16 px: trade and area selects (were 14), towns (new), sample email (was 15), digest email (was 14), and the hidden honeypot. iOS Safari no longer zooms on focus.
- **C5.2** Tap targets: fields 48 px tall, buttons 52 to 60 px, the first-screen sample action 56 px (was a 20 px text link), FAQ rows at least 44 px, the price-box sample link 47 px, the coverage-page link in the proof card 46 px.
- **C5.3** No sideways scroll: `scrollWidth` 375 on the home page, `offer.html` and `/offer/`, before and after. The grid columns use `minmax(0, 1fr)` so a long word cannot widen the page; the preview table still scrolls inside its own box.
- **C5.4** The preview table's date column does not wrap, and the "+ N more" line is outside the scrolling box (C3.2).
- **C5.5** The digest form puts its email field on its own row on a phone (it was squeezed to about 145 px beside the button).
- **C5.6** `text-size-adjust:100%` so iOS does not inflate text in landscape.

### C6. Copy hygiene (index.html)

- **C6.1** Every em dash a visitor can read is gone (eight at load plus one in the success message; each is listed in its change above). Comments in the page source were also cleaned where touched. The only em dashes left in these five files are inside the dormant promo templates, which are never shown while the codes are off.
- **C6.2** The exclamation mark in the success message is gone (C2.8).
- **C6.3** `Already subscribed?` block: before, inside the hero, `Already subscribed? Your leads are in your Monday email [em dash] the Download your leads button in it always serves the current file. Can't find it? <a href="mailto:(founder's mailbox)?subject=...">Email me</a> and I'll send your link.` After, its own block `#subscribers` above the FAQ: `Your leads are in your Monday email. The Download your leads button in it always serves the current file. Can't find it? Email hello@masspermits.com and we'll send your link.` (home-copy H3; see owner check K2)
- **C6.4** Digest messages: `Check your inbox [em dash] click the confirm link and you're in. 📬` becomes `Check your inbox and click the confirm link to finish. 📬`; `Hmm, that didn't work [em dash] double-check the email?` becomes `That didn't work. Please check the email address.`; `Network hiccup [em dash] try again in a second.` becomes `Network hiccup. Please try again in a second.`; the description `One email every Monday [em dash] which towns ...` uses a colon.

### C7. offer.html

- **C7.1** New line under the headline: `For trades and suppliers who sell after the permit`.
- **C7.2** Lead. Before: `A building permit is a public record that a property owner was just approved for work. We collect permits from the Massachusetts towns we cover, sort them by trade and town, and send them to you every Monday.` After: `A building permit is a dated public record of approved work at a real address. The trade named on it is usually hired already; the trades and suppliers who come next are not. We send you the permits from the Massachusetts towns we cover, sorted by trade and town, in a new file every Monday.` (home-copy O1, plus the follow-on point)
- **C7.3** Bullets. Before: `Sortable file + live dashboard [em dash] filter by trade, town, project size`. After: `Spreadsheets and a browser dashboard: filter by trade, town, project size` ("live" overclaimed for a weekly file), and a new bullet `No homeowner name column: the permit holder is usually the contractor or applicant`.
- **C7.4** New, under the $99 button: an outlined `Not ready? Get a free sample first` (to `/#sample`) and `Recent permits with house numbers and names hidden. No card.`
- Unchanged: the tag, the headline, the `#buy` button and its promo twin, the chips, the closing panel.

### C8. offer/index.html (the paid-traffic page)

- **C8.1** Eyebrow: `For Massachusetts contractors` becomes `For Massachusetts trades and suppliers`.
- **C8.2** Headline. Before: `This week, homeowners across MA are pulling permits. Get those permits in one file every Monday.` After: `Sell to the job after the permit is filed. Get the permits in one file every Monday.` (home-copy F1 fixed the homeowner overclaim; this also matches the home page)
- **C8.3** Lead. Before: `A building permit means a property owner was just approved for work on their property. MassPermits sends you ...` After: `A building permit is a dated public record of approved work at a real address. The trade named on it is usually hired already; the trades and suppliers who come next are not. MassPermits sends you ...` (rest unchanged; home-copy F2 plus the follow-on point)
- **C8.4** Live count source. Before: fetched the 116,895-byte `data.json` to print one number. After: reads `corpus_rows` and `corpus_last` from `/research/evidence/coverage.json` (17,710 bytes; the same whole-build count) and adds the date: `72,166 MA permits on file · newest dated 2026-11-02 · new file every Monday`. Page weight 131 KB to 34 KB. If the file cannot be read, the line already in the HTML stays.
- **C8.5** New, under each $99 button: outlined `Not ready? Get a free sample first` (to `/#sample`), and under the second one `Recent permits with house numbers and names hidden. No card.` (audit change 13)
- **C8.6** Guarantee: `... No forms, no argument. [em dash] Pat` becomes `... No forms, no argument. (Pat, founder)`.
- **C8.7** Card 01. Before: `Funded intent` / `A permit means the homeowner is approved and about to spend. Not a tire-kicker [em dash] a real, dated project.` After: `Real, dated work` / `A permit is approved work at a real address, with a date. The trade named on it is usually hired already; the trades and suppliers who come next are not.` (home-copy F3)
- **C8.8** The closing "why" box gains: `There is no homeowner name column: the permit holder, where the town lists one, is usually the contractor or applicant.`
- **C8.9** Footer: `MassPermits [em dash] building-permit leads for Massachusetts contractors.` becomes `MassPermits: building-permit leads for Massachusetts trades and suppliers.`
- Unchanged on purpose: `cta1` and `cta2`, the `/offer` page-view beacon and the `/offer/click` listener (`test/growth/review.test.mjs` holds them), the promo templates.

### C9. agents.html and 404.html

- **C9.1** `agents.html`: `plus the name on the permit where the town lists one` becomes `plus the permit holder (usually the contractor or applicant) where the town lists one` (home-copy A1; "the name on the permit" reads as the homeowner).
- **C9.2** `404.html` title: `Page not found [em dash] MassPermits` becomes `Page not found | MassPermits`.
- **C9.3** `404.html` button: `Find leads in your trade &rarr;` (to `/`) becomes `Get a free sample &rarr;` (to `/#sample`). A visitor on a dead link is one tap from the form.
- **C9.4** `agents.html`: the sample form's email and town inputs go from 14 px to 16 px, so iOS stops zooming on them (the same rule as C5.1).

## Not changed, on purpose

- **Dormant promo markup.** The `FOUNDER2026` templates in `index.html` and the `FIRST90` templates in `offer.html` and `offer/index.html` stay exactly as they were, every code off in `js/promo-switch.js`. Visitors never see them. Removing them means rewriting `test/promo-switch.test.mjs`, which this change does not touch; that removal is claude/home-copy H5, O2 and F4.
- **JSON-LD.** The Organization and WebSite blocks are maintained by the refresh bot (`mp-schema-v`), and the Product block already says $99 a month with the right qualifiers.
- **The internal-link block** (trades, towns, guides, research, project types): SEO equity, left alone.
- **`widget/index.html`**: its phone fix lives on claude/phone-layout.
- **"The MassPermits promise"** and the refund wording: the owner's own promise, unchanged.

## Relationship to the open branches

- **claude/home-copy** edits the same lines of `index.html`, `offer.html`, `offer/index.html` and `agents.html`. This branch already contains H1 (reworded again), H2, H3, H4, H6, O1, F1 (reworded), F2, F3 and A1. Merging both will conflict. Suggested order: merge this one, then either close home-copy or cut it down to H5, O2, F4 and its test change (the promo removal), rebased on this.
- **claude/phone-layout**: its `index.html` font-size lines are superseded here (every field is 16 px). Its `widget/index.html` fix and its write-up are independent; rebase it and drop its `index.html` hunk.
- **claude/funnel-audit**: documents only, no conflict.

## Server changes needed (not made here: `functions/` is out of scope)

- **S1. Make the free sample open on a phone** (audit change 2). Add `?view=1` to `functions/api/sample.js` that streams the dashboard HTML from the same R2 object with `Content-Type: text/html`, as `functions/leads.js` already does for subscribers. Then the success message becomes `Got it. Open your free sample (it opens in this browser). The same link is in your inbox.` and the ZIP becomes the second link. This is the most valuable server change on the sample path.
- **S2. Store and use `towns`** in `functions/api/request-sample.js`: accept a string of at most 160 characters matching `^[A-Za-z' .,-]*$`, store it on the `prospects/<email>` object and its `customMetadata`, and print it in `notifyOwner`. Later, cut the sample to the visitor's towns and trade (audit change 3).
- **S3. Widen the whitelists** in `request-sample.js`: `AREAS` lacks `metrowest`, `northshore`, `central` and `western` (four of the seven `data.json` regions), so those selections are stored as empty today; `TRADES` lacks `Septic`, `Building` and `Asbestos`, and would need the nine follow-on labels from C2.3 (or a mapping) to keep them.
- **S4. Correct the sample email**: `~45 towns` (the coverage page lists 81 reporting sources) and `the name on the permit` (audit changes 7 and 8). Say it is a ZIP and how to open it until S1 ships.
- **S5. Nurture emails** (audit change 14): drop "every competitor's ... value" and "(Boston, Cape Cod, the South Shore)".
- **S6. Optional:** return `{ok:true, sent:false}` when an address was already enrolled, so the page can say "we sent it to you earlier; here is the link again".
- **S7. Phone access for subscribers:** link the `/leads` portal from the welcome and Monday emails. Until then the site does not claim the paid file opens on a phone.
- **Stripe** (outside the repo, audit change 1): the product description still promises homeowner names.

## Engine template changes (for the generated pages)

The refresh bot regenerates the town, region, project and guide pages, so these belong in the private engine's templates.

- **E1. Pass the town to the form.** On every town and town-trade page, make the sample button link `/?trade=<Trade>&area=<areaKey>&town=<Town>#sample` (today it passes trade and area only). The home page now prefills the towns box and shows that town's live line (C2.10).
- **E2. Same two actions on every generated page.** A filled `Get a free sample` button as the main action and an outlined `Subscribe: $99 a month` as the second, in that order, above the free digest form (audit: on `permits/boston.html` the digest form sits above the sample button).
- **E3. Follow-on positioning.** Replace "Each is a homeowner who just got approved for work" with "Each is a dated permit for approved work at a real address. The trade named on it is usually hired already; the trades and suppliers who come next are not."
- **E4. Qualifiers** (audit change 9): "the permit holder where the town lists one" in the body card and the meta description; "permit holder (usually the contractor or applicant)" instead of "the name on the permit"; a "No homeowner name column" line near the sample button.
- **E5. Phone layout** (claude/phone-layout): wrap every preview `<table>` in `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">`, add `p,li,dd{overflow-wrap:anywhere}`, set `.alertform input[type=email]` to `font-size:16px`, and put the "+ N more" line outside the table.
- **E6. A per-page objections block** with computed answers: "Is the job already sold?" (static), "Is <Town> in the file?" with that town's permit count and newest date, "How fresh?" with the newest permit date for the page, and the monthly-town note where it applies.
- **E7. The coverage file is now an interface.** The home page and `/offer/` read `research/evidence/coverage.json`: `corpus_rows`, `corpus_last`, `stats.n_rows`, `stats.table[].source/rows/last`, `stats.monthly` and `stats.errors`. Keep those names, or emit a small `/towns.json` and point both pages at it. Both pages fall back to plain words if the file changes shape, so nothing breaks, but the town check goes quiet.
- **E8. Town aliases in the build.** Emit village-to-town aliases (the Barnstable villages, Boston neighbourhoods, any others the sources use) into that file so the short hand-typed `ALIAS` map in `index.html` can be deleted.
- **E9. Meta descriptions lead with the newest date** (audit change 9), for example `175 Falmouth, MA roofing permits, newest dated 2026-10-30. Full address and project type, permit holder where the town lists it. Free sample, no card.`
- **E10. No dashes, no exclamation marks** in generated visitor copy, the same rule as here.

## Owner checks before merging

- **K1.** The FAQ says you can cancel "by writing to hello@masspermits.com". No self-serve cancel link was found in the repo. Confirm that is the route, or give the link to use.
- **K2.** The subscriber block and the FAQ use hello@masspermits.com instead of the founder's mailbox. Confirm it is watched.
- **K3.** The follow-on map (C2.3): Insulation, Drywall and plaster, Painting follow additions, remodels and new construction; Flooring and tile adds kitchen and bath; Cabinets and countertops follow kitchen and bath, remodels and new construction; Gutters follow roofing and new construction; Sitework follows new construction, septic, pools, additions and demolition; Dumpsters follow demolition, remodels, roofing and new construction; Lumber and building supply follows new construction, additions, remodels and decks. Adjust in the `FOLLOW` constant if a buyer would put it differently.
- **K4.** Showing "Massachusetts has 351 cities and towns" next to the live count is deliberate honesty. Keep it or drop that sentence.
- **K5.** `≈ $23 a week` in the price box was kept as it was. It is the same $99 a month, but if the rule is that only "$99 a month" may appear, delete that line.
- **K6.** The title now says "for trades and suppliers" where it said "for MA contractors". Watch Search Console for the home page's queries for a few weeks.
- **K7.** "Reply stop to end them" repeats what the sample email already promises; `nurture.js` has no automatic opt-out, so a "stop" reply is honoured by hand. And the page shows the download link and "check your inbox for a copy too" even in the rare cases where the function enrols nobody (an address seen before, the per-address limit, the 50-a-day cap). Server change S6 would let the page tell those apart.

## Screenshots

All in `docs/conversion/screens/`, 375 px with mobile emulation and 1280 px, rendered from this repo on a local static server with every other request blocked. Quantized to 256 colours to keep the repo light.

| View | Before | After |
|---|---|---|
| Home, first screen, 375 | `before-home-375-first.png` | `after-home-375-first.png` |
| Home, full page, 375 | `before-home-375-full.png` | `after-home-375-full.png` |
| Home, first screen, 1280 | `before-home-1280-first.png` | `after-home-1280-first.png` |
| Home, full page, 1280 | `before-home-1280-full.png` | `after-home-1280-full.png` |
| Sample form after a request, 375 | `before-home-375-submitted.png` | `after-home-375-submitted.png` |
| Sample form after a request, 1280 | `before-home-1280-submitted.png` | `after-home-1280-submitted.png` |
| Town check (Falmouth, Mashpee, Bourne) | none | `after-home-375-towncheck.png`, `after-home-1280-towncheck.png` |
| Proof section for a follow-on trade (Insulation, Cape Cod &amp; Islands) | none | `after-home-375-follow-on.png`, `after-home-1280-follow-on.png` |
| `offer.html`, first screen and full page | `before-offer-375-first.png`, `before-offer-375-full.png`, `before-offer-1280-first.png`, `before-offer-1280-full.png` | `after-offer-375-first.png`, `after-offer-375-full.png`, `after-offer-1280-first.png`, `after-offer-1280-full.png` |
| `/offer/`, first screen and full page | `before-offer-dir-375-first.png`, `before-offer-dir-375-full.png`, `before-offer-dir-1280-first.png`, `before-offer-dir-1280-full.png` | `after-offer-dir-375-first.png`, `after-offer-dir-375-full.png`, `after-offer-dir-1280-first.png`, `after-offer-dir-1280-full.png` |

The "after a request" shots use a local stub that answers `/api/request-sample` with `{"ok":true}`; Web3Forms was blocked, which is also the case C2.7 fixes.

## Tests and checks run

- The repo's tests that read these pages, `node --test test/promo-switch.test.mjs test/growth/hit.test.mjs test/growth/review.test.mjs`: 27 of 27 pass (they hold the promo switch, the checkout button ids, the one `buy-click.js` per page with a Stripe link, and the `/offer` beacons).
- The whole suite, `node --test "test/**/*.test.mjs"`: 427 tests, 411 pass, 16 skipped, 0 fail, the same as `main` before the change. One later full run had 1 failure in `test/manual/store.test.mjs` ("index concurrency: two interleaved writers both land"), a timing test of `functions/api/_manual_store.js`, which this change does not touch; it passed 5 of 5 times on its own, and claude/home-copy reports the same flake on `main`. (Run with LF line endings; on a Windows checkout with `core.autocrlf=true` the `_headers` test fails on `main` too, because it looks for `\n`.)
- Behaviour checks in a real browser against the local server (39 of 39 pass): prefill from `?trade=&area=` and `?town=`; the eyebrow and the Stripe `client_reference_id` follow the selection; the follow-on count names the permit types it sums; the town check for a live town, village aliases (Hyannis, East Falmouth, Marston's Mills), a prefix (Foxboro), a quiet town (Bourne), a missing town (Wellfleet) and a neighbouring town that must not be mapped (West Boylston); the request body keeps `email`, `trade`, `area`, `company` and adds `towns`; success when only the function answers and when only Web3Forms answers; "check the email" on a 400 with the button restored; the error with a written route when both fail; a bad address stopped before any request; unknown `?trade=` and `?area=` ignored; markup in `?town=` reduced to letters; the page still works with `coverage.json` or `data.json` missing; no page errors and no request leaving the machine.
- Copy check over the visible text and script strings of all five pages: no em or en dash, no exclamation mark, no price but $99 a month (and the existing `≈ $23 a week`), no promo word, no call or Zoom offer; every "homeowner name" mention is a statement that there is none.

## Independent review

A separate read-only review of the page diff (fresh context, given the code and the rules, not this write-up) reported nine findings. Fixed on this branch:

- Quiet towns were told they were "listed"; they have no rows in the file. Now `no permits in the file right now`, and the coverage card no longer counts them.
- Village names of covered towns (East Falmouth, South Yarmouth, Harwich Port, Marston's Mills with the apostrophe) answered "not in the file yet". Added, with the rule that a separate town is never mapped to a neighbour.
- The follow-on count read "1,790 permits for insulation". Now labelled with the permit types it sums; the price-box line likewise.
- "A copy by email" and "the same link is in your inbox" were stated as certain; now softer (C2.6, C2.8), with the edge cases in K7.
- The 404 button said "for your trade and towns" (the sample is not cut to them). Now `Get a free sample`.
- Preview values from `data.json` were written into the table unescaped (this predates the change). Now escaped.
- If `data.json` failed, the example row showed an ellipsis forever and `?town=` did nothing. The row hides, and `?town=` runs on its own.
- "Latest build" wording on the page described the pipeline; now "current file". "Cape Cod and the Islands to Western Massachusetts" became "Cape Cod to the Berkshires" (one island town reports).
- `agents.html` form inputs at 14 px; now 16 px (C9.4).

Left as they are, with the reason: the server drops the new trade and area values and the towns (S2, S3: `functions/` is out of scope; the Web3Forms notice carries them today); `≈ $23 a week` (K5); the 404 chips at about 40 px and the selects cutting long option text on a phone (both predate this change and are cosmetic); the sample email's "~45 towns" and "name on the permit" (S4).

## Method

- Clone of `capecodtaxappeal/masspermits-lander`, branch `claude/conversion-1103` from `main`.
- Rendering: Python `http.server` bound to 127.0.0.1 (clean URLs mapped as Pages does), Playwright with the installed Chrome, 375 by 812 (mobile, touch, iPhone user agent) and 1280 by 800, reduced motion. Every request whose host was not the local server was aborted; `/api/*` was answered locally.
- Positions are `getBoundingClientRect().top + scrollY` after `networkidle`; overflow is `document.documentElement.scrollWidth`; font sizes are computed styles; weights are response body sizes.
- Figures quoted from the build (72,166 permits, 81 reporting towns, 17 quiet, 6 monthly, newest 2026-11-02, Falmouth 2,400) are from `data.json` and `research/evidence/coverage.json` at `cf81b6abd`. The page reads them live, so they will differ on the next build.
