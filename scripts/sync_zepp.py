#!/usr/bin/env python3
"""Sync Zepp Life body measurements to Supabase, for every user with a
stored Zepp credential (see credentials.py). Each user's CloudSessionAdapter
is constructed directly from their decrypted app_token/huami_user_id/region —
no more global keyring shim, since there's no longer a single shared account.

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

from zepp_life_mcp.adapters.cloud_session import CloudSessionAdapter  # noqa: E402
from zepp_life_mcp.config import load_config  # noqa: E402
from zepp_life_mcp.services.query_service import QueryService  # noqa: E402
from zepp_life_mcp.services.sync_service import SyncService  # noqa: E402
from zepp_life_mcp.storage import Database  # noqa: E402

_cfg = load_config()
_db = Database(_cfg.database_path)


async def sync_user(user_id: str, app_token: str, huami_user_id: str, region: str) -> None:
    adapter = CloudSessionAdapter(app_token=app_token, user_id=huami_user_id, region=region)

    if not await adapter.connect():
        raise RuntimeError("Cannot connect to Zepp Life API — token may be expired")

    sync_svc = SyncService(adapter, _db)
    query_svc = QueryService(_db, huami_user_id)

    result = (
        supabase.table("zepp_body_composition")
        .select("measured_at")
        .eq("user_id", user_id)
        .order("measured_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        start_date = result.data[0]["measured_at"][:10]
    else:
        start_date = (datetime.date.today() - datetime.timedelta(days=90)).isoformat()
    end_date = datetime.date.today().isoformat()

    print(f"  Syncing {start_date} to {end_date}...")
    await sync_svc.sync_data_type("body_measurements", start_date=start_date, end_date=end_date)

    measurements = query_svc.get_body_measurements(start_date, end_date)
    print(f"  Got {len(measurements)} measurements from local DB")
    if not measurements:
        return

    existing = (
        supabase.table("zepp_body_composition")
        .select("date")
        .eq("user_id", user_id)
        .gte("date", start_date)
        .execute()
    )
    existing_dates = {r["date"] for r in (existing.data or [])}

    rows = []
    for m in measurements:
        measured_at = m.get("measured_at") or m.get("timestamp") or m.get("date")
        if not measured_at or str(measured_at)[:10] in existing_dates:
            continue
        rows.append({
            "user_id": user_id,
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

    if not rows:
        print("  no new measurements")
        return

    # Multiple measurements per day possible — keep latest per date before upsert
    rows_by_date: dict = {}
    for row in rows:
        d = row["date"]
        if d not in rows_by_date or (row["measured_at"] or "") > (rows_by_date[d]["measured_at"] or ""):
            rows_by_date[d] = row
    rows = list(rows_by_date.values())
    supabase.table("zepp_body_composition").upsert(rows, on_conflict="user_id,date").execute()
    print(f"  zepp_body_composition OK ({len(rows)} rows upserted)")


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
