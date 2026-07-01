# Hybrid

Fitness analytics dashboard unifying Garmin, Strava, and Zepp/Amazfit into one
cross-signal view that no single platform exposes. Multi-user backend live as
of 1 Jul 2026 — each user connects their own accounts via `/settings`.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React, TypeScript, Tailwind CSS, Recharts |
| 3D | Three.js / React Three Fiber + drei (muscle-group body model) |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (email/password, `AuthContext` + `ProtectedRoute`) |
| PWA | `vite-plugin-pwa` — installable, offline-capable, auto-update |
| Deployment | Vercel |
| Data sync | GitHub Actions (4x daily) |

## Local Development

```
npm install
npm run dev
```

Requires `.env.local`:

```
VITE_SUPABASE_URL=https://oiiznhwhjcowapxkxpyz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

## Pages

- `/dashboard` — Daily readiness: body battery, RHR, sleep, stress, steps, 270-day heatmap
- `/recovery` — RHR trend, sleep stages, stress, body battery, blood pressure, scatter correlations
- `/running` — Weekly volume, pace, lap breakdown, cadence trend, best efforts
- `/strength` — Session volume, exercise progression, muscle group balance
- `/body` — Weight, body fat %, muscle mass, visceral fat, metabolic age, 3D muscle-group model
- `/settings` — Connect/disconnect Garmin, Strava, Zepp; per-source status + last synced
- `/login` — Supabase Auth sign-in (protects all other routes)

## Data Sources

| Source | Transport | Tables |
|---|---|---|
| Garmin Connect | `garminconnect` Python lib | `garmin_daily`, `garmin_activities`, `garmin_weekly_stress`, `blood_pressure_readings` |
| Strava | OAuth REST API | `strava_activities`, `strava_run_performance` |
| Zepp Life (Amazfit scale) | Huami cloud API (ported login logic, no `zepp-life-mcp` dependency in the connect flow) | `zepp_body_composition` |

Credentials are per-user, not global secrets — see "Connecting an account" below.

## Connecting an account

Each user connects their own Garmin/Strava/Zepp accounts from `/settings`:

- **Strava** — standard OAuth redirect (`api/strava-init.ts` → Strava → `api/strava-callback.ts`). No password ever touches the app; works regardless of how the user originally signed up with Strava (Google/Apple/Facebook/native).
- **Garmin / Zepp** — password-based. The password never runs through a public-facing function: `api/connect-init.ts` encrypts it into a short-lived `pending_logins` row and triggers the `connect.yml` GitHub Actions workflow (`workflow_dispatch`, no secret material in the dispatch call itself), which runs `scripts/connect_account.py` to do the real login, then deletes the pending row regardless of outcome. The frontend polls `connection_status` until it flips to `connected`/`needs_reauth`.
- **Known limitation:** Garmin/Zepp accounts created via "Sign in with Google/Apple/Facebook" have no password these unofficial APIs can use — a hard wall, not a bug. The connect modal says so.

Credentials live in `user_credentials` (AES-256-GCM encrypted, zero RLS policies —
service_role only); `connection_status` is the safe, owner-readable status table
the settings page queries.

## Sync

GitHub Actions workflow (`sync.yml`) runs at 06:00, 12:00, 18:00, 00:00 SAST,
looping over every user with a stored credential for each source (not one
hardcoded account).

Scripts in `scripts/`:
- `sync_garmin.py` — per-user: previous day wellness + activities + weekly stress + blood pressure
- `sync_strava.py` — per-user: new activities since last sync, with lap + best effort detail
- `sync_zepp.py` — per-user: body composition measurements
- `credentials.py` — shared helper: loads/decrypts active users per source, writes back rotated tokens and sync status
- `crypto_utils.py` — AES-256-GCM encrypt/decrypt (must stay byte-compatible with `api/_lib/crypto.ts`)
- `connect_account.py` — the one-shot connect handshake, run by `connect.yml` via `workflow_dispatch`

Required secrets (GitHub Actions): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`CREDENTIAL_ENCRYPTION_KEY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`.

Required env vars (Vercel, all environments): the above plus `STATE_SIGNING_SECRET`,
`STRAVA_REDIRECT_URI`, `APP_URL`, `GITHUB_REPOSITORY`, `GH_PAT` (currently reusing
a personal `gh auth token` — see plan doc for the tradeoff).

`CREDENTIAL_ENCRYPTION_KEY` must be identical in both places — a mismatch after
rotation breaks decryption silently (looks like credential expiry, not a key issue).
