/* ============================================================
   Undercut metric — pit-lap delta between chaser & target.

   The audit's weakest honesty point: narration used to imply
   undercuts that were never detected. This model makes the
   claim real or absent:

   · an ATTEMPT is a pit stop made while running within
     UNDERCUT_MAX_GAP_S of the car directly ahead (interval table)
   · an attempt SUCCEEDS if the chaser is ahead of that exact
     target UNDERCUT_SETTLE_LAPS after the stop; otherwise FAILED;
     UNCLEAR when position data can't answer (rendered as nothing)
   · outLapDelta compares the chaser's first clean lap after the
     stop against the target's clean lap on the same race lap —
     positive = the tire offset actually converted to pace

   Honesty rules honored here:
   - no interval data at the pit lap ⇒ NOT an attempt, never guessed
   - SC / VSC / RED pit stops are free stops, excluded entirely
   - targetAlsoPitted flags swaps that may be cycle phase, not pace
   - 'unclear' outcomes are kept for the ledger but never narrated
   ============================================================ */

import type { SessionData } from '../../data/types'
import type { FlagTimeline } from '../flags'
import type { RaceStateIndex, GapSample } from '../raceState'
import { classifyLaps } from './classify'
import type { LapPoint } from './types'

// ---------- the heuristics, named ----------

/** closer than this at pit entry ⇒ the stop counts as an undercut attempt */
export const UNDERCUT_MAX_GAP_S = 2.5
/** positions are compared this many laps after the stop */
export const UNDERCUT_SETTLE_LAPS = 2
/** settle-time fallback when the chaser's own lap rows don't reach that far */
const FALLBACK_SETTLE_S = 150

export interface UndercutEvent {
  chaser: number
  target: number
  /** chaser's pit lap */
  lap: number
  /** session time of pit entry */
  t: number
  /** interval to the car ahead at pit entry (s); NaN unknown */
  gapAtPit: number
  outcome: 'success' | 'failed' | 'unclear'
  /** first race lap the chaser ran ahead of target (null if never did) */
  swapLap: number | null
  /**
   * chaser's first clean out-lap vs target's clean lap on the same lap.
   * positive = chaser quicker. NaN when either side lacks a clean sample.
   */
  outLapDelta: number
  /** target pitted within the settle window — swap may be cycle phase */
  targetAlsoPitted: boolean
}

export interface UndercutModel {
  /** sorted by t */
  events: UndercutEvent[]
  byChaser: Map<number, UndercutEvent[]>
  byTarget: Map<number, UndercutEvent[]>
}

function emptyModel(): UndercutModel {
  return { events: [], byChaser: new Map(), byTarget: new Map() }
}

function lapStartTime(data: SessionData, driver: number, lap: number): number | null {
  for (const l of data.laps) {
    if (l.driver_number === driver && l.lap_number === lap && Number.isFinite(l.t)) return l.t
  }
  return null
}

/** first clean lap at/after `from` for a driver (null if none) */
function firstCleanFrom(points: LapPoint[], from: number): LapPoint | null {
  for (const p of points) {
    if (p.lap >= from && p.kind === 'clean' && Number.isFinite(p.sec)) return p
  }
  return null
}

export function buildUndercuts(data: SessionData, idx: RaceStateIndex, flags: FlagTimeline): UndercutModel {
  if (data.meta.session_type !== 'Race') return emptyModel()

  // pit stops under SC / VSC / RED are free stops, not undercut bets —
  // caution freezes the intervals small and would fool the attempt gate.
  // OpenF1 also logs suspended-race service stops AFTER the span ends
  // (laps never advance while red), so the honest key is the pit's
  // RACE LAP falling inside the caution window, not just wall time.
  const inCaution = (t: number, lap: number): boolean => {
    for (const s of flags.spans) {
      if (s.phase !== 'SC' && s.phase !== 'VSC' && s.phase !== 'RED') continue
      if (t >= s.t0 - 5 && t <= s.t1 + 40) return true
      const lead0 = idx.leaderAt(s.t0)
      const lead1 = idx.leaderAt(s.t1)
      const lapA = lead0 !== null ? (idx.lapOf(lead0, s.t0) ?? 0) : 0
      const lapB = lead1 !== null ? (idx.lapOf(lead1, s.t1) ?? lapA) : lapA
      if (lap >= lapA && lap <= lapB + 1) return true
    }
    return false
  }

  const lapsByDriver = classifyLaps(data, flags)
  const pits = data.pits
    .filter((p) => Number.isFinite(p.t) && !inCaution(p.t, p.lapNumber))
    .sort((a, b) => a.t - b.t)
  const events: UndercutEvent[] = []
  const gapSample: GapSample = { gap: NaN, interval: NaN, gapLaps: 0 }

  for (const pit of pits) {
    const chaser = pit.driverNumber
    // who is directly ahead at pit entry?
    const posC = idx.positionOf(chaser, pit.t)
    if (posC === null || posC <= 1) continue // leader has nobody to jump
    const target = idx.orderAt(pit.t)[posC - 2]
    if (target === undefined || target === chaser) continue

    // attempt gate: measured closeness at the moment of commitment
    idx.gapOf(chaser, pit.t, gapSample)
    const gapAtPit = gapSample.interval
    if (!Number.isFinite(gapAtPit) || Math.abs(gapAtPit) > UNDERCUT_MAX_GAP_S) continue

    // settle time: chaser's own calendar N laps later (their lap rows = truth)
    const settleLap = pit.lapNumber + UNDERCUT_SETTLE_LAPS
    const tSettle = lapStartTime(data, chaser, settleLap) ?? pit.t + FALLBACK_SETTLE_S

    let outcome: UndercutEvent['outcome'] = 'unclear'
    let swapLap: number | null = null
    const posCs = idx.positionOf(chaser, tSettle)
    const posTs = idx.positionOf(target, tSettle)
    if (posCs !== null && posTs !== null) {
      outcome = posCs < posTs ? 'success' : 'failed'
      if (outcome === 'success') {
        for (let L = pit.lapNumber + 1; L <= settleLap; L++) {
          const tl = lapStartTime(data, chaser, L)
          if (tl === null) break
          const pc = idx.positionOf(chaser, tl)
          const pt = idx.positionOf(target, tl)
          if (pc !== null && pt !== null && pc < pt) {
            swapLap = L
            break
          }
        }
      }
    }



    // did the offset convert to pace? first clean lap out vs target same lap
    const cl = lapsByDriver.get(chaser)
    const tlaps = lapsByDriver.get(target)
    let outLapDelta = NaN
    if (cl && tlaps) {
      const out = firstCleanFrom(cl, pit.lapNumber + 1)
      if (out) {
        const counterpart =
          tlaps.find((p) => p.lap === out.lap && p.kind === 'clean' && Number.isFinite(p.sec)) ??
          tlaps.find(
            (p) => Math.abs(p.lap - out.lap) <= 1 && p.kind === 'clean' && Number.isFinite(p.sec),
          )
        if (counterpart) outLapDelta = counterpart.sec - out.sec
      }
    }

    const targetAlsoPitted = pits.some(
      (q) => q.driverNumber === target && q.lapNumber >= pit.lapNumber && q.lapNumber <= settleLap,
    )

    events.push({
      chaser,
      target,
      lap: pit.lapNumber,
      t: pit.t,
      gapAtPit,
      outcome,
      swapLap,
      outLapDelta,
      targetAlsoPitted,
    })
  }

  const byChaser = new Map<number, UndercutEvent[]>()
  const byTarget = new Map<number, UndercutEvent[]>()
  for (const e of events) {
    let a = byChaser.get(e.chaser)
    if (!a) byChaser.set(e.chaser, (a = []))
    a.push(e)
    let b = byTarget.get(e.target)
    if (!b) byTarget.set(e.target, (b = []))
    b.push(e)
  }

  return { events, byChaser, byTarget }
}

// ---------- cursor reads ----------

export interface UndercutThreat {
  target: number
  /** measured interval to that car right now (s) */
  gap: number
}

/**
 * Live threat read at the playhead: the focus car is within undercut
 * range of the car directly ahead RIGHT NOW. Binary searches only —
 * cheap enough per tick. Null means "no story — render nothing".
 */
export function undercutThreatAt(idx: RaceStateIndex, driver: number, t: number): UndercutThreat | null {
  const pos = idx.positionOf(driver, t)
  if (pos === null || pos <= 1) return null
  const target = idx.orderAt(t)[pos - 2]
  if (target === undefined) return null
  const g: GapSample = { gap: NaN, interval: NaN, gapLaps: 0 }
  idx.gapOf(driver, t, g)
  if (!Number.isFinite(g.interval) || Math.abs(g.interval) > UNDERCUT_MAX_GAP_S) return null
  return { target, gap: Math.abs(g.interval) }
}

