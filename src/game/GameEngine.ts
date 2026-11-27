export type ActorId = 'player' | 'boss'

export type Phase =
  | 'idle'
  | 'reloading'
  | 'dealing'
  | 'playerTurn'
  | 'bossTurn'
  | 'resolving'
  | 'targeting'
  | 'execution'
  | 'roundEnd'
  | 'levelClear'
  | 'supply'
  | 'bossSupply'
  | 'gameOver'
  | 'victory'

export const CARD_SUITS = ['spade', 'heart', 'diamond', 'club'] as const
export type CardSuit = (typeof CARD_SUITS)[number]

export type CardRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
export const DECK_SIZE = 11

export interface Card {
  readonly id: string
  readonly rank: CardRank
  readonly suit: CardSuit
}

export interface HandState {
  readonly cards: readonly Card[]
  /** 与 cards 等长；null 表示盖住的暗牌。仅用于展示，点数始终按真实手牌计算 */
  readonly visible: readonly (Card | null)[]
  readonly total: number
  readonly busted: boolean
}

export type Chamber = 'live' | 'blank'

export const ITEM_IDS = [
  'magnifier',
  'sedative',
  'saw',
  'handcuffs',
  'aegis',
  'hammer',
  'iou',
  'gloves',
] as const

export type ItemId = (typeof ITEM_IDS)[number]
export type LegacyAnimationId = 'hourglass' | 'magnet' | 'cutter' | 'seal'
export type ActionVisualId = ItemId | LegacyAnimationId

export const TRUMP_IDS = [
  'go24',
  'go27',
  'remove',
  'return',
  'exchange',
  'card2',
  'card3',
  'card4',
  'card5',
  'card6',
  'card7',
  'happiness',
  'destroy',
  'love',
] as const

export type TrumpId = (typeof TRUMP_IDS)[number]

export const TRUMP_WEIGHTS: Readonly<Record<TrumpId, number>> = {
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
}

export interface TrumpDefinition {
  readonly id: TrumpId
  readonly name: string
  readonly enName: string
  readonly summary: string
  readonly glyph: string
}

export const TRUMP_CATALOG: Readonly<Record<TrumpId, TrumpDefinition>> = {
  go24: { id: 'go24', name: '血注·廿四', enName: 'Go for 24', summary: '本局目标改为 24，最接近 24 者胜。', glyph: '24' },
  go27: { id: 'go27', name: '血注·廿七', enName: 'Go for 27', summary: '本局目标改为 27，最接近 27 者胜。', glyph: '27' },
  remove: { id: 'remove', name: '封牌', enName: 'Remove', summary: '把对手最后一张明牌弹回牌堆。', glyph: '−' },
  return: { id: 'return', name: '割牌', enName: 'Return', summary: '把自己最后一张明牌弹回牌堆。', glyph: '↩' },
  exchange: { id: 'exchange', name: '易牌', enName: 'Exchange', summary: '交换双方最后一张明牌，暗牌不能交换。', glyph: '⇄' },
  card2: { id: 'card2', name: '索牌·二', enName: '2 Card', summary: '直接抽出数字 2；若已不在牌堆则无事发生。', glyph: '2' },
  card3: { id: 'card3', name: '索牌·三', enName: '3 Card', summary: '直接抽出数字 3；若已不在牌堆则无事发生。', glyph: '3' },
  card4: { id: 'card4', name: '索牌·四', enName: '4 Card', summary: '直接抽出数字 4；若已不在牌堆则无事发生。', glyph: '4' },
  card5: { id: 'card5', name: '索牌·五', enName: '5 Card', summary: '直接抽出数字 5；若已不在牌堆则无事发生。', glyph: '5' },
  card6: { id: 'card6', name: '索牌·六', enName: '6 Card', summary: '直接抽出数字 6；若已不在牌堆则无事发生。', glyph: '6' },
  card7: { id: 'card7', name: '索牌·七', enName: '7 Card', summary: '直接抽出数字 7；若已不在牌堆则无事发生。', glyph: '7' },
  happiness: { id: 'happiness', name: '双喜', enName: 'Happiness', summary: '双方各抽一张王牌。', glyph: '＋' },
  destroy: { id: 'destroy', name: '销注', enName: 'Destroy', summary: '移除对手台面上的血注王牌，目标恢复 21。', glyph: '×' },
  love: { id: 'love', name: '以爱资敌', enName: 'Love Your Enemy', summary: '强迫对手抽一张：优先给最贴近目标且不爆的牌；没有这样的牌就给最小的一张，哪怕爆牌。', glyph: '♥' },
}

export function trumpAnimationItem(trump: TrumpId): LegacyAnimationId | null {
  if (trump === 'go24' || trump === 'go27') return 'hourglass'
  if (trump === 'exchange') return 'magnet'
  if (trump === 'return') return 'cutter'
  if (trump === 'remove') return 'seal'
  return null
}

export interface ItemDefinition {
  readonly id: ItemId
  readonly name: string
  readonly summary: string
  readonly glyph: string
}

export const ITEM_CATALOG: Readonly<Record<ItemId, ItemDefinition>> = {
  magnifier: {
    id: 'magnifier',
    name: '放大镜',
    summary: '窥视当前枪膛内下一发是实弹还是空弹。知道空膛时可以对自己开枪跳过本轮，但不再获得道具。',
    glyph: '◎',
  },
  sedative: {
    id: 'sedative',
    name: '镇定剂',
    summary: '立即恢复 1 点生命，不能超过本层上限。',
    glyph: '✚',
  },
  saw: {
    id: 'saw',
    name: '锯子',
    summary: '锯短枪管：下一发实弹伤害 +1。打出实弹后失效。',
    glyph: '⌁',
  },
  handcuffs: {
    id: 'handcuffs',
    name: '手铐',
    summary: '铐住对手：你下一次对他开空枪时，枪权不会转移，你继续持枪。',
    glyph: '∞',
  },
  aegis: {
    id: 'aegis',
    name: '护心镜',
    summary: '举镜照膛：退出当前这一发，退出的实弹或空膛双方都看得见，该发从本局弹仓移除。',
    glyph: '⬟',
  },
  hammer: {
    id: 'hammer',
    name: '重锤',
    summary: '逆转膛内当前这一发：实弹变空膛，空膛变实弹。',
    glyph: '⚒',
  },
  iou: {
    id: 'iou',
    name: '借据',
    summary: '开枪阶段赌命：50% 自损 2 血，50% 恢复 1 血。',
    glyph: '▤',
  },
  gloves: {
    id: 'gloves',
    name: '窃贼手套',
    summary: '点选对手一件道具，偷走并立即使用；不能偷窃贼手套，偷到的道具无法使用时放回，手套不消耗。',
    glyph: '✧',
  },
}

/** Items unlocked at the start of each level, in level order. */
export const LEVEL_UNLOCKS: readonly (readonly ItemId[])[] = [
  ['magnifier', 'sedative', 'saw'],
  ['handcuffs', 'aegis', 'iou'],
  ['hammer', 'gloves'],
]

export type BossPersonality = 'cautious' | 'gambler' | 'executioner'

export interface LevelConfig {
  readonly id: number
  readonly name: string
  readonly title: string
  /** 对手生命：逐层抬高，逼玩家必须靠牌技积累胜场 */
  readonly hp: number
  /** 玩家生命：每层重置；第一关给足容错，之后收紧 */
  readonly playerHp: number
  /** 开局发给双方的道具数 */
  readonly supply: number
  /** 弹仓打空重装时，发给双方的道具数 */
  readonly reloadSupply?: number
  readonly personality: BossPersonality
}

export const LEVELS: readonly LevelConfig[] = [
  {
    id: 1,
    name: '锈蚀看门人',
    title: '门厅 · 滴水的地下室',
    hp: 4,
    playerHp: 4,
    supply: 0,
    reloadSupply: 1,
    personality: 'cautious',
  },
  {
    id: 2,
    name: '赌命收账人',
    title: '账房 · 发霉的赌桌',
    hp: 5,
    playerHp: 4,
    supply: 1,
    reloadSupply: 2,
    personality: 'gambler',
  },
  {
    id: 3,
    name: '深渊执刑者',
    title: '刑台 · 没有出口',
    hp: 6,
    playerHp: 4,
    supply: 1,
    reloadSupply: 4,
    personality: 'executioner',
  },
]

export interface ActorView {
  readonly id: ActorId
  readonly hp: number
  readonly maxHp: number
  readonly items: readonly ItemId[]
  readonly hand: HandState
  /** 显示给玩家看的手牌：对手第 2 张为暗牌，此处用 null 占位 */
  readonly visibleHand: HandState
  readonly holeCardRevealed: boolean
  readonly standing: boolean
  readonly stayed: boolean
  /** 手铐效果生效中：下一次接枪时不能从持枪者手中接走枪权 */
  readonly gunCuffed: boolean
  readonly trumps: readonly TrumpId[]
  readonly sawBoost: number
  readonly itemsUsedThisTurn: number
}

export interface CylinderView {
  readonly remaining: number
  readonly total: number
  readonly live: number
  readonly blank: number
  readonly revealed: Chamber | null
}

export interface GameSnapshot {
  readonly phase: Phase
  readonly started: boolean
  readonly levelIndex: number
  readonly level: LevelConfig
  readonly round: number
  readonly player: ActorView
  readonly boss: ActorView
  readonly cylinder: CylinderView
  readonly turn: ActorId | null
  /** 进入 targeting 阶段时持枪的人；玩家需要选择枪口朝向 */
  readonly pendingShot: ActorId | null
  /** 本局目标值，默认 21，由血注王牌改写 */
  readonly roundTarget: number
  /** 玩家上一局是否满点获胜 */
  readonly lastPerfectWin: boolean
  /** 台面上的血注王牌；后打出的覆盖先前的 */
  readonly tableTrumps: Readonly<Record<ActorId, readonly TrumpId[]>>
  readonly unlockedItems: readonly ItemId[]
  /** supply 阶段的三选一候选；其他阶段为空数组 */
  readonly supplyOptions: readonly ItemId[]
  /** 系统在候选里替玩家抽中的那件；仅 supply 阶段，决定托盘留下哪一件 */
  readonly supplyPick: ItemId | null
  /** Boss 的补给候选；supply / bossSupply 阶段展示在它的托盘里 */
  readonly bossSupplyOptions: readonly ItemId[]
  /** Boss 本次门前挑中的道具；仅 bossSupply 阶段（镜头切过去时它已经拿定） */
  readonly bossSupplyPick: ItemId | null
  readonly inputLocked: boolean
  readonly paused: boolean
  /** 本场跨层累计回合数；round 仍是每层回合 */
  readonly runRounds: number
  readonly log: readonly string[]
}

export type GameEvent =
  | { readonly type: 'state'; readonly snapshot: GameSnapshot }
  | { readonly type: 'notice'; readonly message: string }
  | { readonly type: 'roundStart'; readonly level: number; readonly round: number }
  | { readonly type: 'cardDealt'; readonly actor: ActorId; readonly card: Card }
  | { readonly type: 'turn'; readonly actor: ActorId }
  | { readonly type: 'playerTableAction'; readonly action: 'hit' | 'stand' }
  | { readonly type: 'bossBark'; readonly action: 'hit' | 'stand'; readonly hand: boolean }
  | { readonly type: 'bust'; readonly actor: ActorId }
  | { readonly type: 'itemDrawn'; readonly actor: ActorId; readonly item: ItemId }
  | {
      readonly type: 'itemUsed'
      readonly actor: ActorId
      readonly item: ItemId
      readonly detail: string
    }
  | { readonly type: 'chamberRevealed'; readonly actor: ActorId; readonly chamber: Chamber }
  | { readonly type: 'chamberFlipped'; readonly actor: ActorId; readonly chamber: Chamber }
  | { readonly type: 'chamberDiscarded'; readonly actor: ActorId; readonly chamber: Chamber }
  | { readonly type: 'trumpPlayed'; readonly actor: ActorId; readonly trump: TrumpId; readonly detail: string }
  | { readonly type: 'perfectWin'; readonly actor: ActorId; readonly item: ItemId | null }
  | {
      readonly type: 'execution'
      readonly by: ActorId
      readonly target: ActorId
      readonly chamber: Chamber
      readonly lethal: boolean
    }
  | {
      readonly type: 'shot'
      readonly by: ActorId
      readonly target: ActorId
      readonly chamber: Chamber
      readonly damage: number
      readonly sawed: boolean
    }
  | { readonly type: 'tie'; readonly player: number; readonly boss: number }
  | { readonly type: 'reload'; readonly live: number; readonly blank: number }
  | { readonly type: 'levelClear'; readonly level: number }
  | {
      readonly type: 'lootUnlocked'
      readonly level: number
      readonly items: readonly ItemId[]
    }
  | { readonly type: 'supplyOffer'; readonly options: readonly ItemId[] }
  | { readonly type: 'supplyPick'; readonly actor: ActorId; readonly item: ItemId }
  | { readonly type: 'bossSupply'; readonly pick: ItemId }
  | {
      readonly type: 'checkpoint'
      readonly levelIndex: number
      readonly carryOver: readonly ItemId[]
      readonly runRounds: number
    }
  | { readonly type: 'gameOver'; readonly winner: ActorId }

export type GameEventListener = (event: GameEvent, snapshot: GameSnapshot) => void

export type RandomSource = () => number

export interface GameEngineOptions {
  readonly rng?: RandomSource
  readonly levels?: readonly LevelConfig[]
  readonly dealDelayMs?: number
  readonly thinkDelayMs?: number
  readonly dealLockMs?: number
  readonly itemLockMs?: number
}

interface BossProfile {
  readonly label: string
  readonly personality: BossPersonality
  readonly standAt: number
  readonly thinkingMs: number
}

const BOSS_PROFILES: Readonly<Record<BossPersonality, BossProfile>> = {
  cautious: { label: '谨慎', personality: 'cautious', standAt: 15, thinkingMs: 380 },
  gambler: { label: '赌徒', personality: 'gambler', standAt: 17, thinkingMs: 320 },
  executioner: { label: '算牌', personality: 'executioner', standAt: 19, thinkingMs: 280 },
}

export const MAX_ITEMS = 8
const LOG_LIMIT = 80
const SUPPLY_OPTION_COUNT = 3
/** 每种道具的同时持有上限：抽的时候只在没拿满的里面等概率挑 */
const ITEM_CAP: Readonly<Record<ItemId, number>> = {
  magnifier: 8,
  sedative: 4,
  saw: 8,
  handcuffs: 8,
  aegis: 8,
  hammer: 2,
  iou: 4,
  gloves: 2,
}
/** 清层横幅先播完，再摆出补给候选 */
const SUPPLY_DELAY_MS = 2600
/** 候选升上桌后停留多久，再整盘沉下去只留选中件（托盘约 2.0s 升完，留出约 1.2s） */
const SUPPLY_HOLD_MS = 3200
/** 沉盘、筛掉未选中件、选中件升回桌面的时间；玩家与 Boss 共用 */
const SUPPLY_PICK_BEAT_MS = 3000
const SUIT_SYMBOLS: Readonly<Record<CardSuit, string>> = {
  spade: '♠',
  heart: '♥',
  diamond: '♦',
  club: '♣',
}

/** mulberry32：32 位整数种子，同名种子必得同一发牌序列，用于复现对局问题 */
export function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: readonly T[], rng: RandomSource): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const current = result[i]
    const other = result[j]
    if (current === undefined || other === undefined) continue
    result[i] = other
    result[j] = current
  }
  return result
}

function createDeck(): Card[] {
  const cards: Card[] = []
  for (let rank = 1; rank <= DECK_SIZE; rank += 1) {
    const suit = CARD_SUITS[(rank - 1) % CARD_SUITS.length]!
    cards.push({ id: `${suit}-${rank}`, rank: rank as CardRank, suit })
  }
  return cards
}

export function formatRank(rank: CardRank): string {
  return String(rank)
}

export function formatCard(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${formatRank(card.rank)}`
}

export function evaluateHand(cards: readonly Card[], target = 21): HandState {
  const total = cards.reduce((sum, card) => sum + card.rank, 0)
  return {
    cards: [...cards],
    visible: [...cards],
    total,
    busted: total > target,
  }
}

/**
 * 对手的展示手牌：第 2 张起手牌默认扣住，直到亮牌阶段。
 * 点数额仍按真实手牌计算，UI 只隐藏牌面。
 */
function withHoleCard(hand: HandState, hidden: boolean): HandState {
  return {
    ...hand,
    visible: hand.cards.map((card, index) => (hidden && index === 1 ? null : card)),
  }
}

class ActorRuntime {
  readonly id: ActorId
  hp: number
  maxHp: number
  items: ItemId[] = []
  hand: HandState = evaluateHand([])
  trumps: TrumpId[] = []
  standing = false
  stayed = false
  gunCuffed = false
  sawBoost = 0
  itemsUsedThisTurn = 0

  constructor(id: ActorId, hp: number) {
    this.id = id
    this.hp = hp
    this.maxHp = hp
  }
}

class Cylinder {
  private chambers: Chamber[] = []
  private cursor = 0
  private readonly rng: RandomSource

  constructor(rng: RandomSource) {
    this.rng = rng
  }

  get remaining(): number {
    return Math.max(0, this.chambers.length - this.cursor)
  }

  get total(): number {
    return this.chambers.length
  }

  get current(): Chamber | null {
    return this.chambers[this.cursor] ?? null
  }

  get liveRemaining(): number {
    let count = 0
    for (let i = this.cursor; i < this.chambers.length; i += 1) {
      if (this.chambers[i] === 'live') count += 1
    }
    return count
  }

  get blankRemaining(): number {
    return this.remaining - this.liveRemaining
  }

  reload(total: number): Chamber[] {
    // 总弹 2~8 发；2 发固定 1 实 1 空。其余实弹 2~4 发，且不超过一半（奇数可多 1 发）。
    const capacity = Math.max(2, Math.min(8, Math.round(total)))
    const liveCount =
      capacity === 2
        ? 1
        : 2 + Math.floor(this.rng() * (Math.min(4, Math.ceil(capacity / 2), capacity - 1) - 1))
    const chambers: Chamber[] = []
    for (let i = 0; i < liveCount; i += 1) chambers.push('live')
    for (let i = 0; i < capacity - liveCount; i += 1) chambers.push('blank')
    this.chambers = shuffle(chambers, this.rng)
    this.cursor = 0
    return [...this.chambers]
  }

  fire(): Chamber {
    const chamber = this.current
    if (chamber === null) {
      throw new Error('Cannot fire an empty cylinder')
    }
    this.cursor += 1
    return chamber
  }

  discard(): Chamber | null {
    const chamber = this.current
    if (chamber === null) return null
    this.cursor += 1
    return chamber
  }

  /** 重锤：翻转当前这一发；弹仓见底时返回 false */
  flip(): boolean {
    const current = this.current
    if (current === null) return false
    this.chambers[this.cursor] = current === 'blank' ? 'live' : 'blank'
    return true
  }
}

/**
 * 可暂停的定时器：暂停时保留剩余毫秒，恢复后继续计时，不会重复触发。
 * wait / 处决停顿 / 补给倒计时 / 输入锁统一走这里，避免各自处理暂停。
 */
class PausableDelay {
  private remaining: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private startedAt = 0
  private resolved = false
  private readonly done: () => void

  constructor(ms: number, done: () => void) {
    this.remaining = Math.max(0, ms)
    this.done = done
  }

  start(): void {
    if (this.resolved || this.timer !== null) return
    this.startedAt = Date.now()
    this.timer = setTimeout(() => this.fire(), this.remaining)
  }

  pause(): void {
    if (this.timer === null || this.resolved) return
    clearTimeout(this.timer)
    this.timer = null
    this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt))
  }

  resume(): void {
    if (this.resolved || this.timer !== null) return
    this.start()
  }

  /** 取消并放行挂起的 Promise，避免暂停/销毁后协程永久悬空 */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.fire()
  }

  get leftover(): number {
    if (this.resolved) return 0
    if (this.timer === null) return this.remaining
    return Math.max(0, this.remaining - (Date.now() - this.startedAt))
  }

  private fire(): void {
    if (this.resolved) return
    this.resolved = true
    this.remaining = 0
    this.done()
  }
}

function actorLabel(id: ActorId): string {
  return id === 'player' ? '你' : '它'
}

/**
 * Pure-TypeScript 21-point duel state machine with alternating turns and trump cards.
 * No DOM, Three.js or audio dependencies: the host wires sounds off `GameEvent`s.
 */
export class GameEngine {
  private readonly rng: RandomSource
  private readonly levelList: readonly LevelConfig[]
  private readonly dealDelay: number
  private readonly thinkOverride: number | null
  private readonly itemLockMs: number
  private inputDelay: PausableDelay | null = null
  private executionDelay: PausableDelay | null = null
  private executionSkip: (() => void) | null = null
  private supplyOptions: ItemId[] = []
  private supplyPick: ItemId | null = null
  private bossSupplyOptions: ItemId[] = []
  private bossSupplyPick: ItemId | null = null
  /** 层间三选一选中的道具：beginLevel 会重建 Actor，必须先寄存再注入 */
  private carryOver: ItemId[] = []
  private carryOverBoss: ItemId[] = []
  private readonly listeners = new Set<GameEventListener>()
  private readonly delays = new Set<PausableDelay>()
  private readonly resumeWaiters = new Set<() => void>()
  private readonly cylinder: Cylinder

  private generation = 0
  private destroyed = false
  private started = false
  private paused = false
  /** 场景演出闸门：枪放平、镜头回位后才允许重新发牌；测试/无场景时为 null */
  private presentationGate: (() => Promise<void>) | null = null
  private itemPresentationGate: (() => Promise<void>) | null = null
  private itemPresentationPending = false
  private itemPresentationFinished = false
  private itemEvents: GameEvent[] | null = null
  private deferredItemEvents: GameEvent[] = []
  private runRounds = 0
  private phase: Phase = 'idle'
  private levelIndex = 0
  private round = 0
  private cylinderRandomized = false
  private player: ActorRuntime = new ActorRuntime('player', 0)
  private boss: ActorRuntime = new ActorRuntime('boss', 0)
  private deck: Card[] = []
  private trumpPool: TrumpId[] = []
  private tableTrumps: Record<ActorId, TrumpId[]> = { player: [], boss: [] }
  private roundTarget = 21
  private lastPerfectWin = false
  private cleanStandPasses = 0
  private standPassDirty = false
  private revealedBy: Record<ActorId, Chamber | null> = { player: null, boss: null }
  private pendingShot: ActorId = 'player'
  private holeRevealed = false
  private playerHoleRevealed = false
  private inputLocked = false
  private logLines: string[] = []

  constructor(options: GameEngineOptions = {}) {
    this.rng = options.rng ?? Math.random
    this.levelList = options.levels && options.levels.length > 0 ? [...options.levels] : LEVELS
    this.dealDelay = Math.max(0, options.dealDelayMs ?? 240)
    this.thinkOverride =
      options.thinkDelayMs === undefined ? null : Math.max(0, options.thinkDelayMs)
    this.itemLockMs = Math.max(0, options.itemLockMs ?? 460)
    this.cylinder = new Cylinder(this.rng)
    this.log('深渊在呼吸。锈蚀的轮盘正在等待一笔交易。')
  }

  start(): void {
    if (this.destroyed || this.started) return
    this.started = true
    this.generation += 1
    this.runRounds = 0
    this.cylinderRandomized = false
    this.logLines = []
    this.log('你坐下，牌桌另一端的影子抬起头。')
    void this.beginLevel(0, this.generation)
  }

  /** 从层首检查点继续：血袋与补给重置，不保留局内手牌 */
  startAtLevel(levelIndex: number, carryOver: readonly ItemId[] = []): void {
    if (this.destroyed) return
    const index = Math.max(0, Math.min(this.levelList.length - 1, Math.floor(levelIndex)))
    if (this.started) this.cancelTimers()
    this.generation += 1
    this.started = true
    this.runRounds = 0
    this.paused = false
    this.carryOver = [...carryOver]
    this.carryOverBoss = []
    this.bossSupplyOptions = []
    this.bossSupplyPick = null
    this.logLines = []
    this.log('你从门缝里退回上一层，血袋重新注满。')
    void this.beginLevel(index, this.generation)
  }

  /** 死亡后从本层重来；不保留旧手牌与旧补给 */
  retryLevel(): boolean {
    if (this.phase !== 'gameOver') {
      return this.reject('现在还不能重来。')
    }
    this.startAtLevel(this.levelIndex)
    return true
  }

  restart(): void {
    if (this.destroyed) return
    this.generation += 1
    this.cancelTimers()
    this.started = false
    this.paused = false
    this.runRounds = 0
    this.cylinderRandomized = false
    this.phase = 'idle'
    this.levelIndex = 0
    this.round = 0
    this.player = new ActorRuntime('player', 0)
    this.boss = new ActorRuntime('boss', 0)
    this.deck = []
    this.trumpPool = []
    this.tableTrumps = { player: [], boss: [] }
    this.roundTarget = 21
    this.lastPerfectWin = false
    this.cleanStandPasses = 0
    this.standPassDirty = false
    this.clearReveals()
    this.pendingShot = 'player'
    this.holeRevealed = false
    this.playerHoleRevealed = false
    this.logLines = []
    this.supplyOptions = []
    this.supplyPick = null
    this.bossSupplyOptions = []
    this.bossSupplyPick = null
    this.carryOver = []
    this.carryOverBoss = []
    this.publish()
    this.start()
  }

  hit(): boolean {
    if (this.paused) return this.reject('游戏已暂停。')
    if (this.phase !== 'playerTurn') {
      return this.reject('现在不是你的回合。')
    }
    if (this.player.hand.busted) {
      return this.reject('你已经爆牌，只能打王牌或停牌。')
    }
    if (this.inputLocked) {
      return this.reject('上一张牌还在飞。')
    }
    this.dispatch({ type: 'playerTableAction', action: 'hit' })
    if (this.presentationGate) {
      this.queuePlayerAction(150, () => this.finishPlayerHit())
      return true
    }
    this.finishPlayerHit()
    return true
  }

  private finishPlayerHit(): void {
    this.cleanStandPasses = 0
    this.standPassDirty = false
    this.dealTo(this.player)
    this.maybeDrawTrump(this.player)
    this.player.stayed = false
    if (this.player.hand.busted) {
      // 爆牌不再自动停牌：回合仍归玩家，只能打王牌（抬高目标）或停牌
      this.dispatch({ type: 'bust', actor: 'player' })
      this.log('你爆牌了。只能打王牌或停牌。')
      this.resumeAfterOpponentHit(this.boss)
      this.phase = 'playerTurn'
      this.publish()
      return
    } else if (this.player.hand.total === this.roundTarget) {
      this.player.stayed = true
      this.player.standing = true
      this.log(`${this.roundTarget} 点。你自动停牌。`)
    }
    this.resumeAfterOpponentHit(this.boss)
    this.phase = 'bossTurn'
    this.publish()
    void this.runBossTurn(this.generation)
  }

  stand(): boolean {
    if (this.paused) return this.reject('游戏已暂停。')
    if (this.phase !== 'playerTurn') {
      return this.reject('现在不是你的回合。')
    }
    if (this.inputLocked) {
      return this.reject('动作还没结束。')
    }
    this.dispatch({ type: 'playerTableAction', action: 'stand' })
    if (this.presentationGate) {
      this.queuePlayerAction(220, () => this.finishPlayerStand())
      return true
    }
    this.finishPlayerStand()
    return true
  }

  private finishPlayerStand(): void {
    this.player.stayed = true
    this.player.standing = true
    this.log(`你停牌在 ${this.player.hand.total} 点。`)
    this.phase = 'bossTurn'
    this.publish()
    void this.runBossTurn(this.generation)
  }

  private queuePlayerAction(delayMs: number, finish: () => void): void {
    const token = this.generation
    this.inputLocked = true
    this.publish()
    void this.wait(delayMs).then(() => {
      if (!this.alive(token) || this.phase !== 'playerTurn') return
      this.inputLocked = false
      finish()
    })
  }

  useItem(item: ItemId, target?: ItemId): boolean {
    if (this.paused) return this.reject('游戏已暂停。')
    if (this.phase !== 'targeting' && this.phase !== 'execution') {
      return this.reject('21 点阶段只能使用王牌。')
    }
    if (this.phase !== 'targeting' || this.pendingShot !== 'player') {
      return this.reject('现在不是使用道具的时机。')
    }
    if (this.inputLocked) {
      return this.reject('动作还没结束。')
    }
    if (!this.applyItem(this.player, item, target)) return false
    if (this.resolveDeaths()) return true
    if (this.itemPresentationGate) {
      this.clearInputDelay()
      this.itemPresentationPending = true
      this.itemPresentationFinished = false
      this.inputLocked = true
      const token = this.generation
      this.publish()
      void this.itemPresentationGate().then(async () => {
        if (!this.alive(token)) return
        await this.waitUntilResumed()
        if (!this.alive(token)) return
        this.releaseDeferredItemEvents()
        this.itemPresentationFinished = true
        this.finishItemPresentation()
      })
    } else {
      this.releaseDeferredItemEvents()
      this.lockInput(this.itemLockMs)
    }
    return true
  }

  private finishItemPresentation(): void {
    if (!this.itemPresentationPending || !this.itemPresentationFinished || this.paused) return
    this.itemPresentationPending = false
    this.itemPresentationFinished = false
    this.unlockInput()
  }

  advanceLevel(): boolean {
    if (this.phase !== 'levelClear') {
      return this.reject('现在无法进入下一层。')
    }
    this.generation += 1
    this.cancelTimers()
    void this.beginLevel(this.levelIndex + 1, this.generation)
    return true
  }

  /** 层间补给由系统随机抽取，不再等玩家点击 */
  subscribe(listener: GameEventListener): () => void {
    this.listeners.add(listener)
    const snapshot = this.getSnapshot()
    try {
      listener({ type: 'state', snapshot }, snapshot)
    } catch (error) {
      console.error(error)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): GameSnapshot {
    return {
      phase: this.phase,
      started: this.started,
      levelIndex: this.levelIndex,
      level: this.currentLevel(),
      round: this.round,
      player: this.viewOf(this.player),
      boss: this.viewOf(this.boss),
      cylinder: {
        remaining: this.cylinder.remaining,
        total: this.cylinder.total,
        live: this.cylinder.liveRemaining,
        blank: this.cylinder.blankRemaining,
        revealed: this.revealedBy.player,
      },
      turn:
        this.phase === 'playerTurn'
          ? 'player'
          : this.phase === 'bossTurn'
            ? 'boss'
            : null,
      pendingShot: this.phase === 'targeting' ? this.pendingShot : null,
      roundTarget: this.roundTarget,
      lastPerfectWin: this.lastPerfectWin,
      tableTrumps: {
        player: [...this.tableTrumps.player],
        boss: [...this.tableTrumps.boss],
      },
      unlockedItems: this.unlockedItems(),
      supplyOptions: this.phase === 'supply' ? [...this.supplyOptions] : [],
      supplyPick: this.phase === 'supply' ? this.supplyPick : null,
      bossSupplyOptions:
        this.phase === 'supply' || this.phase === 'bossSupply' ? [...this.bossSupplyOptions] : [],
      bossSupplyPick: this.phase === 'bossSupply' ? this.bossSupplyPick : null,
      inputLocked: this.inputLocked,
      paused: this.paused,
      runRounds: this.runRounds,
      log: [...this.logLines],
    }
  }

  destroy(): void {
    this.destroyed = true
    this.generation += 1
    this.cancelTimers()
    for (const resolve of this.resumeWaiters) resolve()
    this.resumeWaiters.clear()
    this.listeners.clear()
  }

  private async beginLevel(index: number, token: number): Promise<void> {
    if (!this.alive(token)) return
    this.levelIndex = index
    this.phase = 'reloading'
    this.round = 0
    this.roundTarget = 21
    this.lastPerfectWin = false
    this.trumpPool = []
    this.tableTrumps = { player: [], boss: [] }
    this.holeRevealed = false
    this.playerHoleRevealed = false
    this.clearReveals()
    this.pendingShot = 'player'
    this.supplyOptions = []
    this.supplyPick = null
    this.bossSupplyOptions = []
    this.bossSupplyPick = null
    const level = this.currentLevel()
    this.player = new ActorRuntime('player', level.playerHp)
    this.boss = new ActorRuntime('boss', level.hp)
    if (this.carryOver.length > 0) {
      const carried = this.carryOver
      this.carryOver = []
      for (const item of carried) {
        if (!this.canHoldItem(this.player, item)) break
        this.player.items.push(item)
      }
      this.log(
        `门前的补给还在你身上：${carried.map((item) => `【${ITEM_CATALOG[item].name}】`).join('')}。`,
      )
    }
    this.giveSupply(this.player, level.supply)
    this.giveSupply(this.boss, level.supply)
    if (this.carryOverBoss.length > 0) {
      const carried = this.carryOverBoss
      this.carryOverBoss = []
      for (const item of carried) {
        if (!this.canHoldItem(this.boss, item)) break
        this.boss.items.push(item)
      }
      this.log(
        `它也把门前的补给带了进来：${carried.map((item) => `【${ITEM_CATALOG[item].name}】`).join('')}。`,
      )
    }
    const chambers = this.reloadCylinder()
    this.log(`—— 第 ${index + 1} 层 · ${level.title} ——`)
    this.log(`「${level.name}」把一枚生锈的转轮推到你面前。`)
    // 进入新层即是一个可继续的检查点：血袋与补给已按本层重置
    this.dispatch({
      type: 'checkpoint',
      levelIndex: index,
      carryOver: [...this.player.items],
      runRounds: this.runRounds,
    })
    this.dispatch({
      type: 'reload',
      live: chambers.filter((chamber) => chamber === 'live').length,
      blank: chambers.filter((chamber) => chamber === 'blank').length,
    })
    this.publish()
    await this.wait(2600)
    if (!this.alive(token)) return
    void this.startRound(token)
  }

  private async startRound(token: number): Promise<void> {
    if (!this.alive(token)) return
    this.round += 1
    this.runRounds += 1
    this.phase = 'dealing'
    this.clearReveals()
    this.pendingShot = 'player'
    this.roundTarget = 21
    this.lastPerfectWin = false
    this.cleanStandPasses = 0
    this.standPassDirty = false
    this.tableTrumps = { player: [], boss: [] }
    this.holeRevealed = false
    this.playerHoleRevealed = false
    this.player.itemsUsedThisTurn = 0
    this.boss.itemsUsedThisTurn = 0
    this.retainOneTrump(this.player)
    this.retainOneTrump(this.boss)
    // 加权随机排序后 pop，保持每回合不重复抽取
    this.trumpPool = [...TRUMP_IDS]
      .map((id) => ({
        id,
        key: -Math.log(Math.max(this.rng(), Number.EPSILON)) / TRUMP_WEIGHTS[id],
      }))
      .sort((a, b) => b.key - a.key)
      .map((entry) => entry.id)
    this.player.hand = evaluateHand([])
    this.player.standing = false
    this.player.stayed = false
    this.boss.hand = evaluateHand([])
    this.boss.standing = false
    this.boss.stayed = false
    this.ensureCylinder()
    // 所有层每个回合都重新洗牌，Boss 只能根据本回合剩余牌靴算牌
    this.deck = shuffle(createDeck(), this.rng)
    this.drawTrump(this.player)
    this.drawTrump(this.player)
    this.drawTrump(this.boss)
    this.drawTrump(this.boss)
    this.log(`—— 第 ${this.round} 回合 · 目标 ${this.roundTarget} ——`)
    this.dispatch({ type: 'roundStart', level: this.levelIndex + 1, round: this.round })
    this.publish()

    for (let pass = 0; pass < 2; pass += 1) {
      await this.wait(this.dealDelay)
      if (!this.alive(token)) return
      this.dealTo(this.player)
      await this.wait(this.dealDelay)
      if (!this.alive(token)) return
      this.dealTo(this.boss)
    }

    // 双方第 2 张牌都扣住，结算时再亮牌；点数额仍按真实手牌计算
    this.player.hand = withHoleCard(this.player.hand, !this.playerHoleRevealed)
    this.boss.hand = withHoleCard(this.boss.hand, !this.holeRevealed)

    this.publish()

    this.phase = 'playerTurn'
    this.dispatch({ type: 'turn', actor: 'player' })
    this.publish()
  }

  private resolveStandPass(token: number): void {
    if (this.standPassDirty) {
      this.standPassDirty = false
      this.cleanStandPasses = 0
      this.resetStandConfirmation()
      this.dispatch({ type: 'notice', message: '本轮使用过王牌，连续停牌计数重新开始。' })
      this.phase = 'playerTurn'
      this.dispatch({ type: 'turn', actor: 'player' })
      this.publish()
      return
    }

    this.cleanStandPasses += 1
    if (this.cleanStandPasses >= 2) {
      this.log('双方连续两轮未使用王牌并停牌，开始结算。')
      void this.settleRound(token)
      return
    }

    this.resetStandConfirmation()
    this.dispatch({ type: 'notice', message: '双方连续停牌 1/2：再连续停牌一轮且不使用王牌才会结算。' })
    this.phase = 'playerTurn'
    this.dispatch({ type: 'turn', actor: 'player' })
    this.publish()
  }

  private resetStandConfirmation(): void {
    this.player.stayed = false
    this.player.standing = false
    this.boss.stayed = false
    this.boss.standing = false
  }

  private async runBossTurn(token: number): Promise<void> {
    const profile = BOSS_PROFILES[this.currentLevel().personality]
    const think = this.thinkOverride ?? profile.thinkingMs
    await this.wait(think)
    if (!this.alive(token) || this.phase !== 'bossTurn') return
    this.dispatch({ type: 'turn', actor: 'boss' })
    this.publish()

    while (this.alive(token) && this.phase === 'bossTurn') {
      const trumpIndex = this.chooseBossTrump()
      if (trumpIndex === null) break
      const trumpCount = this.boss.trumps.length
      this.useTrumpInternal(this.boss, trumpIndex)
      if (this.boss.trumps.length === trumpCount) break
      if (this.resolveDeaths()) return
      if (this.itemPresentationGate) await this.itemPresentationGate()
      await this.waitUntilResumed()
      this.releaseDeferredItemEvents()
      if (!this.alive(token) || this.phase !== 'bossTurn') return
    }

    const target = this.bossTarget(profile, profile.personality)
    const wantHit = !this.boss.hand.busted && this.boss.hand.total < target
    if (wantHit) {
      this.dispatch({ type: 'bossBark', action: 'hit', hand: true })
      await this.wait(150)
      if (!this.alive(token) || this.phase !== 'bossTurn') return
      this.cleanStandPasses = 0
      this.standPassDirty = false
      this.dealTo(this.boss)
      this.maybeDrawTrump(this.boss)
      this.boss.stayed = false
      if (this.boss.hand.busted) {
        this.dispatch({ type: 'bust', actor: 'boss' })
        this.log('它爆牌了，喉咙里滚出一声低笑。')
        this.boss.stayed = true
        this.boss.standing = true
      } else if (this.boss.hand.total === this.roundTarget) {
        this.boss.stayed = true
        this.boss.standing = true
        this.dispatch({ type: 'bossBark', action: 'stand', hand: false })
        this.log(`它摸到 ${this.roundTarget} 点，自动停牌。`)
      }
      this.resumeAfterOpponentHit(this.player)
    } else {
      this.dispatch({ type: 'bossBark', action: 'stand', hand: true })
      await this.wait(220)
      if (!this.alive(token) || this.phase !== 'bossTurn') return
      this.boss.stayed = true
      this.boss.standing = true
      this.log(`「${this.currentLevel().name}」停牌在 ${this.boss.hand.total} 点。`)
    }

    this.publish()
    await this.wait(450)
    if (!this.alive(token)) return
    if (this.player.stayed && this.boss.stayed) {
      this.resolveStandPass(token)
      return
    }
    this.phase = 'playerTurn'
    this.dispatch({ type: 'turn', actor: 'player' })
    this.publish()
  }

  private async settleRound(token: number): Promise<void> {
    if (!this.alive(token)) return
    if (!this.player.stayed || !this.boss.stayed) {
      this.phase = !this.player.stayed ? 'playerTurn' : 'bossTurn'
      this.publish()
      return
    }
    this.phase = 'resolving'
    // 结算时双方亮出暗牌
    const wasPlayerHidden = !this.playerHoleRevealed
    const wasBossHidden = !this.holeRevealed
    this.playerHoleRevealed = true
    this.holeRevealed = true
    this.player.hand = withHoleCard(this.player.hand, false)
    this.boss.hand = withHoleCard(this.boss.hand, false)
    if (wasPlayerHidden) {
      const hole = this.player.hand.cards[1]
      if (hole) this.log(`你亮出暗牌 ${formatCard(hole)}，共 ${this.player.hand.total} 点。`)
    }
    if (wasBossHidden) {
      const hole = this.boss.hand.cards[1]
      if (hole) {
        this.log(`它亮出底牌 ${formatCard(hole)}，共 ${this.boss.hand.total} 点。`)
      }
    }
    this.publish()
    await this.wait(420)
    if (!this.alive(token)) return

    const playerTotal = this.player.hand.total
    const bossTotal = this.boss.hand.total
    let winner: ActorId | null = null
    // 双方都爆牌时，离本局目标更近的一方获胜；同点仍为平局
    if (this.player.hand.busted && this.boss.hand.busted) {
      winner = playerTotal === bossTotal ? null : playerTotal < bossTotal ? 'player' : 'boss'
    } else if (this.player.hand.busted) {
      winner = 'boss'
    } else if (this.boss.hand.busted) {
      winner = 'player'
    } else if (playerTotal === bossTotal) {
      winner = null
    } else {
      winner = playerTotal > bossTotal ? 'player' : 'boss'
    }

    if (winner === null) {
      if (this.player.hand.busted && this.boss.hand.busted) {
        this.log(`双方同时爆牌（${playerTotal} 对 ${bossTotal}），这一枪没人开。`)
      } else {
        this.log(`走火危机：双方都停在 ${playerTotal} 点，这一枪没人开。`)
      }
      const mine = this.giveOne(this.player)
      const theirs = this.giveOne(this.boss)
      if (mine) this.log(`你从桌下摸到了【${ITEM_CATALOG[mine].name}】。`)
      else this.log('你的背包已满，摸不到新道具。')
      if (theirs) this.log(`它也摸到了【${ITEM_CATALOG[theirs].name}】。`)
      this.log('轮盘发出空转的咔哒声。双方各摸一件补给。')
      this.dispatch({ type: 'tie', player: playerTotal, boss: bossTotal })
      this.publish()
      this.phase = 'roundEnd'
      await this.wait(1600)
      if (!this.alive(token)) return
      void this.startRound(token)
      return
    }

    if (this.player.hand.busted && this.boss.hand.busted) {
      this.log(`双方都爆牌（你 ${playerTotal}，它 ${bossTotal}），点数更小的${winner === 'player' ? '你' : '它'}获胜。`)
    }

    this.lastPerfectWin = false
    const winnerTotal = winner === 'player' ? playerTotal : bossTotal
    if (winnerTotal === this.roundTarget) {
      const winnerActor = winner === 'player' ? this.player : this.boss
      const bonus = this.giveOne(winnerActor)
      if (winner === 'player') this.lastPerfectWin = true
      this.log(bonus
        ? `${winner === 'player' ? '你' : '它'}满点收局。发牌人多推来一件【${ITEM_CATALOG[bonus].name}】。`
        : `${winner === 'player' ? '你' : '它'}满点收局，但背包已经塞不下了。`)
      this.dispatch({ type: 'perfectWin', actor: winner, item: bonus })
    }

    // 赢家拿到枪，由它决定枪口朝向：对手，或者自己
    this.pendingShot = winner
    this.phase = 'targeting'
    this.publish()

    if (winner === 'boss') {
      void this.runBossTargeting(token)
    }
  }

  private async runBossTargeting(token: number): Promise<void> {
    if (!this.alive(token) || this.phase !== 'targeting' || this.pendingShot !== 'boss') return
    while (this.alive(token) && this.phase === 'targeting') {
      const item = this.chooseBossItem()
      if (!item) break
      this.log(`「${this.currentLevel().name}」从大衣里摸出一件东西。`)
      this.publish()
      if (!this.applyItem(this.boss, item)) break
      if (this.resolveDeaths()) return
      if (this.itemPresentationGate) await this.itemPresentationGate()
      await this.waitUntilResumed()
      this.releaseDeferredItemEvents()
      if (!this.alive(token) || this.phase !== 'targeting') return
    }
    await this.wait(760)
    if (!this.alive(token) || this.phase !== 'targeting') return
    const target = this.chooseBossTarget()
    this.log(`「${this.currentLevel().name}」把枪口对准${target === 'boss' ? '自己' : '你'}。`)
    this.publish()
    await this.resolveShot(this.boss, target === 'boss' ? this.boss : this.player, token)
  }

  /** 处决阶段：持枪者选择枪口。只有玩家持枪时才能调用。 */
  chooseTarget(target: ActorId): boolean {
    if (this.paused) return this.reject('游戏已暂停。')
    if (this.phase !== 'targeting') {
      return this.reject('现在不是决定枪口的时候。')
    }
    if (this.pendingShot !== 'player') {
      return this.reject('枪在它手里。')
    }
    void this.resolveShot(this.player, target === 'player' ? this.player : this.boss, this.generation)
    return true
  }

  /** 注入场景演出闸门；传 null 恢复立即发牌（测试与无场景环境） */
  setPresentationGate(gate: (() => Promise<void>) | null): void {
    this.presentationGate = gate
  }

  /** 动作收尾前不允许再次行动，也不允许把未完成的结果提前交给 UI */
  get hasPendingItemAction(): boolean {
    return this.itemPresentationPending
  }

  setItemPresentationGate(gate: (() => Promise<void>) | null): void {
    this.itemPresentationGate = gate
    if (!gate && this.itemPresentationPending) {
      this.releaseDeferredItemEvents()
      this.itemPresentationFinished = true
      this.finishItemPresentation()
    }
  }

  /** 跳过处决悬念停顿，立即揭晓枪响结果；只在处决演出进行中有效 */
  skipExecution(): boolean {
    if (this.phase !== 'execution' || this.executionSkip === null) return false
    this.executionSkip()
    return true
  }

  private async resolveShot(attacker: ActorRuntime, target: ActorRuntime, token: number): Promise<void> {
    if (!this.alive(token) || this.phase !== 'targeting') return
    const selfShot = attacker === target
    const foe = attacker.id === 'player' ? this.boss : this.player
    const cuffedActor = selfShot ? foe : target
    const transferBlocked = !selfShot && cuffedActor.gunCuffed
    this.ensureCylinder()
    const sawed = attacker.sawBoost > 0
    const chamber = this.cylinder.current ?? 'blank'

    this.phase = 'execution'
    this.pendingShot = 'player'
    this.publish()
    this.dispatch({
      type: 'execution',
      by: attacker.id,
      target: target.id,
      chamber,
      lethal: chamber === 'live',
    })
    await this.waitExecution(2900)
    if (!this.alive(token)) return

    this.cylinder.fire()
    cuffedActor.gunCuffed = false
    this.clearReveals()
    const damage = chamber === 'live' ? 1 + (sawed ? 1 : 0) : 0
    if (chamber === 'live') {
      target.hp = Math.max(0, target.hp - damage)
      attacker.sawBoost = 0
    }

    const who = actorLabel(attacker.id)
    const victim = selfShot ? '自己' : actorLabel(target.id)
    if (chamber === 'live') {
      const tag = sawed ? '（锯短枪管 +1）' : ''
      this.log(`${who}扣下扳机：实弹${tag}。${victim}承受 ${damage} 点伤害。`)
    } else if (selfShot) {
      this.log(`${who}把枪口对准自己：空膛。本次开枪结束，没有拿到补给。`)
    } else if (transferBlocked) {
      this.log(`${who}把枪口对准${victim}：空膛。手铐锁住对手的手，枪没有脱手。`)
    } else {
      this.log(`${who}把枪口对准${victim}：空膛。枪权转移给${actorLabel(target.id)}。`)
    }
    this.dispatch({
      type: 'shot',
      by: attacker.id,
      target: target.id,
      chamber,
      damage,
      sawed,
    })
    this.publish()
    await this.wait(1500)
    if (!this.alive(token)) return
    if (this.resolveDeaths()) return

    if (chamber === 'blank' && !selfShot) {
      const nextShooter = transferBlocked ? attacker : target
      this.phase = 'targeting'
      this.pendingShot = nextShooter.id
      this.publish()
      if (this.presentationGate) {
        await this.presentationGate()
        if (!this.alive(token)) return
      }
      await this.waitUntilResumed()
      if (!this.alive(token)) return
      if (nextShooter.id === 'boss') void this.runBossTargeting(token)
      return
    }

    this.phase = 'roundEnd'
    this.publish()
    await this.wait(900)
    if (!this.alive(token)) return
    // 等枪完全放平、镜头回到桌面机位，再开始下一回合发牌
    if (this.presentationGate) {
      await this.presentationGate()
      if (!this.alive(token)) return
    }
    await this.waitUntilResumed()
    if (!this.alive(token)) return
    void this.startRound(token)
  }

  /** 对手的枪口选择：看穿空膛就一定自射跳过本轮，不把枪交回来；否则打玩家 */
  private chooseBossTarget(): ActorId {
    if (this.revealedBy.boss === 'blank') return 'boss'
    return 'player'
  }

  private resolveDeaths(): boolean {
    if (this.boss.hp <= 0) {
      if (this.levelIndex >= this.levelList.length - 1) {
        this.phase = 'victory'
        this.log('轮盘停转。深渊把你的名字刻进了铁锈里。')
        this.dispatch({ type: 'gameOver', winner: 'player' })
        this.publish()
      } else {
        this.phase = 'levelClear'
        this.log(`「${this.currentLevel().name}」倒下了。下一层的门正在开启……`)
        this.dispatch({ type: 'levelClear', level: this.levelIndex + 1 })
        const nextTier = LEVEL_UNLOCKS[this.levelIndex + 1]
        if (nextTier && nextTier.length > 0) {
          this.dispatch({
            type: 'lootUnlocked',
            level: this.levelIndex + 2,
            items: [...nextTier],
          })
        }
        this.publish()
        void this.offerSupply(this.generation)
      }
      return true
    }
    if (this.player.hp <= 0) {
      this.phase = 'gameOver'
      this.log('你的呼吸停在了牌桌上。轮盘继续转动。')
      this.dispatch({ type: 'gameOver', winner: 'boss' })
      this.publish()
      return true
    }
    return false
  }

  /**
   * 清层后先让横幅播完，再摆出补给。
   * 玩家与 Boss 同一套演出：候选升上桌 → 停留 → 整盘沉下只留随机选中件 → 选中件升回桌面。
   * 选中件先存进 carryOver，beginLevel 重建 Actor 时再注入。
   */
  private async offerSupply(token: number): Promise<void> {
    await this.wait(SUPPLY_DELAY_MS)
    if (!this.alive(token) || this.phase !== 'levelClear') return
    const options = this.rollSupplyOptions()
    if (options.length === 0) {
      void this.beginLevel(this.levelIndex + 1, token)
      return
    }
    const bossOptions = this.rollBossSupplyOptions(options.length)
    this.supplyOptions = options
    this.supplyPick = null
    this.bossSupplyOptions = bossOptions
    this.bossSupplyPick = null
    this.phase = 'supply'
    this.log(
      options.length >= 3
        ? '门前的桌上摆着三件补给，随机留下一件。'
        : `门前的桌上摆着 ${options.length} 件补给，随机留下一件。`,
    )
    this.dispatch({ type: 'supplyOffer', options: [...options] })
    this.publish()
    await this.wait(SUPPLY_HOLD_MS)
    if (!this.alive(token) || this.phase !== 'supply') return
    const picked = options[Math.floor(this.rng() * options.length)] ?? null
    if (picked) {
      this.supplyPick = picked
      this.carryOver.push(picked)
      this.log(`你带走了【${ITEM_CATALOG[picked].name}】，推开了下一道生锈的铁门。`)
      this.dispatch({ type: 'supplyPick', actor: 'player', item: picked })
      this.publish()
      await this.wait(SUPPLY_PICK_BEAT_MS)
      if (!this.alive(token)) return
    }
    this.supplyOptions = []
    this.supplyPick = null
    if (bossOptions.length > 0) {
      const bossPick = bossOptions[Math.floor(this.rng() * bossOptions.length)] ?? null
      if (bossPick) {
        this.bossSupplyPick = bossPick
        this.carryOverBoss.push(bossPick)
        this.phase = 'bossSupply'
        this.dispatch({ type: 'bossSupply', pick: bossPick })
        this.publish()
        await this.wait(SUPPLY_PICK_BEAT_MS)
        if (!this.alive(token)) return
        this.log(`它把【${ITEM_CATALOG[bossPick].name}】收进斗篷，留给下一层。`)
      }
    }
    this.bossSupplyOptions = []
    this.bossSupplyPick = null
    this.generation += 1
    this.cancelTimers()
    void this.beginLevel(this.levelIndex + 1, this.generation)
  }

  private rollSupplyOptions(): ItemId[] {
    // 第 1 层只摆两件，之后三件；随机取一件
    const count = this.levelIndex === 0 ? 2 : SUPPLY_OPTION_COUNT
    return shuffle(this.unlockedItems(), this.rng).slice(0, count)
  }

  /** Boss 与玩家使用同一份已解锁道具池 */
  private rollBossSupplyOptions(count: number): ItemId[] {
    if (count <= 0) return []
    return shuffle([...this.unlockedItems()], this.rng).slice(0, count)
  }

  useTrump(index: number): boolean {
    if (this.paused) return this.reject('游戏已暂停。')
    if (this.phase !== 'playerTurn') return this.reject('现在不是使用王牌的时机。')
    if (this.inputLocked) return this.reject('动作还没结束。')
    if (!this.useTrumpInternal(this.player, index)) return false
    if (this.resolveDeaths()) return true
    if (this.itemPresentationGate) {
      this.clearInputDelay()
      this.itemPresentationPending = true
      this.itemPresentationFinished = false
      this.inputLocked = true
      const token = this.generation
      this.publish()
      void this.itemPresentationGate().then(async () => {
        if (!this.alive(token)) return
        await this.waitUntilResumed()
        if (!this.alive(token)) return
        this.releaseDeferredItemEvents()
        this.itemPresentationFinished = true
        this.finishItemPresentation()
      })
    } else {
      this.releaseDeferredItemEvents()
      this.lockInput(this.itemLockMs)
    }
    return true
  }

  private useTrumpInternal(actor: ActorRuntime, index: number): boolean {
    const trump = actor.trumps[index]
    if (!trump) return this.reject('没有这张王牌。')
    const foe = actor.id === 'player' ? this.boss : this.player
    let detail: string | null = null

    if (trump === 'go24' || trump === 'go27') {
      this.roundTarget = trump === 'go24' ? 24 : 27
      this.tableTrumps.player = []
      this.tableTrumps.boss = []
      this.tableTrumps[actor.id].push(trump)
      this.reevaluateHands()
      this.player.stayed = false
      this.boss.stayed = false
      this.player.standing = this.player.hand.busted
      this.boss.standing = this.boss.hand.busted
      this.phase = 'playerTurn'
      detail = `目标值改为 ${this.roundTarget}，双方重新获得行动权。`
    } else if (trump === 'return' || trump === 'remove') {
      const targetActor = trump === 'return' ? actor : foe
      const cardIndex = this.lastVisibleCardIndex(targetActor)
      if (cardIndex === null) return this.reject('没有可以弹回的明牌。')
      const nextCards = targetActor.hand.cards.filter((_, i) => i !== cardIndex)
      const card = targetActor.hand.cards[cardIndex]
      if (!card) return this.reject('没有可以弹回的明牌。')
      targetActor.hand = evaluateHand(nextCards, this.roundTarget)
      this.deck.push(card)
      this.deck = shuffle(this.deck, this.rng)
      this.reevaluateActorHand(targetActor)
      detail = `${trump === 'return' ? '你' : '对手'}弹回了 ${formatCard(card)}。`
    } else if (trump === 'exchange') {
      const mineIndex = this.lastVisibleCardIndex(actor)
      const foeIndex = this.lastVisibleCardIndex(foe)
      if (mineIndex === null || foeIndex === null) return this.reject('没有可以交换的明牌。')
      const mine = [...actor.hand.cards]
      const theirs = [...foe.hand.cards]
      const myCard = mine[mineIndex]
      const foeCard = theirs[foeIndex]
      if (!myCard || !foeCard) return this.reject('没有可以交换的明牌。')
      mine[mineIndex] = foeCard
      theirs[foeIndex] = myCard
      actor.hand = evaluateHand(mine, this.roundTarget)
      foe.hand = evaluateHand(theirs, this.roundTarget)
      this.preserveHoleCard(actor)
      this.preserveHoleCard(foe)
      detail = `双方交换了 ${formatCard(myCard)} 与 ${formatCard(foeCard)}。`
    } else if (trump.startsWith('card')) {
      const rank = Number(trump.slice(4)) as CardRank
      const deckIndex = this.deck.findIndex((card) => card.rank === rank)
      if (deckIndex === -1) {
        detail = `数字 ${rank} 已不在牌堆，王牌落空。`
      } else {
        const [card] = this.deck.splice(deckIndex, 1)
        if (card) {
          this.appendCard(actor, card)
          detail = `${actorLabel(actor.id)}抽到了 ${formatCard(card)}。`
        }
      }
    } else if (trump === 'happiness') {
      this.drawTrump(this.player)
      this.drawTrump(this.boss)
      detail = '双方各抽了一张王牌。'
    } else if (trump === 'destroy') {
      const hadTarget = this.tableTrumps[foe.id].some((id) => id === 'go24' || id === 'go27')
      this.tableTrumps[foe.id] = []
      if (hadTarget) {
        this.roundTarget = 21
        this.reevaluateHands()
        this.resetStayedAfterRetarget()
        detail = '对手的目标王牌被移除，目标恢复 21。'
      } else {
        detail = '对手台面上没有可移除的目标王牌。'
      }
    } else if (trump === 'love') {
      if (this.deck.length === 0) return this.reject('牌堆里没有牌。')
      const safeCards = this.deck.filter((entry) => foe.hand.total + entry.rank <= this.roundTarget)
      const best = safeCards.length > 0
        ? safeCards.reduce((a, b) => (b.rank > a.rank ? b : a))
        : this.deck.reduce((a, b) => (b.rank < a.rank ? b : a))
      this.deck.splice(this.deck.indexOf(best), 1)
      this.appendCard(foe, best)
      detail = safeCards.length > 0
        ? `对手得到了牌堆里最贴近目标的一张：${formatCard(best)}。`
        : `牌堆里没有不爆的牌，对手拿到了最小的一张：${formatCard(best)}，仍然爆牌。`
    }

    if (detail === null) return false
    this.cleanStandPasses = 0
    this.standPassDirty = true
    actor.trumps.splice(index, 1)
    this.log(`${actorLabel(actor.id)}使用了【${TRUMP_CATALOG[trump].name}】。${detail}`)
    this.dispatch({ type: 'trumpPlayed', actor: actor.id, trump, detail })
    this.publish()
    return true
  }

  private drawTrump(actor: ActorRuntime): void {
    const trump = this.trumpPool.pop()
    if (!trump) return
    actor.trumps.push(trump)
  }

  private maybeDrawTrump(actor: ActorRuntime): void {
    if (this.rng() < 0.15) this.drawTrump(actor)
  }

  private retainOneTrump(actor: ActorRuntime): void {
    if (actor.trumps.length > 1) actor.trumps = actor.trumps.slice(-1)
  }

  private lastVisibleCardIndex(actor: ActorRuntime): number | null {
    for (let i = actor.hand.visible.length - 1; i >= 0; i -= 1) {
      if (actor.hand.visible[i] !== null) return i
    }
    return null
  }

  private appendCard(actor: ActorRuntime, card: Card): void {
    actor.hand = evaluateHand([...actor.hand.cards, card], this.roundTarget)
    this.preserveHoleCard(actor)
  }

  private preserveHoleCard(actor: ActorRuntime): void {
    const revealed = actor.id === 'boss' ? this.holeRevealed : this.playerHoleRevealed
    if (!revealed) actor.hand = withHoleCard(actor.hand, true)
  }

  private reevaluateActorHand(actor: ActorRuntime): void {
    actor.hand = evaluateHand(actor.hand.cards, this.roundTarget)
    this.preserveHoleCard(actor)
  }

  private reevaluateHands(): void {
    this.reevaluateActorHand(this.player)
    this.reevaluateActorHand(this.boss)
  }

  private resetStayedAfterRetarget(): void {
    this.player.stayed = false
    this.boss.stayed = false
    this.player.standing = this.player.hand.busted
    this.boss.standing = this.boss.hand.busted
    this.phase = 'playerTurn'
  }

  private resumeAfterOpponentHit(actor: ActorRuntime): void {
    if (!actor.hand.busted && actor.hand.total !== this.roundTarget) {
      actor.stayed = false
      actor.standing = false
    }
  }

  private chooseBossTrump(): number | null {
    const indexOf = (id: TrumpId) => this.boss.trumps.indexOf(id)
    if (this.boss.hand.busted) {
      const index = indexOf('return')
      if (index !== null) {
        const cardIndex = this.lastVisibleCardIndex(this.boss)
        const card = cardIndex === null ? null : this.boss.hand.cards[cardIndex]
        if (card && this.boss.hand.total - card.rank <= this.roundTarget) return index
      }
    }
    if (this.boss.hand.total < this.roundTarget && this.boss.hand.total < this.player.hand.total) {
      const preferred = this.roundTarget >= 27 ? 'go27' : this.roundTarget >= 24 ? 'go24' : null
      if (preferred && indexOf(preferred) !== null) return indexOf(preferred)
    }
    if (
      this.wouldLose() &&
      indexOf('exchange') !== null &&
      this.lastVisibleCardIndex(this.boss) !== null &&
      this.lastVisibleCardIndex(this.player) !== null
    ) return indexOf('exchange')
    for (let rank = 2; rank <= 7; rank += 1) {
      const id = `card${rank}` as TrumpId
      const index = indexOf(id)
      const next = this.boss.hand.total + rank
      if (index !== null && next <= this.roundTarget && next > this.boss.hand.total) return index
    }
    if (this.tableTrumps.player.some((id) => id === 'go24' || id === 'go27') && indexOf('destroy') !== null) {
      return indexOf('destroy')
    }
    if (this.boss.trumps.length < 2 && indexOf('happiness') !== null) return indexOf('happiness')
    if (!this.player.hand.busted && this.deck.length > 0 && indexOf('love') !== null) {
      const lowest = Math.min(...this.deck.map((card) => card.rank))
      if (this.player.hand.total + lowest > this.roundTarget) return indexOf('love')
    }
    return null
  }

  private applyItem(actor: ActorRuntime, item: ItemId, target?: ItemId): boolean {
    this.itemEvents = []
    let success = false
    let events: GameEvent[] = []
    try {
      success = this.applyItemEffect(actor, item, target)
      events = this.itemEvents
    } finally {
      this.itemEvents = null
    }
    // 读数、换牌、重洗等结果要等动作演到接触点再发，否则会出现「手还没碰到枪，镜头已经特写」
    const used = events.find((event) => event.type === 'itemUsed')
    if (used) this.dispatch(used)
    if (success) {
      this.deferredItemEvents.push(...events.filter((event) => event !== used))
      this.publish()
    } else {
      for (const event of events) this.dispatch(event)
    }
    return success
  }

  private releaseDeferredItemEvents(): void {
    if (this.deferredItemEvents.length === 0) return
    const events = this.deferredItemEvents
    this.deferredItemEvents = []
    for (const event of events) this.dispatch(event)
    this.publish()
  }

  private applyItemEffect(actor: ActorRuntime, item: ItemId, target?: ItemId): boolean {
    const index = actor.items.indexOf(item)
    if (index === -1) {
      return this.reject(`${actorLabel(actor.id)}没有【${ITEM_CATALOG[item].name}】。`)
    }
    const result = this.resolveItemEffect(actor, item, target)
    if (!result.ok || result.detail === null) return false
    actor.items.splice(index, 1)
    actor.itemsUsedThisTurn += 1
    this.log(`${actorLabel(actor.id)}使用了【${ITEM_CATALOG[item].name}】。${result.detail}`)
    this.dispatch({ type: 'itemUsed', actor: actor.id, item, detail: result.detail })
    this.publish()
    return true
  }

  private resolveItemEffect(
    actor: ActorRuntime,
    item: ItemId,
    target?: ItemId,
  ): { ok: boolean; detail: string | null } {
    const foe = actor.id === 'player' ? this.boss : this.player
    const fail = (message: string): { ok: false; detail: null } => {
      this.reject(message)
      return { ok: false, detail: null }
    }

    switch (item) {
      case 'magnifier': {
        this.ensureCylinder()
        const chamber = this.cylinder.current
        if (!chamber) return fail('弹仓里空无一物。')
        this.revealedBy[actor.id] = chamber
        // Boss 的窥视不能写进日志，否则等于把膛内读数告诉了玩家
        const detail =
          actor.id === 'player'
            ? chamber === 'live'
              ? '窥见实弹。'
              : '窥见空膛。'
            : '它窥视了枪膛，指节停了一瞬。'
        this.dispatch({ type: 'chamberRevealed', actor: actor.id, chamber })
        return { ok: true, detail }
      }
      case 'sedative': {
        if (actor.hp >= actor.maxHp) return fail('生命已经满了。')
        actor.hp = Math.min(actor.maxHp, actor.hp + 1)
        return { ok: true, detail: `生命恢复至 ${actor.hp}/${actor.maxHp}。` }
      }
      case 'saw': {
        if (actor.sawBoost > 0) return fail('枪管已经锯短了。')
        actor.sawBoost = 1
        return { ok: true, detail: '枪管被锯短，下一发实弹伤害 +1。' }
      }
      case 'handcuffs': {
        if (foe.gunCuffed) return fail('对手已经被铐住了。')
        foe.gunCuffed = true
        return { ok: true, detail: '对手的手被铐住：你下一次对他开空枪时，枪权不会转移。' }
      }
      case 'aegis': {
        const ejected = this.cylinder.discard()
        if (ejected === null) return fail('弹仓里空无一物。')
        // 退掉的就是被看穿/记住的那一发，读数必须一起失效
        this.clearReveals()
        this.dispatch({ type: 'chamberDiscarded', actor: actor.id, chamber: ejected })
        const left = this.cylinder.remaining
        return {
          ok: true,
          detail: `退出一发${ejected === 'live' ? '实弹' : '空膛'}，弹仓还剩 ${left} 发。`,
        }
      }
      case 'iou': {
        if (this.rng() < 0.5) {
          actor.hp = Math.max(0, actor.hp - 2)
          return { ok: true, detail: `借据兑现：你自损 2 血，现为 ${actor.hp}/${actor.maxHp}。` }
        }
        actor.hp = Math.min(actor.maxHp, actor.hp + 1)
        return { ok: true, detail: `借据兑现：你恢复 1 血，现为 ${actor.hp}/${actor.maxHp}。` }
      }
      case 'hammer': {
        const before = this.cylinder.current
        if (before === null) return fail('弹仓里空无一物。')
        if (!this.cylinder.flip()) return fail('弹仓里空无一物。')
        this.flipReveals()
        for (const id of ['player', 'boss'] as const) {
          const revealed = this.revealedBy[id]
          if (revealed) this.dispatch({ type: 'chamberFlipped', actor: id, chamber: revealed })
        }
        return {
          ok: true,
          detail: before === 'blank' ? '重锤落下：空膛被砸成了实弹。' : '重锤落下：实膛被震成了空膛。',
        }
      }
      case 'gloves': {
        // 玩家点选目标；Boss 仍随机挑一件
        let targetId: ItemId | null = null
        if (actor.id === 'player') {
          if (!target) return fail('先点选它的一件道具。')
          if (target === 'gloves' || !foe.items.includes(target)) return fail('它身上没有这件道具。')
          targetId = target
        } else {
          const candidates = foe.items.filter((id) => id !== 'gloves')
          targetId = candidates.length > 0 ? candidates[Math.floor(this.rng() * candidates.length)] ?? null : null
        }
        if (targetId === null) return fail('对手没有可以偷取的道具。')
        const picked = { id: targetId, index: foe.items.indexOf(targetId) }
        if (picked.index === -1) return fail('它身上没有这件道具。')
        foe.items.splice(picked.index, 1)
        const used = this.resolveItemEffect(actor, picked.id)
        if (!used.ok || used.detail === null) {
          foe.items.splice(picked.index, 0, picked.id)
          return fail('偷到的道具当前无法使用。')
        }
        return {
          ok: true,
          detail: `偷走了【${ITEM_CATALOG[picked.id].name}】并立即使用：${used.detail}`,
        }
      }
      default: {
        return { ok: false, detail: null }
      }
    }
  }

  private chooseBossItem(): ItemId | null {
    const me = this.boss
    const foe = this.player
    const has = (id: ItemId): boolean => me.items.includes(id)
    if (has('sedative') && me.hp < me.maxHp) return 'sedative'
    if (has('iou') && me.hp > 2 && me.hp < me.maxHp) return 'iou'
    if (has('magnifier') && this.revealedBy.boss === null && this.cylinder.remaining > 0) return 'magnifier'
    // 护心镜是「跳过哑弹」：当前空膛、后面还压着实弹时退掉它，把实弹顶上膛口。
    // 已经看穿这一发是空膛就不用镜子，直接留给自己自射跳过本轮。
    if (
      has('aegis') &&
      this.cylinder.current === 'blank' &&
      this.cylinder.liveRemaining > 0 &&
      this.revealedBy.boss !== 'blank'
    ) return 'aegis'
    if (has('saw') && me.sawBoost === 0 && this.cylinder.current === 'live') return 'saw'
    if (has('hammer') && this.cylinder.current === 'blank') return 'hammer'
    if (has('handcuffs') && !foe.gunCuffed) return 'handcuffs'
    if (has('gloves') && foe.items.some((id) => id !== 'gloves')) return 'gloves'
    return null
  }

  private wouldLose(): boolean {
    const mine = this.boss.hand.total
    const theirs = this.player.hand.total
    if (this.boss.hand.busted && this.player.hand.busted) return mine >= theirs
    if (this.boss.hand.busted) return true
    if (this.player.hand.busted) return false
    return mine < theirs
  }

  private bossTarget(profile: BossProfile, personality: BossPersonality): number {
    if (this.player.hand.busted) return 0
    const mine = this.boss.hand.total
    const theirs = this.player.hand.total
    const visible = this.playerVisibleTotal()
    let target = profile.standAt

    if (personality === 'cautious') {
      if (this.player.stayed) {
        const tooGreedy = theirs >= this.roundTarget - 3
        if (!tooGreedy) target = Math.max(target, Math.min(this.roundTarget, theirs + 1))
      }
    } else if (personality === 'gambler') {
      if (this.player.stayed) {
        if (theirs >= this.roundTarget - 3 && mine <= this.roundTarget - 5) target = this.roundTarget
        else if (theirs <= this.roundTarget - 5 && mine >= this.roundTarget - 4) target = mine
        else target = Math.max(target, Math.min(this.roundTarget, theirs + 1))
      } else if (mine < visible) {
        target = Math.max(target, Math.min(this.roundTarget, visible + 1))
      }
    } else {
      const risk = this.bustRisk()
      target += this.executionerAdjustment()
      if (risk > 0.62) target = Math.min(target, mine)
      else if (risk < 0.25) target = Math.max(target, this.roundTarget)
      else if (this.player.stayed) target = Math.max(target, Math.min(this.roundTarget, theirs + 1))
    }
    return Math.max(0, Math.min(this.roundTarget, target))
  }

  /** 玩家明牌点数（不含扣住的底牌） */
  private playerVisibleTotal(): number {
    const visible = this.player.hand.visible.filter((card): card is Card => card !== null)
    return evaluateHand(visible).total
  }

  /** 估计剩余牌堆里「再摸一张会爆」的概率，换算成停牌线的微调 */
  private executionerAdjustment(): number {
    const risk = this.bustRisk()
    if (risk > 0.62) return -3
    if (risk > 0.45) return -1
    if (risk < 0.25) return 1
    return 0
  }

  private bustRisk(): number {
    const total = this.roundTarget - this.boss.hand.total
    if (total <= 0) return 1
    let bust = 0
    let count = 0
    for (const card of this.deck) {
      count += 1
      if (card.rank > total) bust += 1
    }
    if (count === 0) return 0
    return bust / count
  }

  private dealTo(actor: ActorRuntime): void {
    const card = this.drawCard()
    let hand = evaluateHand([...actor.hand.cards, card], this.roundTarget)
    const revealed = actor.id === 'boss' ? this.holeRevealed : this.playerHoleRevealed
    if (!revealed && hand.cards.length >= 2) hand = withHoleCard(hand, true)
    actor.hand = hand
    this.dispatch({ type: 'cardDealt', actor: actor.id, card })
    // 双方的第 2 张起手牌都是暗牌，日志不能提前报出牌面
    const concealed = !revealed && actor.hand.cards.length === 2
    this.log(
      concealed
        ? `${actor.id === 'player' ? '你' : '它'}扣下一张暗牌。`
        : `${actorLabel(actor.id)}摸到 ${formatCard(card)}，${actor.hand.total} 点。`,
    )
    this.publish()
  }

  private drawCard(): Card {
    if (this.deck.length === 0) {
      throw new Error('Numeric deck exhausted inside a round')
    }
    const card = this.deck.pop()
    if (!card) throw new Error('Deck is unexpectedly empty')
    return card
  }

  private cylinderCapacity(): number {
    const levelGrowth = this.levelIndex * 2
    const roundGrowth = Math.floor(Math.max(0, this.round - 1) / 2)
    return Math.min(8, 2 + levelGrowth + roundGrowth)
  }

  private reloadCylinder(): Chamber[] {
    if (!this.cylinderRandomized) {
      const capacity = this.cylinderCapacity()
      if (capacity === 8) this.cylinderRandomized = true
      return this.cylinder.reload(capacity)
    }
    const total = 2 + Math.floor(this.rng() * 7)
    return this.cylinder.reload(total)
  }

  private ensureCylinder(): void {
    if (this.cylinder.remaining > 0) return
    const chambers = this.reloadCylinder()
    this.clearReveals()
    const live = chambers.filter((chamber) => chamber === 'live').length
    const blank = chambers.filter((chamber) => chamber === 'blank').length
    this.log(`弹仓打空，重新装填：${live} 实 ${blank} 空，顺序已打乱。`)
    this.dispatch({ type: 'reload', live, blank })
    const supply = this.currentLevel().reloadSupply ?? 0
    if (supply > 0) {
      this.giveSupply(this.player, supply)
      this.giveSupply(this.boss, supply)
    }
  }

  private unlockedItems(): ItemId[] {
    const unlocked: ItemId[] = []
    for (let i = 0; i <= this.levelIndex && i < LEVEL_UNLOCKS.length; i += 1) {
      const tier = LEVEL_UNLOCKS[i]
      if (!tier) continue
      for (const item of tier) {
        if (!unlocked.includes(item)) unlocked.push(item)
      }
    }
    return unlocked.length > 0 ? unlocked : [...ITEM_IDS]
  }

  private itemCount(actor: ActorRuntime, item: ItemId): number {
    let count = 0
    for (const held of actor.items) {
      if (held === item) count += 1
    }
    return count
  }

  private canHoldItem(actor: ActorRuntime, item: ItemId): boolean {
    return actor.items.length < MAX_ITEMS && this.itemCount(actor, item) < ITEM_CAP[item]
  }

  /** 只在还没拿满上限的类型里抽，所以池子永远抽不完 */
  private availableTypes(actor: ActorRuntime): ItemId[] {
    return this.unlockedItems().filter((item) => this.canHoldItem(actor, item))
  }

  private giveOne(actor: ActorRuntime): ItemId | null {
    const pool = this.availableTypes(actor)
    const item = pool[Math.floor(this.rng() * pool.length)] ?? null
    if (item === null) return null
    actor.items.push(item)
    this.dispatch({ type: 'itemDrawn', actor: actor.id, item })
    return item
  }

  private giveSupply(actor: ActorRuntime, count: number): void {
    const drawn: ItemId[] = []
    for (let i = 0; i < count; i += 1) {
      const item = this.giveOne(actor)
      if (item === null) break
      drawn.push(item)
    }
    if (drawn.length > 0) {
      this.log(
        `${actorLabel(actor.id)}获得补给：${drawn.map((item) => `【${ITEM_CATALOG[item].name}】`).join('')}。`,
      )
    }
    if (drawn.length < count) {
      this.log(`${actorLabel(actor.id)}的背包已满，剩下的补给留在桌上。`)
    }
  }

  private clearReveals(): void {
    this.revealedBy.player = null
    this.revealedBy.boss = null
  }

  private flipReveals(): void {
    if (this.revealedBy.player !== null) {
      this.revealedBy.player = this.revealedBy.player === 'live' ? 'blank' : 'live'
    }
    if (this.revealedBy.boss !== null) {
      this.revealedBy.boss = this.revealedBy.boss === 'live' ? 'blank' : 'live'
    }
  }

  private viewOf(actor: ActorRuntime): ActorView {
    const revealed = actor.id === 'boss' ? this.holeRevealed : this.playerHoleRevealed
    const hidden = !revealed && actor.hand.cards.length >= 2
    const hand = hidden ? withHoleCard(actor.hand, true) : actor.hand
    return {
      id: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      items: [...actor.items],
      hand: { ...actor.hand, cards: [...actor.hand.cards], visible: [...actor.hand.visible] },
      visibleHand: { ...hand, cards: [...hand.cards], visible: [...hand.visible] },
      holeCardRevealed: revealed,
      standing: actor.standing,
      stayed: actor.stayed,
      gunCuffed: actor.gunCuffed,
      trumps: [...actor.trumps],
      sawBoost: actor.sawBoost,
      itemsUsedThisTurn: actor.itemsUsedThisTurn,
    }
  }

  private currentLevel(): LevelConfig {
    const level = this.levelList[this.levelIndex] ?? this.levelList[0]
    if (!level) throw new Error('No level configuration available')
    return level
  }

  private log(message: string): void {
    this.logLines.push(message)
    if (this.logLines.length > LOG_LIMIT) {
      this.logLines.splice(0, this.logLines.length - LOG_LIMIT)
    }
  }

  private publish(): void {
    if (this.itemEvents) return
    const snapshot = this.getSnapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener({ type: 'state', snapshot }, snapshot)
      } catch (error) {
        console.error(error)
      }
    }
  }

  private dispatch(event: GameEvent): void {
    if (this.itemEvents) { this.itemEvents.push(event); return }
    const snapshot = this.getSnapshot()
    for (const listener of [...this.listeners]) {
      try {
        listener(event, snapshot)
      } catch (error) {
        console.error(error)
      }
    }
  }

  private lockInput(ms: number): void {
    if (ms <= 0) return
    this.clearInputDelay()
    this.inputLocked = true
    this.publish()
    const delay = this.track(new PausableDelay(ms, () => {
      this.inputDelay = null
      this.unlockInput()
    }))
    this.inputDelay = delay
    if (!this.paused) delay.start()
  }

  private unlockInput(): void {
    if (!this.inputLocked) return
    this.inputLocked = false
    this.publish()
  }

  private clearInputDelay(): void {
    if (this.inputDelay === null) return
    this.delays.delete(this.inputDelay)
    this.inputDelay.cancel()
    this.inputDelay = null
  }

  pause(): void {
    if (this.paused || this.destroyed) return
    this.paused = true
    for (const delay of this.delays) delay.pause()
    this.publish()
  }

  resume(): void {
    if (!this.paused || this.destroyed) return
    this.paused = false
    this.finishItemPresentation()
    for (const delay of this.delays) delay.resume()
    for (const resolve of this.resumeWaiters) resolve()
    this.resumeWaiters.clear()
    this.publish()
  }

  get isPaused(): boolean {
    return this.paused
  }

  private reject(message: string): false {
    this.dispatch({ type: 'notice', message })
    return false
  }

  private alive(token: number): boolean {
    return !this.destroyed && token === this.generation
  }

  private track(delay: PausableDelay): PausableDelay {
    this.delays.add(delay)
    return delay
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const delay = this.track(
        new PausableDelay(ms, () => {
          this.delays.delete(delay)
          resolve()
        }),
      )
      if (!this.paused) delay.start()
    })
  }

  private waitUntilResumed(): Promise<void> {
    if (!this.paused) return Promise.resolve()
    return new Promise<void>((resolve) => this.resumeWaiters.add(resolve))
  }

  /** 与 wait 相同，但允许玩家用 skipExecution() 提前放行 */
  private waitExecution(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = () => {
        if (this.executionDelay !== null) {
          this.delays.delete(this.executionDelay)
          this.executionDelay = null
        }
        this.executionSkip = null
        resolve()
      }
      const delay = this.track(
        new PausableDelay(ms, () => {
          this.executionDelay = null
          finish()
        }),
      )
      this.executionDelay = delay
      this.executionSkip = finish
      if (!this.paused) delay.start()
    })
  }

  private cancelTimers(): void {
    for (const delay of [...this.delays]) delay.cancel()
    this.delays.clear()
    this.inputDelay = null
    this.executionDelay = null
    this.executionSkip = null
    this.inputLocked = false
    this.itemPresentationPending = false
    this.itemPresentationFinished = false
    this.deferredItemEvents = []
  }
}
