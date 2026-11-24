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
  'headYaw',
  'headRoll',
  'armL',
  'armR',
  'forearmL',
  'forearmR',
  'legL',
  'legR',
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

function controlledHit(
  level = 1,
  overrides: Partial<{ damage: number; hpAfter: number; maxHp: number }> = {},
) {
  return { ...hit(level, overrides), controlled: true }
}

function suspendedHit(
  overrides: Partial<{ damage: number; hpAfter: number; maxHp: number }> = {},
) {
  return { ...hit(2, overrides), suspended: true }
}

describe('BossPoseController', () => {
  it('普通命中走完整倒地/起身并回到 idle', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    const seen = recordStates(controller, 8)
    expect(seen).toEqual([
      'impact',
      'launch',
      'down',
      'plant',
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

  it('L1 先向后击飞，再单手撑桌并跟上另一只手', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    const launched = sampleWhen(controller, 'down', 2)
    expect(launched.y).toBeGreaterThan(0.2)
    expect(launched.z).toBeLessThan(-0.8)

    const firstHand = sampleWhen(controller, 'brace', 3)
    expect(firstHand.armL).toBeGreaterThan(firstHand.armR + 0.5)
    expect(firstHand.forearmL).toBeGreaterThan(firstHand.forearmR + 0.5)

    advance(controller, 0.3)
    const secondHand = controller.sample()
    expect(secondHand.armR).toBeGreaterThan(firstHand.armR + 0.5)
    expect(secondHand.forearmR).toBeGreaterThan(firstHand.forearmR + 0.5)
  })

  it('可以在撑桌入口冻结，释放后继续完整起身', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    controller.holdBeforePlant()

    const beforePlant = sampleWhen(controller, 'plant', 3)
    expect(beforePlant.armL).toBeCloseTo(0.35)
    expect(controller.stateProgress()).toBe(0)
    advance(controller, 2)
    expect(controller.state()).toBe('plant')
    expect(controller.stateProgress()).toBe(0)
    expect(controller.sample().armL).toBeCloseTo(0.35)

    controller.releasePlantHold()
    controller.update(STEP)
    expect(controller.stateProgress()).toBeGreaterThan(0)
    expect(recordStates(controller, 5).at(-1)).toBe('idle')
  })

  it('L2/L3 非致死命中仍走原来的倒地起身序列', () => {
    for (const level of [1, 2]) {
      const controller = new BossPoseController()
      controller.triggerHit(hit(level))
      expect(recordStates(controller, 8)).toEqual([
        'impact',
        'collapse',
        'prone',
        'brace',
        'push',
        'rise',
        'recover',
        'idle',
      ])
    }
  })

  it('第三层悬吊命中按挣扎、僵住、回头顺序完成', () => {
    const controller = new BossPoseController()
    controller.triggerHit(suspendedHit())
    expect(recordStates(controller, 5)).toEqual([
      'impact',
      'struggle',
      'still',
      'headTurn',
      'recover',
      'idle',
    ])
  })

  it('第三层僵住阶段可冻结到血袋与桌面回位结束', () => {
    const controller = new BossPoseController()
    controller.triggerHit(suspendedHit())
    controller.holdBeforeStill()
    while (controller.state() !== 'still') controller.update(STEP)
    const frozen = controller.sample()
    expect(frozen.headYaw).toBeCloseTo(Math.PI)
    expect(controller.stateProgress()).toBe(0)
    advance(controller, 2)
    for (const channel of CHANNELS) {
      expect(controller.sample()[channel]).toBeCloseTo(frozen[channel], 6)
    }
    controller.releaseStillHold()
    expect(recordStates(controller, 3).at(-1)).toBe('idle')
  })

  it('第三层挣扎时双臂与双腿持续乱动，停止时头背对玩家', () => {
    const controller = new BossPoseController()
    controller.triggerHit(suspendedHit())
    while (controller.state() !== 'struggle') controller.update(STEP)
    const start = controller.sample()
    let armDelta = 0
    let legDelta = 0
    for (let elapsed = 0; elapsed < 2 && controller.state() !== 'still'; elapsed += STEP) {
      controller.update(STEP)
      const sample = controller.sample()
      armDelta = Math.max(
        armDelta,
        Math.abs(sample.armL - start.armL),
        Math.abs(sample.armR - start.armR),
        Math.abs(sample.forearmL - start.forearmL),
        Math.abs(sample.forearmR - start.forearmR),
      )
      legDelta = Math.max(legDelta, Math.abs(sample.legL), Math.abs(sample.legR))
    }
    expect(armDelta).toBeGreaterThan(0.8)
    expect(legDelta).toBeGreaterThan(0.3)
    expect(controller.state()).toBe('still')
    expect(controller.sample().headYaw).toBeCloseTo(Math.PI)
    expect(controller.sample().lookWeight).toBe(0)
  })

  it('第三层头部特写只旋转头部 180 度并回到面向玩家', () => {
    const controller = new BossPoseController()
    controller.triggerHit(suspendedHit())
    while (controller.state() !== 'headTurn') controller.update(STEP)
    controller.update(STEP)
    const start = controller.sample()
    expect(start.headYaw).toBeCloseTo(Math.PI + 0.08)
    advance(controller, 0.36)
    const turned = controller.sample()
    expect(turned.headYaw).toBeCloseTo(0)
    expect(turned.yaw).toBeCloseTo(start.yaw)
    expect(turned.pitch).toBeCloseTo(start.pitch)
  })

  it('第三层 reduced motion 保留完整顺序并压低乱抓幅度', () => {
    const measure = (reducedMotion: boolean) => {
      const controller = new BossPoseController({ reducedMotion })
      controller.triggerHit(suspendedHit())
      while (controller.state() !== 'struggle') controller.update(STEP)
      advance(controller, 0.2)
      const start = controller.sample()
      let delta = 0
      for (let elapsed = 0; elapsed < 0.3; elapsed += STEP) {
        controller.update(STEP)
        const sample = controller.sample()
        delta = Math.max(delta, Math.abs(sample.armL - start.armL), Math.abs(sample.armR - start.armR))
      }
      return { delta, states: recordStates(controller, 5) }
    }
    const normal = measure(false)
    const reduced = measure(true)
    expect(reduced.delta).toBeLessThan(normal.delta * 0.5)
    expect(reduced.states).toEqual(['struggle', 'still', 'headTurn', 'recover', 'idle'])
  })

  it('第三层致死命中不进入悬吊挣扎', () => {
    const controller = new BossPoseController()
    controller.triggerHit(suspendedHit({ damage: 9, hpAfter: 0 }))
    expect(recordStates(controller, 8)).toEqual(['impact', 'collapse', 'deadProne'])
  })

  it('第二阶段受控命中按错误重启顺序起身', () => {
    const controller = new BossPoseController()
    controller.triggerHit(controlledHit())
    expect(recordStates(controller, 8)).toEqual([
      'impact',
      'launch',
      'down',
      'plant',
      'brace',
      'push',
      'rise',
      'recover',
      'idle',
    ])
  })

  it('受控后仰在落地前冻结，不会直接滑倒', () => {
    const controller = new BossPoseController()
    controller.triggerHit(controlledHit())
    while (controller.state() !== 'launch') controller.update(STEP)

    advance(controller, 0.31)
    const frozen = controller.sample()
    expect(controller.state()).toBe('launch')
    advance(controller, 0.08)
    expect(controller.state()).toBe('launch')
    for (const channel of CHANNELS) {
      expect(controller.sample()[channel]).toBeCloseTo(frozen[channel], 6)
    }
  })

  it('倒地后先抽动右臂再抽动左臂，头部反向跟随', () => {
    const controller = new BossPoseController()
    controller.triggerHit(controlledHit())
    while (controller.state() !== 'plant') controller.update(STEP)
    const base = controller.sample()
    let rightPeak = 0
    let leftPeak = 0
    let rightAt = 0
    let leftAt = 0
    let headPeak = 0

    for (let elapsed = 0; elapsed < 1 && controller.state() === 'plant'; elapsed += STEP) {
      controller.update(STEP)
      const sample = controller.sample()
      const right = sample.armR - base.armR
      const left = sample.armL - base.armL
      if (right > rightPeak) {
        rightPeak = right
        rightAt = elapsed
      }
      if (left > leftPeak) {
        leftPeak = left
        leftAt = elapsed
      }
      headPeak = Math.max(headPeak, Math.abs(sample.headPitch - base.headPitch))
    }

    expect(rightPeak).toBeGreaterThan(0.5)
    expect(leftPeak).toBeGreaterThan(0.45)
    expect(rightAt).toBeLessThan(leftAt)
    expect(headPeak).toBeGreaterThan(0.25)
  })

  it('恢复时头部先修正，躯干随后，手臂最后跟上', () => {
    const controller = new BossPoseController()
    controller.triggerHit(controlledHit())
    while (controller.state() !== 'brace') controller.update(STEP)
    const start = controller.sample()
    advance(controller, 0.24)
    const middle = controller.sample()

    const headDelta = Math.abs(middle.headPitch - start.headPitch)
    const bodyDelta = Math.abs(middle.pitch - start.pitch) + Math.abs(middle.y - start.y)
    const armDelta = Math.abs(middle.armR - start.armR) + Math.abs(middle.forearmR - start.forearmR)
    expect(headDelta).toBeGreaterThan(bodyDelta * 2)
    expect(bodyDelta).toBeGreaterThan(armDelta)

    while (controller.state() !== 'push') controller.update(STEP)
    const pushStart = controller.sample()
    advance(controller, 0.2)
    const pushMiddle = controller.sample()
    expect(Math.abs(pushMiddle.pitch - pushStart.pitch)).toBeGreaterThan(0.1)
    expect(Math.abs(pushMiddle.armR - pushStart.armR)).toBeLessThan(0.02)
  })

  it('受控序列的 reduced motion 保留停顿但关闭双臂抽搐', () => {
    const controller = new BossPoseController({ reducedMotion: true })
    controller.triggerHit(controlledHit())
    while (controller.state() !== 'plant') controller.update(STEP)
    const base = controller.sample()
    let armDelta = 0
    for (let elapsed = 0; elapsed < 1 && controller.state() === 'plant'; elapsed += STEP) {
      controller.update(STEP)
      const sample = controller.sample()
      armDelta = Math.max(
        armDelta,
        Math.abs(sample.armL - base.armL),
        Math.abs(sample.armR - base.armR),
      )
    }
    expect(armDelta).toBeLessThan(0.001)
    expect(recordStates(controller, 5).at(-1)).toBe('idle')
  })

  it('第二阶段致死命中仍直接死亡，不播放受控起身', () => {
    const controller = new BossPoseController()
    controller.triggerHit(controlledHit(1, { damage: 9, hpAfter: 0 }))
    expect(recordStates(controller, 8)).toEqual(['impact', 'collapse', 'deadProne'])
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
    const proneL1 = sampleWhen(l1, 'plant', 3)

    const l3 = new BossPoseController()
    l3.triggerHit(hit(2))
    const proneL3 = sampleWhen(l3, 'prone', 2)

    expect(Math.abs(proneL1.pitch)).toBeGreaterThan(Math.abs(proneL3.pitch) + 0.2)
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

  it('reduced motion 更快，且关闭倒地侧倾', () => {
    const normal = new BossPoseController()
    normal.triggerHit(hit(0))
    const normalDown = sampleWhen(normal, 'plant', 3)

    const reduced = new BossPoseController({ reducedMotion: true })
    reduced.triggerHit(hit(0))
    const reducedDown = sampleWhen(reduced, 'plant', 3)

    expect(reducedDown.roll).toBe(0)
    expect(normalDown.roll).not.toBe(0)

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

  it('倒地阶段 lookWeight 归零', () => {
    const controller = new BossPoseController()
    controller.triggerHit(hit(0))
    const down = sampleWhen(controller, 'plant', 3)
    expect(down.lookWeight).toBe(0)
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