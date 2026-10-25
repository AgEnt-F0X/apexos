/* ============================================================
   X-RAY — hold X and the interface explains itself in place.
   Every annotation names its data lineage: which streams, at
   what cadence, combined how. Inspection mode for a broadcast.
   ============================================================ */

import { useAppStore } from '../state/appStore'

interface Note {
  /** anchor position, viewport-relative */
  style: React.CSSProperties
  title: string
  body: string
  lineage: string
  /** which densities this note applies to */
  min?: 0 | 1 | 2
}

const NOTES: Note[] = [
  {
    style: { top: 70, left: 270 },
    title: 'TIMING TOWER',
    body: 'Live running order. Rows physically glide when positions change — the movement IS the overtake.',
    lineage: 'position change-log (sparse) + interval stream (~4s cadence), interpolated',
    min: 1,
  },
  {
    style: { top: 64, left: '50%', transform: 'translateX(-50%)' },
    title: 'FLAG STATE',
    body: 'Race control\'s current instruction to every driver on track.',
    lineage: 'race_control messages → state machine (SC / VSC / YELLOW / RED spans)',
  },
  {
    style: { bottom: 110, left: '50%', transform: 'translateX(-50%)', width: 460 },
    title: 'RACE DNA STRIP',
    body: 'The whole race as one object: each thread is a driver\'s position over time. Bands are safety cars and red flags; blue top edge is rain; the glow along the floor is computed drama density. Dots up top are real team-radio clips — click to hear them. Release a scrub near a story beat and the playhead settles onto it.',
    lineage: 'position log × 20 drivers + flag spans + weather.rainfall + moments engine',
  },
  {
    style: { top: '34%', right: 330 },
    title: 'BATTLE BRIDGES',
    body: 'A beam stretches between cars fighting inside ~1.6s. Color = tension: ice → red as the gap collapses.',
    lineage: 'interval stream: gap(chaser, ahead) < 1.6s sustained',
    min: 1,
  },
  {
    style: { top: '52%', left: '38%' },
    title: 'THE ASPHALT REMEMBERS',
    body: 'Warm glow on the track = where the whole field actually brakes, accumulated across the session. Amber pulses = live yellow sectors. The surface darkens when rain is falling at that moment of the race.',
    lineage: 'brake channel ≥40% × all drivers, binned along the racing line (built from X/Y/Z telemetry — no 3D model files)',
  },
  {
    style: { top: 120, right: 24, width: 260 },
    title: 'FOCUS HUD',
    body: 'One car\'s live cockpit state: 30 seconds of speed, throttle and brake, plus gear, DRS and tire.',
    lineage: 'car telemetry @ ~4Hz, resampled to 5Hz, drawn per frame',
    min: 1,
  },
]

export function XrayLayer() {
  const xray = useAppStore((s) => s.xray)
  const density = useAppStore((s) => s.density)
  if (!xray) return null

  return (
    <div className="xray" aria-live="polite">
      <div className="xray__veil" />
      <div className="xray__badge mono">X-RAY · THE INTERFACE, EXPLAINED · RELEASE X TO EXIT</div>
      {NOTES.filter((n) => density >= (n.min ?? 0)).map((n) => (
        <div key={n.title} className="xray__note" style={n.style}>
          <span className="xray__title mono">{n.title}</span>
          <span className="xray__body">{n.body}</span>
          <span className="xray__lineage mono">⌁ {n.lineage}</span>
        </div>
      ))}
    </div>
  )
}
