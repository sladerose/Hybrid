import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BodyPage from './BodyPage'

// See DashboardPage.test.tsx for the rationale behind a table-name-keyed
// Supabase mock.
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
  zepp_body_composition: { data: [], error: null },
  garmin_fitness_age: { data: [], error: null },
}

describe('BodyPage', () => {
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

    const { container } = render(<BodyPage />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Body Composition')).not.toBeInTheDocument()
  })

  // This is the exact regression class the codebase already hit once:
  // WeightTrendChart used to run Math.min(...[])/Math.max(...[]) on a zero-row
  // account, producing Infinity/-Infinity as a chart axis domain (fixed
  // 2 Jul 2026). This test locks in that fix and the sibling charts' guards.
  it('renders sensibly with zero rows (no crash, no Infinity/NaN/undefined)', async () => {
    supabaseMock = makeSupabaseMock(EMPTY_TABLES)

    render(<BodyPage />)

    await waitFor(() => expect(screen.getByText('Body Composition')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    // WeightTrendChart, BodyFatChart, MuscleMassChart, VisceralFatChart, and
    // FitnessAgeSection all `return null` on empty data -- none of their
    // chart-specific subtitles (distinct from the always-present KPI card
    // labels, which share the same words) should be present.
    expect(screen.queryByText('Weight Trend')).not.toBeInTheDocument()
    expect(screen.queryByText('% over time')).not.toBeInTheDocument()
    expect(screen.queryByText('kg over time')).not.toBeInTheDocument()
    expect(screen.queryByText('Visceral Fat Score')).not.toBeInTheDocument()
    expect(screen.queryByText(/Garmin fitness age vs chronological/)).not.toBeInTheDocument()
    expect(screen.queryByText('Latest Reading')).not.toBeInTheDocument()
    // KPI cards fall back to '--'.
    expect(screen.getByText('Weight')).toBeInTheDocument()
    expect(screen.getAllByText('--').length).toBeGreaterThan(0)
  })

  it('renders sensibly with typical data', async () => {
    const bodyRow = {
      date: '2026-08-28',
      weight_kg: '82.4',
      bmi: '24.1',
      body_fat_percent: '17.5',
      muscle_mass_kg: '38.2',
      bone_mass_kg: '3.4',
      hydration_percent: '58.2',
      visceral_fat: '8',
      visceral_fat_rating: 1,
      metabolic_age: 29,
      physique_rating: 5,
      basal_metabolic_rate: 1800,
    }
    supabaseMock = makeSupabaseMock({
      zepp_body_composition: {
        data: [bodyRow, { ...bodyRow, date: '2026-08-29', weight_kg: '82.1' }, { ...bodyRow, date: '2026-08-30', weight_kg: '81.9' }],
        error: null,
      },
      garmin_fitness_age: {
        data: [
          { date: '2026-06-10', fitness_age: 28, chronological_age: 34, achievable_fitness_age: 25 },
          { date: '2026-07-10', fitness_age: 27, chronological_age: 34, achievable_fitness_age: 25 },
        ],
        error: null,
      },
    })

    render(<BodyPage />)

    await waitFor(() => expect(screen.getByText('Body Composition')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('Weight Trend')).toBeInTheDocument()
    expect(screen.getAllByText('Body Fat').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Muscle Mass').length).toBeGreaterThan(0)
    expect(screen.getByText('Visceral Fat Score')).toBeInTheDocument()
    expect(screen.getAllByText('Fitness Age').length).toBeGreaterThan(0)
    expect(screen.getByText('Latest Reading')).toBeInTheDocument()
    expect(screen.getByText('Weight').closest('div')).toHaveTextContent('81.9')
  })
})
