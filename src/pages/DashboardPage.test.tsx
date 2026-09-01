import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

// ── Table-name-keyed Supabase mock ──────────────────────────────────────────
// DashboardPage fires several `.from(table)` calls inside one Promise.all
// (v_readiness_daily, v_week_comparison, v_daily_activity_heatmap) plus a
// `supabase.functions.invoke` call for the Weekly Coach panel. Keying the
// mock by table name (rather than call order, like the api/ handler mock in
// tests/helpers/mockSupabase.ts) keeps this robust regardless of which order
// the queries actually fire in.
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
  return {
    from,
    functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
  }
}

const mockUseAuth = vi.fn()
const mockUseTheme = vi.fn()
const mockUseCapabilities = vi.fn()
let supabaseMock: ReturnType<typeof makeSupabaseMock>

vi.mock('../lib/supabase', () => ({
  get supabase() {
    return supabaseMock
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => mockUseTheme() }))
vi.mock('../hooks/useCapabilities', () => ({ useCapabilities: () => mockUseCapabilities() }))

const USER = { id: 'user-1', email: 'slade@example.com' }

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  )
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: USER, session: {}, loading: false, signOut: vi.fn() })
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
    mockUseCapabilities.mockReturnValue({
      loading: false,
      isConnected: (s: string) => s === 'garmin',
      anyConnected: true,
      connectedSources: new Set(['garmin']),
    })
  })

  it('shows a loading indicator before the queries resolve', () => {
    supabaseMock = makeSupabaseMock({})
    // Override .then on every builder to never resolve, so we can inspect
    // the synchronous post-render DOM before the Promise.all settles.
    const originalFrom = supabaseMock.from
    supabaseMock.from = vi.fn((table: string) => {
      const builder = originalFrom(table) as Record<string, unknown>
      builder.then = () => new Promise(() => {})
      return builder
    })

    const { container } = renderPage()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })

  it('renders sensibly with all-empty/null data (no crash, no Infinity/NaN/undefined)', async () => {
    supabaseMock = makeSupabaseMock({
      v_readiness_daily: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
      v_week_comparison: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
      v_daily_activity_heatmap: { data: [], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    // Readiness block renders (garmin connected) with '--' placeholders.
    expect(screen.getByText('Body Battery')).toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
  })

  it('renders sensibly with typical data', async () => {
    supabaseMock = makeSupabaseMock({
      v_readiness_daily: {
        data: {
          date: '2026-08-30',
          user_id: USER.id,
          resting_hr: 52,
          last_7_days_avg_resting_hr: 51,
          avg_stress: 38,
          body_battery_highest: 82,
          body_battery_current: 20,
          sleep_hours: '7.4',
          sleep_deep_percent: '18',
          sleep_rem_percent: '22',
          bb_score: 80,
          stress_score: 70,
          heart_score: 75,
          activity_score: 60,
          sleep_score: '72',
          readiness_score: '74',
          readiness_signal: 'green',
        },
        error: null,
      },
      v_week_comparison: {
        data: {
          this_week: '2026-08-24',
          user_id: USER.id,
          avg_rhr: '52',
          avg_stress: '38',
          avg_sleep: '7.3',
          avg_bb_high: '80',
          run_count: 3,
          gym_count: 2,
          run_km: '18.5',
          total_vigorous_min: 95,
          total_moderate_min: 120,
          rhr_delta: '-1',
          stress_delta: '-2',
          sleep_delta: '0.3',
          bb_delta: '4',
          run_km_delta: '2.1',
        },
        error: null,
      },
      v_daily_activity_heatmap: {
        data: [
          { date: '2026-08-28', total_steps: 8000, vigorous_intensity_minutes: 20, active_calories: 400, activity_count: 1 },
          { date: '2026-08-29', total_steps: 6000, vigorous_intensity_minutes: 10, active_calories: 250, activity_count: 1 },
          { date: '2026-08-30', total_steps: 9000, vigorous_intensity_minutes: 30, active_calories: 500, activity_count: 2 },
        ],
        error: null,
      },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('82')).toBeInTheDocument() // body battery highest
    expect(screen.getByText('This week vs last week')).toBeInTheDocument()
    expect(screen.getByText('Activity Heatmap')).toBeInTheDocument()
  })

  it('shows a Garmin-connection prompt instead of the readiness block when garmin is not connected', async () => {
    mockUseCapabilities.mockReturnValue({
      loading: false,
      isConnected: () => false,
      anyConnected: false,
      connectedSources: new Set(),
    })
    supabaseMock = makeSupabaseMock({
      v_readiness_daily: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
      v_week_comparison: { data: null, error: { message: 'no rows', code: 'PGRST116' } },
      v_daily_activity_heatmap: { data: [], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Dashboard')).toBeInTheDocument())

    expect(screen.queryByText('Body Battery')).not.toBeInTheDocument()
    expect(screen.getByText(/needs a Garmin connection/)).toBeInTheDocument()
  })
})
