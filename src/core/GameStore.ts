export type Side = 'player' | 'opponent'

export interface InventoryItem {
  id: string
  name: string
  /** 槽位展示用的短标签（1-2 个汉字） */
  badge: string
  qty: number
}

export interface BattleState {
  hp: Record<Side, number>
  maxHp: Record<Side, number>
  chips: number
  turn: Side
  round: number
  inventory: InventoryItem[]
  activeGame: string | null
}

type Listener = (state: Readonly<BattleState>) => void

const DEFAULT_HP = 12

const DEFAULT_INVENTORY: InventoryItem[] = [
  { id: 'handcuffs', name: '手铐', badge: '铐', qty: 1 },
  { id: 'cigarette', name: '香烟', badge: '烟', qty: 1 },
  { id: 'handsaw', name: '手锯', badge: '锯', qty: 1 },
]

/** 全局对局状态。修改必须走方法，保证订阅者收到通知。 */
export class GameStore {
  private state: BattleState = createInitialState()
  private readonly listeners = new Set<Listener>()

  get snapshot(): Readonly<BattleState> {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 扣血，返回实际扣除值与剩余血量 */
  damage(side: Side, amount: number): { applied: number; hp: number } {
    const applied = Math.max(0, Math.min(this.state.hp[side], Math.round(amount)))
    this.state.hp[side] -= applied
    this.commit()
    return { applied, hp: this.state.hp[side] }
  }

  heal(side: Side, amount: number): void {
    this.state.hp[side] = Math.min(this.state.maxHp[side], this.state.hp[side] + Math.max(0, amount))
    this.commit()
  }

  addChips(amount: number): void {
    this.state.chips = Math.max(0, this.state.chips + Math.round(amount))
    this.commit()
  }

  setTurn(side: Side): void {
    if (this.state.turn === side) return
    this.state.turn = side
    this.commit()
  }

  nextTurn(): void {
    this.state.turn = this.state.turn === 'player' ? 'opponent' : 'player'
    this.state.round += 1
    this.commit()
  }

  setActiveGame(id: string | null): void {
    this.state.activeGame = id
    this.commit()
  }

  setInventory(items: InventoryItem[]): void {
    this.state.inventory = items.map((item) => ({ ...item }))
    this.commit()
  }

  useItem(id: string): void {
    const item = this.state.inventory.find((entry) => entry.id === id)
    if (!item || item.qty <= 0) return
    item.qty -= 1
    this.state.inventory = this.state.inventory.filter((entry) => entry.qty > 0)
    this.commit()
  }

  reset(): void {
    this.state = createInitialState()
    this.commit()
  }

  private commit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}

function createInitialState(): BattleState {
  return {
    hp: { player: DEFAULT_HP, opponent: DEFAULT_HP },
    maxHp: { player: DEFAULT_HP, opponent: DEFAULT_HP },
    chips: 10,
    turn: 'player',
    round: 1,
    inventory: DEFAULT_INVENTORY.map((item) => ({ ...item })),
    activeGame: null,
  }
}
