import { describe, expect, it } from 'vitest'
import { ENDINGS } from './endingScript'

describe('endingScript 结局分镜契约', () => {
  it('胜利与失败各一段', () => {
    expect(Object.keys(ENDINGS).sort()).toEqual(['lose', 'win'])
    expect(ENDINGS.win.id).toBe('win')
    expect(ENDINGS.lose.id).toBe('lose')
  })

  it('胜利不可跳过，失败可跳过', () => {
    expect(ENDINGS.win.skippable).toBe(false)
    expect(ENDINGS.lose.skippable).toBe(true)
  })

  it('胜利段足够长（一次性终局），失败段不拖沓', () => {
    expect(ENDINGS.win.duration).toBeGreaterThanOrEqual(8)
    expect(ENDINGS.win.duration).toBeLessThanOrEqual(12)
    expect(ENDINGS.lose.duration).toBeGreaterThanOrEqual(6)
    expect(ENDINGS.lose.duration).toBeLessThanOrEqual(9)
  })

  it('cue 落在时长内且按时间递增', () => {
    for (const spec of Object.values(ENDINGS)) {
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
    for (const spec of Object.values(ENDINGS)) {
      let lastEnd = -1
      for (const line of spec.lines) {
        expect(line.text.length).toBeGreaterThan(0)
        expect(line.at).toBeGreaterThanOrEqual(0)
        expect(line.end).toBeGreaterThan(line.at)
        expect(line.end).toBeLessThanOrEqual(spec.duration)
        expect(line.at).toBeGreaterThanOrEqual(lastEnd)
        lastEnd = line.end
      }
    }
  })

  it('两段各有至少两句字幕，能读出收束', () => {
    expect(ENDINGS.win.lines.length).toBeGreaterThanOrEqual(2)
    expect(ENDINGS.lose.lines.length).toBeGreaterThanOrEqual(2)
  })

  it('不引用外部素材', () => {
    for (const spec of Object.values(ENDINGS)) {
      expect(typeof spec.draw).toBe('function')
      const src = spec.draw.toString()
      expect(src).not.toContain('.png')
      expect(src).not.toContain('.webm')
      expect(src).not.toContain('.mp4')
    }
  })
})
