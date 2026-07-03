import { Card } from './Card'

// Consolidates the KpiCard/SignalCard/WeekCard variants that were
// byte-for-byte duplicated (KpiCard) or near-identical (SignalCard/WeekCard
// add deltaVal/progress) across RunningPage, BodyPage, StrengthPage, and
// DashboardPage. deltaVal/progress are optional so plain KPI usage is
// unchanged; pass them for the Dashboard's week-over-week / goal-progress
// cases.
export function MetricCard({
  label,
  value,
  unit,
  accent,
  sub,
  deltaVal,
  progress,
  barColor,
}: {
  label: string
  value: string | number | null | undefined
  unit?: string
  accent: string
  sub?: string
  deltaVal?: { text: string; color: string }
  progress?: number
  barColor?: string
}) {
  return (
    <Card>
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-semibold ${accent}`}>
        {value ?? '--'}
        {unit && <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
      {progress !== undefined && (
        <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor ?? 'bg-blue-500'}`}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      <div className="mt-1 space-y-0.5">
        {deltaVal && (
          <p className={`text-xs font-medium ${deltaVal.color}`}>{deltaVal.text} vs 7d avg</p>
        )}
        {sub && <p className="text-xs text-gray-500 leading-tight">{sub}</p>}
      </div>
    </Card>
  )
}
