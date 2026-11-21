import * as THREE from 'three'
import type { CardRank, CardSuit } from '../game/GameEngine'

const CARD_W = 256
const CARD_H = 358
const SUIT_GLYPH: Readonly<Record<CardSuit, string>> = {
  spade: '\u2660',
  heart: '\u2665',
  diamond: '\u2666',
  club: '\u2663',
}
const RED_SUITS: ReadonlySet<CardSuit> = new Set<CardSuit>(['heart', 'diamond'])
const MASK_KEYS = ['mask-1', 'mask-2', 'mask-3'] as const
const BASE_KEYS: readonly string[] = [
  'table',
  'card-back',
  'dust',
  ...MASK_KEYS,
]

type Random = () => number

function mulberry32(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  return ctx
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, rnd: Random, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const alpha = 0.015 + rnd() * 0.05
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,240,215,${alpha})` : `rgba(0,0,0,${alpha * 1.6})`
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 1.6, 1 + rnd() * 1.6)
  }
}

function bloodSplatter(
  ctx: CanvasRenderingContext2D,
  rnd: Random,
  cx: number,
  cy: number,
  radius: number,
  intensity: number,
): void {
  const grad = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius)
  grad.addColorStop(0, `rgba(104,16,14,${0.55 * intensity})`)
  grad.addColorStop(0.55, `rgba(72,10,10,${0.3 * intensity})`)
  grad.addColorStop(1, 'rgba(50,6,6,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.ellipse(cx, cy, radius, radius * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2)
  ctx.fill()
  const drops = 5 + Math.floor(rnd() * 7)
  for (let i = 0; i < drops; i += 1) {
    const angle = rnd() * Math.PI * 2
    const dist = radius * (0.9 + rnd() * 1.5)
    ctx.fillStyle = `rgba(${70 + Math.floor(rnd() * 40)},8,8,${0.3 + rnd() * 0.45})`
    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 0.8 + rnd() * 3.2, 0, Math.PI * 2)
    ctx.fill()
  }
}

function scratches(ctx: CanvasRenderingContext2D, rnd: Random, w: number, h: number, count: number): void {
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    const len = 8 + rnd() * 46
    const angle = rnd() * Math.PI
    ctx.strokeStyle = `rgba(226,208,180,${0.03 + rnd() * 0.07})`
    ctx.lineWidth = 0.5 + rnd() * 1.1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
}

function drawCardFace(canvas: HTMLCanvasElement, rank: CardRank, suit: CardSuit): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(rank * 977 + suit.length * 131 + suit.charCodeAt(0))
  const red = RED_SUITS.has(suit)

  const base = ctx.createLinearGradient(0, 0, w, h)
  base.addColorStop(0, '#1d1613')
  base.addColorStop(0.45, '#251b16')
  base.addColorStop(1, '#0e0a09')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.6)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  noise(ctx, w, h, rnd, 2400)

  ctx.strokeStyle = 'rgba(163,126,72,0.85)'
  ctx.lineWidth = 2.5
  ctx.strokeRect(9, 9, w - 18, h - 18)
  ctx.strokeStyle = 'rgba(163,126,72,0.32)'
  ctx.lineWidth = 1
  ctx.strokeRect(15, 15, w - 30, h - 30)

  ctx.font = '90px Georgia, "Times New Roman", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = red ? 'rgba(150,36,32,0.16)' : 'rgba(206,190,158,0.13)'
  ctx.fillText(SUIT_GLYPH[suit], w / 2, h * 0.54)

  const ink = red ? '#c8483c' : '#d9c9a6'
  const label = rank === 1 ? 'A' : String(rank)
  ctx.fillStyle = ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 62px Georgia, "Times New Roman", serif'
  ctx.fillText(label, 26, 78)
  ctx.font = '26px Georgia, "Times New Roman", serif'
  ctx.fillText(SUIT_GLYPH[suit], 30, 108)

  ctx.save()
  ctx.translate(w - 26, h - 32)
  ctx.rotate(Math.PI)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.font = 'bold 62px Georgia, "Times New Roman", serif'
  ctx.fillText(label, 0, 0)
  ctx.font = '26px Georgia, "Times New Roman", serif'
  ctx.fillText(SUIT_GLYPH[suit], 4, 30)
  ctx.restore()

  const cx = w / 2
  const cy = h * 0.54
  ctx.strokeStyle = 'rgba(177,138,80,0.5)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, 72, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([3, 7])
  ctx.beginPath()
  ctx.arc(cx, cy, 62, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  for (let i = 0; i < rank; i += 1) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
    ctx.strokeStyle = red ? 'rgba(190,60,48,0.55)' : 'rgba(190,168,128,0.4)'
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * 24, cy + Math.sin(angle) * 24)
    ctx.lineTo(cx + Math.cos(angle) * (46 + rank * 2.2), cy + Math.sin(angle) * (46 + rank * 2.2))
    ctx.stroke()
  }
  ctx.strokeStyle = red ? 'rgba(190,60,48,0.45)' : 'rgba(190,168,128,0.32)'
  ctx.beginPath()
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2 - Math.PI / 2
    const px = cx + Math.cos(angle) * 26
    const py = cy + Math.sin(angle) * 26
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.stroke()

  scratches(ctx, rnd, w, h, 22)
  bloodSplatter(ctx, rnd, rnd() > 0.5 ? w - 34 : 30, h * (0.2 + rnd() * 0.6), 28 + rnd() * 26, 0.9)

  const edge = ctx.createLinearGradient(0, 0, 0, h)
  edge.addColorStop(0, 'rgba(0,0,0,0.35)')
  edge.addColorStop(0.08, 'rgba(0,0,0,0)')
  edge.addColorStop(0.92, 'rgba(0,0,0,0)')
  edge.addColorStop(1, 'rgba(0,0,0,0.4)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, w, h)
}

function drawCardBack(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(4242)

  const base = ctx.createLinearGradient(0, 0, w, h)
  base.addColorStop(0, '#2a1210')
  base.addColorStop(0.5, '#3a1713')
  base.addColorStop(1, '#170a08')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(150,110,58,0.35)'
  ctx.lineWidth = 1
  for (let i = -h; i < w; i += 18) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + h, h)
    ctx.stroke()
  }
  for (let i = 0; i < w + h; i += 18) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i - h, h)
    ctx.stroke()
  }

  noise(ctx, w, h, rnd, 2000)

  ctx.strokeStyle = 'rgba(198,156,88,0.75)'
  ctx.lineWidth = 3
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.strokeStyle = 'rgba(198,156,88,0.3)'
  ctx.lineWidth = 1
  ctx.strokeRect(17, 17, w - 34, h - 34)

  const cx = w / 2
  const cy = h / 2
  ctx.strokeStyle = 'rgba(212,170,96,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, 76, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 58, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = 'rgba(10,4,4,0.7)'
  ctx.beginPath()
  ctx.ellipse(cx, cy, 40, 21, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(208,164,88,0.85)'
  ctx.beginPath()
  ctx.arc(cx, cy, 12, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(20,6,6,0.9)'
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()

  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2
    ctx.fillStyle = 'rgba(198,156,88,0.35)'
    ctx.beginPath()
    ctx.arc(cx + Math.cos(angle) * 92, cy + Math.sin(angle) * 92, 2, 0, Math.PI * 2)
    ctx.fill()
  }

  scratches(ctx, rnd, w, h, 30)
  bloodSplatter(ctx, rnd, w * 0.78, h * 0.25, 40, 0.8)

  const shade = ctx.createRadialGradient(cx, cy, h * 0.15, cx, cy, h * 0.75)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.68)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)
}

function drawTable(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(90210)

  const base = ctx.createLinearGradient(0, 0, w, h)
  base.addColorStop(0, '#332b26')
  base.addColorStop(0.45, '#292220')
  base.addColorStop(1, '#1b1614')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < 900; i += 1) {
    ctx.strokeStyle = `rgba(${140 + Math.floor(rnd() * 60)},${120 + Math.floor(rnd() * 50)},${100 + Math.floor(rnd() * 40)},${0.02 + rnd() * 0.05})`
    ctx.lineWidth = 0.5 + rnd()
    const y = rnd() * h
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y + (rnd() - 0.5) * 6)
    ctx.stroke()
  }

  for (let i = 0; i < 26; i += 1) {
    const cx = rnd() * w
    const cy = rnd() * h
    const r = 18 + rnd() * 90
    const rust = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    rust.addColorStop(0, `rgba(${110 + Math.floor(rnd() * 40)},${52 + Math.floor(rnd() * 24)},18,${0.16 + rnd() * 0.22})`)
    rust.addColorStop(0.6, `rgba(88,40,16,${0.08 + rnd() * 0.1})`)
    rust.addColorStop(1, 'rgba(60,28,12,0)')
    ctx.fillStyle = rust
    ctx.beginPath()
    ctx.ellipse(cx, cy, r, r * (0.5 + rnd() * 0.7), rnd() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(18,12,10,0.5)'
  ctx.lineWidth = 3
  ctx.strokeRect(26, 26, w - 52, h - 52)
  ctx.strokeStyle = 'rgba(220,200,170,0.08)'
  ctx.lineWidth = 1
  ctx.strokeRect(30, 30, w - 60, h - 60)

  const rivetSpots: ReadonlyArray<readonly [number, number]> = [
    [40, 40], [w / 2, 40], [w - 40, 40],
    [40, h / 2], [w - 40, h / 2],
    [40, h - 40], [w / 2, h - 40], [w - 40, h - 40],
  ]
  for (const [x, y] of rivetSpots) {
    const rv = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 9)
    rv.addColorStop(0, '#7d7168')
    rv.addColorStop(0.6, '#413934')
    rv.addColorStop(1, '#191413')
    ctx.fillStyle = rv
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(232,206,160,0.1)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, h * 0.31, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, h * 0.31 + 4, 0, Math.PI * 2)
  ctx.stroke()

  for (let i = 0; i < 5; i += 1) {
    bloodSplatter(ctx, rnd, rnd() * w, rnd() * h, 30 + rnd() * 70, 0.55 + rnd() * 0.4)
  }
  scratches(ctx, rnd, w, h, 70)
  noise(ctx, w, h, rnd, 6000)

  const shade = ctx.createRadialGradient(w / 2, h / 2, h * 0.18, w / 2, h / 2, h * 0.78)
  shade.addColorStop(0, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.72)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)
}

function drawMaskOne(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(101)

  ctx.clearRect(0, 0, w, h)
  const face = ctx.createRadialGradient(w * 0.42, h * 0.35, 20, w / 2, h / 2, h * 0.52)
  face.addColorStop(0, '#e6dcc6')
  face.addColorStop(0.65, '#cbbda2')
  face.addColorStop(1, '#8d8069')
  ctx.fillStyle = face
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w * 0.31, h * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(0,0,0,0.8)'
  ctx.beginPath()
  ctx.ellipse(w * 0.4, h * 0.42, 26, 16, -0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(w * 0.6, h * 0.42, 26, 16, 0.18, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(120,20,14,0.7)'
  ctx.beginPath()
  ctx.arc(w * 0.4, h * 0.45, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(w * 0.6, h * 0.45, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(40,30,24,0.85)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(w * 0.33, h * 0.63)
  ctx.quadraticCurveTo(w / 2, h * 0.72, w * 0.67, h * 0.63)
  ctx.stroke()
  ctx.lineWidth = 2
  for (let i = 0; i < 7; i += 1) {
    const x = w * 0.36 + i * (w * 0.28) / 6
    const y = h * 0.655 + Math.sin(i * 1.1) * 6
    ctx.beginPath()
    ctx.moveTo(x - 6, y - 8)
    ctx.lineTo(x + 6, y + 8)
    ctx.stroke()
  }

  ctx.strokeStyle = 'rgba(52,40,32,0.7)'
  ctx.lineWidth = 2.5
  const cracks: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
    [[w * 0.24, h * 0.2], [w * 0.34, h * 0.33], [w * 0.3, h * 0.46], [w * 0.38, h * 0.56]],
    [[w * 0.7, h * 0.18], [w * 0.64, h * 0.3], [w * 0.7, h * 0.4], [w * 0.66, h * 0.52]],
    [[w * 0.5, h * 0.22], [w * 0.46, h * 0.34]],
  ]
  for (const path of cracks) {
    ctx.beginPath()
    path.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  for (let i = 0; i < 3; i += 1) {
    bloodSplatter(ctx, rnd, w * (0.4 + rnd() * 0.2), h * (0.5 + rnd() * 0.3), 16 + rnd() * 16, 0.8)
  }
  ctx.strokeStyle = 'rgba(112,20,16,0.5)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(w * 0.43, h * 0.47)
  ctx.lineTo(w * 0.41, h * 0.62)
  ctx.stroke()

  noise(ctx, w, h, rnd, 1400)
}

function drawMaskTwo(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(202)

  ctx.clearRect(0, 0, w, h)
  const brass = ctx.createLinearGradient(w * 0.2, h * 0.1, w * 0.8, h * 0.9)
  brass.addColorStop(0, '#8d6a33')
  brass.addColorStop(0.35, '#c69a50')
  brass.addColorStop(0.6, '#7b5a28')
  brass.addColorStop(1, '#4c3617')
  ctx.fillStyle = brass
  ctx.beginPath()
  ctx.ellipse(w / 2, h * 0.45, w * 0.33, h * 0.37, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#2a1a0c'
  ctx.beginPath()
  ctx.moveTo(w * 0.5, h * 0.58)
  ctx.quadraticCurveTo(w * 0.72, h * 0.62, w * 0.62, h * 0.92)
  ctx.quadraticCurveTo(w * 0.5, h * 0.98, w * 0.38, h * 0.92)
  ctx.quadraticCurveTo(w * 0.28, h * 0.62, w * 0.5, h * 0.58)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(230,190,110,0.35)'
  ctx.lineWidth = 3
  ctx.stroke()

  for (let i = 0; i < 5; i += 1) {
    ctx.strokeStyle = 'rgba(20,12,6,0.7)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(w * (0.42 + i * 0.04), h * 0.86)
    ctx.lineTo(w * (0.44 + i * 0.03), h * 0.68)
    ctx.stroke()
  }

  for (const cx of [w * 0.37, w * 0.63]) {
    const lens = ctx.createRadialGradient(cx - 6, h * 0.39, 2, cx, h * 0.41, 34)
    lens.addColorStop(0, '#cfe6c4')
    lens.addColorStop(0.5, '#54724b')
    lens.addColorStop(1, '#101a10')
    ctx.fillStyle = lens
    ctx.beginPath()
    ctx.arc(cx, h * 0.41, 32, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#3a2712'
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.fillStyle = 'rgba(220,60,40,0.75)'
    ctx.beginPath()
    ctx.arc(cx + 6, h * 0.41 + 4, 3.5, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2
    const rx = w / 2 + Math.cos(angle) * w * 0.3
    const ry = h * 0.45 + Math.sin(angle) * h * 0.33
    const rv = ctx.createRadialGradient(rx - 1, ry - 1, 0, rx, ry, 5)
    rv.addColorStop(0, '#f0d49a')
    rv.addColorStop(1, '#43301a')
    ctx.fillStyle = rv
    ctx.beginPath()
    ctx.arc(rx, ry, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  scratches(ctx, rnd, w, h, 40)
  noise(ctx, w, h, rnd, 1600)
}

function drawMaskThree(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(303)

  ctx.clearRect(0, 0, w, h)
  const iron = ctx.createRadialGradient(w * 0.45, h * 0.3, 20, w / 2, h / 2, h * 0.55)
  iron.addColorStop(0, '#4a413c')
  iron.addColorStop(0.6, '#2a2320')
  iron.addColorStop(1, '#100c0b')
  ctx.fillStyle = iron
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w * 0.32, h * 0.42, 0, 0, Math.PI * 2)
  ctx.fill()

  for (const dir of [-1, 1]) {
    ctx.fillStyle = '#241c18'
    ctx.beginPath()
    ctx.moveTo(w / 2 + dir * w * 0.16, h * 0.24)
    ctx.quadraticCurveTo(w / 2 + dir * w * 0.46, h * 0.06, w / 2 + dir * w * 0.52, h * 0.3)
    ctx.quadraticCurveTo(w / 2 + dir * w * 0.36, h * 0.24, w / 2 + dir * w * 0.22, h * 0.34)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(200,140,70,0.28)'
    ctx.lineWidth = 2
    ctx.stroke()
  }

  for (const cx of [w * 0.39, w * 0.61]) {
    const glow = ctx.createRadialGradient(cx, h * 0.42, 2, cx, h * 0.42, 26)
    glow.addColorStop(0, '#ffb070')
    glow.addColorStop(0.35, '#d0261c')
    glow.addColorStop(1, 'rgba(60,4,2,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, h * 0.42, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#120404'
    ctx.beginPath()
    ctx.ellipse(cx, h * 0.42, 11, 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.fillStyle = '#0a0605'
  ctx.beginPath()
  ctx.moveTo(w * 0.3, h * 0.6)
  ctx.quadraticCurveTo(w / 2, h * 0.72, w * 0.7, h * 0.6)
  ctx.quadraticCurveTo(w * 0.62, h * 0.82, w / 2, h * 0.84)
  ctx.quadraticCurveTo(w * 0.38, h * 0.82, w * 0.3, h * 0.6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#cdbfa4'
  for (let i = 0; i < 8; i += 1) {
    const x = w * 0.36 + i * (w * 0.28) / 7
    const y = h * 0.655 + Math.sin(i * 1.3) * 4
    ctx.beginPath()
    ctx.moveTo(x - 6, y)
    ctx.lineTo(x, y + 16 + (i % 2) * 6)
    ctx.lineTo(x + 6, y)
    ctx.closePath()
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(210,90,40,0.22)'
  ctx.lineWidth = 2
  for (let i = 0; i < 8; i += 1) {
    ctx.beginPath()
    ctx.moveTo(w * 0.22, h * (0.2 + i * 0.07))
    ctx.lineTo(w * 0.78, h * (0.16 + i * 0.075))
    ctx.stroke()
  }

  scratches(ctx, rnd, w, h, 60)
  noise(ctx, w, h, rnd, 2000)
}

function drawDust(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2)
  grad.addColorStop(0, 'rgba(255,238,204,0.95)')
  grad.addColorStop(0.35, 'rgba(255,226,176,0.45)')
  grad.addColorStop(1, 'rgba(255,220,160,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
}

/** 入场纸片：撕去左半的血契残页，只剩一个「棠」字 */
function drawCorridorWall(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(307)
  ctx.fillStyle = '#3a4038'
  ctx.fillRect(0, 0, w, h)
  noise(ctx, w, h, rnd, 2600)
  // 大面积水渍竖痕：上深下浅的脏水挂流
  for (let i = 0; i < 26; i += 1) {
    const x = rnd() * w
    const sw = 6 + rnd() * 30
    const y0 = rnd() * h * 0.5
    const len = h * (0.3 + rnd() * 0.7)
    const grad = ctx.createLinearGradient(x, y0, x, y0 + len)
    grad.addColorStop(0, `rgba(18,22,16,${0.25 + rnd() * 0.3})`)
    grad.addColorStop(1, 'rgba(18,22,16,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x - sw / 2, y0, sw, len)
  }
  // 霉斑群
  for (let i = 0; i < 40; i += 1) {
    const x = rnd() * w
    const y = h * 0.55 + rnd() * h * 0.45
    ctx.fillStyle = `rgba(16,24,14,${0.2 + rnd() * 0.3})`
    ctx.beginPath()
    ctx.ellipse(x, y, 2 + rnd() * 14, 2 + rnd() * 9, rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // 裂缝：折线带分叉
  for (let i = 0; i < 7; i += 1) {
    let x = rnd() * w
    let y = rnd() * h * 0.4
    ctx.strokeStyle = 'rgba(12,14,10,0.55)'
    ctx.lineWidth = 0.8 + rnd()
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let k = 0; k < 9; k += 1) {
      x += (rnd() - 0.5) * 26
      y += 8 + rnd() * 22
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // 剥漆片：边缘翘起亮边的不规则斑
  for (let i = 0; i < 12; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    const rw = 8 + rnd() * 26
    const rh = 6 + rnd() * 20
    ctx.fillStyle = 'rgba(52,56,46,0.85)'
    ctx.beginPath()
    for (let k = 0; k < 7; k += 1) {
      const a = (k / 7) * Math.PI * 2
      const px = x + Math.cos(a) * rw * (0.6 + rnd() * 0.6)
      const py = y + Math.sin(a) * rh * (0.6 + rnd() * 0.6)
      if (k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(14,16,12,0.6)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
}

function drawCorridorFloor(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(409)
  ctx.fillStyle = '#26282a'
  ctx.fillRect(0, 0, w, h)
  noise(ctx, w, h, rnd, 2400)
  // 砖缝
  ctx.strokeStyle = 'rgba(8,10,10,0.85)'
  ctx.lineWidth = 3
  for (const p of [0, 0.5, 1]) {
    ctx.beginPath()
    ctx.moveTo(w * p, 0)
    ctx.lineTo(w * p, h)
    ctx.moveTo(0, h * p)
    ctx.lineTo(w, h * p)
    ctx.stroke()
  }
  // 砖面边缘磨亮
  ctx.strokeStyle = 'rgba(70,74,70,0.25)'
  ctx.lineWidth = 1
  for (const x of [0.25, 0.75]) {
    for (const y of [0.25, 0.75]) {
      ctx.strokeRect(w * (x - 0.24), h * (y - 0.24), w * 0.48, h * 0.48)
    }
  }
  for (let i = 0; i < 30; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    ctx.fillStyle = `rgba(10,14,12,${0.15 + rnd() * 0.25})`
    ctx.beginPath()
    ctx.ellipse(x, y, 4 + rnd() * 30, 3 + rnd() * 16, rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  bloodSplatter(ctx, rnd, w * 0.7, h * 0.6, w * 0.25, 0.12)
}

function drawCorridorDoor(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(503)
  ctx.fillStyle = '#2e2118'
  ctx.fillRect(0, 0, w, h)
  // 纵向木纹
  for (let x = 0; x < w; x += 3) {
    const shade = rnd()
    ctx.fillStyle = `rgba(${18 + shade * 30},${12 + shade * 20},${8 + shade * 12},0.5)`
    ctx.fillRect(x, 0, 2, h)
  }
  for (let i = 0; i < 40; i += 1) {
    const x = rnd() * w
    ctx.strokeStyle = `rgba(12,8,5,${0.2 + rnd() * 0.3})`
    ctx.lineWidth = 0.6 + rnd()
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.bezierCurveTo(x + 6, h * 0.3, x - 6, h * 0.6, x + 2, h)
    ctx.stroke()
  }
  noise(ctx, w, h, rnd, 1500)
  // 剥漆块与底部水浸
  for (let i = 0; i < 16; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    ctx.fillStyle = `rgba(20,14,10,${0.3 + rnd() * 0.3})`
    ctx.fillRect(x, y, 3 + rnd() * 14, 2 + rnd() * 8)
  }
  const grad = ctx.createLinearGradient(0, h * 0.7, 0, h)
  grad.addColorStop(0, 'rgba(8,10,8,0)')
  grad.addColorStop(1, 'rgba(8,10,8,0.75)')
  ctx.fillStyle = grad
  ctx.fillRect(0, h * 0.7, w, h * 0.3)
}

function drawCorridorRust(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(607)
  ctx.fillStyle = '#3a2417'
  ctx.fillRect(0, 0, w, h)
  noise(ctx, w, h, rnd, 1800)
  for (let i = 0; i < 60; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    ctx.fillStyle = `rgba(${90 + rnd() * 60},${40 + rnd() * 26},${16 + rnd() * 12},${0.2 + rnd() * 0.35})`
    ctx.beginPath()
    ctx.ellipse(x, y, 2 + rnd() * 9, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2)
    ctx.fill()
  }
  // 残存漆皮与金属划痕
  for (let i = 0; i < 20; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    ctx.fillStyle = 'rgba(40,46,40,0.7)'
    ctx.fillRect(x, y, 3 + rnd() * 10, 2 + rnd() * 7)
  }
  for (let i = 0; i < 24; i += 1) {
    const x = rnd() * w
    const y = rnd() * h
    ctx.strokeStyle = 'rgba(120,110,96,0.35)'
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rnd() - 0.5) * 30, y + rnd() * 8)
    ctx.stroke()
  }
}

function drawHandSilhouette(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(9,5,4,0.96)'
  // 手掌
  ctx.beginPath()
  ctx.ellipse(w * 0.5, h * 0.66, w * 0.21, h * 0.26, -0.12, 0, Math.PI * 2)
  ctx.fill()
  // 四指：根部分开、指尖略张
  const fingers: Array<[number, number, number, number, number]> = [
    [0.34, 0.47, 0.055, 0.3, -0.22],
    [0.46, 0.4, 0.058, 0.36, -0.07],
    [0.58, 0.42, 0.055, 0.33, 0.08],
    [0.69, 0.5, 0.048, 0.24, 0.2],
  ]
  for (const [cx, cy, rw, rh, rot] of fingers) {
    ctx.beginPath()
    ctx.ellipse(w * cx, h * cy, w * rw, h * rh, rot, 0, Math.PI * 2)
    ctx.fill()
  }
  // 拇指
  ctx.beginPath()
  ctx.ellipse(w * 0.27, h * 0.68, w * 0.06, h * 0.16, 0.65, 0, Math.PI * 2)
  ctx.fill()
  // 手腕延伸到画面下缘
  ctx.beginPath()
  ctx.moveTo(w * 0.36, h * 0.82)
  ctx.lineTo(w * 0.64, h * 0.82)
  ctx.lineTo(w * 0.7, h)
  ctx.lineTo(w * 0.3, h)
  ctx.closePath()
  ctx.fill()
}

function drawTallyList(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(913)
  ctx.fillStyle = '#241f1a'
  ctx.fillRect(0, 0, w, h)
  noise(ctx, w, h, rnd, 700)
  // 四角铆钉
  ctx.fillStyle = 'rgba(120,110,96,0.6)'
  for (const [x, y] of [
    [0.08, 0.05],
    [0.92, 0.05],
    [0.08, 0.95],
    [0.92, 0.95],
  ]) {
    ctx.beginPath()
    ctx.arc(w * x, h * y, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  // 前几行：划花的名字（不可读）+ 正字计数，整行再斜划一道勾销
  for (let row = 0; row < 5; row += 1) {
    const y = h * (0.16 + row * 0.1)
    ctx.strokeStyle = 'rgba(160,150,130,0.3)'
    ctx.lineWidth = 1.6
    for (let i = 0; i < 6; i += 1) {
      const x = w * (0.14 + i * 0.055)
      ctx.beginPath()
      ctx.moveTo(x, y - 6 + rnd() * 4)
      ctx.lineTo(x + 3 + rnd() * 5, y + 5 - rnd() * 4)
      ctx.stroke()
    }
    for (let i = 0; i < 4; i += 1) {
      const x = w * (0.62 + i * 0.05)
      ctx.beginPath()
      ctx.moveTo(x, y - 7)
      ctx.lineTo(x + 2, y + 6)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(150,138,120,0.4)'
    ctx.beginPath()
    ctx.moveTo(w * 0.1, y + 4)
    ctx.lineTo(w * 0.86, y - 6)
    ctx.stroke()
  }
  // 末位：小棠——唯一清晰可读的名字
  ctx.fillStyle = 'rgba(217,207,190,0.92)'
  ctx.font = `${Math.floor(h * 0.085)}px Georgia, serif`
  ctx.textBaseline = 'middle'
  ctx.fillText('小棠', w * 0.14, h * 0.7)
  // 下一行：空白新刻痕——只有一道新鲜亮刻，名字的位置空着
  ctx.strokeStyle = 'rgba(236,226,205,0.85)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(w * 0.16, h * 0.79)
  ctx.lineTo(w * 0.19, h * 0.86)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(160,150,130,0.25)'
  ctx.lineWidth = 1
  ctx.strokeRect(w * 0.12, h * 0.76, w * 0.5, h * 0.13)
}

function drawPaperScrap(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(77)
  ctx.clearRect(0, 0, w, h)
  // 撕边：左侧锯齿状透明缺口
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(w * 0.3, 0)
  for (let y = 0; y <= h; y += 12) {
    ctx.lineTo(w * (0.24 + rnd() * 0.14), y)
  }
  ctx.lineTo(w, h)
  ctx.lineTo(w, 0)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = '#c9b998'
  ctx.fillRect(0, 0, w, h)
  noise(ctx, w, h, rnd, 900)
  bloodSplatter(ctx, rnd, w * 0.82, h * 0.9, w * 0.2, 0.22)
  ctx.strokeStyle = 'rgba(90,70,50,0.35)'
  ctx.lineWidth = 2
  for (let i = 1; i < 4; i += 1) {
    ctx.beginPath()
    ctx.moveTo(w * 0.34, h * (0.2 + i * 0.18))
    ctx.lineTo(w * 0.92, h * (0.2 + i * 0.18))
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(38,26,20,0.88)'
  ctx.font = `${Math.floor(h * 0.34)}px Georgia, serif`
  ctx.textBaseline = 'middle'
  ctx.fillText('棠', w * 0.56, h * 0.47)
  // 撕边纤维
  ctx.strokeStyle = 'rgba(220,205,175,0.5)'
  ctx.lineWidth = 1
  for (let i = 0; i < 26; i += 1) {
    const y = rnd() * h
    ctx.beginPath()
    ctx.moveTo(w * (0.24 + rnd() * 0.1), y)
    ctx.lineTo(w * (0.2 + rnd() * 0.08), y + (rnd() - 0.5) * 8)
    ctx.stroke()
  }
  ctx.restore()
}

/** 毛巾：绣着「棠」字；readable=false 时绣字模糊不可读（第一章） */
function drawTowel(canvas: HTMLCanvasElement, readable: boolean): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(131)
  ctx.fillStyle = '#b7ab97'
  ctx.fillRect(0, 0, w, h)
  // 织物纹 + 褶皱明暗
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`
    ctx.fillRect(0, y, w, 1)
  }
  for (let i = 0; i < 5; i += 1) {
    const x = (i + 0.5) * (w / 5)
    const grad = ctx.createLinearGradient(x - w * 0.09, 0, x + w * 0.09, 0)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(0.5, `rgba(40,32,24,${0.16 + rnd() * 0.1})`)
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x - w * 0.09, 0, w * 0.18, h)
  }
  noise(ctx, w, h, rnd, 700)
  bloodSplatter(ctx, rnd, w * 0.2, h * 0.86, w * 0.16, 0.3)
  ctx.save()
  if (!readable) ctx.filter = 'blur(5px)'
  ctx.fillStyle = readable ? 'rgba(122,42,30,0.85)' : 'rgba(122,42,30,0.4)'
  ctx.font = `${Math.floor(h * 0.3)}px Georgia, serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('棠', w * 0.5, h * 0.42)
  ctx.restore()
}

/** 桌面上的手印形污渍：掌印 + 五指拖痕 */
function drawHandprint(canvas: HTMLCanvasElement): void {
  const ctx = getContext(canvas)
  const w = canvas.width
  const h = canvas.height
  const rnd = mulberry32(219)
  ctx.clearRect(0, 0, w, h)
  const smudge = (cx: number, cy: number, rx: number, ry: number, rot: number, a: number) => {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry))
    grad.addColorStop(0, `rgba(78,14,12,${a})`)
    grad.addColorStop(0.7, `rgba(60,10,10,${a * 0.55})`)
    grad.addColorStop(1, 'rgba(50,8,8,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2)
    ctx.fill()
  }
  smudge(w * 0.5, h * 0.62, w * 0.2, h * 0.24, 0.1, 0.5)
  const fingers: ReadonlyArray<readonly [number, number, number]> = [
    [0.3, 0.3, -0.35], [0.42, 0.22, -0.15], [0.55, 0.18, 0], [0.68, 0.22, 0.15], [0.78, 0.34, 0.4],
  ]
  for (const [fx, fy, rot] of fingers) {
    smudge(w * fx, h * fy, w * 0.055, h * 0.13, rot, 0.42)
  }
  // 拖拽抹痕
  ctx.strokeStyle = 'rgba(70,12,10,0.28)'
  ctx.lineCap = 'round'
  for (let i = 0; i < 7; i += 1) {
    ctx.lineWidth = 2 + rnd() * 5
    ctx.beginPath()
    ctx.moveTo(w * (0.3 + rnd() * 0.4), h * (0.5 + rnd() * 0.3))
    ctx.lineTo(w * (0.2 + rnd() * 0.6), h * (0.75 + rnd() * 0.2))
    ctx.stroke()
  }
  // 五指向桌沿抠扯的深拖痕：从每根指尖向下后方拉出，比掌印拖痕更长更锐
  for (const [fx, fy] of fingers) {
    const x = w * fx
    const y = h * fy
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.strokeStyle = pass === 0 ? 'rgba(58,8,8,0.5)' : 'rgba(96,20,16,0.32)'
      ctx.lineWidth = pass === 0 ? 5 + rnd() * 3 : 2 + rnd() * 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.bezierCurveTo(
        x + w * 0.01,
        y + h * 0.2,
        x - w * 0.02,
        y + h * 0.36,
        x - w * 0.035,
        y + h * 0.52,
      )
      ctx.stroke()
    }
  }
}

export class TextureFactory {
  private readonly cache = new Map<string, THREE.Texture>()
  private readonly listeners = new Set<(key: string, texture: THREE.Texture) => void>()
  private readonly etags = new Map<string, string>()
  private watchTimer: number | null = null
  private disposed = false

  get(key: string): THREE.Texture {
    const existing = this.cache.get(key)
    if (existing) return existing
    const texture = this.build(key)
    this.cache.set(key, texture)
    return texture
  }

  get cardBackKey(): string {
    return 'card-back'
  }

  cardKey(rank: CardRank, suit: CardSuit): string {
    return `card-${suit}-${rank}`
  }

  maskKey(levelIndex: number): string {
    return `mask-${Math.min(3, Math.max(1, levelIndex + 1))}`
  }

  onOverride(listener: (key: string, texture: THREE.Texture) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 开发期贴图热替换：每 2.5 秒用 HEAD 探测 public/assets 下是否有同名覆盖图。
   * 这是本地开发工具，不是后台请求；生产构建不会启动轮询。
   */
  startWatching(): void {
    if (this.watchTimer !== null || this.disposed) return
    void this.scan(true)
    if (import.meta.env.DEV) {
      this.watchTimer = window.setInterval(() => {
        if (document.hidden) return
        void this.scan(false)
      }, 2500)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.watchTimer !== null) {
      window.clearInterval(this.watchTimer)
      this.watchTimer = null
    }
    this.listeners.clear()
    for (const texture of this.cache.values()) texture.dispose()
    this.cache.clear()
  }

  private build(key: string): THREE.Texture {
    if (key === 'table') return this.buildCanvasTexture(1024, 1024, (canvas) => drawTable(canvas))
    if (key === 'card-back') return this.buildCanvasTexture(CARD_W, CARD_H, (canvas) => drawCardBack(canvas))
    if (key === 'dust') return this.buildCanvasTexture(64, 64, (canvas) => drawDust(canvas))
    if (key === 'paper-scrap') return this.buildCanvasTexture(256, 256, (canvas) => drawPaperScrap(canvas))
    if (key === 'towel-blurry') return this.buildCanvasTexture(256, 256, (canvas) => drawTowel(canvas, false))
    if (key === 'towel-readable') return this.buildCanvasTexture(256, 256, (canvas) => drawTowel(canvas, true))
    if (key === 'handprint') return this.buildCanvasTexture(256, 256, (canvas) => drawHandprint(canvas))
    if (key === 'tally-list') return this.buildCanvasTexture(256, 384, (canvas) => drawTallyList(canvas))
    if (key === 'hand-silhouette') return this.buildCanvasTexture(256, 256, (canvas) => drawHandSilhouette(canvas))
    if (key === 'corridor-wall') return this.buildCanvasTexture(512, 512, (canvas) => drawCorridorWall(canvas))
    if (key === 'corridor-floor') return this.buildCanvasTexture(512, 512, (canvas) => drawCorridorFloor(canvas))
    if (key === 'corridor-door') return this.buildCanvasTexture(256, 512, (canvas) => drawCorridorDoor(canvas))
    if (key === 'corridor-rust') return this.buildCanvasTexture(256, 256, (canvas) => drawCorridorRust(canvas))
    if (key.startsWith('mask-')) {
      const index = Number(key.slice(5))
      return this.buildCanvasTexture(384, 384, (canvas) => {
        if (index === 2) drawMaskTwo(canvas)
        else if (index === 3) drawMaskThree(canvas)
        else drawMaskOne(canvas)
      })
    }
    const cardMatch = /^card-(spade|heart|diamond|club)-(10|[1-9])$/.exec(key)
    if (cardMatch) {
      const suit = cardMatch[1] as CardSuit
      const rank = Number(cardMatch[2]) as CardRank
      return this.buildCanvasTexture(CARD_W, CARD_H, (canvas) => drawCardFace(canvas, rank, suit))
    }
    return this.buildCanvasTexture(64, 64, (canvas) => drawDust(canvas))
  }

  private buildCanvasTexture(
    width: number,
    height: number,
    paint: (canvas: HTMLCanvasElement) => void,
  ): THREE.CanvasTexture {
    const canvas = createCanvas(width, height)
    paint(canvas)
    return this.registerCanvasTexture(canvas)
  }

  private registerCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    texture.needsUpdate = true
    return texture
  }

  private async scan(first: boolean): Promise<void> {
    if (this.disposed) return
    const keys = new Set<string>(BASE_KEYS)
    for (const key of this.cache.keys()) keys.add(key)
    await Promise.all([...keys].map((key) => this.checkOverride(key, first)))
  }

  private async checkOverride(key: string, force: boolean): Promise<void> {
    if (this.disposed) return
    const url = `${import.meta.env.BASE_URL}assets/${key}.png`
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      if (!res.ok) return
      const type = res.headers.get('content-type') ?? ''
      if (!type.startsWith('image')) return
      const etag = res.headers.get('etag') ?? res.headers.get('last-modified') ?? ''
      if (!force && this.etags.get(key) === etag) return
      this.etags.set(key, etag)
      await this.loadOverride(key, etag ? `${url}?v=${encodeURIComponent(etag)}` : url)
    } catch {
      // Missing override is the normal case.
    }
  }

  private loadOverride(key: string, url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        if (this.disposed) {
          resolve()
          return
        }
        const texture = new THREE.Texture(img)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        texture.needsUpdate = true
        const previous = this.cache.get(key)
        this.cache.set(key, texture)
        for (const listener of this.listeners) listener(key, texture)
        if (previous && previous !== texture) previous.dispose()
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })
  }
}
