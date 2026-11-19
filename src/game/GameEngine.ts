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
  | 'gameOver'
  | 'victory'

export const CARD_SUITS = ['spade', 'heart', 'diamond', 'club'] as const
export type CardSuit = (typeof CARD_SUITS)[number]

export type CardRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

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
  readonly soft: boolean
  readonly busted: boolean
  readonly blackjack: boolean
}

export type Chamber = 'live' | 'blank'

export const ITEM_IDS = [
  'magnifier',
  'sedative',
  'saw',
  'magnet',
  'handcuffs',
  'hourglass',
  'dagger',
] as const

export type ItemId = (typeof ITEM_IDS)[number]

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
    summary: '窥视当前枪膛内下一发是实弹还是空弹。知道空膛时，开枪阶段可对自己开枪换取道具。',
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
    summary: '锯短枪管：实弹伤害翻倍。加成一直保留到真正打出实弹为止。',
    glyph: '⌁',
  },
  magnet: {
    id: 'magnet',
    name: '磁铁',
    summary: '强制将你最后一张明牌与对手的明牌互换。',
    glyph: '⊂',
  },
  handcuffs: {
    id: 'handcuffs',
    name: '手铐',
    summary: '锁住对手的下一次行动：不能要牌，也不能使用道具。',
    glyph: '∞',
  },
  hourglass: {
    id: 'hourglass',
    name: '逆转沙漏',
    summary: '本局胜负反转：点数更小者获胜（爆牌依然直接判负）。仅玩家可用。',
    glyph: '⧗',
  },
  dagger: {
    id: 'dagger',
    name: '献祭匕首',
    summary: '自损 1 点生命，立刻清空手牌、重洗牌库并重新装填弹仓。',
    glyph: '†',
  },
}

/** Items unlocked at the start of each level, in level order. */
export const LEVEL_UNLOCKS: readonly (readonly ItemId[])[] = [
  ['magnifier', 'sedative', 'saw'],
  ['magnet', 'handcuffs'],
  ['hourglass', 'dagger'],
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
  readonly supply: number
  readonly personality: BossPersonality
}

export const LEVELS: readonly LevelConfig[] = [
  {
    id: 1,
    name: '锈蚀看门人',
    title: '门厅 · 滴水的地下室',
    hp: 6,
    playerHp: 7,
    supply: 2,
    personality: 'cautious',
  },
  {
    id: 2,
    name: '赌命收账人',
    title: '账房 · 发霉的赌桌',
    hp: 8,
    playerHp: 6,
    supply: 3,
    personality: 'gambler',
  },
  {
    id: 3,
    name: '深渊执刑者',
    title: '刑台 · 没有出口',
    hp: 9,
    playerHp: 7,
    supply: 4,
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
  readonly skipTurn: boolean
  readonly sawBoost: number
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
  /** 本局实弹伤害加成（走火遗恨，中弹后清零） */
  readonly damageBonus: number
  /** 已累积的走火层数，等于 damageBonus，供 UI 区分「遗恨」与「基础」 */
  readonly crisisStacks: number
  /** 本局是否启用逆转沙漏（点数小者胜） */
  readonly hourglassActive: boolean
  readonly unlockedItems: readonly ItemId[]
  readonly inputLocked: boolean
  readonly log: readonly string[]
}

export type GameEvent =
  | { readonly type: 'state'; readonly snapshot: GameSnapshot }
  | { readonly type: 'notice'; readonly message: string }
  | { readonly type: 'roundStart'; readonly level: number; readonly round: number }
  | { readonly type: 'cardDealt'; readonly actor: ActorId; readonly card: Card }
  | { readonly type: 'turn'; readonly actor: ActorId }
  | { readonly type: 'turnSkipped'; readonly actor: ActorId }
  | { readonly type: 'bust'; readonly actor: ActorId }
  | { readonly type: 'itemDrawn'; readonly actor: ActorId; readonly item: ItemId }
  | {
      readonly type: 'itemUsed'
      readonly actor: ActorId
      readonly item: ItemId
      readonly detail: string
    }
  | { readonly type: 'chamberRevealed'; readonly actor: ActorId; readonly chamber: Chamber }
  | { readonly type: 'chamberDiscarded'; readonly actor: ActorId; readonly chamber: Chamber }
  | { readonly type: 'magnetSwap'; readonly actor: ActorId; readonly card: Card }
  | { readonly type: 'chamberRecovered'; readonly actor: ActorId; readonly item: ItemId }
  | { readonly type: 'hourglass'; readonly actor: ActorId }
  | { readonly type: 'daggerReshuffle'; readonly actor: ActorId; readonly live: number; readonly blank: number }
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
      readonly blackjack: boolean
    }
  | { readonly type: 'tie'; readonly player: number; readonly boss: number }
  | { readonly type: 'reload'; readonly live: number; readonly blank: number }
  | { readonly type: 'levelClear'; readonly level: number }
  | {
      readonly type: 'lootUnlocked'
      readonly level: number
      readonly items: readonly ItemId[]
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
  readonly itemBudget: number
  readonly thinkingMs: number
}

const BOSS_PROFILES: Readonly<Record<BossPersonality, BossProfile>> = {
  cautious: { label: '谨慎', personality: 'cautious', standAt: 15, itemBudget: 1, thinkingMs: 900 },
  gambler: { label: '赌徒', personality: 'gambler', standAt: 17, itemBudget: 3, thinkingMs: 720 },
  executioner: { label: '算牌', personality: 'executioner', standAt: 19, itemBudget: 4, thinkingMs: 620 },
}

const MAX_ITEMS = 8
const LOG_LIMIT = 80
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
  for (let rank = 1; rank <= 10; rank += 1) {
    for (const suit of CARD_SUITS) {
      cards.push({ id: `${suit}-${rank}`, rank: rank as CardRank, suit })
    }
  }
  return cards
}

export function formatRank(rank: CardRank): string {
  return rank === 1 ? 'A' : String(rank)
}

export function formatCard(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${formatRank(card.rank)}`
}

/**
 * Aces count as 11 whenever that keeps the hand at or below 21, otherwise as 1.
 * `soft` stays true while an ace is still being counted as 11.
 */
export function evaluateHand(cards: readonly Card[]): HandState {
  let hardTotal = 0
  let aces = 0
  for (const card of cards) {
    if (card.rank === 1) {
      aces += 1
    } else {
      hardTotal += card.rank
    }
  }
  let total = hardTotal + aces * 11
  let softAces = aces
  while (total > 21 && softAces > 0) {
    total -= 10
    softAces -= 1
  }
  return {
    cards: [...cards],
    visible: [...cards],
    total,
    soft: softAces > 0,
    busted: total > 21,
    blackjack: cards.length === 2 && total === 21,
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
  standing = false
  skipTurn = false
  sawBoost = 0

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

  reload(): Chamber[] {
    // 装 4~6 发、实弹 2~3 发：实弹率约五成，一枪定生死但不至于一局打完还在空响
    const total = 4 + Math.floor(this.rng() * 3)
    const maxLive = Math.min(3, total - 1)
    const liveCount = 2 + Math.floor(this.rng() * (maxLive - 1))
    const chambers: Chamber[] = []
    for (let i = 0; i < liveCount; i += 1) chambers.push('live')
    for (let i = 0; i < total - liveCount; i += 1) chambers.push('blank')
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
}

function actorLabel(id: ActorId): string {
  return id === 'player' ? '你' : '它'
}

/**
 * Pure-TypeScript blackjack duel state machine.
 * No DOM, Three.js or audio dependencies: the host wires sounds off `GameEvent`s.
 */
export class GameEngine {
  private readonly rng: RandomSource
  private readonly levelList: readonly LevelConfig[]
  private readonly dealDelay: number
  private readonly thinkOverride: number | null
  private readonly dealLockMs: number
  private readonly itemLockMs: number
  private inputUnlockTimer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<GameEventListener>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly cylinder: Cylinder

  private generation = 0
  private destroyed = false
  private started = false
  private phase: Phase = 'idle'
  private levelIndex = 0
  private round = 0
  private player: ActorRuntime = new ActorRuntime('player', 0)
  private boss: ActorRuntime = new ActorRuntime('boss', 0)
  private deck: Card[] = []
  private revealed: Chamber | null = null
  private damageBonus = 0
  private pendingShot: ActorId = 'player'
  private hourglassActive = false
  private holeRevealed = false
  private inputLocked = false
  private logLines: string[] = []

  constructor(options: GameEngineOptions = {}) {
    this.rng = options.rng ?? Math.random
    this.levelList = options.levels && options.levels.length > 0 ? [...options.levels] : LEVELS
    this.dealDelay = Math.max(0, options.dealDelayMs ?? 240)
    this.thinkOverride =
      options.thinkDelayMs === undefined ? null : Math.max(0, options.thinkDelayMs)
    this.dealLockMs = Math.max(0, options.dealLockMs ?? 620)
    this.itemLockMs = Math.max(0, options.itemLockMs ?? 460)
    this.cylinder = new Cylinder(this.rng)
    this.log('深渊在呼吸。锈蚀的轮盘正在等待一笔交易。')
  }

  start(): void {
    if (this.destroyed || this.started) return
    this.started = true
    this.generation += 1
    this.logLines = []
    this.log('你坐下，牌桌另一端的影子抬起头。')
    void this.beginLevel(0, this.generation)
  }

  restart(): void {
    if (this.destroyed) return
    this.generation += 1
    this.cancelTimers()
    this.started = false
    this.phase = 'idle'
    this.levelIndex = 0
    this.round = 0
    this.player = new ActorRuntime('player', 0)
    this.boss = new ActorRuntime('boss', 0)
    this.deck = []
    this.revealed = null
    this.damageBonus = 0
    this.pendingShot = 'player'
    this.hourglassActive = false
    this.holeRevealed = false
    this.logLines = []
    this.publish()
    this.start()
  }

  hit(): boolean {
    if (this.phase !== 'playerTurn') {
      return this.reject('现在不是你的回合。')
    }
    if (this.inputLocked) {
      return this.reject('上一张牌还在飞。')
    }
    this.dealTo(this.player)
    if (this.player.hand.busted) {
      this.dispatch({ type: 'bust', actor: 'player' })
      this.log('你爆牌了。手指停在半空。')
      this.player.standing = true
      this.phase = 'bossTurn'
      this.publish()
      void this.runBossTurn(this.generation)
    } else if (this.player.hand.total === 21) {
      this.player.standing = true
      this.log('21 点。你选择停牌。')
      this.phase = 'bossTurn'
      this.publish()
      void this.runBossTurn(this.generation)
    } else {
      this.lockInput(this.dealLockMs)
    }
    return true
  }

  stand(): boolean {
    if (this.phase !== 'playerTurn') {
      return this.reject('现在不是你的回合。')
    }
    if (this.inputLocked) {
      return this.reject('动作还没结束。')
    }
    this.player.standing = true
    this.log(`你停牌在 ${this.player.hand.total} 点。`)
    this.phase = 'bossTurn'
    this.publish()
    void this.runBossTurn(this.generation)
    return true
  }

  useItem(item: ItemId): boolean {
    if (this.phase !== 'playerTurn') {
      return this.reject('现在不是使用道具的时机。')
    }
    if (this.inputLocked) {
      return this.reject('动作还没结束。')
    }
    if (!this.applyItem(this.player, item)) return false
    if (this.resolveDeaths()) return true
    this.lockInput(this.itemLockMs)
    return true
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
        revealed: this.revealed,
      },
      turn:
        this.phase === 'playerTurn'
          ? 'player'
          : this.phase === 'bossTurn'
            ? 'boss'
            : null,
      pendingShot: this.phase === 'targeting' ? this.pendingShot : null,
      damageBonus: this.damageBonus,
      crisisStacks: this.damageBonus,
      hourglassActive: this.hourglassActive,
      unlockedItems: this.unlockedItems(),
      inputLocked: this.inputLocked,
      log: [...this.logLines],
    }
  }

  destroy(): void {
    this.destroyed = true
    this.generation += 1
    this.cancelTimers()
    this.listeners.clear()
  }

  private async beginLevel(index: number, token: number): Promise<void> {
    if (!this.alive(token)) return
    this.levelIndex = index
    this.phase = 'reloading'
    this.round = 0
    this.damageBonus = 0
    this.hourglassActive = false
    this.holeRevealed = false
    this.revealed = null
    this.pendingShot = 'player'
    const level = this.currentLevel()
    this.player = new ActorRuntime('player', level.playerHp)
    this.boss = new ActorRuntime('boss', level.hp)
    this.giveSupply(this.player, level.supply)
    this.giveSupply(this.boss, level.supply)
    const chambers = this.cylinder.reload()
    this.log(`—— 第 ${index + 1} 层 · ${level.title} ——`)
    this.log(`「${level.name}」把一枚生锈的转轮推到你面前。`)
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
    this.phase = 'dealing'
    this.revealed = null
    this.pendingShot = 'player'
    // 走火遗恨是「永久叠加」的，直到有人真的中弹才清零，因此这里不重置
    this.hourglassActive = false
    this.holeRevealed = false
    this.player.hand = evaluateHand([])
    this.player.standing = false
    this.boss.hand = evaluateHand([])
    this.boss.standing = false
    this.ensureCylinder()
    this.deck = shuffle(createDeck(), this.rng)
    this.log(`—— 第 ${this.round} 回合 ——`)
    if (this.damageBonus > 0) {
      this.log(`走火遗恨未散：本回合实弹伤害 +${this.damageBonus}。`)
    }
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

    // 对手第 2 张牌扣住，玩家看不到；点数额照旧
    this.boss.hand = withHoleCard(this.boss.hand, !this.holeRevealed)

    if (this.player.hand.blackjack) {
      this.log('黑杰克。你的实弹将额外造成 1 点伤害。')
    }
    if (this.boss.hand.blackjack) {
      this.log('它摸到了黑杰克，指关节在灯下泛白。')
    }
    this.publish()

    if (this.player.skipTurn) {
      this.player.skipTurn = false
      this.player.standing = true
      this.log('手铐仍锁着你的手腕，本回合你无法行动。')
      this.dispatch({ type: 'turnSkipped', actor: 'player' })
      this.phase = 'bossTurn'
      this.publish()
      await this.wait(650)
      if (!this.alive(token)) return
      void this.runBossTurn(token)
      return
    }

    this.phase = 'playerTurn'
    this.dispatch({ type: 'turn', actor: 'player' })
    this.publish()
  }

  private async runBossTurn(token: number): Promise<void> {
    const profile = BOSS_PROFILES[this.currentLevel().personality]
    const think = this.thinkOverride ?? profile.thinkingMs
    await this.wait(think)
    if (!this.alive(token) || this.phase !== 'bossTurn') return
    this.dispatch({ type: 'turn', actor: 'boss' })
    this.publish()

    if (this.boss.skipTurn) {
      this.boss.skipTurn = false
      this.boss.standing = true
      this.log('手铐崩紧——它本回合无法摸牌。')
      this.dispatch({ type: 'turnSkipped', actor: 'boss' })
      this.publish()
      await this.wait(600)
      if (!this.alive(token)) return
      void this.settleRound(token)
      return
    }

    const used = new Set<ItemId>()
    for (let i = 0; i < profile.itemBudget; i += 1) {
      const item = this.chooseBossItem(used)
      if (!item) break
      used.add(item)
      this.log(`「${this.currentLevel().name}」从大衣里摸出一件东西。`)
      this.publish()
      await this.wait(Math.max(180, think * 0.6))
      if (!this.alive(token) || this.phase !== 'bossTurn') return
      if (!this.applyItem(this.boss, item)) break
      if (this.resolveDeaths()) return
      await this.wait(Math.max(160, think * 0.4))
      if (!this.alive(token) || this.phase !== 'bossTurn') return
    }

    while (this.alive(token) && this.phase === 'bossTurn' && !this.boss.hand.busted) {
      const target = this.bossTarget(profile, profile.personality)
      if (this.boss.hand.total >= target) break
      await this.wait(Math.max(160, think * 0.55))
      if (!this.alive(token) || this.phase !== 'bossTurn') return
      this.dealTo(this.boss)
    }

    if (this.boss.hand.busted) {
      this.dispatch({ type: 'bust', actor: 'boss' })
      this.log('它爆牌了，喉咙里滚出一声低笑。')
    }
    this.boss.standing = true
    this.log(`「${this.currentLevel().name}」停牌在 ${this.boss.hand.total} 点。`)
    this.publish()
    await this.wait(450)
    if (!this.alive(token)) return
    void this.settleRound(token)
  }

  private async settleRound(token: number): Promise<void> {
    if (!this.alive(token)) return
    this.phase = 'resolving'
    // 结算时亮出底牌
    const wasHidden = !this.holeRevealed
    this.holeRevealed = true
    this.boss.hand = withHoleCard(this.boss.hand, false)
    if (wasHidden) {
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
    // 爆牌永远直接判负，沙漏不改变这一点
    if (this.player.hand.busted && this.boss.hand.busted) {
      winner = null
    } else if (this.player.hand.busted) {
      winner = 'boss'
    } else if (this.boss.hand.busted) {
      winner = 'player'
    } else if (playerTotal === bossTotal) {
      winner = null
    } else {
      const playerHigher = playerTotal > bossTotal
      // 逆转沙漏：点数更小者获胜
      const playerWins = this.hourglassActive ? !playerHigher : playerHigher
      winner = playerWins ? 'player' : 'boss'
    }

    if (winner === null) {
      if (this.player.hand.busted && this.boss.hand.busted) {
        this.log(`双方同时爆牌（${playerTotal} 对 ${bossTotal}），这一枪没人开。`)
      } else {
        this.log(`走火危机：双方都停在 ${playerTotal} 点，这一枪没人开。`)
      }
      const mine = this.giveRandomItem(this.player)
      const theirs = this.giveRandomItem(this.boss)
      if (mine) this.log(`你从桌下摸到了【${ITEM_CATALOG[mine].name}】。`)
      if (theirs) this.log(`它也摸到了【${ITEM_CATALOG[theirs].name}】。`)
      // 永久叠加，直到有人中弹才清零
      this.damageBonus += 1
      this.log(`轮盘发出空转的咔哒声。走火遗恨 +1，此后实弹伤害 +${this.damageBonus}。`)
      this.dispatch({ type: 'tie', player: playerTotal, boss: bossTotal })
      this.publish()
      this.phase = 'roundEnd'
      await this.wait(1600)
      if (!this.alive(token)) return
      void this.startRound(token)
      return
    }

    // 赢家拿到枪，由它决定枪口朝向：对手，或者自己
    this.pendingShot = winner
    this.phase = 'targeting'
    this.publish()

    if (winner === 'boss') {
      await this.wait(760)
      if (!this.alive(token) || this.phase !== 'targeting') return
      const target = this.chooseBossTarget()
      this.log(`「${this.currentLevel().name}」把枪口对准${target === 'boss' ? '自己' : '你'}。`)
      this.publish()
      await this.resolveShot(this.boss, target === 'boss' ? this.boss : this.player, token)
    }
  }

  /** 处决阶段：持枪者选择枪口。只有玩家持枪时才能调用。 */
  chooseTarget(target: ActorId): boolean {
    if (this.phase !== 'targeting') {
      return this.reject('现在不是决定枪口的时候。')
    }
    if (this.pendingShot !== 'player') {
      return this.reject('枪在它手里。')
    }
    void this.resolveShot(this.player, target === 'player' ? this.player : this.boss, this.generation)
    return true
  }

  private async resolveShot(attacker: ActorRuntime, target: ActorRuntime, token: number): Promise<void> {
    if (!this.alive(token) || this.phase !== 'targeting') return
    const selfShot = attacker === target
    this.ensureCylinder()
    const sawed = attacker.sawBoost > 0
    const blackjack = attacker.hand.blackjack && !attacker.hand.busted
    const chamber = this.cylinder.current ?? 'blank'
    // 高牌奖励：赢下本轮且手牌 ≥20 点才算「碾压」。
    // 原来用点差 ≥5，但 AI 停牌线决定了第 2/3 关几乎不可能打出这个点差，等于死条款。
    const overwhelmed = !attacker.hand.busted && attacker.hand.total >= 20

    this.phase = 'execution'
    this.hourglassActive = false
    this.pendingShot = 'player'
    this.publish()
    this.dispatch({
      type: 'execution',
      by: attacker.id,
      target: target.id,
      chamber,
      lethal: chamber === 'live',
    })
    await this.wait(2900)
    if (!this.alive(token)) return

    this.cylinder.fire()
    this.revealed = null
    // 基础 2 点；黑杰克 +1；碾压（手牌 ≥20）+1；走火遗恨 +N；锯子整体翻倍
    const stacks = this.damageBonus
    const base = 2 + (blackjack ? 1 : 0) + (overwhelmed ? 1 : 0) + stacks
    const damage = chamber === 'live' ? (sawed ? base * 2 : base) : 0
    let reward: ItemId | null = null
    if (chamber === 'live') {
      target.hp = Math.max(0, target.hp - damage)
      // 有人真的中弹了，走火遗恨清零；锯子的加成也只在实弹时耗尽
      this.damageBonus = 0
      attacker.sawBoost = 0
    } else if (selfShot) {
      // 空膛对己：弹壳掉进黑暗，换回一件道具
      reward = this.giveRandomItem(attacker)
    }

    const who = actorLabel(attacker.id)
    const victim = selfShot ? '自己' : actorLabel(target.id)
    if (chamber === 'live') {
      const tags: string[] = []
      if (blackjack) tags.push('黑杰克')
      if (overwhelmed) tags.push('碾压')
      if (sawed) tags.push('锯短枪管')
      if (stacks > 0) tags.push(`走火遗恨 +${stacks}`)
      const tag = tags.length > 0 ? `（${tags.join(' · ')}）` : ''
      this.log(`${who}扣下扳机：实弹${tag}。${victim}承受 ${damage} 点伤害。`)
    } else if (reward) {
      this.log(`${who}把枪口对准${victim}：空膛。捡回一枚空弹，摸到【${ITEM_CATALOG[reward].name}】。`)
    } else {
      this.log(`${who}扣下扳机：空膛。只有撞针的脆响。`)
    }
    this.dispatch({
      type: 'shot',
      by: attacker.id,
      target: target.id,
      chamber,
      damage,
      sawed,
      blackjack,
    })
    if (reward) {
      this.dispatch({ type: 'chamberRecovered', actor: attacker.id, item: reward })
    }
    this.publish()
    await this.wait(1500)
    if (!this.alive(token)) return
    if (this.resolveDeaths()) return

    this.phase = 'roundEnd'
    this.publish()
    await this.wait(900)
    if (!this.alive(token)) return
    void this.startRound(token)
  }

  /** 对手的枪口选择：已知空膛且道具槽没满就对自己开枪换道具，否则打玩家 */
  private chooseBossTarget(): ActorId {
    if (this.revealed === 'blank' && this.boss.items.length < MAX_ITEMS) return 'boss'
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
        void this.autoAdvance(this.generation)
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

  private async autoAdvance(token: number): Promise<void> {
    await this.wait(4200)
    if (!this.alive(token) || this.phase !== 'levelClear') return
    this.log('你推开下一道生锈的铁门。')
    void this.beginLevel(this.levelIndex + 1, token)
  }

  private applyItem(actor: ActorRuntime, item: ItemId): boolean {
    const index = actor.items.indexOf(item)
    if (index === -1) {
      return this.reject(`${actorLabel(actor.id)}没有【${ITEM_CATALOG[item].name}】。`)
    }
    const foe = actor.id === 'player' ? this.boss : this.player
    let detail: string | null = null

    switch (item) {
      case 'magnifier': {
        this.ensureCylinder()
        const chamber = this.cylinder.current
        if (!chamber) return this.reject('弹仓里空无一物。')
        this.revealed = chamber
        detail = chamber === 'live' ? '窥见实弹。' : '窥见空膛。'
        this.dispatch({ type: 'chamberRevealed', actor: actor.id, chamber })
        break
      }
      case 'sedative': {
        if (actor.hp >= actor.maxHp) return this.reject('生命已经满了。')
        actor.hp = Math.min(actor.maxHp, actor.hp + 1)
        detail = `生命恢复至 ${actor.hp}/${actor.maxHp}。`
        break
      }
      case 'saw': {
        if (actor.sawBoost > 0) return this.reject('枪管已经锯短了。')
        actor.sawBoost = 1
        detail = '枪管被锯短，本局实弹伤害翻倍。'
        break
      }
      case 'magnet': {
        const mine = actor.hand.cards
        const theirs = foe.hand.cards
        // 必须拿「明牌」交换：对手的明牌是第 1 张（第 2 张是暗牌），玩家没有暗牌取最后一张
        const mineIndex = actor.id === 'boss' ? 0 : mine.length - 1
        const foeIndex = foe.id === 'boss' ? 0 : theirs.length - 1
        if (mineIndex < 0 || foeIndex < 0) return this.reject('桌上没有可以互换的明牌。')
        const myCard = mine[mineIndex]
        const foeCard = theirs[foeIndex]
        if (!myCard || !foeCard) return this.reject('桌上没有可以互换的明牌。')
        const mineNext = [...mine]
        const foeNext = [...theirs]
        mineNext[mineIndex] = foeCard
        foeNext[foeIndex] = myCard
        actor.hand = evaluateHand(mineNext)
        foe.hand = evaluateHand(foeNext)
        // 原明牌已被换走，底牌必须亮出，否则桌面信息会自相矛盾
        this.holeRevealed = true
        this.boss.hand = withHoleCard(this.boss.hand, false)
        detail = `磁铁换走了对手的明牌，当前 ${this.player.hand.total} 对 ${this.boss.hand.total}。`
        this.dispatch({ type: 'magnetSwap', actor: actor.id, card: foeCard })
        break
      }
      case 'handcuffs': {
        if (foe.skipTurn) return this.reject('对手已经被锁住了。')
        foe.skipTurn = true
        detail = `${actorLabel(foe.id)}下一次行动被跳过。`
        break
      }
      case 'hourglass': {
        if (this.hourglassActive) return this.reject('沙漏已经在逆转了。')
        this.hourglassActive = true
        detail = '沙漏倒转：本局点数更小者获胜，爆牌依然直接判负。'
        this.dispatch({ type: 'hourglass', actor: actor.id })
        break
      }
      case 'dagger': {
        if (actor.hp <= 1) return this.reject('生命不足以献祭。')
        actor.hp -= 1
        // 手牌作废后必须立刻重发，否则 0 点对 0 点会让回合卡死
        this.deck = shuffle(createDeck(), this.rng)
        this.player.hand = evaluateHand([])
        this.boss.hand = evaluateHand([])
        this.player.standing = false
        this.boss.standing = false
        this.holeRevealed = false
        for (let pass = 0; pass < 2; pass += 1) {
          this.dealTo(this.player)
          this.dealTo(this.boss)
        }
        this.boss.hand = withHoleCard(this.boss.hand, true)
        const chambers = this.cylinder.reload()
        this.revealed = null
        const live = chambers.filter((chamber) => chamber === 'live').length
        const blank = chambers.filter((chamber) => chamber === 'blank').length
        detail = `献出 1 点生命。手牌重发为 ${this.player.hand.total} 对 ${this.boss.hand.total}，弹仓重装 ${live} 实 ${blank} 空。`
        this.dispatch({ type: 'daggerReshuffle', actor: actor.id, live, blank })
        break
      }
      default: {
        detail = null
      }
    }

    if (detail === null) return false
    actor.items.splice(index, 1)
    this.log(`${actorLabel(actor.id)}使用了【${ITEM_CATALOG[item].name}】。${detail}`)
    this.dispatch({ type: 'itemUsed', actor: actor.id, item, detail })
    this.publish()
    return true
  }

  private chooseBossItem(used: ReadonlySet<ItemId>): ItemId | null {
    const me = this.boss
    const foe = this.player
    const personality = this.currentLevel().personality
    const has = (id: ItemId): boolean => me.items.includes(id) && !used.has(id)
    const liveRate = this.liveRate()
    const loses = this.wouldLose()
    const behind = me.hand.total < foe.hand.total
    // 锯子会一直保留到打出实弹，重复使用会被引擎拒绝并浪费整轮预算
    const canSaw = me.sawBoost === 0

    // ---- 胆小看守者：保守保命 ----
    if (personality === 'cautious') {
      if (has('sedative') && me.hp < me.maxHp) return 'sedative'
      if (canSaw && has('saw') && liveRate > 0.7 && me.hand.total >= 15 && !loses) return 'saw'
      if (has('magnifier') && this.revealed === null && this.cylinder.remaining <= 2) {
        return 'magnifier'
      }
      if (has('handcuffs') && !foe.skipTurn && foe.hand.total >= 18) return 'handcuffs'
      return null
    }

    // ---- 狂热老千：激进赌徒 ----
    if (personality === 'gambler') {
      if (has('sedative') && me.hp < me.maxHp) return 'sedative'
      if (has('handcuffs') && !foe.skipTurn && !foe.hand.busted) return 'handcuffs'
      if (has('magnet') && behind && foe.hand.total >= 8) return 'magnet'
      if (canSaw && has('saw') && me.hand.total >= 16 && liveRate >= 0.4) return 'saw'
      if (has('magnifier') && this.revealed === null) return 'magnifier'
      return null
    }

    // ---- 机械典狱长：冷酷算牌 ----
    // 沙漏是玩家专属：Boss 落后时开沙漏再立刻停牌等于一键必胜，玩家无从补救
    // 下一发必为实弹且自己大概率输牌 → 用匕首强行续命
    if (has('dagger') && this.cylinder.remaining > 0 && liveRate >= 1 && loses && me.hp > 1) {
      return 'dagger'
    }
    if (has('sedative') && me.hp < me.maxHp) return 'sedative'
    if (has('handcuffs') && !foe.skipTurn && !foe.hand.busted && foe.hand.total >= 16) {
      return 'handcuffs'
    }
    if (has('magnet') && behind && foe.hand.total >= 9) return 'magnet'
    if (canSaw && has('saw') && me.hand.total >= 17 && !loses && liveRate > 0.5) return 'saw'
    if (has('magnifier') && this.revealed === null) return 'magnifier'
    return null
  }

  /** 剩余弹仓中实弹的比例，供 AI 判断锯枪收益 */
  private liveRate(): number {
    const remaining = this.cylinder.remaining
    if (remaining <= 0) return 0
    return this.cylinder.liveRemaining / remaining
  }

  private wouldLose(): boolean {
    if (this.boss.hand.busted) return true
    if (this.player.hand.busted) return false
    const mine = this.boss.hand.total
    const theirs = this.player.hand.total
    if (mine === theirs) return false
    const higher = mine > theirs
    // 沙漏生效时，点数小者赢
    return this.hourglassActive ? higher : !higher
  }

  private bossTarget(profile: BossProfile, personality: BossPersonality): number {
    if (this.player.hand.busted) return 0
    let target = profile.standAt

    // 狂热老千：点数低于玩家明牌时，即使 17 点也继续要牌
    if (personality === 'gambler' && !this.player.standing) {
      const playerVisible = this.playerVisibleTotal()
      if (this.boss.hand.total < playerVisible) {
        target = Math.max(target, Math.min(21, playerVisible + 1))
      }
    }
    // 机械典狱长：按剩余牌堆的爆牌概率粗调停牌线（±1~3），不是逐张精算
    if (personality === 'executioner') {
      target += this.executionerAdjustment()
    }
    if (this.player.standing) {
      // 谨慎的看守者不敢追高分：玩家停牌在 18 点以上时它直接认输，不硬摸
      const tooGreedy = personality === 'cautious' && this.player.hand.total + 1 > 18
      if (!tooGreedy) target = Math.max(target, Math.min(21, this.player.hand.total + 1))
    }
    // 沙漏生效时点数小者胜：再摸一张只会把自己推高，立即停牌才是最优
    if (this.hourglassActive && !this.player.hand.busted) return 0
    return target
  }

  /** 玩家明牌点数（不含扣住的底牌） */
  private playerVisibleTotal(): number {
    const visible = this.player.hand.visible.filter((card): card is Card => card !== null)
    return evaluateHand(visible).total
  }

  /** 估计剩余牌堆里「再摸一张会爆」的概率，换算成停牌线的微调 */
  private executionerAdjustment(): number {
    const total = 21 - this.boss.hand.total
    if (total <= 0) return 0
    let bust = 0
    let count = 0
    for (const card of this.deck) {
      count += 1
      if (card.rank > total) bust += 1
    }
    if (count === 0) return 0
    const risk = bust / count
    if (risk > 0.62) return -3
    if (risk > 0.45) return -1
    if (risk < 0.25) return 1
    return 0
  }

  private dealTo(actor: ActorRuntime): void {
    const card = this.drawCard()
    actor.hand = evaluateHand([...actor.hand.cards, card])
    this.dispatch({ type: 'cardDealt', actor: actor.id, card })
    // 对手的第二张牌是暗牌，日志不能报点数
    const concealed = actor.id === 'boss' && !this.holeRevealed && actor.hand.cards.length === 2
    this.log(
      concealed
        ? '它扣下一张暗牌。'
        : `${actorLabel(actor.id)}摸到 ${formatCard(card)}，${actor.hand.total} 点${actor.hand.soft ? '（软牌）' : ''}。`,
    )
    this.publish()
  }

  private drawCard(): Card {
    if (this.deck.length === 0) {
      this.deck = shuffle(createDeck(), this.rng)
      this.log('牌靴见底，发牌人重新洗牌。')
    }
    const card = this.deck.pop()
    if (!card) throw new Error('Deck is unexpectedly empty')
    return card
  }

  private ensureCylinder(): void {
    if (this.cylinder.remaining > 0) return
    const chambers = this.cylinder.reload()
    this.revealed = null
    const live = chambers.filter((chamber) => chamber === 'live').length
    const blank = chambers.filter((chamber) => chamber === 'blank').length
    this.log(`弹仓打空，重新装填：${live} 实 ${blank} 空，顺序已打乱。`)
    this.dispatch({ type: 'reload', live, blank })
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

  private giveSupply(actor: ActorRuntime, count: number): void {
    const pool = shuffle(this.unlockedItems(), this.rng)
    const drawn: ItemId[] = []
    for (let i = 0; i < count && i < pool.length; i += 1) {
      const item = pool[i]
      if (!item) continue
      if (actor.items.length >= MAX_ITEMS) break
      actor.items.push(item)
      drawn.push(item)
      this.dispatch({ type: 'itemDrawn', actor: actor.id, item })
    }
    if (drawn.length > 0) {
      this.log(
        `${actorLabel(actor.id)}获得补给：${drawn.map((item) => `【${ITEM_CATALOG[item].name}】`).join('')}。`,
      )
    }
  }

  private giveRandomItem(actor: ActorRuntime): ItemId | null {
    if (actor.items.length >= MAX_ITEMS) return null
    const pool = this.unlockedItems()
    const item = pool[Math.floor(this.rng() * pool.length)]
    if (!item) return null
    actor.items.push(item)
    this.dispatch({ type: 'itemDrawn', actor: actor.id, item })
    return item
  }

  private viewOf(actor: ActorRuntime): ActorView {
    const hidden = actor.id === 'boss' && !this.holeRevealed && this.boss.hand.cards.length >= 2
    const hand = hidden ? withHoleCard(this.boss.hand, true) : actor.hand
    return {
      id: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      items: [...actor.items],
      hand: { ...actor.hand, cards: [...actor.hand.cards], visible: [...actor.hand.visible] },
      visibleHand: { ...hand, cards: [...hand.cards], visible: [...hand.visible] },
      holeCardRevealed: actor.id === 'boss' ? this.holeRevealed : true,
      standing: actor.standing,
      skipTurn: actor.skipTurn,
      sawBoost: actor.sawBoost,
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
    this.clearInputLockTimer()
    this.inputLocked = true
    this.publish()
    this.inputUnlockTimer = setTimeout(() => {
      this.inputUnlockTimer = null
      this.unlockInput()
    }, ms)
  }

  private unlockInput(): void {
    if (!this.inputLocked) return
    this.inputLocked = false
    this.publish()
  }

  private clearInputLockTimer(): void {
    if (this.inputUnlockTimer === null) return
    clearTimeout(this.inputUnlockTimer)
    this.inputUnlockTimer = null
  }

  private reject(message: string): false {
    this.dispatch({ type: 'notice', message })
    return false
  }

  private alive(token: number): boolean {
    return !this.destroyed && token === this.generation
  }

  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const id = setTimeout(() => {
        this.timers.delete(id)
        resolve()
      }, Math.max(0, ms))
      this.timers.add(id)
    })
  }

  private cancelTimers(): void {
    for (const id of this.timers) clearTimeout(id)
    this.timers.clear()
    this.clearInputLockTimer()
    this.inputLocked = false
  }
}
