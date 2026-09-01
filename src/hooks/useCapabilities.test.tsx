import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'

const from = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
  },
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

const { useCapabilities } = await import('./useCapabilities')

function Probe() {
  const { loading, isConnected, anyConnected, connectedSources } = useCapabilities()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="any">{String(anyConnected)}</span>
      <span data-testid="garmin">{String(isConnected('garmin'))}</span>
      <span data-testid="strava">{String(isConnected('strava'))}</span>
      <span data-testid="count">{connectedSources.size}</span>
    </div>
  )
}

/** Builds a thenable that mimics the chained Supabase query used by the hook. */
function chainResolvingTo(data: { source: string }[] | null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (onFulfilled: (v: { data: typeof data }) => unknown) =>
      Promise.resolve({ data }).then(onFulfilled),
  }
  return builder
}

describe('useCapabilities', () => {
  beforeEach(() => {
    from.mockReset()
    mockUseAuth.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not query and stays loading when there is no authenticated user', () => {
    mockUseAuth.mockReturnValue({ user: null })

    render(<Probe />)

    expect(from).not.toHaveBeenCalled()
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    expect(screen.getByTestId('any')).toHaveTextContent('false')
  })

  it('reports no connections for a user with zero connected sources', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } as User })
    from.mockReturnValue(chainResolvingTo([]))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('any')).toHaveTextContent('false')
    expect(screen.getByTestId('garmin')).toHaveTextContent('false')
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('reports a single connected source correctly', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } as User })
    from.mockReturnValue(chainResolvingTo([{ source: 'garmin' }]))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('any')).toHaveTextContent('true')
    expect(screen.getByTestId('garmin')).toHaveTextContent('true')
    expect(screen.getByTestId('strava')).toHaveTextContent('false')
    expect(screen.getByTestId('count')).toHaveTextContent('1')
  })

  it('reports multiple connected sources correctly', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } as User })
    from.mockReturnValue(chainResolvingTo([{ source: 'garmin' }, { source: 'strava' }, { source: 'zepp' }]))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('any')).toHaveTextContent('true')
    expect(screen.getByTestId('garmin')).toHaveTextContent('true')
    expect(screen.getByTestId('strava')).toHaveTextContent('true')
    expect(screen.getByTestId('count')).toHaveTextContent('3')
  })

  it('treats a null data response as zero connections rather than crashing', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } as User })
    from.mockReturnValue(chainResolvingTo(null))

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('any')).toHaveTextContent('false')
    expect(screen.getByTestId('count')).toHaveTextContent('0')
  })

  it('queries connection_status filtered by user_id and status=connected', async () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-42' } as User })
    const builder = chainResolvingTo([])
    from.mockReturnValue(builder)

    render(<Probe />)

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(from).toHaveBeenCalledWith('connection_status')
    expect(builder.select).toHaveBeenCalledWith('source, status')
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-42')
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'status', 'connected')
  })
})
