import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import RecoveryPage from './RecoveryPage'

// See DashboardPage.test.tsx for the rationale behind a table-name-keyed
// Supabase mock (RecoveryPage fires 7 different `.from(table)` calls inside
// one Promise.all).
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
  v_recovery_trend: { data: [], error: null },
  v_sleep_quality: { data: [], error: null },
  v_correlations: { data: [], error: null },
  garmin_weekly_stress: { data: [], error: null },
  v_run_load_recovery: { data: [], error: null },
  garmin_daily: { data: [], error: null },
  v_blood_pressure_daily: { data: [], error: null },
}

describe('RecoveryPage', () => {
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

    const { container } = render(<RecoveryPage />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Recovery')).not.toBeInTheDocument()
  })

  it('renders sensibly with all-empty data (no crash, no Infinity/NaN/undefined)', async () => {
    supabaseMock = makeSupabaseMock(EMPTY_TABLES)

    render(<RecoveryPage />)

    await waitFor(() => expect(screen.getByText('Recovery')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    // Blood pressure / respiration / run-recovery-cost blocks are gated on
    // length > 0 and shouldn't render at all with zero rows.
    expect(screen.queryByText('Blood Pressure')).not.toBeInTheDocument()
    expect(screen.queryByText('Waking Respiration')).not.toBeInTheDocument()
    expect(screen.queryByText('Run Recovery Cost')).not.toBeInTheDocument()
    // Scatter panels render their "need more data" placeholder instead of a broken chart.
    expect(screen.getAllByText('Need more data').length).toBeGreaterThan(0)
    // 30-night average stats fall back to '--'.
    expect(screen.getByText('30-Night Average')).toBeInTheDocument()
  })

  it('renders sensibly with typical data', async () => {
    const trendRow = {
      date: '2026-08-30',
      resting_hr: 52,
      avg_stress: 38,
      body_battery_highest: 80,
      sleep_hours: '7.5',
      rhr_7d_avg: '51',
      stress_7d_avg: '36',
      sleep_7d_avg: '7.2',
      bb_high_7d_avg: '78',
    }
    supabaseMock = makeSupabaseMock({
      v_recovery_trend: { data: [trendRow, { ...trendRow, date: '2026-08-29' }], error: null },
      v_sleep_quality: {
        data: [
          {
            date: '2026-08-30',
            sleep_hours: '7.5',
            sleep_deep_seconds: 5400,
            sleep_light_seconds: 14400,
            sleep_rem_seconds: 5400,
            sleep_awake_seconds: 600,
            sleep_deep_percent: '18',
            sleep_rem_percent: '20',
          },
        ],
        error: null,
      },
      v_correlations: {
        data: Array.from({ length: 6 }, (_, i) => ({
          date: `2026-08-${20 + i}`,
          sleep_hours: '7.2',
          avg_stress: 38,
          resting_hr: 52,
          next_bb_high: 78,
          week_vigorous_total: 100,
          week_avg_bb_high: '75',
          avg_systolic: '118',
          avg_diastolic: '76',
        })),
        error: null,
      },
      garmin_weekly_stress: {
        data: [{ week_start: '2026-08-24', stress_value: 40 }],
        error: null,
      },
      v_run_load_recovery: {
        data: [
          {
            run_date: '2026-08-28',
            name: 'Morning Run',
            distance_km: '5.2',
            relative_effort: 60,
            sleep_night_before: '7.1',
            bb_peak_day_of_run: 80,
            next_day_bb_peak: 75,
            next_day_rhr: 51,
            rhr_day_of_run: 52,
            bb_impact: -5,
            rhr_impact: -1,
          },
        ],
        error: null,
      },
      garmin_daily: {
        data: [{ date: '2026-08-30', avg_waking_respiration: '15.2', highest_respiration: '18', lowest_respiration: '13' }],
        error: null,
      },
      v_blood_pressure_daily: {
        data: [
          {
            date: '2026-08-30',
            num_measurements: 3,
            high_systolic: 122,
            low_systolic: 114,
            avg_systolic: '118',
            high_diastolic: 80,
            low_diastolic: 72,
            avg_diastolic: '76',
            avg_pulse: '62',
            category: 'NORMAL',
          },
        ],
        error: null,
      },
    })

    render(<RecoveryPage />)

    await waitFor(() => expect(screen.getByText('Recovery')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('Blood Pressure')).toBeInTheDocument()
    expect(screen.getByText('Latest Reading')).toBeInTheDocument()
    expect(screen.getByText('118/76')).toBeInTheDocument()
    expect(screen.getByText('Normal')).toBeInTheDocument()
    expect(screen.getByText('Waking Respiration')).toBeInTheDocument()
    expect(screen.getByText('Run Recovery Cost')).toBeInTheDocument()
  })
})
