/* ============================================================
   Pack truth-check: decode an APEXPACK, build the track model
   and race index, and print verifiable facts (winner, laps,
   circuit length, flags) to compare against the historical
   record.

   usage: npx tsx scripts/verify-pack.ts [sessionKey]
   ============================================================ */

import { readFile } from 'node:fs/promises'
import { decodePack } from '../src/data/pack'
import { buildTrackModel } from '../src/scene/trackBuilder'
import { RaceStateIndex } from '../src/engine/raceState'

const key = Number(process.argv[2] ?? 9636)
const buf = await readFile(`public/packs/${key}.apx`)
const data = decodePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

const m = data.meta
console.log(`\n=== ${m.year} ${m.country_name} · ${m.session_name} · ${m.circuit_short_name} (session ${m.session_key}) ===`)
console.log(`drivers with telemetry : ${Object.keys(data.channels).length}/${data.drivers.length}`)
console.log(`playable range         : ${(data.tMin / 60).toFixed(1)} → ${(data.tMax / 60).toFixed(1)} min (action @ ${(data.tAction / 60).toFixed(1)} min)`)
console.log(`laps table             : ${data.laps.length} rows`)
console.log(`race control           : ${data.raceControl.length} msgs`)
console.log(`radio clips            : ${data.radio.length}`)
console.log(`weather samples        : ${data.weather.length} (max rainfall ${Math.max(...data.weather.map((w) => w.rainfall))})`)
console.log(`pit events             : ${data.pits.length}`)

const track = buildTrackModel(data)
console.log(`\ntrack model            : ${track.n} pts, ${(track.length / 1000).toFixed(3)} km, radius ${track.radius.toFixed(0)} m`)
console.log(`sector params          : ${track.sectorParam.map((p) => p.toFixed(3)).join(' / ')}`)
const hotBins = track.brakeHeat.filter((h) => h > 0.5).length
console.log(`braking zones          : ${hotBins} hot points of ${track.n}`)

const idx = new RaceStateIndex(data)
// evaluate at the LAST LIVE POSITION SAMPLE — telemetry can run past the flag
// (cool-down laps) while position rows freeze per driver; tMax−30 is stale soup
const tEnd = data.positions.t.length > 0 ? data.positions.t[data.positions.t.length - 1] : data.tMax - 30
const order = idx.orderAt(tEnd)
const nameOf = (d: number) => data.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`
console.log(`\nfinal order (top 5)    : ${order.slice(0, 5).map(nameOf).join(' → ')}`)
console.log(`leader final lap       : ${idx.lapOf(order[0], tEnd)} / ${idx.totalLaps}`)

// v4 truth-check: official classification vs the index's own reconstruction
if (data.results.length > 0) {
  const top = data.results.filter((r) => r.position !== null).slice(0, 5)
  const officialTop5 = top.map((r) => nameOf(r.driverNumber)).join(' → ')
  console.log(`official top 5         : ${officialTop5}`)
  const match = order.slice(0, 5).every((d, i) => top[i] && top[i].driverNumber === d)
  console.log(`index vs official      : ${match ? 'MATCH' : 'DIVERGES (check lapped traffic / post-race penalties)'}`)
} else {
  console.log(`results table          : absent (legacy v3 pack — run scripts/upgrade-packs.ts)`)
}

// v5 truth-check: authoritative on-track passes (/overtakes)
if (data.overtakes.length > 0) {
  const passers = new Map<number, number>()
  for (const o of data.overtakes) passers.set(o.overtaking, (passers.get(o.overtaking) ?? 0) + 1)
  const busiest = [...passers.entries()].sort((a, b) => b[1] - a[1])[0]
  console.log(`official overtakes     : ${data.overtakes.length} on-track passes`)
  console.log(`  most passes          : ${busiest ? `${nameOf(busiest[0])} (${busiest[1]})` : '—'}`)
  console.log(`  first pass           : ${data.overtakes[0].t.toFixed(1)}s — ${nameOf(data.overtakes[0].overtaking)} past ${data.overtakes[0].overtaken !== undefined ? nameOf(data.overtakes[0].overtaken) : '?'}`)
} else {
  console.log(`official overtakes     : absent (legacy pack or non-race session)`)
}

// v5 truth-check: starting grid
if (data.grid.length > 0) {
  const front = data.grid.slice(0, 5).map((g) => nameOf(g.driverNumber)).join(' → ')
  console.log(`starting grid          : ${front}`)
  const pole = data.grid.find((g) => g.position === 1)
  console.log(`  pole quali lap       : ${pole?.qualiLap ? `${pole.qualiLap.toFixed(3)}s` : '—'}`)
} else {
  console.log(`starting grid          : absent (not yet published)`)
}

// spot-check interpolated position against a raw-ish moment: mid-race leader speed
const midT = (data.tAction + data.tMax) / 2
const midLeader = idx.leaderAt(midT)
if (midLeader !== null) {
  const ch = data.channels[midLeader]
  const i = Math.round((midT - ch.t0) * ch.hz)
  console.log(`mid-race leader        : ${nameOf(midLeader)} @ ${ch.speed[i].toFixed(0)} km/h, gear ${ch.gear[i]}`)
}
console.log('')

// corner detection truth-check: Interlagos has 15 numbered turns, 4.309 km
console.log(`corners detected       : ${track.corners.length}`)
console.log(
  track.corners
    .map((c) => `  T${c.number} @ p=${c.param.toFixed(3)} ${(c.dir === 1 ? 'L' : 'R')} ${((Math.abs(c.angle) * 180) / Math.PI).toFixed(0)}°`)
    .join('\n'),
)
console.log(`bounds                 : x ${track.bounds[0].toFixed(0)}..${track.bounds[1].toFixed(0)}  z ${track.bounds[2].toFixed(0)}..${track.bounds[3].toFixed(0)}`)
console.log('')
