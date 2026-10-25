/* ============================================================
   TrackModel — the circuit extruded from the data itself.
   The fastest clean lap's positional trace becomes a closed,
   arc-length-parametrized centerline; every centerline point
   carries data attributes (braking heat, sector index) so the
   ribbon shader can paint telemetry onto the asphalt.

   Coordinate mapping (telemetry → world):
     world.x = tel.x        (east)
     world.y = tel.z        (elevation, re-based to 0)
     world.z = -tel.y       (preserves real-world chirality)
   ============================================================ */

import type { DriverChannels, SessionData } from '../data/types'
import { makeCarSample, sampleCar } from '../engine/sampler'

export interface Corner {
  /** apex point index into `points` */
  idx: number
  /** arc param of the apex */
  param: number
  /** +1 left-hander, -1 right-hander (world plane) */
  dir: 1 | -1
  /** total heading change through the corner, radians */
  angle: number
  /** T-number, 1-based from the start/finish line */
  number: number
}

export interface TrackModel {
  /** closed centerline, world coords, n*3 (wraps: point n connects to point 0) */
  points: Float32Array
  n: number
  /** arc length at each point, meters */
  cumDist: Float32Array
  length: number
  halfWidth: number
  /** arc params (0..1) where sectors 1/2/3 begin (sector 1 starts at 0) */
  sectorParam: [number, number, number]
  /** per-point sector index 0|1|2 */
  sectorOf: Uint8Array
  /** per-point braking heat 0..1 (field-wide, whole session) */
  brakeHeat: Float32Array
  /** corners detected from centerline curvature, ordered from S/F */
  corners: Corner[]
  /** XZ footprint: [minX, maxX, minZ, maxZ] */
  bounds: [number, number, number, number]
  /** scene framing */
  center: [number, number, number]
  radius: number
  elevationBase: number
  /** nearest arc param for a world-plane position; NaN if farther than maxDist */
  paramOf(wx: number, wz: number, maxDist?: number): number
  /** point index for an arc param */
  indexOfParam(p: number): number
}

const POINT_SPACING_M = 3
const HALF_WIDTH_M = 6.5

interface RefLap {
  channels: DriverChannels
  t: number
  duration: number
  s1: number | null
  s2: number | null
}

function pickReferenceLap(data: SessionData): RefLap {
  const candidates = data.laps
    .filter(
      (l) =>
        l.lap_duration !== null &&
        l.lap_duration > 30 &&
        !l.is_pit_out_lap &&
        Number.isFinite(l.t),
    )
    .sort((a, b) => a.lap_duration! - b.lap_duration!)

  for (const lap of candidates) {
    const ch = data.channels[lap.driver_number]
    if (!ch) continue
    const lapEnd = lap.t + lap.lap_duration!
    if (lap.t >= ch.t0 && lapEnd <= ch.t0 + ch.n / ch.hz) {
      return {
        channels: ch,
        t: lap.t,
        duration: lap.lap_duration!,
        s1: lap.duration_sector_1,
        s2: lap.duration_sector_2,
      }
    }
  }
  throw new Error('no clean lap with full telemetry coverage — cannot extrude circuit')
}

/** wrap-aware box smoothing on a closed sequence */
function smoothClosed(arr: Float64Array, half: number, passes: number): void {
  const n = arr.length
  const tmp = new Float64Array(n)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let k = -half; k <= half; k++) {
        sum += arr[(i + k + n) % n]
      }
      tmp[i] = sum / (2 * half + 1)
    }
    arr.set(tmp)
  }
}

export function buildTrackModel(data: SessionData): TrackModel {
  const ref = pickReferenceLap(data)

  // --- 1. trace the reference lap densely ---
  const steps = 1600
  const out = makeCarSample()
  const rx = new Float64Array(steps)
  const ry = new Float64Array(steps)
  const rz = new Float64Array(steps)
  for (let i = 0; i < steps; i++) {
    // stop just short of the line so start/end don't overlap
    const t = ref.t + (ref.duration * i) / steps
    sampleCar(ref.channels, t, out)
    rx[i] = out.x
    ry[i] = out.y
    rz[i] = out.z
  }

  // --- 2. smooth (closed): plan gently, elevation hard ---
  smoothClosed(rx, 3, 2)
  smoothClosed(ry, 3, 2)
  smoothClosed(rz, 12, 3)

  // --- 3. arc-length resample as a closed polygon ---
  const segLen = new Float64Array(steps)
  let total = 0
  for (let i = 0; i < steps; i++) {
    const j = (i + 1) % steps
    total += segLen[i] = Math.hypot(rx[j] - rx[i], ry[j] - ry[i])
  }
  const n = Math.max(64, Math.round(total / POINT_SPACING_M))
  const step = total / n

  let minZ = Infinity
  for (let i = 0; i < steps; i++) minZ = Math.min(minZ, rz[i])

  const points = new Float32Array(n * 3)
  const cumDist = new Float32Array(n)
  {
    let seg = 0
    let into = 0 // distance already consumed within current segment
    let walked = 0
    for (let i = 0; i < n; i++) {
      cumDist[i] = walked
      while (seg < steps && into >= segLen[seg]) {
        into -= segLen[seg]
        seg++
      }
      const s = Math.min(seg, steps - 1)
      const j = (s + 1) % steps
      const u = segLen[s] > 0 ? into / segLen[s] : 0
      const tx = rx[s] + (rx[j] - rx[s]) * u
      const ty = ry[s] + (ry[j] - ry[s]) * u
      const tz = rz[s] + (rz[j] - rz[s]) * u
      points[i * 3] = tx
      points[i * 3 + 1] = tz - minZ
      points[i * 3 + 2] = -ty
      into += step
      walked += step
    }
  }

  // --- 4. scene framing ---
  let cx = 0
  let cy = 0
  let cz = 0
  let minX = Infinity
  let maxX = -Infinity
  let minWZ = Infinity
  let maxWZ = -Infinity
  for (let i = 0; i < n; i++) {
    const px = points[i * 3]
    const pz = points[i * 3 + 2]
    cx += px
    cy += points[i * 3 + 1]
    cz += pz
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (pz < minWZ) minWZ = pz
    if (pz > maxWZ) maxWZ = pz
  }
  cx /= n
  cy /= n
  cz /= n
  let radius = 0
  for (let i = 0; i < n; i++) {
    radius = Math.max(radius, Math.hypot(points[i * 3] - cx, points[i * 3 + 2] - cz))
  }

  // --- 5. spatial hash for nearest-param lookups ---
  const CELL = 20
  const grid = new Map<number, number[]>()
  const cellKey = (gx: number, gz: number) => gx * 73856093 ^ gz * 19349663
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(points[i * 3] / CELL)
    const gz = Math.floor(points[i * 3 + 2] / CELL)
    const key = cellKey(gx, gz)
    let bucket = grid.get(key)
    if (!bucket) {
      bucket = []
      grid.set(key, bucket)
    }
    bucket.push(i)
  }

  const paramOf = (wx: number, wz: number, maxDist = 30): number => {
    const gx = Math.floor(wx / CELL)
    const gz = Math.floor(wz / CELL)
    let best = -1
    let bestD2 = maxDist * maxDist
    for (let ax = gx - 1; ax <= gx + 1; ax++) {
      for (let az = gz - 1; az <= gz + 1; az++) {
        const bucket = grid.get(cellKey(ax, az))
        if (!bucket) continue
        for (const i of bucket) {
          const dx = points[i * 3] - wx
          const dz = points[i * 3 + 2] - wz
          const d2 = dx * dx + dz * dz
          if (d2 < bestD2) {
            bestD2 = d2
            best = i
          }
        }
      }
    }
    return best < 0 ? NaN : cumDist[best] / total
  }

  const indexOfParam = (p: number): number => {
    const i = Math.round(((p % 1 + 1) % 1) * n) % n
    return i
  }

  // --- 6. sector boundaries from the reference lap's sector times ---
  let p1 = 0.33
  let p2 = 0.66
  if (ref.s1 !== null && ref.s2 !== null) {
    sampleCar(ref.channels, ref.t + ref.s1, out)
    const q1 = paramOf(out.x, -out.y, 60)
    sampleCar(ref.channels, ref.t + ref.s1 + ref.s2, out)
    const q2 = paramOf(out.x, -out.y, 60)
    if (Number.isFinite(q1)) p1 = q1
    if (Number.isFinite(q2)) p2 = q2
  }
  const sectorParam: [number, number, number] = [0, p1, p2]
  const sectorOf = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const p = cumDist[i] / total
    sectorOf[i] = p >= p2 ? 2 : p >= p1 ? 1 : 0
  }

  // --- 7. braking heat: every driver, whole session, binned onto the line ---
  const heat = new Float64Array(n)
  for (const ch of Object.values(data.channels)) {
    // stride 2 → 2.5 Hz is plenty for a heat map
    for (let i = 0; i < ch.n; i += 2) {
      const b = ch.brake[i]
      if (b < 40) continue
      const p = paramOf(ch.x[i], -ch.y[i], 14) // tight: excludes pit lane
      if (!Number.isFinite(p)) continue
      heat[Math.round(p * n) % n] += b / 100
    }
  }
  smoothClosed(heat, 4, 2)
  // normalize by a high percentile so one mega-braking-zone doesn't flatten the rest
  const sorted = Float64Array.from(heat).sort()
  const p98 = sorted[Math.min(n - 1, Math.floor(n * 0.98))] || 1
  const brakeHeat = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    brakeHeat[i] = Math.min(1, heat[i] / p98)
  }

  // --- 8. corners from centerline curvature (T-numbers, like the real circuit maps) ---
  // signed curvature via heading change over a ~9m window
  const heading = new Float64Array(n)
  const HW = Math.max(1, Math.round(4.5 / step))
  for (let i = 0; i < n; i++) {
    const a = ((i - HW) % n + n) % n
    const b = (i + HW) % n
    heading[i] = Math.atan2(points[b * 3 + 2] - points[a * 3 + 2], points[b * 3] - points[a * 3])
  }
  const curv = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = ((i - 1) % n + n) % n
    const b = (i + 1) % n
    let d = heading[b] - heading[a]
    d = Math.atan2(Math.sin(d), Math.cos(d))
    curv[i] = d / (2 * step)
  }
  smoothClosed(curv, 3, 2)

  // a corner = contiguous run of turn radius < ~230m turning ≥ 14° in total.
  // real circuit maps number each apex: runs split where the turn changes
  // hand (a left-right flick is two corners) and at curvature valleys
  // between distinct apexes of long complexes.
  const K_MIN = 1 / 330
  const corners: Corner[] = []
  const inCorner = (i: number) => Math.abs(curv[i]) > K_MIN
  const MIN_ANGLE = (12 * Math.PI) / 180

  const emit = (seg: number[]) => {
    if (seg.length === 0) return
    let angle = 0
    let apex = seg[0]
    for (const i of seg) {
      angle += curv[i] * step
      if (Math.abs(curv[i]) > Math.abs(curv[apex])) apex = i
    }
    if (Math.abs(angle) < MIN_ANGLE) return
    corners.push({
      idx: apex,
      param: cumDist[apex] / total,
      // world z is mirrored vs. telemetry north — positive heading change
      // is a RIGHT-hander on the real circuit
      dir: angle > 0 ? -1 : 1,
      angle,
      number: 0,
    })
  }

  /** split one same-sign segment at pronounced curvature valleys between apexes */
  const emitSplitting = (seg: number[]) => {
    if (seg.length * step < 80) {
      emit(seg)
      return
    }
    // local |κ| maxima with ≥ 40m separation
    const mag = seg.map((i) => Math.abs(curv[i]))
    const peaks: number[] = []
    for (let j = 1; j < seg.length - 1; j++) {
      if (mag[j] >= mag[j - 1] && mag[j] >= mag[j + 1]) {
        if (peaks.length === 0 || (j - peaks[peaks.length - 1]) * step >= 40) peaks.push(j)
        else if (mag[j] > mag[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = j
      }
    }
    if (peaks.length < 2) {
      emit(seg)
      return
    }
    // cut at the deepest valley between adjacent peaks when it drops well
    // below both — that valley is the "straight-ish" breath between apexes
    const cuts: number[] = []
    for (let p = 0; p < peaks.length - 1; p++) {
      let valley = peaks[p]
      for (let j = peaks[p]; j <= peaks[p + 1]; j++) if (mag[j] < mag[valley]) valley = j
      if (mag[valley] < 0.5 * Math.min(mag[peaks[p]], mag[peaks[p + 1]])) cuts.push(valley)
    }
    let start = 0
    for (const cut of cuts) {
      emit(seg.slice(start, cut))
      start = cut
    }
    emit(seg.slice(start))
  }

  // start scanning at a non-corner point so runs don't wrap awkwardly
  let scan0 = 0
  while (scan0 < n && inCorner(scan0)) scan0++
  let run: number[] = []
  const flushRun = () => {
    if (run.length === 0) return
    // split the run wherever the corner changes hand
    let segStart = 0
    for (let j = 1; j <= run.length; j++) {
      if (j === run.length || Math.sign(curv[run[j]]) !== Math.sign(curv[run[segStart]])) {
        emitSplitting(run.slice(segStart, j))
        segStart = j
      }
    }
    run = []
  }
  let gap = Infinity
  for (let k = 0; k <= n; k++) {
    const i = (scan0 + k) % n
    if (k === n) {
      flushRun()
      break
    }
    if (inCorner(i)) {
      run.push(i)
      gap = 0
    } else {
      gap++
      if (gap * step >= 30) flushRun()
    }
  }
  corners.sort((a, b) => a.param - b.param)
  corners.forEach((c, i) => (c.number = i + 1))

  return {
    points,
    n,
    cumDist,
    length: total,
    halfWidth: HALF_WIDTH_M,
    sectorParam,
    sectorOf,
    brakeHeat,
    corners,
    bounds: [minX, maxX, minWZ, maxWZ],
    center: [cx, cy, cz],
    radius,
    elevationBase: minZ,
    paramOf,
    indexOfParam,
  }
}

// ============================================================
// Geometry cache — serialize once, hydrate forever.
// The expensive parts of extrusion are the whole-session braking
// pass and curvature/corner detection. This snapshot lets a
// known circuit skip straight to rendering. The lookup closures
// (paramOf/indexOfParam) are rebuilt on hydrate from the same
// spatial-hash construction as above.
// ============================================================

export interface CachedTrackGeometry {
  v: 1
  /** slugified circuit_short_name */
  key: string
  /** 'telemetry' = extruded from a real racing lap · 'geojson' = traced from public circuit data (no brake heat, approximate sectors) */
  source: 'telemetry' | 'geojson'
  /** session the geometry was extracted from */
  sessionKey: number
  points: number[]
  cumDist: number[]
  length: number
  halfWidth: number
  sectorParam: [number, number, number]
  sectorOf: number[]
  brakeHeat: number[]
  corners: Corner[]
  bounds: [number, number, number, number]
  center: [number, number, number]
  radius: number
  elevationBase: number
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000

export function serializeTrackModel(m: TrackModel, key: string, sessionKey: number): CachedTrackGeometry {
  return {
    v: 1,
    key,
    source: 'telemetry',
    sessionKey,
    points: Array.from(m.points, r3),
    cumDist: Array.from(m.cumDist, (v) => Math.round(v * 10) / 10),
    length: r3(m.length),
    halfWidth: m.halfWidth,
    sectorParam: m.sectorParam,
    sectorOf: Array.from(m.sectorOf),
    brakeHeat: Array.from(m.brakeHeat, (v) => Math.round(v * 1000) / 1000),
    corners: m.corners.map((c) => ({ idx: c.idx, param: r3(c.param), dir: c.dir, angle: r3(c.angle), number: c.number })),
    bounds: m.bounds,
    center: m.center,
    radius: r3(m.radius),
    elevationBase: m.elevationBase,
  }
}

/** Rebuild live lookups around cached geometry — bit-compatible with fresh builds. */
export function modelFromCached(g: CachedTrackGeometry): TrackModel {
  const points = Float32Array.from(g.points)
  const cumDist = Float32Array.from(g.cumDist)
  const n = g.points.length / 3
  const total = g.length

  const CELL = 20
  const grid = new Map<number, number[]>()
  const cellKey = (gx: number, gz: number) => (gx * 73856093) ^ (gz * 19349663)
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(points[i * 3] / CELL)
    const gz = Math.floor(points[i * 3 + 2] / CELL)
    const key = cellKey(gx, gz)
    let bucket = grid.get(key)
    if (!bucket) {
      bucket = []
      grid.set(key, bucket)
    }
    bucket.push(i)
  }

  const paramOf = (wx: number, wz: number, maxDist = 30): number => {
    const gx = Math.floor(wx / CELL)
    const gz = Math.floor(wz / CELL)
    let best = -1
    let bestD2 = maxDist * maxDist
    for (let ax = gx - 1; ax <= gx + 1; ax++) {
      for (let az = gz - 1; az <= gz + 1; az++) {
        const bucket = grid.get(cellKey(ax, az))
        if (!bucket) continue
        for (const i of bucket) {
          const dx = points[i * 3] - wx
          const dz = points[i * 3 + 2] - wz
          const d2 = dx * dx + dz * dz
          if (d2 < bestD2) {
            bestD2 = d2
            best = i
          }
        }
      }
    }
    return best < 0 ? NaN : cumDist[best] / total
  }

  const indexOfParam = (p: number): number => Math.round((((p % 1) + 1) % 1) * n) % n

  return {
    points,
    n,
    cumDist,
    length: total,
    halfWidth: g.halfWidth,
    sectorParam: g.sectorParam,
    sectorOf: Uint8Array.from(g.sectorOf),
    brakeHeat: Float32Array.from(g.brakeHeat),
    corners: g.corners.map((c) => ({ ...c })),
    bounds: g.bounds,
    center: g.center,
    radius: g.radius,
    elevationBase: g.elevationBase,
    paramOf,
    indexOfParam,
  }
}
