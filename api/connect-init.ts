import { verifyUser, supabaseAdmin } from './_lib/supabaseAdmin.js'
import { encrypt } from './_lib/crypto.js'

export const config = { runtime: 'nodejs' }

const VALID_SOURCES = ['garmin', 'zepp']
const PENDING_COOLDOWN_SECONDS = 60

// POST /api/connect-init { source, email, password } — the password-based
// handshake (Garmin, Zepp). The actual login never happens here: this
// function only encrypts the credentials into a short-lived pending_logins
// row and triggers a GitHub Actions job to do the real work, because a live
// Garmin/Zepp login is slow, flaky, and depends on heavy libraries that
// don't belong in a public-facing serverless function (see plan doc).
//
// Rate limiting, evaluated 2026-09-01: this endpoint requires a real,
// verifyUser()-authenticated Supabase session, and Auth "Confirm email" is
// ON (CLAUDE.md resume checklist item 3) — so abuse needs a real, confirmed
// email address per attempt, not just an anonymous request. The realistic
// remaining abuse path is a bad actor signing up several throwaway accounts
// (each resetting the per-user PENDING_COOLDOWN_SECONDS below) to burn
// GitHub Actions minutes on doomed connects and risk getting the shared
// Garmin-facing IP flagged by Garmin's anti-automation systems. That needs
// a dimension that survives a new account — IP address, or a global daily
// ceiling — to actually stop it.
// Deliberately NOT building either yet:
//   - A global daily ceiling is simple but blunt: at current scale (a
//     handful of real users, per CLAUDE.md) one legitimate user retrying a
//     mistyped password a few times could exhaust it and lock out every
//     other user's connect attempts for the rest of the day — a shared-fate
//     failure mode worse than the gap it closes.
//   - Real IP-based limiting (new table + migration + parsing Vercel's
//     x-forwarded-for) is the correct fix but is real new infrastructure
//     with an ongoing maintenance cost (stale-row cleanup, header-spoofing
//     edge cases), not justified yet against a threat that hasn't actually
//     been observed — email-confirmation-gated signup is already real
//     friction against casual abuse.
// Revisit if: GitHub Actions minutes usage shows an unexplained spike, if
// Garmin's account or the shared egress IP gets flagged/rate-limited, or if
// real user count grows enough that "a handful" no longer describes it.
export default {
  async fetch(request: Request): Promise<Response> {
    return handleConnectInit(request)
  },
}

async function handleConnectInit(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const admin = supabaseAdmin()

  try {
    const userId = await verifyUser(request)
    const body = (await request.json()) as { source?: string; email?: string; password?: string }
    const { source, email, password } = body

    if (!source || !VALID_SOURCES.includes(source)) throw new Error('Invalid source')
    if (!email || !password) throw new Error('Email and password are required')

    // Basic anti-spam: refuse if a pending attempt for this (user, source) is still fresh.
    const { data: recentPending } = await admin
      .from('pending_logins')
      .select('created_at')
      .eq('user_id', userId)
      .eq('source', source)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (recentPending) {
      const ageSeconds = (Date.now() - new Date(recentPending.created_at as string).getTime()) / 1000
      if (ageSeconds < PENDING_COOLDOWN_SECONDS) {
        throw new Error('A connection attempt is already in progress — please wait a minute and try again')
      }
    }

    const encryptedCredentials = encrypt(JSON.stringify({ email, password }))

    const { data: pendingRow, error: insertError } = await admin
      .from('pending_logins')
      .insert({ user_id: userId, source, encrypted_credentials: encryptedCredentials })
      .select('id')
      .single()

    if (insertError || !pendingRow) throw new Error('Failed to create pending login')

    await admin
      .from('connection_status')
      .upsert({ user_id: userId, source, status: 'pending', last_error: null }, { onConflict: 'user_id,source' })

    await dispatchConnectWorkflow(pendingRow.id as string, source)

    return new Response(JSON.stringify({ loginId: pendingRow.id }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 400 })
  }
}

async function dispatchConnectWorkflow(loginId: string, source: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY // "sladerose/Hybrid"
  const pat = process.env.GH_PAT
  if (!repo || !pat) throw new Error('GitHub dispatch env vars not set')

  const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/connect.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { login_id: loginId, source } }),
  })

  if (!resp.ok) {
    throw new Error(`Failed to trigger connect workflow: ${resp.status}`)
  }
}
