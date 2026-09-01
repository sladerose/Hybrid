// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'

const validKey = () => randomBytes(32).toString('base64')

describe('crypto', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('encrypt / decrypt', () => {
    it('round-trips a plain string', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', validKey())
      const { encrypt, decrypt } = await import('./crypto.js')
      const plaintext = 'hunter2'
      const encoded = encrypt(plaintext)
      expect(decrypt(encoded)).toBe(plaintext)
    })

    it('round-trips a JSON payload', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', validKey())
      const { encrypt, decrypt } = await import('./crypto.js')
      const payload = { email: 'slade@example.com', password: 'correct horse battery staple' }
      const encoded = encrypt(JSON.stringify(payload))
      expect(JSON.parse(decrypt(encoded))).toEqual(payload)
    })

    it('produces a different ciphertext each call (random nonce)', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', validKey())
      const { encrypt } = await import('./crypto.js')
      expect(encrypt('same plaintext')).not.toBe(encrypt('same plaintext'))
    })

    it('fails to decrypt tampered ciphertext', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', validKey())
      const { encrypt, decrypt } = await import('./crypto.js')
      const encoded = encrypt('some secret')
      const raw = Buffer.from(encoded, 'base64')
      // Flip a byte in the ciphertext region (after the 12-byte nonce).
      raw[12] ^= 0xff
      const tampered = raw.toString('base64')
      expect(() => decrypt(tampered)).toThrow()
    })

    it('fails to decrypt garbage input', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', validKey())
      const { decrypt } = await import('./crypto.js')
      expect(() => decrypt('not-valid-base64-ciphertext-at-all')).toThrow()
    })

    it('throws on encrypt when CREDENTIAL_ENCRYPTION_KEY is not set', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', undefined)
      const { encrypt } = await import('./crypto.js')
      expect(() => encrypt('x')).toThrow('CREDENTIAL_ENCRYPTION_KEY is not set')
    })

    it('throws on decrypt when CREDENTIAL_ENCRYPTION_KEY is not set', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', undefined)
      const { decrypt } = await import('./crypto.js')
      expect(() => decrypt('anything')).toThrow('CREDENTIAL_ENCRYPTION_KEY is not set')
    })

    it('throws when the key does not decode to exactly 32 bytes', async () => {
      vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', Buffer.from('too-short').toString('base64'))
      const { encrypt } = await import('./crypto.js')
      expect(() => encrypt('x')).toThrow('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes')
    })
  })

  describe('signState / verifyState', () => {
    it('round-trips a userId', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      const { signState, verifyState } = await import('./crypto.js')
      const state = signState('user-123')
      expect(verifyState(state)).toBe('user-123')
    })

    it('rejects a tampered signature', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      const { signState, verifyState } = await import('./crypto.js')
      const state = signState('user-123')
      const [payload, sig] = state.split('.')
      const tamperedSig = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a')
      expect(() => verifyState(`${payload}.${tamperedSig}`)).toThrow('Invalid state signature')
    })

    it('rejects a payload tampered to a different userId (signature no longer matches)', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      const { signState, verifyState } = await import('./crypto.js')
      const state = signState('user-123')
      const [, sig] = state.split('.')
      const forgedPayload = Buffer.from(JSON.stringify({ userId: 'someone-else', exp: 9999999999 })).toString(
        'base64url',
      )
      expect(() => verifyState(`${forgedPayload}.${sig}`)).toThrow('Invalid state signature')
    })

    it('rejects an expired state', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const { signState, verifyState } = await import('./crypto.js')
      const state = signState('user-123')
      vi.setSystemTime(new Date('2026-01-01T00:10:01Z')) // > 5 minutes later
      expect(() => verifyState(state)).toThrow('State expired')
    })

    it('rejects malformed state with no "." separator', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      const { verifyState } = await import('./crypto.js')
      expect(() => verifyState('not-a-valid-state-string')).toThrow('Malformed state')
    })

    it('rejects an empty state string', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', 'test-signing-secret')
      const { verifyState } = await import('./crypto.js')
      expect(() => verifyState('')).toThrow('Malformed state')
    })

    it('throws on signState when STATE_SIGNING_SECRET is not set', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', undefined)
      const { signState } = await import('./crypto.js')
      expect(() => signState('user-123')).toThrow('STATE_SIGNING_SECRET is not set')
    })

    it('throws on verifyState when STATE_SIGNING_SECRET is not set', async () => {
      vi.stubEnv('STATE_SIGNING_SECRET', undefined)
      const { verifyState } = await import('./crypto.js')
      expect(() => verifyState('a.b')).toThrow('STATE_SIGNING_SECRET is not set')
    })
  })
})
