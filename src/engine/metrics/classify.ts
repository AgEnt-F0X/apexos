/* ============================================================
   Lap classification — the single source of truth for what a
   "clean" lap is. Both the consistency stats and the tire-deg
   fit filter laps through this, so no two panels can disagree
   about which laps counted.
   ============================================================ */

import type { SessionData } from '../../data/types'
import type { FlagTimeline } from '../flags'
import type { LapKind, LapPoint } from './types'
import { OUTLIER_ABS_S, OUTLIER_FRAC } from './types'

const MEDIAN_MIN_SAMPLES = 3

/**
 * Classify every timed lap of every driver.
 *
 * Order of precedence (first match wins):
 *   no-time → pit-in → pit-out → lap1 → wet → sc
 * Outlier testing happens AFTER, against the driver's overall median,
 * so a lap must survive both context and magnitude checks to be clean.
 */
export function classifyLaps(data: SessionData, flags: FlagTimeline): Map<number, LapPoint[]> {
  // --- wet spans from the weather channel (same derivation as DnaStrip rain) ---
  const wetSpans: Array<[number, number]> = []
  let wet = false
  let wetStart = 0
  for (const w of data.weather) {
    const r = w.rainfall > 0
    if (r && !wet) {
      wet = true
      wetStart = w.t
    } else if (!r && wet) {
      wet = false
      wetSpans.push([wetStart, w.t])
    }
  }
  if (wet) wetSpans.push([wetStart, data.tMax])

  const slowSpan = (t: number): boolean => {
    for (const s of flags.spans) {
      if ((s.phase === 'SC' || s.phase === 'VSC' || s.phase === 'RED') && t >= s.t0 - 5 && t <= s.t1 + 40)
        return true
    }
    return false
  }
  const isWet = (t: number): boolean => wetSpans.some(([a, b]) => t >= a && t <= b)

  // --- pit-in detection: a pit event's lap ---
  const pitLaps = new Map<number, Set<number>>()
  for (const p of data.pits) {
    let set = pitLaps.get(p.driverNumber)
    if (!set) {
      set = new Set()
      pitLaps.set(p.driverNumber, set)
    }
    set.add(p.lapNumber)
  }

  // --- first pass: contextual kinds ---
  const byDriver = new Map<number, Array<{ point: LapPoint; tStart: number }>>()
  for (const l of data.laps) {
    let arr = byDriver.get(l.driver_number)
    if (!arr) {
      arr = []
      byDriver.set(l.driver_number, arr)
    }
    const sec = l.lap_duration ?? NaN
    let kind: LapKind
    if (!Number.isFinite(sec)) kind = 'no-time'
    else if (pitLaps.get(l.driver_number)?.has(l.lap_number)) kind = 'pit-in'
    else if (l.is_pit_out_lap) kind = 'pit-out'
    else if (l.lap_number <= 1) kind = 'lap1'
    else if (Number.isFinite(l.t) && isWet(l.t)) kind = 'wet'
    else if (Number.isFinite(l.t) && slowSpan(l.t)) kind = 'sc'
    else kind = 'clean'
    arr.push({ tStart: Number.isFinite(l.t) ? l.t : Infinity, point: { lap: l.lap_number, sec, kind, compound: '' } })
  }

  // --- attach compound context per lap via stint windows ---
  const stintsByDriver = new Map<number, typeof data.stints>()
  for (const s of data.stints) {
    let arr = stintsByDriver.get(s.driverNumber)
    if (!arr) {
      arr = []
      stintsByDriver.set(s.driverNumber, arr)
    }
    arr.push(s)
  }

  // --- outlier pass per driver over currently-clean laps ---
  for (const [driver, arr] of byDriver) {
    arr.sort((a, b) => a.point.lap - b.point.lap)
    const stints = (stintsByDriver.get(driver) ?? []).sort((a, b) => a.stintNumber - b.stintNumber)
    for (const entry of arr) {
      const st = stints.find((s) => entry.point.lap >= s.lapStart && entry.point.lap <= s.lapEnd)
      entry.point.compound = st?.compound ?? ''
    }

    const cleanSecs = arr.filter((e) => e.point.kind === 'clean').map((e) => e.point.sec)
    if (cleanSecs.length >= MEDIAN_MIN_SAMPLES) {
      const sorted = [...cleanSecs].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      const gate = Math.max(median * OUTLIER_FRAC, OUTLIER_ABS_S)
      for (const e of arr) {
        if (e.point.kind === 'clean' && Math.abs(e.point.sec - median) > gate) e.point.kind = 'outlier'
      }
    }

    byDriver.set(
      driver,
      arr.map((e) => ({ ...e, point: { ...e.point } })),
    )
  }

  const out = new Map<number, LapPoint[]>()
  for (const [d, arr] of byDriver) out.set(d, arr.map((e) => e.point))
  return out
}
