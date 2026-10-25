/* ============================================================
   Jolpica-F1 source — Ergast-compatible history lane.

   What OpenF1 cannot give (results/standings/schedules before
   2023, championship tables) comes from here. Enrichment-only
   by policy: nothing in the core pipeline blocks on this API,
   and every response is cached in localStorage so a flaky day
   never blanks a panel. Free tier is generous but rate-limited;
   we run one sequential lane with generous spacing regardless.
   ============================================================ */

const BASE = 'https://api.jolpi.ca/ergast/f1'
const MIN_SPACING_MS = 400

let chain: Promise<unknown> = Promise.resolve()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchJolpica<T>(path: string, ttlMs = 6 * 3600_000): Promise<T | null> {
  const cacheKey = `jlp:${path}`
  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) {
      const entry = JSON.parse(raw) as { t: number; data: T }
      if (Date.now() - entry.t < ttlMs) return entry.data
    }
  } catch {
    /* cache miss */
  }

  // serialize every network touch through one chain
  const run = chain.then(async () => {
    await sleep(MIN_SPACING_MS)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`)
        if (!res.ok) throw new Error(`jolpica ${res.status}: ${path}`)
        const json = (await res.json()) as T
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: json }))
        } catch {
          /* storage full — best effort */
        }
        return json
      } catch (err) {
        if (attempt === 2) {
          console.warn(`[jolpica] giving up on ${path}`, err)
          return null
        }
        await sleep(1200 * 2 ** attempt)
      }
    }
    return null
  })
  chain = run.catch(() => undefined)
  return run as Promise<T | null>
}

// ---------- shapes (only what we consume) ----------

export interface JolpicaCircuitRef {
  circuitId: string
  circuitName: string
  Location: { lat: string; long: string; locality: string; country: string }
}
export interface JolpicaRace {
  season: string
  round: string
  raceName: string
  Circuit: JolpicaCircuitRef
  date: string
  time?: string
  url?: string
  Results?: unknown[]
}
export interface JolpicaDriverStanding {
  position: string
  positionText: string
  points: string
  wins: string
  Driver: { driverId: string; givenName: string; familyName: string; nationality: string }
  Constructors: Array<{ constructorId: string; name: string }>
}
export interface JolpicaConstructorStanding {
  position: string
  positionText: string
  points: string
  wins: string
  Constructor: { constructorId: string; name: string; nationality: string }
}

interface MRData<T> {
  MRData?: { total?: string; RaceTable?: { Races?: T[] }; StandingsTable?: { StandingsLists?: Array<Record<string, unknown>> } }
}

/** Full season calendar, round order preserved. */
export async function seasonCalendar(year: number): Promise<JolpicaRace[]> {
  const j = await fetchJolpica<MRData<JolpicaRace>>(`/${year}.json`, 24 * 3600_000)
  return j?.MRData?.RaceTable?.Races ?? []
}

export async function raceResult(year: number, round: number): Promise<JolpicaRace | null> {
  const j = await fetchJolpica<MRData<JolpicaRace>>(`/${year}/${round}/results.json`)
  return j?.MRData?.RaceTable?.Races?.[0] ?? null
}

export async function driverStandings(year: number): Promise<JolpicaDriverStanding[]> {
  const j = await fetchJolpica<{ MRData?: { StandingsTable?: { StandingsLists?: Array<{ DriverStandings?: JolpicaDriverStanding[] }> } } }>(
    `/${year}/driverstandings.json`,
  )
  return j?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? []
}

export async function constructorStandings(year: number): Promise<JolpicaConstructorStanding[]> {
  const j = await fetchJolpica<{ MRData?: { StandingsTable?: { StandingsLists?: Array<{ ConstructorStandings?: JolpicaConstructorStanding[] }> } } }>(
    `/${year}/constructorstandings.json`,
  )
  return j?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? []
}

/** Seasons list (year), oldest → newest — used by the archive's era browser. */
export async function seasons(): Promise<Array<{ season: string }>> {
  const j = await fetchJolpica<{ MRData?: { SeasonTable?: { Seasons?: Array<{ season: string }> } } }>(
    `/seasons.json?limit=100`,
    30 * 24 * 3600_000,
  )
  return j?.MRData?.SeasonTable?.Seasons ?? []
}
