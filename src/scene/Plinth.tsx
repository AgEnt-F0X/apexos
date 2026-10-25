/* ============================================================
   The plinth — a rounded porcelain slab the circuit floats
   over, like an architectural model in a gallery. Sized from
   the track's real bounds; a tight-cored blob shadow below it
   makes the whole diorama hover in the void.

   The top face is a printed base sheet: paper grain, a 10 m
   graph grid (major every 100 m), a topology wash that lets
   the paper *know* where the circuit climbs, an edge vignette,
   a 100 m scale bar and a north needle — one 2048² canvas
   texture baked once per track, zero per-frame cost.

   THE MIRRORING RULE. The cap UVs are the raw extrude-shape
   coordinates, and that sheet→world mapping is left-handed for
   a viewer above the model: anything with chirality — letters —
   baked into this texture renders mirrored from every turntable
   plate. The sheet therefore carries only achiral content:
   grids, bars, symmetric needles, washes. Words live on
   billboards instead: the engraved plaque is now a camera-facing
   sprite parked at the sheet corner like a museum placard,
   readable from every seat. The diegetic lap timeline obeys the
   same rule: ticks and fills only, no glyphs.
   ============================================================ */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { TrackModel } from './trackBuilder'
import { raceClock } from '../engine/RaceClock'
import { onMonoReady } from './tagTexture'

/** world-y of the plinth's top face (track base sits at y≈0) */
export const PLINTH_TOP_Y = -0.9

const CANVAS_PX = 2048
const INK = '36, 46, 60'

/** baked paper/grid/wash sheet; v axis follows world +z */
function makePaperTexture(
  minX: number,
  minZ: number,
  spanX: number,
  spanZ: number,
  model: TrackModel,
): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = CANVAS_PX
  const ctx = c.getContext('2d')!
  const pxX = CANVAS_PX / spanX
  const pxZ = CANVAS_PX / spanZ

  ctx.fillStyle = '#f2f4f8'
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)

  // paper mottling: many small soft clouds read as fibre; the old
  // 900 big discs read as rain-of-bloom stains at close zoom
  for (let i = 0; i < 1500; i++) {
    const r = 5 + Math.random() * 26
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? '226, 231, 239' : '247, 249, 252'}, ${0.018 + Math.random() * 0.022})`
    ctx.beginPath()
    ctx.arc(Math.random() * CANVAS_PX, Math.random() * CANVAS_PX, r, 0, Math.PI * 2)
    ctx.fill()
  }
  const grain = ctx.createImageData(256, 256)
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = 232 + Math.random() * 23
    grain.data[i] = v
    grain.data[i + 1] = v + 2
    grain.data[i + 2] = v + 6
    grain.data[i + 3] = 19
  }
  const tile = document.createElement('canvas')
  tile.width = tile.height = 256
  tile.getContext('2d')!.putImageData(grain, 0, 0)
  const tileTex = ctx.createPattern(tile, 'repeat')!
  ctx.fillStyle = tileTex
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)

  // topology wash: every centerline point bleeds a soft ellipse of
  // terrain tone under the paper — cool blue-grey in the valleys,
  // warm sepia on the ridges. The sheet gains the circuit's relief
  // without a single contour glyph
  {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < model.n; i++) {
      const y = model.points[i * 3 + 1]
      if (y < lo) lo = y
      if (y > hi) hi = y
    }
    const range = Math.max(1, hi - lo)
    const rr = 36 // wash radius, meters
    for (let i = 0; i < model.n; i += 2) {
      const x = model.points[i * 3]
      const y = model.points[i * 3 + 1]
      const z = model.points[i * 3 + 2]
      const h = (y - lo) / range // 0 = valley → 1 = ridge
      const t = Math.abs(h - 0.5) * 2
      const rgb = h >= 0.5 ? '98, 80, 62' : '62, 84, 112'
      const a = 0.007 + 0.016 * t
      ctx.save()
      ctx.translate((x - minX) * pxX, (z - minZ) * pxZ)
      ctx.scale(pxX, pxZ)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rr)
      g.addColorStop(0, `rgba(${rgb}, ${a.toFixed(3)})`)
      g.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, rr, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // graph grid: minor 10 m, major 100 m — world-square, sheet-quiet
  for (const [m, style, w] of [
    [10, 'rgba(36, 52, 72, 0.045)', 1],
    [100, 'rgba(36, 52, 72, 0.075)', Math.max(1, pxX * 0.8)],
  ] as const) {
    ctx.strokeStyle = style
    ctx.lineWidth = w
    ctx.beginPath()
    const originX = -minX % m
    for (let x = originX; x <= spanX; x += m) {
      ctx.moveTo(x * pxX, 0)
      ctx.lineTo(x * pxX, CANVAS_PX)
    }
    const originZ = -minZ % m
    for (let z = originZ; z <= spanZ; z += m) {
      ctx.moveTo(0, z * pxZ)
      ctx.lineTo(CANVAS_PX, z * pxZ)
    }
    ctx.stroke()
  }

  // edge vignette so the eye falls back to the model
  const vg = ctx.createRadialGradient(
    CANVAS_PX / 2, CANVAS_PX / 2, CANVAS_PX * 0.34,
    CANVAS_PX / 2, CANVAS_PX / 2, CANVAS_PX * 0.72,
  )
  vg.addColorStop(0, 'rgba(34, 44, 58, 0)')
  vg.addColorStop(1, 'rgba(34, 44, 58, 0.06)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)

  // scale bar, canvas-lower edge: 100 m of real circuit. Shape only —
  // the "100 M" words live on the nameplate sprite (mirroring rule)
  {
    const len = 100 * pxX
    const bx = CANVAS_PX - 74 - len
    const by = CANVAS_PX - 64
    ctx.strokeStyle = `rgba(${INK}, 0.3)`
    ctx.lineWidth = Math.max(1, pxX * 1.4)
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + len, by)
    for (const ex of [bx, bx + len]) {
      ctx.moveTo(ex, by - 9)
      ctx.lineTo(ex, by + 9)
    }
    ctx.stroke()
  }

  // north needle, canvas-upper-right: a symmetric blade (filled half,
  // paper-ruled spine) pointing at world +z. Achiral by construction,
  // so it survives the sheet's handedness from every plate
  {
    const ax = CANVAS_PX - 92
    const ay = 96
    ctx.strokeStyle = `rgba(${INK}, 0.24)`
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(ax, ay - 32)
    ctx.lineTo(ax, ay + 32)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ax - 11, ay + 32)
    ctx.lineTo(ax, ay - 8)
    ctx.lineTo(ax + 11, ay + 32)
    ctx.closePath()
    ctx.fillStyle = `rgba(${INK}, 0.24)`
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(ax, ay + 26)
    ctx.lineTo(ax, ay - 2)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

/* ============================================================
   Diegetic lap timeline — a baked tick strip the race drains
   across: baseline, one tick per lap, a major tick every five.
   No glyphs (mirroring rule); the live progress fill and the
   pulsing head are painted by the material patch at runtime.
   ============================================================ */
function makeTimelineTexture(laps: number): THREE.CanvasTexture | null {
  if (!Number.isFinite(laps) || laps < 2) return null
  const w = 1024
  const h = 96
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // faint paper decker + hairline, so the strip reads as an
  // instrument laid onto the sheet
  ctx.fillStyle = 'rgba(203, 212, 224, 0.3)'
  ctx.fillRect(0, 14, w, h - 28)
  ctx.strokeStyle = 'rgba(36, 46, 60, 0.16)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 14, w - 2, h - 28)
  ctx.strokeStyle = 'rgba(36, 46, 60, 0.3)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(6, h * 0.62)
  ctx.lineTo(w - 6, h * 0.62)
  ctx.stroke()
  for (let k = 0; k <= laps; k++) {
    const x = 8 + (k / laps) * (w - 16)
    const major = k % 5 === 0
    ctx.fillStyle = major ? 'rgba(36, 46, 60, 0.44)' : 'rgba(36, 46, 60, 0.24)'
    ctx.fillRect(x - (major ? 1.5 : 0.75), h * 0.62 - (major ? 22 : 10), major ? 3 : 1.5, major ? 22 : 10)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* ============================================================
   Museum nameplate — the plaque the paper could never carry
   without mirroring. Paper chip, engraved double-strike type
   (highlight above sunk ink) and a model-kit meta line. Lives
   on a camera-facing sprite: right way up and right-handed
   from every seat in the gallery.
   ============================================================ */
function makeNameplateTexture(title: string): THREE.CanvasTexture {
  const w = 1024
  const h = 160
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8

  const redraw = () => {
    ctx.clearRect(0, 0, w, h)
    ctx.shadowColor = 'rgba(22, 27, 35, 0.16)'
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 4
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
    ctx.beginPath()
    ctx.roundRect(6, 6, w - 12, h - 14, 12)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'rgba(24, 32, 44, 0.14)'
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    // shrink-to-fit engraving
    let size = 56
    ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`
    while (size > 24 && ctx.measureText(title).width > w - 64) {
      size -= 2
      ctx.font = `700 ${size}px "JetBrains Mono", ui-monospace, monospace`
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fillText(title, w / 2, 54 - 2) // highlight under the engraving
    ctx.fillStyle = 'rgba(36, 46, 60, 0.55)'
    ctx.fillText(title, w / 2, 54) // ink sunk into the chip
    ctx.font = '500 26px "JetBrains Mono", ui-monospace, monospace'
    ctx.fillStyle = 'rgba(76, 87, 102, 0.6)'
    ctx.fillText('GRAPH GRID 10 M  ·  SCALE BAR 100 M  ·  BLADE ▲ N', w / 2, h - 38)
    tex.needsUpdate = true
  }
  redraw()
  onMonoReady(redraw)
  return tex
}

export function Plinth({
  model,
  plaque,
  lapCount,
}: {
  model: TrackModel
  plaque?: string
  lapCount: number
}) {
  const built = useMemo(() => {
    // true footprint of the circuit
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let i = 0; i < model.n; i++) {
      const x = model.points[i * 3]
      const z = model.points[i * 3 + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const margin = Math.max(70, model.radius * 0.16)
    minX -= margin
    maxX += margin
    minZ -= margin
    maxZ += margin
    const w = maxX - minX
    const h = maxZ - minZ
    const r = Math.min(w, h) * 0.09

    // rounded-rect slab, extruded downward (shape XY → world XZ)
    const shape = new THREE.Shape()
    shape.moveTo(minX + r, minZ)
    shape.lineTo(maxX - r, minZ)
    shape.absarc(maxX - r, minZ + r, r, -Math.PI / 2, 0, false)
    shape.lineTo(maxX, maxZ - r)
    shape.absarc(maxX - r, maxZ - r, r, 0, Math.PI / 2, false)
    shape.lineTo(minX + r, maxZ)
    shape.absarc(minX + r, maxZ - r, r, Math.PI / 2, Math.PI, false)
    shape.lineTo(minX, minZ + r)
    shape.absarc(minX + r, minZ + r, r, Math.PI, Math.PI * 1.5, false)

    const thickness = Math.max(22, model.radius * 0.075)
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: 3.5,
      bevelSize: 3.5,
      bevelSegments: 3,
    })
    geometry.rotateX(Math.PI / 2) // shape Y → world Z, extrusion → downward
    geometry.translate(0, -3.5, 0) // bevel rises above the cap: re-seat top at y=0
    geometry.computeVertexNormals()

    // the cap UVs are the raw shape coords in meters; remap to 0..1
    const paper = makePaperTexture(minX, minZ, w, h, model)
    paper.repeat.set(1 / w, 1 / h)
    paper.offset.set(-minX / w, -minZ / h)

    const capMaterial = new THREE.MeshStandardMaterial({
      map: paper,
      color: '#ffffff',
      roughness: 0.92,
      metalness: 0.02,
    })
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: '#f2f4f8',
      roughness: 0.9,
      metalness: 0.02,
    })

    // hover shadow: the old gradient had no core — a wide weak haze
    // that read as fog, not weight. Dark core near the slab, long
    // quick falloff after: the diorama finally has mass over the void
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const ctx = c.getContext('2d')!
    const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 126)
    grad.addColorStop(0, 'rgba(34, 44, 58, 0.3)')
    grad.addColorStop(0.32, 'rgba(34, 44, 58, 0.15)')
    grad.addColorStop(0.65, 'rgba(34, 44, 58, 0.045)')
    grad.addColorStop(1, 'rgba(34, 44, 58, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 256, 256)
    const shadowTex = new THREE.CanvasTexture(c)

    // --- diegetic lap timeline, laid on the near margin ---
    const timelineTex = makeTimelineTexture(lapCount)
    const timelineU = {
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uAccent: { value: new THREE.Color('#e10600') },
    }
    let timelineMat: THREE.MeshStandardMaterial | null = null
    let timelineMesh: THREE.Mesh | null = null
    if (timelineTex) {
      timelineMat = new THREE.MeshStandardMaterial({
        map: timelineTex,
        transparent: true,
        roughness: 0.95,
        metalness: 0,
        depthWrite: false,
      })
      timelineMat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, timelineU)
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            /* glsl */ `#include <common>
              uniform float uProgress;
              uniform float uTime;
              uniform vec3 uAccent;`,
          )
          .replace(
            '#include <map_fragment>',
            /* glsl */ `
              vec4 tl = texture2D(map, vMapUv);
              float done = step(vMapUv.x, uProgress);
              float head = 1.0 - smoothstep(0.0, 0.008, abs(vMapUv.x - uProgress));
              vec3 tc = mix(tl.rgb, vec3(0.07, 0.09, 0.12), done * (0.18 + 0.55 * tl.a));
              tc = mix(tc, uAccent, head * (0.6 + 0.22 * sin(uTime * 5.0)));
              diffuseColor = vec4(tc, min(max(tl.a, head * 0.95), 1.0));`,
          )
        timelineMat!.customProgramCacheKey = () => 'apex-timeline'
      }
      timelineMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(w * 0.62, model.radius * 1.4), THREE.MathUtils.clamp(margin * 0.22, 7, 22)),
        timelineMat,
      )
      timelineMesh.rotation.x = -Math.PI / 2
      timelineMesh.position.set(model.center[0], PLINTH_TOP_Y + 0.06, minZ + margin * 0.45)
      timelineMesh.renderOrder = 1
    }

    // --- museum nameplate, standing where the engraving used to be ---
    const plateTex = plaque ? makeNameplateTexture(plaque) : null
    let plate: THREE.Sprite | null = null
    if (plateTex) {
      plate = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: plateTex, transparent: true, depthWrite: false }),
      )
      plate.renderOrder = 9
      const ph = THREE.MathUtils.clamp(model.radius * 0.075, 18, 52)
      plate.scale.set(ph * (1024 / 160), ph, 1)
      plate.position.set(minX + margin * 0.55, PLINTH_TOP_Y + 8, maxZ - margin * 0.38)
    }

    return {
      geometry,
      capMaterial,
      sideMaterial,
      shadowTex,
      spanX: w,
      spanZ: h,
      thickness,
      timelineMesh,
      timelineMat,
      timelineTex,
      timelineU,
      plate,
      plateTex,
    }
  }, [model, plaque, lapCount])

  useEffect(
    () => () => {
      built.capMaterial.map?.dispose()
      built.capMaterial.dispose()
      built.sideMaterial.dispose()
      built.shadowTex.dispose()
      built.geometry.dispose()
      built.timelineTex?.dispose()
      built.timelineMat?.dispose()
      built.timelineMesh?.geometry.dispose()
      if (built.plate) {
        built.plate.material.map?.dispose()
        built.plate.material.dispose()
      }
    },
    [built],
  )

  useFrame((state) => {
    // the race drains across the strip: time-share of the session,
    // a pulsing ink head marking where this moment sits in the race
    built.timelineU.uProgress.value = THREE.MathUtils.clamp(raceClock.frac, 0, 1)
    built.timelineU.uTime.value = state.clock.elapsedTime
    // placard etiquette: solid for the gallery plates, politely
    // fading out once the camera dives to model scale
    if (built.plate) {
      const zoom = Math.max(state.camera.zoom, 1e-6)
      const span = Math.min(state.size.width, state.size.height) / zoom
      built.plate.material.opacity = THREE.MathUtils.smoothstep(span, 340, 620)
    }
  })

  return (
    <group>
      {/* ExtrudeGeometry group 0 = caps (paper sheet), group 1 = sides (plain slab) */}
      <mesh geometry={built.geometry} position={[0, PLINTH_TOP_Y, 0]} receiveShadow castShadow>
        <primitive object={built.capMaterial} attach="material-0" />
        <primitive object={built.sideMaterial} attach="material-1" />
      </mesh>
      {built.timelineMesh && <primitive object={built.timelineMesh} />}
      {built.plate && <primitive object={built.plate} />}
      {/* hover shadow in the void below, pulled in tight so its core
          sits under the slab — weight, not fog */}
      <mesh
        position={[model.center[0], PLINTH_TOP_Y - built.thickness - 26, model.center[2]]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[built.spanX * 1.28, built.spanZ * 1.28]} />
        <meshBasicMaterial map={built.shadowTex} transparent depthWrite={false} />
      </mesh>
    </group>
  )
}
