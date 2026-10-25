// ambient types for n8ao (ships untyped as of 2.0.1)
declare module 'n8ao' {
  import type { Pass } from 'postprocessing'
  import type { Camera, Color, Scene } from 'three'

  export interface N8AOConfiguration {
    /** world-unit radius of the occlusion spread */
    aoRadius: number
    distanceFalloff: number
    intensity: number
    color: Color
    /** render AO buffers at half resolution (2–4× faster, depth-aware upscaled) */
    halfRes: boolean
    /** temporal accumulation while the camera is still — smears moving objects */
    accumulate: boolean
    aoSamples: number
    denoiseSamples: number
    denoiseRadius: number
    depthAwareUpsampling: boolean
    screenSpaceRadius: boolean
    gammaCorrection: boolean
    accuracy: number
    dilate: number
  }

  export class N8AOPass extends Pass {
    configuration: N8AOConfiguration
    constructor(scene: Scene, camera: Camera, width: number, height: number)
  }

  /** variant for pmndrs/postprocessing pipelines: requires a RenderPass before it */
  export class N8AOPostPass extends Pass {
    configuration: N8AOConfiguration
    constructor(scene: Scene, camera: Camera, width: number, height: number)
  }
}
