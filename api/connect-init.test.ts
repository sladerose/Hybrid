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
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

function jsonRequest(body: unknown, method = 'POST'): Request {
  return new Request('https://example.com/api/connect-init', {
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

describe('connect-init', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', ENCRYPTION_KEY)
    vi.stubEnv('GH_PAT', 'gh-pat-value')
    vi.stubEnv('GITHUB_REPOSITORY', 'sladerose/Hybrid')
    verifyUser.mockReset().mockResolvedValue(USER_ID)
    supabaseAdmin.mockReset()
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('rejects non-POST methods with 405', async () => {
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest(undefined, 'GET'))
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
    expect(supabaseAdmin).not.toHaveBeenCalled()
  })

  it('rejects an invalid source with 400', async () => {
    setAdmin([])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'peloton', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid source' })
  })

  it('rejects a missing email with 400', async () => {
    setAdmin([])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Email and password are required' })
  })

  it('rejects a missing password with 400', async () => {
    setAdmin([])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', email: 'a@b.com' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Email and password are required' })
  })

  it('refuses a connect attempt when a pending row for the same user+source is <60s old', async () => {
    setAdmin([{ data: { created_at: new Date(Date.now() - 5_000).toISOString() }, error: null }])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/already in progress/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proceeds normally when the existing pending row is older than 60s', async () => {
    const { builders } = setAdmin([
      { data: { created_at: new Date(Date.now() - 120_000).toISOString() }, error: null },
      { data: { id: 'pending-row-id' }, error: null },
      { data: null, error: null },
    ])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loginId: 'pending-row-id' })
    expect(builders[1].insert).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('happy path: no pending row — inserts pending_logins, upserts connection_status, dispatches GH workflow, returns loginId', async () => {
    const { decrypt } = await import('./_lib/crypto.js')
    const { builders } = setAdmin([
      { data: null, error: null }, // no recent pending row
      { data: { id: 'pending-row-id' }, error: null }, // insert().select('id').single()
      { data: null, error: null }, // connection_status upsert
    ])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', email: 'a@b.com', password: 'pw' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ loginId: 'pending-row-id' })

    // pending_logins insert payload
    const insertPayload = builders[1].insert.mock.calls[0][0]
    expect(insertPayload.user_id).toBe(USER_ID)
    expect(insertPayload.source).toBe('garmin')
    expect(JSON.parse(decrypt(insertPayload.encrypted_credentials))).toEqual({
      email: 'a@b.com',
      password: 'pw',
    })

    // connection_status upsert payload
    expect(builders[2].upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, source: 'garmin', status: 'pending', last_error: null },
      { onConflict: 'user_id,source' },
    )

    // GitHub Actions dispatch
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/sladerose/Hybrid/actions/workflows/connect.yml/dispatches')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer gh-pat-value')
    expect(JSON.parse(init.body)).toEqual({
      ref: 'main',
      inputs: { login_id: 'pending-row-id', source: 'garmin' },
    })
  })

  it('returns 400 when the GitHub dispatch responds non-ok', async () => {
    setAdmin([
      { data: null, error: null },
      { data: { id: 'pending-row-id' }, error: null },
      { data: null, error: null },
    ])
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'zepp', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Failed to trigger connect workflow: 500' })
  })

  it('returns 400 when GH_PAT/GITHUB_REPOSITORY are not configured', async () => {
    vi.stubEnv('GH_PAT', undefined)
    setAdmin([
      { data: null, error: null },
      { data: { id: 'pending-row-id' }, error: null },
      { data: null, error: null },
    ])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'zepp', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'GitHub dispatch env vars not set' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates verifyUser rejection as a 400', async () => {
    verifyUser.mockRejectedValue(new Error('Invalid or expired session'))
    setAdmin([])
    const handler = (await import('./connect-init.js')).default
    const res = await handler.fetch(jsonRequest({ source: 'garmin', email: 'a@b.com', password: 'pw' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid or expired session' })
  })
})
