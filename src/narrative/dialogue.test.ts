import { describe, expect, it } from 'vitest'
import { CUTSCENES } from './cutsceneScript'
import { typingDurationMs } from './dialogue'
import { ENDINGS } from './endingScript'

describe('narrative typing windows', () => {
  it('2D 章节字幕能在显示窗口内打完', () => {
    for (const spec of Object.values(CUTSCENES)) {
      for (const line of spec.lines) {
        expect(typingDurationMs(line.text), line.text).toBeLessThanOrEqual((line.end - line.at) * 1000 - 80)
      }
    }
  })

  it('结局字幕能在显示窗口内打完', () => {
    for (const spec of Object.values(ENDINGS)) {
      for (const line of spec.lines) {
        expect(typingDurationMs(line.text), line.text).toBeLessThanOrEqual((line.end - line.at) * 1000 - 80)
      }
    }
  })
})
