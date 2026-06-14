# Hybrid

Personal fitness analytics dashboard built for a single athlete. Unifies data from Garmin, Strava, and Zepp/Amazfit into one cross-signal view that no single platform exposes.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React, TypeScript, Tailwind CSS, Recharts |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Deployment | Vercel |
| Data sync | GitHub Actions (4x daily) |

## Pages

- `/dashboard` — Daily readiness: body battery, RHR, sleep, stress, steps, 270-day heatmap
- `/recovery` — RHR trend, sleep stages, stress, body battery, scatter correlations
- `/running` — Weekly volume, pace, lap breakdown, cadence trend, best efforts
- `/strength` — Session volume, exercise progression, muscle group balance
- `/body` — Weight, body fat %, muscle mass, visceral fat, metabolic age

## Data Sources

| Source | Transport | Tables |
|---|---|---|
| Garmin Connect | `garminconnect` Python lib | `garmin_daily`, `garmin_activities`, `garmin_weekly_stress` |
| Strava | OAuth REST API | `strava_activities`, `strava_run_performance` |
| Zepp Life (Amazfit scale) | `zepp-life-mcp` lib | `zepp_body_composition` |

## Sync

GitHub Actions workflow runs at 06:00, 12:00, 18:00, 00:00 SAST.

Scripts in `scripts/`:
- `sync_garmin.py` — previous day wellness + activities + weekly stress
- `sync_strava.py` — new activities since last sync, with lap + best effort detail
- `sync_zepp.py` — body composition measurements

Required secrets: `GARMIN_TOKENS_BASE64`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`, `ZEPP_APP_TOKEN`, `ZEPP_USER_ID`, `ZEPP_REGION`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_USER_ID`
