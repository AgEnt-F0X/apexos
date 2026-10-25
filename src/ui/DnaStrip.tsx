/* ============================================================
   The Race DNA Strip — the scrubber as a data visualization.
   Position threads woven as a bump chart, safety-car and red
   bands, rain texture, pit notches, radio pins, drama density.
   The shape of the whole race, readable at a glance; scrubbing
   is navigating the race's genome.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import { playRadio } from './radioPlayer'

const RADIO_BAND_PX = 12

export function DnaStrip() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const staticRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const focusDriver = useAppStore((s) => s.focusDriver)
  const joinMode = useAppStore((s) => s.joinMode)

  // ---------- static layer ----------
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = staticRef.current
    if (!wrap || !canvas) return

    const draw = () => {
      const { session, raceIndex, flags, moments, joinMode } = useAppStore.getState()
      if (!session || !raceIndex || !flags || !moments) return
      // Join Broadcast: the strip only knows what has already happened
      const clipT = joinMode ? raceClock.t : Infinity
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = Math.max(10, Math.round(wrap.clientWidth * dpr))
      const H = Math.max(10, Math.round(wrap.clientHeight * dpr))
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, W, H)

      const t0 = session.tMin
      const t1 = session.tMax
      const xOf = (t: number) => ((t - t0) / (t1 - t0)) * W
      const padTop = RADIO_BAND_PX * dpr + 4 * dpr
      const padBot = 8 * dpr
      const nDrivers = Math.max(2, session.drivers.length)
      const yOf = (pos: number) => padTop + ((pos - 1) / (nDrivers - 1)) * (H - padTop - padBot)

      // flag bands
      for (const s of flags.spans) {
        if (s.t0 > clipT) continue
        if (s.phase === 'SC' || s.phase === 'VSC') ctx.fillStyle = 'rgba(224, 134, 0, 0.13)'
        else if (s.phase === 'RED') ctx.fillStyle = 'rgba(225, 6, 0, 0.10)'
        else continue
        ctx.fillRect(xOf(s.t0), 0, Math.max(1, xOf(Math.min(s.t1, clipT)) - xOf(s.t0)), H)
      }

      // rain: top texture band
      let rainStart: number | null = null
      const rain: Array<[number, number]> = []
      for (const w of session.weather) {
        if (w.rainfall > 0 && rainStart === null) rainStart = w.t
        if (w.rainfall <= 0 && rainStart !== null) {
          rain.push([rainStart, w.t])
          rainStart = null
        }
      }
      if (rainStart !== null) rain.push([rainStart, t1])
      ctx.fillStyle = 'rgba(31, 114, 216, 0.65)'
      for (const [a, b] of rain) {
        if (a > clipT) continue
        ctx.fillRect(xOf(a), 2 * dpr, Math.max(1, xOf(Math.min(b, clipT)) - xOf(a)), 2.5 * dpr)
      }

      // lap ticks every 10 laps
      const lapT = new Map<number, number>()
      for (const l of session.laps) {
        if (!Number.isFinite(l.t)) continue
        const cur = lapT.get(l.lap_number)
        if (cur === undefined || l.t < cur) lapT.set(l.lap_number, l.t)
      }
      ctx.fillStyle = 'rgba(24, 32, 44, 0.10)'
      for (const [lapNo, t] of lapT) {
        if (lapNo % 10 !== 1) continue
        ctx.fillRect(xOf(t), padTop, dpr, H - padTop - padBot)
      }

      // position threads
      const teamOf = new Map<number, string>()
      for (const d of session.drivers) teamOf.set(d.driver_number, `#${d.team_colour || '9aa7b8'}`)
      const drawThread = (d: number, emphasized: boolean) => {
        const s = raceIndex.positionSeries(d)
        if (!s || s.t.length === 0) return
        ctx.strokeStyle = teamOf.get(d) ?? '#8a94a3'
        ctx.globalAlpha = emphasized ? 0.95 : 0.5
        ctx.lineWidth = (emphasized ? 2.2 : 1) * dpr
        ctx.beginPath()
        const ramp = 6 * dpr
        let y = yOf(s.v[0])
        ctx.moveTo(xOf(Math.max(s.t[0], t0)), y)
        for (let i = 1; i < s.t.length; i++) {
          if (s.t[i] > clipT) break
          const x = xOf(s.t[i])
          const ny = yOf(s.v[i])
          ctx.lineTo(Math.max(x - ramp, 0), y)
          ctx.lineTo(x, ny)
          y = ny
        }
        ctx.lineTo(xOf(Math.min(t1, clipT)), y)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      for (const d of session.drivers) {
        if (d.driver_number !== focusDriver) drawThread(d.driver_number, false)
      }
      if (focusDriver !== null) drawThread(focusDriver, true)

      // pit notches
      ctx.fillStyle = 'rgba(22, 27, 35, 0.8)'
      for (const p of session.pits) {
        if (!Number.isFinite(p.t) || p.t > clipT) continue
        const pos = raceIndex.positionOf(p.driverNumber, p.t)
        if (pos === null) continue
        const x = xOf(p.t)
        const y = yOf(pos)
        ctx.fillRect(x - dpr, y - 2.5 * dpr, 2 * dpr, 5 * dpr)
      }

      // drama density along the floor
      const bh = 4.5 * dpr
      for (let px = 0; px < W; px += 2) {
        const t = t0 + (px / W) * (t1 - t0)
        if (t > clipT) break
        const v = moments.dramaAt(t)
        if (v < 0.03) continue
        ctx.fillStyle = `rgba(225, 6, 0, ${(v * 0.7).toFixed(3)})`
        ctx.fillRect(px, H - padBot + 1.5 * dpr, 2, bh * (0.35 + 0.65 * v))
      }

      // radio pins in the top band
      for (const r of session.radio) {
        if (r.t > clipT) continue
        ctx.fillStyle = teamOf.get(r.driverNumber) ?? '#9aa7b8'
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        ctx.arc(xOf(r.t), RADIO_BAND_PX * dpr * 0.55, 1.6 * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    // live mode: the strip grows as the broadcast advances
    const id = joinMode ? window.setInterval(draw, 6000) : 0
    return () => {
      ro.disconnect()
      if (id) clearInterval(id)
    }
  }, [focusDriver, joinMode])

  // ---------- live layer: veil + playhead ----------
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = liveRef.current
    if (!wrap || !canvas) return
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const W = Math.max(10, Math.round(wrap.clientWidth * dpr))
      const H = Math.max(10, Math.round(wrap.clientHeight * dpr))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
      }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, W, H)
      const x = raceClock.frac * W
      // future veil — opaque in Join Broadcast: the future does not exist yet
      const locked = useAppStore.getState().joinMode
      ctx.fillStyle = locked ? 'rgba(244, 246, 249, 0.96)' : 'rgba(244, 246, 249, 0.68)'
      ctx.fillRect(x, 0, W - x, H)
      // playhead — the red voice
      ctx.fillStyle = 'rgba(225, 6, 0, 0.20)'
      ctx.fillRect(x - 3 * dpr, 0, 6 * dpr, H)
      ctx.fillStyle = '#e10600'
      ctx.fillRect(x - 0.75 * dpr, 0, 1.5 * dpr, H)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  // ---------- interaction ----------
  const seekFrom = (clientX: number) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    let t = raceClock.tMin + frac * (raceClock.tMax - raceClock.tMin)
    // Join Broadcast: dragging past the live edge snaps to it instead of dead-ending
    if (useAppStore.getState().joinMode && t > raceClock.t) t = raceClock.t
    raceClock.seek(t)
  }

  const tryRadio = (clientX: number, clientY: number): boolean => {
    const wrap = wrapRef.current
    const { session } = useAppStore.getState()
    if (!wrap || !session) return false
    const rect = wrap.getBoundingClientRect()
    if (clientY - rect.top > RADIO_BAND_PX + 4) return false
    const t = raceClock.tMin + ((clientX - rect.left) / rect.width) * (raceClock.tMax - raceClock.tMin)
    const tolerance = ((raceClock.tMax - raceClock.tMin) / rect.width) * 6
    const nowLimit = useAppStore.getState().joinMode ? raceClock.t : Infinity
    let best: { dt: number; url: string; d: number; t: number } | null = null
    for (const r of session.radio) {
      if (r.t > nowLimit) continue
      const dt = Math.abs(r.t - t)
      if (dt < tolerance && (!best || dt < best.dt)) best = { dt, url: r.url, d: r.driverNumber, t: r.t }
    }
    if (best) {
      playRadio(best.url, best.d, best.t)
      raceClock.seek(best.t)
      return true
    }
    return false
  }

  return (
    <div
      ref={wrapRef}
      className="dna"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        if (tryRadio(e.clientX, e.clientY)) return
        raceClock.scrubbing = true
        seekFrom(e.clientX)
      }}
      onPointerMove={(e) => {
        if (raceClock.scrubbing) seekFrom(e.clientX)
      }}
      onPointerUp={() => {
        raceClock.scrubbing = false
        // moment gravity: the playhead settles onto nearby story beats
        const wrap = wrapRef.current
        const { moments, joinMode } = useAppStore.getState()
        if (!wrap || !moments) return
        // gravity only pulls toward moments that already exist in join mode
        const nowLimit = joinMode ? raceClock.t : Infinity
        const tolerance = ((raceClock.tMax - raceClock.tMin) / wrap.clientWidth) * 14
        let best: { dt: number; t: number } | null = null
        for (const m of moments.moments) {
          if (m.severity < 0.45) continue
          if (m.t > nowLimit) continue
          const dt = Math.abs(m.t - raceClock.t)
          if (dt < tolerance && (!best || dt < best.dt)) best = { dt, t: m.t }
        }
        if (best) raceClock.seek(Math.max(raceClock.tMin, best.t - 5))
      }}
      role="slider"
      aria-label="race timeline"
    >
      <canvas ref={staticRef} className="dna__layer" />
      <canvas ref={liveRef} className="dna__layer" />
    </div>
  )
}
