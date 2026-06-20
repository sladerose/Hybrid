import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { sessionRatingColor } from '../lib/rag'
import { useChartTheme } from '../lib/chartTheme'

// ── Types ─────────────────────────────────────────────────────────────────────

type SessionRow = {
  session_id: number
  user_id: string
  date: string
  day: string
  session_rating: number | null
  duration_minutes: number | null
  body_weight: number | null
  session_notes: string | null
  exercise_count: number | null
  total_sets: number | null
  total_volume_kg: string | null
  avg_weight_kg: string | null
  max_weight_lifted_kg: string | null
  avg_reps: string | null
}

type ExerciseRow = {
  exercise: string
  muscle_group: string
  secondary_muscle_group: string | null
  movement_pattern: string
  date: string
  day: string
  user_id: string
  sets: number | null
  max_weight_kg: string | null
  avg_weight_kg: string | null
  volume_kg: string | null
  avg_reps: string | null
}

// ── Chart config moved to useChartTheme() hook ───────────────────────────────

const DAY_COLOR: Record<string, string> = {
  Push: '#f97316',
  Pull: '#3b82f6',
  Legs: '#8b5cf6',
}

const MUSCLE_COLORS: Record<string, string> = {
  Lats: '#3b82f6',
  Chest: '#f97316',
  Quadriceps: '#8b5cf6',
  Triceps: '#f97316',
  Shoulders: '#f97316',
  Biceps: '#3b82f6',
  Traps: '#f97316',
  Calves: '#8b5cf6',
  Abs: '#6b7280',
  Glutes: '#8b5cf6',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const x = Number(v)
  return isNaN(x) ? null : x
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

// ── Session Volume Bar ────────────────────────────────────────────────────────

function SessionVolumeChart({ data }: { data: SessionRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const chartData = [...data]
    .reverse()
    .map(s => ({
      label: format(parseISO(s.date), 'MMM d'),
      volume: n(s.total_volume_kg),
      day: s.day,
    }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Session Volume" />
        <div className="h-[260px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No sessions recorded yet</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader title="Session Volume" sub="Total weight lifted (kg) per session" />
      <ResponsiveContainer width="99%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} />
          <YAxis
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}t`}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown, name: unknown): [string, string] => [
              `${Number(v).toLocaleString()} kg`,
              String(name),
            ]}
          />
          <Bar dataKey="volume" name="Volume" maxBarSize={72} radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={DAY_COLOR[entry.day] ?? '#f97316'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 justify-center">
        {Object.entries(DAY_COLOR).map(([day, color]) => (
          <div key={day} className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {day}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Push / Pull / Legs balance ────────────────────────────────────────────────

function PPLBalanceChart({ data }: { data: SessionRow[] }) {
  const balance: Record<string, { sessions: number; sets: number; volume: number }> = {}

  for (const s of data) {
    const day = s.day ?? 'Other'
    if (!balance[day]) balance[day] = { sessions: 0, sets: 0, volume: 0 }
    balance[day].sessions++
    balance[day].sets += n(s.total_sets) ?? 0
    balance[day].volume += n(s.total_volume_kg) ?? 0
  }

  const rows = Object.entries(balance)
    .sort((a, b) => b[1].volume - a[1].volume)
    .map(([day, v]) => ({ day, ...v }))

  const maxSets = Math.max(...rows.map(r => r.sets), 1)

  if (!rows.length) {
    return (
      <Card>
        <ChartHeader title="Push / Pull / Legs" />
        <div className="h-[220px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No sessions yet</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader title="Push / Pull / Legs" sub="Sessions · sets · volume per day type" />
      <div className="space-y-5 mt-4">
        {rows.map(r => {
          const pct = (r.sets / maxSets) * 100
          const color = DAY_COLOR[r.day] ?? '#6b7280'
          return (
            <div key={r.day}>
              <div className="flex justify-between items-baseline mb-1.5">
                <span className="text-sm font-medium" style={{ color }}>{r.day}</span>
                <span className="text-[11px] text-gray-500">
                  {r.sessions} session{r.sessions !== 1 ? 's' : ''} &middot; {r.sets} sets &middot; {(r.volume / 1000).toFixed(1)}t
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Muscle Group Volume ───────────────────────────────────────────────────────

function MuscleGroupChart({ data }: { data: ExerciseRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const agg: Record<string, number> = {}
  for (const row of data) {
    const mg = row.muscle_group
    agg[mg] = (agg[mg] ?? 0) + (n(row.volume_kg) ?? 0)
  }

  const chartData = Object.entries(agg)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([mg, vol]) => ({ mg, vol }))

  if (!chartData.length) {
    return (
      <Card>
        <ChartHeader title="Volume by Muscle Group" />
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-gray-500 dark:text-gray-600 text-sm">No data</p>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <ChartHeader title="Volume by Muscle Group" sub="Cumulative kg lifted across all sessions" />
      <ResponsiveContainer width="99%" height={Math.max(180, chartData.length * 32)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 48, bottom: 4, left: 72 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
          <XAxis
            type="number"
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}kg`}
          />
          <YAxis
            type="category"
            dataKey="mg"
            tick={{ ...TICK, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={68}
          />
          <Tooltip
            contentStyle={TIP}
            formatter={(v: unknown): [string, string] => [`${Number(v).toLocaleString()} kg`, 'Volume']}
          />
          <Bar dataKey="vol" name="Volume" maxBarSize={20} radius={[0, 3, 3, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={MUSCLE_COLORS[entry.mg] ?? '#6b7280'} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Exercise Progression Table ────────────────────────────────────────────────

function ExerciseProgressionTable({ data }: { data: ExerciseRow[] }) {
  const byExercise: Record<string, ExerciseRow[]> = {}
  for (const row of data) {
    if (!byExercise[row.exercise]) byExercise[row.exercise] = []
    byExercise[row.exercise].push(row)
  }

  for (const ex of Object.keys(byExercise)) {
    byExercise[ex].sort((a, b) => a.date.localeCompare(b.date))
  }

  const tableRows = Object.entries(byExercise).map(([exercise, history]) => {
    const latest = history[history.length - 1]
    const prev = history.length > 1 ? history[history.length - 2] : null
    const latestMax = n(latest.max_weight_kg) ?? 0
    const prevMax = prev ? (n(prev.max_weight_kg) ?? 0) : null
    const delta = prevMax != null ? latestMax - prevMax : null
    return {
      exercise,
      muscle_group: latest.muscle_group,
      movement_pattern: latest.movement_pattern,
      max_weight: latestMax,
      avg_reps: n(latest.avg_reps),
      sets: latest.sets ?? 0,
      delta,
      sessions: history.length,
    }
  }).sort((a, b) => {
    // Bodyweight (0kg) last, then descending by max weight
    if (a.max_weight === 0 && b.max_weight > 0) return 1
    if (b.max_weight === 0 && a.max_weight > 0) return -1
    return b.max_weight - a.max_weight
  })

  return (
    <Card>
      <ChartHeader title="Exercise Progression" sub="Latest max weight · delta vs previous session" />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800">
              <th className="text-left py-2 pr-3 text-gray-500 font-medium">Exercise</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">Max kg</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">Avg reps</th>
              <th className="text-right py-2 pr-3 text-gray-500 font-medium">Sets</th>
              <th className="text-right py-2 text-gray-500 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(r => (
              <tr key={r.exercise} className="border-b border-gray-200/50 dark:border-gray-800/50 last:border-0">
                <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">
                  <div>{r.exercise}</div>
                  <div className="text-gray-400 dark:text-gray-600 text-[10px]">
                    {r.muscle_group}
                    {r.movement_pattern === 'Compound' && (
                      <span className="ml-1 text-orange-500 dark:text-orange-700">compound</span>
                    )}
                  </div>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.max_weight > 0 ? (
                    <span className="text-orange-400 font-medium">{r.max_weight}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-600">BW</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                  {r.avg_reps != null ? r.avg_reps.toFixed(0) : '--'}
                </td>
                <td className="py-2 pr-3 text-right text-gray-500 tabular-nums">{r.sets}</td>
                <td className="py-2 text-right tabular-nums">
                  {r.delta == null ? (
                    <span className="text-gray-700">first</span>
                  ) : r.delta > 0 ? (
                    <span className="text-emerald-400">+{r.delta}</span>
                  ) : r.delta < 0 ? (
                    <span className="text-red-400">{r.delta}</span>
                  ) : (
                    <span className="text-gray-600">=</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Session Log ───────────────────────────────────────────────────────────────

function SessionLog({ data }: { data: SessionRow[] }) {
  return (
    <Card>
      <ChartHeader title="Session Log" />
      <div className="space-y-3">
        {data.map(s => {
          const vol = n(s.total_volume_kg)
          const color = DAY_COLOR[s.day] ?? '#9ca3af'
          return (
            <div key={s.session_id} className="border border-gray-200 dark:border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color }}>
                    {s.day}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {format(parseISO(s.date), 'EEE d MMM yyyy')}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-500 dark:text-gray-600">{s.exercise_count} exercises · {s.total_sets} sets</span>
                  {vol != null && (
                    <span className="text-orange-400 font-medium tabular-nums">
                      {vol.toLocaleString()} kg
                    </span>
                  )}
                  {s.session_rating != null && (
                    <span className={`font-medium ${sessionRatingColor(s.session_rating)}`}>
                      {s.session_rating}/5
                    </span>
                  )}
                </div>
              </div>
              {s.session_notes && (
                <p className="text-[11px] text-gray-500 dark:text-gray-600 leading-relaxed mt-1">{s.session_notes}</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StrengthPage() {
  const { user } = useAuth()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [exercises, setExercises] = useState<ExerciseRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    const uid = user.id

    Promise.all([
      supabase
        .from('v_strength_sessions')
        .select('session_id,user_id,date,day,session_rating,duration_minutes,body_weight,session_notes,exercise_count,total_sets,total_volume_kg,avg_weight_kg,max_weight_lifted_kg,avg_reps')
        .eq('user_id', uid)
        .order('date', { ascending: false }),
      supabase
        .from('v_exercise_progression')
        .select('exercise,muscle_group,secondary_muscle_group,movement_pattern,date,day,user_id,sets,max_weight_kg,avg_weight_kg,volume_kg,avg_reps')
        .eq('user_id', uid)
        .order('date', { ascending: false }),
    ]).then(([s, e]) => {
      setSessions(s.data ?? [])
      setExercises(e.data ?? [])
      setLoading(false)
    })
  }, [user])

  // ── KPIs ──

  const totalSessions = sessions.length
  const totalVolume = sessions.reduce((sum, s) => sum + (n(s.total_volume_kg) ?? 0), 0)
  const maxWeightLifted = sessions.reduce(
    (mx, s) => Math.max(mx, n(s.max_weight_lifted_kg) ?? 0),
    0,
  )
  const ratedSessions = sessions.filter(s => s.session_rating != null)
  const avgRating = ratedSessions.length
    ? ratedSessions.reduce((sum, s) => sum + s.session_rating!, 0) / ratedSessions.length
    : null

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
        <h1 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">Strength</h1>
        <p className="text-xs text-gray-500">
          Session volume · exercise progression · Push / Pull / Legs balance
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Sessions"
          value={String(totalSessions)}
          accent="text-orange-400"
          sub="since Jun 2026"
        />
        <KpiCard
          label="Total Volume"
          value={totalVolume > 0 ? (totalVolume / 1000).toFixed(1) : null}
          unit="tonnes"
          accent="text-orange-400"
        />
        <KpiCard
          label="Max Weight"
          value={maxWeightLifted > 0 ? String(maxWeightLifted) : null}
          unit="kg"
          accent="text-orange-400"
          sub="across all exercises"
        />
        <KpiCard
          label="Avg Session"
          value={avgRating != null ? avgRating.toFixed(1) : null}
          unit="/ 5"
          accent={sessionRatingColor(avgRating)}
          sub={ratedSessions.length < sessions.length ? `${ratedSessions.length}/${sessions.length} rated` : undefined}
        />
      </div>

      {/* Volume bar + PPL balance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SessionVolumeChart data={sessions} />
        <PPLBalanceChart data={sessions} />
      </div>

      {/* Muscle group volume */}
      <MuscleGroupChart data={exercises} />

      {/* Exercise progression */}
      <ExerciseProgressionTable data={exercises} />

      {/* Session log */}
      {sessions.length > 0 && <SessionLog data={sessions} />}
    </div>
  )
}
