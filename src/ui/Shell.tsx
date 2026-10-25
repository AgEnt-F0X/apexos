/* ============================================================
   Theatre overlay shell. Composition is governed by the
   Density Dial: CINEMA strips the chrome, BROADCAST tells the
   story, ENGINEER shows the pit wall. X-ray sits above all.

   Keys: SPACE play · 1/2/3 camera · D density · A auto-lens ·
   hold X x-ray · ←/→ seek · R rate · ESC unfocus
   ============================================================ */

import { useEffect } from 'react'
import { raceClock } from '../engine/RaceClock'
import { useAppStore, type Density } from '../state/appStore'
import { sceneRefs } from '../scene/sceneRefs'
import { Onboarding } from './Onboarding'
import { StatusBar } from './StatusBar'
import { StoryFeed } from './StoryFeed'
import { FocusPanel } from './FocusPanel'
import { Dossier } from './Dossier'
import { TimingTower } from './TimingTower'
import { Transport } from './Transport'
import { CalloutLayer } from './CalloutLayer'
import { AnatomyHud } from './AnatomyHud'
import { XrayLayer } from './XrayLayer'
import { setWorkshopDrone, playLightToggle } from './workshopAudio'

export function Shell() {
  const density = useAppStore((s) => s.density)
  const focusDriver = useAppStore((s) => s.focusDriver)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const store = useAppStore.getState()
      switch (e.code) {
        case 'Space':
          e.preventDefault()
          raceClock.toggle()
          break
        case 'Digit1':
          store.setCameraMode('director')
          break
        case 'Digit2':
          store.setCameraMode('orbit')
          break
        case 'Digit3':
          store.setCameraMode('chase')
          break
        case 'Digit4':
          store.setCameraMode('top')
          break
        case 'Digit5':
          store.setCameraMode('anatomy')
          break
        case 'KeyD':
          store.setDensity(((store.density + 1) % 3) as Density)
          break
        case 'KeyA':
          if (!store.joinMode) store.toggleDirected()
          break
        case 'KeyX':
          if (!e.repeat) store.setXray(true)
          break
        case 'ArrowRight':
          raceClock.seek(raceClock.t + (e.shiftKey ? 60 : 10))
          break
        case 'ArrowLeft':
          raceClock.seek(raceClock.t - (e.shiftKey ? 60 : 10))
          break
        case 'KeyR':
          raceClock.cycleRate()
          break
        case 'KeyL':
          store.toggleWorkshopLight()
          playLightToggle(!store.workshopLight)
          break
        case 'Escape':
          // in anatomy mode, ESC leaves the cutaway back to where you were;
          // otherwise it just unfocuses
          if (store.cameraMode === 'anatomy') {
            store.setCameraMode(
              (sceneRefs.anatomyPrevMode ?? 'director') as typeof store.cameraMode,
            )
          } else {
            store.setFocusDriver(null)
          }
          break
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'KeyX') useAppStore.getState().setXray(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const cameraMode = useAppStore((s) => s.cameraMode)
  useEffect(() => {
    setWorkshopDrone(cameraMode === 'anatomy')
    return () => {
      if (cameraMode === 'anatomy') setWorkshopDrone(false)
    }
  }, [cameraMode])

  return (
    <div className={`shell density-${density} ${density === 2 && focusDriver !== null ? 'has-dossier' : ''}`}>
      <StatusBar />
      {density >= 1 && <TimingTower />}
      <StoryFeed />
      {density >= 1 && focusDriver !== null && (density === 2 ? <Dossier /> : <FocusPanel />)}
      <Transport />
      <AnatomyHud />
      {density === 2 && (
        <div className="shell__hints label">
          <span>SPACE play</span>
          <span>1–5 camera</span>
          <span>SCROLL zoom · 2×CLICK reset</span>
          <span>D density</span>
          <span>A auto-lens</span>
          <span>hold X — x-ray</span>
          <span>L light</span>
          <span>CLICK CAR focus</span>
        </div>
      )}
      <CalloutLayer />
      <XrayLayer />
      <Onboarding />
    </div>
  )
}
