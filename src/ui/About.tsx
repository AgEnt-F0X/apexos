/* ============================================================
   About / process overlay — the designer's story. What this is,
   why it's built this way, and how raw rows become a broadcast.
   ============================================================ */

import { useAppStore } from '../state/appStore'

const PIPELINE = [
  { step: '01', name: 'ACQUIRE', text: 'OpenF1 community API — positions, car channels, gaps, laps, stints, flags, weather, radio. ~500k rows per race, streamed in polite windowed chunks.' },
  { step: '02', name: 'NORMALIZE', text: 'A web worker resamples every motion channel to a uniform 5 Hz grid and packs everything into typed binary columns (APEXPACK).' },
  { step: '03', name: 'REMEMBER', text: 'Packs persist to IndexedDB — a session loads once from the network, then instantly forever.' },
  { step: '04', name: 'INTERPRET', text: 'The Moments Engine derives what humans talk about: overtakes, sustained battles, pit stops, fastest laps, flag phases, weather shifts. A drama curve scores the whole race.' },
  { step: '05', name: 'PERFORM', text: 'The circuit is extruded from the telemetry itself. A director cuts cameras off the moments. Time bends around the action. Data is painted on the world, not in panels.' },
]

const THESIS = [
  ['DIEGETIC TELEMETRY', 'Data lives in the world: braking heat on the asphalt, battle tension as light, tire age on the car.'],
  ['SEMANTIC ZOOM', 'One surface, three depths — CINEMA, BROADCAST, ENGINEER. The interface recomposes; nothing toggles.'],
  ['TEMPORAL LENSING', 'The scrubber is honest about where the race actually lives. Cruise compresses; drama breathes.'],
  ['X-RAY', 'Hold X — the interface annotates itself in place, down to the data lineage of every number.'],
  ['THE DIRECTOR', 'A quiet camera grammar — plate, follow, pair — driven by the same interpretation layer. Join-as-live hides the future entirely.'],
]

export function About() {
  const open = useAppStore((s) => s.about)
  const setAbout = useAppStore((s) => s.setAbout)
  if (!open) return null

  return (
    <div className="about" role="dialog" aria-label="about this project" onClick={() => setAbout(false)}>
      <div className="about__card panel ticked" onClick={(e) => e.stopPropagation()}>
        <header className="about__head">
          <div>
            <p className="label" style={{ color: 'var(--accent)' }}>CONCEPT 001 — DESIGN EXPLORATION</p>
            <h2 className="about__title">APEX//OS</h2>
            <p className="about__sub">
              A study in spatial information design: can an interface <b>interpret</b> a system
              as complex as a Formula 1 race — and perform it for anyone, at any depth?
            </p>
          </div>
          <button className="about__close mono" onClick={() => setAbout(false)}>✕</button>
        </header>

        <section>
          <p className="label about__sectionTitle">THE PIPELINE — RAW ROWS → BROADCAST</p>
          <ol className="about__pipeline">
            {PIPELINE.map((p) => (
              <li key={p.step}>
                <span className="about__step mono">{p.step}</span>
                <span className="about__stepName mono">{p.name}</span>
                <span className="about__stepText">{p.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <p className="label about__sectionTitle">FIVE PATTERNS THIS INTERFACE ARGUES FOR</p>
          <ul className="about__thesis">
            {THESIS.map(([name, text]) => (
              <li key={name}>
                <span className="about__thesisName mono">{name}</span>
                <span className="about__thesisText">{text}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="about__foot label">
          DATA · OPENF1.ORG (COMMUNITY API) · TEAM RADIO © FORMULA 1 — UNOFFICIAL CONCEPT, NON-COMMERCIAL,
          NOT ASSOCIATED WITH FORMULA 1 OR THE FIA · BUILT WITH REACT · THREE.JS · ZUSTAND
        </footer>
      </div>
    </div>
  )
}
