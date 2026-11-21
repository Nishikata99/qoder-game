import type { SoundEngine } from '../audio/SoundEngine'
import type { SceneManager } from '../scene/SceneManager'
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
  private visual: NarrativeVisual = { active: false, black: 0, focus: 0, letterbox: false, ledger: false, subtitle: null }

  constructor(deps: NarrativeDeps) {
    this.deps = deps
  }

  now(): number {
    return this.time
  }

  start(mode: NarrativeMode): void {
    this.stop()
    this.beats = BEATS_BY_MODE[mode]
    this.index = 0
    this.time = 0
    this.lastTs = null
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

  private readonly tick = (ts: number): void => {
    if (!this.running) return
    this.rafId = requestAnimationFrame(this.tick)
    if (this.lastTs === null) {
      this.lastTs = ts
      return
    }
    // 后台回来时 dt  clamp，避免一口气补播积压的分镜
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000)
    this.lastTs = ts
    this.time += dt
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
      next = { ...next, subtitle: { text: beat.line, at: this.time, end: beat.lineEnd ?? this.time + 3 } }
    }
    if (next !== this.visual) {
      this.visual = next
      this.deps.onVisual(next)
    }
    if (beat.action === 'startGame') this.deps.onGameStart()
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