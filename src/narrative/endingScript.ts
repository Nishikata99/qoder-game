/**
 * 结局 2D 像素过场分镜。
 *
 * 胜利：接在 3D endingB（缝线透光 → 你伸手 → 黑屏）之后，讲述"走出去"的收束。
 * 胜利段不可跳过（仅长按 3s 兜底）。
 *
 * 失败：名单补针，交代"你被归档"。
 * 失败段可跳过（Space/Esc/按钮）。
 */
import {
  PIXEL_COLORS as C,
  PIXEL_HEIGHT,
  PIXEL_WIDTH,
  clamp01,
  dot,
  glow,
  letterbox,
  limb,
  rect,
  span,
  type Ctx,
} from './pixelDraw'
import type { DialogueChannel } from './dialogue'

export type EndingSfx =
  | 'lowThump'
  | 'chairCreak'
  | 'bossBreath'
  | 'stitch'
  | 'doorCreak'
  | 'spin'
  | 'paperRustle'

export interface EndingCue {
  readonly at: number
  readonly sfx: EndingSfx
}

export interface EndingLine {
  readonly text: string
  readonly at: number
  readonly end: number
  readonly channel: DialogueChannel
}

export interface EndingSpec {
  readonly id: 'win' | 'lose'
  readonly duration: number
  readonly lines: readonly EndingLine[]
  readonly dialogueAnchor?: { readonly x: number; readonly y: number }
  readonly cues: readonly EndingCue[]
  /** 胜利结局不可跳过，只有长按兜底 */
  readonly skippable: boolean
  readonly draw: (ctx: Ctx, t: number) => void
}

/**
 * 胜利 ·「赎契」
 * 3D 段停在黑场与缝线声；这里从黑场亮起，光已经在手上。
 * 牌桌残局 → 缝线透光 → 你伸手 → 缝线绽成走廊 → 灯下人影抬手 → 灯灭。
 */
function drawRedemption(ctx: Ctx, t: number): void {
  // 墙面：比关卡间更暗、更空（收束感）
  rect(ctx, 0, 0, PIXEL_WIDTH, PIXEL_HEIGHT, '#0c0b0a')
  let row = 0
  for (let y = 0; y < 132; y += 14) {
    const off = row % 2 === 0 ? -14 : 0
    for (let x = off; x < PIXEL_WIDTH; x += 30) {
      rect(ctx, x + 1, y + 1, 28, 12, '#131110')
      rect(ctx, x + 1, y + 1, 28, 1, '#1a1715')
    }
    row += 1
  }

  // ---- 牌桌残局（背景，随时间淡出，让位给缝线光） ----
  const tableFade = 1 - span(t, 3.4, 5.2)
  if (tableFade > 0) {
    ctx.save()
    ctx.globalAlpha = tableFade
    const top = 132
    rect(ctx, 0, top, PIXEL_WIDTH, PIXEL_HEIGHT - top, '#090807')
    rect(ctx, 0, top, PIXEL_WIDTH, 2, '#241a14')
    // 散落的牌（贴近桌沿，不进字幕带）
    const cards: ReadonlyArray<readonly [number, number, number]> = [
      [58, 134, -6],
      [86, 138, 4],
      [112, 133, -11],
      [140, 139, 8],
      [168, 135, 2],
    ]
    for (const [cx, cy, rot] of cards) {
      const w = 10
      const h = 12
      // 用错位矩形近似旋转卡牌，避免引入 save/rotate
      rect(ctx, cx + rot * 0.15, cy, w, h, '#b9ab92')
      rect(ctx, cx + rot * 0.15, cy, w, 1, '#d6cbb4')
      rect(ctx, cx + 1 + rot * 0.15, cy + 2, w - 2, h - 4, '#8f8367')
    }
    // 收拢的契纸（半张）
    rect(ctx, 84, 146, 26, 7, '#cbbfa8')
    rect(ctx, 84, 146, 26, 1, '#e3d8c2')
    rect(ctx, 90, 148, 14, 1, '#6e6558')
    rect(ctx, 90, 150, 10, 1, '#6e6558')
    ctx.restore()
  }

  // ---- 讨债人残躯：瘫在桌沿，胸口缝线透光 ----
  const glowIn = span(t, 1.2, 2.6)
  const bodyAlpha = 1 - span(t, 5.0, 6.2)
  if (bodyAlpha > 0) {
    ctx.save()
    ctx.globalAlpha = bodyAlpha
    const bx = 196
    const by = 104
    // 躯干（塌着）
    rect(ctx, bx - 8, by + 10, 36, 26, '#171313')
    rect(ctx, bx - 4, by + 36, 40, 18, '#120f10')
    // 头（低垂，贴着桌面）
    rect(ctx, bx + 1, by + 1, 15, 11, '#241d1c')
    rect(ctx, bx + 1, by + 1, 15, 1, '#3d332e')
    // 垂下的脸（更暗，暗示低垂）
    rect(ctx, bx + 4, by + 6, 9, 5, '#181312')
    // 闭着的眼缝
    rect(ctx, bx + 5, by + 7, 2, 1, '#332925')
    rect(ctx, bx + 10, by + 7, 2, 1, '#332925')
    // 肩线
    rect(ctx, bx - 8, by + 10, 36, 1, '#332a26')
    ctx.restore()
  }

  // 缝线透光：整段的唯一暖光源
  if (glowIn > 0) {
    const pulse = 0.6 + 0.4 * Math.sin(t * 3.4)
    const strength = glowIn * (0.5 + 0.5 * pulse)
    glow(ctx, 208, 126, 30 + glowIn * 22, '240,196,132', 0.16 * strength)
    glow(ctx, 208, 126, 12, '255,235,190', 0.3 * strength)
    // 缝线本身：一根根透光的短线
    for (let i = 0; i < 7; i += 1) {
      const on = t > 1.6 + i * 0.09
      if (!on) continue
      rect(ctx, 200 + i * 3, 124 + (i % 2), 2, 1, i % 2 === 0 ? '#f4dcae' : '#d8b47c')
    }
  }

  // ---- 你的手从右下伸入，指尖触到缝线 ----
  const reach = span(t, 2.6, 3.8)
  if (reach > 0) {
    const hx = 300 - reach * 74
    const hy = 196 - reach * 64
    // 袖子
    rect(ctx, hx + 20, hy + 12, 70, 40, '#141011')
    rect(ctx, hx + 20, hy + 12, 70, 2, '#2b2422')
    // 手背
    rect(ctx, hx, hy, 24, 16, '#2a2220')
    rect(ctx, hx, hy, 24, 1, '#463a35')
    // 伸出的食指
    rect(ctx, hx - 6, hy + 3, 8, 4, '#2f2724')
    rect(ctx, hx - 6, hy + 3, 8, 1, '#4d403a')
    // 指尖的暖光：光顺着指尖爬上手腕
    const climb = span(t, 3.6, 4.6)
    if (climb > 0) {
      glow(ctx, hx - 4, hy + 5, 10, '240,196,132', 0.22 * climb)
      rect(ctx, hx - 2, hy + 5, 2, 2, '#f4dcae')
      // 光沿手腕向上爬
      const along = Math.round(climb * 18)
      rect(ctx, hx + 6, hy + 6, along, 1, 'rgba(240,196,132,0.5)')
    }
  }

  // ---- 缝线绽开成走廊（4.2–5.6s）：裂口长在缝线处，边缘不规则像被撕开 ----
  const open = span(t, 4.2, 5.6)
  if (open > 0) {
    const cx = 208
    const cy = 120
    const w = 8 + open * 96
    const h = 5 + open * 66
    // 裂口主体
    rect(ctx, cx - w / 2, cy - h / 2, w, h, '#080707')
    // 不规则撕边：上下各用几段不同高度的短线
    const teeth = 7
    for (let i = 0; i < teeth; i += 1) {
      const tx = cx - w / 2 + (w * i) / teeth
      const tw = w / teeth
      const jitter = ((i * 7) % 5) - 2
      rect(ctx, tx, cy - h / 2 - 2 - jitter, tw, 2 + Math.abs(jitter), '#241a14')
      rect(ctx, tx, cy + h / 2 + jitter * 0.5, tw, 2 + Math.abs(jitter) * 0.5, '#241a14')
    }
    // 左右撕边
    rect(ctx, cx - w / 2 - 2, cy - h / 2, 2, h, '#241a14')
    rect(ctx, cx + w / 2, cy - h / 2, 2, h, '#241a14')

    if (open > 0.3) {
      const inner = clamp01((open - 0.3) / 0.7)
      // 纵深：内收的框，但用横向地砖线强化"走廊"而非"窗"
      for (let k = 1; k <= 3; k += 1) {
        const p = (inner * k) / 3
        const fw = w * (1 - p * 0.6)
        const fh = h * (1 - p * 0.46)
        rect(ctx, cx - fw / 2, cy - fh / 2, fw, fh, k % 2 === 0 ? '#0a0908' : '#070606')
        // 地面横线（越远越密）
        rect(ctx, cx - fw / 2, cy + fh / 2 - 1, fw, 1, `rgba(80,62,46,${0.36 - k * 0.08})`)
      }
      // 尽头灯：暖色是唯一亮源
      glow(ctx, cx, cy - 3, 14 + inner * 12, '240,214,158', 0.22 * inner)
      glow(ctx, cx, cy - 3, 5, '255,240,205', 0.3 * inner)
      rect(ctx, cx - 1, cy - 5, 2, 3, '#fbf0cf')
      // 地面灯光带
      rect(ctx, cx - 3, cy + 9, 6, 1, 'rgba(240,214,158,0.34)')
    }
  }

  // ---- 灯下人影：抬手（5.6–7.0s） ----
  const figure = span(t, 5.6, 6.2)
  if (figure > 0 && open > 0.5) {
    const cx = 208
    const cy = 120
    const inner = clamp01((open - 0.3) / 0.7)
    const farH = 66 * (1 - inner * 0.5)
    const baseY = cy + farH / 2 - 3
    ctx.save()
    ctx.globalAlpha = figure
    // 灯下的人：约 40px 高，剪影但可读（头/肩/身/腿）
    const fx = cx
    // 腿
    rect(ctx, fx - 6, baseY - 12, 4, 12, '#1a1514')
    rect(ctx, fx + 2, baseY - 12, 4, 12, '#1a1514')
    // 躯干
    rect(ctx, fx - 7, baseY - 30, 15, 19, '#1d1817')
    rect(ctx, fx - 7, baseY - 30, 15, 1, '#332a26')
    // 肩
    rect(ctx, fx - 9, baseY - 30, 19, 2, '#241d1c')
    // 头
    rect(ctx, fx - 4, baseY - 40, 9, 10, '#221b1a')
    rect(ctx, fx - 4, baseY - 40, 9, 1, '#3d332e')
    // 手里半张纸（同撕边）
    rect(ctx, fx + 6, baseY - 26, 7, 8, '#cbbfa8')
    rect(ctx, fx + 6, baseY - 26, 7, 1, '#e3d8c2')
    rect(ctx, fx + 6, baseY - 26, 1, 8, '#e3d8c2')
    // 抬手：手臂向上抬起（这是"认出你"的唯一动作）
    const raise = span(t, 6.0, 6.7)
    const handX = fx + 8 + raise * 6
    const handY = baseY - 26 - raise * 14
    limb(ctx, fx + 6, baseY - 26, fx + 12, handY + 3, '#1d1817')
    rect(ctx, handX, handY, 4, 4, '#241d1c')
    ctx.restore()
  }

  // ---- 灯与人影一起暗下去（7.0–8.0s）：走廊轮廓留着，只留一点残余暖光 ----
  const dim = span(t, 7.0, 8.0)
  if (dim > 0) {
    // 分层压暗：先压背景，走廊裂口保留到最后
    ctx.fillStyle = `rgba(6,5,4,${dim * 0.6})`
    ctx.fillRect(0, 0, PIXEL_WIDTH, PIXEL_HEIGHT)
  }

  letterbox(ctx)
}

/**
 * 失败 ·「补针」
 * 名单空槽特写 → 缝线手套捏针 → 针落第一笔 → 刻痕扩散成你的轮廓 →
 * 缝线垂落缝死 → 拉远成整面墙。
 */
function drawStitchedIn(ctx: Ctx, t: number): void {
  // 更冷的世界：去暖光，只留血与骨
  rect(ctx, 0, 0, PIXEL_WIDTH, PIXEL_HEIGHT, '#0a0908')

  // ---- 名单板特写（0.5–4.8s 为主体） ----
  const boardX = 44
  const boardY = 24
  const boardW = 176
  const boardH = 108
  rect(ctx, boardX, boardY, boardW, boardH, '#1d140d')
  rect(ctx, boardX, boardY, boardW, 2, '#33251a')
  rect(ctx, boardX + 4, boardY + 4, boardW - 8, boardH - 8, '#140e09')

  // 已刻的 8 道痕
  const marks: ReadonlyArray<readonly [number, number]> = [
    [54, 36],
    [54, 52],
    [74, 36],
    [74, 52],
    [94, 36],
    [94, 52],
    [114, 36],
    [114, 52],
  ]
  for (const [mx, my] of marks) {
    rect(ctx, mx, my, 1, 10, '#8d8271')
    rect(ctx, mx + 2, my, 1, 10, '#8d8271')
  }

  // 最后一道空槽：闪烁
  const slotX = 148
  const slotY = 60
  // 空槽闪烁；轮廓长出后淡出，避免刻痕停在人形头顶
  const slotFade = 1 - span(t, 3.5, 4.2)
  if (slotFade > 0) {
    const blink = 0.55 + 0.45 * Math.sin(t * 4.2)
    ctx.save()
    ctx.globalAlpha = slotFade
    rect(ctx, slotX, slotY, 26, 1, '#3a322a')
    glow(ctx, slotX + 13, slotY, 16, '230,205,150', 0.12 * blink)
    ctx.restore()
  }

  // ---- 手套捏针伸入（1.6–2.4s），刻完在 3.6s 前抽离 ----
  const hand = span(t, 1.6, 2.4) * (1 - span(t, 3.0, 3.7))
  if (hand > 0) {
    const targetX = slotX + 13
    const targetY = slotY - 6
    const hx = targetX + 14 + (1 - hand) * 120
    const hy = targetY - 8 + (1 - hand) * 24
    // 皮手套（比人手更冷、更硬），加指节分线与边光
    rect(ctx, hx, hy, 30, 20, '#1d2226')
    rect(ctx, hx, hy, 30, 1, '#3d474c')
    rect(ctx, hx, hy, 1, 20, '#333c41')
    // 指节分线
    rect(ctx, hx + 8, hy + 2, 1, 14, '#14181b')
    rect(ctx, hx + 18, hy + 2, 1, 14, '#14181b')
    // 手指捏合
    rect(ctx, hx - 7, hy + 5, 9, 6, '#232a2e')
    rect(ctx, hx - 7, hy + 5, 9, 1, '#4a555b')
    rect(ctx, hx - 7, hy + 9, 9, 1, '#14181b')
    // 针：仅在手靠近空槽时画，避免抽离时针被拉成长条
    if (hand > 0.55) {
      rect(ctx, targetX, targetY, hx - targetX, 1, '#d6dce2')
      rect(ctx, targetX, targetY - 1, 1, 2, '#eef4fa')
    }
    // 线
    for (let i = 0; i < 8; i += 1) {
      if (i % 2 === 0) dot(ctx, hx + 4 + i * 2, hy + 13 + (i % 3), 'rgba(200,206,214,0.4)')
    }
  }

  // ---- 针落第一笔（2.4–3.6s）：空槽上刻一道，边缘渗血 ----
  const carve = span(t, 2.4, 3.2)
  if (carve > 0) {
    const h = 10 * carve
    rect(ctx, slotX + 12, slotY - h, 1, h + 1, '#b6a68c')
    rect(ctx, slotX + 14, slotY - h, 1, h + 1, '#b6a68c')
    // 血从笔画边缘渗（只在下笔后出现）
    if (t > 2.9) {
      const seep = span(t, 2.9, 3.6)
      rect(ctx, slotX + 11, slotY + 1, 1, 3 * seep, C.bloodHi)
      rect(ctx, slotX + 15, slotY + 1, 1, 2 * seep, C.blood)
    }
  }

  // ---- 刻痕扩散成你的轮廓（3.6–4.8s） ----
  const bloom = span(t, 3.6, 4.8)
  if (bloom > 0) {
    // 名单板淡出，让位给"墙上的轮廓"
    const boardFade = 1 - bloom
    ctx.save()
    ctx.globalAlpha = boardFade
    rect(ctx, boardX, boardY, boardW, boardH, '#140e09')
    ctx.restore()

    // 你的剪影：低垂的头 + 肩 + 躯干，连成一整块，边光勾出形状
    const cx = slotX + 13
    const topY = 44
    const grow = bloom
    ctx.save()
    ctx.globalAlpha = 0.92 * grow
    glow(ctx, cx, topY + 40, 40, '120,90,70', 0.18)
    // 头（低垂，微微前倾）——填实，不镂空
    const headY = topY
    rect(ctx, cx - 8, headY, 16, 15, '#2b2322')
    rect(ctx, cx - 8, headY, 16, 1, '#4a3b33')
    rect(ctx, cx - 8, headY, 1, 15, '#3d302a')
    rect(ctx, cx + 7, headY, 1, 15, '#3d302a')
    // 垂下的脸（更深一档，暗示低头）
    rect(ctx, cx - 5, headY + 7, 10, 7, '#1f1918')
    // 颈
    rect(ctx, cx - 3, headY + 15, 6, 3, '#241d1c')
    // 肩 + 躯干（梯形，用三段矩形近似）
    const sy = headY + 18
    rect(ctx, cx - 15, sy, 30, 7, '#2a2221')
    rect(ctx, cx - 15, sy, 30, 1, '#4a3b33')
    rect(ctx, cx - 13, sy + 7, 26, 11, '#241d1c')
    rect(ctx, cx - 11, sy + 18, 22, 16, '#1f1918')
    // 中缝：把躯干"缝"起来的暗示（也是后面缝合线的落点）
    rect(ctx, cx, sy + 2, 1, 30, 'rgba(180,140,100,0.4)')
    // 边光
    rect(ctx, cx - 15, sy, 1, 7, '#4a3a31')
    rect(ctx, cx + 14, sy, 1, 7, '#4a3a31')
    rect(ctx, cx - 11, sy + 18, 1, 16, '#332925')
    rect(ctx, cx + 10, sy + 18, 1, 16, '#332925')
    ctx.restore()
  }

  // ---- 缝线垂落，一针针缝死（4.8–6.0s）：沿躯干中缝自上而下 ----
  const sew = span(t, 4.8, 5.9)
  if (sew > 0) {
    const cx = slotX + 13
    const top = 0
    const stitchTop = 68
    const stitchBottom = 94
    // 一根线从画面顶部垂到缝线起点
    rect(ctx, cx, top, 1, stitchTop * sew, 'rgba(200,206,214,0.45)')
    // 横向缝针：沿中缝由上往下，每针横跨躯干
    const stitches = 7
    for (let i = 0; i < stitches; i += 1) {
      const on = t > 4.9 + i * 0.11
      if (!on) continue
      const y = stitchTop + i * 4
      const halfW = 10 - Math.abs(i - 3) * 0.6
      rect(ctx, cx - halfW, y, halfW * 2, 1, '#9aa1a8')
      rect(ctx, cx - halfW, y, 1, 3, '#c9cfd6')
      rect(ctx, cx + halfW - 1, y, 1, 3, '#c9cfd6')
      // 每一针带一点血
      rect(ctx, cx + 1, y + 1, 1, 1, C.blood)
    }
    // 最后一针收在躯干下沿
    if (t > 5.75) {
      rect(ctx, cx - 6, stitchBottom, 12, 1, '#9aa1a8')
      rect(ctx, cx - 6, stitchBottom, 1, 2, '#c9cfd6')
      rect(ctx, cx + 5, stitchBottom, 1, 2, '#c9cfd6')
    }
  }

  // ---- 拉远：名单变成整面墙（6.0–6.6s） ----
  const zoomOut = span(t, 6.0, 6.6)
  if (zoomOut > 0) {
    // 前景覆盖：一个小格子高亮的墙
    ctx.save()
    ctx.globalAlpha = zoomOut
    rect(ctx, 0, 0, PIXEL_WIDTH, 132, '#0e0c0b')
    // 网格：每格是一个名字
    const cols = 11
    const rows = 6
    const cw = PIXEL_WIDTH / cols
    const ch = 132 / rows
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = c * cw
        const y = r * ch
        rect(ctx, x + 1, y + 1, cw - 2, ch - 2, '#151110')
        // 每格两道刻痕
        rect(ctx, x + cw / 2 - 2, y + ch / 2 - 3, 1, 6, '#4a423a')
        rect(ctx, x + cw / 2 + 1, y + ch / 2 - 3, 1, 6, '#4a423a')
      }
    }
    // 你的那一格：高亮（血）
    const myCol = 7
    const myRow = 3
    const x = myCol * cw
    const y = myRow * ch
    rect(ctx, x + 1, y + 1, cw - 2, ch - 2, '#1c1210')
    rect(ctx, x + cw / 2 - 2, y + ch / 2 - 3, 1, 6, C.bloodHi)
    rect(ctx, x + cw / 2 + 1, y + ch / 2 - 3, 1, 6, C.bloodHi)
    glow(ctx, x + cw / 2, y + ch / 2, 12, '179,55,44', 0.14)
    ctx.restore()
  }

  // 桌面
  rect(ctx, 0, 132, PIXEL_WIDTH, 48, '#080706')
  rect(ctx, 0, 132, PIXEL_WIDTH, 2, '#20160f')

  letterbox(ctx)
}

export const ENDINGS: Readonly<Record<'win' | 'lose', EndingSpec>> = {
  win: {
    id: 'win',
    duration: 8.5,
    skippable: false,
    lines: [
      { text: '哥？', at: 1.6, end: 2.4, channel: 'sister' },
      { text: '小棠……我在。', at: 2.6, end: 3.7, channel: 'player' },
      { text: '别碰线。先找到我的名字。', at: 3.9, end: 5.4, channel: 'sister' },
      { text: '找到了。', at: 5.6, end: 6.2, channel: 'player' },
      { text: '把最后一针缝完。', at: 6.4, end: 7.6, channel: 'sister' },
    ],
    cues: [
      { at: 0.05, sfx: 'lowThump' },
      { at: 0.9, sfx: 'stitch' },
      { at: 2.6, sfx: 'bossBreath' },
      { at: 4.2, sfx: 'doorCreak' },
      { at: 5.6, sfx: 'lowThump' },
      { at: 7.0, sfx: 'stitch' },
    ],
    draw: drawRedemption,
  },
  lose: {
    id: 'lose',
    duration: 7.0,
    dialogueAnchor: { x: 205, y: 36 },
    skippable: true,
    lines: [
      { text: '轮到你的名字了。', at: 1.4, end: 2.6, channel: 'enemy' },
      { text: '小棠……', at: 2.8, end: 3.6, channel: 'player' },
      { text: '不用挣了。缝进去就不疼了。', at: 3.8, end: 5.2, channel: 'enemy' },
      { text: '名单还很长。下一位已经在门外了。', at: 5.3, end: 6.9, channel: 'enemy' },
    ],
    cues: [
      { at: 0.05, sfx: 'lowThump' },
      { at: 1.6, sfx: 'stitch' },
      { at: 2.5, sfx: 'stitch' },
      { at: 3.8, sfx: 'bossBreath' },
      { at: 4.9, sfx: 'stitch' },
      { at: 6.0, sfx: 'spin' },
    ],
    draw: drawStitchedIn,
  },
}
