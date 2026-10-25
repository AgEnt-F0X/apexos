/* ============================================================
   The designed loading sequence. First cold load of a race
   streams ~500k telemetry rows; this screen narrates the
   pipeline honestly (stages, rows, live log) and teaches while
   it works — the wait is part of the product's story.
   ============================================================ */

import { useEffect, useState } from 'react'
import type { LoadStage } from '../data/types'
import { useAppStore } from '../state/appStore'

const STAGE_ORDER: LoadStage[] = ['cache', 'tables', 'location', 'car_data', 'pack']

const STAGE_LABELS: Record<LoadStage, string> = {
  cache: 'LOCAL ARCHIVE',
  tables: 'TIMING TABLES',
  location: 'POSITIONAL TELEMETRY',
  car_data: 'CAR TELEMETRY',
  pack: 'BINARY PACK',
}

/** stage → [weightStart, weightEnd] of overall progress */
const STAGE_SPAN: Record<LoadStage, [number, number]> = {
  cache: [0, 0.02],
  tables: [0.02, 0.12],
  location: [0.12, 0.58],
  car_data: [0.58, 0.95],
  pack: [0.95, 1],
}

const FACTS = [
  'Each car reports its position about 4 times per second — 20 cars, two hours, half a million coordinates.',
  'The pit wall never watches the TV feed. It watches exactly the tables you are downloading right now.',
  'Gap data updates every ~4 seconds. Strategists mentally interpolate the rest — this app does it for you.',
  'Tire compound and age are the two numbers that decide almost every strategy call.',
  'Race control messages are the referee\'s diary: every flag, every investigation, timestamped.',
  'Team radio clips are public. The paranoia in them is real.',
  'X/Y/Z positions arrive in decimeters. The circuit you are about to see is built from them — no 3D model files.',
]

export function LoadingScreen() {
  const progress = useAppStore((s) => s.progress)
  const target = useAppStore((s) => s.loadTarget)
  const exitToBrowser = useAppStore((s) => s.exitToBrowser)
  const [factIdx, setFactIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setFactIdx((i) => (i + 1) % FACTS.length), 6000)
    return () => clearInterval(id)
  }, [])

  const stage = progress?.stage ?? 'cache'
  const stageIdx = STAGE_ORDER.indexOf(stage)
  const span = STAGE_SPAN[stage]
  const overall = progress ? span[0] + (span[1] - span[0]) * progress.frac : 0

  return (
    <div className="loading">
      <div className="loading__core">
        <p className="label">ACQUIRING SESSION</p>
        <h1 className="loading__title">{target?.title ?? '—'}</h1>

        <div className="loading__bar">
          <div className="loading__fill" style={{ width: `${overall * 100}%` }} />
        </div>
        <div className="loading__meta mono">
          <span>{Math.round(overall * 100)}%</span>
          <span>{(progress?.rows ?? 0).toLocaleString()} ROWS</span>
        </div>

        <ul className="loading__stages">
          {STAGE_ORDER.map((s, i) => (
            <li
              key={s}
              className={`loading__stage ${i < stageIdx ? 'is-done' : ''} ${i === stageIdx ? 'is-active' : ''}`}
            >
              <span className="loading__stageMark mono">{i < stageIdx ? '■' : i === stageIdx ? '▸' : '□'}</span>
              <span className="loading__stageName label">{STAGE_LABELS[s]}</span>
              {i === stageIdx && <span className="loading__stageDetail mono">{progress?.label ?? ''}</span>}
            </li>
          ))}
        </ul>

        <p className="loading__fact">{FACTS[factIdx]}</p>

        <button className="loading__cancel label" onClick={exitToBrowser}>
          ABORT ACQUISITION
        </button>
      </div>
    </div>
  )
}
