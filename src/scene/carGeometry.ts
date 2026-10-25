/* ============================================================
   Procedural F1 cars — no model files, two fidelities:

   · LO (diorama): ~300 tris, the extruded plan wedge + wings.
     Reads as a game piece from across the room.
   · HI (conversational zoom): ~3k tris — tapered nose, sidepods,
     halo with strut, two-element rear wing, wing endplates, rim
     discs, diffuser, airbox. Swapped in when the camera is close.

   Same outer bounding box and `aDark` convention for both, so
   the instanced shader's zone tests (brake light, DRS flap,
   stripe, cockpit, wheels) work unchanged:
     0 = livery body · 0.3 = rain light · 0.55 = cockpit/halo
     0.85 = rim face · 1 = rubber
   ============================================================ */

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function withDark(geo: THREE.BufferGeometry, dark: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const count = g.getAttribute('position').count
  const arr = new Float32Array(count).fill(dark)
  g.setAttribute('aDark', new THREE.BufferAttribute(arr, 1))
  // drop uv/uv1 so merge only has to reconcile position/normal/aDark
  g.deleteAttribute('uv')
  if (g.getAttribute('uv1')) g.deleteAttribute('uv1')
  return g
}

const PLAN_HALF: Array<[number, number]> = [
  [2.95, 0.02],
  [2.75, 0.14],
  [2.15, 0.20],
  [1.45, 0.26],
  [1.05, 0.55],
  [0.35, 0.72],
  [-0.75, 0.74],
  [-1.65, 0.60],
  [-2.35, 0.46],
  [-2.72, 0.42],
]

function bodyShape(geo: THREE.ExtrudeGeometryOptions): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(PLAN_HALF[0][0], PLAN_HALF[0][1])
  for (let i = 1; i < PLAN_HALF.length; i++) shape.lineTo(PLAN_HALF[i][0], PLAN_HALF[i][1])
  for (let i = PLAN_HALF.length - 1; i >= 0; i--) shape.lineTo(PLAN_HALF[i][0], -PLAN_HALF[i][1])
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, geo)
  g.rotateX(-Math.PI / 2)
  g.translate(0, 0.16, 0)
  return g
}

/** shared wheel placement (both fidelities) */
const WHEEL_POSITIONS: Array<[number, number, number]> = [
  [1.55, 0.34, 0.82],
  [1.55, 0.34, -0.82],
  [-1.75, 0.36, 0.84],
  [-1.75, 0.36, -0.84],
]

let cachedLo: THREE.BufferGeometry | null = null
let cachedHi: THREE.BufferGeometry | null = null
let cachedPawn: THREE.BufferGeometry | null = null

/* The pawn: what a car becomes at gallery distance — a turned
   model-kit token, lathe body on a smoke-dark disc, with a red
   brake flash at the tail. The signature move: cars morph into
   pawns as the camera pulls out and morph back as it leans in,
   so the diorama never fights pixel soup. */
function buildPawn(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []

  const foot = new THREE.CylinderGeometry(1.3, 1.5, 0.3, 12)
  foot.translate(0, 0.15, 0)
  parts.push(withDark(foot, 0.55))

  const profile = [
    new THREE.Vector2(1.02, 0.3),
    new THREE.Vector2(0.96, 0.78),
    new THREE.Vector2(0.72, 1.42),
    new THREE.Vector2(0.42, 2.08),
    new THREE.Vector2(0.2, 2.5),
    new THREE.Vector2(0.0, 2.66),
  ]
  const body = new THREE.LatheGeometry(profile, 12)
  parts.push(withDark(body, 0))

  const cap = new THREE.SphereGeometry(0.2, 8, 6)
  cap.translate(0, 2.6, 0)
  parts.push(withDark(cap, 0.55))

  // brake flash sits at the tail; the pawn shader lights the 0.3 zone
  const tail = new THREE.BoxGeometry(0.16, 0.2, 0.34)
  tail.translate(-0.98, 0.66, 0)
  parts.push(withDark(tail, 0.3))

  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged
}

export function getPawnGeometry(): THREE.BufferGeometry {
  if (!cachedPawn) {
    const g = buildPawn()
    if (!g) throw new Error('pawn geometry merge failed')
    g.computeBoundingSphere()
    cachedPawn = g
  }
  return cachedPawn
}


function buildLo(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []
  parts.push(withDark(bodyShape({ depth: 0.34, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 2 }), 0))

  const spine = new THREE.BoxGeometry(1.7, 0.3, 0.46)
  spine.translate(-0.55, 0.58, 0)
  parts.push(withDark(spine, 0))

  const cockpit = new THREE.BoxGeometry(0.62, 0.22, 0.5)
  cockpit.translate(0.55, 0.6, 0)
  parts.push(withDark(cockpit, 0.55))

  const frontWing = new THREE.BoxGeometry(0.55, 0.08, 1.95)
  frontWing.translate(2.62, 0.1, 0)
  parts.push(withDark(frontWing, 0))

  const rearPlate = new THREE.BoxGeometry(0.42, 0.07, 1.02)
  rearPlate.translate(-2.48, 0.82, 0)
  parts.push(withDark(rearPlate, 0))

  for (const z of [0.5, -0.5]) {
    const ep = new THREE.BoxGeometry(0.52, 0.38, 0.05)
    ep.translate(-2.48, 0.64, z)
    parts.push(withDark(ep, 0))
  }

  const rainLight = new THREE.BoxGeometry(0.12, 0.26, 0.14)
  rainLight.translate(-2.7, 0.3, 0)
  parts.push(withDark(rainLight, 0.3))

  for (const [x, y, z] of WHEEL_POSITIONS) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.36, 12)
    w.rotateX(Math.PI / 2)
    w.translate(x, y, z)
    parts.push(withDark(w, 1))
  }
  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged
}

function buildHi(): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = []

  // smoother body: same silhouette, finer bevel, taller floor to nose taper
  parts.push(withDark(bodyShape({ depth: 0.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 3 }), 0))

  // nose taper: a flattened cone from mid-chassis to the tip
  const nose = new THREE.CylinderGeometry(0.03, 0.26, 1.7, 6)
  nose.rotateZ(-Math.PI / 2)
  nose.scale(1, 0.75, 1)
  nose.translate(2.15, 0.3, 0)
  parts.push(withDark(nose, 0))

  // engine cover spine + airbox
  const spine = new THREE.BoxGeometry(1.9, 0.34, 0.44)
  spine.translate(-0.6, 0.58, 0)
  parts.push(withDark(spine, 0))
  const airbox = new THREE.BoxGeometry(0.34, 0.24, 0.3)
  airbox.translate(0.36, 0.72, 0)
  parts.push(withDark(airbox, 0))

  // sidepods
  for (const z of [0.62, -0.62]) {
    const pod = new THREE.BoxGeometry(1.9, 0.38, 0.42)
    pod.translate(-0.45, 0.3, z)
    parts.push(withDark(pod, 0))
    const barge = new THREE.BoxGeometry(0.06, 0.26, 0.36)
    barge.translate(0.62, 0.3, z)
    parts.push(withDark(barge, 0))
  }

  // halo: half torus + front strut, kept dark like the cockpit
  const halo = new THREE.TorusGeometry(0.33, 0.045, 6, 14, Math.PI)
  halo.rotateY(Math.PI / 2)
  halo.rotateX(-0.12)
  halo.translate(0.62, 0.8, 0)
  parts.push(withDark(halo, 0.55))
  const strut = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5)
  strut.translate(0.92, 0.74, 0)
  parts.push(withDark(strut, 0.55))

  // driver helmet hint
  const helmet = new THREE.SphereGeometry(0.15, 8, 6)
  helmet.translate(0.66, 0.78, 0)
  parts.push(withDark(helmet, 0))

  // front wing: plate + flaps + endplates
  const fw = new THREE.BoxGeometry(0.6, 0.05, 1.9)
  fw.translate(2.64, 0.1, 0)
  parts.push(withDark(fw, 0))
  const fwFlap = new THREE.BoxGeometry(0.3, 0.03, 1.86)
  fwFlap.translate(2.52, 0.17, 0)
  parts.push(withDark(fwFlap, 0))
  for (const z of [0.97, -0.97]) {
    const ep = new THREE.BoxGeometry(0.5, 0.16, 0.03)
    ep.translate(2.6, 0.1, z)
    parts.push(withDark(ep, 0))
  }

  // rear wing: main plane + DRS flap + swan-neck + endplates
  const rw = new THREE.BoxGeometry(0.4, 0.05, 1.02)
  rw.translate(-2.5, 0.86, 0)
  parts.push(withDark(rw, 0))
  const rwFlap = new THREE.BoxGeometry(0.26, 0.04, 1.0)
  rwFlap.translate(-2.32, 0.98, 0)
  parts.push(withDark(rwFlap, 0))
  for (const z of [0.51, -0.51]) {
    const ep = new THREE.BoxGeometry(0.56, 0.4, 0.035)
    ep.translate(-2.48, 0.68, z)
    parts.push(withDark(ep, 0))
  }
  for (const z of [0.22, -0.22]) {
    const neck = new THREE.BoxGeometry(0.05, 0.4, 0.05)
    neck.translate(-2.34, 0.66, z)
    parts.push(withDark(neck, 0))
  }

  // diffuser + rain light
  const diffuser = new THREE.BoxGeometry(0.5, 0.22, 0.9)
  diffuser.translate(-2.55, 0.14, 0)
  parts.push(withDark(diffuser, 0.55))
  const rainLight = new THREE.BoxGeometry(0.12, 0.26, 0.14)
  rainLight.translate(-2.76, 0.3, 0)
  parts.push(withDark(rainLight, 0.3))

  // wheels: rubber band with a livery alloy face
  for (const [x, y, z] of WHEEL_POSITIONS) {
    const w = new THREE.CylinderGeometry(0.34, 0.34, 0.36, 16)
    w.rotateX(Math.PI / 2)
    w.translate(x, y, z)
    parts.push(withDark(w, 1))
    const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.37, 8)
    rim.rotateX(Math.PI / 2)
    rim.translate(x, y, z)
    parts.push(withDark(rim, 0.85))
  }

  const merged = mergeGeometries(parts, false)
  for (const p of parts) p.dispose()
  return merged
}

export function getCarGeometry(hi = false): THREE.BufferGeometry {
  if (hi) {
    if (!cachedHi) {
      const g = buildHi()
      if (!g) throw new Error('car geometry (hi) merge failed')
      g.computeBoundingSphere()
      cachedHi = g
    }
    return cachedHi
  }
  if (!cachedLo) {
    const g = buildLo()
    if (!g) throw new Error('car geometry (lo) merge failed')
    g.computeBoundingSphere()
    cachedLo = g
  }
  return cachedLo
}
