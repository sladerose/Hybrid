// Global test setup, applied to every test file via vitest.config.ts's
// `test.setupFiles`. jest-dom's matchers only matter for the jsdom/component
// tests a follow-up pass will add, but this file itself is environment-
// agnostic (importing it under `// @vitest-environment node` in the api/
// tests is harmless — jest-dom just extends `expect`).
import '@testing-library/jest-dom/vitest'

// Node 22+'s built-in `--experimental-webstorage` global `localStorage` /
// `sessionStorage` (stable, on by default — see `node --help`) shadows
// jsdom's own Storage implementation on `window`. Without the companion
// `--localstorage-file` CLI flag, Node's version is a silent no-op: its
// getter returns `undefined` instead of a `Storage` instance (confirmed via
// `Object.getOwnPropertyDescriptor(window, 'localStorage').get.call(window)`
// returning `undefined` with no throw). That breaks every component under
// jsdom that touches `localStorage` (ThemeContext's persisted theme, chart
// theme tests built on it, etc). `--no-experimental-webstorage` fixes it at
// the Node CLI level, but that flag has to be set before the process starts
// (NODE_OPTIONS set here is too late, and vitest's default `threads` pool
// doesn't spawn new Node processes that would re-read it anyway) — so
// instead we redefine `window.localStorage`/`sessionStorage` here with a
// small in-memory Storage-compatible polyfill. Both descriptors are
// `configurable: true`, so this is a safe override, not a hack around a
// lock. Real jsdom Storage semantics beyond get/set/remove/clear/length/key
// aren't needed by anything in this codebase.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

// Guarded for `typeof window` because the api/ handler tests run under the
// `node` environment (no DOM globals at all) via their `@vitest-environment
// node` docblock — this file is shared across both environments.
if (typeof window !== 'undefined') {
  for (const prop of ['localStorage', 'sessionStorage'] as const) {
    const desc = Object.getOwnPropertyDescriptor(window, prop)
    if (!desc || typeof desc.get !== 'function' || desc.get.call(window) == null) {
      Object.defineProperty(window, prop, {
        value: createMemoryStorage(),
        configurable: true,
        writable: true,
      })
    }
  }
}

// jsdom (as of jsdom 30, bundled with vitest's jsdom environment) does not
// implement ResizeObserver. Recharts' <ResponsiveContainer> — used by every
// chart across the dashboard pages — degrades gracefully without it in
// practice (renders a 0x0 container instead of throwing), but that's an
// implementation detail of the recharts version in use, not a guarantee.
// Stubbing the global here is the centrally-shared fix so every page/chart
// test gets it for free, rather than each test file guarding against a
// missing global (or a future recharts upgrade that starts relying on it)
// individually.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}
