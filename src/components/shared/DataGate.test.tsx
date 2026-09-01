import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataGate } from './DataGate'

describe('DataGate', () => {
  it('renders children when rows length meets the default minLength (1)', () => {
    render(
      <DataGate rows={[1]}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders children when rows length exceeds the default minLength', () => {
    render(
      <DataGate rows={[1, 2, 3]}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders nothing (default null fallback) when rows is an empty array', () => {
    const { container } = render(
      <DataGate rows={[]}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when rows is null', () => {
    const { container } = render(
      <DataGate rows={null}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when rows is undefined', () => {
    const { container } = render(
      <DataGate rows={undefined}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.queryByText('content')).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the fallback node when below threshold and a fallback is given', () => {
    render(
      <DataGate rows={[]} fallback={<div>no data yet</div>}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('no data yet')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('respects a custom minLength: renders fallback one row below the threshold', () => {
    render(
      <DataGate rows={[1, 2]} minLength={3} fallback={<div>not enough</div>}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('not enough')).toBeInTheDocument()
    expect(screen.queryByText('content')).not.toBeInTheDocument()
  })

  it('respects a custom minLength: renders children exactly at the threshold', () => {
    render(
      <DataGate rows={[1, 2, 3]} minLength={3} fallback={<div>not enough</div>}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('content')).toBeInTheDocument()
    expect(screen.queryByText('not enough')).not.toBeInTheDocument()
  })

  it('treats minLength 0 as always satisfied, even for an empty array', () => {
    render(
      <DataGate rows={[]} minLength={0}>
        <div>content</div>
      </DataGate>
    )
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
