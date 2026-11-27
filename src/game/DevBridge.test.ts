import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GameEngine } from './GameEngine'
import { DevBridge } from './DevBridge'

type Probe = Record<string, any>

function setup(): { engine: GameEngine; bridge: DevBridge; probe: Probe } {
  const engine = new GameEngine({ dealDelayMs: 0, thinkDelayMs: 0 })
  return { engine, bridge: new DevBridge(engine), probe: engine as unknown as Probe }
}

async function toPlayerTurn(engine: GameEngine): Promise<void> {
  engine.start()
  for (let i = 0; i < 40; i += 1) {
    await vi.advanceTimersByTimeAsync(500)
    if (engine.getSnapshot().phase === 'playerTurn') return
  }
  throw new Error('未能进入玩家回合')
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DevBridge.winLevel', () => {
  it('当前层直接清层：走引擎 levelClear 与补给流程', async () => {
    const { engine, bridge } = setup()
    await toPlayerTurn(engine)
    bridge.winLevel()
    expect(engine.getSnapshot().phase).toBe('levelClear')
    // 横幅 2.6s 后进入补给，全程由引擎自己推进
    await vi.advanceTimersByTimeAsync(2800)
    expect(engine.getSnapshot().phase).toBe('supply')
  })

  it('最后一关直接胜利：phase=victory 并派 gameOver(player)', async () => {
    const { engine, bridge, probe } = setup()
    await toPlayerTurn(engine)
    probe.levelIndex = 2
    const events: string[] = []
    engine.subscribe((event) => {
      if (event.type === 'gameOver') events.push(event.winner)
    })
    bridge.winLevel()
    expect(engine.getSnapshot().phase).toBe('victory')
    expect(events).toEqual(['player'])
  })

  it('清层/补给/结算中重复点击是静默 no-op', async () => {
    const { engine, bridge } = setup()
    await toPlayerTurn(engine)
    bridge.winLevel()
    const phase = engine.getSnapshot().phase
    bridge.winLevel()
    expect(engine.getSnapshot().phase).toBe(phase)
  })
})

describe('DevBridge.setPlayerTotal', () => {
  it('21 点使用两张数字牌', () => {
    const { bridge, engine } = setup()
    bridge.setPlayerTotal(21)
    const hand = engine.getSnapshot().player.hand
    expect(hand.total).toBe(21)
    expect(hand.cards).toHaveLength(2)
  })

  it('2/3 点用单张牌，4–20 点用两张牌，超界钳制到 21', () => {
    const { bridge, engine } = setup()
    bridge.setPlayerTotal(2)
    expect(engine.getSnapshot().player.hand.total).toBe(2)
    bridge.setPlayerTotal(3)
    expect(engine.getSnapshot().player.hand.cards).toHaveLength(1)
    for (const t of [4, 7, 11, 13, 17, 20]) {
      bridge.setPlayerTotal(t)
      expect(engine.getSnapshot().player.hand.total).toBe(t)
      expect(engine.getSnapshot().player.hand.cards).toHaveLength(2)
    }
    bridge.setPlayerTotal(99)
    expect(engine.getSnapshot().player.hand.total).toBe(21)
  })
})

describe('DevBridge.forceChamber', () => {
  it('改写当前膛位并刷新弹仓计数', () => {
    const { bridge, engine, probe } = setup()
    probe.cylinder.chambers = ['blank', 'live']
    probe.cylinder.cursor = 0
    bridge.forceChamber('live')
    expect(engine.getSnapshot().cylinder.live).toBe(2)
    bridge.forceChamber('blank')
    expect(probe.cylinder.chambers[probe.cylinder.cursor]).toBe('blank')
  })

  it('弹仓打空后静默忽略', () => {
    const { bridge, probe } = setup()
    probe.cylinder.chambers = ['live']
    probe.cylinder.cursor = 1
    expect(() => bridge.forceChamber('blank')).not.toThrow()
  })
})

describe('DevBridge.resetItemBudget', () => {
  it('清零双方本回合道具计数并刷新快照', () => {
    const { bridge, engine, probe } = setup()
    probe.player.itemsUsedThisTurn = 3
    probe.boss.itemsUsedThisTurn = 2
    bridge.resetItemBudget()
    expect(engine.getSnapshot().player.itemsUsedThisTurn).toBe(0)
    expect(engine.getSnapshot().boss.itemsUsedThisTurn).toBe(0)
  })
})

describe('DevBridge.grantItem', () => {
  it('直接入包，满 8 件替换最早一件', () => {
    const { bridge, engine } = setup()
    bridge.grantItem('saw')
    expect(engine.getSnapshot().player.items).toContain('saw')
    for (let i = 0; i < 8; i += 1) bridge.grantItem('magnifier')
    bridge.grantItem('hammer')
    const items = engine.getSnapshot().player.items
    expect(items).toHaveLength(8)
    expect(items[items.length - 1]).toBe('hammer')
  })
})
