/* ============================================================
   Probe EVERY OpenF1 endpoint the loader consumes, with tiny
   queries, and assert each response row's SHAPE against the
   contracts in src/data/types.ts.

   Purpose: catch upstream schema drift EARLY — the 404-empty
   semantics discovery proved drift happens silently.

   Politeness contract: setMinSpacing(2400) ≈ 25 req/min; big
   channels (location/car_data) are windowed to ~2 seconds so a
   full probe costs ~13 requests total.

   usage:
     npx tsx scripts/probe-endpoints.ts [session_key]
   (no key ⇒ most recent COMPLETED race is auto-picked)
   ============================================================ */

import { fetchRows, setMinSpacing } from '../src/data/openf1'
import type {
  SessionMetaRow,
  DriverRow,
  LapRow,
  StintRow,
  PitRow,
  RaceControlRow,
  WeatherRow,
  RadioRow,
  PositionRow,
  IntervalRow,
  LocationRow,
  CarDataRow,
  SessionResultRow,
} from '../src/data/types'

setMinSpacing(2400)

const CURRENT_YEAR = new Date().getFullYear()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Check {
  name: string
  endpoint: string
  params: Record<string, string | number>
  expect: string[]
}

const CHECKS: Check[] = [
  { name: 'sessions', endpoint: 'sessions', params: { session_name: 'Race', session_type: 'Race', year: CURRENT_YEAR - 1 }, expect: ['session_key', 'meeting_key', 'session_name', 'session_type', 'date_start', 'date_end', 'circuit_key', 'circuit_short_name', 'country_name', 'location', 'year'] },
  { name: 'drivers', endpoint: 'drivers', params: { session_key: 0 }, expect: ['driver_number', 'name_acronym', 'full_name', 'team_name', 'team_colour'] },
  { name: 'laps', endpoint: 'laps', params: { session_key: 0, lap_number: 10 }, expect: ['driver_number', 'lap_number', 'lap_duration', 'is_pit_out_lap', 'segments_sector_1'] },
  { name: 'stints', endpoint: 'stints', params: { session_key: 0 }, expect: ['driver_number', 'stint_number', 'lap_start', 'lap_end', 'compound', 'tyre_age_at_start'] },
  { name: 'pit', endpoint: 'pit', params: { session_key: 0 }, expect: ['driver_number', 'lap_number', 'date', 'pit_duration'] },
  { name: 'race_control', endpoint: 'race_control', params: { session_key: 0 }, expect: ['date', 'category', 'flag', 'message', 'driver_number', 'lap_number'] },
  { name: 'weather', endpoint: 'weather', params: { session_key: 0 }, expect: ['date', 'air_temperature', 'track_temperature', 'humidity', 'rainfall'] },
  { name: 'team_radio', endpoint: 'team_radio', params: { session_key: 0 }, expect: ['date', 'driver_number', 'recording_url'] },
]

/** big motion channels + position/intervals get tight time windows */
function windowedChecks(meta: SessionMetaRow): Check[] {
  const t0 = new Date(Date.parse(meta.date_start) + 120_000).toISOString().slice(0, 19)
  const t1 = new Date(Date.parse(meta.date_start) + 122_000).toISOString().slice(0, 19)
  const w = { session_key: meta.session_key, 'date>=': t0, 'date<=': t1 }
  return [
    { name: 'position', endpoint: 'position', params: w, expect: ['date', 'driver_number', 'position'] },
    { name: 'intervals', endpoint: 'intervals', params: w, expect: ['date', 'driver_number', 'gap_to_leader', 'interval'] },
    { name: 'location', endpoint: 'location', params: w, expect: ['date', 'driver_number', 'x', 'y', 'z'] },
    { name: 'car_data', endpoint: 'car_data', params: w, expect: ['date', 'driver_number', 'speed', 'throttle', 'brake', 'n_gear', 'rpm', 'drs'] },
    { name: 'session_result', endpoint: 'session_result', params: { session_key: meta.session_key }, expect: ['position', 'driver_number', 'number_of_laps', 'points', 'dnf', 'gap_to_leader'] },
  ]
}

async function pickSession(): Promise<SessionMetaRow> {
  for (const year of [CURRENT_YEAR, CURRENT_YEAR - 1]) {
    const rows = await fetchRows<SessionMetaRow>('sessions', { session_name: 'Race', session_type: 'Race', year })
    const done = rows.filter((r) => Date.parse(r.date_end) < Date.now()).sort((a, b) => b.date_start.localeCompare(a.date_start))
    if (done.length > 0) return done[0]
  }
  throw new Error('no completed race found')
}

let failures = 0

async function runCheck(c: Check): Promise<void> {
  try {
    const rows = await fetchRows<Record<string, unknown>>(c.endpoint, c.params, { allowEmpty404: true })
    if (rows.length === 0) {
      console.log(`  ⚠ ${c.name.padEnd(15)} EMPTY (allowed, but shape unverified)`)
      return
    }
    const missing = c.expect.filter((k) => !(k in rows[0]))
    if (missing.length > 0) {
      failures++
      console.log(`  ✗ ${c.name.padEnd(15)} MISSING FIELDS: ${missing.join(', ')}`)
      console.log(`      got: ${Object.keys(rows[0]).join(', ')}`)
    } else {
      console.log(`  ✓ ${c.name.padEnd(15)} shape OK · ${rows.length} rows`)
    }
  } catch (e) {
    failures++
    console.log(`  ✗ ${c.name.padEnd(15)} FETCH FAILED — ${(e as Error).message}`)
  }
}

console.log(`probing OpenF1 endpoints…`)
const meta = await pickSession()
console.log(`reference session: ${meta.session_key} ${meta.circuit_short_name} ${meta.date_start.slice(0, 10)}\n`)

for (const c of CHECKS) {
  await runCheck(c.params.session_key === 0 ? { ...c, params: { ...c.params, session_key: meta.session_key } } : c)
  await sleep(400)
}
for (const c of windowedChecks(meta)) {
  await runCheck(c)
  await sleep(400)
}

console.log(failures === 0 ? `\nALL CONTRACTS HOLD` : `\n${failures} CONTRACT FAILURE(S) — types.ts needs updating or upstream drifted`)
process.exitCode = failures === 0 ? 0 : 1
