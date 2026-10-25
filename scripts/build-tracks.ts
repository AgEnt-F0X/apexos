/* ============================================================
   Circuit geometry snapshot builder.
   Decodes every pack in public/packs/, extrudes the track model,
   and writes public/tracks/<key>.json for the runtime cache.

   usage: npx tsx scripts/build-tracks.ts
   ============================================================ */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { decodePack } from '../src/data/pack'
import { buildTrackModel } from '../src/scene/trackBuilder'
import { exportTrackJson } from '../src/data/circuitCache'

await mkdir('public/tracks', { recursive: true })
const files = (await readdir('public/packs')).filter((f) => f.endsWith('.apx'))
if (files.length === 0) {
  console.log('no packs found in public/packs — nothing to do')
  process.exit(0)
}

for (const f of files) {
  const buf = await readFile(`public/packs/${f}`)
  const data = decodePack(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  try {
    const t0 = performance.now()
    const model = buildTrackModel(data)
    const ms = (performance.now() - t0).toFixed(0)
    const json = exportTrackJson(data, model)
    const key = (JSON.parse(json) as { key: string }).key
    await writeFile(`public/tracks/${key}.json`, json)
    console.log(
      `${data.meta.circuit_short_name.padEnd(12)} ${model.length.toFixed(0)}m · ${model.corners.length} corners · extruded in ${ms}ms → public/tracks/${key}.json`,
    )
  } catch (err) {
    console.warn(`SKIP ${data.meta.circuit_short_name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
console.log('done')
