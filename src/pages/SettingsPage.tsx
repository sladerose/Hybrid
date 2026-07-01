import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import ConnectionCard, { type ConnectionStatusValue } from '../components/ConnectionCard'

type Source = 'garmin' | 'strava' | 'zepp'
type PasswordSource = 'garmin' | 'zepp'

interface StatusEntry {
  status: ConnectionStatusValue
  last_synced_at: string | null
  last_error: string | null
}

type StatusMap = Record<Source, StatusEntry>

const SOURCES: { key: Source; label: string }[] = [
  { key: 'garmin', label: 'Garmin' },
  { key: 'strava', label: 'Strava' },
  { key: 'zepp', label: 'Zepp' },
]

const EMPTY_ENTRY: StatusEntry = { status: 'not_connected', last_synced_at: null, last_error: null }

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 60000

const PASSWORD_MODAL_HELP: Record<PasswordSource, string> = {
  garmin:
    "Use your connect.garmin.com email + password login — not \"Sign in with Google/Facebook.\" " +
    'Accounts created via social login have no password we can use here.',
  zepp:
    'Use your Zepp/Huami account email or phone + password — not "Sign in with Google/Apple" ' +
    'in the Zepp Life app. Social-login accounts have no password we can use here.',
}

const STRAVA_BANNER: Record<string, string> = {
  connected: 'Strava connected.',
  denied: 'Strava connection was declined.',
  error: 'Strava connection failed — please try again.',
  invalid_state: 'That Strava link expired — please try again.',
}

export default function SettingsPage() {
  const { user, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statuses, setStatuses] = useState<StatusMap>({
    garmin: EMPTY_ENTRY,
    strava: EMPTY_ENTRY,
    zepp: EMPTY_ENTRY,
  })
  const [loading, setLoading] = useState(true)
  const [connectingSource, setConnectingSource] = useState<PasswordSource | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [initInFlight, setInitInFlight] = useState<Source | null>(null)

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatuses = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('connection_status')
      .select('source, status, last_synced_at, last_error')
      .eq('user_id', user.id)

    const next: StatusMap = { garmin: EMPTY_ENTRY, strava: EMPTY_ENTRY, zepp: EMPTY_ENTRY }
    for (const row of data ?? []) {
      next[row.source as Source] = {
        status: row.status as ConnectionStatusValue,
        last_synced_at: row.last_synced_at,
        last_error: row.last_error,
      }
    }
    setStatuses(next)
    return next
  }, [user])

  useEffect(() => {
    fetchStatuses().finally(() => setLoading(false))
  }, [fetchStatuses])

  useEffect(() => {
    const bannerKey = searchParams.get('strava')
    if (bannerKey) {
      fetchStatuses()
      const params = new URLSearchParams(searchParams)
      params.delete('strava')
      setSearchParams(params, { replace: true })
    }
    // Only react to the initial redirect param, not every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stravaBanner = searchParams.get('strava')

  const startPolling = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current)
    const startedAt = Date.now()
    pollTimer.current = setInterval(async () => {
      const next = await fetchStatuses()
      const stillPending = next && Object.values(next).some((s) => s.status === 'pending')
      if (!stillPending || Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollTimer.current) clearInterval(pollTimer.current)
      }
    }, POLL_INTERVAL_MS)
  }, [fetchStatuses])

  useEffect(() => () => {
    if (pollTimer.current) clearInterval(pollTimer.current)
  }, [])

  async function handleConnect(source: Source) {
    if (source === 'strava') {
      setInitInFlight('strava')
      try {
        const resp = await fetch('/api/strava-init', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error ?? 'Failed to start Strava connection')
        window.location.href = data.url
      } catch (e) {
        setInitInFlight(null)
        setStatuses((prev) => ({
          ...prev,
          strava: { ...prev.strava, status: 'needs_reauth', last_error: e instanceof Error ? e.message : 'Unknown error' },
        }))
      }
      return
    }
    setConnectingSource(source)
    setEmail('')
    setPassword('')
    setModalError(null)
  }

  async function handleModalSubmit(e: FormEvent) {
    e.preventDefault()
    if (!connectingSource) return
    setSubmitting(true)
    setModalError(null)
    try {
      const resp = await fetch('/api/connect-init', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ source: connectingSource, email, password }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error ?? 'Failed to start connection')

      setStatuses((prev) => ({
        ...prev,
        [connectingSource]: { ...prev[connectingSource], status: 'pending', last_error: null },
      }))
      setConnectingSource(null)
      startPolling()
    } catch (e) {
      setModalError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisconnect(source: Source) {
    try {
      await fetch('/api/disconnect', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ source }),
      })
    } finally {
      fetchStatuses()
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Settings</h1>
      <p className="text-sm text-gray-500 mb-6">Connected data sources</p>

      {stravaBanner && (
        <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 text-gray-700 dark:text-gray-300">
          {STRAVA_BANNER[stravaBanner] ?? 'Strava connection updated.'}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : (
        <div className="space-y-3">
          {SOURCES.map(({ key, label }) => (
            <ConnectionCard
              key={key}
              label={label}
              status={statuses[key].status}
              lastSyncedAt={statuses[key].last_synced_at}
              lastError={statuses[key].last_error}
              connecting={initInFlight === key}
              onConnect={() => handleConnect(key)}
              onDisconnect={() => handleDisconnect(key)}
            />
          ))}
        </div>
      )}

      {connectingSource && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-50">
          <div className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1.5 capitalize">
              Connect {connectingSource}
            </h2>
            <p className="text-xs text-gray-500 mb-4">{PASSWORD_MODAL_HELP[connectingSource]}</p>
            <form onSubmit={handleModalSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors"
                />
              </div>

              {modalError && <p className="text-xs text-red-400">{modalError}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setConnectingSource(null)}
                  className="flex-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 py-2 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors cursor-pointer"
                >
                  {submitting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
