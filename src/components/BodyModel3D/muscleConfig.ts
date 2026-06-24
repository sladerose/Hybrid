import * as THREE from 'three'

// ── Muscle group keys ─────────────────────────────────────────────────────────

export type MuscleGroupKey =
  | 'Chest' | 'Lats' | 'Shoulders' | 'Traps' | 'Triceps'
  | 'Biceps' | 'Core' | 'Quadriceps' | 'Hamstrings'
  | 'Glutes' | 'Calves'

// ── DB value → visual key ─────────────────────────────────────────────────────

export const DB_TO_MUSCLE: Record<string, MuscleGroupKey> = {
  Chest:       'Chest',
  Lats:        'Lats',
  Back:        'Lats',
  Shoulders:   'Shoulders',
  Traps:       'Traps',
  Triceps:     'Triceps',
  Biceps:      'Biceps',
  Core:        'Core',
  Abs:         'Core',
  Quadriceps:  'Quadriceps',
  Legs:        'Quadriceps',
  Hamstrings:  'Hamstrings',
  Glutes:      'Glutes',
  Calves:      'Calves',
}

export const MUSCLE_LABELS: Record<MuscleGroupKey, string> = {
  Chest:       'Chest',
  Lats:        'Back & Lats',
  Shoulders:   'Shoulders',
  Traps:       'Trapezius',
  Triceps:     'Triceps',
  Biceps:      'Biceps',
  Core:        'Core & Abs',
  Quadriceps:  'Quadriceps',
  Hamstrings:  'Hamstrings',
  Glutes:      'Glutes',
  Calves:      'Calves',
}

// ── Training data per muscle ──────────────────────────────────────────────────

export interface MuscleStats {
  group: MuscleGroupKey
  sessions28: number
  totalVolume: number    // kg, last 28 days
  daysSince: number | null
  lastDate: string | null
  exercises: string[]
}

export type MuscleStatsMap = Map<MuscleGroupKey, MuscleStats>

// ── Color logic ───────────────────────────────────────────────────────────────

export function heatColor(sessions28: number): string {
  if (sessions28 === 0) return '#2d4a6b'  // visible steel blue — untrained but distinct
  if (sessions28 <= 1)  return '#1d4ed8'
  if (sessions28 <= 2)  return '#2563eb'
  if (sessions28 <= 4)  return '#10b981'
  if (sessions28 <= 6)  return '#f97316'
  return '#ef4444'
}

export function heatEmissive(sessions28: number): string {
  if (sessions28 === 0) return '#162438'  // subtle hover glow for untrained too
  if (sessions28 <= 2)  return '#1e3a8a'
  if (sessions28 <= 4)  return '#065f46'
  if (sessions28 <= 6)  return '#7c2d12'
  return '#450a0a'
}

export function statusBadge(sessions28: number, daysSince: number | null): { label: string; color: string } {
  if (sessions28 === 0) return { label: 'Untrained', color: '#6b8aaa' }
  if (daysSince === 0)  return { label: 'Trained today', color: '#10b981' }
  if (daysSince === 1)  return { label: 'Yesterday', color: '#10b981' }
  if (sessions28 >= 7)  return { label: 'High load', color: '#ef4444' }
  if (sessions28 >= 5)  return { label: 'Active', color: '#f97316' }
  if (sessions28 >= 3)  return { label: 'Optimal', color: '#10b981' }
  return { label: 'Light', color: '#2563eb' }
}

// ── Reusable Three.js temps (avoid per-frame allocation) ──────────────────────

export const TMP_COLOR = new THREE.Color()

// ── Body part geometry definitions ───────────────────────────────────────────

export type GeometryKind = 'box' | 'capsule' | 'sphere' | 'cylinder'

export interface BodyPartDef {
  id: string
  muscleGroup: MuscleGroupKey | null  // null = non-interactive (head, neck, etc.)
  position: [number, number, number]
  rotation?: [number, number, number]
  geometry: GeometryKind
  // args match Three.js constructor: BoxGeometry(w,h,d), CapsuleGeometry(r,l,cap,rad), etc.
  args: number[]
}

// Flat list for insight header counts
export const ALL_MUSCLE_KEYS: MuscleGroupKey[] = [
  'Chest', 'Lats', 'Shoulders', 'Traps',
  'Biceps', 'Triceps', 'Core',
  'Quadriceps', 'Hamstrings', 'Glutes', 'Calves',
]

// PPL-grouped for the chip panel — matches Slade's Push / Pull / Legs structure
export const MUSCLE_GROUPS: Array<{ label: string; color: string; muscles: MuscleGroupKey[] }> = [
  { label: 'Push',  color: '#f97316', muscles: ['Chest', 'Shoulders', 'Triceps'] },
  { label: 'Pull',  color: '#3b82f6', muscles: ['Lats', 'Traps', 'Biceps'] },
  { label: 'Core',  color: '#10b981', muscles: ['Core'] },
  { label: 'Legs',  color: '#8b5cf6', muscles: ['Quadriceps', 'Hamstrings', 'Glutes', 'Calves'] },
]

// Body spans y ≈ -1.38 (feet) to y ≈ 1.86 (head top). Centred at origin.
// Y-up, Z-forward (front of body = positive Z).
export const BODY_PARTS: BodyPartDef[] = [
  // ── Head & Neck (neutral) ──────────────────────────────────────────────────
  { id: 'head', muscleGroup: null, position: [0, 1.58, 0], geometry: 'sphere', args: [0.28, 16, 16] },
  { id: 'neck', muscleGroup: null, position: [0, 1.28, 0], geometry: 'capsule', args: [0.09, 0.06, 4, 8] },

  // ── Torso front ───────────────────────────────────────────────────────────
  { id: 'chest', muscleGroup: 'Chest', position: [0, 0.87, 0.10], geometry: 'box', args: [0.68, 0.42, 0.20] },
  { id: 'core',  muscleGroup: 'Core',  position: [0, 0.42, 0.10], geometry: 'box', args: [0.56, 0.34, 0.18] },

  // ── Torso rear ────────────────────────────────────────────────────────────
  { id: 'back',  muscleGroup: 'Lats',  position: [0, 0.80, -0.12], geometry: 'box',  args: [0.74, 0.48, 0.18] },
  { id: 'traps', muscleGroup: 'Traps', position: [0, 1.16, -0.08], geometry: 'box',  args: [0.42, 0.20, 0.12] },

  // ── Pelvis / hip (neutral) ────────────────────────────────────────────────
  { id: 'hip',   muscleGroup: null, position: [0, 0.10, 0], geometry: 'box', args: [0.52, 0.22, 0.24] },

  // ── Shoulders ─────────────────────────────────────────────────────────────
  { id: 'shl-l', muscleGroup: 'Shoulders', position: [-0.51, 1.08, 0], geometry: 'sphere', args: [0.16, 12, 12] },
  { id: 'shl-r', muscleGroup: 'Shoulders', position: [ 0.51, 1.08, 0], geometry: 'sphere', args: [0.16, 12, 12] },

  // ── Arms – biceps (anterior / front) ─────────────────────────────────────
  { id: 'bic-l', muscleGroup: 'Biceps', position: [-0.65, 0.68,  0.07], geometry: 'capsule', args: [0.09, 0.30, 4, 8] },
  { id: 'bic-r', muscleGroup: 'Biceps', position: [ 0.65, 0.68,  0.07], geometry: 'capsule', args: [0.09, 0.30, 4, 8] },

  // ── Arms – triceps (posterior / back) ────────────────────────────────────
  { id: 'tri-l', muscleGroup: 'Triceps', position: [-0.65, 0.68, -0.07], geometry: 'capsule', args: [0.09, 0.30, 4, 8] },
  { id: 'tri-r', muscleGroup: 'Triceps', position: [ 0.65, 0.68, -0.07], geometry: 'capsule', args: [0.09, 0.30, 4, 8] },

  // ── Forearms & hands (neutral) ────────────────────────────────────────────
  { id: 'far-l', muscleGroup: null, position: [-0.67, 0.22, 0], geometry: 'capsule', args: [0.075, 0.26, 4, 8] },
  { id: 'far-r', muscleGroup: null, position: [ 0.67, 0.22, 0], geometry: 'capsule', args: [0.075, 0.26, 4, 8] },
  { id: 'hnd-l', muscleGroup: null, position: [-0.68, -0.07, 0], geometry: 'sphere', args: [0.08, 8, 8] },
  { id: 'hnd-r', muscleGroup: null, position: [ 0.68, -0.07, 0], geometry: 'sphere', args: [0.08, 8, 8] },

  // ── Glutes (posterior hip – visible from back) ────────────────────────────
  { id: 'glt-l', muscleGroup: 'Glutes', position: [-0.20, -0.04, -0.12], geometry: 'sphere', args: [0.18, 10, 10] },
  { id: 'glt-r', muscleGroup: 'Glutes', position: [ 0.20, -0.04, -0.12], geometry: 'sphere', args: [0.18, 10, 10] },

  // ── Legs – quads (anterior thigh) ─────────────────────────────────────────
  { id: 'qd-l', muscleGroup: 'Quadriceps', position: [-0.20, -0.30,  0.08], geometry: 'capsule', args: [0.14, 0.46, 4, 8] },
  { id: 'qd-r', muscleGroup: 'Quadriceps', position: [ 0.20, -0.30,  0.08], geometry: 'capsule', args: [0.14, 0.46, 4, 8] },

  // ── Legs – hamstrings (posterior thigh) ───────────────────────────────────
  { id: 'hm-l', muscleGroup: 'Hamstrings', position: [-0.20, -0.30, -0.09], geometry: 'capsule', args: [0.13, 0.44, 4, 8] },
  { id: 'hm-r', muscleGroup: 'Hamstrings', position: [ 0.20, -0.30, -0.09], geometry: 'capsule', args: [0.13, 0.44, 4, 8] },

  // ── Calves ────────────────────────────────────────────────────────────────
  { id: 'clf-l', muscleGroup: 'Calves', position: [-0.20, -0.92, -0.02], geometry: 'capsule', args: [0.10, 0.36, 4, 8] },
  { id: 'clf-r', muscleGroup: 'Calves', position: [ 0.20, -0.92, -0.02], geometry: 'capsule', args: [0.10, 0.36, 4, 8] },

  // ── Shins (neutral) ───────────────────────────────────────────────────────
  { id: 'shn-l', muscleGroup: null, position: [-0.20, -0.92, 0.07], geometry: 'capsule', args: [0.08, 0.34, 4, 8] },
  { id: 'shn-r', muscleGroup: null, position: [ 0.20, -0.92, 0.07], geometry: 'capsule', args: [0.08, 0.34, 4, 8] },

  // ── Feet (neutral) ────────────────────────────────────────────────────────
  { id: 'ft-l', muscleGroup: null, position: [-0.20, -1.30, 0.04], geometry: 'box', args: [0.14, 0.10, 0.22] },
  { id: 'ft-r', muscleGroup: null, position: [ 0.20, -1.30, 0.04], geometry: 'box', args: [0.14, 0.10, 0.22] },
]
