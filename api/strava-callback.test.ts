// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupabaseAdminMock, type QueryResult } from '../tests/helpers/mockSupabase.js'

const supabaseAdmin = vi.fn()

vi.mock('./_lib/supabaseAdmin.js', () => ({
  supabaseAdmin: (...args: unknown[]) => supabaseAdmin(...args),
}))

const USER_ID = 'user-123'
const APP_URL = 'https://hybrid-peach.vercel.app'
const STATE_SECRET = 'test-signing-secret'
const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')

function callbackUrl(params: Record<string, string>): string {
  const url = new URL('https://example.com/api/strava-callback')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

function setAdmin(results: QueryResult[]) {
  const { admin, builders } = createSupabaseAdminMock(results)
  supabaseAdmin.mockReturnValue(admin)
  return { admin, builders }
}

describe('strava-callback', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    supabaseAdmin.mockReset()
    vi.stubEnv('APP_URL', APP_URL)
    vi.stubEnv('STATE_SIGNING_SECRET', STATE_SECRET)
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', ENCRYPTION_KEY)
    vi.stubEnv('STRAVA_CLIENT_ID', 'client-id')
    vi.stubEnv('STRAVA_CLIENT_SECRET', 'client-secret')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function signValidState(userId: string): Promise<string> {
    const { signState } = await import('./_lib/crypto.js')
    return signState(userId)
  }

  it('redirects to ?strava=denied when the user denies access, without touching Supabase or Strava', async () => {
    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ error: 'access_denied' }))
    const res = await handler.fetch(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=denied`)
    expect(supabaseAdmin).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redirects to ?strava=error when code is missing', async () => {
    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ state: 'whatever' }))
    const res = await handler.fetch(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=error`)
    expect(supabaseAdmin).not.toHaveBeenCalled()
  })

  it('redirects to ?strava=error when state is missing', async () => {
    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123' }))
    const res = await handler.fetch(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=error`)
    expect(supabaseAdmin).not.toHaveBeenCalled()
  })

  it('redirects to ?strava=invalid_state on a garbled state, without ever calling Supabase or Strava', async () => {
    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state: 'garbage-not-a-signed-state' }))
    const res = await handler.fetch(req)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=invalid_state`)
    expect(supabaseAdmin).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('happy path: exchanges code, upserts credential + connected status, redirects to ?strava=connected', async () => {
    const { decrypt } = await import('./_lib/crypto.js')
    const state = await signValidState(USER_ID)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'refresh-abc', athlete: { id: 999 } }),
    })
    const { builders } = setAdmin([
      { data: [], error: null }, // no colliding external_account_id
      { data: null, error: null }, // user_credentials upsert
      { data: null, error: null }, // connection_status upsert
    ])

    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state }))
    const res = await handler.fetch(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=connected`)

    // collision check query
    expect(builders[0].eq).toHaveBeenNthCalledWith(1, 'source', 'strava')
    expect(builders[0].eq).toHaveBeenNthCalledWith(2, 'external_account_id', '999')
    expect(builders[0].neq).toHaveBeenCalledWith('user_id', USER_ID)

    // credential upsert
    const credentialPayload = builders[1].upsert.mock.calls[0][0]
    expect(credentialPayload.user_id).toBe(USER_ID)
    expect(credentialPayload.source).toBe('strava')
    expect(credentialPayload.external_account_id).toBe('999')
    expect(JSON.parse(decrypt(credentialPayload.encrypted_payload))).toEqual({ refresh_token: 'refresh-abc' })

    // connection_status upsert
    expect(builders[2].upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, source: 'strava', status: 'connected', last_error: null },
      { onConflict: 'user_id,source' },
    )
  })

  it('refuses and marks needs_reauth when athlete.id is already linked to a different user', async () => {
    const state = await signValidState(USER_ID)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'refresh-abc', athlete: { id: 999 } }),
    })
    const { builders } = setAdmin([
      { data: [{ user_id: 'a-different-user' }], error: null }, // collision found
      { data: null, error: null }, // connection_status upsert (needs_reauth)
    ])

    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state }))
    const res = await handler.fetch(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=error`)

    const statusPayload = builders[1].upsert.mock.calls[0][0]
    expect(statusPayload).toMatchObject({ user_id: USER_ID, source: 'strava', status: 'needs_reauth' })
    expect(statusPayload.last_error).toMatch(/already connected to a different user/i)

    // Must not have written a credential row for the stolen account.
    expect(builders).toHaveLength(2)
  })

  it('marks needs_reauth and redirects to ?strava=error when Strava token exchange fails', async () => {
    const state = await signValidState(USER_ID)
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) })
    const { builders } = setAdmin([
      { data: null, error: null }, // connection_status upsert (needs_reauth)
    ])

    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state }))
    const res = await handler.fetch(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=error`)
    const statusPayload = builders[0].upsert.mock.calls[0][0]
    expect(statusPayload).toMatchObject({ user_id: USER_ID, source: 'strava', status: 'needs_reauth' })
    expect(statusPayload.last_error).toMatch(/Strava token exchange failed: 400/)
  })

  it('marks needs_reauth when Strava responds ok but omits refresh_token', async () => {
    const state = await signValidState(USER_ID)
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { builders } = setAdmin([{ data: null, error: null }])

    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state }))
    const res = await handler.fetch(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=error`)
    expect(builders[0].upsert.mock.calls[0][0].last_error).toMatch(/No refresh_token/)
  })

  it('proceeds without a collision check when Strava omits athlete.id', async () => {
    const { decrypt } = await import('./_lib/crypto.js')
    const state = await signValidState(USER_ID)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refresh_token: 'refresh-abc' }), // no athlete field
    })
    const { builders } = setAdmin([
      { data: null, error: null }, // user_credentials upsert (no prior collision-check call)
      { data: null, error: null }, // connection_status upsert
    ])

    const handler = (await import('./strava-callback.js')).default
    const req = new Request(callbackUrl({ code: 'abc123', state }))
    const res = await handler.fetch(req)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/settings?strava=connected`)
    expect(builders).toHaveLength(2)
    const credentialPayload = builders[0].upsert.mock.calls[0][0]
    expect(credentialPayload.external_account_id).toBeNull()
    expect(JSON.parse(decrypt(credentialPayload.encrypted_payload))).toEqual({ refresh_token: 'refresh-abc' })
  })
})
