/* ============================================================
   Derived Metrics Engine — shared contracts.

   Every metric is built ONCE per session from SessionData and
   exposed as time-addressable series, so dashboard panels can
   answer "what does this look like AT the playhead" with a
   binary search instead of recomputation. This is what makes
   the One Time Cursor cheap: panels subscribe to clock ticks
   and read windows, they never own timelines.

   Honesty rules for every model here:
   - missing data is NaN/null, never imputed silently
   - heuristics carry their thresholds in named constants
   - a "clean" lap means exactly what cleanLaps() says it means
   ============================================================ */

import type { RaceStateIndex } from '../raceState'
import type { FlagTimeline } from '../flags'
import type { SessionData } from '../../data/types'
import type { UndercutModel } from './undercut'
import type { GapDynamicsModel } from './gapDynamics'
import type { TrackEvolutionModel } from './trackEvolution'
import type { SectorsModel } from './sectors'

/** One classified lap for a driver. `kind` explains WHY it counts or doesn't. */
export type LapKind =
  | 'clean' // representative push lap under green, dry, no pit involvement
  | 'no-time' // lap_duration missing from OpenF1
  | 'lap1' // race start lap: grid launch, first-lap chaos
  | 'pit-in' // lap containing this driver's pit entry
  | 'pit-out' // flagged out-lap (is_pit_out_lap)
  | 'sc' // lap fully/partially under SC, VSC or red restart crawl
  | 'wet' // lap started while rainfall > 0
  | 'outlier' // failed robust outlier test against the stint median

export interface LapPoint {
  lap: number
  /** lap duration in seconds, NaN when unknown */
  sec: number
  kind: LapKind
  /** lap-average speed trap style figure is NOT available per lap; keep compound context */
  compound: string
}

export interface DriverConsistency {
  driverNumber: number
  points: LapPoint[]
  /** stats over CLEAN laps only; NaN when fewer than MIN_CLEAN_LAPS */
  median: number
  stdev: number
  best: number
  cleanCount: number
}

/** Linear pace-decay model of one tire stint. */
export interface StintDeg {
  driverNumber: number
  stintNumber: number
  compound: string
  /** sampling context the fit ran in: 'wet' means wet-classified laps fed the fit */
  context: 'dry' | 'wet'
  /** race lap numbers the stint spans (inclusive) */
  lapStart: number
  lapEnd: number
  tyreAgeAtStart: number
  /** intercept of the fit: projected clean lap at stint-relative lap 0 (s) */
  baseLap: number
  /** fitted pace loss per lap in seconds (positive = slower). NaN if < MIN_FIT_POINTS */
  slopePerLap: number
  /** fit quality 0..1; NaN if < MIN_FIT_POINTS */
  r2: number
  /** the clean samples the fit used */
  samples: Array<{ lap: number; sec: number }>
}

export interface TireDegModel {
  driverNumber: number
  stints: StintDeg[]
  /** fastest single clean lap across all stints */
  bestCleanLap: number
}

/** Field-relative pace of one driver: per-lap delta to the session's best clean lap that lap. */
export interface PacePoint {
  lap: number
  /** driver's clean lap (NaN if none this lap) */
  sec: number
  /** sec − field best that lap (NaN if either missing) */
  deltaToBest: number
}

export interface MetricsModel {
  consistency: Map<number, DriverConsistency>
  tireDeg: Map<number, TireDegModel>
  paceVsField: Map<number, PacePoint[]>
  /** classified pit-lap attacks: real ones only, never guessed */
  undercuts: UndercutModel
  /** gap-to-leader trend series + detected closing swings */
  gapDynamics: GapDynamicsModel
  /** field median lap vs race lap (fuel/deg/caution curve) */
  trackEvolution: TrackEvolutionModel
  /** per-driver + field sector truths from the laps table */
  sectors: SectorsModel
  /** total laps with any timing data (field-wide max) */
  totalTimedLaps: number
}

export interface MetricInputs {
  data: SessionData
  idx: RaceStateIndex
  flags: FlagTimeline
}

// ---------- shared constants (the heuristics, named) ----------

/** minimum clean samples before we trust a regression */
export const MIN_FIT_POINTS = 4
/** minimum clean laps before stdev/median are considered meaningful */
export const MIN_CLEAN_LAPS = 5
/** robust outlier gate: |sec − median| beyond this fraction of median ⇒ rejected */
export const OUTLIER_FRAC = 0.035
/** absolute outlier floor in seconds (protects tiny-medians) */
export const OUTLIER_ABS_S = 2.5
/**
 * regime-break gate: adjacent clean laps inside one stint differing by more
 * than this many seconds signal a condition shift (deluge, red-flag crawl,
 * drying track) rather than tire degradation. The fit then runs on the
 * largest stable segment only — measuring weather would be dishonest deg.
 */
export const REGIME_BREAK_S = 6
