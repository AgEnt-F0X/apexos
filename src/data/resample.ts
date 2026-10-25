/* ============================================================
   Irregular telemetry (~3.7–4.5 Hz) → uniform channel arrays.
   Single forward pass; linear interpolation for continuous
   channels, previous-sample hold for discrete ones.
   ============================================================ */

export interface RawSeries {
  /** seconds, ascending */
  t: Float64Array
  /** one array per channel, same length as t */
  values: Float64Array[]
}

export interface ResampleSpec {
  /** 'linear' | 'hold' per channel */
  modes: Array<'linear' | 'hold'>
  hz: number
}

export interface Resampled {
  t0: number
  n: number
  values: Float64Array[]
}

/**
 * Resample onto a uniform grid. If `target` is given, sample exactly onto
 * that grid (clamping at the raw series' ends); otherwise derive the grid
 * from the series' own extent.
 */
export function resampleUniform(
  raw: RawSeries,
  spec: ResampleSpec,
  target?: { t0: number; n: number },
): Resampled | null {
  const m = raw.t.length
  if (m < 2) return null
  const { hz } = spec
  const t0 = target ? target.t0 : Math.ceil(raw.t[0] * hz) / hz
  const n = target ? target.n : Math.floor((raw.t[m - 1] - t0) * hz) + 1
  if (n < 2) return null

  const out = spec.modes.map(() => new Float64Array(n))
  let j = 0 // raw cursor: raw.t[j] <= t < raw.t[j+1]
  for (let i = 0; i < n; i++) {
    const t = t0 + i / hz
    while (j < m - 2 && raw.t[j + 1] <= t) j++
    const ta = raw.t[j]
    const tb = raw.t[j + 1]
    const span = tb - ta
    const u = span > 0 ? Math.min(Math.max((t - ta) / span, 0), 1) : 0
    for (let c = 0; c < out.length; c++) {
      const va = raw.values[c][j]
      const vb = raw.values[c][j + 1]
      out[c][i] = spec.modes[c] === 'linear' ? va + (vb - va) * u : (u >= 1 ? vb : va)
    }
  }
  return { t0, n, values: out }
}

/** Light box smoothing in place (for positional jitter). windowHalf=1 → 3-tap. */
export function smoothInPlace(arr: Float64Array, windowHalf: number, passes = 1): void {
  const n = arr.length
  const tmp = new Float64Array(n)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0
      let cnt = 0
      const a = Math.max(0, i - windowHalf)
      const b = Math.min(n - 1, i + windowHalf)
      for (let k = a; k <= b; k++) {
        sum += arr[k]
        cnt++
      }
      tmp[i] = sum / cnt
    }
    arr.set(tmp)
  }
}
