/* ============================================================
   Circuit geometry cache — resolution order:
     1. static snapshot  /tracks/<key>.json   (shipped, instant)
     2. fresh extrusion from the session's telemetry (always works)
   A known circuit therefore costs zero extrusion time on load,
   and an unknown one still builds itself from data — no hard
   dependency on a build step.
   ============================================================ */

import type { SessionData } from './types'
import { buildTrackModel, modelFromCached, serializeTrackModel, type CachedTrackGeometry, type TrackModel } from '../scene/trackBuilder'

export const trackKeyOf = (shortName: string): string =>
  shortName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** in-memory memo so multiple components never re-resolve */
const memo = new Map<string, Promise<TrackModel>>()

async function tryStatic(key: string): Promise<TrackModel | null> {
  try {
    const res = await fetch(`/tracks/${key}.json`)
    if (!res.ok) return null
    const g = (await res.json()) as CachedTrackGeometry
    if (g.v !== 1 || !Array.isArray(g.points) || g.points.length < 6) return null
    return modelFromCached(g)
  } catch {
    return null // dev server without the file, offline, malformed — fall through
  }
}

/**
 * Resolve the TrackModel for a session. Never throws unless the
 * session genuinely lacks extrudable telemetry (same contract as
 * buildTrackModel).
 */
export async function resolveTrackModel(data: SessionData): Promise<TrackModel> {
  const key = trackKeyOf(data.meta.circuit_short_name)
  let p = memo.get(key)
  if (!p) {
    p = (async () => {
      const cached = await tryStatic(key)
      if (cached) return cached
      return buildTrackModel(data)
    })()
    memo.set(key, p)
  }
  return p
}

/** Serialize + hand back the JSON text for `public/tracks/<key>.json` (build script uses this). */
export function exportTrackJson(data: SessionData, model: TrackModel): string {
  const g = serializeTrackModel(model, trackKeyOf(data.meta.circuit_short_name), data.meta.session_key)
  return JSON.stringify(g)
}
