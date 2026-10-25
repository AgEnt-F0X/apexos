/* ============================================================
   DRS zones, derived from the field's own telemetry.
   No track-model file carries zone extents — but the cars tell
   us: over a whole session, the stations where the drs channel
   reports an open wing at speed ARE the zones. One pass over
   the packs maps activations to track stations through a coarse
   spatial hash, then a mask is thresholded against the busiest
   station and cleaned of speckle. Works identically on real and
   simulated packs.
   ============================================================ */

import type { SessionData } from '../data/types'
import { isDrsOpen } from '../data/types'
import type { TrackModel } from './trackBuilder'

/** Minimum speed (km/h) for an activation to count as a zone sample —
    the wing codes flip in slow corners during test modes. */
const MIN_KMH = 170
/** A station is in a zone when its activation count reaches this share
    of the busiest station's count */
const THRESHOLD = 0.35
/** Zone masks shorter than this many stations are speckle */
const MIN_RUN = 8

export interface DrsZones {
  /** per station: 1 = inside a DRS zone */
  mask: Uint8Array
  /** fraction of sampled cars with an open wing right now (0..1) */
  activationAt(t: number): number
}

export function buildDrsZones(session: SessionData, model: TrackModel): DrsZones {
  const n = model.n
  const counts = new Float32Array(n)

  // spatial hash: 3 m cells → station index (first station in the cell wins;
  // collisions only smear by one station, harmless at this resolution)
  const CELL = 3
  const grid = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const x = model.points[i * 3]
    const z = model.points[i * 3 + 2]
    const key = (Math.floor(x / CELL) + 4096) * 8192 + (Math.floor(z / CELL) + 4096)
    if (!grid.has(key)) grid.set(key, i)
  }

  let max = 0
  for (const ch of Object.values(session.channels)) {
    const stride = ch.hz >= 4 ? 2 : 1 // sample every ~0.4 s — zones are long
    for (let i = 0; i < ch.n; i += stride) {
      if (!isDrsOpen(ch.drs[i]) || ch.speed[i] < MIN_KMH) continue
      const key =
        (Math.floor(ch.x[i] / CELL) + 4096) * 8192 + (Math.floor(-ch.y[i] / CELL) + 4096)
      const st = grid.get(key)
      if (st === undefined) continue
      counts[st]++
      if (counts[st] > max) max = counts[st]
    }
  }

  // threshold + close single-station holes, then drop short runs
  const hot = max > 0
  const raw = new Uint8Array(n)
  if (hot) for (let i = 0; i < n; i++) raw[i] = counts[i] >= max * THRESHOLD ? 1 : 0
  const mask = new Uint8Array(n)
  if (hot) {
    // close gaps of <= 2 stations inside runs
    let runStart = -1
    for (let i = 0; i <= n; i++) {
      const v = i < n ? raw[i] : 0
      if (v === 1 && runStart < 0) runStart = i
      if (v === 0 && runStart >= 0) {
        let end = i - 1
        // look ahead: a short gap continues the run
        let j = i
        while (j < n && j - i <= 2 && raw[j] === 0) j++
        if (j < n && raw[j] === 1 && j - i <= 2) {
          continue // the run keeps going after the gap
        }
        if (end - runStart + 1 >= MIN_RUN) for (let k = runStart; k <= end; k++) mask[k] = 1
        runStart = -1
      }
    }
  }

  // live activation: the share of a small panel of cars with an open wing
  const panel = Object.values(session.channels).slice(0, 8)
  const activationAt = (t: number): number => {
    if (panel.length === 0) return 0
    let open = 0
    for (const ch of panel) {
      const i = Math.min(ch.n - 1, Math.max(0, Math.round((t - ch.t0) * ch.hz)))
      if (isDrsOpen(ch.drs[i])) open++
    }
    return open / panel.length
  }

  return { mask, activationAt }
}
