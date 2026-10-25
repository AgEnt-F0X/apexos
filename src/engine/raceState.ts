/* ============================================================
   RaceStateIndex — O(log n) answers to "at time t, who is where?"
   Built once per session from the sparse position change-log,
   the interval samples, and the laps table.
   ============================================================ */

import type { SessionData, StintEvent } from '../data/types'

function upperBound(arr: ArrayLike<number>, t: number, lo: number, hi: number): number {
  // first index with arr[i] > t, within [lo, hi)
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

interface DriverSeries {
  t: Float64Array
  v: Float64Array
}

interface DriverGapSeries {
  t: Float64Array
  gap: Float32Array
  interval: Float32Array
  gapLaps: Uint8Array
}

export interface GapSample {
  gap: number // seconds to leader, NaN unknown
  interval: number // seconds to car ahead, NaN unknown
  gapLaps: number // laps behind leader
}

export class RaceStateIndex {
  readonly driverNumbers: number[]
  readonly totalLaps: number
  private readonly pos = new Map<number, DriverSeries>()
  private readonly gaps = new Map<number, DriverGapSeries>()
  private readonly lapStarts = new Map<number, DriverSeries>() // v = lap_number
  private readonly stints = new Map<number, StintEvent[]>()
  private readonly gridOrder: number[]

  constructor(data: SessionData) {
    this.driverNumbers = data.drivers.map((d) => d.driver_number)

    // --- per-driver position step functions ---
    const posAcc = new Map<number, { t: number[]; v: number[] }>()
    const P = data.positions
    for (let i = 0; i < P.t.length; i++) {
      const d = P.driver[i]
      let acc = posAcc.get(d)
      if (!acc) {
        acc = { t: [], v: [] }
        posAcc.set(d, acc)
      }
      acc.t.push(P.t[i])
      acc.v.push(P.position[i])
    }
    for (const [d, acc] of posAcc) {
      this.pos.set(d, { t: Float64Array.from(acc.t), v: Float64Array.from(acc.v) })
    }

    // --- per-driver gap series ---
    const gapAcc = new Map<number, { t: number[]; g: number[]; iv: number[]; gl: number[] }>()
    const I = data.intervals
    for (let i = 0; i < I.t.length; i++) {
      const d = I.driver[i]
      let acc = gapAcc.get(d)
      if (!acc) {
        acc = { t: [], g: [], iv: [], gl: [] }
        gapAcc.set(d, acc)
      }
      acc.t.push(I.t[i])
      acc.g.push(I.gap[i])
      acc.iv.push(I.interval[i])
      acc.gl.push(I.gapLaps[i])
    }
    for (const [d, acc] of gapAcc) {
      this.gaps.set(d, {
        t: Float64Array.from(acc.t),
        gap: Float32Array.from(acc.g),
        interval: Float32Array.from(acc.iv),
        gapLaps: Uint8Array.from(acc.gl),
      })
    }

    // --- per-driver lap starts ---
    const lapAcc = new Map<number, { t: number[]; v: number[] }>()
    let totalLaps = 0
    for (const l of data.laps) {
      totalLaps = Math.max(totalLaps, l.lap_number)
      if (!Number.isFinite(l.t)) continue
      let acc = lapAcc.get(l.driver_number)
      if (!acc) {
        acc = { t: [], v: [] }
        lapAcc.set(l.driver_number, acc)
      }
      acc.t.push(l.t)
      acc.v.push(l.lap_number)
    }
    this.totalLaps = totalLaps
    for (const [d, acc] of lapAcc) {
      this.lapStarts.set(d, { t: Float64Array.from(acc.t), v: Float64Array.from(acc.v) })
    }

    // --- per-driver stints (ordered) ---
    for (const s of data.stints) {
      let arr = this.stints.get(s.driverNumber)
      if (!arr) {
        arr = []
        this.stints.set(s.driverNumber, arr)
      }
      arr.push(s)
    }
    for (const arr of this.stints.values()) arr.sort((a, b) => a.stintNumber - b.stintNumber)

    // starting order = each driver's first known position
    this.gridOrder = [...this.driverNumbers].sort((a, b) => {
      const pa = this.pos.get(a)?.v[0] ?? 99
      const pb = this.pos.get(b)?.v[0] ?? 99
      return pa - pb
    })
  }

  /** Race position of a driver at time t (1-based), or null if unknown. */
  positionOf(driver: number, t: number): number | null {
    const s = this.pos.get(driver)
    if (!s || s.t.length === 0) return null
    const i = upperBound(s.t, t, 0, s.t.length)
    if (i === 0) return s.v[0] // before first sample: starting position
    return s.v[i - 1]
  }

  /** Drivers ordered by position at time t. Ties broken by grid order (stable). */
  orderAt(t: number): number[] {
    const scored = this.gridOrder.map((d, gi) => ({
      d,
      p: this.positionOf(d, t) ?? 90 + gi,
      gi,
    }))
    scored.sort((a, b) => (a.p - b.p) || (a.gi - b.gi))
    return scored.map((s) => s.d)
  }

  leaderAt(t: number): number | null {
    return this.orderAt(t)[0] ?? null
  }

  /** Current lap number of a driver at t (the lap they are ON), or 0 before the start. */
  lapOf(driver: number, t: number): number {
    const s = this.lapStarts.get(driver)
    if (!s || s.t.length === 0) return 0
    const i = upperBound(s.t, t, 0, s.t.length)
    if (i === 0) return 0
    return s.v[i - 1]
  }

  /** Raw position change-log for one driver (for timeline threads). */
  positionSeries(driver: number): { t: Float64Array; v: Float64Array } | null {
    return this.pos.get(driver) ?? null
  }

  /** Tire stint a driver is on during a given lap (compound + age). */
  stintAt(driver: number, lap: number): { compound: string; age: number } | null {
    const arr = this.stints.get(driver)
    if (!arr || arr.length === 0) return null
    let current = arr[0]
    for (const s of arr) {
      if (lap >= s.lapStart) current = s
      else break
    }
    return {
      compound: current.compound,
      age: current.tyreAgeAtStart + Math.max(0, lap - current.lapStart),
    }
  }

  /** Gap/interval of a driver at t, linearly interpolated where possible. */
  gapOf(driver: number, t: number, out: GapSample): GapSample {
    const s = this.gaps.get(driver)
    out.gap = NaN
    out.interval = NaN
    out.gapLaps = 0
    if (!s || s.t.length === 0) return out
    const n = s.t.length
    const i = upperBound(s.t, t, 0, n)
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i)
    const ta = s.t[a]
    const tb = s.t[b]
    const u = b > a && tb > ta ? Math.min(Math.max((t - ta) / (tb - ta), 0), 1) : 0
    const lerpOrHold = (va: number, vb: number): number => {
      if (Number.isFinite(va) && Number.isFinite(vb)) return va + (vb - va) * u
      return u >= 0.5 ? vb : va
    }
    out.gap = lerpOrHold(s.gap[a], s.gap[b])
    out.interval = lerpOrHold(s.interval[a], s.interval[b])
    out.gapLaps = u >= 0.5 ? s.gapLaps[b] : s.gapLaps[a]
    return out
  }
}
