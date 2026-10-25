/* ============================================================
   Driver Dossier — the ENGINEER-density successor to the HUD.
   One driver's whole race laid out as evidence:

   · lap-time scatter with EVERY classification visible
     (the metrics classifier is the single source of truth —
      the same kinds the tire fit uses are the ones you see)
   · stint table with fitted degradation slopes + fit quality
   · pace-vs-field trace against the per-lap field best

   Everything reads AT THE CURSOR (§0.7): the vertical hairline,
   the stint readout and the deg figure all move with RaceClock.
   No scrubber lives here — the dossier is a view, not a player.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import {
  metricsFor,
  consistencyOf,
  degAt,
  paceSeriesOf,
  undercutThreatAt,
  gapSlopeAt,
} from '../engine/metrics'
import type { LapPoint, TireDegModel } from '../engine/metrics/types'
import { formatLap } from '../engine/moments'
import { useAppStore } from '../state/appStore'
import { useUiPulse } from './useUiPulse'

const INK = '#161b23'
const WET_INK = '#4a6f8b'
const GHOST = 'rgba(22, 27, 35, 0.28)'
const RED = '#e10600'

function kindStyle(kind: LapPoint['kind']): { fill: string; hollow: boolean; size: number; square?: boolean } {
  switch (kind) {
    case 'clean':
      return { fill: INK, hollow: false, size: 2.6 }
    case 'wet':
      return { fill: WET_INK, hollow: false, size: 2.4 }
    case 'sc':
      return { fill: 'rgba(90, 100, 115, 0.75)', hollow: true, size: 3, square: true }
    case 'pit-in':
    case 'pit-out':
    case 'lap1':
      return { fill: GHOST, hollow: false, size: 1.7 }
    case 'outlier':
      return { fill: RED, hollow: true, size: 3.4 }
    default:
      return { fill: 'transparent', hollow: false, size: 0 }
  }
}

export function Dossier() {
  const session = useAppStore((s) => s.session)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const flags = useAppStore((s) => s.flags)
  const focusDriver = useAppStore((s) => s.focusDriver)
  const setFocusDriver = useAppStore((s) => s.setFocusDriver)
  const pulse = useUiPulse()

  const scatterRef = useRef<HTMLCanvasElement>(null)
  const paceRef = useRef<HTMLCanvasElement>(null)

  // whole-race models — memoized per session inside the registry
  const metrics = useMemo(() => {
    if (!session || !raceIndex || !flags) return null
    return metricsFor(session, raceIndex, flags)
  }, [session, raceIndex, flags])

  const driver = useMemo(
    () => session?.drivers.find((d) => d.driver_number === focusDriver) ?? null,
    [session, focusDriver],
  )
  const cons = focusDriver !== null && metrics ? consistencyOf(metrics, focusDriver) : null
  const tireModel: TireDegModel | null =
    focusDriver !== null && metrics ? (metrics.tireDeg.get(focusDriver) ?? null) : null
  const pace = focusDriver !== null && metrics ? paceSeriesOf(metrics, focusDriver) : []

  const result =
    focusDriver !== null ? (session?.results.find((r) => r.driverNumber === focusDriver) ?? null) : null

  // ---------- lap scatter ----------
  useEffect(() => {
    const canvas = scatterRef.current
    if (!canvas || !cons || !raceIndex || cons.points.length === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.round(canvas.clientWidth * dpr)
    const H = Math.round(canvas.clientHeight * dpr)
    if (W === 0 || H === 0) return
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    const timed = cons.points.filter((p) => Number.isFinite(p.sec))
    if (timed.length === 0) return
    let lo = Infinity
    let hi = -Infinity
    let maxLap = 1
    for (const p of timed) {
      lo = Math.min(lo, p.sec)
      hi = Math.max(hi, p.sec)
      maxLap = Math.max(maxLap, p.lap)
    }
    const pad = (hi - lo) * 0.12 || 1
    lo -= pad
    hi += pad
    const xOf = (lap: number) => ((lap - 0.5) / maxLap) * (W - 8 * dpr) + 4 * dpr
    const yOf = (sec: number) => H - 6 * dpr - ((sec - lo) / (hi - lo)) * (H - 12 * dpr)

    // median hairline
    if (Number.isFinite(cons.median)) {
      ctx.strokeStyle = 'rgba(22, 27, 35, 0.18)'
      ctx.lineWidth = dpr
      ctx.setLineDash([3 * dpr, 4 * dpr])
      ctx.beginPath()
      ctx.moveTo(0, yOf(cons.median))
      ctx.lineTo(W, yOf(cons.median))
      ctx.stroke()
      ctx.setLineDash([])
    }

    // points, slowest-drawn-last so fast laps sit on top
    const sorted = [...timed].sort((a, b) => b.sec - a.sec)
    for (const p of sorted) {
      const st = kindStyle(p.kind)
      const x = xOf(p.lap)
      const y = yOf(p.sec)
      if (st.square) {
        ctx.strokeStyle = st.fill
        ctx.lineWidth = 1.2 * dpr
        ctx.strokeRect(x - st.size * dpr, y - st.size * dpr, st.size * 2 * dpr, st.size * 2 * dpr)
      } else if (st.hollow) {
        ctx.strokeStyle = st.fill
        ctx.lineWidth = 1.3 * dpr
        ctx.beginPath()
        ctx.arc(x, y, st.size * dpr, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.fillStyle = st.fill
        ctx.beginPath()
        ctx.arc(x, y, st.size * dpr, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // cursor hairline
    const curLap = raceIndex.lapOf(focusDriver ?? 0, pulse.t)
    if (curLap > 0) {
      ctx.strokeStyle = 'rgba(225, 6, 0, 0.45)'
      ctx.lineWidth = dpr
      ctx.beginPath()
      ctx.moveTo(xOf(curLap), 0)
      ctx.lineTo(xOf(curLap), H)
      ctx.stroke()
    }
  }, [cons, raceIndex, focusDriver, pulse.t])

  // ---------- pace vs field ----------
  useEffect(() => {
    const canvas = paceRef.current
    if (!canvas || pace.length < 2) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = Math.round(canvas.clientWidth * dpr)
    const H = Math.round(canvas.clientHeight * dpr)
    if (W === 0 || H === 0) return
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W
      canvas.height = H
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, W, H)

    let maxAbs = 0.5
    let maxLap = 1
    for (const p of pace) {
      if (Number.isFinite(p.deltaToBest)) maxAbs = Math.max(maxAbs, Math.abs(p.deltaToBest))
      maxLap = Math.max(maxLap, p.lap)
    }
    maxAbs = Math.min(maxAbs, 4) // clip pathological laps; noted in legend
    const xOf = (lap: number) => ((lap - 0.5) / maxLap) * (W - 8 * dpr) + 4 * dpr
    const yOf = (d: number) => {
      const c = Math.max(-maxAbs, Math.min(maxAbs, d))
      return H / 2 - (c / maxAbs) * (H / 2 - 6 * dpr)
    }

    // zero line = field best that lap
    ctx.strokeStyle = 'rgba(22, 27, 35, 0.25)'
    ctx.lineWidth = dpr
    ctx.setLineDash([3 * dpr, 4 * dpr])
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()
    ctx.setLineDash([])

    let started = false
    ctx.strokeStyle = INK
    ctx.lineWidth = 1.4 * dpr
    ctx.beginPath()
    for (const p of pace) {
      if (!Number.isFinite(p.deltaToBest)) continue
      const x = xOf(p.lap)
      const y = yOf(p.deltaToBest)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else ctx.lineTo(x, y)
    }
    ctx.stroke()

    const curLapPoint = (() => {
      const curLap = raceIndex?.lapOf(focusDriver ?? 0, pulse.t) ?? 0
      let best: (typeof pace)[number] | null = null
      for (const p of pace) {
        if (p.lap > curLap) break
        best = p
      }
      return best
    })()
    if (curLapPoint && Number.isFinite(curLapPoint.deltaToBest)) {
      const x = xOf(curLapPoint.lap)
      const y = yOf(curLapPoint.deltaToBest)
      ctx.fillStyle = Math.abs(curLapPoint.deltaToBest) > 1.5 ? RED : INK
      ctx.beginPath()
      ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [pace, raceIndex, focusDriver, pulse.t])

  if (!session || !raceIndex || !metrics || focusDriver === null || !driver) return null

  const teamColor = `#${driver.team_colour || '9aa7b8'}`
  const pos = raceIndex.positionOf(focusDriver, pulse.t)
  const curLap = raceIndex.lapOf(focusDriver, pulse.t)
  const curDeg = tireModel && curLap > 0 ? degAt(tireModel, curLap) : null
  const curPace = (() => {
    let best: (typeof pace)[number] | null = null
    for (const p of pace) {
      if (p.lap > curLap) break
      best = p
    }
    return best
  })()

  // ---------- undercut ledger (every figure traces to metrics.undercuts) ----------
  const undercuts = metrics.undercuts
  const ucMine = focusDriver !== null ? (undercuts.byChaser.get(focusDriver) ?? []) : []
  const ucAgainst = focusDriver !== null ? (undercuts.byTarget.get(focusDriver) ?? []) : []
  const ucLanded = ucMine.filter((e) => e.outcome === 'success').length
  const ucThreat = focusDriver !== null ? undercutThreatAt(raceIndex, focusDriver, pulse.t) : null
  const acronymOf = (d: number): string =>
    session.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`
  const ucRelevant = ucMine.length > 0 || ucAgainst.length > 0 || ucThreat !== null

  // roster order: official classification first, then entry order
  const roster = [...session.drivers].sort((a, b) => {
    const pa = session.results.find((r) => r.driverNumber === a.driver_number)?.position ?? 99
    const pb = session.results.find((r) => r.driverNumber === b.driver_number)?.position ?? 99
    return pa - pb
  })

  const fmtOrDash = (sec: number): string =>
    Number.isFinite(sec) ? formatLap(sec) : '—'

  return (
    <aside className="dossier panel ticked">
      <header className="focus__head">
        <span className="focus__pos mono" style={{ color: teamColor }}>
          {pos !== null ? `P${pos}` : '—'}
        </span>
        <div className="focus__who">
          <span className="focus__name">{(driver.last_name ?? driver.name_acronym ?? '').toUpperCase()}</span>
          <span className="focus__team label">
            {result
              ? `${driver.team_name?.toUpperCase() ?? ''} · P${result.position ?? 'NC'} · ${result.points ?? 0} PTS`
              : (driver.team_name?.toUpperCase() ?? '')}
          </span>
        </div>
        <button className="focus__close mono" onClick={() => setFocusDriver(null)} aria-label="close">
          ✕
        </button>
      </header>

      {/* roster switcher */}
      <div className="dossier__roster mono">
        {roster.map((d) => (
          <button
            key={d.driver_number}
            className={`dossier__chip ${d.driver_number === focusDriver ? 'is-active' : ''}`}
            onClick={() => useAppStore.getState().setFocusDriver(d.driver_number)}
            title={d.full_name}
          >
            {d.name_acronym}
          </button>
        ))}
      </div>

      <div className="focus__vitals">
        <div className="focus__vital">
          <span className="focus__vitalValue num">{fmtOrDash(cons?.best ?? NaN)}</span>
          <span className="label">BEST</span>
        </div>
        <div className="focus__vital">
          <span className="focus__vitalValue num">{fmtOrDash(cons?.median ?? NaN)}</span>
          <span className="label">MEDIAN·CLEAN</span>
        </div>
        <div className="focus__vital">
          <span className="focus__vitalValue num">
            {cons && Number.isFinite(cons.stdev) ? `±${cons.stdev.toFixed(3)}` : '—'}
          </span>
          <span className="label">STDEV·CLEAN</span>
        </div>
        <div className="focus__vital">
          <span className="focus__vitalValue num">{cons?.cleanCount ?? 0}</span>
          <span className="label">CLEAN LAPS</span>
        </div>
        <div className="focus__vital">
          <span className="focus__vitalValue num">
            {(() => {
              const tr = gapSlopeAt(metrics.gapDynamics, focusDriver, pulse.t)
              if (!tr || !Number.isFinite(tr.perLap)) return '—'
              return `${tr.perLap >= 0 ? '+' : ''}${tr.perLap.toFixed(2)}s`
            })()}
          </span>
          <span className="label">GAP·TREND</span>
        </div>
      </div>

      {ucRelevant && (
        <section className="dossier__section">
          <h4 className="label">
            UNDERCUT LEDGER{ucMine.length > 0 ? ` — ${ucLanded}/${ucMine.length} LANDED` : ''}
          </h4>
          {ucThreat !== null && (
            <div className="dossier__table mono">
              <div className="dossier__threatRow is-hot">
                IN RANGE → {acronymOf(ucThreat.target)} · {ucThreat.gap.toFixed(1)}s
              </div>
            </div>
          )}
          {ucMine.length > 0 ? (
            <table className="dossier__table mono">
              <thead>
                <tr>
                  <th>LAP</th>
                  <th>VS</th>
                  <th>GAP@STOP</th>
                  <th>OUT-LAP</th>
                  <th>RESULT</th>
                </tr>
              </thead>
              <tbody>
                {ucMine.map((e) => (
                  <tr key={`${e.lap}-${e.target}`} className={curLap >= e.lap && curLap <= e.lap + 2 ? 'is-cursor' : ''}>
                    <td>{e.lap}</td>
                    <td title={e.targetAlsoPitted ? 'target pitted within the settle window — swap may be cycle phase' : undefined}>
                      {acronymOf(e.target)}
                      {e.targetAlsoPitted ? '*' : ''}
                    </td>
                    <td>{Number.isFinite(e.gapAtPit) ? `${Math.abs(e.gapAtPit).toFixed(1)}s` : '—'}</td>
                    <td>
                      {Number.isFinite(e.outLapDelta)
                        ? `${e.outLapDelta >= 0 ? '+' : ''}${e.outLapDelta.toFixed(2)}s`
                        : '—'}
                    </td>
                    <td
                      className={
                        e.outcome === 'success' ? 'is-hot' : e.outcome === 'failed' ? '' : 'dossier__wet'
                      }
                    >
                      {e.outcome === 'success'
                        ? `LANDED${e.swapLap !== null ? ` · L${e.swapLap}` : ''}`
                        : e.outcome === 'failed'
                          ? 'HELD'
                          : 'UNCLEAR'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="label">
              no classified attempts{ucAgainst.length > 0 ? ` · was target ${ucAgainst.length}×` : ''}
            </div>
          )}
        </section>
      )}

      <section className="dossier__section">
        <h4 className="label">LAP TIMES — EVERY KIND SHOWN</h4>
        <canvas ref={scatterRef} className="dossier__scatter" />
        <div className="dossier__legend label">
          <i style={{ background: INK }} /> CLEAN
          <i style={{ background: WET_INK }} /> WET
          <i className="dossier__lgSquare" style={{ borderColor: 'rgba(90,100,115,0.75)' }} /> SLOW
          <i className="dossier__lgDot" style={{ background: GHOST }} /> PIT/1
          <i className="dossier__lgRing" style={{ borderColor: RED }} /> OUTLIER
        </div>
      </section>

      <section className="dossier__section">
        <h4 className="label">TIRE MODEL — PER-STINT LINEAR FIT</h4>
        {tireModel && tireModel.stints.length > 0 ? (
          <table className="dossier__table mono">
            <thead>
              <tr>
                <th>ST</th>
                <th>COMP</th>
                <th>CTX</th>
                <th>LAPS</th>
                <th>BASE</th>
                <th>SLOPE/LAP</th>
                <th>R²</th>
              </tr>
            </thead>
            <tbody>
              {tireModel.stints.map((s) => (
                <tr key={s.stintNumber} className={curLap >= s.lapStart && curLap <= s.lapEnd ? 'is-cursor' : ''}>
                  <td>{s.stintNumber}</td>
                  <td>{(s.compound || '?').slice(0, 4)}</td>
                  <td className={s.context === 'wet' ? 'dossier__wet' : ''}>{s.context === 'wet' ? 'WET' : 'DRY'}</td>
                  <td>{s.lapStart}–{s.lapEnd}</td>
                  <td>{Number.isFinite(s.baseLap) ? `${s.baseLap.toFixed(1)}s` : '—'}</td>
                  <td className={Number.isFinite(s.slopePerLap) && s.slopePerLap > 0.5 ? 'is-hot' : ''}>
                    {Number.isFinite(s.slopePerLap) ? `${s.slopePerLap >= 0 ? '+' : ''}${s.slopePerLap.toFixed(3)}s` : 'n/a'}
                  </td>
                  <td>{Number.isFinite(s.r2) ? s.r2.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="dossier__empty label">NOT ENOUGH CLEAN LAPS FOR A FIT</p>
        )}
      </section>

      <section className="dossier__section">
        <h4 className="label">PACE VS FIELD — Δ TO FASTEST THAT LAP</h4>
        <canvas ref={paceRef} className="dossier__pace" />
        <div className="dossier__legend label">
          <span>DASHED 0 = FIELD BEST · CLIPPED AT ±4s</span>
        </div>
      </section>

      <footer className="focus__foot mono dossier__cursor">
        LAP {curLap || '—'}
        {curDeg?.compound ? ` · ${curDeg.compound.slice(0, 1)}` : ''}
        {' · DEG '}
        {curDeg && Number.isFinite(curDeg.slopePerLap) ? `${curDeg.slopePerLap >= 0 ? '+' : ''}${curDeg.slopePerLap.toFixed(3)}s/lap` : 'UNKNOWN'}
        {curPace && Number.isFinite(curPace.deltaToBest)
          ? ` · FIELD Δ ${curPace.deltaToBest >= 0 ? '+' : ''}${curPace.deltaToBest.toFixed(2)}s`
          : ''}
      </footer>
    </aside>
  )
}
