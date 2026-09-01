import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { useChartTheme } from './chartTheme'
import { ThemeProvider } from '../context/ThemeContext'

// useChartTheme is a hook (depends on useTheme's context), not static config,
// so we exercise it via a tiny host component rendered under a real
// ThemeProvider, with the initial theme driven by localStorage (the same
// mechanism ThemeProvider itself uses to read its starting theme).
function Capture({ onValue }: { onValue: (v: ReturnType<typeof useChartTheme>) => void }) {
  onValue(useChartTheme())
  return null
}

function renderWithTheme(theme: 'dark' | 'light') {
  localStorage.setItem('slade-theme', theme)
  let captured: ReturnType<typeof useChartTheme> | undefined
  render(
    <ThemeProvider>
      <Capture onValue={(v) => { captured = v }} />
    </ThemeProvider>
  )
  return captured!
}

describe('useChartTheme', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('returns the expected shape', () => {
    const value = renderWithTheme('dark')
    expect(value).toHaveProperty('TIP')
    expect(value).toHaveProperty('GRID')
    expect(value).toHaveProperty('TICK')
    expect(value).toHaveProperty('LABEL_FILL')
    expect(value).toHaveProperty('CURSOR_FILL')
    expect(value).toHaveProperty('LEGEND_FILL')
  })

  it('returns dark-mode colors when theme is dark', () => {
    const value = renderWithTheme('dark')
    expect(value.GRID).toBe('#1f2937')
    expect(value.TIP.backgroundColor).toBe('#111827')
    expect(value.TIP.color).toBe('#f9fafb')
  })

  it('returns light-mode colors when theme is light', () => {
    const value = renderWithTheme('light')
    expect(value.GRID).toBe('#e5e7eb')
    expect(value.TIP.backgroundColor).toBe('#ffffff')
    expect(value.TIP.color).toBe('#111827')
  })
})
