/* ============================================================
   The Moments Engine — the interpretation layer. Scans a
   session once and derives the events humans actually talk
   about: overtakes, pit stops, battles, fastest laps, weather
   shifts, flags. Powers the story feed, the DNA strip's drama
   topology, temporal lensing (Phase 3) and the Director
   (Phase 4).
   ============================================================ */

import type { OvertakeEvent, SessionData } from '../data/types'
import type { FlagTimeline } from './flags'
import { RaceStateIndex } from './raceState'
import { buildUndercuts } from './metrics/undercut'
import { buildGapDynamics } from './metrics/gapDynamics'

export type MomentType =
  | 'overtake'
  | 'pit'
  | 'undercut'
  | 'battle_swing'
  | 'fastest_lap'
  | 'battle'
  | 'sc'
  | 'vsc'
  | 'red'
  | 'yellow'
  | 'rain_start'
  | 'rain_stop'
  | 'race_start'
  | 'chequered'

export interface Moment {
  t: number
  /** for span moments (battle, sc…) */
  tEnd?: number
  type: MomentType
  /** primary driver(s) involved (numbers) */
  drivers: number[]
  /** short machine label; Phase 3 narration turns these into prose */
  label: string
  /** 0..1 how much this should bend attention/time */
  severity: number
  /** honesty hedge — conditions that soften the claim (narration surfaces it) */
  note?: string
}

export interface MomentsModel {
  moments: Moment[] // sorted by t
  /** drama density curve, 1 Hz from tMin */
  drama: Float32Array
  dramaT0: number
  dramaAt(t: number): number
}

const BATTLE_GAP_S = 1.4
const BATTLE_MIN_SPAN_S = 25

export function buildMoments(data: SessionData, idx: RaceStateIndex, flags: FlagTimeline): MomentsModel {
  const moments: Moment[] = []
  const isRace = data.meta.session_type === 'Race'
  const nameOf = (d: number) => data.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`

  // --- race start ---
  if (isRace && Number.isFinite(data.tAction)) {
    moments.push({
      t: data.tAction + 8,
      type: 'race_start',
      drivers: [],
      label: 'LIGHTS OUT',
      severity: 1,
    })
  }

  // --- overtakes: position gains inside the points-visible field ---
  // The position change-log gives dense, well-timed candidates; the /overtakes
  // table (data.overtakes) is the authoritative on-track-pass source but is
  // often incomplete. We cross-check: an inferred pass within ±6 s of an
  // official pass by the same driver is labelled confirmed; official passes
  // the position log missed are appended. Everything stays honestly sourced.
  if (isRace) {
    const P = data.positions
    const OFF = data.overtakes
    // official passes bucketed by overtaking driver for a ±6 s window match
    const officialAt = (d: number, t: number): OvertakeEvent | undefined => {
      for (const o of OFF) {
        if (o.overtaking === d && Math.abs(o.t - t) <= 6) return o
      }
      return undefined
    }
    const matchedOfficial = new Set<OvertakeEvent>()
    // per driver last position, walk change-log in time order
    const lastPos = new Map<number, number>()
    for (let i = 0; i < P.t.length; i++) {
      const d = P.driver[i]
      const p = P.position[i]
      const prev = lastPos.get(d)
      lastPos.set(d, p)
      if (prev === undefined || p >= prev) continue
      if (P.t[i] < data.tAction + 20) continue // grid shuffle noise
      // who did they take? the car now directly behind
      const order = idx.orderAt(P.t[i] + 1)
      const victim = order[p] // 0-based: position p is index p-1; victim at index p
      const severity = Math.max(0.35, 1 - (p - 1) * 0.06)
      const off = officialAt(d, P.t[i])
      if (off) matchedOfficial.add(off)
      moments.push({
        t: P.t[i],
        type: 'overtake',
        drivers: victim !== undefined ? [d, victim] : [d],
        label: `${nameOf(d)} → P${p}${victim !== undefined ? ` (past ${nameOf(victim)})` : ''}`,
        severity,
        note: off ? 'confirmed by /overtakes' : undefined,
      })
    }
    // authoritative passes the position log never caught (sector-timed swaps,
    // same-lap traffic) — appended with their own confidence note
    for (const o of OFF) {
      if (matchedOfficial.has(o)) continue
      const victim = o.overtaken !== undefined ? [o.overtaking, o.overtaken] : [o.overtaking]
      moments.push({
        t: o.t,
        type: 'overtake',
        drivers: victim,
        label: `${nameOf(o.overtaking)} → P${o.position}${o.overtaken !== undefined ? ` (past ${nameOf(o.overtaken)})` : ''}`,
        severity: Math.max(0.35, 1 - (o.position - 1) * 0.06),
        note: '/overtakes only — not seen in position log',
      })
    }
  }

  // --- pit stops ---
  for (const p of data.pits) {
    if (!Number.isFinite(p.t)) continue
    moments.push({
      t: p.t,
      type: 'pit',
      drivers: [p.driverNumber],
      label: `${nameOf(p.driverNumber)} PITS — LAP ${p.lapNumber}`,
      severity: 0.45,
    })
  }

  // --- undercuts: classified attempts ONLY — narration never claims what we can't see ---
  if (isRace) {
    for (const e of buildUndercuts(data, idx, flags).events) {
      if (e.outcome === 'unclear') continue
      moments.push({
        t: e.t + 20, // surface just after the stop, once the bet is legible
        type: 'undercut',
        drivers: [e.chaser, e.target],
        label:
          e.outcome === 'success'
            ? `${nameOf(e.chaser)} UNDERCUTS ${nameOf(e.target)} — LAP ${e.lap}`
            : `${nameOf(e.chaser)} UNDERCUT FAILS VS ${nameOf(e.target)} — LAP ${e.lap}`,
        severity: e.outcome === 'success' ? 0.65 : 0.35,
        note: e.targetAlsoPitted ? 'target also pitted — swap may be cycle phase, not pace' : undefined,
      })
    }
  }

  // --- battle swings: sustained closes (Drama v2) — a PREDICTION, hedged as such ---
  if (isRace) {
    for (const s of buildGapDynamics(data, idx, flags).swings) {
      moments.push({
        t: s.t,
        type: 'battle_swing',
        drivers: [s.chaser, s.target],
        label: `${nameOf(s.chaser)} CLOSING ON ${nameOf(s.target)} — ${Math.abs(s.ratePerLap).toFixed(1)}s/LAP · ${s.gapFrom.toFixed(1)}s BACK`,
        severity: 0.4,
        note: 'prediction from gap trend — the pass is not guaranteed',
      })
    }
  }

  // --- fastest laps (session-best progression, after early laps) ---
  if (isRace) {
    let best = Infinity
    for (const l of data.laps) {
      if (l.lap_duration === null || !Number.isFinite(l.t) || l.lap_number < 3) continue
      if (l.lap_duration < best) {
        best = l.lap_duration
        moments.push({
          t: l.t + l.lap_duration,
          type: 'fastest_lap',
          drivers: [l.driver_number],
          label: `${nameOf(l.driver_number)} FASTEST LAP ${formatLap(l.lap_duration)}`,
          severity: 0.5,
        })
      }
    }
  }

  // --- battles: sustained interval < threshold ---
  if (isRace) {
    const I = data.intervals
    const open = new Map<number, { t0: number; minGap: number; lastT: number }>()
    for (let i = 0; i < I.t.length; i++) {
      const d = I.driver[i]
      const iv = I.interval[i]
      const t = I.t[i]
      const b = open.get(d)
      const inBattle = Number.isFinite(iv) && iv < BATTLE_GAP_S && iv >= 0 && t > data.tAction + 60
      if (inBattle) {
        if (!b) open.set(d, { t0: t, minGap: iv, lastT: t })
        else {
          b.minGap = Math.min(b.minGap, iv)
          b.lastT = t
        }
      } else if (b) {
        commitBattle(d, b)
        open.delete(d)
      }
    }
    for (const [d, b] of open) commitBattle(d, b)

    function commitBattle(d: number, b: { t0: number; minGap: number; lastT: number }) {
      if (b.lastT - b.t0 < BATTLE_MIN_SPAN_S) return
      const mid = (b.t0 + b.lastT) / 2
      const order = idx.orderAt(mid)
      const pos = idx.positionOf(d, mid)
      const ahead = pos !== null && pos >= 2 ? order[pos - 2] : undefined
      moments.push({
        t: b.t0,
        tEnd: b.lastT,
        type: 'battle',
        drivers: ahead !== undefined ? [d, ahead] : [d],
        label: `${nameOf(d)}${ahead !== undefined ? ` HUNTS ${nameOf(ahead)}` : ''} — ${b.minGap.toFixed(1)}s`,
        severity: Math.min(1, 0.5 + (BATTLE_GAP_S - b.minGap) * 0.5 + (b.lastT - b.t0) / 600),
      })
    }
  }

  // --- flag phases as moments ---
  for (const s of flags.spans) {
    const map: Partial<Record<string, { type: MomentType; label: string; sev: number }>> = {
      SC: { type: 'sc', label: 'SAFETY CAR DEPLOYED', sev: 0.9 },
      VSC: { type: 'vsc', label: 'VIRTUAL SAFETY CAR', sev: 0.7 },
      RED: { type: 'red', label: 'RED FLAG — SESSION HALTED', sev: 1 },
      YELLOW: { type: 'yellow', label: 'YELLOW FLAG', sev: 0.4 },
      CHEQUERED: { type: 'chequered', label: 'CHEQUERED FLAG', sev: 0.9 },
    }
    const m = map[s.phase]
    if (m) moments.push({ t: s.t0, tEnd: s.t1, type: m.type, drivers: [], label: m.label, severity: m.sev })
  }

  // --- rain transitions ---
  let raining = false
  for (const w of data.weather) {
    const wet = w.rainfall > 0
    if (wet !== raining) {
      raining = wet
      moments.push({
        t: w.t,
        type: wet ? 'rain_start' : 'rain_stop',
        drivers: [],
        label: wet ? 'RAIN ON TRACK' : 'RAIN CLEARING',
        severity: wet ? 0.75 : 0.4,
      })
    }
  }

  // --- Drama v2: stakes weighting — moments involving eventual podium finishers bend time more.
  // The v4 results table carries the championship context: a fight that ends on the podium
  // IS a bigger story, and the drama curve should know that before the chequered flag.
  if (isRace && data.results.length > 0) {
    const podium = new Set(
      data.results
        .filter((r) => r.position !== null && r.position <= 3 && !r.dnf && !r.dsq)
        .map((r) => r.driverNumber),
    )
    if (podium.size > 0) {
      for (const m of moments) {
        if (m.type !== 'overtake' && m.type !== 'battle' && m.type !== 'undercut' && m.type !== 'battle_swing')
          continue
        if (m.drivers.some((d) => podium.has(d))) m.severity = Math.min(1, m.severity * 1.25)
      }
    }
  }

  moments.sort((a, b) => a.t - b.t)

  // --- drama density: 1 Hz gaussian splat of moment severity ---
  const dramaT0 = data.tMin
  const n = Math.max(2, Math.ceil(data.tMax - data.tMin))
  const drama = new Float32Array(n)
  for (const m of moments) {
    const sigma = m.type === 'battle' ? 20 : 14
    const center = m.t
    const end = m.tEnd ?? m.t
    const from = Math.max(0, Math.floor(center - dramaT0 - sigma * 3))
    const to = Math.min(n - 1, Math.ceil(end - dramaT0 + sigma * 3))
    for (let i = from; i <= to; i++) {
      const t = dramaT0 + i
      // distance to the span [center, end]
      const d = t < center ? center - t : t > end ? t - end : 0
      drama[i] += m.severity * Math.exp(-(d * d) / (2 * sigma * sigma))
    }
  }
  // normalize to 0..1 against a high percentile
  const sorted = Float32Array.from(drama).sort()
  const p97 = sorted[Math.floor((n - 1) * 0.97)] || 1
  for (let i = 0; i < n; i++) drama[i] = Math.min(1, drama[i] / p97)

  const dramaAt = (t: number): number => {
    const i = Math.round(t - dramaT0)
    return i >= 0 && i < n ? drama[i] : 0
  }

  return { moments, drama, dramaT0, dramaAt }
}

export function formatLap(s: number): string {
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${m}:${rest.toFixed(3).padStart(6, '0')}`
}
