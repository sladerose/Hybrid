import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'

const STORAGE_KEY = 'slade-theme'

function Probe() {
  const { theme, toggleTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

/** jsdom does not implement window.matchMedia; stub it per-test. */
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn().mockReturnValue({ matches }),
    writable: true,
    configurable: true,
  })
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    vi.restoreAllMocks()
  })

  it('defaults to dark when localStorage is empty and the OS prefers dark', () => {
    mockMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  it('defaults to light when localStorage is empty and the OS prefers light', () => {
    mockMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })

  it('reads the persisted theme from localStorage over the OS preference', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    mockMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })

  it('toggles the theme and persists the new value to localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    mockMatchMedia(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')

    await act(async () => {
      screen.getByText('toggle').click()
    })

    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('adds the "dark" class to the document root when theme is dark', () => {
    localStorage.setItem(STORAGE_KEY, 'dark')
    mockMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the "dark" class from the document root when theme is light', () => {
    localStorage.setItem(STORAGE_KEY, 'light')
    mockMatchMedia(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('useTheme outside a provider falls back to the default context value', () => {
    render(<Probe />)
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })
})
