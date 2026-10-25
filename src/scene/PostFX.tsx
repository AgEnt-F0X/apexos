/* ============================================================
   Post pipeline — one hand-rolled pmndrs composer driven from a
   priority-1 useFrame, which takes rendering over from R3F:

     RenderPass → N8AOPostPass (half-res GTAO contact shadows)
     → EffectPass[ Khronos Neutral tone map + SMAA ULTRA ]

   Neutral lives here, not on the renderer, because three only
   tone-maps renders that go straight to the canvas — through a
   composer the final pass owns it.

   ADAPTIVE SHED LADDER. Quality must meet the GPU, not the demo
   machine: the tier is detected once (discrete vs integrated), the
   ladder starts accordingly, and a PerformanceMonitor walks it one
   rung per sustained decline — MSAA off, AO off, shadow map 2048 —
   and back up on sustained incline. The composer re-builds only
   when MSAA flips (buffer property, requires rebuild); AO sheds via
   pass.enabled, which costs nothing and recompiles nothing. The
   current rung is published on sceneRefs.quality.shed so the light
   rig can shed its shadow budget without prop drilling.

   The composer is re-sized from the renderer's drawing buffer, so
   DPR steps and window resizes can never desync its targets.
   compileAsync warms the shader programs once on mount.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { sceneRefs } from './sceneRefs'

/** discrete GPUs get the full ladder; integrated chips start one rung down */
function detectDiscreteGPU(gl: THREE.WebGLRenderer): boolean {
  try {
    const glc = gl.getContext()
    const ext = glc.getExtension('WEBGL_debug_renderer_info')
    const s = String(
      ext ? glc.getParameter(ext.UNMASKED_RENDERER_WEBGL) : glc.getParameter(glc.RENDERER),
    ).toLowerCase()
    return /nvidia|geforce|rtx|gtx|arc|radeon|apple\s*m\d/.test(s)
  } catch {
    return false
  }
}

export function PostFX() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const initLevel = useMemo(() => (detectDiscreteGPU(gl) ? 0 : 1), [gl])
  const [level, setLevel] = useState(initLevel)

  const composer = useMemo(() => {
    const composer = new EffectComposer(gl, {
      // integrated Intel drivers (ANGLE/D3D11) destabilize on HalfFloat
      // targets — the porcelain look is LDR anyway, so low tiers render
      // plain RGBA and only discrete GPUs get HDR headroom
      frameBufferType: initLevel === 0 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      multisampling: level === 0 ? 4 : 0, // SMAA covers level ≥ 1
    })
    composer.addPass(new RenderPass(scene, camera))

    const ao = new N8AOPostPass(scene, camera, size.width, size.height)
    ao.configuration.halfRes = true
    // cars are ~5.6 m, the visible diorama ~10²–10³ m: contact-shadow
    // scale sits two magnitudes down, per the n8ao rule of thumb
    ao.configuration.aoRadius = 3.0
    ao.configuration.distanceFalloff = 1.0
    ao.configuration.intensity = 1.6
    composer.addPass(ao)

    composer.addPass(
      new EffectPass(
        camera,
        new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
        new SMAAEffect({ preset: SMAAPreset.ULTRA }),
      ),
    )
    return { composer, aoPass: ao }
    // size is handled per-frame via drawing-buffer checks; rebuilding
    // on viewport change would thrash shader compiles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, level === 0])

  useEffect(() => () => composer.composer.dispose(), [composer])
  useEffect(() => {
    composer.aoPass.enabled = level < 2
  }, [composer, level])
  useEffect(() => {
    sceneRefs.quality.shed = level
  }, [level])

  // KHR_parallel_shader_compile warm-up + one silent settle render
  useEffect(() => {
    let alive = true
    gl.compileAsync(scene, camera)
      .catch(() => {})
      .then(() => {
        if (alive) composer.composer.render()
      })
    return () => {
      alive = false
    }
  }, [gl, scene, camera, composer])

  const bufSize = useMemo(() => new THREE.Vector2(), [])
  const drawn = useRef({ w: 0, h: 0 })
  useFrame(() => {
    gl.getDrawingBufferSize(bufSize)
    if (bufSize.x !== drawn.current.w || bufSize.y !== drawn.current.h) {
      drawn.current.w = bufSize.x
      drawn.current.h = bufSize.y
      composer.composer.setSize(size.width, size.height)
    }
    composer.composer.render()
  }, 1)

  return (
    <PerformanceMonitor
      onDecline={() => setLevel((l) => Math.min(3, l + 1))}
      onIncline={() => setLevel((l) => Math.max(initLevel, l - 1))}
      flipflops={3}
    />
  )
}
