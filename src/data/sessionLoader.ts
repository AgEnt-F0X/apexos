/* ============================================================
   Full-session load orchestration. Runs inside the worker.
   sessions → drivers → small tables (parallel) → windowed
   all-driver location + car_data → resample → APEXPACK.
   ============================================================ */

import { fetchRows, timeWindows } from './openf1'
import { resampleUniform } from './resample'
import { getCachedPack, putCachedPack } from './cache'
import { encodePack } from './pack'
import {
  CHANNEL_HZ,
  type CarDataRow,
  type DriverChannels,
  type DriverRow,
  type GridEvent,
  type IntervalRow,
  type IntervalTable,
  type LapRow,
  type LoadProgress,
  type LocationRow,
  type OvertakeEvent,
  type OvertakeRow,
  type PitRow,
  type PositionRow,
  type PositionTable,
  type RaceControlRow,
  type RadioRow,
  type ResultEvent,
  type SessionData,
  type SessionMetaRow,
  type SessionResultRow,
  type StartingGridRow,
  type StintRow,
  type WeatherRow,
} from './types'

const WINDOW_SEC = 180 // ~14k rows per all-driver window — light enough that the API stays happy

// ---------- fast ISO parsing ----------
// OpenF1 dates: "2024-05-26T13:05:00.009000+00:00" (always UTC).
// Cache the minute prefix; parseFloat the seconds. ~100x Date.parse.

const minuteCache = new Map<string, number>()

export function parseIsoMs(s: string): number {
  const prefix = s.slice(0, 16) // "2024-05-26T13:05"
  let base = minuteCache.get(prefix)
  if (base === undefined) {
    base = Date.parse(prefix + ':00Z')
    minuteCache.set(prefix, base)
  }
  const sec = parseFloat(s.slice(17)) // "00.009000+00:00" → 0.009
  return base + sec * 1000
}

// ---------- shared normalizers (the upgrade script reuses these — one shape) ----------

export function normalizeResults(rows: SessionResultRow[]): ResultEvent[] {
  return rows
    .map((r) => ({
      driverNumber: r.driver_number,
      position: r.position,
      lapsCompleted: r.number_of_laps,
      points: r.points,
      dnf: r.dnf ?? false,
      dns: r.dns ?? false,
      dsq: r.dsq ?? false,
      duration: r.duration,
      gapToLeader: r.gap_to_leader,
    }))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
}

// ---------- per-driver accumulation ----------

interface LocAcc { t: number[]; x: number[]; y: number[]; z: number[] }
interface CarAcc { t: number[]; speed: number[]; throttle: number[]; brake: number[]; gear: number[]; rpm: number[]; drs: number[] }

function ensureSorted(t: number[]): boolean {
  for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1]) return false
  return true
}

// ---------- main entry ----------

export async function loadSession(
  sessionKey: number,
  emit: (p: LoadProgress) => void,
): Promise<{ buffer: ArrayBuffer; fromCache: boolean }> {
  let rows = 0
  const progress = (stage: LoadProgress['stage'], frac: number, label: string) =>
    emit({ stage, frac, label, rows })

  progress('cache', 0, 'CHECKING LOCAL ARCHIVE')
  const cached = await getCachedPack(sessionKey)
  if (cached) {
    progress('cache', 1, 'ARCHIVE HIT — RESTORING')
    return { buffer: cached, fromCache: true }
  }

  // --- session meta + drivers ---
  progress('tables', 0, 'SESSION MANIFEST')
  const metas = await fetchRows<SessionMetaRow>('sessions', { session_key: sessionKey })
  if (metas.length === 0) throw new Error(`session ${sessionKey} not found`)
  const meta = metas[0]
  const epoch0 = parseIsoMs(meta.date_start)
  const toT = (iso: string): number => (parseIsoMs(iso) - epoch0) / 1000

  const drivers = await fetchRows<DriverRow>('drivers', { session_key: sessionKey })
  rows += drivers.length

  // --- small tables, parallel through the queue ---
  const tableNames = ['laps', 'stints', 'pit', 'race_control', 'weather', 'team_radio', 'position', 'intervals', 'session_result', 'overtakes', 'starting_grid']
  let tablesDone = 0
  const tick = <T>(p: Promise<T[]>): Promise<T[]> =>
    p.then((r) => {
      tablesDone++
      rows += r.length
      progress('tables', tablesDone / tableNames.length, `TIMING TABLES ${tablesDone}/${tableNames.length}`)
      return r
    })

  const [lapRows, stintRows, pitRows, rcRows, weatherRows, radioRows, positionRows, intervalRows, resultRows, overtakeRows, gridRows] =
    await Promise.all([
      tick(fetchRows<LapRow>('laps', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<StintRow>('stints', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<PitRow>('pit', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<RaceControlRow>('race_control', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<WeatherRow>('weather', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<RadioRow>('team_radio', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<PositionRow>('position', { session_key: sessionKey }, { allowEmpty404: true })),
      tick(fetchRows<IntervalRow>('intervals', { session_key: sessionKey }, { allowEmpty404: true })),
      // final classification — a small static table; tolerate absence on old
      // archived sessions by treating failure as "no results" rather than
      // failing the whole load
      tick(
        fetchRows<SessionResultRow>('session_result', { session_key: sessionKey }).catch(() => [] as SessionResultRow[]),
      ),
      // authoritative on-track passes — races only, and often incomplete;
      // an absent/failed table is a legitimate empty set, never fatal
      tick(
        fetchRows<OvertakeRow>('overtakes', { session_key: sessionKey }, { allowEmpty404: true }).catch(() => [] as OvertakeRow[]),
      ),
      // starting grid — published post-quali; tolerate absence (practice/old)
      tick(
        fetchRows<StartingGridRow>('starting_grid', { session_key: sessionKey }, { allowEmpty404: true }).catch(() => [] as StartingGridRow[]),
      ),
    ])

  // --- determine the true telemetry range (red flags can run past date_end) ---
  let endMs = parseIsoMs(meta.date_end)
  for (const l of lapRows) {
    if (l.date_start && l.lap_duration) {
      endMs = Math.max(endMs, parseIsoMs(l.date_start) + (l.lap_duration + 90) * 1000)
    }
  }
  if (rcRows.length > 0) endMs = Math.max(endMs, parseIsoMs(rcRows[rcRows.length - 1].date) + 60_000)
  if (intervalRows.length > 0) endMs = Math.max(endMs, parseIsoMs(intervalRows[intervalRows.length - 1].date) + 30_000)
  const startMs = epoch0 - 60_000

  // --- windowed telemetry: all drivers per window ---
  const windows = timeWindows(startMs, endMs, WINDOW_SEC)

  const locAcc = new Map<number, LocAcc>()
  const carAcc = new Map<number, CarAcc>()

  const fetchWindowed = async <T extends { date: string; driver_number: number }>(
    endpoint: 'location' | 'car_data',
    stage: 'location' | 'car_data',
    label: string,
    ingest: (row: T) => void,
  ) => {
    let done = 0
    const results: Array<T[] | null> = new Array(windows.length).fill(null)

    const fetchInto = async (i: number): Promise<boolean> => {
      const [a, b] = windows[i]
      try {
        // time-bounded windows legitimately 404 when the range holds no rows
        results[i] = await fetchRows<T>(
          endpoint,
          { session_key: sessionKey, 'date>=': a, 'date<': b },
          { allowEmpty404: true },
        )
        rows += results[i]!.length
        return true
      } catch {
        return false // window failed all its retries — sweep it up later
      }
    }

    // pass 1: all windows, queue-limited (2 lanes). A window that exhausts its
    // retries doesn't reject the batch — the API sheds load under a long pull,
    // so we simply note the gap and revisit it once the pressure is off.
    await Promise.all(
      windows.map(async (_, i) => {
        await fetchInto(i)
        done++
        progress(stage, done / windows.length, `${label} ${done}/${windows.length}`)
      }),
    )

    // pass 2+: retry the gaps sequentially, after letting the API breathe.
    for (let sweep = 0; sweep < 3; sweep++) {
      const missing = results.flatMap((r, i) => (r === null ? [i] : []))
      if (missing.length === 0) break
      await new Promise((r) => setTimeout(r, 4000))
      progress(stage, done / windows.length, `${label} — RECOVERING ${missing.length} GAP${missing.length > 1 ? 'S' : ''}`)
      for (const i of missing) await fetchInto(i)
    }

    const stillMissing = results.filter((r) => r === null).length
    if (stillMissing > 2) {
      throw new Error(`${endpoint}: ${stillMissing} telemetry windows unrecoverable — the OpenF1 archive may be under load, try again`)
    }
    for (const chunk of results) if (chunk) for (const row of chunk) ingest(row)
  }

  await fetchWindowed<LocationRow>('location', 'location', 'POSITIONAL TELEMETRY', (r) => {
    let acc = locAcc.get(r.driver_number)
    if (!acc) {
      acc = { t: [], x: [], y: [], z: [] }
      locAcc.set(r.driver_number, acc)
    }
    // raw decimeters → meters
    acc.t.push((parseIsoMs(r.date) - epoch0) / 1000)
    acc.x.push(r.x / 10)
    acc.y.push(r.y / 10)
    acc.z.push(r.z / 10)
  })

  await fetchWindowed<CarDataRow>('car_data', 'car_data', 'CAR TELEMETRY', (r) => {
    let acc = carAcc.get(r.driver_number)
    if (!acc) {
      acc = { t: [], speed: [], throttle: [], brake: [], gear: [], rpm: [], drs: [] }
      carAcc.set(r.driver_number, acc)
    }
    acc.t.push((parseIsoMs(r.date) - epoch0) / 1000)
    acc.speed.push(r.speed)
    acc.throttle.push(r.throttle)
    acc.brake.push(r.brake)
    acc.gear.push(r.n_gear)
    acc.rpm.push(r.rpm)
    acc.drs.push(r.drs)
  })

  // --- resample to uniform channels ---
  progress('pack', 0, 'RESAMPLING CHANNELS')
  const channels: Record<number, DriverChannels> = {}
  for (const [driverNumber, loc] of locAcc) {
    const car = carAcc.get(driverNumber)
    if (!car || car.t.length === 0) continue // location without matching car_data — skip honestly
    if (loc.t.length < 10) continue
    if (!ensureSorted(loc.t)) {
      const order = Array.from(loc.t.keys()).sort((a, b) => loc.t[a] - loc.t[b])
      for (const key of ['t', 'x', 'y', 'z'] as const) {
        const src = loc[key]
        loc[key] = order.map((i) => src[i])
      }
    }
    const locRes = resampleUniform(
      {
        t: Float64Array.from(loc.t),
        values: [Float64Array.from(loc.x), Float64Array.from(loc.y), Float64Array.from(loc.z)],
      },
      { modes: ['linear', 'linear', 'linear'], hz: CHANNEL_HZ },
    )
    if (!locRes) continue

    const carRes = (() => {
      const car = carAcc.get(driverNumber)
      if (!car || car.t.length < 10) return null
      if (!ensureSorted(car.t)) {
        const order = Array.from(car.t.keys()).sort((a, b) => car.t[a] - car.t[b])
        for (const key of ['t', 'speed', 'throttle', 'brake', 'gear', 'rpm', 'drs'] as const) {
          const src = car[key]
          car[key] = order.map((i) => src[i])
        }
      }
      return resampleUniform(
        {
          t: Float64Array.from(car.t),
          values: [
            Float64Array.from(car.speed),
            Float64Array.from(car.throttle),
            Float64Array.from(car.brake),
            Float64Array.from(car.gear),
            Float64Array.from(car.rpm),
            Float64Array.from(car.drs),
          ],
        },
        { modes: ['linear', 'linear', 'hold', 'hold', 'linear', 'hold'], hz: CHANNEL_HZ },
        { t0: locRes.t0, n: locRes.n },
      )
    })()

    const n = locRes.n
    const zeros = () => new Float64Array(n)
    const [sp, th, br, ge, rp, dr] = carRes ? carRes.values : [zeros(), zeros(), zeros(), zeros(), zeros(), zeros()]

    channels[driverNumber] = {
      driverNumber,
      t0: locRes.t0,
      hz: CHANNEL_HZ,
      n,
      x: Float32Array.from(locRes.values[0]),
      y: Float32Array.from(locRes.values[1]),
      z: Float32Array.from(locRes.values[2]),
      speed: Float32Array.from(sp),
      throttle: Uint8Array.from(th, (v) => Math.max(0, Math.min(255, Math.round(v)))),
      brake: Uint8Array.from(br, (v) => Math.max(0, Math.min(255, Math.round(v)))),
      gear: Uint8Array.from(ge, (v) => Math.max(0, Math.min(15, Math.round(v)))),
      rpm: Uint16Array.from(rp, (v) => Math.max(0, Math.min(65535, Math.round(v)))),
      drs: Uint8Array.from(dr, (v) => Math.max(0, Math.min(255, Math.round(v)))),
    }
  }

  // --- normalize event tables ---
  const laps = lapRows
    .map((l) => ({ ...l, t: l.date_start ? toT(l.date_start) : NaN }))
    .sort((a, b) => (a.t || 0) - (b.t || 0))

  const stints = stintRows.map((s) => ({
    driverNumber: s.driver_number,
    stintNumber: s.stint_number,
    lapStart: s.lap_start,
    lapEnd: s.lap_end,
    compound: s.compound ?? 'UNKNOWN',
    tyreAgeAtStart: s.tyre_age_at_start ?? 0,
  }))

  const pits = pitRows.map((p) => ({
    driverNumber: p.driver_number,
    lapNumber: p.lap_number,
    t: toT(p.date),
    pitDuration: p.pit_duration,
  }))

  const raceControl = rcRows.map((r) => ({
    t: toT(r.date),
    category: r.category,
    flag: r.flag,
    scope: r.scope,
    sector: r.sector,
    message: r.message,
    driverNumber: r.driver_number,
    lapNumber: r.lap_number,
  }))

  const weather = weatherRows.map((w) => ({
    t: toT(w.date),
    airTemp: w.air_temperature,
    trackTemp: w.track_temperature,
    humidity: w.humidity,
    rainfall: w.rainfall,
    windSpeed: w.wind_speed,
    windDirection: w.wind_direction,
  }))

  const radio = radioRows.map((r) => ({
    t: toT(r.date),
    driverNumber: r.driver_number,
    url: r.recording_url,
  }))

  const posSorted = positionRows
    .map((p) => ({ t: toT(p.date), d: p.driver_number, p: p.position }))
    .sort((a, b) => a.t - b.t)
  const positions: PositionTable = {
    t: Float64Array.from(posSorted, (r) => r.t),
    driver: Uint8Array.from(posSorted, (r) => r.d),
    position: Uint8Array.from(posSorted, (r) => r.p),
  }

  const parseGap = (v: number | string | null): { s: number; laps: number } => {
    if (typeof v === 'number') return { s: v, laps: 0 }
    if (typeof v === 'string') {
      const m = /\+?(\d+)\s+LAP/i.exec(v)
      if (m) return { s: NaN, laps: Number(m[1]) }
    }
    return { s: NaN, laps: 0 }
  }
  const ivSorted = intervalRows
    .map((r) => {
      const g = parseGap(r.gap_to_leader)
      const iv = parseGap(r.interval)
      return { t: toT(r.date), d: r.driver_number, gap: g.s, gapLaps: g.laps, interval: iv.s }
    })
    .sort((a, b) => a.t - b.t)
  const intervals: IntervalTable = {
    t: Float64Array.from(ivSorted, (r) => r.t),
    driver: Uint8Array.from(ivSorted, (r) => r.d),
    gap: Float32Array.from(ivSorted, (r) => r.gap),
    interval: Float32Array.from(ivSorted, (r) => r.interval),
    gapLaps: Uint8Array.from(ivSorted, (r) => Math.min(255, r.gapLaps)),
  }

  const results: ResultEvent[] = normalizeResults(resultRows)

  // authoritative on-track passes, session-time sorted
  const overtakes: OvertakeEvent[] = overtakeRows
    .map((r) => ({
      t: toT(r.date),
      overtaking: r.overtaking_driver_number,
      overtaken: r.overtaken_driver_number,
      position: r.position,
    }))
    .sort((a, b) => a.t - b.t)

  // starting grid — grid order then qualifying lap; sorted by slot
  const grid: GridEvent[] = gridRows
    .map((r) => ({
      driverNumber: r.driver_number,
      position: r.position,
      qualiLap: r.lap_duration,
    }))
    .sort((a, b) => a.position - b.position)

  // --- playable range + action point ---
  const chans = Object.values(channels)
  if (chans.length === 0) throw new Error('no positional telemetry available for this session')
  const tMin = Math.min(...chans.map((c) => c.t0))
  const tMax = Math.max(...chans.map((c) => c.t0 + c.n / c.hz))

  let tAction = tMin
  if (meta.session_type === 'Race') {
    const lap1 = laps.filter((l) => l.lap_number === 1 && Number.isFinite(l.t)).map((l) => l.t)
    if (lap1.length > 0) tAction = Math.max(tMin, Math.min(...lap1) - 8)
  } else {
    const flying = laps.filter((l) => l.lap_duration !== null && Number.isFinite(l.t)).map((l) => l.t)
    if (flying.length > 0) tAction = Math.max(tMin, Math.min(...flying) - 15)
  }

  const data: SessionData = {
    meta,
    epoch0,
    drivers,
    channels,
    laps,
    stints,
    pits,
    raceControl,
    weather,
    radio,
    positions,
    intervals,
    results,
    overtakes,
    grid,
    tMin,
    tMax,
    tAction,
  }

  progress('pack', 0.6, 'WRITING BINARY PACK')
  const buffer = encodePack(data)
  await putCachedPack(sessionKey, buffer)
  progress('pack', 1, 'PACK SEALED')
  return { buffer, fromCache: false }
}
