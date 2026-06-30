import { useEffect, useState } from 'react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useChartTheme } from '../lib/chartTheme'
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
  heart_score: number | null
  activity_score: number | null
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
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 ${className}`}>
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
        <div className="mt-2 h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
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

// ── Readiness Radar ───────────────────────────────────────────────────────────

const RADAR_SIGNAL: Record<string, string> = {
  green: '#10b981',
  amber: '#f59e0b',
  red:   '#ef4444',
}

function ReadinessRadar({
  readiness,
  week,
}: {
  readiness: ReadinessRow | null
  week: WeekRow | null
}) {
  const { GRID, TICK } = useChartTheme()

  const sig       = readiness?.readiness_signal ?? 'amber'
  const fillColor = RADAR_SIGNAL[sig] ?? '#f59e0b'
  const sigLabel  = sig === 'green' ? 'Ready' : sig === 'red' ? 'Rest day' : 'Take it easy'

  const axes = [
    { axis: 'Sleep',    score: Math.round(n(readiness?.sleep_score)    ?? 0) },
    { axis: 'Recovery', score: Math.round(n(readiness?.bb_score)       ?? 0) },
    { axis: 'Heart',    score: Math.round(n(readiness?.heart_score)    ?? 0) },
    { axis: 'Stress',   score: Math.round(n(readiness?.stress_score)   ?? 0) },
    { axis: 'Activity', score: Math.round(n(readiness?.activity_score) ?? 0) },
  ]

  const overallScore = Math.round(n(readiness?.readiness_score) ?? 0)

  function axisBarColor(score: number): string {
    if (score >= 70) return '#10b981'
    if (score >= 50) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <Card>
      <div className="flex flex-col lg:flex-row gap-2 lg:gap-6">

        {/* Radar chart */}
        <div className="w-full lg:w-[220px] h-[200px] flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={axes} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
              <PolarGrid stroke={GRID} />
              <PolarAngleAxis
                dataKey="axis"
                tick={{ fontSize: 10, fill: TICK.fill, fontWeight: 500 }}
              />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                dataKey="score"
                stroke={fillColor}
                fill={fillColor}
                fillOpacity={0.22}
                strokeWidth={2}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Score breakdown */}
        <div className="flex-1 flex flex-col justify-center">
          {/* Overall */}
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-bold tabular-nums" style={{ color: fillColor }}>
              {overallScore || '--'}
            </span>
            <div>
              <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">Readiness</p>
              <p className="text-[11px] font-semibold" style={{ color: fillColor }}>{sigLabel}</p>
            </div>
          </div>

          {/* Axis bars */}
          <div className="space-y-2.5">
            {axes.map(a => (
              <div key={a.axis}>
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">{a.axis}</span>
                  <span className="text-[11px] font-medium tabular-nums text-gray-700 dark:text-gray-300">{a.score}</span>
                </div>
                <div className="h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${a.score}%`, backgroundColor: axisBarColor(a.score) }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ── Week vs Last Week ─────────────────────────────────────────────────────────

function WeekComparison({ week }: { week: WeekRow | null }) {
  if (!week) return null

  const metrics: {
    label: string
    value: string | number | null
    unit: string
    deltaVal: string | null
    higherIsBetter: boolean
    accent: string
  }[] = [
    { label: 'Avg RHR',    value: fmt(week.avg_rhr, 0),   unit: 'bpm', deltaVal: week.rhr_delta,    higherIsBetter: false, accent: 'text-red-400' },
    { label: 'Avg Stress', value: fmt(week.avg_stress, 0), unit: '',    deltaVal: week.stress_delta,  higherIsBetter: false, accent: 'text-amber-400' },
    { label: 'BB High',    value: fmt(week.avg_bb_high, 0),unit: '',    deltaVal: week.bb_delta,      higherIsBetter: true,  accent: 'text-emerald-400' },
    { label: 'Avg Sleep',  value: fmt(week.avg_sleep, 1),  unit: 'h',   deltaVal: week.sleep_delta,   higherIsBetter: true,  accent: 'text-purple-400' },
    { label: 'Run km',     value: fmt(week.run_km, 1),     unit: 'km',  deltaVal: week.run_km_delta,  higherIsBetter: true,  accent: 'text-blue-400' },
  ]

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">This week vs last week</p>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {metrics.map((m) => {
          const d = delta(m.deltaVal, m.higherIsBetter)
          return (
            <div key={m.label} className="text-center">
              <p className="text-[10px] text-gray-500 mb-1 truncate">{m.label}</p>
              <p className={`text-lg font-semibold tabular-nums ${m.accent}`}>
                {m.value}
                {m.unit && <span className="text-[10px] font-normal text-gray-500 ml-0.5">{m.unit}</span>}
              </p>
              {d ? (
                <p className={`text-[11px] font-medium mt-0.5 ${d.color}`}>{d.text}</p>
              ) : (
                <p className="text-[11px] text-gray-600 mt-0.5">--</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

type HeatmapMode = 'steps' | 'calories' | 'vigorous' | 'count'

type HeatmapConfig = {
  label: string
  getValue: (r: HeatmapRow) => number | null
  thresholds: number[]
  darkColors: string[]
  lightColors: string[]
  legendMax: string
}

const HEATMAP_MODES: Record<HeatmapMode, HeatmapConfig> = {
  steps: {
    label: 'Steps',
    getValue: (r) => r.total_steps,
    thresholds: [3000, 5000, 7500, 10000],
    darkColors: ['#1e293b', '#1e3a5f', '#1e40af', '#2563eb', '#3b82f6', '#60a5fa'],
    lightColors: ['#f1f5f9', '#dbeafe', '#93c5fd', '#3b82f6', '#2563eb', '#1d4ed8'],
    legendMax: '10k',
  },
  calories: {
    label: 'Calories',
    getValue: (r) => r.active_calories,
    thresholds: [100, 250, 400, 600],
    darkColors: ['#1e293b', '#451a03', '#92400e', '#b45309', '#d97706', '#fbbf24'],
    lightColors: ['#f1f5f9', '#fef9c3', '#fde047', '#f59e0b', '#d97706', '#b45309'],
    legendMax: '600+',
  },
  vigorous: {
    label: 'Vigorous min',
    getValue: (r) => r.vigorous_intensity_minutes,
    thresholds: [5, 15, 30, 45],
    darkColors: ['#1e293b', '#052e16', '#14532d', '#15803d', '#16a34a', '#4ade80'],
    lightColors: ['#f1f5f9', '#dcfce7', '#86efac', '#22c55e', '#16a34a', '#15803d'],
    legendMax: '45min',
  },
  count: {
    label: 'Activities',
    getValue: (r) => r.activity_count,
    thresholds: [1, 2, 3, 4],
    darkColors: ['#1e293b', '#1e1b4b', '#3730a3', '#4f46e5', '#6366f1', '#a5b4fc'],
    lightColors: ['#f1f5f9', '#ede9fe', '#c4b5fd', '#8b5cf6', '#7c3aed', '#6d28d9'],
    legendMax: '4+',
  },
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ActivityHeatmap({ data, today }: { data: HeatmapRow[]; today: string }) {
  const [mode, setMode] = useState<HeatmapMode>('steps')
  const { theme } = useTheme()
  const cfgBase = HEATMAP_MODES[mode]
  const cfg = {
    ...cfgBase,
    colors: theme === 'dark' ? cfgBase.darkColors : cfgBase.lightColors,
  }

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
                  ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                  : 'text-gray-500 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
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

// ── Weekly Coach ──────────────────────────────────────────────────────────────

function WeeklyCoach({
  insights,
  loading,
  error,
  generatedAt,
  onAnalyse,
}: {
  insights: string[] | null
  loading: boolean
  error: string | null
  generatedAt: string | null
  onAnalyse: () => void
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">Weekly Coach</p>
          <span className="text-[9px] font-semibold bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
            AI
          </span>
        </div>
        {insights && !loading && (
          <button
            onClick={onAnalyse}
            className="text-[11px] text-gray-500 hover:text-gray-300 dark:hover:text-gray-400 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2.5 py-3">
          <div className="w-4 h-4 rounded-full border-2 border-violet-400 border-t-transparent animate-spin flex-shrink-0" />
          <p className="text-sm text-gray-500">Analysing 14 days of data...</p>
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-red-400 py-2">{error}</p>
      )}

      {!loading && !insights && !error && (
        <div className="py-1">
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Get 3–4 personalised insights based on your last 14 days of recovery, runs, and training load.
          </p>
          <button
            onClick={onAnalyse}
            className="px-4 py-2 bg-violet-500 hover:bg-violet-400 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Analyse my week
          </button>
        </div>
      )}

      {!loading && insights && insights.length > 0 && (
        <ul className="space-y-2.5">
          {insights.map((insight, i) => (
            <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300 leading-snug">
              <span className="text-violet-400 flex-shrink-0 mt-0.5">•</span>
              <span>{insight}</span>
            </li>
          ))}
        </ul>
      )}

      {generatedAt && !loading && (
        <p className="text-[10px] text-gray-500 mt-3">
          Analysed {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
        </p>
      )}
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth()
  const [readiness, setReadiness] = useState<ReadinessRow | null>(null)
  const [week, setWeek] = useState<WeekRow | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [coachInsights, setCoachInsights] = useState<string[] | null>(null)
  const [coachLoading, setCoachLoading] = useState(false)
  const [coachError, setCoachError] = useState<string | null>(null)
  const [coachGeneratedAt, setCoachGeneratedAt] = useState<string | null>(null)

  async function analyseWeek() {
    setCoachLoading(true)
    setCoachError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('coach-insights')
      if (fnError) throw fnError
      if (data?.insights?.length > 0) {
        setCoachInsights(data.insights)
        setCoachGeneratedAt(data.generated_at)
      } else {
        setCoachError('No insights returned. Try again.')
      }
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : 'Failed to analyse. Try again.')
    } finally {
      setCoachLoading(false)
    }
  }

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
        <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin" />
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
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {readiness?.date
            ? format(parseISO(readiness.date), 'EEEE, d MMMM yyyy')
            : format(new Date(), 'EEEE, d MMMM yyyy')}
        </p>
      </div>

      {/* Readiness Radar */}
      <ReadinessRadar readiness={readiness} week={week} />

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

      {/* Week vs last week */}
      <WeekComparison week={week} />

      {/* Weekly AI Coach */}
      <WeeklyCoach
        insights={coachInsights}
        loading={coachLoading}
        error={coachError}
        generatedAt={coachGeneratedAt}
        onAnalyse={analyseWeek}
      />

      {/* Activity heatmap */}
      <Card>
        <ActivityHeatmap data={heatmap} today={today} />
      </Card>
    </div>
  )
}
