#!/usr/bin/env python3
"""Manual Strava re-sync for a single user over an explicit window.

sync_strava.py already self-heals: a brand-new connection has no rows, so it
pulls the last 90 days automatically on its first cron pass. This script is
for the case that default doesn't cover — a gap in the *middle* of existing
history (a failed sync day, a token that was dead for a week), where the
"since the last activity" logic in sync_strava.py won't look back far enough
to refetch it. Re-fetching a range that already has data is safe (upsert on
Strava activity id).

GitHub Secrets / env vars required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY,
  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
"""

import argparse
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from credentials import get_user_credential, mark_failed, mark_synced  # noqa: E402
import sync_strava  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill/re-sync Strava for one user.")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--start-date", help="YYYY-MM-DD. Defaults to --days back from today.")
    parser.add_argument("--days", type=int, default=90, help="Used when --start-date is omitted.")
    args = parser.parse_args()

    if args.start_date:
        since_dt = datetime.datetime.fromisoformat(args.start_date)
    else:
        since_dt = datetime.datetime.utcnow() - datetime.timedelta(days=args.days)
    since_ts = int(since_dt.timestamp())

    cred = get_user_credential(args.user_id, "strava")

    try:
        sync_strava.sync_user(args.user_id, cred.payload["refresh_token"], since_ts=since_ts)
        mark_synced(args.user_id, "strava", datetime.datetime.utcnow().isoformat())
        print(f"Backfill complete for {args.user_id}, since {since_dt.date().isoformat()}")
    except Exception as e:
        mark_failed(args.user_id, "strava", f"Backfill failed: {e}")
        print(f"Backfill FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
