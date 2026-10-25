/* ============================================================
   The Density Dial — semantic zoom as a physical control.
   One surface, three anchors: CINEMA / BROADCAST / ENGINEER.
   The interface recomposes around it; nothing toggles, it
   morphs. (Key: D cycles.)
   ============================================================ */

import { useAppStore, type Density } from '../state/appStore'

const ANCHORS: Array<{ id: Density; label: string; hint: string }> = [
  { id: 0, label: 'CINEMA', hint: 'pure theatre — the race as a film' },
  { id: 1, label: 'BROADCAST', hint: 'story first — plain language' },
  { id: 2, label: 'ENGINEER', hint: 'full density — the pit wall' },
]

export function DensityDial() {
  const density = useAppStore((s) => s.density)
  const setDensity = useAppStore((s) => s.setDensity)

  return (
    <div className="dial" role="radiogroup" aria-label="information density">
      <span className="dial__glyph" aria-hidden>
        ◐
      </span>
      <div className="dial__track">
        <div
          className="dial__thumb"
          style={{ transform: `translateX(${density * 100}%)` }}
          aria-hidden
        />
        {ANCHORS.map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={density === a.id}
            className={`dial__stop mono ${density === a.id ? 'is-active' : ''}`}
            title={a.hint}
            onClick={() => setDensity(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
