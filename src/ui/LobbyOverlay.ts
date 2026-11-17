import gsap from 'gsap'
import type { CameraPresetId } from '../core/CameraController'
import type { BattleState, GameStore, Side } from '../core/GameStore'

/**
 * 【2D 悬浮层】模式切换菜单 / 回合结算 / 镜头预设。
 * 与 3D 的唯一联系是回调：选游戏 → GameRegistry，切镜头 → CameraController。
 */
export interface LobbyGameEntry {
  id: string
  title: string
  blurb: string
  status: 'ready' | 'wip'
}

export interface LobbyOptions {
  store: GameStore
  games: LobbyGameEntry[]
  presets: Array<{ id: CameraPresetId; label: string }>
  onSelectGame: (id: string) => void
  onCameraPreset: (id: CameraPresetId) => void
  onRestart: () => void
}

interface SettlementInfo {
  title: string
  detail: string
  outcome: 'victory' | 'defeat' | 'draw'
}

export class LobbyOverlay {
  private readonly root: HTMLElement
  private readonly options: LobbyOptions
  private unsubscribe: (() => void) | null = null
  private lobbyVisible = true
  private settlementShown = false

  constructor(root: HTMLElement, options: LobbyOptions) {
    this.root = root
    this.options = options
    this.root.innerHTML = template(options.games, options.presets)
    this.bind()
    this.unsubscribe = options.store.subscribe((state) => this.syncWithStore(state))
    gsap.fromTo(
      this.root.querySelector('#lobby-panel'),
      { opacity: 0, y: 24 },
      { opacity: 1, y: 0, duration: 0.7, ease: 'power2.out' },
    )
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    window.removeEventListener('keydown', this.onKeyDown)
    this.root.innerHTML = ''
  }

  showLobby(): void {
    this.lobbyVisible = true
    this.root.querySelector('#btn-toggle-lobby')?.classList.add('hidden')
    const layer = this.root.querySelector<HTMLElement>('#lobby-layer')
    if (!layer) return
    layer.classList.remove('hidden')
    gsap.fromTo(layer, { opacity: 0 }, { opacity: 1, duration: 0.35 })
    gsap.fromTo(
      this.root.querySelector('#lobby-panel'),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
    )
  }

  hideLobby(): void {
    this.lobbyVisible = false
    this.root.querySelector('#btn-toggle-lobby')?.classList.remove('hidden')
    const layer = this.root.querySelector<HTMLElement>('#lobby-layer')
    if (!layer) return
    gsap.to(layer, {
      opacity: 0,
      duration: 0.3,
      onComplete: () => layer.classList.add('hidden'),
    })
  }

  toggleLobby(): void {
    if (this.lobbyVisible) this.hideLobby()
    else this.showLobby()
  }

  showSettlement(info: SettlementInfo): void {
    const modal = this.root.querySelector<HTMLElement>('#settlement-layer')
    const card = this.root.querySelector<HTMLElement>('#settlement-card')
    if (!modal || !card) return
    if (this.settlementShown) return
    this.settlementShown = true

    const titleEl = card.querySelector<HTMLElement>('#settlement-title')!
    const detailEl = card.querySelector<HTMLElement>('#settlement-detail')!
    const outcomeEl = card.querySelector<HTMLElement>('#settlement-outcome')!

    titleEl.textContent = info.title
    detailEl.textContent = info.detail
    outcomeEl.textContent =
      info.outcome === 'victory' ? 'YOU SURVIVED' : info.outcome === 'defeat' ? 'YOU BLED OUT' : 'STALEMATE'
    outcomeEl.className =
      info.outcome === 'victory'
        ? 'tag-chip text-ante-bone border-ante-blood-bright/70'
        : 'tag-chip text-ante-blood-bright border-ante-blood-bright/70'

    modal.classList.remove('hidden')
    gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.3 })
    gsap.fromTo(
      card,
      { opacity: 0, scale: 0.92, y: 18 },
      { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.5)' },
    )
  }

  hideSettlement(): void {
    const modal = this.root.querySelector<HTMLElement>('#settlement-layer')
    if (!modal) return
    this.settlementShown = false
    gsap.to(modal, {
      opacity: 0,
      duration: 0.25,
      onComplete: () => modal.classList.add('hidden'),
    })
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.game
        if (!id) return
        this.highlightGame(id)
        this.options.onSelectGame(id)
      })
    })

    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        const preset = button.dataset.preset as CameraPresetId | undefined
        if (!preset) return
        this.highlightPreset(preset)
        this.options.onCameraPreset(preset)
      })
    })

    this.root.querySelector('#btn-toggle-lobby')?.addEventListener('click', () => this.toggleLobby())
    this.root.querySelector('#btn-close-lobby')?.addEventListener('click', () => this.hideLobby())
    this.root.querySelector('#btn-restart')?.addEventListener('click', () => {
      this.hideSettlement()
      this.options.onRestart()
    })
    this.root.querySelector('#btn-restart-modal')?.addEventListener('click', () => {
      this.hideSettlement()
      this.options.onRestart()
    })
    this.root.querySelector('#btn-settlement-continue')?.addEventListener('click', () => {
      this.hideSettlement()
      this.showLobby()
    })

    window.addEventListener('keydown', this.onKeyDown)
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' || event.code === 'Tab') {
      event.preventDefault()
      this.toggleLobby()
    }
  }

  private syncWithStore(state: Readonly<BattleState>): void {
    const toggle = this.root.querySelector<HTMLElement>('#btn-toggle-lobby')
    toggle?.classList.toggle('hidden', this.lobbyVisible)

    if (state.hp.player > 0 && state.hp.opponent > 0) return
    if (this.settlementShown) return

    const outcome: Side | 'draw' =
      state.hp.player <= 0 && state.hp.opponent <= 0 ? 'draw' : state.hp.player <= 0 ? 'opponent' : 'player'

    this.showSettlement({
      title: outcome === 'player' ? '对手倒下了' : outcome === 'opponent' ? '你的血牌见底' : '两败俱伤',
      detail:
        outcome === 'player'
          ? '庄家的筹码与血一并留在了这张桌上。下一局的底注会更高。'
          : '血迹在绒布上晕开。重开一局，或者换一个模块复盘。',
      outcome: outcome === 'player' ? 'victory' : outcome === 'opponent' ? 'defeat' : 'draw',
    })
  }

  private highlightGame(id: string): void {
    this.root.querySelectorAll<HTMLElement>('[data-game]').forEach((el) => {
      el.classList.toggle('is-selected', el.dataset.game === id)
      el.setAttribute('aria-pressed', String(el.dataset.game === id))
    })
  }

  private highlightPreset(id: CameraPresetId): void {
    this.root.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) => {
      el.classList.toggle('btn-ante--active', el.dataset.preset === id)
    })
  }
}

function template(games: LobbyGameEntry[], presets: Array<{ id: CameraPresetId; label: string }>): string {
  const cards = games
    .map(
      (game) => `
      <button type="button" class="menu-card" data-game="${game.id}" aria-pressed="false">
        <div class="flex items-center justify-between gap-2">
          <span class="font-display text-base tracking-[0.14em] text-ante-bone">${game.title}</span>
          <span class="tag-chip ${game.status === 'ready' ? 'text-ante-bone/80' : 'text-ante-blood-bright/90'}">
            ${game.status === 'ready' ? 'READY' : 'WIP'}
          </span>
        </div>
        <p class="mt-2 text-[0.72rem] leading-relaxed text-ante-ash">${game.blurb}</p>
      </button>`,
    )
    .join('')

  const presetButtons = presets
    .map(
      (preset) => `
      <button type="button" class="btn-ante" data-preset="${preset.id}">${preset.label}</button>`,
    )
    .join('')

  return `
    <div id="lobby-layer" class="pointer-events-none absolute inset-0">
      <div class="lobby-vignette absolute inset-0"></div>
      <div class="relative flex h-full items-center justify-center px-5">
        <div id="lobby-panel" class="pointer-events-auto w-[min(94vw,54rem)]">
          <header class="text-center">
            <p class="text-[0.62rem] tracking-[0.5em] text-ante-blood-bright/80">FIRST PERSON · TABLE OF BLOOD</p>
            <h1 class="mt-3 font-display text-4xl tracking-[0.22em] text-ante-bone sm:text-5xl">
              BLOOD&nbsp;ANTE
            </h1>
            <p class="mt-2 text-xs tracking-[0.42em] text-ante-ash">血 色 底 注</p>
          </header>

          <section class="mt-8 grid gap-3 sm:grid-cols-3">${cards}</section>

          <section class="mt-7 flex flex-col items-center gap-4">
            <div class="flex flex-wrap items-center justify-center gap-2">
              <span class="tag-chip">视角预设</span>
              ${presetButtons}
            </div>
            <div class="flex flex-wrap items-center justify-center gap-3">
              <button type="button" id="btn-close-lobby" class="btn-ante">进入赌桌</button>
              <button type="button" id="btn-restart" class="btn-ante">重置对局</button>
            </div>
            <p class="text-center text-[0.65rem] leading-relaxed tracking-[0.2em] text-ante-ash/80">
              <kbd class="border border-ante-ash/30 px-1">Esc</kbd> / <kbd class="border border-ante-ash/30 px-1">Tab</kbd>
              呼出菜单 · 鼠标移动轻微带动视线
            </p>
          </section>
        </div>
      </div>
    </div>

    <button type="button" id="btn-toggle-lobby" class="btn-ante absolute right-4 top-[8.6rem] z-30 hidden !px-3 !py-1.5 !text-[0.65rem]">菜单</button>

    <div id="settlement-layer" class="pointer-events-auto absolute inset-0 z-40 hidden">
      <div class="lobby-vignette absolute inset-0"></div>
      <div class="relative flex h-full items-center justify-center px-6">
        <div id="settlement-card" class="modal-panel w-[min(92vw,32rem)] px-7 py-8 text-center">
          <span id="settlement-outcome" class="tag-chip">RESULT</span>
          <h2 id="settlement-title" class="mt-4 font-display text-2xl tracking-[0.16em] text-ante-bone">对局结束</h2>
          <p id="settlement-detail" class="mt-3 text-sm leading-relaxed text-ante-ash"></p>
          <div class="mt-7 flex items-center justify-center gap-3">
            <button type="button" id="btn-settlement-continue" class="btn-ante">返回菜单</button>
            <button type="button" id="btn-restart-modal" class="btn-ante hidden">再来一局</button>
          </div>
        </div>
      </div>
    </div>
  `
}
