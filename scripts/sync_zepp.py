#!/usr/bin/env python3
"""Sync Zepp Life body measurements to Supabase.

GitHub Secrets required:
  ZEPP_APP_TOKEN, ZEPP_USER_ID, ZEPP_REGION
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID
"""

import asyncio
import os
import sys
import json
import datetime
from pathlib import Path

import keyring
from keyring.backend import KeyringBackend


class _EnvKeyring(KeyringBackend):
    """Read Zepp credentials from env vars instead of system keyring."""
    priority = 100

    def get_password(self, service, username):
        if service != "zepp-life-mcp":
            return None
        return {
            "zepp_auth_token": os.environ.get("ZEPP_APP_TOKEN"),
            "zepp_auth_user_id": os.environ.get("ZEPP_USER_ID"),
        }.get(username)

    def set_password(self, service, username, password):
        pass

    def delete_password(self, service, username):
        pass


keyring.set_keyring(_EnvKeyring())

# Write config.json before importing zepp modules
_config_dir = Path.home() / ".config" / "zepp-life-mcp"
_config_dir.mkdir(parents=True, exist_ok=True)
_data_dir = Path("/tmp/zepp-data")
_data_dir.mkdir(parents=True, exist_ok=True)

(_config_dir / "config.json").write_text(json.dumps({
    "mode": "cloud_session",
    "region": os.environ.get("ZEPP_REGION", "us"),
    "timezone": "UTC",
    "database_path": str(_data_dir / "zepp.db"),
    "logs_path": str(_data_dir / "zepp.log"),
    "export_path": None,
    "auto_sync_on_start": False,
    "stale_after_minutes": 60,
    "store_raw_payloads": True,
    "default_lookback_days": 30,
}))

from zepp_life_mcp.config import load_config
from zepp_life_mcp.auth import load_token
from zepp_life_mcp.adapters.cloud_session import CloudSessionAdapter
from zepp_life_mcp.storage import Database
from zepp_life_mcp.services.sync_service import SyncService
from zepp_life_mcp.services.query_service import QueryService
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


async def main():
    cfg = load_config()
    app_token, user_id = load_token()
    db = Database(cfg.database_path)
    adapter = CloudSessionAdapter(app_token=app_token, user_id=user_id, region=cfg.region)

    if not await adapter.connect():
        print("Cannot connect to Zepp Life API. Verify ZEPP_APP_TOKEN is valid.", file=sys.stderr)
        sys.exit(1)

    sync_svc = SyncService(adapter, db)
    query_svc = QueryService(db, user_id)

    # Determine sync window
    try:
        result = supabase.table("zepp_body_composition") \
            .select("measured_at") \
            .eq("user_id", USER_ID) \
            .order("measured_at", desc=True) \
            .limit(1) \
            .execute()

        if result.data:
            start_date = result.data[0]["measured_at"][:10]
        else:
            start_date = (datetime.date.today() - datetime.timedelta(days=90)).isoformat()
    except Exception as e:
        print(f"Could not determine sync window: {e}", file=sys.stderr)
        start_date = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()

    end_date = datetime.date.today().isoformat()
    print(f"Syncing Zepp body measurements {start_date} to {end_date}...")

    # Pull from Zepp cloud into local SQLite
    try:
        await sync_svc.sync_data_type("body_measurements", start_date=start_date, end_date=end_date)
        print("  Zepp cloud sync OK")
    except Exception as e:
        print(f"  Zepp cloud sync FAILED: {e}", file=sys.stderr)
        sys.exit(1)

    # Query local SQLite
    try:
        measurements = query_svc.get_body_measurements(start_date, end_date)
        print(f"  Got {len(measurements)} measurements from local DB")
    except Exception as e:
        print(f"  Query FAILED: {e}", file=sys.stderr)
        sys.exit(1)

    if not measurements:
        print("No measurements to sync.")
        return

    # Get existing measured_at values to avoid duplicates
    try:
        existing = supabase.table("zepp_body_composition") \
            .select("measured_at") \
            .eq("user_id", USER_ID) \
            .gte("measured_at", start_date) \
            .execute()
        existing_ts = {r["measured_at"] for r in (existing.data or [])}
    except Exception as e:
        print(f"  Could not fetch existing records: {e}", file=sys.stderr)
        existing_ts = set()

    rows = []
    for m in measurements:
        measured_at = m.get("measured_at") or m.get("timestamp") or m.get("date")
        if not measured_at or measured_at in existing_ts:
            continue
        rows.append({
            "user_id": USER_ID,
            "date": str(measured_at)[:10],
            "measured_at": measured_at,
            "weight_kg": m.get("weight_kg"),
            "bmi": m.get("bmi"),
            "body_fat_percent": m.get("body_fat_pct") or m.get("body_fat_percent"),
            "muscle_mass_kg": m.get("muscle_mass_kg"),
            "bone_mass_kg": m.get("bone_mass_kg"),
            "hydration_percent": m.get("water_pct") or m.get("hydration_pct") or m.get("hydration_percent"),
            "visceral_fat": m.get("visceral_fat") or m.get("visceral_fat_level"),
            "visceral_fat_rating": m.get("visceral_fat_rating"),
            "metabolic_age": m.get("metabolic_age"),
            "physique_rating": m.get("physique_rating"),
            "basal_metabolic_rate": m.get("basal_metabolic_rate") or m.get("bmr"),
            "synced_at": datetime.datetime.utcnow().isoformat(),
        })

    if rows:
        # Multiple measurements per day possible — keep latest per date before upsert
        rows_by_date: dict = {}
        for row in rows:
            d = row["date"]
            if d not in rows_by_date or (row["measured_at"] or "") > (rows_by_date[d]["measured_at"] or ""):
                rows_by_date[d] = row
        rows = list(rows_by_date.values())
        supabase.table("zepp_body_composition").upsert(rows, on_conflict="user_id,date").execute()
        print(f"  zepp_body_composition OK ({len(rows)} rows upserted)")
    else:
        print("  zepp_body_composition: no new measurements")

    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
