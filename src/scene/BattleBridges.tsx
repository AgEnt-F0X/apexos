/* ============================================================
   Battle threads — PORCELAIN's flagship: a taut thread
   stretches between cars fighting inside ~1.6s, the single red
   ribbon through the white world. Tension (gap) drives it from
   quiet ink to signal red; the live gap rides it on a paper
   chip. Fixed pool; pair selection at 2 Hz, geometry at 60.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SessionData } from '../data/types'
import { raceClock } from '../engine/RaceClock'
import type { GapSample } from '../engine/raceState'
import { makeCarSample, sampleCar } from '../engine/sampler'
import { useAppStore } from '../state/appStore'
import type { TrackModel } from './trackBuilder'

const POOL = 6
const BRIDGE_GAP_S = 1.6

interface Slot {
  beam: THREE.Mesh
  label: THREE.Sprite
  labelCtx: CanvasRenderingContext2D
  labelTex: THREE.CanvasTexture
  lastText: string
  chaser: number
  ahead: number
  active: boolean
}

function makeLabel(): { sprite: THREE.Sprite; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 44
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({
    map: tex,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.034, 0.0117, 1)
  sprite.renderOrder = 11
  return { sprite, ctx, tex }
}

function drawLabel(slot: Slot, text: string, tension: number) {
  if (text === slot.lastText) return
  slot.lastText = text
  const ctx = slot.labelCtx
  const { width: w, height: h } = ctx.canvas
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
  ctx.beginPath()
  ctx.roundRect(4, 4, w - 8, h - 8, 6)
  ctx.fill()
  // quiet ink → signal red as the gap collapses
  const r = Math.round(76 + (225 - 76) * tension)
  const g = Math.round(87 - (87 - 6) * tension)
  const b = Math.round(102 * (1 - tension))
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + 0.45 * tension})`
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
  ctx.font = '700 24px "JetBrains Mono", monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, w / 2, h / 2 + 1)
  slot.labelTex.needsUpdate = true
}

export function BattleBridges({ session, model }: { session: SessionData; model: TrackModel }) {
  const slots = useMemo<Slot[]>(() => {
    const out: Slot[] = []
    for (let i = 0; i < POOL; i++) {
      const geo = new THREE.BoxGeometry(1, 0.16, 0.16)
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55 })
      const beam = new THREE.Mesh(geo, mat)
      beam.visible = false
      const { sprite, ctx, tex } = makeLabel()
      sprite.visible = false
      out.push({ beam, label: sprite, labelCtx: ctx, labelTex: tex, lastText: '', chaser: -1, ahead: -1, active: false })
    }
    return out
  }, [])

  useEffect(() => {
    return () => {
      for (const s of slots) {
        s.beam.geometry.dispose()
        ;(s.beam.material as THREE.Material).dispose()
        s.labelTex.dispose()
        s.label.material.dispose()
      }
    }
  }, [slots])

  const sampleA = useMemo(() => makeCarSample(), [])
  const sampleB = useMemo(() => makeCarSample(), [])
  const gapTmp = useMemo<GapSample>(() => ({ gap: NaN, interval: NaN, gapLaps: 0 }), [])
  const lastPairT = useRef(-1)
  const mid = useMemo(() => new THREE.Vector3(), [])
  const a = useMemo(() => new THREE.Vector3(), [])
  const b = useMemo(() => new THREE.Vector3(), [])

  useFrame((state) => {
    const t = raceClock.t
    const { raceIndex } = useAppStore.getState()
    if (!raceIndex) return
    // orthographic constant-screen-size labels
    const zoom = Math.max(state.camera.zoom, 1e-6)
    const labelH = 24 / zoom
    const labelW = labelH * (128 / 44)
    // battles are a detail-level story: hide the chips on wide shots
    const span = Math.min(state.size.width, state.size.height) / zoom
    const labelsAllowed = span < 520

    // grid gaps are not battles — threads only exist once the race is running
    if (t < session.tAction) {
      for (const slot of slots) {
        slot.active = false
        slot.beam.visible = false
        slot.label.visible = false
      }
      return
    }

    // --- re-pair at 2 Hz (or after scrubs) ---
    if (Math.abs(t - lastPairT.current) > 0.5) {
      lastPairT.current = t
      const order = raceIndex.orderAt(t)
      const pairs: Array<{ chaser: number; ahead: number; iv: number }> = []
      for (let i = 1; i < order.length && pairs.length < POOL; i++) {
        raceIndex.gapOf(order[i], t, gapTmp)
        const iv = gapTmp.interval
        if (Number.isFinite(iv) && iv >= 0 && iv < BRIDGE_GAP_S && gapTmp.gapLaps === 0) {
          pairs.push({ chaser: order[i], ahead: order[i - 1], iv })
        }
      }
      pairs.sort((x, y) => x.iv - y.iv)
      for (let i = 0; i < POOL; i++) {
        const slot = slots[i]
        if (i < pairs.length) {
          slot.chaser = pairs[i].chaser
          slot.ahead = pairs[i].ahead
          slot.active = true
        } else {
          slot.active = false
        }
      }
    }

    // --- stretch beams every frame ---
    for (const slot of slots) {
      if (!slot.active) {
        slot.beam.visible = false
        slot.label.visible = false
        continue
      }
      const chA = session.channels[slot.chaser]
      const chB = session.channels[slot.ahead]
      if (!chA || !chB) {
        slot.beam.visible = false
        slot.label.visible = false
        continue
      }
      sampleCar(chA, t, sampleA)
      sampleCar(chB, t, sampleB)
      if (!sampleA.valid || !sampleB.valid) {
        slot.beam.visible = false
        slot.label.visible = false
        continue
      }
      a.set(sampleA.x, sampleA.z - model.elevationBase + 1.1, -sampleA.y)
      b.set(sampleB.x, sampleB.z - model.elevationBase + 1.1, -sampleB.y)
      const dist = a.distanceTo(b)
      if (!Number.isFinite(dist) || dist < 4 || dist > 260) {
        slot.beam.visible = false
        slot.label.visible = false
        continue
      }
      mid.addVectors(a, b).multiplyScalar(0.5)
      slot.beam.visible = true
      slot.beam.position.copy(mid)
      slot.beam.scale.set(dist, 1, 1)
      slot.beam.lookAt(b)
      slot.beam.rotateY(Math.PI / 2)

      raceIndex.gapOf(slot.chaser, t, gapTmp)
      const iv = Number.isFinite(gapTmp.interval) ? gapTmp.interval : BRIDGE_GAP_S
      const tension = Math.min(Math.max(1 - iv / BRIDGE_GAP_S, 0), 1)
      const m = slot.beam.material as THREE.MeshBasicMaterial
      // ink thread → signal red at full tension
      m.color.setRGB(0.30 + tension * 0.58, 0.34 - tension * 0.32, 0.40 * (1 - tension))
      m.opacity = 0.35 + tension * 0.55

      slot.label.visible = labelsAllowed
      slot.label.scale.set(labelW, labelH, 1)
      slot.label.position.set(mid.x, mid.y + 3.4, mid.z)
      drawLabel(slot, `${iv.toFixed(1)}s`, tension)
    }
  })

  return (
    <group>
      {slots.map((s, i) => (
        <group key={i}>
          <primitive object={s.beam} />
          <primitive object={s.label} />
        </group>
      ))}
    </group>
  )
}
