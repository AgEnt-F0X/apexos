/* ============================================================
   The timing tower — the pit wall's heartbeat. Live positions,
   gaps, tire state, and (ENGINEER) the last sector times with
   broadcast semantics: purple beat the session, green beat only
   the driver. Rows physically glide when positions change (the
   reorder IS the overtake). Click a row to focus + chase.
   ============================================================ */

import { useMemo } from 'react'
import { useAppStore } from '../state/appStore'
import { useUiPulse } from './useUiPulse'
import type { GapSample } from '../engine/raceState'
import { lastSectorsAt, type SectorEntry } from '../engine/sectorTimeline'
import { livePointsAt } from '../engine/points'

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

function sectorCell(e: SectorEntry | null): string {
  if (!e || !Number.isFinite(e.time)) return ''
  return e.time.toFixed(2)
}

export function TimingTower() {
  const session = useAppStore((s) => s.session)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const sectors = useAppStore((s) => s.sectors)
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
    const pts = density >= 2 && session.meta.session_type === 'Race' ? livePointsAt(raceIndex, t) : null
    return order.map((d, i) => {
      const pos = i + 1
      raceIndex.gapOf(d, t, g)
      const lap = raceIndex.lapOf(d, t)
      const stint = raceIndex.stintAt(d, lap)
      const ch = session.channels[d]
      const retired = ch ? t > ch.t0 + ch.n / ch.hz + 5 : true
      const inPit = session.pits.some((p) => p.driverNumber === d && t >= p.t - 6 && t <= p.t + 16)
      const sectorCells = sectors && density >= 2 ? lastSectorsAt(sectors, d, t) : null
      return {
        d,
        pos,
        gap: gapText(pos, g),
        compound: COMPOUND[stint?.compound ?? 'UNKNOWN'] ?? COMPOUND.UNKNOWN,
        age: stint?.age ?? 0,
        retired,
        inPit,
        pts: pts ? pts.get(d) ?? 0 : null,
        s: sectorCells ? [sectorCell(sectorCells[0]), sectorCell(sectorCells[1]), sectorCell(sectorCells[2])] : null,
        sCls: sectorCells
          ? sectorCells.map((e) => (e?.purple ? 'is-purple' : e?.green ? 'is-green' : ''))
          : null,
      }
    })
  }, [session, raceIndex, sectors, density, pulse.t])

  if (!session || rows.length === 0) return null
  const visibleRows = rows.filter((r) => r.pos <= shown)

  return (
    <aside className={`tower panel ${density >= 2 ? 'tower--engineer' : ''}`} style={{ height: visibleRows.length * ROW_H + 34 }}>
      <div className="tower__head label">
        <span>POS</span>
        <span>DRIVER</span>
        {density >= 2 && <span className="tower__headSectors">S1 · S2 · S3</span>}
        <span className="tower__headGap">{density >= 2 ? 'PTS · GAP' : 'GAP'}</span>
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
              {r.s && (
                <span className="tower__sectors mono">
                  {r.s.map((sv, si) => (
                    <i key={si} className={`tower__sector ${r.sCls?.[si] ?? ''}`}>{sv || '·'}</i>
                  ))}
                </span>
              )}
              <span className={`tower__tire mono ${r.compound.cls}`}>
                {r.compound.letter}
                <i>{r.age}</i>
              </span>
              {r.pts !== null && <span className="tower__pts mono">{r.pts > 0 ? r.pts : '·'}</span>}
              <span className="tower__gap mono">{r.retired ? 'OUT' : r.gap}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
