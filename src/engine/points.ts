/* ============================================================
   Championship points, live — the swing the pit wall actually
   cares about. Positions → projected points at any instant; the
   swing feed then narrates the moments the PROJECTION changed:
   the points lead changing hands, the podium set re-forming,
   a driver falling out of the top ten.
   ============================================================ */

import type { SessionData } from '../data/types'
import type { RaceStateIndex } from './raceState'

/** standard F1 points, index = position - 1 */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

export function pointsFor(position: number): number {
  return position >= 1 && position <= POINTS.length ? POINTS[position - 1] : 0
}

export interface PointsSwing {
  t: number
  /** driver who gained projection */
  driver: number
  /** net points change for the gaining driver */
  delta: number
  /** true when the points LEAD itself changed hands */
  leadChange: boolean
  /** the new projected leader after the swing */
  leader: number
}

/**
 * Walk the position change-log and emit the moments where the projected
 * championship picture moved. Only swings of >= 2 points are worth a
 * row — a P7↔P8 swap (4↔6 pts) is a swing; a P14↔P15 swap is not.
 */
export function buildPointsSwings(data: SessionData, idx: RaceStateIndex): PointsSwing[] {
  if (data.meta.session_type !== 'Race') return []
  const P = data.positions
  if (P.t.length === 0) return []

  // running projection per driver, from the change-log itself
  const pts = new Map<number, number>()
  let leader: number | null = null
  const swings: PointsSwing[] = []

  // grid order establishes the opening projection (published starting grid
  // where present, else first known positions — the same orderAt uses)
  const order0 = idx.orderAt(P.t[0] - 1)
  order0.forEach((d, i) => pts.set(d, pointsFor(i + 1)))
  if (order0.length > 0) leader = order0[0]

  // a story that narrates every front-field swap drowns itself; the
  // projection state always updates, but LEAD-CHANGE rows carry a cooldown
  const LEAD_COOLDOWN_S = 30
  let lastLeadRowT = -Infinity

  for (let i = 0; i < P.t.length; i++) {
    const d = P.driver[i]
    const pos = P.position[i]
    const before = pts.get(d) ?? 0
    const after = pointsFor(pos)
    if (after === before) continue
    pts.set(d, after)

    // the projected leader: strictly more points wins; ties keep the
    // current leader — a tie must never register as a change of hands
    let newLeader = leader
    let newBest = leader !== null ? pts.get(leader) ?? 0 : -1
    for (const [dd, p] of pts) {
      if (p > newBest) {
        newBest = p
        newLeader = dd
      }
    }
    const leaderPts = leader !== null ? pts.get(leader) ?? 0 : -1
    const rawLeadChange = newLeader !== null && newLeader !== leader && newBest > leaderPts
    const leadChange = rawLeadChange && P.t[i] - lastLeadRowT >= LEAD_COOLDOWN_S
    if (leadChange) lastLeadRowT = P.t[i]
    if (Math.abs(after - before) >= 2 || leadChange) {
      swings.push({ t: P.t[i], driver: d, delta: after - before, leadChange, leader: newLeader ?? d })
      if (rawLeadChange) leader = newLeader
    }
  }
  return swings
}

/** Projected points for the whole field at time t (0 outside the top ten). */
export function livePointsAt(idx: RaceStateIndex, t: number): Map<number, number> {
  const out = new Map<number, number>()
  const order = idx.orderAt(t)
  order.forEach((d, i) => out.set(d, pointsFor(i + 1)))
  return out
}
