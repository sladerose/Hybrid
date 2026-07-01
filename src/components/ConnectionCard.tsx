export type ConnectionStatusValue = 'not_connected' | 'pending' | 'connected' | 'needs_reauth'

interface ConnectionCardProps {
  label: string
  status: ConnectionStatusValue
  lastSyncedAt: string | null
  lastError: string | null
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

const STATUS_STYLES: Record<ConnectionStatusValue, { badge: string; text: string }> = {
  not_connected: { badge: 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400', text: 'Not connected' },
  pending: { badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400', text: 'Connecting...' },
  connected: { badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400', text: 'Connected' },
  needs_reauth: { badge: 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400', text: 'Needs reauth' },
}

export default function ConnectionCard({
  label,
  status,
  lastSyncedAt,
  lastError,
  connecting,
  onConnect,
  onDisconnect,
}: ConnectionCardProps) {
  const style = STATUS_STYLES[status]
  const isConnectedOrStale = status === 'connected' || status === 'needs_reauth'

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">{label}</h3>
          <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${style.badge}`}>{style.text}</span>
        </div>
        {status === 'connected' && lastSyncedAt && (
          <p className="text-xs text-gray-500 mt-1">Last synced {new Date(lastSyncedAt).toLocaleString()}</p>
        )}
        {status === 'needs_reauth' && lastError && (
          <p className="text-xs text-red-400 mt-1 truncate">{lastError}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {isConnectedOrStale ? (
          <>
            {status === 'needs_reauth' && (
              <button
                onClick={onConnect}
                disabled={connecting}
                className="text-xs text-blue-500 hover:text-blue-400 disabled:opacity-50 cursor-pointer"
              >
                Reconnect
              </button>
            )}
            <button
              onClick={onDisconnect}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-pointer"
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={onConnect}
            disabled={connecting || status === 'pending'}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            {status === 'pending' ? 'Connecting...' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  )
}
