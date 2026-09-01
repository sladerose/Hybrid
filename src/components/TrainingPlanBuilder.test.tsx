import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  TrainingPlanBuilder,
  type TrainingPlanRow,
  type TrainingPlanDayRow,
} from './TrainingPlanBuilder'

// TrainingPlanBuilder's handleSave calls supabase.from(...).insert/update/
// upsert/delete in sequence. These tests focus on the form-state bugs fixed
// this session (weeks-count truncation, per-day distance validation) and
// basic create/edit rendering -- not the exact upsert/delete call shapes, so
// a lightweight mock that resolves everything successfully is enough; we
// only assert on whether supabase was called at all where that matters.
const supabaseCalls: { table: string; method: string; arg: unknown }[] = []

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {}
      const record = (method: string) => (arg: unknown) => {
        supabaseCalls.push({ table, method, arg })
        return builder
      }
      for (const m of ['insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'not']) {
        builder[m] = vi.fn(record(m))
      }
      builder.select = vi.fn(() => builder)
      builder.single = vi.fn(() => Promise.resolve({ data: { id: 1 }, error: null }))
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve)
      return builder
    },
  },
}))

const USER_ID = 'user-1'

function setup(props?: Partial<Parameters<typeof TrainingPlanBuilder>[0]>) {
  const onCancel = vi.fn()
  const onSaved = vi.fn()
  const utils = render(
    <TrainingPlanBuilder
      userId={USER_ID}
      existingPlan={null}
      onCancel={onCancel}
      onSaved={onSaved}
      {...props}
    />
  )
  return { ...utils, onCancel, onSaved }
}

const EXISTING_PLAN: { plan: TrainingPlanRow; days: TrainingPlanDayRow[] } = {
  plan: {
    id: 42,
    user_id: USER_ID,
    name: 'Spring 10km Build',
    goal_type: 'race',
    target_date: '2026-10-15',
    target_distance_km: 10,
    target_time_seconds: 3300,
    location: 'Kings Park Stadium, Durban',
    start_date: '2026-08-24',
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
  },
  days: [
    { id: 1, plan_id: 42, date: '2026-08-24', workout_type: 'easy', label: 'Easy', distance_km: 5, description: 'Shakeout', phase: 'Base' },
    { id: 2, plan_id: 42, date: '2026-08-25', workout_type: 'rest', label: 'Rest', distance_km: 0, description: null, phase: 'Base' },
  ],
}

describe('TrainingPlanBuilder', () => {
  beforeEach(() => {
    supabaseCalls.length = 0
  })

  it('renders in create mode with an empty form', () => {
    setup()
    expect(screen.getByText('New Training Plan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Spring 10km Build')).toHaveValue('')
    // Default duration is 8 weeks -> 8 week cards rendered.
    expect(screen.getAllByText(/^W\d+$/).length).toBe(8)
  })

  it('renders in edit mode pre-filled from existingPlan', () => {
    setup({ existingPlan: EXISTING_PLAN })
    expect(screen.getByText('Edit Training Plan')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. Spring 10km Build')).toHaveValue('Spring 10km Build')
    expect(screen.getByPlaceholderText('e.g. Kings Park Stadium, Durban')).toHaveValue('Kings Park Stadium, Durban')
    expect(screen.getByPlaceholderText('e.g. 10')).toHaveValue(10)
    // target_time_seconds 3300 -> 55:00
    expect(screen.getByPlaceholderText('e.g. 55:00 or 1:45:00')).toHaveValue('55:00')
  })

  // ── Bug fix lock-in: weeks-count field no longer truncates entered data
  // while the input is momentarily empty (e.g. selecting all + retyping). ──
  it('does not truncate week data when the weeks-count input is cleared mid-edit', async () => {
    const user = userEvent.setup()
    const { container } = setup()
    // No <label htmlFor>/id association exists for this field, and its
    // value ("8") collides with values other fields can take on during the
    // test -- min=1/max=52 is unique to the weeks-count input.
    const weeksInput = container.querySelector('input[min="1"][max="52"]') as HTMLInputElement

    // 8 weeks * 7 days, but only non-rest days show a km input; default days
    // are all 'rest' so no km inputs exist yet -- set week 3 day 1 to 'easy' first.
    expect(screen.queryAllByPlaceholderText('km').length).toBe(0)
    // The very first <select> on the page is the "Goal" field; every select
    // after that is a per-day workout-type select, laid out week-by-week
    // (7 per week).
    const daySelects = screen
      .getAllByRole('combobox')
      .filter((el) => el.tagName === 'SELECT')
      .slice(1) // drop the Goal select
    const week3Day1Select = daySelects[2 * 7 + 0]
    await user.selectOptions(week3Day1Select, 'easy')

    const kmInput = screen.getAllByPlaceholderText('km')[0]
    await user.clear(kmInput)
    await user.type(kmInput, '8')
    expect(kmInput).toHaveValue(8)

    // Now clear the weeks-count field (fires onChange with '').
    expect(weeksInput).toHaveValue(8)
    await user.clear(weeksInput)

    // Week grid must still show all 8 weeks -- and the km value entered above
    // must still be there -- even while the weeks-count field itself is
    // sitting empty mid-edit.
    expect(screen.getAllByText(/^W\d+$/).length).toBe(8)
    expect(screen.getAllByPlaceholderText('km')[0]).toHaveValue(8)

    // Finish typing the real number -- grid resizes correctly afterwards.
    await user.type(weeksInput, '10')
    expect(screen.getAllByText(/^W\d+$/).length).toBe(10)
  })

  // ── Bug fix lock-in: an invalid per-day distance surfaces a validation
  // error instead of silently saving as 0km. ──
  //
  // jsdom's <input type="number"> value-sanitization makes it impossible to
  // type a genuinely non-numeric string into that field via simulated
  // keystrokes -- every non-numeric candidate we tried gets silently
  // stripped to a valid number or emptied, and React additionally re-forces
  // `node.type`/`node.value` to match its controlled state on every commit,
  // so even DOM-level tricks to defeat that sanitization get reverted on the
  // very next re-render. Real users hit this validation branch a different
  // way -- the fix's own code comment cites a comma-decimal locale writing
  // "5,5" into the DOM value (which some browsers accept, but JS's
  // locale-independent Number() still parses as NaN) -- or, exercised here,
  // a pre-existing corrupted value already sitting in the DB row for a plan
  // being edited. `handleSave`'s `isNaN(Number(day.distance_km))` check
  // reads from React state, which `deriveWeeks` seeds directly from
  // `existingPlan.days[].distance_km` on mount, with no DOM/typing step in
  // between -- so an edit-mode day carrying a bad value reproduces the
  // validation branch faithfully without fighting jsdom's number-input
  // semantics.
  it('surfaces a validation error for a non-numeric per-day distance instead of saving', async () => {
    const user = userEvent.setup()
    const corruptedPlan = {
      plan: EXISTING_PLAN.plan,
      days: [
        { ...EXISTING_PLAN.days[0], distance_km: '5,5' as unknown as number },
        EXISTING_PLAN.days[1],
      ],
    }
    const { onSaved } = setup({ existingPlan: corruptedPlan })

    // Note: the <input type="number"> DOM element itself sanitizes "5,5"
    // down to a blank display (a browser/jsdom-level quirk of that input
    // type, unrelated to this bug) -- but React's underlying component
    // *state* for that day still holds the real string "5,5" untouched,
    // which is what handleSave's validation actually reads.
    await user.click(screen.getByRole('button', { name: 'Save plan' }))

    expect(await screen.findByText(/isn't a valid distance/)).toBeInTheDocument()
    expect(screen.getByText(/"5,5"/)).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(supabaseCalls.length).toBe(0)
  })

  it('requires a name before saving', async () => {
    const user = userEvent.setup()
    const { onSaved } = setup()
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByText('Name is required.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(supabaseCalls.length).toBe(0)
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
