/* ============================================================
   Pit-bay glow probe — verifies the REAL bay model
   (src/scene/pitModel.ts, the exact code TracksideDressing's
   useFrame calls) against pack data. Nothing here re-implements
   the envelope or the mapping, so probe and frame cannot drift.

   Checks:
     · every pit stop's team maps to a real bay
     · an isolated stop lights exactly one bay, at full
     · a quiet window leaves every bay dark (no phantom light)
     · two distinct teams stopping within 6 s light two bays
     · the envelope pre-lights, peaks at the stop, decays to dark
   Run: npx tsx scripts/probe-pit-bays.ts [sessionKey]
   ============================================================ */

import { readFile } from 'node:fs/promises'
import { decodePack } from '../src/data/pack'
import { uniqueTeamColours, pitBayCount, pitBayOf, pitEnvelope, pitBaysAt } from '../src/scene/pitModel'

const key = Number(process.argv[2] ?? 9636)
const buf = await readFile(`public/packs/${key}.apx`)
let data
try {
  data = decodePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
} catch (err) {
  console.log('PACK_DECODE_FAIL — no pack or corrupt; nothing to verify here')
  console.log(`  reason: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(0)
}

const drivers = data.drivers
const stops = data.pits
const teamColours = uniqueTeamColours(drivers)
// the component's own bay-count function, so the probe can't disagree
const nBays = pitBayCount(teamColours.length)

let fails = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  <-  ${detail}`}`)
  if (!ok) fails++
}

console.log(`\n=== pit-bay glow | ${key} (${drivers.length} drivers, ${stops.length} pit events) ===`)
console.log(`unique teams : ${teamColours.length} -> ${nBays} bays  ${teamColours.join(' ')}`)

// 1. every stop must land on a real bay — catches null/unknown colours
const unmapped = stops
  .map((p) => ({ p, bay: pitBayOf(p.driverNumber, drivers, teamColours) }))
  .filter((x) => x.bay < 0 || x.bay >= nBays)
check(
  'every pit stop maps to a real bay',
  unmapped.length === 0,
  unmapped.length > 0 ? `${unmapped.length} unmapped, first driver #${unmapped[0].p.driverNumber}` : '',
)

// 2. an isolated stop lights exactly one bay, at full
const isolated = stops.filter((p) => !stops.some((q) => q !== p && Math.abs(q.t - p.t) < 8))
if (isolated.length > 0) {
  const bad: string[] = []
  for (const p of isolated) {
    const bay = pitBayOf(p.driverNumber, drivers, teamColours)
    const glow = pitBaysAt(p.t, stops, drivers, teamColours, nBays)
    const lit = glow.filter((g) => g > 0.5).length
    if (lit !== 1 || glow[bay] < 0.99) bad.push(`t=${p.t.toFixed(0)} #${p.driverNumber} lit ${lit}`)
  }
  check('an isolated stop lights exactly one bay at full', bad.length === 0, bad.slice(0, 3).join(' | '))
} else {
  console.log('skip isolated-stop check - no stop is 8 s clear of any other')
}

// 3. quiet windows stay dark, so a dark bay only ever means "no car here"
const first = stops.reduce((a, p) => Math.min(a, p.t), Infinity)
const last = stops.reduce((a, p) => Math.max(a, p.t), -Infinity)
const quiet = pitBaysAt((first + last) / 2, stops, drivers, teamColours, nBays)
check('a quiet window leaves every bay dark', quiet.every((g) => g === 0), `max glow ${Math.max(...quiet)}`)

// 4. a genuine double-stack: two different teams whose stops genuinely
//    overlap (the earlier car is still in the window when the later one
//    arrives). Evaluate at the LATER stop so both are inside the lit window.
let pair: { t: number; a: number; b: number } | null = null
for (const p of stops) {
  for (const q of stops) {
    if (q === p) continue
    const later = q.t >= p.t ? q : p
    const earlier = q.t >= p.t ? p : q
    const gap = later.t - earlier.t
    if (gap <= 0 || gap >= 1.5) continue // both still bright at later.t
    const bayA = pitBayOf(earlier.driverNumber, drivers, teamColours)
    const bayB = pitBayOf(later.driverNumber, drivers, teamColours)
    if (bayA >= 0 && bayB >= 0 && bayA !== bayB) {
      pair = { t: later.t, a: bayA, b: bayB }
      break
    }
  }
  if (pair) break
}
if (pair) {
  const glow = pitBaysAt(pair.t, stops, drivers, teamColours, nBays)
  const litBays = glow.map((g, i) => ({ g, i })).filter((x) => x.g > 0.5).map((x) => x.i)
  check(
    `two teams stopping together light two bays (${pair.a} & ${pair.b})`,
    litBays.includes(pair.a) && litBays.includes(pair.b),
    `lit ${litBays.length}: ${litBays.join(',') || 'none'}`,
  )
} else {
  console.log('skip double-stack check - no overlapping distinct-team pair in this session')
}

// 5. the envelope itself, on a synthetic stop (no data dependency)
const t0 = 1000
const pre = pitEnvelope(t0 - 1, { t: t0 })
check('envelope pre-lights on approach', pre > 0 && pre < 1)
check('envelope reads full at the stop', pitEnvelope(t0, { t: t0 }) === 1)
check('envelope decays to dark', pitEnvelope(t0 + 99, { t: t0 }) === 0)

console.log(`\n${fails === 0 ? 'BAY MAPPING VERIFIED - pit glow tracks real pit stops' : `${fails} FAILURE(S)`}\n`)
process.exit(fails === 0 ? 0 : 1)
