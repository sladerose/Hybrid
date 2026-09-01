import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SettingsPage from './SettingsPage'

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
let supabaseMock: ReturnType<typeof makeSupabaseMock>

vi.mock('../lib/supabase', () => ({
  get supabase() {
    return supabaseMock
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }))

const USER = { id: 'user-1', email: 'slade@example.com' }
const SESSION = { access_token: 'tok', user: USER }

const DATA_SOURCES = [
  { key: 'garmin', display_name: 'Garmin', auth_method: 'password' },
  { key: 'strava', display_name: 'Strava', auth_method: 'oauth' },
  { key: 'zepp', display_name: 'Zepp', auth_method: 'password' },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage />
    </MemoryRouter>
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: USER, session: SESSION, loading: false, signOut: vi.fn() })
  })

  it('shows a loading state before sources/statuses resolve', () => {
    supabaseMock = makeSupabaseMock({
      data_sources: { data: DATA_SOURCES, error: null },
      connection_status: { data: [], error: null },
    })
    const originalFrom = supabaseMock.from
    supabaseMock.from = vi.fn((table: string) => {
      const builder = originalFrom(table) as Record<string, unknown>
      builder.then = () => new Promise(() => {})
      return builder
    })

    renderPage()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders one ConnectionCard per configured source (empty statuses -> all "Not connected")', async () => {
    supabaseMock = makeSupabaseMock({
      data_sources: { data: DATA_SOURCES, error: null },
      connection_status: { data: [], error: null },
    })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('Garmin')).toBeInTheDocument()
    expect(screen.getByText('Strava')).toBeInTheDocument()
    expect(screen.getByText('Zepp')).toBeInTheDocument()
    expect(screen.getAllByText('Not connected').length).toBe(3)
  })

  it('renders per-source connected/needs_reauth status from connection_status rows', async () => {
    supabaseMock = makeSupabaseMock({
      data_sources: { data: DATA_SOURCES, error: null },
      connection_status: {
        data: [
          { source: 'garmin', status: 'connected', last_synced_at: '2026-08-30T06:00:00Z', last_error: null, last_backfill_requested_at: null },
          { source: 'strava', status: 'needs_reauth', last_synced_at: null, last_error: 'token expired', last_backfill_requested_at: null },
          { source: 'zepp', status: 'not_connected', last_synced_at: null, last_error: null, last_backfill_requested_at: null },
        ],
        error: null,
      },
    })

    renderPage()

    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument())

    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
    expect(screen.getByText('Garmin').closest('div')?.parentElement).toHaveTextContent('Connected')
    expect(screen.getByText('Strava').closest('div')?.parentElement).toHaveTextContent('Needs reauth')
    expect(screen.getByText('Zepp').closest('div')?.parentElement).toHaveTextContent('Not connected')
  })

  it('resolves out of the loading state (not stuck forever) with zero configured sources', async () => {
    supabaseMock = makeSupabaseMock({
      data_sources: { data: [], error: null },
      connection_status: { data: [], error: null },
    })

    renderPage()

    expect(screen.getByText('Settings')).toBeInTheDocument()
    // Real bug found in this pass: the second effect only calls
    // setLoading(false) inside `if (!sources.length) return` -- guarded
    // *out* -- so a data_sources fetch that resolves to an empty array
    // (indistinguishable from "not loaded yet", both are `[]`) left the page
    // stuck on "Loading..." forever. Fixed in SettingsPage.tsx by having the
    // data_sources effect itself clear loading when the resolved list is
    // empty, since there's nothing for the second effect to fetch statuses for.
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument())
    expect(document.body.textContent).not.toMatch(/Infinity|-Infinity|NaN|undefined/)
  })
})
