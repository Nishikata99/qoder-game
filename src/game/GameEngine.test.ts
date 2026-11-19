import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameEngine, evaluateHand, type Card, type CardSuit, type GameEngineOptions } from './GameEngine'

const card = (rank: number, suit: CardSuit = 'spade'): Card => ({
  id: `${suit}-${rank}`,
  rank: rank as Card['rank'],
  suit,
})

const hand = (...ranks: number[]) => evaluateHand(ranks.map((rank) => card(rank)))

/** 引擎内部状态在测试里直接改写，省去反复发牌的随机性；与引擎行为无关，只用于固定场景 */
type Probe = Record<string, any>

function newEngine(options: GameEngineOptions = {}): { engine: GameEngine; probe: Probe } {
  const engine = new GameEngine({ dealDelayMs: 0, thinkDelayMs: 0, ...options })
  return { engine, probe: engine as unknown as Probe }
}

/** 把刚开局的引擎推进到「玩家回合」，全程用假时钟驱动 */
async function toPlayerTurn(engine: GameEngine): Promise<void> {
  engine.start()
  for (let i = 0; i < 40; i += 1) {
    await vi.advanceTimersByTimeAsync(500)
    if (engine.getSnapshot().phase === 'playerTurn') return
  }
  throw new Error('未能进入玩家回合')
}

/** 长推进直到断言成立，避免依赖具体演出时长（处决 2.9s + 结算尾段） */
async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (done()) return
    await vi.advanceTimersByTimeAsync(250)
  }
}

function setTargeting(probe: Probe, playerTotal: number[], bossTotal: number[], chamber: 'live' | 'blank') {
  const Actor = Object.getPrototypeOf(probe.player).constructor
  probe.player = new Actor('player', 7)
  probe.boss = new Actor('boss', 6)
  probe.player.hand = hand(...playerTotal)
  probe.boss.hand = hand(...bossTotal)
  probe.player.standing = true
  probe.boss.standing = true
  probe.holeRevealed = true
  probe.phase = 'targeting'
  probe.pendingShot = 'player'
  // 必须在 targeting 之后清：startRound / beginLevel 会把走火遗恨重置
  probe.damageBonus = 0
  probe.hourglassActive = false
  probe.cylinder.chambers = [chamber]
  probe.cylinder.cursor = 0
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('evaluateHand', () => {
  it('A 按不爆牌的最大值折算', () => {
    expect(hand(1, 9).total).toBe(20)
    expect(hand(1, 1, 9).total).toBe(21)
    expect(hand(1, 1, 1, 9).total).toBe(12)
    expect(hand(1, 9).soft).toBe(true)
  })

  it('超过 21 点即爆牌', () => {
    const state = hand(10, 10, 5)
    expect(state.total).toBe(25)
    expect(state.busted).toBe(true)
  })

  it('只有起手两张恰好 21 点算黑杰克', () => {
    expect(hand(1, 10).blackjack).toBe(true)
    expect(hand(10, 6, 5).blackjack).toBe(false)
  })
})

describe('回合与输入锁', () => {
  it('非玩家回合拒绝要牌与停牌', () => {
    const { engine } = newEngine()
    const notices: string[] = []
    engine.subscribe((event) => {
      if (event.type === 'notice') notices.push(event.message)
    })
    expect(engine.hit()).toBe(false)
    expect(engine.stand()).toBe(false)
    expect(notices).toEqual(['现在不是你的回合。', '现在不是你的回合。'])
  })

  it('发牌后输入锁到期才允许要牌', async () => {
    const { engine } = newEngine()
    await toPlayerTurn(engine)
    expect(engine.getSnapshot().inputLocked).toBe(false)
    expect(engine.hit()).toBe(true)
  })
})

describe('结算伤害公式', () => {
  it('实弹基础伤害为 2', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 8], [10, 5], 'live')
    expect(engine.chooseTarget('boss')).toBe(true)
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().boss.hp).toBe(4)
    expect(engine.getSnapshot().log.join(' ')).toContain('承受 2 点伤害')
  })

  it('黑杰克 +1，且锯子整体翻倍', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [1, 10], [10, 5], 'live')
    probe.player.sawBoost = 1
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    // (2 + 黑杰克 1) × 2 = 6
    expect(engine.getSnapshot().boss.hp).toBe(0)
    const log = engine.getSnapshot().log.join(' ')
    expect(log).toContain('黑杰克')
    expect(log).toContain('锯短枪管')
  })

  it('赢家手牌 ≥20 触发碾压 +1', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 10], [10, 5], 'live')
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    // 20 点赢下本轮
    expect(engine.getSnapshot().log.join(' ')).toContain('碾压')
    expect(engine.getSnapshot().boss.hp).toBe(3)
  })

  it('手牌 19 点不触发碾压', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().log.join(' ')).not.toContain('碾压')
    expect(engine.getSnapshot().boss.hp).toBe(4)
  })

  it('爆牌收尾不算碾压', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 10, 5], [10, 5], 'live')
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().log.join(' ')).not.toContain('碾压')
    expect(engine.getSnapshot().boss.hp).toBe(4)
  })

  it('低分赢下本轮（沙漏）不算碾压', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    // 沙漏下 15 点赢，虽然赢家手牌不足 20
    setTargeting(probe, [10, 5], [10, 9], 'live')
    probe.hourglassActive = true
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(250)
      if (engine.getSnapshot().phase === 'targeting') break
    }
    expect(engine.getSnapshot().pendingShot).toBe('player')
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().log.join(' ')).not.toContain('碾压')
  })

  it('走火遗恨计入基础伤害，中弹后清零', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 8], [10, 5], 'live')
    probe.damageBonus = 3
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().boss.hp).toBe(1)
    expect(engine.getSnapshot().damageBonus).toBe(0)
  })

  it('空膛不造成伤害；对自己开空膛回收一件道具', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 8], [10, 5], 'blank')
    probe.player.items = []
    engine.chooseTarget('player')
    await settleUntil(() => engine.getSnapshot().player.items.length === 1)
    const snapshot = engine.getSnapshot()
    expect(snapshot.player.hp).toBe(7)
    expect(snapshot.player.items).toHaveLength(1)
  })
})

describe('处决重入保护', () => {
  it('连点两次只结算一次', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.cylinder.chambers = ['live', 'live']
    expect(engine.chooseTarget('boss')).toBe(true)
    expect(engine.chooseTarget('boss')).toBe(false)
    await settleUntil(() => engine.getSnapshot().boss.hp !== 6)
    expect(engine.getSnapshot().boss.hp).toBe(4)
    // 弹仓只消耗一发，证明没有二次结算
    expect(engine.getSnapshot().cylinder.remaining).toBe(1)
  })
})

describe('跳过处决演出', () => {
  it('skipExecution 立即揭晓结果，不必等满悬念时长', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 8], [10, 5], 'live')
    engine.chooseTarget('boss')
    expect(engine.getSnapshot().phase).toBe('execution')
    expect(engine.skipExecution()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(engine.getSnapshot().boss.hp).toBe(4)
    // 演出结束后再按不会重复结算
    expect(engine.skipExecution()).toBe(false)
  })
})

describe('沙漏与 Boss AI', () => {
  it('沙漏生效时点数更小的一方赢下本轮', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    // 玩家 19 对 Boss 15：常规规则玩家胜，沙漏下 Boss 胜
    probe.player.hand = hand(10, 9)
    probe.boss.hand = hand(10, 5)
    probe.player.standing = true
    probe.boss.standing = true
    probe.holeRevealed = true
    probe.hourglassActive = true
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(250)
      if (engine.getSnapshot().phase === 'targeting') break
    }
    expect(engine.getSnapshot().pendingShot).toBe('boss')
  })

  it('沙漏生效时双方同点仍无人开枪，遗恨 +1', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 8)
    probe.boss.hand = hand(10, 8)
    probe.player.standing = true
    probe.boss.standing = true
    probe.holeRevealed = true
    probe.hourglassActive = true
    probe.damageBonus = 0
    probe.player.items = []
    probe.boss.items = []
    const events: string[] = []
    engine.subscribe((event) => {
      if (event.type !== 'state') events.push(event.type)
    })
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().damageBonus === 1)
    const snapshot = engine.getSnapshot()
    expect(snapshot.log.join(' ')).toContain('走火危机')
    expect(snapshot.damageBonus).toBe(1)
    expect(events).toContain('tie')
    // 同点不产生赢家：沙漏只翻转「谁点数更小谁赢」，不改变平局，也不把枪交给任何一方
    expect(snapshot.pendingShot).toBeNull()
  })

  it('没有沙漏时高分方赢下本轮', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 9)
    probe.boss.hand = hand(10, 5)
    probe.player.standing = true
    probe.boss.standing = true
    probe.holeRevealed = true
    probe.hourglassActive = false
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(250)
      if (engine.getSnapshot().phase === 'targeting') break
    }
    expect(engine.getSnapshot().pendingShot).toBe('player')
  })

  it('第 3 关 Boss 落后时不会打沙漏', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.levelIndex = 2
    probe.boss.items = ['hourglass']
    probe.player.hand = hand(10, 10)
    probe.boss.hand = hand(10, 5)
    probe.boss.standing = false
    probe.phase = 'bossTurn'
    // 沙漏是玩家专属：即使落后、持有沙漏，AI 也不会选择它
    expect(probe.chooseBossItem(new Set())).not.toBe('hourglass')
    expect(engine.getSnapshot().hourglassActive).toBe(false)
  })
})

describe('道具效果', () => {
  it('手铐让对手跳过下一次行动', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.items = ['handcuffs']
    engine.useItem('handcuffs')
    expect(engine.getSnapshot().boss.skipTurn).toBe(true)
    expect(engine.useItem('handcuffs')).toBe(false)
  })

  it('磁铁交换双方明牌', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.items = ['magnet']
    probe.player.hand = hand(10, 2)
    probe.boss.hand = hand(6, 9)
    probe.holeRevealed = false
    engine.useItem('magnet')
    const snapshot = engine.getSnapshot()
    // 玩家最后一张明牌 2 换走 Boss 的明牌 6：玩家 16，Boss 11
    expect(snapshot.player.hand.total).toBe(16)
    expect(snapshot.boss.hand.total).toBe(11)
  })

  it('生命已满时镇定剂被拒绝', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.items = ['sedative']
    probe.player.hp = probe.player.maxHp
    expect(engine.useItem('sedative')).toBe(false)
  })
})
