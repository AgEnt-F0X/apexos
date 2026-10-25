/* ============================================================
   Driver focus — the micro-telemetry HUD. Rolling 30-second
   canvas strips (speed / throttle / brake) drawn straight from
   the channel arrays every frame; live gear, DRS, tire state.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { raceClock } from '../engine/RaceClock'
import type { GapSample } from '../engine/raceState'
import { makeCarSample, sampleCar } from '../engine/sampler'
import { useAppStore } from '../state/appStore'
import { useUiPulse } from './useUiPulse'

const WINDOW_S = 30

const COMPOUND_COLOR: Record<string, string> = {
  SOFT: 'var(--tire-soft)',
  MEDIUM: 'var(--tire-medium)',
  HARD: 'var(--tire-hard)',
  INTERMEDIATE: 'var(--tire-inter)',
  WET: 'var(--tire-wet)',
}

export function FocusPanel() {
  const session = useAppStore((s) => s.session)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const focusDriver = useAppStore((s) => s.focusDriver)
  const setFocusDriver = useAppStore((s) => s.setFocusDriver)
  const pulse = useUiPulse()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sample = useMemo(() => makeCarSample(), [])

  const driver = useMemo(
    () => session?.drivers.find((d) => d.driver_number === focusDriver) ?? null,
    [session, focusDriver],
  )

  // rolling strips at rAF
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !session || focusDriver === null) return
    const ch = session.channels[focusDriver]
    if (!ch) return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = Math.round(canvas.clientWidth * dpr)
      const H = Math.round(canvas.clientHeight * dpr)
      if (W === 0) return
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, W, H)

      const t1 = raceClock.t
      const t0 = t1 - WINDOW_S
      const lanes = [
        { key: 'speed' as const, top: 0, h: 0.52, color: '#161b23', max: 360, fill: false },
        { key: 'throttle' as const, top: 0.56, h: 0.2, color: '#0a9e5f', max: 100, fill: true },
        { key: 'brake' as const, top: 0.79, h: 0.2, color: '#e10600', max: 100, fill: true },
      ]
      for (const lane of lanes) {
        const yTop = lane.top * H
        const laneH = lane.h * H
        // lane baseline
        ctx.fillStyle = 'rgba(24, 32, 44, 0.08)'
        ctx.fillRect(0, yTop + laneH, W, dpr)

        ctx.beginPath()
        let started = false
        for (let px = 0; px <= W; px += 2) {
          const t = t0 + (px / W) * WINDOW_S
          const fi = (t - ch.t0) * ch.hz
          if (fi < 0 || fi >= ch.n) continue
          const i = Math.floor(fi)
          const raw = lane.key === 'speed' ? ch.speed[i] : lane.key === 'throttle' ? ch.throttle[i] : ch.brake[i]
          const y = yTop + laneH - (Math.min(raw, lane.max) / lane.max) * laneH
          if (!started) {
            ctx.moveTo(px, y)
            started = true
          } else {
            ctx.lineTo(px, y)
          }
        }
        if (lane.fill) {
          ctx.lineTo(W, yTop + laneH)
          ctx.lineTo(0, yTop + laneH)
          ctx.closePath()
          ctx.fillStyle = lane.color + '2e'
          ctx.fill()
        }
        ctx.strokeStyle = lane.color
        ctx.lineWidth = 1.4 * dpr
        ctx.stroke()
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [session, focusDriver])

  if (!session || !raceIndex || focusDriver === null || !driver) return null
  const ch = session.channels[focusDriver]
  if (ch) sampleCar(ch, pulse.t, sample)
  const lap = raceIndex.lapOf(focusDriver, pulse.t)
  const stint = raceIndex.stintAt(focusDriver, lap)
  const pos = raceIndex.positionOf(focusDriver, pulse.t)
  const g: GapSample = { gap: NaN, interval: NaN, gapLaps: 0 }
  raceIndex.gapOf(focusDriver, pulse.t, g)
  const teamColor = `#${driver.team_colour || '9aa7b8'}`

  return (
    <aside className="focus panel ticked">
      <header className="focus__head">
        <span className="focus__pos mono" style={{ color: teamColor }}>
          {pos !== null ? `P${pos}` : '—'}
        </span>
        <div className="focus__who">
          <span className="focus__name">{(driver.last_name ?? driver.name_acronym ?? '').toUpperCase()}</span>
          <span className="focus__team label">{driver.team_name?.toUpperCase()}</span>
        </div>
        <button className="focus__close mono" onClick={() => setFocusDriver(null)} aria-label="close">
          ✕
        </button>
      </header>

      <div className="focus__vitals">
        <div className="focus__vital">
          <span className="focus__vitalValue num">{sample.valid ? Math.round(sample.speed) : '—'}</span>
          <span className="label">KM/H</span>
        </div>
        <div className="focus__vital">
          <span className="focus__vitalValue num">{sample.valid ? sample.gear || 'N' : '—'}</span>
          <span className="label">GEAR</span>
        </div>
        <div className="focus__vital">
          <span className={`focus__vitalValue num ${sample.drsOpen ? 'is-drs' : ''}`}>
            {sample.drsOpen ? 'OPEN' : 'CLSD'}
          </span>
          <span className="label">DRS</span>
        </div>
        <div className="focus__vital">
          <span
            className="focus__vitalValue num"
            style={{ color: COMPOUND_COLOR[stint?.compound ?? ''] ?? 'var(--text-lo)' }}
          >
            {(stint?.compound ?? '—').slice(0, 1)}
            {stint ? stint.age : ''}
          </span>
          <span className="label">TIRE·AGE</span>
        </div>
      </div>

      <canvas ref={canvasRef} className="focus__strips" />
      <div className="focus__legend label">
        <span style={{ color: 'var(--text-hi)' }}>SPEED</span>
        <span style={{ color: 'var(--t-green)' }}>THROTTLE</span>
        <span style={{ color: 'var(--t-red)' }}>BRAKE</span>
        <span className="focus__window mono">−{WINDOW_S}s</span>
      </div>

      <footer className="focus__foot mono">
        LAP {lap} · {pos === 1 ? 'LEADER' : g.gapLaps > 0 ? `+${g.gapLaps} LAP` : Number.isFinite(g.interval) ? `+${g.interval.toFixed(1)}s AHEAD CAR` : '—'}
      </footer>
    </aside>
  )
}
