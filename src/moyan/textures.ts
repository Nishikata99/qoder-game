import * as THREE from 'three'
import {
  ITEM_NAMES,
  ORGAN_NAMES,
  PENALTY_ITEMS,
  type ItemId,
  type Organ,
} from './content'
import { paintPixelArt, pixelArtMetrics, type PixelArtKey } from '../scene/PixelArt'

export type CellVisual =
  | { readonly kind: 'back'; readonly heart: boolean }
  | { readonly kind: 'venom'; readonly source: boolean }
  | { readonly kind: 'cleared' }
  | { readonly kind: 'wall'; readonly organ: Organ | null }
  | { readonly kind: 'heart' }
  | { readonly kind: 'organ'; readonly organ: Organ }
  | { readonly kind: 'item'; readonly item: ItemId }
  | { readonly kind: 'wet'; readonly item: ItemId }

const SIZE = 256

/** 道具牌洗过之后保留的液体膜浓度：能看出浸过毒，又不遮挡道具。 */
export const WET_ALPHA = 0.24

export interface CellLayer {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly artwork: HTMLCanvasElement
  readonly texture: THREE.CanvasTexture
}

function keyOf(visual: CellVisual): string {
  switch (visual.kind) {
    case 'back':
      return visual.heart ? 'back-heart' : 'back'
    case 'venom':
      return visual.source ? 'source' : 'venom'
    case 'wall':
      return `wall-${visual.organ ?? 'none'}`
    case 'organ':
      return `organ-${visual.organ}`
    case 'item':
      return `item-${visual.item}`
    case 'wet':
      return `wet-${visual.item}`
    default:
      return visual.kind
  }
}

function drawFrame(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = 'rgba(122,198,106,0.22)'
  ctx.lineWidth = 3
  ctx.strokeRect(7, 7, SIZE - 14, SIZE - 14)
  ctx.strokeStyle = 'rgba(122,198,106,0.08)'
  ctx.lineWidth = 1
  ctx.strokeRect(14, 14, SIZE - 28, SIZE - 28)
}

function drawBase(ctx: CanvasRenderingContext2D, tint: string): void {
  const base = ctx.createRadialGradient(SIZE / 2, SIZE * 0.42, 12, SIZE / 2, SIZE / 2, SIZE * 0.72)
  base.addColorStop(0, tint)
  base.addColorStop(1, '#060b08')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, SIZE, SIZE)
  drawFrame(ctx)
}

function drawPixelIcon(
  ctx: CanvasRenderingContext2D,
  key: PixelArtKey,
  centerX: number,
  centerY: number,
  scale: number,
  alpha = 1,
): void {
  const metrics = pixelArtMetrics(key)
  ctx.save()
  ctx.globalAlpha = alpha
  paintPixelArt(ctx, key, centerX - (metrics.width * scale) / 2, centerY - (metrics.height * scale) / 2, scale)
  ctx.restore()
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  ctx.save()
  ctx.font = 'bold 30px "Microsoft YaHei", "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, SIZE / 2, SIZE - 30)
  ctx.restore()
}

// 心脏和四个器官同出 PixelArt 的 32×32 像素表，按器官卡面的同一套画法绘制
function paintHeartFace(ctx: CanvasRenderingContext2D): void {
  drawBase(ctx, '#141026')
  drawPixelIcon(ctx, 'heart', SIZE / 2, SIZE / 2 - 10, 5, 1)
  drawLabel(ctx, '心脏', 'rgba(224,123,111,0.95)')
}

// 牌背血肉纹理：TPeebles《Flesh & Bone》CC BY 4.0
// https://tpeebles.itch.io/flesh-bone-asset-pack —— 发布前需在游戏内署名
const FLESH_PALETTE: Readonly<Record<string, string>> = {
  A: '#a71e1e',
  B: '#af2222',
  C: '#821919',
  D: '#9b1a1a',
  E: '#8a1e1e',
  F: '#8b1414',
  G: '#8f2121',
  H: '#781313',
  I: '#d9c9b8',
  J: '#cdb6a7',
  K: '#b52424',
  L: '#6b0b0b',
  M: '#bc9b8e',
  N: '#760c0c',
  O: '#932323',
  P: '#84443f',
}

const FLESH_TILE: readonly string[] = [
  'HCFHDADFHFNFDD',
  'CECCCJEDDHAAAC',
  'CCHEAJBAEGAAAC',
  'FDAEJBKGGGAEDE',
  'LCIIEKBGBGBACC',
  'LAJEEGGGBBACEE',
  'HDEBBGGGKGECAC',
  'HCCGBJIBBBOBCM',
  'LHDAJMAAKKGBAD',
  'FNFMMDEEBKBAAA',
  'FFPMDAEAIBAADD',
  'FFDDBBBIIBDDFF',
  'CCCEBBIIBDDFFD',
  'CCLAAAAACHHFNL',
]

let fleshTileCanvas: HTMLCanvasElement | null = null

function fleshTile(): HTMLCanvasElement {
  if (fleshTileCanvas) return fleshTileCanvas
  const canvas = document.createElement('canvas')
  canvas.width = 14
  canvas.height = 14
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  FLESH_TILE.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = FLESH_PALETTE[row[x]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(x, y, 1, 1)
    }
  })
  fleshTileCanvas = canvas
  return canvas
}

function drawFleshBack(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#0d1a12'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = 0.55
  ctx.drawImage(fleshTile(), 0, 0, 14, 14, 0, 0, SIZE, SIZE)
  ctx.restore()
  // 压暗 + 暗角，让血肉只作为底纹
  const shade = ctx.createRadialGradient(SIZE / 2, SIZE * 0.42, SIZE * 0.16, SIZE / 2, SIZE / 2, SIZE * 0.8)
  shade.addColorStop(0, 'rgba(7,12,9,0.12)')
  shade.addColorStop(0.55, 'rgba(6,10,8,0.4)')
  shade.addColorStop(1, 'rgba(4,7,6,0.8)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, SIZE, SIZE)
  drawFrame(ctx)
}

function drawBack(ctx: CanvasRenderingContext2D, heart: boolean): void {
  // 心脏位置本来公开，牌背直接画成心脏卡面，别让人误读成还没翻的普通牌
  if (heart) {
    paintHeartFace(ctx)
    return
  }
  drawFleshBack(ctx)
}

function drawVenom(ctx: CanvasRenderingContext2D, source: boolean): void {
  drawBase(ctx, source ? '#17532a' : '#103a1f')
  const glow = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 10, SIZE / 2, SIZE / 2, SIZE * 0.5)
  glow.addColorStop(0, source ? 'rgba(122,198,106,0.5)' : 'rgba(122,198,106,0.3)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SIZE, SIZE)
  drawPixelIcon(ctx, source ? 'source' : 'venom', SIZE / 2, SIZE / 2 - 8, source ? 10 : 9, 1)
  if (source) drawLabel(ctx, '毒源', 'rgba(184,230,184,0.85)')
}

// 洗牌用的液体层：半透明绿水 + 高光 + 暗涡，不带毒液牌面的图标和文字
function paintLiquid(ctx: CanvasRenderingContext2D): void {
  const tint = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  tint.addColorStop(0, 'rgba(38,120,64,0.55)')
  tint.addColorStop(0.55, 'rgba(24,96,50,0.45)')
  tint.addColorStop(1, 'rgba(10,52,26,0.6)')
  ctx.fillStyle = tint
  ctx.fillRect(0, 0, SIZE, SIZE)

  const blobs: ReadonlyArray<readonly [number, number, number, number, string, string]> = [
    [0.28, 0.34, 0.26, 0.2, '196,255,208', '120,200,140'],
    [0.68, 0.62, 0.22, 0.16, '180,250,196', '120,200,140'],
    [0.52, 0.14, 0.16, 0.14, '210,255,218', '120,200,140'],
    [0.18, 0.8, 0.2, 0.14, '170,240,188', '120,200,140'],
    [0.84, 0.24, 0.13, 0.12, '210,255,218', '120,200,140'],
    [0.45, 0.5, 0.3, 0.2, '4,26,14', '4,26,14'],
    [0.78, 0.86, 0.2, 0.18, '4,26,14', '4,26,14'],
    [0.12, 0.22, 0.17, 0.16, '4,26,14', '4,26,14'],
  ]
  for (const [bx, by, br, a, inner, outer] of blobs) {
    const x = bx * SIZE
    const y = by * SIZE
    const radius = br * SIZE
    const grad = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius)
    grad.addColorStop(0, `rgba(${inner},${a})`)
    grad.addColorStop(1, `rgba(${outer},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  ctx.save()
  ctx.lineCap = 'round'
  const streaks: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [26, 70, 96, 54, 0.22],
    [70, 150, 180, 120, 0.16],
    [40, 210, 130, 200, 0.12],
  ]
  for (const [x1, y1, x2, y2, a] of streaks) {
    ctx.strokeStyle = `rgba(220,255,225,${a})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.quadraticCurveTo((x1 + x2) / 2 + 18, (y1 + y2) / 2 - 14, x2, y2)
    ctx.stroke()
  }
  ctx.restore()
}

// 洗过之后保留下来的液体膜：道具仍清晰可读，只是牌面有一层湿绿
function drawWet(ctx: CanvasRenderingContext2D, item: ItemId): void {
  drawItem(ctx, item)
  ctx.save()
  ctx.globalAlpha = WET_ALPHA
  paintLiquid(ctx)
  ctx.restore()
}

function drawCleared(ctx: CanvasRenderingContext2D): void {
  drawBase(ctx, '#0a0f0c')
  ctx.fillStyle = 'rgba(44,58,49,0.9)'
  ctx.beginPath()
  ctx.arc(SIZE / 2, SIZE / 2, 10, 0, Math.PI * 2)
  ctx.fill()
}

function drawWall(ctx: CanvasRenderingContext2D, organ: Organ | null): void {
  drawBase(ctx, '#2a1f15')
  ctx.save()
  ctx.translate(SIZE / 2, SIZE / 2)
  ctx.rotate(Math.PI / 4)
  for (let i = -3; i <= 3; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(224,201,168,0.13)' : 'rgba(0,0,0,0.25)'
    ctx.fillRect(-SIZE, i * 28, SIZE * 2, 14)
  }
  ctx.restore()
  if (organ) drawPixelIcon(ctx, organ, SIZE / 2, SIZE / 2 - 10, 4, 0.5)
  drawLabel(ctx, organ ? `坏死墙·${ORGAN_NAMES[organ]}` : '坏死墙', 'rgba(224,201,168,0.75)')
}

function drawOrgan(ctx: CanvasRenderingContext2D, organ: Organ): void {
  drawBase(ctx, '#141026')
  drawPixelIcon(ctx, organ, SIZE / 2, SIZE / 2 - 10, 5, 1)
  drawLabel(ctx, ORGAN_NAMES[organ], 'rgba(196,176,255,0.9)')
}

function drawItem(ctx: CanvasRenderingContext2D, item: ItemId): void {
  drawBase(ctx, PENALTY_ITEMS.includes(item) ? '#2a1214' : '#1d1b10')
  drawPixelIcon(ctx, ITEM_ART[item], SIZE / 2, SIZE / 2 - 10, 5, 1)
  drawLabel(
    ctx,
    ITEM_NAMES[item],
    PENALTY_ITEMS.includes(item) ? 'rgba(224,123,111,0.95)' : 'rgba(232,204,106,0.95)',
  )
}

function drawHeart(ctx: CanvasRenderingContext2D): void {
  paintHeartFace(ctx)
}

const ITEM_ART: Readonly<Record<ItemId, PixelArtKey>> = {
  stethoscope: 'stethoscope',
  transplant: 'syringe',
  steal: 'forceps',
  adrenaline: 'adrenaline',
  fever: 'virus',
}

function paint(ctx: CanvasRenderingContext2D, visual: CellVisual): void {
  switch (visual.kind) {
    case 'back':
      drawBack(ctx, visual.heart)
      break
    case 'venom':
      drawVenom(ctx, visual.source)
      break
    case 'cleared':
      drawCleared(ctx)
      break
    case 'wall':
      drawWall(ctx, visual.organ)
      break
    case 'heart':
      drawHeart(ctx)
      break
    case 'organ':
      drawOrgan(ctx, visual.organ)
      break
    case 'item':
      drawItem(ctx, visual.item)
      break
    case 'wet':
      drawWet(ctx, visual.item)
      break
  }
}

export class MoyanTextures {
  private readonly cache = new Map<string, THREE.CanvasTexture>()
  private liquidCanvas: HTMLCanvasElement | null = null
  private sheenMap: THREE.CanvasTexture | null = null

  get(visual: CellVisual): THREE.CanvasTexture {
    const key = keyOf(visual)
    const cached = this.cache.get(key)
    if (cached) return cached
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    paint(ctx, visual)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    this.cache.set(key, texture)
    return texture
  }

  /** 每格独立的牌面层：完整牌面预渲染一次，逐帧动画只做裁切和叠加。 */
  createFaceLayer(visual: CellVisual): CellLayer {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    const artwork = document.createElement('canvas')
    artwork.width = SIZE
    artwork.height = SIZE
    const artCtx = artwork.getContext('2d')
    if (!artCtx) throw new Error('2D canvas context unavailable')
    paint(artCtx, visual)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return { canvas, ctx, artwork, texture }
  }

  /** 纯液体层，作为毒液漫过其他牌面时的覆盖层（不画毒液牌面）。 */
  liquidArt(): HTMLCanvasElement {
    if (this.liquidCanvas) return this.liquidCanvas
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.clearRect(0, 0, SIZE, SIZE)
    paintLiquid(ctx)
    this.liquidCanvas = canvas
    return canvas
  }

  /** 毒液表面的流动高光，平铺无缝，所有毒格共用一张。 */
  sheen(): THREE.CanvasTexture {
    if (this.sheenMap) return this.sheenMap
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    const blobs: ReadonlyArray<readonly [number, number, number, number]> = [
      [0.18, 0.24, 0.16, 0.05],
      [0.62, 0.1, 0.13, 0.04],
      [0.44, 0.62, 0.2, 0.06],
      [0.84, 0.52, 0.14, 0.045],
      [0.3, 0.86, 0.12, 0.04],
      [0.72, 0.82, 0.17, 0.05],
    ]
    // 每个光斑在九宫格各画一次，贴图平铺时边缘才接得上
    for (const [bx, by, br, alpha] of blobs) {
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const x = (bx + ox) * SIZE
          const y = (by + oy) * SIZE
          const radius = br * SIZE
          const grad = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius)
          grad.addColorStop(0, `rgba(214,255,224,${alpha})`)
          grad.addColorStop(0.55, `rgba(150,235,170,${alpha * 0.5})`)
          grad.addColorStop(1, 'rgba(120,200,140,0)')
          ctx.fillStyle = grad
          ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    this.sheenMap = texture
    return texture
  }

  dispose(): void {
    for (const texture of this.cache.values()) texture.dispose()
    this.cache.clear()
    this.liquidCanvas = null
    this.sheenMap?.dispose()
    this.sheenMap = null
  }
}