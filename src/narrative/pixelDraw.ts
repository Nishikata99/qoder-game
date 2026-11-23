/**
 * 2D 像素绘制的共享工具：关卡间过场与结局过场共用。
 * 逻辑分辨率固定 320×180，全部用整数矩形，零外部贴图。
 */

export const PIXEL_WIDTH = 320
export const PIXEL_HEIGHT = 180

export type Ctx = CanvasRenderingContext2D

export const PIXEL_COLORS = {
  ink: '#050405',
  wall: '#12100f',
  wallHi: '#1b1716',
  wood: '#241a12',
  woodHi: '#3a2a1c',
  ember: '#c86a3a',
  flame: '#e8a24a',
  bone: '#b9ab92',
  boneDim: '#6e6558',
  blood: '#7c1f1c',
  bloodHi: '#b3372c',
  steel: '#2c3036',
  steelHi: '#4a5159',
} as const

export function rect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

export function dot(ctx: Ctx, x: number, y: number, color: string): void {
  rect(ctx, x, y, 1, 1, color)
}

export function glow(
  ctx: Ctx,
  cx: number,
  cy: number,
  r: number,
  rgb: string,
  alpha: number,
): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, `rgba(${rgb},${alpha})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** 0→1 的缓入缓出，用于"探身/抬手"这类要有重量感的动作 */
export function ease(v: number): number {
  const x = clamp01(v)
  return x * x * (3 - 2 * x)
}

export function span(t: number, from: number, to: number): number {
  return ease((t - from) / (to - from))
}

/** 砖墙：奇数行错半块，drift 让背景极慢横移制造视差 */
export function brickWall(ctx: Ctx, bottom: number, drift: number): void {
  rect(ctx, 0, 0, PIXEL_WIDTH, PIXEL_HEIGHT, PIXEL_COLORS.wall)
  const bw = 26
  const bh = 10
  let row = 0
  for (let y = 0; y < bottom; y += bh) {
    const off = row % 2 === 0 ? 0 : -bw / 2
    for (let x = off + Math.floor(drift); x < PIXEL_WIDTH; x += bw) {
      rect(ctx, x + 1, y + 1, bw - 2, bh - 2, PIXEL_COLORS.wallHi)
      rect(ctx, x + 1, y + 1, bw - 2, 1, '#211b19')
    }
    row += 1
  }
}

export function letterbox(ctx: Ctx): void {
  rect(ctx, 0, 0, PIXEL_WIDTH, 10, PIXEL_COLORS.ink)
  rect(ctx, 0, PIXEL_HEIGHT - 10, PIXEL_WIDTH, 10, PIXEL_COLORS.ink)
}

/** 手臂用一串 4×4 方块沿两点连线铺，避免引入绘制路径 */
export function limb(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2))
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps
    rect(ctx, x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, 4, 4, color)
  }
}
