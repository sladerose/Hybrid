#!/usr/bin/env python3
"""Manual Zepp re-sync for a single user over an explicit window.

sync_zepp.py already self-heals like sync_strava.py: a brand-new connection
has no rows, so it pulls the last 90 days automatically on its first cron
pass. This script covers the case that default doesn't — a gap in the
*middle* of existing history, where "since the last measurement" won't look
back far enough. Safe to re-run over a range that already has data (upsert
on user_id + date).

GitHub Secrets / env vars required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import argparse
import asyncio
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from credentials import get_user_credential, mark_failed, mark_synced  # noqa: E402
import sync_zepp  # noqa: E402


async def run(user_id: str, start_date: str, end_date: str) -> None:
    cred = get_user_credential(user_id, "zepp")
    await sync_zepp.sync_user(
        user_id,
        cred.payload["app_token"],
        cred.payload["huami_user_id"],
        cred.payload.get("region", "us"),
        start_date=start_date,
        end_date=end_date,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill/re-sync Zepp for one user.")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--start-date", help="YYYY-MM-DD. Defaults to --days back from --end-date.")
    parser.add_argument("--end-date", help="YYYY-MM-DD. Defaults to today.")
    parser.add_argument("--days", type=int, default=90, help="Used when --start-date is omitted.")
    args = parser.parse_args()

    end_date = args.end_date or datetime.date.today().isoformat()
    start_date = args.start_date or (
        datetime.date.fromisoformat(end_date) - datetime.timedelta(days=args.days)
    ).isoformat()

    try:
        asyncio.run(run(args.user_id, start_date, end_date))
        mark_synced(args.user_id, "zepp", datetime.datetime.utcnow().isoformat())
        print(f"Backfill complete for {args.user_id}: {start_date} -> {end_date}")
    except Exception as e:
        mark_failed(args.user_id, "zepp", f"Backfill failed: {e}")
        print(f"Backfill FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
