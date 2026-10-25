/* ============================================================
   Track evolution — how the FIELD's lap time moves across the
   race. Median clean lap per race lap across all drivers:
   early laps ride fuel-weight penalties, cautions flatten the
   curve, tire deg and track rubbering-in shape the drift.

   Feeds strategy storytelling: "the field is X s/lap slower
   than stint one" is a named-table fact, not a vibe.

   Honesty rules:
   - a lap's median needs ≥ EVOLUTION_MIN_DRIVERS clean laps
   - the pace fit starts at EVOLUTION_START_LAP (lap-1 chaos out)
   ============================================================ */

import type { SessionData } from '../../data/types'
import type { FlagTimeline } from '../flags'
import { classifyLaps } from './classify'

export const EVOLUTION_MIN_DRIVERS = 3
export const EVOLUTION_START_LAP = 3

export interface EvolutionPoint {
  lap: number
  /** field median clean lap (s); NaN if too few drivers */
  median: number
  best: number
  n: number
}

export interface TrackEvolutionModel {
  /** sorted by lap */
  points: EvolutionPoint[]
  /** fitted pace drift of the field medians (s/lap; + = field slowing) */
  slopePerLap: number
  /** clean-lap median across the whole race */
  overallMedian: number
}

export function buildTrackEvolution(data: SessionData, flags: FlagTimeline): TrackEvolutionModel {
  const classified = classifyLaps(data, flags)
  const byLap = new Map<number, number[]>()
  for (const points of classified.values()) {
    for (const p of points) {
      if (p.kind !== 'clean' || !Number.isFinite(p.sec)) continue
      let arr = byLap.get(p.lap)
      if (!arr) byLap.set(p.lap, (arr = []))
      arr.push(p.sec)
    }
  }

  const points: EvolutionPoint[] = []
  const allClean: number[] = []
  for (const [lap, secs] of [...byLap.entries()].sort((a, b) => a[0] - b[0])) {
    for (const s of secs) allClean.push(s)
    if (secs.length < EVOLUTION_MIN_DRIVERS) {
      points.push({ lap, median: NaN, best: Math.min(...secs), n: secs.length })
      continue
    }
    const sorted = [...secs].sort((a, b) => a - b)
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    points.push({ lap, median, best: sorted[0], n: secs.length })
  }

  // fit medians → slope (s/lap), skipping the opening laps
  let slopePerLap = NaN
  const fit = points.filter((p) => p.lap >= EVOLUTION_START_LAP && Number.isFinite(p.median))
  if (fit.length >= 5) {
    const n = fit.length
    let sx = 0
    let sy = 0
    let sxx = 0
    let sxy = 0
    for (const p of fit) {
      sx += p.lap
      sy += p.median
      sxx += p.lap * p.lap
      sxy += p.lap * p.median
    }
    const denom = n * sxx - sx * sx
    if (Math.abs(denom) > 1e-9) slopePerLap = (n * sxy - sx * sy) / denom
  }

  const sortedAll = [...allClean].sort((a, b) => a - b)
  const overallMedian =
    sortedAll.length > 0
      ? sortedAll.length % 2 === 1
        ? sortedAll[(sortedAll.length - 1) / 2]
        : (sortedAll[sortedAll.length / 2 - 1] + sortedAll[sortedAll.length / 2]) / 2
      : NaN

  return { points, slopePerLap, overallMedian }
}

/** Field median at a race lap (nearest sampled lap within 2). */
export function fieldMedianAt(m: TrackEvolutionModel, lap: number): number {
  let best: EvolutionPoint | null = null
  let bestDist = Infinity
  for (const p of m.points) {
    const d = Math.abs(p.lap - lap)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best && bestDist <= 2 && Number.isFinite(best.median) ? best.median : NaN
}
