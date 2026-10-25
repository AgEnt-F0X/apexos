/* ============================================================
   OpenF1 raw row types + the normalized SessionData model.
   Time convention: all normalized times are SECONDS relative to
   the session's date_start ("session time", sT).
   Space convention: raw OpenF1 x/y/z are decimeters; normalized
   channels are METERS.
   ============================================================ */

// ---------- raw API rows ----------

export interface SessionMetaRow {
  session_key: number
  meeting_key: number
  session_name: string
  session_type: string
  date_start: string
  date_end: string
  circuit_key: number
  circuit_short_name: string
  country_name: string
  country_code: string
  location: string
  year: number
  gmt_offset: string
}

export interface MeetingRow {
  meeting_key: number
  meeting_name: string
  meeting_official_name: string
  circuit_short_name: string
  country_name: string
  location: string
  date_start: string
  year: number
}

export interface DriverRow {
  driver_number: number
  name_acronym: string
  full_name: string
  broadcast_name: string
  team_name: string
  team_colour: string | null
  first_name: string | null
  last_name: string | null
  headshot_url: string | null
  country_code: string | null
}

export interface LocationRow {
  date: string
  driver_number: number
  x: number
  y: number
  z: number
}

export interface CarDataRow {
  date: string
  driver_number: number
  speed: number
  throttle: number
  brake: number
  n_gear: number
  rpm: number
  drs: number
}

export interface LapRow {
  driver_number: number
  lap_number: number
  date_start: string | null
  lap_duration: number | null
  duration_sector_1: number | null
  duration_sector_2: number | null
  duration_sector_3: number | null
  is_pit_out_lap: boolean
  i1_speed: number | null
  i2_speed: number | null
  st_speed: number | null
  segments_sector_1: number[] | null
  segments_sector_2: number[] | null
  segments_sector_3: number[] | null
}

export interface StintRow {
  driver_number: number
  stint_number: number
  lap_start: number
  lap_end: number
  compound: string | null
  tyre_age_at_start: number | null
}

export interface PitRow {
  driver_number: number
  lap_number: number
  date: string
  pit_duration: number | null
}

export interface RaceControlRow {
  date: string
  category: string
  flag: string | null
  scope: string | null
  sector: number | null
  message: string
  driver_number: number | null
  lap_number: number | null
}

export interface WeatherRow {
  date: string
  air_temperature: number
  track_temperature: number
  humidity: number
  pressure: number
  rainfall: number
  wind_speed: number
  wind_direction: number
}

export interface RadioRow {
  date: string
  driver_number: number
  recording_url: string
}

export interface PositionRow {
  date: string
  driver_number: number
  position: number
}

export interface IntervalRow {
  date: string
  driver_number: number
  gap_to_leader: number | string | null
  interval: number | string | null
}

/** /overtakes — authoritative on-track passes (races; may be incomplete) */
export interface OvertakeRow {
  date: string
  driver_number: number
  overtaking_driver_number: number
  overtaken_driver_number: number
  position: number
}

/** /starting_grid — grid slots + qualifying lap (published post-quali) */
export interface StartingGridRow {
  driver_number: number
  position: number
  lap_duration: number | null
}

/** /session_result — final classification incl. points & DNF/DNS/DSQ flags */
export interface SessionResultRow {
  position: number | null
  driver_number: number
  number_of_laps: number | null
  points: number | null
  dnf: boolean | null
  dns: boolean | null
  dsq: boolean | null
  duration: number | null
  gap_to_leader: number | null
}

// ---------- normalized model ----------

/** Uniformly resampled motion channels for one driver. Index i is at time t0 + i/hz. */
export interface DriverChannels {
  driverNumber: number
  /** session-time of sample 0, seconds */
  t0: number
  /** samples per second (uniform) */
  hz: number
  /** sample count */
  n: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  speed: Float32Array // km/h
  throttle: Uint8Array // 0..100
  brake: Uint8Array // 0..100
  gear: Uint8Array // 0..8
  rpm: Uint16Array
  drs: Uint8Array // raw OpenF1 code; >=10 means open
}

/** Normalized event tables — session-time `t` precomputed on every row. */
export interface LapEvent extends Omit<LapRow, 'date_start'> {
  t: number // lap start, session time; NaN if unknown
}
export interface PitEvent {
  driverNumber: number
  lapNumber: number
  t: number
  pitDuration: number | null
}
export interface RaceControlEvent {
  t: number
  category: string
  flag: string | null
  scope: string | null
  sector: number | null
  message: string
  driverNumber: number | null
  lapNumber: number | null
}
export interface WeatherEvent {
  t: number
  airTemp: number
  trackTemp: number
  humidity: number
  rainfall: number
  windSpeed: number
  windDirection: number
}
export interface RadioEvent {
  t: number
  driverNumber: number
  url: string
}
export interface StintEvent {
  driverNumber: number
  stintNumber: number
  lapStart: number
  lapEnd: number
  compound: string
  tyreAgeAtStart: number
}

/** Normalized final classification. Absent entirely in legacy v3 packs. */
export interface ResultEvent {
  driverNumber: number
  /** final classification position; null = unclassified */
  position: number | null
  lapsCompleted: number | null
  points: number | null
  dnf: boolean
  dns: boolean
  dsq: boolean
  /** total race time (seconds) where recorded */
  duration: number | null
  gapToLeader: number | null
}

/** An authoritative on-track pass from /overtakes (session-time normalized). */
export interface OvertakeEvent {
  t: number
  overtaking: number
  overtaken: number
  position: number
}

/** A grid slot from /starting_grid (order + quali lap, no session-time). */
export interface GridEvent {
  driverNumber: number
  position: number
  qualiLap: number | null
}

/** Columnar position change-log, sorted by t. */
export interface PositionTable {
  t: Float64Array
  driver: Uint8Array
  position: Uint8Array
}

/** Columnar interval samples, sorted by t. gapLaps>0 means "+N LAP". NaN = unknown. */
export interface IntervalTable {
  t: Float64Array
  driver: Uint8Array
  gap: Float32Array
  interval: Float32Array
  gapLaps: Uint8Array
}

export interface SessionData {
  meta: SessionMetaRow
  /** epoch ms of meta.date_start — the zero of session time */
  epoch0: number
  drivers: DriverRow[]
  channels: Record<number, DriverChannels>
  laps: LapEvent[]
  stints: StintEvent[]
  pits: PitEvent[]
  raceControl: RaceControlEvent[]
  weather: WeatherEvent[]
  radio: RadioEvent[]
  positions: PositionTable
  intervals: IntervalTable
  /** final classification — empty array in legacy v3 packs */
  results: ResultEvent[]
  /** authoritative on-track passes (/overtakes) — empty in legacy packs / non-race */
  overtakes: OvertakeEvent[]
  /** starting grid (/starting_grid) — empty when not yet published */
  grid: GridEvent[]
  /** playable range, session time */
  tMin: number
  tMax: number
  /** best guess for "the action starts here" (race start / first flying lap) */
  tAction: number
}

// ---------- loader protocol ----------

export type LoadStage =
  | 'cache'
  | 'tables'
  | 'location'
  | 'car_data'
  | 'pack'

export interface LoadProgress {
  stage: LoadStage
  /** 0..1 within stage */
  frac: number
  /** human line for the loading screen log */
  label: string
  /** total rows fetched so far (all endpoints) */
  rows: number
}

export type WorkerRequest = { type: 'load'; sessionKey: number }

export type WorkerResponse =
  | { type: 'progress'; progress: LoadProgress }
  | { type: 'done'; buffer: ArrayBuffer; fromCache: boolean }
  | { type: 'error'; message: string }

export const DRS_OPEN_THRESHOLD = 10 // drs codes 10,12,14 = wing open

export function isDrsOpen(code: number): boolean {
  return code >= DRS_OPEN_THRESHOLD
}

export const CHANNEL_HZ = 5
