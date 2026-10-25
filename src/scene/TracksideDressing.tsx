/* ============================================================
   Trackside dressing — the architectural-model layer. Everything
   here stands ON the paper like the base pieces of a gallery
   diorama, and everything measured from the road rides the same
   sceneRefs.widthGain channel the ribbon inflates on:

   · runoff skirt (the track sits IN terrain, sunk to the sheet):
     pale model-kit ground, an asphalt apron under fast sweepers,
     a red/white candy strip hugging the wall at heavy-braking
     corners, and a soft rim that dissolves into paper
   · a continuous low barrier wall both sides — its base is
     planted in the paper, no light-gap under it
   · molded kerb strips standing proud of the deck at corners,
     casting real shadows — no longer two flat painted lines
   · grandstand + pit building on the detected main straight,
     a second stand on the longest remaining straight, all
     grounded on the sheet and sliding outward as the road swells
   · the start/finish gantry (the one place a bridge is earned)
   · marshal posts at the sector gates whose flags actually fly
     the live flag state (amber sector yellow, red for a stoppage)
   · seeded pale tree groves, rejection-sampled off the racing line
   · ink-stroke rain streaks when the weather channel says wet

   No data fetches, no per-frame React state: frame-rate reads go
   through the store/clock/sceneRefs the same way LiveOps does.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TrackModel } from './trackBuilder'
import { PLINTH_TOP_Y } from './Plinth'
import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import { useShallow } from 'zustand/react/shallow'
import { sceneRefs } from './sceneRefs'
import { pitBayCount, pitBaysAt, PIT_ENV_SMOOTH, uniqueTeamColours } from './pitModel'

// deterministic RNG so a circuit is dressed identically every visit
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** world position `dist` meters off the centerline on `side`, at an
    absolute world-y; +yaw for +X-forward boxes */
function anchorPoint(model: TrackModel, idx: number, side: 1 | -1, dist: number, absY: number, into: THREE.Vector3) {
  const n = model.n
  const nx = model.points[((idx + 1) % n) * 3] - model.points[((idx - 1 + n) % n) * 3]
  const nz = model.points[((idx + 1) % n) * 3 + 2] - model.points[((idx - 1 + n) % n) * 3 + 2]
  const tangent = new THREE.Vector3(nx, 0, nz).normalize()
  const left = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize()
  into.set(
    model.points[idx * 3] + left.x * dist * side,
    absY,
    model.points[idx * 3 + 2] + left.z * dist * side,
  )
  return { heading: Math.atan2(-tangent.z, tangent.x) }
}

function orient(geo: THREE.BufferGeometry, n: number): THREE.BufferGeometry {
  const normals = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.computeBoundingSphere()
  return geo
}

/* Every road-coupled surface carries the same reconstruction set —
   centerline anchor aC, signed lateral aN (already ×side), fixed
   offset aBase, road-relative scale aRoad — so one vertex snippet
   inflates them all with the ribbon's shared uWidthGain: the road
   edge, its skirt, its walls and its kerbs can never drift apart. */
const GAIN_VERT = /* glsl */ `
  attribute vec3 aC;
  attribute vec3 aN;
  attribute float aBase;
  attribute float aRoad;
  uniform float uHalfWidth;
  uniform float uWidthGain;
`
const GAIN_APPLY = /* glsl */ `transformed.xz = aC.xz + aN.xz * (aBase + uHalfWidth * uWidthGain * aRoad);`

const fragNoise = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
`

/** per-corner runoff zoning: fast sweepers get tarmac aprons, heavy
    braking zones get candy strips; straight sections stay grass.
    Corner angle (radians of heading change) is the speed proxy. */
function buildZones(model: TrackModel): { zones: Float32Array; candy: Float32Array; kerb: Float32Array } {
  const n = model.n
  const zones = new Float32Array(n)
  const candy = new Float32Array(n)
  const kerb = new Float32Array(n)
  const M_PER_PT = model.length / n
  for (const c of model.corners) {
    const half = Math.min(240, Math.abs(c.angle) * 95 + 18)
    const reach = Math.ceil((half * 1.2) / M_PER_PT)
    const speed = 1 - Math.min(1, Math.abs(c.angle) / 2.1) // 1 flowing, ~0 rotating
    for (let k = -reach; k <= reach; k++) {
      const i = (((c.idx + k) % n) + n) % n
      const w = Math.max(0, 1 - Math.max(0, Math.abs(k) * M_PER_PT - half * 0.55) / (half * 0.6))
      if (w > kerb[i]) kerb[i] = Math.min(1, w)
      if (speed > 0.6 && w > zones[i]) zones[i] = Math.min(1, w)
      else if (speed < 0.38 && w > candy[i]) candy[i] = Math.min(1, w)
    }
  }
  return { zones, candy, kerb }
}

/** runoff skirt: two gain-coupled strips flanking the road, sunk to
    the paper. Vertices per point: [inner+, outer+, inner−, outer−] */
function skirtGeometry(
  model: TrackModel,
  zones: Float32Array,
  candy: Float32Array,
  ext: number,
  y: number,
): THREE.BufferGeometry {
  const n = model.n
  const hw = model.halfWidth
  const positions = new Float32Array(n * 4 * 3)
  const aC = new Float32Array(n * 4 * 3)
  const aN = new Float32Array(n * 4 * 3)
  const aBase = new Float32Array(n * 4)
  const aRoad = new Float32Array(n * 4)
  const aEt = new Float32Array(n * 4)
  const aZone = new Float32Array(n * 4)
  const aCandy = new Float32Array(n * 4)
  const aArc = new Float32Array(n * 4)
  const up = new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const nx = model.points[((i + 1) % n) * 3] - model.points[((i - 1 + n) % n) * 3]
    const nz = model.points[((i + 1) % n) * 3 + 2] - model.points[((i - 1 + n) % n) * 3 + 2]
    tangent.set(nx, 0, nz).normalize()
    normal.crossVectors(up, tangent).normalize()
    const px = model.points[i3]
    const pz = model.points[i3 + 2]
    // rows: inner(+), outer(+), inner(−), outer(−); the inner row tucks
    // 0.6 m under the deck so a widened road can never reveal the seam
    const rows: Array<[number, number, number, number]> = [
      [1, -0.6, 1, 0],
      [1, ext, 1, 1],
      [-1, -0.6, 1, 0],
      [-1, ext, 1, 1],
    ]
    for (let r = 0; r < 4; r++) {
      const v = i * 4 + r
      const [side, base, road, et] = rows[r]
      positions[v * 3] = px + normal.x * side * (hw + base)
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = pz + normal.z * side * (hw + base)
      aC[v * 3] = px
      aC[v * 3 + 1] = y
      aC[v * 3 + 2] = pz
      aN[v * 3] = normal.x * side
      aN[v * 3 + 1] = 0
      aN[v * 3 + 2] = normal.z * side
      aBase[v] = base
      aRoad[v] = road
      aEt[v] = et
      aZone[v] = zones[i]
      aCandy[v] = candy[i]
      aArc[v] = model.cumDist[i]
    }
  }
  // two independent strips — no quad bridging under the road
  const indices = new Uint32Array(n * 12)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    let o = i * 12
    for (const [r0, r1] of [[0, 1], [2, 3]] as const) {
      const a = i * 4 + r0
      const b = i * 4 + r1
      const c = j * 4 + r0
      const d = j * 4 + r1
      indices[o++] = a
      indices[o++] = b
      indices[o++] = c
      indices[o++] = b
      indices[o++] = d
      indices[o++] = c
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  orient(g, n * 4)
  g.setAttribute('aC', new THREE.BufferAttribute(aC, 3))
  g.setAttribute('aN', new THREE.BufferAttribute(aN, 3))
  g.setAttribute('aBase', new THREE.BufferAttribute(aBase, 1))
  g.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1))
  g.setAttribute('aEt', new THREE.BufferAttribute(aEt, 1))
  g.setAttribute('aZone', new THREE.BufferAttribute(aZone, 1))
  g.setAttribute('aCandy', new THREE.BufferAttribute(aCandy, 1))
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1))
  return g
}

/** vertical wall strip along one side — base PLANTED in the paper
    (no light-gap under it), top at track height + h, xz riding the
    shared widthGain channel with the ribbon */
function wallGeometry(model: TrackModel, side: 1 | -1, off: number, h: number): THREE.BufferGeometry {
  const n = model.n
  const hw = model.halfWidth
  const positions = new Float32Array(n * 2 * 3)
  const normals = new Float32Array(n * 2 * 3)
  const aC = new Float32Array(n * 2 * 3)
  const aN = new Float32Array(n * 2 * 3)
  const aBase = new Float32Array(n * 2)
  const aRoad = new Float32Array(n * 2)
  const up = new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const nx = model.points[((i + 1) % n) * 3] - model.points[((i - 1 + n) % n) * 3]
    const nz = model.points[((i + 1) % n) * 3 + 2] - model.points[((i - 1 + n) % n) * 3 + 2]
    tangent.set(nx, 0, nz).normalize()
    normal.crossVectors(up, tangent).normalize().multiplyScalar(side)
    const px = model.points[i3]
    const pz = model.points[i3 + 2]
    const y0 = model.points[i3 + 1]
    positions[i * 6 + 0] = px + normal.x * (hw + off)
    positions[i * 6 + 1] = y0 + h + 0.05
    positions[i * 6 + 2] = pz + normal.z * (hw + off)
    positions[i * 6 + 3] = px + normal.x * (hw + off)
    positions[i * 6 + 4] = PLINTH_TOP_Y + 0.02
    positions[i * 6 + 5] = pz + normal.z * (hw + off)
    for (const q of [0, 3]) {
      normals[i * 6 + q] = normal.x
      normals[i * 6 + q + 1] = 0
      normals[i * 6 + q + 2] = normal.z
    }
    for (const v of [i * 2, i * 2 + 1]) {
      aC[v * 3] = px
      aC[v * 3 + 1] = 0
      aC[v * 3 + 2] = pz
      aN[v * 3] = normal.x
      aN[v * 3 + 1] = 0
      aN[v * 3 + 2] = normal.z
      aBase[v] = off
      aRoad[v] = 1
    }
  }
  const indices = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = i * 2 + 1
    const c = ((i + 1) % n) * 2
    const d = ((i + 1) % n) * 2 + 1
    indices[i * 6 + 0] = a
    indices[i * 6 + 1] = b
    indices[i * 6 + 2] = c
    indices[i * 6 + 3] = b
    indices[i * 6 + 4] = d
    indices[i * 6 + 5] = c
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  g.setAttribute('aC', new THREE.BufferAttribute(aC, 3))
  g.setAttribute('aN', new THREE.BufferAttribute(aN, 3))
  g.setAttribute('aBase', new THREE.BufferAttribute(aBase, 1))
  g.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1))
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  g.computeBoundingSphere()
  return g
}

/** molded kerb strips: a raised band standing 16 cm proud of the
    deck through the corners, red/white alternating along the arc.
    Non-corner points collapse to zero width, so one mesh covers
    the whole circuit and nothing paints where no kerb exists */
function kerbGeometry(model: TrackModel, kerb: Float32Array): THREE.BufferGeometry {
  const n = model.n
  const hw = model.halfWidth
  const positions = new Float32Array(n * 4 * 3)
  const aC = new Float32Array(n * 4 * 3)
  const aN = new Float32Array(n * 4 * 3)
  const aRoad = new Float32Array(n * 4)
  const aEt = new Float32Array(n * 4)
  const aArc = new Float32Array(n * 4)
  const up = new THREE.Vector3(0, 1, 0)
  const tangent = new THREE.Vector3()
  const normal = new THREE.Vector3()
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    const nx = model.points[((i + 1) % n) * 3] - model.points[((i - 1 + n) % n) * 3]
    const nz = model.points[((i + 1) % n) * 3 + 2] - model.points[((i - 1 + n) % n) * 3 + 2]
    tangent.set(nx, 0, nz).normalize()
    normal.crossVectors(up, tangent).normalize()
    const px = model.points[i3]
    const pz = model.points[i3 + 2]
    const k = kerb[i]
    const y = model.points[i3 + 1] + 0.05 + 0.16 * k
    // rows: inner(+), outer(+), inner(−), outer(−) at 78–94 % of deck
    // half-width; without corner weight both rows sit at 1.0 → no area
    const rows: Array<[number, number, number]> = [
      [1, 0.78 + (1 - k) * 0.22, 0],
      [1, 0.94 + (1 - k) * 0.06, 1],
      [-1, 0.78 + (1 - k) * 0.22, 0],
      [-1, 0.94 + (1 - k) * 0.06, 1],
    ]
    for (let r = 0; r < 4; r++) {
      const v = i * 4 + r
      const [side, road, et] = rows[r]
      positions[v * 3] = px + normal.x * side * hw * road
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = pz + normal.z * side * hw * road
      aC[v * 3] = px
      aC[v * 3 + 1] = y
      aC[v * 3 + 2] = pz
      aN[v * 3] = normal.x * side
      aN[v * 3 + 1] = 0
      aN[v * 3 + 2] = normal.z * side
      aRoad[v] = road
      aEt[v] = et
      aArc[v] = model.cumDist[i]
    }
  }
  const indices = new Uint32Array(n * 12)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    let o = i * 12
    for (const [r0, r1] of [[0, 1], [2, 3]] as const) {
      const a = i * 4 + r0
      const b = i * 4 + r1
      const c = j * 4 + r0
      const d = j * 4 + r1
      indices[o++] = a
      indices[o++] = b
      indices[o++] = c
      indices[o++] = b
      indices[o++] = d
      indices[o++] = c
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex(new THREE.BufferAttribute(indices, 1))
  orient(g, n * 4)
  g.setAttribute('aC', new THREE.BufferAttribute(aC, 3))
  g.setAttribute('aN', new THREE.BufferAttribute(aN, 3))
  g.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1))
  g.setAttribute('aEt', new THREE.BufferAttribute(aEt, 1))
  g.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1))
  return g
}

/** terraced grandstand: six steps climbing away from the track, each step
    standing full-height to its own tier so the union reads as a solid
    wedge of seating, plus a low front barrier at the pit-wall. One merged
    mesh per stand, so a whole terrace costs a single draw call. */
function rakeGeometry(len: number, depth: number, h: number, tiers = 6): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const plinthH = h * 0.16
  const plinthD = Math.min(depth * 0.34, 5)
  const seatH = h - plinthH
  const rowRise = seatH / tiers
  const tierD = (depth - plinthD) / tiers
  const plinth = new THREE.BoxGeometry(len, plinthH, plinthD)
  plinth.translate(0, plinthH / 2, -plinthD / 2)
  parts.push(plinth)
  for (let i = 0; i < tiers; i++) {
    const hh = plinthH + (i + 1) * rowRise
    const t = new THREE.BoxGeometry(len, hh, tierD)
    t.translate(0, hh / 2, -(plinthD + (i + 0.5) * tierD))
    parts.push(t)
  }
  // low barrier on the track side
  const barrier = new THREE.BoxGeometry(len, 1.05, 0.35)
  barrier.translate(0, plinthH + 0.52, 0.18)
  parts.push(barrier)
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged ?? new THREE.BoxGeometry(len, h, depth)
}

interface Block {
  len: number
  depth: number
  h: number
  pos: THREE.Vector3
  heading: number
  /** road-coupling anchor: re-placed each frame at dist + widthShift */
  idx: number
  side: 1 | -1
  dist: number
  /** terraced seating mesh; absent on the low pit buildings */
  rake?: THREE.BufferGeometry
}

/** straights = gaps between consecutive detected corners, longest first */
function findStraights(model: TrackModel): Array<{ idx: number; len: number }> {
  const corners = model.corners
  if (corners.length < 2) return [{ idx: 0, len: model.length }]
  const mPerPt = model.length / model.n
  const out: Array<{ idx: number; len: number }> = []
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k].idx
    const b = corners[(k + 1) % corners.length].idx
    const pts = (((b - a) % model.n) + model.n) % model.n
    out.push({ idx: (a + Math.floor(pts / 2)) % model.n, len: pts * mPerPt })
  }
  return out.sort((p, q) => q.len - p.len)
}

/** lateral unit vector of the centerline at `idx` (in the xz plane) */
function lateralAt(model: TrackModel, idx: number, out: THREE.Vector3): THREE.Vector3 {
  const n = model.n
  const pa = (((idx - 1 + n) % n) + n) % n
  const pb = (((idx + 1) % n) + n) % n
  out.set(model.points[pb * 3] - model.points[pa * 3], 0, model.points[pb * 3 + 2] - model.points[pa * 3 + 2])
  return out.normalize().cross(new THREE.Vector3(0, 1, 0)).normalize()
}

/* ---- the pit lane --------------------------------------------------
   A service road is not a road-coupled *loop* — it is a straight
   segment with two ends. It therefore cannot ride the centreline
   channel the ribbon/skirt use: that channel rebuilds x/z from the
   centerline normal at the SAME index, which would drag every vertex
   of a strip that leaves the centreline to a different place as the
   road swells.

   Instead the pit strip stores, per vertex, its own centreline anchor
   (aC) and the signed lateral it was built at (aN·aBase). aC is
   re-read from the model each frame, so when the ribbon widens the
   whole lane translates rigidly outward with it — no shear, and it
   can never end up standing inside the road. The uniforms are shared
   with the skirt so both move in exact lockstep.
   ---------------------------------------------------------------- */
interface PitBoxRef {
  /** index into model.points where the box front edge sits */
  idx: number
  side: 1 | -1
  /** distance from the centreline to the box front, at widthGain=1 */
  dist: number
  /** the box's own slot along the lane, in metres from the lane start */
  slot: number
  /** resolved world position at widthGain=1 (re-anchored per frame) */
  pos: THREE.Vector3
  /** yaw that aligns the box row with the lane */
  heading: number
}

/** build the pit complex for the longest straight: the service lane
    itself (a flat dark strip), plus one garage bay per field entry */
/** build the pit complex for the longest straight: the service lane
    itself (a parallel service road on side 1 with chicane entry/exit),
    plus garage bays lining the outer edge and pit perches on the inner edge */
export function buildPitComplex(model: TrackModel, bayCount: number) {
  const straights = findStraights(model)
  const s = straights.length > 0 ? straights[0] : { idx: 0, len: Math.min(model.length * 0.3, 400) }
  const n = model.n
  const mPerPt = model.length / n
  const laneIdx = s.idx

  // Pit lane service road runs on side 1:
  // inner edge at model.halfWidth + 10.5
  // outer edge at model.halfWidth + 10.5 + 8.4 = model.halfWidth + 18.9
  const LANE_WIDTH = 8.4
  const innerBase = 10.5
  const outerBase = innerBase + LANE_WIDTH
  const laneDist = model.halfWidth + (innerBase + outerBase) / 2

  const teams = Math.max(6, Math.min(12, bayCount))
  const boxSpacing = 12 // metres of lane frontage per box
  const boxW = boxSpacing - 1.6
  const run = (teams - 1) * boxSpacing
  const startIdx = (((laneIdx - Math.round(run / mPerPt / 2)) % n) + n) % n

  // Garages line the outer edge of the service road (depth 8.5m, centered at outerBase + 4.25)
  const garageDist = model.halfWidth + outerBase + 4.25
  const boxes: PitBoxRef[] = []
  const tmp = new THREE.Vector3()
  for (let i = 0; i < teams; i++) {
    const idx = (startIdx + Math.round((i * boxSpacing) / mPerPt)) % n
    const a = anchorPoint(model, idx, 1, garageDist, PAPER_Y, tmp)
    boxes.push({ idx, side: 1, dist: garageDist, slot: i * boxSpacing, pos: tmp.clone(), heading: a.heading })
  }

  // Pit wall command stands sit on the inner verge (between track edge and pit lane)
  const pitWallDist = model.halfWidth + 5.2
  const pitWall: Array<{ idx: number; side: 1; dist: number; pos: THREE.Vector3; heading: number }> = []
  for (let i = 0; i < teams; i += 2) {
    const idx = (startIdx + Math.round((i * boxSpacing) / mPerPt)) % n
    const a = anchorPoint(model, idx, 1, pitWallDist, PAPER_Y, tmp)
    pitWall.push({ idx, side: 1, dist: pitWallDist, pos: tmp.clone(), heading: a.heading })
  }

  // Lane strip geometry with smooth chicane tapers at entry and exit
  const entrySteps = Math.max(3, Math.round((boxSpacing * 1.8) / mPerPt))
  const exitSteps = Math.max(3, Math.round((boxSpacing * 2.2) / mPerPt))
  const stripFrom = (((startIdx - Math.round((boxSpacing * 1.8) / mPerPt)) % n) + n) % n
  const stripTo = (startIdx + Math.round((run + boxSpacing * 2.2) / mPerPt)) % n
  const steps = (stripTo - stripFrom + n) % n

  const lanePositions: number[] = []
  const laneAnchors: number[] = []
  const laneNormals: number[] = []
  const laneBase: number[] = []
  const laneRoad: number[] = []
  const lat = new THREE.Vector3()
  const centre = new THREE.Vector3()

  for (let k = 0; k <= steps; k++) {
    const idx = (stripFrom + k) % n
    lateralAt(model, idx, lat)
    centre.set(model.points[idx * 3], 0, model.points[idx * 3 + 2])

    // Smoothstep chicane taper from track edge (0) to lane offset
    let taper = 1
    if (k < entrySteps) {
      const u = k / entrySteps
      taper = u * u * (3 - 2 * u)
    } else if (k > steps - exitSteps) {
      const u = (steps - k) / exitSteps
      taper = u * u * (3 - 2 * u)
    }

    const curInner = innerBase * taper
    const curOuter = (curInner + LANE_WIDTH * taper)

    // Inner edge (vertex 2*k)
    lanePositions.push(
      centre.x + lat.x * (model.halfWidth + curInner),
      PAPER_Y + 0.02,
      centre.z + lat.z * (model.halfWidth + curInner),
    )
    laneAnchors.push(centre.x, 0, centre.z)
    laneNormals.push(lat.x, 0, lat.z)
    laneBase.push(curInner)
    laneRoad.push(1)

    // Outer edge (vertex 2*k + 1)
    lanePositions.push(
      centre.x + lat.x * (model.halfWidth + curOuter),
      PAPER_Y + 0.02,
      centre.z + lat.z * (model.halfWidth + curOuter),
    )
    laneAnchors.push(centre.x, 0, centre.z)
    laneNormals.push(lat.x, 0, lat.z)
    laneBase.push(curOuter)
    laneRoad.push(1)
  }

  const laneIndices: number[] = []
  for (let k = 0; k < steps; k++) {
    const a = k * 2
    const b = k * 2 + 1
    const c = (k + 1) * 2
    const d = (k + 1) * 2 + 1
    laneIndices.push(a, c, b, b, c, d)
  }

  return {
    lanePositions: new Float32Array(lanePositions),
    laneAnchors: new Float32Array(laneAnchors),
    laneNormals: new Float32Array(laneNormals),
    laneBase: new Float32Array(laneBase),
    laneRoad: new Float32Array(laneRoad),
    laneIndices: new Uint16Array(laneIndices),
    laneDist,
    boxes,
    pitWall,
    teams,
    boxW,
  }
}

const RAIN_COUNT = 420
const rainVert = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  varying float vSeed;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // fall cycles through a 55 m column above the diorama
    wp.y += 30.0 - mod(uTime * 9.0 + aSeed * 55.0, 55.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    vSeed = aSeed;
  }
`
const rainFrag = /* glsl */ `
  uniform float uWet;
  varying float vSeed;
  void main() {
    float a = uWet * (0.16 + 0.14 * vSeed);
    if (a < 0.004) discard;
    gl_FragColor = vec4(0.28, 0.34, 0.42, a);
  }
`

const PAPER_Y = PLINTH_TOP_Y + 0.05

/* ---- gain-patched materials: skirt, wall, kerb ----------------
   Same vertex snippet rebuilds x/z from the centerline, so these
   surfaces inflate exactly as much as the ribbon does. ---------- */
function makeSkirtMaterial(hw: number): THREE.MeshStandardMaterial {
  const u = {
    uHalfWidth: { value: hw },
    uWidthGain: sceneRefs.widthGain,
    uPaper: { value: new THREE.Color('#f0f2ee') },
    uAsphalt: { value: new THREE.Color('#e4e7ec') },
    uGrass: { value: new THREE.Color('#e6eae0') },
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#f0f2ee', roughness: 0.98, metalness: 0, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GAIN_VERT}
          attribute float aEt;
          attribute float aZone;
          attribute float aCandy;
          attribute float aArc;
          varying float vEt;
          varying float vZone;
          varying float vCandy;
          varying float vArc;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${GAIN_APPLY}
          vEt = aEt;
          vZone = aZone;
          vCandy = aCandy;
          vArc = aArc;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
          uniform vec3 uPaper;
          uniform vec3 uAsphalt;
          uniform vec3 uGrass;
          varying float vEt;
          varying float vZone;
          varying float vCandy;
          varying float vArc;
          ${fragNoise}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
          // terrain zoning: tarmac apron under fast sweepers fading to
          // grass, plain grass everywhere else
          float grassF = 1.0 - vZone * (1.0 - smoothstep(0.45, 0.68, vEt));
          vec3 col = mix(uAsphalt, uGrass, grassF);
          // faint shade line where the skirt meets the deck shadow
          col *= 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.16, vEt));
          // candy stripes hug the wall foot at heavy-braking corners
          float band = (1.0 - smoothstep(0.025, 0.10, vEt)) * vCandy;
          float stripe = step(0.5, mod(floor(vArc / 4.5), 2.0));
          col = mix(col, mix(vec3(0.77, 0.27, 0.23), vec3(0.88, 0.90, 0.93), stripe), band);
          // model-kit grain, then dissolve the outer rim into bare paper
          float gn = hash21(vec2(floor(vArc / 2.0), floor(vEt * 30.0)));
          col *= 0.95 + 0.09 * gn;
          col = mix(col, uPaper, smoothstep(0.82, 1.0, vEt));
          diffuseColor = vec4(col, 1.0);`,
      )
    mat.customProgramCacheKey = () => 'apex-skirt'
  }
  return mat
}

function makeWallMaterial(hw: number): THREE.MeshStandardMaterial {
  const u = { uHalfWidth: { value: hw }, uWidthGain: sceneRefs.widthGain }
  const mat = new THREE.MeshStandardMaterial({ color: '#eef1f5', roughness: 0.85, metalness: 0.02 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GAIN_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GAIN_APPLY}`)
    mat.customProgramCacheKey = () => 'apex-wall'
  }
  return mat
}

/* ---- pit-lane material -------------------------------------------
   The lane is a segment, not a loop, so it carries its own baked
   anchor + signed lateral per vertex. It injects the SAME gain
   coupling as the skirt/wall/kerb ribbon (GAIN_VERT / GAIN_APPLY),
   so a widened road pushes the lane further clear instead of the
   road swallowing it — the lane can never drift from the deck.
   ---------------------------------------------------------------- */
function makePitLaneMaterial(hw: number): THREE.Material {
  const u = { uHalfWidth: { value: hw }, uWidthGain: sceneRefs.widthGain }
  // DoubleSide: the lane is a flat floor read from ~35° above, and a floor
  // must never disappear because one strip segment wound the wrong way
  const mat = new THREE.MeshStandardMaterial({ color: '#3c4654', roughness: 0.72, metalness: 0.05, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GAIN_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GAIN_APPLY}`)
    mat.customProgramCacheKey = () => 'apex-pitlane'
  }
  return mat
}

function makeKerbMaterial(hw: number): THREE.MeshStandardMaterial {
  const u = {
    uHalfWidth: { value: hw },
    uWidthGain: sceneRefs.widthGain,
    uKerbRed: { value: new THREE.Color('#c4453a') },
  }
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GAIN_VERT}
          attribute float aEt;
          attribute float aArc;
          varying float vEt;
          varying float vArc;`,
      )
      // aBase is absent on kerb strips: the disabled vertex attribute
      // reads as 0 by spec — the band is purely road-relative
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${GAIN_APPLY}
          vEt = aEt;
          vArc = aArc;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
          uniform vec3 uKerbRed;
          varying float vEt;
          varying float vArc;
          ${fragNoise}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
          float stripe = step(0.5, mod(floor((vArc + 3.0) / 6.0), 2.0));
          vec3 col = mix(vec3(0.88, 0.90, 0.93), uKerbRed, stripe);
          col *= 0.94 + 0.11 * hash21(vec2(floor(vArc * 1.7), floor(vEt * 6.0)));
          col *= 1.0 - 0.12 * smoothstep(0.55, 1.0, vEt);
          diffuseColor = vec4(col, 1.0);`,
      )
    mat.customProgramCacheKey = () => 'apex-kerb'
  }
  return mat
}


export function TracksideDressing({ model }: { model: TrackModel }) {
  // --- the pit row's team order --------------------------------------
  // Bay = Nth unique team in championship order, so a stop in the real
  // lights exactly that bay and never invents a colour not on the grid.
  // zustand selector: identity is stable while the list is unchanged.
  // The envelope and the mapping itself live in pitModel.ts, shared
  // verbatim with scripts/probe-pit-bays.ts.
  // shallow-compare: uniqueTeamColours returns a fresh array each render,
  // which zustand v5 would read as a new snapshot every time (React's
  // "getSnapshot should be cached" infinite-loop crash) without this
  const teamColours = useAppStore(useShallow((s) => uniqueTeamColours(s.session?.drivers ?? [])))
  const fasciaMats = useMemo(
    () =>
      teamColours.map(
        (c) =>
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(c ? (c.startsWith('#') ? c : `#${c}`) : '#eef1f5'),
            roughness: 0.55,
            metalness: 0.05,
          }),
      ),
    [teamColours],
  )
  useEffect(() => () => fasciaMats.forEach((m) => m.dispose()), [fasciaMats])

  // --- live pit-box glow -------------------------------------------------
  const bayGlow = useRef<number[]>([])
  // ONE number, from pitModel: the bay materials, the garage geometry
  // and the probe all read it, so box count and material count can
  // never disagree (a box with an undefined material renders as a
  // magenta wireframe — a visible, avoidable bug)
  const bayCount = pitBayCount(teamColours.length)
  const bayLightMats = useMemo(
    () =>
      Array.from({ length: bayCount }, () => {
        const m = new THREE.MeshStandardMaterial({
          color: '#aeb6c2',
          roughness: 0.5,
          metalness: 0.1,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0,
        })
        m.customProgramCacheKey = () => 'apex-baylight'
        return m
      }),
    [bayCount],
  )
  useEffect(() => () => bayLightMats.forEach((m) => m.dispose()), [bayLightMats])
  // fascia copy: warmed team colour at rest, bright and hot when its bay stops
  const bayFasciaMats = useMemo(
    () =>
      Array.from({ length: bayCount }, (_, i) => {
        const c = fasciaMats[i]
        const m = new THREE.MeshStandardMaterial({
          color: c ? c.color.clone() : new THREE.Color(0xffffff),
          roughness: 0.45,
          metalness: 0.1,
        })
        m.customProgramCacheKey = () => 'apex-bayfascia'
        return m
      }),
    [bayCount, fasciaMats],
  )
  useEffect(() => () => bayFasciaMats.forEach((m) => m.dispose()), [bayFasciaMats])

  const props = useMemo(() => {
    const disposables: Array<{ dispose(): void }> = []
    const track = <T extends { dispose(): void }>(o: T): T => (disposables.push(o), o)

    const { zones, candy, kerb } = buildZones(model)

    // --- runoff skirt, barrier walls, molded kerbs ---
    const skirt = track(skirtGeometry(model, zones, candy, 17, PLINTH_TOP_Y + 0.02))
    const skirtMat = track(makeSkirtMaterial(model.halfWidth))
    const wallL = track(wallGeometry(model, 1, 1.6, 0.55))
    const wallR = track(wallGeometry(model, -1, 1.6, 0.55))
    const wallMat = track(makeWallMaterial(model.halfWidth))
    const kerbGeo = track(kerbGeometry(model, kerb))
    const kerbMat = track(makeKerbMaterial(model.halfWidth))

    // --- the pit complex: a road-coupled service strip + garage bays.
    //     Built before the buildings because it claims the inner edge
    //     of the main straight, where the old flat pit box used to sit
    const pit = buildPitComplex(model, bayCount)
    const pitGeo = track((() => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pit.lanePositions, 3))
      g.setAttribute('aC', new THREE.BufferAttribute(pit.laneAnchors, 3))
      g.setAttribute('aN', new THREE.BufferAttribute(pit.laneNormals, 3))
      g.setAttribute('aBase', new THREE.BufferAttribute(pit.laneBase, 1))
      g.setAttribute('aRoad', new THREE.BufferAttribute(pit.laneRoad, 1))
      g.setIndex(new THREE.BufferAttribute(pit.laneIndices, 1))
      orient(g, pit.lanePositions.length / 3)
      g.computeBoundingSphere()
      return g
    })())
    const pitMat = track(makePitLaneMaterial(model.halfWidth))

    // --- buildings on the two longest straights: grounded on the
    //     sheet, anchored to the road so they slide out as it swells ---
    const straights = findStraights(model)
    const blocks: Block[] = []
    const tmp = new THREE.Vector3()
    if (straights.length > 0) {
      const s = straights[0]
      const gLen = Math.min(s.len * 0.62, model.radius * 0.55, 340)
      const gs = anchorPoint(model, s.idx, -1, model.halfWidth + 24, PAPER_Y, tmp)
      blocks.push({
        len: gLen,
        depth: 16,
        h: 9.5,
        pos: tmp.clone(),
        heading: gs.heading + Math.PI,
        idx: s.idx,
        side: -1,
        dist: model.halfWidth + 24,
        rake: track(rakeGeometry(gLen, 16, 9.5)),
      })
    }
    if (straights.length > 1) {
      const s = straights[1]
      const gLen = Math.min(s.len * 0.5, 220)
      const gs = anchorPoint(model, s.idx, 1, model.halfWidth + 24, PAPER_Y, tmp)
      blocks.push({ len: gLen, depth: 14, h: 7.5, pos: tmp.clone(), heading: gs.heading, idx: s.idx, side: 1, dist: model.halfWidth + 24, rake: track(rakeGeometry(gLen, 14, 7.5)) })
    }

    // --- start/finish gantry posts at arc param 0 ---
    const idx0 = model.indexOfParam(0)
    const gantry: Block[] = []
    for (const side of [1, -1] as const) {
      const p = anchorPoint(model, idx0, side, model.halfWidth + 2.6, PAPER_Y, tmp)
      gantry.push({ len: 0.9, depth: 0.9, h: 5.6, pos: tmp.clone(), heading: p.heading, idx: idx0, side, dist: model.halfWidth + 2.6 })
    }
    const lintel =
      gantry.length === 2
        ? {
            pos: gantry[0].pos.clone().add(gantry[1].pos).multiplyScalar(0.5).setY(PAPER_Y + 5.6 - 0.35),
            heading: gantry[0].heading,
          }
        : null
    const lintelSpan = model.halfWidth * 2 + 8.5

    // --- trees ---
    const rng = mulberry32(Math.round(model.length) * 7919 + model.n)
    const [minX, maxX, minZ, maxZ] = model.bounds
    const treePos: Array<{ x: number; z: number; s: number; r: number }> = []
    let tries = 0
    while (treePos.length < 130 && tries < 2600) {
      tries++
      const x = minX + rng() * (maxX - minX)
      const z = minZ + rng() * (maxZ - minZ)
      if (Number.isFinite(model.paramOf(x, z, 26))) continue // near the racing line
      if (blocks.some((b) => Math.hypot(b.pos.x - x, b.pos.z - z) < 42)) continue
      treePos.push({ x, z, s: 0.7 + rng() * 1.1, r: rng() * Math.PI * 2 })
    }
    const treeGeo = (() => {
      const trunk = new THREE.CylinderGeometry(0.42, 0.6, 4.4, 6)
      trunk.translate(0, 2.2, 0)
      const canopy = new THREE.ConeGeometry(3.1, 8.6, 7)
      canopy.translate(0, 8.2, 0)
      const merged = mergeGeometries([trunk, canopy])
      trunk.dispose()
      canopy.dispose()
      return track(merged ?? new THREE.BufferGeometry())
    })()
    const treeMat = track(new THREE.MeshStandardMaterial({ color: '#e4e8e2', roughness: 1, metalness: 0 }))

    // --- rain ---
    const rainGeo = track(new THREE.PlaneGeometry(0.32, 6.5))
    const rainMat = track(
      new THREE.ShaderMaterial({
        vertexShader: rainVert,
        fragmentShader: rainFrag,
        uniforms: { uTime: { value: 0 }, uWet: sceneRefs.wet },
        transparent: true,
        depthWrite: false,
      }),
    )
    const rainMesh = track(new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT))
    rainMesh.frustumCulled = false
    rainMesh.visible = false
    {
      const seed = new Float32Array(RAIN_COUNT)
      const d = new THREE.Object3D()
      for (let i = 0; i < RAIN_COUNT; i++) {
        seed[i] = rng()
        d.position.set(
          model.center[0] + (rng() * 2 - 1) * model.radius * 1.5,
          0,
          model.center[2] + (rng() * 2 - 1) * model.radius * 1.5,
        )
        d.scale.setScalar(1)
        d.updateMatrix()
        rainMesh.setMatrixAt(i, d.matrix)
      }
      rainMesh.instanceMatrix.needsUpdate = true
      rainGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1))
    }

    return {
      skirt,
      skirtMat,
      wallL,
      wallR,
      wallMat,
      kerbGeo,
      kerbMat,
      pit,
      pitGeo,
      pitMat,
      blocks,
      gantry,
      lintel,
      lintelSpan,
      treeGeo,
      treeMat,
      treePos,
      rainMesh,
      rainMat,
      disposables,
    }
  }, [model, bayCount])

  useEffect(() => {
    const { disposables } = props
    return () => void disposables.forEach((d) => d.dispose())
  }, [props])

  // marshal posts at the sector gates; flags fly the live state
  const flagMats = useMemo(
    () => [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: '#f4f6f9', roughness: 0.8 })),
    [],
  )
  useEffect(() => () => void flagMats.forEach((m) => m.dispose()), [flagMats])
  const flagSlots = useMemo(() => {
    const out: Array<{ pos: THREE.Vector3; idx: number; side: 1 | -1; dist: number }> = []
    const tmp = new THREE.Vector3()
    for (let s = 0; s < 3; s++) {
      const idx = model.indexOfParam(model.sectorParam[s] === 0 ? 0.996 : model.sectorParam[s])
      const side = (s % 2 === 0 ? 1 : -1) as 1 | -1
      const dist = model.halfWidth + 4.4
      anchorPoint(model, idx, side, dist, PAPER_Y, tmp)
      out.push({ pos: tmp.clone(), idx, side, dist })
    }
    return out
  }, [model])

  const blockRefs = useRef<Array<THREE.Group | null>>([])
  const gantryRefs = useRef<Array<THREE.Group | null>>([])
  const flagRefs = useRef<Array<THREE.Group | null>>([])
  const lintelRef = useRef<THREE.Mesh>(null)
  // pit boxes; garage side; the second bay of a lit box
  const bayRefs = useRef<Array<THREE.Group | null>>([])
  const pitWallRefs = useRef<Array<THREE.Group | null>>([])
  const anchorTmp = useMemo(() => new THREE.Vector3(), [])
  const pulse = useRef<[number, number, number]>([0, 0, 0])

  const bandCol = useMemo(() => new THREE.Color(0xfff3e0), [])
  const hotCol = useMemo(() => new THREE.Color(0xffffff), [])
  useFrame((state, delta) => {
    // road-coupled re-anchoring: gantry, marshals and pit slide outward
    // exactly as far as the widened deck reaches, so nothing ends up
    // standing in the middle of the road at macro zoom
    const shift = (sceneRefs.widthGain.value - 1) * model.halfWidth
    props.blocks.forEach((b, i) => {
      const el = blockRefs.current[i]
      if (el) {
        anchorPoint(model, b.idx, b.side, b.dist + shift, PAPER_Y, anchorTmp)
        el.position.copy(anchorTmp)
      }
    })
    props.gantry.forEach((b, i) => {
      const el = gantryRefs.current[i]
      if (el) {
        anchorPoint(model, b.idx, b.side, b.dist + shift, PAPER_Y, anchorTmp)
        el.position.copy(anchorTmp)
      }
    })
    // ---- live bay glow: which team is stopped RIGHT NOW ----
    // the mapping + envelope live in pitModel so this frame and the
    // probe run the exact same code, never two copies
    const { session: ses } = useAppStore.getState()
    const glowArr = bayGlow.current
    if (glowArr.length !== bayCount) glowArr.length = bayCount
    if (ses) {
      const lit = pitBaysAt(raceClock.t, ses.pits, ses.drivers, teamColours, bayCount)
      for (let i = 0; i < bayCount; i++) glowArr[i] = lit[i]
    } else {
      glowArr.fill(0)
    }
    for (let i = 0; i < bayCount; i++) {
      // smooth toward the target so the light never snaps on/off
      const cur = bayLightMats[i].emissiveIntensity
      const lit = cur + (glowArr[i] - cur) * Math.min(1, delta * PIT_ENV_SMOOTH)
      const light = bayLightMats[i]
      light.emissiveIntensity = lit
      light.emissive.copy(lit < 0.5 ? bandCol.clone().lerp(hotCol, lit * 2) : hotCol)
      const f = bayFasciaMats[i]
      if (f) {
        f.emissive.copy(f.color).multiplyScalar(lit * 0.85)
      }
    }

    // pit lane rides the gain surface in the vertex shader (attribute
    // per lane vertex); the garage boxes and pit wall are rigid, so slide them by the
    // same delta the shader applies — keeps them outside the deck edge
    props.pit.boxes.forEach((b, i) => {
      const el = bayRefs.current[i]
      if (!el) return
      anchorPoint(model, b.idx, b.side, b.dist + shift, PAPER_Y, anchorTmp)
      el.position.copy(anchorTmp)
    })

    props.pit.pitWall.forEach((p, i) => {
      const el = pitWallRefs.current[i]
      if (!el) return
      anchorPoint(model, p.idx, p.side, p.dist + shift, PAPER_Y, anchorTmp)
      el.position.copy(anchorTmp)
    })

    flagSlots.forEach((f, i) => {
      const el = flagRefs.current[i]
      if (el) {
        anchorPoint(model, f.idx, f.side, f.dist + shift, PAPER_Y, anchorTmp)
        el.position.copy(anchorTmp)
      }
    })
    if (lintelRef.current) {
      lintelRef.current.scale.z =
        (model.halfWidth * 2 * sceneRefs.widthGain.value + 8.5) / props.lintelSpan
    }

    const { flags } = useAppStore.getState()
    if (flags) {
      flags.sectorPulseAt(raceClock.t, pulse.current)
      const phase = flags.phaseAt(raceClock.t)
      for (let i = 0; i < 3; i++) {
        const mat = flagMats[i]
        const p = pulse.current[i]
        if (phase === 'RED' && i === 0) {
          mat.color.set('#c0392b')
          mat.emissive.setRGB(0.4, 0.04, 0.02)
        } else if (p > 0.08) {
          mat.color.set('#e8a01c')
          mat.emissive.setRGB(0.5 * p, 0.3 * p, 0.02 * p)
        } else {
          mat.color.set('#f4f6f9')
          mat.emissive.setRGB(0, 0, 0)
        }
      }
    }
    const wet = sceneRefs.wet.value
    props.rainMesh.visible = wet > 0.02
    props.rainMat.uniforms.uTime.value = state.clock.elapsedTime
  })

  const treeMesh = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = treeMesh.current
    if (!mesh) return
    const d = new THREE.Object3D()
    props.treePos.forEach((t, i) => {
      d.position.set(t.x, PLINTH_TOP_Y + 0.1, t.z)
      d.rotation.set(0, t.r, 0)
      d.scale.setScalar(t.s)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [props])

  return (
    <group>
      <mesh geometry={props.skirt} material={props.skirtMat} receiveShadow frustumCulled={false} />
      <mesh geometry={props.wallL} material={props.wallMat} castShadow receiveShadow frustumCulled={false} />
      <mesh geometry={props.wallR} material={props.wallMat} castShadow receiveShadow frustumCulled={false} />
      {/* molded kerbs: raised, shadow-casting, only where corners are */}
      <mesh geometry={props.kerbGeo} material={props.kerbMat} castShadow receiveShadow frustumCulled={false} />

      {/* pit lane — the service road, coupled to the road swell in-shader */}
      <mesh geometry={props.pitGeo} material={props.pitMat} receiveShadow frustumCulled={false} />

      {/* garage bays: slab, dividing walls, roof canopy, team fascia, and live work light */}
      {props.pit.boxes.map((b, i) => (
        <group
          key={i}
          ref={(el) => {
            bayRefs.current[i] = el
          }}
          position={b.pos}
          rotation={[0, b.heading, 0]}
        >
          {/* poured concrete garage floor */}
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[9.4, 0.8, 8.5]} />
            <meshStandardMaterial color="#e4e8ef" roughness={0.92} metalness={0.03} />
          </mesh>
          {/* back wall facing outfield */}
          <mesh position={[0, 1.8, -4.15]} castShadow receiveShadow>
            <boxGeometry args={[9.4, 2.8, 0.3]} />
            <meshStandardMaterial color="#d4d9e2" roughness={0.9} metalness={0.02} />
          </mesh>
          {/* dividing walls between bays */}
          <mesh position={[-4.6, 1.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.2, 2.8, 8.2]} />
            <meshStandardMaterial color="#dce1ea" roughness={0.9} metalness={0.02} />
          </mesh>
          <mesh position={[4.6, 1.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.2, 2.8, 8.2]} />
            <meshStandardMaterial color="#dce1ea" roughness={0.9} metalness={0.02} />
          </mesh>
          {/* garage roof canopy */}
          <mesh position={[0, 3.25, 0]} castShadow>
            <boxGeometry args={[9.6, 0.3, 8.8]} />
            <meshStandardMaterial color="#edf0f5" roughness={0.8} metalness={0.05} />
          </mesh>
          {/* team fascia — facing the pit lane */}
          <mesh position={[0, 2.7, 4.15]} material={bayFasciaMats[i]}>
            <boxGeometry args={[9.4, 0.65, 0.1]} />
          </mesh>
          {/* overhead work light / gantry */}
          <mesh position={[0, 2.9, 2.5]} material={bayLightMats[i]}>
            <boxGeometry args={[4.2, 0.12, 0.12]} />
          </mesh>
          {/* pit box stop markings on service road tarmac */}
          <mesh position={[0, 0.03, 5.8]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[3.2, 4.8]} />
            <meshBasicMaterial color="#ffffff" opacity={0.35} transparent depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/* pit wall command stands facing the main straight */}
      {props.pit.pitWall.map((p, i) => (
        <group
          key={i}
          ref={(el) => {
            pitWallRefs.current[i] = el
          }}
          position={p.pos}
          rotation={[0, p.heading, 0]}
        >
          {/* pit wall concrete barrier */}
          <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
            <boxGeometry args={[14, 1.3, 0.7]} />
            <meshStandardMaterial color="#cbd3df" roughness={0.9} metalness={0.02} />
          </mesh>
          {/* team telemetry perch canopy */}
          <mesh position={[0, 1.4, -0.6]} castShadow>
            <boxGeometry args={[6.5, 0.8, 1.2]} />
            <meshStandardMaterial color="#2a3240" roughness={0.6} metalness={0.2} />
          </mesh>
        </group>
      ))}

      {/* grandstands: terraced seating wedge with roof on architectural pillars */}
      {props.blocks.map((b, i) => (
        <group
          key={i}
          ref={(el) => {
            blockRefs.current[i] = el
          }}
          position={b.pos}
          rotation={[0, b.heading, 0]}
        >
          {b.rake ? (
            <>
              <mesh geometry={b.rake} castShadow receiveShadow>
                <meshStandardMaterial color="#f0f2f6" roughness={0.9} metalness={0.02} />
              </mesh>
              {b.h > 6 && (
                <>
                  <mesh position={[0, b.h + 1.6, -b.depth * 0.45]} castShadow>
                    <boxGeometry args={[b.len * 1.02, 0.45, b.depth * 1.05]} />
                    <meshStandardMaterial color="#fbfcfe" roughness={0.8} metalness={0.04} />
                  </mesh>
                  {/* architectural support columns along seating tiers */}
                  {[-0.42, -0.21, 0, 0.21, 0.42].map((frac, idx) => (
                    <group key={idx}>
                      <mesh position={[b.len * frac, (b.h + 1.6) / 2, -1.8]} castShadow>
                        <cylinderGeometry args={[0.18, 0.22, b.h + 1.6, 6]} />
                        <meshStandardMaterial color="#3a4454" roughness={0.6} metalness={0.2} />
                      </mesh>
                      <mesh position={[b.len * frac, (b.h + 1.6) / 2, -b.depth * 0.85]} castShadow>
                        <cylinderGeometry args={[0.22, 0.26, b.h + 1.6, 6]} />
                        <meshStandardMaterial color="#3a4454" roughness={0.6} metalness={0.2} />
                      </mesh>
                    </group>
                  ))}
                </>
              )}
            </>
          ) : (
            /* low pit buildings stay a plain box */
            <mesh position={[0, b.h / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[b.len, b.h, b.depth]} />
              <meshStandardMaterial color="#f0f2f6" roughness={0.9} metalness={0.02} />
            </mesh>
          )}
        </group>
      ))}

      {/* start/finish gantry — the diorama's one bridge, ink-dark */}
      {props.gantry.map((b, i) => (
        <group
          key={i}
          ref={(el) => {
            gantryRefs.current[i] = el
          }}
          position={b.pos}
        >
          <mesh position={[0, b.h / 2, 0]} castShadow>
            <boxGeometry args={[b.len, b.h, b.depth]} />
            <meshStandardMaterial color="#2a3240" roughness={0.6} metalness={0.25} />
          </mesh>
        </group>
      ))}
      {props.lintel && (
        <mesh ref={lintelRef} position={props.lintel.pos} rotation={[0, props.lintel.heading, 0]} castShadow>
          {/* the long axis crosses the track: local Z after the yaw */}
          <boxGeometry args={[0.7, 0.7, props.lintelSpan]} />
          <meshStandardMaterial color="#2a3240" roughness={0.6} metalness={0.25} />
        </mesh>
      )}

      {/* marshal posts with live flags */}
      {flagSlots.map((f, i) => (
        <group
          key={i}
          ref={(el) => {
            flagRefs.current[i] = el
          }}
          position={f.pos}
        >
          <mesh position={[0, 1.7, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.14, 3.4, 5]} />
            <meshStandardMaterial color="#3a4452" roughness={0.7} />
          </mesh>
          <mesh position={[0, 3.0, 0.55]} material={flagMats[i]}>
            <boxGeometry args={[0.14, 0.85, 0.85]} />
          </mesh>
        </group>
      ))}

      {/* tree groves */}
      <instancedMesh ref={treeMesh} args={[props.treeGeo, props.treeMat, Math.max(1, props.treePos.length)]} castShadow receiveShadow />

      <primitive object={props.rainMesh} />
    </group>
  )
}
