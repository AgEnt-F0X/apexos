/* ============================================================
   The Anatomy Car — one cutaway F1 car, ~110 merged solid
   parts, at track scale in the SAME world units as the diorama
   car, using the SAME `aDark` zone convention so one shader
   paints both.

   Anatomy's rule: the object is the explanation. Not a slab with
   lines on it — a machine made of many small parts, each of
   which does something you can watch. Every dimension reads
   from anatomyModel.ts, so a part's size, the shader's zone
   test and a displayed number can never disagree.

   Zones (aDark) — extended from carGeometry's four:
     0    livery / structure
     0.3  brake disc + caliper
     0.55 cockpit / carbon / halo / detail
     0.7  radiator core (glows when heat-soaked)
     0.85 alloy rim
     1    rubber tyre
     0.15 power unit (glows on throttle)
   ============================================================ */

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CAR, WHEEL } from './anatomyModel'

/** zone constants — the single source the shader and this file share */
export const ANATOMY_ZONES = {
  LIVERY: 0,
  BRAKE: 0.3,
  COCKPIT: 0.55,
  RADIATOR: 0.7,
  RIM: 0.85,
  RUBBER: 1,
  POWER_UNIT: 0.15,
} as const

function withDark(geo: THREE.BufferGeometry, dark: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const count = g.getAttribute('position').count
  const arr = new Float32Array(count).fill(dark)
  g.setAttribute('aDark', new THREE.BufferAttribute(arr, 1))
  g.deleteAttribute('uv')
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1')
  return g
}

/** Deterministic RNG — detail bolts must land identically every build. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WHEEL_R = WHEEL.frontDiameter / 2 // 0.36 m
const RIM_R = WHEEL.rimDiameter / 2 // 0.2285 m
const FRONT_X = CAR.wheelbase / 2 // 1.8
const REAR_X = -CAR.wheelbase / 2 // -1.8
const TRACK_F = CAR.frontTrack / 2 // 0.875
const TRACK_R = CAR.rearTrack / 2 // 0.825
const ZONES = ANATOMY_ZONES

let cachedAnatomy: THREE.BufferGeometry | null = null

function buildAnatomy(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  const push = (geo: THREE.BufferGeometry, zone: number) => {
    parts.push(withDark(geo, zone))
  }

  /* ---------- base / tub ---------- */
  // floor pan
  const floor = new THREE.BoxGeometry(CAR.length, 0.04, 1.7)
  floor.translate(-0.1, 0.16, 0)
  push(floor, ZONES.LIVERY)

  // survival cell tub: an extruded higher-sided section, cockpit up front
  const tubShape = new THREE.Shape()
  tubShape.moveTo(0.95, 0.02)
  tubShape.lineTo(0.55, 0.30)
  tubShape.lineTo(-0.75, 0.34)
  tubShape.lineTo(-1.55, 0.22)
  tubShape.lineTo(-2.45, 0.10)
  tubShape.lineTo(-2.72, 0.02)
  tubShape.lineTo(-2.45, -0.06)
  tubShape.lineTo(-1.55, 0.0)
  tubShape.lineTo(-0.75, -0.06)
  tubShape.lineTo(0.55, -0.08)
  tubShape.lineTo(0.95, -0.06)
  tubShape.closePath()
  const tub = new THREE.ExtrudeGeometry(tubShape, { depth: 1.05, bevelEnabled: false })
  tub.rotateX(-Math.PI / 2)
  tub.translate(0, 0.28, -0.525)
  push(tub, ZONES.LIVERY)

  // nose cone
  const nose = new THREE.CylinderGeometry(0.05, 0.22, 1.25, 6)
  nose.rotateZ(-Math.PI / 2)
  nose.scale(1, 0.85, 1)
  nose.translate(2.05, 0.26, 0)
  push(nose, ZONES.LIVERY)

  /* ---------- suspension (×4 corners) ---------- */
  for (const [cx, z, front] of [
    [FRONT_X, TRACK_F, true],
    [FRONT_X, -TRACK_F, true],
    [REAR_X, TRACK_R, false],
    [REAR_X, -TRACK_R, false],
  ] as Array<[number, number, boolean]>) {
    const inward = z > 0 ? -1 : 1
    const inboardZ = z * 0.35
    // upper wishbone: two thin arms forming a V from chassis to the hub
    for (const dz of [0.1, -0.1]) {
      const arm = new THREE.BoxGeometry(0.5, 0.035, 0.035)
      arm.rotateY(Math.PI / 2)
      const mx = (cx + z * 0.05 + cx) / 2
      const mz = (inboardZ + (z + inward * dz)) / 2
      arm.translate(mx, 0.5, mz)
      arm.rotateX((z - inboardZ) / (cx - 0) * 0.2 * inward * (front ? 1 : -1))
      push(arm, ZONES.COCKPIT)
    }
    // lower wishbone: wider, lower
    for (const dz of [0.13, -0.13]) {
      const arm = new THREE.BoxGeometry(0.6, 0.04, 0.04)
      arm.rotateY(Math.PI / 2)
      const mz = (inboardZ + (z + inward * dz)) / 2
      arm.translate((cx + z * 0.05 + cx) / 2, 0.28, mz)
      push(arm, ZONES.COCKPIT)
    }
    // pushrod (inboard suspension) — from the tub up to the upper wishbone
    const rod = new THREE.CylinderGeometry(0.028, 0.028, 0.7, 6)
    rod.rotateZ(0.5 * (front ? 1 : -1))
    rod.translate(cx + (front ? -0.15 : 0.15), 0.55, inboardZ + (front ? 0.15 : -0.15))
    push(rod, ZONES.COCKPIT)
    // trackrod (steering/geometry link)
    const track = new THREE.CylinderGeometry(0.022, 0.022, 0.65, 6)
    track.rotateZ(Math.PI / 2.4 * (front ? 1 : -1))
    track.translate(cx - 0.1, 0.38, inboardZ + (front ? 0.1 : -0.1))
    push(track, ZONES.LIVERY)
  }

  /* ---------- brakes (×4) ---------- */
  for (const [cx, z] of [
    [FRONT_X, TRACK_F],
    [FRONT_X, -TRACK_F],
    [REAR_X, TRACK_R],
    [REAR_X, -TRACK_R],
  ] as Array<[number, number]>) {
    const inward = z > 0 ? -1 : 1
    // carbon disc
    const disc = new THREE.CylinderGeometry(WHEEL.brakeDiscDiameter / 2, WHEEL.brakeDiscDiameter / 2, WHEEL.brakeDiscThickness, 16)
    disc.rotateX(Math.PI / 2)
    disc.translate(cx, WHEEL_R, z + inward * 0.02)
    push(disc, ZONES.BRAKE)
    // caliper (a small offset box)
    const cal = new THREE.BoxGeometry(0.11, 0.17, 0.07)
    cal.translate(cx + 0.14, WHEEL_R + 0.02, z + inward * 0.06)
    push(cal, ZONES.BRAKE)
    // brake duct (a curved scoop feeding the disc)
    const duct = new THREE.BoxGeometry(0.3, 0.2, 0.14)
    duct.translate(cx - 0.1, WHEEL_R, z + inward * 0.1)
    duct.rotateZ(0.35)
    push(duct, ZONES.COCKPIT)
  }

  /* ---------- wheels (×4): tyre + rim ---------- */
  for (const [cx, z] of [
    [FRONT_X, TRACK_F],
    [FRONT_X, -TRACK_F],
    [REAR_X, TRACK_R],
    [REAR_X, -TRACK_R],
  ] as Array<[number, number]>) {
    const tyre = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL.width, 16)
    tyre.rotateX(Math.PI / 2)
    tyre.translate(cx, WHEEL_R, z)
    push(tyre, ZONES.RUBBER)
    const rim = new THREE.CylinderGeometry(RIM_R, RIM_R, WHEEL.width * 1.04, 8)
    rim.rotateX(Math.PI / 2)
    rim.translate(cx, WHEEL_R, z)
    push(rim, ZONES.RIM)
  }

  /* ---------- power unit ---------- */
  const engine = new THREE.BoxGeometry(0.85, 0.5, 0.55)
  engine.translate(-0.75, 0.62, 0)
  push(engine, ZONES.POWER_UNIT)
  // turbo / MGU-H housing
  const turbo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10)
  turbo.rotateX(Math.PI / 2)
  turbo.translate(-1.15, 0.85, 0.16)
  push(turbo, ZONES.POWER_UNIT)
  // exhaust
  const exhaust = new THREE.CylinderGeometry(0.05, 0.045, 0.5, 8)
  exhaust.rotateZ(Math.PI / 2)
  exhaust.rotateY(0.12)
  exhaust.translate(-1.85, 0.72, 0)
  push(exhaust, ZONES.COCKPIT)
  // engine cover spine
  const cover = new THREE.BoxGeometry(1.9, 0.2, 0.34)
  cover.translate(-0.7, 0.92, 0)
  push(cover, ZONES.LIVERY)

  /* ---------- cooling (×2 sidepods) ---------- */
  for (const z of [0.62, -0.62]) {
    const pod = new THREE.BoxGeometry(1.8, 0.36, 0.4)
    pod.translate(-0.5, 0.3, z)
    push(pod, ZONES.LIVERY)
    const rad = new THREE.BoxGeometry(0.5, 0.28, 0.3)
    rad.translate(0.32, 0.3, z)
    push(rad, ZONES.RADIATOR)
    const inlet = new THREE.BoxGeometry(0.12, 0.26, 0.34)
    inlet.translate(0.6, 0.3, z)
    push(inlet, ZONES.LIVERY)
  }

  /* ---------- aero ---------- */
  // front wing main + flap + endplates
  const fw = new THREE.BoxGeometry(0.5, 0.05, 1.85)
  fw.translate(2.5, 0.1, 0)
  push(fw, ZONES.LIVERY)
  const fwFlap = new THREE.BoxGeometry(0.3, 0.03, 1.8)
  fwFlap.translate(2.36, 0.16, 0)
  push(fwFlap, ZONES.LIVERY)
  for (const z of [0.95, -0.95]) {
    const ep = new THREE.BoxGeometry(0.5, 0.18, 0.03)
    ep.translate(2.48, 0.1, z)
    push(ep, ZONES.LIVERY)
  }
  // rear wing: main + DRS flap + endplates + swan necks
  const rw = new THREE.BoxGeometry(0.4, 0.05, 1.0)
  rw.translate(-2.5, 0.84, 0)
  push(rw, ZONES.LIVERY)
  const rwFlap = new THREE.BoxGeometry(0.26, 0.04, 0.98)
  rwFlap.translate(-2.34, 0.94, 0)
  push(rwFlap, ZONES.LIVERY)
  for (const z of [0.5, -0.5]) {
    const ep = new THREE.BoxGeometry(0.56, 0.4, 0.035)
    ep.translate(-2.48, 0.66, z)
    push(ep, ZONES.LIVERY)
    const neck = new THREE.BoxGeometry(0.05, 0.4, 0.05)
    neck.translate(-2.34, 0.64, z)
    push(neck, ZONES.LIVERY)
  }
  // floor edges (×2) + diffuser
  for (const z of [0.85, -0.85]) {
    const edge = new THREE.BoxGeometry(2.4, 0.05, 0.1)
    edge.translate(-0.2, 0.18, z)
    push(edge, ZONES.LIVERY)
  }
  const diffuser = new THREE.BoxGeometry(0.6, 0.24, 1.0)
  diffuser.rotateZ(-0.12)
  diffuser.translate(-2.4, 0.2, 0)
  push(diffuser, ZONES.COCKPIT)

  /* ---------- cockpit ---------- */
  const halo = new THREE.TorusGeometry(0.34, 0.05, 6, 14, Math.PI)
  halo.rotateY(Math.PI / 2)
  halo.rotateX(-0.12)
  halo.translate(0.6, 0.86, 0)
  push(halo, ZONES.COCKPIT)
  const wheel = new THREE.TorusGeometry(0.11, 0.03, 6, 10)
  wheel.rotateX(-Math.PI / 2)
  wheel.translate(0.72, 0.78, 0)
  push(wheel, ZONES.COCKPIT)
  const seat = new THREE.BoxGeometry(0.45, 0.2, 0.45)
  seat.translate(0.15, 0.5, 0)
  push(seat, ZONES.COCKPIT)
  const helmet = new THREE.SphereGeometry(0.15, 10, 8)
  helmet.translate(0.62, 0.82, 0)
  push(helmet, ZONES.LIVERY)
  // airbox
  const airbox = new THREE.BoxGeometry(0.3, 0.22, 0.26)
  airbox.translate(0.2, 0.98, 0)
  push(airbox, ZONES.LIVERY)

  /* ---------- detail bolts: the scattering that makes it read as anatomy ---------- */
  const rng = mulberry32(0xf1)
  const boltSites: Array<[number, number, number]> = []
  // chassis joint points, wishbone roots, wing mounts, suspension pickup points
  for (const x of [-1.4, -0.8, -0.2, 0.4, 1.0]) {
    boltSites.push([x, 0.46, 0.42], [x, 0.46, -0.42])
  }
  for (const [cx, z] of [
    [FRONT_X, TRACK_F],
    [FRONT_X, -TRACK_F],
    [REAR_X, TRACK_R],
    [REAR_X, -TRACK_R],
  ] as Array<[number, number]>) {
    boltSites.push([cx, 0.46, z * 0.35], [cx - 0.12, 0.3, z * 0.35])
  }
  boltSites.push([2.5, 0.14, 0.9], [2.5, 0.14, -0.9], [-2.5, 0.88, 0.9], [-2.5, 0.88, -0.9])
  for (const [x, y, z] of boltSites) {
    const r = 0.012 + rng() * 0.008
    const h = 0.02 + rng() * 0.015
    const bolt = new THREE.CylinderGeometry(r, r, h, 6)
    bolt.translate(x, y, z)
    push(bolt, ZONES.COCKPIT)
  }

  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged
}

/** One cutaway car. Cached; the owning component disposes. */
export function getAnatomyCarGeometry(): THREE.BufferGeometry {
  if (!cachedAnatomy) {
    const g = buildAnatomy()
    if (!g) throw new Error('anatomy car geometry merge failed')
    g.computeBoundingSphere()
    cachedAnatomy = g
  }
  return cachedAnatomy
}
