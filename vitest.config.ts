import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'

// The api/ handlers import sibling modules with an explicit `.js` extension
// pointing at a `.ts` file on disk (e.g. `./_lib/supabaseAdmin.js`) — required
// by Vercel's Node ESM runtime at deploy time (see CLAUDE.md conventions).
// Vite/vitest's resolver does not rewrite an explicit `.js` specifier to the
// `.ts` file that actually exists, so without this plugin every relative
// `.js` import inside api/ (and every `vi.mock('./_lib/....js')` targeting
// one) fails to resolve under the test runner. This mirrors what Vercel's
// own build step does silently.
function tsJsExtension(): Plugin {
  return {
    name: 'resolve-ts-as-js',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (importer && source.startsWith('.') && source.endsWith('.js')) {
        const candidate = resolvePath(dirname(importer), source.replace(/\.js$/, '.ts'))
        if (existsSync(candidate)) return candidate
      }
      return null
    },
  }
}

// Separate from vite.config.ts on purpose: the app build config pulls in the
// Tailwind and PWA plugins, neither of which the test runner needs, and
// keeping this file standalone avoids coupling test collection to the app's
// build pipeline. `environment: 'jsdom'` is the default for the frontend/
// component tests a follow-up pass will add; the api/ handler tests (plain
// Web Request/Response, no DOM) override per-file with the vitest standard
// `// @vitest-environment node` docblock at the top of the file.
export default defineConfig({
  plugins: [tsJsExtension(), react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['api/**/*.test.ts', 'src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
})
