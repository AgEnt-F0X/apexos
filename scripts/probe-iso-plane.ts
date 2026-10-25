/* ============================================================
   Iso-plane probe — the projection kernel MUST agree with the
   live camera, pixel for pixel, or every hairline callout would
   hang off its anchor. This builds a THREE.OrthographicCamera
   placed exactly as CameraRig places it (same elevation, same
   azimuth convention, same zoom = min(w,h)/span, same lookAt)
   and asserts isoProject reproduces its pixels.

   Run: npx tsx scripts/probe-iso-plane.ts
   ============================================================ */

import * as THREE from 'three'
import { isoProject, isoUnproject, ISO_ELEV } from '../src/scene/isoPlane'

const ce = Math.cos(ISO_ELEV)
const se = Math.sin(ISO_ELEV)
const D = 5000

interface Case {
  az: number
  cx: number
  cz: number
  width: number
  height: number
  span: number
}

// the four director plates plus two off-plate azimuths, aspect-balanced
const CASES: Case[] = [
  { az: Math.PI / 4, cx: 13, cz: -7, width: 1600, height: 900, span: 320 },
  { az: Math.PI * 1.25, cx: -40, cz: 22, width: 900, height: 1600, span: 640 },
  { az: Math.PI * 0.75, cx: 0, cz: 0, width: 1280, height: 720, span: 120 },
  { az: Math.PI * 1.75, cx: 250, cz: 250, width: 1000, height: 1000, span: 90 },
  { az: 0.9, cx: 13, cz: -7, width: 1600, height: 900, span: 320 },
  { az: 2.4, cx: -180, cz: 90, width: 1200, height: 800, span: 500 },
]

let fails = 0

for (const c of CASES) {
  const zoom = Math.min(c.width, c.height) / c.span
  const cam = new THREE.OrthographicCamera(-c.width / 2, c.width / 2, c.height / 2, -c.height / 2, 1, D * 2)
  cam.position.set(c.cx + Math.cos(c.az) * ce * D, se * D, c.cz + Math.sin(c.az) * ce * D)
  cam.zoom = zoom
  cam.updateProjectionMatrix()
  cam.lookAt(new THREE.Vector3(c.cx, 0, c.cz))
  cam.updateMatrixWorld()

  const frame = { az: c.az, cx: c.cx, cz: c.cz, width: c.width, height: c.height, zoom }

  // ring of points out to the corner of the visible span, plus the target
  const pts: Array<[number, number]> = [[c.cx, c.cz]]
  const r = c.span * 1.4
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2
    pts.push([c.cx + Math.cos(a) * r, c.cz + Math.sin(a) * r])
  }

  let worst = 0
  let worstAt: [number, number] = [0, 0]
  for (const [wx, wz] of pts) {
    const p = new THREE.Vector3(wx, 0, wz).project(cam)
    const pxT = (p.x * 0.5 + 0.5) * c.width
    const pyT = (-p.y * 0.5 + 0.5) * c.height
    const mine = isoProject(frame, wx, wz)
    const d = Math.hypot(pxT - mine.x, pyT - mine.y)
    if (d > worst) {
      worst = d
      worstAt = [wx, wz]
    }
  }

  // the inverse must round-trip: a screen pixel back to world and forward again
  let worstRound = 0
  for (const [wx, wz] of pts) {
    const px = isoProject(frame, wx, wz)
    const w = isoUnproject(frame, px.x, px.y)
    worstRound = Math.max(worstRound, Math.hypot(w.x - wx, w.z - wz))
  }

  const okProj = worst < 0.5
  const okInv = worstRound < 0.5
  if (!okProj || !okInv) fails++
  console.log(
    `${okProj && okInv ? 'ok  ' : 'FAIL'} az=${c.az.toFixed(3)} ${c.width}x${c.height} span=${c.span}` +
      `  proj=${worst.toFixed(4)}px${okProj ? '' : ` @(${worstAt[0]},${worstAt[1]})`}  roundTrip=${worstRound.toFixed(3)}m`,
  )
}

console.log(`\n${fails === 0 ? 'ISO PLANE VERIFIED — callouts will hang on their anchors' : `${fails} FAILURE(S)`}\n`)
process.exit(fails === 0 ? 0 : 1)
