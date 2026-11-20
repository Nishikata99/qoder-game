import type { CameraShot } from '../scene/SceneManager'

export interface NarrativeGrade {
  readonly fog?: number
  readonly vignette?: number
  readonly grain?: number
  readonly lamp?: number
  readonly flicker?: number
}

export type NarrativeSfx =
  | 'chairCreak'
  | 'doorLock'
  | 'paperRustle'
  | 'spin'
  | 'lowThump'
  | 'bossBreath'
  | 'coin'
  | 'stitch'

export interface NarrativeBeat {
  readonly at: number
  readonly shot?: CameraShot
  readonly shotDuration?: number
  readonly line?: string
  readonly lineEnd?: number
  readonly sfx?: NarrativeSfx
  readonly grade?: NarrativeGrade
  readonly black?: number
  readonly letterbox?: boolean
  /** 账页面片滑入/滑出（T3） */
  readonly ledger?: boolean
  /** 逐章压力档位：0 门厅 1 账房 2 刑台 */
  readonly mood?: number
  readonly action?: 'startGame' | 'headSnap' | 'finish' | 'sutureGlow' | 'reachHand'
}

/** 入场 ≈40s（含 T1），永久不可跳过；时间轴见 docs/NARRATIVE-DESIGN.md §2 */
export const INTRO_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 1, letterbox: true, grade: { fog: 0.06, vignette: 1.2, grain: 0.12, lamp: 0 } },
  { at: 2.5, black: 0, shot: 'introWake', shotDuration: 1.6, sfx: 'lowThump', grade: { lamp: 1, flicker: 3 } },
  { at: 2.6, line: '你醒了。', lineEnd: 5.2 },
  { at: 5.5, shot: 'introStain', shotDuration: 1.4, sfx: 'chairCreak', grade: { flicker: 1 } },
  { at: 5.7, line: '你不记得自己是怎么坐下的。', lineEnd: 8.8 },
  { at: 9, shot: 'introPaper', shotDuration: 1.3, sfx: 'paperRustle' },
  { at: 9.2, line: '你是自己走进来的。', lineEnd: 12.2 },
  { at: 12.5, shot: 'introDoor', shotDuration: 1.2, sfx: 'doorLock' },
  { at: 12.8, line: '门在你身后锁了。', lineEnd: 15.6 },
  { at: 16, shot: 'introTowel', shotDuration: 1.4 },
  { at: 20, shot: 'table', shotDuration: 1.6, sfx: 'spin' },
  { at: 20.2, line: '规矩你懂。赢了，往下走。', lineEnd: 23.6 },
  { at: 24, line: '输了——', lineEnd: 26, grade: { flicker: 2.5 } },
  { at: 26.2, line: '就留下来。', lineEnd: 28.8 },
  { at: 29, shot: 'victory', shotDuration: 1.6, sfx: 'bossBreath', grade: { flicker: 1 } },
  { at: 29.2, line: '上一个坐这位置的人，也攥着这么一张纸。', lineEnd: 33.6 },
  {
    at: 34,
    action: 'startGame',
    shot: 'table',
    shotDuration: 2.2,
    black: 0,
    grade: { fog: 0.042, vignette: 0.85, grain: 0.04 },
  },
  { at: 34.5, letterbox: false },
  { at: 36.6, action: 'headSnap', sfx: 'lowThump', line: '它抬起头。', lineEnd: 39.4 },
  { at: 40, action: 'finish' },
]

/** restart 迷你入场 ≈4.2s：换一位坐下的客人；同样不可跳过 */
export const RESTART_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 1, letterbox: true, mood: 0, grade: { lamp: 0.15, flicker: 3 } },
  { at: 0.3, sfx: 'chairCreak', line: '灯没有熄灭，只是换了一位坐下的客人。', lineEnd: 3.6 },
  { at: 1.2, grade: { lamp: 1, flicker: 1 } },
  { at: 1.4, action: 'startGame' },
  { at: 3.8, black: 0, letterbox: false },
  { at: 4.2, action: 'finish' },
]

/** T2 ch1→ch2 ≈6.5s：骑 levelClear→supply 窗口，覆盖层压在 supply 面板上方 */
export const T2_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, sfx: 'coin', grade: { lamp: 0.55, flicker: 1.3 } },
  { at: 0.3, line: '你找的人，欠我一笔。', lineEnd: 4.4 },
  { at: 2.6, mood: 1 },
  { at: 4.2, action: 'headSnap', sfx: 'lowThump' },
  { at: 6.5, action: 'finish', letterbox: false },
]

/** T3 ch2→ch3 ≈6.5s：账页滑入「小满。已收。」，门缝光随 mood 2 熄灭 */
export const T3_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, sfx: 'paperRustle', grade: { lamp: 0.55, flicker: 1.6 } },
  { at: 0.4, ledger: true },
  { at: 2.6, mood: 2 },
  { at: 4.2, action: 'headSnap', sfx: 'doorLock' },
  { at: 4.8, ledger: false },
  { at: 6.5, action: 'finish', letterbox: false },
]

/** 结局 B「团聚·吞噬即重逢」≈7.2s：缝线透光 → 伸手 → 黑屏缝线声；无旁白，线索闭合 */
export const ENDING_B_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, grade: { lamp: 0.7, flicker: 1.6 } },
  { at: 0.5, action: 'sutureGlow' },
  { at: 2.8, shot: 'endingReach', shotDuration: 1.8 },
  { at: 3.4, action: 'reachHand', sfx: 'stitch' },
  { at: 5.6, black: 1, sfx: 'stitch' },
  { at: 7.2, action: 'finish', letterbox: false },
]