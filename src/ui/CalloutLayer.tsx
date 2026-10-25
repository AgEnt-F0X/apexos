/* ============================================================
   CalloutLayer — the hairline annotation overlay.

   Ink hairlines that hang off a point on the diorama and end
   in a text chip. Where the 3D diorama renders the geometry,
   this layer speaks about the race: which car leads, which car
   you focused, corner apexes, sector gates, and track lineage.

   Anchors go through isoPlane against the frame CameraRig
   publishes each frame, so they are pixel-true with the canvas
   and never stale — re-anchoring is a pure function of camera
   plus race state, with no per-frame React state for numbers.

   The annotation grammar:
     · one hairline per subject, 1px, ink at low alpha
     · chips face the nearer frame edge, lines run outward
     · corner callouts draw leader lines directly to the apex
     · hover proximity highlights the corner name and apex
     · density-gated: BROADCAST (1) and ENGINEER (2)
     · never over the action: chips clamp to a safe margin
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { sceneRefs } from '../scene/sceneRefs'
import { isoProject } from '../scene/isoPlane'
import { raceClock } from '../engine/RaceClock'
import { makeCarSample, sampleCar } from '../engine/sampler'
import type { TrackModel } from '../scene/trackBuilder'

const SAFE = 12 // px chips clamp to inside the frame
const CHIP_W = 118
const CHIP_H = 32
const CHIP_OFF = 44 // px from the anchor to the chip's near edge

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
  monaco: [
    [0.06, 'STE DÉVOTE'],
    [0.21, 'BEAU RIVAGE'],
    [0.28, 'MASSENET'],
    [0.33, 'CASINO'],
    [0.42, 'MIRABEAU HAUTE'],
    [0.48, 'FAIRMONT HAIRPIN'],
    [0.54, 'MIRABEAU BAS'],
    [0.59, 'PORTIER'],
    [0.72, 'NOUVELLE CHICANE'],
    [0.78, 'TABAC'],
    [0.84, 'LOUIS CHIRON'],
    [0.91, 'PISCINE'],
    [0.96, 'RASCASSE'],
  ],
  spa: [
    [0.05, 'LA SOURCE'],
    [0.17, 'EAU ROUGE'],
    [0.21, 'RAIDILLON'],
    [0.32, 'KEMMEL'],
    [0.44, 'LES COMBES'],
    [0.48, 'MALMEDY'],
    [0.53, 'RIVAGE'],
    [0.65, 'POUHON'],
    [0.77, 'FAGNES'],
    [0.84, 'STAVELOT'],
    [0.91, 'BLANCHIMONT'],
    [0.96, 'BUS STOP'],
  ],
  silverstone: [
    [0.06, 'ABBEY'],
    [0.11, 'FARM'],
    [0.17, 'VILLAGE'],
    [0.22, 'THE LOOP'],
    [0.28, 'AINTREE'],
    [0.44, 'BROOKLANDS'],
    [0.5, 'LUFFIELD'],
    [0.55, 'WOODCOTE'],
    [0.62, 'COPSE'],
    [0.7, 'MAGGOTTS'],
    [0.74, 'BECKETTS'],
    [0.78, 'CHAPEL'],
    [0.85, 'HANGAR STRAIGHT'],
    [0.92, 'STOWE'],
    [0.97, 'CLUB'],
  ],
}

interface Callout {
  key: string
  /** world anchor on the paper plane */
  x: number
  z: number
  title: string
  detail: string
}

interface CornerAnnotation {
  number: number
  name: string
  apexX: number
  apexZ: number
  chipX: number
  chipZ: number
}

interface SectorGate {
  label: string
  innerX: number
  innerZ: number
  outerX: number
  outerZ: number
}

/** the subjects worth a hairline right now — pure function of race state */
function useCarCallouts(tick: number): Callout[] {
  const focusDriver = useAppStore((s) => s.focusDriver)
  const raceIndex = useAppStore((s) => s.raceIndex)
  const session = useAppStore((s) => s.session)
  return useMemo(() => {
    if (!session || !raceIndex) return []
    const out: Callout[] = []
    const t = raceClock.t
    const sample = makeCarSample()
    const name = (d: number) => session.drivers.find((x) => x.driver_number === d)?.name_acronym ?? `#${d}`
    const p = { x: 0, z: 0 }
    // the world mapping the diorama's own cars use (see CameraRig.carPos)
    const place = (d: number): boolean => {
      const ch = session.channels[d]
      if (!ch) return false
      sampleCar(ch, t, sample)
      if (!sample.valid) return false
      p.x = sample.x
      p.z = -sample.y
      return true
    }

    // 1. the leader — the race's headline, always worth naming
    const leader = raceIndex.leaderAt(t)
    if (leader !== null && place(leader)) {
      out.push({ key: `leader-${leader}`, x: p.x, z: p.z, title: name(leader), detail: 'LEADER' })
    }

    // 2. the focused car — the subject the user picked
    if (focusDriver !== null && focusDriver !== leader && place(focusDriver)) {
      out.push({ key: `focus-${focusDriver}`, x: p.x, z: p.z, title: name(focusDriver), detail: 'FOCUS' })
    }

    return out.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.z))
  }, [focusDriver, raceIndex, session, tick])
}

/** Prepares corner leader-line annotations from the track model */
function useCornerAnnotations(model: TrackModel | null, circuit: string): CornerAnnotation[] {
  return useMemo(() => {
    if (!model) return []
    const names = CORNER_NAMES[circuit.toLowerCase()] ?? []
    const n = model.n
    const out: CornerAnnotation[] = []

    for (const c of model.corners) {
      const idx = c.idx
      const pa = (((idx - 1 + n) % n) + n) % n
      const pb = (((idx + 1) % n) + n) % n
      const nx = model.points[pb * 3] - model.points[pa * 3]
      const nz = model.points[pb * 3 + 2] - model.points[pa * 3 + 2]
      const len = Math.hypot(nx, nz) || 1
      // normal vector pointing left in xz
      const latX = -nz / len
      const latZ = nx / len

      const apexX = model.points[idx * 3]
      const apexZ = model.points[idx * 3 + 2]

      // place corner label chip outward along corner direction
      const chipDist = model.halfWidth + 14
      const chipX = apexX + latX * chipDist * -c.dir
      const chipZ = apexZ + latZ * chipDist * -c.dir

      // check curated corner name
      let cornerName = ''
      for (const [param, nm] of names) {
        const d = Math.min(Math.abs(c.param - param), 1 - Math.abs(c.param - param))
        if (d < 0.045) {
          cornerName = nm
          break
        }
      }

      out.push({
        number: c.number,
        name: cornerName,
        apexX,
        apexZ,
        chipX,
        chipZ,
      })
    }
    return out
  }, [model, circuit])
}

/** Prepares sector gates (S1, S2, S3) and Start/Finish lines */
function useSectorGates(model: TrackModel | null): SectorGate[] {
  return useMemo(() => {
    if (!model) return []
    const out: SectorGate[] = []
    const n = model.n

    const gates = [
      { label: 'FINISH', param: 0 },
      { label: 'S2', param: model.sectorParam[1] },
      { label: 'S3', param: model.sectorParam[2] },
    ]

    for (const g of gates) {
      const idx = model.indexOfParam(g.param)
      const pa = (((idx - 1 + n) % n) + n) % n
      const pb = (((idx + 1) % n) + n) % n
      const nx = model.points[pb * 3] - model.points[pa * 3]
      const nz = model.points[pb * 3 + 2] - model.points[pa * 3 + 2]
      const len = Math.hypot(nx, nz) || 1
      const latX = -nz / len
      const latZ = nx / len

      const cx = model.points[idx * 3]
      const cz = model.points[idx * 3 + 2]
      const w = model.halfWidth + 1.2

      out.push({
        label: g.label,
        innerX: cx - latX * w,
        innerZ: cz - latZ * w,
        outerX: cx + latX * w,
        outerZ: cz + latZ * w,
      })
    }

    return out
  }, [model])
}

export function CalloutLayer() {
  const density = useAppStore((s) => s.density)
  const cameraMode = useAppStore((s) => s.cameraMode)
  const circuit = useAppStore((s) => s.session?.meta.circuit_short_name ?? '')
  const [tick, setTick] = useState(0)
  const callouts = useCarCallouts(tick)
  const model = sceneRefs.trackModel
  const corners = useCornerAnnotations(model, circuit)
  const sectorGates = useSectorGates(model)

  const [hoveredCorner, setHoveredCorner] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)

  // Listen to mouse pointer position for interactive proximity hover
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setPointer({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Synchronize with ortho camera changes and clock playback
  const lastId = useRef('')
  useEffect(() => {
    let raf = 0
    let alive = true
    const loop = () => {
      if (!alive) return
      const f = sceneRefs.isoFrame
      const clockQuant = raceClock.playing ? Math.floor(raceClock.t * 8) : Math.floor(raceClock.t * 2)
      if (f) {
        const id = `${f.az.toFixed(3)}|${f.cx.toFixed(1)}|${f.cz.toFixed(1)}|${f.zoom.toFixed(3)}|${f.width}x${f.height}|${f.elevation ?? 0}|${clockQuant}`
        if (id !== lastId.current) {
          lastId.current = id
          setTick((n) => n + 1)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  const frame = sceneRefs.isoFrame

  // Project car callouts
  const placedCars = useMemo(() => {
    if (!frame || callouts.length === 0) return []
    const w = frame.width
    const h = frame.height
    return callouts.map((c) => {
      const p = isoProject(frame, c.x, c.z)
      const flip = p.x < w / 2 // true → chip sits to the RIGHT of the anchor
      const cx = Math.min(Math.max(p.x + (flip ? CHIP_OFF : -CHIP_OFF - CHIP_W), SAFE), Math.max(SAFE, w - SAFE - CHIP_W))
      const cy = Math.min(Math.max(p.y - CHIP_H / 2, SAFE), Math.max(SAFE, h - SAFE - CHIP_H))
      return { c, p, cx, cy }
    })
  }, [frame, callouts])

  // Project corner apex leader-lines and chips
  const placedCorners = useMemo(() => {
    if (!frame || corners.length === 0) return []
    return corners.map((cr) => {
      const apexP = isoProject(frame, cr.apexX, cr.apexZ)
      const chipP = isoProject(frame, cr.chipX, cr.chipZ)

      // Calculate proximity to cursor
      let hovered = false
      if (pointer) {
        const dChip = Math.hypot(pointer.x - chipP.x, pointer.y - chipP.y)
        const dApex = Math.hypot(pointer.x - apexP.x, pointer.y - apexP.y)
        if (dChip < 32 || dApex < 24) hovered = true
      }

      return {
        ...cr,
        apexP,
        chipP,
        hovered,
      }
    })
  }, [frame, corners, pointer])

  // Project sector gate lines
  const placedGates = useMemo(() => {
    if (!frame || sectorGates.length === 0) return []
    return sectorGates.map((g) => {
      const p1 = isoProject(frame, g.innerX, g.innerZ)
      const p2 = isoProject(frame, g.outerX, g.outerZ)
      return { ...g, p1, p2 }
    })
  }, [frame, sectorGates])

  if (density < 1 || cameraMode === 'anatomy' || !frame) return null

  return (
    <svg className="callouts" width={frame.width} height={frame.height} aria-hidden="true">
      {/* 1. Sector Gates & Start/Finish hairline markers across the track */}
      {placedGates.map((g, i) => (
        <g key={`gate-${i}`} className="callout__gate">
          <line
            className="callout__gate-line"
            x1={g.p1.x.toFixed(2)}
            y1={g.p1.y.toFixed(2)}
            x2={g.p2.x.toFixed(2)}
            y2={g.p2.y.toFixed(2)}
          />
          <circle className="callout__gate-dot" cx={g.p2.x.toFixed(2)} cy={g.p2.y.toFixed(2)} r={2} />
          <text
            className="callout__gate-text mono"
            x={(g.p2.x + 6).toFixed(2)}
            y={(g.p2.y + 3).toFixed(2)}
          >
            {g.label}
          </text>
        </g>
      ))}

      {/* 2. Corner apex hairline leader-lines and interactive chips */}
      {placedCorners.map((cr) => {
        const isHovered = cr.hovered || hoveredCorner === cr.number
        return (
          <g
            key={`corner-${cr.number}`}
            className={`callout__corner ${isHovered ? 'is-active' : ''}`}
            onMouseEnter={() => setHoveredCorner(cr.number)}
            onMouseLeave={() => setHoveredCorner(null)}
            style={{ pointerEvents: 'auto' }}
          >
            {/* Hairline connecting corner label chip to apex */}
            <line
              className={`callout__corner-line ${isHovered ? 'is-hovered' : ''}`}
              x1={cr.chipP.x.toFixed(2)}
              y1={cr.chipP.y.toFixed(2)}
              x2={cr.apexP.x.toFixed(2)}
              y2={cr.apexP.y.toFixed(2)}
            />

            {/* Apex indicator on track surface */}
            <circle
              className={`callout__apex-dot ${isHovered ? 'is-hovered' : ''}`}
              cx={cr.apexP.x.toFixed(2)}
              cy={cr.apexP.y.toFixed(2)}
              r={isHovered ? 3.5 : 2}
            />

            {/* Corner chip badge, hover ring & curated name badge */}
            <g transform={`translate(${cr.chipP.x.toFixed(2)},${cr.chipP.y.toFixed(2)})`}>
              <circle
                className={`callout__chip-bg ${isHovered ? 'is-hovered' : ''}`}
                r={9}
              />
              <text
                className="callout__chip-num mono"
                y={0.5}
              >
                {cr.number}
              </text>
              {isHovered && (
                <circle
                  className="callout__chip-ring"
                  r={15}
                />
              )}
              {isHovered && cr.name && (
                <g transform="translate(16, 0)">
                  <rect className="callout__name-bg" x={-3} y={-9} width={cr.name.length * 6.8 + 12} height={16} rx={3} />
                  <text className="callout__name mono" x={3} y={2.5}>
                    {cr.name}
                  </text>
                </g>
              )}
            </g>
          </g>
        )
      })}

      {/* 3. Car Callouts (Leader & Focused car) */}
      {placedCars.map(({ c, p, cx, cy }) => (
        <g key={c.key} className="callout">
          <path
            className="callout__line"
            d={`M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${cx.toFixed(2)} ${(cy + 8).toFixed(2)}`}
          />
          <circle className="callout__dot" cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={2.4} />
          <g transform={`translate(${cx.toFixed(2)},${(cy - 8).toFixed(2)})`}>
            <rect className="callout__box" width={CHIP_W} height={CHIP_H} rx={3} />
            <text className="callout__t" x={9} y={14}>
              {c.title}
            </text>
            <text className="callout__d" x={9} y={26}>
              {c.detail}
            </text>
          </g>
        </g>
      ))}
    </svg>
  )
}
