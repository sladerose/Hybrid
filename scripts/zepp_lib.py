"""Shared Zepp per-user sync primitives, used by both sync_zepp.py (recurring,
every user, every cron run) and backfill_zepp.py (explicit date range, one
user) — same split as garmin_lib.py, so the row shapes for
zepp_body_composition / zepp_daily / zepp_workouts only exist in one place.

Unlike Garmin (one date at a time via client.get_stats(date_str)), Zepp's
QueryService takes a date range directly, so there's no per-day loop here —
each sync_* call covers [start_date, end_date] in one shot.

Field names below (steps, distance_m, active_kcal, stage/minutes, workout_id
as a string, etc.) are read directly from zepp_life_mcp's QueryService and
Pydantic models on GitHub (kubulashvili/zepp-life-mcp), not guessed from the
MCP tool docstrings in mcps/zepp/server.py — the docstrings describe the
public tool surface, not the actual dict keys QueryService returns.
"""

import datetime


def pct(part, total):
    return round(part / total * 100, 1) if total else None


async def connect(app_token: str, huami_user_id: str, region: str, db):
    from zepp_life_mcp.adapters.cloud_session import CloudSessionAdapter
    from zepp_life_mcp.services.query_service import QueryService
    from zepp_life_mcp.services.sync_service import SyncService

    adapter = CloudSessionAdapter(app_token=app_token, user_id=huami_user_id, region=region)
    if not await adapter.connect():
        raise RuntimeError("Cannot connect to Zepp Life API — token may be expired")
    sync_svc = SyncService(adapter, db)
    query_svc = QueryService(db, huami_user_id)
    return sync_svc, query_svc


async def sync_body_comp(supabase, sync_svc, query_svc, user_id: str, start_date: str, end_date: str) -> int:
    """Xiaomi Mi Body Composition Scale readings, via the same Huami account."""
    await sync_svc.sync_data_type("body_measurements", start_date=start_date, end_date=end_date)
    measurements = query_svc.get_body_measurements(start_date, end_date)
    if not measurements:
        return 0

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
        ts = m.get("timestamp")
        if not ts or str(ts)[:10] in existing_dates:
            continue
        rows.append({
            "user_id": user_id,
            "date": str(ts)[:10],
            "measured_at": ts,
            "weight_kg": m.get("weight_kg"),
            "bmi": m.get("bmi"),
            "body_fat_percent": m.get("body_fat_pct"),
            "muscle_mass_kg": m.get("muscle_mass_kg"),
            "bone_mass_kg": m.get("bone_mass_kg"),
            "hydration_percent": m.get("water_pct"),
            "visceral_fat": m.get("visceral_fat_score"),
            "metabolic_age": m.get("metabolic_age"),
            "basal_metabolic_rate": m.get("basal_metabolism_kcal"),
            "synced_at": datetime.datetime.utcnow().isoformat(),
        })
    if not rows:
        return 0

    # Multiple measurements per day possible — keep latest per date before upsert
    rows_by_date: dict = {}
    for row in rows:
        d = row["date"]
        if d not in rows_by_date or (row["measured_at"] or "") > (rows_by_date[d]["measured_at"] or ""):
            rows_by_date[d] = row
    rows = list(rows_by_date.values())
    supabase.table("zepp_body_composition").upsert(rows, on_conflict="user_id,date").execute()
    return len(rows)


async def sync_daily(supabase, sync_svc, query_svc, user_id: str, start_date: str, end_date: str) -> int:
    """Steps/calories/distance (daily_activity) + sleep stages + resting HR,
    merged into one zepp_daily row per date.

    A sleep session is attributed to the date it ends on (wake-up date) —
    same convention Garmin's get_sleep_data(date_str) uses. Resting HR is
    the day's minimum sample tagged sample_type='resting' — the closest
    available proxy to Garmin's computed dailyRestingHeartRate; Zepp has no
    equivalent pre-computed field, so this can be NULL on days with no
    resting-tagged samples rather than a fabricated value.
    """
    await sync_svc.sync_data_type("daily_activity", start_date=start_date, end_date=end_date)
    await sync_svc.sync_data_type("sleep", start_date=start_date, end_date=end_date)
    await sync_svc.sync_data_type("heart_rate", start_date=start_date, end_date=end_date)

    summaries = query_svc.get_daily_summaries(start_date, end_date)
    sleep_sessions = query_svc.get_sleep_sessions(start_date, end_date, include_naps=False)
    hr_samples = query_svc.get_heart_rate_samples(start_date, end_date, sample_type="resting")

    sleep_by_date: dict = {}
    for s in sleep_sessions:
        end_at = s.get("end_at")
        if not end_at:
            continue
        d = str(end_at)[:10]
        # If more than one non-nap session ends on the same date, keep the longest.
        if d not in sleep_by_date or (s.get("duration_minutes") or 0) > (sleep_by_date[d].get("duration_minutes") or 0):
            sleep_by_date[d] = s

    resting_hr_by_date: dict = {}
    for hr in hr_samples:
        ts, bpm = hr.get("timestamp"), hr.get("bpm")
        if not ts or bpm is None:
            continue
        d = str(ts)[:10]
        if d not in resting_hr_by_date or bpm < resting_hr_by_date[d]:
            resting_hr_by_date[d] = bpm

    rows = []
    for s in summaries:
        d = s.get("date")
        if not d:
            continue
        sleep = sleep_by_date.get(d, {})
        stage_minutes = {st["stage"]: st["minutes"] for st in (sleep.get("stages") or [])}
        deep_m = stage_minutes.get("deep", 0)
        light_m = stage_minutes.get("light", 0)
        rem_m = stage_minutes.get("rem", 0)
        awake_m = stage_minutes.get("awake", 0)
        total_m = deep_m + light_m + rem_m + awake_m
        time_asleep = sleep.get("time_asleep_minutes")

        rows.append({
            "user_id": user_id,
            "date": d,
            "total_steps": s.get("steps"),
            "distance_meters": s.get("distance_m"),
            "active_calories": s.get("active_kcal"),
            "total_calories": s.get("total_kcal"),
            "resting_hr": resting_hr_by_date.get(d),
            "sleep_hours": round(time_asleep / 60, 2) if time_asleep else None,
            "sleep_deep_seconds": (deep_m * 60) or None,
            "sleep_light_seconds": (light_m * 60) or None,
            "sleep_rem_seconds": (rem_m * 60) or None,
            "sleep_awake_seconds": (awake_m * 60) or None,
            "sleep_deep_percent": pct(deep_m, total_m),
            "sleep_light_percent": pct(light_m, total_m),
            "sleep_rem_percent": pct(rem_m, total_m),
            "synced_at": datetime.datetime.utcnow().isoformat(),
        })

    if not rows:
        return 0
    supabase.table("zepp_daily").upsert(rows, on_conflict="user_id,date").execute()
    return len(rows)


async def sync_workouts(supabase, sync_svc, query_svc, user_id: str, start_date: str, end_date: str) -> int:
    """Workout sessions. id is text — zepp_life_mcp's workout_id is a string,
    not numeric like Garmin's activityId (confirmed against the library's
    Workout model)."""
    await sync_svc.sync_data_type("workouts", start_date=start_date, end_date=end_date)
    workouts = query_svc.get_workouts(start_date, end_date)
    if not workouts:
        return 0

    rows = []
    for w in workouts:
        workout_id, start_at = w.get("workout_id"), w.get("start_at")
        if not workout_id or not start_at:
            continue
        duration_min = w.get("duration_minutes")
        rows.append({
            "id": str(workout_id),
            "user_id": user_id,
            "name": w.get("activity_type"),
            "activity_type": w.get("activity_type"),
            "start_time": start_at,
            "start_date": str(start_at)[:10],
            "duration_seconds": duration_min * 60 if duration_min is not None else None,
            "distance_meters": w.get("distance_m"),
            "calories": w.get("calories_kcal"),
            "avg_hr_bpm": w.get("avg_heart_rate_bpm"),
            "max_hr_bpm": w.get("max_heart_rate_bpm"),
            "synced_at": datetime.datetime.utcnow().isoformat(),
        })
    if not rows:
        return 0
    supabase.table("zepp_workouts").upsert(rows, on_conflict="id").execute()
    return len(rows)
