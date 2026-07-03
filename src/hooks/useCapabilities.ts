import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Wraps the connection_status query that used to live only inside
// SettingsPage, so any page can ask "is this source connected" without
// re-fetching it locally. Used for page/section-level empty states (e.g.
// "connect a body-comp source") — the finer-grained "connected but this
// specific metric has zero rows" case is <DataGate>'s job, not this hook's.
export function useCapabilities() {
  const { user } = useAuth()
  const [connected, setConnected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('connection_status')
      .select('source, status')
      .eq('user_id', user.id)
      .eq('status', 'connected')
      .then(({ data }) => {
        if (cancelled) return
        setConnected(new Set((data ?? []).map((r) => r.source as string)))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  return {
    loading,
    isConnected: (source: string) => connected.has(source),
    anyConnected: connected.size > 0,
    connectedSources: connected,
  }
}
