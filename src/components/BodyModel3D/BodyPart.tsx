import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { BodyPartDef, MuscleGroupKey, MuscleStatsMap } from './muscleConfig'
import { heatColor, heatEmissive, TMP_COLOR } from './muscleConfig'

interface Props {
  def: BodyPartDef
  stats: MuscleStatsMap
  selectedGroup: MuscleGroupKey | null
  onSelect: (group: MuscleGroupKey | null) => void
}

export function BodyPart({ def, stats, selectedGroup, onSelect }: Props) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const isInteractive = def.muscleGroup !== null
  const muscleData    = def.muscleGroup ? stats.get(def.muscleGroup) : undefined
  const sessions28    = muscleData?.sessions28 ?? 0
  const isSelected    = isInteractive && def.muscleGroup === selectedGroup

  const targetHex      = isInteractive ? heatColor(sessions28) : '#1e3a52'
  const targetEmissive = isInteractive ? heatEmissive(sessions28) : '#000000'

  useFrame(() => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as THREE.MeshStandardMaterial

    mat.color.lerp(TMP_COLOR.set(isSelected ? '#93c5fd' : targetHex), 0.12)
    mat.emissive.lerp(
      TMP_COLOR.set((isSelected || (hovered && isInteractive)) ? targetEmissive : '#000000'),
      0.12,
    )
    const wantIntensity = isSelected ? 0.55 : hovered && isInteractive ? 0.35 : 0
    mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, wantIntensity, 0.12)
  })

  function handleClick(e: ThreeEvent<MouseEvent>) {
    if (!isInteractive) return
    e.stopPropagation()
    onSelect(isSelected ? null : def.muscleGroup)
  }

  function handlePointerOver(e: ThreeEvent<PointerEvent>) {
    if (!isInteractive) return
    e.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  function handlePointerOut() {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <mesh
      ref={meshRef}
      position={def.position}
      rotation={def.rotation ? def.rotation as [number, number, number] : undefined}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      {def.geometry === 'box'      && <boxGeometry      args={def.args as [number, number, number]} />}
      {def.geometry === 'capsule'  && <capsuleGeometry  args={def.args as [number, number, number, number]} />}
      {def.geometry === 'sphere'   && <sphereGeometry   args={def.args as [number, number, number]} />}
      {def.geometry === 'cylinder' && <cylinderGeometry args={def.args as [number, number, number, number]} />}
      <meshStandardMaterial
        color={isInteractive ? heatColor(sessions28) : '#1e3a52'}
        emissive="#000000"
        emissiveIntensity={0}
        roughness={isInteractive ? 0.55 : 0.8}
        metalness={0.05}
      />
    </mesh>
  )
}
