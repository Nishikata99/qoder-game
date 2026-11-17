import './style.css'
import { BlackjackGame } from './games/blackjack'
import { BuckshotRouletteGame } from './games/buckshot-roulette'
import { TemplateMinigame } from './games/template-minigame'
import { CameraController, type CameraPresetId } from './core/CameraController'
import { EventBus } from './core/EventBus'
import { GameRegistry, type MinigameContext } from './core/GameRegistry'
import { GameStore } from './core/GameStore'
import { SceneManager } from './core/SceneManager'
import { HudOverlay } from './ui/HudOverlay'
import { LobbyOverlay, type LobbyGameEntry } from './ui/LobbyOverlay'

const viewport = document.querySelector<HTMLElement>('#viewport')
const hudRoot = document.querySelector<HTMLElement>('#hud-root')
const lobbyRoot = document.querySelector<HTMLElement>('#lobby-root')

if (!viewport || !hudRoot || !lobbyRoot) {
  throw new Error('缺少 #viewport / #hud-root / #lobby-root 挂载点')
}

const store = new GameStore()
const bus = new EventBus()
const sceneManager = new SceneManager(viewport)
const cameraController = new CameraController(sceneManager, sceneManager.camera)

const context: MinigameContext = { sceneManager, cameraController, store, bus }
const registry = new GameRegistry(context)
registry.register(new BlackjackGame(), new BuckshotRouletteGame(), new TemplateMinigame())

const games: LobbyGameEntry[] = [
  {
    id: 'blackjack',
    title: '21 点 · 黑杰克',
    blurb: '在桌面生成 3D 牌堆，实弹般的发牌节奏。爆牌者交出筹码。',
    status: 'ready',
  },
  {
    id: 'buckshot-roulette',
    title: '恶魔轮盘',
    blurb: '12 号霰弹枪与六发弹仓。实弹两滴血，空包弹只留下一声咔哒。',
    status: 'ready',
  },
  {
    id: 'template-minigame',
    title: '模板 · 骷髅骰盅',
    blurb: '最小可运行模组，复制即开工。成员 C/D 的接入参考实现。',
    status: 'wip',
  },
]

const hud = new HudOverlay(hudRoot, { store, bus })
const lobby = new LobbyOverlay(lobbyRoot, {
  store,
  games,
  presets: [
    { id: 'table', label: '俯视桌面' },
    { id: 'opponent', label: '平视对手' },
    { id: 'aim', label: '瞄准' },
  ],
  onSelectGame: (id) => {
    void registry.switchTo(id)
    lobby.hideLobby()
    cameraController.goto('table', 0.9)
  },
  onCameraPreset: (id: CameraPresetId) => cameraController.goto(id, 0.9),
  onRestart: () => {
    void registry.unmount()
    store.reset()
    cameraController.goto('opponent', 0.7)
    bus.emit('ui:subtitle', { text: '新的一局 · 记住底注的位置', duration: 2.6 })
  },
})

bus.on('fx:shake', ({ intensity, duration }) => sceneManager.triggerShake(intensity, duration))
bus.on('battle:result', ({ summary }) => bus.emit('ui:subtitle', { text: summary, duration: 3 }))

cameraController.snap('opponent')
sceneManager.onFrame((dt) => cameraController.update(dt))
sceneManager.start()

// 首屏预挂载一个模块，确保进入即见内容
void registry.mount('buckshot-roulette')

const teardown = () => {
  hud.dispose()
  lobby.dispose()
  bus.clear()
  sceneManager.dispose()
}
window.addEventListener('beforeunload', teardown)
