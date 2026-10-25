/* ============================================================
   Camera rigs + the Director — PORCELAIN edition.
   One camera, always orthographic, always at the classic
   isometric elevation. The diorama never tilts: the Director's
   grammar is reduced to three moves —
     · turn the model (smooth swing to the next 45° plate)
     · cut in tight  (hard cut, subject fills the frame)
     · frame a duel  (both cars held in one shot)
   Manual: TURNTABLE (drag to spin, locked elevation) ·
   FOLLOW (iso-track the focused car) · PLAN (straight-down
   architectural view).
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { SessionData } from '../data/types'
import { raceClock } from '../engine/RaceClock'
import type { GapSample } from '../engine/raceState'
import { makeCarSample, sampleCar } from '../engine/sampler'
import { useAppStore } from '../state/appStore'
import { sceneRefs } from './sceneRefs'
import type { TrackModel } from './trackBuilder'

/** classic isometric elevation: atan(1/√2) ≈ 35.264° */
const ISO_ELEV = Math.atan(1 / Math.SQRT2)
const POLAR = Math.PI / 2 - ISO_ELEV
/** the four plates of the turntable */
const PLATES = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180)

type ShotType = 'plate' | 'follow' | 'pair'

interface Shot {
  type: ShotType
  driver: number | null
  other: number | null
  /** world meters to fit across the smaller viewport dimension */
  span: number
  /** shot expires at this RACE time — at 20× lensing a wall-clock hold
      keeps cutting back to action that is long over */
  until: number
  cut: boolean
  /** the moment this shot serves (if any): when it passes, the shot passes */
  momentEnd?: number
}

/** shot lengths in RACE seconds, compensated by the playback rate at pick
    time so temporal lensing can't outrun the director */
const SHOT_LENGTH: Record<ShotType, number> = { plate: 11, follow: 8, pair: 7.5 }
/** a hard cut never follows the previous one by less than this (wall s) */
const MIN_CUT_GAP_S = 2.5

export function CameraRig({ model, session }: { model: TrackModel; session: SessionData }) {
  const cameraMode = useAppStore((s) => s.cameraMode)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const sample = useMemo(() => makeCarSample(), [])
  const sampleB = useMemo(() => makeCarSample(), [])
  const gapTmp = useMemo<GapSample>(() => ({ gap: NaN, interval: NaN, gapLaps: 0 }), [])
  const center = useMemo(
    () => new THREE.Vector3(model.center[0], 0, model.center[2]),
    [model],
  )

  // aspect-aware framing: world-meters (across the smaller viewport axis)
  // needed to fit the whole plinth at a given turntable azimuth
  const fitSpan = useMemo(() => {
    const margin = Math.max(70, model.radius * 0.16) + 24
    const [x0, x1, z0, z1] = model.bounds
    const cs = [
      [x0 - margin, z0 - margin],
      [x1 + margin, z0 - margin],
      [x0 - margin, z1 + margin],
      [x1 + margin, z1 + margin],
    ]
    const sinE = Math.sin(ISO_ELEV)
    return (a: number, w: number, h: number): number => {
      const minDim = Math.min(w, h)
      let minU = Infinity
      let maxU = -Infinity
      let minV = Infinity
      let maxV = -Infinity
      for (const [x, z] of cs) {
        const u = -Math.sin(a) * x + Math.cos(a) * z
        const v = (-Math.cos(a) * x - Math.sin(a) * z) * sinE
        if (u < minU) minU = u
        if (u > maxU) maxU = u
        if (v < minV) minV = v
        if (v > maxV) maxV = v
      }
      return Math.max(((maxU - minU) * minDim) / w, ((maxV - minV) * minDim) / h) * 1.04
    }
  }, [model])

  const fullSpan = model.radius * 2.4

  // free zoom: the wheel bends any rig frame; double-click resets
  const zoomBias = useRef(1)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (useAppStore.getState().cameraMode === 'orbit') return
      if ((e.target as HTMLElement | null)?.closest('.shell')) return
      zoomBias.current = THREE.MathUtils.clamp(
        zoomBias.current * Math.exp(-e.deltaY * 0.0012),
        0.35,
        3.5,
      )
    }
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.shell')) return
      zoomBias.current = 1
      // double-click the focused car → drop into the anatomy cutaway,
      // remembering the camera we came from so ESC can return there
      const st = useAppStore.getState()
      if (st.focusDriver !== null && st.cameraMode !== 'anatomy') {
        sceneRefs.anatomyPrevMode = st.cameraMode
        st.setCameraMode('anatomy')
      }
    }
    // anatomy mode: pointer work pauses the idle revolve so it never
    // spins out from under the user while they inspect a part
    const onPointerMove = () => {
      lastInteractT.current = performance.now() / 1000
    }
    const onPointerDown = (e: PointerEvent) => {
      lastInteractT.current = performance.now() / 1000
      // in anatomy mode, publish the click NDC so AnatomyCar can raycast
      // the pressed part and surface its live readout in the HUD
      if (useAppStore.getState().cameraMode === 'anatomy') {
        const target = e.target as HTMLElement | null
        if (target?.closest('.shell__hints') || target?.closest('.anat') || target?.closest('button')) return
        const cvs = document.querySelector('canvas')
        if (cvs) {
          const r = cvs.getBoundingClientRect()
          if (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          ) {
            sceneRefs.anatomyEntryPoint = new THREE.Vector2(
              ((e.clientX - r.left) / r.width) * 2 - 1,
              -(((e.clientY - r.top) / r.height) * 2 - 1),
            )
          }
        }
      }
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('dblclick', onDbl)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('dblclick', onDbl)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  // smoothed rig state
  const az = useRef(PLATES[0])
  const azGoal = useRef(PLATES[0])
  const plateIdx = useRef(0)
  const span = useRef(fullSpan)
  const spanGoal = useRef(fullSpan)
  const target = useRef(new THREE.Vector3())
  const targetGoal = useRef(new THREE.Vector3())
  const shotRef = useRef<Shot | null>(null)
  const shotCounter = useRef(0)
  const wallT = useRef(0)
  const lastCutWallT = useRef(-1e9)
  const lastMode = useRef<string>('')
  /** anatomy mode: slow auto-revolve phase + the last time the user touched it */
  const revolve = useRef(0)
  const lastInteractT = useRef(-1e9)

  const placed = useRef(false)
  useEffect(() => {
    if (placed.current) return
    placed.current = true
    target.current.copy(center)
    targetGoal.current.copy(center)
  }, [center])

  const carPos = (d: number, out: THREE.Vector3): boolean => {
    const ch = session.channels[d]
    if (!ch) return false
    sampleCar(ch, raceClock.t, sample)
    if (!sample.valid) return false
    out.set(sample.x, sample.z - model.elevationBase, -sample.y)
    return true
  }

  const tmpA = useMemo(() => new THREE.Vector3(), [])
  const tmpB = useMemo(() => new THREE.Vector3(), [])

  const pickShot = (): Shot | null => {
    const { raceIndex, moments, focusDriver } = useAppStore.getState()
    if (!raceIndex) return null
    const t = raceClock.t
    shotCounter.current++
    // lensing runs the race 1–24×; a shot must live its scripted length of
    // RACE time or the director narrates the past
    const rate = Math.max(1, raceClock.rate)
    const hold = (len: number) => t + len * rate

    // 0. the establishing shot: always open on the whole diorama
    if (shotCounter.current === 1) {
      return { type: 'plate', driver: null, other: null, span: fullSpan, until: hold(SHOT_LENGTH.plate), cut: false }
    }

    // 1. a fresh high-severity moment cuts in tight
    if (moments) {
      let best: { sev: number; m: (typeof moments.moments)[number] } | null = null
      for (const m of moments.moments) {
        if (m.t > t + 1) break
        const active = m.tEnd !== undefined ? t <= m.tEnd + 4 : t - m.t < 10
        if (!active || m.drivers.length === 0 || m.severity < 0.45) continue
        if (!best || m.severity > best.sev) best = { sev: m.severity, m }
      }
      if (best) {
        const m = best.m
        if (m.type === 'battle' && m.drivers.length > 1) {
          return { type: 'pair', driver: m.drivers[0], other: m.drivers[1], span: 150, until: hold(SHOT_LENGTH.pair), cut: true, momentEnd: m.tEnd }
        }
        const span = m.type === 'overtake' ? 78 : 108
        return { type: 'follow', driver: m.drivers[0], other: null, span, until: hold(SHOT_LENGTH.follow), cut: true, momentEnd: m.tEnd }
      }
    }

    // 2. the user's focus is sacred
    if (focusDriver !== null) {
      return { type: 'follow', driver: focusDriver, other: null, span: 85, until: hold(SHOT_LENGTH.follow), cut: false }
    }

    // 3. idle grammar: mostly watch the sharp end; every third shot, turn the model
    if (shotCounter.current % 3 === 0) {
      plateIdx.current = (plateIdx.current + 1) % PLATES.length
      return { type: 'plate', driver: null, other: null, span: fullSpan, until: hold(SHOT_LENGTH.plate), cut: false }
    }
    const t2 = raceClock.t
    const order = raceIndex.orderAt(t2)
    let tightest: { d: number; ahead: number; iv: number } | null = null
    for (let i = 1; i < order.length; i++) {
      raceIndex.gapOf(order[i], t2, gapTmp)
      if (Number.isFinite(gapTmp.interval) && gapTmp.interval >= 0 && gapTmp.interval < 2.5 && gapTmp.gapLaps === 0) {
        if (!tightest || gapTmp.interval < tightest.iv) tightest = { d: order[i], ahead: order[i - 1], iv: gapTmp.interval }
      }
    }
    if (tightest) {
      return { type: 'pair', driver: tightest.d, other: tightest.ahead, span: 150, until: hold(SHOT_LENGTH.pair), cut: true }
    }
    const leader = order[0]
    if (leader === undefined) return null
    return { type: 'follow', driver: leader, other: null, span: 92, until: hold(SHOT_LENGTH.follow), cut: true }
  }

  useFrame((_, dt) => {
    if (cameraMode === 'orbit') {
      lastMode.current = 'orbit'
      return
    }

    // returning from manual turntable: adopt its azimuth/zoom so we don't jump
    if (lastMode.current === 'orbit') {
      az.current = Math.atan2(camera.position.z - target.current.z, camera.position.x - target.current.x)
      azGoal.current = az.current
      span.current = Math.min(size.width, size.height) / Math.max(camera.zoom, 1e-6)
      spanGoal.current = span.current
    }
    lastMode.current = cameraMode

    wallT.current += dt
    const kPan = 1 - Math.exp(-4.5 * Math.min(dt, 0.08))
    const kSpan = 1 - Math.exp(-3.6 * Math.min(dt, 0.08))
    const kAz = 1 - Math.exp(-2.8 * Math.min(dt, 0.08))
    let cut = false

    if (cameraMode === 'director') {
      let shot = shotRef.current
      const stale =
        !shot ||
        raceClock.t >= shot.until ||
        (shot.momentEnd !== undefined && raceClock.t > shot.momentEnd + 3) ||
        (shot.driver !== null && !session.channels[shot.driver])
      if (stale) {
        shot = pickShot()
        // pace hard cuts: at high lensing rates moments fire faster than
        // the eye can re-orient — hold the minimum gap between them
        if (shot && shot.cut && wallT.current - lastCutWallT.current < MIN_CUT_GAP_S) {
          shot = null
        } else if (shot?.cut) {
          lastCutWallT.current = wallT.current
        }
        shotRef.current = shot
      }
      if (shot) {
        cut = shot.cut
        shot.cut = false

        if (shot.type === 'plate') {
          azGoal.current = PLATES[plateIdx.current]
          spanGoal.current = fitSpan(azGoal.current, size.width, size.height)
          targetGoal.current.copy(center)
        } else if (shot.type === 'pair' && shot.driver !== null && shot.other !== null) {
          const okA = carPos(shot.driver, tmpA)
          const chB = session.channels[shot.other]
          let okB = false
          if (chB) {
            sampleCar(chB, raceClock.t, sampleB)
            okB = sampleB.valid
            if (okB) tmpB.set(sampleB.x, sampleB.z - model.elevationBase, -sampleB.y)
          }
          if (okA && okB) {
            targetGoal.current.addVectors(tmpA, tmpB).multiplyScalar(0.5)
            spanGoal.current = THREE.MathUtils.clamp(tmpA.distanceTo(tmpB) * 2.6, 95, 380)
          } else if (okA || okB) {
            targetGoal.current.copy(okA ? tmpA : tmpB)
            spanGoal.current = 92
          } else {
            // subject telemetry gone (pit box / dropout): re-pick next frame,
            // but never skip the settle — a skipped frame freezes the rig
            shotRef.current = null
          }
        } else if (shot.driver !== null) {
          if (carPos(shot.driver, tmpA)) {
            // lead room: bias the frame ahead of the car, where the race is going
            targetGoal.current.copy(tmpA)
            targetGoal.current.x += Math.cos(sample.heading) * shot.span * 0.11
            targetGoal.current.z += -Math.sin(sample.heading) * shot.span * 0.11
            spanGoal.current = shot.span
          } else {
            shotRef.current = null
          }
        }
      }
    } else if (cameraMode === 'chase') {
      const { focusDriver, raceIndex } = useAppStore.getState()
      const d = focusDriver ?? raceIndex?.leaderAt(raceClock.t) ?? null
      if (d !== null && carPos(d, tmpA)) {
        targetGoal.current.copy(tmpA)
        targetGoal.current.x += Math.cos(sample.heading) * 14
        targetGoal.current.z += -Math.sin(sample.heading) * 14
        spanGoal.current = 95
      }
    } else if (cameraMode === 'anatomy') {
      // the cutaway: tight on the focused car (else the leader), framed from
      // a fixed 3/4 so the open side of the tub reads. A slow auto-revolve
      // (iso-glow's turntable) idles in, pauses while the user works.
      const { focusDriver, raceIndex } = useAppStore.getState()
      const d = focusDriver ?? raceIndex?.leaderAt(raceClock.t) ?? null
      if (d !== null && carPos(d, tmpA)) {
        targetGoal.current.copy(tmpA)
        spanGoal.current = 16 // meters across the smaller viewport axis
        const now = performance.now() / 1000
        if (now - lastInteractT.current > 2.5) {
          revolve.current += 0.06 * Math.min(dt, 0.08)
        }
        azGoal.current = sample.heading + Math.PI * 0.75 + revolve.current
      }
      // mirror the mode for frame systems that read sceneRefs, not React
      sceneRefs.cameraMode = 'anatomy'
    } else {
      // plan view — fit the plinth's true footprint, straight down
      targetGoal.current.copy(center)
      const minDim = Math.min(size.width, size.height)
      const margin = Math.max(70, model.radius * 0.16) + 24
      const [x0, x1, z0, z1] = model.bounds
      spanGoal.current =
        Math.max(
          ((x1 - x0 + margin * 2) * minDim) / size.width,
          ((z1 - z0 + margin * 2) * minDim) / size.height,
        ) * 1.03
    }

    // settle
    if (cut) {
      az.current = azGoal.current
      span.current = spanGoal.current
      target.current.copy(targetGoal.current)
    } else {
      // tracking a subject moving up to ~90 m/s: a fixed smoothing constant
      // parks the frame a constant v/k meters BEHIND the car — the subject
      // drifts to the frame edge and reads as out of focus. Scale the pan
      // gain with the subject's own speed so the lag stays bounded.
      const trackV = sample.valid ? sample.velocity : sampleB.valid ? sampleB.velocity : 0
      const kTrack = 1 - Math.exp(-(4.5 + Math.min(trackV, 95) / 11) * Math.min(dt, 0.08))
      // shortest-arc azimuth damping
      let dAz = azGoal.current - az.current
      dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz))
      az.current += dAz * kAz
      span.current += (spanGoal.current - span.current) * kSpan
      target.current.lerp(targetGoal.current, Math.max(kPan, kTrack))
    }

    // never let a bad sample poison the rig: NaN here wedges the GPU
    if (!Number.isFinite(span.current) || span.current <= 0) span.current = fullSpan
    if (!Number.isFinite(az.current)) az.current = PLATES[plateIdx.current]
    if (
      !Number.isFinite(target.current.x) ||
      !Number.isFinite(target.current.y) ||
      !Number.isFinite(target.current.z)
    ) {
      target.current.copy(center)
      targetGoal.current.copy(center)
    }

    // place the orthographic camera
    const D = model.radius * 5 + 500
    if (cameraMode === 'top') {
      camera.position.set(target.current.x, D, target.current.z + 0.001 * D)
    } else {
      const ce = Math.cos(ISO_ELEV)
      camera.position.set(
        target.current.x + Math.cos(az.current) * ce * D,
        target.current.y + Math.sin(ISO_ELEV) * D,
        target.current.z + Math.sin(az.current) * ce * D,
      )
    }
    camera.zoom = (Math.min(size.width, size.height) / span.current) * zoomBias.current
    camera.updateProjectionMatrix()
    camera.lookAt(target.current)

    // publish the rig frame for the DOM callout layer: the SVG hairlines
    // read sceneRefs.isoFrame and project through isoPlane with the exact
    // azimuth, target and zoom this camera just used. ONE writer, so the
    // overlay and the canvas can never disagree about where things are.
    if (!sceneRefs.isoFrame) sceneRefs.isoFrame = { az: 0, cx: 0, cz: 0, width: 0, height: 0, zoom: 1 }
    const f = sceneRefs.isoFrame
    f.az = cameraMode === 'top' ? 0 : az.current
    f.cx = target.current.x
    f.cz = target.current.z
    f.width = size.width
    f.height = size.height
    f.zoom = camera.zoom
    f.elevation = cameraMode === 'top' ? Math.PI / 2 : ISO_ELEV
  })

  if (cameraMode !== 'orbit') return null
  const minDim = Math.min(size.width, size.height)
  return (
    <OrbitControls
      makeDefault
      target={center}
      enableDamping
      dampingFactor={0.08}
      // the diorama never tilts: elevation is locked, you may only spin and zoom
      minPolarAngle={POLAR}
      maxPolarAngle={POLAR}
      minZoom={minDim / (model.radius * 3.4)}
      maxZoom={minDim / 70}
    />
  )
}
