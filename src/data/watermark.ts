/* ============================================================
   Watermark sync — per-table high-water marks (PLAN §1.2).

   Every table fetch remembers the newest `date` row it saw.
   Incremental refreshes then query `date>` the watermark
   instead of refetching whole ranges — and this is the exact
   primitive Live mode (Phase 5) polls with: append new rows
   past the watermark, advance it, roll tMax forward.

   Storage: localStorage, namespaced, best-effort — a lost
   watermark only means one full refetch, never corruption.

   Honesty rules:
   - rows without a `date` field never bump a watermark
   - a watermark only ever moves FORWARD
   - ages are informational (Pipeline Health gauges later)
   ============================================================ */

const NS = 'wm:'

function key(endpoint: string, scope: string): string {
  return `${NS}${endpoint}:${scope}`
}

/** newest `date` ever stored for this endpoint+scope, or null */
export function getWatermark(endpoint: string, scope: string): string | null {
  try {
    return localStorage.getItem(key(endpoint, scope))
  } catch {
    return null
  }
}

/** advance the watermark to the newest `date` found in these rows (forward-only) */
export function bumpWatermark(
  endpoint: string,
  scope: string,
  rows: ReadonlyArray<{ date?: string | null }>,
): void {
  let max: string | null = null
  for (const r of rows) {
    const d = r?.date
    if (typeof d === 'string' && (max === null || d > max)) max = d
  }
  if (max === null) return
  try {
    const k = key(endpoint, scope)
    const cur = localStorage.getItem(k)
    if (!cur || max > cur) localStorage.setItem(k, max)
  } catch {
    /* best effort — storage full or unavailable */
  }
}

/** params merged with an incremental `date>` filter when a watermark exists */
export function sinceWatermark(
  endpoint: string,
  scope: string,
  params: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> {
  const wm = getWatermark(endpoint, scope)
  return wm ? { ...params, 'date>': wm } : { ...params }
}

/** ms elapsed since the watermarked date (null = no/invalid watermark) */
export function watermarkAge(endpoint: string, scope: string): number | null {
  const wm = getWatermark(endpoint, scope)
  if (!wm) return null
  const ms = Date.parse(wm)
  return Number.isFinite(ms) ? Date.now() - ms : null
}
