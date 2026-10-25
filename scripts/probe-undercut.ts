/* ============================================================
   OFFLINE probe for the undercut metric — zero network.

   Fabricates a tiny 2-car race with known ground truth, runs it
   through the REAL pipeline (RaceStateIndex → classifyLaps →
   buildUndercuts) and asserts every classification:

     · #2 CHASE pits on lap 5 while 1.9s behind #1 LEAD
     · fresh-tire laps are 1.0s quicker than LEAD's 90.0s
     · positions swap during lap 6 ⇒ settle check at lap 7

   usage: npx tsx scripts/probe-undercut.ts
   ============================================================ */

import { RaceStateIndex } from '../src/engine/raceState'
import { buildFlagTimeline } from '../src/engine/flags'
import { buildUndercuts, undercutThreatAt } from '../src/engine/metrics'
import type {
  SessionData,
  LapEvent,
  StintEvent,
  WeatherEvent,
  DriverRow,
  SessionMetaRow,
} from '../src/data/types'

let failures = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

const LAP = 90
const lapT = (L: number): number => (L - 1) * LAP

function mkLap(d: number, L: number, sec: number, pitOut = false): LapEvent {
  return {
    driver_number: d, lap_number: L, lap_duration: sec,
    duration_sector_1: null, duration_sector_2: null, duration_sector_3: null,
    is_pit_out_lap: pitOut, i1_speed: null, i2_speed: null, st_speed: null,
    segments_sector_1: null, segments_sector_2: null, segments_sector_3: null,
    t: lapT(L),
  }
}

function makeSession(gapAtStop: number): SessionData {
  const laps: LapEvent[] = []
  for (let L = 1; L <= 10; L++) {
    laps.push(mkLap(1, L, 90)) // LEAD: metronome 90s
    let sec = 90
    if (L === 5) sec = 100 // CHASE pit-in lap
    else if (L === 6) {
      sec = 95
      laps.push(mkLap(2, L, sec, true)) // slow out-lap
      continue
    } else if (L >= 7) sec = 89 // fresh rubber
    laps.push(mkLap(2, L, sec))
  }

  const stints: StintEvent[] = [
    { driverNumber: 1, stintNumber: 1, lapStart: 1, lapEnd: 10, compound: 'HARD', tyreAgeAtStart: 0 },
    { driverNumber: 2, stintNumber: 1, lapStart: 1, lapEnd: 5, compound: 'SOFT', tyreAgeAtStart: 0 },
    { driverNumber: 2, stintNumber: 2, lapStart: 6, lapEnd: 10, compound: 'MEDIUM', tyreAgeAtStart: 0 },
  ]

  const drv = (n: number, acr: string): DriverRow => ({
    driver_number: n, name_acronym: acr, full_name: acr, broadcast_name: acr,
    team_name: 'TEST', team_colour: 'ffffff', first_name: acr, last_name: acr,
    headshot_url: null, country_code: null,
  })

  const weather: WeatherEvent[] = [
    { t: 0, airTemp: 20, trackTemp: 30, humidity: 40, rainfall: 0, windSpeed: 0, windDirection: 0 },
  ]

  const meta: SessionMetaRow = {
    session_key: 1, meeting_key: 1, session_name: 'Race', session_type: 'Race',
    date_start: '2026-01-01T00:00:00', date_end: '2026-01-01T02:00:00',
    circuit_key: 1, circuit_short_name: 'test', country_name: 'X', country_code: 'XX',
    location: 'X', year: 2026, gmt_offset: '+00:00',
  }

  return {
    meta,
    epoch0: 0,
    drivers: [drv(1, 'LEAD'), drv(2, 'CHASE')],
    channels: {},
    laps,
    stints,
    pits: [{ driverNumber: 2, lapNumber: 5, t: lapT(5) + 80, pitDuration: 22 }],
    raceControl: [],
    weather,
    radio: [],
    // LEAD P1 / CHASE P2 from the start; CHASE takes P1 during lap 6 (t=520)
    positions: {
      t: Float64Array.from([0, 0, 520, 520]),
      driver: Uint8Array.from([1, 2, 2, 1]),
      position: Uint8Array.from([1, 2, 1, 2]),
    },
    intervals: {
      t: Float64Array.from([300, 360]),
      driver: Uint8Array.from([2, 2]),
      gap: Float32Array.from([5, 3]),
      interval: Float32Array.from([1.5, gapAtStop]),
      gapLaps: Uint8Array.from([0, 0]),
    },
    results: [],
    tMin: 0,
    tMax: 1000,
    tAction: 0,
  }
}

console.log('probing undercut metric (synthetic, offline)…\n')

const data = makeSession(1.9)
const idx = new RaceStateIndex(data)
const flags = buildFlagTimeline(data)
const model = buildUndercuts(data, idx, flags)

assert(model.events.length === 1, 'exactly one attempt classified')
const e = model.events[0]
if (e) {
  assert(e.chaser === 2 && e.target === 1 && e.lap === 5, 'chaser/target/pit-lap identified')
  assert(Number.isFinite(e.gapAtPit) && near(Math.abs(e.gapAtPit), 1.9), 'gap@stop measured (1.9s)')
  assert(e.outcome === 'success', 'outcome = success (ahead at settle lap)')
  assert(e.swapLap === 7, 'swap lap pinned to L7')
  assert(Number.isFinite(e.outLapDelta) && near(e.outLapDelta, 1.0), 'out-lap delta = +1.00s (tire offset converted)')
  assert(!e.targetAlsoPitted, 'target stayed out (no phase asterisk)')
  assert(model.byChaser.get(2)?.length === 1 && model.byTarget.get(1)?.length === 1, 'indexes populated')
}

const th1 = undercutThreatAt(idx, 2, 300)
assert(th1 !== null && th1.target === 1 && near(th1!.gap, 1.5), 'threat read pre-stop: IN RANGE vs LEAD')
const th2 = undercutThreatAt(idx, 2, 700)
assert(th2 === null, 'after swap: leader gets NO threat read')

const far = buildUndercuts(makeSession(6.0), new RaceStateIndex(makeSession(6.0)), flags)
assert(far.events.length === 0, 'stop from 6.0s back is NOT an attempt (honesty gate)')

console.log(failures === 0 ? '\nALL UNDERCUT CHECKS PASS' : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
