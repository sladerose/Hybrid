import { Suspense, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { HumanFigure } from './HumanFigure'
import {
  DB_TO_MUSCLE,
  MUSCLE_LABELS,
  ALL_MUSCLE_KEYS,
  MUSCLE_GROUPS,
  heatColor,
  statusBadge,
} from './muscleConfig'
import type { MuscleGroupKey, MuscleStats, MuscleStatsMap } from './muscleConfig'
import { useTheme } from '../../context/ThemeContext'

// ── Raw row type from v_exercise_progression ──────────────────────────────────

export interface ExerciseDataRow {
  exercise: string
  muscle_group: string
  date: string
  volume_kg: string | null
}

// ── Stats builder ─────────────────────────────────────────────────────────────

const WINDOW_DAYS = 28

function buildStatsMap(rows: ExerciseDataRow[]): MuscleStatsMap {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS)

  const map   = new Map<MuscleGroupKey, MuscleStats>()
  const today = new Date().toISOString().split('T')[0]

  for (const row of rows) {
    const key = DB_TO_MUSCLE[row.muscle_group]
    if (!key) continue

    const rowDate  = new Date(row.date)
    const isRecent = rowDate >= cutoff
    const volume   = row.volume_kg ? parseFloat(row.volume_kg) : 0

    const existing = map.get(key) ?? {
      group: key, sessions28: 0, totalVolume: 0,
      daysSince: null, lastDate: null, exercises: [],
    }

    if (isRecent) { existing.sessions28++; existing.totalVolume += volume }

    if (!existing.lastDate || row.date > existing.lastDate) {
      existing.lastDate = row.date
      const msPerDay    = 1000 * 60 * 60 * 24
      existing.daysSince = Math.floor(
        (new Date(today).getTime() - new Date(row.date).getTime()) / msPerDay,
      )
    }

    if (!existing.exercises.includes(row.exercise)) existing.exercises.push(row.exercise)

    map.set(key, existing)
  }

  return map
}

// ── Muscle chip ───────────────────────────────────────────────────────────────

function MuscleChip({
  group, stats, isSelected, onSelect,
}: {
  group: MuscleGroupKey
  stats: MuscleStatsMap
  isSelected: boolean
  onSelect: (g: MuscleGroupKey | null) => void
}) {
  const s    = stats.get(group)
  const s28  = s?.sessions28 ?? 0
  const col  = heatColor(s28)
  const days = s?.daysSince ?? null

  const recencyDot = days !== null && days <= 2

  return (
    <button
      onClick={() => onSelect(isSelected ? null : group)}
      style={isSelected ? {} : {}}
      className={[
        'relative flex flex-col gap-0 p-2 rounded-lg border text-left transition-all duration-150 w-full overflow-hidden',
        isSelected
          ? 'border-blue-400/60 bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-500/10'
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/40',
      ].join(' ')}
    >
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{ background: col }}
      />
      {/* Name row */}
      <div className="flex items-center justify-between pl-1">
        <span className="text-[11px] font-medium text-gray-800 dark:text-gray-100 leading-tight">
          {MUSCLE_LABELS[group]}
        </span>
        {recencyDot && (
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Recently trained" />
        )}
      </div>
      {/* Count */}
      <div className="pl-1">
        <span
          className="text-[16px] font-bold tabular-nums leading-none"
          style={{ color: s28 > 0 ? col : '#4b6a8a' }}
        >
          {s28 > 0 ? s28 : '0'}
        </span>
        <span className="text-[9px] text-gray-400 dark:text-gray-600 ml-1">sess</span>
      </div>
    </button>
  )
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  group, stats, onClose,
}: {
  group: MuscleGroupKey
  stats: MuscleStats | undefined
  onClose: () => void
}) {
  const s28    = stats?.sessions28 ?? 0
  const volume = stats?.totalVolume ?? 0
  const days   = stats?.daysSince ?? null
  const exs    = stats?.exercises ?? []
  const badge  = statusBadge(s28, days)
  const col    = heatColor(s28)

  const dayLabel = (d: number | null) => {
    if (d === null) return 'Never'
    if (d === 0)    return 'Today'
    if (d === 1)    return 'Yesterday'
    return `${d}d ago`
  }

  return (
    <div>
      {/* Title + close */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-base font-bold text-gray-900 dark:text-white leading-tight">
            {MUSCLE_LABELS[group]}
          </p>
          <span
            className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full"
            style={{ background: col + '22', color: badge.color }}
          >
            {badge.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:text-gray-600 dark:hover:text-gray-400 text-sm mt-0.5"
        >
          ✕
        </button>
      </div>

      {/* 3-stat grid */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatBox label="Sessions" value={String(s28)} color={col} />
        <StatBox label="Volume" value={volume > 0 ? `${Math.round(volume / 1000 * 10) / 10}t` : '—'} color={col} />
        <StatBox label="Last" value={dayLabel(days)} color={col} />
      </div>

      {/* Exercises */}
      {exs.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-gray-600 mb-2">
            Exercises
          </p>
          <ul className="space-y-1.5">
            {exs.map(ex => (
              <li key={ex} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: col }} />
                <span className="text-[12px] text-gray-600 dark:text-gray-400 leading-snug">{ex}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {exs.length === 0 && (
        <p className="text-[12px] text-gray-400 dark:text-gray-600 italic">No exercises logged yet</p>
      )}
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2 text-center">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-[14px] font-bold tabular-nums" style={{ color }}>{value}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface BodyModel3DProps {
  exerciseData: ExerciseDataRow[]
}

export function BodyModel3D({ exerciseData }: BodyModel3DProps) {
  const [selectedGroup, setSelectedGroup] = useState<MuscleGroupKey | null>(null)
  const stats         = useMemo(() => buildStatsMap(exerciseData), [exerciseData])
  const selectedStats = selectedGroup ? stats.get(selectedGroup) : undefined
  const { theme }     = useTheme()
  const isDark        = theme === 'dark'

  const activeCount    = ALL_MUSCLE_KEYS.filter(k => (stats.get(k)?.sessions28 ?? 0) > 0).length
  const neglectedCount = ALL_MUSCLE_KEYS.length - activeCount

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-1">
          Muscle Map
        </p>
        <p className="text-[11px] text-gray-500 dark:text-gray-500">
          <span className="text-emerald-500 font-medium">{activeCount}</span>
          {' of '}
          <span className="font-medium text-gray-700 dark:text-gray-300">{ALL_MUSCLE_KEYS.length}</span>
          {' groups trained'}
          {neglectedCount > 0 && (
            <>
              {' · '}
              <span className="text-gray-400 dark:text-gray-600">{neglectedCount} neglected</span>
            </>
          )}
          {' · last 28 days'}
        </p>
      </div>

      {/* Body: canvas left, chip panel right */}
      <div className="flex flex-col lg:flex-row">

        {/* 3D Canvas */}
        <div className="relative lg:w-[40%] h-[320px] lg:h-[380px]">
          <Canvas
            camera={{ position: [0, 0.24, 3.1], fov: 56 }}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: false }}
            style={{ width: '100%', height: '100%' }}
          >
            <Suspense fallback={null}>
              <HumanFigure
                stats={stats}
                selectedGroup={selectedGroup}
                onSelect={setSelectedGroup}
                isDark={isDark}
              />
            </Suspense>
          </Canvas>

          {/* Hint pill */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
            <div className="bg-black/25 dark:bg-black/40 backdrop-blur-sm rounded-full px-3 py-1">
              <p className="text-[10px] text-white/70 whitespace-nowrap">
                Drag to rotate · click to inspect
              </p>
            </div>
          </div>
        </div>

        {/* Right panel: chip grid OR detail view — swaps, never expands */}
        <div className="flex-1 border-t lg:border-t-0 lg:border-l border-gray-100 dark:border-gray-800 p-4 overflow-y-auto">
          {selectedGroup ? (
            <DetailPanel
              group={selectedGroup}
              stats={selectedStats}
              onClose={() => setSelectedGroup(null)}
            />
          ) : (
            <>
              <div className="space-y-3">
                {MUSCLE_GROUPS.map(grp => (
                  <div key={grp.label}>
                    <p
                      className="text-[11px] font-bold uppercase tracking-widest mb-1.5"
                      style={{ color: grp.color }}
                    >
                      {grp.label}
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {grp.muscles.map(group => (
                        <MuscleChip
                          key={group}
                          group={group}
                          stats={stats}
                          isSelected={selectedGroup === group}
                          onSelect={setSelectedGroup}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 dark:text-gray-700 leading-relaxed mt-3">
                Click a muscle on the model or above to inspect training detail.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
