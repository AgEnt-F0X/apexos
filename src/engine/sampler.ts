/* ============================================================
   Per-frame telemetry sampling. Catmull-Rom through the uniform
   5 Hz channels gives smooth 60 fps motion; heading comes from
   the spline's analytic derivative. Zero allocation: callers
   pass a reusable output object.
   ============================================================ */

import type { DriverChannels } from '../data/types'
import { isDrsOpen } from '../data/types'

export interface CarSample {
  /** telemetry coords, meters: x east, y north, z up */
  x: number
  y: number
  z: number
  /** heading in the telemetry plane: atan2(dy, dx) */
  heading: number
  /** m/s magnitude of the positional derivative (for motion cues) */
  velocity: number
  speed: number // km/h channel
  throttle: number // 0..100
  brake: number // 0..100
  gear: number
  rpm: number
  drsOpen: boolean
  valid: boolean
}

export function makeCarSample(): CarSample {
  return {
    x: 0, y: 0, z: 0, heading: 0, velocity: 0,
    speed: 0, throttle: 0, brake: 0, gear: 0, rpm: 0,
    drsOpen: false, valid: false,
  }
}

function cr(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u3
  )
}

function crDeriv(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  return 0.5 * (
    (-p0 + p2) +
    2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u +
    3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2
  )
}

/** How many seconds beyond a driver's data range the car remains parked-visible. */
const EDGE_GRACE_S = 3

export function sampleCar(ch: DriverChannels, t: number, out: CarSample): CarSample {
  const ft = (t - ch.t0) * ch.hz
  const last = ch.n - 1

  if (ft < -EDGE_GRACE_S * ch.hz || ft > last + EDGE_GRACE_S * ch.hz) {
    out.valid = false
    return out
  }

  const f = Math.min(Math.max(ft, 0), last - 1e-6)
  const i = Math.floor(f)
  const u = f - i
  const i0 = Math.max(0, i - 1)
  const i2 = Math.min(last, i + 1)
  const i3 = Math.min(last, i + 2)

  out.x = cr(ch.x[i0], ch.x[i], ch.x[i2], ch.x[i3], u)
  out.y = cr(ch.y[i0], ch.y[i], ch.y[i2], ch.y[i3], u)
  out.z = cr(ch.z[i0], ch.z[i], ch.z[i2], ch.z[i3], u)

  // raw telemetry has gaps; NaN must never leave this function marked valid —
  // downstream it becomes NaN camera/instance matrices and can wedge the GPU
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) {
    out.valid = false
    return out
  }

  // derivative in samples → per second
  const dx = crDeriv(ch.x[i0], ch.x[i], ch.x[i2], ch.x[i3], u) * ch.hz
  const dy = crDeriv(ch.y[i0], ch.y[i], ch.y[i2], ch.y[i3], u) * ch.hz
  const v = Math.hypot(dx, dy)
  out.velocity = v
  // heading: the analytic derivative while rolling; when (nearly) stationary
  // the derivative is noise — a car on the grid must point where its own
  // telemetry is about to take it, never at whatever heading happened to sit
  // in this output object last (callers reuse one CarSample across the whole
  // field, so a leaked heading paints parked cars sideways)
  if (v > 1.5) {
    out.heading = Math.atan2(dy, dx)
  } else {
    // chord toward where this car is about to be, trying progressively
    // longer horizons so a long stop (grid hold, pit box) still finds the
    // launch direction instead of a standstill; cars parked at the END of
    // their data (retired) fall back to where they came from
    let found = false
    for (const aheadS of [1.6, 3.5, 8, 16]) {
      const k = Math.min(last, i + Math.round(ch.hz * aheadS))
      const cx = ch.x[k] - ch.x[i]
      const cy = ch.y[k] - ch.y[i]
      if (Math.hypot(cx, cy) > 0.6) {
        out.heading = Math.atan2(cy, cx)
        found = true
        break
      }
    }
    if (!found) {
      for (const backS of [2, 6, 15]) {
        const k = Math.max(0, i - Math.round(ch.hz * backS))
        const cx = ch.x[i] - ch.x[k]
        const cy = ch.y[i] - ch.y[k]
        if (Math.hypot(cx, cy) > 0.6) {
          out.heading = Math.atan2(cy, cx)
          break
        }
      }
    }
  }

  out.speed = ch.speed[i] + (ch.speed[i2] - ch.speed[i]) * u
  out.throttle = ch.throttle[i]
  out.brake = ch.brake[i]
  out.gear = ch.gear[i]
  out.rpm = ch.rpm[i]
  out.drsOpen = isDrsOpen(ch.drs[i])
  out.valid = true
  return out
}
