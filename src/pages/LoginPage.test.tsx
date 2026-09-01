import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const signInWithPassword = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPassword(...args) } },
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
    mockNavigate.mockReset()
  })

  it('renders the sign-in form', () => {
    renderPage()
    expect(screen.getByText('Hybrid')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Create one')).toBeInTheDocument()
  })

  it('requires email and password before submit (native HTML validation)', () => {
    const { container } = renderPage()
    const emailInput = screen.getByPlaceholderText('you@example.com') as HTMLInputElement
    const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement
    expect(emailInput).toBeRequired()
    expect(passwordInput).toBeRequired()
  })

  it('calls supabase.auth.signInWithPassword with the entered credentials and navigates on success', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    const { container } = renderPage()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'slade@example.com')
    await user.type(container.querySelector('input[type="password"]')!, 'hunter2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({ email: 'slade@example.com', password: 'hunter2' })
    )
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))
  })

  it('shows the error message and does not navigate when sign-in fails', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const user = userEvent.setup()
    const { container } = renderPage()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'slade@example.com')
    await user.type(container.querySelector('input[type="password"]')!, 'wrongpass')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
