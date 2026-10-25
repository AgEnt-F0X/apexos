/* ============================================================
   Geo-fallback track bake — traces circuit centerlines from the
   MIT-licensed f1-circuits.geojson (github.com/bacinger/f1-circuits)
   into CachedTrackGeometry snapshots.

   ORDERING OF TRUTH: telemetry extrusion (build-all-tracks.ts) is
   ALWAYS preferred. This tool only fills gaps — circuits whose
   OpenF1 sessions lack positional telemetry — and stamps them
   source:'geojson' so X-ray lineage stays honest:
     · brakeHeat all zeros (needs real brake channels; not faked)
     · sectorParam ≈ thirds (real crossings need lap timing)
     · corners from curvature · direction = GeoJSON draw order

   usage:
     npx tsx scripts/build-tracks-from-geojson.ts             # fill gaps
     npx tsx scripts/build-tracks-from-geojson.ts zandvoort   # force keys
     npx tsx scripts/build-tracks-from-geojson.ts --dry       # write nothing
   ============================================================ */

import { readdir, writeFile } from 'node:fs/promises'
import { modelFromCached, type CachedTrackGeometry } from '../src/scene/trackBuilder'

const GEOJSON_URL =
  'https://raw.githubusercontent.com/bacinger/f1-circuits/master/f1-circuits.geojson'
const OUT_DIR = 'public/tracks'
const POINT_SPACING_M = 3 // same as trackBuilder
const HALF_WIDTH_M = 6.5 // same as trackBuilder
const CORNER_MIN_ANGLE_RAD = 0.2

/** f1-circuits `Location` → our trackKeyOf(circuit_short_name) */
const LOCATION_TO_KEY: Record<string, string> = {
  austin: 'austin',
  baku: 'baku',
  barcelona: 'catalunya',
  budapest: 'hungaroring',
  imola: 'imola',
  jeddah: 'jeddah',
  'las vegas': 'las_vegas',
  lusail: 'lusail',
  melbourne: 'melbourne',
  'mexico city': 'mexico_city',
  miami: 'miami',
  monaco: 'monte_carlo',
  montreal: 'montreal',
  monza: 'monza',
  'sao paulo': 'interlagos',
  sakhir: 'sakhir',
  shanghai: 'shanghai',
  silverstone: 'silverstone',
  singapore: 'singapore',
  'spa francorchamps': 'spa_francorchamps',
  spielberg: 'spielberg',
  suzuka: 'suzuka',
  'yas marina': 'yas_marina',
  zandvoort: 'zandvoort',
  madrid: 'madrid',
}

interface CircuitFeature {
  properties: { id: string; Location: string; Name: string; length: number; altitude: number }
  geometry: { coordinates: Array<[number, number]> }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const DRY = args.includes('--dry')
  const forced = args.filter((a) => !a.startsWith('--'))

  console.log(`fetching ${GEOJSON_URL} …`)
  const fc = JSON.parse(await (await fetch(GEOJSON_URL)).text()) as { features: CircuitFeature[] }
  console.log(`  ${fc.features.length} circuits in catalog\n`)

  const byKey = new Map<string, CircuitFeature>()
  for (const f of fc.features) {
    const key = LOCATION_TO_KEY[f.properties.Location.toLowerCase()]
    if (key && !byKey.has(key)) byKey.set(key, f) // first variation wins
  }

  let existing: string[] = []
  try {
    existing = (await readdir(OUT_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  } catch {
    /* no dir yet */
  }

  const targets = forced.length > 0 ? forced : [...byKey.keys()].filter((k) => !existing.includes(k))
  console.log(
    DRY
      ? `--dry: validating ${targets.length} circuit(s), writing NOTHING\n`
      : `${existing.length} present · filling ${targets.length} gaps (telemetry files NEVER overwritten)\n`,
  )

  let failures = 0
  for (const key of targets) {
    const feat = byKey.get(key)
    if (!feat) {
      failures++
      console.log(`[${key}] ✗ unknown key — catalog has: ${[...byKey.keys()].join(', ')}`)
      continue
    }
    try {
      const geo = buildFromFeature(key, feat)
      // round-trip validation through the REAL runtime loader path
      const model = modelFromCached(JSON.parse(JSON.stringify(geo)) as CachedTrackGeometry)
      if (model.n < 100 || !Number.isFinite(model.length)) throw new Error('round-trip failed')
      const officialKm = feat.properties.length / 1000
      const bakedKm = geo.length / 1000
      const deltaPct = ((bakedKm - officialKm) / officialKm) * 100
      console.log(
        `[${key}] ✓ ${model.n} pts · ${bakedKm.toFixed(2)}km vs official ${officialKm.toFixed(2)}km (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%) · ${geo.corners.length} corners`,
      )
      if (!DRY) await writeFile(`${OUT_DIR}/${key}.json`, JSON.stringify(geo))
    } catch (err) {
      failures++
      console.log(`[${key}] ✗ ${(err as Error).message}`)
    }
  }

  console.log(failures === 0 ? `\nDONE${DRY ? ' (dry)' : ''}` : `\n${failures} FAILURE(S)`)
  process.exitCode = failures === 0 ? 0 : 1
}

// ---------- geometry pipeline ----------

function buildFromFeature(key: string, feat: CircuitFeature): CachedTrackGeometry {
  const coords = feat.geometry.coordinates
  if (coords.length < 30) throw new Error(`centerline too sparse (${coords.length} pts)`)

  // project lng/lat → meters, equirectangular around the centroid
  let lat0 = 0
  let lon0 = 0
  for (const [lon, lat] of coords) {
    lon0 += lon
    lat0 += lat
  }
  lon0 /= coords.length
  lat0 /= coords.length
  const R = 6371000
  const cosLat = Math.cos((lat0 * Math.PI) / 180)
  const raw = coords.map(
    ([lon, lat]: [number, number]): [number, number] => [
      ((lon - lon0) * Math.PI * R * cosLat) / 180,
      ((lat - lat0) * Math.PI * R) / 180,
    ],
  )

  // close the loop + measure raw length
  const segLen = (a: [number, number], b: [number, number]): number =>
    Math.hypot(b[0] - a[0], b[1] - a[1])
  let rawLen = 0
  for (let i = 0; i < raw.length; i++) rawLen += segLen(raw[i], raw[(i + 1) % raw.length])
  if (rawLen < 1000) throw new Error(`loop implausibly short (${rawLen.toFixed(0)} m)`)

  // resample at uniform arc spacing (closed loop)
  const n = Math.max(200, Math.round(rawLen / POINT_SPACING_M))
  const points = new Float32Array(n * 3)
  const cumDist = new Float64Array(n)
  let src = 0
  let srcD = 0
  for (let i = 0; i < n; i++) {
    const d = (i / n) * rawLen
    while (
      src < raw.length &&
      srcD + segLen(raw[src], raw[(src + 1) % raw.length]) < d
    ) {
      srcD += segLen(raw[src], raw[(src + 1) % raw.length])
      src++
    }
    const a = raw[src % raw.length]
    const b = raw[(src + 1) % raw.length]
    const t = Math.min(Math.max((d - srcD) / Math.max(segLen(a, b), 1e-9), 0), 1)
    points[i * 3] = a[0] + (b[0] - a[0]) * t
    points[i * 3 + 1] = 0 // flat — source carries one scalar altitude, not a profile
    points[i * 3 + 2] = a[1] + (b[1] - a[1]) * t
    cumDist[i] = d
  }

  // corners from smoothed heading deltas (wrap-aware)
  const heading = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    heading[i] = Math.atan2(points[j * 3 + 2] - points[i * 3 + 2], points[j * 3] - points[i * 3])
  }
  const sm = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let prev = heading[i]
    let acc = 0
    for (let k = -5; k <= 5; k++) {
      let h = heading[(i + k + n) % n]
      while (h - prev > Math.PI) h -= 2 * Math.PI
      while (h - prev < -Math.PI) h += 2 * Math.PI
      prev = h
      acc += h
    }
    sm[i] = acc / 11
  }
  const delta = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let d = sm[(i + 1) % n] - sm[i]
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    delta[i] = d
  }

  const corners: CachedTrackGeometry['corners'] = []
  let i = 0
  while (i < n && corners.length < 40) {
    const sign = Math.sign(delta[i])
    if (sign === 0 || Math.abs(delta[i]) < 0.004) {
      i++
      continue
    }
    let j = i
    let angle = 0
    let apex = i
    while (j < n && Math.sign(delta[j]) === sign && Math.abs(delta[j]) >= 0.004) {
      angle += delta[j]
      if (Math.abs(delta[j]) > Math.abs(delta[apex])) apex = j
      j++
    }
    if (Math.abs(angle) >= CORNER_MIN_ANGLE_RAD) {
      corners.push({
        idx: apex,
        param: Number((cumDist[apex] / rawLen).toFixed(3)),
        dir: -sign,
        angle: Number(angle.toFixed(3)),
        number: corners.length + 1,
      })
    }
    i = Math.max(j, i + 1)
  }

  // footprint + framing
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let p = 0; p < n; p++) {
    minX = Math.min(minX, points[p * 3])
    maxX = Math.max(maxX, points[p * 3])
    minZ = Math.min(minZ, points[p * 3 + 2])
    maxZ = Math.max(maxZ, points[p * 3 + 2])
  }

  return {
    v: 1,
    key,
    source: 'geojson',
    sessionKey: 0,
    points: Array.from(points, (v) => Math.round(v * 1000) / 1000),
    cumDist: Array.from(cumDist, (v) => Math.round(v * 10) / 10),
    length: Math.round(rawLen * 1000) / 1000,
    halfWidth: HALF_WIDTH_M,
    sectorParam: [0, 1 / 3, 2 / 3],
    sectorOf: Uint8Array.from({ length: n }, (_, p) => (p / n < 1 / 3 ? 0 : p / n < 2 / 3 ? 1 : 2)),
    brakeHeat: new Array<number>(n).fill(0),
    corners,
    bounds: [minX, maxX, minZ, maxZ],
    center: [(minX + maxX) / 2, feat.properties.altitude, (minZ + maxZ) / 2],
    radius: Math.round((Math.hypot(maxX - minX, maxZ - minZ) / 2) * 1000) / 1000,
    elevationBase: feat.properties.altitude,
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exitCode = 1
})
