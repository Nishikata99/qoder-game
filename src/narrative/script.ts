import type { CameraShot } from '../scene/SceneManager'

export interface NarrativeGrade {
  readonly fog?: number
  readonly vignette?: number
  readonly grain?: number
  readonly lamp?: number
  readonly flicker?: number
  /** 第一人称头部失衡幅度：苏醒时较大，落座后归零 */
  readonly sway?: number
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
  /** DOM 对焦模糊半径（px），只糊 3D 画面，不糊字幕 */
  readonly focus?: number
  readonly letterbox?: boolean
  /** 账页面片滑入/滑出（T3） */
  readonly ledger?: boolean
  /** 逐章压力档位：0 门厅 1 账房 2 刑台 */
  readonly mood?: number
  readonly action?: 'startGame' | 'headSnap' | 'finish' | 'sutureGlow' | 'reachHand'
}

/** 入场 ≈40s（含 T1），永久不可跳过；时间轴见 docs/NARRATIVE-REWORK-PLAN.md §2.2 */
export const INTRO_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 1, letterbox: true, focus: 16, grade: { fog: 0.06, vignette: 1.2, grain: 0.12, lamp: 0, sway: 1.2 } },
  { at: 1.2, black: 0.65, shot: 'introWake', shotDuration: 2.4 },
  { at: 1.8, black: 0.9 },
  { at: 2.5, black: 0, focus: 10, sfx: 'lowThump', grade: { lamp: 1, flicker: 3, sway: 1 } },
  { at: 2.8, line: '这是哪儿……我怎么坐在这？', lineEnd: 5.2 },
  { at: 4.0, focus: 5 },
  { at: 5.5, shot: 'introStain', shotDuration: 2.2, sfx: 'chairCreak', focus: 1.5, grade: { flicker: 1.2, sway: 0.8 } },
  { at: 5.5, line: '我推开了门，之后……什么都不记得了。', lineEnd: 8.6 },
  { at: 6.5, focus: 0 },
  { at: 9, shot: 'introPaper', shotDuration: 2.4, sfx: 'paperRustle', grade: { sway: 0.65 } },
  { at: 9, line: '我的契纸……怎么在桌上？只剩一个「棠」字。', lineEnd: 12.1 },
  { at: 12.5, shot: 'introDoor', shotDuration: 2.5, sfx: 'doorLock', grade: { sway: 0.55 } },
  { at: 12.5, line: '门什么时候锁的？……外面还有光。', lineEnd: 15.5 },
  { at: 16, shot: 'introTowel', shotDuration: 2.8, sfx: 'bossBreath', grade: { sway: 0.45 } },
  { at: 20, shot: 'introTable', shotDuration: 3.0, sfx: 'spin', grade: { sway: 0.25 } },
  { at: 20, line: '契上写着：三层，二十一袋血。赢了，才能去找她。', lineEnd: 23.6 },
  { at: 24, line: '输了——', lineEnd: 25.9, sfx: 'lowThump', grade: { flicker: 3.2 } },
  { at: 26.2, line: '血和名字，都归这张桌子。', lineEnd: 28.6, grade: { flicker: 1.0 } },
  { at: 29, shot: 'introBoss', shotDuration: 1.8, sfx: 'bossBreath', grade: { sway: 0.12 } },
  { at: 29, line: '这把椅子……她也坐过，对吗？', lineEnd: 33.2 },
  {
    at: 34,
    action: 'startGame',
    shot: 'table',
    shotDuration: 2.0,
    black: 0,
    letterbox: false,
    grade: { fog: 0.042, vignette: 0.85, grain: 0.04, sway: 0 },
  },
  { at: 36.6, action: 'headSnap', sfx: 'lowThump', line: '它抬头了。牌，发下来了。', lineEnd: 39.5 },
  { at: 40, action: 'finish' },
]

/** restart 迷你入场 ≈4.2s：换一位坐下的客人；同样不可跳过 */
export const RESTART_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 1, letterbox: true, mood: 0, grade: { lamp: 0.15, flicker: 3 } },
  { at: 0.3, sfx: 'chairCreak', line: '血袋换了一批新的。椅扶手上，抓痕又深了一道。', lineEnd: 3.2 },
  { at: 1.2, grade: { lamp: 1, flicker: 1 } },
  { at: 1.4, action: 'startGame' },
  { at: 3.8, black: 0, letterbox: false },
  { at: 4.2, action: 'finish' },
]

/** T2 ch1→ch2 ≈6.5s：骑 levelClear→supply 窗口，覆盖层压在 supply 面板上方 */
export const T2_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, sfx: 'coin', grade: { lamp: 0.65, flicker: 1.3 } },
  { at: 0.3, line: '小棠替你抵了七袋血，还欠账房一笔——你来补。', lineEnd: 3.8 },
  { at: 2.6, mood: 1 },
  { at: 4.2, action: 'headSnap', sfx: 'lowThump', line: '账房的狗，最喜欢赌命。', lineEnd: 6.1 },
  { at: 6.5, action: 'finish', letterbox: false },
]

/** T3 ch2→ch3 ≈6.5s：账页滑入「小满。已收。」，门缝光随 mood 2 熄灭 */
export const T3_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, sfx: 'paperRustle', grade: { lamp: 0.55, flicker: 1.6 } },
  { at: 0.4, ledger: true },
  { at: 0.6, line: '账已经销了。她没走出去，被送去了刑台「补针」。', lineEnd: 3.9 },
  { at: 2.6, mood: 2 },
  { at: 4.2, action: 'headSnap', sfx: 'doorLock', line: '身后最后一道门缝光，灭了。', lineEnd: 6.1 },
  { at: 4.8, ledger: false },
  { at: 6.5, action: 'finish', letterbox: false },
]

/** 结局 B「团聚·吞噬即重逢」≈7.2s：缝线透光 → 伸手 → 黑屏缝线声；无旁白，线索闭合 */
export const ENDING_B_BEATS: readonly NarrativeBeat[] = [
  { at: 0, black: 0, letterbox: true, shot: 'table', shotDuration: 2.8, grade: { lamp: 0.7, vignette: 1.15 } },
  { at: 0.5, action: 'sutureGlow', sfx: 'bossBreath' },
  { at: 2.8, shot: 'endingReach', shotDuration: 2.8, grade: { lamp: 0.55 } },
  { at: 3.4, action: 'reachHand', sfx: 'stitch' },
  { at: 5.6, black: 1, sfx: 'stitch', grade: { lamp: 0 } },
  { at: 7.2, action: 'finish', letterbox: false },
]