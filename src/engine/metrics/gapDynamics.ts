/* ============================================================
   Gap dynamics — the shape of a battle over time.

   The intervals table carries gap-to-leader at ~4 s cadence per
   driver. From it we derive, per driver:

   · slopePerLap — how fast the gap to the leader is changing,
     fitted over a GAP_FIT_LAPS window (negative = closing)
   · swings — sustained closes on the car directly ahead while
     inside undercut range: the raw material of battle prediction
     and Drama v2. A swing is a PREDICTION, never an outcome —
     narration must hedge accordingly.

   Honesty rules:
   - laps-behind samples (+N LAP) and NaN gaps are skipped
   - fewer than GAP_MIN_LAPS between window ends ⇒ NaN slope
   - a swing needs SUSTAINED closing, not one noisy sample
   ============================================================ */

import type { SessionData } from '../../data/types'
import type { RaceStateIndex } from '../raceState'
import type { FlagTimeline } from '../flags'

// ---------- the heuristics, named ----------

/** slope window: fit gap change across this many race laps */
export const GAP_FIT_LAPS = 3
/** window must span at least this many laps to trust a slope */
export const GAP_MIN_LAPS = 2
/** closing faster than this (s/lap) counts as a swing */
export const GAP_CLOSE_RATE_S = 0.35
/** sustained closes steeper than this are pit-cycle/caution arithmetic, not pace */
export const GAP_MAX_RATE_S = 3
/** the close must be sustained across this many laps */
export const GAP_CLOSE_SUSTAIN_LAPS = 3
/** swings only matter within this distance of the car ahead */
export const GAP_CLOSE_RANGE_S = 3

export interface GapSwing {
  chaser: number
  target: number
  t: number
  lap: number
  /** most negative slope seen in the swing (s/lap) */
  ratePerLap: number
  /** gap to target when the swing began (s) */
  gapFrom: number
}

export interface GapSeries {
  driver: number
  t: Float64Array
  lap: Uint16Array
  /** gap to the race leader (s) */
  gap: Float32Array
  /** interval to the car directly ahead (s); NaN where unmeasured */
  interval: Float32Array
  /** s/lap, negative = closing; NaN where the window is too short */
  slope: Float32Array
}

export interface GapDynamicsModel {
  byDriver: Map<number, GapSeries>
  /** sorted by t */
  swings: GapSwing[]
}

export function buildGapDynamics(
  data: SessionData,
  idx: RaceStateIndex,
  flags?: FlagTimeline,
): GapDynamicsModel {
  const byDriver = new Map<number, GapSeries>()
  const perDriver = new Map<number, Array<{ t: number; lap: number; gap: number; iv: number }>>()
  for (let i = 0; i < data.intervals.t.length; i++) {
    const gap = data.intervals.gap[i]
    const lapsBack = data.intervals.gapLaps[i]
    if (!Number.isFinite(gap) || lapsBack > 0) continue
    const d = data.intervals.driver[i]
    const t = data.intervals.t[i]
    const lap = idx.lapOf(d, t)
    if (!Number.isFinite(lap) || lap < 1) continue
    const rawIv = data.intervals.interval[i]
    let arr = perDriver.get(d)
    if (!arr) perDriver.set(d, (arr = []))
    arr.push({ t, lap, gap, iv: Number.isFinite(rawIv) ? rawIv : NaN })
  }

  for (const [driver, rows] of perDriver) {
    rows.sort((a, b) => a.t - b.t)
    const n = rows.length
    const t = new Float64Array(n)
    const lap = new Uint16Array(n)
    const gap = new Float32Array(n)
    const interval = new Float32Array(n)
    const slope = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      t[i] = rows[i].t
      lap[i] = rows[i].lap
      gap[i] = rows[i].gap
      interval[i] = rows[i].iv
    }
    // two-pointer slope: first sample GAP_FIT_LAPS ahead of i
    let j = 0
    for (let i = 0; i < n; i++) {
      if (j < i) j = i
      while (j < n && rows[j].lap < rows[i].lap + GAP_FIT_LAPS) j++
      const k = j < n ? j : -1
      const span = k >= 0 ? rows[k].lap - rows[i].lap : 0
      slope[i] = k >= 0 && span >= GAP_MIN_LAPS ? (rows[k].gap - rows[i].gap) / span : NaN
    }
    byDriver.set(driver, { driver, t, lap, gap, interval, slope })
  }

  return { byDriver, swings: detectSwings(idx, byDriver, flags) }
}

/** sustained closes on the car directly ahead, inside undercut range */
function detectSwings(
  idx: RaceStateIndex,
  byDriver: Map<number, GapSeries>,
  flags?: FlagTimeline,
): GapSwing[] {
  // SC/VSC/RED compress the whole field — a "close" under caution is
  // bunching arithmetic, not driver pace. Swings are green-flag facts.
  const inCaution = (t: number): boolean => {
    if (!flags) return false
    for (const s of flags.spans) {
      if (
        (s.phase === 'SC' || s.phase === 'VSC' || s.phase === 'RED') &&
        t >= s.t0 - 5 &&
        t <= s.t1 + 40
      )
        return true
    }
    return false
  }
  const swings: GapSwing[] = []
  for (const series of byDriver.values()) {
    let runStart = -1
    let runBest = NaN
    for (let i = 0; i <= series.t.length; i++) {
      const closing = i < series.t.length && Number.isFinite(series.slope[i]) && series.slope[i] <= -GAP_CLOSE_RATE_S
      if (closing) {
        if (runStart < 0) {
          runStart = i
          runBest = series.slope[i]
        } else if (series.slope[i] < runBest) runBest = series.slope[i]
        continue
      }
      if (runStart >= 0) {
        const startLap = series.lap[runStart]
        const endLap = series.lap[i - 1]
        const t = series.t[runStart]
        const iv = series.interval[runStart]
        if (
          endLap - startLap + 1 >= GAP_CLOSE_SUSTAIN_LAPS &&
          !inCaution(t) &&
          Number.isFinite(iv) &&
          iv > 0 &&
          iv < GAP_CLOSE_RANGE_S &&
          -runBest <= GAP_MAX_RATE_S
        ) {
          const pos = idx.positionOf(series.driver, t)
          if (pos !== null && pos > 1) {
            const target = idx.orderAt(t)[pos - 2]
            if (target !== undefined && target !== series.driver) {
              swings.push({
                chaser: series.driver,
                target,
                t,
                lap: startLap,
                ratePerLap: runBest,
                gapFrom: iv,
              })
            }
          }
        }
        runStart = -1
      }
    }
  }
  swings.sort((a, b) => a.t - b.t)
  return swings
}

// ---------- cursor reads ----------

export interface GapTrend {
  /** s/lap, negative = closing on the leader */
  perLap: number
  /** current gap to leader (s) */
  gap: number
  lap: number
}

/**
 * Trend read at the playhead: latest fitted slope at or before t
 * (within 45 s — older than that renders as unknown).
 */
export function gapSlopeAt(
  m: GapDynamicsModel,
  driver: number,
  t: number,
): GapTrend | null {
  const s = m.byDriver.get(driver)
  if (!s || s.t.length === 0) return null
  let lo = 0
  let hi = s.t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (s.t[mid] <= t) lo = mid + 1
    else hi = mid
  }
  const i = lo - 1
  if (i < 0 || t - s.t[i] > 45) return null
  return { perLap: s.slope[i], gap: s.gap[i], lap: s.lap[i] }
}
