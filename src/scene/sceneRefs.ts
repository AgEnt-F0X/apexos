/* ============================================================
   Mutable cross-component scene handles. Frame-rate systems
   (flags, weather, focus) reach materials directly through here
   instead of routing 60 fps data through React.
   ============================================================ */

import type * as THREE from 'three'
import type { CarSample } from '../engine/sampler'
import type { BrakeReadout, DrsReadout, PuReadout, TyreReadout, PartKey } from './anatomyModel'
import type { IsoFrame } from './isoPlane'

export interface RibbonHandle {
  uniforms: {
    uTime: THREE.IUniform<number>
    uSectorPulse: THREE.IUniform<THREE.Vector3>
    uWet: THREE.IUniform<number>
    uRed: THREE.IUniform<number>
    uHeatGain: THREE.IUniform<number>
  }
}

/** The anatomy car's derived readouts — every number the HUD shows comes
    from anatomyModel's pure functions applied to the live sample, so the
    displayed value can never disagree with the part it describes. */
export interface AnatomyReadout {
  driver: number
  brake: BrakeReadout
  drs: DrsReadout
  pu: PuReadout
  tyre: TyreReadout
}

export interface SceneRefs {
  ribbonMat: RibbonHandle | null
  /** smoothed rainfall 0..1, written by LiveOps, read by rain FX */
  wet: { value: number }
  /** world-space position of the current camera look target (for HUD projections) */
  focusWorld: THREE.Vector3 | null
  /** model-kit width exaggeration: the road scales up as the camera pulls
      out so it never collapses under a pixel. Written once per frame by
      TrackRibbon (which owns the camera reading); every road-coupled
      system — apron, walls, gantry, marshals, trails — shares this exact
      uniform object so they can never drift apart */
  widthGain: { value: number }
  /** post-pipeline shed rung, written by PostFX's PerformanceMonitor:
      0 full · 1 no MSAA · 2 no AO · 3 + reduced shadow budget. Read by
      the light rig to trade shadow-map texels for frames when needed */
  quality: { shed: number }
  /** the anatomy car's live sample, written by AnatomyCar each frame
      (the single source for the anatomy HUD readout) */
  anatomySample: CarSample | null
  /** the anatomy car's derived readouts (brake/drs/pu/tyre), written by
      AnatomyCar each frame — the HUD reads these, never recomputes */
  anatomyReadout: AnatomyReadout | null
  /** which anatomy part the pointer last pressed, for the HUD hint line */
  anatomyPart: PartKey | null
  /** the pointer click that triggered the current frame, for the dblclick hit test */
  anatomyEntryPoint: THREE.Vector2 | null
  /** camera mode value before anatomy mode; restored on Escape */
  anatomyPrevMode: string | null
  /** current camera mode mirrored for frame systems that need it without React */
  cameraMode: string
  /** the live ortho rig frame, written each frame by CameraRig and read by
      the DOM callout layer so SVG hairlines project with the camera */
  isoFrame: IsoFrame | null
  /** resolved track model cached for the overlay layer */
  trackModel: import('./trackBuilder').TrackModel | null
  /** raking workshop inspection light active */
  workshopLight: boolean
}

export const sceneRefs: SceneRefs = {
  ribbonMat: null,
  wet: { value: 0 },
  focusWorld: null,
  widthGain: { value: 1 },
  quality: { shed: 0 },
  anatomySample: null,
  anatomyReadout: null,
  anatomyPart: null,
  anatomyEntryPoint: null,
  anatomyPrevMode: null,
  cameraMode: 'director',
  isoFrame: null,
  trackModel: null,
  workshopLight: false,
}
