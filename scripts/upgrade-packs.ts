/* ============================================================
   In-place pack upgrade: v3 → v5 without refetching telemetry.
   Decodes each local pack, pulls only the MISSING small tables
   from OpenF1, re-encodes. Seconds, not minutes — schema
   migrations should never replay the whole ingest.

   Per-table, not per-version: a v4 pack already has `results`
   but still lacks `overtakes`/`grid`, so the old "already has
   results → done" short-circuit would strand every v4 hero
   pack on v4 forever. Each table is now filled only when
   empty, and the pack is rewritten only when something was
   actually added.

   usage: npx tsx scripts/upgrade-packs.ts [sessionKey…]
   ============================================================ */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fetchRows } from '../src/data/openf1'
import { decodePack, encodePack, PACK_VERSION } from '../src/data/pack'
import { normalizeResults } from '../src/data/sessionLoader'
import type {
  GridEvent,
  OvertakeEvent,
  OvertakeRow,
  SessionData,
  SessionResultRow,
  StartingGridRow,
} from '../src/data/types'
import { RaceStateIndex } from '../src/engine/raceState'

async function truthCheck(data: SessionData): Promise<void> {
  if (data.results.length === 0 || data.drivers.length === 0) return
  const idx = new RaceStateIndex(data)
  // Evaluate AT THE LAST LIVE POSITION SAMPLE — not tMax−30. Telemetry can run
  // into cool-down laps after the flag while position rows freeze per driver,
  // which turns any later instant into stale-order soup (Interlagos proved it).
  const evalT =
    data.positions.t.length > 0 ? data.positions.t[data.positions.t.length - 1] : idx.tMax - 30
  const order = idx.orderAt(evalT)
  const nameOf = (d: number) => data.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`
  const top = data.results.filter((r) => r.position !== null).slice(0, 5)
  const match = top.every((r, i) => r.driverNumber === order[i])
  console.log(`  official : ${top.map((r) => nameOf(r.driverNumber)).join(' → ')}`)
  console.log(
    `  index    : ${order.slice(0, 5).map(nameOf).join(' → ')}  → ${match ? 'MATCH' : 'DIVERGES'}`,
  )
}

async function upgrade(file: string): Promise<void> {
  const raw = await readFile(`public/packs/${file}`)
  const data = decodePack(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  const key = data.meta.session_key
  let changed = false
  const added: string[] = []

  // --- results (v3 → v4): fill only when the table is empty ---
  let results = data.results
  if (results.length === 0) {
    console.log(`${file}: fetching session_result…`)
    const rows = await fetchRows<SessionResultRow>('session_result', { session_key: key })
    results = normalizeResults(rows)
    if (results.length > 0) {
      changed = true
      added.push(`${results.length} results`)
    }
  }

  // --- overtakes (→ v5): authoritative on-track passes, session-time normalized ---
  let overtakes: OvertakeEvent[] = data.overtakes
  if (overtakes.length === 0) {
    console.log(`${file}: fetching overtakes…`)
    const rows = await fetchRows<OvertakeRow>('overtakes', { session_key: key }, { allowEmpty404: true })
    overtakes = rows
      .map((r) => ({
        t: (Date.parse(r.date) - data.epoch0) / 1000,
        overtaking: r.overtaking_driver_number,
        overtaken: r.overtaken_driver_number,
        position: r.position,
      }))
      .sort((a, b) => a.t - b.t)
    if (overtakes.length > 0) {
      changed = true
      added.push(`${overtakes.length} overtakes`)
    }
  }

  // --- starting grid (→ v5) ---
  let grid: GridEvent[] = data.grid
  if (grid.length === 0) {
    console.log(`${file}: fetching starting_grid…`)
    const rows = await fetchRows<StartingGridRow>('starting_grid', { session_key: key }, { allowEmpty404: true })
    grid = rows
      .map((r) => ({ driverNumber: r.driver_number, position: r.position, qualiLap: r.lap_duration }))
      .sort((a, b) => a.position - b.position)
    if (grid.length > 0) {
      changed = true
      added.push(`${grid.length} grid slots`)
    }
  }

  if (!changed) {
    console.log(`${file}: already current — all v${PACK_VERSION} tables present`)
    await truthCheck(data)
    return
  }

  const upgraded: SessionData = { ...data, results, overtakes, grid }
  const buffer = encodePack(upgraded)
  await writeFile(`public/packs/${file}`, Buffer.from(buffer))
  console.log(
    `${file}: ${data.meta.circuit_short_name} → v${PACK_VERSION}, added ${added.join(' + ')}, ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`,
  )
  await truthCheck(upgraded)
}

const args = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n) && n > 0)
const files =
  args.length > 0
    ? args.map((k) => `${k}.apx`)
    : (await readdir('public/packs')).filter((f) => f.endsWith('.apx'))

for (const f of files) {
  try {
    await upgrade(f)
  } catch (err) {
    console.error(`${f}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
  }
}
