import { verifyUser } from './_lib/supabaseAdmin.js'
import { signState } from './_lib/crypto.js'

export const config = { runtime: 'nodejs' }

// GET /api/strava-init — verifies the caller's session, builds a signed
// short-lived state param, returns the Strava OAuth authorize URL.
export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const userId = await verifyUser(request)

    const clientId = process.env.STRAVA_CLIENT_ID
    const redirectUri = process.env.STRAVA_REDIRECT_URI
    if (!clientId || !redirectUri) throw new Error('Strava OAuth env vars not set')

    const authorizeUrl = new URL('https://www.strava.com/oauth/authorize')
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('approval_prompt', 'auto')
    authorizeUrl.searchParams.set('scope', 'activity:read_all')
    authorizeUrl.searchParams.set('state', signState(userId))

    return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 401 })
  }
}
