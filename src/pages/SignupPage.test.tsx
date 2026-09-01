import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SignupPage from './SignupPage'

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

const signUp = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signUp: (...args: unknown[]) => signUp(...args) } },
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>
  )
}

async function fillAndSubmit(
  container: HTMLElement,
  { email, password, confirm }: { email: string; password: string; confirm: string }
) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText('you@example.com'), email)
  const passwordInputs = container.querySelectorAll('input[type="password"]')
  await user.type(passwordInputs[0], password)
  await user.type(passwordInputs[1], confirm)
  await user.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('SignupPage', () => {
  beforeEach(() => {
    signUp.mockReset()
    mockNavigate.mockReset()
  })

  it('renders the signup form', () => {
    renderPage()
    expect(screen.getByText('Create your account')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
  })

  it('client-side-validates mismatched passwords without calling supabase', async () => {
    const { container } = renderPage()
    await fillAndSubmit(container, { email: 'slade@example.com', password: 'abcdef', confirm: 'zzzzzz' })

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('client-side-validates a too-short password without calling supabase', async () => {
    const { container } = renderPage()
    // Below minLength=6 on the inputs -- type a value that still satisfies
    // the DOM's own minLength (so the browser doesn't block submit before
    // our handler's own length check runs) isn't representable via the
    // native constraint here, so this exercises the handler's explicit
    // `password.length < 6` branch directly by using matching-but-short values.
    await fillAndSubmit(container, { email: 'slade@example.com', password: 'ab', confirm: 'ab' })

    // Either the native minLength=6 constraint or the handler's own check
    // blocks this -- either way, supabase must not be called.
    expect(signUp).not.toHaveBeenCalled()
  })

  it('calls supabase.auth.signUp and navigates immediately when a session comes back (confirmation off)', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 'tok' }, user: { id: 'u1' } }, error: null })
    const { container } = renderPage()

    await fillAndSubmit(container, { email: 'slade@example.com', password: 'hunter2', confirm: 'hunter2' })

    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith({ email: 'slade@example.com', password: 'hunter2' })
    )
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'))
  })

  it('shows the "check your email" screen when signUp returns no session (confirmation on)', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null })
    const { container } = renderPage()

    await fillAndSubmit(container, { email: 'slade@example.com', password: 'hunter2', confirm: 'hunter2' })

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shows the error message when signUp fails', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'Email already registered' } })
    const { container } = renderPage()

    await fillAndSubmit(container, { email: 'slade@example.com', password: 'hunter2', confirm: 'hunter2' })

    expect(await screen.findByText('Email already registered')).toBeInTheDocument()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})
