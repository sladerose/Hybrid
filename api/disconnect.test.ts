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
  return new Request('https://example.com/api/disconnect', {
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

describe('disconnect', () => {
  beforeEach(() => {
    verifyUser.mockReset().mockResolvedValue(USER_ID)
    supabaseAdmin.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects non-POST methods with 405', async () => {
    const handler = (await import('./disconnect.js')).default
    const res = await handler.fetch(jsonRequest(undefined, 'GET'))
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
    expect(verifyUser).not.toHaveBeenCalled()
  })

  it('rejects an invalid source with 400', async () => {
    setAdmin([])
    const handler = (await import('./disconnect.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'peloton' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
  })

  it('rejects a missing source with 400', async () => {
    setAdmin([])
    const handler = (await import('./disconnect.js')).default
    const res = await handler.fetch(jsonRequest({}))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
  })

  it.each(['garmin', 'strava', 'zepp'])('happy path for source=%s: deletes credential, upserts not_connected, returns ok', async (source) => {
    const { builders } = setAdmin([
      { data: null, error: null }, // delete
      { data: null, error: null }, // upsert
    ])
    const handler = (await import('./disconnect.js')).default
    const res = await handler.fetch(jsonRequest({ source }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(builders[0].delete).toHaveBeenCalledTimes(1)
    expect(builders[0].eq).toHaveBeenNthCalledWith(1, 'user_id', USER_ID)
    expect(builders[0].eq).toHaveBeenNthCalledWith(2, 'source', source)

    expect(builders[1].upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, source, status: 'not_connected', last_error: null, last_synced_at: null },
      { onConflict: 'user_id,source' },
    )
  })

  it('propagates verifyUser rejection as a 400', async () => {
    verifyUser.mockRejectedValue(new Error('Invalid or expired session'))
    setAdmin([])
    const handler = (await import('./disconnect.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid or expired session' })
  })
})
