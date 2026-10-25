/* ============================================================
   Pit-bay model — the pure mapping and envelope behind the
   garage lights.

   Bay = Nth unique team colour in championship order (the same
   list the fascia colours are drawn from), so a stop in the
   real lights exactly that bay and never invents a colour
   that isn't on the grid. The envelope is a stop metabolised
   as light: brake on, hold, fade out. Dark only ever means
   "no car here".

   Kept free of three.js and React so the same functions run
   in the component AND in scripts/probe-pit-bays.ts — one
   implementation, no second copy to drift.
   ============================================================ */

import type { DriverRow, PitEvent } from '../data/types'

/** stop window: pre-light ramp + the stop itself + rejoining, seconds */
export const PIT_ENV_WINDOW = 6
/** how long the car is held in the box at full brightness */
export const PIT_ENV_STOP_S = 1.5
/** per-frame easing toward the target, so nothing snaps */
export const PIT_ENV_SMOOTH = 6

/** unique team colours in championship order — the fascia/bay order */
export function uniqueTeamColours(drivers: DriverRow[]): string[] {
  const seen: string[] = []
  for (const d of drivers) {
    const c = d.team_colour
    if (c && !seen.includes(c)) seen.push(c)
  }
  return seen
}

/**
 * How many bays the pit row has: one per real team, floored at 6 so a
 * short grid still reads as a full row, capped at 12 for visual sanity.
 * ONE function — the component's materials, its geometry and the probe
 * all read it, so box count and material count can never disagree (and
 * never leaves a white bay that no stop can ever light).
 */
export function pitBayCount(teamCount: number): number {
  return Math.max(6, Math.min(12, teamCount))
}

/** bay index for a driver's team; -1 when the colour is unknown */
export function pitBayOf(driverNumber: number, drivers: DriverRow[], teams: string[]): number {
  const row = drivers.find((d) => d.driver_number === driverNumber)
  if (!row?.team_colour) return -1
  return teams.indexOf(row.team_colour)
}

/**
 * Envelope 0..1 at scene time `t` for a stop at `stop.t`. The stop
 * timestamp IS the peak: the bay pre-lights as the car approaches
 * (0 at the window's edge → full as it arrives), holds full for the
 * stop, then fades back to dark as the car rejoins. A dark bay
 * therefore only ever means "no car here right now".
 */
export function pitEnvelope(t: number, stop: { t: number }): number {
  const dt = t - stop.t
  if (dt < -3 || dt > PIT_ENV_WINDOW) return 0
  if (dt < 0) return Math.max(0, 1 + dt / 3)
  if (dt < PIT_ENV_STOP_S) return 1
  if (dt < PIT_ENV_WINDOW) {
    const fade = (dt - PIT_ENV_STOP_S) / (PIT_ENV_WINDOW - PIT_ENV_STOP_S)
    return Math.max(0, 1 - fade)
  }
  return 0
}

/** the whole bay array at scene time t — what the lights should read */
export function pitBaysAt(t: number, pits: PitEvent[], drivers: DriverRow[], teams: string[], bayCount: number): number[] {
  const glow = new Array<number>(bayCount).fill(0)
  for (const p of pits) {
    const g = pitEnvelope(t, p)
    if (g <= 0) continue
    const bay = pitBayOf(p.driverNumber, drivers, teams)
    if (bay < 0 || bay >= bayCount) continue
    if (g > glow[bay]) glow[bay] = g
  }
  return glow
}
