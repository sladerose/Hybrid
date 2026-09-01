import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

const mockUseAuth = vi.fn()

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

const ProtectedRoute = (await import('./ProtectedRoute')).default

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>dashboard content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockUseAuth.mockReset()
  })

  it('renders a loading spinner while auth state is resolving', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true })
    const { container } = renderAt('/dashboard')
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('renders the protected outlet content when a session/user exists', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } as User, loading: false })
    renderAt('/dashboard')
    expect(screen.getByText('dashboard content')).toBeInTheDocument()
  })

  it('redirects to /login when there is no user and loading has finished', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })
    renderAt('/dashboard')
    expect(screen.getByText('login page')).toBeInTheDocument()
    expect(screen.queryByText('dashboard content')).not.toBeInTheDocument()
  })
})
