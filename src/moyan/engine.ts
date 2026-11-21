import {
  ITEM_NAMES,
  N,
  ORGAN_NAMES,
  ORGANS,
  PENALTY_ITEMS,
  sideName,
  type ItemId,
  type Organ,
  type Side,
} from './content'

export type CellType = 'none' | 'source' | 'heart' | 'organ' | 'item'

export interface Cell {
  r: number
  c: number
  type: CellType
  organ: Organ | null
  item: ItemId | null
  revealed: boolean
  cleared: boolean
  wallUntil: number
}

interface PlayerRuntime {
  organs: Record<Organ, boolean>
  items: ItemId[]
  lungLeft: number
  turnCount: number
  weaken: number
  weakenedThisTurn: boolean
}

/** 器官翻到后的坏死回合数；内部按半回合计时。 */
export const NECROSIS_ROUNDS = 6
const NECROSIS_HALVES = NECROSIS_ROUNDS * 2

export type PendingKind =
  | 'liver'
  | 'stethoscope'
  | 'transplant'
  | 'replace'
  | 'steal'

interface InternalPending {
  kind: PendingKind
  from?: Cell | null
  newItem?: ItemId
}

interface GameState {
  board: Cell[][]
  halfTurn: number
  turn: Side
  over: boolean
  winner: Side | null
  pending: InternalPending | null
  flipsRemaining: number
  hasFlipped: boolean
  locked: boolean
  ended: boolean
  turnSeq: number
  peek: Cell | null
  peekViewer: Side | null
  transplantUsedThisTurn: boolean
  aiAvoid: Set<Cell>
  aiIntel: Map<Cell, 'organ' | 'penalty' | 'good'>
  /** 肾被翻到后留给玩家的修复机会；AI 的会在翻到时立即用掉。 */
  repair: Cell | null
  /** 这次修复机会归谁：翻牌的一方，不一定是肾的主人。 */
  repairSide: Side | null
  players: Record<Side, PlayerRuntime>
  log: LogLine[]
}

export interface LogLine {
  readonly text: string
  readonly kind: 'good' | 'bad' | null
}

export interface Coord {
  readonly r: number
  readonly c: number
}

export interface PendingView {
  readonly kind: PendingKind
  readonly newItem?: ItemId
  readonly from: Coord | null
}

export interface PlayerView {
  readonly organs: Readonly<Record<Organ, boolean>>
  /** 各器官坏死墙的剩余回合数；0 表示没有生效中的墙。 */
  readonly walls: Readonly<Record<Organ, number>>
  readonly items: readonly ItemId[]
  readonly lungLeft: number
  readonly weakenedThisTurn: boolean
  readonly itemCap: number
  readonly turnCount: number
}

export interface RepairTargetView {
  readonly organ: Organ
  readonly r: number
  readonly c: number
  readonly ring: number
}

export interface Snapshot {
  readonly gameId: number
  readonly board: readonly (readonly Cell[])[]
  readonly turn: Side
  readonly over: boolean
  readonly winner: Side | null
  readonly halfTurn: number
  readonly flipsRemaining: number
  readonly locked: boolean
  readonly pending: PendingView | null
  readonly peek: Coord | null
  readonly peekViewer: Side | null
  readonly players: Readonly<Record<Side, PlayerView>>
  readonly log: readonly LogLine[]
  readonly legal: readonly Coord[]
  readonly targets: readonly Coord[]
  readonly picked: Coord | null
  readonly canUseItems: boolean
  readonly canPickItem: boolean
  readonly transplantUsedThisTurn: boolean
  readonly repair: readonly RepairTargetView[] | null
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function rand(n: number): number {
  return Math.floor(Math.random() * n)
}

function shuffle<T>(input: readonly T[]): T[] {
  const out = [...input]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rand(i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function cheb(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c))
}

function manh(a: Cell, b: Cell): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c)
}

function makePlayer(): PlayerRuntime {
  return {
    organs: { lung: true, liver: true, kidney: true, stomach: true },
    items: [],
    lungLeft: 2,
    turnCount: 0,
    weaken: 0,
    weakenedThisTurn: false,
  }
}

export class MoyanEngine {
  private s!: GameState
  private generation = 0
  private readonly listeners = new Set<(snapshot: Snapshot) => void>()
  private replaceResolve: ((index: number | null) => void) | null = null
  private stealResolve: ((index: number | null) => void) | null = null
  private idleProbe: (() => number) | null = null

  constructor() {
    this.newGame('player')
  }

  setIdleProbe(probe: (() => number) | null): void {
    this.idleProbe = probe
  }

  subscribe(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): Snapshot {
    const s = this.s
    const pending = s.pending
    const targets = this.pendingTargets()
    const repairCells = s.repair ? this.kidneyRepairTargets() : []
    return {
      gameId: this.generation,
      board: s.board.map((row) => row.map((cell) => ({ ...cell }))),
      turn: s.turn,
      over: s.over,
      winner: s.winner,
      halfTurn: s.halfTurn,
      flipsRemaining: s.flipsRemaining,
      locked: s.locked,
      pending: pending
        ? {
            kind: pending.kind,
            newItem: pending.newItem,
            from: pending.from ? { r: pending.from.r, c: pending.from.c } : null,
          }
        : null,
      peek: s.peek ? { r: s.peek.r, c: s.peek.c } : null,
      peekViewer: s.peekViewer,
      players: {
        player: this.viewOf('player'),
        ai: this.viewOf('ai'),
      },
      log: [...s.log],
      legal: this.legalHighlight(),
      targets: targets.map((cell) => ({ r: cell.r, c: cell.c })),
      picked: pending?.from ? { r: pending.from.r, c: pending.from.c } : null,
      canUseItems: this.canUseItems(),
      canPickItem: this.canPickItem(),
      transplantUsedThisTurn: s.transplantUsedThisTurn,
      repair: repairCells.length
        ? repairCells.map((cell) => ({
            organ: cell.organ as Organ,
            r: cell.r,
            c: cell.c,
            ring: this.repairRingTargets(cell).length,
          }))
        : null,
    }
  }

  restart(): void {
    const starter = this.s.winner ?? 'player'
    this.newGame(starter)
  }

  startItem(item: ItemId): void {
    if (!this.canPickItem()) {
      this.publish()
      return
    }
    const pending = this.s.pending
    if (pending && pending.kind === item) {
      this.s.pending = null
      this.publish()
      return
    }
    this.s.pending = null
    const player = this.s.players.player
    if (!player.items.includes(item)) return
    if (item === 'steal') {
      if (this.s.players.ai.items.length === 0) {
        this.log('对方背包是空的。')
        this.publish()
        return
      }
      void this.doSteal()
      return
    }
    if (item === 'transplant') {
      if (this.s.transplantUsedThisTurn) {
        this.log('本回合已经使用过注射器。')
        this.publish()
        return
      }
      if (this.transplantSources('player').length === 0 || this.transplantDestinations('player').length === 0) {
        this.log('当前没有可注射的目标。')
        this.publish()
        return
      }
      this.s.pending = { kind: 'transplant', from: null }
      this.publish()
      return
    }
    const valid = this.allCells().filter((cell) => !cell.revealed)
    if (valid.length === 0) {
      this.publish()
      return
    }
    this.s.pending = { kind: 'stethoscope' }
    this.publish()
  }

  cancelPending(): void {
    const pending = this.s.pending
    if (!pending || pending.kind === 'liver' || pending.kind === 'replace' || pending.kind === 'steal') return
    this.s.pending = null
    this.publish()
  }

  cellClicked(r: number, c: number): void {
    const s = this.s
    if (s.over || s.turn !== 'player') return
    const cell = this.cellAt(r, c)
    if (!cell) return
    if (s.pending) {
      const targets = this.pendingTargets()
      if (!targets.includes(cell)) {
        if (s.pending.kind === 'liver') return
        this.s.pending = null
        this.publish()
        return
      }
      if (s.pending.kind === 'transplant' && !s.pending.from) {
        s.pending.from = cell
        this.publish()
        return
      }
      void this.handlePending(cell)
      return
    }
    if (s.locked) return
    if (!this.legalCells('player').includes(cell)) return
    void this.playerFlip(cell)
  }

  lung(): void {
    const s = this.s
    const player = s.players.player
    if (!this.canUseItems() || s.pending) return
    if (!player.organs.lung || player.lungLeft <= 0) return
    player.lungLeft -= 1
    this.log('你屏息，跳过本回合翻牌。')
    this.publish()
    this.endTurn()
  }

  /** 肾的修复机会：修好目标器官的坏死墙，并把周围一圈普通毒格变回未翻牌。 */
  repairKidney(r: number, c: number): void {
    const s = this.s
    if (s.over || !s.repair) return
    const cell = this.cellAt(r, c)
    if (!cell || !this.kidneyRepairTargets().includes(cell)) return
    s.repair = null
    s.repairSide = null
    this.applyKidneyRepair('player', cell)
  }

  skipKidneyRepair(): void {
    const s = this.s
    if (s.over || !s.repair) return
    s.repair = null
    s.repairSide = null
    this.log('你放弃了肾的修复机会。')
    this.publish()
  }

  resolveReplace(index: number | null): void {
    const resolve = this.replaceResolve
    this.replaceResolve = null
    this.s.pending = null
    resolve?.(index)
    this.publish()
  }

  resolveSteal(index: number | null): void {
    const resolve = this.stealResolve
    this.stealResolve = null
    this.s.pending = null
    resolve?.(index)
    this.publish()
  }

  // ---------- 初始化与回合 ----------

  private newGame(starter: Side): void {
    this.generation += 1
    this.replaceResolve?.(null)
    this.stealResolve?.(null)
    this.replaceResolve = null
    this.stealResolve = null
    const board: Cell[][] = []
    for (let r = 0; r < N; r += 1) {
      const row: Cell[] = []
      for (let c = 0; c < N; c += 1) {
        row.push({
          r,
          c,
          type: 'none',
          organ: null,
          item: null,
          revealed: false,
          cleared: false,
          wallUntil: 0,
        })
      }
      board.push(row)
    }
    this.s = {
      board,
      halfTurn: 0,
      turn: starter,
      over: false,
      winner: null,
      pending: null,
      flipsRemaining: 1,
      hasFlipped: false,
      locked: false,
      ended: false,
      turnSeq: 0,
      peek: null,
      peekViewer: null,
      transplantUsedThisTurn: false,
      aiAvoid: new Set(),
      aiIntel: new Map(),
      repair: null,
      repairSide: null,
      players: { player: makePlayer(), ai: makePlayer() },
      log: [],
    }
    this.setupBoard()
    this.log('毒液从中心渗开。')
    this.publish()
    this.startTurn(0)
  }

  private setupBoard(): void {
    const source = this.cellAt(3, 3)
    if (source) {
      source.type = 'source'
      source.revealed = true
    }
    const playerHeart = this.cellAt(6, 3)
    if (playerHeart) playerHeart.type = 'heart'
    const aiHeart = this.cellAt(0, 3)
    if (aiHeart) aiHeart.type = 'heart'
    this.placeSideOrgans([4, 5, 6])
    this.placeSideOrgans([0, 1, 2])
    this.placeItems()
  }

  private placeSideOrgans(rows: readonly number[]): void {
    const types = shuffle(ORGANS)
    const placed: Cell[] = []
    const pool = (): Cell[] => {
      const out: Cell[] = []
      for (const r of rows) {
        for (let c = 0; c < N; c += 1) {
          const cell = this.cellAt(r, c)
          if (cell && cell.type === 'none') out.push(cell)
        }
      }
      return out
    }
    for (const organ of types) {
      let cand = pool().filter((cell) => placed.every((p) => cheb(p, cell) >= 2))
      if (cand.length === 0) cand = pool()
      const pick = cand[rand(cand.length)]
      if (!pick) continue
      pick.type = 'organ'
      pick.organ = organ
      placed.push(pick)
    }
  }

  private placeItems(): void {
    const free = this.allCells().filter((cell) => cell.type === 'none' && !cell.revealed)
    const shuffled = shuffle(free)
    const count = 18
    const steth = 4 + rand(3)
    const types: ItemId[] = []
    for (let i = 0; i < steth; i += 1) types.push('stethoscope')
    const others: ItemId[] = ['transplant', 'steal', 'adrenaline', 'fever']
    while (types.length < count) types.push(others[rand(others.length)])
    const bag = shuffle(types)
    shuffled.slice(0, count).forEach((cell, index) => {
      cell.type = 'item'
      cell.item = bag[index] ?? 'stethoscope'
    })
  }

  private startTurn(seq?: number): void {
    const s = this.s
    if (s.over) return
    if (seq !== undefined && seq !== s.turnSeq) return
    s.ended = false
    s.locked = false
    const side = s.turn
    const player = s.players[side]
    player.turnCount += 1
    if (player.weaken > 0) {
      player.weaken -= 1
      player.weakenedThisTurn = true
      this.log(`${sideName(side)}处于虚弱，本回合不能用道具`)
    } else {
      player.weakenedThisTurn = false
    }
    if (s.repair && this.kidneyRepairTargets().length === 0) {
      s.repair = null
      s.repairSide = null
      this.log('肾的修复机会失效：已经没有仍在坏死的器官。')
    }
    s.flipsRemaining = 1
    s.hasFlipped = false
    s.transplantUsedThisTurn = false
    s.aiAvoid = new Set()
    if (player.organs.liver && player.turnCount % 3 === 0) {
      if (side === 'player') {
        const targets = this.liverTargets('player')
        if (targets.length > 0) {
          s.pending = { kind: 'liver' }
          this.publish()
          this.log('肝触发：点击自己半场的一格毒，把它变回未翻牌。', 'good')
          return
        }
        this.log('肝触发，但没有可安全清理的毒。')
      } else {
        const target = this.aiPickLiver()
        if (target) this.applyLiverReset('ai', target)
        else this.log('AI 的肝触发，但没有可安全清理的毒。')
      }
    }
    this.finishStartTurn(side)
  }

  private finishStartTurn(side: Side): void {
    const s = this.s
    if (s.over) return
    s.flipsRemaining = 1
    s.hasFlipped = false
    s.locked = false
    s.pending = null
    s.transplantUsedThisTurn = false
    s.aiAvoid = new Set()
    this.publish()
    if (this.legalCells(side).length === 0) {
      this.log(`${sideName(side)}无牌可翻，闷死。`, 'bad')
      this.endGame(side === 'player' ? 'lose' : 'win')
      return
    }
    if (side === 'ai') void this.aiTurn()
  }

  private endTurn(): void {
    const s = this.s
    if (s.over || s.ended) return
    s.ended = true
    s.locked = true
    s.halfTurn += 1
    s.turn = s.turn === 'player' ? 'ai' : 'player'
    s.pending = null
    s.turnSeq += 1
    const seq = s.turnSeq
    this.publish()
    const gen = this.generation
    void this.sleep(320).then(() => {
      if (gen !== this.generation) return
      this.startTurn(seq)
    })
  }

  private endGame(result: 'win' | 'lose'): void {
    const s = this.s
    if (s.over) return
    s.over = true
    s.winner = result === 'win' ? 'player' : 'ai'
    this.publish()
  }

  // ---------- 翻牌与结算 ----------

  private async playerFlip(cell: Cell): Promise<void> {
    const s = this.s
    if (s.over || s.locked) return
    s.locked = true
    s.hasFlipped = true
    s.pending = null
    this.log(`你翻开了第 ${cell.r + 1} 行第 ${cell.c + 1} 列。`)
    this.publish()
    await this.revealCell(cell, 'player')
    if (s.over) return
    s.flipsRemaining -= 1
    if (s.flipsRemaining > 0) {
      s.locked = false
      this.publish()
    } else {
      this.endTurn()
    }
  }

  private async revealCell(cell: Cell, by: Side): Promise<void> {
    const s = this.s
    cell.revealed = true
    cell.cleared = false
    if (cell.type === 'heart') {
      const owner = this.ownerOf(cell)
      if (owner === 'player') {
        this.log('你的心脏被毒液覆盖。', 'bad')
        this.endGame('lose')
      } else {
        this.log('AI 的心脏被毒液覆盖。', 'good')
        this.endGame('win')
      }
      this.publish()
      return
    }
    if (cell.type === 'organ' && cell.organ) {
      const organ = cell.organ
      const owner = this.ownerOf(cell) === 'ai' ? 'ai' : 'player'
      const runtime = s.players[owner]
      runtime.organs[organ] = false
      this.log(
        by === owner
          ? `${sideName(by)}翻开了自己的${ORGAN_NAMES[organ]}：器官坏死 ${NECROSIS_ROUNDS} 回合。`
          : `${sideName(by)}翻到${sideName(owner)}的${ORGAN_NAMES[organ]}：器官坏死 ${NECROSIS_ROUNDS} 回合。`,
        owner === 'player' ? 'bad' : 'good',
      )
      if (organ === 'stomach') {
        const lost = this.dropStomachItems(runtime)
        if (lost.length > 0) {
          this.log(
            `${sideName(owner)}的胃被毁，随机失去「${lost.map((item) => ITEM_NAMES[item]).join('」「')}」。`,
            owner === 'player' ? 'bad' : 'good',
          )
        }
      }
      cell.wallUntil = s.halfTurn + NECROSIS_HALVES
      if (organ === 'kidney') this.grantKidneyRepair(owner, cell, by)
      this.publish()
      return
    }
    if (cell.type === 'item' && cell.item) {
      const item = cell.item
      if (PENALTY_ITEMS.includes(item)) this.log(`${sideName(by)}翻到惩罚「${ITEM_NAMES[item]}」。`, 'bad')
      else this.log(`${sideName(by)}获得「${ITEM_NAMES[item]}」。`, 'good')
      await this.giveItem(by, item)
      this.publish()
    }
  }

  private async giveItem(side: Side, type: ItemId): Promise<void> {
    if (PENALTY_ITEMS.includes(type)) {
      this.applyPenalty(side, type)
      return
    }
    const runtime = this.s.players[side]
    const cap = this.itemCap(runtime)
    if (runtime.items.length < cap) {
      runtime.items.push(type)
      return
    }
    if (side === 'ai') {
      this.log(`AI 背包已满，丢弃「${ITEM_NAMES[type]}」。`)
      return
    }
    const choice = await this.askReplace(type)
    if (choice === null) {
      this.log(`你放弃了「${ITEM_NAMES[type]}」。`)
    } else {
      const out = runtime.items[choice]
      if (out) {
        runtime.items.splice(choice, 1, type)
        this.log(`你替换掉「${ITEM_NAMES[out]}」，获得「${ITEM_NAMES[type]}」。`)
      }
    }
    this.publish()
  }

  private applyPenalty(side: Side, type: ItemId): void {
    const runtime = this.s.players[side]
    if (type === 'fever') {
      runtime.weaken = 2
      runtime.weakenedThisTurn = true
      this.log(`${sideName(side)}陷入虚弱：本回合及接下来 2 个自己的回合不能用道具。`, 'bad')
    } else if (type === 'adrenaline') {
      this.s.flipsRemaining += 1
      this.log(`${sideName(side)}的肾上腺素发作，必须额外翻 1 张。`, 'bad')
    }
    this.publish()
  }

  // ---------- 器官与棋盘规则 ----------

  private nearestVenomDist(side: Side): number {
    const heart = side === 'player' ? this.cellAt(6, 3) : this.cellAt(0, 3)
    const rows = side === 'player' ? [3, 4, 5, 6] : [0, 1, 2, 3]
    let best = Infinity
    if (!heart) return best
    for (const r of rows) {
      for (let c = 0; c < N; c += 1) {
        const cell = this.cellAt(r, c)
        if (!cell || !this.isVenom(cell)) continue
        best = Math.min(best, manh(cell, heart))
      }
    }
    return best
  }

  private heartCellOf(side: Side): Cell | null {
    return side === 'player' ? this.cellAt(6, 3) : this.cellAt(0, 3)
  }

   private resetCell(cell: Cell): void {
    cell.revealed = false
    cell.cleared = false
    cell.type = 'none'
    cell.organ = null
    cell.item = null
    cell.wallUntil = 0
    this.s.aiIntel.delete(cell)
    this.s.aiAvoid.delete(cell)
  }

  private wouldStrandOnReset(side: Side, cell: Cell): boolean {
    const snap = [cell.revealed, cell.cleared, cell.type, cell.organ, cell.item, cell.wallUntil] as const
    cell.revealed = false
    cell.cleared = false
    cell.type = 'none'
    cell.organ = null
    cell.item = null
    cell.wallUntil = 0
    const count = this.legalCells(side).length
    cell.revealed = snap[0]
    cell.cleared = snap[1]
    cell.type = snap[2]
    cell.organ = snap[3]
    cell.item = snap[4]
    cell.wallUntil = snap[5]
    return count === 0
  }

  private legalAfterClear(side: Side, cell: Cell): number {
    const wasCleared = cell.cleared
    const wasWall = cell.wallUntil
    cell.cleared = true
    cell.wallUntil = 0
    const count = this.legalCells(side).length
    cell.cleared = wasCleared
    cell.wallUntil = wasWall
    return count
  }

  private liverTargets(side: Side): Cell[] {
    const rows = side === 'player' ? [4, 5, 6] : [0, 1, 2]
    const out: Cell[] = []
    for (const r of rows) {
      for (let c = 0; c < N; c += 1) {
        const cell = this.cellAt(r, c)
        if (!cell || !this.isConductive(cell) || cell.type === 'heart') continue
        if (this.wouldStrandOnReset(side, cell)) continue
        out.push(cell)
      }
    }
    return out
  }

  private aiPickLiver(): Cell | null {
    const heart = this.heartCellOf('ai')
    if (!heart) return null
    let best: Cell | null = null
    let bestD = Infinity
    for (const cell of this.liverTargets('ai')) {
      const d = manh(cell, heart)
      if (d < bestD) {
        bestD = d
        best = cell
      }
    }
    return best
  }

  private applyLiverReset(side: Side, cell: Cell): void {
    this.resetCell(cell)
    this.log(
      `${sideName(side)}的肝把第 ${cell.r + 1} 行第 ${cell.c + 1} 列的毒变回了未翻牌。`,
      side === 'player' ? 'good' : null,
    )
    this.publish()
  }

  // ---------- 肾：坏死修复 ----------

  /** 翻牌方自己仍在坏死的器官（可以包括自己的肾），刚被翻开的这张肾除外。 */
  private kidneyRepairTargets(): Cell[] {
    const chance = this.s.repair
    const side = this.s.repairSide
    if (!chance || !side) return []
    return this.allCells().filter(
      (cell) =>
        cell !== chance &&
        cell.type === 'organ' &&
        cell.organ !== null &&
        this.ownerOf(cell) === side &&
        this.isWall(cell),
    )
  }

  /** 坏死墙周围一圈普通毒格（不含毒源、心脏、道具、器官和其它墙）。 */
  private repairRingTargets(cell: Cell): Cell[] {
    const out: Cell[] = []
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const neighbor = this.cellAt(cell.r + dr, cell.c + dc)
        if (!neighbor) continue
        if (neighbor.type !== 'none' || !neighbor.revealed || neighbor.cleared) continue
        if (this.isWall(neighbor)) continue
        out.push(neighbor)
      }
    }
    return out
  }

  private grantKidneyRepair(owner: Side, kidneyCell: Cell, by: Side): void {
    const targets = this.allCells().filter(
      (cell) =>
        cell !== kidneyCell &&
        cell.type === 'organ' &&
        cell.organ !== null &&
        this.ownerOf(cell) === by &&
        this.isWall(cell),
    )
    if (targets.length === 0) {
      this.log(
        `${sideName(by)}翻到了${by === owner ? '自己的' : `${sideName(owner)}的`}肾，但${sideName(by)}没有可修复的坏死器官，修复机会失效。`,
        by === 'player' ? 'bad' : 'good',
      )
      return
    }
    if (by === 'ai') {
      const pick = this.aiPickRepair(targets)
      if (pick) this.applyKidneyRepair('ai', pick)
      else this.log('AI 的肾没有找到不会让自己无牌可翻的修复目标。')
      return
    }
    this.s.repair = kidneyCell
    this.s.repairSide = 'player'
    this.log(
      by === owner
        ? '肾被翻到：点击左侧发光的器官，修好它的坏死墙并清掉周围一圈毒；也可以放弃。'
        : '你翻到了对方的肾：获得一次修复机会，可点左侧发光的器官修复自己坏死的器官（包括自己的肾）。',
      'good',
    )
  }

  private applyKidneyRepair(owner: Side, cell: Cell): void {
    const organ = cell.organ
    if (!organ) return
    const ring = this.repairRingTargets(cell)
    cell.wallUntil = 0
    for (const neighbor of ring) this.resetCell(neighbor)
    this.s.players[owner].organs[organ] = true
    this.log(
      organ === 'kidney'
        ? `${sideName(owner)}的肾修复了自己：坏死墙消失，周围 ${ring.length} 格毒变回未翻牌。`
        : `${sideName(owner)}的肾修复了${ORGAN_NAMES[organ]}：坏死墙消失，周围 ${ring.length} 格毒变回未翻牌，${ORGAN_NAMES[organ]}的功能恢复。`,
      owner === 'player' ? 'good' : 'bad',
    )
    this.publish()
  }

  private simulateKidneyRepair(owner: Side, cell: Cell): number {
    const ring = this.repairRingTargets(cell)
    const wall = cell.wallUntil
    const snaps = ring.map(
      (n) => [n.revealed, n.cleared, n.type, n.organ, n.item, n.wallUntil] as const,
    )
    cell.wallUntil = 0
    for (const n of ring) {
      n.revealed = false
      n.cleared = false
      n.type = 'none'
      n.organ = null
      n.item = null
      n.wallUntil = 0
    }
    const count = this.legalCells(owner).length
    cell.wallUntil = wall
    ring.forEach((n, index) => {
      const snap = snaps[index]
      if (!snap) return
      n.revealed = snap[0]
      n.cleared = snap[1]
      n.type = snap[2]
      n.organ = snap[3]
      n.item = snap[4]
      n.wallUntil = snap[5]
    })
    return count
  }

  private aiPickRepair(targets: readonly Cell[]): Cell | null {
    const heart = this.heartCellOf('ai')
    let best: Cell | null = null
    let bestScore = -Infinity
    for (const cell of targets) {
      const remain = this.simulateKidneyRepair('ai', cell)
      if (remain === 0) continue
      const ring = this.repairRingTargets(cell).length
      const near = heart ? -manh(cell, heart) : 0
      const score = ring * 100 + remain * 10 + near
      if (score > bestScore) {
        bestScore = score
        best = cell
      }
    }
    return best
  }

  // ---------- 道具目标 ----------

  private transplantSources(side: Side): Cell[] {
    const ownRows = side === 'player' ? [3, 4, 5, 6] : [0, 1, 2, 3]
    const out: Cell[] = []
    for (const r of ownRows) {
      for (let c = 0; c < N; c += 1) {
        const cell = this.cellAt(r, c)
        if (cell && this.isVenom(cell) && !this.isWall(cell)) out.push(cell)
      }
    }
    if (side === 'player') {
      const hasHeart = this.transplantDestinations(side).some((d) => d.type === 'heart')
      return out.filter((from) => hasHeart || this.legalAfterClear(side, from) > 0)
    }
    return out
  }

  private transplantDestinations(side: Side): Cell[] {
    const enemyRows = side === 'player' ? [0, 1, 2] : [4, 5, 6]
    const out: Cell[] = []
    for (const r of enemyRows) {
      for (let c = 0; c < N; c += 1) {
        const dest = this.cellAt(r, c)
        if (!dest || dest.revealed) continue
        let anchored = false
        for (const [dr, dc] of DIRS) {
          const neighbor = this.cellAt(r + dr, c + dc)
          if (neighbor && this.isConductive(neighbor)) {
            anchored = true
            break
          }
        }
        if (anchored) out.push(dest)
      }
    }
    return out
  }

  private aiPickTransplant(): { from: Cell; to: Cell } | null {
    const dests = this.transplantDestinations('ai')
    const sources = this.transplantSources('ai')
    const options: Array<{ from: Cell; to: Cell }> = []
    for (const from of sources) for (const to of dests) options.push({ from, to })
    if (options.length === 0) return null
    const targetHeart = this.cellAt(6, 3)
    const ownHeart = this.cellAt(0, 3)
    if (!targetHeart || !ownHeart) return null
    let best: { from: Cell; to: Cell } | null = null
    let bestScore = -Infinity
    for (const option of options) {
      const isHeart = option.to.type === 'heart'
      const d = manh(option.to, targetHeart)
      if (!isHeart) {
        const was = option.from.cleared
        const wasWall = option.from.wallUntil
        option.from.cleared = true
        option.from.wallUntil = 0
        const remain = this.legalCells('ai').length
        option.from.cleared = was
        option.from.wallUntil = wasWall
        if (remain === 0) continue
      }
      const score = isHeart ? 1e9 : -d * 1000 + this.legalCells('ai').length * 10 + manh(option.from, ownHeart)
      if (score > bestScore) {
        bestScore = score
        best = option
      }
    }
    return best
  }

  private async doTransplant(side: Side, from: Cell, to: Cell): Promise<void> {
    from.cleared = true
    from.wallUntil = 0
    if (to.type === 'heart' || (to.type === 'organ' && to.organ)) {
      await this.revealCell(to, side)
      this.publish()
      return
    }
    // 非器官一律变成毒格，牌面效果作废
    to.revealed = true
    to.cleared = false
    to.type = 'none'
    to.organ = null
    to.item = null
    to.wallUntil = 0
    this.publish()
  }

  // ---------- 听诊器 ----------

  private async peekCell(cell: Cell, ms: number, viewer: Side): Promise<void> {
    this.s.peek = cell
    this.s.peekViewer = viewer
    this.publish()
    await this.sleep(ms)
    if (this.s.peek === cell) {
      this.s.peek = null
      this.s.peekViewer = null
      this.publish()
    }
  }

   // ---------- 玩家操作 ----------

  private async handlePending(cell: Cell): Promise<void> {
    const s = this.s
    if (s.locked || !s.pending) return
    const pending = s.pending
    s.locked = true
    s.pending = null
    if (pending.kind === 'liver') {
      this.applyLiverReset('player', cell)
      this.finishStartTurn('player')
      return
    }
    if (pending.kind === 'stethoscope') {
      this.consumeItem('player', 'stethoscope')
      this.log(`你使用听诊器查看了第 ${cell.r + 1} 行第 ${cell.c + 1} 列。`)
      this.publish()
      await this.peekCell(cell, 3000, 'player')
      s.locked = false
      this.publish()
      return
    } else if (pending.kind === 'transplant') {
      const from = pending.from
      if (!from || !this.transplantDestinations('player').includes(cell)) {
        s.locked = false
        this.publish()
        return
      }
      if (this.legalAfterClear('player', from) === 0 && cell.type !== 'heart') {
        s.locked = false
        this.publish()
        return
      }
      this.consumeItem('player', 'transplant')
      s.transplantUsedThisTurn = true
      this.log(
        cell.type === 'heart'
          ? '你使用注射器，直取 AI 的心脏！'
          : `你使用注射器，把一格毒注射到了对方第 ${cell.r + 1} 行第 ${cell.c + 1} 列。`,
        'good',
      )
      await this.doTransplant('player', from, cell)
    }
    s.locked = false
    this.publish()
  }

  private async doSteal(): Promise<void> {
    const index = await this.askSteal()
    if (index === null) return
    const ai = this.s.players.ai
    const item = ai.items[index]
    if (!item) return
    const player = this.s.players.player
    this.consumeItem('player', 'steal')
    ai.items.splice(index, 1)
    const cap = this.itemCap(player)
    if (player.items.length < cap) player.items.push(item)
    this.log(`你用手术钳夹走了 AI 的「${ITEM_NAMES[item]}」。`, 'good')
    this.publish()
  }

  // ---------- AI ----------

  private async aiTurn(): Promise<void> {
    const gen = this.generation
    if (!(await this.waitSceneSettled(gen))) return
    const s = this.s
    if (s.over || s.turn !== 'ai') return
    const ai = s.players.ai
    if (!ai.weakenedThisTurn) {
      let guard = 0
      while (!s.over && s.turn === 'ai' && guard < 10) {
        guard += 1
        const used = await this.aiItems(gen)
        if (!used) break
      }
    }
    if (gen !== this.generation) return
    if (s.over || s.turn !== 'ai') return
    if (ai.organs.lung && ai.lungLeft > 0 && this.nearestVenomDist('ai') <= 2) {
      ai.lungLeft -= 1
      this.log('AI 屏息，跳过本回合翻牌。')
      this.publish()
      await this.sleep(380)
      if (gen !== this.generation) return
      this.endTurn()
      return
    }
    while (s.flipsRemaining > 0 && !s.over) {
      if (!(await this.waitSceneSettled(gen))) return
      if (s.over || s.turn !== 'ai') return
      const cell = this.chooseAiCell()
      if (!cell) {
        this.log('AI 无牌可翻，闷死。', 'good')
        this.endGame('win')
        return
      }
      this.log(`AI 翻开了第 ${cell.r + 1} 行第 ${cell.c + 1} 列。`)
      s.aiIntel.delete(cell)
      await this.revealCell(cell, 'ai')
      if (s.over) return
      s.flipsRemaining -= 1
      this.publish()
    }
    if (!s.over) this.endTurn()
  }

  private simulateRemaining(cell: Cell): number {
    const wasRevealed = cell.revealed
    cell.revealed = true
    const count = this.legalCells('ai').length
    cell.revealed = wasRevealed
    return count
  }

  private chooseAiCell(): Cell | null {
    const s = this.s
    const all = this.legalCells('ai')
    if (all.length === 0) return null
    let pool = all.filter((cell) => !s.aiAvoid.has(cell))
    if (pool.length === 0) pool = all
    const heart = this.cellAt(0, 3)
    if (!heart) return pool[0] ?? null
    let best: Cell | null = null
    let bestScore = -Infinity
    for (const cell of pool) {
      if (cell.type === 'heart') continue
      const d = manh(cell, heart)
      const remain = this.simulateRemaining(cell)
      const score = d * 100 + remain
      if (score > bestScore) {
        bestScore = score
        best = cell
      }
    }
    if (!best) return pool.find((cell) => cell.type === 'heart') ?? pool[0] ?? null
    return best
  }

  private async aiItems(gen: number): Promise<boolean> {
    const s = this.s
    const ai = s.players.ai
    const player = s.players.player
    if (ai.items.includes('transplant') && !s.transplantUsedThisTurn) {
      const best = this.aiPickTransplant()
      if (best && best.to.type === 'heart') {
        this.consumeItem('ai', 'transplant')
        s.transplantUsedThisTurn = true
        this.log('AI 使用注射器，直取你的心脏！', 'bad')
        await this.doTransplant('ai', best.from, best.to)
        this.publish()
        await this.sleep(400)
        return gen === this.generation
      }
    }
    if (ai.items.includes('transplant') && !s.transplantUsedThisTurn) {
      const best = this.aiPickTransplant()
      if (best) {
        this.consumeItem('ai', 'transplant')
        s.transplantUsedThisTurn = true
        this.log(
          best.to.type === 'heart' ? 'AI 使用注射器，直取你的心脏！' : 'AI 使用注射器，把一格毒注射到了你这一侧。',
          best.to.type === 'heart' ? 'bad' : null,
        )
        await this.doTransplant('ai', best.from, best.to)
        this.publish()
        await this.sleep(400)
        return gen === this.generation
      }
    }
    if (ai.items.includes('stethoscope')) {
      const target = this.chooseAiCell()
      if (target && !s.aiIntel.has(target)) {
        this.consumeItem('ai', 'stethoscope')
        this.log(`AI 使用听诊器查看了第 ${target.r + 1} 行第 ${target.c + 1} 列。`)
        await this.peekCell(target, 1300, 'ai')
        const kind: 'organ' | 'penalty' | 'good' =
          target.type === 'organ' ? 'organ' : target.item && PENALTY_ITEMS.includes(target.item) ? 'penalty' : 'good'
        s.aiIntel.set(target, kind)
        if (kind !== 'good') {
          s.aiAvoid.add(target)
          this.log('AI 决定绕开那张牌。')
        }
        this.publish()
        await this.sleep(380)
        return gen === this.generation
      }
    }
    if (ai.items.includes('steal') && player.items.length > 0) {
      this.consumeItem('ai', 'steal')
      const stolen = player.items.splice(rand(player.items.length), 1)[0]
      if (stolen) {
        const cap = this.itemCap(ai)
        if (ai.items.length < cap) ai.items.push(stolen)
        this.log(`AI 用手术钳夹走了你的「${ITEM_NAMES[stolen]}」。`, 'bad')
      }
      this.publish()
      await this.sleep(380)
      return gen === this.generation
    }
    return false
  }

  // ---------- 查询 ----------

  private pendingTargets(): Cell[] {
    const pending = this.s.pending
    if (!pending) return []
    switch (pending.kind) {
      case 'liver':
        return this.liverTargets('player')
      case 'stethoscope':
        return this.allCells().filter((cell) => !cell.revealed)
      case 'transplant': {
        if (!pending.from) return this.transplantSources('player')
        const from = pending.from
        const dests = this.transplantDestinations('player')
        return this.legalAfterClear('player', from) > 0 ? dests : dests.filter((dest) => dest.type === 'heart')
      }
      default:
        return []
    }
  }

  private legalHighlight(): Coord[] {
    const s = this.s
    if (s.over || s.turn !== 'player' || s.locked || s.pending) return []
    return this.legalCells('player').map((cell) => ({ r: cell.r, c: cell.c }))
  }

  private canUseItems(): boolean {
    const s = this.s
    return !s.over && s.turn === 'player' && !s.locked && !s.hasFlipped && !s.players.player.weakenedThisTurn
  }

  private canPickItem(): boolean {
    return this.canUseItems() && !(this.s.pending && this.s.pending.kind === 'liver')
  }

  private viewOf(side: Side): PlayerView {
    const runtime = this.s.players[side]
    const walls: Record<Organ, number> = { lung: 0, liver: 0, kidney: 0, stomach: 0 }
    for (const cell of this.allCells()) {
      if (cell.type !== 'organ' || !cell.organ) continue
      if (this.ownerOf(cell) !== side || !this.isWall(cell)) continue
      walls[cell.organ] = Math.ceil((cell.wallUntil - this.s.halfTurn) / 2)
    }
    return {
      organs: { ...runtime.organs },
      walls,
      items: [...runtime.items],
      lungLeft: runtime.lungLeft,
      weakenedThisTurn: runtime.weakenedThisTurn,
      itemCap: this.itemCap(runtime),
      turnCount: runtime.turnCount,
    }
  }

  private itemCap(runtime: PlayerRuntime): number {
    return runtime.organs.stomach ? 3 : 1
  }

  private dropStomachItems(runtime: PlayerRuntime): ItemId[] {
    const lost: ItemId[] = []
    while (runtime.items.length > 1) {
      const [removed] = runtime.items.splice(rand(runtime.items.length), 1)
      if (removed) lost.push(removed)
    }
    return lost
  }

  private consumeItem(side: Side, item: ItemId): void {
    const items = this.s.players[side].items
    const index = items.indexOf(item)
    if (index >= 0) items.splice(index, 1)
  }

  private cellAt(r: number, c: number): Cell | null {
    if (r < 0 || r >= N || c < 0 || c >= N) return null
    return this.s.board[r]?.[c] ?? null
  }

  private allCells(): Cell[] {
    return this.s.board.flat()
  }

  private ownerOf(cell: Cell): Side | 'neutral' {
    if (cell.r <= 2) return 'ai'
    if (cell.r >= 4) return 'player'
    return 'neutral'
  }

  private isWall(cell: Cell): boolean {
    return cell.revealed && cell.wallUntil > this.s.halfTurn
  }

  private isVenom(cell: Cell): boolean {
    return cell.revealed && !cell.cleared
  }

  private isConductive(cell: Cell): boolean {
    return cell.revealed && !cell.cleared && !this.isWall(cell)
  }

  private hasConductiveNeighbor(cell: Cell): boolean {
    for (const [dr, dc] of DIRS) {
      const neighbor = this.cellAt(cell.r + dr, cell.c + dc)
      if (neighbor && this.isConductive(neighbor)) return true
    }
    return false
  }

  private legalCells(side: Side): Cell[] {
    const rows = side === 'player' ? [3, 4, 5, 6] : [0, 1, 2, 3]
    const out: Cell[] = []
    for (const r of rows) {
      for (let c = 0; c < N; c += 1) {
        const cell = this.cellAt(r, c)
        if (!cell || cell.revealed) continue
        if (this.hasConductiveNeighbor(cell)) out.push(cell)
      }
    }
    return out
  }

  private log(text: string, kind: 'good' | 'bad' | null = null): void {
    this.s.log.push({ text, kind })
    while (this.s.log.length > 80) this.s.log.shift()
    this.publish()
  }

  private publish(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private askReplace(newItem: ItemId): Promise<number | null> {
    return new Promise((resolve) => {
      this.replaceResolve = resolve
      this.s.pending = { kind: 'replace', newItem }
      this.publish()
    })
  }

  private askSteal(): Promise<number | null> {
    return new Promise((resolve) => {
      this.stealResolve = resolve
      this.s.pending = { kind: 'steal' }
      this.publish()
    })
  }

  private async waitSceneSettled(gen: number): Promise<boolean> {
    const probe = this.idleProbe
    if (!probe) {
      await this.sleep(400)
      return gen === this.generation
    }
    for (let i = 0; i < 200; i += 1) {
      if (gen !== this.generation) return false
      if (probe() >= 0.7) return true
      await this.sleep(50)
    }
    return gen === this.generation
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}