/* ============================================================
   RaceClock — the one owner of "now".
   Replay scrubs it; temporal lensing (Phase 3) varies its rate;
   Join-Broadcast (Phase 4) locks it to wall time; a live feed
   appends data while it runs. Everything downstream just reads t.
   Deliberately not React state: consumed per-frame by the scene,
   mirrored to the UI on a low-frequency tick.
   ============================================================ */

export type ClockMode = 'manual' | 'directed' | 'broadcast-locked'

const RATES = [1, 2, 4, 8, 16, 32]

class RaceClock {
  t = 0
  rate = 1
  playing = false
  mode: ClockMode = 'manual'
  tMin = 0
  tMax = 1

  /** true while the user is dragging the scrub bar */
  scrubbing = false

  configure(tMin: number, tMax: number, tStart: number): void {
    this.tMin = tMin
    this.tMax = tMax
    this.t = Math.min(Math.max(tStart, tMin), tMax)
    this.playing = false
    this.rate = 1
    this.mode = 'manual'
  }

  tick(dt: number): void {
    if (!this.playing || this.scrubbing) return
    this.t += dt * this.rate
    if (this.t >= this.tMax) {
      this.t = this.tMax
      this.playing = false
    }
    if (this.t < this.tMin) this.t = this.tMin
  }

  seek(t: number): void {
    // Broadcast lock = DVR, not a brick: rewinding through already-revealed
    // time is allowed; seeking ahead of the live edge is refused.
    if (this.mode === 'broadcast-locked' && t > this.t) return // no peeking at the future
    this.t = Math.min(Math.max(t, this.tMin), this.tMax)
  }

  play(): void {
    if (this.t >= this.tMax - 0.5) this.t = this.tMin
    this.playing = true
  }

  pause(): void {
    this.playing = false
  }

  toggle(): void {
    this.playing ? this.pause() : this.play()
  }

  cycleRate(): number {
    const i = RATES.indexOf(this.rate)
    this.rate = RATES[(i + 1) % RATES.length]
    return this.rate
  }

  setRate(r: number): void {
    this.rate = r
  }

  get frac(): number {
    return (this.t - this.tMin) / Math.max(1e-6, this.tMax - this.tMin)
  }
}

export const raceClock = new RaceClock()
