/* ============================================================
   Metrics registry — one build per session, memoized.

   Usage (mirrors moments/flags):
     const metrics = metricsFor(data, idx, flags)
     const deg = metrics.tireDeg.get(44)          // whole-race model
     const point = consistencyPointAt(metrics, 44, t) // cursor read

   The *At() helpers exist so panels obey the One Time Cursor:
   they take the clock's t and binary-search the precomputed
   series instead of holding their own state.
   ============================================================ */

import type { FlagTimeline } from '../flags'
import type { RaceStateIndex } from '../raceState'
import type { SessionData } from '../../data/types'
import type { DriverConsistency, MetricsModel, PacePoint, StintDeg, TireDegModel } from './types'
import { buildTireDeg } from './tireDeg'
import { buildConsistency, buildPaceVsField } from './consistency'
import { buildUndercuts } from './undercut'
import { buildGapDynamics } from './gapDynamics'
import { buildTrackEvolution } from './trackEvolution'
import { buildSectors } from './sectors'

export function buildMetrics(data: SessionData, idx: RaceStateIndex, flags: FlagTimeline): MetricsModel {
  const tireDeg = buildTireDeg(data, idx, flags)
  const consistency = buildConsistency(data, idx, flags)
  const paceVsField = buildPaceVsField(data, idx, flags)
  const undercuts = buildUndercuts(data, idx, flags)
  const gapDynamics = buildGapDynamics(data, idx, flags)
  const trackEvolution = buildTrackEvolution(data, flags)
  const sectors = buildSectors(data)

  let totalTimedLaps = 0
  for (const laps of consistency.values()) {
    for (const p of laps.points) if (Number.isFinite(p.sec)) totalTimedLaps = Math.max(totalTimedLaps, p.lap)
  }

  return { tireDeg, consistency, paceVsField, undercuts, gapDynamics, trackEvolution, sectors, totalTimedLaps }
}

// ---------- undercut surface (re-exported so panels import from here) ----------

export { buildUndercuts, undercutThreatAt, UNDERCUT_MAX_GAP_S, UNDERCUT_SETTLE_LAPS } from './undercut'
export type { UndercutEvent, UndercutModel, UndercutThreat } from './undercut'

// ---------- gap dynamics surface ----------

export {
  buildGapDynamics,
  gapSlopeAt,
  GAP_FIT_LAPS,
  GAP_CLOSE_RATE_S,
  GAP_CLOSE_RANGE_S,
} from './gapDynamics'
export type { GapDynamicsModel, GapSeries, GapSwing, GapTrend } from './gapDynamics'

// ---------- track evolution + sectors surfaces ----------

export { buildTrackEvolution, fieldMedianAt, EVOLUTION_START_LAP } from './trackEvolution'
export type { TrackEvolutionModel, EvolutionPoint } from './trackEvolution'
export { buildSectors, sectorDeltaAt } from './sectors'
export type { SectorsModel, DriverSectors, SectorStat } from './sectors'

const cache = new WeakMap<SessionData, MetricsModel>()

/** Memoized per SessionData — safe to call every render. */
export function metricsFor(data: SessionData, idx: RaceStateIndex, flags: FlagTimeline): MetricsModel {
  let m = cache.get(data)
  if (!m) {
    m = buildMetrics(data, idx, flags)
    cache.set(data, m)
  }
  return m
}

// ---------- cursor reads ----------

/** The stint a driver's lap belongs to (by race-lap number). */
export function stintOf(model: TireDegModel, lap: number): StintDeg | null {
  let found: StintDeg | null = null
  for (const s of model.stints) {
    if (lap >= s.lapStart && lap <= s.lapEnd) found = s
  }
  return found
}

/**
 * Degradation read at the playhead: the slope of the stint the driver is on
 * at race-lap `lap`. NaN when the stint lacks fit points — render as unknown.
 */
export function degAt(model: TireDegModel, lap: number): { compound: string; slopePerLap: number; r2: number } {
  const st = stintOf(model, lap)
  if (!st) return { compound: '', slopePerLap: NaN, r2: NaN }
  return { compound: st.compound, slopePerLap: st.slopePerLap, r2: st.r2 }
}

export function consistencyOf(m: MetricsModel, driver: number): DriverConsistency | null {
  return m.consistency.get(driver) ?? null
}

export function paceSeriesOf(m: MetricsModel, driver: number): PacePoint[] {
  return m.paceVsField.get(driver) ?? []
}

/** Pace delta at the playhead: latest paceVsField sample at or before t. */
export function paceDeltaAt(
  data: SessionData,
  m: MetricsModel,
  driver: number,
  t: number,
): number {
  const series = m.paceVsField.get(driver)
  if (!series || series.length === 0) return NaN
  // walk backwards from a time-derived lap estimate
  const idxLaps = data.laps
    .filter((l) => l.driver_number === driver && Number.isFinite(l.t) && l.t <= t)
    .reduce((acc, l) => Math.max(acc, l.lap_number), 0)
  let best: PacePoint | null = null
  for (const p of series) {
    if (p.lap > idxLaps) break
    best = p
  }
  return best ? best.deltaToBest : NaN
}
