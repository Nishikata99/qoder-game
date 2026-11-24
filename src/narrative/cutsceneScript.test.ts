import { describe, expect, it } from 'vitest'
import { CUTSCENES, RELOAD_TAIL, cutsceneFor } from './cutsceneScript'

describe('cutsceneScript 分镜契约', () => {
  it('只为第 2、3 层各提供一段过场，第 1 层与终局没有', () => {
    expect(Object.keys(CUTSCENES).map(Number).sort()).toEqual([1, 2])
    expect(cutsceneFor(0)).toBeNull()
    expect(cutsceneFor(1)).not.toBeNull()
    expect(cutsceneFor(2)).not.toBeNull()
    expect(cutsceneFor(3)).toBeNull()
  })

  it('每段时长不超过 8s，且足够容纳剧情（≥6s）', () => {
    for (const spec of Object.values(CUTSCENES)) {
      expect(spec.duration).toBeGreaterThanOrEqual(6)
      expect(spec.duration).toBeLessThanOrEqual(8)
    }
  })

  it('尾部恢复引擎的时点必须留出 RELOAD_TAIL，且为正', () => {
    // 过场在 duration - RELOAD_TAIL 恢复引擎，装弹/发牌在淡出期完成，
    // 所以该时点必须落在过场中段之后，否则等于没提前
    for (const spec of Object.values(CUTSCENES)) {
      const resumeAt = spec.duration - RELOAD_TAIL
      expect(resumeAt).toBeGreaterThan(0)
      expect(resumeAt).toBeLessThan(spec.duration)
      expect(resumeAt).toBeGreaterThan(spec.duration * 0.5)
    }
  })

  it('每条 cue 都落在时长之内且按时间递增', () => {
    for (const spec of Object.values(CUTSCENES)) {
      let last = -1
      for (const cue of spec.cues) {
        expect(cue.at).toBeGreaterThanOrEqual(0)
        expect(cue.at).toBeLessThan(spec.duration)
        expect(cue.at).toBeGreaterThan(last)
        last = cue.at
      }
    }
  })

  it('字幕按时间递增、不重叠，且都收在时长内', () => {
    for (const spec of Object.values(CUTSCENES)) {
      let lastEnd = -1
      for (const line of spec.lines) {
        expect(line.text.length).toBeGreaterThan(0)
        expect(line.at).toBeGreaterThanOrEqual(0)
        expect(line.end).toBeGreaterThan(line.at)
        expect(line.end).toBeLessThanOrEqual(spec.duration)
        // 上一句结束后才起下一句，避免同屏两句
        expect(line.at).toBeGreaterThanOrEqual(lastEnd)
        lastEnd = line.end
      }
    }
  })

  it('二层过场使用敌人通道且不显示旧称呼', () => {
    const text = CUTSCENES[1].lines.map((line) => line.text).join('')
    expect(CUTSCENES[1].lines[0].channel).toBe('enemy')
    expect(CUTSCENES[1].dialogueAnchor).toBeDefined()
    expect(text).not.toContain('赖账犬')
    expect(text).not.toContain('讨债人')
  })

  it('每段至少两句字幕，保证能读出情节推进', () => {
    for (const spec of Object.values(CUTSCENES)) {
      expect(spec.lines.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('layer 号与 levelIndex 对应（进第 2 层显示 2，进第 3 层显示 3）', () => {
    for (const [key, spec] of Object.entries(CUTSCENES)) {
      expect(spec.levelIndex).toBe(Number(key))
      expect(spec.layer).toBe(spec.levelIndex + 1)
    }
  })

  it('两段过场都不引用外部素材路径', () => {
    for (const spec of Object.values(CUTSCENES)) {
      expect(typeof spec.draw).toBe('function')
      const src = spec.draw.toString()
      expect(src).not.toContain('.png')
      expect(src).not.toContain('.webm')
      expect(src).not.toContain('.mp4')
    }
  })
})
