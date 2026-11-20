import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ITEM_ICON, ORGANS, ORGAN_NAMES, PENALTY_ITEMS, type ItemId, type Side } from './content'
import type { Cell, PlayerView, Snapshot } from './engine'
import type { CellLayer, CellVisual } from './textures'
import { MoyanTextures, WET_ALPHA } from './textures'
import { paintPixelArt } from '../scene/PixelArt'

const TABLE_TOP = 0.98
const TILE = 0.255
const PITCH = 0.28
const TILE_THICK = 0.006
const TILE_BASE = TABLE_TOP + 0.016
const BOARD_EXTENT = PITCH * 7
const BOARD_Z = -0.55
const SLOT_Z = 0.62
const AI_SLOT_Z = -1.72
// 与 itemCap 的最大值一致（胃在时 3，失去胃后上限降为 1）
const SLOT_COUNT = 3
const FLIP_DELAY = 0.24
const FLIP_TIME = 0.62
const FLIP_LIFT = 0.15
const CLOSE_DIST = 0.42
const CLOSE_HEIGHT = 0.46
const CLOSE_HOLD = 0.16
const ORGAN_HOLD = 0.45
const ITEM_HOLD = 0.3
const SHOT_GAP = 0.35
const SWAP_TIME = 0.3
const FLASH_TIME = 0.55
const SEEP_TIME = 0.72
const WASH_TIME = 0.85
const ROT_TIME = 1.1
const FLIGHT_TIME = 0.72
// 镜头整体右移，给右侧两台电视让出画面宽度（纯平移，牌桌在画面上左移约 3%）
const CAMERA_POS = new THREE.Vector3(0.14, 3.58, 3.4)
const LOOK_AT = new THREE.Vector3(0.14, 1.34, -0.25)
const CRT_DEPTH = 0.62
const CRT_LIFT = 0.012
const CRT_MODEL = 1.0
const CRT_W = 256
const CRT_H = 192
const CRT_SCALE = 2
// 电视投影在 NDC 上的右边界（1 = 屏幕右缘），留一点余量避免贴边
const CRT_NDC_LIMIT = 0.95

interface CrtAnchor {
  readonly x: number
  readonly z: number
  readonly yaw: number
  readonly scale: number
}

// 两台都摆桌面右侧、朝左并略微向内侧倾斜。牌垫右缘在 x≈1.23，玩家那台锚点 x 要到 1.8
// 机身内角才完全退出牌垫；AI 那台退到牌垫后沿之外，只在 z 方向和牌垫错开
const CRT_ANCHORS: Readonly<Record<Side, CrtAnchor>> = {
  ai: { x: 1.50, z: -2.02, yaw: -0.46, scale: 0.98 },
  player: { x: 1.80, z: 0.30, yaw: -0.42, scale: 0.98 },
}

export interface TileHover {
  readonly r: number
  readonly c: number
  readonly clientX: number
  readonly clientY: number
}

export interface SlotHover {
  readonly side: Side
  readonly index: number
  readonly clientX: number
  readonly clientY: number
}

export interface SceneCallbacks {
  readonly onTileClick: (r: number, c: number) => void
  readonly onTileHover: (hover: TileHover | null) => void
  readonly onSlotClick: (side: Side, index: number) => void
  readonly onSlotHover: (hover: SlotHover | null) => void
  /** 牌真正开始翻转（跳过 FLIP_DELAY）时触发，带上该牌的翻牌时长。 */
  readonly onFlipStart?: (flipTime: number) => void
  /** 一格被清毒（肝变回未翻牌，或注射器抽走来源格）时触发。 */
  readonly onCleanse?: () => void
}

type SeepDir = 'up' | 'down' | 'left' | 'right' | 'center'

type SeepMode = 'fill' | 'wash'

interface SeepState {
  /** 多个可导电邻居可同时向这张牌渗入 */
  readonly sources: readonly SeepDir[]
  readonly mode: SeepMode
  readonly duration: number
  /** 道具牌洗完保留一层很淡的液体膜 */
  readonly keep: boolean
  readonly layer: CellLayer
  /** 漫过牌面的液体层（纯液体，不带毒液牌面贴图） */
  readonly liquid: HTMLCanvasElement
  /** 多方向并集遮罩：白 = 液体已到达的区域 */
  readonly mask: HTMLCanvasElement
  readonly maskCtx: CanvasRenderingContext2D
  readonly maskImage: ImageData
  /** 按遮罩裁好的液体/毒液层 */
  readonly overlay: HTMLCanvasElement
  readonly overlayCtx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly key: string
  t: number
}

interface RotState {
  readonly layer: CellLayer
  readonly texture: THREE.CanvasTexture
  readonly seeds: ReadonlyArray<readonly [number, number, number]>
  readonly key: string
  t: number
}

// 一次翻牌要连带播放的效果：毒液渗入、器官坏死、道具飞进背包
interface RevealFx {
  readonly dirs: readonly SeepDir[]
  readonly mode: SeepMode
  readonly rot: boolean
  readonly fly: Side | null
  readonly item: ItemId | null
}

interface Flight {
  readonly sprite: THREE.Sprite
  readonly material: THREE.SpriteMaterial
  readonly from: THREE.Vector3
  readonly to: THREE.Vector3
  readonly side: Side
  readonly item: ItemId
  t: number
}

interface TileEntry {
  readonly group: THREE.Group
  readonly top: THREE.MeshStandardMaterial
  readonly bottom: THREE.MeshStandardMaterial
  readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly flash: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly sheen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly r: number
  readonly c: number
  readonly restY: number
  key: string
  visual: CellVisual | null
  queued: boolean
  hovered: boolean
  pulse: number
  flashT: number
  glowOn: boolean
  flipT: number | null
  flipTime: number
  flipVisual: CellVisual | null
  swapT: number
  swapVisual: CellVisual | null
  pendingFx: RevealFx | null
  pendingRot: boolean
  seep: SeepState | null
  rot: RotState | null
}

interface FlipShot {
  readonly tile: TileEntry
  timer: number
}

type LiverCuePhase = 'in' | 'flashOn' | 'hold' | 'out' | 'flashOff'

interface LiverCue {
  phase: LiverCuePhase
  t: number
  readonly fromPos: THREE.Vector3
  readonly fromLook: THREE.Vector3
}

const LIVER_IN_TIME = 0.55
const LIVER_HOLD_TIME = 1
const LIVER_OUT_TIME = 0.6
const CRT_FLASH_TIME = 0.16

// 玩家显示器的屏幕中心与法线（局部 0, 0.605, 0.302 换算到世界）
function crtScreenPoint(side: Side): { pos: THREE.Vector3; normal: THREE.Vector3 } {
  const anchor = CRT_ANCHORS[side]
  const localZ = 0.302 * anchor.scale
  const sin = Math.sin(anchor.yaw)
  const cos = Math.cos(anchor.yaw)
  return {
    pos: new THREE.Vector3(
      anchor.x + localZ * sin,
      TABLE_TOP + CRT_LIFT + 0.605 * anchor.scale,
      anchor.z + localZ * cos,
    ),
    normal: new THREE.Vector3(sin, 0, cos),
  }
}

const LIVER_SCREEN = crtScreenPoint('player')
const LIVER_CRT_LOOK = LIVER_SCREEN.pos.clone()
const LIVER_CRT_POS = LIVER_SCREEN.pos
  .clone()
  .addScaledVector(LIVER_SCREEN.normal, 1.02)
  .add(new THREE.Vector3(0, 0.03, 0))

interface FlipJob {
  readonly tile: TileEntry
}

function flipTimeFor(visual: CellVisual): number {
  return visual.kind === 'organ' || (visual.kind === 'wall' && visual.organ !== null) ? FLIP_TIME * 1.12 : FLIP_TIME
}

function holdFor(visual: CellVisual): number {
  if (visual.kind === 'organ') return ORGAN_HOLD
  if (visual.kind === 'item' || visual.kind === 'heart') return ITEM_HOLD
  if (visual.kind === 'wall') return CLOSE_HOLD + 0.12
  return CLOSE_HOLD
}

function accentOf(visual: CellVisual): number {
  switch (visual.kind) {
    case 'cleared':
      return 0x7fe08a
    case 'back':
      return 0x9fd8e0
    case 'wall':
      return 0xe0b44c
    case 'organ':
      return 0x9a76e8
    default:
      return 0xe8cc6a
  }
}

interface TokenEntry {
  readonly side: Side
  readonly index: number
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  key: string
  pulse: number
}

interface SlotInfo {
  readonly item: ItemId | null
  readonly enabled: boolean
}

function slotKey(side: Side, index: number): string {
  return `${side}-${index}`
}

interface CrtUnit {
  readonly side: Side
  readonly canvas: HTMLCanvasElement
  readonly texture: THREE.CanvasTexture
  readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  readonly light: THREE.PointLight
  group: THREE.Group
  key: string
  focus: boolean
  flashing: boolean
  view: PlayerView
}

const DEFAULT_VIEW: PlayerView = {
  organs: { lung: true, liver: true, kidney: true, stomach: true },
  walls: { lung: 0, liver: 0, kidney: 0, stomach: 0 },
  items: [],
  lungLeft: 2,
  weakenedThisTurn: false,
  itemCap: 3,
  turnCount: 0,
}

function crtKeyOf(view: PlayerView): string {
  const organs = ORGANS.map((organ) => (view.organs[organ] ? 1 : 0)).join('')
  const walls = ORGANS.map((organ) => view.walls[organ]).join('')
  return `${organs}|${walls}|${view.items.join(',')}|${view.itemCap}|${view.lungLeft}|${
    view.weakenedThisTurn ? 1 : 0
  }`
}

// 翻牌旋转曲线：起手带冲量、末速归零，前半快后半慢，和甩牌音效的节奏一致
// h'(0)=1.6、h'(1)=0，h(1)=1
function flipEase(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * (1.6 - 0.2 * x - 0.4 * x * x)
}

// 液面推进的前沿折线：沿入口边铺开，带两条不同频率的起伏
function seepFrontPoints(
  size: number,
  dir: Exclude<SeepDir, 'center'>,
  progress: number,
  time: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = []
  const steps = 18
  const over = 26
  const base = -over + progress * (size + over * 2)
  for (let i = 0; i <= steps; i += 1) {
    const along = (i / steps) * size
    const wobble =
      (Math.sin(along * 0.052 + time * 7) * 9 + Math.sin(along * 0.019 - time * 2.6) * 13) *
      (1 - progress * 0.55)
    const depth = base + wobble
    if (dir === 'up') points.push([along, depth])
    else if (dir === 'down') points.push([along, size - depth])
    else if (dir === 'left') points.push([depth, along])
    else points.push([size - depth, along])
  }
  return points
}

// 每面墙的坏死斑块位置固定，同一格两次出现也长得一样
function rotSeedsFor(r: number, c: number): Array<readonly [number, number, number]> {
  let seed = (r * 977 + c * 613 + 37) % 10007
  const next = (): number => {
    seed = (seed * 7919 + 104729) % 100003
    return seed / 100003
  }
  const seeds: Array<readonly [number, number, number]> = []
  for (let i = 0; i < 8; i += 1) {
    seeds.push([38 + next() * 180, 34 + next() * 168, 16 + next() * 30])
  }
  return seeds
}

function visualOf(cell: Cell, halfTurn: number): CellVisual {
  if (!cell.revealed) return { kind: 'back', heart: cell.type === 'heart' }
  if (cell.cleared) return { kind: 'cleared' }
  if (cell.wallUntil > halfTurn) {
    return { kind: 'wall', organ: cell.type === 'organ' ? cell.organ : null }
  }
  if (cell.type === 'heart') return { kind: 'heart' }
  if (cell.type === 'organ' && cell.organ) return { kind: 'organ', organ: cell.organ }
  if (cell.type === 'item' && cell.item) return { kind: 'item', item: cell.item }
  return { kind: 'venom', source: cell.type === 'source' }
}

function visualKey(visual: CellVisual): string {
  return JSON.stringify(visual)
}

function tuneModel(root: THREE.Object3D, dim: number): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.multiplyScalar(material.vertexColors ? dim : dim * 0.6)
      if (material.metalness > 0.55) material.metalness = 0.55
      if (material.roughness < 0.3) material.roughness = 0.3
    }
  })
}

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone()
  })
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) material.dispose()
  })
  root.removeFromParent()
}

export class MoyanScene {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  // 固定默认机位，用于布局收敛；不能拿实时相机算，翻牌特写推进时会把电视误判成越界
  private readonly fitCamera = new THREE.PerspectiveCamera(38, 1, 0.05, 60)
  private readonly textures = new MoyanTextures()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly tiles: TileEntry[] = []
  private readonly tileMeshes: THREE.Mesh[] = []
  private readonly tokens: TokenEntry[] = []
  private readonly aiTokens: TokenEntry[] = []
  private readonly slotMeshes: THREE.Mesh[] = []
  private readonly slotInfo = new Map<string, SlotInfo>()
  private readonly callbacks: SceneCallbacks
  private readonly loader = new GLTFLoader()
  private readonly disposable: Array<{ dispose: () => void }> = []
  private readonly resizeObserver: ResizeObserver
  private readonly crtUnits: CrtUnit[] = []
  private bossModel: THREE.Object3D | null = null
  private readonly cameraLook = new THREE.Vector3().copy(LOOK_AT)
  private readonly shotPos = new THREE.Vector3()
  private readonly shotLook = new THREE.Vector3()
  private shot: FlipShot | null = null
  private readonly flipQueue: FlipJob[] = []
  private shotCooldown = 0
  private liverCue: LiverCue | null = null
  private liverArmed = false
  private liverWanted = false
  private idleTime = 0
  private gameId = -1
  private lastFrame = performance.now()
  private frame = 0
  private elapsed = 0
  private disposed = false
  private hoveredKey: string | null = null
  private hoveredSlot: string | null = null
  private readonly flights: Flight[] = []
  private readonly inFlight: Record<Side, ItemId | null> = { player: null, ai: null }
  private readonly rotCache = new Map<string, THREE.CanvasTexture>()

  constructor(
    private readonly container: HTMLElement,
    callbacks: SceneCallbacks,
  ) {
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.scene.background = new THREE.Color(0x050907)
    this.scene.fog = new THREE.FogExp2(0x050907, 0.055)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60)
    this.camera.position.copy(CAMERA_POS)
    this.camera.lookAt(LOOK_AT)
    this.fitCamera.position.copy(CAMERA_POS)
    this.fitCamera.lookAt(LOOK_AT)
    this.fitCamera.updateMatrixWorld(true)

    this.buildCrtUnits()

    this.buildLighting()
    this.buildBoard()
    this.buildSlots()
    this.loadModels()

    const resize = (): void => this.resize()
    this.resizeObserver = new ResizeObserver(resize)
    this.resizeObserver.observe(container)
    window.addEventListener('resize', resize)
    this.disposable.push({ dispose: () => window.removeEventListener('resize', resize) })

    this.bindPointer()
    this.resize()
    this.animate()
  }

  setSnapshot(snapshot: Snapshot): void {
    if (snapshot.gameId !== this.gameId) {
      this.gameId = snapshot.gameId
      this.flipQueue.length = 0
      this.shot = null
      this.shotCooldown = 0
      this.idleTime = 0
      this.liverCue = null
      this.liverArmed = false
      this.liverWanted = false
      for (const unit of this.crtUnits) {
        unit.key = ''
        unit.focus = false
        unit.flashing = false
        unit.view = DEFAULT_VIEW
      }
      for (const tile of this.tiles) {
        this.cancelSeep(tile)
        this.cancelRot(tile)
        tile.pendingFx = null
        tile.pendingRot = false
        tile.sheen.visible = false
        tile.key = ''
        tile.visual = null
        tile.queued = false
        tile.flipT = null
        tile.flipVisual = null
        tile.swapT = 0
        tile.swapVisual = null
        tile.flashT = 0
        tile.flash.visible = false
        tile.pulse = 0
        tile.group.rotation.x = 0
        tile.group.position.y = tile.restY
        tile.group.scale.setScalar(1)
        tile.bottom.map = null
        tile.bottom.needsUpdate = true
      }
      for (const token of this.tokens) token.key = ''
      for (const token of this.aiTokens) token.key = ''
      this.clearFlights()
      this.inFlight.player = null
      this.inFlight.ai = null
      for (const texture of this.rotCache.values()) texture.dispose()
      this.rotCache.clear()
    }

    const legal = new Set(snapshot.legal.map((key) => `${key.r}-${key.c}`))
    const targets = new Set(snapshot.targets.map((key) => `${key.r}-${key.c}`))
    const picked = snapshot.picked ? `${snapshot.picked.r}-${snapshot.picked.c}` : null
    const peek = snapshot.peek ? `${snapshot.peek.r}-${snapshot.peek.c}` : null

    for (const tile of this.tiles) {
      const cell = snapshot.board[tile.r]?.[tile.c]
      if (!cell) continue
      const visual = visualOf(cell, snapshot.halfTurn)
      const key = visualKey(visual)
      if (key !== tile.key) {
        this.cancelSeep(tile)
        this.cancelRot(tile)
        const isBack = visual.kind === 'back'
        const wasBack = tile.key === visualKey({ kind: 'back', heart: cell.type === 'heart' })
        const fresh = !isBack && (tile.key === '' || wasBack)
        const fly = fresh && visual.kind === 'item' && !PENALTY_ITEMS.includes(visual.item) ? snapshot.turn : null
        // 器官翻开时引擎先广播“器官牌”、随后才补上坏死墙。第二次变化属于同一次翻开，
        // 要沿用已经排队的特效，否则墙的翻牌就什么都不播了
        const carried = tile.pendingFx
        const prevVisual = tile.visual
        const refining =
          carried !== null &&
          prevVisual?.kind === 'organ' &&
          visual.kind === 'wall' &&
          visual.organ === prevVisual.organ
        tile.pendingFx = refining
          ? { ...carried, rot: true }
          : fresh || visual.kind === 'venom'
            ? {
                dirs: this.seepDirsFor(snapshot, tile.r, tile.c),
                mode: visual.kind === 'venom' ? 'fill' : 'wash',
                rot: fresh && visual.kind === 'wall' && visual.organ !== null,
                fly,
                item: visual.kind === 'item' ? visual.item : null,
              }
            : null
        if (fly && visual.kind === 'item') this.inFlight[fly] = visual.item
        if (tile.key === '') {
          this.paintTop(tile, visual)
        } else if (tile.queued) {
          if (isBack || visual.kind === 'cleared') {
            this.cancelQueue(tile)
            this.flipInPlace(tile, visual)
          } else {
            tile.visual = visual
          }
        } else if (tile.flipT !== null) {
          if (this.shot?.tile === tile) {
            tile.visual = visual
            tile.flipVisual = visual
            tile.flipTime = flipTimeFor(visual)
            tile.bottom.map = this.textures.get(visual)
            tile.bottom.needsUpdate = true
            this.shot.timer = Math.max(this.shot.timer, FLIP_DELAY + tile.flipTime + holdFor(visual))
          } else {
            this.flipInPlace(tile, visual)
          }
        } else if (wasBack && !isBack) {
          this.enqueueFlip(tile, visual)
        } else if (visual.kind === 'cleared' || isBack) {
          this.flipInPlace(tile, visual)
        } else {
          this.swapTop(tile, visual)
        }
        tile.key = key
      }
      const id = `${tile.r}-${tile.c}`
      let glowColor: number | null = null
      if (legal.has(id)) glowColor = 0x63d16a
      if (targets.has(id)) glowColor = 0xe0b44c
      if (picked === id) glowColor = 0x5fc6df
      if (peek === id) glowColor = 0xa47ad0
      const glowMat = tile.glow.material
      tile.glowOn = glowColor !== null
      if (glowColor !== null) glowMat.color.setHex(glowColor)
    }

    this.syncTokens(this.tokens, snapshot.players.player.items)
    this.syncTokens(this.aiTokens, snapshot.players.ai.items)
    this.syncSlots(snapshot)

    const liver = snapshot.pending?.kind === 'liver'
    if (liver && !this.liverWanted) this.liverArmed = true
    if (!liver && this.liverWanted) {
      this.liverArmed = false
      const cue = this.liverCue
      if (cue && (cue.phase === 'in' || cue.phase === 'flashOn' || cue.phase === 'hold')) {
        this.liverCue = { phase: 'out', t: 0, fromPos: this.camera.position.clone(), fromLook: this.cameraLook.clone() }
      }
    }
    this.liverWanted = liver

    for (const unit of this.crtUnits) {
      const view = snapshot.players[unit.side]
      unit.view = view
      const key = crtKeyOf(view)
      // 闪屏/特写期间画面由镜头序列接管，等它自己切回来再跟随快照
      if (unit.flashing) {
        unit.key = key
        continue
      }
      if (unit.focus) {
        unit.key = `${key}|L`
        continue
      }
      if (key === unit.key) continue
      unit.key = key
      this.paintCrt(unit, view)
    }
  }

  private paintTop(tile: TileEntry, visual: CellVisual): void {
    tile.visual = visual
    tile.top.map = this.textures.get(visual)
    tile.top.needsUpdate = true
    tile.bottom.map = null
    tile.bottom.needsUpdate = true
    tile.flipT = null
    tile.group.rotation.x = 0
    tile.group.position.y = tile.restY
    tile.pendingFx = null
  }

  private enqueueFlip(tile: TileEntry, visual: CellVisual): void {
    tile.visual = visual
    if (tile.queued) return
    tile.queued = true
    this.flipQueue.push({ tile })
  }

  private cancelQueue(tile: TileEntry): void {
    if (!tile.queued) return
    tile.queued = false
    const index = this.flipQueue.findIndex((job) => job.tile === tile)
    if (index >= 0) this.flipQueue.splice(index, 1)
  }

  private flipInPlace(tile: TileEntry, visual: CellVisual): void {
    tile.visual = visual
    tile.flipVisual = visual
    tile.swapT = 0
    tile.swapVisual = null
    tile.pendingFx = null
    tile.bottom.map = this.textures.get(visual)
    tile.bottom.color.setHex(0xffffff)
    tile.bottom.needsUpdate = true
    if (tile.flipT !== null) return
    if (visual.kind === 'cleared' || visual.kind === 'back') this.callbacks.onCleanse?.()
    tile.flipTime = flipTimeFor(visual)
    tile.flipT = 0
    tile.group.rotation.x = 0
  }

  private startShot(tile: TileEntry): void {
    tile.queued = false
    const visual = tile.visual
    if (!visual) return
    tile.flipVisual = visual
    tile.flipTime = flipTimeFor(visual)
    tile.flipT = -FLIP_DELAY
    tile.group.rotation.x = 0
    tile.bottom.map = this.textures.get(visual)
    tile.bottom.color.setHex(0xffffff)
    tile.bottom.needsUpdate = true
    this.shot = { tile, timer: FLIP_DELAY + tile.flipTime + holdFor(visual) }
  }

  private flipping(): boolean {
    for (const tile of this.tiles) if (tile.flipT !== null) return true
    return false
  }

  private swapTop(tile: TileEntry, visual: CellVisual): void {
    tile.visual = visual
    tile.swapVisual = visual
    tile.swapT = SWAP_TIME
    tile.flashT = FLASH_TIME
    tile.flash.material.color.setHex(accentOf(visual))
    tile.flash.visible = true
    tile.pulse = 1
  }

  private finishFlip(tile: TileEntry): void {
    const visual = tile.flipVisual
    tile.flipT = null
    tile.flipVisual = null
    tile.group.rotation.x = 0
    tile.group.position.y = tile.restY
    if (visual) {
      tile.top.map = this.textures.get(visual)
      tile.top.needsUpdate = true
      tile.flashT = FLASH_TIME
      tile.flash.material.color.setHex(accentOf(visual))
      tile.flash.visible = true
      if (visual.kind === 'organ' || visual.kind === 'wall' || visual.kind === 'cleared' || visual.kind === 'back') {
        tile.pulse = 1
      }
    }
    tile.bottom.map = null
    tile.bottom.needsUpdate = true
    this.applyRevealFx(tile)
  }

  // 每个可导电邻居都向这张牌渗入；毒源没有上游，改从中心涨开
  private seepDirsFor(snapshot: Snapshot, r: number, c: number): SeepDir[] {
    if (snapshot.board[r]?.[c]?.type === 'source') return ['center']
    const around: ReadonlyArray<readonly [number, number, SeepDir]> = [
      [-1, 0, 'up'],
      [1, 0, 'down'],
      [0, -1, 'left'],
      [0, 1, 'right'],
    ]
    const dirs: SeepDir[] = []
    for (const [dr, dc, dir] of around) {
      const cell = snapshot.board[r + dr]?.[c + dc]
      if (!cell) continue
      const kind = visualOf(cell, snapshot.halfTurn).kind
      // 真毒格、已翻开的道具/湿牌/器官卡都可作为上游；墙和已清除不算
      if (kind === 'venom' || kind === 'item' || kind === 'wet' || kind === 'organ') {
        if (!dirs.includes(dir)) dirs.push(dir)
      }
    }
    return dirs.length > 0 ? dirs : ['center']
  }

  private applyRevealFx(tile: TileEntry): void {
    const fx = tile.pendingFx
    tile.pendingFx = null
    const visual = tile.visual
    if (!fx || !visual) return
    this.startSeep(tile, fx)
    // 坏死和洗毒共用牌面，等毒液褪完再烂，避免后一个把前一个的贴图顶掉
    if (fx.rot) tile.pendingRot = true
    if (fx.fly && fx.item) this.startFlight(tile, fx.fly, fx.item)
  }

  private startSeep(tile: TileEntry, fx: RevealFx): void {
    const visual = tile.visual
    if (!visual) return
    if (fx.mode === 'fill' && visual.kind !== 'venom') return
    this.cancelSeep(tile)
    const layer = this.textures.createFaceLayer(visual)
    const size = layer.canvas.width
    const mask = document.createElement('canvas')
    mask.width = size
    mask.height = size
    const maskCtx = mask.getContext('2d')
    if (!maskCtx) throw new Error('2D canvas context unavailable')
    const maskImage = maskCtx.createImageData(size, size)
    const md = maskImage.data
    for (let i = 0; i < md.length; i += 4) {
      md[i] = 255
      md[i + 1] = 255
      md[i + 2] = 255
    }
    const overlay = document.createElement('canvas')
    overlay.width = size
    overlay.height = size
    const overlayCtx = overlay.getContext('2d')
    if (!overlayCtx) throw new Error('2D canvas context unavailable')
    const state: SeepState = {
      sources: fx.dirs,
      mode: fx.mode,
      duration: fx.mode === 'fill' ? SEEP_TIME : WASH_TIME,
      keep: fx.mode === 'wash' && visual.kind === 'item',
      layer,
      liquid: this.textures.liquidArt(),
      mask,
      maskCtx,
      maskImage,
      overlay,
      overlayCtx,
      texture: layer.texture,
      key: visualKey(visual),
      t: 0,
    }
    tile.seep = state
    this.paintSeep(state)
    tile.top.map = state.texture
    tile.top.needsUpdate = true
  }

  private cancelSeep(tile: TileEntry): void {
    tile.pendingRot = false
    const state = tile.seep
    if (!state) return
    tile.seep = null
    if (tile.top.map === state.texture) {
      tile.top.map = tile.visual ? this.textures.get(tile.visual) : null
      tile.top.needsUpdate = true
    }
    state.texture.dispose()
  }

  private finishSeep(tile: TileEntry): void {
    const state = tile.seep
    if (!state) return
    tile.seep = null
    if (tile.visual) {
      if (state.keep && tile.visual.kind === 'item') {
        const wet: CellVisual = { kind: 'wet', item: tile.visual.item }
        tile.visual = wet
        tile.top.map = this.textures.get(wet)
      } else {
        tile.top.map = this.textures.get(tile.visual)
      }
      tile.top.needsUpdate = true
    }
    state.texture.dispose()
    const rot = tile.pendingRot
    tile.pendingRot = false
    if (rot) this.startRot(tile)
  }

  private paintSeep(state: SeepState): void {
    const { canvas, ctx, artwork } = state.layer
    const size = canvas.width
    const progress = Math.min(1, state.t / state.duration)
    const drawOverlay = state.mode === 'fill' || progress < 1 || state.keep

    if (drawOverlay) {
      // 1) 逐像素距离场：每个可导电方向的前沿取并集，带软边
      this.paintSeepMask(state, progress, size)

      // 2) 用遮罩裁出覆盖层（fill 用毒液牌面，wash 用纯液体）
      const overlayCtx = state.overlayCtx
      overlayCtx.clearRect(0, 0, size, size)
      overlayCtx.globalCompositeOperation = 'source-over'
      overlayCtx.globalAlpha = 1
      if (state.mode === 'fill') {
        overlayCtx.drawImage(artwork, 0, 0)
      } else {
        const floor = state.keep ? WET_ALPHA : 0.05
        overlayCtx.globalAlpha = floor + (0.9 - floor) * Math.pow(1 - progress, 1.35)
        overlayCtx.drawImage(state.liquid, 0, 0)
        overlayCtx.globalAlpha = 1
      }
      overlayCtx.globalCompositeOperation = 'destination-in'
      overlayCtx.drawImage(state.mask, 0, 0)
      overlayCtx.globalCompositeOperation = 'source-over'

      // 3) 底图 + 覆盖层
      if (state.mode === 'fill') {
        // 牌面材质不透明，未渗到的区域必须铺底色，否则会露出黑色三角面
        ctx.fillStyle = '#07100a'
        ctx.fillRect(0, 0, size, size)
      } else {
        ctx.drawImage(artwork, 0, 0)
      }
      ctx.drawImage(state.overlay, 0, 0)
    } else {
      // 洗完且不保留水膜：干净牌面
      ctx.drawImage(artwork, 0, 0)
    }

    if (progress < 1) {
      for (const dir of state.sources) this.paintSeepFront(ctx, dir, state, progress)
    }
    state.texture.needsUpdate = true
  }

  /**
   * 逐像素距离场遮罩：每个方向的距离前沿 = base + 波浪；多个方向取覆盖率最大值，
   * 前沿带 soft 像素的软边，多股液体在中间自然合并。
   */
  private paintSeepMask(state: SeepState, progress: number, size: number): void {
    const data = state.maskImage.data
    const soft = 7
    const base = -26 + progress * (size + 52)
    const fade = 1 - progress * 0.55
    const fronts = new Float32Array(size)
    for (let i = 0; i < size; i += 1) {
      const wobble = (Math.sin(i * 0.052 + state.t * 7) * 9 + Math.sin(i * 0.019 - state.t * 2.6) * 13) * fade
      fronts[i] = base + wobble
    }
    const cx = size / 2
    const cy = size / 2
    const centerFront = size * 0.04 + progress * size * 0.8
    const sources = state.sources
    let di = 0
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let a = 0
        for (let s = 0; s < sources.length; s += 1) {
          const dir = sources[s]
          let d: number
          let front: number
          if (dir === 'up') {
            d = y
            front = fronts[x]
          } else if (dir === 'down') {
            d = size - 1 - y
            front = fronts[x]
          } else if (dir === 'left') {
            d = x
            front = fronts[y]
          } else if (dir === 'right') {
            d = size - 1 - x
            front = fronts[y]
          } else {
            d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
            front = centerFront
          }
          const cov = (front + soft - d) * 0.07142857
          if (cov > a) {
            a = cov
            if (a >= 1) break
          }
        }
        data[di + 3] = a > 0 ? a * 255 : 0
        di += 4
      }
    }
    state.maskCtx.putImageData(state.maskImage, 0, 0)
  }

  private paintSeepFront(
    ctx: CanvasRenderingContext2D,
    dir: SeepDir,
    state: SeepState,
    progress: number,
  ): void {
    const size = state.layer.canvas.width
    const fade = 1 - progress * 0.55
    if (dir === 'center') {
      const radius = size * 0.04 + progress * size * 0.8
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
      ctx.lineWidth = 10
      ctx.strokeStyle = `rgba(130,225,150,${0.2 * fade})`
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
      ctx.lineWidth = 2.4
      ctx.strokeStyle = `rgba(205,255,215,${0.5 * fade})`
      ctx.stroke()
      return
    }
    const points = seepFrontPoints(size, dir, progress, state.t)
    const stroke = (width: number, style: string): void => {
      ctx.beginPath()
      ctx.moveTo(points[0][0], points[0][1])
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1])
      ctx.lineWidth = width
      ctx.strokeStyle = style
      ctx.stroke()
    }
    stroke(11, `rgba(120,220,140,${0.16 * fade})`)
    stroke(2.6, `rgba(205,255,215,${0.48 * fade})`)
    for (let i = 3; i < points.length; i += 5) {
      const [x, y] = points[i]
      const radius = 2 + Math.abs(Math.sin(state.t * 3 + i)) * 2
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(170,245,180,${0.15 * fade})`
      ctx.fill()
    }
  }

  // 器官墙翻出来时从几处坏死点往外烂，动画结束后保留最终画面
  private startRot(tile: TileEntry): void {
    const visual = tile.visual
    if (!visual || visual.kind !== 'wall') return
    this.cancelRot(tile)
    const layer = this.textures.createFaceLayer(visual)
    const state: RotState = {
      layer,
      texture: layer.texture,
      seeds: rotSeedsFor(tile.r, tile.c),
      key: visualKey(visual),
      t: 0,
    }
    tile.rot = state
    this.paintRot(state)
    tile.top.map = state.texture
    tile.top.needsUpdate = true
  }

  private cancelRot(tile: TileEntry): void {
    const state = tile.rot
    if (!state) return
    tile.rot = null
    if (tile.top.map === state.texture) {
      tile.top.map = tile.visual ? this.textures.get(tile.visual) : null
      tile.top.needsUpdate = true
    }
    state.texture.dispose()
  }

  private finishRot(tile: TileEntry): void {
    const state = tile.rot
    if (!state) return
    tile.rot = null
    state.t = ROT_TIME
    this.paintRot(state)
    if (tile.visual) {
      const key = `${visualKey(tile.visual)}|${tile.r}-${tile.c}`
      const cached = this.rotCache.get(key)
      if (cached && cached !== state.texture) cached.dispose()
      this.rotCache.set(key, state.texture)
    }
  }

  private paintRot(state: RotState): void {
    const { canvas, ctx, artwork } = state.layer
    const p = Math.min(1, state.t / ROT_TIME)
    const grow = 1 - (1 - p) * (1 - p)
    ctx.drawImage(artwork, 0, 0)
    for (const [x, y, radius] of state.seeds) {
      const r = radius * (0.2 + grow * 0.95)
      const grad = ctx.createRadialGradient(x, y, r * 0.12, x, y, r)
      grad.addColorStop(0, `rgba(20,12,8,${0.9 * grow})`)
      grad.addColorStop(0.5, `rgba(62,34,20,${0.62 * grow})`)
      grad.addColorStop(0.82, `rgba(112,78,44,${0.34 * grow})`)
      grad.addColorStop(1, 'rgba(112,78,44,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
    if (p > 0.3) {
      ctx.save()
      ctx.globalAlpha = grow * 0.5
      ctx.strokeStyle = 'rgba(146,104,58,0.55)'
      ctx.lineWidth = 1.4
      for (const [x, y, radius] of state.seeds) {
        ctx.beginPath()
        ctx.arc(x, y, radius * (0.2 + grow * 0.95), 0.4, 2.4)
        ctx.stroke()
      }
      ctx.restore()
    }
    const veil = ctx.createLinearGradient(0, 0, 0, canvas.height)
    veil.addColorStop(0, `rgba(58,30,16,${0.2 * grow})`)
    veil.addColorStop(1, `rgba(8,5,3,${0.42 * grow})`)
    ctx.fillStyle = veil
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    state.texture.needsUpdate = true
  }

  private startFlight(tile: TileEntry, side: Side, item: ItemId): void {
    const list = side === 'player' ? this.tokens : this.aiTokens
    const target = list.find((entry) => entry.key === item && !entry.mesh.visible) ?? list.find((entry) => entry.key === item)
    const to = new THREE.Vector3(0, TABLE_TOP + 0.06, side === 'player' ? SLOT_Z : AI_SLOT_Z)
    if (target) {
      to.set(target.mesh.position.x, TABLE_TOP + 0.06, target.mesh.position.z)
      target.mesh.visible = false
    }
    const from = new THREE.Vector3(tile.group.position.x, tile.restY + TILE_THICK / 2 + 0.04, tile.group.position.z)
    const material = new THREE.SpriteMaterial({
      map: this.textures.get({ kind: 'item', item }),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(material)
    sprite.position.copy(from)
    sprite.scale.setScalar(0.17)
    this.scene.add(sprite)
    this.flights.push({ sprite, material, from, to, side, item, t: 0 })
  }

  private landFlight(flight: Flight): void {
    const list = flight.side === 'player' ? this.tokens : this.aiTokens
    const entry =
      list.find((token) => token.key === flight.item && !token.mesh.visible) ??
      list.find((token) => token.key === flight.item)
    if (entry) {
      entry.mesh.visible = true
      entry.pulse = 1
    }
    if (this.inFlight[flight.side] === flight.item) this.inFlight[flight.side] = null
  }

  private clearFlights(): void {
    for (const flight of this.flights) {
      flight.sprite.removeFromParent()
      flight.material.dispose()
    }
    this.flights.length = 0
  }

  private syncTokens(list: TokenEntry[], items: readonly ItemId[]): void {
    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i]
      const item = items[i] ?? null
      if (entry.key === (item ?? '')) continue
      entry.key = item ?? ''
      if (!item) {
        entry.mesh.visible = false
        continue
      }
      entry.mesh.material.map = this.textures.get({ kind: 'item', item })
      entry.mesh.material.needsUpdate = true
      // 从牌里飞出来的道具先不在栏里出现，等落地再显示
      entry.mesh.visible = this.inFlight[entry.side] !== item
    }
  }

  private syncSlots(snapshot: Snapshot): void {
    const items = snapshot.players.player.items
    this.slotInfo.clear()
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const item = items[i] ?? null
      const enabled =
        item !== null &&
        snapshot.canPickItem &&
        !(item === 'transplant' && snapshot.transplantUsedThisTurn)
      this.slotInfo.set(slotKey('player', i), { item, enabled })
    }
    const hovered = this.hoveredSlot
    if (hovered && !this.slotInfo.get(hovered)?.item) {
      this.hoveredSlot = null
      this.callbacks.onSlotHover(null)
    }
  }

  idleSeconds(): number {
    return this.idleTime
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    for (const item of this.disposable) item.dispose()
    for (const tile of this.tiles) {
      tile.group.removeFromParent()
      tile.top.map = null
      tile.top.dispose()
      tile.bottom.map = null
      tile.bottom.dispose()
      tile.glow.geometry.dispose()
      tile.glow.material.dispose()
      tile.flash.geometry.dispose()
      tile.flash.material.dispose()
      tile.sheen.material.dispose()
      if (tile.seep) {
        tile.seep.texture.dispose()
        tile.seep = null
      }
      if (tile.rot) {
        tile.rot.texture.dispose()
        tile.rot = null
      }
    }
    this.clearFlights()
    this.inFlight.player = null
    this.inFlight.ai = null
    for (const texture of this.rotCache.values()) texture.dispose()
    this.rotCache.clear()
    this.tiles.length = 0
    this.tileMeshes.length = 0
    this.tokens.length = 0
    this.aiTokens.length = 0
    this.slotMeshes.length = 0
    this.slotInfo.clear()
    this.flipQueue.length = 0
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) material.dispose()
      }
    })
    this.textures.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private buildLighting(): void {
    const ambient = new THREE.HemisphereLight(0x334d3c, 0x0a0d0a, 0.55)
    this.scene.add(ambient)

    const spot = new THREE.SpotLight(0xffd9a6, 62, 16, 0.9, 0.75, 1.2)
    spot.position.set(0, 4.0, 0.35)
    spot.target.position.set(0, TABLE_TOP, 0.05)
    spot.castShadow = true
    spot.shadow.mapSize.set(2048, 2048)
    spot.shadow.camera.near = 0.5
    spot.shadow.camera.far = 12
    spot.shadow.bias = -0.0006
    spot.shadow.normalBias = 0.015
    this.scene.add(spot, spot.target)

    const greenRim = new THREE.PointLight(0x4f9a5c, 6.5, 7, 2)
    greenRim.position.set(0, 1.7, -1.8)
    this.scene.add(greenRim)

    const coolFill = new THREE.PointLight(0x33506e, 5, 9, 2)
    coolFill.position.set(-2.8, 2.1, 1.6)
    this.scene.add(coolFill)

    const nearFill = new THREE.PointLight(0xffcf9f, 4, 6.5, 2)
    nearFill.position.set(0, 2.2, 2.8)
    this.scene.add(nearFill)

    const bossSpot = new THREE.SpotLight(0x9fdf9a, 26, 10, 0.62, 0.85, 1.4)
    bossSpot.position.set(0.6, 3.4, -1.3)
    bossSpot.target.position.set(0, 1.5, -2.9)
    this.scene.add(bossSpot, bossSpot.target)
  }

  private buildBoard(): void {
    const feltMat = new THREE.MeshStandardMaterial({ color: 0x07120b, roughness: 0.97 })
    const feltGeo = new THREE.BoxGeometry(BOARD_EXTENT + 0.5, 0.004, BOARD_EXTENT + 0.55)
    const felt = new THREE.Mesh(feltGeo, feltMat)
    felt.position.set(0, TABLE_TOP + 0.008, BOARD_Z + 0.12)
    felt.receiveShadow = true
    this.scene.add(felt)
    this.disposable.push(feltMat, feltGeo)

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0b110c, roughness: 0.9 })
    const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD_EXTENT + 0.08, 0.008, BOARD_EXTENT + 0.08), frameMat)
    frame.position.set(0, TABLE_TOP + 0.011, BOARD_Z)
    frame.receiveShadow = true
    this.scene.add(frame)
    this.disposable.push(frameMat, frame.geometry)

    const geometry = new THREE.BoxGeometry(TILE, TILE_THICK, TILE)
    this.disposable.push(geometry)
    const glowGeometry = new THREE.PlaneGeometry(TILE * 1.06, TILE * 1.06)
    this.disposable.push(glowGeometry)
    const flashGeometry = new THREE.PlaneGeometry(TILE * 1.02, TILE * 1.02)
    this.disposable.push(flashGeometry)
    const sheenGeometry = new THREE.PlaneGeometry(TILE, TILE)
    this.disposable.push(sheenGeometry)

    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const group = new THREE.Group()
        group.position.set((c - 3) * PITCH, TILE_BASE + TILE_THICK / 2, (r - 3) * PITCH + BOARD_Z)
        group.userData.cell = { r, c }

        const top = new THREE.MeshStandardMaterial({
          roughness: 0.72,
          metalness: 0.04,
          emissive: 0x2c5236,
          emissiveIntensity: 0,
        })
        const side = new THREE.MeshStandardMaterial({ color: 0x1a241c, roughness: 0.85 })
        const bottom = new THREE.MeshStandardMaterial({
          roughness: 0.72,
          metalness: 0.04,
          emissive: 0x2c5236,
          emissiveIntensity: 0,
        })
        this.disposable.push(top, side, bottom)
        const mesh = new THREE.Mesh(geometry, [side, side, top, bottom, side, side])
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.userData.cell = { r, c }
        group.add(mesh)
        this.tileMeshes.push(mesh)

        const glowMat = new THREE.MeshBasicMaterial({
          color: 0x63d16a,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        const glow = new THREE.Mesh(glowGeometry, glowMat)
        glow.rotation.x = -Math.PI / 2
        glow.position.y = TILE_THICK / 2 + 0.0006
        glow.visible = false
        group.add(glow)

        const flashMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        const flash = new THREE.Mesh(flashGeometry, flashMat)
        flash.rotation.x = -Math.PI / 2
        flash.position.y = TILE_THICK / 2 + 0.0014
        flash.visible = false
        group.add(flash)

        const sheenMat = new THREE.MeshBasicMaterial({
          map: this.textures.sheen(),
          color: 0xa8f0b8,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
        this.disposable.push(sheenMat)
        const sheen = new THREE.Mesh(sheenGeometry, sheenMat)
        sheen.rotation.x = -Math.PI / 2
        sheen.rotation.z = ((r * 3 + c) * 0.7) % (Math.PI * 2)
        sheen.position.y = TILE_THICK / 2 + 0.002
        sheen.visible = false
        group.add(sheen)

        this.scene.add(group)
        this.tiles.push({
          group,
          top,
          bottom,
          glow,
          flash,
          sheen,
          r,
          c,
          key: '',
          visual: null,
          queued: false,
          restY: TILE_BASE + TILE_THICK / 2,
          hovered: false,
          pulse: 0,
          flashT: 0,
          glowOn: false,
          flipT: null,
          flipTime: FLIP_TIME,
          flipVisual: null,
          swapT: 0,
          swapVisual: null,
          pendingFx: null,
          pendingRot: false,
          seep: null,
          rot: null,
        })
      }
    }
  }

  private buildSlots(): void {
    const outerMat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, roughness: 0.42, metalness: 0.62 })
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.96, metalness: 0 })
    this.disposable.push(outerMat, innerMat)
    const outerGeo = new THREE.BoxGeometry(0.27, 0.006, 0.27)
    const innerGeo = new THREE.BoxGeometry(0.215, 0.003, 0.215)
    this.disposable.push(outerGeo, innerGeo)
    const tokenGeo = new THREE.PlaneGeometry(0.2, 0.2)
    this.disposable.push(tokenGeo)
    const hitGeo = new THREE.PlaneGeometry(0.27, 0.27)
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    this.disposable.push(hitGeo, hitMat)

    const addRow = (side: Side, z: number, list: TokenEntry[]): void => {
      for (let i = 0; i < SLOT_COUNT; i += 1) {
        const x = (i - (SLOT_COUNT - 1) / 2) * 0.33
        const outer = new THREE.Mesh(outerGeo, outerMat)
        outer.position.set(x, TABLE_TOP + 0.012, z)
        outer.receiveShadow = true
        this.scene.add(outer)

        const inner = new THREE.Mesh(innerGeo, innerMat)
        inner.position.set(x, TABLE_TOP + 0.016, z)
        inner.receiveShadow = true
        this.scene.add(inner)

        const tokenMat = new THREE.MeshBasicMaterial({ transparent: true })
        this.disposable.push(tokenMat)
        const token = new THREE.Mesh(tokenGeo, tokenMat)
        token.rotation.x = -Math.PI / 2
        token.position.set(x, TABLE_TOP + 0.02, z)
        token.visible = false
        this.scene.add(token)
        list.push({ side, index: i, mesh: token, key: '', pulse: 0 })
        if (side === 'player') {
          const hit = new THREE.Mesh(hitGeo, hitMat)
          hit.rotation.x = -Math.PI / 2
          hit.position.set(x, TABLE_TOP + 0.022, z)
          hit.userData.slot = { side, index: i }
          this.scene.add(hit)
          this.slotMeshes.push(hit)
        }
      }
    }

    addRow('player', SLOT_Z, this.tokens)
    addRow('ai', AI_SLOT_Z, this.aiTokens)
  }

  private buildCrtUnits(): void {
    for (const side of ['player', 'ai'] as const) {
      const canvas = document.createElement('canvas')
      canvas.width = CRT_W * CRT_SCALE
      canvas.height = CRT_H * CRT_SCALE
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      )
      screen.scale.set(0.9, 0.675, 1)
      const light = new THREE.PointLight(0x66ffa8, 0.55, 2.2, 2)
      const group = this.buildCrtPlaceholder(side)
      screen.position.set(0, 0.605, 0.302)
      light.position.set(0, 0.605, 0.55)
      group.add(screen)
      group.add(light)
      const unit: CrtUnit = {
        side,
        canvas,
        texture,
        screen,
        light,
        group,
        key: '',
        focus: false,
        flashing: false,
        view: DEFAULT_VIEW,
      }
      this.crtUnits.push(unit)
      this.disposable.push({ dispose: () => texture.dispose() }, screen.geometry, screen.material)
      this.paintCrt(unit, DEFAULT_VIEW)
    }
  }

  private buildCrtPlaceholder(side: Side): THREE.Group {
    const anchor = CRT_ANCHORS[side]
    const group = new THREE.Group()
    group.position.set(anchor.x, TABLE_TOP + CRT_LIFT, anchor.z)
    group.rotation.y = anchor.yaw
    group.scale.setScalar(anchor.scale)
    group.name = `CrtPlaceholder-${side}`
    this.scene.add(group)

    const shellMat = new THREE.MeshStandardMaterial({ color: 0x2f2b25, roughness: 0.7, metalness: 0.3 })
    const shellGeo = new THREE.BoxGeometry(0.9, 1.0, 0.56)
    this.disposable.push(shellMat, shellGeo)
    const shell = new THREE.Mesh(shellGeo, shellMat)
    shell.position.y = 0.5
    shell.castShadow = true
    shell.receiveShadow = true
    shell.name = 'CrtShell'
    group.add(shell)

    const bezelMat = new THREE.MeshStandardMaterial({ color: 0x1a1815, roughness: 0.78 })
    const bezelGeo = new THREE.BoxGeometry(0.915, 0.72, 0.02)
    this.disposable.push(bezelMat, bezelGeo)
    const bezel = new THREE.Mesh(bezelGeo, bezelMat)
    bezel.position.set(0, 0.605, 0.29)
    group.add(bezel)
    return group
  }

  private paintCrt(unit: CrtUnit, view: PlayerView, focus = false): void {
    if (focus) {
      this.paintLiverFocus(unit)
      return
    }
    const ctx = unit.canvas.getContext('2d')
    if (!ctx) return
    const w = CRT_W
    const h = CRT_H
    const alive = ORGANS.filter((organ) => view.organs[organ]).length

    ctx.setTransform(CRT_SCALE, 0, 0, CRT_SCALE, 0, 0)
    ctx.fillStyle = '#03110a'
    ctx.fillRect(0, 0, w, h)

    const glow = ctx.createRadialGradient(w / 2, h / 2, 16, w / 2, h / 2, h)
    glow.addColorStop(0, 'rgba(36,104,58,0.3)')
    glow.addColorStop(1, 'rgba(0,0,0,0.6)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)

    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(80,220,130,0.55)'
    ctx.shadowBlur = 4
    ctx.fillStyle = '#6fe39a'
    ctx.font = 'bold 17px "Cascadia Mono", Consolas, monospace'
    ctx.fillText(unit.side === 'player' ? 'YOU // ORGAN' : 'AI  // ORGAN', 12, 7)
    ctx.textAlign = 'right'
    ctx.font = 'bold 25px "Cascadia Mono", Consolas, monospace'
    ctx.fillText(`${alive}/4`, w - 12, 2)
    ctx.textAlign = 'left'

    ctx.strokeStyle = 'rgba(111,227,154,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, 38)
    ctx.lineTo(w - 12, 38)
    ctx.stroke()

    const cellW = (w - 24) / 4
    ORGANS.forEach((organ, index) => {
      const x = 12 + index * cellW
      const on = view.organs[organ]
      ctx.save()
      ctx.globalAlpha = on ? 1 : 0.28
      const art = paintPixelArt(ctx, organ, x + (cellW - 32) / 2, 44, 1)
      ctx.restore()
      if (!on) {
        ctx.strokeStyle = 'rgba(230,90,80,0.85)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x + (cellW - 32) / 2 + 4, 48)
        ctx.lineTo(x + (cellW + 32) / 2 - 4, 44 + art.height - 4)
        ctx.moveTo(x + (cellW + 32) / 2 - 4, 48)
        ctx.lineTo(x + (cellW - 32) / 2 + 4, 44 + art.height - 4)
        ctx.stroke()
      }
      ctx.textAlign = 'center'
      ctx.shadowBlur = 2
      ctx.font = 'bold 18px "Microsoft YaHei", "PingFang SC", sans-serif'
      ctx.fillStyle = on ? '#bff0cd' : 'rgba(190,120,110,0.8)'
      ctx.fillText(ORGAN_NAMES[organ], x + cellW / 2, 78)
      if (organ === 'lung' && on) {
        ctx.font = 'bold 15px "Cascadia Mono", Consolas, monospace'
        ctx.fillStyle = 'rgba(111,227,154,0.8)'
        ctx.fillText(`×${view.lungLeft}`, x + cellW / 2, 99)
      }
      const wall = view.walls[organ]
      if (wall > 0) {
        ctx.font = 'bold 12px "Microsoft YaHei", "PingFang SC", sans-serif'
        ctx.fillStyle = 'rgba(232,164,76,0.92)'
        ctx.fillText(`坏死 ${wall}`, x + cellW / 2, 100)
      }
      ctx.textAlign = 'left'
    })

    ctx.shadowBlur = 0
    ctx.strokeStyle = 'rgba(111,227,154,0.35)'
    ctx.beginPath()
    ctx.moveTo(12, 120)
    ctx.lineTo(w - 12, 120)
    ctx.stroke()

    ctx.shadowBlur = 3
    ctx.font = 'bold 14px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillStyle = 'rgba(111,227,154,0.72)'
    ctx.fillText(`道具 ${view.items.length}/${view.itemCap}`, 12, 127)
    if (view.weakenedThisTurn) {
      ctx.textAlign = 'right'
      ctx.fillStyle = '#e8a24c'
      ctx.fillText('虚弱', w - 12, 127)
      ctx.textAlign = 'left'
    }
    ctx.shadowBlur = 0

    if (view.items.length === 0) {
      ctx.fillStyle = 'rgba(111,227,154,0.35)'
      ctx.font = '13px "Microsoft YaHei", "PingFang SC", sans-serif'
      ctx.fillText('空', 12, 150)
    } else {
      view.items.forEach((item, index) => {
        ctx.save()
        ctx.globalAlpha = 0.92
        paintPixelArt(ctx, ITEM_ICON[item], 12 + index * 40, 144, 1)
        ctx.restore()
      })
    }

    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    unit.texture.needsUpdate = true
  }

  // 肝触发时接管玩家显示器：放大肝脏图标，提示点棋盘选格清除
  private paintLiverFocus(unit: CrtUnit): void {
    const ctx = unit.canvas.getContext('2d')
    if (!ctx) return
    const w = CRT_W
    const h = CRT_H
    ctx.setTransform(CRT_SCALE, 0, 0, CRT_SCALE, 0, 0)
    ctx.fillStyle = '#190c03'
    ctx.fillRect(0, 0, w, h)

    const glow = ctx.createRadialGradient(w / 2, 92, 8, w / 2, 92, 132)
    glow.addColorStop(0, 'rgba(255,176,60,0.38)')
    glow.addColorStop(1, 'rgba(0,0,0,0.55)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)

    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    ctx.shadowColor = 'rgba(255,150,40,0.8)'
    ctx.shadowBlur = 6
    ctx.fillStyle = '#ffd78a'
    ctx.font = 'bold 18px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText('肝 触 发', w / 2, 10)
    ctx.shadowBlur = 3
    ctx.fillStyle = 'rgba(255,200,120,0.8)'
    ctx.font = 'bold 11px "Cascadia Mono", Consolas, monospace'
    ctx.fillText('LIVER // PURGE', w / 2, 32)

    const iconScale = 3
    const icon = 32 * iconScale
    const x = (w - icon) / 2
    const y = 44
    ctx.shadowColor = 'rgba(255,150,40,0.9)'
    ctx.shadowBlur = 9
    paintPixelArt(ctx, 'liver', x, y, iconScale)
    ctx.shadowBlur = 0

    ctx.shadowColor = 'rgba(255,150,40,0.6)'
    ctx.shadowBlur = 4
    ctx.fillStyle = '#ffd27a'
    ctx.font = 'bold 14px "Microsoft YaHei", "PingFang SC", sans-serif'
    ctx.fillText('点选自己半场一格毒清除', w / 2, 136)
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,210,140,0.65)'
    ctx.font = '10px "Cascadia Mono", Consolas, monospace'
    ctx.fillText('SELECT A CELL TO CLEAR', w / 2, 160)

    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    for (let row = 0; row < h; row += 3) ctx.fillRect(0, row, w, 1)
    unit.texture.needsUpdate = true
  }

  private playerCrt(): CrtUnit | undefined {
    return this.crtUnits.find((unit) => unit.side === 'player')
  }

  private setPlayerCrtFocus(on: boolean): void {
    const unit = this.playerCrt()
    if (!unit) return
    unit.focus = on
    unit.key = `${crtKeyOf(unit.view)}${on ? '|L' : ''}`
    this.paintCrt(unit, unit.view, on)
  }

  private setPlayerCrtFlash(on: boolean): void {
    const unit = this.playerCrt()
    if (!unit) return
    unit.flashing = on
    if (on) this.paintCrtFlash(unit)
  }

  private paintCrtFlash(unit: CrtUnit): void {
    const ctx = unit.canvas.getContext('2d')
    if (!ctx) return
    const w = CRT_W
    const h = CRT_H
    ctx.setTransform(CRT_SCALE, 0, 0, CRT_SCALE, 0, 0)
    ctx.fillStyle = '#ffd48c'
    ctx.fillRect(0, 0, w, h)
    const glow = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, h)
    glow.addColorStop(0, 'rgba(255,255,255,0.95)')
    glow.addColorStop(0.6, 'rgba(255,220,150,0.35)')
    glow.addColorStop(1, 'rgba(255,150,40,0.15)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    unit.texture.needsUpdate = true
  }

  // 肝触发的镜头序列：推进 → 闪屏切特写 → 停留 → 拉回 → 闪屏切回
  private updateLiverCue(dt: number): void {
    const cue = this.liverCue
    if (!cue) return
    cue.t += dt
    if (cue.phase === 'in' || cue.phase === 'out') {
      const duration = cue.phase === 'in' ? LIVER_IN_TIME : LIVER_OUT_TIME
      const p = Math.min(1, cue.t / duration)
      const e = p * p * (3 - 2 * p)
      const toPos = cue.phase === 'in' ? LIVER_CRT_POS : CAMERA_POS
      const toLook = cue.phase === 'in' ? LIVER_CRT_LOOK : LOOK_AT
      this.camera.position.lerpVectors(cue.fromPos, toPos, e)
      this.cameraLook.lerpVectors(cue.fromLook, toLook, e)
      if (p < 1) return
      if (cue.phase === 'in') {
        this.liverCue = { ...cue, phase: 'flashOn', t: 0 }
        this.setPlayerCrtFlash(true)
      } else {
        this.liverCue = { ...cue, phase: 'flashOff', t: 0 }
        this.setPlayerCrtFlash(true)
      }
      return
    }
    if (cue.phase === 'flashOn' || cue.phase === 'hold') {
      this.camera.position.copy(LIVER_CRT_POS)
      this.cameraLook.copy(LIVER_CRT_LOOK)
    }
    if (cue.phase === 'flashOn') {
      if (cue.t < CRT_FLASH_TIME) return
      this.setPlayerCrtFlash(false)
      this.setPlayerCrtFocus(true)
      this.liverCue = { ...cue, phase: 'hold', t: 0 }
    } else if (cue.phase === 'hold') {
      if (cue.t < LIVER_HOLD_TIME) return
      this.liverCue = { phase: 'out', t: 0, fromPos: this.camera.position.clone(), fromLook: this.cameraLook.clone() }
    } else if (cue.t >= CRT_FLASH_TIME) {
      this.setPlayerCrtFlash(false)
      this.setPlayerCrtFocus(false)
      this.liverCue = null
    }
  }

  private loadModels(): void {
    const base = import.meta.env.BASE_URL
    this.loader.loadAsync(`${base}models/room_environment.glb`).then(
      (gltf) => {
        if (this.disposed) return
        const room = gltf.scene
        tuneModel(room, 0.85)
        this.scene.add(room)
      },
      () => {
        this.addFallbackRoom()
      },
    )

    this.loader.loadAsync(`${base}models/gaming_table.glb`).then(
      (gltf) => {
        if (this.disposed) return
        const table = gltf.scene
        table.position.set(0, TABLE_TOP, 0)
        tuneModel(table, 0.8)
        this.scene.add(table)
      },
      () => {
        this.addFallbackTable()
      },
    )

    this.loader.loadAsync(`${base}models/boss_1.glb`).then(
      (gltf) => {
        if (this.disposed) return
        const boss = gltf.scene
        tuneModel(boss, 0.85)
        boss.scale.setScalar(0.8)
        boss.position.set(0, 0.02, -2.95)
        this.bossModel = boss
        this.scene.add(boss)
      },
      () => {
        this.addFallbackBoss()
      },
    )

    this.loader.loadAsync(`${base}models/crt_monitor.glb`).then(
      (gltf) => {
        if (this.disposed) return
        this.swapCrt(gltf.scene)
      },
      () => {
        return
      },
    )
  }

  private swapCrt(root: THREE.Object3D): void {
    for (const unit of this.crtUnits) {
      const placeholder = unit.group
      const clone = root.clone(true)
      cloneMaterials(clone)
      tuneModel(clone, 0.72)
      // 原模型正面留白太多，放大边框让屏幕几乎铺满机身正面
      const bezelNode = clone.getObjectByName('CrtBezel')
      if (bezelNode) {
        bezelNode.scale.set(1.22, 1.22, 1)
        bezelNode.position.y = 0.242
      }
      clone.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) material.color.multiplyScalar(0.58)
        }
      })
      const body = new THREE.Box3().setFromObject(clone)
      const bodySize = body.getSize(new THREE.Vector3())
      if (bodySize.y < 1e-6) return
      const scale = CRT_MODEL / bodySize.y
      clone.scale.set(scale, scale, scale * CRT_DEPTH)
      clone.updateMatrixWorld(true)
      const scaled = new THREE.Box3().setFromObject(clone)
      const center = scaled.getCenter(new THREE.Vector3())
      clone.position.set(-center.x, -scaled.min.y, -center.z)
      clone.updateMatrixWorld(true)

      const bezel = clone.getObjectByName('CrtBezel') ?? clone
      const bezelBox = new THREE.Box3().setFromObject(bezel)
      const bezelSize = bezelBox.getSize(new THREE.Vector3())
      const bezelCenter = bezelBox.getCenter(new THREE.Vector3())

      const wrapper = new THREE.Group()
      wrapper.name = `Crt-${unit.side}`
      wrapper.position.copy(placeholder.position)
      wrapper.rotation.copy(placeholder.rotation)
      wrapper.scale.copy(placeholder.scale)
      wrapper.add(clone)
      this.scene.add(wrapper)

      const screenW = Math.min(bezelSize.x * 0.985, bezelSize.y * 0.985 * (CRT_W / CRT_H))
      const screenH = screenW * (CRT_H / CRT_W)
      unit.screen.removeFromParent()
      unit.screen.position.set(bezelCenter.x, bezelCenter.y, bezelBox.max.z + 0.004)
      unit.screen.scale.set(screenW, screenH, 1)
      wrapper.add(unit.screen)

      unit.light.removeFromParent()
      unit.light.position.set(bezelCenter.x, bezelCenter.y, bezelBox.max.z + 0.22)
      wrapper.add(unit.light)

      unit.group = wrapper
      disposeObject(placeholder)
    }
    // 真模型的机身比占位盒子宽，换完按真实包围盒重新收敛一次
    this.resize()
  }

  private addFallbackRoom(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.95, side: THREE.BackSide })
    this.disposable.push(mat)
    const geo = new THREE.BoxGeometry(14, 7, 14)
    this.disposable.push(geo)
    const room = new THREE.Mesh(geo, mat)
    room.position.y = 3.2
    this.scene.add(room)
  }

  private addFallbackTable(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1f2a22, roughness: 0.88 })
    this.disposable.push(mat)
    const geo = new THREE.BoxGeometry(2.6, 0.08, 2.2)
    this.disposable.push(geo)
    const top = new THREE.Mesh(geo, mat)
    top.position.set(0, TABLE_TOP - 0.04, 0)
    top.receiveShadow = true
    this.scene.add(top)
  }

  private addFallbackBoss(): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c241c, roughness: 0.9 })
    this.disposable.push(mat)
    const geo = new THREE.CapsuleGeometry(0.42, 0.9, 6, 14)
    this.disposable.push(geo)
    const boss = new THREE.Mesh(geo, mat)
    boss.position.set(0, 1.1, -2.9)
    boss.castShadow = true
    this.scene.add(boss)
  }

  private bindPointer(): void {
    const canvas = this.renderer.domElement
    const onMove = (event: PointerEvent): void => {
      if (this.shot) {
        if (this.hoveredKey !== null) {
          this.hoveredKey = null
          for (const tile of this.tiles) tile.hovered = false
          this.callbacks.onTileHover(null)
        }
        if (this.hoveredSlot !== null) {
          this.hoveredSlot = null
          this.callbacks.onSlotHover(null)
        }
        canvas.style.cursor = 'default'
        return
      }
      const rect = canvas.getBoundingClientRect()
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      const slot = this.pickSlot()
      if (slot) {
        const key = slotKey(slot.side, slot.index)
        if (this.hoveredKey !== null) {
          this.hoveredKey = null
          for (const tile of this.tiles) tile.hovered = false
          this.callbacks.onTileHover(null)
        }
        this.hoveredSlot = key
        canvas.style.cursor = this.slotInfo.get(key)?.enabled ? 'pointer' : 'default'
        this.callbacks.onSlotHover({
          side: slot.side,
          index: slot.index,
          clientX: event.clientX,
          clientY: event.clientY,
        })
        return
      }
      if (this.hoveredSlot !== null) {
        this.hoveredSlot = null
        this.callbacks.onSlotHover(null)
      }
      const hit = this.pick()
      const nextKey = hit ? `${hit.r}-${hit.c}` : null
      if (nextKey !== this.hoveredKey) {
        this.hoveredKey = nextKey
        for (const tile of this.tiles) {
          tile.hovered = nextKey === `${tile.r}-${tile.c}`
        }
      }
      canvas.style.cursor = hit ? 'pointer' : 'default'
      if (hit) {
        this.callbacks.onTileHover({ r: hit.r, c: hit.c, clientX: event.clientX, clientY: event.clientY })
      } else {
        this.callbacks.onTileHover(null)
      }
    }
    const onLeave = (): void => {
      this.hoveredKey = null
      for (const tile of this.tiles) tile.hovered = false
      this.callbacks.onTileHover(null)
      if (this.hoveredSlot !== null) {
        this.hoveredSlot = null
        this.callbacks.onSlotHover(null)
      }
    }
    const onClick = (event: PointerEvent): void => {
      if (this.shot) return
      const rect = canvas.getBoundingClientRect()
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      const slot = this.pickSlot()
      if (slot) {
        if (this.slotInfo.get(slotKey(slot.side, slot.index))?.enabled) {
          this.callbacks.onSlotClick(slot.side, slot.index)
        }
        return
      }
      const hit = this.pick()
      if (hit) this.callbacks.onTileClick(hit.r, hit.c)
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerup', onClick)
    this.disposable.push({
      dispose: () => {
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerleave', onLeave)
        canvas.removeEventListener('pointerup', onClick)
      },
    })
  }

  private pickSlot(): { side: Side; index: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.slotMeshes, false)
    for (const hit of hits) {
      const slot = hit.object.userData.slot as { side: Side; index: number } | undefined
      if (!slot) continue
      if (!this.slotInfo.get(slotKey(slot.side, slot.index))?.item) continue
      return slot
    }
    return null
  }

  private pick(): { r: number; c: number } | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.tileMeshes, false)
    const first = hits[0]?.object
    if (!first) return null
    const cell = first.userData.cell as { r: number; c: number } | undefined
    return cell ?? null
  }

  private resize(): void {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.fitCamera.aspect = this.camera.aspect
    this.fitCamera.updateProjectionMatrix()

    const aspect = width / height
    const narrow = THREE.MathUtils.clamp((1.05 - aspect) / 0.55, 0, 1)
    const shrink = 1 - narrow * 0.42
    // 侧栏是固定像素宽，窄窗口下会盖住右侧这两台；只缩小不内收，内收会把 AI 那台压到棋盘上
    const crowd = THREE.MathUtils.clamp((1400 - width) / 300, 0, 1)
    for (const unit of this.crtUnits) {
      const anchor = CRT_ANCHORS[unit.side]
      unit.group.position.set(
        anchor.x * (1 - narrow * 0.25),
        TABLE_TOP + CRT_LIFT,
        anchor.z,
      )
      let scale = anchor.scale * shrink * (1 - crowd * 0.34)
      unit.group.scale.setScalar(scale)
      // 窗口比例变化时两台电视可能被右边缘切掉。以锚点为轴收缩（只会让它离牌桌更远），
      // 直到投影包围盒回到安全范围内
      for (let pass = 0; pass < 6; pass += 1) {
        unit.group.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(unit.group)
        let maxNdc = -Infinity
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const ndc = new THREE.Vector3(x, y, z).project(this.fitCamera)
              if (ndc.x > maxNdc) maxNdc = ndc.x
            }
          }
        }
        if (maxNdc <= CRT_NDC_LIMIT) break
        scale *= Math.max(0.85, (CRT_NDC_LIMIT * 0.985) / maxNdc)
        unit.group.scale.setScalar(scale)
      }
    }
  }

  private animate = (): void => {
    if (this.disposed) return
    this.frame = requestAnimationFrame(this.animate)
    const now = performance.now()
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1)
    this.lastFrame = now
    this.elapsed += dt
    const elapsed = this.elapsed
    this.textures.sheen().offset.set((elapsed * 0.02) % 1, (elapsed * 0.013) % 1)

    this.shotCooldown = Math.max(0, this.shotCooldown - dt)
    if (
      !this.shot &&
      this.liverCue === null &&
      this.shotCooldown === 0 &&
      this.flipQueue.length > 0 &&
      !this.flipping()
    ) {
      const job = this.flipQueue.shift()
      if (job) this.startShot(job.tile)
    }
    if (this.liverArmed && this.shot === null && this.liverCue === null) {
      this.liverArmed = false
      this.liverCue = {
        phase: 'in',
        t: 0,
        fromPos: this.camera.position.clone(),
        fromLook: this.cameraLook.clone(),
      }
    }

    for (const tile of this.tiles) {
      if (tile.flipT !== null) {
        const before = tile.flipT
        tile.flipT += dt
        if (before < 0 && tile.flipT >= 0) this.callbacks.onFlipStart?.(tile.flipTime)
        const p = Math.min(1, Math.max(0, tile.flipT / tile.flipTime))
        const e = flipEase(p)
        tile.group.rotation.x = Math.PI * e
        tile.group.position.y = tile.restY + Math.sin(Math.PI * e) * FLIP_LIFT
        if (p >= 1) this.finishFlip(tile)
      } else {
        const targetY = tile.restY + (tile.hovered ? 0.009 : 0)
        tile.group.position.y += (targetY - tile.group.position.y) * Math.min(1, dt * 12)
      }
      const seep = tile.seep
      if (seep) {
        if (tile.flipT !== null || !tile.visual || visualKey(tile.visual) !== seep.key) {
          this.cancelSeep(tile)
        } else {
          seep.t += dt
          this.paintSeep(seep)
          if (seep.t >= seep.duration) this.finishSeep(tile)
        }
      }
      const rot = tile.rot
      if (rot) {
        if (tile.flipT !== null || !tile.visual || visualKey(tile.visual) !== rot.key) {
          this.cancelRot(tile)
        } else if (rot.t + dt >= ROT_TIME) {
          this.finishRot(tile)
        } else {
          rot.t += dt
          this.paintRot(rot)
        }
      }
      let scale = 1
      if (tile.pulse > 0) {
        tile.pulse = Math.max(0, tile.pulse - dt * 2.2)
        scale += Math.sin(tile.pulse * Math.PI) * 0.08
      }
      if (tile.swapT > 0) {
        const before = tile.swapT
        tile.swapT = Math.max(0, tile.swapT - dt)
        scale -= Math.sin(Math.PI * (1 - tile.swapT / SWAP_TIME)) * 0.14
        if (before > SWAP_TIME / 2 && tile.swapT <= SWAP_TIME / 2 && tile.swapVisual) {
          tile.top.map = this.textures.get(tile.swapVisual)
          tile.top.needsUpdate = true
          tile.swapVisual = null
          this.applyRevealFx(tile)
        }
      }
      if (Math.abs(tile.group.scale.x - scale) > 1e-4) tile.group.scale.setScalar(scale)
      tile.glow.visible = tile.glowOn && tile.flipT === null
      if (tile.glow.visible) {
        tile.glow.material.opacity = 0.36 + Math.sin(elapsed * 3.4) * 0.16
      }
      if (tile.flashT > 0) {
        tile.flashT = Math.max(0, tile.flashT - dt)
        tile.flash.material.opacity = (tile.flashT / FLASH_TIME) * 0.85
        tile.flash.visible = true
      } else if (tile.flash.visible) {
        tile.flash.visible = false
      }
      const venom = tile.visual?.kind === 'venom' && tile.flipT === null && tile.swapT === 0
      tile.sheen.visible = venom
      if (venom) {
        const phase = elapsed * 1.2 + (tile.r * 7 + tile.c) * 0.9
        tile.sheen.material.opacity = 0.055 + Math.sin(phase) * 0.035
        tile.sheen.rotation.z += dt * 0.06
      }
      const breathe =
        tile.visual?.kind === 'venom'
          ? 0.06 + Math.sin(elapsed * 1.4 + (tile.r * 7 + tile.c) * 0.9) * 0.03
          : 0
      tile.top.emissiveIntensity = (tile.hovered && tile.flipT === null ? 0.35 : 0) + breathe
    }

    for (let i = this.flights.length - 1; i >= 0; i -= 1) {
      const flight = this.flights[i]
      flight.t += dt
      const p = Math.min(1, flight.t / FLIGHT_TIME)
      const e = p * p * (3 - 2 * p)
      const lift = Math.sin(Math.PI * e)
      flight.sprite.position.set(
        flight.from.x + (flight.to.x - flight.from.x) * e,
        flight.from.y + (flight.to.y - flight.from.y) * e + lift * 0.32,
        flight.from.z + (flight.to.z - flight.from.z) * e,
      )
      flight.sprite.scale.setScalar(0.17 * (1 + lift * 0.35))
      flight.material.opacity = p < 0.12 ? p / 0.12 : p > 0.82 ? Math.max(0, (1 - p) / 0.18) : 1
      if (p >= 1) {
        this.landFlight(flight)
        flight.sprite.removeFromParent()
        flight.material.dispose()
        this.flights.splice(i, 1)
      }
    }

    for (const list of [this.tokens, this.aiTokens]) {
      for (const token of list) {
        if (token.pulse <= 0) continue
        token.pulse = Math.max(0, token.pulse - dt * 2.4)
        token.mesh.scale.setScalar(1 + Math.sin(token.pulse * Math.PI) * 0.4)
      }
    }

    const cameraSettled = this.camera.position.distanceTo(CAMERA_POS) < 0.05
    const busy =
      this.shot !== null ||
      this.liverCue !== null ||
      this.liverArmed ||
      this.shotCooldown > 0 ||
      this.flipQueue.length > 0 ||
      this.flipping() ||
      this.flights.length > 0 ||
      !cameraSettled
    this.idleTime = busy ? 0 : this.idleTime + dt

    this.crtUnits.forEach((unit, index) => {
      if (unit.flashing) {
        unit.light.color.setHex(0xfff3cf)
        unit.light.intensity = 2.6
      } else if (unit.focus) {
        unit.light.color.setHex(0xffb347)
        unit.light.intensity = 1.3 + Math.sin(elapsed * 7.5) * 0.45
      } else {
        unit.light.color.setHex(0x66ffa8)
        unit.light.intensity = 0.75 + Math.sin(elapsed * 11 + index * 1.9) * 0.12
      }
    })
    if (this.bossModel) {
      this.bossModel.position.y = 0.02 + Math.sin(elapsed * 0.9) * 0.006
      this.bossModel.rotation.y = Math.sin(elapsed * 0.32) * 0.035
    }

    if (this.shot) {
      this.shot.timer -= dt
      const tile = this.shot.tile
      const pos = tile.group.position
      this.shotPos.set(pos.x, tile.restY + CLOSE_HEIGHT, pos.z + CLOSE_DIST)
      this.shotLook.set(pos.x, tile.restY + 0.02, pos.z)
      const k = 1 - Math.exp(-dt * 9)
      this.camera.position.lerp(this.shotPos, k)
      this.cameraLook.lerp(this.shotLook, k)
      if (this.shot.timer <= 0) {
        this.shot = null
        this.shotCooldown = SHOT_GAP
      }
    } else if (this.liverCue) {
      this.updateLiverCue(dt)
    } else {
      this.shotPos.set(
        CAMERA_POS.x + Math.sin(elapsed * 0.16) * 0.012,
        CAMERA_POS.y + Math.sin(elapsed * 0.5) * 0.006,
        CAMERA_POS.z,
      )
      const k = 1 - Math.exp(-dt * 4.5)
      this.camera.position.lerp(this.shotPos, k)
      this.cameraLook.lerp(LOOK_AT, k)
    }
    this.camera.lookAt(this.cameraLook)
    this.renderer.render(this.scene, this.camera)
  }
}