#!/usr/bin/env python3
"""One-shot Garmin history backfill for a single user, over an explicit date
range. Two callers:

1. Automatic: connect_account.py imports run_backfill() directly and calls
   it right after a successful Garmin connect, with a 90-day default
   window, so a newly-connected user isn't stuck with zero history.
2. Manual: run standalone (locally, or via the "Backfill Data" GitHub
   Action — see .github/workflows/backfill.yml) to re-fill a specific gap,
   e.g. after a sync failure or a token that was dead for a few days.

Idempotent — every write is an upsert keyed on the same columns sync_garmin.py
uses, so re-running over a range that already has data just overwrites it
with the same values. Safe to over-specify the range.

GitHub Secrets / env vars required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import argparse
import datetime
import json
import os
import random
import sys
import time

from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
import garmin_lib  # noqa: E402
from credentials import get_user_credential, mark_failed, mark_synced, update_payload  # noqa: E402

DEFAULT_BACKFILL_DAYS = 90


def run_backfill(supabase, user_id: str, payload: dict, start_date: str, end_date: str) -> dict:
    """Returns the possibly-rotated Garmin token payload so callers already
    holding a fresher payload (e.g. connect_account.py, mid-connect) can
    persist it themselves instead of a second decrypt/re-encrypt round trip.
    """
    client = garmin_lib.load_client(payload)
    dates = garmin_lib.date_range(start_date, end_date)
    print(f"  Backfilling {len(dates)} day(s): {start_date} -> {end_date}")

    for i, date_str in enumerate(dates):
        garmin_lib.sync_daily(supabase, client, user_id, date_str)
        activity_count = garmin_lib.sync_activities(supabase, client, user_id, date_str)
        bp_count = garmin_lib.sync_bp(supabase, client, user_id, date_str)
        print(f"  {date_str}: daily OK, {activity_count} activities, {bp_count} BP readings")

        if i < len(dates) - 1:
            time.sleep(random.uniform(0.5, 2))  # jitter — this is a lot of calls in one job

    garmin_lib.sync_fitness_age(supabase, client, user_id, end_date)
    garmin_lib.sync_weekly_stress(supabase, client, user_id, end_date)

    rotated_payload = json.loads(client.client.dumps())
    update_payload(user_id, "garmin", rotated_payload)
    return rotated_payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Garmin history for one user.")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--start-date", help="YYYY-MM-DD. Defaults to --days back from --end-date.")
    parser.add_argument("--end-date", help="YYYY-MM-DD. Defaults to yesterday.")
    parser.add_argument("--days", type=int, default=DEFAULT_BACKFILL_DAYS,
                         help=f"Used when --start-date is omitted. Default {DEFAULT_BACKFILL_DAYS}.")
    args = parser.parse_args()

    end_date = args.end_date or (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    if args.start_date:
        start_date = args.start_date
    else:
        start_date = (datetime.date.fromisoformat(end_date) - datetime.timedelta(days=args.days)).isoformat()

    supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    cred = get_user_credential(args.user_id, "garmin")

    try:
        run_backfill(supabase, args.user_id, cred.payload, start_date, end_date)
        mark_synced(args.user_id, "garmin", datetime.datetime.utcnow().isoformat())
        print(f"Backfill complete for {args.user_id}: {start_date} -> {end_date}")
    except Exception as e:
        mark_failed(args.user_id, "garmin", f"Backfill failed: {e}")
        print(f"Backfill FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
