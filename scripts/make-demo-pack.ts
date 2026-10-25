/* ============================================================
   make-demo-pack — synthesize a complete, honest APEXPACK.
   Purpose: the theatre must never depend on the OpenF1 archive
   being up (live-session 401 lockdowns, cold first visits, offline
   demos). This drives the SHIPPED Interlagos centerline through a
   lap-time-realistic field simulation — curvature-planned speed
   profile, tire strategy, pit lane geometry, safety cars, a rain
   phase, DRS passes — and packs it with the same encoder the real
   pipeline uses. Every table the engine reads (laps, stints, pits,
   positions, intervals, overtakes, grid, results, race control,
   weather) is written CONSISTENTLY from the one simulation, so
   the Moments Engine, DNA strip and Director have real structure
   to interpret.

   The session is clearly labelled synthetic in its meta; it is a
   demonstration, not a record of the real 2024 race.
   ============================================================ */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePack } from '../src/data/pack'
import type {
  DriverRow, IntervalTable, LapEvent, OvertakeEvent, PitEvent,
  PositionTable, RaceControlEvent, ResultEvent, SessionData,
  SessionMetaRow, StintEvent, WeatherEvent, GridEvent,
} from '../src/data/types'

// ---------------- track ----------------

interface TrackJson {
  v: number
  key: string
  points: number[] // xyz triplets, 1408 stations
  cumDist: number[]
  length: number
  sectorParam: number[]
  corners: Array<{ idx: number; param: number; dir: number; angle: number; number: number }>
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const track = JSON.parse(readFileSync(join(ROOT, 'public/tracks/interlagos.json'), 'utf8')) as TrackJson
const N = track.cumDist.length
const L = track.length
const DS = L / N // ~3 m per station

const px = (i: number) => track.points[i * 3]
const py = (i: number) => track.points[i * 3 + 1]
const pz = (i) => track.points[i * 3 + 2]

/** position + tangent at arc length s (meters, wraps at L) */
function frameAt(s: number, out: { x: number; y: number; z: number; tx: number; ty: number }): void {
  const f = (((s % L) + L) % L) / DS
  const i = Math.floor(f)
  const u = f - i
  const i2 = (i + 1) % N
  out.x = px(i) + (px(i2) - px(i)) * u
  out.y = py(i) + (py(i2) - py(i)) * u
  out.z = pz(i) + (pz(i2) - pz(i)) * u
  const i0 = (i - 1 + N) % N
  let tx = px(i2) - px(i0)
  let ty = py(i2) - py(i0)
  const len = Math.hypot(tx, ty) || 1
  out.tx = tx / len
  out.ty = ty / len
}

// ---------------- speed profile (velocity planner) ----------------
// vmax from curvature, then forward (traction) / backward (braking)
// passes. Calibrated so a clean lap lands ~72–75 s.

const A_LAT = 39.5 // m/s² lateral budget (downforce-era, dry)
const A_ACC = 13.5
const A_BRK = 34

const vmaxAt = new Float64Array(N)
{
  for (let i = 0; i < N; i++) {
    const i0 = (i - 2 + N) % N
    const i2 = (i + 2) % N
    const dx = px(i2) - px(i0)
    const dy = py(i2) - py(i0)
    const chord = Math.hypot(dx, dy)
    const dth = Math.abs(Math.atan2(py(i2) - py(i), px(i2) - px(i)) - Math.atan2(py(i) - py(i0), px(i) - px(i0)))
    const k = chord > 1e-6 ? Math.abs(((dth + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / chord : 0
    vmaxAt[i] = k > 1e-4 ? Math.sqrt(A_LAT / k) : 120
    vmaxAt[i] = Math.min(vmaxAt[i], 98) // drag-limited top speed
  }
  // smooth curvature noise
  for (let pass = 0; pass < 3; pass++) {
    const tmp = Float64Array.from(vmaxAt)
    for (let i = 0; i < N; i++) {
      vmaxAt[i] = (tmp[(i - 1 + N) % N] + tmp[i] + tmp[(i + 1) % N]) / 3
    }
  }
  // backward: braking into corners
  for (let i = N - 1; i >= 0; i--) {
    const nx = (i + 1) % N
    const cap = Math.sqrt(vmaxAt[nx] ** 2 + 2 * A_BRK * DS)
    if (vmaxAt[i] > cap) vmaxAt[i] = cap
  }
  // forward: acceleration out
  for (let i = 1; i <= N; i++) {
    const ii = i % N
    const pv = vmaxAt[(ii - 1 + N) % N]
    const cap = Math.sqrt(pv ** 2 + 2 * A_ACC * DS)
    if (vmaxAt[ii] > cap) vmaxAt[ii] = cap
  }
}

const profileLapS = vmaxAt.reduce((a, v) => a + DS / v, 0) // ≈ 70–75 s

/** plan speed at arc s with a grip multiplier */
function planSpeed(s: number): number {
  const i = Math.floor(((((s % L) + L) % L) / DS)) % N
  return vmaxAt[i]
}

// DRS zones: the two longest near-flat stretches — main straight
// (wraps the line) and the back straight. Detected from the plan.
const drsZones: Array<[number, number]> = []
{
  const flat = Array.from({ length: N }, (_, i) => vmaxAt[i] > 88)
  let start = -1
  for (let i = 0; i <= N; i++) {
    const f = i < N ? flat[i] : flat[0]
    if (f && start < 0) start = i
    if (!f && start >= 0) {
      drsZones.push([start * DS, i * DS])
      start = -1
    }
  }
  // merge wrap-around (zone crossing the line)
  if (drsZones.length >= 2) {
    const first = drsZones[0]
    const last = drsZones[drsZones.length - 1]
    if (first[0] < 400 && last[1] > L - 400) {
      last[1] = L + first[1]
      drsZones.shift()
    }
  }
}
function inDrsZone(s: number): boolean {
  const ss = ((s % L) + L) % L
  return drsZones.some(([a, b]) => (b > L ? ss >= a || ss <= b - L : ss >= a && ss <= b))
}

// ---------------- the field ----------------

interface DriverSpec {
  number: number
  acronym: string
  full: string
  team: string
  color: string
  /** base pace multiplier: 1.000 = pole pace */
  pace: number
  grid: number
  strategy: Array<{ compound: string; toLap: number }> // stints
  dnfLap?: number
}

// A plausible 2024-Interlagos-style grid and arc, loosely echoing the
// real weekend's story ( Verstappen deep in the grid, charging through
// the rain) but executed synthetically. Compound codes: SOFT/MEDIUM/
// HARD/INTERMEDIATE.
const FIELD: DriverSpec[] = [
  { number: 4,  acronym: 'NOR', full: 'Lando Norris',        team: 'McLaren',       color: 'FF8000', pace: 0.9975, grid: 1,  strategy: [{ compound: 'MEDIUM', toLap: 20 }, { compound: 'MEDIUM', toLap: 38 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 81, acronym: 'PIA', full: 'Oscar Piastri',       team: 'McLaren',       color: 'FF8000', pace: 1.0010, grid: 2,  strategy: [{ compound: 'MEDIUM', toLap: 21 }, { compound: 'HARD', toLap: 39 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 16, acronym: 'LEC', full: 'Charles Leclerc',     team: 'Ferrari',       color: 'E8002D', pace: 1.0005, grid: 3,  strategy: [{ compound: 'MEDIUM', toLap: 19 }, { compound: 'MEDIUM', toLap: 37 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 55, acronym: 'SAI', full: 'Carlos Sainz',        team: 'Ferrari',       color: 'E8002D', pace: 1.0015, grid: 4,  strategy: [{ compound: 'MEDIUM', toLap: 22 }, { compound: 'HARD', toLap: 40 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 44, acronym: 'HAM', full: 'Lewis Hamilton',      team: 'Mercedes',      color: '27F4D2', pace: 1.0025, grid: 5,  strategy: [{ compound: 'MEDIUM', toLap: 18 }, { compound: 'MEDIUM', toLap: 36 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 63, acronym: 'RUS', full: 'George Russell',      team: 'Mercedes',      color: '27F4D2', pace: 1.0018, grid: 6,  strategy: [{ compound: 'MEDIUM', toLap: 20 }, { compound: 'HARD', toLap: 38 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 14, acronym: 'ALO', full: 'Fernando Alonso',     team: 'Aston Martin',  color: '229971', pace: 1.0040, grid: 7,  strategy: [{ compound: 'MEDIUM', toLap: 17 }, { compound: 'HARD', toLap: 35 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 18, acronym: 'STR', full: 'Lance Stroll',        team: 'Aston Martin',  color: '229971', pace: 1.0090, grid: 8,  strategy: [{ compound: 'MEDIUM', toLap: 24 }, { compound: 'HARD', toLap: 41 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 10, acronym: 'GAS', full: 'Pierre Gasly',        team: 'Alpine',        color: 'FF66B2', pace: 1.0060, grid: 9,  strategy: [{ compound: 'SOFT', toLap: 16 }, { compound: 'MEDIUM', toLap: 34 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 31, acronym: 'OCO', full: 'Esteban Ocon',        team: 'Alpine',        color: 'FF66B2', pace: 1.0065, grid: 10, strategy: [{ compound: 'MEDIUM', toLap: 19 }, { compound: 'HARD', toLap: 37 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 40, acronym: 'COL', full: 'Franco Colapinto',    team: 'Williams',      color: '64C4FF', pace: 1.0075, grid: 11, strategy: [{ compound: 'MEDIUM', toLap: 21 }, { compound: 'HARD', toLap: 39 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 23, acronym: 'ALB', full: 'Alexander Albon',     team: 'Williams',      color: '64C4FF', pace: 1.0050, grid: 12, strategy: [{ compound: 'MEDIUM', toLap: 23 }, { compound: 'HARD', toLap: 40 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 22, acronym: 'TSU', full: 'Yuki Tsunoda',        team: 'RB',            color: '6692FF', pace: 1.0080, grid: 13, strategy: [{ compound: 'SOFT', toLap: 15 }, { compound: 'MEDIUM', toLap: 33 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 3,  acronym: 'RIC', full: 'Daniel Ricciardo',    team: 'RB',            color: '6692FF', pace: 1.0095, grid: 14, strategy: [{ compound: 'MEDIUM', toLap: 20 }, { compound: 'HARD', toLap: 38 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 27, acronym: 'HUL', full: 'Nico Hulkenberg',     team: 'Haas',          color: 'B6BABD', pace: 1.0070, grid: 15, strategy: [{ compound: 'MEDIUM', toLap: 18 }, { compound: 'HARD', toLap: 36 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }], dnfLap: 21 },
  { number: 20, acronym: 'MAG', full: 'Kevin Magnussen',     team: 'Haas',          color: 'B6BABD', pace: 1.0105, grid: 16, strategy: [{ compound: 'MEDIUM', toLap: 22 }, { compound: 'HARD', toLap: 40 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 24, acronym: 'ZHO', full: 'Guanyu Zhou',         team: 'Sauber',        color: '52E252', pace: 1.0115, grid: 17, strategy: [{ compound: 'MEDIUM', toLap: 19 }, { compound: 'HARD', toLap: 37 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 77, acronym: 'BOT', full: 'Valtteri Bottas',     team: 'Sauber',        color: '52E252', pace: 1.0100, grid: 18, strategy: [{ compound: 'MEDIUM', toLap: 21 }, { compound: 'HARD', toLap: 39 }, { compound: 'INTERMEDIATE', toLap: 45 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 1,  acronym: 'VER', full: 'Max Verstappen',      team: 'Red Bull',      color: '3671C6', pace: 0.9955, grid: 19, strategy: [{ compound: 'SOFT', toLap: 14 }, { compound: 'MEDIUM', toLap: 32 }, { compound: 'INTERMEDIATE', toLap: 43 }, { compound: 'SOFT', toLap: 56 }] },
  { number: 11, acronym: 'PER', full: 'Sergio Perez',        team: 'Red Bull',      color: '3671C6', pace: 1.0055, grid: 20, strategy: [{ compound: 'MEDIUM', toLap: 17 }, { compound: 'HARD', toLap: 35 }, { compound: 'INTERMEDIATE', toLap: 44 }, { compound: 'SOFT', toLap: 56 }] },
]

const TOTAL_LAPS = 55
const HZ = 5
const GRID_HOLD_S = 15 // cars hold on the grid, lights out at t=15
const SESSION_KEY = 9595
const EPOCH0 = Date.parse('2024-11-03T14:00:00Z')

// race phases (session-time seconds are computed after we know lap durations)
const RAIN_START_LAP = 40
const RAIN_HEAVY_LAP = 43
const SC2_LAP = 44
const SC2_END_LAP = 47
const VSC_LAP = 33
const VSC_END_LAP = 34
const SC1_LAP = 21
const SC1_END_LAP = 24

// ---------------- per-car state ----------------

interface Car {
  spec: DriverSpec
  s: number // arc position (m, monotonic across laps)
  v: number // m/s
  lat: number // lateral offset (m)
  lap: number // completed laps
  stintIdx: number
  tireAge: number // laps on current set
  inPit: boolean
  pitTransitUntil: number
  pitStopDur: number
  pitUntil: number
  exitingPit: boolean
  pitStopT: number
  retired: boolean
  retireAt: number // session time when the car stops moving for good
  finished: boolean
  finishT: number
  // output buffers
  xs: number[]; ys: number[]; zs: number[]
  spd: number[]; thr: number[]; brk: number[]; gear: number[]; rpm: number[]; drs: number[]
  // lap timing
  lapStartT: number
  sectorT: number[] // crossing times of current lap's sectors
  laps: Array<{ lap: number; t: number; dur: number; s1: number | null; s2: number | null; s3: number | null; pitOut: boolean }>
  pitLapsDone: Set<number>
  lastDrsLap: number
}

const PIT_SPEED = 22 // 80 km/h limiter

const cars: Car[] = FIELD.map((spec) => ({
  spec,
  s: 0, v: 0, lat: 0, lap: 0, stintIdx: 0, tireAge: 0,
  inPit: false, pitTransitUntil: 0, pitStopDur: 0, pitUntil: 0, exitingPit: false, pitStopT: 0,
  retired: false, retireAt: Infinity, finished: false, finishT: Infinity,
  xs: [], ys: [], zs: [], spd: [], thr: [], brk: [], gear: [], rpm: [], drs: [],
  lapStartT: 0, sectorT: [0, 0], laps: [], pitLapsDone: new Set(), lastDrsLap: 0,
}))

// grid placement: staggered slots behind the line
FIELD.forEach((spec, i) => {
  const car = cars[i]
  const row = spec.grid - 1
  car.s = L - 14 - row * 8.1
  car.lat = row % 2 === 0 ? -2.3 : 2.3
})

// ---------------- event tables (built during the sim) ----------------

const posRows: Array<{ t: number; d: number; p: number }> = []
const ivRows: Array<{ t: number; d: number; gap: number; interval: number; gapLaps: number }> = []
const overtakeRows: OvertakeEvent[] = []
const pitRows: PitEvent[] = []
const stintRows: StintEvent[] = []
const rcRows: RaceControlEvent[] = []
const weatherRows: WeatherEvent[] = []
const gridEvents: GridEvent[] = FIELD.map((f) => ({
  driverNumber: f.number,
  position: f.grid,
  qualiLap: 73.5 + (f.grid - 1) * 0.11 + (f.grid % 3) * 0.04,
})).sort((a, b) => a.position - b.position)

// ---------------- helpers ----------------

const frame = { x: 0, y: 0, z: 0, tx: 0, ty: 0 }

function gripOf(car: Car, rainIntensity: number, scActive: boolean): number {
  const compound = car.spec.strategy[car.stintIdx]?.compound ?? 'MEDIUM'
  let grip = 1
  if (rainIntensity <= 0.02) {
    // dry: slicks good, inters slow and overheating
    if (compound === 'INTERMEDIATE') grip = 0.965
    else grip = 1
    grip -= Math.min(0.030, car.tireAge * 0.0011) // deg
  } else {
    // wet track
    if (compound === 'INTERMEDIATE') grip = 1.045 - rainIntensity * 0.035
    else grip = 0.86 - rainIntensity * 0.10 // slicks in rain: dangerous
  }
  return grip * (scActive ? 1 : 1) // SC handled by cap
}

function phaseCaps(t: number, phase: { sc: boolean; vsc: boolean; rain: number }): { vCap: number; paceMul: number } {
  if (phase.sc) return { vCap: 53, paceMul: 1 }
  if (phase.vsc) return { vCap: 42, paceMul: 1 }
  return { vCap: Infinity, paceMul: 1 }
}

// pit geometry: blend off the racing line near the end of the lap
const PIT_ENTRY = L - 235 // branch point
const PIT_BOX_ROW_START = L - 55 // boxes along the start straight (pre-line)
const PIT_EXIT = 150 // rejoin after the line
const PIT_LAT = 21 // pit row offset (left side)

function pitBoxS(car: Car): number {
  return PIT_BOX_ROW_START + (car.spec.grid - 1) * 6.5
}

// ---------------- the simulation loop ----------------

let t = 0
let lapOfLeader = 0
let drsEnabled = false
let rain = 0 // 0..1 intensity
let rainPhase: 'dry' | 'start' | 'heavy' | 'clearing' = 'dry'
let rainHasFallen = false // the rain arc is one-way: dry → rain → dry, never again
const scWindows: Array<[number, number]> = [] // session-time windows
const vscWindows: Array<[number, number]> = []
let raceOver = false
const leaderLapStartTs: number[] = [0]

// order tracking (by s + lap*L)
const prog = (c: Car) => c.s + 0 // s is already monotonic across laps

let lastSampleT = -1
let orderAtLastEmit: number[] = []
const lastPassAt = new Map<string, number>()

const emitIntervals = (tNow: number) => {
  const running = cars.filter((c) => !c.retired && c.lap >= 0).sort((a, b) => prog(b) - prog(a) || a.finishT - b.finishT)
  for (let i = 0; i < running.length; i++) {
    const c = running[i]
    let iv: number
    if (i === 0) iv = 0
    else {
      const ahead = running[i - 1]
      iv = ahead.finished && c.finished ? ahead.finishT - c.finishT : Math.max(0, (prog(ahead) - prog(c)) / Math.max(12, c.v))
    }
    ivRows.push({ t: tNow, d: c.spec.number, gap: NaN, interval: iv, gapLaps: 0 })
  }
  // convert to cumulative gaps to leader
  const byT = ivRows.filter((r) => r.t === tNow)
  let acc = 0
  for (const r of byT) {
    acc += r.interval
    r.gap = acc
  }
}

const emitPositions = (tNow: number) => {
  // classified cars all sit AT the flag (same s): their order is finish order
  const running = cars.filter((c) => !c.retired).sort((a, b) => prog(b) - prog(a) || a.finishT - b.finishT)
  const order = running.map((c) => c.spec.number)
  const changed =
    order.length !== orderAtLastEmit.length ||
    order.some((d, i) => d !== orderAtLastEmit[i])
  if (changed) {
    order.forEach((d, i) => posRows.push({ t: tNow, d, p: i + 1 }))
    orderAtLastEmit = order
  }
}

// main loop — 5 Hz ticks, session time from 0
const DT = 1 / HZ
let tick = 0
let leaderProgAtLapMark = 0

while (!raceOver && t < 5400) {
  const leaderCar = cars.filter((c) => !c.retired).sort((a, b) => prog(b) - prog(a))[0]
  lapOfLeader = Math.floor(prog(leaderCar) / L)

  // race phases by leader lap
  const scActive = scWindows.some(([a, b]) => t >= a && t < b)
  const vscActive = vscWindows.some(([a, b]) => t >= a && t < b)
  // schedule SC/VSC windows once (session-time conversions happen on first pass)
  if (scWindows.length === 0 && lapOfLeader >= SC1_LAP) {
    scWindows.push([t, t + 3 * 74])
    rcRows.push({ t, category: 'SafetyCar', flag: 'SC', scope: 'Track', sector: null, message: 'SAFETY CAR DEPLOYED', driverNumber: null, lapNumber: lapOfLeader })
    // HUL retires into the T1 run-off
    const hul = cars.find((c) => c.spec.acronym === 'HUL')!
    hul.retireAt = t + 11
    rcRows.push({ t: t + 11, category: 'Incident', flag: 'YELLOW', scope: 'Driver', sector: 1, message: 'CAR STOPPED AT TURN 1 — HULKENBERG (27)', driverNumber: 27, lapNumber: lapOfLeader })
  }
  if (vscWindows.length === 0 && lapOfLeader >= VSC_LAP) {
    vscWindows.push([t, t + 70])
    rcRows.push({ t, category: 'Flag', flag: 'VSC', scope: 'Track', sector: null, message: 'VIRTUAL SAFETY CAR DEPLOYED', driverNumber: null, lapNumber: lapOfLeader })
    rcRows.push({ t: t + 70, category: 'Flag', flag: 'GREEN', scope: 'Track', sector: null, message: 'VIRTUAL SAFETY CAR ENDING', driverNumber: null, lapNumber: lapOfLeader })
  }
  if (rainPhase === 'dry' && lapOfLeader >= RAIN_START_LAP && !rainHasFallen) {
    rainHasFallen = true
    rainPhase = 'start'
    rain = 0.25
    rcRows.push({ t, category: 'Weather', flag: null, scope: 'Track', sector: null, message: 'RAIN ON TRACK — SECTOR 3', driverNumber: null, lapNumber: lapOfLeader })
  }
  if (rainPhase === 'start' && lapOfLeader >= RAIN_HEAVY_LAP) {
    rainPhase = 'heavy'
    rain = 0.8
    if (scWindows.length === 1 && lapOfLeader >= SC2_LAP) {
      scWindows.push([t, t + 3 * 80])
      rcRows.push({ t, category: 'SafetyCar', flag: 'SC', scope: 'Track', sector: null, message: 'SAFETY CAR DEPLOYED — HEAVY RAIN', driverNumber: null, lapNumber: lapOfLeader })
    }
  }
  if (rainPhase === 'heavy' && lapOfLeader >= SC2_END_LAP + 1) {
    rainPhase = 'clearing'
    rain = 0.35
  }
  if (rainPhase === 'clearing' && lapOfLeader >= 51) {
    rainPhase = 'dry'
    rain = 0
    rcRows.push({ t, category: 'Weather', flag: null, scope: 'Track', sector: null, message: 'TRACK DRYING — RACING LINE GREEN', driverNumber: null, lapNumber: lapOfLeader })
  }
  drsEnabled = lapOfLeader >= 2 && !scActive && !vscActive && rain < 0.05

  // weather rows every 60 s
  if (tick % (60 * HZ) === 0) {
    weatherRows.push({
      t, airTemp: 24 - rain * 4, trackTemp: 42 - rain * 19 - (rainPhase === 'clearing' ? -6 : 0),
      humidity: 55 + rain * 35, rainfall: rain, windSpeed: 3 + rain * 6, windDirection: 120,
    })
  }

  // sample + advance every car
  const orderNow = cars.filter((c) => !c.retired).sort((a, b) => prog(b) - prog(a))
  for (let oi = 0; oi < orderNow.length; oi++) {
    const car = orderNow[oi]
    const ahead = oi > 0 ? orderNow[oi - 1] : null
    if (car.finished) continue

    // retirement: car parks off-line, data ends 45 s later
    if (!car.retired && t >= car.retireAt) {
      car.retired = true
      continue
    }
    if (car.retired) continue

    // ---- pit lane state machine ----
    if (car.inPit && t >= car.pitUntil) {
      car.inPit = false
      car.exitingPit = true // holds the pit lat until the exit blend finishes
    }

    // ---- decide pit entry (once, on the approach) ----
    const stintEndLap = car.spec.strategy[car.stintIdx]?.toLap ?? TOTAL_LAPS
    const wantPit = !car.inPit && car.stintIdx < car.spec.strategy.length - 1 && car.lap >= stintEndLap - 1 && (car.s % L) > PIT_ENTRY - 5 && (car.s % L) < PIT_ENTRY
    if (wantPit) {
      car.inPit = true
      const stopDur = 2.2 + Math.random() * 1.5
      // transit from entry to this car's box at the limiter (decel included)
      const boxDist = pitBoxS(car) - (car.s % L)
      car.pitTransitUntil = t + Math.max(3, boxDist / (PIT_SPEED + 4))
      car.pitStopDur = stopDur
      car.pitUntil = car.pitTransitUntil + stopDur + 7 // launch + exit lane
      car.pitStopT = t
      // advance the stint at the box
      car.stintIdx++
      car.tireAge = 0
      stintRows.push({
        driverNumber: car.spec.number, stintNumber: car.stintIdx + 1,
        lapStart: car.lap + 1, lapEnd: (car.spec.strategy[car.stintIdx]?.toLap ?? TOTAL_LAPS),
        compound: car.spec.strategy[car.stintIdx]?.compound ?? 'MEDIUM', tyreAgeAtStart: 0,
      })
      pitRows.push({ driverNumber: car.spec.number, lapNumber: car.lap + 1, t: t + 3, pitDuration: stopDur })
      car.pitLapsDone.add(car.lap + 1)
    }

    // ---- longitudinal dynamics ----
    {
      const phase = phaseCaps(t, { sc: scActive, vsc: vscActive, rain })
      const grip = gripOf(car, rain, scActive)
      let vTarget = (planSpeed(car.s) * grip * phase.paceMul) / car.spec.pace
      if (phase.vCap !== Infinity) vTarget = Math.min(vTarget, phase.vCap)
      if (t < GRID_HOLD_S) vTarget = 0
      if (car.inPit) {
        if (t < car.pitTransitUntil) vTarget = PIT_SPEED
        else if (t < car.pitTransitUntil + car.pitStopDur) vTarget = 0
        else vTarget = PIT_SPEED
      }

      // dirty air / DRS vs the car ahead; SC bunching to a queue
      if (ahead && !car.inPit && !ahead.inPit) {
        const gapM = prog(ahead) - prog(car)
        const gapS = gapM / Math.max(15, car.v)
        if (scActive) {
          if (gapM < 26) vTarget = Math.min(vTarget, ahead.v + (gapM - 17) * 0.55)
        } else if (gapS < 0.55 && gapM > 6) {
          const drs = drsEnabled && inDrsZone(car.s)
          vTarget *= drs ? 1.045 : (1 - (0.55 - gapS) * 0.06) // tow hurts in corners, DRS helps on straights
        }
      }

      const dv = vTarget - car.v
      const a = dv > 0 ? Math.min(A_ACC * 0.95, dv / DT) : Math.max(-A_BRK * 0.9, dv / DT)
      car.v = Math.max(0, car.v + a * DT)
    }

    // ---- position along the track ----
    car.s += car.v * DT

    // pit lane lateral blend: racing line → box row → racing line
    {
      const ss = ((car.s % L) + L) % L
      // organic racing-line wobble
      let targetLat = Math.sin(car.s / L * Math.PI * 2 + car.spec.grid) * 1.35
      if (car.inPit) {
        if (ss > PIT_ENTRY && ss < PIT_BOX_ROW_START - 40) {
          const u = (ss - PIT_ENTRY) / (PIT_BOX_ROW_START - 40 - PIT_ENTRY)
          targetLat = -PIT_LAT * u // blend left to the pit row
        } else if (ss >= PIT_BOX_ROW_START - 40 && ss < 60) {
          targetLat = -PIT_LAT // in the box row (wraps the line)
        }
      } else if (car.exitingPit) {
        if (ss >= 60 && ss < PIT_EXIT) {
          const u = (ss - 60) / (PIT_EXIT - 60)
          targetLat = -PIT_LAT * (1 - u)
        } else if (ss >= PIT_EXIT) {
          car.exitingPit = false
        } else {
          targetLat = -PIT_LAT
        }
      }
      car.lat += (targetLat - car.lat) * Math.min(1, DT * 3.2)
    }

    // ---- lap / sector bookkeeping ----
    const lapNow = Math.floor((car.s - 14) / L) // line at s=14 (grid cars start behind it)
    if (lapNow > car.lap) {
      const dur = t - car.lapStartT
      car.laps.push({
        lap: lapNow, t: car.lapStartT, dur,
        s1: car.sectorT[0] ? car.sectorT[0] - car.lapStartT : null,
        s2: car.sectorT[1] ? car.sectorT[1] - car.sectorT[0] : null,
        s3: car.sectorT[1] ? dur - (car.sectorT[1] - car.lapStartT) : null,
        pitOut: car.pitLapsDone.has(lapNow),
      })
      car.lap = lapNow
      car.lapStartT = t
      car.sectorT = [0, 0]
      car.tireAge++
      if (car.lap >= TOTAL_LAPS) {
        car.finished = true
        car.finishT = t
        car.s = 14 + TOTAL_LAPS * L // snap to the flag: classified cars hold one rank order
      }
    }
    // sector crossings
    const sInLap = ((car.s - 14) % L + L) % L
    if (sInLap >= L * track.sectorParam[1] && car.sectorT[0] === 0) car.sectorT[0] = t
    if (sInLap >= L * track.sectorParam[2] && car.sectorT[1] === 0) car.sectorT[1] = t

    // ---- DRS passes (the visible overtake mechanic) ----
    if (ahead && !car.inPit && !ahead.inPit && drsEnabled && inDrsZone(car.s) && t > GRID_HOLD_S + 30) {
      const gapM = prog(ahead) - prog(car)
      const key = `${car.spec.number}-${ahead.spec.number}`
      const lastT = lastPassAt.get(key) ?? -1e9
      if (gapM > 5 && gapM < 22 && t - lastT > 15) {
        const paceEdge = ahead.spec.pace - car.spec.pace
        if (paceEdge > -0.0015 || Math.random() < 0.05) {
          // side-by-side: attacker dives inside, defender drifts out
          car.lat = Math.max(car.lat - 2.6, -3.4)
          ahead.lat = Math.min(ahead.lat + 2.2, 3.4)
          car.v = Math.min(car.v * 1.055, 98)
          if (gapM < 10) {
            lastPassAt.set(key, t)
            overtakeRows.push({ t, overtaking: car.spec.number, overtaken: ahead.spec.number, position: oi + 1 })
          }
        }
      }
    }

    // ---- record the 5 Hz channel ----
    frameAt(car.s, frame)
    // lateral offset: left-normal = (−ty, tx) in telemetry plane
    const x = frame.x + -frame.ty * car.lat
    const y = frame.y + frame.tx * car.lat
    car.xs.push(x); car.ys.push(y); car.zs.push(frame.z)
    car.spd.push(car.v * 3.6)
    // throttle/brake from planned accel (looks right in the HUD)
    const vt = planSpeed(car.s) * gripOf(car, rain, scActive)
    const dvc = (vt - car.v)
    const thr = car.v < 2 && t > GRID_HOLD_S - 0.2 ? 80 : Math.max(0, Math.min(100, 55 + dvc * 9))
    const brk = Math.max(0, Math.min(100, -dvc * 7.5))
    car.thr.push(t < GRID_HOLD_S ? 0 : Math.round(thr))
    car.brk.push(Math.round(t < GRID_HOLD_S ? 0 : brk))
    const kmh = car.v * 3.6
    const gear = car.v < 1 ? 0 : kmh < 95 ? 2 : kmh < 130 ? 3 : kmh < 165 ? 4 : kmh < 210 ? 5 : kmh < 260 ? 6 : kmh < 310 ? 7 : 8
    car.gear.push(gear)
    car.rpm.push(car.v < 1 ? 3800 : Math.round(9500 + (kmh % 45) * 40 + (thr - 55) * 8))
    car.drs.push(drsEnabled && inDrsZone(car.s) && !car.inPit && car.v > 70 ? 12 : 0)
  }

  // leader lap markers for phase bookkeeping
  if (Math.floor(prog(leaderCar) / L) > lapOfLeader) {
    // (already handled at loop top)
  }

  t += DT
  tick++

  // intervals every 5 s, positions on change (checked at 1 Hz)
  if (tick % (5 * HZ) === 0) emitIntervals(t)
  if (tick % HZ === 0) emitPositions(t)

  raceOver = cars.filter((c) => !c.retired).every((c) => c.finished)
}

// final SC green-flag messages
for (const [a, b] of scWindows) {
  rcRows.push({ t: b, category: 'SafetyCar', flag: 'GREEN', scope: 'Track', sector: null, message: 'SAFETY CAR IN THIS LAP', driverNumber: null, lapNumber: null })
}
rcRows.push({ t, category: 'Flag', flag: 'CHEQUERED', scope: 'Track', sector: null, message: 'CHEQUERED FLAG', driverNumber: null, lapNumber: TOTAL_LAPS })
rcRows.sort((a, b) => a.t - b.t)

// final classification: finishers by finish time, then retirements by distance
const finalOrder = cars.slice().sort((a, b) => {
  const ka = a.finished ? 0 : 1
  const kb = b.finished ? 0 : 1
  if (ka !== kb) return ka - kb
  return a.finished ? a.finishT - b.finishT : b.lap - a.lap
})
const winnerT = finalOrder[0].finishT
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
const results: ResultEvent[] = finalOrder.map((c, i) => {
  const dnf = !c.finished
  return {
    driverNumber: c.spec.number,
    position: dnf ? null : i + 1,
    lapsCompleted: c.lap,
    points: dnf ? 0 : (POINTS[i] ?? 0),
    dnf, dns: false, dsq: false,
    duration: dnf ? null : c.finishT,
    gapToLeader: dnf ? null : Math.max(0, c.finishT - winnerT),
  }
})

// ---------------- assemble the pack ----------------

const meta: SessionMetaRow = {
  session_key: SESSION_KEY,
  meeting_key: SESSION_KEY,
  session_name: 'Race',
  session_type: 'Race',
  date_start: '2024-11-03T14:00:00.000000+00:00',
  date_end: new Date(EPOCH0 + t * 1000).toISOString(),
  circuit_key: 63,
  circuit_short_name: 'Interlagos',
  country_name: 'Brazil',
  country_code: 'BRA',
  location: 'São Paulo',
  year: 2024,
  gmt_offset: '-03:00:00',
}

const drivers: DriverRow[] = FIELD.map((f) => ({
  driver_number: f.number,
  name_acronym: f.acronym,
  full_name: f.full,
  broadcast_name: f.full.toUpperCase(),
  team_name: f.team,
  team_colour: f.color,
  first_name: f.full.split(' ')[0],
  last_name: f.full.split(' ').slice(1).join(' '),
  headshot_url: null,
  country_code: null,
}))

const channels: SessionData['channels'] = {}
for (const car of cars) {
  channels[car.spec.number] = {
    driverNumber: car.spec.number,
    t0: 0,
    hz: HZ,
    n: car.xs.length,
    x: Float32Array.from(car.xs),
    y: Float32Array.from(car.ys),
    z: Float32Array.from(car.zs),
    speed: Float32Array.from(car.spd),
    throttle: Uint8Array.from(car.thr),
    brake: Uint8Array.from(car.brk),
    gear: Uint8Array.from(car.gear),
    rpm: Uint16Array.from(car.rpm),
    drs: Uint8Array.from(car.drs),
  }
}

// first stints (stint 1 for everyone)
for (const car of cars) {
  stintRows.unshift({
    driverNumber: car.spec.number, stintNumber: 1, lapStart: 1,
    lapEnd: car.spec.strategy[0].toLap, compound: car.spec.strategy[0].compound, tyreAgeAtStart: 0,
  })
}
stintRows.sort((a, b) => a.driverNumber - b.driverNumber || a.stintNumber - b.stintNumber)

const laps: LapEvent[] = cars.flatMap((car) =>
  car.laps.map((l) => ({
    driver_number: car.spec.number,
    lap_number: l.lap,
    date_start: new Date(EPOCH0 + l.t * 1000).toISOString(),
    lap_duration: l.dur,
    duration_sector_1: l.s1, duration_sector_2: l.s2, duration_sector_3: l.s3,
    is_pit_out_lap: l.pitOut,
    i1_speed: null, i2_speed: null, st_speed: null,
    segments_sector_1: null, segments_sector_2: null, segments_sector_3: null,
    t: l.t,
  })),
).sort((a, b) => a.t - b.t)

posRows.sort((a, b) => a.t - b.t)
const positions: PositionTable = {
  t: Float64Array.from(posRows, (r) => r.t),
  driver: Uint8Array.from(posRows, (r) => r.d),
  position: Uint8Array.from(posRows, (r) => r.p),
}
ivRows.sort((a, b) => a.t - b.t)
const intervals: IntervalTable = {
  t: Float64Array.from(ivRows, (r) => r.t),
  driver: Uint8Array.from(ivRows, (r) => r.d),
  gap: Float32Array.from(ivRows, (r) => (Number.isFinite(r.gap) ? r.gap : NaN)),
  interval: Float32Array.from(ivRows, (r) => (Number.isFinite(r.interval) ? r.interval : NaN)),
  gapLaps: Uint8Array.from(ivRows, (r) => r.gapLaps),
}

const data: SessionData = {
  meta, epoch0: EPOCH0, drivers, channels,
  laps, stints: stintRows, pits: pitRows, raceControl: rcRows,
  weather: weatherRows, radio: [], positions, intervals,
  results, overtakes: overtakeRows.sort((a, b) => a.t - b.t), grid: gridEvents,
  tMin: 0, tMax: t,
  tAction: GRID_HOLD_S - 8,
}

const buffer = encodePack(data)
mkdirSync(join(ROOT, 'public/packs'), { recursive: true })
const out = join(ROOT, `public/packs/${SESSION_KEY}.apx`)
writeFileSync(out, new Uint8Array(buffer))

console.log(`demo pack written: ${out}`)
console.log(`  session ${SESSION_KEY} · plan lap ${profileLapS.toFixed(1)}s · race ${t.toFixed(0)}s · ${TOTAL_LAPS} laps`)
console.log(`  pack ${(buffer.byteLength / 1e6).toFixed(1)} MB · overtakes ${overtakeRows.length} · pits ${pitRows.length}`)
console.log(`  leader: ${FIELD.find((f) => f.number === finalOrder[0].spec.number)?.acronym}`)
