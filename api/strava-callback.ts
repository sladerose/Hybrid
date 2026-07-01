import { verifyState, encrypt } from './_lib/crypto.js'
import { supabaseAdmin } from './_lib/supabaseAdmin.js'

export const config = { runtime: 'nodejs' }

// GET /api/strava-callback — Strava redirects here after the user approves
// (or denies) access. No password involved, low risk, stays entirely in
// Vercel (unlike the Garmin/Zepp password handshake, which round-trips
// through GitHub Actions — see connect-init.ts).
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const deniedByUser = url.searchParams.get('error')

  const appUrl = process.env.APP_URL ?? ''
  const redirectTo = (path: string) => Response.redirect(`${appUrl}${path}`, 302)

  if (deniedByUser) {
    return redirectTo('/settings?strava=denied')
  }
  if (!code || !state) {
    return redirectTo('/settings?strava=error')
  }

  let userId: string
  try {
    userId = verifyState(state)
  } catch {
    return redirectTo('/settings?strava=invalid_state')
  }

  const admin = supabaseAdmin()

  try {
    const resp = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    })
    if (!resp.ok) throw new Error(`Strava token exchange failed: ${resp.status}`)

    const data = (await resp.json()) as { refresh_token?: string }
    if (!data.refresh_token) throw new Error('No refresh_token in Strava response')

    const encryptedPayload = encrypt(JSON.stringify({ refresh_token: data.refresh_token }))

    await admin
      .from('user_credentials')
      .upsert({ user_id: userId, source: 'strava', encrypted_payload: encryptedPayload }, { onConflict: 'user_id,source' })

    await admin
      .from('connection_status')
      .upsert(
        { user_id: userId, source: 'strava', status: 'connected', last_error: null },
        { onConflict: 'user_id,source' },
      )

    return redirectTo('/settings?strava=connected')
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    await admin
      .from('connection_status')
      .upsert(
        { user_id: userId, source: 'strava', status: 'needs_reauth', last_error: message },
        { onConflict: 'user_id,source' },
      )
    return redirectTo('/settings?strava=error')
  }
}
