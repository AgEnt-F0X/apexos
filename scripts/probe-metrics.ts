/* ============================================================
   Metrics truth-check: decode a pack, run the Derived Metrics
   Engine over it, and print facts a human can verify against
   the historical record + hard sanity gates that fail loudly.

   usage: npx tsx scripts/probe-metrics.ts [sessionKey] [driverNumber]
   ============================================================ */

import { readFile } from 'node:fs/promises'
import { decodePack } from '../src/data/pack'
import { RaceStateIndex } from '../src/engine/raceState'
import { buildFlagTimeline } from '../src/engine/flags'
import { metricsFor, degAt, paceSeriesOf, gapSlopeAt, sectorDeltaAt } from '../src/engine/metrics'

const key = Number(process.argv[2] ?? 9636)
const focusDriver = Number(process.argv[3] ?? 0) // 0 = auto-pick winner
const buf = await readFile(`public/packs/${key}.apx`)
const data = decodePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

const nameOf = (d: number) => data.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`
console.log(`\n=== METRICS · ${data.meta.year} ${data.meta.country_name} ${data.meta.session_name} ===`)

const idx = new RaceStateIndex(data)
const flags = buildFlagTimeline(data)
const t0 = performance.now()
const m = metricsFor(data, idx, flags)
console.log(`build time             : ${(performance.now() - t0).toFixed(0)} ms`)

// ---------- 1. lap classification distribution ----------
const kinds: Record<string, number> = {}
for (const c of m.consistency.values()) {
  for (const p of c.points) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1
}
console.log(`\nlap classification     :`)
for (const [k, v] of Object.entries(kinds).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(9)} ${v}`)

// ---------- 2. consistency leaderboard ----------
console.log(`\nconsistency (clean laps):`)
console.log(`   DRV  BEST      MEDIAN    STDEV    N`)
const rows = [...m.consistency.values()]
  .filter((c) => Number.isFinite(c.best))
  .sort((a, b) => a.best - b.best)
  .slice(0, 10)
for (const r of rows) {
  const stdev = Number.isFinite(r.stdev) ? r.stdev.toFixed(3) : '—'
  console.log(
    `   ${nameOf(r.driverNumber)}  ${(r.best / 60 | 0)}:${(r.best % 60).toFixed(3).padStart(6, '0')}  ${(r.median / 60 | 0)}:${(r.median % 60).toFixed(3).padStart(6, '0')}  ${stdev.padStart(7)}  ${r.cleanCount}`,
  )
}

// ---------- 3. tire deg for one driver ----------
const driver =
  focusDriver ||
  [...m.tireDeg.keys()].find((d) => idx.positionOf(d, data.tMax - 30) === 1) ||
  [...m.tireDeg.keys()][0]
const model = m.tireDeg.get(driver)!
console.log(`\ntire model ${nameOf(driver)} (P${idx.positionOf(driver, data.tMax - 30) ?? '?'} finish):`)
console.log(`   STINT  COMP   CTX   LAPS     BASE      SLOPE/lap   R²     N`)
for (const s of model.stints) {
  const slope = Number.isFinite(s.slopePerLap) ? `${s.slopePerLap >= 0 ? '+' : ''}${s.slopePerLap.toFixed(3)}s` : 'n/a'
  const base = Number.isFinite(s.baseLap) ? `${s.baseLap.toFixed(2)}s` : '—'
  const r2 = Number.isFinite(s.r2) ? s.r2.toFixed(2) : '—'
  console.log(
    `   ${String(s.stintNumber).padEnd(6)} ${s.compound.slice(0, 5).padEnd(6)} ${s.context.padEnd(5)} ${String(s.lapEnd - s.lapStart + 1).padEnd(8)} ${base.padEnd(9)} ${slope.padEnd(11)} ${r2.padEnd(6)} ${s.samples.length}`,
  )
}

// cursor read demo: mid-race readout
const midT = (data.tAction + data.tMax) / 2
const midLap = idx.lapOf(driver, midT)
const midDeg = degAt(model, midLap)
console.log(
  `\ncursor read @ ${(midT / 60).toFixed(0)}min: on ${midDeg.compound || '?'}, deg ${Number.isFinite(midDeg.slopePerLap) ? midDeg.slopePerLap.toFixed(3) + 's/lap' : 'unknown'}`,
)
const pace = paceSeriesOf(m, driver)
if (pace.length > 0) {
  const finite = pace.filter((p) => Number.isFinite(p.deltaToBest))
  const avgDelta = finite.reduce((a, p) => a + p.deltaToBest, 0) / Math.max(1, finite.length)
  console.log(`pace vs field          : avg Δ to per-lap best = ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(3)}s (${finite.length} laps)`)
}

// ---------- 3.5 undercut ledger (truth-check vs the historical record) ----------
const uc = m.undercuts.events
console.log(`\nundercut ledger        : ${uc.length} classified attempt(s)`)
for (const e of uc) {
  const gap = Number.isFinite(e.gapAtPit) ? `${Math.abs(e.gapAtPit).toFixed(1)}s` : '?'
  const out =
    Number.isFinite(e.outLapDelta) ? `${e.outLapDelta >= 0 ? '+' : ''}${e.outLapDelta.toFixed(2)}s` : '—'
  const swap = e.swapLap !== null ? ` · L${e.swapLap}` : ''
  const phase = e.targetAlsoPitted ? ' · target also pitted' : ''
  console.log(
    `   ${nameOf(e.chaser)} → ${nameOf(e.target)}  lap ${String(e.lap).padEnd(3)} gap@stop ${gap.padEnd(6)} out-lap Δ ${out.padEnd(7)} ${e.outcome.toUpperCase()}${swap}${phase}`,
  )
}

// ---------- 3.7 gap dynamics / evolution / sectors (truth-check) ----------
let trendRead = ''
for (const frac of [0.5, 0.7, 0.85]) {
  const tt = data.tAction + (data.tMax - data.tAction) * frac
  const tr = gapSlopeAt(m.gapDynamics, driver, tt)
  if (tr && Number.isFinite(tr.perLap)) {
    trendRead = `@ ${(frac * 100).toFixed(0)}%: ${tr.perLap >= 0 ? '+' : ''}${tr.perLap.toFixed(2)}s/lap · gap ${tr.gap.toFixed(1)}s`
    break
  }
}
console.log(`\ngap trend ${nameOf(driver)}      : ${trendRead || 'unknown at sampled phases'}`)
console.log(`battle swings (field)   : ${m.gapDynamics.swings.length}`)
for (const s of m.gapDynamics.swings.slice(0, 5)) {
  console.log(
    `   ${nameOf(s.chaser)} → ${nameOf(s.target)}  lap ${s.lap}  ${Math.abs(s.ratePerLap).toFixed(2)}s/lap from ${s.gapFrom.toFixed(1)}s`,
  )
}
const evo = m.trackEvolution
const evoEarly = evo.points.find((p) => p.lap >= 3 && Number.isFinite(p.median))
const evoLate = [...evo.points].reverse().find((p) => Number.isFinite(p.median))
console.log(
  `\ntrack evolution         : early ${evoEarly ? evoEarly.median.toFixed(1) + 's' : '—'} → late ${evoLate ? evoLate.median.toFixed(1) + 's' : '—'} · drift ${Number.isFinite(evo.slopePerLap) ? evo.slopePerLap.toFixed(3) + 's/lap' : 'unknown'} · overall median ${Number.isFinite(evo.overallMedian) ? evo.overallMedian.toFixed(1) + 's' : '—'}`,
)
const sec = m.sectors
const pct = (a: number): string => (sec.availability.total > 0 ? `${((a / sec.availability.total) * 100).toFixed(0)}%` : '—')
console.log(
  `sectors                 : coverage S1 ${pct(sec.availability.s1)} · S2 ${pct(sec.availability.s2)} · S3 ${pct(sec.availability.s3)}`,
)
const fb = sec.fieldBest
console.log(
  `   field best trio      : S1 ${Number.isFinite(fb[0]) ? fb[0].toFixed(2) + 's' : '—'} · S2 ${Number.isFinite(fb[1]) ? fb[1].toFixed(2) + 's' : '—'} · S3 ${Number.isFinite(fb[2]) ? fb[2].toFixed(2) + 's' : '—'}`,
)
const dsec = sectorDeltaAt(m.sectors, driver)
console.log(
  `   ${nameOf(driver)} vs benchmark: ${dsec.map((d) => (Number.isFinite(d) ? `${d >= 0 ? '+' : ''}${d.toFixed(2)}s` : '—')).join(' / ')}`,
)

// ---------- 4. sanity gates ----------
let failures = 0
const gate = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
console.log('')

gate('consistency covers field', m.consistency.size >= Math.floor(data.drivers.length * 0.5), `${m.consistency.size}/${data.drivers.length}`)
const meds = rows.map((r) => r.median).filter(Number.isFinite)
gate(
  'medians in plausible race-lap band',
  meds.every((v) => v > 55 && v < 110),
  meds.length ? `${Math.min(...meds).toFixed(1)}–${Math.max(...meds).toFixed(1)}s` : 'no medians',
)
let badFit = 0
let fitChecked = 0
for (const tm of m.tireDeg.values())
  for (const s of tm.stints) {
    if (s.samples.length >= 4 && Number.isFinite(s.slopePerLap)) {
      fitChecked++
      if (!Number.isFinite(s.baseLap)) badFit++
    }
  }
gate('no NaN explosions in fits', badFit === 0, `${fitChecked} fits checked`)
const slopes = [...m.tireDeg.values()].flatMap((tm) => tm.stints.map((s) => s.slopePerLap)).filter(Number.isFinite)
const offenders = [...m.tireDeg.values()]
  .flatMap((tm) => tm.stints)
  .filter((s) => Number.isFinite(s.slopePerLap) && (s.slopePerLap > 4 || s.slopePerLap < -3))
for (const s of offenders)
  console.log(
    `   ↳ ${nameOf(s.driverNumber)} stint ${s.stintNumber} ${s.compound} laps ${s.lapStart}–${s.lapEnd}: ${s.slopePerLap.toFixed(2)}s/lap over ${s.samples.length} pts`,
  )
const wild = offenders.length
gate('slopes physically sane', wild === 0, `${slopes.length} fits, ${wild} beyond ±[−3,+4] s/lap`)
const r2s = [...m.tireDeg.values()].flatMap((tm) => tm.stints.map((s) => s.r2)).filter(Number.isFinite)
gate('r² bounded', r2s.every((r) => r >= 0 && r <= 1), `${r2s.length} values`)
gate(
  'undercuts bounded by pit count',
  uc.length <= data.pits.length,
  `${uc.length} attempts / ${data.pits.length} stops`,
)
const anySlope = [...m.gapDynamics.byDriver.values()].some((s) => {
  for (let i = 0; i < s.slope.length; i++) if (Number.isFinite(s.slope[i])) return true
  return false
})
gate('gap slopes computed for field', anySlope, `${m.gapDynamics.swings.length} swings detected`)
gate(
  'evolution drift physically sane',
  !Number.isFinite(evo.slopePerLap) || (evo.slopePerLap > -5 && evo.slopePerLap < 5),
  `${Number.isFinite(evo.slopePerLap) ? evo.slopePerLap.toFixed(3) + 's/lap' : 'unknown'}`,
)
gate(
  'evolution median in race-lap band',
  !Number.isFinite(evo.overallMedian) || (evo.overallMedian > 55 && evo.overallMedian < 110),
  Number.isFinite(evo.overallMedian) ? evo.overallMedian.toFixed(1) + 's' : 'no data',
)
gate(
  'sector coverage usable',
  sec.availability.total === 0 ||
    (sec.availability.s1 / sec.availability.total > 0.5 &&
      sec.availability.s2 / sec.availability.total > 0.5 &&
      sec.availability.s3 / sec.availability.total > 0.5),
  `S1 ${pct(sec.availability.s1)} / S2 ${pct(sec.availability.s2)} / S3 ${pct(sec.availability.s3)}`,
)

console.log(failures === 0 ? '\nALL GATES PASS\n' : `\n${failures} GATE(S) FAILED\n`)
process.exitCode = failures === 0 ? 0 : 1
