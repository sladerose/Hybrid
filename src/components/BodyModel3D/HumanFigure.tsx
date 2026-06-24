import { useRef } from 'react'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { BODY_PARTS } from './muscleConfig'
import type { MuscleGroupKey, MuscleStatsMap } from './muscleConfig'
import { BodyPart } from './BodyPart'

interface Props {
  stats: MuscleStatsMap
  selectedGroup: MuscleGroupKey | null
  onSelect: (group: MuscleGroupKey | null) => void
  isDark: boolean
}

export function HumanFigure({ stats, selectedGroup, onSelect, isDark }: Props) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)

  return (
    <>
      {/* Scene background — follows app theme */}
      <color attach="background" args={[isDark ? '#080e18' : '#eef2f8']} />

      {/* Lighting — slightly brighter on light mode for readability */}
      <ambientLight intensity={isDark ? 0.35 : 0.6} />
      <directionalLight
        position={[2, 4, 3]}
        intensity={isDark ? 1.2 : 1.5}
        castShadow={false}
      />
      <directionalLight
        position={[-2, 1, -2]}
        intensity={isDark ? 0.3 : 0.2}
        color={isDark ? '#4488ff' : '#aabbdd'}
      />
      <pointLight position={[0, 3, 0]} intensity={isDark ? 0.4 : 0.3} color="#ffffff" />

      {/* Deselect on background click */}
      <mesh
        position={[0, 0, -2]}
        onClick={() => onSelect(null)}
        visible={false}
      >
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial />
      </mesh>

      {/* Floor shadow disc — grounds the figure */}
      <mesh position={[0, -1.39, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.52, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={isDark ? 0.45 : 0.12} />
      </mesh>

      {/* Body parts */}
      <group position={[0, 0, 0]}>
        {BODY_PARTS.map(def => (
          <BodyPart
            key={def.id}
            def={def}
            stats={stats}
            selectedGroup={selectedGroup}
            onSelect={onSelect}
          />
        ))}
      </group>

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        autoRotate
        autoRotateSpeed={0.6}
        enableZoom={false}
        enablePan={false}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={(Math.PI * 3) / 4}
      />
    </>
  )
}

// Suppress Three.js "Texture has been disposed" noise from OrbitControls
THREE.Object3D.DEFAULT_UP.set(0, 1, 0)
