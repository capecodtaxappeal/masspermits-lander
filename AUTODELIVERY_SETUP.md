# MassPermits — Auto-Delivery Setup (one-time)

The code is built & deployed. A Stripe payment will auto-email the right bundle —
once these 4 credential steps are done. ~20 minutes, all in accounts I can't
create for you. Do them in order.

## How it works (so the steps make sense)
```
Customer pays on Stripe
   └─> Stripe calls  https://masspermits.com/api/stripe-webhook   (already live)
         └─> verifies signature → picks bundle → pulls ZIP from R2 → emails via Resend
                one-time buyer / NEW subscriber  → latest-monthly.zip
                subscription RENEWAL             → latest-weekly.zip
Free-sample form → links to /api/sample → serves latest-sample.zip from R2
```
You keep the bundles fresh by running, weekly, on your machine:
```
python weekly_refresh.py      # scrape + build monthly/weekly/sample bundles
python publish_bundles.py     # upload the 3 bundles to R2  (needs `npx wrangler login` once)
```

---

## STEP 1 — Create the R2 bucket (holds the bundles)
1. Cloudflare dash → **R2** (left sidebar) → **Create bucket**
2. Name it exactly: **`masspermits-bundles`**  → Create. (Free tier is plenty.)
   *(R2 may ask you to add a payment card to "activate" — it won't charge at this volume; free tier = 10GB.)*

## STEP 2 — Bind R2 to the Pages project (so the functions can read it)
1. Cloudflare → **Workers & Pages** → **masspermits-lander** → **Settings** → **Bindings** (or "Functions" → "R2 bucket bindings")
2. **Add binding**:
   - Variable name: **`BUNDLES`**  (exact, uppercase)
   - R2 bucket: **masspermits-bundles**
3. Save. (Triggers a redeploy.)

## STEP 3 — Resend (sends the email + attachment)
1. Sign up free at **resend.com** (3,000 emails/mo free).
2. **Add domain** → `masspermits.com` → Resend shows DNS records (SPF/DKIM).
3. Add those records in Cloudflare → masspermits.com → **DNS** (just paste what Resend gives).
   *(This is the same DNS area; takes ~2 min to verify.)*
4. **API Keys** → Create → copy the `re_...` key.
5. In Cloudflare → masspermits-lander → Settings → **Variables and Secrets**, add (type: Secret):
   - `RESEND_API_KEY` = the `re_...` key
   - `FROM_EMAIL` = `MassPermits <leads@masspermits.com>`  (any address @masspermits.com)

## STEP 4 — Stripe webhook (tells our site about payments)
1. Stripe → **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: **`https://masspermits.com/api/stripe-webhook`**
3. **Select events**: `checkout.session.completed` AND `invoice.paid`
4. Add endpoint → click it → reveal **Signing secret** (`whsec_...`) → copy.
5. Cloudflare → masspermits-lander → Settings → **Variables and Secrets** (type: Secret):
   - `STRIPE_WEBHOOK_SECRET` = the `whsec_...`
6. (Bindings/secrets change → redeploy: Pages → Deployments → Retry latest, or just push any commit.)

---

## TEST IT (do this once everything's set)
1. `python weekly_refresh.py` then `python publish_bundles.py` (uploads bundles to R2).
2. Stripe → your $49 Payment Link → buy with a REAL card (you can refund after).
3. Within ~30s the bundle email should arrive. Check Stripe webhook logs (Developers → Webhooks → your endpoint → recent deliveries) for `200 OK`.
4. Refund yourself in Stripe.

## Troubleshooting
- Webhook delivery shows non-200 → click it, read the response body (our function returns a JSON error like `bundle latest-monthly.zip not in R2` → run publish_bundles).
- No email but webhook = 200 → Resend domain not verified, or FROM_EMAIL not on a verified domain.
- `/api/sample` 500 → R2 binding `BUNDLES` missing (Step 2) or `latest-sample.zip` not uploaded (publish_bundles).

## Weekly routine (after setup, ~2 min)
```
cd C:\Users\patri\OneDrive\Desktop\PermitPulse
python weekly_refresh.py
python publish_bundles.py
cd ..\masspermits-lander && git add -A && git commit -m "weekly data" && git push
```
That refreshes the public teaser AND the auto-delivered bundles. Sales fulfill themselves.
