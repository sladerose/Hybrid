#!/usr/bin/env python3
"""Sync recent Strava activities to Supabase, for every user with a stored
Strava credential (see credentials.py). Refresh-token rotation now writes
back to that user's user_credentials row instead of GitHub Secrets — there's
no single shared account anymore.

GitHub Secrets required:
  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET  (Hybrid's own OAuth app — shared
    across all users; only the refresh_token is per-user)
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import datetime
import os
import random
import sys
import time

import requests
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from credentials import get_active_users, mark_failed, mark_synced, update_payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_access_token(refresh_token: str) -> tuple[str, str]:
    """Returns (access_token, possibly-rotated refresh_token)."""
    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"], data.get("refresh_token", refresh_token)


def sport_category(sport_type):
    mapping = {
        "Run": "running", "TrailRun": "running",
        "Walk": "walking", "Hike": "walking",
        "Ride": "cycling", "VirtualRide": "cycling",
        "Swim": "swimming",
        "Workout": "strength", "WeightTraining": "strength",
    }
    return mapping.get(sport_type, "other")


def fetch_activities(headers, after_ts):
    activities = []
    page = 1
    while True:
        resp = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers=headers,
            params={"after": after_ts, "per_page": 100, "page": page},
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        activities.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return activities


def get_best_efforts(headers, activity_id):
    resp = requests.get(f"https://www.strava.com/api/v3/activities/{activity_id}", headers=headers)
    resp.raise_for_status()
    detail = resp.json()

    best = {}
    distance_map = {
        400: "best_400m", 804: "best_half_mile", 1000: "best_1k",
        1609: "best_1mile", 3218: "best_2mile", 5000: "best_5k", 10000: "best_10k",
    }
    for effort in detail.get("best_efforts", []):
        dist = effort.get("distance")
        if dist in distance_map:
            best[distance_map[dist]] = effort.get("elapsed_time")

    laps = []
    for i, lap in enumerate(detail.get("laps", []), 1):
        laps.append({
            "km": i,
            "time": lap.get("elapsed_time"),
            "avg_hr": lap.get("average_heartrate"),
            "max_hr": lap.get("max_heartrate"),
            "elev": lap.get("total_elevation_gain"),
        })

    return {
        "avg_hr": detail.get("average_heartrate"),
        "max_hr": detail.get("max_heartrate"),
        "avg_cadence": detail.get("average_cadence"),
        "calories": detail.get("calories"),
        "laps": laps,
        **best,
    }


def sync_user(user_id: str, refresh_token: str) -> None:
    access_token, new_refresh_token = get_access_token(refresh_token)
    if new_refresh_token != refresh_token:
        update_payload(user_id, "strava", {"refresh_token": new_refresh_token})
    headers = {"Authorization": f"Bearer {access_token}"}

    result = (
        supabase.table("strava_activities")
        .select("start_datetime")
        .eq("user_id", user_id)
        .order("start_datetime", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        last_dt = result.data[0]["start_datetime"]
        last_ts = int(datetime.datetime.fromisoformat(last_dt.replace("Z", "+00:00")).timestamp()) + 1
    else:
        last_ts = int((datetime.datetime.utcnow() - datetime.timedelta(days=90)).timestamp())

    activities = fetch_activities(headers, last_ts)
    print(f"  Fetched {len(activities)} new activities")

    run_ids = []
    rows = []
    for a in activities:
        sport = a.get("sport_type") or a.get("type", "")
        start_dt = a.get("start_date")
        start_date = start_dt[:10] if start_dt else None

        rows.append({
            "id": a["id"],
            "user_id": user_id,
            "name": a.get("name"),
            "sport_type": sport,
            "start_date": start_date,
            "start_datetime": start_dt,
            "duration_seconds": a.get("elapsed_time"),
            "distance_meters": a.get("distance"),
            "elevation_gain": a.get("total_elevation_gain"),
            "avg_speed": a.get("average_speed"),
            "max_speed": a.get("max_speed"),
            "avg_heart_rate": a.get("average_heartrate"),
            "max_heart_rate": a.get("max_heartrate"),
            "calories": a.get("calories"),
            "relative_effort": a.get("suffer_score"),
            "avg_cadence": a.get("average_cadence"),
            "pr_count": a.get("pr_count"),
            "achievement_count": a.get("achievement_count"),
            "kudos_count": a.get("kudos_count"),
            "gear_id": a.get("gear_id"),
            "sport_category": sport_category(sport),
            "workout_type": str(a.get("workout_type")) if a.get("workout_type") is not None else None,
            "synced_at": datetime.datetime.utcnow().isoformat(),
        })

        if sport in ("Run", "TrailRun"):
            run_ids.append(a["id"])

    if rows:
        supabase.table("strava_activities").upsert(rows, on_conflict="id").execute()
        print(f"  strava_activities OK ({len(rows)} upserted)")

    perf_rows = []
    for activity_id in run_ids:
        try:
            perf = get_best_efforts(headers, activity_id)
            perf_rows.append({
                "activity_id": activity_id,
                "user_id": user_id,
                "avg_hr": perf.get("avg_hr"),
                "max_hr": perf.get("max_hr"),
                "avg_cadence": perf.get("avg_cadence"),
                "calories": perf.get("calories"),
                "best_400m": perf.get("best_400m"),
                "best_half_mile": perf.get("best_half_mile"),
                "best_1k": perf.get("best_1k"),
                "best_1mile": perf.get("best_1mile"),
                "best_2mile": perf.get("best_2mile"),
                "best_5k": perf.get("best_5k"),
                "best_10k": perf.get("best_10k"),
                "laps": perf.get("laps"),
                "synced_at": datetime.datetime.utcnow().isoformat(),
            })
        except Exception as e:
            print(f"  run perf fetch failed for {activity_id}: {e}", file=sys.stderr)

    if perf_rows:
        supabase.table("strava_run_performance").upsert(perf_rows, on_conflict="activity_id").execute()
        print(f"  strava_run_performance OK ({len(perf_rows)} runs)")


def main() -> None:
    users = get_active_users("strava")
    print(f"Syncing Strava for {len(users)} user(s)...")
    failures = 0

    for i, cred in enumerate(users):
        print(f"[{cred.user_id}] syncing...")
        try:
            sync_user(cred.user_id, cred.payload["refresh_token"])
            mark_synced(cred.user_id, "strava", datetime.datetime.utcnow().isoformat())
        except Exception as e:
            failures += 1
            mark_failed(cred.user_id, "strava", str(e))
            print(f"  FAILED: {e}", file=sys.stderr)

        if i < len(users) - 1:
            time.sleep(random.uniform(2, 8))  # jitter — avoid bursting Strava/shared runner IP

    if users and failures == len(users):
        sys.exit(1)


if __name__ == "__main__":
    main()
