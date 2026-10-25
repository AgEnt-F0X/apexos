/* ============================================================
   APEXPACK — the binary session container.
   One ArrayBuffer: [magic u32][jsonLen u32][json bytes][blobs…]
   The JSON header holds metadata + small event tables + a blob
   directory; blobs are the big typed-array columns. This exact
   format is what lives in IndexedDB and what a pre-warmed hero
   pack on the CDN is — one pipeline, one artifact.
   ============================================================ */

import type {
  DriverChannels,
  DriverRow,
  GridEvent,
  IntervalTable,
  LapEvent,
  OvertakeEvent,
  PitEvent,
  PositionTable,
  RaceControlEvent,
  RadioEvent,
  ResultEvent,
  SessionData,
  SessionMetaRow,
  StintEvent,
  WeatherEvent,
} from './types'

export const PACK_MAGIC = 0x41505831 // "APX1"
export const PACK_VERSION = 5 // v5: + overtakes (authoritative passes) & grid

type DType = 'f64' | 'f32' | 'u16' | 'u8'

interface BlobEntry {
  key: string
  dtype: DType
  offset: number
  count: number
}

interface PackHeader {
  version: number
  meta: SessionMetaRow
  epoch0: number
  drivers: DriverRow[]
  driverIndex: Array<{ driverNumber: number; t0: number; hz: number; n: number }>
  laps: LapEvent[]
  stints: StintEvent[]
  pits: PitEvent[]
  raceControl: RaceControlEvent[]
  weather: WeatherEvent[]
  radio: RadioEvent[]
  /** v4+ only */
  results?: ResultEvent[]
  /** v5+ only — authoritative on-track passes */
  overtakes?: OvertakeEvent[]
  /** v5+ only — starting grid slots */
  grid?: GridEvent[]
  tMin: number
  tMax: number
  tAction: number
  blobs: BlobEntry[]
}

const BYTES: Record<DType, number> = { f64: 8, f32: 4, u16: 2, u8: 1 }

type AnyArray = Float64Array | Float32Array | Uint16Array | Uint8Array

function dtypeOf(a: AnyArray): DType {
  if (a instanceof Float64Array) return 'f64'
  if (a instanceof Float32Array) return 'f32'
  if (a instanceof Uint16Array) return 'u16'
  return 'u8'
}

export function encodePack(data: SessionData): ArrayBuffer {
  const blobs: Array<{ key: string; arr: AnyArray }> = []

  for (const ch of Object.values(data.channels)) {
    const d = ch.driverNumber
    blobs.push(
      { key: `d${d}.x`, arr: ch.x },
      { key: `d${d}.y`, arr: ch.y },
      { key: `d${d}.z`, arr: ch.z },
      { key: `d${d}.speed`, arr: ch.speed },
      { key: `d${d}.throttle`, arr: ch.throttle },
      { key: `d${d}.brake`, arr: ch.brake },
      { key: `d${d}.gear`, arr: ch.gear },
      { key: `d${d}.rpm`, arr: ch.rpm },
      { key: `d${d}.drs`, arr: ch.drs },
    )
  }
  blobs.push(
    { key: 'pos.t', arr: data.positions.t },
    { key: 'pos.driver', arr: data.positions.driver },
    { key: 'pos.position', arr: data.positions.position },
    { key: 'iv.t', arr: data.intervals.t },
    { key: 'iv.driver', arr: data.intervals.driver },
    { key: 'iv.gap', arr: data.intervals.gap },
    { key: 'iv.interval', arr: data.intervals.interval },
    { key: 'iv.gapLaps', arr: data.intervals.gapLaps },
  )

  // lay out blob section with 8-byte alignment
  const entries: BlobEntry[] = []
  let cursor = 0
  for (const { key, arr } of blobs) {
    const dtype = dtypeOf(arr)
    cursor = Math.ceil(cursor / 8) * 8
    entries.push({ key, dtype, offset: cursor, count: arr.length })
    cursor += arr.length * BYTES[dtype]
  }
  const blobBytes = cursor

  const header: PackHeader = {
    version: PACK_VERSION,
    meta: data.meta,
    epoch0: data.epoch0,
    drivers: data.drivers,
    driverIndex: Object.values(data.channels).map((c) => ({
      driverNumber: c.driverNumber,
      t0: c.t0,
      hz: c.hz,
      n: c.n,
    })),
    laps: data.laps,
    stints: data.stints,
    pits: data.pits,
    raceControl: data.raceControl,
    weather: data.weather,
    radio: data.radio,
    results: data.results ?? [],
    overtakes: data.overtakes ?? [],
    grid: data.grid ?? [],
    tMin: data.tMin,
    tMax: data.tMax,
    tAction: data.tAction,
    blobs: entries,
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(header))
  const jsonPadded = Math.ceil(jsonBytes.length / 8) * 8
  const total = 8 + jsonPadded + blobBytes
  const buffer = new ArrayBuffer(total)
  const dv = new DataView(buffer)
  dv.setUint32(0, PACK_MAGIC, true)
  dv.setUint32(4, jsonBytes.length, true)
  new Uint8Array(buffer, 8, jsonBytes.length).set(jsonBytes)

  const base = 8 + jsonPadded
  for (let i = 0; i < blobs.length; i++) {
    const e = entries[i]
    const src = blobs[i].arr
    const dstBytes = new Uint8Array(buffer, base + e.offset, e.count * BYTES[e.dtype])
    dstBytes.set(new Uint8Array(src.buffer, src.byteOffset, src.byteLength))
  }
  return buffer
}

export function decodePack(buffer: ArrayBuffer): SessionData {
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== PACK_MAGIC) throw new Error('not an APEXPACK')
  const jsonLen = dv.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonLen))) as PackHeader
  // v3 (pre results), v4 (results) and v5 (+ overtakes & grid) packs all remain
  // first-class citizens — hero packs and cached archives are whatever version
  // they were snapshotted at; each older version just omits its newer tables.
  if (header.version !== PACK_VERSION && header.version !== 4 && header.version !== 3)
    throw new Error(`unsupported pack version ${header.version}`)
  const base = 8 + Math.ceil(jsonLen / 8) * 8

  const view = new Map<string, AnyArray>()
  for (const e of header.blobs) {
    const off = base + e.offset
    switch (e.dtype) {
      case 'f64': view.set(e.key, new Float64Array(buffer, off, e.count)); break
      case 'f32': view.set(e.key, new Float32Array(buffer, off, e.count)); break
      case 'u16': view.set(e.key, new Uint16Array(buffer, off, e.count)); break
      case 'u8': view.set(e.key, new Uint8Array(buffer, off, e.count)); break
    }
  }
  const req = <T extends AnyArray>(key: string): T => {
    const a = view.get(key)
    if (!a) throw new Error(`pack missing blob ${key}`)
    return a as T
  }

  const channels: Record<number, DriverChannels> = {}
  for (const di of header.driverIndex) {
    const d = di.driverNumber
    channels[d] = {
      driverNumber: d,
      t0: di.t0,
      hz: di.hz,
      n: di.n,
      x: req<Float32Array>(`d${d}.x`),
      y: req<Float32Array>(`d${d}.y`),
      z: req<Float32Array>(`d${d}.z`),
      speed: req<Float32Array>(`d${d}.speed`),
      throttle: req<Uint8Array>(`d${d}.throttle`),
      brake: req<Uint8Array>(`d${d}.brake`),
      gear: req<Uint8Array>(`d${d}.gear`),
      rpm: req<Uint16Array>(`d${d}.rpm`),
      drs: req<Uint8Array>(`d${d}.drs`),
    }
  }

  const positions: PositionTable = {
    t: req<Float64Array>('pos.t'),
    driver: req<Uint8Array>('pos.driver'),
    position: req<Uint8Array>('pos.position'),
  }
  const intervals: IntervalTable = {
    t: req<Float64Array>('iv.t'),
    driver: req<Uint8Array>('iv.driver'),
    gap: req<Float32Array>('iv.gap'),
    interval: req<Float32Array>('iv.interval'),
    gapLaps: req<Uint8Array>('iv.gapLaps'),
  }

  return {
    meta: header.meta,
    epoch0: header.epoch0,
    drivers: header.drivers,
    channels,
    laps: header.laps,
    stints: header.stints,
    pits: header.pits,
    raceControl: header.raceControl,
    weather: header.weather,
    radio: header.radio,
    results: header.version >= 4 ? (header.results ?? []) : [],
    overtakes: header.version >= 5 ? (header.overtakes ?? []) : [],
    grid: header.version >= 5 ? (header.grid ?? []) : [],
    positions,
    intervals,
    tMin: header.tMin,
    tMax: header.tMax,
    tAction: header.tAction,
  }
}
