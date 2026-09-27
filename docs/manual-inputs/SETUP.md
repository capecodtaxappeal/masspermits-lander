# Manual inputs: setup, click by click

Do these in order. Each step says whether it is **safe any day** or
**never on a Monday**. The customer email goes out on Monday, roughly 12:00 to
17:00 UTC; anything that redeploys the site or changes DNS waits for
Tuesday to Sunday.

**The intake address** is the local part `drop` on the domain
`in.masspermits.com`. Below it is written INTAKE ADDRESS; type it as `drop`,
then the at sign, then `in.masspermits.com`, with no spaces. (This public repo
never spells out a whole address.) Use a different local part if you like;
keep it on the `in.` subdomain.

> **The one thing never to touch:** the MX records on the root domain
> `masspermits.com`. They deliver your Google Workspace mail. Everything here
> happens on the subdomain `in.masspermits.com`. If any Cloudflare screen
> offers to add, change or delete MX records for `masspermits.com` itself,
> click **Cancel** and stop.

---

## Part 1: the drop box

### Step 1. Write down the root mail records (safe any day)

1. Cloudflare dashboard, pick the `masspermits.com` zone, **DNS**, **Records**.
2. Filter by type **MX**. Take a screenshot. These are the Google Workspace
   records. You will compare against this screenshot after Part 2.

### Step 2. Set MANUAL_SOURCES on Pages (safe any day; it takes effect at the next deploy)

1. **Workers & Pages**, the `masspermits-lander` project, **Settings**,
   **Variables and Secrets**, **Production**.
2. Add a variable `MANUAL_SOURCES`, type **Text**, with a JSON object: one
   entry per hand-delivered source. Slugs are 2 to 40 characters of lowercase
   letters, digits and `-`. Example shape:

   ```json
   {
     "town-a": { "label": "Town A", "cadence": "weekly",  "accept": ["csv", "xlsx"] },
     "town-b": { "label": "Town B", "cadence": "monthly", "accept": ["pdf"] }
   }
   ```

   `cadence` is `weekly` or `monthly`. `accept` lists which of `csv`, `xlsx`,
   `pdf` that source may send.
3. Check that `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` and
   `ADMIN_ALLOWED_EMAILS` are already there (Mission Control uses them). The
   drop box uses the same three.
4. **Save**. Do not click "Retry deployment" now; Step 3 deploys.

### Step 3. Merge the pull request (NEVER ON A MONDAY)

Merging to `main` is a production deploy of the whole site, including the
customer send path.

1. Open the pull request "Manual inputs: owner drop box, email intake, engine
   read route", mark it ready, merge it, Tuesday to Sunday.
2. Wait for the Pages deployment to show **Success**.

### Step 4. Try the drop box (safe any day)

1. On your phone, open `https://masspermits.com/admin/drop`. Cloudflare Access
   asks you to sign in, as it does for Mission Control.
2. Pick a source, drop a small real file (or tap to choose one).
3. You should see "Received". The table below shows the date, size and type.
   Drop the same file again: it answers "Already received".

That is the whole weekly routine for a source that only you can download:
open the page, drag the file in.

---

## Part 2: the email intake

### Step 5. Turn on Email Routing for the subdomain only (NEVER ON A MONDAY)

1. Cloudflare dashboard, the `masspermits.com` zone, **Email**,
   **Email Routing**, **Settings**.
2. Under **Subdomains**, enter `in` (so the full name is `in.masspermits.com`)
   and submit.
3. **Stop here if** the dashboard instead asks you to enable Email Routing for
   `masspermits.com` itself, or to add or remove MX records on the root. Click
   **Cancel**. Your Google Workspace mail depends on the root MX records.
4. Cloudflare adds these records **on `in.masspermits.com` only** (the exact
   priorities and the DKIM key are whatever the dashboard shows):

   | Type | Name | Content |
   |---|---|---|
   | MX | `in` | `route1.mx.cloudflare.net` |
   | MX | `in` | `route2.mx.cloudflare.net` |
   | MX | `in` | `route3.mx.cloudflare.net` |
   | TXT | `in` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
   | TXT | `cf2024-1._domainkey.in` | `v=DKIM1; h=sha256; k=rsa; p=...` |

5. **DNS**, **Records**, filter **MX**. Compare with your Step 1 screenshot:
   the `masspermits.com` MX records must be exactly the same. If they are not,
   put them back from the screenshot right away.

### Step 6. Deploy the Worker (safe any day)

On your computer, in this repo:

```sh
cd workers/manual-intake
npm ci
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` binds the private bucket `masspermits-bundles` as `BUNDLES`.
The Worker has no web address (`workers_dev = false`) and, until Step 7, no
configuration, so it quietly drops everything it receives.

### Step 7. Set the Worker's secrets (safe any day)

Still in `workers/manual-intake`. Each command asks you to paste the value.
Secrets are used instead of plain variables so that no address sits in this
public repo and so that a later deploy never wipes them.

```sh
npx wrangler secret put ALLOWED_SENDERS
npx wrangler secret put OWNER_FORWARDER
npx wrangler secret put MANUAL_SOURCES
```

* `ALLOWED_SENDERS`: JSON mapping an exact sender address, or a whole domain,
  to a slug. For example
  `{"<the office's exact address>": "town-a", "<a domain>": "town-b"}`.
  A domain entry matches that domain exactly, not its subdomains. A free
  webmail domain is never accepted as a whole domain; list that address exactly.
* `OWNER_FORWARDER`: your own mailbox address, the one Gmail forwards from.
* `MANUAL_SOURCES`: the same JSON as in Step 2.
* Optional: `TRUSTED_AUTHSERV_ID`, only if Step 8 tells you to.

### Step 8. Route the address to the Worker and check the auth header (safe any day)

1. **Email Routing**, **Routing rules**, **Create address**. Custom address
   `drop` on `in.masspermits.com`. Action **Send to a Worker**, Worker
   `masspermits-manual-intake`. Save. Leave the catch-all off.
2. Check which name Cloudflare signs its checks with. Create a second,
   temporary address, `check` on `in.masspermits.com`, action **Send to an
   email**, destination your own mailbox (Cloudflare sends a one-time
   verification link to that mailbox first; click it). Send any email to the
   `check` address from your phone. In Gmail open it, **Show original**, and
   find the topmost `Authentication-Results:` or
   `ARC-Authentication-Results:` line added by Cloudflare. The word right after
   the `;` (or after `i=N;`) is the authserv-id. If it is `mx.cloudflare.net`,
   do nothing. If it is anything else, set it with
   `npx wrangler secret put TRUSTED_AUTHSERV_ID`.
3. Delete the temporary `check` address.

### Step 9. Gmail: add the forwarding address, with its verification code (safe any day)

Gmail sends a confirmation code to the new forwarding address, and the Worker
throws away anything that is not a file from an allowed sender. So point the
`drop` address at your mailbox for two minutes:

1. **Email Routing**, **Routing rules**, edit `drop`: action **Send to an
   email**, destination your own mailbox. Save.
2. Gmail on a computer, gear icon, **See all settings**,
   **Forwarding and POP/IMAP**, **Add a forwarding address**, enter
   the INTAKE ADDRESS, **Next**, **Proceed**.
3. The confirmation email arrives in your own inbox (through the rule you just
   changed). Copy the code into Gmail and **Verify**, or click its link.
4. Back in **Email Routing**, edit `drop` again: action **Send to a Worker**,
   `masspermits-manual-intake`. Save. **Do not skip this.**
5. In Gmail, keep **Disable forwarding** selected at the top of that settings
   page. Forwarding happens only through the filter in Step 10.

### Step 10. Gmail: one filter per sending office (safe any day)

1. In Gmail search, click the options icon. **From**: the office's exact
   address. Tick **Has attachment**. **Create filter**.
2. Tick **Forward it to** and pick the INTAKE ADDRESS. Do not tick
   "Never send it to Spam": Gmail's spam check is part of the protection.
3. **Create filter**.

Add the same sender to `ALLOWED_SENDERS` (Step 7) if it is not there yet.

### Step 11. Test end to end (safe any day)

1. Forward one real email with a file from that office to
   the INTAKE ADDRESS, or wait for the next one.
2. Open `https://masspermits.com/admin/drop`. The receipt shows under that
   source with "email" in the Via column.
3. If it does not: Workers & Pages, `masspermits-manual-intake`, **Logs**. Each
   message logs one line with an outcome word and counts:
   `no-trusted-auth` means Step 8.2 needs a different `TRUSTED_AUTHSERV_ID`;
   `sender-not-allowed` means the address is missing from `ALLOWED_SENDERS`
   (or, for a forward, `OWNER_FORWARDER` is not your exact address);
   `not-configured` means a secret is missing.

After this, when an office emails a file, you do nothing.

---

## Later changes

| Change | How | When |
|---|---|---|
| Add or remove a source | edit `MANUAL_SOURCES` on Pages, then the Worker secret of the same name | Pages part needs a deploy: NEVER ON A MONDAY. Worker secret: safe any day |
| Add or remove a sender | `npx wrangler secret put ALLOWED_SENDERS` | safe any day |
| Change a Gmail filter | Gmail settings | safe any day |
| Anything in DNS or Email Routing | dashboard | NEVER ON A MONDAY |
