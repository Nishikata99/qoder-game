import type { SoundEngine } from '../audio/SoundEngine'
import type { SceneManager } from '../scene/SceneManager'
import type { DialogueChannel } from './dialogue'
import {
  ENDING_B_BEATS,
  INTRO_BEATS,
  RESTART_BEATS,
  T2_BEATS,
  T3_BEATS,
  type NarrativeBeat,
} from './script'

export type NarrativeMode = 'intro' | 'restart' | 't2' | 't3' | 'endingB'

const BEATS_BY_MODE: Record<NarrativeMode, readonly NarrativeBeat[]> = {
  intro: INTRO_BEATS,
  restart: RESTART_BEATS,
  t2: T2_BEATS,
  t3: T3_BEATS,
  endingB: ENDING_B_BEATS,
}

export interface NarrativeSubtitle {
  readonly text: string
  readonly at: number
  readonly end: number
  readonly channel: DialogueChannel
}

export interface NarrativeVisual {
  readonly active: boolean
  readonly black: number
  readonly focus: number
  readonly letterbox: boolean
  readonly ledger: boolean
  readonly subtitle: NarrativeSubtitle | null
}

export interface NarrativeDeps {
  readonly scene: SceneManager
  readonly sound: SoundEngine
  readonly onVisual: (visual: NarrativeVisual) => void
  readonly onGameStart: () => void
  readonly onFinish: () => void
}

/**
 * 叙事导演：rAF 时钟推进分镜（后台标签页 rAF 停摆 = 自动暂停），
 * 只调用 SceneManager / SoundEngine 的对外接口，不碰引擎。
 */
export class NarrativeDirector {
  private readonly deps: NarrativeDeps
  private beats: readonly NarrativeBeat[] = []
  private index = 0
  private time = 0
  private rafId: number | null = null
  private lastTs: number | null = null
  private running = false
  private mode: NarrativeMode = 'intro'
  private startedGame = false
  private visual: NarrativeVisual = { active: false, black: 0, focus: 0, letterbox: false, ledger: false, subtitle: null }

  constructor(deps: NarrativeDeps) {
    this.deps = deps
  }

  now(): number {
    return this.time
  }

  bossDialogueAnchor(): { x: number; y: number; visible: boolean } {
    return this.deps.scene.getBossDialogueAnchor()
  }

  start(mode: NarrativeMode): void {
    this.stop()
    this.mode = mode
    this.beats = BEATS_BY_MODE[mode]
    this.index = 0
    this.time = 0
    this.lastTs = null
    this.startedGame = false
    this.running = true
    // 入场/重开从全黑起；章节过渡骑在胜利远景上，不能先黑一帧
    const dark = mode === 'intro' || mode === 'restart'
    this.visual = { active: true, black: dark ? 1 : 0, focus: 0, letterbox: dark, ledger: false, subtitle: null }
    this.deps.onVisual(this.visual)
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop(): void {
    this.running = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.rafId = null
    this.lastTs = null
  }

  resume(): void {
    if (this.running || !this.visual.active) return
    this.running = true
    this.lastTs = null
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 已读后跳过：入场/重开补一次启动，章节过渡只结束剧情并保留引擎进度 */
  skip(): void {
    if (!this.visual.active) return
    if (!this.startedGame && (this.mode === 'intro' || this.mode === 'restart')) this.deps.onGameStart()
    this.stop()
    this.deps.scene.resetNarrativeGrade()
    this.visual = { ...this.visual, active: false, subtitle: null, ledger: false }
    this.deps.onVisual(this.visual)
    this.deps.onFinish()
  }

  private readonly tick = (ts: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.tick)
    if (this.lastTs === null) {
      this.lastTs = ts
      return
    }
    const raw = (ts - this.lastTs) / 1000
    this.lastTs = ts
    // 后台标签页 rAF 本就停摆；这里再兜一层，防止某些环境回补大量帧
    if (document.hidden) return
    // 低帧率按真实时间推进，最多补 0.25s，避免镜头跳过整拍
    this.time += Math.min(0.25, raw)
    while (this.index < this.beats.length && this.beats[this.index]!.at <= this.time) {
      this.apply(this.beats[this.index]!)
      this.index += 1
    }
    if (this.visual.subtitle && this.time >= this.visual.subtitle.end) {
      this.visual = { ...this.visual, subtitle: null }
      this.deps.onVisual(this.visual)
    }
  }

  private apply(beat: NarrativeBeat): void {
    const { scene, sound } = this.deps
    if (beat.shot) scene.setShot(beat.shot, beat.shotDuration ?? 1.2)
    if (beat.grade) scene.setNarrativeGrade(beat.grade)
    if (beat.sfx) {
      switch (beat.sfx) {
        case 'chairCreak':
          sound.playChairCreak()
          break
        case 'doorLock':
          sound.playDoorLock()
          break
        case 'paperRustle':
          sound.playPaperRustle()
          break
        case 'spin':
          sound.playSpin()
          break
        case 'lowThump':
          sound.playLowThump()
          break
        case 'bossBreath':
          sound.playBossBreath()
          break
        case 'coin':
          sound.playCoin()
          break
        case 'stitch':
          sound.playStitch()
          break
      }
    }
    if (beat.mood !== undefined) scene.setChapterMood(beat.mood)
    let next = this.visual
    if (beat.black !== undefined) next = { ...next, black: beat.black }
    if (beat.focus !== undefined) next = { ...next, focus: beat.focus }
    if (beat.letterbox !== undefined) next = { ...next, letterbox: beat.letterbox }
    if (beat.ledger !== undefined) next = { ...next, ledger: beat.ledger }
    if (beat.line) {
      next = {
        ...next,
        subtitle: {
          text: beat.line,
          at: this.time,
          end: beat.lineEnd ?? this.time + 3,
          channel: beat.channel ?? 'player',
        },
      }
    }
    if (next !== this.visual) {
      this.visual = next
      this.deps.onVisual(next)
    }
    if (beat.action === 'startGame') {
      this.startedGame = true
      this.deps.onGameStart()
    }
    if (beat.action === 'headSnap') scene.triggerHeadSnap()
    if (beat.action === 'sutureGlow') scene.triggerSutureGlow()
    if (beat.action === 'reachHand') scene.triggerReachHand()
    if (beat.action === 'finish') {
      this.stop()
      scene.resetNarrativeGrade()
      this.deps.onFinish()
    }
  }
}