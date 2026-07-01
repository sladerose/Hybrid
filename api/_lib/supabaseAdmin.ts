import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Verifies the caller's Supabase session JWT server-side and returns the
// authoritative user_id. Never trust a client-supplied user_id instead.
export async function verifyUser(request: Request): Promise<string> {
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('Missing Authorization header')

  const { data, error } = await supabaseAdmin().auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid or expired session')
  return data.user.id
}
