# MassPermits — Deploy & Update Guide

A **pure static site** (one `index.html` + a masked `data.json`). No build step,
no server, nothing to hack. Same GitHub → Cloudflare Pages flow as
capecodtaxappeal.com. ~5 minutes to go live.

## Architecture (why this is safe)
- The **public site** shows only a *masked teaser* (house numbers blurred, counts + values). The real leads never touch the internet.
- The **real data + PDF/CSV packets** live on your local PermitPulse machine.
- Your weekly job = regenerate `data.json` locally and `git push`. Cloudflare rebuilds in ~30s.
- The only "backend" is **Stripe** (checkout) + emailing the packet. That's it.

---

## ONE-TIME SETUP

### 1. Push this folder to GitHub
```
cd C:\Users\patri\OneDrive\Desktop\masspermits-lander
git add -A
git commit -m "MassPermits lander"
```
Create the repo on GitHub (e.g. `masspermits/masspermits-lander`), then:
```
git branch -M main
git remote add origin https://github.com/<you>/masspermits-lander.git
git push -u origin main
```

### 2. Connect to Cloudflare Pages
1. dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Pick the `masspermits-lander` repo → **Begin setup**
3. Build config:
   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(leave blank)* |
   | Build output directory | `/` *(repo root — the site IS static)* |
4. **Save and Deploy.** ~20s → preview URL `https://masspermits-lander.pages.dev`

### 3. Bind the domain
Pages → your project → **Custom domains** → add `masspermits.com`. Cloudflare
(same account that holds the domain) auto-adds DNS + SSL. Live in ~2 min.

### 4. Wire the two integrations (edit `index.html`, top of `<script>`)
```js
const WEB3FORMS_KEY = "";   // <- paste your Web3Forms key (free, web3forms.com) → free-sample emails go to you
const STRIPE_LINK   = "";   // <- paste your $49 Stripe Payment Link → Buy button uses it
```
Also set the footer `[YOUR EMAIL]` to a real address.
Commit + push → live in ~30s. (Until set: Buy routes to the free-sample form, and the form fails-soft so the page never looks broken.)

---

## WEEKLY UPDATE (the only recurring task)
On your local machine:
```
cd C:\Users\patri\OneDrive\Desktop\PermitPulse
python scraper.py              # refresh real permit data
python export_lander.py        # write ../masspermits-lander/data.json (masked snapshot)
cd ..\masspermits-lander
git add -A && git commit -m "weekly data" && git push
```
Cloudflare auto-rebuilds. Done.

---

## FULFILLMENT (when someone buys)
A Stripe purchase notifies you (email/dashboard). To deliver:
```
cd C:\Users\patri\OneDrive\Desktop\PermitPulse
# generate their trade+area packet (PDF + CSV) from the live server, e.g.:
#   http://localhost:8003/api/feed.pdf?source=Barnstable, MA&trade=Roofing
#   http://localhost:8003/api/feed.csv?source=Barnstable, MA&trade=Roofing
```
Email the two files. (Later: automate via Stripe webhook → auto-send.)
