import gsap from 'gsap'
import type { EventBus } from '../core/EventBus'
import type { BattleState, GameStore, Side } from '../core/GameStore'

/**
 * 【HUD 层】屏幕边缘的半透明血量/道具/字幕。
 * 只读 GameStore 快照并订阅 EventBus，禁止直接操作 Three.js 对象。
 */
export interface HudOptions {
  store: GameStore
  bus: EventBus
  onUseItem?: (itemId: string) => void
}

const OPPONENT_ID = 'hud-opponent'
const PLAYER_ID = 'hud-player'

export class HudOverlay {
  private readonly root: HTMLElement
  private readonly store: GameStore
  private readonly bus: EventBus
  private readonly onUseItem?: (itemId: string) => void
  private unsubscribe: (() => void) | null = null
  private busOff: Array<() => void> = []
  private subtitleTimer = 0
  private readonly flashLayer: HTMLDivElement

  constructor(root: HTMLElement, options: HudOptions) {
    this.root = root
    this.store = options.store
    this.bus = options.bus
    this.onUseItem = options.onUseItem
    this.root.innerHTML = template()
    this.flashLayer = this.root.querySelector<HTMLDivElement>('#hud-flash')!

    this.unsubscribe = this.store.subscribe((state) => this.render(state))

    this.busOff.push(
      this.bus.on('ui:subtitle', ({ text, duration }) => this.showSubtitle(text, duration)),
      this.bus.on('fx:flash', ({ color }) => this.flash(color)),
      this.bus.on('battle:damage', ({ side, amount }) => this.pulseHp(side, amount)),
    )
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const off of this.busOff) off()
    this.busOff = []
    window.clearTimeout(this.subtitleTimer)
    this.root.innerHTML = ''
  }

  private render(state: Readonly<BattleState>): void {
    for (const side of ['opponent', 'player'] as const) {
      const id = side === 'player' ? PLAYER_ID : OPPONENT_ID
      const hp = state.hp[side]
      const maxHp = state.maxHp[side]
      const ratio = maxHp > 0 ? (hp / maxHp) * 100 : 0
      const card = this.root.querySelector<HTMLElement>(`#${id}`)
      if (!card) continue
      const fill = card.querySelector<HTMLElement>('.hp-fill')!
      const value = card.querySelector<HTMLElement>('.hp-value')!
      fill.style.width = `${Math.max(0, ratio)}%`
      value.textContent = `${hp}`
      card.dataset.turn = String(state.turn === side)
      card.classList.toggle('opacity-100', state.turn === side)
      card.classList.toggle('opacity-60', state.turn !== side)
    }

    const turnLabel = this.root.querySelector<HTMLElement>('#hud-turn')!
    turnLabel.textContent = state.turn === 'player' ? '你的回合' : '对手回合'
    turnLabel.classList.toggle('text-ante-blood-bright', state.turn === 'opponent')

    const roundLabel = this.root.querySelector<HTMLElement>('#hud-round')!
    roundLabel.textContent = `ROUND ${state.round}`

    const chipsValue = this.root.querySelector<HTMLElement>('#hud-chips')!
    chipsValue.textContent = `${state.chips}`

    const tray = this.root.querySelector<HTMLElement>('#hud-inventory')!
    tray.innerHTML = state.inventory
      .map(
        (item) => `
        <button type="button" class="inventory-slot" data-item="${item.id}" title="${item.name}">
          <span class="text-sm tracking-widest">${item.badge}</span>
          <span class="inventory-slot__qty">×${item.qty}</span>
        </button>`,
      )
      .join('')

    for (const button of tray.querySelectorAll<HTMLButtonElement>('.inventory-slot')) {
      button.addEventListener('click', () => {
        const id = button.dataset.item
        if (id) this.useItem(id)
      })
    }
  }

  private useItem(id: string): void {
    if (this.onUseItem) {
      this.onUseItem(id)
      return
    }
    const item = this.store.snapshot.inventory.find((entry) => entry.id === id)
    if (!item) return
    this.store.useItem(id)
    this.showSubtitle(`使用了 ${item.name}`, 1.8)
  }

  private showSubtitle(text: string, duration = 2.6): void {
    const caption = this.root.querySelector<HTMLElement>('#hud-subtitle')
    if (!caption) return
    caption.textContent = text
    window.clearTimeout(this.subtitleTimer)
    gsap.fromTo(
      caption,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' },
    )
    this.subtitleTimer = window.setTimeout(() => {
      gsap.to(caption, { opacity: 0, duration: 0.4, ease: 'power1.in' })
    }, duration * 1000)
  }

  private flash(color = '#ff3b2f'): void {
    gsap.fromTo(
      this.flashLayer,
      { opacity: 0.85, backgroundColor: color },
      { opacity: 0, duration: 0.55, ease: 'power2.out' },
    )
  }

  private pulseHp(side: Side, amount: number): void {
    const card = this.root.querySelector<HTMLElement>(side === 'player' ? `#${PLAYER_ID}` : `#${OPPONENT_ID}`)
    if (!card) return
    const tag = document.createElement('span')
    tag.textContent = `-${amount}`
    tag.className = 'absolute -top-1 right-2 text-ante-blood-bright text-sm font-bold'
    card.appendChild(tag)
    gsap.fromTo(tag, { opacity: 1, y: 0 }, { opacity: 0, y: -18, duration: 0.9, onComplete: () => tag.remove() })
  }
}

function template(): string {
  return `
    <div class="vignette pointer-events-none absolute inset-0"></div>
    <div class="scanlines pointer-events-none absolute inset-0 overflow-hidden"></div>
    <div id="hud-flash" class="flash-layer pointer-events-none absolute inset-0 opacity-0"></div>

    <div class="crosshair pointer-events-none"><span class="crosshair-dot"></span></div>

    <!-- 对手（上方） -->
    <div id="${OPPONENT_ID}"
      class="hud-panel absolute left-1/2 top-4 w-[min(92vw,30rem)] -translate-x-1/2 px-4 py-3 transition-opacity duration-500">
      <div class="flex items-center justify-between">
        <span class="tag-chip">对手 · 庄家</span>
        <span class="text-[0.7rem] tracking-[0.25em] text-ante-ash">THE HOUSE</span>
      </div>
      <div class="mt-2 flex items-center gap-3">
        <div class="hp-track h-2 flex-1 rounded-sm">
          <div class="hp-fill hp-fill--enemy h-full w-full"></div>
        </div>
        <span class="hp-value w-8 text-right text-lg leading-none text-ante-bone">12</span>
      </div>
    </div>

    <!-- 回合 / 底注 -->
    <div class="pointer-events-none absolute left-1/2 top-[7.6rem] -translate-x-1/2 text-center">
      <div id="hud-turn" class="text-[0.72rem] tracking-[0.32em] text-ante-bone">你的回合</div>
      <div class="mt-1 flex items-center justify-center gap-3 text-[0.62rem] tracking-[0.22em] text-ante-ash">
        <span id="hud-round">ROUND 1</span>
        <span class="h-3 w-px bg-ante-blood/60"></span>
        <span>筹码 <span id="hud-chips" class="text-ante-bone">10</span></span>
      </div>
    </div>

    <!-- 字幕 -->
    <div class="pointer-events-none absolute bottom-36 left-1/2 w-[min(90vw,42rem)] -translate-x-1/2 text-center">
      <p id="hud-subtitle" class="subtitle-caption text-sm text-ante-bone opacity-0"></p>
    </div>

    <!-- 玩家（下方） -->
    <div id="${PLAYER_ID}"
      class="hud-panel absolute bottom-4 left-1/2 w-[min(92vw,30rem)] -translate-x-1/2 px-4 py-3 transition-opacity duration-500">
      <div class="flex items-center justify-between">
        <span class="text-[0.7rem] tracking-[0.25em] text-ante-ash">YOU · 挑战者</span>
        <span class="tag-chip">你的血</span>
      </div>
      <div class="mt-2 flex items-center gap-3">
        <span class="hp-value w-8 text-lg leading-none text-ante-bone">12</span>
        <div class="hp-track h-2 flex-1 rounded-sm">
          <div class="hp-fill h-full w-full"></div>
        </div>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <span class="text-[0.62rem] tracking-[0.25em] text-ante-ash">道具栏</span>
        <div id="hud-inventory" class="flex gap-2"></div>
      </div>
    </div>
  `
}
