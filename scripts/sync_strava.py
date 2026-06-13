#!/usr/bin/env python3
"""Sync recent Strava activities to Supabase.

Fetches activities updated since the most recent record in strava_activities,
then upserts to strava_activities and strava_run_performance.

GitHub Secrets required:
  STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_USER_ID
"""

import os
import sys
import datetime
import requests

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]
CLIENT_ID = os.environ["STRAVA_CLIENT_ID"]
CLIENT_SECRET = os.environ["STRAVA_CLIENT_SECRET"]
REFRESH_TOKEN = os.environ["STRAVA_REFRESH_TOKEN"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
errors = []

print("Syncing Strava data...")


# ── OAuth token refresh ───────────────────────────────────────────────────────

def get_access_token():
    resp = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "refresh_token": REFRESH_TOKEN,
        "grant_type": "refresh_token",
    })
    resp.raise_for_status()
    return resp.json()["access_token"]


try:
    access_token = get_access_token()
    headers = {"Authorization": f"Bearer {access_token}"}
except Exception as e:
    print(f"Strava OAuth failed: {e}", file=sys.stderr)
    sys.exit(1)


# ── Determine sync window ─────────────────────────────────────────────────────

try:
    result = supabase.table("strava_activities") \
        .select("start_datetime") \
        .eq("user_id", USER_ID) \
        .order("start_datetime", desc=True) \
        .limit(1) \
        .execute()

    if result.data:
        last_dt = result.data[0]["start_datetime"]
        # Parse and add 1 second to avoid re-fetching the last record
        last_ts = int(datetime.datetime.fromisoformat(
            last_dt.replace("Z", "+00:00")
        ).timestamp()) + 1
    else:
        # No data yet — fetch last 90 days
        last_ts = int((datetime.datetime.utcnow() - datetime.timedelta(days=90)).timestamp())
except Exception as e:
    print(f"Could not determine sync window: {e}", file=sys.stderr)
    last_ts = int((datetime.datetime.utcnow() - datetime.timedelta(days=7)).timestamp())


# ── Fetch activities ──────────────────────────────────────────────────────────

def fetch_activities(after_ts):
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


try:
    activities = fetch_activities(last_ts)
    print(f"  Fetched {len(activities)} new activities")
except Exception as e:
    print(f"Strava fetch failed: {e}", file=sys.stderr)
    sys.exit(1)


# ── Upsert strava_activities ──────────────────────────────────────────────────

def sport_category(sport_type):
    mapping = {
        "Run": "running", "TrailRun": "running",
        "Walk": "walking", "Hike": "walking",
        "Ride": "cycling", "VirtualRide": "cycling",
        "Swim": "swimming",
        "Workout": "strength", "WeightTraining": "strength",
    }
    return mapping.get(sport_type, "other")


run_ids = []

try:
    rows = []
    for a in activities:
        sport = a.get("sport_type") or a.get("type", "")
        start_dt = a.get("start_date")  # UTC ISO string
        start_date = start_dt[:10] if start_dt else None

        rows.append({
            "id": a["id"],
            "user_id": USER_ID,
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
except Exception as e:
    errors.append(f"strava_activities: {e}")
    print(f"  strava_activities FAILED: {e}", file=sys.stderr)


# ── Upsert strava_run_performance ─────────────────────────────────────────────

def get_best_efforts(activity_id):
    resp = requests.get(
        f"https://www.strava.com/api/v3/activities/{activity_id}",
        headers=headers,
    )
    resp.raise_for_status()
    detail = resp.json()

    best = {}
    distance_map = {
        400: "best_400m",
        804: "best_half_mile",
        1000: "best_1k",
        1609: "best_1mile",
        3218: "best_2mile",
        5000: "best_5k",
        10000: "best_10k",
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


try:
    perf_rows = []
    for activity_id in run_ids:
        try:
            perf = get_best_efforts(activity_id)
            perf_rows.append({
                "activity_id": activity_id,
                "user_id": USER_ID,
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
        supabase.table("strava_run_performance").upsert(
            perf_rows, on_conflict="activity_id"
        ).execute()
        print(f"  strava_run_performance OK ({len(perf_rows)} runs)")
except Exception as e:
    errors.append(f"strava_run_performance: {e}")
    print(f"  strava_run_performance FAILED: {e}", file=sys.stderr)


# ── Exit ──────────────────────────────────────────────────────────────────────

if errors:
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)

print("Done.")
