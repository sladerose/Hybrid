// Shared RAG (Red/Amber/Green) color utilities for KPI values.
// Chart series colors are channel identifiers — do NOT use these there.

export const RAG = {
  green:   'text-emerald-400',
  amber:   'text-amber-400',
  red:     'text-red-400',
  neutral: 'text-gray-400',
} as const

export const RAG_BG = {
  green:   'bg-emerald-500',
  amber:   'bg-amber-500',
  red:     'bg-red-500',
  neutral: 'bg-gray-600',
} as const

export type RagClass = typeof RAG[keyof typeof RAG]

// Body battery — higher is better. Slade's avg peak is ~65–80 healthy.
export function bodyBatteryColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 65 ? RAG.green : v >= 45 ? RAG.amber : RAG.red
}

// Resting HR — lower is better. His avg 50.7, spike above 56 = fatigue signal.
export function rhrColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v <= 52 ? RAG.green : v <= 56 ? RAG.amber : RAG.red
}

// Sleep hours — more is better.
export function sleepColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 7 ? RAG.green : v >= 6 ? RAG.amber : RAG.red
}

// Deep sleep % — more is better.
export function sleepDeepColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 15 ? RAG.green : v >= 10 ? RAG.amber : RAG.red
}

// REM sleep % — more is better.
export function sleepRemColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 20 ? RAG.green : v >= 15 ? RAG.amber : RAG.red
}

// Stress score — lower is better. His avg ~39.6.
export function stressColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v <= 35 ? RAG.green : v <= 50 ? RAG.amber : RAG.red
}

// Running cadence spm — higher is better. Target 85+.
export function cadenceColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 85 ? RAG.green : v >= 78 ? RAG.amber : RAG.red
}

// 5k time in seconds — lower is better.
export function run5kColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v <= 1500 ? RAG.green : v <= 1800 ? RAG.amber : RAG.red // <25min / <30min
}

// Body fat % — lower is better for male fitness context.
export function bodyFatColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v <= 18 ? RAG.green : v <= 22 ? RAG.amber : RAG.red
}

// Visceral fat score — lower is better. Healthy = below 10.
export function visceralFatColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v < 9 ? RAG.green : v < 12 ? RAG.amber : RAG.red
}

// Metabolic age — lower is better. His chronological ~34.
export function metabolicAgeColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v <= 28 ? RAG.green : v <= 33 ? RAG.amber : RAG.red
}

// Weekly vigorous minutes — WHO target 150.
export function vigorousMinsColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 150 ? RAG.green : v >= 75 ? RAG.amber : RAG.red
}

export function vigorousMinsBg(v: number | null | undefined): string {
  if (v == null) return RAG_BG.neutral
  return v >= 150 ? RAG_BG.green : v >= 75 ? RAG_BG.amber : RAG_BG.red
}

// Session rating 1–5.
export function sessionRatingColor(v: number | null | undefined): RagClass {
  if (v == null) return RAG.neutral
  return v >= 4 ? RAG.green : v >= 3 ? RAG.amber : RAG.red
}
