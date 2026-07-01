// AES-256-GCM encrypt/decrypt for credential payloads. Payloads cross the
// Node (Vercel) / Python (GitHub Actions) boundary, so this matches the
// wire format used by app/scripts/crypto_utils.py exactly:
//   base64( 12-byte nonce || ciphertext || 16-byte GCM tag )
// Key: CREDENTIAL_ENCRYPTION_KEY env var, base64-encoded 32 raw bytes.

import { randomBytes, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto'

function getKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!raw) throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes')
  return key
}

export function encrypt(plaintext: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, tag]).toString('base64')
}

export function decrypt(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64')
  const nonce = raw.subarray(0, 12)
  const tag = raw.subarray(raw.length - 16)
  const ciphertext = raw.subarray(12, raw.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

// Strava OAuth state signing — separate secret from CREDENTIAL_ENCRYPTION_KEY
// on purpose (unforgeability + short-lived integrity, not confidentiality;
// keeps the two keys' rotation independent).

interface StravaState {
  userId: string
  exp: number // unix seconds
}

export function signState(userId: string): string {
  const secret = process.env.STATE_SIGNING_SECRET
  if (!secret) throw new Error('STATE_SIGNING_SECRET is not set')
  const exp = Math.floor(Date.now() / 1000) + 300 // 5 min
  const state: StravaState = { userId, exp }
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyState(state: string): string {
  const secret = process.env.STATE_SIGNING_SECRET
  if (!secret) throw new Error('STATE_SIGNING_SECRET is not set')
  const [payload, sig] = state.split('.')
  if (!payload || !sig) throw new Error('Malformed state')

  const expectedSig = createHmac('sha256', secret).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Invalid state signature')

  const { userId, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as StravaState
  if (Math.floor(Date.now() / 1000) > exp) throw new Error('State expired')
  return userId
}
