/* ============================================================
   The field: one InstancedMesh triplet (pawn token / diorama
   wedge / close-up detail), 20 cars driven directly by telemetry
   every frame. Per-instance attributes: team color + live state
   (brake, throttle, DRS, focus) feed the shader — brake lights
   and DRS glow are data, not art.

   THE MORPH: pull the camera out and the field condenses from
   detailed cars into turned model-kit pawns — solid-team tokens
   with a brake flash — the way a board game packs its pieces.
   Lean in and they turn back. Crossfaded by continuous scale so
   no seam shows.

   THE TRAIL: every car drags a short ribbon of its own ink —
   team-coloured, head-bright and fading, laid into the deck and
   washed away by rain. Recent history, painted by the field.

   THE QUIET GRID: tags are a scarce resource. One pass projects
   every candidate chip to screen space and packs them — the
   focused car and the race leader eat first, podium next, the
   rest only get ink where nothing already sits.

   The body runs on a patched MeshStandardMaterial: albedo zones
   (livery flood, spine stripe, smoked cockpit, tire sidewalls,
   focus recede) are painted procedurally, but light, tone
   mapping and the shadow the car drops onto the asphalt come
   from the gallery rig.
   ============================================================ */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { SessionData } from '../data/types'
import { raceClock } from '../engine/RaceClock'
import { makeCarSample, sampleCar } from '../engine/sampler'
import { useAppStore } from '../state/appStore'
import { getCarGeometry, getPawnGeometry } from './carGeometry'
import { makeMiniTagTexture, makeTagTexture } from './tagTexture'
import { sceneRefs } from './sceneRefs'
import type { TrackModel } from './trackBuilder'

const ALBEDO = {
  porcelain: new THREE.Color('#e8edf1'),
  cockpit: new THREE.Color('#3d424a'),
  tireDark: new THREE.Color('#22262b'),
  recede: new THREE.Color('#e2e6ea'),
}
const LIGHTS = {
  brake: new THREE.Color('#f2090a'),
  drs: new THREE.Color('#12a35a'),
}

const TRAIL_CAP = 40 // ring points per car
const TRAIL_SEGS = TRAIL_CAP - 1
const TRAIL_STEP = 0.65 // race-seconds between trail pins
const TRAIL_HALF_W = 0.95 // meters either side of the centerline
const TRAIL_FADE = 0.55 // head alpha
const LABEL_CELL_W = 46 // screen px — one chip's worth of quiet grid
const LABEL_CELL_H = 22

export function Cars({ session, model }: { session: SessionData; model: TrackModel }) {
  const drivers = useMemo(
    () => session.drivers.filter((d) => session.channels[d.driver_number]),
    [session],
  )
  const count = drivers.length
  const focusDriver = useAppStore((s) => s.focusDriver)
  const focusRef = useRef<number | null>(null)
  focusRef.current = focusDriver

  const {
    meshLo, meshHi, meshPawn, material, pawnMat, uniforms, stateAttr, tireAttr, tags,
    spinAttr, heatAttr,
    trailMesh, trailGeo, trailMat, trailPts, trailCount, trailHead, trailLast,
  } = useMemo(() => {
    const geoLo = getCarGeometry(false).clone()
    const geoHi = getCarGeometry(true).clone()
    const geoPawn = getPawnGeometry().clone()

    const team = new Float32Array(count * 3)
    const color = new THREE.Color()
    drivers.forEach((d, i) => {
      color.set(`#${d.team_colour || '9aa7b8'}`)
      team[i * 3] = color.r
      team[i * 3 + 1] = color.g
      team[i * 3 + 2] = color.b
    })
    const state = new Float32Array(count * 4)
    const stateAttr = new THREE.InstancedBufferAttribute(state, 4)
    stateAttr.setUsage(THREE.DynamicDrawUsage)
    // per-instance wheel dynamics: spin angle (rad) + front-wheel steer (rad).
    // Kept as a SEPARATE attribute from aState so the vec4 (brake, throttle,
    // drs, focus) layout — which the focus-recede logic reads — never shifts.
    const spin = new Float32Array(count * 2)
    const spinAttr = new THREE.InstancedBufferAttribute(spin, 2)
    spinAttr.setUsage(THREE.DynamicDrawUsage)
    // per-instance tire heat 0..1 (brake-accumulated); drives the hot-tire glow
    const heat = new Float32Array(count)
    const heatAttr = new THREE.InstancedBufferAttribute(heat, 1)
    heatAttr.setUsage(THREE.DynamicDrawUsage)
    const tire = new Float32Array(count * 2).fill(5) // compound UNKNOWN
    const tireAttr = new THREE.InstancedBufferAttribute(tire, 2)
    tireAttr.setUsage(THREE.DynamicDrawUsage)
    const teamAttr = new THREE.InstancedBufferAttribute(team, 3)
    for (const g of [geoLo, geoHi]) {
      g.setAttribute('aTeam', teamAttr)
      g.setAttribute('aState', stateAttr)
      g.setAttribute('aTire', tireAttr)
      g.setAttribute('aSpin', spinAttr)
      g.setAttribute('aHeat', heatAttr)
    }
    geoPawn.setAttribute('aTeam', teamAttr)
    geoPawn.setAttribute('aState', stateAttr)

    const material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.52,
      metalness: 0.14,
    })
    const uniforms = {
      uPiece: { value: 0 },
      uPorcelain: { value: ALBEDO.porcelain },
      uCockpit: { value: ALBEDO.cockpit },
      uTireDark: { value: ALBEDO.tireDark },
      uRecede: { value: ALBEDO.recede },
      uBrakeLight: { value: LIGHTS.brake },
      uDrsLight: { value: LIGHTS.drs },
      uCompound: {
        value: [
          new THREE.Color('#e10600'), // soft
          new THREE.Color('#d7a300'), // medium
          new THREE.Color('#454e5a'), // hard
          new THREE.Color('#1e9e50'), // intermediate
          new THREE.Color('#1f72d8'), // wet
          new THREE.Color('#9aa4b0'), // unknown
        ],
      },
    }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
            attribute vec3 aTeam;
            attribute vec4 aState; // brake, throttle, drs, focus
            attribute vec2 aTire;  // compoundId, ageFrac
            attribute vec2 aSpin;  // wheel spin angle, front steer angle
            attribute float aHeat; // tire heat 0..1
            attribute float aDark;
            varying vec3 vTeam;
            varying vec4 vState;
            varying vec2 vTire;
            varying float vDark;
            varying float vHeat;
            varying vec3 vLocal;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vTeam = aTeam;
            vState = aState;
            vTire = aTire;
            vDark = aDark;
            vHeat = aHeat;
            vLocal = position;
            // wheels really roll: rubber vertices (aDark≈1) spin about the
            // local Z axle by the accumulated angle; front wheels also yaw by
            // the steer angle. aSpin = (spinAngle, steerAngle)
            float isWheel = step(0.9, aDark);
            float isFront = step(vLocal.x, 0.0); // front wheels sit at +x
            float ang = aSpin.x;
            float steer = aSpin.y * isFront * isWheel;
            vec3 wp = position;
            // steer first (yaw the whole wheel about its own up axis), then roll
            float cs = cos(steer); float ss = sin(steer);
            wp = vec3(cs * wp.x + ss * wp.z, wp.y, -ss * wp.x + cs * wp.z);
            float cr = cos(ang * isWheel); float sr = sin(ang * isWheel);
            wp = vec3(cr * wp.x - sr * wp.y, sr * wp.x + cr * wp.y, wp.z);
            // DRS flap: the rear-wing upper flap physically lifts about its
            // leading edge when the wing is open (x in [-2.45,-2.2], y > 0.88)
            float drsFlap = step(vLocal.x, -2.2) * step(0.88, vLocal.y) * step(vLocal.x, -2.45);
            float dAng = drsFlap * aState.z * (-0.12);
            float hx = -2.32; float hy = 0.88;
            float fdx = wp.x - hx; float fdy = wp.y - hy;
            float fc = cos(dAng); float fs = sin(dAng);
            wp.xy = vec2(hx + fc * fdx - fs * fdy, hy + fs * fdx + fc * fdy);
            transformed.xyz = wp;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
            uniform float uPiece;
            uniform vec3 uPorcelain;
            uniform vec3 uCockpit;
            uniform vec3 uTireDark;
            uniform vec3 uRecede;
            uniform vec3 uBrakeLight;
            uniform vec3 uDrsLight;
            uniform vec3 uCompound[6];
            varying vec3 vTeam;
            varying vec4 vState;
            varying vec2 vTire;
            varying float vDark;
            varying float vHeat;
            varying vec3 vLocal;`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
            // porcelain body; the livery is a team-color spine stripe.
            // at diorama zoom the whole body floods team color — a map
            // marker, readable from across the room
            vec3 col = mix(uPorcelain, vTeam, uPiece);
            float stripe = step(0.46, vLocal.y) * step(abs(vLocal.z), 0.50) * (1.0 - step(0.9, vDark));
            col = mix(col, vTeam, stripe * 0.92);
            // cockpit / diffuser / halo stay smoked
            col = mix(col, uCockpit, step(0.4, vDark) * (1.0 - step(0.8, vDark)));
            // wheels: dark rubber with the compound as sidewall, aging to grey
            float wheelZone = step(0.9, vDark);
            vec3 tireCol = mix(uCompound[int(vTire.x + 0.5)], vec3(0.42, 0.44, 0.47), vTire.y * 0.75);
            col = mix(col, mix(uTireDark, tireCol, 0.55), wheelZone);
            // rim faces flood team color at any zoom — the alloy is livery
            col = mix(col, vTeam, step(0.75, vDark) * (1.0 - step(0.9, vDark)));
            // brake / rain light block reads red-lit while braking
            float brakeZone = step(vLocal.x, -2.55) * step(0.14, vLocal.y) * step(abs(vLocal.z), 0.18);
            col = mix(col, uBrakeLight, brakeZone * vState.x * 0.9);
            // DRS open: the rear wing plate flips to green
            float drsZone = step(vLocal.x, -2.15) * step(0.62, vLocal.y);
            col = mix(col, uDrsLight, drsZone * vState.z * 0.9);
            // focus grammar on white: the field recedes toward porcelain,
            // the chosen car keeps full ink
            float recede = (1.0 - step(0.9, vState.w)) * step(vState.w, 0.05);
            col = mix(col, uRecede, recede * 0.62);
            col *= 1.0 + step(0.9, vState.w) * 0.05;
            diffuseColor = vec4(col, diffuseColor.a);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
            float bz = step(vLocal.x, -2.55) * step(0.14, vLocal.y) * step(abs(vLocal.z), 0.18);
            totalEmissiveRadiance += uBrakeLight * bz * vState.x * 1.4;
            float dz = step(vLocal.x, -2.15) * step(0.62, vLocal.y);
            totalEmissiveRadiance += uDrsLight * dz * vState.z * 0.25;
            // power unit warms under throttle — the engine-cover spine glows
            // amber while on power (iso-glow: switched-on glows, reserved)
            float pu = step(0.40, vLocal.y) * step(vLocal.y, 0.72)
                     * step(abs(vLocal.z), 0.26) * step(-1.55, vLocal.x) * step(vLocal.x, 0.45);
            totalEmissiveRadiance += vec3(0.85, 0.42, 0.10) * pu * vState.y * 0.30;
            // hot tire: the sidewall glows its compound colour once heat-soaked
            float hot = smoothstep(0.62, 0.85, vHeat) * step(0.9, vDark);
            totalEmissiveRadiance += uCompound[int(vTire.x + 0.5)] * hot * 0.55;`,
        )
      material.customProgramCacheKey = () => 'apex-cars'
    }

    // --- the pawn: a turned token, team-bright, smoke foot, brake tail ---
    const pawnMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, metalness: 0.12 })
    const pawnUniforms = {
      uPorcelain: { value: ALBEDO.porcelain },
      uRecede: { value: ALBEDO.recede },
      uBrakeLight: { value: LIGHTS.brake },
    }
    pawnMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, pawnUniforms)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
            attribute vec3 aTeam;
            attribute vec4 aState;
            attribute float aDark;
            varying vec3 vTeam;
            varying vec4 vState;
            varying float vDark;`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
            vTeam = aTeam;
            vState = aState;
            vDark = aDark;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
            uniform vec3 uPorcelain;
            uniform vec3 uRecede;
            uniform vec3 uBrakeLight;
            varying vec3 vTeam;
            varying vec4 vState;
            varying float vDark;`,
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
            vec3 col = mix(uPorcelain, vTeam, 0.88); // the token IS the team
            col = mix(col, vec3(0.16, 0.18, 0.22), step(0.4, vDark) * (1.0 - step(0.7, vDark)) * 0.8);
            float recede = (1.0 - step(0.9, vState.w)) * step(vState.w, 0.05);
            col = mix(col, uRecede, recede * 0.55);
            col *= 1.0 + step(0.9, vState.w) * 0.06;
            diffuseColor = vec4(col, diffuseColor.a);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
            float bz = step(0.25, vDark) * (1.0 - step(0.35, vDark));
            totalEmissiveRadiance += uBrakeLight * bz * vState.x * 1.6;`,
        )
      pawnMat.customProgramCacheKey = () => 'apex-pawn'
    }

    const meshLo = new THREE.InstancedMesh(geoLo, material, count)
    const meshHi = new THREE.InstancedMesh(geoHi, material, count)
    const meshPawn = new THREE.InstancedMesh(geoPawn, pawnMat, count)
    for (const m of [meshLo, meshHi, meshPawn]) {
      m.frustumCulled = false
      m.castShadow = true
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }
    meshHi.visible = false
    meshPawn.visible = false

    // --- ink trails: one indexed strip per car, vertex-alpha drained
    //     by age, tinted by team, washed by rain ---
    const trailPos = new Float32Array(count * TRAIL_SEGS * 4 * 3)
    const trailCol = new Float32Array(count * TRAIL_SEGS * 4 * 4)
    const trailIdx = new Uint16Array(count * TRAIL_SEGS * 6)
    for (let i = 0; i < count; i++) {
      for (let s = 0; s < TRAIL_SEGS; s++) {
        const b = (i * TRAIL_SEGS + s) * 4
        const o = (i * TRAIL_SEGS + s) * 6
        trailIdx[o] = b
        trailIdx[o + 1] = b + 1
        trailIdx[o + 2] = b + 2
        trailIdx[o + 3] = b + 1
        trailIdx[o + 4] = b + 3
        trailIdx[o + 5] = b + 2
      }
      // bake the team tint; alpha rides in the same 4-comp color attribute
      for (let v = 0; v < TRAIL_SEGS * 4; v++) {
        const c = (i * TRAIL_SEGS * 4 + v) * 4
        trailCol[c] = team[i * 3]
        trailCol[c + 1] = team[i * 3 + 1]
        trailCol[c + 2] = team[i * 3 + 2]
        trailCol[c + 3] = 0
      }
    }
    const trailGeo = new THREE.BufferGeometry()
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage))
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4).setUsage(THREE.DynamicDrawUsage))
    trailGeo.setIndex(new THREE.BufferAttribute(trailIdx, 1))
    trailGeo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(model.center[0], 0, model.center[2]),
      model.radius * 1.3 + 200,
    )
    const trailMat = new THREE.MeshBasicMaterial({
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const trailMesh = new THREE.Mesh(trailGeo, trailMat)
    trailMesh.frustumCulled = false
    trailMesh.renderOrder = 4
    trailMesh.visible = false
    const trailPts = Array.from({ length: count }, () => new Float32Array(TRAIL_CAP * 3))
    const trailCount = new Int32Array(count)
    const trailHead = new Int32Array(count)
    const trailLast = new Float32Array(count).fill(-1e9)

    // name tags: constant screen-size sprites above each car.
    // full chip for close zoom, acronym-only mini for the wide diorama.
    const tags = drivers.map((d) => {
      const color = `#${d.team_colour || '9aa7b8'}`
      const acr = d.name_acronym || String(d.driver_number)
      const full = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeTagTexture(acr, d.driver_number, color),
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      )
      full.renderOrder = 10
      const mini = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeMiniTagTexture(acr, color),
          depthTest: false,
          transparent: true,
          opacity: 0.92,
        }),
      )
      mini.renderOrder = 10
      return { full, mini }
    })

    return {
      meshLo, meshHi, meshPawn, material, pawnMat, uniforms, stateAttr, tireAttr, tags,
      spinAttr, heatAttr,
      trailMesh, trailGeo, trailMat, trailPts, trailCount, trailHead, trailLast,
    }
  }, [drivers, count, model])

  useEffect(
    () => () => {
      meshLo.geometry.dispose()
      meshHi.geometry.dispose()
      meshPawn.geometry.dispose()
      material.dispose()
      pawnMat.dispose()
      trailGeo.dispose()
      trailMat.dispose()
      for (const t of tags) {
        t.full.material.map?.dispose()
        t.full.material.dispose()
        t.mini.material.map?.dispose()
        t.mini.material.dispose()
      }
    },
    [meshLo, meshHi, meshPawn, material, pawnMat, trailGeo, trailMat, tags],
  )

  // anatomy entry: double-click a car's tag → focus it + cut to the cutaway.
  // (Dblclick → raycast handled by Theatre's AnatomyShell below, so this
  // component keeps out of the bundle-hot path entirely.)
  // (this useFrame is at the end of the render loop — placed into a later section if needed)

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const sample = useMemo(() => makeCarSample(), [])
  const projV = useMemo(() => new THREE.Vector3(), [])
  const lastTireT = useRef(-1e9)
  const prevT = useRef(-1e9)
  // wheel dynamics state (per car): accumulated spin, last heading, smoothed steer, heat
  const spinAngle = useRef<Float32Array>(new Float32Array(count))
  const prevHeading = useRef<Float32Array>(new Float32Array(count).fill(NaN))
  const steerSm = useRef<Float32Array>(new Float32Array(count))
  const heatVal = useRef<Float32Array>(new Float32Array(count))
  const lastFrameT = useRef(-1e9)

  const COMPOUND_ID: Record<string, number> = useMemo(
    () => ({ SOFT: 0, MEDIUM: 1, HARD: 2, INTERMEDIATE: 3, WET: 4 }),
    [],
  )

  useFrame((state) => {
    const t = raceClock.t
    const focus = focusRef.current
    const { density, raceIndex } = useAppStore.getState()
    // orthographic constant-screen-size tags: world size = px / zoom
    const zoom = Math.max(state.camera.zoom, 1e-6)
    const tagH = 30 / zoom
    const tagW = tagH * (192 / 72)
    // how many world-meters fit across the smaller viewport dimension
    const span = Math.min(state.size.width, state.size.height) / zoom
    // wide shots: game pieces — cars swell so they never drop below ~13px
    const carScale = Math.max(1, 13 / (5.6 * zoom))
    // and flood to solid team color as they shrink toward map markers
    uniforms.uPiece.value = THREE.MathUtils.clamp((carScale - 1) / 1.8, 0, 0.88)

    // --- the morph: past the board-game line, cars condense into pawns
    // on a continuous scale ramp, so there is no visible swap frame ---
    const pawnK = THREE.MathUtils.clamp((carScale - 1.9) / 1.2, 0, 1)
    const pawnOn = pawnK > 0.02
    const pawnScale = carScale * (0.55 + 0.45 * pawnK)
    meshPawn.visible = pawnOn
    const hiNow = density > 0 && span < 460 && !pawnOn
    meshHi.visible = hiNow
    meshLo.visible = !hiNow && !pawnOn
    const active = hiNow ? meshHi : meshLo

    const fullTags = density > 0 && span < 460
    const miniTags = density > 0 && span >= 460
    const miniH = 19 / zoom
    const miniW = miniH * (104 / 44)

    // trails: ink only reads where the deck does — off for the deep-plate
    const trailOn = span < 2000
    trailMesh.visible = trailOn
    if (Math.abs(t - prevT.current) > 3) {
      // scrubbed or seeked: the old ink belonged to another moment
      trailCount.fill(0)
      trailLast.fill(-1e9)
    }
    prevT.current = t

    // tire compound/age changes at pit-stop cadence — refresh every 2s of race time
    if (Math.abs(t - lastTireT.current) > 2) {
      lastTireT.current = t
      if (raceIndex) {
        for (let i = 0; i < count; i++) {
          const d = drivers[i].driver_number
          const stint = raceIndex.stintAt(d, raceIndex.lapOf(d, t))
          tireAttr.array[i * 2] = stint ? (COMPOUND_ID[stint.compound] ?? 5) : 5
          tireAttr.array[i * 2 + 1] = stint ? Math.min(1, stint.age / 32) : 0
        }
        tireAttr.needsUpdate = true
      }
    }

    const leader = raceIndex ? raceIndex.leaderAt(t) : null
    const labelCand: Array<{ i: number; pri: number; pos: number }> = []

    for (let i = 0; i < count; i++) {
      const d = drivers[i]
      const ch = session.channels[d.driver_number]
      sampleCar(ch, t, sample)
      const tag = tags[i]
      if (!sample.valid) {
        dummy.position.set(0, -100, 0)
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        active.setMatrixAt(i, dummy.matrix)
        if (pawnOn) meshPawn.setMatrixAt(i, dummy.matrix)
        tag.full.visible = false
        tag.mini.visible = false
        continue
      }
      const wy = sample.z - model.elevationBase
      dummy.position.set(sample.x, wy + 0.05, -sample.y)
      dummy.rotation.set(0, sample.heading, 0)
      dummy.scale.setScalar(carScale)
      dummy.updateMatrix()
      active.setMatrixAt(i, dummy.matrix)
      if (pawnOn) {
        dummy.scale.setScalar(pawnScale)
        dummy.updateMatrix()
        meshPawn.setMatrixAt(i, dummy.matrix)
      }

      // trail pins arrive at a fixed race-time cadence
      if (trailOn && t - trailLast[i] >= TRAIL_STEP) {
        trailHead[i] = (trailHead[i] + 1) % TRAIL_CAP
        const h3 = trailHead[i] * 3
        const pts = trailPts[i]
        pts[h3] = sample.x
        pts[h3 + 1] = wy + 0.14
        pts[h3 + 2] = -sample.y
        trailLast[i] = t
        if (trailCount[i] < TRAIL_CAP) trailCount[i]++
      }

      const isFocus = focus === d.driver_number
      tag.full.visible = (fullTags || (isFocus && density > 0)) && !(miniTags && !isFocus)
      tag.mini.visible = miniTags && !isFocus
      const tagY = wy + 4.2 * carScale + 2
      if (tag.full.visible) {
        tag.full.scale.set(tagW, tagH, 1)
        tag.full.position.set(sample.x, tagY, -sample.y)
      }
      if (tag.mini.visible) {
        tag.mini.scale.set(miniW, miniH, 1)
        tag.mini.position.set(sample.x, tagY, -sample.y)
      }
      if (tag.full.visible || tag.mini.visible) {
        const pos = raceIndex ? raceIndex.positionOf(d.driver_number, t) ?? 99 : 99
        const pri = isFocus ? 0 : leader === d.driver_number ? 1 : pos <= 3 ? 2 : 3
        labelCand.push({ i, pri, pos })
      }

      const s = i * 4
      stateAttr.array[s] = sample.brake / 100
      stateAttr.array[s + 1] = sample.throttle / 100
      stateAttr.array[s + 2] = sample.drsOpen ? 1 : 0
      stateAttr.array[s + 3] = focus === d.driver_number ? 1 : focus === null ? 0.15 : 0

      // --- wheel dynamics: integrate spin from speed, steer from heading
      //     rate, heat from brake history. dt is RACE-time advance per frame
      //     (clamped so a scrub/jump never flings the wheels), so spin stays
      //     correct at every playback rate — the wheels roll at the speed the
      //     race clock says the car is going, not the wall clock. ---
      // scene wheel radius matches the geometry's rubber radius (0.34 m)
      const WHEEL_R = 0.34
      const dt = Math.min(0.25, Math.max(0, t - lastFrameT.current))
      lastFrameT.current = t
      // sample.velocity is m/s → rad/s about the axle
      spinAngle.current[i] += (sample.velocity / WHEEL_R) * dt
      // steer: heading rate → target angle, low-pass smoothed, clamped
      const ph = prevHeading.current[i]
      let steerTarget = 0
      if (Number.isFinite(ph) && dt > 1e-4) {
        let dh = sample.heading - ph
        dh = Math.atan2(Math.sin(dh), Math.cos(dh))
        steerTarget = THREE.MathUtils.clamp(dh / dt * 0.12, -0.5, 0.5)
      }
      prevHeading.current[i] = sample.heading
      steerSm.current[i] += (steerTarget - steerSm.current[i]) * Math.min(1, dt * 8)
      // heat: rises with braking, cools otherwise, clamped 0..1
      const hv = heatVal.current[i]
      heatVal.current[i] = THREE.MathUtils.clamp(
        hv + (sample.brake / 100) * dt * 0.5 - dt * 0.08,
        0,
        1,
      )
      spinAttr.array[i * 2] = spinAngle.current[i]
      spinAttr.array[i * 2 + 1] = steerSm.current[i]
      heatAttr.array[i] = heatVal.current[i]
    }
    active.instanceMatrix.needsUpdate = true
    if (pawnOn) meshPawn.instanceMatrix.needsUpdate = true
    stateAttr.needsUpdate = true
    spinAttr.needsUpdate = true
    heatAttr.needsUpdate = true

    // --- drain the ink: rebuild every ribbon strip newest → oldest ---
    if (trailOn) {
      trailMat.opacity = (density === 0 ? 0.45 : 1) * (1 - 0.7 * sceneRefs.wet.value)
      const posAttr = trailGeo.getAttribute('position') as THREE.BufferAttribute
      const colAttr = trailGeo.getAttribute('color') as THREE.BufferAttribute
      const P = posAttr.array as Float32Array
      const A = colAttr.array as Float32Array
      const fade = (k: number) => TRAIL_FADE * Math.pow(Math.max(0, 1 - k / TRAIL_SEGS), 1.6)
      for (let i = 0; i < count; i++) {
        const pts = trailPts[i]
        const cnt = trailCount[i]
        const head = trailHead[i]
        const base = i * TRAIL_SEGS * 4
        const putV = (v: number, x: number, y: number, z: number, a: number) => {
          const p = (base + v) * 3
          P[p] = x
          P[p + 1] = y
          P[p + 2] = z
          A[(base + v) * 4 + 3] = a
        }
        const tailK = (((head - Math.max(0, cnt - 1)) % TRAIL_CAP) + TRAIL_CAP) % TRAIL_CAP
        for (let s = 0; s < TRAIL_SEGS; s++) {
          if (s + 1 >= cnt) {
            // beyond the ink: collapse to the tail point, fully transparent
            const k = cnt === 0 ? head : tailK
            const x = pts[k * 3]
            const y = pts[k * 3 + 1]
            const z = pts[k * 3 + 2]
            putV(0, x, y, z, 0)
            putV(1, x, y, z, 0)
            putV(2, x, y, z, 0)
            putV(3, x, y, z, 0)
            continue
          }
          const k0 = (((head - s) % TRAIL_CAP) + TRAIL_CAP) % TRAIL_CAP
          const k1 = (((head - s - 1) % TRAIL_CAP) + TRAIL_CAP) % TRAIL_CAP
          const p0x = pts[k0 * 3]
          const p0y = pts[k0 * 3 + 1]
          const p0z = pts[k0 * 3 + 2]
          const p1x = pts[k1 * 3]
          const p1y = pts[k1 * 3 + 1]
          const p1z = pts[k1 * 3 + 2]
          const a0 = fade(s)
          const a1 = fade(s + 1)
          const dx = p0x - p1x
          const dz = p0z - p1z
          const len = Math.hypot(dx, dz)
          if (len > 1e-4) {
            const sw = TRAIL_HALF_W / len
            const sx = dz * sw
            const sz = -dx * sw
            putV(0, p0x + sx, p0y, p0z + sz, a0)
            putV(1, p0x - sx, p0y, p0z - sz, a0)
            putV(2, p1x + sx, p1y, p1z + sz, a1)
            putV(3, p1x - sx, p1y, p1z - sz, a1)
          } else {
            putV(0, p0x, p0y, p0z, a0)
            putV(1, p0x, p0y, p0z, a0)
            putV(2, p1x, p1y, p1z, a1)
            putV(3, p1x, p1y, p1z, a1)
          }
        }
      }
      posAttr.needsUpdate = true
      colAttr.needsUpdate = true
    }

    // --- the quiet grid: pack chips in screen space. Focus eats first,
    //     then the leader, then the podium, then whoever fits; a chip
    //     with no free cell lifts a notch or stays silent this frame ---
    if (labelCand.length > 1 && density > 0) {
      labelCand.sort((a, b) => a.pri - b.pri || a.pos - b.pos)
      const occupied = new Set<number>()
      const cellWorldH = LABEL_CELL_H / zoom
      for (const c of labelCand) {
        const tag = tags[c.i]
        const spr = tag.full.visible ? tag.full : tag.mini
        projV.copy(spr.position)
        projV.project(state.camera)
        const px = (projV.x * 0.5 + 0.5) * state.size.width
        const py = (1 - (projV.y * 0.5 + 0.5)) * state.size.height
        const cx = Math.round(px / LABEL_CELL_W)
        let cy = Math.round(py / LABEL_CELL_H)
        let lift = -1
        for (let up = 0; up < 3; up++) {
          const key = (cy - up) * 8192 + cx
          if (!occupied.has(key)) {
            occupied.add(key)
            lift = up
            break
          }
        }
        if (lift < 0) {
          tag.full.visible = false
          tag.mini.visible = false
        } else if (lift > 0) {
          spr.position.y += cellWorldH * lift
        }
      }
    }
  })

  return (
    <group>
      <primitive object={trailMesh} />
      <primitive object={meshLo} />
      <primitive object={meshHi} />
      <primitive object={meshPawn} />
      {tags.map((t, i) => (
        <group key={drivers[i].driver_number}>
          <primitive object={t.full} />
          <primitive object={t.mini} />
        </group>
      ))}
    </group>
  )
}
