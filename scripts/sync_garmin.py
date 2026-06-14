#!/usr/bin/env python3
"""Sync yesterday's Garmin data to Supabase.

Auth: uses pre-generated tokens at ~/.garminconnect (no email/password needed).
Encode tokens for GitHub Actions: tar -czf - ~/.garminconnect | base64 -w 0
Store output as GARMIN_TOKENS_BASE64 secret. The workflow decodes before running this script.
"""

import os
import sys
import datetime
import json

from garminconnect import Garmin
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["SUPABASE_USER_ID"]
TOKEN_PATH = os.path.expanduser("~/.garminconnect")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

client = Garmin()
client.login(TOKEN_PATH)

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


# ── Exit ──────────────────────────────────────────────────────────────────────

if errors:
    print(f"\n{len(errors)} error(s):")
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)

print("Done.")
