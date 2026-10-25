/* ============================================================
   The UI heartbeat: an 8 Hz snapshot of frame-rate state
   (clock + race order) for React components. The 3D scene never
   waits for React; React just samples the world periodically.
   ============================================================ */

import { useEffect, useState } from 'react'
import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import type { FlagPhase } from '../engine/flags'

export interface UiPulse {
  t: number
  frac: number
  playing: boolean
  rate: number
  lap: number
  totalLaps: number
  leader: number | null
  phase: FlagPhase
  trackTemp: number | null
  raining: boolean
}

function snapshot(): UiPulse {
  const { raceIndex, flags, session } = useAppStore.getState()
  const t = raceClock.t
  const leader = raceIndex?.leaderAt(t) ?? null

  let trackTemp: number | null = null
  let raining = false
  if (session && session.weather.length > 0) {
    // weather is ~1/min; linear scan from a binary-search start is overkill — bisect
    const w = session.weather
    let lo = 0
    let hi = w.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (w[mid].t <= t) lo = mid
      else hi = mid - 1
    }
    trackTemp = w[lo].trackTemp
    raining = w[lo].rainfall > 0
  }

  return {
    t,
    frac: raceClock.frac,
    playing: raceClock.playing,
    rate: raceClock.rate,
    lap: leader !== null && raceIndex ? raceIndex.lapOf(leader, t) : 0,
    totalLaps: raceIndex?.totalLaps ?? 0,
    leader,
    phase: flags?.phaseAt(t) ?? 'GREEN',
    trackTemp,
    raining,
  }
}

export function useUiPulse(intervalMs = 125): UiPulse {
  const [pulse, setPulse] = useState<UiPulse>(snapshot)
  useEffect(() => {
    const id = setInterval(() => setPulse(snapshot()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return pulse
}

/** "+1:23:45" style session clock */
export function formatSessionTime(t: number): string {
  const sign = t < 0 ? '−' : '+'
  const a = Math.abs(t)
  const h = Math.floor(a / 3600)
  const m = Math.floor((a % 3600) / 60)
  const s = Math.floor(a % 60)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`
}
