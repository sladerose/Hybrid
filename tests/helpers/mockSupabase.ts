// Reusable Supabase query-builder mock for the api/ handler tests.
//
// The handlers under test call chainable methods like
//   admin.from('table').select(...).eq(...).order(...).limit(...).maybeSingle()
//   admin.from('table').insert(...).select('id').single()
//   admin.from('table').upsert(...)                      // awaited directly
//   admin.from('table').delete().eq(...).eq(...)         // awaited directly
// The real @supabase/supabase-js query builder is "thenable" — every
// intermediate call returns `this`, and awaiting the builder at any point
// (not just after `.single()`/`.maybeSingle()`) resolves to `{ data, error }`
// (or `{ data, error, count }`). This mock reproduces just that shape:
// every chain method is a `vi.fn()` returning the same builder, and the
// builder itself is a thenable that resolves to a configured result.
//
// Conceptually similar to how mcps/garmin/tests/conftest.py mocks its
// Supabase chain (mock the chain, configure the terminal resolution) but
// written idiomatically for vi.fn()/vitest rather than ported from Python.
import { vi } from 'vitest'

export interface QueryResult<T = unknown> {
  data: T | null
  error: { message: string; [key: string]: unknown } | null
  count?: number | null
}

export const CHAIN_METHODS = [
  'select',
  'insert',
  'update',
  'upsert',
  'delete',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'ilike',
  'is',
  'in',
  'or',
  'filter',
  'match',
  'order',
  'limit',
  'range',
] as const

export type MockQueryBuilder = {
  [K in (typeof CHAIN_METHODS)[number]]: ReturnType<typeof vi.fn>
} & {
  single: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: (
    onFulfilled?: ((value: QueryResult) => unknown) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ) => Promise<unknown>
  catch: (onRejected?: ((reason: unknown) => unknown) | null) => Promise<unknown>
}

const DEFAULT_RESULT: QueryResult = { data: null, error: null }

/** Builds one mock query-builder chain that resolves to `result`. */
export function createQueryBuilder(result: QueryResult = DEFAULT_RESULT): MockQueryBuilder {
  const builder = {} as MockQueryBuilder
  for (const method of CHAIN_METHODS) {
    ;(builder as Record<string, unknown>)[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  builder.catch = (onRejected) => Promise.resolve(result).catch(onRejected)
  return builder
}

export interface MockSupabaseAdmin {
  from: ReturnType<typeof vi.fn>
}

/**
 * Builds a mock `SupabaseClient`-shaped object whose `.from(table)` calls
 * return, in order, one query builder per entry in `results` — matching the
 * deterministic call order of `.from(...)` inside the handler under test.
 * Each returned builder is captured in `builders` (same order) so a test can
 * assert on what was called against it, e.g.
 *   expect(builders[1].insert).toHaveBeenCalledWith({...})
 * A `.from()` call beyond the configured `results` gets a default empty
 * builder rather than throwing, so an unexpected extra call fails loudly at
 * the assertion instead of crashing the mock itself.
 */
export function createSupabaseAdminMock(results: QueryResult[] = []): {
  admin: MockSupabaseAdmin
  builders: MockQueryBuilder[]
} {
  const builders: MockQueryBuilder[] = []
  let call = 0
  const from = vi.fn((_table: string) => {
    const result = results[call] ?? DEFAULT_RESULT
    call += 1
    const builder = createQueryBuilder(result)
    builders.push(builder)
    return builder
  })
  return { admin: { from }, builders }
}
