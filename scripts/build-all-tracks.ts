/* ============================================================
   Bake ALL circuit geometries into public/tracks/.
   Enumerates every race 2023→current year on OpenF1 and, for
   each distinct circuit, tries its most recent COMPLETED races
   (newest first) until one yields clean geometry. After this
   runs, every known circuit loads its diorama instantly from a
   static snapshot — runtime extrusion stays as fallback only.

   Politeness contract: OpenF1 free tier allows ~30 req/min.
   setMinSpacing(2000) paces the shared queue to that axis;
   failed attempts rest a full minute before the next candidate.
   Resumable: circuits with an existing snapshot are skipped.

   usage:
     npx tsx scripts/build-all-tracks.ts            # all missing
     npx tsx scripts/build-all-tracks.ts Spa-Francorchamps Suzuka
   ============================================================ */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { fetchRows, setMinSpacing } from '../src/data/openf1'
import { loadSession } from '../src/data/sessionLoader'
import { decodePack } from '../src/data/pack'
import type { SessionMetaRow, SessionData } from '../src/data/types'
import { buildTrackModel } from '../src/scene/trackBuilder'
import { exportTrackJson, trackKeyOf } from '../src/data/circuitCache'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].filter((y) => y >= 2023)
const NOW = Date.now()
const REST_AFTER_FAIL_MS = 65_000 // one full rate window, then try again
const ATTEMPTS_PER_CANDIDATE = 2 // transient load-shedding deserves a second chance

setMinSpacing(2400) // ~25 req/min — leave headroom under the 30/min cap

const filters = process.argv.slice(2)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

console.log(`enumerating races ${YEARS[YEARS.length - 1]}–${YEARS[0]}…`)
// newest-first candidates per circuit, future/scheduled sessions excluded
const candidates = new Map<string, SessionMetaRow[]>()
for (const year of YEARS) {
  const rows = await fetchRows<SessionMetaRow>('sessions', {
    session_name: 'Race',
    session_type: 'Race',
    year,
  })
  console.log(`  ${year}: ${rows.length} races`)
  for (const s of rows) {
    if (Date.parse(s.date_start) > NOW) continue // scheduled, not run — no data exists
    const list = candidates.get(s.circuit_short_name) ?? []
    list.push(s)
    candidates.set(s.circuit_short_name, list)
  }
}
for (const list of candidates.values()) {
  list.sort((a, b) => b.date_start.localeCompare(a.date_start))
  list.length = Math.min(list.length, 3) // three chances per circuit
}

await mkdir('public/tracks', { recursive: true })
const existing = new Set((await readdir('public/tracks')).map((f) => f.replace(/\.json$/, '')))

const targets = [...candidates.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .filter(([name]) => filters.length === 0 || filters.includes(name))
  .filter(([name]) => !existing.has(trackKeyOf(name)))

console.log(
  `${candidates.size} run circuits · ${existing.size} already baked · ${targets.length} to go\n`,
)

let ok = 0
let failed = 0
for (const [name, metas] of targets) {
  const key = trackKeyOf(name)
  let done = false
  for (let i = 0; i < metas.length && !done; i++) {
    const meta = metas[i]
    for (let attemptNo = 1; attemptNo <= ATTEMPTS_PER_CANDIDATE && !done; attemptNo++) {
      const t0 = performance.now()
      try {
        process.stdout.write(
          `[${key}] (${i + 1}.${attemptNo}/${metas.length}) session ${meta.session_key} ${meta.date_start.slice(0, 10)}…`,
        )
        let lastStage = ''
        const { buffer } = await loadSession(meta.session_key, (p) => {
          if (p.stage !== lastStage) {
            lastStage = p.stage
            process.stdout.write(` ${p.stage}`)
          }
        })
        const data = decodePack(buffer) as SessionData
        if (!data.channels || Object.keys(data.channels).length === 0) throw new Error('no telemetry channels')
        const model = buildTrackModel(data)
        await writeFile(`public/tracks/${key}.json`, exportTrackJson(data, model))
        console.log(` OK ${(model.length / 1000).toFixed(2)}km · ${model.corners.length}T · ${((performance.now() - t0) / 1000).toFixed(0)}s`)
        ok++
        done = true
        await sleep(8_000) // breathe between successes
      } catch (err) {
        console.log(` FAIL — ${err instanceof Error ? err.message : String(err)}`)
        if (i < metas.length - 1 || attemptNo < ATTEMPTS_PER_CANDIDATE) {
          console.log(`        resting ${REST_AFTER_FAIL_MS / 1000}s…`)
          await sleep(REST_AFTER_FAIL_MS)
        }
      }
    }
  }
  if (!done) {
    failed++
    console.log(`[${key}] all candidates exhausted`)
  }
}
console.log(`\ndone: ${ok} baked, ${failed} failed, ${existing.size} pre-existing — rerun to fill gaps`)
if (failed > 0) process.exitCode = 1
