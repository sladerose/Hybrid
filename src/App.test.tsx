import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// App.tsx wires up BrowserRouter itself (rather than accepting a router as a
// prop), so these tests drive it via the real `window.location` (reset to
// `/` before each test) rather than wrapping in a MemoryRouter.
//
// Only the root-route (`/`) branching added in this pass is under test here
// — the signed-in case renders <DashboardPage /> after redirecting, so that
// page is stubbed out rather than exercised for real: its own data-fetching
// behaviour already has full coverage in DashboardPage.test.tsx, and letting
// the real component render here would drag in its Supabase query mocking
// for no benefit to what this file is checking.
// App.tsx's route table imports every page up front (LoginPage, SignupPage,
// etc.), several of which import the real Supabase client at module scope.
// That client throws immediately in this test environment (no
// VITE_SUPABASE_URL/ANON_KEY configured), regardless of which route is
// actually rendered — stub it out the same way the page-level test files do.
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn() } },
}))

const mockUseAuth = vi.fn()
vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockUseAuth(),
}))
vi.mock('./context/ThemeContext', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}))
vi.mock('./pages/DashboardPage', () => ({
  default: () => <div>dashboard content</div>,
}))

const App = (await import('./App')).default

describe('App root route (/)', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
    window.history.pushState({}, '', '/')
  })

  it('renders the landing page for a signed-out visitor', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    render(<App />)
    expect(
      screen.getByText('One dashboard for the athlete who runs, lifts, and sleeps well.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up' })).toBeInTheDocument()
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument()
  })

  it('redirects a signed-in visitor straight to /dashboard', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' }, loading: false })
    render(<App />)
    expect(screen.getByText('dashboard content')).toBeInTheDocument()
    expect(
      screen.queryByText('One dashboard for the athlete who runs, lifts, and sleeps well.')
    ).not.toBeInTheDocument()
    expect(window.location.pathname).toBe('/dashboard')
  })

  it('shows a loading state instead of flashing the landing page while auth is resolving', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true })
    const { container } = render(<App />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(
      screen.queryByText('One dashboard for the athlete who runs, lifts, and sleeps well.')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument()
  })
})
