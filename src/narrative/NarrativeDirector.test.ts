import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoundEngine } from '../audio/SoundEngine'
import type { SceneManager } from '../scene/SceneManager'
import { NarrativeDirector, type NarrativeMode } from './NarrativeDirector'
import { INTRO_BEATS, RESTART_BEATS, T2_BEATS, T3_BEATS } from './script'

function createDirector() {
  const scene = { resetNarrativeGrade: vi.fn() } as unknown as SceneManager
  const onVisual = vi.fn()
  const onGameStart = vi.fn()
  const onFinish = vi.fn()
  const director = new NarrativeDirector({
    scene,
    sound: {} as SoundEngine,
    onVisual,
    onGameStart,
    onFinish,
  })
  return { director, onVisual, onGameStart, onFinish }
}

describe('对话分镜时序', () => {
  it.each([
    ['intro', INTRO_BEATS],
    ['restart', RESTART_BEATS],
    ['t2', T2_BEATS],
    ['t3', T3_BEATS],
  ] as const)('%s 的节拍按时间递增且对白不重叠', (_mode, beats) => {
    for (let i = 1; i < beats.length; i += 1) {
      expect(beats[i].at).toBeGreaterThanOrEqual(beats[i - 1].at)
    }
    const lines = beats.filter((beat) => beat.line && beat.lineEnd)
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i].at).toBeGreaterThanOrEqual(lines[i - 1].lineEnd!)
    }
  })
})

describe('NarrativeDirector skip', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each<NarrativeMode>(['t2', 't3', 'endingB'])('%s 跳过时不启动或重启游戏', (mode) => {
    const { director, onVisual, onGameStart, onFinish } = createDirector()
    director.start(mode)
    director.skip()

    expect(onGameStart).not.toHaveBeenCalled()
    expect(onFinish).toHaveBeenCalledOnce()
    expect(onVisual).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }))
  })

  it.each<NarrativeMode>(['intro', 'restart'])('%s 跳过时仍只启动一次游戏', (mode) => {
    const { director, onGameStart, onFinish } = createDirector()
    director.start(mode)
    director.skip()
    director.skip()

    expect(onGameStart).toHaveBeenCalledOnce()
    expect(onFinish).toHaveBeenCalledOnce()
  })
})
