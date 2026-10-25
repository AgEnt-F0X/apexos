/* ============================================================
   Narration — turns machine moments into broadcast language.
   BROADCAST mode speaks like a good commentator; ENGINEER mode
   uses the terse machine labels. This is the plain-language
   half of the information-design thesis.
   ============================================================ */

import type { SessionData } from '../data/types'
import type { Moment } from './moments'
import { formatLap } from './moments'

export interface Narration {
  title: string
  sub: string | null
  /** honesty hedge — surfaces the conditions that soften the claim */
  hedge?: string
}

export function narrate(m: Moment, session: SessionData): Narration {
  const nameOf = (d: number | undefined): string => {
    if (d === undefined) return '—'
    const drv = session.drivers.find((x) => x.driver_number === d)
    return drv?.last_name ?? drv?.name_acronym ?? `#${d}`
  }
  const A = nameOf(m.drivers[0])
  const B = nameOf(m.drivers[1])

  switch (m.type) {
    case 'race_start':
      return { title: 'Lights out!', sub: 'Watch turn one — everyone arrives at once with cold tires.' }
    case 'overtake': {
      const pos = /P(\d+)/.exec(m.label)?.[1]
      return {
        title: m.drivers.length > 1 ? `${A} takes ${B}` : `${A} gains a place`,
        sub: pos ? `Up to P${pos}. Position changes are the only currency here.` : null,
      }
    }
    case 'pit':
      return {
        title: `${A} pits`,
        sub: 'Fresh tires cost ~20s of track time. The bet: faster laps win it back.',
      }
    case 'undercut': {
      const failed = /FAILS/.test(m.label)
      return failed
        ? {
            title: `${A}'s undercut falls short`,
            sub: `Pitted right on ${B}'s tail — but the offset didn't convert. Track position held.`,
            hedge: m.note,
          }
        : {
            title: `${A} undercuts ${B}`,
            sub: 'Fresh rubber while the target stays out — the classic tire-offset bet, cashed in.',
            hedge: m.note,
          }
    }
    case 'battle_swing':
      return {
        title: `${A} is reeling in ${B}`,
        sub: `Gap shrinking lap after lap — this fight is coming to us. Watch for DRS.`,
        hedge: m.note,
      }
    case 'fastest_lap': {
      const time = /(\d+:\d+\.\d+)/.exec(m.label)?.[1]
      return {
        title: `${A} goes fastest${time ? ` — ${time}` : ''}`,
        sub: 'The purple lap. Pure pace, right now.',
      }
    }
    case 'battle':
      return {
        title: `${A} hunts ${B}`,
        sub: 'Under 1.4s — close enough for DRS and dirty air. Watch the braking zones.',
      }
    case 'sc':
      return {
        title: 'Safety Car',
        sub: 'The field bunches up. Gaps evaporate — cheap pit stops for everyone.',
      }
    case 'vsc':
      return {
        title: 'Virtual Safety Car',
        sub: 'Everyone slows to a delta time. The gaps freeze in place.',
      }
    case 'red':
      return {
        title: 'Red flag',
        sub: 'Session halted. Cars return to the pit lane and wait.',
      }
    case 'yellow':
      return { title: 'Yellow flag', sub: 'Caution — no overtaking in the affected sector.' }
    case 'rain_start':
      return {
        title: 'Rain on track',
        sub: 'Grip becomes a negotiation. Watch for dives into the pits for inters.',
      }
    case 'rain_stop':
      return { title: 'Rain easing', sub: 'A drying line will appear — slicks become a gamble worth taking.' }
    case 'chequered':
      return { title: 'Chequered flag', sub: null }
    default:
      return { title: m.label, sub: null }
  }
}

export { formatLap }
