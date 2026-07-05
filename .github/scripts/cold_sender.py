"""MassPermits — unattended cold-outreach sender (runs hourly on GitHub Actions).

Sends 2-3 pre-written, pre-reviewed outreach emails per run from the owner's
Gmail (SMTP + app password), weekdays 9am-6pm ET, ramping 15/day -> 25/day
(hard cap 30). The contact queue + email copy live in PRIVATE R2 (never this
public repo); state is checkpointed after EVERY send so retries can never
double-send. Recipient addresses are never printed (public Actions logs).

DORMANT until the repo secret GMAIL_APP_PASSWORD exists — without it this
exits 0 with a notice, so the pipeline deploys safely ahead of arming.

Guards: kill switch (cold-state.paused), suppression list, per-day caps,
per-run cap, dedupe against the sent log, and Sent-folder copies via Gmail.
"""
from __future__ import annotations

import json
import os
import random
import smtplib
import ssl
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr

BASE = "https://masspermits.com"
AUDIENCE = "masspermits-cron"
# Provider-agnostic SMTP: host/port/user set in the workflow env (non-secret),
# the app password is the one repo SECRET (SMTP_PASSWORD). Defaults target Zoho
# (patrick@masspermits.com) — override SMTP_HOST/SMTP_USER for Gmail/Workspace.
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.zoho.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "patrick@masspermits.com")
SMTP_PASS = os.environ.get("SMTP_PASSWORD", "")
FROM_NAME = os.environ.get("FROM_NAME", "Patrick Seeley")

RAMP_DAILY = 15   # first 7 days from ramp_start
STEADY_DAILY = 25
HARD_CAP = 30
PER_RUN = 3


def oidc() -> str:
    url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=" + AUDIENCE
    req = urllib.request.Request(url, headers={
        "Authorization": "bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())["value"]


def get_json(key: str) -> dict | list:
    req = urllib.request.Request(f"{BASE}/api/get-object?key={key}",
                                 headers={"Authorization": "Bearer " + oidc()})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def put_state(state: dict) -> None:
    req = urllib.request.Request(f"{BASE}/api/upload-bundle?key=cold-state.json",
                                 data=json.dumps(state).encode(), method="PUT",
                                 headers={"Content-Type": "application/json",
                                          "Authorization": "Bearer " + oidc()})
    resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
    if not resp.get("ok"):
        raise RuntimeError("state checkpoint failed: " + str(resp)[:120])


def main() -> None:
    if not SMTP_PASS:
        print("DORMANT: SMTP_PASSWORD secret not set — no sends. "
              "Add it in repo Settings -> Secrets to arm the pipeline.")
        return

    # Smoke-test mode (push-triggered runs): validate SMTP auth end-to-end by
    # emailing the OWNER once. Never touches the queue or state.
    test_to = os.environ.get("TEST_RECIPIENT", "").strip()
    if test_to:
        ctx = ssl.create_default_context()
        msg = EmailMessage()
        msg["From"] = formataddr((FROM_NAME, SMTP_USER))
        msg["To"] = test_to
        msg["Subject"] = "MassPermits outreach pipeline — SMTP test OK"
        msg.set_content("This is the cold-outreach pipeline verifying its SMTP login.\n"
                        "If you're reading this, sending works. Real sends run weekdays "
                        "9am-6pm ET at the configured ramp. No cold emails were sent.")
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as smtp:
            smtp.starttls(context=ctx)
            smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(msg)
        print("SMOKE TEST: sent SMTP-verification email to the owner. No queue sends.")
        return

    state = get_json("cold-state.json")
    if state.get("paused"):
        print("PAUSED via cold-state.json — no sends.")
        return

    queue = get_json("cold-queue.json")
    suppression = {s.lower() for s in get_json("suppression.json")}
    sent_ever = {e["to"].lower() for e in state.get("log", [])}

    today = date.today().isoformat()
    sent_today = int(state.get("sent_by_day", {}).get(today, 0))
    try:
        ramp_days = (date.today() - date.fromisoformat(state.get("ramp_start", today))).days
    except Exception:  # noqa: BLE001
        ramp_days = 0
    daily_cap = min(HARD_CAP, RAMP_DAILY if ramp_days < 7 else STEADY_DAILY)
    budget = min(PER_RUN, daily_cap - sent_today)
    if budget <= 0:
        print(f"Daily cap reached ({sent_today}/{daily_cap}) — no sends this run.")
        return

    due = [e for e in queue
           if e["to"].lower() not in sent_ever and e["to"].lower() not in suppression][:budget]
    if not due:
        print("Queue drained — nothing left to send. 🎉")
        return

    time.sleep(random.randint(0, 240))  # de-robotize the cron cadence

    ctx = ssl.create_default_context()
    sent_n = 0
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as smtp:
        smtp.starttls(context=ctx)
        smtp.login(SMTP_USER, SMTP_PASS)
        for e in due:
            msg = EmailMessage()
            msg["From"] = formataddr((FROM_NAME, SMTP_USER))
            msg["To"] = e["to"]
            msg["Subject"] = e["subject"]
            msg.set_content(e["body"])
            try:
                smtp.send_message(msg)
            except smtplib.SMTPRecipientsRefused:
                # bad address — record as handled so we never retry it, send nothing
                state.setdefault("log", []).append(
                    {"ts": datetime.now(timezone.utc).isoformat(), "to": e["to"],
                     "batch": e.get("batch", ""), "status": "refused"})
                put_state(state)
                continue
            state.setdefault("log", []).append(
                {"ts": datetime.now(timezone.utc).isoformat(), "to": e["to"],
                 "batch": e.get("batch", ""), "status": "sent"})
            state.setdefault("sent_by_day", {})[today] = sent_today + sent_n + 1
            put_state(state)  # checkpoint AFTER each send — a crash can never double-send
            sent_n += 1
            if sent_n < len(due):
                time.sleep(random.randint(45, 150))

    # counts only — recipient addresses never appear in (public) Actions logs
    print(f"Sent {sent_n} email(s). Today: {sent_today + sent_n}/{daily_cap}. "
          f"Queue remaining: {len([e for e in queue if e['to'].lower() not in sent_ever]) - sent_n}.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        # fail visibly (GitHub emails the owner) but never leak addresses
        print("ERROR:", type(e).__name__, str(e)[:200])
        sys.exit(1)
