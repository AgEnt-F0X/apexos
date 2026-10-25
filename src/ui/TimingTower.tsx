/* ============================================================
   The timing tower — the pit wall's heartbeat. Live positions,
   gaps, tire state. Rows physically glide when positions change
   (the reorder IS the overtake). Click a row to focus + chase.
   ============================================================ */

import { useMemo } from 'react'
import { useAppStore } from '../state/appStore'
import { useUiPulse } from './useUiPulse'
import type { GapSample } from '../engine/raceState'

const ROW_H = 26

const COMPOUND: Record<string, { letter: string; cls: string }> = {
  SOFT: { letter: 'S', cls: 'c-soft' },
  MEDIUM: { letter: 'M', cls: 'c-medium' },
  HARD: { letter: 'H', cls: 'c-hard' },
  INTERMEDIATE: { letter: 'I', cls: 'c-inter' },
  WET: { letter: 'W', cls: 'c-wet' },
  UNKNOWN: { letter: '·', cls: 'c-unknown' },
}

function gapText(pos: number, g: GapSample): string {
  if (pos === 1) return 'LEADER'
  if (g.gapLaps > 0) return `+${g.gapLaps}L`
  if (Number.isFinite(g.gap)) return `+${g.gap.toFixed(g.gap < 10 ? 1 : 0)}`
  return '—'
}

export function TimingTower() {
  const session = useAppStore((s) => s.session)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const focusDriver = useAppStore((s) => s.focusDriver)
  const setFocusDriver = useAppStore((s) => s.setFocusDriver)
  const setCameraMode = useAppStore((s) => s.setCameraMode)
  const density = useAppStore((s) => s.density)
  const pulse = useUiPulse()
  // BROADCAST shows the sharp end; ENGINEER shows the whole field
  const shown = density >= 2 ? 99 : 6

  const driverInfo = useMemo(() => {
    const m = new Map<number, { acr: string; color: string }>()
    for (const d of session?.drivers ?? []) {
      m.set(d.driver_number, { acr: d.name_acronym || String(d.driver_number), color: `#${d.team_colour || '9aa7b8'}` })
    }
    return m
  }, [session])

  const rows = useMemo(() => {
    if (!session || !raceIndex) return []
    const t = pulse.t
    const order = raceIndex.orderAt(t)
    const g: GapSample = { gap: NaN, interval: NaN, gapLaps: 0 }
    return order.map((d, i) => {
      const pos = i + 1
      raceIndex.gapOf(d, t, g)
      const lap = raceIndex.lapOf(d, t)
      const stint = raceIndex.stintAt(d, lap)
      const ch = session.channels[d]
      const retired = ch ? t > ch.t0 + ch.n / ch.hz + 5 : true
      const inPit = session.pits.some((p) => p.driverNumber === d && t >= p.t - 6 && t <= p.t + 16)
      return {
        d,
        pos,
        gap: gapText(pos, g),
        compound: COMPOUND[stint?.compound ?? 'UNKNOWN'] ?? COMPOUND.UNKNOWN,
        age: stint?.age ?? 0,
        retired,
        inPit,
      }
    })
  }, [session, raceIndex, pulse.t])

  if (!session || rows.length === 0) return null
  const visibleRows = rows.filter((r) => r.pos <= shown)

  return (
    <aside className="tower panel" style={{ height: visibleRows.length * ROW_H + 34 }}>
      <div className="tower__head label">
        <span>POS</span>
        <span>DRIVER</span>
        <span className="tower__headGap">GAP</span>
      </div>
      <div className="tower__rows" style={{ height: visibleRows.length * ROW_H }}>
        {visibleRows.map((r) => {
          const info = driverInfo.get(r.d)
          return (
            <button
              key={r.d}
              className={`tower__row ${focusDriver === r.d ? 'is-focus' : ''} ${r.retired ? 'is-out' : ''}`}
              style={{ transform: `translateY(${(r.pos - 1) * ROW_H}px)` }}
              onClick={() => {
                setFocusDriver(r.d)
                setCameraMode('chase')
              }}
            >
              <span className="tower__pos mono">{r.pos}</span>
              <span className="tower__bar" style={{ background: info?.color }} />
              <span className="tower__acr mono">{info?.acr}</span>
              {r.inPit && <span className="tower__pit mono">PIT</span>}
              <span className={`tower__tire mono ${r.compound.cls}`}>
                {r.compound.letter}
                <i>{r.age}</i>
              </span>
              <span className="tower__gap mono">{r.retired ? 'OUT' : r.gap}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
