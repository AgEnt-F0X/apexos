/* ============================================================
   Workshop audio synthesizer — telemetry haptics and ambient drone.

   Uses pure Web Audio API (zero audio file requests, zero 404
   failures, instant offline responsiveness). Adheres to browser
   user-gesture autoplay rules by lazily initializing AudioContext
   on the first user interaction.
   ============================================================ */

let ctx: AudioContext | null = null
let droneGain: GainNode | null = null
let droneOsc1: OscillatorNode | null = null
let droneOsc2: OscillatorNode | null = null
let noiseSource: AudioBufferSourceNode | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioContextClass) {
      ctx = new AudioContextClass()
    }
  }
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume()
  }
  return ctx
}

/** Subtle precision telemetry micro-tone when a part is pressed or picked */
export function playPartClick(partKey?: string): void {
  const ac = getContext()
  if (!ac) return

  const now = ac.currentTime
  const osc = ac.createOscillator()
  const gain = ac.createGain()

  // Pitch modulated based on part type for subtle tactile variety
  let baseFreq = 1800
  if (partKey === 'brake_disc') baseFreq = 1400
  else if (partKey === 'power_unit') baseFreq = 950
  else if (partKey === 'tyre') baseFreq = 1200
  else if (partKey === 'drs_flap') baseFreq = 2200

  osc.type = 'sine'
  osc.frequency.setValueAtTime(baseFreq, now)
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.025)

  // Soft envelope, barely audible click (-28dB)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(0.04, now + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035)

  osc.connect(gain)
  gain.connect(ac.destination)

  osc.start(now)
  osc.stop(now + 0.04)
}

/** Workshop inspection raking light relay switch click */
export function playLightToggle(on: boolean): void {
  const ac = getContext()
  if (!ac) return

  const now = ac.currentTime
  const osc = ac.createOscillator()
  const filter = ac.createBiquadFilter()
  const gain = ac.createGain()

  osc.type = on ? 'triangle' : 'square'
  osc.frequency.setValueAtTime(on ? 420 : 310, now)
  osc.frequency.exponentialRampToValueAtTime(on ? 680 : 180, now + 0.035)

  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(1200, now)
  filter.Q.setValueAtTime(3.0, now)

  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(0.06, now + 0.003)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ac.destination)

  osc.start(now)
  osc.stop(now + 0.06)
}

/** Subtle pneumatic actuator whisper when DRS opens or actuates */
export function playDrsActuation(open: boolean): void {
  const ac = getContext()
  if (!ac) return

  const bufferSize = ac.sampleRate * 0.08
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.1
  }

  const noise = ac.createBufferSource()
  noise.buffer = buffer

  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(open ? 1800 : 1200, ac.currentTime)
  filter.frequency.exponentialRampToValueAtTime(open ? 2400 : 800, ac.currentTime + 0.08)
  filter.Q.setValueAtTime(2.5, ac.currentTime)

  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, ac.currentTime)
  gain.gain.linearRampToValueAtTime(0.035, ac.currentTime + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.08)

  noise.connect(filter)
  filter.connect(gain)
  gain.connect(ac.destination)

  noise.start()
}

/** Smooth ambient telemetry room tone active during anatomy inspection */
export function setWorkshopDrone(active: boolean): void {
  const ac = getContext()
  if (!ac) return

  const now = ac.currentTime

  if (active) {
    if (droneGain) return // already running
    droneGain = ac.createGain()
    droneGain.gain.setValueAtTime(0.0001, now)
    droneGain.gain.linearRampToValueAtTime(0.015, now + 1.2) // very gentle -36dB drone

    // 60Hz and 120Hz transformer harmonics
    droneOsc1 = ac.createOscillator()
    droneOsc1.type = 'sine'
    droneOsc1.frequency.setValueAtTime(60, now)

    droneOsc2 = ac.createOscillator()
    droneOsc2.type = 'sine'
    droneOsc2.frequency.setValueAtTime(120, now)

    // Gentle filtered background air hiss
    const noiseBuffer = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    noiseSource = ac.createBufferSource()
    noiseSource.buffer = noiseBuffer
    noiseSource.loop = true

    const airFilter = ac.createBiquadFilter()
    airFilter.type = 'lowpass'
    airFilter.frequency.setValueAtTime(350, now)

    const airGain = ac.createGain()
    airGain.gain.setValueAtTime(0.004, now)

    noiseSource.connect(airFilter)
    airFilter.connect(airGain)
    airGain.connect(droneGain)

    droneOsc1.connect(droneGain)
    droneOsc2.connect(droneGain)
    droneGain.connect(ac.destination)

    droneOsc1.start(now)
    droneOsc2.start(now)
    noiseSource.start(now)
  } else {
    if (droneGain) {
      droneGain.gain.setValueAtTime(droneGain.gain.value, now)
      droneGain.gain.linearRampToValueAtTime(0.0001, now + 0.6)
      const g = droneGain
      const o1 = droneOsc1
      const o2 = droneOsc2
      const ns = noiseSource
      droneGain = null
      droneOsc1 = null
      droneOsc2 = null
      noiseSource = null
      setTimeout(() => {
        try {
          o1?.stop()
          o2?.stop()
          ns?.stop()
          g.disconnect()
        } catch {
          // ignore cleanup errors if audio context was closed
        }
      }, 700)
    }
  }
}
