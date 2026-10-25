/* ============================================================
   The Theatre — PORCELAIN diorama root. A gallery-white void,
   one floating plinth, real soft light, contact shadows instead
   of bloom. Ticks the RaceClock at frame priority -100 so every
   other system reads a settled t.

   The light rig is three parts: a hemisphere sky/ground bounce,
   one cool key from the upper left that actually casts shadows
   (its ortho shadow camera is framed to the circuit's real
   radius), and a faint fill from the opposite side so porcelain
   faces never go flat-ink. A tiny PMREM'd RoomEnvironment gives
   lacquer sheen to cars and wet asphalt without fetching a
   network HDR.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { PostFX } from './PostFX'
import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import { resolveTrackModel } from '../data/circuitCache'
import { sceneRefs } from './sceneRefs'
import type { TrackModel } from './trackBuilder'
import { TrackRibbon } from './TrackRibbon'
import { Cars } from './Cars'
import { Plinth } from './Plinth'
import { CameraRig } from './CameraRig'
import { LiveOps } from './LiveOps'
import { BattleBridges } from './BattleBridges'
import { TrackFurniture } from './TrackFurniture'
import { TracksideDressing } from './TracksideDressing'
import { AnatomyCar } from './AnatomyCar'

function ClockTicker() {
  useFrame((_, dt) => {
    const { directed, moments } = useAppStore.getState()
    if (directed && moments && raceClock.playing) {
      // temporal lensing: cruise laps compress, key moments breathe.
      // drama 0 → 24×, drama 1 → 0.9× (near real time at the apex)
      const drama = moments.dramaAt(raceClock.t)
      const target = 0.9 + 23.1 * Math.pow(1 - drama, 2.4)
      raceClock.rate += (target - raceClock.rate) * Math.min(1, dt * 2.5)
    }
    raceClock.tick(Math.min(dt, 0.1))
  }, -100)
  return null
}

/** soft gallery PMREM — one-time generation, gives spec response to
    car bodies and the wet asphalt without any network asset */
function GalleryEnv() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const rt = pmrem.fromScene(new RoomEnvironment(), 0.04)
    scene.environment = rt.texture
    scene.environmentIntensity = 0.22
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/** the casting key light, framed to the circuit's real bounds */
function KeyLight({ model }: { model: TrackModel }) {
  const ref = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  const r = Math.max(50, model.radius)
  const shedRef = useRef(-1)
  useFrame(() => {
    // post shed-ladder rung 3 trades shadow texels for frames; rung 0
    // restores the calibrated 4096 map. Disposing the map forces
    // re-allocation at the new size on the next shadow pass.
    const light = ref.current
    if (!light || sceneRefs.quality.shed === shedRef.current) return
    shedRef.current = sceneRefs.quality.shed
    const size = shedRef.current >= 3 ? 2048 : 4096
    if (light.shadow.mapSize.x !== size) {
      light.shadow.map?.dispose()
      light.shadow.map = null
      light.shadow.mapSize.set(size, size)
    }
  })
  useEffect(() => {
    const light = ref.current
    if (!light) return
    const target = new THREE.Object3D()
    target.position.set(model.center[0], model.center[1], model.center[2])
    scene.add(target)
    light.target = target
    return () => {
      scene.remove(target)
      light.target = new THREE.Object3D()
    }
  }, [model, scene])
  // normalBias is in world units: 0.5 made every shadow skate off its
  // caster (the "floating diorama" look). A hair above the ribbon's 5 cm
  // step kills acne without breaking contact. 4096 map: 2048 across a
  // 6 km ortho box left car shadows dithered at close zoom.
  return (
    <directionalLight
      ref={ref}
      position={[model.center[0] - r * 0.85, r * 1.75, model.center[2] + r * 0.5]}
      intensity={1.9}
      color="#f4f7fc"
      castShadow
      shadow-mapSize={[4096, 4096]}
      shadow-camera-left={-r * 1.6}
      shadow-camera-right={r * 1.6}
      shadow-camera-top={r * 1.6}
      shadow-camera-bottom={-r * 1.6}
      shadow-camera-near={r * 0.4}
      shadow-camera-far={r * 5.5}
      shadow-normalBias={0.06}
      shadow-bias={-0.00035}
    />
  )
}

/** Raking workshop inspection light rig for cutaway anatomy mode */
function WorkshopRig({ model }: { model: TrackModel }) {
  const workshopLight = useAppStore((s) => s.workshopLight)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const lightRef = useRef<THREE.DirectionalLight>(null)
  const targetRef = useRef<THREE.Object3D>(new THREE.Object3D())
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const t = targetRef.current
    scene.add(t)
    return () => {
      scene.remove(t)
    }
  }, [scene])

  useFrame(() => {
    if (!lightRef.current || cameraMode !== 'anatomy' || !workshopLight) return
    const sample = sceneRefs.anatomySample
    if (sample && sample.valid) {
      const cx = sample.x
      const cy = sample.z - model.elevationBase
      const cz = -sample.y
      targetRef.current.position.set(cx, cy, cz)
      const h = sample.heading + Math.PI * 0.45
      lightRef.current.position.set(
        cx + Math.cos(h) * 5.2,
        cy + 1.8,
        cz + Math.sin(h) * 5.2,
      )
      lightRef.current.target = targetRef.current
    }
  })

  if (cameraMode !== 'anatomy' || !workshopLight) return null

  return (
    <directionalLight
      ref={lightRef}
      intensity={2.8}
      color="#fffbf2"
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0004}
      shadow-normalBias={0.03}
      shadow-camera-near={0.5}
      shadow-camera-far={25}
      shadow-camera-left={-4}
      shadow-camera-right={4}
      shadow-camera-top={4}
      shadow-camera-bottom={-4}
    />
  )
}

export function Theatre() {
  const session = useAppStore((s) => s.session)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const setFocusDriver = useAppStore((s) => s.setFocusDriver)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const workshopLight = useAppStore((s) => s.workshopLight)

  // DPR is a coarse, PerformanceMonitor-governed step (not a continuous
  // dial): every step reallocates the post buffers, so it must move rarely
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio || 1, 2))

  // geometry resolves through the circuit cache (static snapshot first,
  // fresh extrusion as fallback); async but memoized per circuit
  const [model, setModel] = useState<TrackModel | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  useEffect(() => {
    if (!session) return
    let alive = true
    setModel(null)
    setBuildError(null)
    resolveTrackModel(session).then(
      (m) => {
        if (alive) {
          setModel(m)
          sceneRefs.trackModel = m
        }
      },
      (err) => {
        if (alive) setBuildError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      alive = false
    }
  }, [session])

  if (!session) return null
  if (buildError) {
    return (
      <div className="buildError">
        <p className="label" style={{ color: 'var(--t-red)' }}>CANNOT RENDER CIRCUIT</p>
        <p className="buildError__msg mono">{buildError}</p>
        <p className="buildError__hint">
          This session lacks a clean lap with complete positional telemetry — usually true of
          heavily disrupted or very short sessions. Try a race or qualifying session.
        </p>
        <button className="loading__cancel label" onClick={() => useAppStore.getState().exitToBrowser()}>
          ← BACK TO ARCHIVE
        </button>
      </div>
    )
  }
  if (!model) return null

  return (
    <Canvas
      orthographic
      shadows="soft"
      gl={{
        // AA moved into the composer: 4× MSAA on its buffers + SMAA.
        // The canvas framebuffer never reaches the screen directly
        antialias: false,
        alpha: true, // no framebuffer background: the CSS studio sweep shows through
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping, // owned by PostFX's Neutral pass
      }}
      dpr={dpr}
      camera={{ zoom: 1, near: -50000, far: 50000 }}
      onPointerMissed={() => setFocusDriver(null)}
    >
      <PerformanceMonitor
        onIncline={() => setDpr(Math.min(window.devicePixelRatio || 1, 2))}
        onDecline={() => setDpr(1)}
        flipflops={2}
        onFallback={() => setDpr(1.25)}
      />
      <ClockTicker />
      <GalleryEnv />
      <PostFX />
      <LiveOps />

      {/* gallery light, three tones: a low sky/ground bounce that only
          keeps ink faces alive (0.34 — it used to wash the whole key
          away at 0.58), one strong casting key from the upper left that
          now actually reads as a direction, and a cool side fill at the
          rim. The plinth lands ~205, shadowed faces ~150 — porcelain
          with depth, not a light box */}
      <hemisphereLight args={['#ffffff', '#ccd5e0', cameraMode === 'anatomy' && workshopLight ? 0.12 : 0.34]} />
      <KeyLight model={model} />
      <directionalLight
        position={[model.center[0] + model.radius, model.radius * 0.7, model.center[2] - model.radius * 0.8]}
        intensity={0.2}
        color="#e8eef8"
      />
      <WorkshopRig model={model} />

      <Plinth
        model={model}
        lapCount={raceIndex?.totalLaps ?? 0}
        plaque={`${session.meta.circuit_short_name.toUpperCase().replace(/_/g, ' ')}  ·  ${(model.length / 1000).toFixed(3)} KM  ·  ${model.corners.length} TURNS`}
      />
      <TrackRibbon model={model} />
      <TracksideDressing model={model} />
      <TrackFurniture model={model} />
      <Cars session={session} model={model} />
      <BattleBridges session={session} model={model} />
      {cameraMode === 'anatomy' && <AnatomyCar model={model} session={session} />}
      <CameraRig model={model} session={session} />
    </Canvas>
  )
}
