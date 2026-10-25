/* Dependency-free PNG analysis for visual regression checks.
   Decodes RGBA8 PNGs with zlib and reports palette/structure
   statistics so a headless agent can sanity-check WebGL frames
   without a vision model. Usage: node scripts/analyze-png.mjs f1.png f2.png ... */

import { readFileSync } from 'node:fs'
import zlib from 'node:zlib'

function decodePng(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG: ' + file)
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`unsupported png ${bitDepth}/${interlace}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (!channels) throw new Error('unsupported color type ' + colorType)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 3)
  let prev = Buffer.alloc(stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++]
    const line = Buffer.from(raw.subarray(rp, rp + stride))
    rp += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = line[x]
      switch (filter) {
        case 0: break
        case 1: v = (v + a) & 255; break
        case 2: v = (v + b) & 255; break
        case 3: v = (v + ((a + b) >> 1)) & 255; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
          break
        }
        default: throw new Error('bad filter ' + filter)
      }
      line[x] = v
    }
    for (let x = 0; x < width; x++) {
      out[y * width * 3 + x * 3 + 0] = line[x * channels + 0]
      out[y * width * 3 + x * 3 + 1] = line[x * channels + 1]
      out[y * width * 3 + x * 3 + 2] = channels >= 3 ? line[x * channels + 2] : line[x * channels + 0]
    }
    prev = line
  }
  return { width, height, px: out }
}

function analyze(file) {
  const { width, height, px } = decodePng(file)
  const N = width * height
  let sum = 0
  let bins = { void: 0, paper: 0, mid: 0, dark: 0, black: 0 }
  let red = 0
  let amber = 0
  let green = 0
  let blue = 0
  let hiFreq = 0
  let centerSum = 0
  let centerN = 0
  let edgeSum = 0
  let edgeN = 0
  const cx0 = Math.floor(width * 0.3)
  const cx1 = Math.floor(width * 0.7)
  const cy0 = Math.floor(height * 0.3)
  const cy1 = Math.floor(height * 0.7)
  const lum = new Float32Array(N)
  for (let i = 0, y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const r = px[i * 3]
      const g = px[i * 3 + 1]
      const b = px[i * 3 + 2]
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      lum[i] = l
      sum += l
      if (l > 232) bins.void++
      else if (l > 190) bins.paper++
      else if (l > 90) bins.mid++
      else if (l > 35) bins.dark++
      else bins.black++
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      const sat = mx - mn
      if (sat > 60 && r === mx && g < 100 && b < 100) red++
      else if (sat > 50 && r === mx && g > 100 && b < 100) amber++
      else if (sat > 45 && g === mx) green++
      else if (sat > 55 && b === mx && r < 150) blue++
      const inCenter = x >= cx0 && x < cx1 && y >= cy0 && y < cy1
      if (inCenter) { centerSum += l; centerN++ }
      const inEdge = x < width * 0.04 || x > width * 0.96 || y < height * 0.04 || y > height * 0.96
      if (inEdge && !inCenter) { edgeSum += l; edgeN++ }
    }
  }
  for (let i = 1; i < N; i++) if (Math.abs(lum[i] - lum[i - 1]) > 26) hiFreq++
  let vs = 0
  const mean = sum / N
  for (let i = 0; i < N; i++) vs += (lum[i] - mean) * (lum[i] - mean)
  const pct = (n) => ((100 * n) / N).toFixed(2) + '%'
  return {
    file: file.split(/[\\/]/).pop(),
    size: `${width}x${height}`,
    meanLum: mean.toFixed(1),
    stdLum: Math.sqrt(vs / N).toFixed(1),
    bins: Object.fromEntries(Object.entries(bins).map(([k, v]) => [k, pct(v)])),
    saturated: { red: pct(red), amber: pct(amber), green: pct(green), blue: pct(blue) },
    hiFreqEdges: pct(hiFreq),
    centerVsEdge: (centerSum / centerN - edgeSum / edgeN).toFixed(1),
  }
}

const files = process.argv.slice(2)
for (const f of files) console.log(JSON.stringify(analyze(f)))
