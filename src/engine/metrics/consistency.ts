/* ============================================================
   Consistency — per-driver lap-time distribution over clean
   laps, with every lap classified and kept. The dossier's
   scatter plot renders points colored by kind; stdev/median
   are computed over CLEAN laps only (MIN_CLEAN_LAPS gate).

   Also derives paceVsField: per lap delta between a driver's
   best clean lap that lap... actually simpler and more honest:
   the driver's ONLY timed lap that lap vs the field's fastest
   timed lap that lap. Wet/SC laps are excluded on BOTH sides so
   strategy phases don't read as "pace loss".
   ============================================================ */

import type { FlagTimeline } from '../flags'
import type { RaceStateIndex } from '../raceState'
import type { SessionData } from '../../data/types'
import type { DriverConsistency, PacePoint } from './types'
import { MIN_CLEAN_LAPS } from './types'
import { classifyLaps } from './classify'

export function buildConsistency(
  data: SessionData,
  _idx: RaceStateIndex,
  flags: FlagTimeline,
): Map<number, DriverConsistency> {
  const classified = classifyLaps(data, flags)
  const out = new Map<number, DriverConsistency>()
  for (const [driver, laps] of classified) {
    const clean = laps.filter((l) => l.kind === 'clean' && Number.isFinite(l.sec)).map((l) => l.sec)
    const sorted = [...clean].sort((a, b) => a - b)
    const median =
      sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : NaN
    let stdev = NaN
    if (sorted.length >= MIN_CLEAN_LAPS) {
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
      stdev = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length)
    }
    out.set(driver, {
      driverNumber: driver,
      points: laps,
      median,
      stdev,
      best: sorted[0] ?? NaN,
      cleanCount: sorted.length,
    })
  }
  return out
}

export function buildPaceVsField(
  data: SessionData,
  _idx: RaceStateIndex,
  flags: FlagTimeline,
): Map<number, PacePoint[]> {
  const classified = classifyLaps(data, flags)

  // field-best timed lap per race lap, ignoring wet/sc/no-time laps entirely
  const fieldBest = new Map<number, number>()
  for (const laps of classified.values()) {
    for (const lp of laps) {
      if (lp.kind !== 'clean') continue
      const cur = fieldBest.get(lp.lap)
      if (cur === undefined || lp.sec < cur) fieldBest.set(lp.lap, lp.sec)
    }
  }

  const out = new Map<number, PacePoint[]>()
  for (const [driver, laps] of classified) {
    const bylap = new Map<number, number>()
    for (const lp of laps) {
      if (!Number.isFinite(lp.sec)) continue
      // a driver's representative lap of that lap-number: their only real attempt
      const kindsThatCount = lp.kind === 'clean' || lp.kind === 'wet' || lp.kind === 'sc'
      if (!kindsThatCount) continue
      const cur = bylap.get(lp.lap)
      if (cur === undefined || lp.sec < cur) bylap.set(lp.lap, lp.sec)
    }
    const points: PacePoint[] = []
    for (const [lap, sec] of [...bylap.entries()].sort((a, b) => a[0] - b[0])) {
      const fb = fieldBest.get(lap)
      points.push({ lap, sec, deltaToBest: fb !== undefined ? sec - fb : NaN })
    }
    out.set(driver, points)
  }
  return out
}
