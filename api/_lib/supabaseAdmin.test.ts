// @vitest-environment node
//
// This file tests _lib/supabaseAdmin.ts itself, so unlike the handler tests
// it mocks @supabase/supabase-js's createClient directly rather than the
// ./_lib/supabaseAdmin.js module boundary.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const createClient = vi.fn(() => ({ auth: { getUser } }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

describe('supabaseAdmin', () => {
  beforeEach(() => {
    vi.resetModules()
    getUser.mockReset()
    createClient.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('supabaseAdmin()', () => {
    it('throws when SUPABASE_URL is not set', async () => {
      vi.stubEnv('SUPABASE_URL', undefined)
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
      const { supabaseAdmin } = await import('./supabaseAdmin.js')
      expect(() => supabaseAdmin()).toThrow('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
    })

    it('throws when SUPABASE_SERVICE_ROLE_KEY is not set', async () => {
      vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
      const { supabaseAdmin } = await import('./supabaseAdmin.js')
      expect(() => supabaseAdmin()).toThrow('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
    })

    it('builds a client with the service-role key and no session persistence', async () => {
      vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
      const { supabaseAdmin } = await import('./supabaseAdmin.js')
      supabaseAdmin()
      expect(createClient).toHaveBeenCalledWith('https://test.supabase.co', 'service-role-key', {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    })
  })

  describe('verifyUser()', () => {
    beforeEach(() => {
      vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key')
    })

    it('throws when the Authorization header is missing', async () => {
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever')
      await expect(verifyUser(request)).rejects.toThrow('Missing Authorization header')
      expect(getUser).not.toHaveBeenCalled()
    })

    it('throws when the Authorization header is present but empty', async () => {
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever', {
        headers: { authorization: '' },
      })
      await expect(verifyUser(request)).rejects.toThrow('Missing Authorization header')
      expect(getUser).not.toHaveBeenCalled()
    })

    it('throws when auth.getUser returns an error', async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever', {
        headers: { authorization: 'Bearer bad-token' },
      })
      await expect(verifyUser(request)).rejects.toThrow('Invalid or expired session')
    })

    it('throws when auth.getUser returns no user and no error', async () => {
      getUser.mockResolvedValue({ data: { user: null }, error: null })
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever', {
        headers: { authorization: 'Bearer some-token' },
      })
      await expect(verifyUser(request)).rejects.toThrow('Invalid or expired session')
    })

    it('returns the user id for a valid token', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'user-abc-123' } }, error: null })
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever', {
        headers: { authorization: 'Bearer valid-token' },
      })
      await expect(verifyUser(request)).resolves.toBe('user-abc-123')
      expect(getUser).toHaveBeenCalledWith('valid-token')
    })

    it('accepts a lowercase "bearer" scheme (header lookup + regex are both case-insensitive)', async () => {
      getUser.mockResolvedValue({ data: { user: { id: 'user-abc-123' } }, error: null })
      const { verifyUser } = await import('./supabaseAdmin.js')
      const request = new Request('https://example.com/api/whatever', {
        headers: { Authorization: 'bearer valid-token' },
      })
      await expect(verifyUser(request)).resolves.toBe('user-abc-123')
    })
  })
})
