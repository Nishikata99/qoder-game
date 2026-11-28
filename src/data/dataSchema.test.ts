import { describe, expect, it } from 'vitest'
import narrative from './narrative.json'
import game from './game.json'
import beats from './beats.json'
import cutscenes from './cutscenes.json'
import { LEVELS, ITEM_CATALOG, TRUMP_CATALOG, TRUMP_WEIGHTS, ITEM_IDS, TRUMP_IDS, LEVEL_UNLOCKS } from '../game/GameEngine'
import { BOSS_NAME, LEVEL_NARRATIVE } from '../narrative/copy'
import { INTRO_BEATS, RESTART_BEATS, T2_BEATS, T3_BEATS } from '../narrative/script'
import { CUTSCENES } from '../narrative/cutsceneScript'
import { ENDINGS } from '../narrative/endingScript'

describe('data JSON schema', () => {
  it('narrative covers all three levels and every item flavor', () => {
    expect(BOSS_NAME).toBeTruthy()
    expect(LEVEL_NARRATIVE).toHaveLength(3)
    for (const l of LEVEL_NARRATIVE) {
      expect(l.name.trim()).not.toBe('')
      expect(l.title.trim()).not.toBe('')
    }
    for (const id of ITEM_IDS) expect(narrative.itemFlavor[id], id).toBeTruthy()
  })

  it('levels config matches engine contract', () => {
    expect(LEVELS).toHaveLength(3)
    LEVELS.forEach((l, i) => {
      expect(l.id).toBe(i + 1)
      expect(l.hp).toBeGreaterThan(0)
      expect(l.playerHp).toBeGreaterThan(0)
      expect(l.supply).toBeGreaterThanOrEqual(0)
      expect(l.supply).toBeLessThanOrEqual(8)
      expect(['cautious', 'gambler', 'executioner']).toContain(l.personality)
    })
    expect(LEVEL_UNLOCKS).toHaveLength(3)
  })

  it('catalogs cover every trump and item with text', () => {
    for (const id of TRUMP_IDS) {
      expect(TRUMP_CATALOG[id].id).toBe(id)
      expect(TRUMP_CATALOG[id].name.trim()).not.toBe('')
      expect(TRUMP_CATALOG[id].summary.trim()).not.toBe('')
      expect(TRUMP_WEIGHTS[id]).toBeGreaterThanOrEqual(0)
    }
    for (const id of ITEM_IDS) {
      expect(ITEM_CATALOG[id].id).toBe(id)
      expect(ITEM_CATALOG[id].name.trim()).not.toBe('')
      expect(ITEM_CATALOG[id].summary.trim()).not.toBe('')
    }
  })

  it('sfx files point at public/audio paths', () => {
    for (const v of Object.values(game.sfxFiles)) {
      expect(v).toMatch(/^audio\/[\w.-]+\.(ogg|wav|mp3)$/)
    }
  })

  it('beat lines have sane windows and channels', () => {
    for (const sec of ['intro', 'restart', 't2', 't3'] as const) {
      expect(beats[sec].length).toBeGreaterThan(0)
      for (const e of beats[sec]) {
        expect(e.line.trim()).not.toBe('')
        expect(e.lineEnd).toBeGreaterThan(e.at)
        expect(['player', 'enemy', 'sister']).toContain(e.channel)
      }
    }
  })

  it('cutscene and ending lines stay inside their duration', () => {
    for (const spec of Object.values(cutscenes.cutscenes)) {
      for (const l of spec.lines) {
        expect(l.text.trim()).not.toBe('')
        expect(l.end).toBeGreaterThan(l.at)
        expect(l.end).toBeLessThanOrEqual(spec.duration + 0.01)
      }
    }
    for (const spec of Object.values(cutscenes.endings)) {
      for (const l of spec.lines) expect(l.end).toBeLessThanOrEqual(spec.duration + 0.01)
      expect(typeof spec.skippable).toBe('boolean')
    }
  })

  it('runtime beats/cutscenes/endings actually read the JSON lines', () => {
    expect(INTRO_BEATS.filter((b) => b.line !== undefined).map((b) => b.line)).toEqual(beats.intro.map((e) => e.line))
    expect(RESTART_BEATS.filter((b) => b.line !== undefined).map((b) => b.line)).toEqual(beats.restart.map((e) => e.line))
    expect(T2_BEATS.filter((b) => b.line !== undefined).map((b) => b.line)).toEqual(beats.t2.map((e) => e.line))
    expect(T3_BEATS.filter((b) => b.line !== undefined).map((b) => b.line)).toEqual(beats.t3.map((e) => e.line))
    for (const id of ['1', '2'] as const) {
      expect(CUTSCENES[Number(id)].lines.map((l) => l.text)).toEqual(cutscenes.cutscenes[id].lines.map((l) => l.text))
      expect(CUTSCENES[Number(id)].duration).toBe(cutscenes.cutscenes[id].duration)
    }
    for (const id of ['win', 'lose'] as const) {
      expect(ENDINGS[id].lines.map((l) => l.text)).toEqual(cutscenes.endings[id].lines.map((l) => l.text))
      expect(ENDINGS[id].duration).toBe(cutscenes.endings[id].duration)
      expect(ENDINGS[id].skippable).toBe(cutscenes.endings[id].skippable)
    }
    for (const key of ['level1', 'level3'] as const) {
      expect(beats.clues[key].length).toBeGreaterThan(0)
      for (const e of beats.clues[key]) {
        expect(e.text.trim()).not.toBe('')
        expect(e.durationMs).toBeGreaterThanOrEqual(300)
        expect(['player', 'enemy', 'sister']).toContain(e.channel)
      }
    }
  })
})
