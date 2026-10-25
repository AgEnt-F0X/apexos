/* ============================================================
   Transport — time controls. (Phase 2 grows the scrub bar into
   the Race DNA Strip; the interaction contract stays the same.)
   ============================================================ */

import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import { DnaStrip } from './DnaStrip'
import { radioState, stopRadio } from './radioPlayer'
import { formatSessionTime, useUiPulse } from './useUiPulse'

export function Transport() {
  const pulse = useUiPulse()
  const session = useAppStore((s) => s.session)
  const directed = useAppStore((s) => s.directed)
  const toggleDirected = useAppStore((s) => s.toggleDirected)
  const joinMode = useAppStore((s) => s.joinMode)
  const radio = radioState()
  const radioAcr =
    radio.driverNumber !== null
      ? session?.drivers.find((d) => d.driver_number === radio.driverNumber)?.name_acronym ?? `#${radio.driverNumber}`
      : null

  return (
    <div className="transport panel ticked">
      <button
        className="transport__play"
        onClick={() => raceClock.toggle()}
        aria-label={pulse.playing ? 'pause' : 'play'}
      >
        {pulse.playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <rect x="2.5" y="2" width="4" height="12" fill="currentColor" />
            <rect x="9.5" y="2" width="4" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path d="M3 1.8 L14 8 L3 14.2 Z" fill="currentColor" />
          </svg>
        )}
      </button>

      {joinMode ? (
        <span className="transport__liveTag mono">
          <i aria-hidden />
          BROADCAST
        </span>
      ) : (
        <>
          <button
            className="transport__rate mono"
            onClick={() => {
              if (directed) toggleDirected()
              else raceClock.cycleRate()
            }}
            title={directed ? 'auto-directed rate — click for manual' : 'playback rate'}
          >
            {directed ? `≈${pulse.rate < 10 ? pulse.rate.toFixed(1) : Math.round(pulse.rate)}` : `×${pulse.rate}`}
          </button>

          <button
            className={`transport__lens mono ${directed ? 'is-active' : ''}`}
            onClick={toggleDirected}
            title="temporal lensing: time compresses through cruise laps, expands at the action (key A)"
          >
            LENS
          </button>
        </>
      )}

      <DnaStrip />

      {radioAcr && radio.playing && (
        <button className="transport__radio mono" onClick={stopRadio} title="stop radio">
          <span className="transport__radioWave" aria-hidden />
          {radioAcr} ✕
        </button>
      )}

      <div className="transport__readout">
        {pulse.totalLaps > 0 && (
          <div className="transport__lap num" title="race lap">
            <span className="transport__lapKey label">LAP</span>
            <span className="transport__lapNow">{pulse.lap}</span>
            <span className="transport__lapOf">
              <i>of</i> {pulse.totalLaps}
            </span>
          </div>
        )}
        <span className="transport__time num" title="session time">
          <i>T</i>
          {formatSessionTime(pulse.t)}
        </span>
      </div>
    </div>
  )
}
