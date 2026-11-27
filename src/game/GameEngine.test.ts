import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GameEngine,
  ITEM_IDS,
  LEVELS,
  TRUMP_CATALOG,
  TRUMP_IDS,
  TRUMP_WEIGHTS,
  createSeededRandom,
  evaluateHand,
  type Card,
  type CardSuit,
  type GameEngineOptions,
  type ItemId,
  type LevelConfig,
  type TrumpId,
} from './GameEngine'

const card = (rank: number, suit: CardSuit = 'spade'): Card => ({
  id: `${suit}-${rank}`,
  rank: rank as Card['rank'],
  suit,
})

const hand = (...ranks: number[]) => evaluateHand(ranks.map((rank) => card(rank)))
type Probe = Record<string, any>

function newEngine(options: GameEngineOptions = {}): { engine: GameEngine; probe: Probe } {
  const engine = new GameEngine({ dealDelayMs: 0, thinkDelayMs: 0, ...options })
  return { engine, probe: engine as unknown as Probe }
}

async function toPlayerTurn(engine: GameEngine): Promise<void> {
  engine.start()
  for (let i = 0; i < 60; i += 1) {
    await vi.advanceTimersByTimeAsync(250)
    if (engine.getSnapshot().phase === 'playerTurn') return
  }
  throw new Error('未能进入玩家回合')
}

async function settleUntil(done: () => boolean): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
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
  probe.player.standing = false
  probe.player.stayed = true
  probe.boss.standing = false
  probe.boss.stayed = true
  probe.holeRevealed = true
  probe.playerHoleRevealed = true
  probe.phase = 'targeting'
  probe.pendingShot = 'player'
  probe.cylinder.chambers = [chamber]
  probe.cylinder.cursor = 0
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('数字牌与目标值', () => {
  it('血量配置为玩家 4/4/4，Boss 4/5/6', () => {
    expect(LEVELS.map((level) => level.playerHp)).toEqual([4, 4, 4])
    expect(LEVELS.map((level) => level.hp)).toEqual([4, 5, 6])
  })

  it('1 固定按 1 点计，目标改变时爆牌阈值同步改变', () => {
    expect(hand(1, 9).total).toBe(10)
    expect(evaluateHand([card(10), card(11)], 21).busted).toBe(false)
    expect(evaluateHand([card(10), card(11)], 17).busted).toBe(true)
    expect(evaluateHand([card(11), card(12)], 24).busted).toBe(false)
  })

  it('每回合使用 11 张唯一数字牌，局内抽干直接报错', async () => {
    const { engine, probe } = newEngine({ rng: createSeededRandom(20261127) })
    await toPlayerTurn(engine)
    const ranks = [...probe.deck, ...probe.player.hand.cards, ...probe.boss.hand.cards]
      .map((entry: Card) => entry.rank)
      .sort((a: number, b: number) => a - b)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    probe.deck = []
    expect(() => probe.drawCard()).toThrow('Numeric deck exhausted inside a round')
  })

  it('双方爆牌时离目标更近者赢，同点平局', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 10, 2], [10, 10, 5], 'blank')
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(engine.getSnapshot().pendingShot).toBe('player')
  })
})

describe('严格交替回合', () => {
  it('玩家要牌后立即换手，Boss 每次只摸一张或停牌', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(3, 4)
    probe.boss.hand = hand(6, 5)
    expect(engine.hit()).toBe(true)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(probe.boss.hand.cards.length).toBeLessThanOrEqual(3)
    expect(engine.getSnapshot().player.stayed).toBe(false)
  })

  it('爆牌后留在玩家回合：不能再要牌，只能打王牌或停牌', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 10)
    probe.boss.hand = hand(10, 5)
    probe.player.trumps = []
    probe.boss.trumps = []
    probe.deck.push(card(5))
    expect(engine.hit()).toBe(true)
    const snap = engine.getSnapshot()
    expect(snap.phase).toBe('playerTurn')
    expect(snap.player.hand.busted).toBe(true)
    expect(snap.player.stayed).toBe(false)
    expect(engine.hit()).toBe(false)
    expect(engine.getSnapshot().phase).toBe('playerTurn')
    expect(engine.getSnapshot().log.join(' ')).toContain('只能打王牌或停牌')
    expect(engine.stand()).toBe(true)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
    expect(engine.getSnapshot().player.stayed).toBe(true)
  })

  it('爆牌后打出提高目标的血注王牌，重新获得要牌权', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 10)
    probe.boss.hand = hand(10, 5)
    probe.player.trumps = ['go24']
    probe.boss.trumps = []
    probe.deck.push(card(2))
    expect(engine.hit()).toBe(true)
    expect(engine.getSnapshot().player.hand.busted).toBe(true)
    expect(engine.getSnapshot().phase).toBe('playerTurn')
    expect(engine.useTrump(0)).toBe(true)
    expect(engine.getSnapshot().roundTarget).toBe(24)
    expect(engine.getSnapshot().player.hand.busted).toBe(false)
    expect(engine.getSnapshot().phase).toBe('playerTurn')
    probe.deck.push(card(4))
    expect(engine.hit()).toBe(true)
    expect(engine.getSnapshot().player.hand.busted).toBe(true)
    expect(engine.getSnapshot().phase).toBe('playerTurn')
  })

  it('对手加牌后，主动停牌的一方恢复行动权', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.hand = hand(10, 4)
    probe.boss.hand = hand(6, 5)
    expect(engine.stand()).toBe(true)
    expect(engine.getSnapshot().player.stayed).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().player.stayed).toBe(false)
    expect(engine.getSnapshot().player.standing).toBe(false)
  })

  it('只有双方连续停牌才结算', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    probe.player.stayed = true
    probe.boss.stayed = false
    void probe.settleRound(probe.generation)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
    probe.player.hand = hand(10, 9)
    probe.boss.hand = hand(10, 5)
    probe.player.stayed = true
    probe.boss.stayed = true
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(engine.getSnapshot().pendingShot).toBe('player')
  })

  it('双方第一次干净停牌不结算，第二次才结算', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.trumps = []
    probe.player.hand = hand(10, 11)
    probe.boss.hand = hand(10, 10)
    const round = probe.round
    const playerCards = [...probe.player.hand.cards]

    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn' && probe.cleanStandPasses === 1)
    expect(engine.getSnapshot().phase).toBe('playerTurn')
    expect(engine.getSnapshot().player.stayed).toBe(false)
    expect(engine.getSnapshot().boss.stayed).toBe(false)
    expect(probe.round).toBe(round)
    expect(probe.player.hand.cards).toEqual(playerCards)

    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(probe.cleanStandPasses).toBe(2)
    expect(engine.getSnapshot().pendingShot).toBe('player')
  })

  it('Boss 停牌不会撤销玩家刚做出的停牌', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.trumps = []
    probe.player.hand = hand(10, 2)
    probe.boss.hand = hand(10, 9)

    expect(engine.stand()).toBe(true)
    await settleUntil(() => probe.cleanStandPasses === 1 && engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().player.stayed).toBe(false)
    expect(engine.getSnapshot().boss.stayed).toBe(false)

    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(probe.cleanStandPasses).toBe(2)
  })

  it('使用王牌后的双方停牌不计数，之后仍需两次干净停牌', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0, itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.trumps = []
    probe.player.hand = hand(10, 11)
    probe.boss.hand = hand(10, 10)
    probe.player.trumps = ['happiness']
    probe.trumpPool = ['remove', 'return']
    expect(engine.useTrump(0)).toBe(true)
    expect(probe.standPassDirty).toBe(true)

    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().phase).toBe('playerTurn')
    expect(probe.cleanStandPasses).toBe(0)
    expect(probe.standPassDirty).toBe(false)

    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn' && probe.cleanStandPasses === 1)
    expect(engine.stand()).toBe(true)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(probe.cleanStandPasses).toBe(2)
  })

  it('要牌会清空连续停牌计数', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    probe.boss.trumps = []
    probe.player.hand = hand(3, 4)
    probe.boss.hand = hand(10, 10)
    probe.cleanStandPasses = 1
    probe.standPassDirty = true
    expect(engine.hit()).toBe(true)
    expect(probe.cleanStandPasses).toBe(0)
    expect(probe.standPassDirty).toBe(false)
  })

  it('Boss 使用王牌也会重置连续停牌计数', async () => {
    const { probe } = newEngine()
    probe.cleanStandPasses = 1
    probe.standPassDirty = false
    probe.boss.trumps = ['happiness']
    probe.trumpPool = ['remove', 'return']
    expect(probe.useTrumpInternal(probe.boss, 0)).toBe(true)
    expect(probe.cleanStandPasses).toBe(0)
    expect(probe.standPassDirty).toBe(true)
  })

  it('Boss 同一回合可连续使用多张王牌', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    const played: string[] = []
    engine.subscribe((event) => {
      if (event.type === 'trumpPlayed' && event.actor === 'boss') played.push(event.trump)
    })
    probe.phase = 'bossTurn'
    probe.boss.hand = hand(10, 10, 5)
    probe.player.hand = hand(10, 5)
    probe.boss.trumps = ['return', 'happiness']
    probe.player.trumps = []
    probe.trumpPool = ['remove']
    void probe.runBossTurn(probe.generation)
    await settleUntil(() => played.length >= 2)
    expect(played.slice(0, 2)).toEqual(['return', 'happiness'])
  })

  it('玩家先按要牌键再发牌，等待期间拒绝重复输入', async () => {
    const { engine } = newEngine({ rng: createSeededRandom(20261127) })
    await toPlayerTurn(engine)
    engine.setPresentationGate(() => Promise.resolve())
    expect(engine.hit()).toBe(true)
    expect(engine.getSnapshot().inputLocked).toBe(true)
    expect(engine.getSnapshot().player.hand.cards).toHaveLength(2)
    expect(engine.hit()).toBe(false)
    await vi.advanceTimersByTimeAsync(149)
    expect(engine.getSnapshot().player.hand.cards).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.getSnapshot().player.hand.cards).toHaveLength(3)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
  })

  it('玩家先按停牌键再确认停牌', async () => {
    const { engine } = newEngine()
    await toPlayerTurn(engine)
    engine.setPresentationGate(() => Promise.resolve())
    expect(engine.stand()).toBe(true)
    expect(engine.getSnapshot().player.stayed).toBe(false)
    await vi.advanceTimersByTimeAsync(219)
    expect(engine.getSnapshot().player.stayed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(engine.getSnapshot().player.stayed).toBe(true)
    expect(engine.getSnapshot().phase).toBe('bossTurn')
  })

  it('Boss 要牌和停牌分别发出动作字幕事件', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    const barks: Array<{ action: string; hand: boolean; stayed: boolean; cards: number }> = []
    engine.subscribe((event, snapshot) => {
      if (event.type === 'bossBark') barks.push({ action: event.action, hand: event.hand, stayed: snapshot.boss.stayed, cards: snapshot.boss.hand.cards.length })
    })
    probe.boss.trumps = []
    probe.boss.hand = hand(6, 5)
    probe.phase = 'bossTurn'
    void probe.runBossTurn(probe.generation)
    await settleUntil(() => barks.some((bark) => bark.action === 'hit'))
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    const hitBark = barks.find((bark) => bark.action === 'hit')
    barks.length = 0
    probe.boss.trumps = []
    probe.boss.hand = hand(10, 10)
    probe.boss.stayed = false
    probe.phase = 'bossTurn'
    void probe.runBossTurn(probe.generation)
    await settleUntil(() => barks.some((bark) => bark.action === 'stand'))
    expect(hitBark).toMatchObject({ hand: true, stayed: false, cards: 2 })
    expect(barks.map((bark) => bark.action)).toEqual(['stand'])
    expect(barks[0]).toMatchObject({ hand: true, stayed: false, cards: 2 })
  })

  it('Boss 的双爆判断与低者胜规则一致', () => {
    const { probe } = newEngine()
    probe.boss.hand = hand(10, 10, 2)
    probe.player.hand = hand(10, 10, 5)
    expect(probe.wouldLose()).toBe(false)
    probe.boss.hand = hand(10, 10, 5)
    probe.player.hand = hand(10, 10, 2)
    expect(probe.wouldLose()).toBe(true)
  })
})

describe('王牌系统', () => {
  it('卡池为 14 张，双方每回合各抽 2 张', async () => {
    expect(TRUMP_IDS).toHaveLength(14)
    expect(TRUMP_IDS).not.toContain('go17')
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(engine.getSnapshot().player.trumps).toHaveLength(2)
    expect(engine.getSnapshot().boss.trumps).toHaveLength(2)
    expect(probe.trumpPool).toHaveLength(10)
    expect(new Set(probe.trumpPool).size).toBe(10)
  })

  it('单卡权重合计 100%，且按确认值配置', () => {
    expect(Object.values(TRUMP_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(100)
    expect(TRUMP_WEIGHTS).toMatchObject({
      go24: 7,
      go27: 7,
      destroy: 4,
      remove: 8,
      return: 7,
      exchange: 9,
      card2: 7.5,
      card3: 7.5,
      card4: 7.5,
      card5: 7.5,
      card6: 7.5,
      card7: 7.5,
      happiness: 10,
      love: 3,
    })
  })

  it('局末最多保留一张，下一回合再补到两张', async () => {
    const { engine, probe } = newEngine({ itemLockMs: 0 })
    await toPlayerTurn(engine)
    probe.player.trumps = ['go24', 'return', 'exchange']
    probe.boss.trumps = ['go24', 'remove']
    void probe.startRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'playerTurn')
    expect(engine.getSnapshot().player.trumps).toHaveLength(3)
    expect(engine.getSnapshot().player.trumps[0]).toBe('exchange')
    expect(engine.getSnapshot().boss.trumps).toHaveLength(3)
    expect(engine.getSnapshot().boss.trumps[0]).toBe('remove')
  })

  it('血注改写目标、重算爆牌并恢复双方行动权', () => {
    const { engine, probe } = newEngine()
    probe.phase = 'playerTurn'
    probe.player.hand = hand(10, 10, 5)
    probe.boss.hand = hand(10, 5)
    probe.player.stayed = true
    probe.boss.stayed = true
    probe.player.trumps = ['go24']
    expect(engine.useTrump(0)).toBe(true)
    expect(engine.getSnapshot().roundTarget).toBe(24)
    expect(engine.getSnapshot().player.hand.busted).toBe(true)
    expect(engine.getSnapshot().player.stayed).toBe(false)
    expect(engine.getSnapshot().boss.stayed).toBe(false)
    expect(engine.getSnapshot().tableTrumps.player).toEqual(['go24'])
  })

  it('Return 和 Remove 只弹回最后一张明牌', () => {
    const { probe } = newEngine()
    probe.phase = 'playerTurn'
    const playerCards = [card(3), card(7), card(9)]
    const bossCards = [card(4), card(8), card(10)]
    probe.player.hand = { ...evaluateHand(playerCards), visible: [playerCards[0]!, null, playerCards[2]!] }
    probe.boss.hand = { ...evaluateHand(bossCards), visible: [bossCards[0]!, null, bossCards[2]!] }
    probe.player.trumps = ['return']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(probe.player.hand.total).toBe(10)
    probe.player.trumps = ['remove']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(probe.boss.hand.total).toBe(12)
  })

  it('Exchange 交换双方最后一张明牌，暗牌保持隐藏', () => {
    const { probe } = newEngine()
    probe.phase = 'playerTurn'
    const playerCards = [card(3), card(7), card(9)]
    const bossCards = [card(4), card(8), card(10)]
    probe.player.hand = { ...evaluateHand(playerCards), visible: [playerCards[0]!, null, playerCards[2]!] }
    probe.boss.hand = { ...evaluateHand(bossCards), visible: [bossCards[0]!, null, bossCards[2]!] }
    probe.player.trumps = ['exchange']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(probe.player.hand.total).toBe(20)
    expect(probe.boss.hand.total).toBe(21)
    expect(probe.boss.hand.visible[1]).toBeNull()
  })

  it('2 Card 到 7 Card 都只抽对应且仍在牌堆中的数字牌', () => {
    const { probe } = newEngine()
    probe.phase = 'playerTurn'
    for (let rank = 2; rank <= 7; rank += 1) {
      probe.player.hand = evaluateHand([])
      probe.deck = [card(rank), card(11)]
      probe.player.trumps = [`card${rank}` as TrumpId]
      expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
      expect(probe.player.hand.total).toBe(rank)
      expect(probe.deck.some((entry: Card) => entry.rank === rank)).toBe(false)
    }
  })

  it('Happiness 双方各抽一张，Destroy 移除目标王牌并恢复 21', () => {
    const { engine, probe } = newEngine()
    probe.phase = 'playerTurn'
    probe.trumpPool = ['return', 'remove']
    probe.player.trumps = ['happiness']
    probe.boss.trumps = []
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(engine.getSnapshot().player.trumps).toEqual(['remove'])
    expect(engine.getSnapshot().boss.trumps).toEqual(['return'])

    probe.roundTarget = 24
    probe.tableTrumps.boss = ['go24']
    probe.player.trumps = ['destroy']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(engine.getSnapshot().roundTarget).toBe(21)
    expect(engine.getSnapshot().tableTrumps.boss).toEqual([])
  })

  it('以爱资敌给对手最贴近目标且不爆的一张', () => {
    const { probe } = newEngine()
    probe.phase = 'playerTurn'
    probe.boss.hand = hand(8, 10)
    probe.deck = [card(2), card(9), card(5)]
    probe.player.trumps = ['love']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(probe.boss.hand.total).toBe(20)
    expect(probe.boss.hand.busted).toBe(false)
    expect(probe.deck.map((entry: { rank: number }) => entry.rank)).toEqual([9, 5])
  })

  it('以爱资敌没有不爆的牌时给最小的一张，照样爆牌', () => {
    const { probe } = newEngine()
    probe.phase = 'playerTurn'
    probe.boss.hand = hand(8, 10, 2)
    probe.deck = [card(9), card(2)]
    probe.player.trumps = ['love']
    expect(probe.useTrumpInternal(probe.player, 0)).toBe(true)
    expect(probe.boss.hand.total).toBe(22)
    expect(probe.boss.hand.busted).toBe(true)
    expect(probe.deck.map((entry: { rank: number }) => entry.rank)).toEqual([9])
  })

  it('每张王牌都有独立中文名和英文副标题', () => {
    const names = TRUMP_IDS.map((id) => TRUMP_CATALOG[id].name)
    expect(new Set(names).size).toBe(TRUMP_IDS.length)
    for (const id of TRUMP_IDS) {
      expect(TRUMP_CATALOG[id].name).toMatch(/[\u4e00-\u9fff]/)
      expect(TRUMP_CATALOG[id].enName.length).toBeGreaterThan(0)
    }
    expect(TRUMP_CATALOG.love.name).toBe('以爱资敌')
  })

  it('旧动画映射到 Go for / Exchange / Return / Remove', async () => {
    const { trumpAnimationItem } = await import('./GameEngine')
    expect(trumpAnimationItem('go24')).toBe('hourglass')
    expect(trumpAnimationItem('go27')).toBe('hourglass')
    expect(trumpAnimationItem('exchange')).toBe('magnet')
    expect(trumpAnimationItem('return')).toBe('cutter')
    expect(trumpAnimationItem('remove')).toBe('seal')
    expect(trumpAnimationItem('card2')).toBeNull()
  })
})

describe('开枪道具与伤害', () => {
  it('只保留 8 件开枪道具，牌局阶段禁止使用', async () => {
    expect(ITEM_IDS).toEqual(['magnifier', 'sedative', 'saw', 'handcuffs', 'aegis', 'hammer', 'iou', 'gloves'])
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    const notices: string[] = []
    engine.subscribe((event) => { if (event.type === 'notice') notices.push(event.message) })
    probe.player.items = ['saw']
    expect(engine.useItem('saw')).toBe(false)
    expect(notices).toContain('21 点阶段只能使用王牌。')
  })

  it('实弹基础伤害为 1，锯子 +1', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    const shots: number[] = []
    engine.subscribe((event) => { if (event.type === 'shot') shots.push(event.damage) })
    setTargeting(probe, [10, 9], [10, 5], 'live')
    engine.chooseTarget('boss')
    await settleUntil(() => shots.length > 0)
    expect(shots[0]).toBe(1)

    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.sawBoost = 1
    engine.chooseTarget('boss')
    await settleUntil(() => shots.length > 1)
    expect(shots[1]).toBe(2)
  })

  it('空膛自射不再给道具，只结束开枪', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = []
    engine.chooseTarget('player')
    await settleUntil(() => engine.getSnapshot().log.join(' ').includes('本次开枪结束'))
    expect(engine.getSnapshot().player.items).toHaveLength(0)
    expect(engine.getSnapshot().log.join(' ')).toContain('没有拿到补给')
    expect(engine.getSnapshot().pendingShot).toBeNull()
  })

  it('对敌人开空枪会把枪权交给敌人', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().phase === 'targeting' && engine.getSnapshot().pendingShot === 'boss')
    expect(engine.getSnapshot().pendingShot).toBe('boss')
    expect(engine.getSnapshot().log.join(' ')).toContain('枪权转移给它')
  })

  it('手铐阻止一次对敌空枪转移，玩家继续持枪', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = ['handcuffs']
    expect(engine.useItem('handcuffs')).toBe(true)
    expect(probe.boss.gunCuffed).toBe(true)
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().phase === 'targeting' && engine.getSnapshot().pendingShot === 'player')
    expect(probe.boss.gunCuffed).toBe(false)
    expect(engine.getSnapshot().log.join(' ')).toContain('枪没有脱手')
  })

  it('手铐只保护下一枪，第二次对敌空枪正常转移', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = ['handcuffs']
    expect(engine.useItem('handcuffs')).toBe(true)
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().phase === 'targeting' && engine.getSnapshot().pendingShot === 'player')
    probe.cylinder.chambers = ['blank']
    probe.cylinder.cursor = 0
    engine.chooseTarget('boss')
    await settleUntil(() => engine.getSnapshot().phase === 'targeting' && engine.getSnapshot().pendingShot === 'boss')
    expect(engine.getSnapshot().log.join(' ')).toContain('枪权转移给它')
  })

  it('Boss 对玩家开空枪会把枪权交给玩家，玩家可以继续用道具', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.pendingShot = 'boss'
    probe.revealedBy.boss = 'live'
    void probe.runBossTargeting(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting' && engine.getSnapshot().pendingShot === 'player')
    probe.player.items = ['saw']
    expect(engine.useItem('saw')).toBe(true)
    expect(engine.getSnapshot().log.join(' ')).toContain('枪权转移给你')
  })

  it('Boss 用手铐也能阻止空枪把枪权转给玩家', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.pendingShot = 'boss'
    probe.boss.items = ['handcuffs']
    probe.revealedBy.boss = 'live'
    void probe.runBossTargeting(probe.generation)
    await settleUntil(() => {
      const snapshot = engine.getSnapshot()
      return snapshot.log.join(' ').includes('枪没有脱手') && snapshot.phase === 'targeting' && snapshot.pendingShot === 'boss'
    })
    expect(probe.player.gunCuffed).toBe(false)
    expect(engine.getSnapshot().pendingShot).toBe('boss')
  })

  it('手铐不再影响 21 点要牌和停牌', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    const before = probe.player.hand.cards.length
    probe.player.gunCuffed = true
    expect(engine.hit()).toBe(true)
    expect(probe.player.hand.cards.length).toBe(before + 1)
    expect(engine.getSnapshot().log.join(' ')).not.toContain('手铐锁住手腕')
  })

  it('重锤可以把空膛翻成实弹并同步玩家读数', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = ['hammer']
    probe.revealedBy.player = 'blank'
    expect(engine.useItem('hammer')).toBe(true)
    expect(probe.cylinder.current).toBe('live')
    expect(engine.getSnapshot().cylinder.revealed).toBe('live')
  })

  it('重锤可以把实膛翻成空膛并同步双方读数', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.items = ['hammer']
    probe.revealedBy.player = 'live'
    probe.revealedBy.boss = 'live'
    expect(engine.useItem('hammer')).toBe(true)
    expect(probe.cylinder.current).toBe('blank')
    expect(engine.getSnapshot().cylinder.revealed).toBe('blank')
    expect(probe.revealedBy.boss).toBe('blank')
  })

  it('弹仓见底时不能使用重锤', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = ['hammer']
    probe.cylinder.chambers = []
    probe.cylinder.cursor = 0
    expect(engine.useItem('hammer')).toBe(false)
    expect(probe.player.items).toEqual(['hammer'])
  })

  it('护心镜退出当前这一发：公开退弹并从本局弹仓移除', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.cylinder.chambers = ['live', 'blank']
    probe.cylinder.cursor = 0
    probe.player.items = ['aegis']
    probe.revealedBy.player = 'live'
    const ejected: string[] = []
    engine.subscribe((event) => {
      if (event.type === 'chamberDiscarded') ejected.push(`${event.actor}:${event.chamber}`)
    })
    expect(engine.useItem('aegis')).toBe(true)
    expect(ejected).toEqual(['player:live'])
    expect(probe.cylinder.current).toBe('blank')
    expect(probe.cylinder.remaining).toBe(1)
    const view = engine.getSnapshot().cylinder
    expect(view.live).toBe(0)
    expect(view.blank).toBe(1)
    expect(view.revealed).toBeNull()
    expect(probe.player.items).toEqual([])
    expect(engine.getSnapshot().log.join(' ')).toContain('退出一发实弹')
  })

  it('弹仓见底时不能使用护心镜', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    probe.player.items = ['aegis']
    probe.cylinder.chambers = []
    probe.cylinder.cursor = 0
    expect(engine.useItem('aegis')).toBe(false)
    expect(probe.player.items).toEqual(['aegis'])
  })

  it('窃贼手套点选对手锯子并立即使用', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.items = ['gloves']
    probe.boss.items = ['saw']
    expect(engine.useItem('gloves', 'saw')).toBe(true)
    expect(probe.boss.items).toEqual([])
    expect(probe.player.items).toEqual([])
    expect(probe.player.sawBoost).toBe(1)
    expect(engine.getSnapshot().log.join(' ')).toContain('偷走了【锯子】')
  })

  it('窃贼手套必须先点选目标，点不存在的道具会失败且不消耗', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.items = ['gloves']
    probe.boss.items = ['saw']
    expect(engine.useItem('gloves')).toBe(false)
    expect(probe.player.items).toEqual(['gloves'])
    expect(engine.useItem('gloves', 'aegis')).toBe(false)
    expect(probe.player.items).toEqual(['gloves'])
    expect(probe.boss.items).toEqual(['saw'])
    expect(engine.useItem('gloves', 'saw')).toBe(true)
    expect(probe.player.sawBoost).toBe(1)
  })

  it('窃贼手套不能偷取另一只窃贼手套', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.items = ['gloves']
    probe.boss.items = ['gloves']
    expect(engine.useItem('gloves', 'gloves')).toBe(false)
    expect(probe.player.items).toEqual(['gloves'])
    expect(probe.boss.items).toEqual(['gloves'])
  })

  it('偷到的道具无法使用时放回，手套不消耗，可以改偷别的', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.hp = probe.player.maxHp
    probe.player.items = ['gloves']
    probe.boss.items = ['sedative', 'saw']
    expect(engine.useItem('gloves', 'sedative')).toBe(false)
    expect(probe.player.items).toEqual(['gloves'])
    expect(probe.boss.items).toEqual(['sedative', 'saw'])
    expect(engine.useItem('gloves', 'saw')).toBe(true)
    expect(probe.boss.items).toEqual(['sedative'])
  })

  it('窃贼手套偷到重锤时同步翻转读数', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'live')
    probe.player.items = ['gloves']
    probe.boss.items = ['hammer']
    probe.revealedBy.player = 'live'
    expect(engine.useItem('gloves', 'hammer')).toBe(true)
    expect(probe.cylinder.current).toBe('blank')
    expect(engine.getSnapshot().cylinder.revealed).toBe('blank')
    expect(engine.getSnapshot().log.join(' ')).toContain('偷走了【重锤】')
  })

  it('Boss 的窃贼手套仍随机偷取并立即使用', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 9], 'live')
    probe.boss.items = ['gloves']
    probe.player.items = ['saw']
    probe.pendingShot = 'boss'
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().log.join(' ').includes('偷走了'))
    expect(probe.player.items).toEqual([])
    expect(probe.boss.sawBoost).toBe(1)
  })

  it('玩家满点获胜额外获得一件道具', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 11], [10, 5], 'blank')
    probe.player.items = []
    probe.phase = 'resolving'
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().phase === 'targeting')
    expect(engine.getSnapshot().lastPerfectWin).toBe(true)
    expect(engine.getSnapshot().player.items).toHaveLength(1)
  })

  it('Boss 满点同样获得一件道具', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 11], 'blank')
    probe.boss.items = []
    probe.phase = 'resolving'
    const perfect: { actor: string; item: ItemId | null }[] = []
    engine.subscribe((event) => {
      if (event.type === 'perfectWin') perfect.push({ actor: event.actor, item: event.item })
    })
    void probe.settleRound(probe.generation)
    await settleUntil(() => perfect.length > 0)
    expect(perfect[0]?.actor).toBe('boss')
    expect(perfect[0]?.item).not.toBeNull()
    expect(engine.getSnapshot().lastPerfectWin).toBe(false)
  })

  it('Boss 在开枪阶段会使用道具', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 9], 'live')
    probe.boss.items = ['saw']
    probe.pendingShot = 'boss'
    void probe.settleRound(probe.generation)
    await settleUntil(() => engine.getSnapshot().log.join(' ').includes('使用了【锯子】'))
    expect(probe.boss.sawBoost).toBe(1)
    expect(engine.getSnapshot().log.join(' ')).toContain('使用了【锯子】')
  })

  it('Boss 用护心镜退掉空膛，再用锯子把顶上来的实弹打出去', async () => {
    const { engine, probe } = newEngine({ thinkDelayMs: 0 })
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 9], 'blank')
    probe.cylinder.chambers = ['blank', 'live']
    probe.cylinder.cursor = 0
    probe.boss.items = ['saw', 'aegis']
    probe.pendingShot = 'boss'
    void probe.runBossTargeting(probe.generation)
    await settleUntil(() => probe.player.hp < 7)
    expect(probe.boss.items).toEqual([])
    expect(probe.player.hp).toBe(5)
    const log = engine.getSnapshot().log.join(' ')
    expect(log).toContain('使用了【护心镜】')
    expect(log).toContain('退出一发空膛')
    expect(log).toContain('使用了【锯子】')
    expect(log).toContain('承受 2 点伤害')
  })

  it('道具池按持有上限抽取，双方共用同一份可抽类型', () => {
    const { probe } = newEngine()
    for (let level = 0; level < 3; level += 1) {
      probe.levelIndex = level
      expect(probe.availableTypes(probe.boss)).toEqual(probe.availableTypes(probe.player))
    }
    probe.levelIndex = 2
    probe.player.items = ['hammer', 'hammer']
    const pool = probe.availableTypes(probe.player)
    expect(pool).not.toContain('hammer')
    expect(pool).toContain('gloves')
    probe.player.items = new Array(8).fill('sedative')
    expect(probe.availableTypes(probe.player)).toEqual([])
  })

  it('Boss 受伤但未濒死时会使用借据', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 5], [10, 9], 'live')
    probe.boss.items = ['iou']
    probe.boss.hp = 3
    probe.pendingShot = 'boss'
    void probe.runBossTargeting(probe.generation)
    await settleUntil(() => probe.boss.items.length === 0)
    expect(engine.getSnapshot().log.join(' ')).toContain('使用了【借据】')
    expect([1, 4]).toContain(probe.boss.hp)
  })
})

describe('弹仓增长与随机模式', () => {
  it('第一层开局 1 实 1 空，容量随层与回合增长', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    expect(engine.getSnapshot().cylinder).toMatchObject({ total: 2, live: 1, blank: 1 })
    probe.levelIndex = 0
    probe.round = 3
    expect(probe.cylinderCapacity()).toBe(3)
    probe.levelIndex = 1
    probe.round = 1
    expect(probe.cylinderCapacity()).toBe(4)
    probe.levelIndex = 2
    expect(probe.cylinderCapacity()).toBe(6)
  })

  it('首次达到 8 发后随机 2~8，层首保留，新局重置', () => {
    const { engine, probe } = newEngine()
    const rng = vi.fn().mockReturnValue(0)
    probe.rng = rng
    probe.cylinder.rng = rng
    probe.levelIndex = 2
    probe.round = 9
    probe.cylinderRandomized = false
    expect(probe.reloadCylinder()).toHaveLength(8)
    expect(probe.reloadCylinder()).toHaveLength(2)
    probe.started = true
    engine.startAtLevel(1)
    expect(probe.cylinderRandomized).toBe(true)
    engine.restart()
    expect(probe.cylinderRandomized).toBe(false)
  })
})

describe('层间补给', () => {
  const levels: readonly LevelConfig[] = [
    { id: 1, name: '看门人', title: '门厅', hp: 6, playerHp: 7, supply: 0, personality: 'cautious' },
    { id: 2, name: '收账人', title: '账房', hp: 6, playerHp: 7, supply: 0, personality: 'gambler' },
  ]

  it('第 1 层两件候选，第 2 层三件候选', async () => {
    const { engine, probe } = newEngine({ levels })
    await toPlayerTurn(engine)
    probe.levelIndex = 0
    expect(probe.rollSupplyOptions()).toHaveLength(2)
    probe.levelIndex = 1
    expect(probe.rollSupplyOptions()).toHaveLength(3)
  })

  it('补给只来自剩余 8 件道具', () => {
    const { probe } = newEngine()
    probe.levelIndex = 2
    const options = probe.rollSupplyOptions()
    expect(options.every((item: ItemId) => ITEM_IDS.includes(item))).toBe(true)
  })

  it('开局补给 0/1/1，弹仓打空重装发 1/2/4', () => {
    expect(LEVELS.map((level) => level.supply)).toEqual([0, 1, 1])
    expect(LEVELS.map((level) => level.reloadSupply)).toEqual([1, 2, 4])
  })

  it('从走廊续档进入某层时，玩家也照常拿到开局补给', () => {
    const { engine, probe } = newEngine({ levels: [
      { id: 1, name: '看门人', title: '门厅', hp: 6, playerHp: 7, supply: 2, personality: 'cautious' },
    ] })
    engine.startAtLevel(0)
    expect(probe.player.items).toHaveLength(2)
    expect(probe.boss.items).toHaveLength(2)
  })

  it('弹仓打空重装时双方各发一件补给', async () => {
    const { engine, probe } = newEngine()
    await toPlayerTurn(engine)
    setTargeting(probe, [10, 9], [10, 5], 'blank')
    engine.chooseTarget('player')
    await settleUntil(() => probe.player.items.length > 0 && probe.boss.items.length > 0)
    expect(probe.player.items).toHaveLength(1)
    expect(probe.boss.items).toHaveLength(1)
    expect(engine.getSnapshot().log.join(' ')).toContain('弹仓打空')
  })

  it('清层补给自动抽取：先玩家后 Boss，各带一件进下一层', async () => {
    const { engine, probe } = newEngine({ levels: [
      { id: 1, name: '看门人', title: '门厅', hp: 6, playerHp: 7, supply: 0, reloadSupply: 0, personality: 'cautious' },
      { id: 2, name: '收账人', title: '账房', hp: 6, playerHp: 7, supply: 0, reloadSupply: 0, personality: 'gambler' },
    ] })
    await toPlayerTurn(engine)
    probe.boss.hp = 0
    probe.phase = 'targeting'
    probe.resolveDeaths()
    expect(engine.getSnapshot().phase).toBe('levelClear')

    await vi.advanceTimersByTimeAsync(2600 + 3200 + 100)
    const offer = engine.getSnapshot()
    expect(offer.phase).toBe('supply')
    expect(offer.supplyOptions).toHaveLength(2)
    expect(offer.supplyPick).not.toBeNull()
    expect(offer.supplyOptions).toContain(offer.supplyPick)

    await vi.advanceTimersByTimeAsync(3000 + 100)
    expect(engine.getSnapshot().phase).toBe('bossSupply')
    expect(engine.getSnapshot().bossSupplyPick).not.toBeNull()

    await vi.advanceTimersByTimeAsync(3000 + 100)
    expect(engine.getSnapshot().levelIndex).toBe(1)
    expect(engine.getSnapshot().player.items).toHaveLength(1)
    expect(engine.getSnapshot().boss.items).toHaveLength(1)
  })
})
