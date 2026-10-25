/* ============================================================
   anatomyModel — the truth-first F1 car model.

   Anatomy's rule: every number a figure shows comes from the
   same model that moves its parts, so none can disagree. This
   module is that single source for the anatomy car: the real
   2024-regulation dimensions, the telemetry→part mapping, and
   the readout derivations (brake temp, DRS state, tire state).

   Nothing here draws — the anatomy geometry and the anatomy HUD
   both read these constants and these pure functions, so a part
   size, a shader threshold and a displayed number can never
   drift apart.

   All lengths in METERS, masses in KG, temps in °C, pressures
   in BAR. Sources: 2024 FIA F1 Technical Regulations + public
   team spec sheets; the values below are the regulation figures,
   not any one team's.
   ============================================================ */

/** Regulation envelope (2024). */
export const CAR = {
  length: 5.63,
  width: 2.0,
  height: 0.95,
  wheelbase: 3.6,
  frontTrack: 1.75,
  rearTrack: 1.65,
  mass: 798, // incl. driver, excl. fuel
  massWithFuel: 830, // race-fuel on the grid
} as const

/** Tyre + wheel (2024: 18" rims, reduced diameters). */
export const WHEEL = {
  frontDiameter: 0.72,
  rearDiameter: 0.72,
  rimDiameter: 0.457, // 18"
  width: 0.405,
  brakeDiscDiameter: 0.34,
  brakeDiscThickness: 0.032,
} as const

/** Compound catalogue — id matches the instanced shader's uCompound index. */
export const COMPOUNDS = [
  { id: 0, key: 'SOFT', label: 'Soft', grip: 1.0, degrade: 1.0, optimalMin: 90, optimalMax: 110 },
  { id: 1, key: 'MEDIUM', label: 'Medium', grip: 0.93, degrade: 0.7, optimalMin: 85, optimalMax: 105 },
  { id: 2, key: 'HARD', label: 'Hard', grip: 0.86, degrade: 0.5, optimalMin: 80, optimalMax: 100 },
  { id: 3, key: 'INTERMEDIATE', label: 'Inter', grip: 0.8, degrade: 0.9, optimalMin: 60, optimalMax: 90 },
  { id: 4, key: 'WET', label: 'Wet', grip: 0.72, degrade: 1.0, optimalMin: 40, optimalMax: 70 },
] as const

export type CompoundId = 0 | 1 | 2 | 3 | 4

export function compoundById(id: number): (typeof COMPOUNDS)[number] {
  return COMPOUNDS[Math.max(0, Math.min(COMPOUNDS.length - 1, Math.round(id)))]
}

/** DRS detection-zone parameters (per-circuit distance to zone start). */
export const DRS = {
  minSpeedKph: 140, // flap only opens above this
  minGapToAhead: 1.0, // seconds, at the detection point
  zoneLengthM: 600, // typical activation zone
} as const

/** Brake thermodynamic model — carbon disc temp/pressure from brake input + speed.
    Pure: same inputs always give the same reading. Used by the anatomy HUD
    when the brake disc is pressed, and to cross-check the shader's heat glow. */
export interface BrakeReadout {
  /** disc surface temp, °C */
  discTempC: number
  /** hydraulic line pressure, bar */
  pressureBar: number
  /** 0..1 — how hard into the carbon's fade window the disc is */
  fadeRisk: number
}

export function brakeReadout(brakePct: number, speedKph: number, heat0to1: number): BrakeReadout {
  const b = Math.max(0, Math.min(100, brakePct))
  // line pressure tracks pedal force (caliper force per bar is ~fixed)
  const pressureBar = 12 + (b / 100) * 92 // 12 idle → 104 peak
  // disc temp: brake-by-wire heats the disc on application, airflow cools it;
  // baseline rises with speed (more kinetic energy per stop) and with heat soak
  const airflow = Math.min(1, speedKph / 300)
  const drive = (b / 100) * (0.55 + 0.45 * airflow)
  const cool = 0.9 * airflow
  const discTempC = 90 + heat0to1 * 620 * (drive / (drive + cool + 0.15))
  // carbon fades hard above ~900 °C surface
  const fadeRisk = Math.max(0, Math.min(1, (discTempC - 820) / 160))
  return { discTempC, pressureBar, fadeRisk }
}

/** Tyre readout — compound, age, and a working-window flag from live telemetry. */
export interface TyreReadout {
  compoundKey: string
  compoundLabel: string
  /** laps of age (float; interpolates within a lap) */
  age: number
  /** surface temp °C, derived from the shader's accumulated heat 0..1 */
  surfaceTempC: number
  /** true when the tyre is inside its compound's optimal temp window */
  inWindow: boolean
}

export function tyreReadout(compoundId: number, ageLaps: number, heat0to1: number): TyreReadout {
  const c = compoundById(compoundId)
  // heat 0..1 maps to ~ambient..165 °C surface (matching the shader's glow band)
  const surfaceTempC = 25 + heat0to1 * 140
  const inWindow = surfaceTempC >= c.optimalMin && surfaceTempC <= c.optimalMax
  return {
    compoundKey: c.key,
    compoundLabel: c.label,
    age: ageLaps,
    surfaceTempC,
    inWindow,
  }
}

/** DRS readout — can the flap legally open right now, from the live state. */
export interface DrsReadout {
  /** raw wing state from telemetry */
  wingOpen: boolean
  /** within the detection zone (gap ≤ minGapToAhead) */
  withinGap: boolean
  /** above the minimum speed */
  aboveSpeed: boolean
  /** wing open AND legally allowed — the honest combined verdict */
  active: boolean
}

export function drsReadout(wingOpen: boolean, speedKph: number, gapToAheadS: number): DrsReadout {
  const withinGap = gapToAheadS <= DRS.minGapToAhead
  const aboveSpeed = speedKph >= DRS.minSpeedKph
  return {
    wingOpen,
    withinGap,
    aboveSpeed,
    active: wingOpen && withinGap && aboveSpeed,
  }
}

/** Power-unit readout — RPM, gear and a simple energy-deployment proxy. */
export interface PuReadout {
  rpm: number
  gear: number
  /** 0..1 deployment guess: throttle × rpm headroom (rough, honestly labelled) */
  deployment: number
}

const RPM_IDLE = 4200
const RPM_MAX = 15000

export function puReadout(rpm: number, gear: number, throttlePct: number): PuReadout {
  const headroom = Math.max(0, Math.min(1, (rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE)))
  const deployment = (throttlePct / 100) * (1 - 0.35 * headroom)
  return { rpm, gear, deployment }
}

/** The mapping from a pressed anatomy part to what it produces.
    The iso-figure rule: decide what pressing a part outputs before
    drawing it. `key` is the hit-test id used by the anatomy overlay. */
export type PartKey =
  | 'brake_disc'
  | 'drs_flap'
  | 'tyre'
  | 'power_unit'
  | 'front_wing'
  | 'diffuser'

export interface PartDescriptor {
  key: PartKey
  /** short label shown on the plate frame */
  label: string
  /** one line: what pressing this part reveals */
  hint: string
  /** the live readout kind this part produces */
  readout: 'brake' | 'drs' | 'tyre' | 'pu' | 'none'
}

export const ANATOMY_PARTS: PartDescriptor[] = [
  { key: 'brake_disc', label: 'Brake disc', hint: 'press for disc temp & pressure', readout: 'brake' },
  { key: 'drs_flap', label: 'DRS flap', hint: 'press to toggle the wing', readout: 'drs' },
  { key: 'tyre', label: 'Tyre', hint: 'press for compound & temperature', readout: 'tyre' },
  { key: 'power_unit', label: 'Power unit', hint: 'press for rpm & gear', readout: 'pu' },
  { key: 'front_wing', label: 'Front wing', hint: 'downforce & aero balance', readout: 'none' },
  { key: 'diffuser', label: 'Diffuser', hint: 'rear downforce extraction', readout: 'none' },
]

/** Format helpers — the HUD uses these so every readout reads the same. */
export const fmt = {
  temp: (c: number) => `${Math.round(c)}°C`,
  bar: (b: number) => `${Math.round(b)} bar`,
  kph: (k: number) => `${Math.round(k)} km/h`,
  rpm: (r: number) => `${Math.round(r / 100) / 10}k rpm`,
  laps: (a: number) => `${a < 10 ? a.toFixed(1) : Math.round(a)} laps`,
  pct: (p: number) => `${Math.round(p * 100)}%`,
}
