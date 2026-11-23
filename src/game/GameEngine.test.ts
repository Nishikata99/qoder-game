import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOSS_ITEM_POOLS, GameEngine, ITEM_IDS, evaluateHand, type Card, type CardSuit, type GameEngineOptions, type ItemId, type LevelConfig } from './GameEngine'

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

describe('层间补给三选一', () => {
  const levels: readonly LevelConfig[] = [
    { id: 1, name: '看门人', title: '门厅', hp: 6, playerHp: 7, supply: 0, personality: 'cautious' },
    { id: 2, name: '收账人', title: '账房', hp: 6, playerHp: 7, supply: 0, personality: 'gambler' },
  ]

  /** 把引擎摆到「第一层已清空」并触发补给三选一 */
  async function toSupplyOffer(engine: GameEngine, probe: Probe): Promise<void> {
    await toPlayerTurn(engine)
    probe.boss.hp = 0
    probe.phase = 'levelClear'
    void probe.offerSupply(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'supply')
  }

  it('清层后给出候选，选中道具带进下一层', async () => {
    const { engine, probe } = newEngine({ levels })
    await toSupplyOffer(engine, probe)
    const options = engine.getSnapshot().supplyOptions
    // 第 1 层门前只摆两件
    expect(options).toHaveLength(2)
    expect(new Set(options).size).toBe(2)

    const picked = options[1] as ItemId
    expect(engine.chooseSupply(picked)).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const snapshot = engine.getSnapshot()
    expect(snapshot.levelIndex).toBe(1)
    expect(snapshot.player.items).toContain(picked)
    // 补给面板只在 supply 阶段出现
    expect(snapshot.supplyOptions).toHaveLength(0)
  })

  it('不在候选里的道具会被拒绝，阶段不变', async () => {
    const { engine, probe } = newEngine({ levels })
    await toSupplyOffer(engine, probe)
    const options = engine.getSnapshot().supplyOptions
    const outside = ITEM_IDS.find((item) => !options.includes(item))
    expect(outside).toBeDefined()
    expect(engine.chooseSupply(outside as ItemId)).toBe(false)
    expect(engine.getSnapshot().phase).toBe('supply')
  })

  it('补给不设时限：等再久也不会自动拿走，点选后才开门', async () => {
    const { engine, probe } = newEngine({ levels })
    await toSupplyOffer(engine, probe)
    const options = engine.getSnapshot().supplyOptions
    await vi.advanceTimersByTimeAsync(60_000)
    expect(engine.getSnapshot().phase).toBe('supply')
    expect(engine.getSnapshot().supplyOptions).toEqual(options)

    const picked = options[0] as ItemId
    expect(engine.chooseSupply(picked)).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const snapshot = engine.getSnapshot()
    expect(snapshot.levelIndex).toBe(1)
    expect(snapshot.player.items).toContain(picked)
  })

  it('非 supply 阶段调用会被拒绝', async () => {
    const { engine } = newEngine()
    expect(engine.chooseSupply('magnifier')).toBe(false)
  })
})

describe('道具效果', () => {
  it('护心镜完全挡下一次实弹伤害后碎裂', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['aegis']
    expect(engine.useItem('aegis')).toBe(true)
    expect(engine.getSnapshot().player.shield).toBe(1)
    expect(engine.useItem('aegis')).toBe(false)

    const shots: { damage: number; blocked: string | null }[] = []
    engine.subscribe((event) => {
      if (event.type === 'shot') shots.push({ damage: event.damage, blocked: event.blocked })
    })
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.boss.shield = 1
    engine.chooseTarget('boss')
    await settleUntil(() => shots.length > 0)
    expect(shots[0]).toEqual({ damage: 0, blocked: 'shield' })
    expect(engine.getSnapshot().boss.hp).toBe(6)
    expect(engine.getSnapshot().boss.shield).toBe(0)
  })

  it('重锤把空膛砸成实弹，实弹时拒绝', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['hammer']
    probe.cylinder.chambers = ['blank', 'blank']
    probe.cylinder.cursor = 0
    probe.revealedBy.player = null
    expect(engine.useItem('hammer')).toBe(true)
    expect(engine.getSnapshot().cylinder.live).toBe(1)
    expect(engine.getSnapshot().cylinder.blank).toBe(1)
    expect(engine.getSnapshot().cylinder.revealed).toBeNull()

    probe.player.items = ['hammer']
    expect(engine.useItem('hammer')).toBe(false)
    expect(engine.getSnapshot().player.items).toContain('hammer')
  })

  it('重锤砸中已窥见的空膛后读数同步为实弹', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['magnifier', 'hammer']
    probe.cylinder.chambers = ['blank']
    probe.cylinder.cursor = 0
    probe.revealedBy.player = null
    expect(engine.useItem('magnifier')).toBe(true)
    expect(engine.getSnapshot().cylinder.revealed).toBe('blank')
    expect(engine.useItem('hammer')).toBe(true)
    expect(engine.getSnapshot().cylinder.revealed).toBe('live')
  })

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

describe('每回合道具上限', () => {
  it('一回合最多使用三件，第四件被拒绝', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['saw', 'aegis', 'sedative', 'iou']
    expect(engine.useItem('saw')).toBe(true)
    expect(engine.useItem('aegis')).toBe(true)
    expect(engine.useItem('iou')).toBe(true)
    expect(engine.getSnapshot().player.itemsUsedThisTurn).toBe(3)
    expect(engine.useItem('sedative')).toBe(false)
    // 被拒绝的道具仍在背包里
    expect(engine.getSnapshot().player.items).toContain('sedative')
  })

  it('新一回合重置计数', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['saw', 'aegis', 'iou']
    engine.useItem('saw')
    engine.useItem('aegis')
    expect(engine.getSnapshot().player.itemsUsedThisTurn).toBe(2)
    void probe.startRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().player.itemsUsedThisTurn).toBe(0)
  })
})

describe('窥视按角色私有', () => {
  it('Boss 的窥视不会出现在玩家快照里', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.items = ['magnifier']
    probe.cylinder.chambers = ['live', 'blank']
    probe.cylinder.cursor = 0
    expect(probe.applyItem(probe.boss, 'magnifier')).toBe(true)
    expect(probe.revealedBy.boss).toBe('live')
    expect(engine.getSnapshot().cylinder.revealed).toBeNull()
  })

  it('Boss 窥视日志不泄露膛内读数', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.items = ['magnifier']
    probe.cylinder.chambers = ['blank', 'live']
    probe.cylinder.cursor = 0
    probe.applyItem(probe.boss, 'magnifier')
    const log = engine.getSnapshot().log.join(' ')
    expect(log).toContain('窥视了枪膛')
    expect(log).not.toContain('窥见空膛')
    expect(log).not.toContain('窥见实弹')
  })

  it('玩家自己的窥视仍然可见', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['magnifier']
    probe.cylinder.chambers = ['blank', 'live']
    probe.cylinder.cursor = 0
    expect(engine.useItem('magnifier')).toBe(true)
    expect(engine.getSnapshot().cylinder.revealed).toBe('blank')
    expect(probe.revealedBy.boss).toBeNull()
  })
})

describe('格挡不清零遗恨与锯子', () => {
  it('护心镜完全挡下实弹后，遗恨和锯子保留', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.damageBonus = 2
    probe.player.sawBoost = 1
    probe.boss.shield = 1
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.shield === 0)
    const snapshot = engine.getSnapshot()
    expect(snapshot.boss.hp).toBe(6)
    expect(snapshot.damageBonus).toBe(2)
    expect(snapshot.player.sawBoost).toBe(1)
  })

  it('被护心镜挡下时锯子同样保留', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.damageBonus = 1
    probe.player.sawBoost = 1
    probe.boss.shield = 1
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().boss.shield === 0)
    const snapshot = engine.getSnapshot()
    expect(snapshot.boss.hp).toBe(6)
    expect(snapshot.damageBonus).toBe(1)
    expect(snapshot.player.sawBoost).toBe(1)
  })
})

describe('Boss 补给池', () => {
  it('Boss 补给只从自己人格的池子里取', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.boss.items = []
    probe.giveSupply(probe.boss, 4)
    const items = engine.getSnapshot().boss.items
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(BOSS_ITEM_POOLS.cautious).toContain(item)
    }
  })

  it('沙漏永不进入 Boss 手中', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.levelIndex = 2
    probe.boss.items = []
    for (let i = 0; i < 40; i += 1) {
      probe.boss.items = []
      probe.giveRandomItem(probe.boss)
      expect(engine.getSnapshot().boss.items).not.toContain('hourglass')
    }
  })
})

describe('层间补给数量', () => {
  it('第 1 层两件候选，第 2 层三件候选', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.levelIndex = 0
    expect(probe.rollSupplyOptions()).toHaveLength(2)
    probe.levelIndex = 1
    expect(probe.rollSupplyOptions()).toHaveLength(3)
  })
})

describe('暂停与恢复', () => {
  it('暂停时 Boss 回合不推进，恢复后继续', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 7)
    probe.player.standing = true
    probe.phase = 'bossTurn'
    void probe.runBossTurn(probe.generation)
    await vi.advanceTimersByTimeAsync(100)
    engine.pause()
    expect(engine.getSnapshot().paused).toBe(true)
    // 暂停期间推进 30 秒：不应进入下一阶段
    await vi.advanceTimersByTimeAsync(30_000)
    expect(engine.getSnapshot().paused).toBe(true)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
    engine.resume()
    expect(engine.getSnapshot().paused).toBe(false)
    // 恢复后剩余思考时间走完，回合继续推进
    await vi.advanceTimersByTimeAsync(5_000)
    expect(engine.getSnapshot().phase).not.toBe('bossTurn')
  })

  it('暂停时输入锁不会到期，恢复后按剩余时间解锁', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 1000 })
    await toPlayerTurn(engine)
    // 直接施加输入锁，避免 hit() 因 21 点/爆牌直接跳过锁
    probe.player.items = ['saw']
    engine.useItem('saw')
    expect(engine.getSnapshot().inputLocked).toBe(true)
    engine.pause()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(engine.getSnapshot().inputLocked).toBe(true)
    engine.resume()
    await vi.advanceTimersByTimeAsync(1200)
    expect(engine.getSnapshot().inputLocked).toBe(false)
  })

  it('重复 pause/resume 是幂等的', async () => {
    const { engine } = newEngine()
    await toPlayerTurn(engine)
    engine.pause()
    engine.pause()
    expect(engine.getSnapshot().paused).toBe(true)
    engine.resume()
    engine.resume()
    expect(engine.getSnapshot().paused).toBe(false)
  })
})

describe('runRounds 与检查点', () => {
  it('runRounds 跨回合累加', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(engine.getSnapshot().runRounds).toBe(1)
    void probe.startRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().runRounds).toBe(2)
    expect(engine.getSnapshot().round).toBe(2)
  })

  it('进入新层会派发 checkpoint 事件', async () => {
    const { engine } = newEngine()
    const events: string[] = []
    engine.subscribe((event) => {
      if (event.type === 'checkpoint') events.push(`${event.levelIndex}:${event.runRounds}`)
    })
    engine.start()
    for (let i = 0; i < 40; i += 1) {
      await vi.advanceTimersByTimeAsync(500)
      if (events.length > 0) break
    }
    expect(events[0]).toMatch(/^0:/)
  })
})

describe('从层首重来', () => {
  it('startAtLevel 从指定层开始，血袋按该层重置', async () => {
    const { engine, probe } = newEngine()
    engine.startAtLevel(1)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const snapshot = engine.getSnapshot()
    expect(snapshot.levelIndex).toBe(1)
    expect(snapshot.player.hp).toBe(snapshot.player.maxHp)
    // 第 1 层 Boss 6 血、第 2 层 8 血；用 Boss 生命确认确实从第 2 层开始
    expect(snapshot.boss.maxHp).toBe(8)
    expect(probe.round).toBe(1)
  })

  it('retryLevel 只在 gameOver 阶段可用，并保持当前层', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.levelIndex = 1
    expect(engine.retryLevel()).toBe(false)
    probe.phase = 'gameOver'
    expect(engine.retryLevel()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().levelIndex).toBe(1)
  })
})

describe('第 3 层牌靴', () => {
  it('L3 连续两局不重洗，牌数递减', async () => {
    const { engine, probe } = newEngine()
    engine.startAtLevel(2)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const first = engine.getSnapshot().deckRemaining
    expect(first).not.toBeNull()
    const before = first as number
    void probe.startRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const after = engine.getSnapshot().deckRemaining as number
    // 新一局至少又发了 4 张牌，牌靴应明显减少而不是重置回 40
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  it('L1/L2 每局重洗，deckRemaining 为 null', async () => {
    const { engine } = newEngine()
    await toPlayerTurn(engine)
    expect(engine.getSnapshot().deckRemaining).toBeNull()
  })
})

describe('Boss 人格停牌线', () => {
  const profileOf = (personality: 'cautious' | 'gambler' | 'executioner') =>
    ({ label: personality, personality, standAt: personality === 'cautious' ? 15 : personality === 'gambler' ? 17 : 19, itemBudget: 1, thinkingMs: 0 })

  function bossTargetFor(
    probe: Probe,
    personality: 'cautious' | 'gambler' | 'executioner',
    bossTotal: number[],
    playerTotal: number[],
    playerStanding: boolean,
  ): number {
    probe.boss.hand = hand(...bossTotal)
    probe.player.hand = hand(...playerTotal)
    probe.player.standing = playerStanding
    probe.boss.standing = false
    probe.hourglassActive = false
    return probe.bossTarget(profileOf(personality), personality)
  }

  it('谨慎：玩家停牌 18+ 时保持 15，不硬追', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(bossTargetFor(probe, 'cautious', [10, 5], [10, 9], true)).toBe(15)
  })

  it('谨慎：玩家停牌 ≤17 时追到 +1', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(bossTargetFor(probe, 'cautious', [10, 5], [10, 6], true)).toBe(17)
  })

  it('赌徒：玩家 18+ 且自己 ≤16 时真赌 21', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(bossTargetFor(probe, 'gambler', [10, 5], [10, 9], true)).toBe(21)
  })

  it('赌徒：自己 17+ 而玩家低时停牌，不贪', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(bossTargetFor(probe, 'gambler', [10, 8], [10, 5], true)).toBe(18)
  })

  it('算牌：牌靴爆牌风险高时允许把目标压到当前点数以下', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.boss.hand = hand(10, 6)
    probe.player.hand = hand(10, 5)
    probe.player.standing = true
    probe.hourglassActive = false
    // 剩余牌全是高牌 → 爆牌风险为 1
    probe.deck = [card(10), card(9), card(8)]
    const target = probe.bossTarget(profileOf('executioner'), 'executioner')
    expect(target).toBeLessThanOrEqual(16)
  })
})

describe('新道具：裁纸刀 / 借据 / 封条 / 单片眼镜', () => {
  it('裁纸刀进入待选，选中的那张被裁掉且不补牌', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 5)
    probe.player.items = ['cutter']
    expect(engine.useItem('cutter')).toBe(true)
    const choice = engine.getSnapshot().cardChoice
    expect(choice?.kind).toBe('cutter')
    expect(choice?.cards).toHaveLength(2)
    // 选第一张（10）裁掉，剩下 5
    expect(engine.resolveCardChoice(0)).toBe(true)
    const after = engine.getSnapshot().player.hand
    expect(after.cards).toHaveLength(1)
    expect(after.total).toBe(5)
    expect(engine.getSnapshot().cardChoice).toBeNull()
  })

  it('裁纸刀待选期间不能要牌/停牌/再用道具，可放弃', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 5)
    probe.player.items = ['cutter', 'aegis']
    expect(engine.useItem('cutter')).toBe(true)
    expect(engine.hit()).toBe(false)
    expect(engine.stand()).toBe(false)
    expect(engine.useItem('aegis')).toBe(false)
    expect(engine.cancelCardChoice()).toBe(true)
    expect(engine.getSnapshot().cardChoice).toBeNull()
    // 放弃后牌与道具都没变
    expect(engine.getSnapshot().player.hand.total).toBe(15)
  })

  it('裁纸刀每回合限一次，且爆牌时不可用', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 8)
    probe.player.items = ['cutter', 'cutter']
    probe.deck = [card(2), card(3)]
    expect(engine.useItem('cutter')).toBe(true)
    expect(engine.useItem('cutter')).toBe(false)

    // 爆牌状态：新回合里把总点数推到 22 再尝试
    probe.player.hand = hand(10, 10, 10)
    probe.player.cutterUsedThisRound = false
    probe.player.items = ['cutter']
    expect(engine.useItem('cutter')).toBe(false)
  })

  it('借据让玩家赢下的实弹 +2，但只作用于对抗方向', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['iou']
    expect(engine.useItem('iou')).toBe(true)
    expect(engine.getSnapshot().player.iou).toBe(1)
    expect(engine.useItem('iou')).toBe(false)

    const shots: number[] = []
    engine.subscribe((event) => {
      if (event.type === 'shot') shots.push(event.damage)
    })
    // 基础 2 + 借据 2 = 4（setTargeting 会重建 Actor，借据要在其后设置）
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.iou = 1
    engine.chooseTarget('boss')
    await settleUntil(() => shots.length > 0)
    expect(shots[0]).toBe(4)
  })

  it('借据在输掉时让挨的实弹 +1', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 9], 'live')
    // 玩家签了借据，被 Boss 打中时多挨 1 点
    probe.player.iou = 1
    probe.pendingShot = 'boss'
    void probe.resolveShot(probe.boss, probe.player, probe.generation)
    await settleUntil(() => engine.getSnapshot().player.hp !== 7)
    // 基础 2 + 玩家借据 1 = 3
    expect(engine.getSnapshot().player.hp).toBe(4)
  })

  it('借据对自射不加成', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.iou = 1
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.iou = 1
    engine.chooseTarget('player')
    await settleUntil(() => engine.getSnapshot().phase !== 'execution')
    // 基础 2 打在自己身上，不叠加借据
    expect(engine.getSnapshot().player.hp).toBe(5)
  })

  it('封条亮出底牌并让玩家自选封住哪张明牌', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.hand = hand(6, 9)
    probe.boss.hand = { ...probe.boss.hand, visible: [probe.boss.hand.cards[0]!, null] }
    probe.holeRevealed = false
    probe.player.items = ['seal']
    expect(engine.useItem('seal')).toBe(true)
    // 底牌已亮，待选是两张明牌
    expect(engine.getSnapshot().boss.holeCardRevealed).toBe(true)
    const choice = engine.getSnapshot().cardChoice
    expect(choice?.kind).toBe('seal')
    expect(choice?.cards).toHaveLength(2)
    // 选择封掉 9（第二张），剩 6
    expect(engine.resolveCardChoice(1)).toBe(true)
    expect(engine.getSnapshot().boss.hand.total).toBe(6)
    // 同一手不能再封
    probe.player.items = ['seal']
    expect(engine.useItem('seal')).toBe(false)
  })

  it('单片眼镜查看牌靴顶部三张且不改变牌序', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.items = ['monocle']
    probe.deck = [card(2), card(5), card(7), card(9)]
    const peeked: string[][] = []
    engine.subscribe((event) => {
      if (event.type === 'deckPeeked') peeked.push(event.cards.map((c) => c.id))
    })
    expect(engine.useItem('monocle')).toBe(true)
    expect(peeked[0]).toHaveLength(3)
    // 牌序不变：顶部三张仍是 9、7、5（从栈顶往下）
    expect(probe.deck.map((c: Card) => c.id)).toEqual(['spade-2', 'spade-5', 'spade-7', 'spade-9'])
  })
})
