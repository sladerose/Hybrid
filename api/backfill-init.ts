import { verifyUser, supabaseAdmin } from './_lib/supabaseAdmin.js'

export const config = { runtime: 'nodejs' }

const VALID_SOURCES = ['garmin', 'strava', 'zepp']
const BACKFILL_COOLDOWN_HOURS = 24
const BACKFILL_DAYS = 90

// POST /api/backfill-init { source } — self-serve "Resync" button on
// /settings. user_id always comes from the verified session, never the
// request body: this dispatches a real GitHub Actions job against
// production data, so a client-supplied id would let any signed-in user
// trigger a backfill for someone else's account.
//
// Cooldown exists because a backfill call is not cheap like a routine
// sync tick — it burns real quota against Strava's shared per-app rate
// limit (pooled across every user, not per-user) and against Garmin/Zepp's
// unofficial APIs. 24h per (user, source) means repeated clicks can't
// starve the app's shared budget. See backfill.yml / backfill_*.py.
export default {
  async fetch(request: Request): Promise<Response> {
    return handleBackfillInit(request)
  },
}

async function handleBackfillInit(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  try {
    const userId = await verifyUser(request)
    const body = (await request.json()) as { source?: string }
    const source = body.source

    if (!source || !VALID_SOURCES.includes(source)) throw new Error('Invalid source')

    const admin = supabaseAdmin()

    const { data: status } = await admin
      .from('connection_status')
      .select('status, last_backfill_requested_at')
      .eq('user_id', userId)
      .eq('source', source)
      .maybeSingle()

    if (!status || status.status !== 'connected') {
      throw new Error('Source must be connected before it can be resynced')
    }

    if (status.last_backfill_requested_at) {
      const hoursSince = (Date.now() - new Date(status.last_backfill_requested_at as string).getTime()) / 3_600_000
      if (hoursSince < BACKFILL_COOLDOWN_HOURS) {
        const hoursLeft = Math.ceil(BACKFILL_COOLDOWN_HOURS - hoursSince)
        throw new Error(`Resync already requested recently — try again in about ${hoursLeft}h`)
      }
    }

    await admin
      .from('connection_status')
      .update({ last_backfill_requested_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('source', source)

    await dispatchBackfillWorkflow(userId, source)

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 400 })
  }
}

async function dispatchBackfillWorkflow(userId: string, source: string): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY // "sladerose/Hybrid"
  const pat = process.env.GH_PAT
  if (!repo || !pat) throw new Error('GitHub dispatch env vars not set')

  const resp = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/backfill.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: { source, user_id: userId, days: String(BACKFILL_DAYS) },
    }),
  })

  if (!resp.ok) {
    throw new Error(`Failed to trigger backfill workflow: ${resp.status}`)
  }
}
