/* ============================================================
   OpenF1 HTTP client — polite by design.
   All requests flow through one queue: limited concurrency,
   minimum spacing, exponential backoff on 429/5xx.
   ============================================================ */

const BASE = 'https://api.openf1.org/v1'

const CONCURRENCY = 2
let MIN_SPACING_MS = 220 // between request launches, shared across lanes

/** Batch jobs (track baking) raise this to respect the 30 req/min axis;
    the interactive app keeps its snappy default. */
export function setMinSpacing(ms: number): void {
  MIN_SPACING_MS = ms
}
// Pass 1 gives up relatively quickly; the loader's recovery sweeps re-fetch any
// gaps once the API has had a moment to breathe (see fetchWindowed).
const MAX_RETRIES = 4

let activeCount = 0
let lastLaunch = 0
/** shared brake: when the API sheds load (429/5xx), everyone slows down */
let cooldownUntil = 0
const waiters: Array<() => void> = []

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function acquire(): Promise<void> {
  if (activeCount >= CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  activeCount++
  for (;;) {
    const wait = Math.max(lastLaunch + MIN_SPACING_MS, cooldownUntil) - Date.now()
    if (wait <= 0) break
    await sleep(wait)
  }
  lastLaunch = Date.now()
}

function release(): void {
  activeCount--
  const next = waiters.shift()
  if (next) next()
}

export interface QueryParams {
  [key: string]: string | number | boolean | undefined
}

/**
 * Build an OpenF1 URL. Keys may embed comparison operators,
 * e.g. { 'date>=': '2024-05-26T13:00:00' }.
 */
export function buildUrl(endpoint: string, params: QueryParams): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    const m = /^(.+?)(>=|<=|>|<)?$/.exec(key)!
    const v = encodeURIComponent(String(value))
    // OpenF1 comparison filters read as `field>=value` — the operator IS the
    // separator, so there is no `=` after it. Plain fields use `field=value`.
    parts.push(m[2] ? `${encodeURIComponent(m[1])}${encodeURIComponent(m[2])}${v}` : `${encodeURIComponent(m[1])}=${v}`)
  }
  return `${BASE}/${endpoint}?${parts.join('&')}`
}

export async function fetchRows<T>(
  endpoint: string,
  params: QueryParams,
  opts?: { allowEmpty404?: boolean },
): Promise<T[]> {
  return requestLane(
    buildUrl(endpoint, params),
    opts,
    async (res) => {
      const json: unknown = await res.json()
      // OpenF1 returns {"detail": "..."} for empty/invalid instead of []
      return Array.isArray(json) ? (json as T[]) : []
    },
  )
}

/* ---------- CSV bulk lane (PLAN §1.2) ----------
   Big pulls (location/car_data) accept `csv=true` — same rows,
   meaningfully smaller payloads. Typed columns are coerced back
   from strings via an explicit `numeric` list; anything the CSV
   lane can't parse throws so callers fall back to JSON. */

async function requestLane<T>(
  url: string,
  opts: { allowEmpty404?: boolean } | undefined,
  parse: (res: Response) => Promise<T[]>,
): Promise<T[]> {
  let attempt = 0
  for (;;) {
    await acquire()
    // hold the lane only for the request itself — backoff sleeps happen
    // after release() so two stalled retries can't starve the whole queue
    let retryDelay = -1
    try {
      const res = await fetch(url)
      if (res.ok) {
        return await parse(res)
      }
      if (res.status === 404 && opts?.allowEmpty404) {
        // OpenF1 answers 404 for queries whose range contains zero rows —
        // notably time-windowed telemetry past a session's recorded extent.
        // An empty range is a legitimate empty result, not an error.
        return []
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= MAX_RETRIES) throw new Error(`OpenF1 ${res.status} after ${attempt} retries: ${url}`)
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(16000, 800 * 2 ** attempt) + Math.random() * 500
        // brake the whole queue, not just this request
        cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.min(6000, backoff * 0.6))
        attempt++
        retryDelay = backoff
      } else {
        throw new Error(`OpenF1 ${res.status}: ${url}`)
      }
    } catch (err) {
      if (err instanceof TypeError && attempt < MAX_RETRIES) {
        // network hiccup
        attempt++
        retryDelay = 600 * 2 ** attempt
      } else {
        throw err
      }
    } finally {
      release()
    }
    await sleep(retryDelay)
  }
}

export async function fetchRowsCsv<T>(
  endpoint: string,
  params: QueryParams,
  opts?: { allowEmpty404?: boolean; numeric?: readonly string[] },
): Promise<T[]> {
  const url = buildUrl(endpoint, { ...params, csv: true })
  const numeric = new Set(opts?.numeric ?? [])
  return requestLane(url, opts, async (res) => {
    const rows = parseCsvRows(await res.text())
    if (rows === null) throw new Error(`csv lane: unparseable payload — ${endpoint}`)
    return rows.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) out[k] = numeric.has(k) ? (v === '' ? null : Number(v)) : v
      return out as T
    })
  })
}

/** minimal RFC-4180-ish splitter (quoted cells, doubled quotes) */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  return cells
}

function parseCsvRows(text: string): Array<Record<string, string>> | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return null
  const header = splitCsvLine(lines[0])
  if (header.length === 0) return null
  const out: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const row: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c] ?? ''
    out.push(row)
  }
  return out
}

/* ---------- tiny stale-while-revalidate cache for the small tables ----------
   meetings/sessions lists are near-static: serve localStorage instantly,
   refresh in the background. A flaky API should never blank the archive. */

interface CacheEntry<T> {
  t: number
  rows: T[]
}

export function readTableCache<T>(key: string, ttlMs: number): { rows: T[]; fresh: boolean } | null {
  try {
    const raw = localStorage.getItem(`of1:${key}`)
    if (!raw) return null
    const entry = JSON.parse(raw) as CacheEntry<T>
    if (!Array.isArray(entry.rows)) return null
    return { rows: entry.rows, fresh: Date.now() - entry.t < ttlMs }
  } catch {
    return null
  }
}

import { bumpWatermark } from './watermark'

export function writeTableCache<T>(key: string, rows: T[]): void {
  try {
    localStorage.setItem(`of1:${key}`, JSON.stringify({ t: Date.now(), rows }))
  } catch {
    // storage full/unavailable — cache is best-effort
  }
  // watermark sync (§1.2): each table write remembers the newest `date` row
  // it saw, scoped to the table, so Live mode / incremental refresh can
  // query `date>` instead of refetching whole windows. Forward-only, best-effort.
  bumpWatermark('table', key, rows as ReadonlyArray<{ date?: string | null }>)
}

/** Split [startMs, endMs] into windows of `windowSec`, as ISO string pairs. */
export function timeWindows(startMs: number, endMs: number, windowSec: number): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const step = windowSec * 1000
  for (let a = startMs; a < endMs; a += step) {
    const b = Math.min(a + step, endMs)
    out.push([new Date(a).toISOString(), new Date(b).toISOString()])
  }
  return out
}
