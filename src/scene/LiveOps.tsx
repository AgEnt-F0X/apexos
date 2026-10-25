/* ============================================================
   LiveOps — frame-rate bridge from race state to the ribbon.
   Sector yellows pulse the asphalt, red flags tint the rails,
   rainfall soaks the surface. No React state involved.
   ============================================================ */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { raceClock } from '../engine/RaceClock'
import { useAppStore } from '../state/appStore'
import { sceneRefs } from './sceneRefs'
import type { WeatherEvent } from '../data/types'

function rainfallAt(weather: WeatherEvent[], t: number, cursor: { i: number }): number {
  if (weather.length === 0) return 0
  let i = Math.min(Math.max(cursor.i, 0), weather.length - 1)
  while (i > 0 && weather[i].t > t) i--
  while (i < weather.length - 1 && weather[i + 1].t <= t) i++
  cursor.i = i
  return weather[i].rainfall > 0 ? 1 : 0
}

export function LiveOps() {
  const pulse = useMemo<[number, number, number]>(() => [0, 0, 0], [])
  const cursor = useRef({ i: 0 })

  useFrame(() => {
    const mat = sceneRefs.ribbonMat
    const { flags, session } = useAppStore.getState()
    if (!mat || !flags || !session) return
    const t = raceClock.t
    const u = mat.uniforms

    flags.sectorPulseAt(t, pulse)
    u.uSectorPulse.value.set(pulse[0], pulse[1], pulse[2])

    const phase = flags.phaseAt(t)
    const redTarget = phase === 'RED' ? 1 : 0
    u.uRed.value += (redTarget - u.uRed.value) * 0.04

    const wetTarget = rainfallAt(session.weather, t, cursor.current)
    // rain soaks in / dries out slowly
    u.uWet.value += (wetTarget - u.uWet.value) * 0.006
    sceneRefs.wet.value = u.uWet.value
  })

  return null
}
