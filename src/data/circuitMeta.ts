/* ============================================================
   F1 Connect / f1api.dev source — circuit metadata enrichment.

   Narrow by policy. This API overlaps Jolpica on almost every-
   thing; the one thing it uniquely gives is per-circuit lore:
   lap record + holder, corner count, length, first GP year.
   That feeds the lap-record explorer, dossier context chips and
   X-ray plaques. Never load-bearing: every call degrades to null.
   ============================================================ */

const BASE = 'https://f1api.dev/api'

export interface CircuitMeta {
  /** f1api.dev id, e.g. "monza" */
  circuitId: string
  circuitName: string
  country: string
  city: string
  circuitLengthKm: number | null
  lapRecord: string | null
  lapRecordHolder: string | null
  firstParticipationYear: number | null
  corners: number | null
}

interface F1ApiRace {
  raceName?: string
  /** NOTE: f1api.dev uses a LOWERCASE `circuit` key — unlike Ergast's `Circuit` */
  circuit?: {
    circuitId?: string
    circuitName?: string
    country?: string
    city?: string
    /** flat string, meters concatenated: "5278km" = 5.278 km */
    circuitLength?: string
    /** flat string, colon-separated millis: "1:19:813" = 1:19.813 */
    lapRecord?: string
    firstParticipationYear?: number
    corners?: number
    /** record holder as a driver ID slug ("leclerc", "max_verstappen") */
    fastestLapDriverId?: string
  }
}

// OpenF1 `circuit_short_name` slug → f1api.dev circuitId where slugs diverge.
// (Lookup direction: OUR slug is the key, THEIR id is the value.)
const ALIASES: Record<string, string> = {
  las_vegas: 'vegas',
  s_o_paulo: 'interlagos',
  monte_carlo: 'monaco',
  roval: 'charlotte', // unused guard — documented example of the mapping direction
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

let cache: Map<string, CircuitMeta> | null = null
let inflight: Promise<Map<string, CircuitMeta>> | null = null

async function loadAll(): Promise<Map<string, CircuitMeta>> {
  if (cache) return cache
  if (!inflight) {
    inflight = (async () => {
      const map = new Map<string, CircuitMeta>()
      try {
        const res = await fetch(`${BASE}/current`)
        if (res.ok) {
          const json = (await res.json()) as { races?: F1ApiRace[] } & F1ApiRace
          // /current may nest circuits under each race of the season
          for (const r of json.races ?? []) {
            const c = r.circuit
            if (!c?.circuitId) continue
            map.set(c.circuitId.toLowerCase(), {
              circuitId: c.circuitId,
              circuitName: c.circuitName ?? c.circuitId,
              country: c.country ?? '',
              city: c.city ?? '',
              circuitLengthKm: parseKm(c.circuitLength),
              lapRecord: normalizeLapRecord(c.lapRecord),
              lapRecordHolder: c.fastestLapDriverId
                ? c.fastestLapDriverId.replace(/_/g, ' ').toUpperCase()
                : null,
              firstParticipationYear: c.firstParticipationYear ?? null,
              corners: typeof c.corners === 'number' ? c.corners : null,
            })
          }
        }
      } catch (err) {
        console.warn('[circuitMeta] f1api.dev unreachable — running without lore', err)
      }
      // a failed/empty pull is not cached — retry next call once back online
      if (map.size > 0) cache = map
      return map
    })()
    inflight.finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** "5278km" (meters concatenated) → 5.278 km; bare numbers >100 treated as meters too */
function parseKm(v: string | number | undefined): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') n = parseFloat(v.replace(/[^\d.]/g, ''))
  else return null
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 100 ? n / 1000 : n
}

/** "1:19:813" (colon-separated millis) → "1:19.813" — displayed honestly, not re-parsed */
function normalizeLapRecord(v: string | undefined): string | null {
  if (!v) return null
  const parts = v.split(':')
  if (parts.length === 3) return `${parts[0]}:${parts[1]}.${parts[2]}`
  return v
}

/**
 * Lore for an OpenF1 `circuit_short_name` ("Monza", "Las Vegas", "Albert Park"…).
 * Returns null quietly when the network or the mapping fails.
 */
export async function circuitMeta(shortName: string): Promise<CircuitMeta | null> {
  const all = await loadAll()
  if (all.size === 0) return null
  const key = slugify(shortName)
  const direct = all.get(key) ?? all.get(ALIASES[key] ?? '')
  if (direct) return direct
  // fuzzy fallback: match on name fragment in either direction
  for (const meta of all.values()) {
    const a = slugify(meta.circuitName)
    if (a.includes(key) || key.includes(a)) return meta
  }
  return null
}
