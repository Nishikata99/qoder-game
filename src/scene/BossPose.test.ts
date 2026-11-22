import { describe, expect, it } from 'vitest'
import { BOSS_POSE_PROFILES, BossPoseController, shouldRespawnBossPose } from './BossPose'
import type { BossPoseSample, BossPoseState, BossPoseSnapshotFacts } from './BossPose'

const STEP = 1 / 60
const CHANNELS: readonly (keyof BossPoseSample)[] = [
  'pitch',
  'yaw',
  'roll',
  'y',
  'z',
  'headPitch',
  'headRoll',
  'armL',
  'armR',
  'lookWeight',
]

function advance(controller: BossPoseController, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) controller.update(STEP)
}

function recordStates(controller: BossPoseController, seconds: number): BossPoseState[] {
  const seen: BossPoseState[] = []
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    controller.update(STEP)
    const state = controller.state()
    if (seen[seen.length - 1] !== state) seen.push(state)
  }
  return seen
}

function sampleWhen(controller: BossPoseController, target: BossPoseState, seconds: number): BossPoseSample {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    controller.update(STEP)
    if (controller.state() === target) return controller.sample()
  }
  throw new Error(`未进入状态 ${target}`)
}

function hit(level: number, overrides: Partial<{ damage: number; hpAfter: number; maxHp: number }> = {}) {
  return { damage: 2, hpAfter: 6, maxHp: 8, level, ...overrides }
}

describe('BossPoseController', () => {
  it('普通命中走完整倒地/起身并回到 idle', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    const seen = recordStates(controller, 8)
    expect(seen).toEqual([
      'impact',
      'collapse',
      'prone',
      'brace',
      'push',
      'rise',
      'recover',
      'idle',
    ])
    expect(controller.state()).toBe('idle')
    expect(controller.sample().pitch).toBeCloseTo(0)
    expect(controller.sample().lookWeight).toBe(1)
  })

  it('致死命中停在 deadProne，之后也不再起身', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0, { damage: 9, hpAfter: 0 }))
    const seen = recordStates(controller, 8)
    expect(seen).toEqual(['impact', 'collapse', 'deadProne'])
    advance(controller, 12)
    expect(controller.state()).toBe('deadProne')

    controller.triggerHit(hit(0))
    expect(controller.state()).toBe('deadProne')
  })

  it('起身途中再次命中时从当前姿态连续接回', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    advance(controller, 1.4)
    const before = controller.sample()

    controller.triggerHit(hit(0, { damage: 4, hpAfter: 3 }))
    controller.update(STEP)
    const after = controller.sample()

    for (const channel of CHANNELS) {
      expect(Math.abs(after[channel] - before[channel])).toBeLessThan(0.05)
    }

    advance(controller, 8)
    expect(controller.state()).toBe('idle')
  })

  it('reset 与 spawn 能清掉致死姿态', () => {
    const controller = new BossPoseController()
    controller.triggerDefeat(0)
    advance(controller, 4)
    expect(controller.state()).toBe('deadProne')

    controller.reset()
    expect(controller.state()).toBe('idle')
    expect(controller.sample().pitch).toBe(0)

    controller.spawn(1)
    expect(controller.state()).toBe('spawn')
    advance(controller, 2)
    expect(controller.state()).toBe('idle')
  })

  it('每关使用不同的倒地幅度', () => {
    const l1 = new BossPoseController()
    l1.triggerHit(hit(0))
    const proneL1 = sampleWhen(l1, 'prone', 2)

    const l3 = new BossPoseController()
    l3.triggerHit(hit(2))
    const proneL3 = sampleWhen(l3, 'prone', 2)

    expect(proneL1.pitch).toBeGreaterThan(proneL3.pitch + 0.2)
    expect(BOSS_POSE_PROFILES[2].riseLift).toBeGreaterThan(0)
  })

  it('L2 拖起带两次轻颤，L3 悬吊自转且不共用 L1 手臂', () => {
    const l2 = new BossPoseController()
    l2.triggerHit(hit(1))
    while (l2.state() !== 'brace') l2.update(STEP)
    let prev = l2.sample().pitch
    let lastSign = 0
    let flips = 0
    for (let elapsed = 0; elapsed < 2.5 && l2.state() !== 'recover'; elapsed += STEP) {
      l2.update(STEP)
      const pitch = l2.sample().pitch
      const sign = Math.sign(pitch - prev)
      prev = pitch
      if (sign === 0) continue
      if (lastSign !== 0 && sign !== lastSign) flips += 1
      lastSign = sign
    }
    expect(flips).toBeGreaterThanOrEqual(2)

    const l3 = new BossPoseController()
    l3.triggerHit(hit(2))
    sampleWhen(l3, 'prone', 2)
    advance(l3, 0.5)
    const proneL3 = l3.sample()
    expect(proneL3.yaw).toBeGreaterThan(0.05)
    expect(Math.abs(proneL3.roll)).toBeLessThan(0.45)
    expect(BOSS_POSE_PROFILES[2].riseLift).toBeGreaterThan(BOSS_POSE_PROFILES[1].riseLift)
    expect(BOSS_POSE_PROFILES[1].allowArms).toBe(false)
    expect(BOSS_POSE_PROFILES[2].allowArms).toBe(false)
  })

  it('reduced motion 更快，且关闭侧倾与手臂', () => {
    const normal = new BossPoseController()
    normal.triggerHit(hit(0))
    const normalProne = sampleWhen(normal, 'prone', 2)

    const reduced = new BossPoseController({ reducedMotion: true })
    reduced.triggerHit(hit(0))
    const reducedProne = sampleWhen(reduced, 'prone', 2)

    expect(reducedProne.roll).toBe(0)
    expect(reducedProne.armL).toBe(0)
    expect(normalProne.roll).not.toBe(0)
    expect(normalProne.armL).toBeGreaterThan(0)

    let normalTime = 0
    while (normal.state() !== 'idle' && normalTime < 10) {
      normal.update(STEP)
      normalTime += STEP
    }
    let reducedTime = 0
    while (reduced.state() !== 'idle' && reducedTime < 10) {
      reduced.update(STEP)
      reducedTime += STEP
    }
    expect(reducedTime).toBeLessThan(normalTime)
  })

  it('prone 阶段 lookWeight 归零', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    const prone = sampleWhen(controller, 'prone', 2)
    expect(prone.lookWeight).toBe(0)
  })

  it('三关的采样值始终有界', () => {
    for (let level = 0; level < 3; level += 1) {
      const controller = new BossPoseController()
      controller.triggerHit(hit(level, { damage: 6, hpAfter: 3 }))
      for (let elapsed = 0; elapsed < 8; elapsed += STEP) {
        controller.update(STEP)
        const sample = controller.sample()
        for (const channel of CHANNELS) {
          expect(Number.isFinite(sample[channel])).toBe(true)
          expect(Math.abs(sample[channel])).toBeLessThan(2)
        }
        expect(sample.lookWeight).toBeGreaterThanOrEqual(0)
        expect(sample.lookWeight).toBeLessThanOrEqual(1)
      }
    }
  })

  it('零伤害的非致死命中不触发姿态', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0, { damage: 0, hpAfter: 6 }))
    expect(controller.state()).toBe('idle')
  })
})

describe('shouldRespawnBossPose', () => {
  const facts = (
    phase: string,
    levelIndex: number,
    bossHp: number,
  ): BossPoseSnapshotFacts => ({ phase, levelIndex, boss: { hp: bossHp } })

  it('首次快照不需要 spawn', () => {
    expect(shouldRespawnBossPose(null, facts('reloading', 0, 6))).toBe(false)
  })

  it('普通回合推进不误触发', () => {
    expect(shouldRespawnBossPose(facts('playerTurn', 0, 6), facts('bossTurn', 0, 6))).toBe(false)
    expect(shouldRespawnBossPose(facts('roundEnd', 0, 5), facts('dealing', 0, 5))).toBe(false)
  })

  it('切层触发', () => {
    expect(shouldRespawnBossPose(facts('supply', 0, 0), facts('reloading', 1, 8))).toBe(true)
  })

  it('Boss 从 0 血复活触发', () => {
    expect(shouldRespawnBossPose(facts('gameOver', 1, 0), facts('dealing', 1, 8))).toBe(true)
  })

  it('同层 retry 靠 reloading 一跳触发（血量与层数都不变）', () => {
    expect(shouldRespawnBossPose(facts('gameOver', 1, 8), facts('reloading', 1, 8))).toBe(true)
  })

  it('reloading 期间的连续快照只触发一次', () => {
    expect(shouldRespawnBossPose(facts('reloading', 1, 8), facts('reloading', 1, 8))).toBe(false)
  })
})