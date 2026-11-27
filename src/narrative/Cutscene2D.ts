import type { SoundEngine } from '../audio/SoundEngine'
import { isDocumentBackgrounded } from '../browserVisibility'
import type { DialogueChannel } from './dialogue'
import { PIXEL_HEIGHT, PIXEL_WIDTH, type Ctx } from './pixelDraw'

/** 淡入/淡出时长（秒） */
const FADE_IN = 0.5
const FADE_OUT = 0.45
/** 跳过时的收尾淡出 */
const SKIP_FADE = 0.18

/** 关卡间过场与结局过场共有的播放契约 */
export interface Playable2D {
  readonly duration: number
  readonly lines: readonly {
    readonly text: string
    readonly at: number
    readonly end: number
    readonly channel: DialogueChannel
  }[]
  readonly dialogueAnchor?: { readonly x: number; readonly y: number }
  readonly cues: readonly { readonly at: number; readonly sfx: string }[]
  readonly draw: (ctx: Ctx, t: number) => void
}

export interface CutsceneDeps {
  readonly sound: SoundEngine
  /**
   * 关卡间过场：过场尾部提前恢复引擎，让装弹/发牌落在淡出窗口。
   * 结局过场不传（引擎已终局，无计时可恢复）。
   */
  readonly onResumeEngine?: () => void
  /** 距结束多少秒时恢复引擎；默认 2.6s（与 beginLevel 的黑窗一致） */
  readonly resumeTail?: number
  readonly onFinish: () => void
}

/**
 * 2D 像素过场导演层：照 NarrativeDirector 的生命週期写，
 * 但只画自己的 canvas，不碰 SceneManager / 引擎。
 *
 * 时钟用墙钟推进：过场必须在 duration 内走完，低帧率下不能靠补帧拖长时间。
 */
export class Cutscene2D {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly spec: Playable2D
  private readonly deps: CutsceneDeps

  private rafId: number | null = null
  private lastTs: number | null = null
  private time = 0
  private cueIndex = 0
  private running = false
  private active = false
  private skipAt: number | null = null
  private finished = false
  private resumed = false
  private readonly onResize: () => void

  constructor(canvas: HTMLCanvasElement, spec: Playable2D, deps: CutsceneDeps) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable')
    this.ctx = ctx
    this.spec = spec
    this.deps = deps
    canvas.width = PIXEL_WIDTH
    canvas.height = PIXEL_HEIGHT
    ctx.imageSmoothingEnabled = false
    this.onResize = () => this.fit()
    this.fit()
    window.addEventListener('resize', this.onResize)
  }

  /** 逻辑 320×180，按容器取最大整数倍缩放，像素边缘保持锐利 */
  private fit(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const scale = Math.max(
      1,
      Math.floor(Math.min(rect.width / PIXEL_WIDTH, rect.height / PIXEL_HEIGHT)),
    )
    this.canvas.style.width = `${PIXEL_WIDTH * scale}px`
    this.canvas.style.height = `${PIXEL_HEIGHT * scale}px`
  }

  now(): number {
    return this.time
  }

  /** DEV 抓帧用：跳到指定秒并立即重绘（跳过期间禁用，免得把补帧逻辑搅乱） */
  debugSeek(seconds: number): void {
    if (!this.active || this.skipAt !== null) return
    this.time = Math.max(0, Math.min(this.spec.duration - 0.001, seconds))
    this.syncCues()
    this.maybeResumeEngine()
    this.render(this.time)
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.running = true
    this.time = 0
    this.cueIndex = 0
    this.lastTs = null
    this.skipAt = null
    this.finished = false
    this.resumed = false
    this.render(0)
    this.rafId = requestAnimationFrame(this.tick)
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.lastTs = null
  }

  resume(): void {
    if (this.running || !this.active || this.finished) return
    this.running = true
    this.lastTs = null
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 跳过后仍在 SKIP_FADE 内淡到黑再交还，避免硬切 */
  skip(): void {
    if (!this.active || this.finished || this.skipAt !== null) return
    this.skipAt = this.time
    this.maybeResumeEngine()
    if (!this.running) {
      this.running = true
      this.lastTs = null
      this.rafId = requestAnimationFrame(this.tick)
    }
  }

  dispose(): void {
    this.stop()
    window.removeEventListener('resize', this.onResize)
  }

  private stop(): void {
    this.running = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.lastTs = null
    this.active = false
  }

  private readonly tick = (ts: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.tick)
    if (this.lastTs === null) {
      this.lastTs = ts
      return
    }
    if (isDocumentBackgrounded()) {
      this.lastTs = null
      return
    }
    const raw = (ts - this.lastTs) / 1000
    this.lastTs = ts
    this.time += raw

    this.syncCues()
    this.maybeResumeEngine()

    const endAt =
      this.skipAt !== null ? Math.min(this.spec.duration, this.skipAt + SKIP_FADE) : this.spec.duration
    if (this.time >= endAt) {
      this.render(endAt)
      this.finish()
      return
    }
    this.render(this.time)
  }

  /** 提前把引擎唤醒（仅关卡间过场用；结局无 onResumeEngine 时直接跳过） */
  private maybeResumeEngine(): void {
    if (this.resumed || !this.deps.onResumeEngine) return
    const tail = this.deps.resumeTail ?? 2.6
    const threshold = this.spec.duration - tail
    if (this.skipAt === null && this.time < threshold) return
    this.resumed = true
    this.deps.onResumeEngine()
  }

  private syncCues(): void {
    while (
      this.cueIndex < this.spec.cues.length &&
      this.spec.cues[this.cueIndex]!.at <= this.time
    ) {
      this.playSfx(this.spec.cues[this.cueIndex]!.sfx)
      this.cueIndex += 1
    }
  }

  private finish(): void {
    if (this.finished) return
    this.finished = true
    this.maybeResumeEngine()
    this.stop()
    this.deps.onFinish()
  }

  private render(t: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.clearRect(0, 0, PIXEL_WIDTH, PIXEL_HEIGHT)
    this.spec.draw(ctx, t)
    ctx.restore()

    const alpha = this.blackAt(t)
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`
      ctx.fillRect(0, 0, PIXEL_WIDTH, PIXEL_HEIGHT)
    }
  }

  private blackAt(t: number): number {
    if (this.skipAt !== null) {
      const p = (t - this.skipAt) / SKIP_FADE
      return p < 0 ? 0 : p > 1 ? 1 : p
    }
    if (t < FADE_IN) return 1 - t / FADE_IN
    const outStart = this.spec.duration - FADE_OUT
    if (t > outStart) {
      const p = (t - outStart) / FADE_OUT
      return p > 1 ? 1 : p
    }
    return 0
  }

  /** 当前应显示的字幕（按 at/end 命中，仅一条） */
  static lineAt(spec: Playable2D, t: number): Playable2D['lines'][number] | null {
    for (const line of spec.lines) {
      if (t >= line.at && t < line.end) return line
    }
    return null
  }

  private playSfx(sfx: string): void {
    const sound = this.deps.sound
    switch (sfx) {
      case 'doorLock':
        sound.playDoorLock()
        break
      case 'doorCreak':
        sound.playDoorCreak()
        break
      case 'lowThump':
        sound.playLowThump()
        break
      case 'chairCreak':
        sound.playChairCreak()
        break
      case 'paperRustle':
        sound.playPaperRustle()
        break
      case 'bossBreath':
        sound.playBossBreath()
        break
      case 'stitch':
        sound.playStitch()
        break
      case 'coin':
        sound.playCoin()
        break
      case 'spin':
        sound.playSpin()
        break
      default:
        break
    }
  }
}

/** 供覆盖层复用：把一句话的首字时间算出来（打字机从 at 起笔） */
export type PlayableLine = Playable2D['lines'][number]
