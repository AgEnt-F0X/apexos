/* ============================================================
   Sector analysis — per-driver and field sector time truths.

   OpenF1 keeps duration_sector_1/2/3 on the laps table (~98%
   populated in current packs — verified), so this needs zero
   new ingestion. The per-mini-sector segment channels remain
   dropped at ingest; those would need the derivation pass
   (PLAN §1.2). What THIS model answers honestly:

   · a driver's median + best per sector
   · the field's best per sector ("the benchmark")
   · a driver's sector delta vs that benchmark
   · data availability, so panels can degrade honestly

   Whole-race medians mix fuel loads and compunds — they are a
   strength profile, not a per-lap claim. Cursor reads belong
   to paceVsField, not here.
   ============================================================ */

import type { SessionData } from '../../data/types'

export interface SectorStat {
  median: number
  best: number
  n: number
}

export interface DriverSectors {
  driverNumber: number
  s1: SectorStat
  s2: SectorStat
  s3: SectorStat
}

export interface SectorsModel {
  byDriver: Map<number, DriverSectors>
  /** field-best per sector (s) — NaN where unmeasured */
  fieldBest: [number, number, number]
  availability: { total: number; s1: number; s2: number; s3: number }
}

const MEDIAN_MIN = 3

function stat(secs: number[]): SectorStat {
  if (secs.length === 0) return { median: NaN, best: NaN, n: 0 }
  const sorted = [...secs].sort((a, b) => a - b)
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return { median, best: sorted[0], n: sorted.length }
}

export function buildSectors(data: SessionData): SectorsModel {
  const byDriver = new Map<number, DriverSectors>()
  const availability = { total: 0, s1: 0, s2: 0, s3: 0 }
  const field: [number[], number[], number[]] = [[], [], []]

  const perDriver = new Map<number, { s1: number[]; s2: number[]; s3: number[] }>()
  for (const l of data.laps) {
    availability.total++
    let e = perDriver.get(l.driver_number)
    if (!e) perDriver.set(l.driver_number, (e = { s1: [], s2: [], s3: [] }))
    if (l.duration_sector_1 !== null && Number.isFinite(l.duration_sector_1)) {
      availability.s1++
      e.s1.push(l.duration_sector_1)
      field[0].push(l.duration_sector_1)
    }
    if (l.duration_sector_2 !== null && Number.isFinite(l.duration_sector_2)) {
      availability.s2++
      e.s2.push(l.duration_sector_2)
      field[1].push(l.duration_sector_2)
    }
    if (l.duration_sector_3 !== null && Number.isFinite(l.duration_sector_3)) {
      availability.s3++
      e.s3.push(l.duration_sector_3)
      field[2].push(l.duration_sector_3)
    }
  }

  for (const [driver, e] of perDriver) {
    byDriver.set(driver, {
      driverNumber: driver,
      s1: stat(e.s1.length >= MEDIAN_MIN ? e.s1 : []),
      s2: stat(e.s2.length >= MEDIAN_MIN ? e.s2 : []),
      s3: stat(e.s3.length >= MEDIAN_MIN ? e.s3 : []),
    })
  }

  const fieldBest: [number, number, number] = [
    field[0].length ? Math.min(...field[0]) : NaN,
    field[1].length ? Math.min(...field[1]) : NaN,
    field[2].length ? Math.min(...field[2]) : NaN,
  ]

  return { byDriver, fieldBest, availability }
}

/** A driver's median sector delta vs the field benchmark (s; + = slower). */
export function sectorDeltaAt(m: SectorsModel, driver: number): [number, number, number] {
  const d = m.byDriver.get(driver)
  if (!d) return [NaN, NaN, NaN]
  return [
    Number.isFinite(d.s1.median) && Number.isFinite(m.fieldBest[0]) ? d.s1.median - m.fieldBest[0] : NaN,
    Number.isFinite(d.s2.median) && Number.isFinite(m.fieldBest[1]) ? d.s2.median - m.fieldBest[1] : NaN,
    Number.isFinite(d.s3.median) && Number.isFinite(m.fieldBest[2]) ? d.s3.median - m.fieldBest[2] : NaN,
  ]
}
