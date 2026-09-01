// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseAdminMock, type QueryResult } from '../tests/helpers/mockSupabase.js'

const verifyUser = vi.fn()
const supabaseAdmin = vi.fn()

vi.mock('./_lib/supabaseAdmin.js', () => ({
  verifyUser: (...args: unknown[]) => verifyUser(...args),
  supabaseAdmin: (...args: unknown[]) => supabaseAdmin(...args),
}))

const USER_ID = 'user-123'

function jsonRequest(body: unknown, method = 'POST'): Request {
  return new Request('https://example.com/api/backfill-init', {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function setAdmin(results: QueryResult[]) {
  const { admin, builders } = createSupabaseAdminMock(results)
  supabaseAdmin.mockReturnValue(admin)
  return { admin, builders }
}

describe('backfill-init', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    verifyUser.mockReset().mockResolvedValue(USER_ID)
    supabaseAdmin.mockReset()
    vi.stubEnv('GH_PAT', 'gh-pat-value')
    vi.stubEnv('GITHUB_REPOSITORY', 'sladerose/Hybrid')
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('rejects non-POST methods with 405', async () => {
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest(undefined, 'GET'))
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
    expect(verifyUser).not.toHaveBeenCalled()
  })

  it('rejects an invalid source with 400', async () => {
    setAdmin([])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'peloton' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
  })

  it('refuses when the source is not connected', async () => {
    setAdmin([{ data: { status: 'not_connected', last_backfill_requested_at: null }, error: null }])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Source must be connected before it can be resynced' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when there is no connection_status row at all', async () => {
    setAdmin([{ data: null, error: null }])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Source must be connected before it can be resynced' })
  })

  it('refuses within the read-time 24h cooldown, before even attempting the atomic claim', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1h ago
    const { builders } = setAdmin([{ data: { status: 'connected', last_backfill_requested_at: recent }, error: null }])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'strava' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/try again in about \d+h/)
    expect(fetchMock).not.toHaveBeenCalled()
    // Only the read happened — the atomic UPDATE claim was never attempted.
    expect(builders).toHaveLength(1)
  })

  it('refuses when the atomic conditional UPDATE claims zero rows (lost the cooldown race)', async () => {
    // Read-time check passes (no last_backfill_requested_at at all), but the
    // atomic UPDATE...WHERE...OR...select() comes back empty — e.g. another
    // concurrent request already claimed it between the read and the write.
    const { builders } = setAdmin([
      { data: { status: 'connected', last_backfill_requested_at: null }, error: null },
      { data: [], error: null }, // claimed: zero rows
    ])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already requested recently/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(builders[1].update).toHaveBeenCalledTimes(1)
  })

  it('dispatches the backfill workflow when the atomic UPDATE claims a row (cooldown expired)', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25h ago, past cooldown
    const { builders } = setAdmin([
      { data: { status: 'connected', last_backfill_requested_at: old }, error: null },
      { data: [{ user_id: USER_ID }], error: null }, // claimed: one row won the race
    ])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    // The atomic update payload + conditional WHERE clause.
    expect(builders[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ last_backfill_requested_at: expect.any(String) }),
    )
    expect(builders[1].eq).toHaveBeenCalledWith('status', 'connected')
    expect(builders[1].or).toHaveBeenCalledTimes(1)
    expect(builders[1].select).toHaveBeenCalledWith('user_id')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/sladerose/Hybrid/actions/workflows/backfill.yml/dispatches')
    expect(JSON.parse(init.body)).toEqual({
      ref: 'main',
      inputs: { source: 'garmin', user_id: USER_ID, days: '90' },
    })
  })

  it('dispatches when there has never been a previous backfill request (null last_backfill_requested_at)', async () => {
    setAdmin([
      { data: { status: 'connected', last_backfill_requested_at: null }, error: null },
      { data: [{ user_id: USER_ID }], error: null },
    ])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'zepp' }))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when the GitHub dispatch responds non-ok', async () => {
    setAdmin([
      { data: { status: 'connected', last_backfill_requested_at: null }, error: null },
      { data: [{ user_id: USER_ID }], error: null },
    ])
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Failed to trigger backfill workflow: 500' })
  })

  it('propagates verifyUser rejection as a 400', async () => {
    verifyUser.mockRejectedValue(new Error('Invalid or expired session'))
    setAdmin([])
    const handler = (await import('./backfill-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid or expired session' })
  })
})
