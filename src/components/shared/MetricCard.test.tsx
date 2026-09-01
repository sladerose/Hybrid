import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricCard } from './MetricCard'

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Resting HR" value={52} accent="text-emerald-400" />)
    expect(screen.getByText('Resting HR')).toBeInTheDocument()
    expect(screen.getByText('52')).toBeInTheDocument()
  })

  it('falls back to "--" when value is null', () => {
    render(<MetricCard label="Resting HR" value={null} accent="text-gray-400" />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('falls back to "--" when value is undefined', () => {
    render(<MetricCard label="Resting HR" value={undefined} accent="text-gray-400" />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('renders the unit when provided', () => {
    render(<MetricCard label="Body Battery" value={78} unit="%" accent="text-emerald-400" />)
    expect(screen.getByText('%')).toBeInTheDocument()
  })

  it('does not render a unit element when not provided', () => {
    const { container } = render(<MetricCard label="Body Battery" value={78} accent="text-emerald-400" />)
    expect(container.querySelector('.text-xs.font-normal')).not.toBeInTheDocument()
  })

  it('renders sub text when provided', () => {
    render(<MetricCard label="Sleep" value={7.5} accent="text-emerald-400" sub="7d avg 7.2" />)
    expect(screen.getByText('7d avg 7.2')).toBeInTheDocument()
  })

  it('renders deltaVal text with its color class', () => {
    render(
      <MetricCard
        label="Steps"
        value={8000}
        accent="text-blue-400"
        deltaVal={{ text: '+12%', color: 'text-emerald-400' }}
      />
    )
    const el = screen.getByText('+12% vs 7d avg')
    expect(el).toBeInTheDocument()
    expect(el.className).toContain('text-emerald-400')
  })

  it('does not render deltaVal text when not provided', () => {
    render(<MetricCard label="Steps" value={8000} accent="text-blue-400" />)
    expect(screen.queryByText(/vs 7d avg/)).not.toBeInTheDocument()
  })

  it('renders a progress bar with width clamped to 100 when progress exceeds 100', () => {
    const { container } = render(
      <MetricCard label="Goal" value={120} accent="text-blue-400" progress={150} barColor="bg-emerald-500" />
    )
    const bar = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(bar).toBeInTheDocument()
    expect(bar.style.width).toBe('100%')
    expect(bar.className).toContain('bg-emerald-500')
  })

  it('renders a progress bar reflecting the given percentage under 100', () => {
    const { container } = render(<MetricCard label="Goal" value={60} accent="text-blue-400" progress={42} />)
    const bar = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(bar.style.width).toBe('42%')
    // default bar color when barColor not supplied
    expect(bar.className).toContain('bg-blue-500')
  })

  it('does not render a progress bar when progress is not provided', () => {
    const { container } = render(<MetricCard label="Goal" value={60} accent="text-blue-400" />)
    expect(container.querySelector('.h-full.rounded-full')).not.toBeInTheDocument()
  })

  it('renders a progress bar at 0% when progress is exactly 0', () => {
    const { container } = render(<MetricCard label="Goal" value={0} accent="text-blue-400" progress={0} />)
    const bar = container.querySelector('.h-full.rounded-full') as HTMLElement
    expect(bar).toBeInTheDocument()
    expect(bar.style.width).toBe('0%')
  })
})
