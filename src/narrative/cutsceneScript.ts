/**
 * 关卡间 2D 像素过场的分镜数据。
 * 内部分辨率固定 320×180，全部用整数矩形绘制，零外部贴图。
 *
 * 时长说明：过场在 checkpoint 时暂停引擎（reloading 的 2.6s 计时尚未启动），
 * 播放到 duration - RELOAD_TAIL 时再恢复引擎，让装弹与发牌正好在淡出时完成。
 * 因此单段可以放到 7s 而不会产生额外空等。
 */
export const RELOAD_TAIL = 2.6

import {
  PIXEL_COLORS,
  brickWall as drawBrickWall,
  clamp01 as clamp,
  dot as drawDot,
  glow as drawGlow,
  letterbox as drawLetterbox,
  limb as drawLimb,
  rect as drawRect,
  span as spanFn,
} from './pixelDraw'
import type { DialogueChannel } from './dialogue'

export type CutsceneSfx =
  | 'doorLock'
  | 'doorCreak'
  | 'lowThump'
  | 'chairCreak'
  | 'paperRustle'
  | 'bossBreath'
  | 'stitch'
  | 'coin'
  | 'spin'

export interface CutsceneCue {
  readonly at: number
  readonly sfx: CutsceneSfx
}

export interface CutsceneLine {
  readonly text: string
  readonly at: number
  readonly end: number
  readonly channel: DialogueChannel
}

export interface CutsceneSpec {
  /** 目标层（引擎 levelIndex）：1 = 第二层，2 = 第三层 */
  readonly levelIndex: number
  /** 展示用的层号（2 / 3） */
  readonly layer: number
  /** 总时长（秒），含淡入淡出 */
  readonly duration: number
  readonly lines: readonly CutsceneLine[]
  readonly dialogueAnchor?: { readonly x: number; readonly y: number }
  readonly cues: readonly CutsceneCue[]
  readonly draw: (ctx: CanvasRenderingContext2D, t: number) => void
}

export const CUTSCENE_WIDTH = 320
export const CUTSCENE_HEIGHT = 180

type Ctx = CanvasRenderingContext2D

const C = PIXEL_COLORS
const rect = drawRect
const dot = drawDot
const glow = drawGlow
const clamp01 = clamp
const span = spanFn
const brickWall = drawBrickWall
const letterbox = drawLetterbox
const limb = drawLimb

/**
 * 第二层 · 欠收账房（7.0s）
 * 债主摊开烧剩的账页 → 抬手点向血袋架 → 把账页推到你面前 → 你伸手按住
 */
function drawLedgerRoom(ctx: Ctx, t: number): void {
  // 视差：背景最慢、中景次之、前景最快，镜头缓慢右移
  const camBg = -t * 1.1
  const camMid = -t * 2.6
  const camFg = -t * 6

  brickWall(ctx, 132, camBg)

  // 铁门（虚掩，门缝里透着冷光）
  const doorX = 26 + camMid
  rect(ctx, doorX, 24, 48, 108, '#1c1715')
  rect(ctx, doorX + 4, 28, 40, 100, '#070606')
  rect(ctx, doorX + 42, 30, 1, 96, t > 0.9 ? '#6b5b45' : '#241d16')

  // 血袋架（中景）
  const rackX = 86 + camMid
  rect(ctx, rackX, 58, 2, 74, C.steel)
  rect(ctx, rackX + 32, 58, 2, 74, C.steel)
  rect(ctx, rackX, 58, 34, 2, C.steelHi)
  for (let i = 0; i < 3; i += 1) {
    rect(ctx, rackX + 4 + i * 10, 64 + i, 8, 12, C.blood)
    rect(ctx, rackX + 5 + i * 10, 64 + i, 2, 5, C.bloodHi)
  }

  // 吊灯：火苗摇曳决定光晕强弱
  rect(ctx, 177 + camMid, 0, 1, 22, C.steel)
  rect(ctx, 169 + camMid, 22, 18, 3, C.steelHi)
  rect(ctx, 173 + camMid, 25, 10, 3, C.steel)
  const flick = 0.09 + 0.03 * Math.sin(t * 13) + 0.02 * Math.sin(t * 27)
  glow(ctx, 178 + camMid, 42, 56, '214,150,80', flick)

  // 桌面（前景）
  rect(ctx, 0, 132, CUTSCENE_WIDTH, 48, '#0b0908')
  rect(ctx, 0, 132, CUTSCENE_WIDTH, 2, '#2a1d16')
  rect(ctx, 0, 134, CUTSCENE_WIDTH, 3, '#171210')

  // ---- 收账人 ----
  const lean = span(t, 1.2, 1.9) // 前倾探身
  const raise = span(t, 3.2, 4.2) // 抬手
  const bx = 186 + camMid * 0.4
  const by = 92 + lean * 5
  // 背光：压暗但要能从墙里读出来
  glow(ctx, bx + 26, by + 30, 54, '150,80,50', 0.1)
  // 眼：1.5s 点亮（2px → 4px 并变亮）
  const lit = t > 1.5
  const eyeColor = lit ? '#f08a4a' : '#3a2a22'

  rect(ctx, bx + 6, by, 44, 8, '#221b1a')
  rect(ctx, bx + 2, by + 8, 52, 16, '#1e1817')
  rect(ctx, bx - 2, by + 24, 60, 20, '#1a1414')
  rect(ctx, bx + 12, by - 14, 30, 16, '#2a2220')
  rect(ctx, bx + 12, by - 14, 30, 1, '#4a3b33')
  rect(ctx, bx + 16, by - 10, 22, 10, '#151010')
  if (lit) {
    rect(ctx, bx + 19, by - 7, 3, 3, eyeColor)
    rect(ctx, bx + 30, by - 7, 3, 3, eyeColor)
    glow(ctx, bx + 26, by - 6, 16, '240,138,74', 0.16)
  } else {
    rect(ctx, bx + 20, by - 6, 2, 2, eyeColor)
    rect(ctx, bx + 30, by - 6, 2, 2, eyeColor)
  }
  // 肩线高光
  rect(ctx, bx + 6, by, 44, 1, '#3a2a22')
  rect(ctx, bx - 2, by + 24, 60, 1, '#2e2119')

  // 左臂搭在桌沿
  limb(ctx, bx + 46, by + 12, bx + 56, by + 38, '#1d1716')
  // 右臂：先在账本上划笔（小幅抖动），2.8s 后改为抬起指向血袋架
  const writeJab = t > 1.9 && t < 2.9 ? Math.sin((t - 1.9) * 22) * 3 : 0
  const elbowX = bx - 4
  const elbowY = by + 14 - raise * 10
  const handX = bx - 20 + writeJab + raise * 26
  const handY = by + 24 + writeJab * 0.5 - raise * 34
  limb(ctx, bx + 4, by + 10, elbowX, elbowY, '#221b1a')
  limb(ctx, elbowX, elbowY, handX, handY, '#221b1a')
  rect(ctx, handX - 1, handY - 1, 6, 5, '#2a2222')

  // ---- 桌上账页与火 ----
  const pageX = 140 + camFg * 0.5
  rect(ctx, pageX, 120, 36, 10, C.boneDim)
  rect(ctx, pageX, 120, 36, 2, C.bone)
  rect(ctx, pageX + 4, 124, 26, 1, '#5a5348')
  for (let i = 0; i < 5; i += 1) {
    const fx = pageX + 4 + i * 7
    const fh = 4 + Math.abs(Math.sin(t * 11 + i * 1.7)) * 9 * (0.6 + 0.4 * Math.sin(t * 3 + i))
    rect(ctx, fx, 120 - fh, 5, fh, i % 2 === 0 ? C.flame : C.ember)
    rect(ctx, fx + 1, 120 - fh, 2, fh * 0.5, '#f0c070')
  }
  glow(ctx, pageX + 22, 114, 48, '220,130,60', 0.1 + 0.03 * Math.sin(t * 9))

  // ---- 账页被推过桌面（4.4–5.6s）：只推到桌沿，不进入字幕区 ----
  const push = span(t, 4.4, 5.6)
  if (push > 0) {
    const py = 134 + push * 8
    const pw = 42 + push * 34
    const px = 150 + camFg * 0.3 - push * 34
    rect(ctx, px, py, pw, 11, '#cbbfa8')
    rect(ctx, px + 4, py + 3, pw - 14, 1, '#6e6558')
    rect(ctx, px + 4, py + 6, pw - 24, 1, '#6e6558')
    rect(ctx, px + 4, py + 9, pw - 30, 1, '#6e6558')
  }

  // 纸灰上飘（推到面前时更密）
  const ashCount = push > 0 ? 22 : 12
  for (let i = 0; i < ashCount; i += 1) {
    const seed = i * 37.7
    const x0 = 118 + ((seed * 1.7) % 190)
    const speed = 18 + (seed % 13)
    const y = 132 - ((t * speed + (seed % 100)) % 132)
    const x = x0 + Math.sin(t * 1.6 + i) * 6
    dot(ctx, x, y, i % 3 === 0 ? C.flame : C.ember)
    if (i % 4 === 0) dot(ctx, x + 1, y, '#8a4a32')
  }

  // ---- 你的手按住账页（5.8–6.6s）：从右下角伸入，压在账页上沿 ----
  const handIn = span(t, 5.8, 6.4)
  if (handIn > 0) {
    const hx = 168 + handIn * 8
    const hy = 172 - handIn * 26
    // 袖口：只从手掌右下斜出一小段，止于桌面下沿，不进字幕带
    rect(ctx, hx + 20, hy + 10, 26, 14, '#191314')
    rect(ctx, hx + 20, hy + 10, 26, 2, '#332a27')
    // 手背
    rect(ctx, hx, hy, 28, 18, '#2a2220')
    rect(ctx, hx, hy, 28, 1, '#463a35')
    // 四指压在账页上
    for (let i = 0; i < 4; i += 1) {
      rect(ctx, hx + 2 + i * 6, hy - 5, 4, 7, '#2f2724')
      rect(ctx, hx + 2 + i * 6, hy - 5, 4, 1, '#4d403a')
    }
    // 拇指
    rect(ctx, hx + 26, hy + 4, 4, 10, '#2a2220')
  }

  letterbox(ctx)
}

/**
 * 第三层 · 补针刑台（7.5s）
 * 铁链降下讨债人 → 睁眼 → 刻痕名单逐道刻入 → 拈针绷线 →
 * 名单推到你面前、末行空槽发光 → 血从缝线渗出滴落
 */
function drawTallyRoom(ctx: Ctx, t: number): void {
  const camMid = -t * 2.2
  const camFg = -t * 5

  rect(ctx, 0, 0, CUTSCENE_WIDTH, CUTSCENE_HEIGHT, '#100f0e')
  // 混凝土块
  let row = 0
  for (let y = 0; y < 152; y += 22) {
    const off = row % 2 === 0 ? -18 : 0
    for (let x = off + Math.floor(camMid * 0.35); x < CUTSCENE_WIDTH; x += 44) {
      rect(ctx, x + 1, y + 1, 42, 20, '#171513')
      rect(ctx, x + 1, y + 1, 42, 1, '#221e1b')
    }
    row += 1
  }
  // 锈迹纵流
  for (let i = 0; i < 6; i += 1) {
    const x = 40 + i * 47 + camMid * 0.4
    rect(ctx, x, 18 + (i % 3) * 28, 1, 36 + (i % 4) * 18, 'rgba(92,47,34,0.45)')
  }

  // ---- 铁链：0.6–1.8s 从画面上方降下，之后轻摆 ----
  const drop = span(t, 0.6, 1.8)
  const sway = Math.sin(t * 1.25) * 1.6
  const swayR = Math.sin(t * 1.25 + 2.1) * 1.6
  const chainTop = -78 + drop * 78
  const chainX1 = 96 + camMid * 0.5 + sway
  const chainX2 = 213 + camMid * 0.5 + swayR
  const link = (cx: number, from: number, to: number) => {
    for (let y = from; y < to; y += 5) rect(ctx, cx, y, 2, 3, C.steelHi)
  }
  link(chainX1, chainTop, chainTop + 76)
  rect(ctx, chainX1 - 2, chainTop + 76, 6, 3, C.steel)
  link(chainX2, chainTop, chainTop + 76)
  rect(ctx, chainX2 - 2, chainTop + 76, 6, 3, C.steel)

  // ---- 左侧刻痕名单（背景板，随镜头微动） ----
  const bX = 24 + camMid * 0.6
  rect(ctx, bX, 46, 62, 74, C.wood)
  rect(ctx, bX, 46, 62, 2, C.woodHi)
  rect(ctx, bX + 4, 52, 54, 62, '#1a120c')
  // 刻痕逐道刻入，节奏越来越快（1.9s 起）
  const marks: ReadonlyArray<readonly [number, number]> = [
    [32, 58],
    [32, 66],
    [41, 58],
    [41, 66],
    [50, 58],
    [50, 66],
    [59, 58],
    [59, 66],
  ]
  const markAt = (i: number) => 1.9 + i * 0.19 - i * i * 0.008
  marks.forEach(([mx, my], i) => {
    if (t > markAt(i)) {
      rect(ctx, bX + 8 + (mx - 32), my, 1, 6, C.boneDim)
      rect(ctx, bX + 10 + (mx - 32), my, 1, 6, C.boneDim)
    }
  })
  // 最后一道空槽：4.9s 后发亮
  const slotLit = t > 4.9
  rect(ctx, bX + 42, 74, 14, 1, slotLit ? C.bone : '#3a322a')
  if (slotLit) glow(ctx, bX + 49, 74, 14, '230,205,150', 0.22)

  // ---- 讨债人：随右侧链条降到画面内，与链条同步摆荡 ----
  const figY = -84 + drop * 78 // 落地后头顶在 y≈-6 → 用 76 基准
  const cx = 213 + camMid * 0.5 + swayR
  const top = 76 + figY
  // 背光
  glow(ctx, cx + 10, top + 32, 64, '130,78,54', 0.17)
  rect(ctx, cx + 9, top - 2, 1, 2, C.boneDim)
  rect(ctx, cx, top, 20, 8, '#2a2222')
  rect(ctx, cx - 2, top + 8, 24, 22, '#241d1c')
  rect(ctx, cx - 7, top + 30, 34, 42, '#1d1718')
  // 肩线与腰线，把躯干从"一块板"拆出体积
  rect(ctx, cx, top, 20, 1, '#3f322e')
  rect(ctx, cx - 2, top + 8, 24, 1, '#332925')
  rect(ctx, cx - 7, top + 30, 34, 1, '#2e2523')
  rect(ctx, cx - 7, top + 44, 34, 1, '#191314')
  // 头（兜帽）：比躯干亮一档，否则在暗墙前只剩两个点
  rect(ctx, cx + 5, top - 8, 12, 9, '#241d1c')
  rect(ctx, cx + 5, top - 8, 12, 1, '#453833')
  rect(ctx, cx + 4, top - 5, 14, 4, '#1b1514')
  // 眼：1.8s 睁开
  if (t > 1.8) {
    rect(ctx, cx + 7, top - 4, 2, 2, '#e0d3b6')
    rect(ctx, cx + 13, top - 4, 2, 2, '#e0d3b6')
    glow(ctx, cx + 10, top - 3, 20, '220,205,170', 0.22)
  }
  // 胸口缝线
  for (let i = 0; i < 6; i += 1) rect(ctx, cx + 1 + i * 3, top + 12 + (i % 2), 2, 1, '#b6a68c')
  // 边光
  rect(ctx, cx + 17, top - 8, 1, 8, '#5a4a3c')
  rect(ctx, cx - 8, top + 30, 1, 42, '#3b2e26')
  rect(ctx, cx + 26, top + 30, 1, 42, '#3b2e26')

  // ---- 拈针绷线（3.3–4.4s） ----
  const needle = span(t, 3.3, 4.2)
  if (needle > 0) {
    const nX = cx + 18 - needle * 6
    const nY = top + 20 - needle * 10
    rect(ctx, nX, nY, 1, 4, C.bone)
    rect(ctx, nX, nY + 4, 1, 1, C.boneDim)
    // 线从针尖绷向悬索
    const steps = 12
    for (let i = 0; i <= steps; i += 1) {
      const p = i / steps
      const lx = nX + (cx + 9 - nX) * p
      const ly = nY + (top - 2 - nY) * p
      if (i % 2 === 0) dot(ctx, lx, ly, 'rgba(185,171,146,0.42)')
    }
  }

  // ---- 血从缝线渗出并滴落（5.6s 起） ----
  if (t > 5.6) {
    const seep = clamp01((t - 5.6) / 0.5)
    rect(ctx, cx + 6, top + 12, 1, Math.max(1, seep * 12), C.bloodHi)
    const drip = span(t, 6.1, 6.7)
    if (drip > 0) {
      const dy = top + 24 + drip * (148 - top - 24)
      rect(ctx, cx + 6, dy, 1, 3, C.bloodHi)
      if (drip >= 1) {
        rect(ctx, cx + 3, 147, 7, 1, C.blood)
        rect(ctx, cx + 4, 146, 5, 1, C.bloodHi)
      }
    }
  }

  // ---- 桌面与滑入的名单（4.4–5.6s 推到你面前） ----
  rect(ctx, 0, 150, CUTSCENE_WIDTH, 30, '#0b0908')
  rect(ctx, 0, 150, CUTSCENE_WIDTH, 2, '#2a1d16')
  const slide = span(t, 4.4, 5.6)
  const px0 = 26 + camFg * 0.2
  const py0 = 150 - slide * 46
  const ph = 30 + slide * 22
  rect(ctx, px0, py0, 62, ph, '#cbbfa8')
  rect(ctx, px0, py0, 62, 2, '#e3d8c2')
  for (let i = 0; i < 6; i += 1) {
    rect(ctx, px0 + 5, py0 + 6 + i * 6, 38 - (i % 3) * 8, 1, '#6e6558')
  }
  if (slide > 0.9) {
    rect(ctx, px0 + 5, py0 + ph - 8, 50, 4, 'rgba(124,31,28,0.35)')
    rect(ctx, px0 + 5, py0 + ph - 7, 52, 1, 'rgba(124,31,28,0.62)')
  }

  letterbox(ctx)
}

export const CUTSCENES: Readonly<Record<number, CutsceneSpec>> = {
  1: {
    levelIndex: 1,
    layer: 2,
    duration: 7,
    dialogueAnchor: { x: 238, y: 54 },
    lines: [
      { text: '烧剩的账页，一页页摊开。欠的血，都记在上面。', at: 1.9, end: 4.3, channel: 'enemy' },
      { text: '我伸手按住那页——墨迹还在渗，像没干的血。', at: 5.5, end: 6.8, channel: 'player' },
    ],
    cues: [
      { at: 0.05, sfx: 'doorCreak' },
      { at: 0.9, sfx: 'doorLock' },
      { at: 1.5, sfx: 'bossBreath' },
      { at: 1.9, sfx: 'paperRustle' },
      { at: 3.2, sfx: 'chairCreak' },
      { at: 4.4, sfx: 'paperRustle' },
      { at: 5.8, sfx: 'lowThump' },
      { at: 6.4, sfx: 'bossBreath' },
    ],
    draw: drawLedgerRoom,
  },
  2: {
    levelIndex: 2,
    layer: 3,
    duration: 7.5,
    dialogueAnchor: { x: 244, y: 50 },
    lines: [
      { text: '补针刑台没有出口。名单上，又多了一道刻痕。', at: 1.9, end: 4.4, channel: 'enemy' },
      { text: '最后一行的空槽，是留给你的。', at: 5.5, end: 7.2, channel: 'enemy' },
    ],
    cues: [
      { at: 0.05, sfx: 'lowThump' },
      { at: 0.6, sfx: 'doorCreak' },
      { at: 1.8, sfx: 'bossBreath' },
      { at: 2.6, sfx: 'spin' },
      { at: 3.3, sfx: 'stitch' },
      { at: 4.4, sfx: 'paperRustle' },
      { at: 5.6, sfx: 'lowThump' },
    ],
    draw: drawTallyRoom,
  },
}

export function cutsceneFor(levelIndex: number): CutsceneSpec | null {
  return CUTSCENES[levelIndex] ?? null
}
