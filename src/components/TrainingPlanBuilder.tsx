import { useState } from 'react'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { Card } from './shared/Card'

// ── Shared training-plan vocabulary ──────────────────────────────────────────
// Lives here (rather than in RunningPage.tsx) because this file already owns
// the day-editor UI that renders it, and pages import from components, not
// the other way round (see .planning/codebase/ARCHITECTURE.md's Module
// dependencies note). RunningPage.tsx imports these back for its read view.

export type WorkoutType = 'easy' | 'tempo' | 'intervals' | 'long' | 'race' | 'rest' | 'strides'

export const WORKOUT_STYLES: Record<WorkoutType, { dot: string; badge: string; text: string }> = {
  easy:      { dot: 'bg-blue-400',   badge: 'bg-blue-500/10 border-blue-500/30',     text: 'text-blue-400'   },
  long:      { dot: 'bg-purple-400', badge: 'bg-purple-500/10 border-purple-500/30', text: 'text-purple-400' },
  tempo:     { dot: 'bg-amber-400',  badge: 'bg-amber-500/10 border-amber-500/30',   text: 'text-amber-400'  },
  intervals: { dot: 'bg-red-400',    badge: 'bg-red-500/10 border-red-500/30',       text: 'text-red-400'    },
  strides:   { dot: 'bg-orange-400', badge: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-400' },
  race:      { dot: 'bg-green-400',  badge: 'bg-green-500/10 border-green-500/30',   text: 'text-green-400'  },
  rest:      { dot: 'bg-gray-600',   badge: 'border-transparent',                    text: 'text-gray-600'   },
}

// Default short label per type -- the builder's day editor only exposes
// type + km + description (see task spec), so `label` is derived rather
// than a separately-edited field.
const DEFAULT_LABEL: Record<WorkoutType, string> = {
  easy: 'Easy', tempo: 'Tempo', intervals: 'Intervals', long: 'Long',
  race: 'Race', rest: 'Rest', strides: 'Strides',
}

const WORKOUT_TYPE_OPTIONS: WorkoutType[] = ['rest', 'easy', 'long', 'tempo', 'intervals', 'strides', 'race']

// `phase` is free text on purpose (custom plans may not use Base/Build/Peak/
// Taper/Race at all) -- these are suggestions via <datalist>, not an enum.
export const PHASE_SUGGESTIONS = ['Base', 'Build', 'Peak', 'Taper', 'Race']

const KNOWN_PHASE_STYLE: Record<string, string> = {
  Base: 'text-blue-400',
  Build: 'text-amber-400',
  Peak: 'text-red-400',
  Taper: 'text-purple-400',
  Race: 'text-green-400',
}

export function phaseStyle(phase: string | null | undefined): string {
  if (!phase) return 'text-gray-400'
  return KNOWN_PHASE_STYLE[phase] ?? 'text-gray-400'
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

export type TrainingPlanRow = {
  id: number
  user_id: string
  name: string
  goal_type: string | null
  target_date: string | null
  target_distance_km: number | string | null
  target_time_seconds: number | null
  location: string | null
  start_date: string
  is_active: boolean
  created_at: string
}

export type TrainingPlanDayRow = {
  id: number
  plan_id: number
  date: string
  workout_type: WorkoutType
  label: string | null
  distance_km: number | string | null
  description: string | null
  phase: string | null
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function parseHMS(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':').map(p => p.trim())
  if (!parts.length || parts.some(p => p === '' || isNaN(Number(p)))) return null
  const nums = parts.map(Number)
  let seconds: number
  if (nums.length === 3) seconds = nums[0] * 3600 + nums[1] * 60 + nums[2]
  else if (nums.length === 2) seconds = nums[0] * 60 + nums[1]
  else if (nums.length === 1) seconds = nums[0]
  else return null
  return seconds >= 0 ? Math.round(seconds) : null
}

function formatHMS(seconds: number | null | undefined): string {
  if (seconds == null) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Builder state shapes ────────────────────────────────────────────────────

type BuilderDay = {
  workout_type: WorkoutType
  distance_km: string
  description: string
}

type BuilderWeek = {
  phase: string
  days: BuilderDay[] // always length 7
}

function emptyDay(): BuilderDay {
  return { workout_type: 'rest', distance_km: '', description: '' }
}

function emptyWeek(): BuilderWeek {
  return { phase: '', days: Array.from({ length: 7 }, emptyDay) }
}

function resizeWeeks(current: BuilderWeek[], count: number): BuilderWeek[] {
  if (count === current.length) return current
  if (count < current.length) return current.slice(0, count)
  return [...current, ...Array.from({ length: count - current.length }, emptyWeek)]
}

const DEFAULT_WEEKS = 8
const MIN_WEEKS = 1
const MAX_WEEKS = 52

const GOAL_TYPE_LABEL: Record<string, string> = {
  general: 'No specific goal',
  race: 'Race',
  distance_target: 'Distance target',
  time_target: 'Time target',
}

// ── Input styling (matches LoginPage/SignupPage form fields) ────────────────

const INPUT_CLS =
  'w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors'
const LABEL_CLS = 'block text-xs text-gray-500 dark:text-gray-400 mb-1.5'
const DAY_INPUT_CLS =
  'bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors'

// ── Component ─────────────────────────────────────────────────────────────────

export function TrainingPlanBuilder({
  userId,
  existingPlan,
  onCancel,
  onSaved,
}: {
  userId: string
  existingPlan: { plan: TrainingPlanRow; days: TrainingPlanDayRow[] } | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(existingPlan?.plan.name ?? '')
  const [goalType, setGoalType] = useState(existingPlan?.plan.goal_type ?? 'general')
  const [targetDate, setTargetDate] = useState(existingPlan?.plan.target_date ?? '')
  const [targetDistanceKm, setTargetDistanceKm] = useState(
    existingPlan?.plan.target_distance_km != null ? String(existingPlan.plan.target_distance_km) : ''
  )
  const [targetTime, setTargetTime] = useState(formatHMS(existingPlan?.plan.target_time_seconds))
  const [location, setLocation] = useState(existingPlan?.plan.location ?? '')
  const [startDate, setStartDate] = useState(existingPlan?.plan.start_date ?? format(new Date(), 'yyyy-MM-dd'))

  const [weeksCountInput, setWeeksCountInput] = useState(String(deriveWeekCount(existingPlan)))
  const [weeks, setWeeks] = useState<BuilderWeek[]>(deriveWeeks(existingPlan))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateWeeksCount(raw: string) {
    setWeeksCountInput(raw)
    // Don't resize on an empty/invalid intermediate value -- selecting the
    // field's text to retype it fires a change event with raw='', and
    // Number('') is 0 (falsy), which previously fell through to MIN_WEEKS
    // and immediately truncated the grid to 1 week, destroying every other
    // week's entered data before the user finished typing the real number.
    if (raw.trim() === '') return
    const num = Number(raw)
    if (!Number.isFinite(num)) return
    const parsed = Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.round(num)))
    setWeeks(w => resizeWeeks(w, parsed))
  }

  function updateDay(weekIdx: number, dayIdx: number, patch: Partial<BuilderDay>) {
    setWeeks(ws =>
      ws.map((w, wi) =>
        wi !== weekIdx
          ? w
          : { ...w, days: w.days.map((d, di) => (di === dayIdx ? { ...d, ...patch } : d)) }
      )
    )
  }

  function updateWeekPhase(weekIdx: number, phase: string) {
    setWeeks(ws => ws.map((w, wi) => (wi === weekIdx ? { ...w, phase } : w)))
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required.'); return }
    if (!startDate) { setError('Start date is required.'); return }

    let targetDistance: number | null = null
    if (targetDistanceKm.trim()) {
      targetDistance = Number(targetDistanceKm)
      if (isNaN(targetDistance)) { setError('Target distance must be a number.'); return }
    }

    let targetSeconds: number | null = null
    if (targetTime.trim()) {
      targetSeconds = parseHMS(targetTime)
      if (targetSeconds == null) { setError('Target time must look like 25:00 or 1:45:00.'); return }
    }

    // Same validation the target-distance field above already gets --
    // previously an unparseable per-day value (stray whitespace, a
    // locale-formatted "5,5") silently saved as 0km with no warning instead
    // of surfacing an error like every other numeric field in this form.
    for (const week of weeks) {
      for (const day of week.days) {
        if (day.workout_type !== 'rest' && day.distance_km.trim() && isNaN(Number(day.distance_km))) {
          setError(`"${day.distance_km}" isn't a valid distance. Use a plain number, e.g. 5 or 5.5.`)
          return
        }
      }
    }

    setSaving(true)
    try {
      const planPayload = {
        user_id: userId,
        name: name.trim(),
        goal_type: goalType,
        target_date: targetDate || null,
        target_distance_km: targetDistance,
        target_time_seconds: targetSeconds,
        location: location.trim() || null,
        start_date: startDate,
        is_active: true,
      }

      let planId: number
      if (existingPlan) {
        planId = existingPlan.plan.id
        const { error: updErr } = await supabase
          .from('training_plans')
          .update(planPayload)
          .eq('id', planId)
          .eq('user_id', userId)
        if (updErr) throw updErr
      } else {
        // Insert first, deactivate other plans second. Doing it the other
        // way around (deactivate-then-insert) meant a failure between the
        // two steps -- or a network blip after the deactivate landed --
        // left the user with zero active plans and no way back short of
        // reaching into the DB by hand. Inserting first means the same
        // failure instead leaves at most two active plans, which the "most
        // recent by start_date" fetch already tolerates without crashing.
        const { data: inserted, error: insErr } = await supabase
          .from('training_plans')
          .insert(planPayload)
          .select('id')
          .single()
        if (insErr) throw insErr
        planId = inserted.id

        const { error: deactErr } = await supabase
          .from('training_plans')
          .update({ is_active: false })
          .eq('user_id', userId)
          .eq('is_active', true)
          .neq('id', planId)
        if (deactErr) throw deactErr
      }

      const dayRows = weeks.flatMap((week, wIdx) =>
        week.days.map((day, dIdx) => ({
          plan_id: planId,
          date: format(addDays(parseISO(startDate), wIdx * 7 + dIdx), 'yyyy-MM-dd'),
          workout_type: day.workout_type,
          label: DEFAULT_LABEL[day.workout_type],
          distance_km: day.workout_type === 'rest' ? 0 : Number(day.distance_km) || 0,
          description: day.workout_type === 'rest' ? null : (day.description.trim() || null),
          phase: week.phase.trim() || null,
        }))
      )

      // Upsert the new grid, THEN delete whatever's left over from the old
      // one -- not delete-then-insert. Delete-then-insert meant a failure
      // between the two steps (a transient error, a network blip) wiped
      // every previously-saved day with nothing to roll it back; upserting
      // first means the same failure instead leaves a few stale extra rows
      // past the new range, which is harmless and gets cleaned up on the
      // next successful save.
      if (dayRows.length) {
        const { error: upsertErr } = await supabase
          .from('training_plan_days')
          .upsert(dayRows, { onConflict: 'plan_id,date' })
        if (upsertErr) throw upsertErr
      }
      const keepDates = dayRows.map(d => d.date)
      const { error: delErr } = keepDates.length
        ? await supabase
            .from('training_plan_days')
            .delete()
            .eq('plan_id', planId)
            .not('date', 'in', `(${keepDates.join(',')})`)
        : await supabase.from('training_plan_days').delete().eq('plan_id', planId)
      if (delErr) throw delErr

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <Card>
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-widest mb-3">
          {existingPlan ? 'Edit Training Plan' : 'New Training Plan'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={LABEL_CLS}>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Spring 10km Build"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Goal</label>
            <select value={goalType ?? 'general'} onChange={e => setGoalType(e.target.value)} className={INPUT_CLS}>
              {Object.entries(GOAL_TYPE_LABEL).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL_CLS}>Location (optional)</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Kings Park Stadium, Durban"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Target date (optional)</label>
            <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className={INPUT_CLS} />
          </div>

          <div>
            <label className={LABEL_CLS}>Target distance, km (optional)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={targetDistanceKm}
              onChange={e => setTargetDistanceKm(e.target.value)}
              placeholder="e.g. 10"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Target time (optional)</label>
            <input
              type="text"
              value={targetTime}
              onChange={e => setTargetTime(e.target.value)}
              placeholder="e.g. 55:00 or 1:45:00"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={INPUT_CLS} />
          </div>

          <div>
            <label className={LABEL_CLS}>Plan duration, weeks</label>
            <input
              type="number"
              min={MIN_WEEKS}
              max={MAX_WEEKS}
              value={weeksCountInput}
              onChange={e => updateWeeksCount(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save plan'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </Card>

      <datalist id="phase-suggestions">
        {PHASE_SUGGESTIONS.map(p => <option key={p} value={p} />)}
      </datalist>

      <div className="space-y-1.5">
        {weeks.map((week, wIdx) => {
          const weekStart = format(addDays(parseISO(startDate || format(new Date(), 'yyyy-MM-dd')), wIdx * 7), 'MMM d')
          const weekEnd = format(addDays(parseISO(startDate || format(new Date(), 'yyyy-MM-dd')), wIdx * 7 + 6), 'MMM d')

          return (
            <Card key={wIdx}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-gray-400 shrink-0">W{wIdx + 1}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">{weekStart}–{weekEnd}</span>
                </div>
                <input
                  type="text"
                  list="phase-suggestions"
                  value={week.phase}
                  onChange={e => updateWeekPhase(wIdx, e.target.value)}
                  placeholder="Phase (optional)"
                  className={`${DAY_INPUT_CLS} w-32 shrink-0 ${phaseStyle(week.phase)}`}
                />
              </div>

              <div className="space-y-1">
                {week.days.map((day, dIdx) => {
                  const dayLabel = format(addDays(parseISO(startDate || format(new Date(), 'yyyy-MM-dd')), wIdx * 7 + dIdx), 'EEE')
                  return (
                    <div
                      key={dIdx}
                      className="flex flex-wrap items-center gap-2 py-1 border-b border-gray-100 dark:border-gray-800/60 last:border-0"
                    >
                      <span className="w-8 text-[10px] text-gray-500 shrink-0">{dayLabel}</span>
                      <select
                        value={day.workout_type}
                        onChange={e => updateDay(wIdx, dIdx, { workout_type: e.target.value as WorkoutType })}
                        className={`${DAY_INPUT_CLS} ${WORKOUT_STYLES[day.workout_type].text}`}
                      >
                        {WORKOUT_TYPE_OPTIONS.map(t => (
                          <option key={t} value={t}>{DEFAULT_LABEL[t]}</option>
                        ))}
                      </select>
                      {day.workout_type !== 'rest' && (
                        <>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={day.distance_km}
                            onChange={e => updateDay(wIdx, dIdx, { distance_km: e.target.value })}
                            placeholder="km"
                            className={`${DAY_INPUT_CLS} w-16`}
                          />
                          <input
                            type="text"
                            value={day.description}
                            onChange={e => updateDay(wIdx, dIdx, { description: e.target.value })}
                            placeholder="Description (optional)"
                            className={`${DAY_INPUT_CLS} flex-1 min-w-[140px]`}
                          />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

// ── Reconstruct builder state from an existing plan (edit mode) ─────────────

function deriveWeekCount(existingPlan: { plan: TrainingPlanRow; days: TrainingPlanDayRow[] } | null): number {
  if (!existingPlan) return DEFAULT_WEEKS
  const { plan, days } = existingPlan
  if (!days.length) return DEFAULT_WEEKS
  const start = parseISO(plan.start_date)
  const lastDate = days.reduce((max, d) => (d.date > max ? d.date : max), days[0].date)
  const endDateStr = plan.target_date && plan.target_date > lastDate ? plan.target_date : lastDate
  const totalDays = Math.max(1, differenceInCalendarDays(parseISO(endDateStr), start) + 1)
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.ceil(totalDays / 7)))
}

function deriveWeeks(existingPlan: { plan: TrainingPlanRow; days: TrainingPlanDayRow[] } | null): BuilderWeek[] {
  const count = deriveWeekCount(existingPlan)
  const weeks = Array.from({ length: count }, emptyWeek)
  if (!existingPlan) return weeks

  const { plan, days } = existingPlan
  const start = parseISO(plan.start_date)
  days.forEach(d => {
    const offset = differenceInCalendarDays(parseISO(d.date), start)
    const wIdx = Math.floor(offset / 7)
    const dIdx = offset % 7
    if (wIdx < 0 || wIdx >= weeks.length || dIdx < 0 || dIdx > 6) return
    weeks[wIdx].days[dIdx] = {
      workout_type: d.workout_type,
      distance_km: d.workout_type === 'rest' ? '' : String(d.distance_km ?? ''),
      description: d.description ?? '',
    }
    if (d.phase && !weeks[wIdx].phase) weeks[wIdx].phase = d.phase
  })
  return weeks
}
