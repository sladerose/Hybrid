#!/usr/bin/env python3
"""Sync yesterday's Garmin data to Supabase.

Auth: reads GARMIN_REFRESH_TOKEN env var, writes a minimal garmin_tokens.json,
then lets garminconnect auto-refresh the access token on login. After login,
rotates the new refresh token back to GitHub Secrets via GH_TOKEN + GH_PAT.
"""

import os
import subprocess
import sys
import datetime
import json

from garminconnect import Garmin
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]
TOKEN_PATH = os.path.expanduser("~/.garminconnect")
GARMIN_CLIENT_ID = "GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2"

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _write_tokens_from_env() -> None:
    refresh_token = os.environ.get("GARMIN_REFRESH_TOKEN")
    if not refresh_token:
        return
    os.makedirs(TOKEN_PATH, exist_ok=True)
    tokens = {
        "di_token": "placeholder",
        "di_refresh_token": refresh_token,
        "di_client_id": GARMIN_CLIENT_ID,
    }
    with open(os.path.join(TOKEN_PATH, "garmin_tokens.json"), "w") as f:
        json.dump(tokens, f)


def _rotate_refresh_token() -> None:
    token_file = os.path.join(TOKEN_PATH, "garmin_tokens.json")
    try:
        with open(token_file) as f:
            new_tokens = json.load(f)
        new_refresh = new_tokens.get("di_refresh_token")
        repo = os.environ.get("GITHUB_REPOSITORY")
        if not (new_refresh and repo):
            return
        result = subprocess.run(
            ["gh", "secret", "set", "GARMIN_REFRESH_TOKEN",
             "--repo", repo, "--body", new_refresh],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            print("  Garmin refresh token rotated in GitHub Secrets")
        else:
            print(f"  WARNING: refresh token rotation failed: {result.stderr.strip()}", file=sys.stderr)
    except Exception as e:
        print(f"  WARNING: refresh token rotation error: {e}", file=sys.stderr)


_write_tokens_from_env()

client = Garmin()
client.login(TOKEN_PATH)

_rotate_refresh_token()

yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
errors = []

print(f"Syncing Garmin data for {yesterday}...")


# ── garmin_daily ─────────────────────────────────────────────────────────────

try:
    stats = client.get_stats(yesterday)
    sleep_raw = client.get_sleep_data(yesterday)

    sleep_dto = (sleep_raw or {}).get("dailySleepDTO", {})
    deep_s = sleep_dto.get("deepSleepSeconds") or 0
    light_s = sleep_dto.get("lightSleepSeconds") or 0
    rem_s = sleep_dto.get("remSleepSeconds") or 0
    awake_s = sleep_dto.get("awakeSleepSeconds") or 0
    total_s = deep_s + light_s + rem_s + awake_s

    def pct(part, total):
        return round(part / total * 100, 1) if total > 0 else None

    sleep_time_s = sleep_dto.get("sleepTimeSeconds")
    sleep_hours = round(sleep_time_s / 3600, 2) if sleep_time_s else None

    sleep_start_ms = sleep_dto.get("sleepStartTimestampGMT")
    sleep_start_time = (
        datetime.datetime.fromtimestamp(sleep_start_ms / 1000.0, tz=datetime.timezone.utc).isoformat()
        if sleep_start_ms
        else None
    )

    row = {
        "user_id": USER_ID,
        "date": yesterday,
        "total_steps": stats.get("totalSteps"),
        "step_goal": stats.get("dailyStepGoal"),
        "distance_meters": stats.get("totalDistanceMeters"),
        "total_calories": stats.get("totalKilocalories"),
        "active_calories": stats.get("activeKilocalories"),
        "bmr_calories": stats.get("bmrKilocalories"),
        "resting_hr": stats.get("restingHeartRate"),
        "min_hr": stats.get("minHeartRate"),
        "max_hr": stats.get("maxHeartRate"),
        "last_7_days_avg_resting_hr": stats.get("lastSevenDaysAvgRestingHeartRate"),
        "avg_stress": stats.get("averageStressLevel"),
        "max_stress": stats.get("maxStressLevel"),
        "stress_qualifier": stats.get("stressQualifier"),
        "body_battery_highest": stats.get("bodyBatteryHighestValue"),
        "body_battery_lowest": stats.get("bodyBatteryLowestValue"),
        "body_battery_charged": stats.get("bodyBatteryChargedValue"),
        "body_battery_drained": stats.get("bodyBatteryDrainedValue"),
        "body_battery_current": stats.get("bodyBatteryMostRecentValue"),
        "highly_active_seconds": stats.get("highlyActiveSeconds"),
        "active_seconds": stats.get("activeSeconds"),
        "sedentary_seconds": stats.get("sedentarySeconds"),
        "sleeping_seconds": stats.get("sleepingSeconds"),
        "moderate_intensity_minutes": stats.get("moderateIntensityMinutes"),
        "vigorous_intensity_minutes": stats.get("vigorousIntensityMinutes"),
        "avg_waking_respiration": stats.get("avgWakingRespirationValue"),
        "highest_respiration": stats.get("highestRespirationValue"),
        "lowest_respiration": stats.get("lowestRespirationValue"),
        "sleep_hours": sleep_hours,
        "sleep_deep_seconds": deep_s or None,
        "sleep_light_seconds": light_s or None,
        "sleep_rem_seconds": rem_s or None,
        "sleep_awake_seconds": awake_s or None,
        "sleep_deep_percent": pct(deep_s, total_s),
        "sleep_light_percent": pct(light_s, total_s),
        "sleep_rem_percent": pct(rem_s, total_s),
        "sleep_start_time": sleep_start_time,
        "synced_at": datetime.datetime.utcnow().isoformat(),
    }

    supabase.table("garmin_daily").upsert(row, on_conflict="user_id,date").execute()
    print(f"  garmin_daily OK")
except Exception as e:
    errors.append(f"garmin_daily: {e}")
    print(f"  garmin_daily FAILED: {e}", file=sys.stderr)


# ── garmin_activities ─────────────────────────────────────────────────────────

try:
    raw = client.get_activities_fordate(yesterday)
    activities = (raw or {}).get("ActivitiesForDay", {}).get("payload", [])
    if activities:
        rows = []
        for a in activities:
            atype = a.get("activityType", {})
            etype = a.get("eventType", {})
            rows.append({
                "id": a.get("activityId"),
                "user_id": USER_ID,
                "name": a.get("activityName"),
                "activity_type": atype.get("typeKey") if isinstance(atype, dict) else atype,
                "event_type": etype.get("typeKey") if isinstance(etype, dict) else etype,
                "start_time": a.get("startTimeGMT"),
                "start_date": yesterday,
                "duration_seconds": a.get("duration"),
                "distance_meters": a.get("distance"),
                "calories": a.get("calories"),
                "avg_hr_bpm": a.get("averageHR"),
                "max_hr_bpm": a.get("maxHR"),
                "steps": a.get("steps"),
                "elevation_gain_meters": a.get("elevationGain"),
                "elevation_loss_meters": a.get("elevationLoss"),
                "lap_count": a.get("lapCount"),
                "moderate_intensity_minutes": a.get("moderateIntensityMinutes"),
                "vigorous_intensity_minutes": a.get("vigorousIntensityMinutes"),
                "is_strength": atype.get("typeKey") == "other" if isinstance(atype, dict) else False,
                "synced_at": datetime.datetime.utcnow().isoformat(),
            })
        supabase.table("garmin_activities").upsert(rows, on_conflict="id").execute()
        print(f"  garmin_activities OK ({len(rows)} activities)")
    else:
        print(f"  garmin_activities: no activities for {yesterday}")
except Exception as e:
    errors.append(f"garmin_activities: {e}")
    print(f"  garmin_activities FAILED: {e}", file=sys.stderr)


# ── garmin_fitness_age ───────────────────────────────────────────────────────

try:
    fa = client.get_fitnessage_data(yesterday)
    if fa:
        dto = fa.get("biometricAgeDTO") or fa.get("fitnessAgeDTO") or (fa if isinstance(fa, dict) else {})
        components = dto.get("components") or {}

        fitness_age = dto.get("fitnessAge") or dto.get("biometricAge")
        chrono_age = dto.get("chronologicalAge")
        achievable = dto.get("achievableFitnessAge") or dto.get("achievableBiometricAge") or dto.get("bestFitnessAge")
        gap = dto.get("fitnessAgeGap") or dto.get("ageDifference") or (
            round(chrono_age - fitness_age, 1) if chrono_age and fitness_age else None
        )

        def _comp(key, field="value"):
            c = components.get(key) or {}
            return c.get(field) if isinstance(c, dict) else None

        row = {
            "user_id": USER_ID,
            "date": yesterday,
            "fitness_age": fitness_age,
            "chronological_age": chrono_age,
            "age_difference": gap,
            "achievable_fitness_age": achievable,
            "rhr": dto.get("rhr") or dto.get("restingHeartRate") or _comp("rhr"),
            "bmi": dto.get("bmi") or _comp("bmi"),
            "vigorous_minutes_avg": dto.get("vigorousMinutesAvg") or _comp("vigorousMinutesAvg"),
            "vigorous_days_avg": dto.get("vigorousDaysAvg") or _comp("vigorousDaysAvg"),
            "synced_at": datetime.datetime.utcnow().isoformat(),
        }

        # Check if row for this date already exists (table has no guaranteed unique constraint)
        existing = supabase.table("garmin_fitness_age") \
            .select("id") \
            .eq("user_id", USER_ID) \
            .eq("date", yesterday) \
            .execute()

        if existing.data:
            supabase.table("garmin_fitness_age") \
                .update(row) \
                .eq("id", existing.data[0]["id"]) \
                .execute()
        else:
            supabase.table("garmin_fitness_age").insert(row).execute()

        print(f"  garmin_fitness_age OK (age {fitness_age})")
    else:
        print(f"  garmin_fitness_age: no data for {yesterday}")
except Exception as e:
    errors.append(f"garmin_fitness_age: {e}")
    print(f"  garmin_fitness_age FAILED: {e}", file=sys.stderr)


# ── garmin_weekly_stress ──────────────────────────────────────────────────────

try:
    today = datetime.date.today().isoformat()
    weekly = client.get_weekly_stress(today, 52)
    if weekly:
        rows = []
        items = weekly if isinstance(weekly, list) else weekly.get("weeklyStress", [])
        for item in items:
            week_start = item.get("startTimestampGMT") or item.get("calendarDate")
            if week_start:
                rows.append({
                    "user_id": USER_ID,
                    "week_start": week_start[:10],
                    "stress_value": item.get("overallStressLevel") or item.get("stressLevel"),
                    "synced_at": datetime.datetime.utcnow().isoformat(),
                })
        if rows:
            supabase.table("garmin_weekly_stress").upsert(
                rows, on_conflict="user_id,week_start"
            ).execute()
            print(f"  garmin_weekly_stress OK ({len(rows)} weeks)")
except Exception as e:
    errors.append(f"garmin_weekly_stress: {e}")
    print(f"  garmin_weekly_stress FAILED: {e}", file=sys.stderr)


# ── blood_pressure_readings ──────────────────────────────────────────────────

try:
    bp = client.get_blood_pressure(yesterday, yesterday)
    summaries = (bp or {}).get("measurementSummaries", [])
    rows = []
    for day in summaries:
        for m in day.get("measurements", []):
            measured_at = m.get("measurementTimestampGMT")
            if not measured_at:
                continue
            rows.append({
                "user_id": USER_ID,
                "measured_at": measured_at,
                "measured_date": measured_at[:10],
                "systolic": m.get("systolic"),
                "diastolic": m.get("diastolic"),
                "pulse": m.get("pulse"),
                "source_type": m.get("sourceType"),
                "notes": m.get("notes"),
                "synced_at": datetime.datetime.utcnow().isoformat(),
            })
    if rows:
        supabase.table("blood_pressure_readings").upsert(
            rows, on_conflict="user_id,measured_at"
        ).execute()
        print(f"  blood_pressure_readings OK ({len(rows)} readings)")
    else:
        print(f"  blood_pressure_readings: no readings for {yesterday}")
except Exception as e:
    errors.append(f"blood_pressure_readings: {e}")
    print(f"  blood_pressure_readings FAILED: {e}", file=sys.stderr)


# ── Exit ──────────────────────────────────────────────────────────────────────

if errors:
    print(f"\n{len(errors)} error(s):")
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print("Done.")
