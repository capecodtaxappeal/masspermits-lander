# Road to 100

Your page: **masspermits.com/admin/growth** (signed in through Cloudflare Access, the same way as Mission Control).

It answers one question: how close are we to 100 paying subscribers, and where do people drop off on the way?

## The big number

**"X of 100"** is how many people are paying for the Weekly Feed right now, straight from Stripe. The line under it shows that number at the end of each week, against a line at 100.

If Stripe cannot be read, the page says **unavailable**. It never shows 0 for a number it could not read.

## Each week, left to right

Weeks run Monday to Sunday, Boston time. The top row is this week so far.

| Column | What it counts |
|---|---|
| **Visits** | Page loads by people on masspermits.com (bots are filtered out). No cookies, so one person reading three pages counts three times. Counted the same way as /ops, except that old clicks the offer page used to log as page views are left out. |
| **Buy clicks** | Clicks on a Weekly Feed Buy button on our site. Clicks on the Lead Pack or agents Radar buttons are kept apart and not shown in this column. |
| **Checkouts opened** | Stripe checkout pages opened for the Weekly Feed, whatever happened next. This can be higher than Buy clicks, because the link in our emails goes straight to Stripe without passing through the site. |
| **Abandoned** | A checkout that was opened but never paid: Stripe expired it, or it was still open 24 hours after it was opened. These are the people who got as far as the card form and stopped. |
| **Paid** | A checkout that was completed. |
| **Paying at week end** | Weekly Feed subscribers paying at the end of that week: active, on a trial, or behind on a payment (past due). Someone who cancelled stops counting on the day the subscription actually ended. |
| **Free sign ups** | New free sign ups that week (digest list plus free sample requests), from the daily funnel snapshot. It shows "no data yet" when a snapshot is missing. |

Checkouts, abandoned and paid are counted in the week the checkout was **opened**.

**≥ 12** means "at least 12": that week's data starts partway through, or a list was too long to read in full, so the real number may be higher.

**no data yet** (or **not tracked yet** for Buy clicks) means the counter did not exist yet that week. The page works out the start date from the oldest record still stored and prints it under "How to read this". The visit counter was added on 5 July 2026. Buy clicks start with the first click after this page goes live.

## The two funnel boxes

"This week so far" and "Last 4 full weeks" show each step with **x of y**: for example "2 of 40 visits" clicked Buy. A percentage appears only once the bottom number reaches 20, because below that one person swings it wildly. A step is only compared over weeks where both numbers exist.

## What counts, and what never does

- Only MassPermits prices count. The Stripe account also runs IRWatch; its sales never appear here.
- The page shows counts only. No names, emails, card details or addresses are on it or in the data behind it.
- Stripe numbers are refreshed at most every 10 minutes. Press Refresh for the rest.

## Setup (once)

1. **Stripe permissions: nothing new.** The page uses the same restricted read key as Mission Control (`STRIPE_READ_KEY`). It reads Checkout Sessions and Subscriptions, which that key can already read. It now reads all checkout sessions (open, expired and complete), not only completed ones; that is the same "Checkout Sessions: Read" permission.
2. **Add one Production variable in Cloudflare Pages:** `MASSPERMITS_FEED_PRICE_IDS` = the Weekly Feed's price id (Stripe, Products, Weekly Feed, the price row). It must also be on `MASSPERMITS_PRICE_IDS`. Until it is set, the page counts every MassPermits product (Weekly Feed, Lead Pack and Radar together) and says so under the big number.
3. Redeploy so the variable takes effect.

## Where the Buy clicks come from

A small shared script, `/js/buy-click.js`, sends one count to our own server when someone clicks any buy.stripe.com link. It is loaded on the four pages that have Buy buttons today: the homepage, /offer, /offer/ and /agents. Every other page on the site sends people to the homepage to buy, so their clicks are counted there.

If a future page gets its own Buy button, it needs the same one line, or its clicks are not counted:

```html
<script src="/js/buy-click.js" defer></script>
```

Pages written by the private site builder (the /permits/, /guides/, /news/ pages and the rest) carry no Buy links today. If the builder ever adds one, the line has to go into the builder's templates, the frozen page retrofit and the dark branch, all three, or some pages will be missed.
