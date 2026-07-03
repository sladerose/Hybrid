#!/usr/bin/env python3
"""Sync Zepp Life data to Supabase, for every user with a stored Zepp
credential (see credentials.py). Each user's CloudSessionAdapter is
constructed directly from their decrypted app_token/huami_user_id/region —
no global keyring shim, since there's no longer a single shared account.

Covers three data categories from the same Huami account: body composition
(Xiaomi scale), daily wellness (steps/sleep/resting HR from an Amazfit
watch), and workouts. Row-shape logic for each lives in zepp_lib.py.

GitHub Secrets required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import asyncio
import datetime
import json
import os
import random
import sys
from pathlib import Path

from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from credentials import get_active_users, mark_failed, mark_synced  # noqa: E402
import zepp_lib  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

_config_dir = Path.home() / ".config" / "zepp-life-mcp"
_config_dir.mkdir(parents=True, exist_ok=True)
_data_dir = Path("/tmp/zepp-data")
_data_dir.mkdir(parents=True, exist_ok=True)

(_config_dir / "config.json").write_text(json.dumps({
    "mode": "cloud_session",
    "region": "us",
    "timezone": "UTC",
    "database_path": str(_data_dir / "zepp.db"),
    "logs_path": str(_data_dir / "zepp.log"),
    "export_path": None,
    "auto_sync_on_start": False,
    "stale_after_minutes": 60,
    "store_raw_payloads": True,
    "default_lookback_days": 30,
}))

from zepp_life_mcp.config import load_config  # noqa: E402
from zepp_life_mcp.storage import Database  # noqa: E402

_cfg = load_config()
_db = Database(_cfg.database_path)

DEFAULT_LOOKBACK_DAYS = 90


def _since_last(table: str, date_col: str, user_id: str) -> str:
    """Last recorded date for this table/user, or a 90-day fallback for a
    brand-new data category (e.g. zepp_daily/zepp_workouts on a connection
    that previously only synced body composition) — same self-heal
    convention sync_strava.py uses for a zero-row user."""
    result = (
        supabase.table(table)
        .select(date_col)
        .eq("user_id", user_id)
        .order(date_col, desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        return str(result.data[0][date_col])[:10]
    return (datetime.date.today() - datetime.timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()


async def sync_user(
    user_id: str,
    app_token: str,
    huami_user_id: str,
    region: str,
    start_date: str | None = None,
    end_date: str | None = None,
) -> None:
    """start_date/end_date override each table's "since last row" default —
    used by backfill_zepp.py to force-refetch an explicit window (e.g. to
    repair a gap). Safe to re-run over a range that already has data: every
    table upserts on its natural key.
    """
    sync_svc, query_svc = await zepp_lib.connect(app_token, huami_user_id, region, _db)
    end_date = end_date or datetime.date.today().isoformat()

    body_start = start_date or _since_last("zepp_body_composition", "measured_at", user_id)
    print(f"  body composition: {body_start} to {end_date}...")
    n = await zepp_lib.sync_body_comp(supabase, sync_svc, query_svc, user_id, body_start, end_date)
    print(f"  zepp_body_composition OK ({n} rows upserted)")

    daily_start = start_date or _since_last("zepp_daily", "date", user_id)
    print(f"  daily wellness: {daily_start} to {end_date}...")
    n = await zepp_lib.sync_daily(supabase, sync_svc, query_svc, user_id, daily_start, end_date)
    print(f"  zepp_daily OK ({n} rows upserted)")

    workouts_start = start_date or _since_last("zepp_workouts", "start_date", user_id)
    print(f"  workouts: {workouts_start} to {end_date}...")
    n = await zepp_lib.sync_workouts(supabase, sync_svc, query_svc, user_id, workouts_start, end_date)
    print(f"  zepp_workouts OK ({n} rows upserted)")


async def main() -> None:
    users = get_active_users("zepp")
    print(f"Syncing Zepp for {len(users)} user(s)...")
    failures = 0

    for i, cred in enumerate(users):
        print(f"[{cred.user_id}] syncing...")
        try:
            await sync_user(
                cred.user_id,
                cred.payload["app_token"],
                cred.payload["huami_user_id"],
                cred.payload.get("region", "us"),
            )
            mark_synced(cred.user_id, "zepp", datetime.datetime.utcnow().isoformat())
        except Exception as e:
            failures += 1
            mark_failed(cred.user_id, "zepp", str(e))
            print(f"  FAILED: {e}", file=sys.stderr)

        if i < len(users) - 1:
            await asyncio.sleep(random.uniform(2, 8))  # jitter — avoid bursting shared runner IP

    if users and failures == len(users):
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
