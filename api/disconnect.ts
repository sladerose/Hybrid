import { verifyUser, supabaseAdmin } from './_lib/supabaseAdmin.js'

export const config = { runtime: 'nodejs' }

const VALID_SOURCES = ['garmin', 'strava', 'zepp']

// POST /api/disconnect { source } — deletes the credential row and resets
// connection_status. Not just a status flip: "delete my data" needs a real
// path for an eventual open-core/public product.
export default {
  async fetch(request: Request): Promise<Response> {
    return handleDisconnect(request)
  },
}

async function handleDisconnect(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const userId = await verifyUser(request)
    const body = (await request.json()) as { source?: string }
    const source = body.source

    if (!source || !VALID_SOURCES.includes(source)) {
      throw new Error('Invalid source')
    }

    const admin = supabaseAdmin()

    await admin.from('user_credentials').delete().eq('user_id', userId).eq('source', source)

    await admin
      .from('connection_status')
      .upsert(
        { user_id: userId, source, status: 'not_connected', last_error: null, last_synced_at: null },
        { onConflict: 'user_id,source' },
      )

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 400 })
  }
}
