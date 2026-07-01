#!/usr/bin/env python3
"""Sync Garmin data to Supabase for yesterday (finalized) and today (partial),
for every user with a stored Garmin credential (see credentials.py).

Garmin finalizes full-day totals (steps, stress, calories) only once the day
ends, so "yesterday" is the newest *complete* row. But sleep and resting HR
are keyed by wake-date and known the moment the user wakes up — syncing
"today" too means last night's sleep drives the readiness panel same-day
instead of sitting unused until tomorrow's run. Today's row is necessarily
partial and gets overwritten (upsert) as the day progresses and by
tomorrow's "yesterday" pass once finalized.

Auth: each user's stored payload is the exact {di_token, di_refresh_token,
di_client_id} shape garminconnect's Garmin.client.dumps() produces (see the
Garmin token-shape spike in connect_account.py's docstring). It's written to
a per-user temp tokenstore directory and loaded via Garmin().login(tokenstore=...)
— any refresh that happens during login is re-persisted back to that user's
user_credentials row afterward, replacing the old gh-secret-rotation dance.

GitHub Secrets required:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREDENTIAL_ENCRYPTION_KEY
"""

import datetime
import json
import os
import random
import sys
import tempfile
import time

from garminconnect import Garmin
from supabase import create_client

sys.path.insert(0, os.path.dirname(__file__))
from credentials import get_active_users, mark_failed, mark_synced, update_payload  # noqa: E402

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
today = datetime.date.today().isoformat()


def pct(part, total):
    return round(part / total * 100, 1) if total > 0 else None


def load_client(payload: dict) -> Garmin:
    with tempfile.TemporaryDirectory() as tmp:
        with open(os.path.join(tmp, "garmin_tokens.json"), "w") as f:
            json.dump(payload, f)
        client = Garmin()
        client.login(tokenstore=tmp)
    return client


def sync_daily(client: Garmin, user_id: str, date_str: str) -> None:
    stats = client.get_stats(date_str)
    sleep_raw = client.get_sleep_data(date_str)

    sleep_dto = (sleep_raw or {}).get("dailySleepDTO", {})
    deep_s = sleep_dto.get("deepSleepSeconds") or 0
    light_s = sleep_dto.get("lightSleepSeconds") or 0
    rem_s = sleep_dto.get("remSleepSeconds") or 0
    awake_s = sleep_dto.get("awakeSleepSeconds") or 0
    total_s = deep_s + light_s + rem_s + awake_s

    sleep_time_s = sleep_dto.get("sleepTimeSeconds")
    sleep_hours = round(sleep_time_s / 3600, 2) if sleep_time_s else None

    sleep_start_ms = sleep_dto.get("sleepStartTimestampGMT")
    sleep_start_time = (
        datetime.datetime.fromtimestamp(sleep_start_ms / 1000.0, tz=datetime.timezone.utc).isoformat()
        if sleep_start_ms
        else None
    )

    row = {
        "user_id": user_id,
        "date": date_str,
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


def sync_activities(client: Garmin, user_id: str, date_str: str) -> int:
    raw = client.get_activities_fordate(date_str)
    activities = (raw or {}).get("ActivitiesForDay", {}).get("payload", [])
    if not activities:
        return 0
    rows = []
    for a in activities:
        atype = a.get("activityType", {})
        etype = a.get("eventType", {})
        rows.append({
            "id": a.get("activityId"),
            "user_id": user_id,
            "name": a.get("activityName"),
            "activity_type": atype.get("typeKey") if isinstance(atype, dict) else atype,
            "event_type": etype.get("typeKey") if isinstance(etype, dict) else etype,
            "start_time": a.get("startTimeGMT"),
            "start_date": date_str,
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
    return len(rows)


def sync_bp(client: Garmin, user_id: str, date_str: str) -> int:
    bp = client.get_blood_pressure(date_str, date_str)
    summaries = (bp or {}).get("measurementSummaries", [])
    rows = []
    for day in summaries:
        for m in day.get("measurements", []):
            measured_at = m.get("measurementTimestampGMT")
            if not measured_at:
                continue
            rows.append({
                "user_id": user_id,
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
        supabase.table("blood_pressure_readings").upsert(rows, on_conflict="user_id,measured_at").execute()
    return len(rows)


def sync_fitness_age(client: Garmin, user_id: str) -> None:
    fa = client.get_fitnessage_data(yesterday)
    if not fa:
        print(f"  garmin_fitness_age: no data for {yesterday}")
        return

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
        "user_id": user_id,
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

    existing = (
        supabase.table("garmin_fitness_age")
        .select("id")
        .eq("user_id", user_id)
        .eq("date", yesterday)
        .execute()
    )
    if existing.data:
        supabase.table("garmin_fitness_age").update(row).eq("id", existing.data[0]["id"]).execute()
    else:
        supabase.table("garmin_fitness_age").insert(row).execute()

    print(f"  garmin_fitness_age OK (age {fitness_age})")


def sync_weekly_stress(client: Garmin, user_id: str) -> None:
    weekly = client.get_weekly_stress(today, 52)
    if not weekly:
        return
    rows = []
    items = weekly if isinstance(weekly, list) else weekly.get("weeklyStress", [])
    for item in items:
        week_start = item.get("startTimestampGMT") or item.get("calendarDate")
        if week_start:
            rows.append({
                "user_id": user_id,
                "week_start": week_start[:10],
                "stress_value": item.get("overallStressLevel") or item.get("stressLevel"),
                "synced_at": datetime.datetime.utcnow().isoformat(),
            })
    if rows:
        supabase.table("garmin_weekly_stress").upsert(rows, on_conflict="user_id,week_start").execute()
        print(f"  garmin_weekly_stress OK ({len(rows)} weeks)")


def sync_user(user_id: str, payload: dict) -> None:
    client = load_client(payload)

    for date_str in (yesterday, today):
        sync_daily(client, user_id, date_str)
        print(f"  garmin_daily OK ({date_str})")

        count = sync_activities(client, user_id, date_str)
        print(f"  garmin_activities OK ({date_str}, {count} activities)")

        count = sync_bp(client, user_id, date_str)
        print(f"  blood_pressure_readings OK ({date_str}, {count} readings)")

    sync_fitness_age(client, user_id)
    sync_weekly_stress(client, user_id)

    # Persist any token rotation that happened during login/refresh.
    update_payload(user_id, "garmin", json.loads(client.client.dumps()))


def main() -> None:
    users = get_active_users("garmin")
    print(f"Syncing Garmin for {len(users)} user(s), {yesterday} (finalized) and {today} (partial)...")
    failures = 0

    for i, cred in enumerate(users):
        print(f"[{cred.user_id}] syncing...")
        try:
            sync_user(cred.user_id, cred.payload)
            mark_synced(cred.user_id, "garmin", datetime.datetime.utcnow().isoformat())
        except Exception as e:
            failures += 1
            mark_failed(cred.user_id, "garmin", str(e))
            print(f"  FAILED: {e}", file=sys.stderr)

        if i < len(users) - 1:
            time.sleep(random.uniform(2, 8))  # jitter — avoid bursting Garmin's rate limiter

    if users and failures == len(users):
        sys.exit(1)


if __name__ == "__main__":
    main()
