import type { ReactNode } from 'react'

// Standardizes the 3 inconsistent visibility patterns found across the
// dashboard (chart-level `if (!data.length) return null`, page-level
// `{arr.length > 0 && (...)}`, and several charts with no guard at all that
// rendered a broken/blank shell on empty data). Wrap any card whose content
// depends on a fetched array — it disappears cleanly when the connected
// source(s) don't produce that data category, instead of every card author
// re-deriving the same empty check.
export function DataGate<T>({
  rows,
  minLength = 1,
  fallback = null,
  children,
}: {
  rows: T[] | null | undefined
  minLength?: number
  fallback?: ReactNode
  children: ReactNode
}) {
  if (!rows || rows.length < minLength) return <>{fallback}</>
  return <>{children}</>
}
