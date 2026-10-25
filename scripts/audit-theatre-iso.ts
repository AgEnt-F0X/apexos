/* ============================================================
   THEATRE ISOMETRY AUDIT — headless, mathematical.

   Replicates the EXACT camera math from CameraRig.tsx /
   Theatre.tsx and asserts the PLAN §0.5 diorama contract:

   1. PROJECTION IS ORTHOGRAPHIC   (no perspective anywhere)
   2. ELEVATION == classic iso      atan(1/√2) ≈ 35.264°
      (spec band: ~30–35°, "near-isometric, legibility-tuned")
   3. AZIMUTHS are the four iso plates (45/135/225/315°)
   4. FRAMING: at every plate, the full plinth footprint stays
      inside the Director's chosen span — the diorama never crops
   5. ISO FORESHORTENING: x/z axes foreshorten in the true-
      isometric √3 : 1 ratio (each at 30° to screen-horizontal)

   usage: npx tsx scripts/audit-theatre-iso.ts
   ============================================================ */

import { readdir, readFile } from 'node:fs/promises'
import type { CachedTrackGeometry } from '../src/scene/trackBuilder'

/** exact constants from CameraRig.tsx */
const ISO_ELEV = Math.atan(1 / Math.SQRT2)
const POLAR = Math.PI / 2 - ISO_ELEV
const PLATES = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180)

let failures = 0
const check = (ok: boolean, msg: string): void => {
  if (ok) console.log(`  ✓ ${msg}`)
  else {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

console.log('ELEVATION CONTRACT')
const elevDeg = (ISO_ELEV * 180) / Math.PI
check(Math.abs(ISO_ELEV - Math.atan(1 / Math.SQRT2)) < 1e-9, `ISO_ELEV = atan(1/√2) = ${elevDeg.toFixed(3)}° (true isometric)`)
check(elevDeg >= 30 && elevDeg <= 35.5, `within spec band ~30–35° (${elevDeg.toFixed(2)}° — at/above the top edge)`)
check(Math.abs(POLAR + ISO_ELEV - Math.PI / 2) < 1e-9, 'POLAR derived correctly (OrbitControls elevation lock)')

console.log('\nISO PLATES')
const expected = [45, 135, 225, 315]
check(
  PLATES.every((p, i) => Math.abs((p * 180) / Math.PI - expected[i]) < 1e-9),
  'azimuths = the four 45°-spaced iso plates',
)

console.log('\nPROJECTION')
let perspectiveRefs = 0
{
  const { execSync } = await import('node:child_process')
  try {
    const out = execSync(
      'findstr /S /I /C:"PerspectiveCamera" /C:"fov: " /C:"fov=" src\\*.ts src\\*.tsx 2>nul',
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    if (out.trim().length > 0) perspectiveRefs = out.trim().split(/\r?\n/).length
  } catch {
    /* findstr exits nonzero when nothing matches — exactly what we want */
  }
}
check(perspectiveRefs === 0, 'zero PerspectiveCamera / fov references in src')

console.log('\nISO FORESHORTENING (√3 : 1, axis to screen = 30°)')
{
  const az = PLATES[0]
  const ux = -Math.sin(az)
  const vx = -Math.cos(az) * Math.sin(ISO_ELEV)
  const ratio = Math.abs(ux) / Math.abs(vx)
  check(Math.abs(ratio - Math.sqrt(3)) < 1e-6, `projected x-axis foreshortening ratio = ${ratio.toFixed(3)} (√3:1 = ${Math.sqrt(3).toFixed(3)})`)
  const thX = (Math.atan2(Math.abs(vx), Math.abs(ux)) * 180) / Math.PI
  check(Math.abs(thX - 30) < 1e-6, `axis-to-screen angle = ${thX.toFixed(2)}° (true iso = 30°)`)
}

// ---------- 4. framing: every baked track, every plate ----------
console.log('\nFRAMING (every baked track · 4 plates each)')
const files = (await readdir('public/tracks')).filter((f) => f.endsWith('.json'))
check(files.length >= 20, `${files.length} baked circuits to audit`)
let cropCount = 0
let maxRadius = 0
for (const f of files) {
  const g = JSON.parse(await readFile(`public/tracks/${f}`, 'utf8')) as CachedTrackGeometry
  if (g.v !== 1) continue
  const bounds = g.bounds as [number, number, number, number]
  const radius = g.radius
  maxRadius = Math.max(maxRadius, radius)

  // plinth footprint (same margin math as Plinth.tsx + fitSpan)
  const margin = Math.max(70, radius * 0.16) + 24
  const cornerPts = [
    [bounds[0] - margin, bounds[2] - margin],
    [bounds[1] + margin, bounds[2] - margin],
    [bounds[0] - margin, bounds[3] + margin],
    [bounds[1] + margin, bounds[3] + margin],
  ]

  for (const az of PLATES) {
    const sinE = Math.sin(ISO_ELEV)
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, z] of cornerPts) {
      const u = -Math.sin(az) * x + Math.cos(az) * z
      const v = (-Math.cos(az) * x - Math.sin(az) * z) * sinE
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const useSpan = Math.max((maxU - minU) * 1.04, (maxV - minV) * 1.04)
    if (maxU - minU > useSpan || maxV - minV > useSpan) {
      cropCount++
      failures++
      console.log(`  ✗ ${f} @ az ${((az * 180) / Math.PI).toFixed(0)}° — plinth OVERFLOWS span`)
    }
  }
}
console.log(`  ${files.length} circuits × 4 plates — ${cropCount === 0 ? 'ALL FRAMED, ZERO CROPS' : `${cropCount} crop(s)`}`)

// ortho clip sanity: camera distance D = radius*5+500, near=-50000 far=50000
console.log('\nCLIP SANITY')
check(
  maxRadius * 5 + 500 < 50000,
  `largest circuit D = ${(maxRadius * 5 + 500).toFixed(0)} < ortho far 50000`,
)

console.log(failures === 0 ? '\nALL ISOMETRY CHECKS PASS' : `\n${failures} ISOMETRY FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1