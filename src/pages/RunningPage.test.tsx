import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RunningPage from './RunningPage'

// See DashboardPage.test.tsx for the rationale behind a table-name-keyed
// Supabase mock. RunningPage itself fires 5 `.from(table)` calls in one
// Promise.all; its child <TrainingPlanPanel> fires 1-2 more (training_plans,
// then conditionally training_plan_days) from a separate effect. Keying by
// table name sidesteps having to reason about cross-effect call ordering.
type TableResult = { data: unknown; error?: { message: string; code?: string } | null }

function makeSupabaseMock(tables: Record<string, TableResult>) {
  const from = vi.fn((table: string) => {
    const result: TableResult = tables[table] ?? { data: null, error: null }
    const builder: Record<string, unknown> = {}
    const chain = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
      'is', 'in', 'or', 'filter', 'match', 'order', 'limit', 'range', 'not',
    ]
    chain.forEach((m) => { builder[m] = vi.fn(() => builder) })
    builder.single = vi.fn(() => Promise.resolve(result))
    builder.maybeSingle = vi.fn(() => Promise.resolve(result))
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject)
    builder.catch = (reject: (e: unknown) => unknown) => Promise.resolve(result).catch(reject)
    return builder
  })
  return { from }
}

const mockUseAuth = vi.fn()
const mockUseTheme = vi.fn()
let supabaseMock: ReturnType<typeof makeSupabaseMock>

vi.mock('../lib/supabase', () => ({
  get supabase() {
    return supabaseMock
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => mockUseTheme() }))

const USER = { id: 'user-1', email: 'slade@example.com' }

const EMPTY_TABLES: Record<string, TableResult> = {
  v_run_performance: { data: [], error: null },
  v_weekly_training: { data: [], error: null },
  strava_gear: { data: [], error: null },
  strava_zones: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
  strava_activities: { data: [], error: null },
  training_plans: { data: [], error: null },
}

describe('RunningPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: USER, session: {}, loading: false, signOut: vi.fn() })
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
  })

  it('shows a loading indicator before the queries resolve', () => {
    supabaseMock = makeSupabaseMock(EMPTY_TABLES)
    const originalFrom = supabaseMock.from
    supabaseMock.from = vi.fn((table: string) => {
      const builder = originalFrom(table) as Record<string, unknown>
      builder.then = () => new Promise(() => {})
      return builder
    })

    const { container } = render(<RunningPage />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })

  it('renders sensibly with all-empty data (no crash, no Infinity/NaN/undefined)', async () => {
    supabaseMock = makeSupabaseMock(EMPTY_TABLES)

    render(<RunningPage />)

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())
    // Training plan panel resolves its own separate fetch.
    await waitFor(() => expect(screen.getByText('No training plan set.')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('No run data')).toBeInTheDocument()
    expect(screen.getByText('No 5k data')).toBeInTheDocument()
    expect(screen.getByText('No cadence data')).toBeInTheDocument()
    // KPI cards fall back to '--' rather than 0/NaN.
    const totalRunsCard = screen.getByText('Total Runs').closest('div')!
    expect(totalRunsCard).toHaveTextContent('0')
    // Zones absent -> HR zone / efficiency charts don't render at all.
    expect(screen.queryByText('HR Zone Distribution')).not.toBeInTheDocument()
    // No runs with laps -> lap breakdown card absent entirely (gated by `latestRunWithLaps &&`).
    expect(screen.queryByText('Lap Breakdown')).not.toBeInTheDocument()
  })

  it('renders sensibly with typical data', async () => {
    const runRow = {
      activity_id: 1,
      start_date: '2026-08-30',
      name: 'Morning Run',
      distance_km: '5.2',
      duration_seconds: 1600,
      pace_sec_per_km: '308',
      pace_formatted: '5:08',
      elevation_gain: 40,
      relative_effort: 55,
      avg_hr: 150,
      cadence_precise: '82',
      best_1k: 300,
      best_5k: 1550,
      best_10k: null,
      laps: [
        { km: 1, time: 300, avg_hr: 148 },
        { km: 2, time: 305, avg_hr: 152 },
      ],
    }
    supabaseMock = makeSupabaseMock({
      v_run_performance: { data: [runRow, { ...runRow, activity_id: 2, laps: null, best_5k: 1600 }], error: null },
      v_weekly_training: {
        data: [
          { week_start: '2026-08-24', run_count: 2, run_km: '10.4', avg_run_hr: '150', avg_run_cadence: '82', run_elevation_gain: 80, workout_count: 1, avg_relative_effort: '55' },
        ],
        error: null,
      },
      strava_gear: {
        data: [{ id: 'g1', gear_type: 'shoes', name: 'Pegasus', brand: 'Nike', model_name: '40', retired: false, total_distance_meters: '250000' }],
        error: null,
      },
      strava_zones: {
        data: {
          hr_z1_max: 120, hr_z2_min: 121, hr_z2_max: 140, hr_z3_min: 141, hr_z3_max: 160,
          hr_z4_min: 161, hr_z4_max: 175, hr_z5_min: 176,
          run_z1_max: '360', run_z2_max: '330', run_z3_max: '300', run_z4_max: '270', run_z5_max: '240',
        },
        error: null,
      },
      strava_activities: {
        data: [
          { id: 1, sport_type: 'Run', start_date: '2026-08-30', relative_effort: 55, duration_seconds: 1600 },
          { id: 2, sport_type: 'Workout', start_date: '2026-08-29', relative_effort: 30, duration_seconds: 2400 },
        ],
        error: null,
      },
      training_plans: {
        data: [
          {
            id: 10, user_id: USER.id, name: '10km Build', goal_type: 'race', target_date: '2026-10-01',
            target_distance_km: 10, target_time_seconds: null, location: 'Durban', start_date: '2026-08-01',
            is_active: true, created_at: '2026-08-01T00:00:00Z',
          },
        ],
        error: null,
      },
      training_plan_days: {
        data: [
          { id: 1, plan_id: 10, date: '2026-08-03', workout_type: 'easy', label: 'Easy', distance_km: 5, description: null, phase: 'Base' },
          { id: 2, plan_id: 10, date: '2026-08-04', workout_type: 'rest', label: 'Rest', distance_km: 0, description: null, phase: 'Base' },
        ],
        error: null,
      },
    })

    render(<RunningPage />)

    await waitFor(() => expect(screen.getByText('Running')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('10km Build')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    const totalRunsCard = screen.getByText('Total Runs').closest('div')!
    expect(totalRunsCard).toHaveTextContent('2')
    expect(screen.getByText('Weekly Run Volume')).toBeInTheDocument()
    expect(screen.getByText('HR Zone Distribution')).toBeInTheDocument()
    expect(screen.getByText('Lap Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Recent Runs')).toBeInTheDocument()
    expect(screen.getByText('Running Gear')).toBeInTheDocument()
  })
})
