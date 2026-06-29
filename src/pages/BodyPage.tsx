import { useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { bodyFatColor, visceralFatColor, metabolicAgeColor } from '../lib/rag'
import { useChartTheme } from '../lib/chartTheme'

// ── Types ─────────────────────────────────────────────────────────────────────

type FitnessAgeRow = {
  date: string
  fitness_age: number | null
  chronological_age: number | null
  achievable_fitness_age: number | null
}

type BodyRow = {
  date: string
  weight_kg: string | null
  bmi: string | null
  body_fat_percent: string | null
  muscle_mass_kg: string | null
  bone_mass_kg: string | null
  hydration_percent: string | null
  visceral_fat: string | null
  visceral_fat_rating: number | null
  metabolic_age: number | null
  physique_rating: number | null
  basal_metabolic_rate: number | null
}

// ── Chart config moved to useChartTheme() hook ───────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const x = Number(v)
  return isNaN(x) ? null : x
}

function rolling7(arr: (number | null)[]): (number | null)[] {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v != null)
    return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null
  })
}

function fmt(date: string) {
  return format(parseISO(date), 'MMM d')
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
  label, value, unit, accent, sub,
}: {
  label: string; value: string | null; unit?: string; accent: string; sub?: string
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

// ── Weight Trend ──────────────────────────────────────────────────────────────

function WeightTrendChart({ data }: { data: BodyRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const weights = data.map(r => n(r.weight_kg))
  const avgs = rolling7(weights)

  const chartData = data.map((r, i) => ({
    date: fmt(r.date),
    weight: n(r.weight_kg),
    avg7: avgs[i] != null ? Math.round(avgs[i]! * 100) / 100 : null,
  }))

  const allWeights = weights.filter((v): v is number => v != null)
  const lo = Math.floor(Math.min(...allWeights) - 0.5)
  const hi = Math.ceil(Math.max(...allWeights) + 0.5)

  return (
    <Card>
      <ChartHeader title="Weight Trend" sub="Daily weigh-in · 7-day rolling average" />
      <ResponsiveContainer width="99%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            domain={[lo, hi]}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(v: number) => `${v}kg`}
          />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown, name: unknown): [string, string] => [
              `${Number(v).toFixed(2)} kg`,
              name === 'avg7' ? '7d avg' : 'Weight',
            ]}
          />
          <Bar dataKey="weight" name="weight" fill="#3b82f6" fillOpacity={0.25} maxBarSize={6} radius={[2, 2, 0, 0]} />
          <Line
            dataKey="avg7"
            name="avg7"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Body Fat ──────────────────────────────────────────────────────────────────

function BodyFatChart({ data }: { data: BodyRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const compData = data.filter(r => r.body_fat_percent != null)
  if (!compData.length) return null

  const vals = compData.map(r => n(r.body_fat_percent)).filter((v): v is number => v != null)
  const lo = Math.floor(Math.min(...vals) - 0.5)
  const hi = Math.ceil(Math.max(...vals) + 0.5)

  const chartData = compData.map(r => ({ date: fmt(r.date), fat: n(r.body_fat_percent) }))

  return (
    <Card>
      <ChartHeader title="Body Fat" sub="% over time" />
      <ResponsiveContainer width="99%" height={180}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[lo, hi]} tick={TICK} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v}%`} />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [`${Number(v).toFixed(1)}%`, 'Body Fat']}
          />
          <ReferenceLine y={20} stroke="#6b7280" strokeDasharray="4 4" strokeOpacity={0.6}
            label={{ value: 'fit range', fill: '#6b7280', fontSize: 9, position: 'insideTopRight' }} />
          <Line dataKey="fat" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Muscle Mass ───────────────────────────────────────────────────────────────

function MuscleMassChart({ data }: { data: BodyRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const compData = data.filter(r => r.muscle_mass_kg != null)
  if (!compData.length) return null

  const vals = compData.map(r => n(r.muscle_mass_kg)).filter((v): v is number => v != null)
  const lo = Math.floor(Math.min(...vals) - 0.5)
  const hi = Math.ceil(Math.max(...vals) + 0.5)

  const chartData = compData.map(r => ({ date: fmt(r.date), muscle: n(r.muscle_mass_kg) }))

  return (
    <Card>
      <ChartHeader title="Muscle Mass" sub="kg over time" />
      <ResponsiveContainer width="99%" height={180}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" />
          <YAxis domain={[lo, hi]} tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}kg`} />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [`${Number(v).toFixed(2)} kg`, 'Muscle Mass']}
          />
          <Line dataKey="muscle" stroke="#10b981" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Visceral Fat Chart ────────────────────────────────────────────────────────

function VisceralFatChart({ data }: { data: BodyRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  const compData = data.filter(r => r.visceral_fat != null)
  if (!compData.length) return null

  const chartData = compData.map(r => ({
    date: fmt(r.date),
    visceral: n(r.visceral_fat),
  }))

  return (
    <Card>
      <ChartHeader
        title="Visceral Fat Score"
        sub="Scale 1–59 · healthy range below 10"
      />
      <ResponsiveContainer width="99%" height={160}>
        <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" />
          <YAxis
            domain={[7, 12]}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <ReferenceLine y={10} stroke="#374151" strokeDasharray="4 4" label={{ value: 'threshold', fill: '#6b7280', fontSize: 9, position: 'insideTopRight' }} />
          <Tooltip
            contentStyle={TIP}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(v: unknown): [string, string] => [`${v}`, 'Visceral Fat']}
          />
          <Line
            dataKey="visceral"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  )
}

// ── Stats Panel ───────────────────────────────────────────────────────────────

function StatRow({ label, value, accent = 'text-gray-700 dark:text-gray-300' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-gray-200 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-medium tabular-nums ${accent}`}>{value}</span>
    </div>
  )
}

function StatsPanel({ latest }: { latest: BodyRow | null }) {
  if (!latest) return null

  const hydration = n(latest.hydration_percent)
  const bone = n(latest.bone_mass_kg)
  const bmr = latest.basal_metabolic_rate
  const metAge = latest.metabolic_age
  const bmi = n(latest.bmi)

  return (
    <Card>
      <ChartHeader title="Latest Reading" sub={latest.date ? format(parseISO(latest.date), 'EEEE d MMMM yyyy') : undefined} />
      <StatRow label="BMI" value={bmi != null ? bmi.toFixed(1) : '--'} />
      <StatRow
        label="Metabolic Age"
        value={metAge != null ? `${metAge} yrs` : '--'}
        accent={metabolicAgeColor(metAge)}
      />
      <StatRow label="Hydration" value={hydration != null ? `${hydration.toFixed(1)}%` : '--'} />
      <StatRow label="Bone Mass" value={bone != null ? `${bone.toFixed(2)} kg` : '--'} />
      <StatRow label="Basal Metabolic Rate" value={bmr != null ? `${bmr.toLocaleString()} kcal` : '--'} />
    </Card>
  )
}

// ── Fitness Age ───────────────────────────────────────────────────────────────

function FitnessAgeSection({ data }: { data: FitnessAgeRow[] }) {
  const { TIP, GRID, TICK } = useChartTheme()
  if (!data.length) return null

  const latest = data[data.length - 1]
  const diff = latest.fitness_age != null && latest.chronological_age != null
    ? latest.chronological_age - latest.fitness_age
    : null

  return (
    <Card>
      <ChartHeader
        title="Fitness Age"
        sub="Garmin fitness age vs chronological age · lower is better"
      />
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Fitness Age</p>
          <p className="text-2xl font-semibold text-blue-400">{latest.fitness_age ?? '--'}<span className="text-xs font-normal text-gray-500 ml-1">yrs</span></p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Chronological</p>
          <p className="text-2xl font-semibold text-gray-400">{latest.chronological_age ?? '--'}<span className="text-xs font-normal text-gray-500 ml-1">yrs</span></p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Advantage</p>
          <p className={`text-2xl font-semibold ${diff != null && diff > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {diff != null ? `${diff > 0 ? '+' : ''}${diff} yrs` : '--'}
          </p>
        </div>
      </div>
      {/* Achievable target */}
      {latest.achievable_fitness_age != null && (
        <p className="text-[11px] text-gray-500 mb-3">
          Achievable fitness age: <span className="text-emerald-400 font-medium">{latest.achievable_fitness_age} yrs</span>
        </p>
      )}
      {/* Chart — only renders with 2+ data points */}
      {data.length >= 2 && (
        <ResponsiveContainer width="99%" height={160}>
          <LineChart
            data={data.map(r => ({ date: fmt(r.date), fitness: r.fitness_age, chrono: r.chronological_age, achievable: r.achievable_fitness_age }))}
            margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tick={TICK} tickLine={false} interval="preserveStartEnd" />
            <YAxis domain={['auto', 'auto']} tick={TICK} tickLine={false} axisLine={false} width={28} />
            <Tooltip contentStyle={TIP} labelStyle={{ color: '#9ca3af' }}
              formatter={(v, name): [string, string] => [`${v} yrs`, String(name)]} />
            <Line dataKey="fitness" name="Fitness Age" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
            <Line dataKey="chrono" name="Chronological" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls />
            <Line dataKey="achievable" name="Achievable" stroke="#10b981" strokeWidth={1} strokeDasharray="4 4" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
      {data.length < 2 && (
        <p className="text-[11px] text-gray-600">Chart will populate as Garmin syncs fitness age data over time.</p>
      )}
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BodyPage() {
  const { user } = useAuth()
  const [data, setData] = useState<BodyRow[]>([])
  const [fitnessAge, setFitnessAge] = useState<FitnessAgeRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase
        .from('zepp_body_composition')
        .select('date,weight_kg,bmi,body_fat_percent,muscle_mass_kg,bone_mass_kg,hydration_percent,visceral_fat,visceral_fat_rating,metabolic_age,physique_rating,basal_metabolic_rate')
        .eq('user_id', user.id)
        .order('date', { ascending: true }),
      supabase
        .from('garmin_fitness_age')
        .select('date,fitness_age,chronological_age,achievable_fitness_age')
        .eq('user_id', user.id)
        .order('date', { ascending: true }),
    ]).then(([body, fa]) => {
      setData(body.data ?? [])
      setFitnessAge(fa.data ?? [])
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

  const latest = data.length ? data[data.length - 1] : null
  const compRows = data.filter(r => r.body_fat_percent != null)

  // 4-week ago row for delta context
  const fourWeeksAgo = data.slice(-28)[0] ?? null

  const currentWeight = n(latest?.weight_kg)
  const prevWeight = n(fourWeeksAgo?.weight_kg)
  const weightDelta = currentWeight != null && prevWeight != null ? currentWeight - prevWeight : null

  const currentFat = n(latest?.body_fat_percent)
  const prevFat = compRows.length > 1 ? n(compRows[compRows.length - 28 < 0 ? 0 : compRows.length - 28]?.body_fat_percent) : null
  const fatDelta = currentFat != null && prevFat != null ? currentFat - prevFat : null

  const currentMuscle = n(latest?.muscle_mass_kg)
  const prevMuscle = compRows.length > 1 ? n(compRows[compRows.length - 28 < 0 ? 0 : compRows.length - 28]?.muscle_mass_kg) : null
  const muscleDelta = currentMuscle != null && prevMuscle != null ? currentMuscle - prevMuscle : null

  const visceral = n(latest?.visceral_fat)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white mb-0.5">Body Composition</h1>
        <p className="text-xs text-gray-500">
          {data.length} readings · {compRows.length} with full composition data · Oct 2025 – present
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="Weight"
          value={currentWeight != null ? currentWeight.toFixed(1) : null}
          unit="kg"
          accent="text-blue-400"
          sub={weightDelta != null
            ? `${weightDelta > 0 ? '+' : ''}${weightDelta.toFixed(1)} kg vs 4 weeks ago`
            : undefined}
        />
        <KpiCard
          label="Body Fat"
          value={currentFat != null ? `${currentFat.toFixed(1)}` : null}
          unit="%"
          accent={bodyFatColor(currentFat)}
          sub={fatDelta != null
            ? `${fatDelta > 0 ? '+' : ''}${fatDelta.toFixed(1)}% vs 4 weeks ago`
            : undefined}
        />
        <KpiCard
          label="Muscle Mass"
          value={currentMuscle != null ? currentMuscle.toFixed(1) : null}
          unit="kg"
          accent="text-emerald-400"
          sub={muscleDelta != null
            ? `${muscleDelta > 0 ? '+' : ''}${muscleDelta.toFixed(2)} kg vs 4 weeks ago`
            : undefined}
        />
        <KpiCard
          label="Visceral Fat"
          value={visceral != null ? String(visceral) : null}
          accent={visceralFatColor(visceral)}
          sub={visceral != null && visceral < 9 ? 'healthy range' : visceral != null && visceral < 12 ? 'watch' : undefined}
        />
      </div>

      {/* Weight trend */}
      <WeightTrendChart data={data} />

      {/* Composition + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BodyFatChart data={data} />
        <MuscleMassChart data={data} />
        <StatsPanel latest={latest} />
      </div>

      {/* Visceral fat */}
      <VisceralFatChart data={data} />

      {/* Fitness age */}
      <FitnessAgeSection data={fitnessAge} />
    </div>
  )
}
