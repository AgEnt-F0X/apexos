/* ============================================================
   App-level state. Everything at UI cadence lives here;
   everything at frame cadence lives in raceClock / refs.
   ============================================================ */

import { create } from 'zustand'
import { replaySource } from '../data/source'
import type { LoadProgress, SessionData } from '../data/types'
import { raceClock } from '../engine/RaceClock'
import { RaceStateIndex } from '../engine/raceState'
import { buildFlagTimeline, type FlagTimeline } from '../engine/flags'
import { buildMoments, type MomentsModel } from '../engine/moments'
import { buildSectorTimeline, type SectorTimeline } from '../engine/sectorTimeline'
import { sceneRefs } from '../scene/sceneRefs'

export type Screen = 'browser' | 'loading' | 'theatre'
export type CameraMode = 'director' | 'orbit' | 'chase' | 'top' | 'anatomy'

/** the Density Dial's anchors: 0 CINEMA · 1 BROADCAST · 2 ENGINEER */
export type Density = 0 | 1 | 2

export interface LoadTarget {
  sessionKey: number
  title: string
  /** Join Broadcast: enter as-if-live — the future is locked */
  join?: boolean
}

interface AppState {
  screen: Screen
  session: SessionData | null
  raceIndex: RaceStateIndex | null
  flags: FlagTimeline | null
  moments: MomentsModel | null
  sectors: SectorTimeline | null
  loadTarget: LoadTarget | null
  progress: LoadProgress | null
  error: string | null

  focusDriver: number | null
  cameraMode: CameraMode
  density: Density
  xray: boolean
  /** temporal lensing: playback rate follows drama density */
  directed: boolean
  /** spoiler-free live mode active */
  joinMode: boolean
  about: boolean
  workshopLight: boolean

  loadSession(target: LoadTarget): void
  exitToBrowser(): void
  dismissError(): void
  setFocusDriver(d: number | null): void
  setCameraMode(m: CameraMode): void
  setDensity(d: Density): void
  setXray(v: boolean): void
  toggleDirected(): void
  setAbout(v: boolean): void
  setWorkshopLight(v: boolean): void
  toggleWorkshopLight(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'browser',
  session: null,
  raceIndex: null,
  flags: null,
  moments: null,
  sectors: null,
  loadTarget: null,
  progress: null,
  error: null,

  focusDriver: null,
  cameraMode: 'director',
  density: 1,
  xray: false,
  directed: false,
  joinMode: false,
  about: false,
  workshopLight: false,

  loadSession(target) {
    if (get().screen === 'loading') return
    set({
      screen: 'loading',
      loadTarget: target,
      progress: null,
      error: null,
      session: null,
      raceIndex: null,
      flags: null,
      moments: null,
      sectors: null,
    })
    replaySource
      .load(target.sessionKey, (progress) => {
        // ignore stale progress if user backed out
        if (get().loadTarget?.sessionKey === target.sessionKey) set({ progress })
      })
      .then((session) => {
        if (get().loadTarget?.sessionKey !== target.sessionKey) return
        raceClock.configure(session.tMin, session.tMax, session.tAction)
        const raceIndex = new RaceStateIndex(session)
        const flags = buildFlagTimeline(session)
        const moments = buildMoments(session, raceIndex, flags)
        const sectors = buildSectorTimeline(session)
        const join = target.join === true
        if (join) {
          // join two minutes before the action, locked to broadcast pace
          raceClock.t = Math.max(session.tMin, session.tAction - 120)
          raceClock.mode = 'broadcast-locked'
          raceClock.rate = 1
          raceClock.playing = true
        }
        set({
          session,
          raceIndex,
          flags,
          moments,
          sectors,
          screen: 'theatre',
          focusDriver: null,
          cameraMode: 'director',
          joinMode: join,
          directed: false,
        })
      })
      .catch((err: unknown) => {
        if (get().loadTarget?.sessionKey !== target.sessionKey) return
        set({
          screen: 'browser',
          error: err instanceof Error ? err.message : String(err),
          loadTarget: null,
        })
      })
  },

  exitToBrowser() {
    raceClock.pause()
    set({
      screen: 'browser',
      session: null,
      raceIndex: null,
      flags: null,
      moments: null,
      sectors: null,
      loadTarget: null,
      progress: null,
      focusDriver: null,
      joinMode: false,
      directed: false,
    })
  },

  dismissError() {
    set({ error: null })
  },

  setFocusDriver(d) {
    set({ focusDriver: d })
  },

  setCameraMode(m) {
    set({ cameraMode: m })
  },

  setDensity(d) {
    set({ density: d })
  },

  setXray(v) {
    set({ xray: v })
  },

  toggleDirected() {
    set((s) => ({ directed: !s.directed }))
  },

  setAbout(v) {
    set({ about: v })
  },

  setWorkshopLight(v) {
    sceneRefs.workshopLight = v
    set({ workshopLight: v })
  },

  toggleWorkshopLight() {
    set((s) => {
      const next = !s.workshopLight
      sceneRefs.workshopLight = next
      return { workshopLight: next }
    })
  },
}))
