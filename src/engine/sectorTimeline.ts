/* ============================================================
   Sector timeline — broadcast-true sector timing semantics.
   The laps table carries completed sectors; replaying them in
   completion order reproduces exactly what the pit wall sees:
   a sector set PURPLE when it beats the session's best-so-far,
   GREEN when it beats only the driver's own best-so-far, and
   plain ink otherwise. Purple is not a property of the number —
   it is a property of the moment the number was set.
   ============================================================ */

import type { SessionData } from '../data/types'

export interface SectorEntry {
  driver: number
  lap: number
  sector: 1 | 2 | 3
  /** session-time when this sector was completed */
  t: number
  /** the sector time, seconds */
  time: number
  /** beat the session best-so-far when set */
  purple: boolean
  /** beat only the driver's own best-so-far when set */
  green: boolean
}

export interface SectorTimeline {
  /** all entries sorted by completion time */
  entries: SectorEntry[]
  /** per driver, entries in completion order (index into `entries`) */
  byDriver: Map<number, number[]>
  /** session-best per sector as of the end of the data (seconds) */
  best: [number, number, number]
  /** the driver holding each session best */
  bestHolder: [number | null, number | null, number | null]
}

export function buildSectorTimeline(data: SessionData): SectorTimeline {
  interface Raw {
    driver: number
    lap: number
    sector: 1 | 2 | 3
    t: number
    time: number
  }
  const raw: Raw[] = []
  for (const l of data.laps) {
    if (!Number.isFinite(l.t)) continue
    // sector k completes at lap start + the sum of durations through k
    const s1 = l.duration_sector_1
    const s2 = l.duration_sector_2
    const s3 = l.duration_sector_3
    if (s1 !== null && Number.isFinite(s1)) {
      raw.push({ driver: l.driver_number, lap: l.lap_number, sector: 1, t: l.t + s1, time: s1 })
    }
    if (s1 !== null && s2 !== null && Number.isFinite(s1) && Number.isFinite(s2)) {
      raw.push({ driver: l.driver_number, lap: l.lap_number, sector: 2, t: l.t + s1 + s2, time: s2 })
    }
    if (s1 !== null && s2 !== null && s3 !== null && Number.isFinite(s1) && Number.isFinite(s2) && Number.isFinite(s3)) {
      raw.push({ driver: l.driver_number, lap: l.lap_number, sector: 3, t: l.t + s1 + s2 + s3, time: s3 })
    }
  }
  raw.sort((a, b) => a.t - b.t)

  const sessionBest: [number, number, number] = [Infinity, Infinity, Infinity]
  const driverBest = new Map<number, [number, number, number]>()
  const entries: SectorEntry[] = []
  const byDriver = new Map<number, number[]>()
  for (const r of raw) {
    const si = r.sector - 1
    let pb = driverBest.get(r.driver)
    if (!pb) driverBest.set(r.driver, (pb = [Infinity, Infinity, Infinity]))
    const purple = r.time < sessionBest[si]
    const green = !purple && r.time < pb[si]
    if (r.time < sessionBest[si]) sessionBest[si] = r.time
    if (r.time < pb[si]) pb[si] = r.time
    entries.push({ ...r, purple, green })
    let arr = byDriver.get(r.driver)
    if (!arr) byDriver.set(r.driver, (arr = []))
    arr.push(entries.length - 1)
  }

  const bestHolder: [number | null, number | null, number | null] = [null, null, null]
  for (let s = 0; s < 3; s++) {
    if (Number.isFinite(sessionBest[s])) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.sector === s + 1 && e.purple && e.time === sessionBest[s]) {
          bestHolder[s] = e.driver
          break
        }
      }
    }
    if (!Number.isFinite(sessionBest[s])) sessionBest[s] = NaN
  }

  return { entries, byDriver, best: sessionBest, bestHolder }
}

/** The driver's most recent completed sector in each slot, as of time t. */
export function lastSectorsAt(
  tl: SectorTimeline,
  driver: number,
  t: number,
): [SectorEntry | null, SectorEntry | null, SectorEntry | null] {
  const out: [SectorEntry | null, SectorEntry | null, SectorEntry | null] = [null, null, null]
  const arr = tl.byDriver.get(driver)
  if (!arr) return out
  // entries are appended in completion order; scan from the end
  for (let i = arr.length - 1; i >= 0 && (!out[0] || !out[1] || !out[2]); i--) {
    const e = tl.entries[arr[i]]
    if (e.t > t) continue
    if (!out[e.sector - 1]) out[e.sector - 1] = e
  }
  return out
}
