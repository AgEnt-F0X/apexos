/* ============================================================
   Tire degradation — a per-stint linear pace-decay fit.

   Model: clean lap time ≈ baseLap + slope × (lap − lapStart).
   This is deliberately simple and inspectable, not a physics
   simulation. It answers "who was losing how much per lap,
   on what compound" — the question the Strategy Board and
   dossier ask. Slope/r2 are NaN when there are fewer than
   MIN_FIT_POINTS clean samples; panels must render that as
   "not enough data", never as zero deg.
   ============================================================ */

import type { RaceStateIndex } from '../raceState'
import type { FlagTimeline } from '../flags'
import type { SessionData } from '../../data/types'
import type { StintDeg, TireDegModel } from './types'
import { MIN_FIT_POINTS, REGIME_BREAK_S } from './types'
import { classifyLaps } from './classify'

/** least-squares line over stint-relative laps; null when degenerate */
function fitLine(samples: Array<{ lap: number; sec: number; lapStart: number }>): {
  baseLap: number
  slopePerLap: number
  r2: number
} | null {
  const n = samples.length
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const s of samples) {
    const x = s.lap - s.lapStart
    sx += x
    sy += s.sec
    sxx += x * x
    sxy += x * s.sec
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return null
  const slopePerLap = (n * sxy - sx * sy) / denom
  const baseLap = (sy - slopePerLap * sx) / n
  const yMean = sy / n
  let ssTot = 0
  let ssRes = 0
  for (const s of samples) {
    const yHat = baseLap + slopePerLap * (s.lap - s.lapStart)
    ssTot += (s.sec - yMean) ** 2
    ssRes += (s.sec - yHat) ** 2
  }
  const r2 = ssTot > 1e-9 ? Math.max(0, 1 - ssRes / ssTot) : 1
  return { baseLap, slopePerLap, r2 }
}

export function buildTireDeg(
  data: SessionData,
  _idx: RaceStateIndex,
  flags: FlagTimeline,
): Map<number, TireDegModel> {
  const classified = classifyLaps(data, flags)

  // Wet compounds legitimately degrade too — in a wet race the inter/wet stint
  // IS the story. Those stints fit on wet-context laps; dry compounds still
  // require genuinely clean laps. SC/no-time/pit laps never feed any fit.
  const isWetCompound = (c: string): boolean => {
    const u = c.toUpperCase()
    return u.startsWith('INTER') || u.startsWith('WET')
  }

  // group fit samples per driver per stint number
  interface Acc {
    samples: Array<{ lap: number; sec: number }>
    context: 'dry' | 'wet'
    stintNumber: number
    compound: string
    lapStart: number
    lapEnd: number
    ageAtStart: number
  }
  const byDriver = new Map<number, Map<number, Acc>>()
  for (const s of data.stints) {
    let m = byDriver.get(s.driverNumber)
    if (!m) {
      m = new Map()
      byDriver.set(s.driverNumber, m)
    }
    if (!m.has(s.stintNumber)) {
      m.set(s.stintNumber, {
        samples: [],
        context: isWetCompound(s.compound) ? 'wet' : 'dry',
        stintNumber: s.stintNumber,
        compound: s.compound || 'UNKNOWN',
        lapStart: s.lapStart,
        lapEnd: s.lapEnd,
        ageAtStart: s.tyreAgeAtStart,
      })
    }
  }
  for (const [driver, laps] of classified) {
    const m = byDriver.get(driver)
    if (!m) continue
    for (const lp of laps) {
      const usable =
        lp.kind === 'clean' ||
        (lp.kind === 'wet' && Number.isFinite(lp.sec)) // context-checked below per stint compound
      if (!usable) continue
      const stints = data.stints.filter(
        (s) => s.driverNumber === driver && lp.lap >= s.lapStart && lp.lap <= s.lapEnd,
      )
      const st = stints[stints.length - 1]
      if (!st) continue
      const acc = m.get(st.stintNumber)
      if (!acc) continue
      if (lp.kind === 'wet' && acc.context !== 'wet') continue // wet lap never feeds a dry-compound fit
      acc.samples.push({ lap: lp.lap, sec: lp.sec })
    }
  }

  const out = new Map<number, TireDegModel>()
  for (const [driver, m] of byDriver) {
    const stints: StintDeg[] = []
    let bestCleanLap = Infinity
    for (const [, acc] of [...m.entries()].sort((a, b) => a[0] - b[0])) {
      acc.samples.sort((a, b) => a.lap - b.lap)
      for (const s of acc.samples) bestCleanLap = Math.min(bestCleanLap, s.sec)

      let baseLap = NaN
      let slopePerLap = NaN
      let r2 = NaN
      if (acc.samples.length >= MIN_FIT_POINTS) {
        // regime-break guard: fit only the largest stable segment
        const all = acc.samples.map((s) => ({ ...s, lapStart: acc.lapStart }))
        let bestStart = 0
        let bestLen = 0
        let start = 0
        for (let i = 1; i <= all.length; i++) {
          const broken =
            i < all.length && Math.abs(all[i].sec - all[i - 1].sec) > REGIME_BREAK_S
          if (broken || i === all.length) {
            const len = i - start
            if (len > bestLen) {
              bestLen = len
              bestStart = start
            }
            start = i
          }
        }
        const segment = bestLen < all.length ? all.slice(bestStart, bestStart + bestLen) : all
        if (segment.length >= MIN_FIT_POINTS) {
          const fit = fitLine(segment)
          if (fit) {
            baseLap = fit.baseLap
            slopePerLap = fit.slopePerLap
            r2 = fit.r2
          }
        }
      }
      stints.push({
        driverNumber: driver,
        stintNumber: acc.stintNumber,
        compound: acc.compound,
        context: acc.context,
        lapStart: acc.lapStart,
        lapEnd: acc.lapEnd,
        tyreAgeAtStart: acc.ageAtStart,
        baseLap,
        slopePerLap,
        r2,
        samples: acc.samples,
      })
    }
    out.set(driver, { driverNumber: driver, stints, bestCleanLap })
  }
  return out
}
