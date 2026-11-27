import {
  evaluateHand,
  type Card,
  type CardRank,
  type Chamber,
  type GameEngine,
  type HandState,
  type ItemId,
} from './GameEngine'

interface ActorInternals {
  hp: number
  items: ItemId[]
  hand: HandState
}

interface CylinderInternals {
  chambers: Chamber[]
  cursor: number
}

interface EngineInternals {
  player: ActorInternals
  boss: ActorInternals
  cylinder: CylinderInternals
  generation: number
  cancelTimers(): void
  resolveDeaths(): boolean
  publish(): void
}

const ITEM_CAP = 8

function cardsForTotal(total: number): Card[] {
  const t = Math.max(2, Math.min(21, Math.round(total)))
  if (t <= 3) return [{ id: `dev-${t}-0`, rank: t as CardRank, suit: 'spade' }]
  const first = Math.max(1, t - 11)
  const second = t - first
  return [
    { id: `dev-${first}-0`, rank: first as CardRank, suit: 'spade' },
    { id: `dev-${second}-1`, rank: second as CardRank, suit: 'heart' },
  ]
}

/**
 * 开发者面板专用桥：只通过运行期可达的内部字段改状态，GameEngine.ts 文件零改动。
 * 走官方出口——赢关用 resolveDeaths（levelClear/victory、补给、结算全由引擎自己跑），
 * 改完手动 publish 刷新快照；挂起的回合定时器先取消，避免旧回合反扑。
 */
export class DevBridge {
  private readonly engine: GameEngine
  private readonly internals: EngineInternals

  constructor(engine: GameEngine) {
    this.engine = engine
    this.internals = engine as unknown as EngineInternals
  }

  winLevel(): boolean {
    const snap = this.engine.getSnapshot()
    // 只在真正的对局阶段生效：清层、补给、层间过场里重复点击会打断过渡，导致卡在中间态
    if (snap.paused) return false
    if (snap.phase !== 'playerTurn' && snap.phase !== 'bossTurn' && snap.phase !== 'targeting') return false
    this.internals.generation += 1
    this.internals.cancelTimers()
    this.internals.boss.hp = 0
    this.internals.resolveDeaths()
    return true
  }

  setPlayerTotal(total: number): void {
    this.internals.player.hand = evaluateHand(cardsForTotal(total))
    this.internals.publish()
  }

  forceChamber(chamber: Chamber): void {
    const cylinder = this.internals.cylinder
    // 弹仓打空后没有「下一发」可改，静默忽略
    if (cylinder.cursor >= cylinder.chambers.length) return
    cylinder.chambers[cylinder.cursor] = chamber
    this.internals.publish()
  }

  grantItem(item: ItemId): void {
    const items = this.internals.player.items
    if (items.length >= ITEM_CAP) items.shift()
    items.push(item)
    this.internals.publish()
  }

  /** 仅供动作验收：压低血量以触发治疗类道具 */
  setPlayerHp(hp: number): void {
    this.internals.player.hp = Math.max(0, Math.min(7, Math.round(hp)))
    this.internals.publish()
  }
}
