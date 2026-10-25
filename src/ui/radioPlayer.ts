/* ============================================================
   Team radio playback — the actual pit-wall recordings.
   Singleton around one HTMLAudio element; UI polls state
   through the pulse cadence.
   ============================================================ */

export interface RadioState {
  playing: boolean
  driverNumber: number | null
  t: number | null
}

let audio: HTMLAudioElement | null = null
const state: RadioState = { playing: false, driverNumber: null, t: null }

export function playRadio(url: string, driverNumber: number, t: number): void {
  stopRadio()
  audio = new Audio(url)
  audio.volume = 0.9
  state.playing = true
  state.driverNumber = driverNumber
  state.t = t
  audio.addEventListener('ended', () => {
    if (state.t === t) {
      state.playing = false
      state.driverNumber = null
      state.t = null
    }
  })
  void audio.play().catch(() => {
    state.playing = false
    state.driverNumber = null
    state.t = null
  })
}

export function stopRadio(): void {
  if (audio) {
    audio.pause()
    audio.src = ''
    audio = null
  }
  state.playing = false
  state.driverNumber = null
  state.t = null
}

export function radioState(): RadioState {
  return state
}
