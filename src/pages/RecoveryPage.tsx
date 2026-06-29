import { useEffect, useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, AreaChart, ScatterChart, BarChart,
  Line, Bar, Area, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
  ResponsiveContainer, ReferenceLine, ZAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useChartTheme } from '../lib/chartTheme'

// ── Types ─────────────────────────────────────────────────────────────────────

type TrendRow = {
  date: string
  resting_hr: number | null
  avg_stress: number | null
  body_battery_highest: number | null
  sleep_hours: string | null
  rhr_7d_avg: string | null
  stress_7d_avg: string | null
  sleep_7d_avg: string | null
  bb_high_7d_avg: string | null
}

type SleepRow = {
  date: string
  sleep_hours: string | null
  sleep_deep_seconds: number | null
  sleep_light_seconds: number | null
  sleep_rem_seconds: number | null
  sleep_awake_seconds: number | null
  sleep_deep_percent: string | null
  sleep_rem_percent: string | null
}

type CorrRow = {
  date: string
  sleep_hours: string | null
  avg_stress: number | null
  resting_hr: number | null
  next_bb_high: number | null
  week_vigorous_total: number | null
  week_avg_bb_high: string | null
}

type StressRow = {
  week_start: string
  stress_value: number | null
}

type RunLoadRow = {
  run_date: string
  name: string | null
  distance_km: string | null
  relative_effort: number | null
  sleep_night_before: string | null
  bb_peak_day_of_run: number | null
  next_day_bb_peak: number | null
  next_day_rhr: number | null
  rhr_day_of_run: number | null
  bb_impact: number | null
  rhr_impact: number | null
}

// ── Chart config moved to useChartTheme() hook ───────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const x = Number(v)
  return isNaN(x) ? null : x
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

function StatRow({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent: string }) {
  return (
    <div className="py-3 border-b border-gray-200 dark:border-gray-800 last:border-0">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-xl font-semibold ${accent}`}>
        {value}
        {unit && <span className="text-xs font-normal text-gray-500 ml-1">{unit}</span>}
      </p>
    </div>
  )
}

// ── Recovery trend charts (split into two focused charts) ─────────────────────

function useTrendChartData(data: TrendRow[]) {
  const interval = Math.max(1, Math.floor(data.length / 10))
  const chartData = [...data].reverse().map(d => ({
    label: format(parseISO(d.date), 'MMM d'),
    rhr: d.resting_hr,
    stress: d.avg_stress,
    bb: d.body_battery_highest,
    sleep: n(d.sleep_hours),
    rhr7: n(d.rhr_7d_avg),
    stress7: n(d.stress_7d_avg),
    sleep7: n(d.sleep_7d_avg),
    bb7: n(d.bb_high_7d_avg),
  }))
  return { chartData, interval }
}

function BatterySleepChart({ data }: { data: TrendRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const { chartData, interval } = useTrendChartData(data)

  return (
    <ResponsiveContainer width="99%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} interval={interval} />
        <YAxis yAxisId="bb" domain={[0, 100]} tick={TICK} tickLine={false} axisLine={false} width={28} />
        <YAxis
          yAxisId="sleep"
          orientation="right"
          domain={[4, 12]}
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={32}
          tickFormatter={(v: number) => `${v}h`}
        />
        <Tooltip
          contentStyle={TIP}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(v: unknown, name: unknown): [string, string] => {
            const s = String(name)
            const num = Number(v)
            if (s === 'Sleep') return [`${num.toFixed(1)}h`, s]
            return [String(Math.round(num)), s]
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
        />
        <Line yAxisId="bb" type="monotone" dataKey="bb" name="Body Battery" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="bb" type="monotone" dataKey="bb7" name="BB 7d avg" stroke="#10b981" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.5} dot={false} connectNulls legendType="none" />
        <Line yAxisId="sleep" type="monotone" dataKey="sleep" name="Sleep" stroke="#8b5cf6" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="sleep" type="monotone" dataKey="sleep7" name="Sleep 7d avg" stroke="#8b5cf6" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.5} dot={false} connectNulls legendType="none" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function StressRHRChart({ data }: { data: TrendRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const { chartData, interval } = useTrendChartData(data)

  return (
    <ResponsiveContainer width="99%" height={240}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 40, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} interval={interval} />
        <YAxis yAxisId="stress" domain={[15, 80]} tick={TICK} tickLine={false} axisLine={false} width={28} />
        <YAxis
          yAxisId="rhr"
          orientation="right"
          domain={[40, 70]}
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
            const num = Number(v)
            if (s === 'RHR' || s === 'RHR 7d avg') return [`${Math.round(num)} bpm`, s]
            return [String(Math.round(num)), s]
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
        />
        <Line yAxisId="stress" type="monotone" dataKey="stress" name="Stress" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="stress" type="monotone" dataKey="stress7" name="Stress 7d avg" stroke="#f59e0b" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.5} dot={false} connectNulls legendType="none" />
        <Line yAxisId="rhr" type="monotone" dataKey="rhr" name="RHR" stroke="#ef4444" strokeWidth={2} dot={false} connectNulls />
        <Line yAxisId="rhr" type="monotone" dataKey="rhr7" name="RHR 7d avg" stroke="#ef4444" strokeWidth={1} strokeDasharray="5 4" strokeOpacity={0.5} dot={false} connectNulls legendType="none" />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Sleep stages chart ────────────────────────────────────────────────────────

function SleepStagesChart({ data }: { data: SleepRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .reverse()
    .map(d => ({
      label: format(parseISO(d.date), 'MMM d'),
      Deep: d.sleep_deep_seconds ? +(d.sleep_deep_seconds / 3600).toFixed(2) : null,
      REM: d.sleep_rem_seconds ? +(d.sleep_rem_seconds / 3600).toFixed(2) : null,
      Light: d.sleep_light_seconds ? +(d.sleep_light_seconds / 3600).toFixed(2) : null,
      Awake: d.sleep_awake_seconds ? +(d.sleep_awake_seconds / 3600).toFixed(2) : null,
    }))
    .filter(d => d.Deep !== null || d.REM !== null)

  return (
    <ResponsiveContainer width="99%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} interval={4} />
        <YAxis domain={[0, 11]} tick={TICK} tickLine={false} axisLine={false} width={28} tickFormatter={(v: number) => `${v}h`} />
        <Tooltip
          contentStyle={TIP}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(v: unknown, name: unknown): [string, string] => {
            return [`${Number(v).toFixed(1)}h`, String(name)]
          }}
          cursor={{ fill: GRID }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(v: unknown) => <span style={{ color: '#9ca3af' }}>{String(v)}</span>}
        />
        <Bar dataKey="Deep" stackId="s" fill="#3b82f6" />
        <Bar dataKey="REM" stackId="s" fill="#8b5cf6" />
        <Bar dataKey="Light" stackId="s" fill="#6b7280" />
        <Bar dataKey="Awake" stackId="s" fill="#f59e0b" radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Linear regression helper ──────────────────────────────────────────────────

function linearRegression(points: { x: number; y: number }[]) {
  const count = points.length
  if (count < 5) return null
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = count * sumX2 - sumX * sumX
  if (Math.abs(denom) < 0.001) return null
  const slope = (count * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / count
  const xs = points.map(p => p.x)
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs)
  return { x1, y1: slope * x1 + intercept, x2, y2: slope * x2 + intercept }
}

// ── Scatter panel ─────────────────────────────────────────────────────────────

function ScatterPanel({
  data,
  xLabel,
  yLabel,
  title,
  sub,
  dotColor,
  xDomain,
  yDomain,
  refX,
  refY,
}: {
  data: { x: number; y: number }[]
  xLabel: string
  yLabel: string
  title: string
  sub: string
  dotColor: string
  xDomain?: [number, number]
  yDomain?: [number, number]
  refX?: number
  refY?: number
}) {
  const { TIP, GRID, TICK, LABEL_FILL } = useChartTheme()
  const reg = linearRegression(data)

  if (data.length < 5) {
    return (
      <Card>
        <ChartHeader title={title} sub={sub} />
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">Need more data</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader title={title} sub={sub} />
      <ResponsiveContainer width="99%" height={200}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="x"
            type="number"
            name={xLabel}
            domain={xDomain ?? ['auto', 'auto']}
            tick={TICK}
            tickLine={false}
            label={{ value: xLabel, position: 'insideBottom', offset: -16, fill: LABEL_FILL, fontSize: 10 }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name={yLabel}
            domain={yDomain ?? ['auto', 'auto']}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <ZAxis range={[24, 24]} />
          <Tooltip contentStyle={TIP} />
          {refX !== undefined && (
            <ReferenceLine x={refX} stroke="#6b7280" strokeDasharray="4 4" strokeOpacity={0.5}
              label={{ value: String(refX), position: 'insideTopRight', fill: LABEL_FILL, fontSize: 9 }} />
          )}
          {refY !== undefined && (
            <ReferenceLine y={refY} stroke="#6b7280" strokeDasharray="4 4" strokeOpacity={0.5}
              label={{ value: String(refY), position: 'insideTopRight', fill: LABEL_FILL, fontSize: 9 }} />
          )}
          <Scatter data={data} fill={dotColor} fillOpacity={0.65} />
          {reg && (
            <ReferenceLine
              segment={[{ x: reg.x1, y: reg.y1 }, { x: reg.x2, y: reg.y2 }]}
              stroke={dotColor}
              strokeWidth={2}
              strokeOpacity={0.7}
            />
          )}
        </ScatterChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Weekly stress chart ───────────────────────────────────────────────────────

function WeeklyStressChart({ data }: { data: StressRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map(d => ({
      label: format(parseISO(d.week_start), 'd MMM'),
      stress: d.stress_value,
    }))

  return (
    <ResponsiveContainer width="99%" height={200}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id="stressGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={TICK} tickLine={false} interval={5} />
        <YAxis domain={[20, 65]} tick={TICK} tickLine={false} axisLine={false} width={28} />
        <Tooltip
          contentStyle={TIP}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(v: unknown): [string, string] => [String(v), 'Avg stress']}
        />
        <ReferenceLine
          y={40}
          stroke="#6b7280"
          strokeDasharray="4 4"
          strokeOpacity={0.5}
          label={{ value: '40', fill: '#6b7280', fontSize: 9, position: 'insideTopRight' }}
        />
        <Area
          type="monotone"
          dataKey="stress"
          name="Weekly Stress"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#stressGrad)"
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Run Recovery Cost ─────────────────────────────────────────────────────────

function RunRecoveryCostPanel({ data }: { data: RunLoadRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()

  if (!data.length) return null

  const chartData = [...data]
    .sort((a, b) => a.run_date.localeCompare(b.run_date))
    .map(d => ({
      label: format(parseISO(d.run_date), 'MMM d'),
      impact: d.bb_impact,
      name: d.name ?? 'Run',
      km: Number(d.distance_km ?? 0).toFixed(1),
    }))

  return (
    <Card>
      <ChartHeader
        title="Run Recovery Cost"
        sub="Body battery impact the day after each run — green = recovered, red = depleted"
      />

      {/* Bar chart */}
      <ResponsiveContainer width="99%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={32} />
          <ReferenceLine y={0} stroke="#6b7280" strokeOpacity={0.5} />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v, name): [string, string] => {
              const n = Number(Array.isArray(v) ? v[0] : (v ?? 0))
              return [`${n > 0 ? '+' : ''}${n} BB pts`, String(name)]
            }}
          />
          <Bar dataKey="impact" name="BB impact" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={(entry.impact ?? 0) >= 0 ? '#10b981' : '#ef4444'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800">
              <th className="text-left pb-2 pr-3 font-medium">Run</th>
              <th className="text-right pb-2 px-2 font-medium">Date</th>
              <th className="text-right pb-2 px-2 font-medium">km</th>
              <th className="text-right pb-2 px-2 font-medium">Effort</th>
              <th className="text-right pb-2 px-2 font-medium">Sleep before</th>
              <th className="text-right pb-2 pl-2 font-medium">BB impact</th>
              <th className="text-right pb-2 pl-2 font-medium">RHR impact</th>
            </tr>
          </thead>
          <tbody>
            {[...data]
              .sort((a, b) => b.run_date.localeCompare(a.run_date))
              .slice(0, 12)
              .map((d, i) => {
                const bbImp = d.bb_impact ?? 0
                const rhrImp = d.rhr_impact ?? 0
                return (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800/50 last:border-0">
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 truncate max-w-[120px]">
                      {d.name ?? 'Run'}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500">
                      {format(parseISO(d.run_date), 'd MMM')}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500">
                      {Number(d.distance_km ?? 0).toFixed(1)}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500">
                      {d.relative_effort ?? '--'}
                    </td>
                    <td className="py-2 px-2 text-right text-gray-500">
                      {d.sleep_night_before ? `${Number(d.sleep_night_before).toFixed(1)}h` : '--'}
                    </td>
                    <td className={`py-2 pl-2 text-right font-medium tabular-nums ${bbImp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {bbImp > 0 ? '+' : ''}{bbImp}
                    </td>
                    <td className={`py-2 pl-2 text-right font-medium tabular-nums ${rhrImp <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {rhrImp > 0 ? '+' : ''}{rhrImp}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecoveryPage() {
  const { user } = useAuth()
  const [trend, setTrend] = useState<TrendRow[]>([])
  const [sleep, setSleep] = useState<SleepRow[]>([])
  const [corr, setCorr] = useState<CorrRow[]>([])
  const [stress, setStress] = useState<StressRow[]>([])
  const [runLoad, setRunLoad] = useState<RunLoadRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const uid = user.id

    Promise.all([
      supabase
        .from('v_recovery_trend')
        .select('date,resting_hr,avg_stress,body_battery_highest,sleep_hours,rhr_7d_avg,stress_7d_avg,sleep_7d_avg,bb_high_7d_avg')
        .eq('user_id', uid)
        .order('date', { ascending: false })
        .limit(90),
      supabase
        .from('v_sleep_quality')
        .select('date,sleep_hours,sleep_deep_seconds,sleep_light_seconds,sleep_rem_seconds,sleep_awake_seconds,sleep_deep_percent,sleep_rem_percent')
        .eq('user_id', uid)
        .order('date', { ascending: false })
        .limit(30),
      supabase
        .from('v_correlations')
        .select('date,sleep_hours,avg_stress,resting_hr,next_bb_high,week_vigorous_total,week_avg_bb_high')
        .eq('user_id', uid)
        .order('date', { ascending: false }),
      supabase
        .from('garmin_weekly_stress')
        .select('week_start,stress_value')
        .eq('user_id', uid)
        .order('week_start', { ascending: true }),
      supabase
        .from('v_run_load_recovery')
        .select('run_date,name,distance_km,relative_effort,sleep_night_before,bb_peak_day_of_run,next_day_bb_peak,next_day_rhr,rhr_day_of_run,bb_impact,rhr_impact')
        .eq('user_id', uid)
        .order('run_date', { ascending: false })
        .limit(20),
    ]).then(([t, s, c, w, rl]) => {
      setTrend(t.data ?? [])
      setSleep(s.data ?? [])
      setCorr(c.data ?? [])
      setStress(w.data ?? [])
      setRunLoad(rl.data ?? [])
      setLoading(false)
    })
  }, [user])

  // ── Derived scatter data ──

  const sleepToBB = useMemo(
    () =>
      corr
        .filter(d => d.sleep_hours != null && d.next_bb_high != null)
        .map(d => ({ x: Number(d.sleep_hours), y: d.next_bb_high as number })),
    [corr],
  )

  const stressToRHR = useMemo(
    () =>
      corr
        .filter(d => d.avg_stress != null && d.resting_hr != null)
        .map(d => ({ x: d.avg_stress as number, y: d.resting_hr as number })),
    [corr],
  )

  const vigToBB = useMemo(() => {
    const seen = new Set<string>()
    return corr
      .filter(d => d.week_vigorous_total != null && d.week_avg_bb_high != null)
      .map(d => ({
        x: d.week_vigorous_total as number,
        y: Number(d.week_avg_bb_high),
        key: `${d.week_vigorous_total}-${d.week_avg_bb_high}`,
      }))
      .filter(d => {
        if (seen.has(d.key)) return false
        seen.add(d.key)
        return true
      })
  }, [corr])

  // ── Sleep summary stats ──

  const avgSleepHrs = avg(sleep.map(d => n(d.sleep_hours)))
  const avgDeepPct = avg(sleep.map(d => n(d.sleep_deep_percent)))
  const avgRemPct = avg(sleep.map(d => n(d.sleep_rem_percent)))
  const lowDeepNights = sleep.filter(d => {
    const v = n(d.sleep_deep_percent)
    return v !== null && v < 5
  }).length

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
        <h1 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">Recovery</h1>
        <p className="text-xs text-gray-500">
          90-day wellness signals · dashed lines = 7-day rolling average
        </p>
      </div>

      {/* Recovery trend — split into two focused charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <ChartHeader
            title="Battery & Sleep"
            sub="Body battery · sleep hours — 90 days · faded = 7d avg"
          />
          <BatterySleepChart data={trend} />
        </Card>
        <Card>
          <ChartHeader
            title="Stress & Resting HR"
            sub="Stress · RHR — 90 days · faded = 7d avg"
          />
          <StressRHRChart data={trend} />
        </Card>
      </div>

      {/* Run recovery cost */}
      <RunRecoveryCostPanel data={runLoad} />

      {/* Sleep stages + summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Card className="lg:col-span-8">
          <ChartHeader
            title="Sleep Stages"
            sub="Last 30 nights · Deep · REM · Light · Awake in hours"
          />
          <SleepStagesChart data={sleep} />
        </Card>
        <Card className="lg:col-span-4">
          <ChartHeader title="30-Night Average" />
          <StatRow
            label="Avg sleep"
            value={avgSleepHrs != null ? avgSleepHrs.toFixed(1) : '--'}
            unit="hrs"
            accent="text-purple-400"
          />
          <StatRow
            label="Avg deep"
            value={avgDeepPct != null ? avgDeepPct.toFixed(1) : '--'}
            unit="%"
            accent={avgDeepPct != null && avgDeepPct < 8 ? 'text-amber-400' : 'text-blue-400'}
          />
          <StatRow
            label="Avg REM"
            value={avgRemPct != null ? avgRemPct.toFixed(1) : '--'}
            unit="%"
            accent="text-purple-400"
          />
          <StatRow
            label="Low deep nights"
            value={String(lowDeepNights)}
            unit="< 5% deep"
            accent={lowDeepNights > 4 ? 'text-amber-400' : 'text-emerald-400'}
          />
        </Card>
      </div>

      {/* Cross-signal scatter plots */}
      <div>
        <p className="text-[10px] font-medium text-gray-500 dark:text-gray-600 uppercase tracking-widest mb-2">
          Cross-signal correlations
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ScatterPanel
            data={sleepToBB}
            xLabel="Sleep hrs"
            yLabel="Next-day BB"
            title="Sleep → Next-day Battery"
            sub="More sleep → higher body battery?"
            dotColor="#8b5cf6"
            xDomain={[4, 11]}
            yDomain={[0, 100]}
            refX={7.5}
            refY={70}
          />
          <ScatterPanel
            data={stressToRHR}
            xLabel="Avg stress"
            yLabel="RHR (bpm)"
            title="Stress → Resting HR"
            sub="Does high stress elevate RHR?"
            dotColor="#f59e0b"
            xDomain={[15, 80]}
            yDomain={[40, 70]}
            refX={40}
            refY={53}
          />
          <ScatterPanel
            data={vigToBB}
            xLabel="Vigorous min"
            yLabel="Avg BB"
            title="Training Load → Battery"
            sub="Weekly vigorous min vs avg body battery"
            dotColor="#10b981"
            xDomain={[0, 200]}
            yDomain={[40, 100]}
            refX={150}
          />
        </div>
      </div>

      {/* Weekly stress */}
      <Card>
        <ChartHeader
          title="Weekly Stress Trend"
          sub="39 weeks · reference at 40 = moderate threshold"
        />
        <WeeklyStressChart data={stress} />
      </Card>
    </div>
  )
}
