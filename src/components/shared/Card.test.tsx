import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from './Card'

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>hello world</Card>)
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('applies an additional className alongside the base styles', () => {
    render(<Card className="custom-class">content</Card>)
    const el = screen.getByText('content')
    expect(el.className).toContain('custom-class')
    expect(el.className).toContain('rounded-xl')
  })

  it('works with no className provided', () => {
    render(<Card>plain</Card>)
    expect(screen.getByText('plain')).toBeInTheDocument()
  })
})
