import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, LineChart,
  Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { cadenceColor, run5kColor } from '../lib/rag'

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

// ── Chart config ──────────────────────────────────────────────────────────────

const TIP = {
  backgroundColor: '#111827',
  border: '1px solid #374151',
  borderRadius: '8px',
  fontSize: 12,
  color: '#f9fafb',
}
const GRID = '#1f2937'
const TICK = { fontSize: 10, fill: '#6b7280' }

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
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className}`}>
      {children}
    </div>
  )
}

function ChartHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest">{title}</p>
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
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
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
    </Card>
  )
}

// ── Weekly volume chart ───────────────────────────────────────────────────────

function WeeklyRunVolumeChart({ data }: { data: WeeklyRow[] }) {
  const chartData = [...data]
    .filter(d => d.run_count && Number(d.run_count) > 0)
    .reverse()
    .map(d => ({
      label: format(parseISO(d.week_start), 'MMM d'),
      km: n(d.run_km),
      count: n(d.run_count),
      hr: n(d.avg_run_hr),
    }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Weekly Run Volume" />
        <div className="h-[260px] flex items-center justify-center">
          <p className="text-gray-600 text-sm">No run data</p>
        </div>
      </Card>
    )
  }

  const interval = Math.max(0, Math.floor(chartData.length / 10))

  return (
    <Card>
      <ChartHeader
        title="Weekly Run Volume"
        sub="Bars = km · line = run count · right axis = avg HR"
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
          <Bar yAxisId="km" dataKey="km" name="Distance" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={44} />
          <Line yAxisId="hr" type="monotone" dataKey="hr" name="Avg HR" stroke="#ef4444" strokeWidth={2} dot={{ r: 3, fill: '#ef4444' }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Best efforts chart ────────────────────────────────────────────────────────

function BestEffortsChart({ data }: { data: RunRow[] }) {
  const chartData = [...data]
    .filter(d => d.best_5k || d.best_1k)
    .reverse()
    .map(d => ({
      label: format(parseISO(d.start_date), 'MMM d'),
      best5k: d.best_5k ? Number(d.best_5k) : null,
      best1k: d.best_1k ? Number(d.best_1k) : null,
    }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Best Efforts" sub="lower is faster" />
        <div className="h-[240px] flex items-center justify-center">
          <p className="text-gray-600 text-sm">No best effort data</p>
        </div>
      </Card>
    )
  }

  const vals5k = chartData.map(d => d.best5k).filter((v): v is number => v != null)
  const domain5k: [number, number] = vals5k.length
    ? [Math.max(0, Math.min(...vals5k) - 120), Math.max(...vals5k) + 60]
    : [1400, 2100]

  return (
    <Card>
      <ChartHeader title="Best Efforts" sub="lower is faster · left = 5k · right = 1k" />
      <ResponsiveContainer width="99%" height={240}>
        <LineChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} />
          <YAxis
            yAxisId="5k"
            domain={domain5k}
            reversed
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={formatTime}
          />
          <YAxis
            yAxisId="1k"
            orientation="right"
            reversed
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={36}
            tickFormatter={formatTime}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [formatTime(Number(v)), '']}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
          />
          <Line
            yAxisId="5k"
            type="monotone"
            dataKey="best5k"
            name="Best 5k"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4, fill: '#3b82f6' }}
            connectNulls
          />
          <Line
            yAxisId="1k"
            type="monotone"
            dataKey="best1k"
            name="Best 1k"
            stroke="#8b5cf6"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 3, fill: '#8b5cf6' }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Cadence trend chart ───────────────────────────────────────────────────────

function CadenceTrendChart({ data }: { data: RunRow[] }) {
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
          <p className="text-gray-600 text-sm">No cadence data</p>
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
            domain={[60, 100]}
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
  if (!run.laps || run.laps.length === 0) {
    return (
      <Card>
        <ChartHeader title="Lap Breakdown" sub="Most recent run with lap data" />
        <div className="h-[260px] flex items-center justify-center">
          <p className="text-gray-600 text-sm">No lap data for recent runs</p>
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
            <tr className="border-b border-gray-800">
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
              <tr key={r.activity_id} className="border-b border-gray-800/50 last:border-0">
                <td className="py-2 pr-3 text-gray-300">
                  {format(parseISO(r.start_date), 'MMM d')}
                </td>
                <td className="py-2 pr-3 text-right text-blue-400 tabular-nums">
                  {n(r.distance_km) != null ? n(r.distance_km)!.toFixed(1) : '--'}
                </td>
                <td className="py-2 pr-3 text-right text-gray-300 tabular-nums">
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RunningPage() {
  const { user } = useAuth()
  const [runs, setRuns] = useState<RunRow[]>([])
  const [weeks, setWeeks] = useState<WeeklyRow[]>([])
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
    ]).then(([r, w]) => {
      setRuns(r.data ?? [])
      setWeeks(w.data ?? [])
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
        <div className="w-5 h-5 rounded-full border-2 border-gray-700 border-t-gray-300 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold text-white mb-0.5">Running</h1>
        <p className="text-xs text-gray-500">
          Weekly volume · pace progression · cadence · lap breakdown
        </p>
      </div>

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

      {/* Lap breakdown */}
      {latestRunWithLaps && <LapBreakdownChart run={latestRunWithLaps} />}

      {/* Recent runs table */}
      {runs.length > 0 && <RecentRunsTable data={runs} />}
    </div>
  )
}
