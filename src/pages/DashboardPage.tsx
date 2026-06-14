import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
  bodyBatteryColor, rhrColor, sleepColor, stressColor,
  vigorousMinsColor, vigorousMinsBg,
} from '../lib/rag'

// ── Types ────────────────────────────────────────────────────────────────────

type ReadinessRow = {
  date: string
  user_id: string
  resting_hr: number | null
  last_7_days_avg_resting_hr: number | null
  avg_stress: number | null
  body_battery_highest: number | null
  body_battery_current: number | null
  sleep_hours: string | null
  sleep_deep_percent: string | null
  sleep_rem_percent: string | null
  bb_score: number | null
  stress_score: number | null
  sleep_score: string | null
  readiness_score: string | null
  readiness_signal: 'green' | 'amber' | 'red' | null
}

type WeekRow = {
  this_week: string
  user_id: string
  avg_rhr: string | null
  avg_stress: string | null
  avg_sleep: string | null
  avg_bb_high: string | null
  run_count: number | null
  gym_count: number | null
  run_km: string | null
  total_vigorous_min: number | null
  total_moderate_min: number | null
  rhr_delta: string | null
  stress_delta: string | null
  sleep_delta: string | null
  bb_delta: string | null
  run_km_delta: string | null
}

type HeatmapRow = {
  date: string
  total_steps: number | null
  vigorous_intensity_minutes: number | null
  active_calories: number | null
  activity_count: number | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const x = Number(v)
  return isNaN(x) ? null : x
}

function fmt(v: string | number | null | undefined, dec = 1): string {
  const x = n(v)
  if (x == null) return '--'
  return x.toFixed(dec)
}

function delta(v: string | number | null, higherIsBetter = true): { text: string; color: string } | null {
  const x = n(v)
  if (x == null) return null
  const good = higherIsBetter ? x > 0 : x < 0
  const sign = x > 0 ? '+' : ''
  return {
    text: `${sign}${x.toFixed(1)}`,
    color: good ? 'text-emerald-400' : 'text-red-400',
  }
}

// ── UI atoms ─────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-2">
      {children}
    </p>
  )
}

function BigNum({
  value,
  unit,
  accent,
}: {
  value: string | number | null | undefined
  unit?: string
  accent: string
}) {
  return (
    <p className={`text-2xl font-semibold ${accent}`}>
      {value ?? '--'}
      {unit && <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>}
    </p>
  )
}

// ── Signal card ───────────────────────────────────────────────────────────────

function SignalCard({
  label,
  value,
  unit,
  accent,
  sub,
  deltaVal,
}: {
  label: string
  value: string | number | null | undefined
  unit?: string
  accent: string
  sub?: string
  deltaVal?: ReturnType<typeof delta>
}) {
  return (
    <Card>
      <Label>{label}</Label>
      <BigNum value={value} unit={unit} accent={accent} />
      <div className="mt-1 space-y-0.5">
        {deltaVal && (
          <p className={`text-xs font-medium ${deltaVal.color}`}>{deltaVal.text} vs 7d avg</p>
        )}
        {sub && <p className="text-xs text-gray-500 leading-tight">{sub}</p>}
      </div>
    </Card>
  )
}

// ── Week metric ───────────────────────────────────────────────────────────────

function WeekCard({
  label,
  value,
  unit,
  accent,
  sub,
  progress,
  barColor,
}: {
  label: string
  value: string | number | null | undefined
  unit?: string
  accent: string
  sub?: string
  progress?: number
  barColor?: string
}) {
  return (
    <Card>
      <Label>{label}</Label>
      <BigNum value={value} unit={unit} accent={accent} />
      {progress !== undefined && (
        <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor ?? 'bg-blue-500'}`}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
      )}
      {sub && <p className="text-xs text-gray-500 mt-1 leading-tight">{sub}</p>}
    </Card>
  )
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

type HeatmapMode = 'steps' | 'calories' | 'vigorous' | 'count'

const HEATMAP_MODES: Record<
  HeatmapMode,
  {
    label: string
    getValue: (r: HeatmapRow) => number | null
    thresholds: number[]
    colors: string[]
    legendMax: string
  }
> = {
  steps: {
    label: 'Steps',
    getValue: (r) => r.total_steps,
    thresholds: [3000, 5000, 7500, 10000],
    colors: ['#0f172a', '#1e3a5f', '#1e40af', '#2563eb', '#3b82f6', '#60a5fa'],
    legendMax: '10k',
  },
  calories: {
    label: 'Calories',
    getValue: (r) => r.active_calories,
    thresholds: [100, 250, 400, 600],
    colors: ['#0f172a', '#451a03', '#92400e', '#b45309', '#d97706', '#fbbf24'],
    legendMax: '600+',
  },
  vigorous: {
    label: 'Vigorous min',
    getValue: (r) => r.vigorous_intensity_minutes,
    thresholds: [5, 15, 30, 45],
    colors: ['#0f172a', '#052e16', '#14532d', '#15803d', '#16a34a', '#4ade80'],
    legendMax: '45min',
  },
  count: {
    label: 'Activities',
    getValue: (r) => r.activity_count,
    thresholds: [1, 2, 3, 4],
    colors: ['#0f172a', '#1e1b4b', '#3730a3', '#4f46e5', '#6366f1', '#a5b4fc'],
    legendMax: '4+',
  },
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ActivityHeatmap({ data, today }: { data: HeatmapRow[]; today: string }) {
  const [mode, setMode] = useState<HeatmapMode>('steps')
  const cfg = HEATMAP_MODES[mode]

  const byDate = new Map(data.map((r) => [r.date, r]))

  const end = new Date(today + 'T12:00:00')
  const start = new Date(today + 'T12:00:00')
  start.setDate(start.getDate() - 269)
  start.setDate(start.getDate() - start.getDay()) // back to Sunday

  const weeks: string[][] = []
  const cur = new Date(start)
  while (cur <= end) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      week.push(localDateStr(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  function level(row: HeatmapRow | undefined): number {
    if (!row) return 0
    const v = cfg.getValue(row)
    if (!v) return 0
    for (let i = 0; i < cfg.thresholds.length; i++) {
      if (v < cfg.thresholds[i]) return i + 1
    }
    return cfg.colors.length - 1
  }

  const BUTTONS: { key: HeatmapMode; label: string }[] = [
    { key: 'steps', label: 'Steps' },
    { key: 'calories', label: 'Calories' },
    { key: 'vigorous', label: 'Vigorous' },
    { key: 'count', label: 'Activities' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">
            Activity Heatmap
          </p>
          <p className="text-[11px] text-gray-600 mt-0.5">270 days</p>
        </div>
        <div className="flex gap-1">
          {BUTTONS.map((b) => (
            <button
              key={b.key}
              onClick={() => setMode(b.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                mode === b.key
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-[2px] min-w-max">
          <div className="flex flex-col gap-[3px] mr-1 pt-5">
            {['', 'M', '', 'W', '', 'F', ''].map((l, i) => (
              <div
                key={i}
                className="h-[11px] text-[9px] text-gray-600 leading-[11px] w-3 text-right pr-1"
              >
                {l}
              </div>
            ))}
          </div>

          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              <div className="h-5 text-[9px] text-gray-600 leading-5">
                {wi % 4 === 0
                  ? format(parseISO(week[0] + 'T00:00:00'), 'MMM')
                  : ''}
              </div>
              {week.map((date) => {
                const row = byDate.get(date)
                const lv = level(row)
                const val = row ? cfg.getValue(row) : null
                return (
                  <div
                    key={date}
                    title={
                      row && val != null
                        ? `${date}: ${val.toLocaleString()} ${cfg.label}`
                        : date
                    }
                    className="w-[11px] h-[11px] rounded-[2px] cursor-default hover:opacity-70 transition-opacity"
                    style={{ backgroundColor: cfg.colors[lv] }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-1 mt-2 justify-end">
        <span className="text-[10px] text-gray-600 mr-1">Low</span>
        {cfg.colors.map((c, i) => (
          <div key={i} className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: c }} />
        ))}
        <span className="text-[10px] text-gray-600 ml-1">{cfg.legendMax}</span>
      </div>
    </div>
  )
}

// ── Readiness badge config ────────────────────────────────────────────────────

const SIGNAL_CONFIG = {
  green: { label: 'Ready', color: '#10b981', border: 'border-emerald-700' },
  amber: { label: 'Take it easy', color: '#f59e0b', border: 'border-amber-700' },
  red: { label: 'Rest day', color: '#ef4444', border: 'border-red-800' },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const [readiness, setReadiness] = useState<ReadinessRow | null>(null)
  const [week, setWeek] = useState<WeekRow | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    const uid = user.id

    Promise.all([
      supabase
        .from('v_readiness_daily')
        .select('*')
        .eq('user_id', uid)
        .order('date', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('v_week_comparison')
        .select('*')
        .eq('user_id', uid)
        .single(),
      supabase
        .from('v_daily_activity_heatmap')
        .select('date,total_steps,vigorous_intensity_minutes,active_calories,activity_count')
        .eq('user_id', uid)
        .order('date', { ascending: false })
        .limit(270),
    ]).then(([r, w, h]) => {
      if (r.error && r.error.code !== 'PGRST116') setError(r.error.message)
      setReadiness(r.data ?? null)
      setWeek(w.data ?? null)
      setHeatmap(h.data ?? [])
      setLoading(false)
    })
  }, [user])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 rounded-full border-2 border-gray-700 border-t-gray-300 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    )
  }

  const sig = readiness?.readiness_signal
    ? SIGNAL_CONFIG[readiness.readiness_signal]
    : null

  const rhrDelta = delta(
    readiness?.resting_hr != null && readiness?.last_7_days_avg_resting_hr != null
      ? readiness.resting_hr - readiness.last_7_days_avg_resting_hr
      : null,
    false, // lower RHR is better
  )

  const vigMin = n(week?.total_vigorous_min) ?? 0
  const vigProgress = (vigMin / 150) * 100

  const today = readiness?.date ?? localDateStr(new Date())

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {readiness?.date
              ? format(parseISO(readiness.date), 'EEEE, d MMMM yyyy')
              : format(new Date(), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        {sig && (
          <div
            className={`px-3 py-1 rounded-lg border text-xs font-semibold tracking-wide ${sig.border}`}
            style={{ color: sig.color }}
          >
            {sig.label}
          </div>
        )}
      </div>

      {/* Signal cards */}
      <div>
        <p className="text-[10px] font-medium text-gray-600 uppercase tracking-widest mb-2">
          Today
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SignalCard
            label="Body Battery"
            value={readiness?.body_battery_highest ?? '--'}
            accent={bodyBatteryColor(readiness?.body_battery_highest)}
            sub={`Low ${readiness?.body_battery_current ?? '--'} · peak today`}
          />
          <SignalCard
            label="Sleep"
            value={fmt(readiness?.sleep_hours)}
            unit="hrs"
            accent={sleepColor(n(readiness?.sleep_hours))}
            sub={
              readiness?.sleep_deep_percent != null
                ? `Deep ${fmt(readiness.sleep_deep_percent, 0)}% · REM ${fmt(readiness.sleep_rem_percent, 0)}%`
                : undefined
            }
          />
          <SignalCard
            label="Resting HR"
            value={readiness?.resting_hr ?? '--'}
            unit="bpm"
            accent={rhrColor(readiness?.resting_hr)}
            deltaVal={rhrDelta ?? undefined}
            sub={`7d avg ${readiness?.last_7_days_avg_resting_hr ?? '--'} bpm`}
          />
          <SignalCard
            label="Stress"
            value={readiness?.avg_stress ?? '--'}
            accent={stressColor(readiness?.avg_stress)}
            sub={
              readiness?.readiness_score != null
                ? `Readiness score ${fmt(readiness.readiness_score, 0)}`
                : undefined
            }
          />
        </div>
      </div>

      {/* Week at a glance */}
      <div>
        <p className="text-[10px] font-medium text-gray-600 uppercase tracking-widest mb-2">
          This week
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <WeekCard
            label="Running"
            value={
              week?.run_count != null && week.run_km != null
                ? `${week.run_count} run${week.run_count !== 1 ? 's' : ''}`
                : week?.run_count ?? '--'
            }
            accent="text-blue-400"
            sub={week?.run_km ? `${fmt(week.run_km, 1)} km total` : undefined}
          />
          <WeekCard
            label="Gym sessions"
            value={week?.gym_count ?? '--'}
            accent="text-orange-400"
            sub={week?.gym_count != null ? `session${week.gym_count !== 1 ? 's' : ''} this week` : undefined}
          />
          <WeekCard
            label="Vigorous mins"
            value={vigMin}
            unit="min"
            accent={vigorousMinsColor(vigMin)}
            progress={vigProgress}
            barColor={vigorousMinsBg(vigMin)}
            sub={`of 150 min target${vigMin >= 150 ? ' ✓' : ''}`}
          />
          <WeekCard
            label="Avg sleep"
            value={fmt(week?.avg_sleep)}
            unit="hrs"
            accent={sleepColor(n(week?.avg_sleep))}
            sub={
              week?.sleep_delta
                ? (() => {
                    const d = delta(week.sleep_delta, true)
                    return d ? `${d.text} hrs vs last week` : undefined
                  })()
                : undefined
            }
          />
        </div>
      </div>

      {/* Activity heatmap */}
      <Card>
        <ActivityHeatmap data={heatmap} today={today} />
      </Card>
    </div>
  )
}
