import { useEffect, useState } from 'react'
import { format, parseISO, startOfWeek } from 'date-fns'
import {
  ComposedChart, LineChart, ScatterChart,
  Line, Bar, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { cadenceColor, run5kColor } from '../lib/rag'
import { useChartTheme } from '../lib/chartTheme'

// ── Types ─────────────────────────────────────────────────────────────────────

type RunRow = {
  activity_id: number
  start_date: string
  name: string
  distance_km: string | null
  duration_seconds: number | null
  pace_sec_per_km: string | null
  pace_formatted: string | null
  elevation_gain: number | null
  relative_effort: number | null
  avg_hr: number | null
  cadence_precise: string | null
  best_1k: number | null
  best_5k: number | null
  best_10k: number | null
  laps: Array<{ km: number; time: number; avg_hr?: number | null; max_hr?: number | null; elev?: number | null }> | null
}

type WeeklyRow = {
  week_start: string
  run_count: number | null
  run_km: string | null
  avg_run_hr: string | null
  avg_run_cadence: string | null
  run_elevation_gain: number | null
  workout_count: number | null
  avg_relative_effort: string | null
}

type GearRow = {
  id: string
  gear_type: string
  name: string
  brand: string | null
  model_name: string | null
  retired: boolean
  total_distance_meters: string | null
}

type ZoneRow = {
  hr_z1_max: number
  hr_z2_min: number; hr_z2_max: number
  hr_z3_min: number; hr_z3_max: number
  hr_z4_min: number; hr_z4_max: number
  hr_z5_min: number
  run_z1_max: string
  run_z2_max: string
  run_z3_max: string
  run_z4_max: string
  run_z5_max: string
}

type EffortRow = {
  id: number
  sport_type: string
  start_date: string
  relative_effort: number | null
  duration_seconds: number | null
}

// ── Training Plan Types & Data ───────────────────────────────────────────────

type WorkoutType = 'easy' | 'tempo' | 'intervals' | 'long' | 'race' | 'rest' | 'strides'

type PlanDay = {
  day: string
  date: string
  type: WorkoutType
  label: string
  km: number
  description?: string
}

type PlanWeek = {
  weekNum: number
  phase: 'Base' | 'Build' | 'Peak' | 'Taper' | 'Race'
  start: string
  days: PlanDay[]
}

const RACE_DATE = '2026-08-15'
const RACE_NAME = 'Garmin Run Series 10km'
const PLAN_TOTAL_DAYS = 54
// This race plan is hardcoded to Slade's own training block — not yet a
// per-user feature (see .planning/PRODUCT-STRATEGY.md Phase 3).
const SLADE_USER_ID = '4671de36-2274-4aa7-bf9c-d185336987c5'

const WORKOUT_STYLES: Record<WorkoutType, { dot: string; badge: string; text: string }> = {
  easy:      { dot: 'bg-blue-400',   badge: 'bg-blue-500/10 border-blue-500/30',     text: 'text-blue-400'   },
  long:      { dot: 'bg-purple-400', badge: 'bg-purple-500/10 border-purple-500/30', text: 'text-purple-400' },
  tempo:     { dot: 'bg-amber-400',  badge: 'bg-amber-500/10 border-amber-500/30',   text: 'text-amber-400'  },
  intervals: { dot: 'bg-red-400',    badge: 'bg-red-500/10 border-red-500/30',       text: 'text-red-400'    },
  strides:   { dot: 'bg-orange-400', badge: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-400' },
  race:      { dot: 'bg-green-400',  badge: 'bg-green-500/10 border-green-500/30',   text: 'text-green-400'  },
  rest:      { dot: 'bg-gray-600',   badge: 'border-transparent',                    text: 'text-gray-600'   },
}

const PHASE_STYLE: Record<PlanWeek['phase'], string> = {
  Base:  'text-blue-400',
  Build: 'text-amber-400',
  Peak:  'text-red-400',
  Taper: 'text-purple-400',
  Race:  'text-green-400',
}

const TRAINING_PLAN: PlanWeek[] = [
  {
    weekNum: 1, phase: 'Base', start: '2026-06-22',
    days: [
      { day: 'Mon', date: '2026-06-22', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Tue', date: '2026-06-23', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Wed', date: '2026-06-24', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Thu', date: '2026-06-25', type: 'easy',  label: 'Easy',  km: 3, description: 'Conversational pace. Get legs moving after the break.' },
      { day: 'Fri', date: '2026-06-26', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Sat', date: '2026-06-27', type: 'easy',  label: 'Easy',  km: 4, description: 'Easy effort. No watch pressure.' },
      { day: 'Sun', date: '2026-06-28', type: 'rest',  label: 'Rest',  km: 0 },
    ],
  },
  {
    weekNum: 2, phase: 'Base', start: '2026-06-29',
    days: [
      { day: 'Mon', date: '2026-06-29', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Tue', date: '2026-06-30', type: 'easy',    label: 'Easy',    km: 4 },
      { day: 'Wed', date: '2026-07-01', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Thu', date: '2026-07-02', type: 'strides', label: 'Strides', km: 3, description: '2km easy warmup + 6×20s strides + 1km cooldown.' },
      { day: 'Fri', date: '2026-07-03', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Sat', date: '2026-07-04', type: 'long',    label: 'Long',    km: 5, description: '5km easy. Consistent effort throughout.' },
      { day: 'Sun', date: '2026-07-05', type: 'rest',    label: 'Rest',    km: 0 },
    ],
  },
  {
    weekNum: 3, phase: 'Build', start: '2026-07-06',
    days: [
      { day: 'Mon', date: '2026-07-06', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Tue', date: '2026-07-07', type: 'easy',  label: 'Easy',  km: 4 },
      { day: 'Wed', date: '2026-07-08', type: 'tempo', label: 'Tempo', km: 4, description: '1km easy + 20min tempo + 1km easy. Comfortably hard effort.' },
      { day: 'Thu', date: '2026-07-09', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Fri', date: '2026-07-10', type: 'easy',  label: 'Easy',  km: 4 },
      { day: 'Sat', date: '2026-07-11', type: 'long',  label: 'Long',  km: 6, description: '6km. Run the last 2km at marathon effort.' },
      { day: 'Sun', date: '2026-07-12', type: 'rest',  label: 'Rest',  km: 0 },
    ],
  },
  {
    weekNum: 4, phase: 'Build', start: '2026-07-13',
    days: [
      { day: 'Mon', date: '2026-07-13', type: 'rest',      label: 'Rest',   km: 0 },
      { day: 'Tue', date: '2026-07-14', type: 'easy',      label: 'Easy',   km: 4 },
      { day: 'Wed', date: '2026-07-15', type: 'intervals', label: '5×400m', km: 4, description: '1km warmup + 5×400m at 5k effort with 90s rest + 1km cooldown.' },
      { day: 'Thu', date: '2026-07-16', type: 'rest',      label: 'Rest',   km: 0 },
      { day: 'Fri', date: '2026-07-17', type: 'tempo',     label: 'Tempo',  km: 5, description: '1km easy + 25min at 10k goal pace + 1km easy.' },
      { day: 'Sat', date: '2026-07-18', type: 'long',      label: 'Long',   km: 7, description: '7km easy. Longest run yet — go slow and enjoy it.' },
      { day: 'Sun', date: '2026-07-19', type: 'rest',      label: 'Rest',   km: 0 },
    ],
  },
  {
    weekNum: 5, phase: 'Peak', start: '2026-07-20',
    days: [
      { day: 'Mon', date: '2026-07-20', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Tue', date: '2026-07-21', type: 'easy',  label: 'Easy',  km: 5 },
      { day: 'Wed', date: '2026-07-22', type: 'tempo', label: 'Tempo', km: 6, description: '1km easy + 30min at 10k goal pace + 1km easy. This is your race effort.' },
      { day: 'Thu', date: '2026-07-23', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Fri', date: '2026-07-24', type: 'easy',  label: 'Easy',  km: 4 },
      { day: 'Sat', date: '2026-07-25', type: 'long',  label: 'Long',  km: 8, description: '8km easy. Peak long run. Controlled and confident.' },
      { day: 'Sun', date: '2026-07-26', type: 'rest',  label: 'Rest',  km: 0 },
    ],
  },
  {
    weekNum: 6, phase: 'Taper', start: '2026-07-27',
    days: [
      { day: 'Mon', date: '2026-07-27', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Tue', date: '2026-07-28', type: 'easy',  label: 'Easy',  km: 4 },
      { day: 'Wed', date: '2026-07-29', type: 'tempo', label: 'Tempo', km: 3, description: 'Short 15min tempo. Sharp effort, not long.' },
      { day: 'Thu', date: '2026-07-30', type: 'rest',  label: 'Rest',  km: 0 },
      { day: 'Fri', date: '2026-07-31', type: 'easy',  label: 'Easy',  km: 3 },
      { day: 'Sat', date: '2026-08-01', type: 'long',  label: 'Long',  km: 6, description: '6km. Reduced volume. Legs should feel fresh.' },
      { day: 'Sun', date: '2026-08-02', type: 'rest',  label: 'Rest',  km: 0 },
    ],
  },
  {
    weekNum: 7, phase: 'Taper', start: '2026-08-03',
    days: [
      { day: 'Mon', date: '2026-08-03', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Tue', date: '2026-08-04', type: 'easy',    label: 'Easy',    km: 3 },
      { day: 'Wed', date: '2026-08-05', type: 'strides', label: 'Strides', km: 2, description: '10min easy + 4×20s strides. Activate, do not fatigue.' },
      { day: 'Thu', date: '2026-08-06', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Fri', date: '2026-08-07', type: 'easy',    label: 'Easy',    km: 2, description: 'Short shakeout. Trust the taper.' },
      { day: 'Sat', date: '2026-08-08', type: 'rest',    label: 'Rest',    km: 0 },
      { day: 'Sun', date: '2026-08-09', type: 'rest',    label: 'Rest',    km: 0 },
    ],
  },
  {
    weekNum: 8, phase: 'Race', start: '2026-08-10',
    days: [
      { day: 'Mon', date: '2026-08-10', type: 'rest', label: 'Rest', km: 0 },
      { day: 'Tue', date: '2026-08-11', type: 'easy', label: 'Easy', km: 2, description: 'Very easy 2km. Stay loose, stay calm.' },
      { day: 'Wed', date: '2026-08-12', type: 'rest', label: 'Rest', km: 0 },
      { day: 'Thu', date: '2026-08-13', type: 'easy', label: 'Easy', km: 2, description: '2km easy + 2 strides. Final activation — do not fatigue.' },
      { day: 'Fri', date: '2026-08-14', type: 'rest', label: 'Rest', km: 0 },
      { day: 'Sat', date: '2026-08-15', type: 'race', label: 'RACE', km: 10, description: 'Garmin Run Series 10km · Kings Park Stadium, Durban · 07:00 start.' },
      { day: 'Sun', date: '2026-08-16', type: 'rest', label: 'Rest', km: 0 },
    ],
  },
]

// ── Chart config moved to useChartTheme() hook ───────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const x = Number(v)
  return isNaN(x) ? null : x
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

// ── UI atoms ──────────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function ChartHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">{title}</p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

function KpiCard({
  label,
  value,
  unit,
  accent,
  sub,
}: {
  label: string
  value: string | null
  unit?: string
  accent: string
  sub?: string
}) {
  return (
    <Card>
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accent}`}>
        {value ?? '--'}
        {unit && <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
      {sub && <p className="text-[11px] text-gray-500 dark:text-gray-600 mt-0.5">{sub}</p>}
    </Card>
  )
}

// ── Weekly volume chart ───────────────────────────────────────────────────────

function WeeklyRunVolumeChart({ data }: { data: WeeklyRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .reverse()
    .map(d => {
      const rc = n(d.run_count)
      const h = n(d.avg_run_hr)
      return {
        label: format(parseISO(d.week_start), 'MMM d'),
        km: n(d.run_km) ?? 0,
        hr: rc && rc > 0 && h != null && h > 50 ? h : null,
      }
    })
    .filter(d => d.km > 0)

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Weekly Run Volume" />
        <div className="h-[260px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No run data</p>
        </div>
      </Card>
    )
  }

  const interval = Math.max(0, Math.floor(chartData.length / 10))

  return (
    <Card>
      <ChartHeader
        title="Weekly Run Volume"
        sub="Bars = km · line = avg HR (right axis)"
      />
      <ResponsiveContainer width="99%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval={interval} />
          <YAxis
            yAxisId="km"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={32}
            tickFormatter={(v: number) => `${v}km`}
          />
          <YAxis
            yAxisId="hr"
            orientation="right"
            domain={[100, 180]}
            allowDataOverflow
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={32}
            tickFormatter={(v: number) => `${v}`}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown, name: unknown): [string, string] => {
              const s = String(name)
              if (s === 'Distance') return [`${Number(v).toFixed(1)} km`, s]
              if (s === 'Avg HR') return [`${Number(v).toFixed(0)} bpm`, s]
              return [String(v), s]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
          />
          <ReferenceLine
            yAxisId="km"
            y={20}
            stroke="#10b981"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
            label={{ value: '20km', fill: '#10b981', fontSize: 9, position: 'insideTopRight' }}
          />
          <Bar yAxisId="km" dataKey="km" name="Distance" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={44} />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="Avg HR" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Best efforts chart ────────────────────────────────────────────────────────

function BestEffortsChart({ data }: { data: RunRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .filter(d => d.best_5k != null)
    .reverse()
    .map(d => ({
      label: format(parseISO(d.start_date), 'MMM d'),
      best5k: d.best_5k ? Number(d.best_5k) : null,
    }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="5k Progression" sub="lower is faster" />
        <div className="h-[240px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No 5k data</p>
        </div>
      </Card>
    )
  }

  const vals = chartData.map(d => d.best5k).filter((v): v is number => v != null)
  const domain: [number, number] = vals.length
    ? [Math.max(0, Math.min(...vals) - 90), Math.max(...vals) + 60]
    : [1400, 2100]

  return (
    <Card>
      <ChartHeader title="5k Progression" sub="best 5k time per run · lower = faster · top of chart = best" />
      <ResponsiveContainer width="99%" height={240}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} />
          <YAxis
            domain={domain}
            reversed
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={formatTime}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [formatTime(Number(v)), 'Best 5k']}
          />
          <ReferenceLine
            y={1525}
            stroke="#10b981"
            strokeDasharray="4 4"
            strokeOpacity={0.8}
            label={{ value: 'PB 25:25', fill: '#10b981', fontSize: 9, position: 'insideTopRight' }}
          />
          <Line
            type="monotone"
            dataKey="best5k"
            name="Best 5k"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4, fill: '#3b82f6' }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Cadence trend chart ───────────────────────────────────────────────────────

function CadenceTrendChart({ data }: { data: RunRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .filter(d => d.cadence_precise && n(d.distance_km) != null && (n(d.distance_km) ?? 0) >= 2)
    .reverse()
    .map(d => ({
      label: format(parseISO(d.start_date), 'MMM d'),
      cadence: n(d.cadence_precise),
      dist: n(d.distance_km),
    }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Cadence Trend" sub="target: 85 spm" />
        <div className="h-[240px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No cadence data</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader title="Cadence Trend" sub="steps per minute · runs ≥ 2 km · target 85 spm" />
      <ResponsiveContainer width="99%" height={240}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} />
          <YAxis
            domain={[65, 95]}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <ReferenceLine
            y={85}
            stroke="#10b981"
            strokeDasharray="4 4"
            strokeOpacity={0.7}
            label={{ value: '85', fill: '#10b981', fontSize: 9, position: 'insideTopRight' }}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [`${Number(v).toFixed(0)} spm`, 'Cadence']}
          />
          <Line
            type="monotone"
            dataKey="cadence"
            name="Cadence"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 4, fill: '#f59e0b' }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Lap breakdown chart ───────────────────────────────────────────────────────

type Lap = { km: number; time: number; avg_hr?: number | null }

function LapBreakdownChart({ run }: { run: RunRow }) {
  const { TIP, GRID, TICK } = useChartTheme()

  if (!run.laps || run.laps.length === 0) {
    return (
      <Card>
        <ChartHeader title="Lap Breakdown" sub="Most recent run with lap data" />
        <div className="h-[260px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No lap data for recent runs</p>
        </div>
      </Card>
    )
  }

  const chartData = (run.laps as Lap[]).map((lap, i) => ({
    km: `km ${i + 1}`,
    pace: Number(lap.time),
    hr: lap.avg_hr ? Number(lap.avg_hr) : null,
  }))

  const hrValues = chartData.map(d => d.hr).filter((v): v is number => v !== null)
  const hrMin = hrValues.length ? Math.max(100, Math.min(...hrValues) - 10) : 100
  const hrMax = hrValues.length ? Math.min(220, Math.max(...hrValues) + 10) : 200

  return (
    <Card>
      <ChartHeader
        title="Lap Breakdown"
        sub={`${run.name} · ${n(run.distance_km)?.toFixed(1) ?? '?'} km · ${format(parseISO(run.start_date), 'MMM d, yyyy')}`}
      />
      <ResponsiveContainer width="99%" height={260}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="km" tick={TICK} tickLine={false} />
          <YAxis
            yAxisId="pace"
            reversed
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={formatTime}
          />
          <YAxis
            yAxisId="hr"
            orientation="right"
            domain={[hrMin, hrMax]}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown, name: unknown): [string, string] => {
              const s = String(name)
              if (s === 'Pace /km') return [formatTime(Number(v)), s]
              return [`${Number(v).toFixed(0)} bpm`, s]
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
          />
          <Bar yAxisId="pace" dataKey="pace" name="Pace /km" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={50} />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="Avg HR" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Recent runs table ─────────────────────────────────────────────────────────

function RecentRunsTable({ data }: { data: RunRow[] }) {
  const rows = data.slice(0, 10)

  return (
    <Card>
      <ChartHeader title="Recent Runs" sub="Last 10 runs" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="text-left py-2 pr-3 text-gray-500 font-medium">Date</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">km</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">Pace</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">HR</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">Best 5k</th>
              <th className="text-right py-2 text-gray-500 font-medium">Effort</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.activity_id} className="border-b border-gray-200/50 dark:border-gray-800/50 last:border-0">
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                  {format(parseISO(r.start_date), 'MMM d')}
                </td>
                <td className="py-2 pr-3 text-right text-blue-400 tabular-nums">
                  {n(r.distance_km) != null ? n(r.distance_km)!.toFixed(1) : '--'}
                </td>
                <td className="py-2 pr-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">
                  {r.pace_formatted ?? '--'}
                </td>
                <td className="py-2 pr-3 text-right text-red-400 tabular-nums">
                  {r.avg_hr != null ? `${r.avg_hr}` : '--'}
                </td>
                <td className="py-2 pr-3 text-right text-blue-300 tabular-nums">
                  {r.best_5k ? formatTime(r.best_5k) : '--'}
                </td>
                <td className="py-2 text-right text-gray-500 tabular-nums">
                  {r.relative_effort ?? '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Running Gear Card ─────────────────────────────────────────────────────────

const SHOE_LIFESPAN_KM = 600

function RunningGearCard({ data }: { data: GearRow[] }) {
  if (!data.length) return null

  return (
    <Card>
      <ChartHeader title="Running Gear" sub={`km tracked via Strava · ${SHOE_LIFESPAN_KM}km reference lifespan`} />
      <div className="space-y-3">
        {data.map(g => {
          const km = Math.round((Number(g.total_distance_meters) || 0) / 1000)
          const pct = Math.min(100, Math.round((km / SHOE_LIFESPAN_KM) * 100))
          const barColor = pct > 83 ? 'bg-red-400' : pct > 50 ? 'bg-amber-400' : 'bg-blue-400'

          return (
            <div key={g.id}>
              <div className="flex items-baseline justify-between mb-1">
                <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate pr-3">
                  {g.name}
                  {g.retired && (
                    <span className="ml-2 text-[9px] text-gray-600 uppercase tracking-wider">retired</span>
                  )}
                </p>
                <div className="shrink-0 tabular-nums">
                  <span className={`text-sm font-semibold ${barColor.replace('bg-', 'text-')}`}>{km}</span>
                  <span className="text-[10px] text-gray-500 ml-0.5">km</span>
                </div>
              </div>
              <div className="w-full h-1 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Training Plan Section ─────────────────────────────────────────────────────

function TrainingPlanSection({ runs }: { runs: RunRow[] }) {
  const [expanded, setExpanded] = useState(false)

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const oneDayMs = 86400000
  const daysToRace = Math.ceil((parseISO(RACE_DATE).getTime() - today.getTime()) / oneDayMs)
  const daysElapsed = Math.max(0, Math.floor((today.getTime() - parseISO('2026-06-22').getTime()) / oneDayMs))
  const progressPct = Math.min(100, Math.round((daysElapsed / PLAN_TOTAL_DAYS) * 100))

  const actualByDate = new Map<string, RunRow>()
  runs.forEach(r => { if (r.start_date >= '2026-06-22') actualByDate.set(r.start_date, r) })

  const dueDays = TRAINING_PLAN.flatMap(w => w.days).filter(
    d => d.type !== 'rest' && d.type !== 'race' && d.date <= todayStr
  )
  const completedCount = dueDays.filter(d => actualByDate.has(d.date)).length

  // Volume compliance
  const plannedToDate = dueDays.reduce((s, d) => s + d.km, 0)
  const actualToDate = runs
    .filter(r => r.start_date >= '2026-06-22' && r.start_date <= todayStr)
    .reduce((s, r) => s + (n(r.distance_km) ?? 0), 0)
  const kmBalance = actualToDate - plannedToDate
  const balanceLabel = kmBalance >= 0 ? `+${kmBalance.toFixed(1)} km` : `${kmBalance.toFixed(1)} km`
  const balanceColor = kmBalance >= -2 ? 'text-green-400' : kmBalance >= -5 ? 'text-amber-400' : 'text-red-400'
  const balanceStatus = kmBalance >= -2 ? 'On track' : kmBalance >= -5 ? 'Behind' : 'Well behind'

  return (
    <div className="space-y-2">
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-1">Goal Race</p>
            <p className="text-base font-semibold text-green-400 truncate">{RACE_NAME}</p>
            <p className="text-xs text-gray-500 mt-0.5">15 Aug 2026 · 07:00 · Kings Park Stadium, Durban</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold text-green-400 tabular-nums leading-none">{Math.max(0, daysToRace)}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">days to go</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>{completedCount} of {dueDays.length} workouts completed</span>
            <span>{progressPct}% through plan</span>
          </div>
        </div>

        {/* Volume balance */}
        {plannedToDate > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="text-gray-500">Planned <span className="text-gray-300 font-medium">{plannedToDate.toFixed(0)} km</span></span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-500">Ran <span className="text-gray-300 font-medium">{actualToDate.toFixed(1)} km</span></span>
            </div>
            <div className="text-right">
              <span className={`text-xs font-semibold tabular-nums ${balanceColor}`}>{balanceLabel}</span>
              <span className={`ml-1.5 text-[10px] ${balanceColor}`}>{balanceStatus}</span>
            </div>
          </div>
        )}

        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-3 text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
        >
          {expanded ? '▲ collapse plan' : '▼ show training plan'}
        </button>
      </Card>

      {expanded && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-0.5">
            {(['easy', 'long', 'tempo', 'intervals', 'strides', 'race'] as WorkoutType[]).map(t => (
              <div key={t} className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${WORKOUT_STYLES[t].dot}`} />
                <span className="text-[10px] text-gray-500 capitalize">{t}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            {TRAINING_PLAN.map(week => {
              const weekEnd = week.days[week.days.length - 1].date
              const isCurrentWeek = week.start <= todayStr && todayStr <= weekEnd
              const isPastWeek = weekEnd < todayStr
              const isActiveWeek = isPastWeek || isCurrentWeek

              const weekPlannedKm = week.days.reduce((s, d) => s + d.km, 0)
              const weekPlannedDue = week.days
                .filter(d => d.type !== 'rest' && d.date <= todayStr)
                .reduce((s, d) => s + d.km, 0)
              const weekActualKm = runs
                .filter(r => r.start_date >= week.start && r.start_date <= weekEnd && r.start_date <= todayStr)
                .reduce((s, r) => s + (n(r.distance_km) ?? 0), 0)
              const weekBalance = weekActualKm - weekPlannedDue
              const weekBalanceColor = weekBalance >= -1 ? 'text-green-400' : weekBalance >= -3 ? 'text-amber-400' : 'text-red-400'

              return (
                <Card key={week.weekNum} className={isCurrentWeek ? 'ring-1 ring-blue-500/40' : ''}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-400">W{week.weekNum}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${PHASE_STYLE[week.phase]}`}>
                        {week.phase}
                      </span>
                      <span className="text-[10px] text-gray-500 hidden sm:block">
                        {format(parseISO(week.start), 'MMM d')}–{format(parseISO(weekEnd), 'MMM d')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isActiveWeek && weekPlannedDue > 0 ? (
                        <>
                          <span className="text-[10px] text-gray-500 tabular-nums">
                            {weekActualKm.toFixed(1)}<span className="text-gray-600">/{weekPlannedKm}km</span>
                          </span>
                          <span className={`text-[10px] font-semibold tabular-nums ${weekBalanceColor}`}>
                            {weekBalance >= 0 ? `+${weekBalance.toFixed(1)}` : weekBalance.toFixed(1)}
                          </span>
                        </>
                      ) : (
                        weekPlannedKm > 0 && <span className="text-[10px] text-gray-500">{weekPlannedKm} km</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {week.days.map(d => {
                      const isToday = d.date === todayStr
                      const isPast = d.date < todayStr
                      const actual = actualByDate.get(d.date)
                      const isCompleted = actual != null && d.type !== 'rest'
                      const s = WORKOUT_STYLES[d.type]

                      return (
                        <div
                          key={d.date}
                          title={d.description ?? (d.type !== 'rest' ? `${d.label} · ${d.km}km` : 'Rest')}
                          className={[
                            'flex flex-col items-center justify-start gap-0.5 rounded-md py-1.5 px-0.5 border text-center cursor-default',
                            d.type === 'rest' ? 'border-transparent' : s.badge,
                            isToday ? 'ring-1 ring-gray-400/50 dark:ring-white/20 bg-gray-100 dark:bg-white/5' : '',
                            isPast && d.type !== 'rest' && !isCompleted ? 'opacity-40' : '',
                          ].filter(Boolean).join(' ')}
                        >
                          <span className={`text-[9px] font-medium leading-none mb-0.5 ${isToday ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>
                            {d.day}
                          </span>
                          {d.type !== 'rest' ? (
                            <>
                              {isCompleted
                                ? <span className="text-green-400 text-[11px] leading-none">✓</span>
                                : <div className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                              }
                              <span className={`text-[9px] font-medium leading-none mt-0.5 ${isCompleted ? 'text-green-400' : s.text}`}>
                                {isCompleted
                                  ? `${(n(actual?.distance_km) ?? d.km).toFixed(1)}`
                                  : `${d.km}`}km
                              </span>
                              <span className={`text-[8px] leading-none mt-0.5 hidden sm:block ${isCompleted ? 'text-green-400/70' : 'text-gray-500'}`}>
                                {isCompleted ? 'done' : d.label}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-gray-700">·</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── HR Zone Distribution ──────────────────────────────────────────────────────

const HR_ZONES = [
  { label: 'Z1 Recovery',  color: '#60a5fa' },
  { label: 'Z2 Aerobic',   color: '#34d399' },
  { label: 'Z3 Threshold', color: '#fbbf24' },
  { label: 'Z4 Anaerobic', color: '#fb923c' },
  { label: 'Z5 Max',       color: '#f87171' },
]

function hrZoneIndex(hr: number, z: ZoneRow): number {
  if (hr <= z.hr_z1_max) return 0
  if (hr <= z.hr_z2_max) return 1
  if (hr <= z.hr_z3_max) return 2
  if (hr <= z.hr_z4_max) return 3
  return 4
}

function HRZoneChart({ runs, zones }: { runs: RunRow[]; zones: ZoneRow }) {
  const { TIP } = useChartTheme()
  const runsWithHR = runs.filter(r => {
    const hr = n(r.avg_hr)
    return hr != null && hr > 60
  })

  const counts = [0, 0, 0, 0, 0]
  runsWithHR.forEach(r => { counts[hrZoneIndex(n(r.avg_hr)!, zones)]++ })

  const pieData = HR_ZONES
    .map((z, i) => ({ name: z.label, value: counts[i], color: z.color }))
    .filter(d => d.value > 0)

  const zoneBounds = [
    `≤${zones.hr_z1_max}`,
    `${zones.hr_z2_min}–${zones.hr_z2_max}`,
    `${zones.hr_z3_min}–${zones.hr_z3_max}`,
    `${zones.hr_z4_min}–${zones.hr_z4_max}`,
    `≥${zones.hr_z5_min}`,
  ]

  if (!runsWithHR.length) {
    return (
      <Card>
        <ChartHeader title="HR Zone Distribution" sub="No runs with heart rate data yet" />
        <div className="h-[160px] flex items-center justify-center">
          <p className="text-gray-500 text-sm">No data</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader
        title="HR Zone Distribution"
        sub={`${runsWithHR.length} runs with HR data · zones sourced from Strava`}
      />
      <div className="flex gap-4 items-center">
        <div className="w-[130px] h-[130px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                innerRadius={38}
                outerRadius={60}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={TIP}
                formatter={(v, name): [string, string] => { const n = Number(Array.isArray(v) ? v[0] : (v ?? 0)); return [`${n} run${n !== 1 ? 's' : ''}`, String(name)]; }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          {HR_ZONES.map((z, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: z.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] text-gray-500 truncate">{z.label}</span>
                  <span className="text-[11px] font-medium text-gray-400 shrink-0">{counts[i]}</span>
                </div>
                <div className="text-[10px] text-gray-600 dark:text-gray-700">{zoneBounds[i]} bpm</div>
                {counts[i] > 0 && (
                  <div className="mt-0.5 h-0.5 rounded-full bg-gray-200 dark:bg-gray-800">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(counts[i] / runsWithHR.length) * 100}%`, backgroundColor: z.color }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-1">
        {runsWithHR.slice(0, 12).map(r => {
          const zi = hrZoneIndex(n(r.avg_hr)!, zones)
          const z = HR_ZONES[zi]
          return (
            <span
              key={r.activity_id}
              title={`${r.name} · ${Math.round(n(r.avg_hr)!)} bpm`}
              className="text-[10px] px-1.5 py-0.5 rounded font-medium cursor-default"
              style={{ color: z.color, backgroundColor: `${z.color}20` }}
            >
              {Math.round(n(r.avg_hr)!)}
            </span>
          )
        })}
      </div>
    </Card>
  )
}

// ── Run Efficiency Scatter ────────────────────────────────────────────────────

function RunEfficiencyScatter({ runs, zones }: { runs: RunRow[]; zones: ZoneRow }) {
  const { TIP, GRID, TICK, LABEL_FILL } = useChartTheme()

  const scatterData = runs
    .filter(r => {
      const hr = n(r.avg_hr)
      const pace = n(r.pace_sec_per_km)
      return hr != null && hr > 80 && pace != null && pace > 100 && pace < 600
    })
    .map(r => ({
      pace: Math.round(n(r.pace_sec_per_km)!),
      hr: Math.round(n(r.avg_hr)!),
      date: r.start_date,
      name: r.name,
    }))
    .reverse()

  const formatPace = (v: number) => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`

  if (scatterData.length < 3) {
    return (
      <Card>
        <ChartHeader title="Run Efficiency" sub="Needs 3+ runs with HR — building up" />
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-gray-500 text-sm">Not enough data yet</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader
        title="Run Efficiency"
        sub="Avg HR vs pace · lower-right = faster at lower effort"
      />
      <ResponsiveContainer width="99%" height={220}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
          <XAxis
            dataKey="pace"
            type="number"
            name="Pace"
            domain={['auto', 'auto']}
            tickFormatter={formatPace}
            tick={TICK}
            label={{ value: 'Pace (min/km)', position: 'insideBottom', offset: -10, fontSize: 10, fill: LABEL_FILL }}
          />
          <YAxis
            dataKey="hr"
            type="number"
            name="HR"
            domain={['auto', 'auto']}
            tick={TICK}
            width={32}
          />
          <Tooltip
            contentStyle={TIP}
            content={({ payload }) => {
              if (!payload?.length) return null
              const d = payload[0]?.payload
              if (!d) return null
              return (
                <div style={TIP} className="p-2 rounded text-xs space-y-0.5">
                  <p className="font-medium">{d.name}</p>
                  <p>Pace: {formatPace(d.pace)}/km</p>
                  <p>HR: {d.hr} bpm</p>
                  <p className="text-gray-500">{format(parseISO(d.date), 'dd MMM yyyy')}</p>
                </div>
              )
            }}
          />
          <ReferenceLine y={zones.hr_z1_max} stroke="#60a5fa" strokeWidth={0.5} strokeDasharray="4 4" label={{ value: 'Z1', fill: '#60a5fa', fontSize: 9, position: 'right' }} />
          <ReferenceLine y={zones.hr_z2_max} stroke="#34d399" strokeWidth={0.5} strokeDasharray="4 4" label={{ value: 'Z2', fill: '#34d399', fontSize: 9, position: 'right' }} />
          <ReferenceLine y={zones.hr_z3_max} stroke="#fbbf24" strokeWidth={0.5} strokeDasharray="4 4" label={{ value: 'Z3', fill: '#fbbf24', fontSize: 9, position: 'right' }} />
          <ReferenceLine y={zones.hr_z4_max} stroke="#fb923c" strokeWidth={0.5} strokeDasharray="4 4" label={{ value: 'Z4', fill: '#fb923c', fontSize: 9, position: 'right' }} />
          <Scatter data={scatterData} fill="#3b82f6" fillOpacity={0.75} r={5} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-gray-500 dark:text-gray-600 mt-1">
        As fitness builds, dots shift right (faster) or down (lower HR). Dashed lines = HR zone boundaries.
      </p>
    </Card>
  )
}

// ── Training Load Chart ───────────────────────────────────────────────────────

function TrainingLoadChart({ efforts }: { efforts: EffortRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()

  const weekMap = new Map<string, { run: number; workout: number; walk: number }>()
  efforts.forEach(e => {
    if (!e.relative_effort) return
    const d = parseISO(e.start_date)
    const ws = format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    if (!weekMap.has(ws)) weekMap.set(ws, { run: 0, workout: 0, walk: 0 })
    const w = weekMap.get(ws)!
    if (e.sport_type === 'Run') w.run += e.relative_effort
    else if (e.sport_type === 'Workout') w.workout += e.relative_effort
    else if (e.sport_type === 'Walk') w.walk += e.relative_effort
  })

  const chartData = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-20)
    .map(([ws, v]) => ({
      label: format(parseISO(ws), 'MMM d'),
      Run: v.run || null,
      Strength: v.workout || null,
      Walk: v.walk || null,
    }))

  if (!chartData.length) return null

  return (
    <Card>
      <ChartHeader
        title="Training Load"
        sub="Strava relative effort by activity type · last 20 weeks"
      />
      <ResponsiveContainer width="99%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={28} />
          <Tooltip
            contentStyle={TIP}
            formatter={(v: unknown, name: unknown): [string, string] => [`${Number(v)} pts`, String(name)]}
          />
          <Bar dataKey="Run"      stackId="a" fill="#3b82f6" name="Run"      radius={[0,0,0,0]} maxBarSize={40} />
          <Bar dataKey="Strength" stackId="a" fill="#f97316" name="Strength" radius={[0,0,0,0]} maxBarSize={40} />
          <Bar dataKey="Walk"     stackId="a" fill="#8b5cf6" name="Walk"     radius={[3,3,0,0]} maxBarSize={40} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2">
        {[['Run', '#3b82f6'], ['Strength', '#f97316'], ['Walk', '#8b5cf6']].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RunningPage() {
  const { user } = useAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [weeks, setWeeks] = useState<WeeklyRow[]>([])
  const [gear, setGear] = useState<GearRow[]>([])
  const [zones, setZones] = useState<ZoneRow | null>(null)
  const [efforts, setEfforts] = useState<EffortRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const uid = user.id

    Promise.all([
      supabase
        .from('v_run_performance')
        .select('activity_id,start_date,name,distance_km,duration_seconds,pace_sec_per_km,pace_formatted,elevation_gain,relative_effort,avg_hr,cadence_precise,best_1k,best_5k,best_10k,laps')
        .eq('user_id', uid)
        .order('start_date', { ascending: false }),
      supabase
        .from('v_weekly_training')
        .select('week_start,run_count,run_km,avg_run_hr,avg_run_cadence,run_elevation_gain,workout_count,avg_relative_effort')
        .eq('user_id', uid)
        .order('week_start', { ascending: false })
        .limit(52),
      supabase
        .from('strava_gear')
        .select('id,gear_type,name,brand,model_name,retired,total_distance_meters')
        .eq('user_id', uid)
        .order('total_distance_meters', { ascending: false }),
      supabase
        .from('strava_zones')
        .select('hr_z1_max,hr_z2_min,hr_z2_max,hr_z3_min,hr_z3_max,hr_z4_min,hr_z4_max,hr_z5_min,run_z1_max,run_z2_max,run_z3_max,run_z4_max,run_z5_max')
        .eq('user_id', uid)
        .single(),
      supabase
        .from('strava_activities')
        .select('id,sport_type,start_date,relative_effort,duration_seconds')
        .eq('user_id', uid)
        .not('relative_effort', 'is', null)
        .order('start_date', { ascending: true }),
    ]).then(([r, w, g, z, e]) => {
      setRuns(r.data ?? [])
      setWeeks(w.data ?? [])
      setGear(g.data ?? [])
      setZones(z.data ?? null)
      setEfforts(e.data ?? [])
      setLoading(false)
    })
  }, [user])

  // ── Summary stats ──

  const totalRuns = runs.length
  const totalKm = runs.reduce((sum, r) => sum + (n(r.distance_km) ?? 0), 0)

  const best5k = runs
    .map(r => r.best_5k)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)[0] ?? null

  const recentCadences = runs
    .slice(0, 5)
    .map(r => n(r.cadence_precise))
    .filter((v): v is number => v != null)
  const avgCadence = avg(recentCadences)

  const latestRunWithLaps = runs.find(r => r.laps && Array.isArray(r.laps) && r.laps.length > 0) ?? null

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 rounded-full border-2 border-gray-200 dark:border-gray-700 border-t-gray-600 dark:border-t-gray-300 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">Running</h1>
        <p className="text-xs text-gray-500">
          Training plan · weekly volume · pace progression · cadence · lap breakdown
        </p>
      </div>

      {/* Training plan — hardcoded to Slade's own race plan for now (see
          .planning/PRODUCT-STRATEGY.md Phase 3). Other users get an empty
          state until per-user training plans exist. */}
      {user?.id === SLADE_USER_ID ? (
        <TrainingPlanSection runs={runs} />
      ) : (
        <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4 text-sm text-gray-500">
          No training plan set.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Total Runs"
          value={String(totalRuns)}
          accent="text-blue-400"
        />
        <KpiCard
          label="Total Distance"
          value={totalKm > 0 ? totalKm.toFixed(1) : null}
          unit="km"
          accent="text-blue-400"
        />
        <KpiCard
          label="Best 5k"
          value={best5k ? formatTime(best5k) : null}
          accent={run5kColor(best5k)}
          sub={best5k ? `${(best5k / 300).toFixed(1)} min/km` : undefined}
        />
        <KpiCard
          label="Avg Cadence"
          value={avgCadence != null ? avgCadence.toFixed(0) : null}
          unit="spm"
          accent={cadenceColor(avgCadence)}
          sub="last 5 runs"
        />
      </div>

      {/* Weekly volume */}
      <WeeklyRunVolumeChart data={weeks} />

      {/* Best efforts + cadence side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BestEffortsChart data={runs} />
        <CadenceTrendChart data={runs} />
      </div>

      {/* HR zones + efficiency */}
      {zones && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <HRZoneChart runs={runs} zones={zones} />
          <RunEfficiencyScatter runs={runs} zones={zones} />
        </div>
      )}

      {/* Training load */}
      {efforts.length > 0 && <TrainingLoadChart efforts={efforts} />}

      {/* Lap breakdown */}
      {latestRunWithLaps && <LapBreakdownChart run={latestRunWithLaps} />}

      {/* Recent runs table */}
      {runs.length > 0 && <RecentRunsTable data={runs} />}

      {/* Gear */}
      {gear.length > 0 && <RunningGearCard data={gear} />}
    </div>
  )
}
