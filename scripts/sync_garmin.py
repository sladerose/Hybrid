#!/usr/bin/env python3
"""Sync Garmin data to Supabase for yesterday (finalized) and today (partial),
for every user with a stored Garmin credential (see credentials.py).

Garmin finalizes full-day totals (steps, stress, calories) only once the day
ends, so "yesterday" is the newest *complete* row. But sleep and resting HR
are keyed by wake-date and known the moment the user wakes up — syncing
"today" too means last night's sleep drives the readiness panel same-day
instead of sitting unused until tomorrow's run. Today's row is necessarily
partial and gets overwritten (upsert) as the day progresses and by
tomorrow's "yesterday" pass once finalized.

This script only ever looks at the last two days — it does not backfill
history for newly-connected users. That happens once, automatically, right
after a successful connect (see connect_account.py). To re-run a specific
date range by hand (e.g. to fill a gap after a failed sync), use
backfill_garmin.py instead.

Auth: each user's stored payload is the exact {di_token, di_refresh_token,
di_client_id} shape garminconnect's Garmin.client.dumps() produces (see the
Garmin token-shape spike in connect_account.py's docstring). It's written to
a per-user temp tokenstore directory and loaded via Garmin().login(tokenstore=...)
— any refresh that happens during login is re-persisted back to that user's
user_credentials row afterward, replacing the old gh-secret-rotation dance.

GitHub Secrets required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import datetime
import json
import os
import random
import sys
import time

from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
import garmin_lib  # noqa: E402
from credentials import get_active_users, mark_failed, mark_synced, update_payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
today = datetime.date.today().isoformat()


def sync_user(user_id: str, payload: dict) -> None:
    client = garmin_lib.load_client(payload)

    for date_str in (yesterday, today):
        garmin_lib.sync_daily(supabase, client, user_id, date_str)
        print(f"  garmin_daily OK ({date_str})")

        count = garmin_lib.sync_activities(supabase, client, user_id, date_str)
        print(f"  garmin_activities OK ({date_str}, {count} activities)")

        count = garmin_lib.sync_bp(supabase, client, user_id, date_str)
        print(f"  blood_pressure_readings OK ({date_str}, {count} readings)")

    garmin_lib.sync_fitness_age(supabase, client, user_id, yesterday)
    garmin_lib.sync_weekly_stress(supabase, client, user_id, today)

    # Persist any token rotation that happened during login/refresh.
    update_payload(user_id, "garmin", json.loads(client.client.dumps()))


def main() -> None:
    users = get_active_users("garmin")
    print(f"Syncing Garmin for {len(users)} user(s), {yesterday} (finalized) and {today} (partial)...")
    failures = 0

    for i, cred in enumerate(users):
        print(f"[{cred.user_id}] syncing...")
        try:
            sync_user(cred.user_id, cred.payload)
            mark_synced(cred.user_id, "garmin", datetime.datetime.utcnow().isoformat())
        except Exception as e:
            failures += 1
            mark_failed(cred.user_id, "garmin", str(e))
            print(f"  FAILED: {e}", file=sys.stderr)

        if i < len(users) - 1:
            time.sleep(random.uniform(2, 8))  # jitter — avoid bursting Garmin's rate limiter

    if users and failures == len(users):
        sys.exit(1)


if __name__ == "__main__":
    main()
