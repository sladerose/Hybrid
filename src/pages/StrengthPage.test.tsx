import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import StrengthPage from './StrengthPage'

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

// BodyModel3D renders a react-three-fiber <Canvas> (WebGL), which jsdom
// doesn't implement. It's out of scope here (owned by neither this pass nor
// the parallel shared/ effort) — stub it so StrengthPage tests exercise
// StrengthPage's own logic without depending on a 3D renderer jsdom can't
// support.
vi.mock('../components/BodyModel3D', () => ({
  BodyModel3D: ({ exerciseData }: { exerciseData: unknown[] }) => (
    <div data-testid="body-model-3d-stub">{exerciseData.length} exercise rows</div>
  ),
}))

const USER = { id: 'user-1', email: 'slade@example.com' }

const EMPTY_TABLES: Record<string, TableResult> = {
  v_strength_sessions: { data: [], error: null },
  v_exercise_progression: { data: [], error: null },
}

describe('StrengthPage', () => {
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

    const { container } = render(<StrengthPage />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('Strength')).not.toBeInTheDocument()
  })

  it('renders sensibly with all-empty data (no crash, no Infinity/NaN/undefined)', async () => {
    supabaseMock = makeSupabaseMock(EMPTY_TABLES)

    render(<StrengthPage />)

    await waitFor(() => expect(screen.getByText('Strength')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('No sessions recorded yet')).toBeInTheDocument()
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
    // Session log is gated on sessions.length > 0.
    expect(screen.queryByText('Session Log')).not.toBeInTheDocument()
    // ExerciseProgressionTable is wrapped in DataGate — absent with 0 rows.
    expect(screen.queryByText('Exercise Progression')).not.toBeInTheDocument()
  })

  it('renders sensibly with typical data', async () => {
    const sessionRow = {
      session_id: 1,
      user_id: USER.id,
      date: '2026-08-25',
      day: 'Push',
      session_rating: 4,
      duration_minutes: 55,
      body_weight: 82,
      session_notes: 'Felt strong',
      exercise_count: 3,
      total_sets: 9,
      total_volume_kg: '1200',
      avg_weight_kg: '40',
      max_weight_lifted_kg: '60',
      avg_reps: '10',
    }
    const exerciseRow = {
      exercise: 'Seated Chest Press',
      muscle_group: 'Chest',
      secondary_muscle_group: null,
      movement_pattern: 'Compound',
      date: '2026-08-25',
      day: 'Push',
      user_id: USER.id,
      sets: 3,
      max_weight_kg: '60',
      avg_weight_kg: '55',
      volume_kg: '1200',
      avg_reps: '10',
    }
    supabaseMock = makeSupabaseMock({
      v_strength_sessions: { data: [sessionRow, { ...sessionRow, session_id: 2, day: 'Pull', date: '2026-08-27' }], error: null },
      v_exercise_progression: { data: [exerciseRow, { ...exerciseRow, exercise: 'Seated Low Row', muscle_group: 'Back', date: '2026-08-27' }], error: null },
    })

    render(<StrengthPage />)

    await waitFor(() => expect(screen.getByText('Strength')).toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('Sessions').closest('div')).toHaveTextContent('2')
    expect(screen.getByText('Session Volume')).toBeInTheDocument()
    expect(screen.getByText('Push / Pull / Legs')).toBeInTheDocument()
    expect(screen.getByText('Volume by Muscle Group')).toBeInTheDocument()
    expect(screen.getByText('Exercise Progression')).toBeInTheDocument()
    expect(screen.getByText('Session Log')).toBeInTheDocument()
    expect(screen.getByTestId('body-model-3d-stub')).toHaveTextContent('2 exercise rows')
  })
})
