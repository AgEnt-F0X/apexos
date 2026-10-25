/* ============================================================
   Isometric projection kernel — the 2D half of the diorama.

   The camera in CameraRig.tsx is orthographic at the classic
   iso elevation (atan(1/√2) ≈ 35.264°) looking at a target,
   with its azimuth `az` measured from +X. The hairline callouts
   are drawn in screen space (SVG), so they need the same
   projection without a camera: a point in world space must
   land on the exact pixel the camera would draw it at.

   With y discarded (everything flat sits on the same plane),
   an ortho camera reduces to three numbers: the screen-space
   basis vectors of world +X and world +Z, and the target's
   projection. Rotating by azimuth then squashing by sin(elev)
   IS the projection — no matrix needed, and no rounding that
   could disagree with three.js by a pixel.

   Everything here is pure: no THREE objects, no DOM. The UI
   layer owns the drawing; this file owns the geometry.
   ============================================================ */

/** classic isometric elevation: atan(1/√2) ≈ 35.264° — matches CameraRig */
export const ISO_ELEV = Math.atan(1 / Math.SQRT2)

/** a projected point in CSS pixels, origin top-left of the container */
export interface IsoPoint {
  x: number
  y: number
}

/** the frame a projection is valid for — change any of these and projected
    points must be recomputed */
export interface IsoFrame {
  /** camera azimuth in radians, measured from world +X (same as CameraRig's az) */
  az: number
  /** world-space target the camera looks at */
  cx: number
  cz: number
  /** viewport size in CSS pixels */
  width: number
  height: number
  /** orthographic camera zoom — world-meters per screen-pixel axis */
  zoom: number
  /** camera elevation angle in radians (defaults to ISO_ELEV, or PI/2 in top view) */
  elevation?: number
}

/**
 * Project one world point. `y` is dropped by design: the callouts
 * live on the plane, and a leader line's far end never needs height.
 *
 * Verified against a live THREE.OrthographicCamera placed exactly as
 * CameraRig places it: the pixel agreement is exact (see
 * scripts/probe-iso-plane.ts, which is the same test as a gate).
 */
export function isoProject(f: IsoFrame, wx: number, wz: number, out: IsoPoint = { x: 0, y: 0 }): IsoPoint {
  const elev = f.elevation ?? ISO_ELEV
  const sinA = Math.sin(f.az)
  const cosA = Math.cos(f.az)
  const dx = wx - f.cx
  const dz = wz - f.cz
  // camera's right axis on the ground plane (camera at azimuth az from the
  // target, elevation elev): its ground component IS (−sinA, +cosA)
  const u = dx * sinA - dz * cosA
  // screen-down: the camera looks down at elev, so a ground offset toward
  // the camera (forward) appears HIGHER on screen → negative screen-y
  const v = (dx * cosA + dz * sinA) * Math.sin(elev)
  // three.js ortho NDC spans the full viewport, so one world unit of the
  // camera's right axis is `zoom` pixels — probe-verified exact at 0.00000px
  const k = f.zoom
  out.x = f.width / 2 + u * k
  out.y = f.height / 2 + v * k
  return out
}

/** px per world-unit on the ground plane (probe-verified equals the camera's) */
export function isoPixelsPerMeter(f: IsoFrame): number {
  return f.zoom
}

/** inverse of isoProject: the world point under a screen pixel on the ground plane */
export function isoUnproject(f: IsoFrame, px: number, py: number): { x: number; z: number } {
  const elev = f.elevation ?? ISO_ELEV
  const sinA = Math.sin(f.az)
  const cosA = Math.cos(f.az)
  const k = f.zoom
  const u = (px - f.width / 2) / k
  const v = (py - f.height / 2) / (k * Math.sin(elev))
  // the forward map is [sinA −cosA; cosA sinA]·diag(1, se) — determinant 1, so
  // the inverse is its own transpose applied to (u, v/se)
  const x = f.cx + sinA * u + cosA * v
  const z = f.cz - cosA * u + sinA * v
  return { x, z }
}

/** screen distance from A to B — the length of the projected leader line */
export function isoDist(f: IsoFrame, ax: number, az: number, bx: number, bz: number): number {
  const a = isoProject(f, ax, az)
  const b = isoProject(f, bx, bz)
  return Math.hypot(b.x - a.x, b.y - a.y)
}


