/* ============================================================
   First-entry orientation. Shown once (localStorage), skippable
   instantly. Not a tour — a briefing.
   ============================================================ */

import { useEffect, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { DEMO } from './SessionBrowser'

const KEY = 'apexos-briefed-v2'

const ROWS: Array<{ k: string; text: string }> = [
  { k: 'AUTO', text: 'A director is cutting cameras for you. Keys 1–4 take the wheel.' },
  { k: 'SCROLL', text: 'Zoom freely in any view — double-click to let the director reframe.' },
  { k: 'D', text: 'The density dial: CINEMA → BROADCAST → ENGINEER. Same race, three depths.' },
  { k: 'A', text: 'Temporal lensing — time compresses through cruise laps, slows for the action.' },
  { k: 'HOLD X', text: 'X-ray: every element of the interface explains itself, with its data lineage.' },
  { k: 'CLICK', text: 'Click any car — or any timing row — to open its live cockpit.' },
]

export function Onboarding() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true)
    } catch {
      // storage unavailable — skip briefing
    }
  }, [])

  if (!show) return null

  const simulated = useAppStore.getState().session?.meta.session_key === DEMO.sessionKey

  const dismiss = () => {
    setShow(false)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // fine
    }
  }

  return (
    <div className="brief" role="dialog" aria-label="orientation">
      <div className="brief__card panel ticked">
        <p className="label" style={{ color: 'var(--accent)' }}>ORIENTATION</p>
        <h2 className="brief__title">You&apos;re on the pit wall now.</h2>
        <p className="brief__lede">
          {simulated ? (
            <>
              This is the demonstration theatre — a simulated Grand Prix, generated on real circuit
              geometry, so the machine works even when the archive cannot. Every panel interprets the
              same simulated feed; you choose how deep to go.
            </>
          ) : (
            <>
              Everything on screen is real telemetry — half a million data points, replayed. The
              interface interprets the race and directs your attention; you choose how deep to go.
            </>
          )}
        </p>
        <ul className="brief__rows">
          {ROWS.map((r) => (
            <li key={r.k}>
              <span className="brief__key mono">{r.k}</span>
              <span className="brief__text">{r.text}</span>
            </li>
          ))}
        </ul>
        <button className="brief__go mono" onClick={dismiss}>
          LIGHTS OUT →
        </button>
      </div>
    </div>
  )
}
