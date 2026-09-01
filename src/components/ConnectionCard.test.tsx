import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ConnectionCard from './ConnectionCard'

const baseProps = {
  label: 'Garmin',
  lastSyncedAt: null as string | null,
  lastError: null as string | null,
  lastBackfillRequestedAt: null as string | null,
  connecting: false,
  resyncing: false,
  onConnect: vi.fn(),
  onDisconnect: vi.fn(),
  onResync: vi.fn(),
}

describe('ConnectionCard', () => {
  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00Z'))
    baseProps.onConnect.mockReset()
    baseProps.onDisconnect.mockReset()
    baseProps.onResync.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the not_connected state with a Connect button', () => {
    render(<ConnectionCard {...baseProps} status="not_connected" />)
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })

  it('renders the pending state with a disabled, "Connecting..." button', () => {
    render(<ConnectionCard {...baseProps} status="pending" />)
    // Both the badge and the button read "Connecting..." — there are two matches.
    expect(screen.getAllByText('Connecting...')).toHaveLength(2)
    const button = screen.getByRole('button', { name: 'Connecting...' })
    expect(button).toBeDisabled()
  })

  it('renders the connected state with last-synced text, Resync, and Disconnect', () => {
    render(
      <ConnectionCard
        {...baseProps}
        status="connected"
        lastSyncedAt="2026-08-30T06:00:00Z"
      />
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText(/Last synced/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resync' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('renders the needs_reauth state with the error message and a Reconnect button', () => {
    render(
      <ConnectionCard
        {...baseProps}
        status="needs_reauth"
        lastError="token expired"
      />
    )
    expect(screen.getByText('Needs reauth')).toBeInTheDocument()
    expect(screen.getByText('token expired')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('calls onConnect when the Connect button is clicked', () => {
    render(<ConnectionCard {...baseProps} status="not_connected" />)
    screen.getByRole('button', { name: 'Connect' }).click()
    expect(baseProps.onConnect).toHaveBeenCalledTimes(1)
  })

  it('calls onDisconnect when the Disconnect button is clicked', () => {
    render(<ConnectionCard {...baseProps} status="connected" />)
    screen.getByRole('button', { name: 'Disconnect' }).click()
    expect(baseProps.onDisconnect).toHaveBeenCalledTimes(1)
  })

  it('calls onResync when the Resync button is clicked', () => {
    render(<ConnectionCard {...baseProps} status="connected" />)
    screen.getByRole('button', { name: 'Resync' }).click()
    expect(baseProps.onResync).toHaveBeenCalledTimes(1)
  })

  it('is not on cooldown when lastBackfillRequestedAt is null: Resync is enabled', () => {
    render(<ConnectionCard {...baseProps} status="connected" lastBackfillRequestedAt={null} />)
    expect(screen.getByRole('button', { name: 'Resync' })).toBeEnabled()
  })

  it('is on cooldown within 24h of lastBackfillRequestedAt: Resync is disabled with an hour countdown', () => {
    // "now" is 2026-09-01T12:00:00Z; a request 5 hours ago leaves 19h on a 24h cooldown.
    render(
      <ConnectionCard
        {...baseProps}
        status="connected"
        lastBackfillRequestedAt="2026-09-01T07:00:00Z"
      />
    )
    const button = screen.getByRole('button', { name: 'Resync (19h)' })
    expect(button).toBeDisabled()
  })

  it('cooldown expires exactly at 24h: Resync is enabled again', () => {
    render(
      <ConnectionCard
        {...baseProps}
        status="connected"
        lastBackfillRequestedAt="2026-08-31T12:00:00Z"
      />
    )
    expect(screen.getByRole('button', { name: 'Resync' })).toBeEnabled()
  })

  it('shows "Resyncing..." and disables the button while a resync is in flight', () => {
    render(<ConnectionCard {...baseProps} status="connected" resyncing />)
    const button = screen.getByRole('button', { name: 'Resyncing...' })
    expect(button).toBeDisabled()
  })

  it('disables the Reconnect button while connecting', () => {
    render(<ConnectionCard {...baseProps} status="needs_reauth" connecting lastError="x" />)
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeDisabled()
  })
})
