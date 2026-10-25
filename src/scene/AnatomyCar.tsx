/* ============================================================
   The Anatomy Car component — the live, telemetry-driven
   cutaway. One car (the focused one, else the leader), sitting
   in the SAME orthographic world and light rig as the diorama,
   so entering anatomy mode is a pure camera move, no teleport.

   The iso-figure rule applied: parts are pressable and produce
   real output. A raycast picks a part by its aDark zone, and the
   HUD readout shows what that part is doing RIGHT NOW, derived
   from the same sampleCar value that moves it — never a
   disagreeing second number.

   The merged geometry carries an `aDark` zone attribute (see
   anatomyGeometry.ts). ONE MeshStandardMaterial is patched with
   onBeforeCompile so every zone reads from the same shader the
   diorama uses, then gets its live telemetry emissive:
     · PU zone (0.15)      → amber throttle glow
     · brake zone (0.3)    → red brake-temp glow
     · radiator zone (0.7) → orange heat-soak glow
     · tyre/rubber (1)     → compound tint when hot
   Wheel roll + DRS lift are baked as vertex animation in the
   same shader (uSpin / uDRS / uSteer uniforms).

   Driven per frame by:
     · sampleCar(ch, raceClock.t) — the one sample
     · sceneRefs.anatomySample / .anatomyReadout — published for the HUD
   ============================================================ */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SessionData } from '../data/types'
import { raceClock } from '../engine/RaceClock'
import { makeCarSample, sampleCar } from '../engine/sampler'
import { useAppStore } from '../state/appStore'
import { sceneRefs } from './sceneRefs'
import type { TrackModel } from './trackBuilder'
import { getAnatomyCarGeometry, ANATOMY_ZONES } from './anatomyGeometry'
import {
  brakeReadout,
  drsReadout,
  puReadout,
  tyreReadout,
  type PartKey,
} from './anatomyModel'
import { playPartClick } from '../ui/workshopAudio'

const WHEEL_R = 0.36 // geometry WHEEL.frontDiameter / 2 (scene units)

export function AnatomyCar({ model, session }: { model: TrackModel; session: SessionData }) {
  const group = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const sample = useMemo(() => makeCarSample(), [])

  // wheel spin accumulator (rad), front steer, DRS flap angle
  const spin = useRef(0)
  const steerSm = useRef(0)
  const prevHeading = useRef(Number.NaN)
  const drsAng = useRef(0)
  const heat = useRef(0)
  const lastT = useRef(-1e9)

  // which zone the pointer is on → the HUD shows that part's live readout
  const activePart = useRef<PartKey | null>(null)

  // live uniforms the shader reads — one object, mutated per frame
  const uniforms = useMemo(
    () => ({
      uSpin: { value: 0 },
      uSteer: { value: 0 },
      uDRS: { value: 0 },
      uPuGlow: { value: 0 }, // power-unit throttle glow 0..1
      uBrakeGlow: { value: 0 }, // brake disc heat 0..1
      uRadGlow: { value: 0 }, // radiator heat-soak 0..1
      uTyreHeat: { value: 0 }, // tyre compound heat 0..1
    }),
    [],
  )

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: '#f4f5f7',
      roughness: 0.45,
      metalness: 0.18,
    })
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aDark;
          varying float vDark;
          uniform float uSpin;
          uniform float uSteer;
          uniform float uDRS;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vDark = aDark;
          // wheel roll + steer: rotate rim/tyre-zone vertices about the
          // wheel centre (x=±1.8) in the local XY plane
          if (vDark >= 0.84 && vDark <= 1.01) {
            float cx = transformed.x >= 0.0 ? 1.8 : -1.8;
            float px = transformed.x - cx;
            transformed.x = cx + px * cos(uSpin) - transformed.y * sin(uSpin);
            transformed.y = px * sin(uSpin) + transformed.y * cos(uSpin);
            if (cx > 0.0) {
              float fx = transformed.x - cx;
              transformed.x = cx + fx * cos(uSteer) - transformed.y * sin(uSteer);
              transformed.y = fx * sin(uSteer) + transformed.y * cos(uSteer);
            }
          }
          // DRS flap lift (rear wing, x<0, upper): lift the leading edge
          if (vDark < 0.01 && transformed.x < -0.5 && transformed.y > 0.35) {
            transformed.z += uDRS * 0.25;
          }`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vDark;
          uniform float uPuGlow;
          uniform float uBrakeGlow;
          uniform float uRadGlow;
          uniform float uTyreHeat;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // PU throttle glow — amber spine along the engine cover
          if (vDark >= 0.14 && vDark <= 0.16) {
            totalEmissiveRadiance += vec3(1.0, 0.55, 0.05) * uPuGlow;
          }
          // brake disc glow — red, scales with brake temp
          if (vDark >= 0.29 && vDark <= 0.31) {
            totalEmissiveRadiance += vec3(1.0, 0.16, 0.03) * uBrakeGlow;
          }
          // radiator heat-soak — orange, once soaked past half
          if (vDark >= 0.69 && vDark <= 0.71) {
            totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * uRadGlow;
          }
          // hot tyre — compound tint bleeds into the rubber
          if (vDark >= 0.99) {
            totalEmissiveRadiance += vec3(0.25, 0.05, 0.02) * uTyreHeat;
          }`,
        )
    }
    return m
  }, [uniforms])

  const geo = useMemo(() => getAnatomyCarGeometry(), [])

  useFrame(() => {
    const { focusDriver, raceIndex } = useAppStore.getState()
    const d = focusDriver ?? raceIndex?.leaderAt(raceClock.t) ?? null
    if (d === null || !group.current) return
    const ch = session.channels[d]
    if (!ch) return
    sampleCar(ch, raceClock.t, sample)
    if (!sample.valid) {
      group.current.visible = false
      return
    }
    group.current.visible = true

    // same world mapping the diorama cars use
    group.current.position.set(sample.x, sample.z - model.elevationBase, -sample.y)
    group.current.rotation.y = sample.heading

    // ---- wheel dynamics (race-clock dt → playback-rate independent) ----
    const dt = Math.min(0.25, Math.max(0, raceClock.t - lastT.current))
    lastT.current = raceClock.t
    spin.current += (sample.velocity / WHEEL_R) * dt
    let steerTarget = 0
    if (Number.isFinite(prevHeading.current) && dt > 1e-4) {
      let dh = sample.heading - prevHeading.current
      dh = Math.atan2(Math.sin(dh), Math.cos(dh))
      steerTarget = THREE.MathUtils.clamp((dh / dt) * 0.12, -0.5, 0.5)
    }
    prevHeading.current = sample.heading
    steerSm.current += (steerTarget - steerSm.current) * Math.min(1, dt * 8)

    // DRS flap lifts over ~0.3 s
    drsAng.current += ((sample.drsOpen ? -0.12 : 0) - drsAng.current) * Math.min(1, dt * 6)

    // global heat for the radiators (brake-history soaked)
    heat.current = THREE.MathUtils.clamp(
      heat.current + (sample.brake / 100) * dt * 0.45 - dt * 0.07,
      0,
      1,
    )

    // ---- drive uniforms from the readouts (anatomyModel = single truth) ----
    const brake = brakeReadout(sample.brake, sample.speed, heat.current)
    const pu = puReadout(sample.rpm, sample.gear, sample.throttle)
    uniforms.uSpin.value = spin.current
    uniforms.uSteer.value = steerSm.current
    uniforms.uDRS.value = drsAng.current
    uniforms.uPuGlow.value = sample.throttle / 100
    uniforms.uBrakeGlow.value = (brake.fadeRisk * 0.9 + 0.1) * (sample.brake / 100)
    uniforms.uRadGlow.value = Math.max(0, (heat.current - 0.5) * 2)
    uniforms.uTyreHeat.value = heat.current

    // publish the live sample + derived readouts for the HUD
    sceneRefs.anatomySample = sample
    sceneRefs.anatomyReadout = {
      driver: d,
      brake,
      drs: drsReadout(sample.drsOpen, sample.speed, sample.drsOpen ? 0.4 : 1.2),
      pu,
      tyre: tyreReadout(0, 0, heat.current),
    }
    // sync external part selection (e.g. from HUD buttons)
    if (sceneRefs.anatomyPart && sceneRefs.anatomyPart !== activePart.current) {
      activePart.current = sceneRefs.anatomyPart
    } else {
      sceneRefs.anatomyPart = activePart.current
    }
  })

  // pointer press → pick the zone under the cursor → HUD shows that part
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const ndc = useMemo(() => new THREE.Vector2(), [])
  useFrame(({ camera }) => {
    if (!sceneRefs.anatomyEntryPoint || !mesh.current) return
    ndc.copy(sceneRefs.anatomyEntryPoint)
    sceneRefs.anatomyEntryPoint = null
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObject(mesh.current, false)
    if (hits.length > 0 && hits[0].face) {
      const hit = hits[0]
      const face = hit.face
      const localPt = mesh.current.worldToLocal(hit.point.clone())
      const darkAttr = mesh.current.geometry.getAttribute('aDark')
      const zone = darkAttr && face ? darkAttr.getX(face.a) : 0

      let selectedPart: PartKey = 'power_unit'
      if (Math.abs(zone - ANATOMY_ZONES.BRAKE) < 0.05) {
        selectedPart = 'brake_disc'
      } else if (Math.abs(zone - ANATOMY_ZONES.RUBBER) < 0.05 || Math.abs(zone - ANATOMY_ZONES.RIM) < 0.05) {
        selectedPart = 'tyre'
      } else if (localPt.x < -1.8 && localPt.y > 0.6) {
        selectedPart = 'drs_flap'
      } else if (localPt.x > 1.7) {
        selectedPart = 'front_wing'
      } else if (localPt.x < -1.8 && localPt.y <= 0.4) {
        selectedPart = 'diffuser'
      } else if (Math.abs(zone - ANATOMY_ZONES.POWER_UNIT) < 0.05 || Math.abs(zone - ANATOMY_ZONES.RADIATOR) < 0.05) {
        selectedPart = 'power_unit'
      } else if (localPt.x > -1.6 && localPt.x < 0.5) {
        selectedPart = 'power_unit'
      } else {
        selectedPart = 'front_wing'
      }

      activePart.current = selectedPart
      sceneRefs.anatomyPart = selectedPart
      playPartClick(selectedPart)
    }
  })

  return (
    <group ref={group}>
      <mesh ref={mesh} geometry={geo} material={material} />
    </group>
  )
}
