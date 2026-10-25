import { useAppStore, type CameraMode } from '../state/appStore'
import type { FlagPhase } from '../engine/flags'
import { DEMO } from './SessionBrowser'
import { DensityDial } from './DensityDial'
import { useUiPulse } from './useUiPulse'

/** sessions the app itself synthesized (scripts/make-demo-pack.ts) — they
    must always wear the badge; honesty is a design principle here */
const DEMO_KEYS = new Set([DEMO.sessionKey])

const CAMERA_MODES: Array<{ id: CameraMode; label: string; key: string }> = [
  { id: 'director', label: 'AUTO', key: '1' },
  { id: 'orbit', label: 'TURNTABLE', key: '2' },
  { id: 'chase', label: 'FOLLOW', key: '3' },
  { id: 'top', label: 'PLAN', key: '4' },
  { id: 'anatomy', label: 'ANATOMY', key: '5' },
]

const FLAG_BANNERS: Partial<Record<FlagPhase, { text: string; cls: string }>> = {
  YELLOW: { text: 'YELLOW FLAG', cls: 'is-yellow' },
  SC: { text: 'SAFETY CAR', cls: 'is-yellow' },
  VSC: { text: 'VIRTUAL SAFETY CAR', cls: 'is-yellow' },
  RED: { text: 'RED FLAG', cls: 'is-red' },
  CHEQUERED: { text: 'CHEQUERED FLAG', cls: 'is-cheq' },
}

export function StatusBar() {
  const session = useAppStore((s) => s.session)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const setCameraMode = useAppStore((s) => s.setCameraMode)
  const exitToBrowser = useAppStore((s) => s.exitToBrowser)
  const joinMode = useAppStore((s) => s.joinMode)
  const pulse = useUiPulse()
  if (!session) return null
  const m = session.meta
  const banner = FLAG_BANNERS[pulse.phase]

  return (
    <header className="status">
      <div className="status__left">
        <span className="status__brand">APEX<span className="status__brandSlash">//</span>OS</span>
        <span className="status__divider" />
        <span className="status__session mono">
          {m.location.toUpperCase()} · {m.session_name.toUpperCase()} · {m.year}
        </span>
        {DEMO_KEYS.has(m.session_key) && (
          <span className="status__sim mono" title="this session is a simulation bundled with the app, not a recorded race">
            SIMULATION
          </span>
        )}
        <span className="status__circuit label">{m.circuit_short_name.toUpperCase()}</span>
        {joinMode && (
          <span className="status__live mono">
            <i className="status__liveDot" aria-hidden />
            LIVE
          </span>
        )}
      </div>
      <div className="status__center">
        {banner && <span className={`status__flag mono ${banner.cls}`}>{banner.text}</span>}
      </div>
      <div className="status__right">
        {pulse.trackTemp !== null && (
          <span className="status__wx mono" title="track temperature / rain">
            TRK {pulse.trackTemp.toFixed(0)}°{pulse.raining ? ' · RAIN' : ''}
          </span>
        )}
        <DensityDial />
        <div className="status__cams" role="tablist" aria-label="camera mode">
          {CAMERA_MODES.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={cameraMode === c.id}
              className={`status__cam ${cameraMode === c.id ? 'is-active' : ''}`}
              onClick={() => setCameraMode(c.id)}
              title={`key ${c.key}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button className="status__exit" onClick={() => useAppStore.getState().setAbout(true)} title="about this concept">
          INFO
        </button>
        <button className="status__exit" onClick={exitToBrowser}>
          EXIT
        </button>
      </div>
    </header>
  )
}
