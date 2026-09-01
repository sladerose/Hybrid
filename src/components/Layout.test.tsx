import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Layout from './Layout'

const mockUseAuth = vi.fn()
const mockUseTheme = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }))
vi.mock('../context/ThemeContext', () => ({ useTheme: () => mockUseTheme() }))

function renderLayout(initialPath = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
          <Route path="/recovery" element={<div>Recovery content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('Layout', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'slade@example.com' }, session: {}, loading: false, signOut: vi.fn() })
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() })
  })

  it('renders a nav link for every route', () => {
    renderLayout()
    for (const label of ['Dashboard', 'Recovery', 'Running', 'Strength', 'Body', 'Settings']) {
      // Each label appears twice: once in the desktop sidebar, once in the mobile bottom nav.
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('renders nav links pointing at the expected routes', () => {
    renderLayout()
    const links = screen.getAllByRole('link') as HTMLAnchorElement[]
    const hrefs = new Set(links.map((l) => l.getAttribute('href')))
    for (const path of ['/dashboard', '/recovery', '/running', '/strength', '/body', '/settings']) {
      expect(hrefs.has(path)).toBe(true)
    }
  })

  it("renders the routed page's content via <Outlet />", () => {
    renderLayout('/dashboard')
    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(screen.queryByText('Recovery content')).not.toBeInTheDocument()
  })

  it('renders different content when navigated to a different route', () => {
    renderLayout('/recovery')
    expect(screen.getByText('Recovery content')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
  })

  it("shows the signed-in user's email and a working sign-out button", async () => {
    const signOut = vi.fn()
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'slade@example.com' }, session: {}, loading: false, signOut })
    renderLayout()
    expect(screen.getByText('slade@example.com')).toBeInTheDocument()
    const signOutButtons = screen.getAllByText('Sign out')
    signOutButtons[0].click()
    expect(signOut).toHaveBeenCalled()
  })
})
