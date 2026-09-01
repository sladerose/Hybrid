import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartHeader } from './ChartHeader'

describe('ChartHeader', () => {
  it('renders the title', () => {
    render(<ChartHeader title="Recovery Trend" />)
    expect(screen.getByText('Recovery Trend')).toBeInTheDocument()
  })

  it('does not render a subtitle when none is given', () => {
    const { container } = render(<ChartHeader title="Recovery Trend" />)
    // Only the title <p> should be present — no second <p> for the subtitle.
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders the subtitle when provided', () => {
    render(<ChartHeader title="Recovery Trend" sub="Last 60 days" />)
    expect(screen.getByText('Recovery Trend')).toBeInTheDocument()
    expect(screen.getByText('Last 60 days')).toBeInTheDocument()
  })
})
