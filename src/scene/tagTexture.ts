/* ============================================================
   Driver tag sprites — pre-rendered canvas chips (acronym +
   number + team bar). PORCELAIN: white pill, ink type, hairline
   border. Cheaper and crisper than SDF text for 20 always-
   visible billboards.

   All of these rasterize JetBrains Mono, so every one of them
   re-bakes itself once the font file actually loads
   (`onMonoReady`): a session restored from cache can otherwise
   bake the fallback monospace into the sprite permanently.
   ============================================================ */

import * as THREE from 'three'

let monoReady: Promise<void> | null = null

/** redraw canvas textures once the mono face is truly available */
export function onMonoReady(redraw: () => void): void {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  monoReady ??= document.fonts
    .load('700 24px "JetBrains Mono"')
    .then(() => undefined)
    .catch(() => undefined)
  void monoReady.then(redraw)
}

export function makeTagTexture(acronym: string, driverNumber: number, teamColor: string): THREE.CanvasTexture {
  const w = 192
  const h = 72
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4

  const redraw = () => {
    ctx.clearRect(0, 0, w, h)
    // paper chip with a soft drop shadow
    ctx.shadowColor = 'rgba(22, 27, 35, 0.18)'
    ctx.shadowBlur = 8
    ctx.shadowOffsetY = 3
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)'
    ctx.beginPath()
    ctx.roundRect(4, 4, w - 8, h - 10, 9)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'rgba(24, 32, 44, 0.16)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // team bar
    ctx.fillStyle = teamColor
    ctx.beginPath()
    ctx.roundRect(10, 12, 7, h - 26, 3)
    ctx.fill()

    // acronym — ink
    ctx.fillStyle = '#161b23'
    ctx.font = '700 34px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(acronym.slice(0, 3).toUpperCase(), 30, h / 2)

    // number — secondary ink
    ctx.fillStyle = 'rgba(76, 87, 102, 0.85)'
    ctx.font = '500 22px "JetBrains Mono", ui-monospace, monospace'
    const num = String(driverNumber)
    const numW = ctx.measureText(num).width
    ctx.fillText(num, w - 16 - numW, h / 2)
    tex.needsUpdate = true
  }
  redraw()
  onMonoReady(redraw)
  return tex
}

/** far-zoom variant: acronym only, tighter, so the field stays readable
    when the cars are game pieces on the full diorama */
export function makeMiniTagTexture(acronym: string, teamColor: string): THREE.CanvasTexture {
  const w = 104
  const h = 44
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4

  const redraw = () => {
    ctx.clearRect(0, 0, w, h)
    ctx.shadowColor = 'rgba(22, 27, 35, 0.16)'
    ctx.shadowBlur = 5
    ctx.shadowOffsetY = 2
    ctx.fillStyle = 'rgba(255, 255, 255, 0.93)'
    ctx.beginPath()
    ctx.roundRect(3, 3, w - 6, h - 7, 7)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = 'rgba(24, 32, 44, 0.14)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.fillStyle = teamColor
    ctx.beginPath()
    ctx.roundRect(8, 9, 5, h - 19, 2.5)
    ctx.fill()

    ctx.fillStyle = '#161b23'
    ctx.font = '700 25px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(acronym.slice(0, 3).toUpperCase(), 21, h / 2)
    tex.needsUpdate = true
  }
  redraw()
  onMonoReady(redraw)
  return tex
}
