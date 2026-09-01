// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const verifyUser = vi.fn()

vi.mock('./_lib/supabaseAdmin.js', () => ({
  verifyUser: (...args: unknown[]) => verifyUser(...args),
}))

const USER_ID = 'user-123'
const STATE_SECRET = 'test-signing-secret'

function getRequest(method = 'GET'): Request {
  return new Request('https://example.com/api/strava-init', {
    method,
    headers: { authorization: 'Bearer token' },
  })
}

describe('strava-init', () => {
  beforeEach(() => {
    verifyUser.mockReset().mockResolvedValue(USER_ID)
    vi.stubEnv('STRAVA_CLIENT_ID', 'client-id-123')
    vi.stubEnv('STRAVA_REDIRECT_URI', 'https://example.com/api/strava-callback')
    vi.stubEnv('STATE_SIGNING_SECRET', STATE_SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects non-GET methods with 405', async () => {
    const handler = (await import('./strava-init.js')).default
    const res = await handler.fetch(getRequest('POST'))
    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: 'Method not allowed' })
    expect(verifyUser).not.toHaveBeenCalled()
  })

  it('returns 401 when STRAVA_CLIENT_ID is not set', async () => {
    vi.stubEnv('STRAVA_CLIENT_ID', undefined)
    const handler = (await import('./strava-init.js')).default
    const res = await handler.fetch(getRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Strava OAuth env vars not set' })
  })

  it('returns 401 when STRAVA_REDIRECT_URI is not set', async () => {
    vi.stubEnv('STRAVA_REDIRECT_URI', undefined)
    const handler = (await import('./strava-init.js')).default
    const res = await handler.fetch(getRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Strava OAuth env vars not set' })
  })

  it('returns 401 when verifyUser rejects', async () => {
    verifyUser.mockRejectedValue(new Error('Invalid or expired session'))
    const handler = (await import('./strava-init.js')).default
    const res = await handler.fetch(getRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid or expired session' })
  })

  it('happy path: returns the Strava authorize URL with expected params, including a signed state', async () => {
    const { verifyState } = await import('./_lib/crypto.js')
    const handler = (await import('./strava-init.js')).default
    const res = await handler.fetch(getRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    const url = new URL(body.url)

    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-id-123')
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.com/api/strava-callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe('activity:read_all')

    const state = url.searchParams.get('state')
    expect(state).toBeTruthy()
    expect(verifyState(state as string)).toBe(USER_ID)
  })
})
