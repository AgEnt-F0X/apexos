/* ============================================================
   Track furniture — the drawing annotations of a circuit map:
   T-numbered corner chips (derived from centerline curvature,
   not a database), sector gates, and the start/finish marker.
   Famous corner names are a small curated layer on top, shown
   only at conversational zoom. Everything is ink on paper:
   constant screen size, density-gated, never over the action.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAppStore } from '../state/appStore'
import { onMonoReady } from './tagTexture'
import { sceneRefs } from './sceneRefs'
import type { TrackModel } from './trackBuilder'

/** curated names for the hero circuit, keyed by approximate arc param.
    each name attaches to the nearest detected corner. verified visually. */
/* anchors verified against the detector's output for pack 9636
   (see scripts/verify-pack.ts — corners print with their params) */
const CORNER_NAMES: Record<string, Array<[number, string]>> = {
  interlagos: [
    [0.08, 'SENNA S'],
    [0.144, 'CURVA DO SOL'],
    [0.328, 'DESCIDA DO LAGO'],
    [0.485, 'FERRADURA'],
    [0.543, 'LARANJINHA'],
    [0.57, 'PINHEIRINHO'],
    [0.637, 'BICO DE PATO'],
    [0.67, 'MERGULHO'],
    [0.751, 'JUNÇÃO'],
    [0.847, 'ARQUIBANCADAS'],
  ],
}

function chipTexture(text: string, opts?: { checker?: boolean; wide?: boolean }): THREE.CanvasTexture {
  const w = opts?.wide ? 256 : 96
  const h = 68
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4

  const redraw = () => {
    ctx.clearRect(0, 0, w, h)
    if (opts?.wide) {
      // name label: bare ink text with a soft paper halo, no chip
      ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = 'rgba(255,255,255,0.95)'
      ctx.shadowBlur = 7
      ctx.fillStyle = '#4c5766'
      ctx.fillText(text, w / 2, h / 2)
      ctx.shadowColor = 'transparent'
    } else {
      // round chip
      const r = 27
      ctx.shadowColor = 'rgba(22,27,35,0.22)'
      ctx.shadowBlur = 6
      ctx.shadowOffsetY = 2
      ctx.fillStyle = 'rgba(255,255,255,0.96)'
      ctx.beginPath()
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.strokeStyle = 'rgba(24,32,44,0.28)'
      ctx.lineWidth = 2
      ctx.stroke()
      if (opts?.checker) {
        const s = 7
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            if ((x + y) % 2 === 0) continue
            ctx.fillStyle = '#161b23'
            ctx.fillRect(w / 2 - 2 * s + x * s, h / 2 - 2 * s + y * s, s, s)
          }
        }
      } else {
        ctx.fillStyle = '#161b23'
        ctx.font = '700 24px "JetBrains Mono", ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, w / 2, h / 2 + 1)
      }
    }
    tex.needsUpdate = true
  }
  redraw()
  onMonoReady(redraw)
  return tex
}

function makeSprite(tex: THREE.CanvasTexture, renderOrder = 8): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })
  const s = new THREE.Sprite(mat)
  s.renderOrder = renderOrder
  return s
}

interface Item {
  sprite: THREE.Sprite
  /** px height on screen */
  px: number
  /** show only when the frame is tighter than this many world-meters (0 = always) */
  maxSpan: number
  aspect: number
  /** road-coupling anchor: re-placed each frame at dist + widthShift */
  anchor: { idx: number; dir: 1 | -1; dist: number; y: number }
}

export function TrackFurniture({ model }: { model: TrackModel }) {
  const circuit = useAppStore((s) => s.session?.meta.circuit_short_name ?? '')

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    const up = new THREE.Vector3(0, 1, 0)
    const tangent = new THREE.Vector3()
    const left = new THREE.Vector3()

    const outward = (idx: number, dir: 1 | -1, dist: number, y: number, into: THREE.Vector3) => {
      const n = model.n
      const nx = model.points[((idx + 1) % n) * 3] - model.points[((idx - 1 + n) % n) * 3]
      const nz = model.points[((idx + 1) % n) * 3 + 2] - model.points[((idx - 1 + n) % n) * 3 + 2]
      tangent.set(nx, 0, nz).normalize()
      left.crossVectors(up, tangent).normalize()
      into.set(
        model.points[idx * 3] + left.x * dist * -dir,
        model.points[idx * 3 + 1] + y,
        model.points[idx * 3 + 2] + left.z * dist * -dir,
      )
    }

    const pos = new THREE.Vector3()

    // corner chips
    for (const c of model.corners) {
      const sprite = makeSprite(chipTexture(`${c.number}`))
      outward(c.idx, c.dir, model.halfWidth + 13, 2, pos)
      sprite.position.copy(pos)
      out.push({ sprite, px: 19, maxSpan: 0, aspect: 96 / 68, anchor: { idx: c.idx, dir: c.dir, dist: model.halfWidth + 13, y: 2 } })
    }

    // curated names near their closest corners
    const names = CORNER_NAMES[circuit.toLowerCase()] ?? []
    for (const [param, name] of names) {
      let best: (typeof model.corners)[number] | null = null
      let bestD = Infinity
      for (const c of model.corners) {
        const d = Math.min(Math.abs(c.param - param), 1 - Math.abs(c.param - param))
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (!best || bestD > 0.045) continue
      const sprite = makeSprite(chipTexture(name, { wide: true }), 7)
      outward(best.idx, best.dir, model.halfWidth + 34, 2.5, pos)
      sprite.position.copy(pos)
      out.push({ sprite, px: 17, maxSpan: 900, aspect: 256 / 68, anchor: { idx: best.idx, dir: best.dir, dist: model.halfWidth + 34, y: 2.5 } })
    }

    // sector gates (S2/S3 begin) + start/finish chip
    for (const [k, label] of [[1, 'S2'], [2, 'S3']] as const) {
      const idx = model.indexOfParam(model.sectorParam[k])
      const sprite = makeSprite(chipTexture(label))
      outward(idx, 1, model.halfWidth + 13, 2, pos)
      sprite.position.copy(pos)
      out.push({ sprite, px: 17, maxSpan: 0, aspect: 96 / 68, anchor: { idx, dir: 1, dist: model.halfWidth + 13, y: 2 } })
    }
    {
      const sprite = makeSprite(chipTexture('', { checker: true }), 9)
      outward(0, 1, model.halfWidth + 13, 2, pos)
      sprite.position.copy(pos)
      out.push({ sprite, px: 20, maxSpan: 0, aspect: 96 / 68, anchor: { idx: 0, dir: 1, dist: model.halfWidth + 13, y: 2 } })
    }

    return out
  }, [model, circuit])

  useEffect(() => {
    return () => {
      for (const it of items) {
        it.sprite.material.map?.dispose()
        it.sprite.material.dispose()
      }
    }
  }, [items])

  const group = useRef<THREE.Group>(null)
  const tanV = useMemo(() => new THREE.Vector3(), [])
  const leftV = useMemo(() => new THREE.Vector3(), [])
  const upV = useMemo(() => new THREE.Vector3(0, 1, 0), [])

  useFrame((state) => {
    const density = useAppStore.getState().density
    const zoom = Math.max(state.camera.zoom, 1e-6)
    const span = Math.min(state.size.width, state.size.height) / zoom
    // furniture belongs to the map reading, not the cinema
    const visible = density >= 1
    // chips ride the road: they slide outward exactly with the widened
    // deck, so at macro zoom they frame the ribbon instead of floating
    // on top of it
    const g = sceneRefs.widthGain.value
    const n = model.n
    for (const it of items) {
      const show = visible && (it.maxSpan === 0 || span < it.maxSpan)
      it.sprite.visible = show
      if (!show) continue
      const h = it.px / zoom
      it.sprite.scale.set(h * it.aspect, h, 1)
      const a = it.anchor
      const nx = model.points[((a.idx + 1) % n) * 3] - model.points[((a.idx - 1 + n) % n) * 3]
      const nz = model.points[((a.idx + 1) % n) * 3 + 2] - model.points[((a.idx - 1 + n) % n) * 3 + 2]
      tanV.set(nx, 0, nz).normalize()
      leftV.crossVectors(upV, tanV).normalize()
      const dist = a.dist + (g - 1) * model.halfWidth
      it.sprite.position.set(
        model.points[a.idx * 3] + leftV.x * dist * -a.dir,
        model.points[a.idx * 3 + 1] + a.y,
        model.points[a.idx * 3 + 2] + leftV.z * dist * -a.dir,
      )
    }
  })

  return (
    <group ref={group}>
      {items.map((it, i) => (
        <primitive key={i} object={it.sprite} />
      ))}
    </group>
  )
}
