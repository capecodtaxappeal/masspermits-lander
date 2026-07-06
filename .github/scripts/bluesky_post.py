#!/usr/bin/env python3
"""Daily Bluesky post for @masspermits — a Massachusetts permit-activity nugget.

Reads the PUBLIC MassPermits JSON feed (masspermits.com/feed/permits.json),
aggregates by town (aggregate counts only — never a single address), rotates the
featured town by day so posts vary, and posts with a link to that town's page.

Needs env vars BSKY_HANDLE (e.g. masspermits.bsky.social) and BSKY_PASSWORD
(a Bluesky *app password*, not the main password) — set as GitHub repo secrets.
If they're unset the script exits quietly, so the workflow is safe to merge before
the account exists. Fully autonomous once the secrets are in place.

    python bluesky_post.py            # post
    python bluesky_post.py --dry      # print what it would post, don't post
"""
import collections
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

FEED = "https://masspermits.com/feed/permits.json"


def fetch(url: str) -> str:
    r = subprocess.run(["curl", "-fsS", "-A", "masspermits-bsky", url],
                       capture_output=True, text=True, timeout=60)
    r.check_returncode()
    return r.stdout


def slugify(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in (s or "").lower()).strip("-")


def build_post():
    items = json.loads(fetch(FEED)).get("items", [])
    by_town = collections.Counter(it.get("_town", "") for it in items if it.get("_town"))
    # prefer towns with a substantive count so nuggets don't read "2 permits"
    towns = [t for t, c in by_town.most_common() if t and c >= 4] \
        or [t for t, _ in by_town.most_common() if t]
    if not towns:
        return None
    # rotate the featured town by day-of-year so it varies and doesn't repeat quickly
    day = datetime.now(timezone.utc).timetuple().tm_yday
    town = towns[day % len(towns)]
    count = by_town[town]
    trades = collections.Counter(it.get("_trade", "") for it in items
                                 if it.get("_town") == town and it.get("_trade"))
    trade = (trades.most_common(1)[0][0].lower() if trades else "construction")
    slug = slugify(town)
    link_text = f"masspermits.com/permits/{slug}"
    url = f"https://masspermits.com/permits/{slug}"
    text = (f"\U0001F3D7️ {count} recent building permits in {town}, MA "
            f"({trade} & more) — each one a homeowner just approved to spend on "
            f"their property, the earliest lead a contractor can get. Full list: ")
    if len(text) + len(link_text) > 295:  # Bluesky ~300-char limit
        text = f"\U0001F3D7️ {count} recent building permits in {town}, MA — fresh contractor leads: "
    return text, link_text, url, town, count


def main():
    handle = os.environ.get("BSKY_HANDLE", "").strip()
    password = os.environ.get("BSKY_PASSWORD", "").strip()
    dry = "--dry" in sys.argv

    post = build_post()
    if not post:
        print("no towns in feed — nothing to post")
        return
    text, link_text, url, town, count = post

    if dry:
        print("WOULD POST:\n" + text + url)
        return
    if not handle or not password:
        print("BSKY_HANDLE / BSKY_PASSWORD not set — skipping. "
              "Add them as repo secrets to activate the daily post.")
        return

    from atproto import Client, client_utils
    client = Client()
    client.login(handle, password)
    tb = client_utils.TextBuilder()
    tb.text(text)
    tb.link(link_text, url)
    client.send_post(tb)
    print(f"posted: {town} ({count}) -> {url}")


if __name__ == "__main__":
    main()
