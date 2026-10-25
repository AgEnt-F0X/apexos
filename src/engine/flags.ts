/* ============================================================
   Flag state machine — race_control messages → track state at
   any time t: global flag phase + per-sector yellows.
   Precomputed as sorted span lists; queried per frame.
   ============================================================ */

import type { RaceControlEvent, SessionData } from '../data/types'

export type FlagPhase = 'GREEN' | 'YELLOW' | 'SC' | 'VSC' | 'RED' | 'CHEQUERED'

export interface FlagSpan {
  t0: number
  t1: number
  phase: FlagPhase
}

export interface SectorYellowSpan {
  t0: number
  t1: number
  sector: number // 1..3 (mini-sector yellows are mapped to their macro sector)
}

export interface FlagTimeline {
  spans: FlagSpan[] // non-GREEN spans, sorted by t0
  sectorYellows: SectorYellowSpan[]
  phaseAt(t: number): FlagPhase
  /** returns strength 0..1 per macro sector at t (with a short fade-out tail) */
  sectorPulseAt(t: number, out: [number, number, number]): [number, number, number]
}

const msg = (r: RaceControlEvent) => r.message.toUpperCase()

export function buildFlagTimeline(data: SessionData): FlagTimeline {
  const rc = data.raceControl
  const tEnd = data.tMax

  const spans: FlagSpan[] = []
  let open: FlagSpan | null = null

  const openPhase = (t: number, phase: FlagPhase) => {
    if (open && open.phase === phase) return
    closePhase(t)
    open = { t0: t, t1: tEnd, phase }
    spans.push(open)
  }
  const closePhase = (t: number) => {
    if (open) {
      open.t1 = t
      open = null
    }
  }

  for (const r of rc) {
    const M = msg(r)
    const cat = r.category.toUpperCase()

    if (cat === 'SAFETYCAR' || M.includes('SAFETY CAR')) {
      if (M.includes('VIRTUAL')) {
        if (M.includes('DEPLOYED')) openPhase(r.t, 'VSC')
        else if (M.includes('ENDING') || M.includes('END')) closePhase(r.t)
      } else {
        if (M.includes('DEPLOYED')) openPhase(r.t, 'SC')
        else if (M.includes('IN THIS LAP') || M.includes('ENDING')) closePhase(r.t + 40) // field bunches until restart
      }
      continue
    }

    if (r.flag === 'RED') {
      openPhase(r.t, 'RED')
      continue
    }
    if (r.flag === 'CHEQUERED') {
      openPhase(r.t, 'CHEQUERED')
      continue
    }
    if (r.flag === 'GREEN' || M.includes('TRACK CLEAR')) {
      closePhase(r.t)
      continue
    }
    // track-wide yellow (no sector scope)
    if (r.flag === 'YELLOW' && r.scope !== 'Sector' && !M.includes('SECTOR')) {
      openPhase(r.t, 'YELLOW')
      continue
    }
    if (r.flag === 'CLEAR' && r.scope !== 'Sector') {
      closePhase(r.t)
    }
  }

  // sector yellows: open on YELLOW/DOUBLE YELLOW in sector N, close on CLEAR in same sector
  const sectorYellows: SectorYellowSpan[] = []
  const openSector = new Map<number, SectorYellowSpan>()
  const macroSectorOf = (r: RaceControlEvent): number | null => {
    if (r.sector === null) return null
    // race control 'sector' is the marshal mini-sector (1..~20); map to thirds
    if (r.sector <= 3) return r.sector // already macro in some seasons
    const MINI_SECTORS = 20
    return Math.min(3, 1 + Math.floor(((r.sector - 1) / MINI_SECTORS) * 3))
  }
  for (const r of rc) {
    if (r.scope !== 'Sector' && !msg(r).includes('SECTOR')) continue
    const s = macroSectorOf(r)
    if (s === null) continue
    if (r.flag === 'YELLOW' || r.flag === 'DOUBLE YELLOW') {
      if (!openSector.has(s)) {
        const span = { t0: r.t, t1: Math.min(r.t + 120, tEnd), sector: s }
        openSector.set(s, span)
        sectorYellows.push(span)
      }
    } else if (r.flag === 'CLEAR' || r.flag === 'GREEN') {
      const span = openSector.get(s)
      if (span) {
        span.t1 = r.t
        openSector.delete(s)
      }
    }
  }

  const phaseAt = (t: number): FlagPhase => {
    // few dozen spans max — linear scan is fine at 8 Hz
    for (let i = spans.length - 1; i >= 0; i--) {
      const s = spans[i]
      if (t >= s.t0 && t < s.t1) return s.phase
    }
    return 'GREEN'
  }

  const FADE = 6
  const sectorPulseAt = (t: number, out: [number, number, number]): [number, number, number] => {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    for (const y of sectorYellows) {
      if (t >= y.t0 && t < y.t1 + FADE) {
        const fade = t > y.t1 ? 1 - (t - y.t1) / FADE : 1
        const i = y.sector - 1
        if (i >= 0 && i < 3) out[i] = Math.max(out[i], fade)
      }
    }
    // track-wide states pulse everywhere
    const phase = phaseAt(t)
    if (phase === 'YELLOW' || phase === 'SC' || phase === 'VSC') {
      out[0] = Math.max(out[0], 0.8)
      out[1] = Math.max(out[1], 0.8)
      out[2] = Math.max(out[2], 0.8)
    }
    return out
  }

  return { spans, sectorYellows, phaseAt, sectorPulseAt }
}
