/* ============================================================
   Hero-pack snapshot: runs the exact same pipeline the in-app
   worker runs, and writes the resulting APEXPACK to
   public/packs/<key>.apx so first-time visitors skip the fetch.

   usage: npx tsx scripts/snapshot-session.ts [sessionKey]
   ============================================================ */

import { mkdir, writeFile } from 'node:fs/promises'
import { loadSession } from '../src/data/sessionLoader'

const key = Number(process.argv[2] ?? 9636)

console.log(`snapshotting session ${key}…`)
const started = Date.now()

const { buffer, fromCache } = await loadSession(key, (p) => {
  process.stdout.write(
    `\r  [${p.stage.padEnd(9)}] ${(p.frac * 100).toFixed(0).padStart(3)}%  ${p.label.padEnd(38)} ${p.rows.toLocaleString().padStart(10)} rows`,
  )
})

process.stdout.write('\n')
await mkdir('public/packs', { recursive: true })
const path = `public/packs/${key}.apx`
await writeFile(path, Buffer.from(buffer))
console.log(
  `wrote ${path} — ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)}s${fromCache ? ' (from cache)' : ''}`,
)
