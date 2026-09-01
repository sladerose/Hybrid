import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { LoadingSkeleton } from './LoadingSkeleton'

describe('LoadingSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<LoadingSkeleton />)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('renders a spinner element', () => {
    const { container } = render(<LoadingSkeleton />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })
})
