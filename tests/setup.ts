// Global test setup, applied to every test file via vitest.config.ts's
// `test.setupFiles`. jest-dom's matchers only matter for the jsdom/component
// tests a follow-up pass will add, but this file itself is environment-
// agnostic (importing it under `// @vitest-environment node` in the api/
// tests is harmless — jest-dom just extends `expect`).
import '@testing-library/jest-dom/vitest'
