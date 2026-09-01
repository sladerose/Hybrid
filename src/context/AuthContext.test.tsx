import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import type { Session, User } from '@supabase/supabase-js'

const getSession = vi.fn()
const onAuthStateChange = vi.fn()
const signOut = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  },
}))

// Imported after the mock so the module under test picks up the mocked
// `../lib/supabase` rather than instantiating a real Supabase client.
const { AuthProvider, useAuth } = await import('./AuthContext')

const unsubscribe = vi.fn()

function Probe() {
  const { user, session, loading, signOut: doSignOut } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.id : 'none'}</span>
      <span data-testid="session">{session ? 'has-session' : 'none'}</span>
      <button onClick={() => doSignOut()}>sign out</button>
    </div>
  )
}

function makeUser(id: string): User {
  return { id } as User
}

function makeSession(id: string): Session {
  return { user: makeUser(id) } as Session
}

describe('AuthContext', () => {
  let authChangeCallback: (event: string, session: Session | null) => void

  beforeEach(() => {
    getSession.mockReset()
    onAuthStateChange.mockReset()
    signOut.mockReset().mockResolvedValue({ error: null })
    unsubscribe.mockReset()
    onAuthStateChange.mockImplementation((cb: (event: string, session: Session | null) => void) => {
      authChangeCallback = cb
      return { data: { subscription: { unsubscribe } } }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts in a loading state with no user before getSession resolves', () => {
    let resolveSession!: (v: { data: { session: Session | null } }) => void
    getSession.mockReturnValue(new Promise((resolve) => { resolveSession = resolve }))

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    expect(screen.getByTestId('user')).toHaveTextContent('none')

    // Resolve so the pending promise doesn't leak across tests.
    resolveSession({ data: { session: null } })
  })

  it('resolves to no user/session when getSession returns none', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('session')).toHaveTextContent('none')
  })

  it('resolves user/session from getSession when a session exists', async () => {
    const session = makeSession('user-abc')
    getSession.mockResolvedValue({ data: { session } })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('user-abc')
    expect(screen.getByTestId('session')).toHaveTextContent('has-session')
  })

  it('updates user/session when onAuthStateChange fires with a new session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')

    const session = makeSession('user-xyz')
    act(() => {
      authChangeCallback('SIGNED_IN', session)
    })

    expect(screen.getByTestId('user')).toHaveTextContent('user-xyz')
    expect(screen.getByTestId('session')).toHaveTextContent('has-session')
  })

  it('clears user/session when onAuthStateChange fires with null (sign-out event)', async () => {
    const session = makeSession('user-xyz')
    getSession.mockResolvedValue({ data: { session } })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-xyz'))

    act(() => {
      authChangeCallback('SIGNED_OUT', null)
    })

    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('session')).toHaveTextContent('none')
  })

  it('signOut calls supabase.auth.signOut()', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    await act(async () => {
      screen.getByText('sign out').click()
    })

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the auth listener on unmount', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    )

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('useAuth outside a provider returns the default context (no crash)', () => {
    render(<Probe />)
    expect(screen.getByTestId('loading')).toHaveTextContent('true')
    expect(screen.getByTestId('user')).toHaveTextContent('none')
  })
})
