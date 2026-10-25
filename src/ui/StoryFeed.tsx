/* ============================================================
   The story feed — what the Moments Engine has to say.
   ENGINEER: terse machine log. BROADCAST: commentator prose.
   CINEMA: only the freshest beat, as a subtitle over the scene.
   ============================================================ */

import { useMemo } from 'react'
import { raceClock } from '../engine/RaceClock'
import type { Moment, MomentType } from '../engine/moments'
import { narrate } from '../engine/narrate'
import { useAppStore } from '../state/appStore'
import { useUiPulse } from './useUiPulse'

const ICON: Record<MomentType, string> = {
  overtake: '⇅',
  pit: '◨',
  undercut: '⇄',
  battle_swing: '↗',
  fastest_lap: '◆',
  battle: '⚔',
  sc: '▲',
  vsc: '△',
  red: '■',
  yellow: '▰',
  rain_start: '☂',
  rain_stop: '☼',
  race_start: '▶',
  chequered: '⏁',
}

const TONE: Partial<Record<MomentType, string>> = {
  fastest_lap: 'is-purple',
  sc: 'is-amber',
  vsc: 'is-amber',
  yellow: 'is-amber',
  red: 'is-red',
  rain_start: 'is-blue',
  overtake: 'is-green',
  undercut: 'is-green',
  battle_swing: 'is-amber',
}

function lapOfMoment(m: Moment): string {
  const lap = /LAP (\d+)/.exec(m.label)?.[1]
  return lap ? `L${lap}` : ''
}

export function StoryFeed() {
  const session = useAppStore((s) => s.session)
  const moments = useAppStore((s) => s.moments)
  const density = useAppStore((s) => s.density)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const pulse = useUiPulse()

  const visible = useMemo(() => {
    if (!moments) return []
    const t = pulse.t
    const out: Moment[] = []
    for (let i = moments.moments.length - 1; i >= 0 && out.length < 9; i--) {
      const m = moments.moments[i]
      if (m.t <= t) out.push(m)
    }
    return out
  }, [moments, pulse.t])

  if (!session || !moments) return null

  // CINEMA — a single fresh subtitle
  if (density === 0) {
    const fresh = visible.find((m) => pulse.t - m.t < 9)
    if (!fresh) return null
    const n = narrate(fresh, session)
    return (
      <div className="subtitle">
        <span className="subtitle__title">{n.title}</span>
        {n.sub && <span className="subtitle__sub">{n.sub}</span>}
        {n.hedge && <span className="subtitle__sub feed__hedge">△ {n.hedge}</span>}
      </div>
    )
  }

  return (
    <aside className="feed panel">
      <div className="feed__head label">
        RACE INTELLIGENCE
        <span className="feed__mode mono">{density === 1 ? 'BROADCAST' : 'ENGINEER'}</span>
      </div>
      <div className="feed__list">
        {visible.map((m, mi) => {
          // index tie-break: two moment TYPES can share {t, drivers} (a
          // rain_start and a rain_stop on the same second, a red + yellow
          // span starting together) — the old key collided and React
          // duplicated/omitted rows, so the feed dropped beats at random
          const key = `${m.type}-${m.t.toFixed(1)}-${mi}`
          const isNew = pulse.t - m.t < 6
          if (density >= 2) {
            // engineer: machine log
            const lapNo = raceIndex && m.drivers[0] !== undefined ? raceIndex.lapOf(m.drivers[0], m.t) : null
            return (
              <button className={`feed__row mono ${isNew ? 'is-new' : ''}`} key={key} onClick={() => seek(m)}>
                <span className={`feed__icon ${TONE[m.type] ?? ''}`}>{ICON[m.type]}</span>
                <span className="feed__label">{m.label}</span>
                <span className="feed__t">{lapNo ? `L${lapNo}` : lapOfMoment(m)}</span>
              </button>
            )
          }
          const n = narrate(m, session)
          return (
            <button className={`feed__card ${isNew ? 'is-new' : ''}`} key={key} onClick={() => seek(m)}>
              <span className={`feed__icon ${TONE[m.type] ?? ''}`}>{ICON[m.type]}</span>
              <span className="feed__body">
                <span className="feed__title">{n.title}</span>
                {n.sub && <span className="feed__sub">{n.sub}</span>}
                {n.hedge && <span className="feed__sub feed__hedge">△ {n.hedge}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function seek(m: Moment) {
  // jump the theatre to just before the moment
  raceClock.seek(Math.max(raceClock.tMin, m.t - 5))
}
