/* ============================================================
   LIVE probe for the two new Phase-1.2 lanes:
   · CSV bulk fetch (fetchRowsCsv) — verbatim rows vs JSON, typed coercion
   · watermark sync (bump/since/age) — forward-only high-water marks

   usage: npx tsx scripts/probe-csv-watermark.ts [sessionKey]
   ============================================================ */

import { readFile, writeFile } from 'node:fs/promises'
import { fetchRows, fetchRowsCsv } from '../src/data/openf1'
import { getWatermark, bumpWatermark, sinceWatermark } from '../src/data/watermark'

const key = Number(process.argv[2] ?? 9636) // default: São Paulo '24 hero pack
const numeric = ['session_key', 'meeting_key', 'driver_number', 'lap_number', 'duration_sector_1', 'duration_sector_2', 'duration_sector_3', 'speed', 'throttle', 'brake', 'n_gear', 'rpm', 'drs']

// --- polyfill a tiny localStorage for the Node runtime (watermark stores there) ---
const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
}

let failures = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  ✓ ${msg}`)
  else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

console.log('probing CSV lane + watermark sync…\n')

// --- derive a small window from the session start ---
import { readFile } from 'node:fs/promises'
const buf = await readFile(`public/packs/${key}.apx`)
const { decodePack } = await import('../src/data/pack')
const data = decodePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const start = new Date(data.epoch0)
const pad = (n: number): string => String(n).padStart(2, '0')
const iso = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
const t0 = iso(new Date(start.getTime() + 120_000))
const t1 = iso(new Date(start.getTime() + 180_000))
const params = { session_key: key, 'date>=': t0, 'date<': t1 }
const json = await fetchRows<Record<string, unknown>>('car_data', params, { allowEmpty404: true })
const csv = await fetchRowsCsv<Record<string, unknown>>('car_data', params, { allowEmpty404: true, numeric })
check(json.length > 0, `car_data JSON window: ${json.length} rows (${t0}→${t1})`)
check(csv.length === json.length, `car_data CSV window: ${csv.length} rows (matches JSON ${json.length})`)
const sJson = json[0]?.speed
const sCsv = csv[0]?.speed
check(
  typeof sJson === 'number' && typeof sCsv === 'number' && Math.abs((sJson as number) - (sCsv as number)) < 1e-6,
  `typed coercion: speed JSON=${JSON.stringify(sJson)} CSV=${JSON.stringify(sCsv)} — both numeric`,
)
check(json[0]?.driver_number === csv[0]?.driver_number, 'driver_number coerced to number')

// --- watermark: forward-only ---
const scope = 'car_data'
const first = [ { date: '2024-10-20T14:00:00.000+00:00' }, { date: '2024-10-20T14:01:00.000+00:00' } ]
bumpWatermark('location', scope, first)
const a = getWatermark('location', scope)
check(a === '2024-10-20T14:01:00.000+00:00', `watermark advanced to ${a}`)

// older/different rows must NOT roll it back
bumpWatermark('location', scope, [{ date: '2024-10-20T13:50:00.000+00:00' }])
check(getWatermark('location', scope) === a, 'watermark is forward-only (older ignored)')

const wmParams = sinceWatermark('location', scope, { session_key: 9636 })
check('date>' in wmParams && wmParams['date>'] === a, `sinceWatermark injects 'date>' = ${wmParams['date>']}`)
const none = sinceWatermark('location', 'none', { session_key: 1 })
check(!('date>' in none), 'no watermark ⇒ no date> filter (full refetch)')

console.log(failures === 0 ? '\nALL CSV + WATERMARK CHECKS PASS' : `\n${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1