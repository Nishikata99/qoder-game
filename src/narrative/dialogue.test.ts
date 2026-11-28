import { describe, expect, it } from 'vitest'
import beats from '../data/beats.json'
import { CUTSCENES } from './cutsceneScript'
import { typingDurationMs } from './dialogue'
import { ENDINGS } from './endingScript'

describe('narrative typing windows', () => {
  it('剧情对白能在显示窗口内打完', () => {
    for (const section of ['intro', 'restart', 't2', 't3'] as const) {
      for (const line of beats[section]) {
        expect(typingDurationMs(line.line), line.line).toBeLessThanOrEqual((line.lineEnd - line.at) * 1000 - 80)
      }
    }
  })

  it('开局线索的停留时间足够打完', () => {
    for (const lines of Object.values(beats.clues)) {
      for (const line of lines) {
        expect(typingDurationMs(line.text), line.text).toBeLessThanOrEqual(line.durationMs - 80)
      }
    }
  })

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
