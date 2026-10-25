/* ============================================================
   The circuit as a data canvas — PORCELAIN edition. One dark
   graphite ribbon inlaid on the white plinth, like ink on
   paper. Per-vertex attributes carry braking heat, sector
   index, corner-kerb presence and rubber wear; uniforms carry
   live state (flag pulses, wetness).

   It runs on a patched MeshStandardMaterial rather than a raw
   unlit shader: the ink colors are still painted procedurally
   (grain, ember heat, kerb stripes, checkered start/finish,
   rubbered-in racing line), but lighting, tone mapping, real
   car shadows and the wet-season specular sheen now come from
   the gallery light rig for free.
   ============================================================ */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SessionData } from '../data/types'
import type { TrackModel } from './trackBuilder'
import { buildDrsZones } from './drsZones'
import { sceneRefs } from './sceneRefs'
import { raceClock } from '../engine/RaceClock'

/** sRGB-authored palette, converted to linear working space by THREE.Color.
    Values are pre-lifted: under the physically-based rig (diffuse/π) these
    albedos land at the PORCELAIN intent — graphite ink ~75–90 sRGB on top
    faces, whites ~170–185, against a plinth at ~220. */
const C = {
  baseDry: new THREE.Color('#6e7682'), // graphite asphalt
  baseWet: new THREE.Color('#4a5468'), // darkened, cooled
  ember: new THREE.Color('#a83f2b'), // braking heat laid into the surface
  kerbRed: new THREE.Color('#c4453a'), // corner kerb stripes (muted F1 red)
  kerbWhite: new THREE.Color('#dfe4ea'),
  lineWhite: new THREE.Color('#dfe4ea'), // edge line where there's no corner
  amber: new THREE.Color('#f0a512'), // local yellow
  redFlag: new THREE.Color('#b4231e'), // red-flag wash
  ink: new THREE.Color('#171c24'), // checker dark square
  checkWhite: new THREE.Color('#d5dbe3'),
}

const fragNoise = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
`

export function TrackRibbon({ model, session }: { model: TrackModel; session: SessionData }) {
  const { geometry, material, uniforms, drs } = useMemo(() => {
    const n = model.n
    const hw = model.halfWidth
    const positions = new Float32Array(n * 2 * 3)
    const aSide = new Float32Array(n * 2)
    const aBrake = new Float32Array(n * 2)
    const aSector = new Float32Array(n * 2)
    const aArc = new Float32Array(n * 2)
    const aKerb = new Float32Array(n * 2)
    const aLine = new Float32Array(n * 2)
    // reconstruction channels for the zoom-aware width patch: the vertex
    // shader rebuilds x/z from center + lateral normal, so uWidthGain can
    // inflate the road without touching the baked buffer
    const aC = new Float32Array(n * 2 * 3)
    const aN = new Float32Array(n * 2 * 2)
    const up = new THREE.Vector3(0, 1, 0)
    const tangent = new THREE.Vector3()
    const normal = new THREE.Vector3()

    // ember normalization: raw brakeHeat is a field-wide spread, and
    // painting it straight meant most of the ribbon glowed. Only the top
    // few percent of braking zones should ever catch fire — remap so
    // p85 heat is cold and p98 is white-hot
    const heatSorted = Float32Array.from(model.brakeHeat).sort()
    const hq = (p: number) => heatSorted[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))]
    const hLo = hq(0.85)
    const hHi = Math.max(hq(0.98), hLo + 0.02)

    // corner runs: kerbs live where the centerline is turning. half-length
    // ~ arc through the corner (angle × typical radius) plus a lead-in.
    const kerb = new Float32Array(n)
    const M_PER_PT = model.length / n
    for (const c of model.corners) {
      const half = Math.min(240, Math.abs(c.angle) * 95 + 18)
      const reach = Math.ceil((half * 1.2) / M_PER_PT)
      for (let k = -reach; k <= reach; k++) {
        const i = (((c.idx + k) % n) + n) % n
        const wrap = Math.abs(k) * M_PER_PT
        const w = Math.max(0, 1 - Math.max(0, wrap - half * 0.55) / (half * 0.6))
        if (w > kerb[i]) kerb[i] = Math.min(1, w)
      }
    }

    for (let i = 0; i < n; i++) {
      const i3 = i * 3
      const nx = model.points[((i + 1) % n) * 3] - model.points[((i - 1 + n) % n) * 3]
      const nz = model.points[((i + 1) % n) * 3 + 2] - model.points[((i - 1 + n) % n) * 3 + 2]
      tangent.set(nx, 0, nz).normalize()
      normal.crossVectors(up, tangent).normalize()

      const px = model.points[i3]
      const py = model.points[i3 + 1] + 0.05
      const pz = model.points[i3 + 2]
      positions[i * 6 + 0] = px + normal.x * hw
      positions[i * 6 + 1] = py
      positions[i * 6 + 2] = pz + normal.z * hw
      positions[i * 6 + 3] = px - normal.x * hw
      positions[i * 6 + 4] = py
      positions[i * 6 + 5] = pz - normal.z * hw

      const heatRaw = model.brakeHeat[i]
      const hn = Math.min(1, Math.max(0, (heatRaw - hLo) / (hHi - hLo)))
      const heat = hn * hn * (3 - 2 * hn) // smoothstep: ember only near the very top
      const k = kerb[i]
      const line = Math.min(1, 0.35 + 0.65 * heatRaw + 0.25 * k)
      aSide[i * 2] = -1
      aSide[i * 2 + 1] = 1
      aBrake[i * 2] = heat
      aBrake[i * 2 + 1] = heat
      aSector[i * 2] = model.sectorOf[i]
      aSector[i * 2 + 1] = model.sectorOf[i]
      aArc[i * 2] = model.cumDist[i]
      aArc[i * 2 + 1] = model.cumDist[i]
      aKerb[i * 2] = k
      aKerb[i * 2 + 1] = k
      aLine[i * 2] = line
      aLine[i * 2 + 1] = line
      for (const v of [0, 1]) {
        aC[i * 6 + v * 3] = px
        aC[i * 6 + v * 3 + 1] = py
        aC[i * 6 + v * 3 + 2] = pz
        aN[i * 4 + v * 2] = normal.x
        aN[i * 4 + v * 2 + 1] = normal.z
      }
    }

    // DRS zones, read from where the field actually ran with the wing open
    const drs = buildDrsZones(session, model)

    const indices = new Uint32Array(n * 6)
    for (let i = 0; i < n; i++) {
      const a = i * 2
      const b = i * 2 + 1
      const c = ((i + 1) % n) * 2
      const d = ((i + 1) % n) * 2 + 1
      indices[i * 6 + 0] = a
      indices[i * 6 + 1] = b
      indices[i * 6 + 2] = c
      indices[i * 6 + 3] = b
      indices[i * 6 + 4] = d
      indices[i * 6 + 5] = c
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 2 * 3).fill(0).map((_, idx) => (idx % 3 === 1 ? 1 : 0)), 3))
    geometry.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1))
    geometry.setAttribute('aBrake', new THREE.BufferAttribute(aBrake, 1))
    geometry.setAttribute('aSector', new THREE.BufferAttribute(aSector, 1))
    geometry.setAttribute('aArc', new THREE.BufferAttribute(aArc, 1))
    geometry.setAttribute('aKerb', new THREE.BufferAttribute(aKerb, 1))
    geometry.setAttribute('aLine', new THREE.BufferAttribute(aLine, 1))
    geometry.setAttribute('aC', new THREE.BufferAttribute(aC, 3))
    geometry.setAttribute('aN', new THREE.BufferAttribute(aN, 2))
    geometry.setAttribute('aDrs', new THREE.BufferAttribute(drs.mask, 1))
    geometry.setIndex(new THREE.BufferAttribute(indices, 1))
    geometry.computeBoundingSphere()

    const uniforms = {
      uTime: { value: 0 },
      uSectorPulse: { value: new THREE.Vector3(0, 0, 0) },
      uWet: { value: 0 },
      uRed: { value: 0 },
      uHeatGain: { value: 1 },
      uDrsActive: { value: 0 },
      uDrsGreen: { value: new THREE.Color('#0a9e5f') },
      uBaseDry: { value: C.baseDry },
      uBaseWet: { value: C.baseWet },
      uEmber: { value: C.ember },
      uKerbRed: { value: C.kerbRed },
      uKerbWhite: { value: C.kerbWhite },
      uLineWhite: { value: C.lineWhite },
      uAmber: { value: C.amber },
      uRedFlag: { value: C.redFlag },
      uInk: { value: C.ink },
      uCheckWhite: { value: C.checkWhite },
      uLength: { value: model.length },
      uHalfWidth: { value: model.halfWidth },
      // shared channel, not a copy: apron, walls, gantry, marshals and
      // trails all read this exact object, so the road and everything
      // clipped to it inflate as one model
      uWidthGain: sceneRefs.widthGain,
    }

    // Patched standard material: we paint diffuseColor procedurally and
    // let the gallery rig handle lighting, shadows and the wet sheen.
    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.88,
      metalness: 0.02,
      side: THREE.DoubleSide,
    })
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
            attribute float aSide;
            attribute float aBrake;
            attribute float aSector;
            attribute float aArc;
            attribute float aKerb;
            attribute float aLine;
            attribute vec3 aC;   // centerline anchor
            attribute vec2 aN;   // lateral normal
            attribute float aDrs; // 1 inside a DRS zone (derived from telemetry)
            uniform float uHalfWidth;
            uniform float uWidthGain;
            varying float vSide;
            varying float vBrake;
            varying float vSector;
            varying float vArc;
            varying float vKerb;
            varying float vLine;
            varying float vDrs;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vSide = aSide;
            vBrake = aBrake;
            vSector = aSector;
            vArc = aArc;
            vKerb = aKerb;
            vLine = aLine;
            vDrs = aDrs;
            // zoom-aware model-kit width: rebuild the lateral offset from
            // the centerline so the road can swell as the camera pulls out
            transformed.x = aC.x + aN.x * aSide * uHalfWidth * uWidthGain;
            transformed.z = aC.z + aN.y * aSide * uHalfWidth * uWidthGain;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform float uTime;
          uniform vec3 uSectorPulse;
          uniform float uWet;
          uniform float uRed;
          uniform float uHeatGain;
          uniform float uDrsActive;
          uniform vec3 uDrsGreen;
          uniform vec3 uBaseDry;
          uniform vec3 uBaseWet;
          uniform vec3 uEmber;
          uniform vec3 uKerbRed;
          uniform vec3 uKerbWhite;
          uniform vec3 uLineWhite;
          uniform vec3 uAmber;
          uniform vec3 uRedFlag;
          uniform vec3 uInk;
          uniform vec3 uCheckWhite;
          uniform float uLength;
          uniform float uHalfWidth;
          uniform float uWidthGain;
          varying float vSide;
          varying float vBrake;
          varying float vSector;
          varying float vArc;
          varying float vKerb;
          varying float vLine;
          varying float vDrs;
          ${fragNoise}`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
            vec3 col = vec3(1.0);
            float et = clamp(abs(vSide), 0.0, 1.0);

            // graphite asphalt; darkens and cools when wet. As the road
            // swells to model-kit width for a wide shot, it also deepens
            // toward ink — at map distance the circuit must read as a
            // drawn line on porcelain, not fade into the paper
            vec3 base = mix(uBaseDry, uBaseWet, uWet);
            base = mix(base, uInk * 1.9, clamp((uWidthGain - 1.5) / 1.5, 0.0, 1.0) * 0.55);

            // grain: fine speckle + larger mottling, stable along the surface
            float gn1 = hash21(vec2(floor(vArc / 0.9), floor(et * 22.0)));
            float gn2 = hash21(floor(vec2(vArc / 11.0, et * 5.0)) * 1.37);
            col *= base * (0.82 + 0.30 * gn1 + 0.10 * (gn2 - 0.5) * 2.0);

            // rubbered-in racing line: the field lays dark rubber down where
            // it brakes, turns and drives hardest
            float lineMask = 1.0 - smoothstep(0.08, 0.5, et);
            col *= mix(1.0, 0.58, vLine * lineMask);

            // braking heat: an ember stain laid into the racing line where
            // the field actually slows. Normalized on the CPU to the top
            // braking zones and centerline-weighted here — effort, not a
            // paint spill across the whole ribbon
            float ember = clamp(vBrake * uHeatGain, 0.0, 1.0) * (1.0 - 0.55 * et);
            col = mix(col, uEmber, ember * 0.32);

            // sector caution: an amber wash breathing over the affected sector
            float sp = vSector < 0.5 ? uSectorPulse.x : (vSector < 1.5 ? uSectorPulse.y : uSectorPulse.z);
            col = mix(col, uAmber, sp * (0.20 + 0.10 * sin(uTime * 4.0)));

            // edges: crisp white line, or painted red/white kerbs in corners
            float edge = smoothstep(0.87, 0.94, et);
            float kerbBand = smoothstep(0.80, 0.88, et) * vKerb;
            vec3 plainLine = mix(uLineWhite, uAmber, min(sp * 1.4, 1.0));
            float stripe = step(0.5, mod(floor((vArc + 3.0) / 6.0), 2.0));
            vec3 kerbCol = mix(uKerbWhite, uKerbRed, stripe);
            col = mix(col, plainLine, edge * (1.0 - vKerb));
            col = mix(col, kerbCol, kerbBand);

            // DRS zones: a green line laid along both edges where the field
            // actually runs with the wing open — quiet ink-green while the
            // zone waits, bright timing-green while wings are live
            float drsEdge = smoothstep(0.90, 0.955, et) * vDrs;
            vec3 drsCol = mix(vec3(0.18, 0.42, 0.28), uDrsGreen, uDrsActive);
            col = mix(col, drsCol, drsEdge * (0.55 + 0.45 * uDrsActive));

            // start/finish: a checkered band across the full width
            float dSF = min(vArc, uLength - vArc);
            float sf = 1.0 - smoothstep(1.1, 2.3, dSF);
            float cell = step(0.5, mod(floor(vArc / 1.15) + floor((et + 1.0) * uHalfWidth / 1.15), 2.0));
            col = mix(col, mix(uInk, uCheckWhite, cell), sf);

            // red flag — the circuit itself is suspended
            col = mix(col, uRedFlag, uRed * (0.5 + 0.10 * sin(uTime * 2.2)));

            diffuseColor = vec4(col, diffuseColor.a);`,
        )
    }
    // keep patched programs distinct from any other standard material
    material.customProgramCacheKey = () => 'apex-ribbon'

    return { geometry, material, uniforms, drs }
  }, [model, session])

  useEffect(() => {
    sceneRefs.ribbonMat = { uniforms }
    return () => {
      sceneRefs.ribbonMat = null
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material, uniforms])

  // wetness drives the physical sheen, not a painted shimmer: rain soaks
  // the roughness down so the key light and gallery env streak across it
  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime
    material.roughness = THREE.MathUtils.lerp(0.88, 0.26, uniforms.uWet.value)
    material.metalness = THREE.MathUtils.lerp(0.02, 0.18, uniforms.uWet.value)

    // DRS: the zone lines breathe with how much of the field has the wing
    // open right now — derived live from the panel drsZones samples
    const active = drs.activationAt(raceClock.t)
    uniforms.uDrsActive.value += (active - uniforms.uDrsActive.value) * Math.min(1, dt * 6)

    // zoom-aware model-kit width — the single writer of widthGain.
    // A real track at gallery distance collapses under a pixel; model
    // kits fix this by lying about scale, so the road keeps at least
    // ~22 px of read at any framing, capped at 3.4× so corners never
    // merge into a single blob
    const zoom = Math.max(state.camera.zoom, 1e-6)
    const roadPx = 2 * model.halfWidth * zoom
    const target = THREE.MathUtils.clamp(22 / Math.max(roadPx, 0.01), 1, 3.4)
    const g = sceneRefs.widthGain
    g.value += (target - g.value) * Math.min(1, dt * 5)
  })

  return <mesh geometry={geometry} material={material} castShadow receiveShadow frustumCulled={false} />
}
