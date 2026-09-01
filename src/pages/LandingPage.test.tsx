import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LandingPage from './LandingPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  )
}

describe('LandingPage', () => {
  it('renders the Hybrid wordmark and value prop', () => {
    renderPage()
    expect(screen.getByText('Hybrid')).toBeInTheDocument()
    expect(
      screen.getByText('One dashboard for the athlete who runs, lifts, and sleeps well.')
    ).toBeInTheDocument()
    expect(screen.getByText('Your Garmin data tells you what happened. Hybrid tells you why.')).toBeInTheDocument()
  })

  it('renders the 4 signal types', () => {
    renderPage()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('Strength')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })

  it('renders a cross-signal example', () => {
    renderPage()
    expect(
      screen.getByText('RHR elevated five days running: do not race Saturday.')
    ).toBeInTheDocument()
  })

  it('the sign-up CTA links to /signup', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup')
  })

  it('the log-in link points to /login', () => {
    renderPage()
    const loginLinks = screen.getAllByRole('link', { name: 'Log in' })
    expect(loginLinks.length).toBeGreaterThan(0)
    for (const link of loginLinks) {
      expect(link).toHaveAttribute('href', '/login')
    }
  })
})
