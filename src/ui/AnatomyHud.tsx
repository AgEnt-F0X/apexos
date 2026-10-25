/* ============================================================
   Anatomy HUD — the live readout panel shown only in anatomy
   mode. Reads sceneRefs.anatomyReadout (published every frame by
   AnatomyCar) and surfaces the pressed part's numbers, derived
   from the exact same sample that moves the car — so a displayed
   value can never disagree with the part it describes (the
   iso-figure rule: press a part, get real output).

   Reads via rAF rather than a React subscription: the readout
   updates at 60 fps and must not re-render the whole shell.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { useAppStore } from '../state/appStore'
import { sceneRefs } from '../scene/sceneRefs'
import { ANATOMY_PARTS, fmt, type PartKey } from '../scene/anatomyModel'
import { playPartClick, playLightToggle } from './workshopAudio'

export function AnatomyHud() {
  const panelRef = useRef<HTMLDivElement>(null)
  const partRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const workshopLight = useAppStore((s) => s.workshopLight)
  const toggleWorkshopLight = useAppStore((s) => s.toggleWorkshopLight)

  const handleSelectPart = (k: PartKey) => {
    sceneRefs.anatomyPart = k
    playPartClick(k)
  }

  const handleToggleLight = () => {
    toggleWorkshopLight()
    playLightToggle(!workshopLight)
  }

  useEffect(() => {
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const mode = useAppStore.getState().cameraMode
      const panel = panelRef.current
      if (!panel) return
      if (mode !== 'anatomy') {
        panel.dataset.visible = 'false'
        return
      }
      panel.dataset.visible = 'true'
      const ro = sceneRefs.anatomyReadout
      const part = sceneRefs.anatomyPart
      if (!ro) return

      // pressed-part label + hint (correctly shows hint when part is active)
      const partEl = partRef.current
      if (partEl) {
        const desc = ANATOMY_PARTS.find((p) => p.key === part)
        if (desc) {
          partEl.querySelector('b')!.textContent = desc.label
          partEl.querySelector('i')!.textContent = desc.hint
        } else {
          partEl.querySelector('b')!.textContent = 'Cutaway'
          partEl.querySelector('i')!.textContent = 'tap a part to read its telemetry'
        }
      }

      // the pressed part's live numbers
      const body = bodyRef.current
      if (body) {
        const lines: string[] = []
        const desc = ANATOMY_PARTS.find((p) => p.key === part)
        const kind = desc?.readout ?? 'none'
        if (kind === 'brake') {
          lines.push(`disc ${fmt.temp(ro.brake.discTempC)}`)
          lines.push(`pressure ${fmt.bar(ro.brake.pressureBar)}`)
          lines.push(ro.brake.fadeRisk > 0.4 ? '⚠ fade risk' : 'fade ok')
        } else if (kind === 'tyre') {
          lines.push(`${ro.tyre.compoundLabel}`)
          lines.push(`surface ${fmt.temp(ro.tyre.surfaceTempC)}`)
          lines.push(ro.tyre.inWindow ? '✓ in window' : 'out of window')
        } else if (kind === 'drs') {
          lines.push(`flap ${ro.drs.wingOpen ? 'OPEN' : 'closed'}`)
          lines.push(ro.drs.active ? '✓ legal' : ro.drs.aboveSpeed ? 'no gap' : 'too slow')
        } else if (kind === 'pu') {
          lines.push(`${fmt.rpm(ro.pu.rpm)}`)
          lines.push(`gear ${ro.pu.gear}`)
          lines.push(`deploy ${fmt.pct(ro.pu.deployment)}`)
        } else {
          // no part pressed — show the whole-car summary
          lines.push(`brake ${fmt.temp(ro.brake.discTempC)}`)
          lines.push(`rpm ${fmt.rpm(ro.pu.rpm)}`)
          lines.push(`tyre ${fmt.temp(ro.tyre.surfaceTempC)}`)
          lines.push(`drs ${ro.drs.wingOpen ? 'OPEN' : 'closed'}`)
        }
        body.innerHTML = lines
          .map((l) => `<span class="anat__row mono">${l}</span>`)
          .join('')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="anat" ref={panelRef} data-visible="false">
      <div className="anat__head">
        <span className="anat__tag label">ANATOMY · LIVE</span>
        <div className="anat__controls">
          <button
            type="button"
            className={`anat__btn label ${workshopLight ? 'is-active' : ''}`}
            onClick={handleToggleLight}
            title="Toggle raking workshop light (shortcut: L)"
          >
            LIGHT (L)
          </button>
          <span className="anat__esc label">ESC exit</span>
        </div>
      </div>
      <div className="anat__part" ref={partRef}>
        <b>Cutaway</b>
        <i>tap a part to read its telemetry</i>
      </div>
      <div className="anat__parts label" aria-label="Quick part selection">
        {ANATOMY_PARTS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="anat__chip"
            onClick={() => handleSelectPart(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="anat__body" ref={bodyRef} />
    </div>
  )
}

