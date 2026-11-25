import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { clone as cloneSkinnedObject } from 'three/addons/utils/SkeletonUtils.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js'
import {
  ITEM_CATALOG,
  evaluateHand,
  type ActorId,
  type Card,
  type CardRank,
  type CardSuit,
  type Chamber,
  type GameSnapshot,
  type ItemId,
} from '../game/GameEngine'
import { TextureFactory } from './TextureFactory'
import { ItemActions, type ItemActionCue, type ItemActionStatus } from './ItemActions'
import { itemActionCamera } from './itemActionConfig'
import type { GameEvent } from '../game/GameEngine'
import { BOSS_POSE_PROFILES, BossPoseController, shouldRespawnBossPose, type BossPoseState } from './BossPose'

export interface ItemHoverPayload {
  readonly actor: ActorId
  readonly item: ItemId
  readonly name: string
  readonly summary: string
  readonly x: number
  readonly y: number
  /** 左侧补给托盘里的候选道具：点击即带走，不属于任何一方的道具栏 */
  readonly supply?: boolean
}

export interface GunHoverPayload {
  readonly x: number
  readonly y: number
}

export interface SceneLoadProgress {
  readonly loaded: number
  readonly total: number
  readonly key: string
}

export type TableAction = 'hit' | 'stand'
export interface TableActionRect { left: number; top: number; right: number; bottom: number }

interface ActionButton {
  readonly root: THREE.Group
  readonly cap: THREE.Group
  readonly indicator: THREE.MeshStandardMaterial
  readonly face: THREE.MeshStandardMaterial
  readonly texture: THREE.CanvasTexture
  pressedUntil: number
}

export interface SceneCallbacks {
  readonly onTableAction?: (action: TableAction) => boolean
  readonly onItemHover?: (payload: ItemHoverPayload | null) => void
  readonly onItemClick?: (actor: ActorId, item: ItemId) => void
  /** 选枪口阶段：点枪进入选择，再点双方血袋架决定枪口朝向 */
  readonly onTargetPick?: (target: ActorId) => void
  /** 选枪口前悬停枪身：浮窗跟随光标，点枪后才开始选目标 */
  readonly onGunHover?: (payload: GunHoverPayload | null) => void
  /** 层间补给：点中托盘里的候选道具即选定 */
  readonly onSupplyPick?: (item: ItemId) => void
  readonly onItemActionCue?: (item: ItemId, cue: ItemActionCue) => void
  readonly onItemActionStatus?: (status: ItemActionStatus | null) => void
  readonly onItemPresented?: (event: GameEvent) => void
  readonly onItemSnapshot?: (snapshot: GameSnapshot) => void
  /** Boss 姿态段落提示，用于音效对齐；只报语义节点，不报每帧采样 */
  readonly onBossPoseCue?: (cue: BossPoseCue) => void
  onLoadProgress?: (progress: SceneLoadProgress) => void
  onLoadError?: (key: string, error: unknown) => void
}

/** down = 塌倒落地（进入趴伏），brace = 撑起，rise = 直身，settle = 落稳 */
export type BossPoseCue = 'down' | 'brace' | 'rise' | 'settle'

export type QualityPreset = 'high' | 'balanced' | 'low'

export const QUALITY_SETTINGS = {
  high: { maxDpr: 2, shadow: 2048, bloom: true, grain: true },
  balanced: { maxDpr: 1.5, shadow: 1024, bloom: true, grain: true },
  low: { maxDpr: 1, shadow: 512, bloom: false, grain: false },
} as const

export type CameraShot =
  | 'table'
  | 'bloodPlayer'
  | 'bloodBoss'
  | 'bossHead'
  | 'bulletTray'
  | 'magnify'
  | 'execute'
  | 'playerDown'
  | 'playerSitUp'
  | 'death'
  | 'victory'
  | 'introWake'
  | 'introStain'
  | 'introPaper'
  | 'introDoor'
  | 'introTowel'
  | 'introTable'
  | 'introBoss'
  | 'tally'
  | 'endingReach'
  | 'supply'
  | 'supplyBoss'

export interface ExecutionPayload {
  readonly by: ActorId
  readonly target: ActorId
  readonly chamber: Chamber
  readonly lethal: boolean
}

export interface ShotPayload {
  readonly by: ActorId
  readonly target: ActorId
  readonly chamber: Chamber
  readonly damage: number
  readonly hpAfter: number
  readonly sawed: boolean
  readonly blackjack: boolean
  readonly blocked: 'shield' | null
}

interface Tween {
  elapsed: number
  duration: number
  delay: number
  onUpdate: (t: number) => void
  onComplete: (() => void) | null
}

interface CardEntry {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.Material[]>
  readonly actor: ActorId
  readonly index: number
  cardKey: string
  flip: number
  angle: number
}

interface ItemEntry {
  readonly group: THREE.Group
  readonly actor: ActorId
  readonly item: ItemId
  readonly key: string
  hovered: boolean
  hoverScale: number
  spawnScale: number
  spawnTarget: number
  baseY: number
  materials: THREE.MeshStandardMaterial[]
}

type SupplyTrayState = 'closed' | 'opening' | 'open' | 'picking' | 'picked' | 'closing'

/** 一块补给托盘：升降组载着候选格和道具一起沉下去/升起来 */
interface SupplyTrayView {
  readonly actor: ActorId
  readonly lift: THREE.Group
  readonly slots: THREE.Group
  readonly light: THREE.PointLight
  readonly items: Map<string, ItemEntry>
  state: SupplyTrayState
  order: ItemId[]
  picked: ItemId | null
  /** Boss 镜头切过来时它可能还在升起：等升完再挑 */
  pendingPick: ItemId | null
  generation: number
}

interface BulletTrayEntry {
  readonly group: THREE.Group
  readonly shell: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>
  readonly tip: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
}

interface BulletTrayView {
  readonly root: THREE.Group
  readonly lift: THREE.Group
  readonly bullets: BulletTrayEntry[]
  readonly light: THREE.PointLight
  readonly liveMaterial: THREE.MeshStandardMaterial
  readonly blankMaterial: THREE.MeshStandardMaterial
  generation: number
  active: boolean
}

/** 手铐锁链：挂在该侧身上的金属环组，随 skipTurn 出现/消失 */
interface ChainEntry {
  readonly group: THREE.Group
  readonly materials: THREE.MeshStandardMaterial[]
}

/** 沙漏逆转：整屏压成冷青色调，中心保留读数亮度 */
const HourglassShader = {
  name: 'HourglassShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 cooled = mix(color.rgb, vec3(luma) * vec3(0.66, 0.94, 1.06), 0.6);
      float edge = smoothstep(0.15, 0.85, distance(vUv, vec2(0.5)));
      color.rgb = mix(color.rgb, cooled * vec3(0.92, 1.0, 1.06) + edge * vec3(0.02, 0.09, 0.12), amount);
      gl_FragColor = color;
    }
  `,
}

interface TorsoParts {
  readonly head: THREE.Object3D
  readonly mask: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  readonly maskBack: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
}

/** 台面点数贴片：一块透明画布平面，只在点数/状态变化时重绘 */
interface ScorePlate {
  readonly ctx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  key: string
}

/** 一只血袋：液体网格按 fill（0..1）从底部向上装填，空袋收瘪 */
interface BloodBag {
  readonly liquid: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
  readonly shell: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshPhysicalMaterial>
  readonly liquidH: number
  readonly bottomY: number
  fill: number
}

interface BloodRack {
  readonly group: THREE.Group
  /** 汇流管到双方身体的细管，挂在世界坐标里，换架时一并销毁 */
  readonly extra: THREE.Group
  readonly bags: BloodBag[]
  maxHp: number
}

const TABLE_TOP = 0.98
/**
 * Gothic Coffee Table（Poly Haven，CC0）原始测量：1.443m 见方、总高 0.559m。
 * 台面是下沉凹板：flat 区 z=0.525、半宽 0.62m，四周雕花边框顶 z=0.559。
 * 场景道具摊开的范围远大于这张 1.44m 小桌，只能非均匀放大凹板来承托：
 * x 覆盖到敌方道具栏外缘（±2.89），z 覆盖到敌方道具与开场双手（±2.3 左右）。
 */
const GOTHIC_TABLE_PANEL_HALF = 0.62
const GOTHIC_TABLE_PANEL_TOP = 0.525
const GOTHIC_TABLE_FIT_HALF_X = 3.0
const GOTHIC_TABLE_FIT_HALF_Z = 2.35
/** 叙事转头惊吓的包络时长：快攻慢释 */
const HEAD_SNAP_LIFE = 0.9

/** 胶片噪点 + 轻微色偏：暗部偏冷绿，强度由导演层驱动 */
const GrainShader = {
  name: 'GrainShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.04 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7)) + time * 43.7) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float g = hash(vUv * vec2(1920.0, 1080.0)) - 0.5;
      color.rgb += g * amount;
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(color.rgb, color.rgb * vec3(0.94, 1.02, 0.98), amount * 2.0 * (1.0 - luma));
      gl_FragColor = color;
    }
  `,
}
/** 顶层常量便于 Rollup 静态求值，让取样代码整段在 production 被摇树移除 */
const devStatsEnabled = import.meta.env.DEV
const CARD_W = 0.3
const CARD_H = 0.42
const CARD_T = 0.012
const DECK_POS = new THREE.Vector3(2.55, TABLE_TOP + 0.06, 0.16)
const MAX_VISIBLE_CARDS = 8
const ITEM_SCALE = 1.0
/** 手牌点数直接印在台呢上：贴片中心（世界坐标）与尺寸，避开卡牌/道具/血袋架/牌堆/后侧围栏 */
const SCORE_PLATE_Y = TABLE_TOP + 0.004
const SCORE_PLATE_W = 1.34
const SCORE_PLATE_H = 0.46
const SCORE_PLATE_POS: Readonly<Record<ActorId, THREE.Vector2>> = {
  // 玩家贴片比 Boss 侧略靠桌心：近侧按键帽在透视里会盖住下缘
  player: new THREE.Vector2(0, 1.3),
  boss: new THREE.Vector2(0, -1.62),
}
/** Boss 侧离镜头远、视角更斜，贴片按比例放大才能与玩家侧同样好读 */
const SCORE_PLATE_SCALE: Readonly<Record<ActorId, number>> = { player: 1, boss: 1.55 }
/** 对面贴片立起一点正对镜头，否则远侧透视会把字压扁；0 = 平贴台呢。
 * 倾角不能太大：立牌太高会把对沿那组镜像按键整个挡住。 */
const SCORE_PLATE_TILT: Readonly<Record<ActorId, number>> = { player: 0, boss: 0.28 }
/** 游戏主镜头机位，用于让 Boss 贴片转向观众 */
const SCORE_PLATE_VIEW = new THREE.Vector3(0, 3.62, 4.92)

/** 放大镜特写的保持时长：读数后镜头自动落回桌面机位 */
const MAGNIFY_HOLD_SECONDS = 2.2

/**
 * 血袋架布局：每格生命挂一只血袋（袋数 = maxHp）。
 * 玩家小架摆在桌面左前角；Boss 落地架在它左后侧，袋口高度露出桌沿之上。
 */
const BLOOD_RACK_LAYOUT: Readonly<
  Record<
    ActorId,
    {
      readonly x: number
      readonly y: number
      readonly z: number
      readonly yaw: number
      readonly poleH: number
      readonly baseR: number
      readonly spacing: number
      readonly bagW: number
      readonly bagH: number
    }
  >
> = {
  player: {
    x: -0.98,
    y: TABLE_TOP,
    z: 1.3,
    yaw: 0.26,
    poleH: 0.46,
    baseR: 0.075,
    spacing: 0.068,
    bagW: 0.058,
    bagH: 0.105,
  },
  boss: {
    x: -1.62,
    y: 0,
    // 哥特桌后沿伸到 z=-2.74，落地架得退到桌外，否则立杆会插进桌板
    z: -3.05,
    yaw: 0.42,
    poleH: 1.62,
    baseR: 0.16,
    spacing: 0.092,
    bagW: 0.075,
    bagH: 0.14,
  },
}
const LEVEL_LOOK: ReadonlyArray<{
  readonly rim: number
  readonly fill: number
  readonly lamp: number
}> = [
  { rim: 0xff5a2a, fill: 0x2f4763, lamp: 0xffb066 },
  { rim: 0xffa53a, fill: 0x3a4f63, lamp: 0xffa951 },
  { rim: 0xff2f22, fill: 0x3a2c4f, lamp: 0xff8a52 },
]

/** 逐章压力参数：灯下降 + 雾加浓 + fov 收窄，不换房间几何；lampDrop 是相对灯架基准高度的下沉量 */
const CHAPTER_MOOD: ReadonlyArray<{
  readonly fog: number
  readonly vignette: number
  readonly grain: number
  readonly fov: number
  readonly flicker: number
  readonly lampDrop: number
}> = [
  { fog: 0.042, vignette: 0.85, grain: 0.04, fov: 48, flicker: 1, lampDrop: 0 },
  { fog: 0.05, vignette: 0.95, grain: 0.07, fov: 46, flicker: 1.3, lampDrop: 0.3 },
  { fog: 0.06, vignette: 1.05, grain: 0.1, fov: 44, flicker: 1.6, lampDrop: 0.6 },
]

/** Blender 导出的模型，键名与 public/models/*.glb 对应 */
type ModelKey =
  | 'shotgun'
  | 'boss_1'
  | 'boss_2'
  | 'boss_3'
  | 'item_magnifier'
  | 'item_syringe'
  | 'item_saw'
  | 'item_magnet'
  | 'item_handcuffs'
  | 'item_hourglass'
  | 'item_dagger'
  | 'item_aegis'
  | 'item_hammer'
  | 'item_seal'
  | 'item_cutter'
  | 'item_iou'
  | 'item_monocle'
  | 'table_gothic'
  | 'room_environment'
  | 'gothic_statue'
  | 'marble_bust_01'
  | 'player_hand'

/** 道具 id → 模型键（与 GameEngine 的 ITEM_IDS 一一对应）；暂无 GLB 的道具留空走程序化几何 */
const ITEM_MODEL: Readonly<Partial<Record<ItemId, ModelKey>>> = {
  magnifier: 'item_magnifier',
  sedative: 'item_syringe',
  saw: 'item_saw',
  magnet: 'item_magnet',
  handcuffs: 'item_handcuffs',
  hourglass: 'item_hourglass',
  dagger: 'item_dagger',
  aegis: 'item_aegis',
  hammer: 'item_hammer',
  seal: 'item_seal',
  cutter: 'item_cutter',
  iou: 'item_iou',
  monocle: 'item_monocle',
}

const ITEM_MODEL_SIZE = 0.5
// 斜放的放大镜对角线约 0.53，格子取 0.54 才能整件收进边框
const ITEM_GRID = {
  columns: 4,
  spacing: 0.56,
  slotSize: 0.54,
  // 两栏关于桌面横向中线镜像：玩家在右前，敌方在右后（屏幕上即右上角）
  player: { originX: 0.78, originZ: 0.92, zSign: 1 },
  boss: { originX: 0.78, originZ: 0.92, zSign: -1 },
} as const

/**
 * 左侧补给托盘：玩家在左前、Boss 在左后，两块关于桌面横向中线镜像。
 * 候选格和道具一起装在升降组里：先沉到桌面以下藏住，再载着道具升回台面。
 */
const SUPPLY_TRAY = {
  centerX: -2.26,
  playerZ: 0.75,
  bossZ: -0.75,
  halfX: 0.62,
  halfZ: 0.66,
  spacing: 0.66,
  slotSize: 0.58,
  rimThickness: 0.02,
  rimHeight: 0.05,
  /** 升降行程：装满道具时能完全沉到桌面以下 */
  travel: 0.42,
  /** 托盘板中心相对桌面的高度 */
  plateLift: 0.024,
  plateThickness: 0.04,
} as const

const BULLET_TRAY = {
  centerX: 1.85,
  centerZ: 0,
  columns: 4,
  rows: 2,
  spacing: 0.19,
  slotSize: 0.16,
  travel: 0.16,
} as const

type ItemTone = 'iron' | 'brass' | 'wood' | 'paper' | 'wax' | 'glass'

/** 每种材质的受光参数；道具改用受光材质后，桌面灯会把轮廓和体积打出来 */
const ITEM_TONE_STYLE: Record<
  ItemTone,
  {
    color: number
    metalness: number
    roughness: number
    emissiveIntensity: number
    transparent?: boolean
    opacity?: number
  }
> = {
  iron: { color: 0x8e9aa6, metalness: 0.55, roughness: 0.5, emissiveIntensity: 0.04 },
  brass: { color: 0xc08f3c, metalness: 0.55, roughness: 0.5, emissiveIntensity: 0.03 },
  wood: { color: 0x7c512e, metalness: 0.03, roughness: 0.8, emissiveIntensity: 0.03 },
  paper: { color: 0xc3b083, metalness: 0, roughness: 0.95, emissiveIntensity: 0 },
  wax: { color: 0x9c211a, metalness: 0.08, roughness: 0.6, emissiveIntensity: 0.04 },
  glass: {
    color: 0xd94a4a,
    metalness: 0.15,
    roughness: 0.12,
    emissiveIntensity: 0.12,
    transparent: true,
    opacity: 0.55,
  },
}

/** 每件道具有自己的主色和底环荧光色，避免整桌都是灰+橙+红 */
const ITEM_PALETTE: Record<ItemId, { glow: number; tones: Partial<Record<ItemTone, number>> }> = {
  magnifier: { glow: 0xff5b66, tones: { brass: 0xc79a42, wood: 0x5f3e23, iron: 0x8f9caa, glass: 0xe84353 } },
  sedative: { glow: 0x45d6a2, tones: { iron: 0xb9c6cf, glass: 0x35c98f } },
  saw: { glow: 0xff7a2f, tones: { iron: 0x8f9aa4, wood: 0x5a3423, wax: 0x8e1d1d } },
  magnet: { glow: 0x5b8dff, tones: { iron: 0x6b7f9e, wax: 0xc62f2f } },
  handcuffs: { glow: 0xdfe6ee, tones: { iron: 0xb9c1c9, brass: 0xe0b55a } },
  aegis: { glow: 0xffb020, tones: { brass: 0x9c6f2f, glass: 0xcc3434, iron: 0x6f5129, wax: 0x7f1a1a } },
  hourglass: { glow: 0x3fd9e8, tones: { brass: 0xcfa03f, glass: 0x57c8d8, wax: 0xd6403c } },
  dagger: { glow: 0xe8443f, tones: { iron: 0xbcc6cf, wood: 0xcaa06a, wax: 0x8f1d1d } },
  hammer: { glow: 0xd8c07a, tones: { iron: 0x545c66, wood: 0x966438, paper: 0xd6cfc0, brass: 0xb98a45, wax: 0x71251e } },
  cutter: { glow: 0xbfe4ff, tones: { iron: 0xaeb9c1, wood: 0x2f2a28, paper: 0xb0a480 } },
  iou: { glow: 0xffc46b, tones: { paper: 0xa8986c, wax: 0xa3201a, wood: 0x6d5033 } },
  seal: { glow: 0xe0262f, tones: { wax: 0x941a16, paper: 0xd8c9a4, brass: 0xc19645, wood: 0x5f4229, iron: 0x8b9199 } },
  monocle: { glow: 0x8be3ff, tones: { brass: 0xe3b552, glass: 0x7fd4e8 } },
}

const MODEL_BASE = './models'

// 爬行 Boss 按低矮轮廓定高，不能沿用直立半身像的缩放。
const BOSS_BUST_HEIGHTS = [2.15, 1.7, 3.0] as const
/** 二、三层暂时统一使用一层的人形半身像：模型、姿态档位、瞄准点与挂饰都跟这一层走 */
const BOSS_VISUAL_LEVEL = 0
const BOSS2_HEAD_TILT = 0.7
const BOSS2_HEAD_TWITCH_LIFE = 0.58
const BOSS2_HEAD_TWITCH_MIN_DELAY = 2.6
const BOSS2_HEAD_TWITCH_MAX_DELAY = 3.4
const BOSS2_HEAD_TWITCH_KEYS = [
  [0, 0],
  [0.08, 9],
  [0.11, 9],
  [0.16, -6],
  [0.19, -6],
  [0.24, 8],
  [0.27, 8],
  [0.34, 0],
] as const
/** 半身像胸口高度占整体高度的比例，用于换算瞄准点 */
const BOSS_CHEST_RATIO = 0.64
/** 半身像底座（斗篷下摆）压到桌面以下，被桌沿挡住，形成「坐在桌后」的错觉 */
const BOSS_BUST_BASE_Y = 0.26
/** Boss 站在桌后：哥特桌放大后后沿 z=-2.74，斗篷前半 z≈-0.51 缩放后约 0.55m，
 * 所以中心必须在 -2.74-0.55-0.1≈-3.39 之后，否则会穿进桌沿 */
const BOSS_Z = -3.4
const BOSS3_INVERSION_LIFT = 1.84
const BOSS3_HEAD_CLEARANCE = 0.55
const SUSPENSION_LINK_COUNT = 34

/** 密室顶棚高度（米）；吊灯摆动以这里为枢轴 */
const CEILING_Y = 6.0
/** 灯罩下沿在世界坐标中的高度，聚光灯挂在这里才不会被罩体遮挡 */
const LAMP_SHADE_BOT_Y = 4.02

/** 枪口瞄准的旋转中心：抬离桌面，给瞄准时下摆的枪托留出空间 */
const GUN_PIVOT = new THREE.Vector3(0, TABLE_TOP + 0.28, 0.08)
/** 开局枪平躺在桌面上的侧翻角（绕枪管轴线），略小于 90° 保留一点斜面 */
const GUN_REST_ROLL = -1.35
/** 抬起/放下时先腾空的高度，保证转正过程中不扫穿桌面 */
const GUN_LIFT_CLEARANCE = 0.18
/** 处决开始，枪从桌面抬到持握位的过渡时长 */
const GUN_RAISE_DURATION = 0.62
/** 开枪后枪落回桌面的过渡时长 */
const GUN_LOWER_DURATION = 0.6
const GUN_SHAKE = {
  delay: 0.045,
  offsetMin: -0.006,
  offsetMax: 0.002,
} as const
/** 枪口对准玩家的误差容限（弧度，约 0.86°） */
const GUN_AIMED_EPSILON = 0.015
/** 一次血雾爆发的粒子数 */
const BLOOD_PARTICLE_COUNT = 80
/** 护心镜 / 诱饵挡下实弹时的碎屑粒子数 */
const SPARK_PARTICLE_COUNT = 70
const BOSS_FLASH_COLOR = new THREE.Color(0xffffff)
const BOSS_FLASH_LIFE = 0.16
/**
 * 闪白峰值。Boss 的贴图接近纯白且带顶点色，自发光是均匀叠加，
 * 系数一高就把明暗关系抹平成一块白板；实测 0.05 附近只把亮度抬高约一成，
 * 0.09 仍保得住轮廓，第一帧的顿感也更明确
 */
const BOSS_FLASH_PEAK = 0.09

/** 姿态状态切换到音效提示；只在离散节点响一次，不按帧触发 */
const BOSS_POSE_CUES: Partial<Record<BossPoseState, BossPoseCue>> = {
  down: 'down',
  prone: 'down',
  deadProne: 'down',
  brace: 'brace',
  rise: 'rise',
  recover: 'settle',
}

/**
 * 处决推近：机位稳定后沿视线前推的距离（米）。
 * 枪在近景，推得越远枪身放大得越快；0.24 附近 Boss 的五官还在画面里，枪也没压过去
 */
const EXECUTION_PUSH_DISTANCE = 0.24
/** 等镜头先落稳再推，推的过程占掉处决停顿的大半 */
const EXECUTION_PUSH_DELAY = 0.7
const EXECUTION_PUSH_DURATION = 2.1

/** 环境反射强度：只留一点金属高光，压低后棚拍感消失、暗部沉入黑里 */
const ENV_INTENSITY = 0.12

/**
 * Blender 预览灯与网页聚光灯差异很大：GLB 里偏亮的 baseColor 进了 Three.js 会过曝。
 * 统一压暗这一档，让材质回到「暗黑地下室」的基调。
 */
const GLB_ALBEDO_DIM = 0.42

/** 顶点色材质（Blender 烘焙）同样压一档，与 GLB_ALBEDO_DIM 叠加后接近线下观感 */
const VERTEX_COLOR_DIM = 0.68

/** 统一处理 GLB 材质：阴影、环境反射、整体压暗 */
function tuneGltfMaterial(
  material: THREE.Material,
  vertexDim = VERTEX_COLOR_DIM,
  albedoDim = GLB_ALBEDO_DIM,
): void {
  if (!(material instanceof THREE.MeshStandardMaterial)) return
  material.envMapIntensity = ENV_INTENSITY
  // 顶点色材质（Blender 烘焙）本身颜色已正确，只做轻度压暗
  if (material.vertexColors) {
    material.color.multiplyScalar(vertexDim)
  } else {
    material.color.multiplyScalar(albedoDim)
  }
  // Blender 的高金属度在网页 IBL 下会整片反射成白，压到 0.55 保留金属感又不失细节
  if (material.metalness > 0.55) material.metalness = 0.55
  // 极度光滑的表面会把环境光镜面反射成白块
  if (material.roughness < 0.28) material.roughness = 0.28
  // 自发光在网页里更容易过曝，整体收敛
  if (material.emissiveIntensity > 1) {
    material.emissiveIntensity *= 0.5
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function makeStandardMaterial(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness })
}

function cardFaceTopIndex(): number {
  return 1
}

function createCardGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H)
  const index = geometry.index!
  const order = [0, 1, 4, 5, 2, 3]
  const reordered: number[] = []
  for (const groupIndex of order) {
    const group = geometry.groups[groupIndex]!
    for (let i = group.start; i < group.start + group.count; i += 1) reordered.push(index.getX(i))
  }
  geometry.setIndex(reordered)
  geometry.clearGroups()
  geometry.addGroup(0, 24, 0)
  geometry.addGroup(24, 6, 1)
  geometry.addGroup(30, 6, 2)
  return geometry
}

export class SceneManager {
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly callbacks: SceneCallbacks
  private quality: QualityPreset = 'high'
  private readonly renderer: THREE.WebGLRenderer
  private readonly composer: EffectComposer
  private readonly renderPass: RenderPass
  private readonly hourglassPass: ShaderPass
  private readonly grainPass: ShaderPass
  private readonly vignettePass: ShaderPass
  private readonly bloomPass: UnrealBloomPass
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly timer = new THREE.Timer()
  private readonly textures = new TextureFactory()
  private readonly tweens: Tween[] = []
  private readonly cards = new Map<string, CardEntry>()
  /** 仍在从牌靴飞入的牌：layoutHand 不重定向它们，避免飞行途中被二次拉回 */
  private readonly dealingCards = new WeakSet<CardEntry>()
  private readonly items = new Map<string, ItemEntry>()
  private readonly actionButtons = new Map<TableAction, ActionButton>()
  private sceneDebugFacade: { canUseTableActions: () => boolean; getTableActionLayout: () => Record<TableAction, TableActionRect> } | null = null
  private actionHovered: TableAction | null = null
  private actionPressed: TableAction | null = null
  private tableActionsAllowed = false
  /** 层间叙事未结束时先不升起补给托盘，避免被透明黑层挡住却已在等待选择 */
  private supplyRevealAllowed = true
  /** 补给候选道具单独成表：不参与 syncItems 的常规道具栏同步 */
  /** 玩家补给道具单独成表：不参与 syncItems 的常规道具栏同步，也用于悬停/点击 */
  private readonly supplyItems = new Map<string, ItemEntry>()
  /** Boss 托盘里的候选只做展示，不参与拾取 */
  private readonly bossSupplyItems = new Map<string, ItemEntry>()
  private supplyTrays: { player: SupplyTrayView; boss: SupplyTrayView } | null = null
  private supplyHovered: ItemEntry | null = null
  private bulletTray: BulletTrayView | null = null
  // 动态资源释放后不能仍被强引用；这里只做弱追踪，真正销毁由 disposeObject 负责。
  private readonly disposableGeometries = new WeakSet<THREE.BufferGeometry>()
  private readonly disposableMaterials = new WeakSet<THREE.Material>()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly listenerCleanup: Array<() => void> = []
  private readonly motionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  /** 系统级「减少动态效果」：抑制震屏、枪械抖动与镜头漂移，保留运镜与发牌演出 */
  private reducedMotion = false
  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches
    this.bossPose.setReducedMotion(event.matches)
    if (event.matches) {
      this.shakeTime = 0
      this.gunShakeAfterAim = false
      this.stopGunShake()
    }
  }
  private statFrames = 0
  private statElapsed = 0
  private readonly resizeObserver: ResizeObserver
  private readonly scratchVector = new THREE.Vector3()
  private readonly scratchHitPoint = new THREE.Vector3()
  private readonly bossDialogueVector = new THREE.Vector3()

  private readonly gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  /** 已加载的模型模板；缺失表示加载失败或尚未完成，此时回退程序化几何 */
  private readonly models = new Map<ModelKey, THREE.Object3D>()
  private envTexture: THREE.Texture | null = null
  private readonly pendingModels: Array<Promise<void>> = []
  private readonly bossModelByLevel: Array<THREE.Object3D | null> = [null, null, null]
  /** 当前挂在 Boss 头上的 GLB 面具关卡，-1 表示仍用贴图面具 */
  private activeBossMaskLevel = -1
  /** 半身像的头部骨骼（Head），「盯视」直接驱动骨骼；程序化 Boss 下为空 */
  private bossHeadBone: THREE.Bone | null = null
  /** 道具模型模板（按 item id），供 UI 图鉴与桌面摆件复用 */
  private readonly itemModelTemplates = new Map<ItemId, THREE.Object3D>()
  private readonly scorePlates = new Map<ActorId, ScorePlate>()
  private readonly bloodRacks = new Map<ActorId, BloodRack>()
  private readonly chains = new Map<ActorId, ChainEntry>()
  private readonly itemActions: ItemActions
  /** 锯短后的断管摆件：只按 sawBoost 生命周期清除 */
  private readonly sawMarks = new Map<ActorId, THREE.Group>()
  private pendingVisualSnapshot: GameSnapshot | null = null
  /** 沙漏滤镜：0=正常，1=全强度冷青；由快照的 hourglassActive 驱动 */
  private hourglassAmount = 0
  private hourglassTarget = 0
  /** 使用瞬间的额外闪白，随时间衰减 */
  private hourglassPulse = 0
  /** 叙事后期参数：平滑跟随导演层目标（入场 / 逐章压力） */
  private gradeFog = 0.042
  private gradeFogTarget = 0.042
  private gradeVignette = 0.85
  private gradeVignetteTarget = 0.85
  private gradeGrain = 0.04
  private gradeGrainTarget = 0.04
  private gradeLamp = 1
  private gradeLampTarget = 1
  private gradeFlicker = 1
  private gradeFlickerTarget = 1
  private narrativeSway = 0
  private narrativeSwayTarget = 0
  private lampBulbMat: THREE.MeshStandardMaterial | null = null
  private lampConeMat: THREE.MeshBasicMaterial | null = null
  private headSnapLife = 0
  /** 当前章节压力档位（0=门厅 1=账房 2=刑台），由 setChapterMood 驱动 */
  private chapterIndex = 0
  private lampBaseY = 5.4
  private lampDrop = 0
  private lampDropTarget = 0
  private doorSlitMat: THREE.MeshBasicMaterial | null = null
  private doorSlitOpacity = 0.5
  private doorSlitTarget = 0.5
  private tallyGroup: THREE.Group | null = null
  private sutureGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private reachHand: THREE.Group | null = null
  /** 叙事陈设单独成组：swapRoom / refreshProps 都不会清掉 */
  private readonly narrativeGroup = new THREE.Group()
  private towelMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null
  private introHands: THREE.Group | null = null
  private introHandsTween = 0
  /** Boss 倒地/起身：纯逻辑状态机只产出姿态采样，Three 对象映射留在 updateBoss */
  private readonly bossPose = new BossPoseController()
  private readonly bossPosePivot = new THREE.Vector3()
  private readonly bossPosePivotRotated = new THREE.Vector3()
  private readonly bossPoseOffset = new THREE.Vector3()
  private readonly bossPoseEuler = new THREE.Euler()
  /** 头部骨骼的静止变换，姿态动画在父空间左乘叠加 */
  private readonly bossHeadRest = new THREE.Quaternion()
  private readonly bossHeadRestPosition = new THREE.Vector3()
  /** 双臂骨骼（UpperArm.L/R）：静止约绕 X 转 180°，偏移必须在父空间左乘 */
  private bossArmLBone: THREE.Bone | null = null
  private bossArmRBone: THREE.Bone | null = null
  private bossForearmLBone: THREE.Bone | null = null
  private bossForearmRBone: THREE.Bone | null = null
  private bossThighLBone: THREE.Bone | null = null
  private bossThighRBone: THREE.Bone | null = null
  private bossChestBone: THREE.Bone | null = null
  private readonly bossThighLRest = new THREE.Quaternion()
  private readonly bossThighRRest = new THREE.Quaternion()
  private readonly bossArmLRest = new THREE.Quaternion()
  private readonly bossArmRRest = new THREE.Quaternion()
  private readonly bossForearmLRest = new THREE.Quaternion()
  private readonly bossForearmRRest = new THREE.Quaternion()
  private readonly bossArmLDirection = new THREE.Vector3()
  private readonly bossArmRDirection = new THREE.Vector3()
  private readonly bossHandLOffset = new THREE.Vector3()
  private readonly bossHandROffset = new THREE.Vector3()
  private readonly bossFootLOffset = new THREE.Vector3()
  private readonly bossFootROffset = new THREE.Vector3()
  private bossUpperArmLength = 0
  private bossForearmLLength = 0
  private bossForearmRLength = 0
  private readonly bossHandContactL = new THREE.Vector3(-1.16, TABLE_TOP + 0.025, -2.28)
  private readonly bossHandContactR = new THREE.Vector3(1.16, TABLE_TOP + 0.025, -2.28)
  private readonly bossIkShoulder = new THREE.Vector3()
  private readonly bossIkElbow = new THREE.Vector3()
  private readonly bossIkDirection = new THREE.Vector3()
  private readonly bossIkClampedTarget = new THREE.Vector3()
  private readonly bossIkPole = new THREE.Vector3()
  private readonly bossIkBend = new THREE.Vector3()
  private readonly bossIkUpperDirection = new THREE.Vector3()
  private readonly bossIkLowerDirection = new THREE.Vector3()
  private readonly bossIkParentDirection = new THREE.Vector3()
  private readonly bossIkOffsetQuat = new THREE.Quaternion()
  private readonly bossIkUpperFk = new THREE.Quaternion()
  private readonly bossIkForearmFk = new THREE.Quaternion()
  private readonly bossIkUpperSolved = new THREE.Quaternion()
  private readonly bossIkForearmSolved = new THREE.Quaternion()
  private readonly bossIkParentQuat = new THREE.Quaternion()
  private readonly bossBoneOffset = new THREE.Euler()
  private readonly bossBoneQuat = new THREE.Quaternion()
  private suspensionLift = 0
  private suspensionWeight = 0
  private suspensionChains: THREE.InstancedMesh[] = []
  private readonly suspensionAnchors = [
    new THREE.Vector3(-0.42, CEILING_Y - 0.12, BOSS_Z + 0.16),
    new THREE.Vector3(0.42, CEILING_Y - 0.12, BOSS_Z + 0.16),
  ]
  private readonly suspensionUp = new THREE.Vector3(0, 1, 0)
  private readonly suspensionAnchor = new THREE.Vector3()
  private readonly suspensionFoot = new THREE.Vector3()
  private readonly suspensionDirection = new THREE.Vector3()
  private readonly suspensionDummy = new THREE.Object3D()
  private bossPosePaused = false
  /** 血袋特写期间冻结姿态，避免起身在镜头外白白播完 */
  private bossPoseHold = false
  private bossPoseCameraHold = false
  private lastBossPoseState: BossPoseState = 'idle'
  /** 上一帧姿态状态，用于派发离散的音效提示 */
  private readonly bossLimbGroups = new Map<string, { base: THREE.Object3D; segments: THREE.Object3D[] }>()
  private readonly bossLimbRest = new Map<string, { base: THREE.Euler; segments: THREE.Euler[] }>()
  private readonly bossPlantFrom = new Map<string, { base: THREE.Euler; segments: number[] }>()
  private bossPoseStateStartedAt = 0
  private bossPlantStartedAt = 0
  private bossPlanted = false
  private proneFlatten = 0

  private readonly roomGroup = new THREE.Group()
  private readonly tableGroup = new THREE.Group()
  private readonly bossGroup = new THREE.Group()
  private readonly gunGroup = new THREE.Group()
  /** 瞄准枢轴：挂在枪座位置，yaw/pitch 绕它旋转，枪口才能真的对准目标 */
  private readonly gunAim = new THREE.Group()
  private readonly gunShake = new THREE.Group()
  private readonly deckGroup = new THREE.Group()
  private readonly cardGroup = new THREE.Group()
  private readonly itemRoot = new THREE.Group()
  private readonly itemGrid = new THREE.Group()
  private readonly lampRig = new THREE.Group()
  /** 背景陈设单独成组：swapRoom 会清空 roomGroup，道具不能跟着被删 */
  private readonly propsGroup = new THREE.Group()
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly spot: THREE.SpotLight
  private readonly rimLight: THREE.PointLight
  private readonly fillLight: THREE.PointLight
  private readonly muzzleLight: THREE.PointLight
  private readonly flash: THREE.Sprite
  private readonly bossParts: TorsoParts
  private drum: THREE.Object3D | null
  /** GLB 霰弹枪的泵动前护木：装填时前后推拉 */
  private pumpSlide: THREE.Object3D | null = null
  private pumpBaseZ = 0

  private cameraBase = new THREE.Vector3(0, 3.62, 4.92)
  private cameraLookAt = new THREE.Vector3(0, 1.02, -0.62)
  private readonly cameraFrom = new THREE.Vector3(0, 3.62, 4.92)
  private readonly lookFrom = new THREE.Vector3(0, 1.02, -0.62)
  private readonly cameraTo = new THREE.Vector3(0, 3.62, 4.92)
  private readonly lookTo = new THREE.Vector3(0, 1.02, -0.62)
  private cameraBlend = 1
  private cameraBlendDuration = 1
  private cameraBlendStartedAt = 0
  private cameraBlendRealtime = false
  private fovFrom = 48
  private fovTo = 48
  private shot: CameraShot = 'table'
  private bloodCloseupGeneration = 0
  private bloodCloseupTimer: number | null = null
  private bloodCloseupTimerResolve: ((proceed: boolean) => void) | null = null
  private bloodCloseupActor: ActorId | null = null
  private bloodCloseupDrain = false
  /** 玩家中弹后的「桌沿低位→坐起→血袋特写」整段：期间保持特写闸门关闭 */
  private playerRecoveryActive = false
  private pendingResolutionShot: { shot: 'death' | 'victory'; duration: number } | null = null
  private revealGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null
  private revealLight: THREE.PointLight | null = null
  /** 中弹低位镜头专用补光：只在这 1 秒多里亮，照亮桌沿/桌底 */
  private recoveryLight: THREE.PointLight | null = null
  private impactLight: THREE.PointLight | null = null
  private impactGeneration = 0
  private revealGlowLife = 0
  private shadowElapsed = 0
  private aimTarget: ActorId = 'boss'
  /** 处决推近进度 0..1；作为视线方向上的偏移叠在相机基座上 */
  private executionPush = 0
  private executionPushGeneration = 0
  /** 平放更接近横置：枪托末尾让开玩家右侧道具栏（1.02 时枪身斜压第一列道具） */
  private gunRestYaw = 1.3
  /** 开局枪平躺在桌面上；第一次处决时抬起，之后沿用原有持枪动画 */
  private gunHolstered = true
  private gunRaiseGeneration = 0
  private gunHolsterY = GUN_PIVOT.y
  /** 抬枪/落枪过渡进行中：引擎要等它结束才允许重新发牌 */
  private gunMotionActive = false
  private gunShakeAfterAim = false
  private gunShakeActive = false
  private readonly gunShakeBase = new THREE.Vector3()
  private gunShakeAccum = 0
  private gunShakeLastPhase = -1
  private readonly gunShakeRight = new THREE.Vector3()
  private readonly gunShakeUp = new THREE.Vector3()
  private readonly gunShakeQuaternion = new THREE.Quaternion()
  private readonly aimScratch = new THREE.Vector3()
  private readonly aimScratchTarget = new THREE.Vector3()
  private readonly bloodBurst: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly bloodVelocity = new Float32Array(BLOOD_PARTICLE_COUNT * 3)
  private bloodLife = 0
  private readonly sparkBurst: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly sparkVelocity = new Float32Array(SPARK_PARTICLE_COUNT * 3)
  private sparkLife = 0
  /** 受击闪白：记录 Boss 各材质原始自发光，衰减后原样还原 */
  private bossFlashLife = 0
  private boss2HeadTwitchLife = 0
  private boss2HeadTwitchCooldown = BOSS2_HEAD_TWITCH_MIN_DELAY + Math.random() * (BOSS2_HEAD_TWITCH_MAX_DELAY - BOSS2_HEAD_TWITCH_MIN_DELAY)
  private bossFlashMaterials: Array<{
    material: THREE.MeshStandardMaterial
    emissive: THREE.Color
    intensity: number
  }> = []
  private bloodMist: THREE.Sprite | null = null
  private bloodMistLife = 0
  private shakeTime = 0
  private shakeDuration = 0
  private shakeStrength = 0
  private hovered: ItemEntry | null = null
  private pointerDownAt: { x: number; y: number } | null = null
  private rafId = 0
  private elapsed = 0
  private levelLookIndex = 0
  private currentLevelIndex = 0
  private lastSnapshot: GameSnapshot | null = null
  /** 玩家持枪选目标时，桌面拾取改为「先点枪，再点双方血袋架」 */
  private targetPickActive = false
  /** 点过枪之后血袋架才可点；进入时架子闪一次并留一层微光 */
  private targetArmed = false
  private targetArmedAt = 0
  private targetArmedHover: ActorId | null = null
  /** 选枪口期间被改色的血袋架材质，退出时逐项还原 */
  private targetArmedMaterials: Array<{
    material: THREE.MeshStandardMaterial
    emissive: THREE.Color
    intensity: number
    actor: ActorId
  }> = []
  /** 血袋架拾取盒：按整架包围盒外扩，袋与袋之间的空隙也能点中 */
  private readonly shotTargetBoxes = new Map<ActorId, THREE.Box3>()
  private gunHovered = false
  private readonly pickHit = new THREE.Vector3()
  private disposed = false
  private readonly onPointerMove: (event: PointerEvent) => void
  private readonly onPointerLeave: () => void
  private readonly onPointerDown: (event: PointerEvent) => void
  private readonly onPointerUp: (event: PointerEvent) => void

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, callbacks: SceneCallbacks = {}) {
    this.container = container
    this.canvas = canvas
    this.callbacks = callbacks

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.98
    // composer 一帧内多次 render，自动重置会把 calls/tris 冲成最后一趟的值；DEV 下改为手动 reset
    if (devStatsEnabled) this.renderer.info.autoReset = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x070a0e)
    this.scene.fog = new THREE.FogExp2(0x070a0e, 0.042)

    // RoomEnvironment 给金属 / 黄铜 / 玻璃提供真实反射；强度克制到不破坏暗调
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environment = this.envTexture
    this.scene.environmentIntensity = ENV_INTENSITY
    pmrem.dispose()

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80)
    this.camera.position.copy(this.cameraBase)
    this.camera.lookAt(this.cameraLookAt)

    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)

    // 只让灯丝、枪口火光、血袋高光发光：阈值压到 0.72，暗场里才有真正的光晕
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.5, 0.72)
    this.composer.addPass(this.bloomPass)

    this.hourglassPass = new ShaderPass(HourglassShader)
    this.composer.addPass(this.hourglassPass)

    this.grainPass = new ShaderPass(GrainShader)
    this.composer.addPass(this.grainPass)

    this.vignettePass = new ShaderPass(VignetteShader)
    this.vignettePass.uniforms.offset!.value = 1.0
    this.vignettePass.uniforms.darkness!.value = 0.85
    this.composer.addPass(this.vignettePass)

    // OutputPass owns tone mapping + sRGB conversion when rendering through the composer.
    this.composer.addPass(new OutputPass())

    this.scene.add(this.roomGroup, this.tableGroup, this.bossGroup, this.gunGroup, this.deckGroup, this.cardGroup, this.itemRoot, this.lampRig, this.propsGroup, this.narrativeGroup)
    // 恢复补光在场景初始化时就建好：枪响那一刻才加灯会让全场景材质重编译，
    // 首帧卡顿会把 0.1s 的枪口火光和 +0.1s 的黑屏一起吞掉
    this.recoveryLight = new THREE.PointLight(0xffa860, 0, 3.2, 2)
    // 左前方的低位侧光：掠亮桌沿立面和双手，避免正打在桌底形成一片泛白
    this.recoveryLight.position.set(-1.35, 0.48, 3.05)
    this.scene.add(this.recoveryLight)
    // 命中闪光同样预建：每次命中加/拆点光都会让全场景材质重编译，枪响当帧卡一下
    this.impactLight = new THREE.PointLight(0xff2a14, 0, 4.5, 2)
    this.scene.add(this.impactLight)
    const debugHost = window as unknown as { __scene?: unknown }
    if (import.meta.env.DEV) debugHost.__scene = this
    else {
      this.sceneDebugFacade = {
        canUseTableActions: () => this.canUseTableActions(),
        getTableActionLayout: () => this.tableActionLayout(),
      }
      debugHost.__scene = this.sceneDebugFacade
    }

    this.buildRoom()
    this.buildTable()
    this.bossParts = this.buildBoss()
    const gun = this.buildGunPlaceholder()
    this.gunAim.position.copy(GUN_PIVOT)
    this.gunAim.rotation.order = 'YXZ'
    this.gunAim.rotation.y = this.gunRestYaw
    this.gunShake.name = 'GunShake'
    this.gunAim.add(this.gunShake)
    this.gunShake.add(gun.root)
    this.revealLight = new THREE.PointLight(0xff2a18, 0, 1.6, 2)
    this.revealLight.position.set(0, 0.135, -0.09)
    this.gunShake.add(this.revealLight)
    this.gunGroup.add(this.gunAim)
    this.holsterGun()
    this.drum = gun.drum
    this.muzzleLight = gun.muzzleLight
    this.flash = gun.flash
    this.bloodBurst = this.buildBloodBurst()
    this.sparkBurst = this.buildSparkBurst()
    this.buildSuspensionRig()

    const lighting = this.buildLighting()
    this.spot = lighting.spot
    this.rimLight = lighting.rim
    this.fillLight = lighting.fill

    this.dust = this.buildDust()
    this.deckGroup.position.copy(DECK_POS)
    this.buildDeckPile()
    this.buildItemGrid()
    this.buildSupplyTray()
    this.buildBulletTray()
    this.buildScorePlates()
    this.buildActionButtons()
    this.buildNarrativeProps()

    this.itemActions = new ItemActions({
      scene: this.scene,
      tableY: TABLE_TOP,
      prop: (item) => this.buildItemContent(item).content,
      hand: () => this.models.get('player_hand'),
      card: (actor, card) => this.findCardMesh(actor, card),
      focus: (point, actor, item) => this.focusItemAction(point, actor, item),
      rest: () => this.setShot('table', 0.8),
      commit: () => this.flushItemEvents(),
      cue: (item, cue) => this.callbacks.onItemActionCue?.(item, cue),
      status: (status) => this.callbacks.onItemActionStatus?.(status),
      restHands: (visible) => { if (this.introHands) this.introHands.visible = visible },
      reducedMotion: () => this.reducedMotion,
      saw: (actor) => this.presentSawCut(actor),
      reload: () => this.playReload(),
    })

    this.preloadModels()

    this.textures.startWatching()
    const unwatch = this.textures.onOverride((key, texture) => this.applyOverride(key, texture))
    this.listenerCleanup.push(unwatch)

    if (this.motionQuery) {
      this.reducedMotion = this.motionQuery.matches
      this.bossPose.setReducedMotion(this.reducedMotion)
      this.motionQuery.addEventListener('change', this.onMotionPreferenceChange)
      this.listenerCleanup.push(() =>
        this.motionQuery?.removeEventListener('change', this.onMotionPreferenceChange),
      )
    }

    this.onPointerMove = (event) => this.handlePointerMove(event)
    this.onPointerLeave = () => {
      this.setHovered(null)
      this.setSupplyHovered(null)
      this.actionHovered = null
      this.actionPressed = null
      this.pointerDownAt = null
      this.targetArmedHover = null
      this.setGunHover(false)
      this.canvas.style.cursor = ''
    }
    this.onPointerDown = (event) => {
      if (!event.isPrimary || event.button !== 0) return
      this.handlePointerMove(event)
      this.pointerDownAt = { x: event.clientX, y: event.clientY }
      this.actionPressed = this.canUseTableActions() ? this.actionHovered : null
    }
    this.onPointerUp = (event) => this.handlePointerUp(event)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('pointercancel', this.onPointerLeave)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.timer.connect(document)
    this.tick = this.tick.bind(this)
    this.rafId = requestAnimationFrame(this.tick)
    this.installBossPoseDebug()
  }

  /** 仅开发期：手动推进/查看姿态时间线，生产构建会被 DEV 常量摇掉 */
  private installBossPoseDebug(): void {
    if (!devStatsEnabled) return
    const controller = this.bossPose
    const host = window as unknown as { __bossPoseDebug?: unknown }
    host.__bossPoseDebug = {
      state: () => controller.state(),
      sample: () => controller.sample(),
      progress: () => controller.stateProgress(),
      hit: (damage = 2, hpAfter = 1) =>
        controller.triggerHit({
          damage,
          hpAfter,
          maxHp: this.lastSnapshot?.boss.maxHp ?? Math.max(1, hpAfter),
          level: BOSS_VISUAL_LEVEL,
          controlled: this.currentLevelIndex === 1 && hpAfter > 0,
          suspended: this.currentLevelIndex === 2 && hpAfter > 0,
        }),
      defeat: () => controller.triggerDefeat(BOSS_VISUAL_LEVEL),
      spawn: () => controller.spawn(BOSS_VISUAL_LEVEL),
      reset: () => controller.reset(),
      seek: (seconds: number) => {
        let left = Math.max(0, seconds)
        while (left > 1e-6) {
          const step = Math.min(1 / 60, left)
          controller.update(step)
          left -= step
        }
      },
      setProfile: () => controller.setProfile(BOSS_VISUAL_LEVEL),
      modelLevel: () => this.activeBossMaskLevel,
      loadedLevels: () => this.bossModelByLevel.map((model) => Boolean(model)),
      currentLevel: () => this.currentLevelIndex,
      shot: () => this.shot,
      pause: (value = true) => {
        this.bossPosePaused = value
      },
      ready: () => Boolean(this.bossGroup.getObjectByName('BossBustGLB')),
      /** 量模型真实几何与相机投影，用于校准各关枢轴/下沉参数 */
      metrics: () => {
        const model = this.bossGroup.getObjectByName('BossBustGLB')
        if (!model) return null
        const box = new THREE.Box3().setFromObject(model)
        this.camera.updateMatrixWorld()
        const ndc = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
        const corner = new THREE.Vector3()
        for (let i = 0; i < 8; i += 1) {
          corner.set(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          )
          corner.project(this.camera)
          ndc.minX = Math.min(ndc.minX, corner.x)
          ndc.maxX = Math.max(ndc.maxX, corner.x)
          ndc.minY = Math.min(ndc.minY, corner.y)
          ndc.maxY = Math.max(ndc.maxY, corner.y)
          ndc.minZ = Math.min(ndc.minZ, corner.z)
          ndc.maxZ = Math.max(ndc.maxZ, corner.z)
        }
        const nodes: Array<{ name: string; type: string; pos: number[] }> = []
        model.traverse((object) => {
          if (!object.name) return
          nodes.push({ name: object.name, type: object.type, pos: object.position.toArray().map((v) => Number(v.toFixed(3))) })
        })
        return {
          world: {
            min: box.min.toArray(),
            max: box.max.toArray(),
            size: box.getSize(new THREE.Vector3()).toArray(),
          },
          nodes,
          ndc,
          wrapper: model.position.toArray(),
          group: this.bossGroup.position.toArray(),
          rot: [this.bossGroup.rotation.x, this.bossGroup.rotation.y, this.bossGroup.rotation.z],
          camera: this.camera.position.toArray(),
          sample: this.bossPose.sample(),
        }
      },
    }
  }

  applySnapshot(snapshot: GameSnapshot): void {
    if (this.disposed) return
    if (this.itemActions.busy) {
      // 动作没演到接触点前，手牌/血袋/点数保持原样；结果在收尾提交时一次补上
      this.pendingVisualSnapshot = snapshot
      this.itemActions.sync(snapshot)
      return
    }
    if (shouldRespawnBossPose(this.lastSnapshot, snapshot)) {
      this.bossPose.spawn(BOSS_VISUAL_LEVEL)
    }
    this.lastSnapshot = snapshot
    const wasTargetPickActive = this.targetPickActive
    this.targetPickActive =
      snapshot.phase === 'targeting' && snapshot.pendingShot === 'player' && !snapshot.paused
    if (!this.targetPickActive) this.disarmTargetPick()
    else if (!wasTargetPickActive) {
      this.disarmTargetPick()
      this.refreshShotTargetBoxes()
    }
    this.applyLevel(snapshot.levelIndex)
    this.syncCards(snapshot)
    this.syncItems(snapshot)
    this.syncSupply(snapshot)
    this.syncScores(snapshot)
    this.syncBlood(snapshot)
    this.syncChains(snapshot)
    this.itemActions.sync(snapshot)
    for (const actor of ['player', 'boss'] as const) {
      const mark = this.sawMarks.get(actor)
      if (mark && snapshot[actor].sawBoost === 0) {
        this.sawMarks.delete(actor)
        mark.removeFromParent()
        this.disposeObject(mark)
      }
    }
    this.hourglassTarget = snapshot.hourglassActive ? 1 : 0
  }

  /** Blends the camera to a named shot; `hold` keeps it there until another shot is set. */
  setShot(shot: CameraShot, duration = 0.9): void {
    if (this.disposed) return
    if (shot !== 'execute') {
      this.gunShakeAfterAim = false
      if (this.gunShakeActive) this.stopGunShake()
    }
    const realtimeBlend = shot === 'bloodPlayer' || shot === 'bloodBoss' || shot === 'bossHead' || (shot === 'table' && this.isCloseupShot())
    // 中弹恢复期间会连续切低位/坐起/桌面机位，这些 setShot 不能把恢复序列自己取消掉
    const keepsCloseup = shot === 'bloodPlayer' || shot === 'bloodBoss' || shot === 'bossHead' || this.playerRecoveryActive || this.bossPoseCameraHold
    if (!keepsCloseup) this.cancelBloodCloseup()
    this.shot = shot
    const target = this.shotFraming(shot)
    this.cameraFrom.copy(this.cameraBase)
    this.lookFrom.copy(this.cameraLookAt)
    this.cameraTo.copy(target.position)
    this.lookTo.copy(target.lookAt)
    this.fovFrom = this.camera.fov
    this.fovTo = target.fov
    this.cameraBlend = 0
    this.cameraBlendDuration = Math.max(0.001, duration)
    this.cameraBlendStartedAt = performance.now()
    this.cameraBlendRealtime = realtimeBlend
    // 离开处决机位时把推近缓回去；无论当前进度是否为 0 都要作废在途的推近 tween，
    // 否则跳过演出后那段延迟 tween 还会在桌面机位里把镜头往前推
    if (shot !== 'execute') {
      this.executionPushGeneration += 1
      if (this.executionPush > 0) this.pushExecutionCamera(0, duration)
    }
    if (shot === 'magnify') this.revealGlowLife = MAGNIFY_HOLD_SECONDS
    else this.clearReveal()
  }

  /** Semi-transparent chamber hint only the player sees: red = live, blue = blank. */
  revealChamber(chamber: Chamber): void {
    if (this.disposed) return
    const live = chamber === 'live'
    if (!this.revealGlow) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xff2a18,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      })
      this.disposableMaterials.add(material)
      const geometry = new THREE.SphereGeometry(0.075, 18, 14)
      this.disposableGeometries.add(geometry)
      const halo = new THREE.Mesh(geometry, material)
      halo.renderOrder = 20
      halo.visible = false
      this.gunShake.add(halo)
      this.revealGlow = halo
    }
    const glow = this.revealGlow
    // 位置使用枪身抖动层的局部坐标：转轮中心正上方
    const cylinderY = 0.075
    glow.visible = true
    glow.position.set(0, cylinderY, -0.09)
    glow.material.color.setHex(live ? 0xff2a18 : 0x2f8cff)
    glow.material.opacity = 0
    glow.scale.setScalar(0.2)
    const light = this.revealLight!
    light.color.setHex(live ? 0xff2a18 : 0x2f8cff)
    light.intensity = 0
    this.tween({
      duration: 0.34,
      onUpdate: (t) => {
        glow.material.opacity = 0.55 * (1 - t) + 0.42 * t
        glow.scale.setScalar(1 + t * 0.4)
        light.intensity = 3.2 * (0.5 + t * 0.5)
      },
    })
    this.revealGlowLife = MAGNIFY_HOLD_SECONDS
  }

  clearReveal(): void {
    this.revealGlowLife = 0
    if (this.revealGlow) {
      this.revealGlow.material.opacity = 0
      this.revealGlow.visible = false
    }
    if (this.revealLight) this.revealLight.intensity = 0
  }

  /** Camera pitches toward the loser, holds its breath, then the shot lands. */
  playExecution(payload: ExecutionPayload): void {
    if (this.disposed) return
    this.clearReveal()
    this.raiseGun()
    const deathShot = payload.lethal && payload.target === 'player'
    this.setShot('execute', 0.85)
    this.aimTarget = payload.target
    this.stopGunShake()
    this.gunShakeAfterAim = payload.by === 'player' && payload.target === 'player'
    // 推进被跳过演出时新旧两段 tween 会并存，用 generation 只让最新的一段写值
    // 玩家中枪那一镜本身有 fov 收窄，再叠推近会顶进玩家模型，这里只留 fov
    if (this.reducedMotion || deathShot) {
      this.executionPushGeneration += 1
      this.executionPush = 0
    } else {
      this.pushExecutionCamera(1, EXECUTION_PUSH_DURATION, EXECUTION_PUSH_DELAY)
    }
    if (deathShot) {
      this.tween({
        duration: 0.9,
        delay: 0.9,
        onUpdate: (t) => {
          this.fovTo = 42 - t * 6
          this.camera.fov = this.fovTo
          this.camera.updateProjectionMatrix()
        },
      })
    }
    this.tween({
      duration: 0.4,
      delay: 1.05,
      onUpdate: (t) => {
        if (this.isCloseupShot()) return
        const jitter = 0.0025 * t
        this.camera.position.x += (Math.random() - 0.5) * jitter
        this.camera.position.y += (Math.random() - 0.5) * jitter
      },
    })
  }

  /** Falls back to the gameplay framing. */
  resetShot(duration = 0.9): void {
    this.setShot('table', duration)
  }

  /** 导演层后期目标：雾密度 / 暗角 / 噪点 / 灯强度 / 灯抖幅，平滑过渡 */
  setNarrativeGrade(grade: {
    fog?: number
    vignette?: number
    grain?: number
    lamp?: number
    flicker?: number
    sway?: number
  }): void {
    if (this.disposed) return
    if (grade.fog !== undefined) this.gradeFogTarget = grade.fog
    if (grade.vignette !== undefined) this.gradeVignetteTarget = grade.vignette
    if (grade.grain !== undefined) this.gradeGrainTarget = grade.grain
    if (grade.lamp !== undefined) this.gradeLampTarget = grade.lamp
    if (grade.flicker !== undefined) this.gradeFlickerTarget = grade.flicker
    if (grade.sway !== undefined) this.narrativeSwayTarget = grade.sway
  }

  resetNarrativeGrade(): void {
    const mood = CHAPTER_MOOD[this.chapterIndex]!
    this.setNarrativeGrade({
      fog: mood.fog,
      vignette: mood.vignette,
      grain: mood.grain,
      lamp: 1,
      flicker: mood.flicker,
      sway: 0,
    })
  }

  /** 逐章压力：雾/暗角/噪点/抖幅/灯高/门缝光/毛巾/刻痕板，顺带提前渐入 LEVEL_LOOK 三色。
   *  不写 levelLookIndex——applyLevel 对同层早退，过渡期间引擎快照不会把颜色回退；
   *  beginLevel 真正换层时 applyLevel 再写一次同样的颜色，天然幂等 */
  setChapterMood(levelIndex: number): void {
    if (this.disposed) return
    const index = Math.min(CHAPTER_MOOD.length - 1, Math.max(0, levelIndex))
    this.chapterIndex = index
    const mood = CHAPTER_MOOD[index]!
    const look = LEVEL_LOOK[index]!
    this.rimLight.color.setHex(look.rim)
    this.fillLight.color.setHex(look.fill)
    this.spot.color.setHex(look.lamp)
    this.resetNarrativeGrade()
    this.lampDropTarget = mood.lampDrop
    this.doorSlitTarget = index === 2 ? 0 : 0.5
    this.setTowelReadable(index >= 1)
    if (this.tallyGroup) this.tallyGroup.visible = index === 2
    // 结局道具不跨章/跨 run 残留
    if (this.sutureGlow) this.sutureGlow.material.opacity = 0
    if (this.reachHand) this.reachHand.visible = false
  }

  /** 结局 B：Boss 缝线里透出刻痕微光，复用 ch3 刻痕贴图，加色混合让「小满」笔划发光 */
  triggerSutureGlow(): void {
    if (this.disposed) return
    if (!this.sutureGlow) {
      const geo = new THREE.PlaneGeometry(0.5, 0.26)
      // 只取刻痕贴图底部「小满 + 空白新刻痕」一条：uv.y 0.08~0.42，不克隆贴图
      const uv = geo.getAttribute('uv')
      for (let i = 0; i < uv.count; i += 1) uv.setY(i, 0.08 + uv.getY(i) * 0.34)
      uv.needsUpdate = true
      this.disposableGeometries.add(geo)
      const mat = new THREE.MeshBasicMaterial({
        map: this.textures.get('tally-list'),
        color: 0xffb08a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      this.disposableMaterials.add(mat)
      const glow = new THREE.Mesh(geo, mat)
      this.bossHitPoint(glow.position)
      // 命中点可能在躯干内部：微光必须贴在身体前方，否则被模型吃掉
      glow.position.z = BOSS_Z + 0.75
      glow.renderOrder = 15
      this.narrativeGroup.add(glow)
      this.sutureGlow = glow
    }
    this.tween({
      duration: 1.8,
      onUpdate: (t) => {
        if (this.sutureGlow) this.sutureGlow.material.opacity = t * 0.95
      },
    })
  }

  /** 结局 B：玩家伸手——真实手部 GLB 挂在相机下，从画面下缘升起并伸向缝线 */
  triggerReachHand(): void {
    if (this.disposed) return
    if (!this.reachHand) {
      const hand = new THREE.Group()
      const source = this.models.get('player_hand')
      if (source) {
        const model = source.clone(true)
        model.scale.setScalar(1.15)
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = false
            child.receiveShadow = false
            child.frustumCulled = false
          }
        })
        hand.add(model)
      } else {
        const geo = new THREE.PlaneGeometry(0.34, 0.34)
        this.disposableGeometries.add(geo)
        const mat = new THREE.MeshBasicMaterial({
          map: this.textures.get('hand-silhouette'),
          transparent: true,
          opacity: 0.94,
          toneMapped: false,
          depthTest: false,
        })
        this.disposableMaterials.add(mat)
        hand.add(new THREE.Mesh(geo, mat))
      }
      const light = new THREE.PointLight(0xffc4a3, 0.6, 0.9, 2)
      light.position.set(0.02, 0.1, 0.05)
      hand.add(light)
      hand.position.set(0.1, -0.5, -0.42)
      hand.rotation.set(0.16, -0.08, -0.08)
      // 相机不挂进 scene 的话，它的子节点不会被渲染
      this.scene.add(this.camera)
      this.camera.add(hand)
      this.reachHand = hand
    }
    const hand = this.reachHand
    hand.visible = true
    this.tween({
      duration: 1.5,
      onUpdate: (t) => {
        hand.position.y = -0.5 + t * 0.26
        hand.position.z = -0.42 - t * 0.12
        hand.rotation.x = 0.16 + t * 0.06
      },
    })
  }

  /** 脚本化惊吓：Boss 猛地转面向玩家再缓慢释放；整 run 由导演层限次 */
  triggerHeadSnap(): void {
    if (this.disposed) return
    this.headSnapLife = HEAD_SNAP_LIFE
  }

  /** 毛巾绣字：第一章模糊，第二章起可读 */
  setTowelReadable(readable: boolean): void {
    if (!this.towelMesh) return
    this.towelMesh.material.map = this.textures.get(readable ? 'towel-readable' : 'towel-blurry')
    this.towelMesh.material.needsUpdate = true
  }

  private updateNarrativeGrade(dt: number): void {
    const k = Math.min(1, dt * 2.2)
    this.gradeFog += (this.gradeFogTarget - this.gradeFog) * k
    this.gradeVignette += (this.gradeVignetteTarget - this.gradeVignette) * k
    this.gradeGrain += (this.gradeGrainTarget - this.gradeGrain) * k
    this.gradeLamp += (this.gradeLampTarget - this.gradeLamp) * k
    this.gradeFlicker += (this.gradeFlickerTarget - this.gradeFlicker) * k
    this.narrativeSway += (this.narrativeSwayTarget - this.narrativeSway) * k
    this.lampDrop += (this.lampDropTarget - this.lampDrop) * k
    this.lampRig.position.y = this.lampBaseY - this.lampDrop
    if (this.doorSlitMat) {
      this.doorSlitOpacity += (this.doorSlitTarget - this.doorSlitOpacity) * k
      this.doorSlitMat.opacity = this.doorSlitOpacity
    }
    const fog = this.scene.fog
    if (fog instanceof THREE.FogExp2) fog.density = this.gradeFog
    this.vignettePass.uniforms.darkness!.value = this.gradeVignette
    this.grainPass.uniforms.amount!.value = this.gradeGrain
    this.grainPass.uniforms.time!.value = this.elapsed
  }

  private pushExecutionCamera(target: number, duration: number, delay = 0): void {
    this.executionPushGeneration += 1
    const generation = this.executionPushGeneration
    const from = this.executionPush
    this.tween({
      duration,
      delay,
      onUpdate: (t) => {
        if (generation !== this.executionPushGeneration) return
        this.executionPush = from + (target - from) * easeInOutCubic(t)
      },
    })
  }

  private bloodFocus(actor: ActorId): THREE.Vector3 {
    const rack = this.bloodRacks.get(actor)
    const focus = new THREE.Vector3()
    if (!rack || rack.bags.length === 0) return focus
    const position = new THREE.Vector3()
    rack.group.updateWorldMatrix(true, true)
    for (const bag of rack.bags) {
      bag.shell.getWorldPosition(position)
      focus.add(position)
    }
    return focus.multiplyScalar(1 / rack.bags.length)
  }

  private shotFraming(shot: CameraShot): {
    position: THREE.Vector3
    lookAt: THREE.Vector3
    fov: number
  } {
    switch (shot) {
      case 'bloodPlayer': {
        const lookAt = this.bloodFocus('player')
        return {
          position: lookAt.clone().add(new THREE.Vector3(0.26, 0.1, 0.56)),
          lookAt,
          fov: 34,
        }
      }
      case 'bloodBoss': {
        const lookAt = this.bloodFocus('boss')
        return {
          position: lookAt.clone().add(new THREE.Vector3(0.42, 0.02, 0.67)),
          lookAt,
          fov: 34,
        }
      }
      case 'bossHead': {
        const lookAt = this.bossHeadBone
          ? this.currentLevelIndex === 2
            ? this.bossHeadBone.localToWorld(new THREE.Vector3(0, 0.11, 0.13))
            : this.bossHeadBone.getWorldPosition(new THREE.Vector3())
          : new THREE.Vector3(0, 2.2 + this.suspensionLift, BOSS_Z + 0.2)
        return {
          position: lookAt.clone().add(new THREE.Vector3(0.04, 0.02, 1.35)),
          lookAt,
          fov: 38,
        }
      }
      case 'bulletTray': {
        const lookAt = new THREE.Vector3(BULLET_TRAY.centerX, TABLE_TOP + 0.06, BULLET_TRAY.centerZ)
        return {
          position: lookAt.clone().add(new THREE.Vector3(0.18, 0.95, 1.3)),
          lookAt,
          fov: 34,
        }
      }
      case 'magnify':
        return {
          position: new THREE.Vector3(0.68, 2.02, 1.62),
          lookAt: new THREE.Vector3(0, 1.0, 0.06),
          fov: 30,
        }
      case 'execute':
        return {
          // 抬高并略后拉：新桌子更深，原机位把枪口顶在画面上缘；这样枪口和枪身都落在画面里
          position: new THREE.Vector3(0.32, 2.32, 1.86),
          lookAt: new THREE.Vector3(0, 1.32, -1.02),
          fov: 38,
        }
      case 'playerDown':
        return {
          // 中枪后趴/靠在桌外：视线越过桌沿直对吊灯，睁眼第一眼看到的是灯
          position: new THREE.Vector3(0.18, 0.52, 3.62),
          lookAt: new THREE.Vector3(-0.15, 4.6, -0.3),
          fov: 62,
        }
      case 'playerSitUp':
        return {
          // 撑桌坐起的中途机位：离桌沿留出距离，双手不会扫进近裁剪面
          position: new THREE.Vector3(0.1, 1.34, 3.3),
          lookAt: new THREE.Vector3(0, 0.98, 0.35),
          fov: 50,
        }
      case 'death':
        return {
          position: new THREE.Vector3(0, 1.28, 2.35),
          lookAt: new THREE.Vector3(0, 1.24, -2.1),
          fov: 52,
        }
      case 'victory':
        return {
          position: new THREE.Vector3(0, 2.35, 3.5),
          lookAt: new THREE.Vector3(0, 1.5, -2.2),
          fov: 44,
        }
      case 'introWake':
        return {
          position: new THREE.Vector3(0.12, 1.32, 2.2),
          lookAt: new THREE.Vector3(-0.15, 4.6, -0.3),
          fov: 58,
        }
      case 'introStain':
        return {
          position: new THREE.Vector3(0.08, 1.45, 2.18),
          lookAt: new THREE.Vector3(0.35, TABLE_TOP, 0.75),
          fov: 46,
        }
      case 'introPaper':
        return {
          position: new THREE.Vector3(-0.05, 1.44, 2.16),
          lookAt: new THREE.Vector3(-1.35, TABLE_TOP, 1.15),
          fov: 42,
        }
      case 'introDoor':
        return {
          position: new THREE.Vector3(0, 1.5, 2.16),
          lookAt: new THREE.Vector3(0, 1.3, 9.9),
          fov: 58,
        }
      case 'introTowel':
        return {
          position: new THREE.Vector3(-0.1, 1.44, 2.18),
          lookAt: new THREE.Vector3(-0.72, 1.1, 1.42),
          fov: 40,
        }
      case 'introTable':
        return {
          position: new THREE.Vector3(0, 1.52, 2.2),
          lookAt: new THREE.Vector3(0, 1.0, -0.2),
          fov: 52,
        }
      case 'introBoss':
        return {
          position: new THREE.Vector3(0, 1.55, 2.25),
          lookAt: new THREE.Vector3(0, 1.6, -3),
          fov: 46,
        }
      case 'endingReach':
        return {
          position: new THREE.Vector3(0, 1.55, 2.3),
          lookAt: new THREE.Vector3(0, 1.9, -3),
          fov: 50,
        }
      case 'tally':
        return {
          position: new THREE.Vector3(-0.8, 2.2, -2.2),
          lookAt: new THREE.Vector3(-1.55, 2.45, -4.35),
          fov: 40,
        }
      case 'supply':
        return {
          // 玩家补给：两块托盘都开着，机位从玩家侧看左半桌
          position: new THREE.Vector3(-0.62, 2.55, 2.95),
          lookAt: new THREE.Vector3(SUPPLY_TRAY.centerX, TABLE_TOP + 0.05, 0.35),
          fov: 40,
        }
      case 'supplyBoss':
        return {
          // Boss 补给：玩家选完后切到左后托盘，Boss 本人留在画面上方
          position: new THREE.Vector3(-0.45, 2.42, 1.62),
          lookAt: new THREE.Vector3(SUPPLY_TRAY.centerX, TABLE_TOP + 0.06, SUPPLY_TRAY.bossZ - 0.1),
          fov: 40,
        }
      case 'table':
      default:
        return {
          position: new THREE.Vector3(0, 3.62, 4.92),
          lookAt: new THREE.Vector3(0, 1.02, -0.62),
          fov: CHAPTER_MOOD[this.chapterIndex]!.fov,
        }
    }
  }

  isBloodCloseupActive(): boolean {
    return this.bloodCloseupActor !== null || this.playerRecoveryActive
  }

  setResolutionShot(shot: 'death' | 'victory', duration: number): void {
    if (this.isBloodCloseupActive()) {
      this.pendingResolutionShot = { shot, duration }
      return
    }
    this.setShot(shot, duration)
  }

  private cancelBloodCloseup(): void {
    this.bloodCloseupGeneration += 1
    if (this.bloodCloseupTimer !== null) window.clearTimeout(this.bloodCloseupTimer)
    this.bloodCloseupTimer = null
    const resolve = this.bloodCloseupTimerResolve
    this.bloodCloseupTimerResolve = null
    resolve?.(false)
    const shouldSync = this.bloodCloseupActor !== null
    this.bloodCloseupActor = null
    this.bloodCloseupDrain = false
    this.bossPoseHold = false
    this.bossPoseCameraHold = false
    this.bossPose.releasePlantHold()
    this.bossPose.releaseStillHold()
    if (this.playerRecoveryActive) {
      this.playerRecoveryActive = false
      this.resetIntroHandsPose()
      if (this.recoveryLight) this.recoveryLight.intensity = 0
    }
    this.pendingResolutionShot = null
    if (shouldSync && this.lastSnapshot) this.syncBlood(this.lastSnapshot)
  }

  private waitBloodCloseup(ms: number, generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      this.bloodCloseupTimerResolve = resolve
      this.bloodCloseupTimer = window.setTimeout(() => {
        this.bloodCloseupTimer = null
        this.bloodCloseupTimerResolve = null
        resolve(!this.disposed && generation === this.bloodCloseupGeneration)
      }, ms)
    })
  }

  /** 等 Boss 塌倒并趴稳（起身段开始）再切特写；超时兜底，避免慢渲染或调试图冻结时卡死 */
  private waitBossCollapsed(generation: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = performance.now()
      const poll = () => {
        const aborted = this.disposed || generation !== this.bloodCloseupGeneration
        const state = this.bossPose.state()
        const settled = state === 'brace' || state === 'plant' || state === 'still' || state === 'deadProne' || state === 'idle'
        const proneEnough = state === 'prone' && this.elapsed - this.bossPoseStateStartedAt >= 1
        if (aborted || settled || proneEnough || performance.now() - startedAt > 8000) {
          this.bloodCloseupTimer = null
          this.bloodCloseupTimerResolve = null
          resolve(!aborted)
          return
        }
        this.bloodCloseupTimer = window.setTimeout(poll, 50)
      }
      this.bloodCloseupTimerResolve = resolve
      poll()
    })
  }

  private bloodDrainSettled(actor: ActorId): boolean {
    const rack = this.bloodRacks.get(actor)
    const snapshot = this.lastSnapshot
    if (!rack || !snapshot) return true
    const hp = actor === 'player' ? snapshot.player.hp : snapshot.boss.hp
    return rack.bags.every((bag, index) => Math.abs(bag.liquid.scale.y - (index < hp ? 1 : 0)) < 0.01)
  }

  private async runBloodCloseup(actor: ActorId, hpAfter: number, generation: number): Promise<void> {
    const shot: CameraShot = actor === 'player' ? 'bloodPlayer' : 'bloodBoss'
    const suspendedHit = actor === 'boss' && hpAfter > 0 && this.currentLevelIndex === 2
    const holdPlantForCamera = actor === 'boss' && hpAfter > 0 && this.currentLevelIndex <= 1
    if (actor === 'boss') {
      if (suspendedHit) {
        this.bossPose.holdBeforeStill()
        this.bossPoseCameraHold = true
        this.setShot('table', 0.35)
      } else if (holdPlantForCamera) this.bossPose.holdBeforePlant()
      if (!await this.waitBossCollapsed(generation)) return
      this.bossPoseHold = true
    } else if (!await this.waitBloodCloseup(1600, generation)) {
      return
    }
    this.setShot(shot, 0.55)
    if (!await this.waitBloodCloseup(750, generation)) return
    this.bloodCloseupDrain = true
    this.syncBlood(this.lastSnapshot!)
    while (!this.bloodDrainSettled(actor)) {
      if (!await this.waitBloodCloseup(100, generation)) return
    }
    if (!await this.waitBloodCloseup(250, generation)) return
    if (suspendedHit) {
      this.setShot('table', 0.7)
      while (this.shot !== 'table' || this.cameraBlend < 1) {
        if (!await this.waitBloodCloseup(50, generation)) return
      }
      this.setShot('bossHead', 0.55)
      while (this.cameraBlend < 1) {
        if (!await this.waitBloodCloseup(50, generation)) return
      }
      if (!await this.waitBloodCloseup(220, generation)) return
      this.bossPose.releaseStillHold()
      this.bossPoseHold = false
      const startedAt = performance.now()
      while (this.bossPose.state() !== 'idle') {
        if (!await this.waitBloodCloseup(50, generation)) return
        if (performance.now() - startedAt > 5000) break
      }
      this.setShot('table', 0.7)
      while (this.cameraBlend < 1) {
        if (!await this.waitBloodCloseup(50, generation)) return
      }
      this.bossPoseCameraHold = false
    } else if (holdPlantForCamera) {
      this.bossPoseCameraHold = true
      this.setShot('table', 0.7)
      while (this.shot !== 'table' || this.cameraBlend < 1) {
        if (!await this.waitBloodCloseup(50, generation)) return
      }
      this.bossPoseCameraHold = false
      this.bossPoseHold = false
      this.bossPose.releasePlantHold()
    }
    const resolution = this.pendingResolutionShot
    this.pendingResolutionShot = null
    this.bloodCloseupActor = null
    this.bloodCloseupDrain = false
    this.bossPoseHold = false
    if (resolution) {
      this.setShot(resolution.shot, resolution.duration)
      return
    }
    if (hpAfter > 0 && !holdPlantForCamera && !suspendedHit) this.setShot('table', 0.7)
  }

  private playBloodCloseup(actor: ActorId, hpAfter: number, damage: number): boolean {
    if (damage <= 0 || this.reducedMotion) return false
    this.cancelBloodCloseup()
    const generation = this.bloodCloseupGeneration
    this.bloodCloseupActor = actor
    void this.runBloodCloseup(actor, hpAfter, generation)
    return true
  }

  /**
   * 玩家中弹（未死）后的恢复段：黑屏期间切到桌沿低位，黑屏淡出后撑桌坐起回桌面，
   * 视角归位后再播原来的血袋特写。整段保持特写闸门关闭，下一回合不会提前发牌。
   */
  private playPlayerHitRecovery(): void {
    if (this.disposed) return
    this.cancelBloodCloseup()
    const generation = this.bloodCloseupGeneration
    this.playerRecoveryActive = true
    // 用 closeup actor 冻住血袋：黑屏/坐起期间保持旧读数，等特写镜头再抽干
    this.bloodCloseupActor = 'player'
    let light = this.recoveryLight
    if (!light) {
      light = new THREE.PointLight(0xffa860, 0, 3.2, 2)
      light.position.set(-1.35, 0.48, 3.05)
      this.scene.add(light)
      this.recoveryLight = light
    }
    this.tween({ duration: 0.5, onUpdate: (t) => { light.intensity = 3.8 * t } })
    // 黑屏在 100ms 后盖上，落枪放到黑屏已经全黑之后再开始
    this.lowerGun(0.2)
    void this.runPlayerHitRecovery(generation)
  }

  private fadeRecoveryLight(duration: number): void {
    const light = this.recoveryLight
    if (!light) return
    const from = light.intensity
    this.tween({ duration, onUpdate: (t) => { light.intensity = from * (1 - t) } })
  }

  private async runPlayerHitRecovery(generation: number): Promise<void> {
    // 黑屏已经盖住时切低位，外面看不到跳变
    if (!await this.waitBloodCloseup(200, generation)) return
    this.setIntroHandsGrip()
    this.setShot('playerDown', 0.35)
    // 黑屏 1.5s 淡出后再停一拍，让低位视角和模糊睁眼都露出来，然后慢慢撑桌坐起
    if (!await this.waitBloodCloseup(2050, generation)) return
    this.setShot('playerSitUp', 1.6)
    this.fadeRecoveryLight(1.6)
    this.tweenIntroHandsRest(1.9)
    if (!await this.waitBloodCloseup(1800, generation)) return
    this.setShot('table', 1.5)
    // 镜头完全归位后，再播原来的血袋特写
    if (!await this.waitBloodCloseup(1700, generation)) return
    this.setShot('bloodPlayer', 0.55)
    if (!await this.waitBloodCloseup(750, generation)) return
    this.bloodCloseupDrain = true
    this.syncBlood(this.lastSnapshot!)
    while (!this.bloodDrainSettled('player')) {
      if (!await this.waitBloodCloseup(100, generation)) return
    }
    if (!await this.waitBloodCloseup(250, generation)) return
    this.bloodCloseupDrain = false
    this.bloodCloseupActor = null
    this.playerRecoveryActive = false
    this.setShot('table', 0.7)
  }

  playShot(payload: ShotPayload): void {
    if (this.disposed) return
    this.boss2HeadTwitchLife = 0
    this.boss2HeadTwitchCooldown = BOSS2_HEAD_TWITCH_MIN_DELAY + Math.random() * (BOSS2_HEAD_TWITCH_MAX_DELAY - BOSS2_HEAD_TWITCH_MIN_DELAY)
    this.gunShakeAfterAim = false
    this.stopGunShake()
    const live = payload.chamber === 'live'
    // 射向 Boss 时枪口背对镜头、离视点约 3m，原尺寸火光会被击中闪白和桌面高光吞掉；
    // 仅对这种「远处枪口」放大精灵并延长亮灯，读起来才和自射一样有明确的枪口爆闪
    const distantFlash = live && payload.target === 'boss'
    const flashSize = distantFlash ? 0.82 : live ? 0.42 : 0.22
    const flashLife = distantFlash ? 0.18 : 0.1
    this.flash.visible = true
    this.flash.material.opacity = live ? 1 : 0.35
    this.flash.material.color.setHex(live ? 0xffc060 : 0x9fb8c8)
    this.flash.scale.setScalar(flashSize)
    this.tween({
      duration: flashLife,
      onUpdate: (t) => {
        this.flash.scale.setScalar(flashSize * (0.8 + t * 0.8))
        this.flash.material.opacity = (1 - t) ** 2 * (live ? 1 : 0.4)
      },
      onComplete: () => {
        this.flash.visible = false
        this.flash.material.opacity = 0
      },
    })
    const lightPeak = distantFlash ? 54 : live ? 60 : 4
    this.muzzleLight.color.setHex(live ? 0xffb060 : 0x8fb4c8)
    this.muzzleLight.intensity = lightPeak
    this.tween({
      duration: distantFlash ? 0.2 : live ? 0.16 : 0.12,
      onUpdate: (t) => {
        this.muzzleLight.intensity = lightPeak * (1 - t) ** 3
      },
    })

    if (live && payload.target === 'boss') {
      const origin = this.bossHitPoint(this.scratchHitPoint)
      if (payload.blocked) {
        // 被挡下：Boss 不受伤，也不闪白、不后仰，只给一次材质化的碎屑反馈
        this.spawnSparks(origin)
      } else {
        this.flashBoss()
        this.spawnBlood(origin)
        this.bossPose.triggerHit({
          damage: payload.damage,
          hpAfter: payload.hpAfter,
          maxHp: this.lastSnapshot?.boss.maxHp ?? Math.max(1, payload.hpAfter),
          level: BOSS_VISUAL_LEVEL,
          controlled: this.currentLevelIndex === 1 && payload.hpAfter > 0,
          suspended: this.currentLevelIndex === 2 && payload.hpAfter > 0,
        })
      }
    }

    const recoil = live ? 0.19 : 0.05
    this.tween({
      duration: live ? 0.55 : 0.3,
      onUpdate: (t) => {
        const kick = Math.sin(t * Math.PI) * recoil
        this.gunGroup.position.z = kick
        this.gunGroup.rotation.x = -kick * 0.7
      },
      onComplete: () => {
        this.gunGroup.position.z = 0
        this.gunGroup.rotation.x = 0
      },
    })

    // 中弹恢复对每一次实弹命中都播；致命时后面的补针面板和原来一样，盖在这段演出之上
    const playerHitRecovery = live && payload.target === 'player' && payload.damage > 0 && !this.reducedMotion
    if (playerHitRecovery) {
      this.playPlayerHitRecovery()
    } else if (!this.playBloodCloseup(payload.target, payload.hpAfter, payload.damage)) {
      this.resetShot(1.1)
    }
    this.shake(live ? 0.11 : 0.018, live ? 0.6 : 0.3)
    // 等镜头回到桌面机位（或结算机位）后再落枪，避免视角还在移动时枪先归位
    this.lowerGunWhenCameraSettles()
  }

  /** Boss 被实弹命中：整身材质瞬间泛白，随后指数衰减回原样 */
  private flashBoss(): void {
    // 上一次闪白还没衰减完就再次命中：先把原色还回去，
    // 否则会把泛白的自发光当成「原色」记下来，Boss 就永久变白了
    this.restoreBossFlash()
    this.bossGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue
        this.bossFlashMaterials.push({
          material,
          emissive: material.emissive.clone(),
          intensity: material.emissiveIntensity,
        })
      }
    })
    this.bossFlashLife = BOSS_FLASH_LIFE
  }

  private restoreBossFlash(): void {
    for (const entry of this.bossFlashMaterials) {
      entry.material.emissive.copy(entry.emissive)
      entry.material.emissiveIntensity = entry.intensity
    }
    this.bossFlashMaterials = []
    this.bossFlashLife = 0
  }

  playReload(live?: number, blank?: number): void {
    if (this.disposed) return
    const cylinder = this.pendingVisualSnapshot?.cylinder ?? this.lastSnapshot?.cylinder
    this.animateReloadGun()
    this.revealBulletTray(live ?? cylinder?.live ?? 0, blank ?? cylinder?.blank ?? 0)
  }

  private animateReloadGun(): void {
    if (this.pumpSlide) {
      const slide = this.pumpSlide
      const base = this.pumpBaseZ
      this.tween({
        duration: 0.72,
        onUpdate: (t) => {
          // 先向后拉开到底，再推回：0.45 处行程最大
          const pull = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55
          slide.position.z = base + 0.09 * easeInOutCubic(pull)
        },
        onComplete: () => {
          slide.position.z = base
        },
      })
      return
    }
    if (!this.drum) return
    const drum = this.drum
    const start = drum.rotation.z
    this.tween({
      duration: 0.7,
      onUpdate: (t) => {
        drum.rotation.z = start + t * Math.PI * 2
      },
    })
  }

  private revealBulletTray(live: number, blank: number): void {
    const tray = this.bulletTray
    if (!tray) return
    const generation = ++tray.generation
    const total = Math.max(0, Math.min(8, Math.round(live + blank)))
    const liveCount = Math.max(0, Math.min(total, Math.round(live)))
    const down = -BULLET_TRAY.travel
    const from = tray.lift.position.y
    tray.active = true
    tray.light.intensity = 0
    for (const bullet of tray.bullets) {
      bullet.group.visible = false
      bullet.group.position.y = -0.24
    }

    this.tween({
      duration: this.reducedMotion ? 0.1 : 0.18,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        tray.lift.position.y = from + (down - from) * easeInOutCubic(t)
      },
      onComplete: () => {
        if (generation !== tray.generation) return
        for (let index = 0; index < total; index += 1) {
          const bullet = tray.bullets[index]
          if (!bullet) continue
          const material = index < liveCount ? tray.liveMaterial : tray.blankMaterial
          bullet.shell.material = material
          bullet.tip.material = material
          bullet.group.visible = true
          this.tween({
            duration: this.reducedMotion ? 0.16 : 0.42,
            delay: (this.reducedMotion ? 0 : 0.28) + index * (this.reducedMotion ? 0 : 0.06),
            onUpdate: (t) => {
              if (generation !== tray.generation) return
              const eased = this.reducedMotion ? easeOutCubic(t) : easeOutCubic(t) + Math.sin(t * Math.PI) * 0.12
              bullet.group.position.y = -0.24 + (0.03 + 0.24) * eased
            },
          })
        }
        this.tween({
          duration: this.reducedMotion ? 0.14 : 0.34,
          delay: this.reducedMotion ? 0 : 0.38,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.lift.position.y = down + (0 - down) * easeOutCubic(t)
          },
        })
        this.tween({
          duration: 0.35,
          delay: this.reducedMotion ? 0 : 0.3,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.light.intensity = 1.15 * easeOutCubic(t)
          },
        })
        this.tween({
          duration: 0.3,
          delay: this.reducedMotion ? 0.35 : 1.75,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.light.intensity = 1.15 * (1 - easeOutCubic(t))
          },
        })
        this.tween({
          duration: this.reducedMotion ? 0.18 : 0.32,
          delay: this.reducedMotion ? 0.7 : 2.05,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.lift.position.y = down * easeInOutCubic(t)
          },
          onComplete: () => {
            if (generation !== tray.generation) return
            for (const bullet of tray.bullets) bullet.group.visible = false
            tray.lift.position.y = 0
            tray.light.intensity = 0
            tray.active = false
          },
        })
      },
    })

    if (!this.isBloodCloseupActive()) {
      this.setShot('bulletTray', 0.45)
      window.setTimeout(() => {
        if (generation !== tray.generation || this.isBloodCloseupActive()) return
        if (this.shot === 'bulletTray') this.resetShot(0.55)
      }, this.reducedMotion ? 850 : 2050)
    }
  }

  /** 道具演出：从槽位拾起原作道具，交给双手完成起手／接触／收尾 */
  playItemUse(actor: ActorId, item: ItemId): void {
    if (this.disposed) return
    const found = [...this.items.values()].find(
      (entry) => entry.actor === actor && entry.item === item && entry.group.visible,
    )
    const from = found ? found.group.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, TABLE_TOP, actor === 'player' ? 1.2 : -1.2)
    if (found) {
      this.items.delete(found.key)
      if (this.hovered === found) this.setHovered(null)
      const group = found.group
      const startScale = group.scale.x
      this.tween({
        duration: 0.26,
        onUpdate: (t) => {
          group.scale.setScalar(Math.max(0.001, startScale * (1 - easeOutCubic(t))))
        },
        onComplete: () => {
          group.removeFromParent()
          this.disposeObject(group)
        },
      })
    }
    if (this.lastSnapshot) this.itemActions.start(actor, item, this.lastSnapshot, from)
  }

  /** 动作到接触/结算点时，把动作期间压住的手牌、血袋与点数一次补到台面 */
  private flushItemEvents(): void {
    const pending = this.pendingVisualSnapshot
    this.pendingVisualSnapshot = null
    if (pending) this.applySnapshot(pending)
  }

  /** 玩家侧道具特写；Boss 保持桌面机位，避免双方演出抢镜。 */
  private focusItemAction(point: THREE.Vector3, actor: ActorId, item: ItemId): void {
    if (this.disposed || actor !== 'player') return
    const framing = itemActionCamera(item)
    const direction = new THREE.Vector3(0.06, 0.5, 0.86)
    const position = point.clone().addScaledVector(direction.normalize(), framing.distance)
    const target = { position, lookAt: point, fov: framing.fov }
    this.setCameraFraming(target, this.reducedMotion ? 0.18 : 0.55)
  }

  /** 绕过 shot 表直接落一段一次性取景，收尾时由 setShot('table') 回位 */
  private setCameraFraming(target: { position: THREE.Vector3; lookAt: THREE.Vector3; fov: number }, duration: number): void {
    this.cameraFrom.copy(this.cameraBase)
    this.lookFrom.copy(this.cameraLookAt)
    this.cameraTo.copy(target.position)
    this.lookTo.copy(target.lookAt)
    this.fovFrom = this.camera.fov
    this.fovTo = target.fov
    this.cameraBlend = 0
    this.cameraBlendDuration = Math.max(0.001, duration)
    this.cameraBlendStartedAt = performance.now()
    this.cameraBlendRealtime = false
  }

  private findCardMesh(actor: ActorId, card: Card): THREE.Mesh | null {
    const key = this.textures.cardKey(card.rank, card.suit)
    for (const entry of this.cards.values()) {
      if (entry.actor !== actor) continue
      if (entry.cardKey === key) return entry.mesh
    }
    return null
  }

  chooseItemCard(card: Card): void {
    this.itemActions.choose(card)
  }

  cancelItemChoice(): void {
    this.itemActions.cancelChoice()
  }

  /** 锯短枪管：在枪身下留一段断管与切痕，直到加成真正打出实弹才清 */
  private presentSawCut(actor: ActorId): void {
    if (this.sawMarks.has(actor)) return
    const mark = new THREE.Group()
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.038, 0.2, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6c6c68, metalness: 0.7, roughness: 0.55 }),
    )
    pipe.rotation.z = Math.PI / 2
    mark.add(pipe)
    const smear = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 16),
      new THREE.MeshBasicMaterial({ color: 0x2c1a12, transparent: true, opacity: 0.55, depthWrite: false }),
    )
    smear.rotation.x = -Math.PI / 2
    smear.position.y = -0.028
    mark.add(smear)
    mark.position.copy(GUN_PIVOT).add(new THREE.Vector3(-0.62, -0.01, 0.22))
    mark.rotation.y = Math.PI * 0.18
    this.scene.add(mark)
    this.sawMarks.set(actor, mark)
    for (const obj of [pipe.geometry, smear.geometry]) this.disposableGeometries.add(obj)
    for (const mat of [pipe.material, smear.material]) this.disposableMaterials.add(mat as THREE.Material)
  }

  itemActionStatus(): ItemActionStatus | null {
    return this.itemActions.getStatus()
  }

  seekItemAction(seconds: number): ItemActionStatus | null {
    return this.itemActions.seek(seconds)
  }

  holdItemAction(value: boolean): void {
    this.itemActions.hold(value)
  }

  /** 仅供开发期逐帧验收：不经过引擎，直接用当前快照播一件道具动作 */
  previewItemAction(item: ItemId, actor: ActorId = 'player'): boolean {
    if (this.disposed || !this.lastSnapshot) return false
    const from = new THREE.Vector3(0, TABLE_TOP, actor === 'player' ? 1.2 : -1.2)
    this.itemActions.start(actor, item, this.lastSnapshot, from)
    return true
  }

  previewItemCards(): Card[] {
    return this.itemActions.previewCards()
  }

  previewChooseCard(index: number): boolean {
    const card = this.itemActions.previewCards()[index]
    if (!card) return false
    this.itemActions.choose(card)
    return true
  }

  /** 仅供开发期逐帧验收：动作道具、双手与相机的位置，用来判断是否出画 */
  previewItemProbe(): Record<string, unknown> | null {
    const root = this.scene.getObjectByName(this.itemActions.activeName)
    if (!root) return null
    const toWorld = (obj: THREE.Object3D) => obj.getWorldPosition(new THREE.Vector3()).toArray().map((n) => +n.toFixed(3))
    const toNdc = (obj: THREE.Object3D) => {
      const n = obj.getWorldPosition(new THREE.Vector3()).project(this.camera)
      return [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)]
    }
    const handR = this.scene.getObjectByName(`${this.itemActions.activeName}-right`)
    const handL = this.scene.getObjectByName(`${this.itemActions.activeName}-left`)
    const prop = this.itemActions.getHero()
    const ndc = prop ? toNdc(prop) : null
    const parts: Record<string, unknown> = {}
    for (const child of root.children) {
      if (!child.name || !child.visible) continue
      if (child === prop || child === handR || child === handL) continue
      parts[child.name] = { ndc: toNdc(child), world: toWorld(child) }
    }
    return {
      root: toWorld(root),
      prop: prop ? toWorld(prop) : null,
      propNdc: ndc,
      __debug: (() => {
        const out: Record<string, unknown> = {}
        if (prop) {
          out.propRotation = [prop.rotation.x, prop.rotation.y, prop.rotation.z].map((n) => +n.toFixed(2))
          out.propScale = +prop.scale.x.toFixed(2)
          let i = 0
          prop.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return
            const m = Array.isArray(o.material) ? o.material[0] : o.material
            const std = m as THREE.MeshStandardMaterial
            out[`#${i++}-${o.name || 'anon'}`] = {
              visible: o.visible,
              z: +o.getWorldPosition(new THREE.Vector3()).z.toFixed(3),
              color: std.color ? '#' + std.color.getHexString() : '?',
              opacity: std.opacity,
              transparent: std.transparent,
              rough: std.roughness,
              metal: std.metalness,
            }
          })
        }
        return out
      })(),
      parts,
      left: handL ? toWorld(handL) : null,
      right: handR ? toWorld(handR) : null,
      leftRotation: handL ? [handL.rotation.x, handL.rotation.y, handL.rotation.z].map((n) => +n.toFixed(2)) : null,
      rightRotation: handR ? [handR.rotation.x, handR.rotation.y, handR.rotation.z].map((n) => +n.toFixed(2)) : null,
      grip: this.itemActions.getGripProbe(),
      contact: this.itemActions.getContactProbe(),
      camera: this.camera.position.toArray().map((n) => +n.toFixed(3)),
      fov: +this.camera.fov.toFixed(1),
    }
  }

  previewRenderMemory(): Record<string, number> {
    return { ...this.renderer.info.memory }
  }
  cancelItemAction(): void {
    this.itemActions.cancel()
  }
  isItemActionBusy(): boolean {
    return this.itemActions.busy
  }

  whenItemReady(): Promise<void> {
    return this.itemActions.whenReady()
  }

  skipItemAction(): boolean {
    return this.itemActions.skip()
  }

  breakItemShield(actor: ActorId): void {
    this.itemActions.breakShield(actor)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.itemActions.dispose()
    this.bloodCloseupGeneration += 1
    if (this.bloodCloseupTimer !== null) window.clearTimeout(this.bloodCloseupTimer)
    this.bloodCloseupTimer = null
    this.bloodCloseupTimerResolve?.(false)
    this.bloodCloseupTimerResolve = null
    this.bloodCloseupActor = null
    cancelAnimationFrame(this.rafId)
    this.timer.dispose()
    this.resizeObserver.disconnect()
    for (const cleanup of this.listenerCleanup) cleanup()
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('pointercancel', this.onPointerLeave)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.callbacks.onItemHover?.(null)
    this.callbacks.onGunHover?.(null)
    for (const entry of this.items.values()) this.disposeObject(entry.group)
    this.items.clear()
    for (const entry of this.supplyItems.values()) this.disposeObject(entry.group)
    this.supplyItems.clear()
    for (const entry of this.bossSupplyItems.values()) this.disposeObject(entry.group)
    this.bossSupplyItems.clear()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
      }
    })
    const modelTemplates = new Set<THREE.Object3D>([
      ...this.models.values(),
      ...this.itemModelTemplates.values(),
    ])
    for (const template of modelTemplates) this.disposeObject(template)
    const debugHost = window as unknown as { __scene?: unknown }
    if (debugHost.__scene === this || debugHost.__scene === this.sceneDebugFacade) delete debugHost.__scene
    this.textures.dispose()
    for (const plate of this.scorePlates.values()) plate.texture.dispose()
    for (const button of this.actionButtons.values()) button.texture.dispose()
    this.envTexture?.dispose()
    this.models.clear()
    this.itemModelTemplates.clear()
    if (devStatsEnabled) {
      const host = window as unknown as { __bossPoseDebug?: unknown }
      delete host.__bossPoseDebug
    }
    this.composer.dispose()
    this.renderer.dispose()
  }

  /** 用 GLB 模型替换某个已存在道具的程序化几何（内容重建，外层只保留摆放姿态） */
  private replaceItemMesh(entry: ItemEntry, source: THREE.Object3D): void {
    for (const child of [...entry.group.children]) {
      entry.group.remove(child)
      this.disposeObject(child)
    }
    entry.materials.length = 0

    const { content, materials } = this.buildItemContent(entry.item, source)
    entry.materials.push(...materials)
    entry.group.add(content)
    // 程序化几何的归一化旋转会落在旧外层上，替换后必须回到道具自己的摆放姿态
    this.applyItemPose(entry.group, entry.item, entry.actor)
    this.attachItemPickProxy(entry.group, content)
    entry.spawnTarget = 1
    entry.spawnScale = 1
    entry.group.scale.setScalar(ITEM_SCALE * entry.hoverScale)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /** 异步载入 GLB：首层关键 → 空闲次级 → Boss2/3 进层补齐；失败保持缺失并回退程序化几何 */
  private preloadModels(): void {
    const critical: ModelKey[] = ['table_gothic', 'room_environment', 'shotgun', 'player_hand', 'boss_1']
    const interactive: ModelKey[] = [
      'item_magnifier',
      'item_syringe',
      'item_saw',
      'item_magnet',
      'item_handcuffs',
      'item_hourglass',
      'item_dagger',
      'item_aegis',
      'item_hammer',
      'item_seal',
      'item_cutter',
      'item_iou',
      'item_monocle',
    ]
    const decorative: ModelKey[] = ['gothic_statue', 'marble_bust_01']
    // 大件场景模型不必和道具一样压那么暗，否则整个桌面沉进黑里
    const dimFor = (key: ModelKey): number => {
      if (key === 'table_gothic') return 0.82
      if (key === 'room_environment') return 0.9
      // Boss 是视觉焦点，压太狠时脸部和躯干细节全丢
      if (key === 'boss_1' || key === 'boss_2' || key === 'boss_3') return 0.85
      return VERTEX_COLOR_DIM
    }
    // 带贴图的模型没有顶点色，走 albedo 压暗那一支，必须单独给值
    const albedoDimFor = (key: ModelKey): number => {
      // 瘟疫医生贴图本身极黑，再压暗会在暗场里全黑，不额外衰减
      if (key === 'boss_1') return 1.0
      if (key === 'boss_2' || key === 'boss_3') return 0.85
      if (key === 'player_hand') return 0.85
      // 哥特桌是木材质贴图，压到默认 0.42 会整张沉进暗场，桌沿轮廓就没了
      if (key === 'table_gothic') return 0.85
      return key === 'gothic_statue' || key === 'marble_bust_01' ? 0.62 : GLB_ALBEDO_DIM
    }

    const criticalTask = this.loadModelBatch(critical, dimFor, albedoDimFor, true)
    const interactiveTask = this.loadModelBatch(interactive, dimFor, albedoDimFor, false)
    this.pendingModels.push(criticalTask, interactiveTask)
    void criticalTask.then(() => {
      const idle = (cb: () => void): void => {
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 1200 })
        else window.setTimeout(cb, 400)
      }
      idle(() => this.pendingModels.push(this.loadModelBatch(decorative, dimFor, albedoDimFor, false)))
    })
  }

  private async loadModelBatch(
    keys: readonly ModelKey[],
    dimFor: (key: ModelKey) => number,
    albedoDimFor: (key: ModelKey) => number,
    reportProgress: boolean,
  ): Promise<void> {
    let loaded = 0
    await Promise.all(
      keys.map(async (key) => {
        try {
          const gltf = await this.loadModelWithRetry(key)
          if (this.disposed) {
            this.disposeObject(gltf.scene)
            return
          }
          const root = gltf.scene
          const tuned = new Set<THREE.Material>()
          const dim = dimFor(key)
          root.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true
              child.receiveShadow = true
              child.frustumCulled = false
              const materials = Array.isArray(child.material) ? child.material : [child.material]
              for (const material of materials) {
                // 模板材质只处理一次；后续 clone(true) 共享同一批材质，不会重复压暗
                if (tuned.has(material)) continue
                tuned.add(material)
                tuneGltfMaterial(material, dim, albedoDimFor(key))
              }
            }
          })
          this.models.set(key, root)
          this.onModelReady(key, root)
        } catch (error: unknown) {
          // 缺模型不是致命错误：程序化几何继续兜底，但要让宿主知道发生了降级
          console.debug(`[SceneManager] 模型 ${key}.glb 加载失败，回退程序化几何`, error)
          this.callbacks.onLoadError?.(key, error)
        } finally {
          loaded += 1
          if (reportProgress) {
            this.callbacks.onLoadProgress?.({ loaded, total: keys.length, key })
          }
        }
      }),
    )
  }

  private async loadModelWithRetry(key: ModelKey): Promise<GLTF> {
    let delay = 1000
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let timeout: number | null = null
      try {
        const request = this.gltfLoader.loadAsync(`${MODEL_BASE}/${key}.glb`)
        const deadline = new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => reject(new Error(`模型 ${key} 加载超时`)), 12_000)
        })
        return await Promise.race([request, deadline])
      } catch (error) {
        if (attempt === 2 || this.disposed) throw error
        await new Promise<void>((resolve) => window.setTimeout(resolve, delay))
        delay *= 3
      } finally {
        if (timeout !== null) window.clearTimeout(timeout)
      }
    }
    throw new Error(`模型 ${key} 加载失败`)
  }

  setQuality(preset: QualityPreset): void {
    if (this.disposed) return
    this.quality = preset
    const q = QUALITY_SETTINGS[preset]
    const dpr = Math.min(window.devicePixelRatio, q.maxDpr)
    this.renderer.setPixelRatio(dpr)
    this.composer.setPixelRatio(dpr)
    this.bloomPass.enabled = q.bloom
    this.grainPass.enabled = q.grain
    if (this.spot.shadow.mapSize.x !== q.shadow) {
      this.spot.shadow.mapSize.set(q.shadow, q.shadow)
      this.spot.shadow.map?.dispose()
      this.spot.shadow.map = null
      this.renderer.shadowMap.needsUpdate = true
    }
    this.resize()
  }

  getQuality(): QualityPreset {
    return this.quality
  }

  /** 把 Blender 模型按目标尺寸贴到桌面：底座对齐 y，水平居中 */
  private placeModel(
    source: THREE.Object3D,
    targetSize: number,
    position: THREE.Vector3,
    rotationY = 0,
    fit: 'longest' | 'height' = 'longest',
  ): THREE.Group {
    const wrapper = new THREE.Group()
    // 蒙皮模型的普通 clone 仍指向模板骨骼，必须用 SkeletonUtils 重绑克隆体骨骼
    const clone = cloneSkinnedObject(source)
    wrapper.add(clone)

    const box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    const basis = fit === 'height' ? size.y : Math.max(size.x, size.y, size.z)
    const scale = basis > 1e-6 ? targetSize / basis : 1
    clone.scale.setScalar(scale)

    // 缩放后重新测量，把底部压到 wrapper 的 y=0、水平居中
    const scaled = new THREE.Box3().setFromObject(clone)
    const center = scaled.getCenter(new THREE.Vector3())
    clone.position.set(-center.x, -scaled.min.y, -center.z)

    wrapper.position.copy(position)
    wrapper.rotation.y = rotationY
    return wrapper
  }

  /** 模型到达后替换对应部位 */
  private onModelReady(key: ModelKey, root: THREE.Object3D): void {
    switch (key) {
      case 'shotgun': {
        this.swapShotgun(root)
        break
      }
      case 'boss_1':
      case 'boss_2':
      case 'boss_3': {
        const level = Number(key.slice(-1)) - 1
        this.bossModelByLevel[level] = root
        // 统一层模型就绪时不看当前关卡，立刻换
        if (level === BOSS_VISUAL_LEVEL || level === this.currentLevelIndex) this.applyBossMaskModel()
        break
      }
      case 'table_gothic': {
        this.swapTable(root)
        break
      }
      case 'room_environment': {
        this.swapRoom(root)
        break
      }
      case 'gothic_statue':
      case 'marble_bust_01': {
        this.refreshProps()
        break
      }
      case 'player_hand': {
        this.buildIntroHands(root)
        break
      }
      default: {
        break
      }
    }

    // 道具模型：登记模板，并把桌上已存在的同类道具换成模型
    const itemId = (Object.keys(ITEM_MODEL) as ItemId[]).find((id) => ITEM_MODEL[id] === key)
    if (itemId) {
      this.itemModelTemplates.set(itemId, root)
      for (const entry of this.items.values()) {
        if (entry.item !== itemId) continue
        this.replaceItemMesh(entry, root)
      }
      for (const entry of this.supplyItems.values()) {
        if (entry.item !== itemId) continue
        this.replaceItemMesh(entry, root)
      }
      for (const entry of this.bossSupplyItems.values()) {
        if (entry.item !== itemId) continue
        this.replaceItemMesh(entry, root)
      }
    }
  }

  /** 第一人称前景：右手原模、左手镜像，腕部朝向玩家，指尖自然伸向桌面 */
  private buildIntroHands(source: THREE.Object3D): void {
    if (this.introHands || this.disposed) return
    const group = new THREE.Group()
    for (const side of [-1, 1]) {
      const hand = source.clone(true)
      hand.updateMatrixWorld(true)
      // meshopt 重导出的手模型：各网格顶点是 [-1,1] 归一化、靠自身缩放落到真实尺寸。
      // 直接把原树按 1.15 缩放会得到两米巨手铺满镜头，所以先把各网格的局部变换烘进几何，
      // 再按整手包围盒归一化到真实手长（与 ItemActions 的 ActionHand 保持一致）。
      hand.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.geometry = child.geometry.clone()
        child.geometry.applyMatrix4(child.matrixWorld)
        child.position.set(0, 0, 0)
        child.rotation.set(0, 0, 0)
        child.scale.setScalar(1)
        child.updateMatrix()
      })
      hand.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(hand)
      const longest = Math.max(...box.getSize(new THREE.Vector3()).toArray())
      const fit = longest > 1e-6 ? 0.218 / longest : 1.15
      hand.scale.set(fit * side, fit, fit)
      hand.position.set(side * 0.43, TABLE_TOP + 0.022, 2.05)
      hand.rotation.y = side * 0.08
      hand.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // 桌沿远景不需要掌纹/静脉曲线：每只手只保留皮肤与 5 枚指甲，
          // 软件渲染下少 13 个 draw call；结局近景仍使用完整模型
          if (/^SM_PlayerHand_(Crease|PalmLine|Vein)/.test(child.name)) child.visible = false
          child.castShadow = true
          child.receiveShadow = true
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) material.side = THREE.DoubleSide
        }
      })
      group.add(hand)
    }
    this.narrativeGroup.add(group)
    this.introHands = group
  }

  /** 中弹后双手先扒住桌沿；黑屏期间完成，不可见 */
  private setIntroHandsGrip(): void {
    const group = this.introHands
    if (!group) return
    this.introHandsTween += 1
    for (const hand of group.children) {
      hand.position.set(
        hand.position.x < 0 ? -0.42 : 0.42,
        TABLE_TOP + 0.09,
        2.66,
      )
    }
  }

  /** 坐起过程中双手从桌沿滑回桌面原位 */
  private tweenIntroHandsRest(duration: number): void {
    const group = this.introHands
    if (!group) return
    const generation = ++this.introHandsTween
    for (const hand of group.children) {
      const target = new THREE.Vector3(
        hand.position.x < 0 ? -0.43 : 0.43,
        TABLE_TOP + 0.022,
        2.05,
      )
      const from = hand.position.clone()
      this.tween({
        duration,
        onUpdate: (t) => {
          if (generation !== this.introHandsTween) return
          const eased = easeOutCubic(t)
          hand.position.x = from.x + (target.x - from.x) * eased
          hand.position.z = from.z + (target.z - from.z) * eased
          // 跨过桌沿时抬一点，别从雕花边框里穿过去
          hand.position.y = from.y + (target.y - from.y) * eased + Math.sin(t * Math.PI) * 0.05
        },
      })
    }
  }

  private resetIntroHandsPose(): void {
    const group = this.introHands
    if (!group) return
    this.introHandsTween += 1
    for (const hand of group.children) {
      hand.position.set(
        hand.position.x < 0 ? -0.43 : 0.43,
        TABLE_TOP + 0.022,
        2.05,
      )
    }
  }

  /** 用 GLB 霰弹枪替换程序化占位枪，保留开火动画所需的 group 层级 */
  private swapShotgun(root: THREE.Object3D): void {
    const placeholder = this.gunGroup.getObjectByName('GunPlaceholder')
    const holder = new THREE.Group()
    holder.name = 'ShotgunGLB'

    const clone = root.clone(true)
    // Blender 中枪口朝 +Y，导出后即 -Z，与场景枪口朝向一致，无需额外旋转
    const box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    const scale = 3 / Math.max(size.x, size.y, size.z)
    clone.scale.setScalar(scale)
    const scaled = new THREE.Box3().setFromObject(clone)
    const center = scaled.getCenter(new THREE.Vector3())
    // 底座贴桌面，水平居中
    clone.position.set(-center.x, -scaled.min.y, -center.z)
    holder.add(clone)

    // 枪口火光与点光原本挂在程序化模型里，换模型前先挪到抖动层，否则一起被销毁
    this.gunShake.add(this.flash, this.muzzleLight)
    this.gunShake.add(holder)
    // 枪口锚点随模型缩放/居中移动，火光必须贴着真实枪口；先刷矩阵再换算成抖动层局部坐标
    this.gunShake.updateWorldMatrix(true, true)
    const muzzle = clone.getObjectByName('MuzzlePoint')
    if (muzzle) {
      const muzzleLocal = muzzle.getWorldPosition(new THREE.Vector3())
      this.gunShake.worldToLocal(muzzleLocal)
      this.flash.position.copy(muzzleLocal)
      this.muzzleLight.position.copy(muzzleLocal)
    }

    if (placeholder) {
      // 占位枪挂在抖动层下，必须从真实父节点摘下，否则两把枪叠在一起
      placeholder.removeFromParent()
      this.disposeObject(placeholder)
      // 转轮随占位枪一起销毁，不能再让装填动画去转它
      this.drum = null
    }

    // 装填动画：有泵动护木就推拉护木，否则回退到占位枪的转轮
    const pump = clone.getObjectByName('PumpSlide')
    if (pump) {
      this.pumpSlide = pump
      this.pumpBaseZ = pump.position.z
    }

    // 换模型会改变包围盒，平躺姿态要按新枪重新贴一次桌面
    if (this.gunHolstered) this.settleGunOnTable()
  }

  /**
   * 用 Poly Haven 的哥特咖啡桌替换程序化桌体。
   * 小桌放大到能罩住整套道具摊面：x/z 各自非均匀缩放，把下沉凹板拉到桌面覆盖范围，
   * y 缩放让凹板面正好落在 TABLE_TOP，桌脚仍踩在地面上；
   * 卡牌/道具/枪的坐标无需改动，边框比面板高约 6cm，边缘道具不会埋进雕花里。
   */
  private swapTable(root: THREE.Object3D): void {
    const stale: THREE.Object3D[] = []
    for (const child of this.tableGroup.children) {
      if (child.userData.proceduralTable) stale.push(child)
    }
    if (stale.length === 0) return
    for (const child of stale) {
      this.tableGroup.remove(child)
      this.disposeObject(child)
    }

    const clone = root.clone(true)
    clone.scale.set(
      GOTHIC_TABLE_FIT_HALF_X / GOTHIC_TABLE_PANEL_HALF,
      TABLE_TOP / GOTHIC_TABLE_PANEL_TOP,
      GOTHIC_TABLE_FIT_HALF_Z / GOTHIC_TABLE_PANEL_HALF,
    )
    // 模型原点在脚底、水平居中，缩放后直接落地即可
    clone.position.set(0, 0, 0)
    clone.name = 'GothicTableGLB'
    this.tableGroup.add(clone)
  }

  /** 用 Blender 密室替换程序化立方体房间；吊灯并入 lampRig 以保留摆动动画 */
  private swapRoom(root: THREE.Object3D): void {
    const procedural: THREE.Object3D[] = []
    for (const child of this.roomGroup.children) {
      procedural.push(child)
    }
    for (const child of procedural) {
      this.roomGroup.remove(child)
      this.disposeObject(child)
    }

    const shell = root.clone(true)
    shell.name = 'RoomGLB'
    // 墙体 glTF 的 y 范围 -6.96..0.10，地面在 y≈-0.05；整体不动即可对齐世界原点地面
    this.roomGroup.add(shell)

    // 吊灯构件从密室拆出，挂到 lampRig（保留原有的微摆动画）
    const lampNames = ['LampBulb', 'LampCage', 'LampShade', 'LampTop', 'LampCanopy',
      'LampCable0', 'LampCable1', 'LampCable2',
      'LampFilaments0', 'LampFilaments1', 'LampFilaments2']
    const lampPivot = new THREE.Group()
    lampPivot.name = 'LampPivot'
    let moved = 0
    for (const name of lampNames) {
      // Blender 导出时重名节点会带 .001 后缀，按前缀回退匹配
      const node = shell.getObjectByName(name)
        ?? shell.children.find((child) => child.name.startsWith(name))
      if (!node) continue
      shell.remove(node)
      lampPivot.add(node)
      moved += 1
    }

    if (moved > 0) {
      // 清掉程序化吊灯，枢轴抬到天花高度，让摆动像真正从顶上垂下来
      for (const child of [...this.lampRig.children]) {
        this.lampRig.remove(child)
        this.disposeObject(child)
      }
      lampPivot.position.y = -CEILING_Y
      this.lampRig.position.set(0, CEILING_Y, 0)
      this.lampBaseY = CEILING_Y
      this.lampRig.add(lampPivot)

      // 聚光灯必须挂在灯罩下沿：置于罩体内会被罩壁完全遮挡，桌面出现一大片黑斑
      this.spot.position.set(0, LAMP_SHADE_BOT_Y - 0.05, -0.05)
    }
  }

  /**
   * 背景陈设：两件 Poly Haven 静态道具。
   * 每件模型独立到达，所以每次都整组重建——两件共享同一批几何/材质，重建不额外占显存。
   */
  private refreshProps(): void {
    const statue = this.models.get('gothic_statue')
    const bust = this.models.get('marble_bust_01')
    if (!statue && !bust) return
    // 旧克隆只摘不销毁：几何与材质和模板共享，销毁会把仍在用的模板一起废掉
    for (const child of [...this.propsGroup.children]) this.propsGroup.remove(child)

    if (statue) {
      // 左后墙下的葬像：冷色轮廓光从右后方勾出剪影，头顶是那扇冷光窗
      const wrapper = this.placeModel(
        statue,
        1.74,
        new THREE.Vector3(-3.35, 0, -4.35),
        0.55,
        'height',
      )
      wrapper.name = 'GothicStatue'
      this.propsGroup.add(wrapper)
    }
    if (bust) {
      // 右侧货架第二层：底座落在层板顶面 y=1.48，被后方红光从侧面舔亮
      const wrapper = this.placeModel(
        bust,
        0.51,
        new THREE.Vector3(2.15, 1.48, -5.05),
        0.5,
        'height',
      )
      wrapper.name = 'MarbleBust'
      this.propsGroup.add(wrapper)
    }
  }

  /** 叙事陈设：纸片 / 手印 / 毛巾 / 门缝光 / 椅扶手；跨章持久，不随 swapRoom 清除 */
  private buildNarrativeProps(): void {
    const flat = (
      key: string,
      w: number,
      h: number,
      x: number,
      z: number,
      rotZ: number,
      tint = 0xffffff,
    ): void => {
      const geo = new THREE.PlaneGeometry(w, h)
      this.disposableGeometries.add(geo)
      const mat = new THREE.MeshStandardMaterial({
        map: this.textures.get(key),
        // 纸片压暗：亮度留在 bloom 阈值下，否则光晕把「满」字veil成白片
        color: tint,
        transparent: true,
        roughness: 0.9,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      })
      this.disposableMaterials.add(mat)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.rotation.z = rotZ
      mesh.position.set(x, TABLE_TOP + 0.006, z)
      this.narrativeGroup.add(mesh)
    }
    flat('paper-scrap', 0.3, 0.3, -1.35, 1.15, 0.35, 0x808080)
    flat('handprint', 0.55, 0.55, 0.35, 0.75, -0.2)

    const towelGeo = new THREE.PlaneGeometry(0.3, 0.36)
    this.disposableGeometries.add(towelGeo)
    const towelMat = new THREE.MeshStandardMaterial({
      map: this.textures.get('towel-blurry'),
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(towelMat)
    const towel = new THREE.Mesh(towelGeo, towelMat)
    towel.position.set(-0.72, 1.12, 1.42)
    towel.rotation.y = -0.35
    towel.rotation.x = 0.06
    this.narrativeGroup.add(towel)
    this.towelMesh = towel

    // 玩家身后的门：暗门板 + 一条冷白门缝光；第三章由导演层熄灭
    const doorGeo = new THREE.BoxGeometry(1.15, 2.3, 0.08)
    this.disposableGeometries.add(doorGeo)
    const doorMat = makeStandardMaterial(0x120d0a, 0.4, 0.9)
    this.disposableMaterials.add(doorMat)
    const door = new THREE.Mesh(doorGeo, doorMat)
    door.position.set(0, 1.15, 9.92)
    this.narrativeGroup.add(door)
    const slitGeo = new THREE.PlaneGeometry(0.035, 2.1)
    this.disposableGeometries.add(slitGeo)
    const slitMat = new THREE.MeshBasicMaterial({
      color: 0xbfd8e8,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    })
    this.disposableMaterials.add(slitMat)
    this.doorSlitMat = slitMat
    const slit = new THREE.Mesh(slitGeo, slitMat)
    slit.position.set(0.5, 1.15, 9.87)
    slit.rotation.y = Math.PI
    this.narrativeGroup.add(slit)

    // 玩家双手由 player_hand.glb 到达后放到桌沿，不再用方块椅扶手冒充前景

    // 刑台刻痕名单：吊轨 + 双链 + 铁板，第三章才挂出来
    const tally = new THREE.Group()
    tally.position.set(-1.55, 2.45, -4.35)
    tally.rotation.y = 0.3
    const boardGeo = new THREE.PlaneGeometry(0.5, 0.75)
    this.disposableGeometries.add(boardGeo)
    const boardMat = new THREE.MeshStandardMaterial({
      map: this.textures.get('tally-list'),
      roughness: 0.85,
      metalness: 0.2,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(boardMat)
    const board = new THREE.Mesh(boardGeo, boardMat)
    tally.add(board)
    const railGeo = new THREE.BoxGeometry(0.72, 0.045, 0.045)
    this.disposableGeometries.add(railGeo)
    const railMat = makeStandardMaterial(0x3a332c, 0.7, 0.6)
    this.disposableMaterials.add(railMat)
    const rail = new THREE.Mesh(railGeo, railMat)
    rail.position.y = 0.48
    tally.add(rail)
    const chainGeo = new THREE.BoxGeometry(0.018, 0.7, 0.018)
    this.disposableGeometries.add(chainGeo)
    for (const x of [-0.26, 0.26]) {
      const link = new THREE.Mesh(chainGeo, railMat)
      link.position.set(x, 0.82, 0)
      tally.add(link)
    }
    tally.visible = false
    this.narrativeGroup.add(tally)
    this.tallyGroup = tally
  }

  /** 第一关面具到货即换掉程序化面具贴图 */
  private tick(): void {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.tick)
    this.timer.update()
    const rawDt = this.timer.getDelta()
    const dt = Math.min(rawDt, 1 / 20)
    const animationDt = Math.min(rawDt, 0.25)
    this.shadowElapsed += rawDt
    if (this.shadowElapsed >= 1 / 30) {
      this.renderer.shadowMap.needsUpdate = true
      this.shadowElapsed = 0
    }
    this.elapsed += animationDt
    this.updateTweens(animationDt)
    this.updateLighting()
    this.updateBoss(animationDt)
    this.updateDust(dt)
    this.updateBlood(dt)
    this.updateSparks(dt)
    this.updateHourglass(animationDt)
    this.updateNarrativeGrade(animationDt)
    this.updateChains(animationDt)
    this.updateGunAim(animationDt)
    if (this.gunMotionActive) this.keepGunAboveTable()
    this.updateGunShake(animationDt)
    this.updateArmedRacks()
    this.updateItems(animationDt)
    this.updateCards(animationDt)
    this.itemActions.update(animationDt)
    this.updateCamera(animationDt)
    this.updateActionButtons(animationDt)
    this.composer.render(animationDt)
    this.sampleStats(rawDt)
    if (devStatsEnabled) this.renderer.info.reset()
  }

  /**
   * 仅开发期的性能取样：每 2 秒 console.debug 一次 FPS 与 draw call。
   * 必须在 composer.render 之后取：一帧内多次 render，关掉 autoReset 才能累计整帧的 calls/tris。
   */
  private sampleStats(dt: number): void {
    if (!devStatsEnabled) return
    this.statFrames += 1
    this.statElapsed += dt
    if (this.statElapsed < 2) return
    const info = this.renderer.info.render
    console.debug(
      `[SceneManager] ${Math.round(this.statFrames / this.statElapsed)} fps · calls ${info.calls} · tris ${info.triangles}`,
    )
    this.statFrames = 0
    this.statElapsed = 0
  }

  private updateTweens(dt: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i -= 1) {
      const tween = this.tweens[i]
      if (!tween) continue
      if (tween.delay > 0) {
        tween.delay -= dt
        continue
      }
      tween.elapsed += dt
      const raw = clamp01(tween.elapsed / tween.duration)
      tween.onUpdate(raw >= 1 ? 1 : raw)
      if (raw >= 1) {
        this.tweens.splice(i, 1)
        tween.onComplete?.()
      }
    }
  }

  private tween(spec: Omit<Tween, 'elapsed' | 'delay' | 'onComplete'> & {
    readonly delay?: number
    readonly onComplete?: (() => void) | null
  }): void {
    this.tweens.push({
      elapsed: 0,
      duration: Math.max(0.001, spec.duration),
      delay: spec.delay ?? 0,
      onUpdate: spec.onUpdate,
      onComplete: spec.onComplete ?? null,
    })
  }

  private shake(strength: number, duration: number): void {
    if (this.reducedMotion) return
    this.shakeStrength = Math.max(this.shakeStrength, strength)
    this.shakeDuration = Math.max(this.shakeDuration, duration)
    this.shakeTime = Math.max(this.shakeTime, duration)
  }

  private isCloseupShot(): boolean {
    return this.shot === 'bloodPlayer' || this.shot === 'bloodBoss' || this.shot === 'bossHead'
  }

  private updateCamera(dt: number): void {
    if (this.cameraBlend < 1) {
      // 血袋运镜与真实计时同步，低帧率时也能在回位前完成切入。
      const progress = this.cameraBlendRealtime
        ? (performance.now() - this.cameraBlendStartedAt) / 1000 / this.cameraBlendDuration
        : this.cameraBlend + dt / this.cameraBlendDuration
      this.cameraBlend = Math.min(1, progress)
      const eased = easeInOutCubic(this.cameraBlend)
      this.cameraBase.lerpVectors(this.cameraFrom, this.cameraTo, eased)
      this.cameraLookAt.lerpVectors(this.lookFrom, this.lookTo, eased)
      const fov = this.fovFrom + (this.fovTo - this.fovFrom) * eased
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
    }

    const closeup = this.isCloseupShot()
    const breathe = this.reducedMotion ? 0 : Math.sin(this.elapsed * 0.62) * 0.012
    let sx = 0
    let sy = 0
    let sz = 0
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt)
      const decay = this.shakeTime / Math.max(0.001, this.shakeDuration)
      const amp = this.shakeStrength * decay * decay
      if (!closeup) {
        sx = (Math.random() - 0.5) * amp * 2
        sy = (Math.random() - 0.5) * amp * 2
        sz = (Math.random() - 0.5) * amp
      }
      if (this.shakeTime === 0) this.shakeStrength = 0
    }
    const drift = this.reducedMotion || closeup
      ? 0
      : (this.shot === 'table' ? 1 : 0.22) + this.narrativeSway
    this.camera.position.set(
      this.cameraBase.x + Math.sin(this.elapsed * 0.21) * 0.035 * drift + sx,
      this.cameraBase.y + breathe * drift + sy,
      this.cameraBase.z + Math.cos(this.elapsed * 0.17) * 0.02 * drift + sz,
    )
    // 沿视线前推：lookAt 不动，构图中心保持，只有景别在收紧
    if (this.executionPush > 0.001) {
      const direction = this.scratchVector.copy(this.cameraLookAt).sub(this.camera.position)
      const length = direction.length()
      if (length > 0.001) {
        this.camera.position.addScaledVector(
          direction.multiplyScalar(1 / length),
          this.executionPush * EXECUTION_PUSH_DISTANCE,
        )
      }
    }
    this.spaceLook()
  }

  /** 新一局/首层开局：枪平躺回桌面，等第一次处决再抬起 */
  restGunOnTable(): void {
    if (this.disposed) return
    this.holsterGun()
  }

  /** 重新发牌前的演出闸门：枪已放平、镜头回到桌面且不再运镜、血液特写结束 */
  whenReadyForDeal(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const startedAt = performance.now()
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.disposed) {
          resolve()
          return
        }
        const settled =
          this.gunHolstered &&
          !this.gunMotionActive &&
          this.shot === 'table' &&
          this.cameraBlend >= 1 &&
          !this.isBloodCloseupActive() &&
          (!this.bossPlanted || this.bossPose.state() === 'idle')
        // 兜底 8 秒：任何异常都不能把发牌锁死
        if (settled || performance.now() - startedAt > 8000) {
          resolve()
          return
        }
        window.setTimeout(check, 90)
      }
      check()
    })
  }

  private holsterGun(): void {
    this.gunHolstered = true
    this.gunMotionActive = false
    this.gunRaiseGeneration += 1
    this.gunAim.position.copy(GUN_PIVOT)
    this.gunAim.rotation.set(0, this.gunRestYaw, GUN_REST_ROLL)
    this.settleGunOnTable()
  }

  /** 侧翻后按包围盒最低点贴住桌面，换模型/换姿态都能复用 */
  private settleGunOnTable(): void {
    const holder =
      this.gunShake.getObjectByName('ShotgunGLB') ?? this.gunShake.getObjectByName('GunPlaceholder')
    if (!holder) return
    this.gunAim.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(holder)
    if (!Number.isFinite(box.min.y)) return
    this.gunAim.position.y += TABLE_TOP - box.min.y
    this.gunHolsterY = this.gunAim.position.y
  }

  /** 处决开始：抬升、翻正、瞄准同步完成，整段是一条连贯的「端起」弧线 */
  private raiseGun(): void {
    if (!this.gunHolstered) return
    this.gunHolstered = false
    this.gunMotionActive = true
    const generation = ++this.gunRaiseGeneration
    const fromY = this.gunAim.position.y
    const fromRoll = this.gunAim.rotation.z
    this.tween({
      duration: this.reducedMotion ? 0.24 : GUN_RAISE_DURATION,
      onUpdate: (t) => {
        if (generation !== this.gunRaiseGeneration) return
        // 基础位移叠一段拱形抬升，翻正发生在枪身抬到高处时，不再「先抬后翻」
        this.gunAim.position.y = fromY + (GUN_PIVOT.y - fromY) * easeOutCubic(t) + GUN_LIFT_CLEARANCE * Math.sin(Math.PI * t)
        this.gunAim.rotation.z = fromRoll * (1 - easeInOutCubic(clamp01((t - 0.08) / 0.8)))
      },
      onComplete: () => {
        if (generation !== this.gunRaiseGeneration) return
        this.gunAim.position.copy(GUN_PIVOT)
        this.gunAim.rotation.z = 0
        this.gunMotionActive = false
      },
    })
  }

  /**
   * 每次开枪后：镜头回到桌面机位（或结算机位）且运镜完成，才触发落枪归位。
   * 血液特写期间机位仍是特写，必须等它结束。
   */
  private lowerGunWhenCameraSettles(): void {
    const generation = this.gunRaiseGeneration
    const check = (): void => {
      if (this.disposed || generation !== this.gunRaiseGeneration) return
      if (this.gunHolstered) return
      const settledShot = this.shot === 'table' || this.shot === 'death' || this.shot === 'victory'
      if (settledShot && this.cameraBlend >= 1 && !this.isBloodCloseupActive()) {
        this.lowerGun(0.12)
        return
      }
      window.setTimeout(check, 70)
    }
    check()
  }

  /** 每次开枪后：翻回侧躺与下落同步完成，最后落回桌面 */
  private lowerGun(delay: number): void {
    if (this.gunHolstered) return
    this.gunHolstered = true
    this.gunMotionActive = true
    const generation = ++this.gunRaiseGeneration
    const fromY = this.gunAim.position.y
    const fromRoll = this.gunAim.rotation.z
    const fromYaw = this.gunAim.rotation.y
    const fromPitch = this.gunAim.rotation.x
    const yawDelta = Math.atan2(Math.sin(this.gunRestYaw - fromYaw), Math.cos(this.gunRestYaw - fromYaw))
    const targetY = this.gunHolsterY
    this.tween({
      delay,
      duration: this.reducedMotion ? 0.24 : GUN_LOWER_DURATION,
      onUpdate: (t) => {
        if (generation !== this.gunRaiseGeneration) return
        const eased = easeInOutCubic(t)
        this.gunAim.position.y = fromY + (targetY - fromY) * eased + GUN_LIFT_CLEARANCE * Math.sin(Math.PI * t)
        this.gunAim.rotation.z = fromRoll + (GUN_REST_ROLL - fromRoll) * easeInOutCubic(clamp01((t - 0.08) / 0.8))
        this.gunAim.rotation.y = fromYaw + yawDelta * eased
        this.gunAim.rotation.x = fromPitch * (1 - eased)
      },
      onComplete: () => {
        if (generation !== this.gunRaiseGeneration) return
        this.gunAim.position.y = targetY
        this.gunAim.rotation.set(0, this.gunRestYaw, GUN_REST_ROLL)
        this.gunMotionActive = false
      },
    })
  }

  /** 抬升/侧翻过程中把枪身最低点压在桌面之上，避免扫穿桌板 */
  private keepGunAboveTable(): void {
    const holder = this.gunShake.getObjectByName('ShotgunGLB') ?? this.gunShake.getObjectByName('GunPlaceholder')
    if (!holder) return
    this.gunAim.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(holder, true)
    if (!Number.isFinite(box.min.y)) return
    const deficit = TABLE_TOP - box.min.y
    if (deficit > 0) this.gunAim.position.y += deficit
  }

  private updateGunAim(dt: number): void {
    if (this.shot === 'execute') {
      this.gunAim.getWorldPosition(this.aimScratch)
      if (this.aimTarget === 'player') {
        // 枪口回指镜头下方一点，画面上看起来才是顶着自己的下颚
        this.aimScratchTarget.copy(this.camera.position)
        this.aimScratchTarget.y -= 0.24
      } else {
        this.bossHitPoint(this.aimScratchTarget)
      }
      this.aimScratchTarget.sub(this.aimScratch)
      const horizontal = Math.hypot(this.aimScratchTarget.x, this.aimScratchTarget.z)
      const yaw = Math.atan2(-this.aimScratchTarget.x, -this.aimScratchTarget.z)
      const pitch = Math.atan2(this.aimScratchTarget.y, Math.max(0.0001, horizontal))
      // 枪还侧躺着的时候不甩向目标，翻正过程中再逐渐咬合，避免「平躺着先转向」
      const upright = clamp01(1 - Math.abs(this.gunAim.rotation.z) / Math.abs(GUN_REST_ROLL))
      this.turnGun(yaw, pitch, dt, upright * upright)
      if (this.gunShakeAfterAim) {
        const yawError = Math.abs(Math.atan2(Math.sin(yaw - this.gunAim.rotation.y), Math.cos(yaw - this.gunAim.rotation.y)))
        const pitchError = Math.abs(Math.atan2(Math.sin(pitch - this.gunAim.rotation.x), Math.cos(pitch - this.gunAim.rotation.x)))
        if (yawError < GUN_AIMED_EPSILON && pitchError < GUN_AIMED_EPSILON) {
          this.gunShakeAfterAim = false
          this.startGunShake()
        }
      }
    } else {
      // 归位动画自己会转回待机朝向，动画期间不再叠加一次转动
      if (!this.gunMotionActive) this.turnGun(this.gunRestYaw, 0, dt)
    }
    if (this.revealGlowLife > 0) {
      this.revealGlowLife = Math.max(0, this.revealGlowLife - dt)
      if (this.revealGlow) {
        const pulse = 0.78 + Math.sin(this.elapsed * 6.5) * 0.22
        const fade = Math.min(1, this.revealGlowLife)
        this.revealGlow.material.opacity = 0.46 * pulse * fade
        this.revealGlow.scale.setScalar(1.24 * (0.94 + pulse * 0.08))
        if (this.revealLight) this.revealLight.intensity = 2.2 * pulse * fade
      }
      // 特写只是一次性演出：读数结束把镜头交还桌面，否则整回合都锁在拉近视野里
      if (this.revealGlowLife === 0 && this.shot === 'magnify') this.resetShot(0.9)
    } else if (this.revealLight) {
      this.revealLight.intensity = 0
    }
  }

  /** 短弧插值：yaw 绕过 ±π 时不会倒着甩一整圈；strength 用于和抬枪/归位动画同步 */
  private turnGun(yaw: number, pitch: number, dt: number, strength = 1): void {
    const k = Math.min(1, dt * 5.5) * strength
    const yawDelta = Math.atan2(Math.sin(yaw - this.gunAim.rotation.y), Math.cos(yaw - this.gunAim.rotation.y))
    const pitchDelta = Math.atan2(Math.sin(pitch - this.gunAim.rotation.x), Math.cos(pitch - this.gunAim.rotation.x))
    this.gunAim.rotation.y += yawDelta * k
    this.gunAim.rotation.x += pitchDelta * k
  }

  private startGunShake(): void {
    if (this.reducedMotion) return
    this.gunShake.position.copy(this.gunShakeBase)
    this.gunShakeAccum = 0
    this.gunShakeLastPhase = -1
    this.gunShakeActive = true
  }

  private stopGunShake(): void {
    this.gunShakeActive = false
    this.gunShake.position.copy(this.gunShakeBase)
  }

  private updateGunShake(dt: number): void {
    if (!this.gunShakeActive) return
    this.gunShakeAccum += dt
    const period = GUN_SHAKE.delay * 2
    const phase = this.gunShakeAccum % period
    if (phase < GUN_SHAKE.delay) {
      if (this.gunShakeLastPhase < 0 || phase < this.gunShakeLastPhase) {
        const offset = GUN_SHAKE.offsetMin + Math.random() * (GUN_SHAKE.offsetMax - GUN_SHAKE.offsetMin)
        this.gunShake.getWorldQuaternion(this.gunShakeQuaternion).invert()
        this.gunShakeRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).applyQuaternion(this.gunShakeQuaternion)
        this.gunShakeUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).applyQuaternion(this.gunShakeQuaternion)
        this.gunShake.position.copy(this.gunShakeBase)
          .addScaledVector(this.gunShakeRight, offset)
          .addScaledVector(this.gunShakeUp, offset)
      }
    } else {
      this.gunShake.position.copy(this.gunShakeBase)
    }
    this.gunShakeLastPhase = phase
  }

  private spaceLook(): void {
    if (this.isCloseupShot()) {
      this.camera.lookAt(this.cameraLookAt)
      return
    }
    const look = this.scratchVector
    look.copy(this.cameraLookAt)
    const sway = this.reducedMotion ? 0 : this.narrativeSway
    look.x += Math.sin(this.elapsed * 0.27) * (0.02 + sway * 0.08)
    look.y += Math.sin(this.elapsed * 0.33) * (0.012 + sway * 0.055)
    this.camera.lookAt(look)
    if (sway > 0.001) this.camera.rotateZ(Math.sin(this.elapsed * 0.74) * 0.012 * sway)
  }

  private updateLighting(): void {
    // 老式钨丝灯的轻微抖动：两个不同频率的正弦叠加，模拟灯丝/电压不稳
    const flicker = Math.sin(this.elapsed * 7.1) * 0.028 + Math.sin(this.elapsed * 17.3) * 0.018
    const fade = 0.94 + flicker * this.gradeFlicker
    this.spot.intensity = 70 * fade * this.gradeLamp
    if (this.lampBulbMat) this.lampBulbMat.emissiveIntensity = 5 * fade * this.gradeLamp
    if (this.lampConeMat) this.lampConeMat.opacity = 0.016 * this.gradeLamp
    // 只做极小幅摆动，避免光斑在桌面上乱甩
    this.spot.position.x = Math.sin(this.elapsed * 0.42) * 0.035
    this.spot.position.z = -0.05 + Math.cos(this.elapsed * 0.33) * 0.025
    this.lampRig.rotation.z = Math.sin(this.elapsed * 0.9) * 0.035
    this.lampRig.rotation.x = Math.cos(this.elapsed * 0.72) * 0.025
  }

  /** 姿态状态只在切换的帧派发一次 cue；音效方不需要每帧采样 */
  private emitBossPoseCue(): void {
    const state = this.bossPose.state()
    if (state === this.lastBossPoseState) return
    const previous = this.lastBossPoseState
    if (this.bossLimbGroups.size > 0) this.capturePlantFrom()
    if (previous === 'prone' && (state === 'brace' || state === 'push' || state === 'rise')) {
      this.bossPlanted = true
      this.bossPlantStartedAt = this.elapsed
    }
    this.lastBossPoseState = state
    this.bossPoseStateStartedAt = this.elapsed
    const cue = BOSS_POSE_CUES[state]
    if (cue) this.callbacks.onBossPoseCue?.(cue)
  }

  private updateBoss(dt: number): void {
    const t = this.elapsed
    // 呼吸：三个不成整数比的正弦叠加，周期压在 4~6 秒，避免机械重复感
    const breath = Math.sin(t * 1.32) * 0.018 + Math.sin(t * 0.61 + 1.7) * 0.010

    if (!this.bossPosePaused && !this.bossPoseHold) this.bossPose.update(dt)
    this.emitBossPoseCue()
    const pose = this.bossPose.sample()
    const poseState = this.bossPose.state()
    const profile = BOSS_POSE_PROFILES[BOSS_VISUAL_LEVEL] ?? BOSS_POSE_PROFILES[0]
    const stageThreeHanging = this.currentLevelIndex === 2 &&
      ((this.lastSnapshot?.boss.hp ?? 0) > 0 || this.lastSnapshot?.phase === 'reloading')
    const suspensionTarget = stageThreeHanging ? BOSS3_INVERSION_LIFT : 0
    this.suspensionLift += (suspensionTarget - this.suspensionLift) * Math.min(1, dt * 3.5)
    this.suspensionWeight = clamp01((this.suspensionLift - 0.2) / (BOSS3_INVERSION_LIFT - 0.2))
    const hangingSway = stageThreeHanging && poseState === 'idle' && !this.reducedMotion
      ? this.suspensionWeight
      : 0
    let bodyPitch = -breath * 0.55 + pose.pitch + Math.sin(t * 0.71) * 0.018 * hangingSway
    if (this.activeBossMaskLevel === 1) {
      const state = this.bossPose.state()
      const target = state === 'prone' || state === 'deadProne' ? 1 : 0
      this.proneFlatten += (target - this.proneFlatten) * Math.min(1, dt * 3)
      bodyPitch += this.proneFlatten * 0.95
    }
    const hangingPitch = Math.PI * this.suspensionWeight
    bodyPitch += hangingPitch
    const bodyYaw = pose.yaw + Math.PI * this.suspensionWeight + Math.sin(t * 0.53) * 0.035 * hangingSway
    const bodyRoll = pose.roll + Math.sin(t * 0.67 + 0.8) * 0.035 * hangingSway

    // 绕虚拟枢轴旋转：先把枢轴点转到新姿态，再反推平移量，避免整尊半身像绕脚底甩动
    this.bossPoseEuler.set(bodyPitch, bodyYaw, bodyRoll)
    this.bossPosePivot.set(0, profile.pivotY, 0)
    this.bossPosePivotRotated.copy(this.bossPosePivot).applyEuler(this.bossPoseEuler)
    this.bossPoseOffset.copy(this.bossPosePivot).sub(this.bossPosePivotRotated)
    this.bossGroup.rotation.set(bodyPitch, bodyYaw, bodyRoll)
    this.bossGroup.position.set(
      Math.sin(t * 0.59) * 0.045 * hangingSway,
      breath + pose.y + this.bossPoseOffset.y + this.suspensionLift - (this.activeBossMaskLevel === 1 ? this.proneFlatten * 0.25 : 0),
      BOSS_Z + pose.z + this.bossPoseOffset.z + Math.sin(t * 0.47 + 1.2) * 0.02 * hangingSway,
    )

    if (this.bossFlashLife > 0) {
      this.bossFlashLife = Math.max(0, this.bossFlashLife - dt)
      const k = this.bossFlashLife / BOSS_FLASH_LIFE
      for (const entry of this.bossFlashMaterials) {
        entry.material.emissive.copy(entry.emissive).lerp(BOSS_FLASH_COLOR, k * k * BOSS_FLASH_PEAK)
      }
      if (this.bossFlashLife === 0) this.restoreBossFlash()
    }

    // 盯视：大部分时间缓慢扫视，偶尔停顿后猛转向玩家
    const sweep = Math.sin(t * 0.37) * 0.55 + Math.sin(t * 0.19 + 2.3) * 0.45
    const glance = Math.max(0, Math.sin(t * 0.165 - 0.6)) ** 6
    let yaw = sweep * (1 - glance) * 0.20 + Math.sin(t * 0.83) * 0.012
    let pitch = Math.cos(t * 0.29) * 0.045 - glance * 0.05
    if (this.headSnapLife > 0) {
      this.headSnapLife = Math.max(0, this.headSnapLife - dt)
      const p = 1 - this.headSnapLife / HEAD_SNAP_LIFE
      const env = p < 0.12 ? p / 0.12 : 1 - (p - 0.12) / 0.88
      yaw *= 1 - env
      pitch = pitch * (1 - env) - 0.03 * env
    }

    if (stageThreeHanging && poseState === 'idle') {
      yaw = 0
      pitch = -0.025
    }
    const headYaw = pose.headYaw + (yaw - Math.PI * this.suspensionWeight) * pose.lookWeight
    const headPitch = pitch * pose.lookWeight + pose.headPitch - Math.PI * this.suspensionWeight * pose.lookWeight
    // 换层 reloading 快照里 Boss 血量可能仍是 0，不能因此漏掉第二层歪头。
    const stageTwoAffliction = this.currentLevelIndex === 1 &&
      ((this.lastSnapshot?.boss.hp ?? 0) > 0 || this.lastSnapshot?.phase === 'reloading')
    const canTwitch = stageTwoAffliction && !this.reducedMotion && poseState === 'idle' && !this.isBloodCloseupActive()
    if (!stageTwoAffliction) {
      this.boss2HeadTwitchLife = 0
      if (this.boss2HeadTwitchCooldown <= 0) {
        this.boss2HeadTwitchCooldown = BOSS2_HEAD_TWITCH_MIN_DELAY + Math.random() * (BOSS2_HEAD_TWITCH_MAX_DELAY - BOSS2_HEAD_TWITCH_MIN_DELAY)
      }
    } else if (!canTwitch) {
      this.boss2HeadTwitchLife = 0
    } else if (this.boss2HeadTwitchLife > 0) {
      this.boss2HeadTwitchLife = Math.max(0, this.boss2HeadTwitchLife - dt)
    } else {
      this.boss2HeadTwitchCooldown = Math.max(0, this.boss2HeadTwitchCooldown - dt)
      if (this.boss2HeadTwitchCooldown <= 0) {
        this.boss2HeadTwitchLife = BOSS2_HEAD_TWITCH_LIFE
        this.boss2HeadTwitchCooldown = BOSS2_HEAD_TWITCH_MIN_DELAY + Math.random() * (BOSS2_HEAD_TWITCH_MAX_DELAY - BOSS2_HEAD_TWITCH_MIN_DELAY)
      }
    }

    let headTwitch = 0
    if (this.boss2HeadTwitchLife > 0) {
      const progress = 1 - this.boss2HeadTwitchLife / BOSS2_HEAD_TWITCH_LIFE
      if (progress < BOSS2_HEAD_TWITCH_KEYS.at(-1)![0]) {
        for (let i = 1; i < BOSS2_HEAD_TWITCH_KEYS.length; i += 1) {
          const [endAt, endRoll] = BOSS2_HEAD_TWITCH_KEYS[i]
          if (progress > endAt) continue
          const [startAt, startRoll] = BOSS2_HEAD_TWITCH_KEYS[i - 1]
          const local = (progress - startAt) / (endAt - startAt)
          const eased = local * local * (3 - 2 * local)
          headTwitch = (startRoll + (endRoll - startRoll) * eased) * Math.PI / 180
          break
        }
      } else {
        const settle = (progress - 0.34) / 0.66
        headTwitch = Math.sin(settle * Math.PI * 3) * 3 * (1 - settle) * Math.PI / 180
      }
    }
    const headRoll = pose.headRoll + (stageTwoAffliction ? BOSS2_HEAD_TILT + headTwitch : 0)
    if (this.bossHeadBone) {
      this.bossHeadBone.position.copy(this.bossHeadRestPosition)
      this.bossHeadBone.position.z += BOSS3_HEAD_CLEARANCE * this.suspensionWeight
      // 父链（Hips→Spine→Chest→Neck）静止无旋转，父空间偏移与旧枢轴等价
      this.bossBoneOffset.set(headPitch, headYaw, headRoll)
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossHeadBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossHeadRest)
    } else {
      // 程序化 Boss 兜底：沿用旧的可动头部
      this.bossParts.head.rotation.set(headPitch, headYaw, headRoll)
      const maskBob = Math.sin(t * 1.6) * 0.004
      this.bossParts.mask.position.y = (this.bossParts.mask.userData.baseY as number) + maskBob
      this.bossParts.maskBack.position.y = (this.bossParts.maskBack.userData.baseY as number) + maskBob
    }

    // 上臂骨骼静止约绕 X 转 180°，偏移在父空间左乘才能复现旧枢轴的世界轴摆动
    const state = poseState
    const knockbackArms =
      state === 'launch' || state === 'down' || state === 'plant' ||
      state === 'brace' || state === 'push' || state === 'rise' ||
      state === 'struggle' || state === 'still' || state === 'headTurn'
    const upperPitch = knockbackArms ? 0.9 : 0.3
    const upperSpread = knockbackArms ? 0.42 : 0.28
    if (this.bossArmLBone) {
      this.bossBoneOffset.set(-pose.armL * upperPitch, 0, -pose.armL * upperSpread)
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossArmLBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossArmLRest)
    }
    if (this.bossArmRBone) {
      this.bossBoneOffset.set(-pose.armR * upperPitch, 0, pose.armR * upperSpread)
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossArmRBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossArmRRest)
    }
    if (this.bossForearmLBone) {
      this.bossBoneOffset.set(-pose.forearmL * 1.05, 0, -pose.forearmL * 0.12)
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossForearmLBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossForearmLRest)
    }
    if (this.bossForearmRBone) {
      this.bossBoneOffset.set(-pose.forearmR * 1.05, 0, pose.forearmR * 0.12)
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossForearmRBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossForearmRRest)
    }
    if (this.bossThighLBone) {
      this.bossBoneOffset.set(
        -pose.legL * 0.5 * this.suspensionWeight,
        0,
        -pose.legL * 0.24 * this.suspensionWeight,
      )
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossThighLBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossThighLRest)
    }
    if (this.bossThighRBone) {
      this.bossBoneOffset.set(
        -pose.legR * 0.5 * this.suspensionWeight,
        0,
        pose.legR * 0.24 * this.suspensionWeight,
      )
      this.bossBoneQuat.setFromEuler(this.bossBoneOffset)
      this.bossThighRBone.quaternion.copy(this.bossBoneQuat).multiply(this.bossThighRRest)
    }
    if (
      this.activeBossMaskLevel === 0 &&
      this.currentLevelIndex === 0 &&
      this.bossUpperArmLength > 0 &&
      this.bossForearmLLength > 0 &&
      this.bossForearmRLength > 0
    ) {
      let leftContact = 0
      let rightContact = 0
      if (state === 'plant') {
        leftContact = easeOutCubic(clamp01(this.bossPose.stateProgress() / 0.32))
      } else if (state === 'brace') {
        leftContact = 1
        rightContact = clamp01((pose.armR - 0.2) / 1.15)
      } else if (state === 'push') {
        leftContact = 1
        rightContact = 1
      } else if (state === 'rise') {
        leftContact = clamp01((pose.pitch + 0.03) / 0.3)
        rightContact = leftContact
      }
      this.bossGroup.updateMatrixWorld(true)
      if (leftContact > 0 && this.bossArmLBone && this.bossForearmLBone) {
        this.solveBossArmContact(
          this.bossArmLBone,
          this.bossForearmLBone,
          this.bossArmLRest,
          this.bossForearmLRest,
          this.bossArmLDirection,
          this.bossHandLOffset,
          this.bossForearmLLength,
          this.bossHandContactL,
          leftContact,
          -1,
        )
      }
      if (rightContact > 0 && this.bossArmRBone && this.bossForearmRBone) {
        this.solveBossArmContact(
          this.bossArmRBone,
          this.bossForearmRBone,
          this.bossArmRRest,
          this.bossForearmRRest,
          this.bossArmRDirection,
          this.bossHandROffset,
          this.bossForearmRLength,
          this.bossHandContactR,
          rightContact,
          1,
        )
      }
    }
    this.bossGroup.updateMatrixWorld(true)
    this.updateSuspensionRig()
    this.updateBossLimbs()
  }

  private solveBossArmContact(
    upper: THREE.Bone,
    forearm: THREE.Bone,
    upperRest: THREE.Quaternion,
    forearmRest: THREE.Quaternion,
    upperRestDirection: THREE.Vector3,
    handOffset: THREE.Vector3,
    forearmLength: number,
    target: THREE.Vector3,
    weight: number,
    poleSide: number,
  ): void {
    this.bossIkUpperFk.copy(upper.quaternion)
    this.bossIkForearmFk.copy(forearm.quaternion)
    this.solveBossArmGeometry(
      upper,
      forearm,
      upperRest,
      forearmRest,
      upperRestDirection,
      handOffset,
      forearmLength,
      target,
      poleSide,
    )
    this.bossIkUpperSolved.copy(upper.quaternion)
    this.bossIkForearmSolved.copy(forearm.quaternion)
    upper.quaternion.copy(this.bossIkUpperFk).slerp(this.bossIkUpperSolved, weight)
    forearm.quaternion.copy(this.bossIkForearmFk).slerp(this.bossIkForearmSolved, weight)
    upper.updateWorldMatrix(true, true)
  }

  private solveBossArmGeometry(
    upper: THREE.Bone,
    forearm: THREE.Bone,
    upperRest: THREE.Quaternion,
    forearmRest: THREE.Quaternion,
    upperRestDirection: THREE.Vector3,
    handOffset: THREE.Vector3,
    forearmLength: number,
    target: THREE.Vector3,
    poleSide: number,
  ): void {
    upper.updateWorldMatrix(true, true)
    upper.getWorldPosition(this.bossIkShoulder)
    this.bossIkDirection.copy(target).sub(this.bossIkShoulder)
    const reach = this.bossUpperArmLength + forearmLength
    const minReach = Math.abs(this.bossUpperArmLength - forearmLength) + 0.001
    const distance = Math.max(minReach, Math.min(reach - 0.001, this.bossIkDirection.length()))
    this.bossIkDirection.normalize()
    this.bossIkClampedTarget.copy(this.bossIkShoulder).addScaledVector(this.bossIkDirection, distance)
    const along = (this.bossUpperArmLength ** 2 - forearmLength ** 2 + distance ** 2) / (2 * distance)
    const bend = Math.sqrt(Math.max(0, this.bossUpperArmLength ** 2 - along ** 2))
    this.bossIkPole.set(poleSide * 1.4, -0.65, -0.45)
    this.bossIkBend.copy(this.bossIkPole).addScaledVector(this.bossIkDirection, -this.bossIkPole.dot(this.bossIkDirection)).normalize()
    this.bossIkElbow.copy(this.bossIkShoulder).addScaledVector(this.bossIkDirection, along).addScaledVector(this.bossIkBend, bend)
    this.bossIkUpperDirection.copy(this.bossIkElbow).sub(this.bossIkShoulder).normalize()
    this.bossIkLowerDirection.copy(this.bossIkClampedTarget).sub(this.bossIkElbow).normalize()

    upper.parent!.getWorldQuaternion(this.bossIkParentQuat).invert()
    this.bossIkParentDirection.copy(upperRestDirection).applyQuaternion(upperRest).normalize()
    this.bossIkUpperDirection.applyQuaternion(this.bossIkParentQuat)
    this.bossIkOffsetQuat.setFromUnitVectors(this.bossIkParentDirection, this.bossIkUpperDirection)
    upper.quaternion.copy(this.bossIkOffsetQuat).multiply(upperRest)

    upper.updateWorldMatrix(true, true)
    upper.getWorldQuaternion(this.bossIkParentQuat).invert()
    this.bossIkParentDirection.copy(handOffset).normalize().applyQuaternion(forearmRest).normalize()
    this.bossIkLowerDirection.applyQuaternion(this.bossIkParentQuat)
    this.bossIkOffsetQuat.setFromUnitVectors(this.bossIkParentDirection, this.bossIkLowerDirection)
    forearm.quaternion.copy(this.bossIkOffsetQuat).multiply(forearmRest)
    forearm.updateWorldMatrix(true, true)
  }

  /** 沙漏滤镜强度平滑跟随快照状态；使用瞬间叠一次短闪 */
  private updateHourglass(dt: number): void {
    const rate = this.reducedMotion ? 6 : 2.6
    this.hourglassAmount += (this.hourglassTarget - this.hourglassAmount) * Math.min(1, dt * rate)
    if (this.hourglassPulse > 0) this.hourglassPulse = Math.max(0, this.hourglassPulse - dt * 1.6)
    const amount = Math.min(1, this.hourglassAmount + this.hourglassPulse * 0.55)
    this.hourglassPass.uniforms.amount!.value = amount
  }

   /** 沙漏打出的瞬间：滤镜先压满再回落到「本局持续」强度 */
  playHourglass(): void {
    if (this.disposed) return
    this.hourglassPulse = 1
    this.hourglassTarget = 1
  }

  /** 手铐锁链：按 skipTurn 挂上或拆下，拆下时播放碎裂下落 */
  private syncChains(snapshot: GameSnapshot): void {
    for (const actor of ['player', 'boss'] as const) {
      const view = actor === 'player' ? snapshot.player : snapshot.boss
      const existing = this.chains.get(actor)
      if (!view.skipTurn) {
        if (existing) {
          this.chains.delete(actor)
          this.dropChain(existing)
        }
        continue
      }
      if (existing) continue
      const entry = this.buildChain(actor)
      this.chains.set(actor, entry)
      const start = entry.group.scale.x
      entry.group.scale.setScalar(0.001)
      this.tween({
        duration: 0.4,
        onUpdate: (t) => {
          entry.group.scale.setScalar(start * easeOutCubic(t))
        },
      })
    }
  }

  /** 两条交叉铁链箍住手部高度；Boss 侧放大并抬到半身像腰部 */
  private buildChain(actor: ActorId): ChainEntry {
    const group = new THREE.Group()
    const materials: THREE.MeshStandardMaterial[] = []
    const iron = new THREE.MeshStandardMaterial({
      color: 0x6d747a,
      metalness: 0.88,
      roughness: 0.42,
      emissive: 0x0d1418,
      emissiveIntensity: 0.5,
    })
    this.disposableMaterials.add(iron)
    materials.push(iron)

    const links = 9
    for (let i = 0; i < links; i += 1) {
      const geo = new THREE.TorusGeometry(0.028, 0.0085, 6, 14)
      this.disposableGeometries.add(geo)
      const link = new THREE.Mesh(geo, iron)
      // 相邻环交替 90°，看起来才是扣合的链节
      link.rotation.x = Math.PI / 2
      link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2
      link.position.x = (i - (links - 1) / 2) * 0.052
      link.castShadow = true
      group.add(link)
    }

    if (actor === 'player') {
      group.position.set(0, TABLE_TOP + 0.11, 0.55)
      group.rotation.z = -0.06
      group.scale.setScalar(1)
    } else {
      // Boss 手在桌后不可见，链子改箍住半身像下段，读作「被缚住」
      const bustHeight = BOSS_BUST_HEIGHTS[BOSS_VISUAL_LEVEL] ?? BOSS_BUST_HEIGHTS[0]
      if (this.currentLevelIndex === 2) {
        group.position.set(0, BOSS_BUST_BASE_Y + bustHeight * 0.96, BOSS_Z + 0.3)
        group.rotation.z = Math.PI + 0.05
      } else {
        group.position.set(0, BOSS_BUST_BASE_Y + bustHeight * 0.42, BOSS_Z + 0.55)
        group.rotation.z = 0.05
      }
      group.scale.setScalar(2.4)
    }
    this.scene.add(group)

    const entry: ChainEntry = { group, materials }
    const sway = this.reducedMotion ? 0 : 1
    this.tween({
      duration: 0.5,
      onUpdate: (t) => {
        group.rotation.y = Math.sin(t * Math.PI) * 0.22 * sway
      },
    })
    return entry
  }

  private dropChain(entry: ChainEntry): void {
    const fromY = entry.group.position.y
    this.tween({
      duration: 0.55,
      onUpdate: (t) => {
        entry.group.position.y = fromY - easeOutCubic(t) * 0.5
        entry.group.rotation.x = t * 0.9
        entry.group.scale.setScalar(Math.max(0.001, entry.group.scale.x * (1 - t * 0.04)))
      },
      onComplete: () => {
        entry.group.removeFromParent()
        this.disposeObject(entry.group)
      },
    })
  }

  private updateChains(dt: number): void {
    void dt
    for (const entry of this.chains.values()) {
      const flicker = 0.45 + Math.sin(this.elapsed * 3.1) * 0.12
      for (const material of entry.materials) material.emissiveIntensity = flicker
    }
  }

  private updateDust(dt: number): void {
    const geometry = this.dust.geometry
    const attribute = geometry.getAttribute('position')
    if (!(attribute instanceof THREE.BufferAttribute)) return
    const array = attribute.array as Float32Array
    const drift = this.dust.userData.drift as Float32Array | undefined
    if (!drift) return
    for (let i = 0; i < attribute.count; i += 1) {
      const base = i * 3
      const vx = drift[base] ?? 0
      const vy = drift[base + 1] ?? 0
      const vz = drift[base + 2] ?? 0
      array[base] = (array[base] ?? 0) + vx * dt
      array[base + 1] = (array[base + 1] ?? 0) + vy * dt
      array[base + 2] = (array[base + 2] ?? 0) + vz * dt
      if ((array[base + 1] ?? 0) < 0.6) {
        array[base + 1] = 4.6
        array[base] = (Math.random() - 0.5) * 7
        array[base + 2] = -3.5 + Math.random() * 3.3
      }
    }
    attribute.needsUpdate = true
    this.dust.material.opacity = 0.3 + Math.sin(this.elapsed * 0.8) * 0.07
  }

  private updateItems(dt: number): void {
    for (const entry of this.items.values()) this.updateItemEntry(entry, dt)
    for (const entry of this.supplyItems.values()) this.updateItemEntry(entry, dt)
    for (const entry of this.bossSupplyItems.values()) this.updateItemEntry(entry, dt)
  }

  private updateItemEntry(entry: ItemEntry, dt: number): void {
    const target = entry.hovered ? 1.18 : 1
    entry.hoverScale += (target - entry.hoverScale) * Math.min(1, dt * 12)
    entry.group.scale.setScalar(ITEM_SCALE * entry.hoverScale * entry.spawnScale)
    const hoverLift = entry.hovered ? 0.04 : 0
    entry.group.position.y = entry.baseY + hoverLift
    for (const material of entry.materials) {
      const base = Number(material.userData.baseColor ?? 0xffffff)
      const baseGlow = Number(material.userData.baseGlow ?? 0)
      material.color.setHex(base)
      material.emissive.setHex(base)
      material.emissiveIntensity = baseGlow
    }
  }

  private updateCards(dt: number): void {
    for (const entry of this.cards.values()) {
      const targetScale = entry.mesh.userData.targetScale as number | undefined
      if (typeof targetScale === 'number') {
        const current = entry.mesh.scale.x
        const next = current + (targetScale - current) * Math.min(1, dt * 10)
        entry.mesh.scale.setScalar(next)
      }
    }
    const deckTop = this.deckGroup.children[this.deckGroup.children.length - 1]
    if (deckTop) {
      deckTop.rotation.y = Math.sin(this.elapsed * 0.6) * 0.02
    }
  }

  private buildRoom(): void {
    const wallGeo = new THREE.BoxGeometry(24, 9, 24)
    this.disposableGeometries.add(wallGeo)
    const wallMat = makeStandardMaterial(0x161211, 0.45, 0.92)
    wallMat.side = THREE.BackSide
    this.disposableMaterials.add(wallMat)
    const walls = new THREE.Mesh(wallGeo, wallMat)
    walls.position.set(0, 4, -2)
    walls.receiveShadow = true
    this.roomGroup.add(walls)

    const floorGeo = new THREE.BoxGeometry(24, 0.3, 24)
    this.disposableGeometries.add(floorGeo)
    const floorMat = makeStandardMaterial(0x0f0c0b, 0.6, 0.86)
    this.disposableMaterials.add(floorMat)
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.position.set(0, -0.15, -2)
    floor.receiveShadow = true
    this.roomGroup.add(floor)

    const beamMat = makeStandardMaterial(0x1c1512, 0.55, 0.8)
    this.disposableMaterials.add(beamMat)
    for (let i = 0; i < 3; i += 1) {
      const beamGeo = new THREE.BoxGeometry(20, 0.28, 0.32)
      this.disposableGeometries.add(beamGeo)
      const beam = new THREE.Mesh(beamGeo, beamMat)
      beam.position.set(0, 5.6, -6 + i * 4)
      beam.castShadow = true
      this.roomGroup.add(beam)
    }

    const pipeMat = makeStandardMaterial(0x2a241f, 0.85, 0.55)
    this.disposableMaterials.add(pipeMat)
    const pipeGeo = new THREE.CylinderGeometry(0.11, 0.11, 8.6, 12)
    this.disposableGeometries.add(pipeGeo)
    const pipePositions: ReadonlyArray<readonly [number, number]> = [
      [-4.6, -3.4], [4.6, -3.4], [-4.6, -0.8], [4.9, -1.8],
    ]
    for (const [x, z] of pipePositions) {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat)
      pipe.position.set(x, 3.4, z)
      pipe.castShadow = true
      this.roomGroup.add(pipe)
    }

    const horizontalGeo = new THREE.CylinderGeometry(0.1, 0.1, 10, 12)
    this.disposableGeometries.add(horizontalGeo)
    const horizontal = new THREE.Mesh(horizontalGeo, pipeMat)
    horizontal.rotation.z = Math.PI / 2
    horizontal.position.set(0, 5.15, -4.6)
    this.roomGroup.add(horizontal)

    const chainMat = makeStandardMaterial(0x322a24, 0.9, 0.42)
    this.disposableMaterials.add(chainMat)
    const linkGeo = new THREE.TorusGeometry(0.055, 0.016, 6, 10)
    this.disposableGeometries.add(linkGeo)
    for (const x of [-2.9, 3.1]) {
      for (let i = 0; i < 9; i += 1) {
        const link = new THREE.Mesh(linkGeo, chainMat)
        link.position.set(x, 4.9 - i * 0.11, -5.1)
        link.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2
        this.roomGroup.add(link)
      }
    }

    const lamp = this.buildLamp()
    this.lampRig.add(lamp)
    this.lampRig.position.set(0, 5.4, -0.2)
    this.lampBaseY = 5.4
  }

  private buildLamp(): THREE.Group {
    const group = new THREE.Group()
    const cableMat = makeStandardMaterial(0x15100e, 0.2, 0.9)
    this.disposableMaterials.add(cableMat)
    const cableGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6)
    this.disposableGeometries.add(cableGeo)
    const cable = new THREE.Mesh(cableGeo, cableMat)
    cable.position.y = 0.5
    group.add(cable)

    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1c,
      metalness: 0.85,
      roughness: 0.42,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(shadeMat)
    const shadeGeo = new THREE.ConeGeometry(0.46, 0.42, 18, 1, true)
    this.disposableGeometries.add(shadeGeo)
    const shade = new THREE.Mesh(shadeGeo, shadeMat)
    shade.rotation.x = Math.PI
    shade.position.y = -0.02
    shade.castShadow = true
    group.add(shade)

    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffb066,
      emissiveIntensity: 5,
      roughness: 0.3,
    })
    this.disposableMaterials.add(bulbMat)
    const bulbGeo = new THREE.SphereGeometry(0.1, 16, 12)
    this.disposableGeometries.add(bulbGeo)
    const bulb = new THREE.Mesh(bulbGeo, bulbMat)
    bulb.position.y = -0.16
    group.add(bulb)
    this.lampBulbMat = bulbMat
    return group
  }

  private buildLighting(): { spot: THREE.SpotLight; rim: THREE.PointLight; fill: THREE.PointLight } {
    // 环境光只留「能分辨轮廓」的最低量：再高就会把暗部抬平，恐怖感消失
    const ambient = new THREE.HemisphereLight(0x2b3a4a, 0x14100c, 0.20)
    this.scene.add(ambient)

    // ===== ① 主聚光灯：吊灯向下，光锥覆盖桌面并延伸到 Boss 上半身 =====
    // 光锥角度必须 >50°：Boss 在灯位下方 55° 方向，锥体太窄它的脸会完全落在光外
    // 第 1 层 applyLevel 因层号未变提前返回，默认灯色必须直接等于 LEVEL_LOOK[0].lamp
    const spot = new THREE.SpotLight(0xffb066, 70, 18, 0.88, 0.78, 1.2)
    spot.position.set(0, LAMP_SHADE_BOT_Y - 0.05, -0.05)
    spot.castShadow = true
    spot.shadow.mapSize.set(2048, 2048)
    spot.shadow.camera.near = 0.5
    spot.shadow.camera.far = 14
    spot.shadow.bias = -0.0005
    spot.shadow.normalBias = 0.018
    spot.shadow.radius = 2.5
    // 落点比桌面略偏后：Boss 的脸正好卡在光锥软边缘，保留半明半暗
    spot.target.position.set(0, TABLE_TOP + 0.1, -0.25)
    this.scene.add(spot, spot.target)

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffc184,
      transparent: true,
      opacity: 0.016,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(coneMat)
    const coneGeo = new THREE.ConeGeometry(1.55, 4.0, 32, 1, true)
    this.disposableGeometries.add(coneGeo)
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.set(0, 2.9, -0.05)
    this.roomGroup.add(cone)
    this.lampConeMat = coneMat

    // ===== ② 冷色轮廓背光：Boss 身后上方，勾出双肩/头角/铁链剪影 =====
    // 强度必须低：高于 ~10 就会把整个躯干照成一块蓝板，失去剪影感
    const rim = new THREE.PointLight(0x6a9be0, 9, 7.0, 1.9)
    rim.position.set(0.3, 3.15, BOSS_Z - 0.95)
    this.scene.add(rim)

    // 轮廓光的第二盏，偏另一侧，避免单点光只勾出一边
    const rimBack = new THREE.PointLight(0x4a7cb8, 8, 6.5, 1.9)
    rimBack.position.set(-1.7, 2.5, BOSS_Z - 1.15)
    this.scene.add(rimBack)

    // ===== ③ 冷色补光：只抬一点暗部细节，让形体不至于糊成剪影 =====
    const fill = new THREE.PointLight(0x33506e, 3.2, 11, 2)
    fill.position.set(-3.6, 2.2, 1.2)
    this.scene.add(fill)

    // 暖色远景分离：让 Boss 和铁皮墙之间有一层空气感
    const rear = new THREE.PointLight(0x7a2416, 10, 8, 2)
    rear.position.set(3.4, 1.3, BOSS_Z - 1.5)
    this.scene.add(rear)

    // Boss 侧下方硬光：恐怖片的标准打法，一半脸亮一半脸沉进黑里。
    // 从前上方平铺会把它照成影棚里的粘土人，立体感和威胁感全没了。
    const faceFill = new THREE.SpotLight(0xffb98a, 30, 8, 0.40, 0.55, 1.6)
    faceFill.position.set(-1.85, 1.15, BOSS_Z + 1.35)
    faceFill.target.position.set(0, 2.05, BOSS_Z)
    this.scene.add(faceFill, faceFill.target)

    // 冷色补光落在玩家血袋架一侧，让半透明袋体有层次
    const torso = new THREE.PointLight(0x8fb0d0, 2.5, 3.6, 2)
    torso.position.set(-0.9, 1.25, 1.0)
    this.scene.add(torso)

    // ===== 密室层次光：只留一盏从后方扫墙，制造纵深剪影 =====
    const wallWash = new THREE.SpotLight(0xc98f65, 20, 16, 1.25, 1, 1.0)
    wallWash.position.set(0, 4.8, -0.9)
    wallWash.target.position.set(0, 2.2, -5.6)
    this.scene.add(wallWash, wallWash.target)

    const sideCold = new THREE.PointLight(0x345f8c, 5, 10, 2)
    sideCold.position.set(-5.4, 2.4, 3.0)
    this.scene.add(sideCold)

    // ===== 深渊雾效：远端管道与铁皮墙渐隐 =====
    // 密度 0.042：Boss 处（5.6m）压掉约 6%，远端墙（11m）压掉约 20%，空间有了纵深
    this.scene.fog = new THREE.FogExp2(0x070a0e, 0.042)
    this.scene.background = new THREE.Color(0x070a0e)

    return { spot, rim, fill }
  }

  private buildTable(): void {
    const topGeo = new THREE.BoxGeometry(6.6, 0.22, 3.9)
    this.disposableGeometries.add(topGeo)
    const topMat = new THREE.MeshStandardMaterial({
      map: this.textures.get('table'),
      color: 0xd3c8ba,
      metalness: 0.55,
      roughness: 0.52,
    })
    this.disposableMaterials.add(topMat)
    const top = new THREE.Mesh(topGeo, topMat)
    top.name = 'TableTop'
    top.userData.proceduralTable = true
    top.position.y = TABLE_TOP - 0.11
    top.castShadow = true
    top.receiveShadow = true
    this.tableGroup.add(top)

    const trimMat = makeStandardMaterial(0x241b16, 0.9, 0.4)
    this.disposableMaterials.add(trimMat)
    const trimGeo = new THREE.BoxGeometry(6.75, 0.06, 4.05)
    this.disposableGeometries.add(trimGeo)
    const trim = new THREE.Mesh(trimGeo, trimMat)
    trim.userData.proceduralTable = true
    trim.position.y = TABLE_TOP - 0.235
    trim.castShadow = true
    this.tableGroup.add(trim)

    const legGeo = new THREE.CylinderGeometry(0.12, 0.09, TABLE_TOP - 0.24, 10)
    this.disposableGeometries.add(legGeo)
    for (const x of [-2.9, 2.9]) {
      for (const z of [-1.6, 1.6]) {
        const leg = new THREE.Mesh(legGeo, trimMat)
        leg.userData.proceduralTable = true
        leg.position.set(x, (TABLE_TOP - 0.24) / 2, z)
        leg.castShadow = true
        this.tableGroup.add(leg)
      }
    }

    const ringGeo = new THREE.RingGeometry(0.55, 0.57, 48)
    this.disposableGeometries.add(ringGeo)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xc9a06a,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(ringMat)
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.userData.proceduralTable = true
    ring.rotation.x = -Math.PI / 2
    ring.position.set(0, TABLE_TOP + 0.002, -0.05)
    this.tableGroup.add(ring)
  }

  private buildActionButtons(): void {
    for (const [index, action] of (['hit', 'stand'] as const).entries()) {
      const button = this.makeActionButton(action, index === 0 ? -0.35 : 0.35, 2.05, 0)
      this.scene.add(button.root)
      this.actionButtons.set(action, button)
    }
    // 对沿镜像一组：只作桌面对称陈列，按道具惯例转 180° 朝 Boss，不参与拾取/悬停
    for (const [index, action] of (['hit', 'stand'] as const).entries()) {
      const button = this.makeActionButton(action, index === 0 ? -0.35 : 0.35, -2.05, Math.PI)
      button.root.name = `TableActionBoss-${action}`
      button.face.emissiveIntensity = 0.06
      button.indicator.emissiveIntensity = 0.02
      this.scene.add(button.root)
    }
  }

  private makeActionButton(action: TableAction, x: number, z: number, yaw: number): ActionButton {
    const iron = makeStandardMaterial(0x262421, 0.7, 0.65)
    const brass = makeStandardMaterial(0x947047, 0.65, 0.52)
    const root = new THREE.Group()
    root.name = `TableAction-${action}`
    root.userData.tableAction = action
    root.position.set(x, TABLE_TOP + 0.12, z)
    root.rotation.order = 'YXZ'
    root.rotation.set(0.2, yaw, 0)
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.09, 0.44), iron)
    socket.castShadow = true
    socket.receiveShadow = true
    root.add(socket)
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.59, 0.025, 0.39), brass)
    bezel.position.y = 0.052
    root.add(bezel)
    const cap = new THREE.Group()
    cap.position.y = 0.075
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.055, 0.33), iron)
    body.castShadow = true
    cap.add(body)

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 320
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = action === 'hit' ? '#39332a' : '#342726'
    ctx.fillRect(0, 0, 512, 320)
    ctx.strokeStyle = '#8d7050'
    ctx.lineWidth = 3
    ctx.strokeRect(14, 14, 484, 292)
    ctx.strokeStyle = 'rgba(196,166,116,0.13)'
    ctx.lineWidth = 1
    for (let i = 0; i < 24; i += 1) {
      const px = (i * 137) % 480
      const py = (i * 89) % 300
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + 15 + (i % 7) * 5, py - 3)
      ctx.stroke()
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ead7ad'
    ctx.font = 'bold 92px "Microsoft YaHei", sans-serif'
    ctx.fillText(action === 'hit' ? '要牌' : '停牌', 256, 131)
    ctx.font = '30px Georgia, serif'
    ctx.fillStyle = '#bc9b6b'
    ctx.fillText(action === 'hit' ? 'H  ·  HIT' : 'S  ·  STAND', 256, 237)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const face = new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.72, metalness: 0.2,
      emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: 0.08,
    })
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.525, 0.325), face)
    label.rotation.x = -Math.PI / 2
    label.position.y = 0.028
    cap.add(label)
    root.add(cap)
    const indicator = new THREE.MeshStandardMaterial({
      color: 0x483921, emissive: 0xe5a24b, emissiveIntensity: 0,
      roughness: 0.45, metalness: 0.35,
    })
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.014), indicator)
    light.position.set(0, 0.066, -0.189)
    root.add(light)
    for (const screwX of [-0.282, 0.282]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 8), brass)
      screw.position.set(screwX, 0.057, 0.165)
      root.add(screw)
    }
    return { root, cap, face, indicator, texture, pressedUntil: 0 }
  }

  setTableActionsAllowed(allowed: boolean): void {
    this.tableActionsAllowed = allowed
  }

  /** 叙事/过场层让出画面后才升起补给托盘 */
  setSupplyRevealAllowed(allowed: boolean): void {
    if (this.supplyRevealAllowed === allowed) return
    this.supplyRevealAllowed = allowed
    if (allowed && this.lastSnapshot) this.syncSupply(this.lastSnapshot)
  }

  getBossDialogueAnchor(): { x: number; y: number; visible: boolean } {
    if (!this.bossHeadBone) return { x: 0.5, y: 0.35, visible: false }
    this.bossHeadBone.getWorldPosition(this.bossDialogueVector)
    this.bossDialogueVector.project(this.camera)
    const x = (this.bossDialogueVector.x + 1) / 2
    const y = (1 - this.bossDialogueVector.y) / 2
    return {
      x,
      y,
      visible:
        this.bossDialogueVector.z > -1 &&
        this.bossDialogueVector.z < 1 &&
        x > 0.04 &&
        x < 0.94 &&
        y > 0.06 &&
        y < 0.9,
    }
  }

  private canUseTableActions(): boolean {
    const snapshot = this.lastSnapshot
    return this.tableActionsAllowed && this.shot === 'table' && this.cameraBlend >= 1 &&
      !this.isBloodCloseupActive() && snapshot?.phase === 'playerTurn' &&
      !snapshot.paused && !snapshot.inputLocked && !snapshot.player.skipTurn && !snapshot.cardChoice
  }

  tableActionLayout(): Record<TableAction, TableActionRect> {
    const rect = this.canvas.getBoundingClientRect()
    const layout = {} as Record<TableAction, TableActionRect>
    for (const [action, button] of this.actionButtons) {
      button.root.updateWorldMatrix(true, true)
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
      for (const x of [-0.32, 0.32]) {
        for (const y of [-0.045, 0.1025]) {
          for (const z of [-0.22, 0.22]) {
            const ndc = new THREE.Vector3(x, y, z).applyMatrix4(button.root.matrixWorld).project(this.camera)
            const sx = rect.left + (ndc.x + 1) * 0.5 * rect.width
            const sy = rect.top + (1 - ndc.y) * 0.5 * rect.height
            left = Math.min(left, sx); right = Math.max(right, sx)
            top = Math.min(top, sy); bottom = Math.max(bottom, sy)
          }
        }
      }
      layout[action] = { left, top, right, bottom }
    }
    return layout
  }

  activateTableAction(action: TableAction): boolean {
    if (!this.canUseTableActions() || !this.callbacks.onTableAction?.(action)) return false
    const button = this.actionButtons.get(action)!
    button.pressedUntil = this.elapsed + 0.16
    return true
  }

  private updateActionButtons(dt: number): void {
    const enabled = this.canUseTableActions()
    if (!enabled) this.actionPressed = null
    // 选枪口阶段由目标拾取接管指针样式，这里不能每帧覆盖
    if (!this.targetPickActive) {
      this.canvas.style.cursor = this.actionHovered && enabled ? 'pointer' : ''
    }
    for (const [action, button] of this.actionButtons) {
      const pressed = this.elapsed < button.pressedUntil || this.actionPressed === action
      const hovered = enabled && this.actionHovered === action
      const target = pressed ? 0.05 : hovered ? 0.098 : 0.075
      button.cap.position.y += (target - button.cap.position.y) * Math.min(1, dt * 24)
      button.face.emissiveIntensity = enabled ? (hovered ? 0.42 : 0.24) : 0.06
      button.indicator.emissiveIntensity = enabled ? (hovered ? 2.6 : 1.4) : 0.02
    }
  }

  private buildBoss(): TorsoParts {
    // GLB 半身像走自身坐标：bossGroup 只承担呼吸与整体摆动，不再做额外缩放
    this.bossGroup.position.set(0, 0, BOSS_Z)

    const coatMat = new THREE.MeshStandardMaterial({
      color: 0x241d19,
      roughness: 0.92,
      metalness: 0.08,
    })
    this.disposableMaterials.add(coatMat)
    const coatGeo = new THREE.CylinderGeometry(0.5, 0.98, 1.62, 20, 1, false)
    this.disposableGeometries.add(coatGeo)
    const coat = new THREE.Mesh(coatGeo, coatMat)
    coat.position.y = 1.24
    coat.castShadow = true
    this.bossGroup.add(coat)

    const shoulderGeo = new THREE.SphereGeometry(0.5, 20, 14)
    this.disposableGeometries.add(shoulderGeo)
    const shoulders = new THREE.Mesh(shoulderGeo, coatMat)
    shoulders.scale.set(1.55, 0.55, 0.78)
    shoulders.position.y = 1.97
    shoulders.castShadow = true
    this.bossGroup.add(shoulders)

    const collarMat = makeStandardMaterial(0x17110e, 0.3, 0.7)
    this.disposableMaterials.add(collarMat)
    const collarGeo = new THREE.CylinderGeometry(0.2, 0.28, 0.3, 14)
    this.disposableGeometries.add(collarGeo)
    const collar = new THREE.Mesh(collarGeo, collarMat)
    collar.position.y = 2.13
    collar.castShadow = true
    this.bossGroup.add(collar)

    const head = new THREE.Group()
    head.position.y = 2.44
    this.bossGroup.add(head)

    const skullMat = makeStandardMaterial(0x1a1512, 0.12, 0.86)
    this.disposableMaterials.add(skullMat)
    const skullGeo = new THREE.SphereGeometry(0.26, 20, 16)
    this.disposableGeometries.add(skullGeo)
    const skull = new THREE.Mesh(skullGeo, skullMat)
    skull.scale.set(0.92, 1.08, 0.95)
    skull.castShadow = true
    head.add(skull)

    const hatMat = makeStandardMaterial(0x141110, 0.08, 0.92)
    this.disposableMaterials.add(hatMat)
    const brimGeo = new THREE.CylinderGeometry(0.5, 0.52, 0.035, 24)
    this.disposableGeometries.add(brimGeo)
    const brim = new THREE.Mesh(brimGeo, hatMat)
    brim.position.y = 0.245
    brim.castShadow = true
    head.add(brim)
    const crownGeo = new THREE.CylinderGeometry(0.24, 0.27, 0.3, 20)
    this.disposableGeometries.add(crownGeo)
    const crown = new THREE.Mesh(crownGeo, hatMat)
    crown.position.y = 0.4
    crown.castShadow = true
    head.add(crown)

    const maskMat = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.maskKey(0)),
      transparent: true,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.88,
      metalness: 0.02,
      color: 0xa8a099,
      side: THREE.FrontSide,
    })
    this.disposableMaterials.add(maskMat)
    const maskGeo = new THREE.PlaneGeometry(0.34, 0.4)
    this.disposableGeometries.add(maskGeo)
    const mask = new THREE.Mesh(maskGeo, maskMat)
    mask.position.set(0, 0.03, 0.248)
    mask.userData.baseY = 0.03
    head.add(mask)

    const maskBackMat = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.maskKey(0)),
      transparent: true,
      roughness: 0.8,
      metalness: 0.05,
      side: THREE.BackSide,
      color: 0x2c2724,
      emissive: 0x000000,
      emissiveIntensity: 0,
    })
    this.disposableMaterials.add(maskBackMat)
    const maskBack = new THREE.Mesh(maskGeo, maskBackMat)
    maskBack.position.set(0, 0.03, 0.239)
    maskBack.userData.baseY = 0.03
    head.add(maskBack)

    const handMat = makeStandardMaterial(0x0f0c0a, 0.05, 0.9)
    this.disposableMaterials.add(handMat)
    const handGeo = new THREE.SphereGeometry(0.1, 10, 8)
    this.disposableGeometries.add(handGeo)
    for (const x of [-0.42, 0.42]) {
      const hand = new THREE.Mesh(handGeo, handMat)
      hand.scale.set(1.1, 0.7, 1.3)
      hand.position.set(x, 1.2, 0.5)
      hand.castShadow = true
      this.bossGroup.add(hand)
    }

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x120a08,
      transparent: true,
      opacity: 0.55,
    })
    this.disposableMaterials.add(fillMat)
    const fillGeo = new THREE.PlaneGeometry(1.8, 1.9)
    this.disposableGeometries.add(fillGeo)
    const silhouette = new THREE.Mesh(fillGeo, fillMat)
    silhouette.position.set(0, 1.6, -0.42)
    this.bossGroup.add(silhouette)

    return { head, mask, maskBack }
  }

  private buildGunPlaceholder(): {
    root: THREE.Group
    drum: THREE.Group
    muzzleLight: THREE.PointLight
    flash: THREE.Sprite
  } {
    const root = new THREE.Group()
    root.name = 'GunPlaceholder'
    // 世界位置由外层 gunAim 提供，模型本身落在枢轴原点
    root.position.set(0, 0, 0)

    const steel = new THREE.MeshStandardMaterial({
      color: 0x4c4a4a,
      metalness: 0.95,
      roughness: 0.34,
    })
    this.disposableMaterials.add(steel)
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x2b2929,
      metalness: 0.92,
      roughness: 0.44,
    })
    this.disposableMaterials.add(darkSteel)
    const wood = new THREE.MeshStandardMaterial({
      color: 0x4a2a17,
      metalness: 0.08,
      roughness: 0.72,
    })
    this.disposableMaterials.add(wood)
    const brass = new THREE.MeshStandardMaterial({
      color: 0xb08a45,
      metalness: 0.9,
      roughness: 0.3,
    })
    this.disposableMaterials.add(brass)

    const barrelGeo = new THREE.CylinderGeometry(0.032, 0.036, 1.05, 15)
    this.disposableGeometries.add(barrelGeo)
    const barrel = new THREE.Mesh(barrelGeo, steel)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.05, -0.62)
    barrel.castShadow = true
    root.add(barrel)

    const ribGeo = new THREE.BoxGeometry(0.05, 0.022, 0.9)
    this.disposableGeometries.add(ribGeo)
    const rib = new THREE.Mesh(ribGeo, darkSteel)
    rib.position.set(0, 0.083, -0.6)
    rib.castShadow = true
    root.add(rib)

    const ejectorGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 8)
    this.disposableGeometries.add(ejectorGeo)
    const ejector = new THREE.Mesh(ejectorGeo, brass)
    ejector.rotation.x = Math.PI / 2
    ejector.position.set(0, -0.005, -0.62)
    root.add(ejector)

    const frameGeo = new THREE.BoxGeometry(0.085, 0.13, 0.42)
    this.disposableGeometries.add(frameGeo)
    const frame = new THREE.Mesh(frameGeo, steel)
    frame.position.set(0, 0.03, -0.02)
    frame.castShadow = true
    root.add(frame)

    const topStrapGeo = new THREE.BoxGeometry(0.075, 0.026, 0.4)
    this.disposableGeometries.add(topStrapGeo)
    const topStrap = new THREE.Mesh(topStrapGeo, darkSteel)
    topStrap.position.set(0, 0.107, -0.02)
    root.add(topStrap)

    const drum = new THREE.Group()
    drum.position.set(0, 0.035, -0.09)
    root.add(drum)
    const drumGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.17, 8)
    this.disposableGeometries.add(drumGeo)
    const drumBody = new THREE.Mesh(drumGeo, darkSteel)
    drumBody.rotation.x = Math.PI / 2
    drumBody.rotation.y = Math.PI / 6
    drumBody.castShadow = true
    drum.add(drumBody)
    const chamberGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8)
    this.disposableGeometries.add(chamberGeo)
    const chamberMat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      metalness: 0.5,
      roughness: 0.9,
    })
    this.disposableMaterials.add(chamberMat)
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2
      const tube = new THREE.Mesh(chamberGeo, chamberMat)
      tube.rotation.x = Math.PI / 2
      tube.position.set(Math.cos(angle) * 0.058, Math.sin(angle) * 0.058, 0.085)
      drum.add(tube)
      const rim = new THREE.Mesh(chamberGeo, brass)
      rim.rotation.x = Math.PI / 2
      rim.scale.set(1.35, 0.06, 1.35)
      rim.position.set(Math.cos(angle) * 0.058, Math.sin(angle) * 0.058, 0.093)
      drum.add(rim)
    }

    const gripGeo = new THREE.BoxGeometry(0.09, 0.34, 0.14)
    this.disposableGeometries.add(gripGeo)
    const grip = new THREE.Mesh(gripGeo, wood)
    grip.position.set(0, -0.12, 0.2)
    grip.rotation.x = 0.42
    grip.castShadow = true
    root.add(grip)
    const gripCapGeo = new THREE.BoxGeometry(0.075, 0.04, 0.12)
    this.disposableGeometries.add(gripCapGeo)
    const gripCap = new THREE.Mesh(gripCapGeo, brass)
    gripCap.position.set(0, -0.275, 0.272)
    gripCap.rotation.x = 0.42
    root.add(gripCap)

    const guardGeo = new THREE.TorusGeometry(0.055, 0.011, 6, 16, Math.PI * 1.15)
    this.disposableGeometries.add(guardGeo)
    const guard = new THREE.Mesh(guardGeo, darkSteel)
    guard.position.set(0, -0.035, 0.05)
    guard.rotation.set(0, Math.PI / 2, -0.5)
    root.add(guard)
    const triggerGeo = new THREE.BoxGeometry(0.016, 0.05, 0.016)
    this.disposableGeometries.add(triggerGeo)
    const trigger = new THREE.Mesh(triggerGeo, brass)
    trigger.position.set(0, -0.035, 0.055)
    trigger.rotation.x = -0.3
    root.add(trigger)

    const hammerGeo = new THREE.BoxGeometry(0.03, 0.075, 0.035)
    this.disposableGeometries.add(hammerGeo)
    const hammer = new THREE.Mesh(hammerGeo, darkSteel)
    hammer.position.set(0, 0.105, 0.17)
    hammer.rotation.x = -0.35
    root.add(hammer)

    const sightGeo = new THREE.BoxGeometry(0.012, 0.018, 0.02)
    this.disposableGeometries.add(sightGeo)
    const sight = new THREE.Mesh(sightGeo, brass)
    sight.position.set(0, 0.115, -1.02)
    root.add(sight)

    const muzzleLight = new THREE.PointLight(0xffb060, 0, 4.5, 2)
    muzzleLight.position.set(0, 0.06, -1.15)
    root.add(muzzleLight)

    const flashMat = new THREE.SpriteMaterial({
      map: this.textures.get('dust'),
      color: 0xffc060,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      // 枪口贴着枪管，深度测试会把火光切掉一半；开火瞬间必须压在所有几何之上
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.disposableMaterials.add(flashMat)
    const flash = new THREE.Sprite(flashMat)
    flash.position.set(0, 0.06, -1.06)
    flash.scale.setScalar(0.3)
    flash.renderOrder = 20
    flash.visible = false
    root.add(flash)

    return { root, drum, muzzleLight, flash }
  }

  private buildDust(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const count = 720
    const positions = new Float32Array(count * 3)
    const drift = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const base = i * 3
      positions[base] = (Math.random() - 0.5) * 7.2
      positions[base + 1] = 0.7 + Math.random() * 3.9
      positions[base + 2] = -3.5 + Math.random() * 3.3
      drift[base] = (Math.random() - 0.5) * 0.05
      drift[base + 1] = -0.012 - Math.random() * 0.035
      drift[base + 2] = (Math.random() - 0.5) * 0.04
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.disposableGeometries.add(geometry)
    const material = new THREE.PointsMaterial({
      map: this.textures.get('dust'),
      size: 0.017,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xffe0b0,
      sizeAttenuation: true,
    })
    this.disposableMaterials.add(material)
    const points = new THREE.Points(geometry, material)
    points.userData.drift = drift
    this.scene.add(points)
    return points
  }

  private buildSuspensionRig(): void {
    const geometry = new THREE.TorusGeometry(0.036, 0.009, 6, 10)
    const material = new THREE.MeshStandardMaterial({
      color: 0x3d4145,
      metalness: 0.85,
      roughness: 0.48,
    })
    this.disposableGeometries.add(geometry)
    this.disposableMaterials.add(material)
    this.suspensionChains = this.suspensionAnchors.map(() => {
      const chain = new THREE.InstancedMesh(geometry, material, SUSPENSION_LINK_COUNT)
      chain.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      chain.frustumCulled = false
      chain.visible = false
      this.scene.add(chain)
      return chain
    })
  }

  private updateSuspensionRig(): void {
    const legs = [this.bossThighLBone, this.bossThighRBone]
    const offsets = [this.bossFootLOffset, this.bossFootROffset]
    for (let side = 0; side < this.suspensionChains.length; side += 1) {
      const chain = this.suspensionChains[side]
      const leg = legs[side]
      const offset = offsets[side]
      const ready = this.suspensionLift > 0.02 && leg && offset.lengthSq() > 0.001
      chain.visible = Boolean(ready)
      if (!ready || !leg) continue
      this.suspensionAnchor.copy(this.suspensionAnchors[side])
      this.suspensionFoot.copy(offset)
      leg.localToWorld(this.suspensionFoot)
      this.suspensionDirection.copy(this.suspensionFoot).sub(this.suspensionAnchor).normalize()
      for (let link = 0; link < SUSPENSION_LINK_COUNT; link += 1) {
        this.suspensionDummy.position.lerpVectors(
          this.suspensionAnchor,
          this.suspensionFoot,
          (link + 0.5) / SUSPENSION_LINK_COUNT,
        )
        this.suspensionDummy.quaternion.setFromUnitVectors(this.suspensionUp, this.suspensionDirection)
        this.suspensionDummy.rotateY(link % 2 === 0 ? 0 : Math.PI / 2)
        this.suspensionDummy.updateMatrix()
        chain.setMatrixAt(link, this.suspensionDummy.matrix)
      }
      chain.instanceMatrix.needsUpdate = true
    }
  }

  /** 实弹命中的血雾：一小撮带重力的血珠 + 一团扩散的红雾，都朝镜头方向喷出 */
  private buildBloodBurst(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const positions = new Float32Array(BLOOD_PARTICLE_COUNT * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.disposableGeometries.add(geometry)
    const material = new THREE.PointsMaterial({
      map: this.textures.get('dust'),
      color: 0xff2414,
      size: 0.16,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    })
    this.disposableMaterials.add(material)
    const points = new THREE.Points(geometry, material)
    points.visible = false
    this.scene.add(points)
    return points
  }

  /** 异形模型优先使用随动画移动的命中标记，直立半身像按胸高换算。 */
  private bossHitPoint(out: THREE.Vector3): THREE.Vector3 {
    const marker = this.bossGroup.getObjectByName('BossHitPoint')
    if (marker) return marker.getWorldPosition(out)
    if (this.currentLevelIndex === 2 && this.bossChestBone) {
      this.bossChestBone.getWorldPosition(out)
      const orientation = this.bossGroup.quaternion
      out.x += 0.48 * orientation.z
      out.y -= 0.48 * orientation.x
      return out
    }
    const bustHeight = BOSS_BUST_HEIGHTS[BOSS_VISUAL_LEVEL] ?? BOSS_BUST_HEIGHTS[0]
    return out.set(0, BOSS_BUST_BASE_Y + bustHeight * BOSS_CHEST_RATIO, BOSS_Z + 0.62)
  }

  /** 命中闪光复用同一盏预建点光，只改颜色/距离/强度/位置；运行中加拆光源会触发全场景重编译 */
  private pulseImpactLight(
    color: number,
    intensity: number,
    distance: number,
    origin: THREE.Vector3,
    zOffset: number,
    duration: number,
  ): void {
    const light = this.impactLight
    if (!light) return
    const generation = ++this.impactGeneration
    light.color.setHex(color)
    light.distance = distance
    light.intensity = intensity
    light.position.copy(origin)
    light.position.z += zOffset
    this.tween({
      duration,
      onUpdate: (t) => {
        if (generation !== this.impactGeneration) return
        light.intensity = intensity * (1 - t) ** 2
      },
      onComplete: () => {
        if (generation !== this.impactGeneration) return
        light.intensity = 0
      },
    })
  }

  private spawnBlood(origin: THREE.Vector3): void {
    this.bloodLife = 0.95
    const attribute = this.bloodBurst.geometry.getAttribute('position')
    if (!(attribute instanceof THREE.BufferAttribute)) return
    const array = attribute.array as Float32Array
    for (let i = 0; i < BLOOD_PARTICLE_COUNT; i += 1) {
      const base = i * 3
      array[base] = origin.x
      array[base + 1] = origin.y
      array[base + 2] = origin.z
      // z 朝向镜头，喷得够开才会在画面上形成扇形血雾
      this.bloodVelocity[base] = (Math.random() - 0.5) * 1.6
      this.bloodVelocity[base + 1] = Math.random() * 1.2 - 0.15
      this.bloodVelocity[base + 2] = 0.6 + Math.random() * 2.6
    }
    attribute.needsUpdate = true
    this.bloodBurst.visible = true
    this.bloodBurst.material.opacity = 0.95

    if (!this.bloodMist) {
      const material = new THREE.SpriteMaterial({
        map: this.textures.get('dust'),
        color: 0xa31208,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      this.disposableMaterials.add(material)
      const sprite = new THREE.Sprite(material)
      sprite.visible = false
      this.scene.add(sprite)
      this.bloodMist = sprite
    }
    const mist = this.bloodMist
    mist.position.copy(origin)
    mist.scale.setScalar(0.55)
    mist.material.opacity = 0.8
    mist.visible = true
    this.bloodMistLife = 0.7

    // 命中瞬间的红光，让血在曝光里"炸"一下
    this.pulseImpactLight(0xff2a14, 16, 4.5, origin, 0.15, 0.3)
  }

  private updateBlood(dt: number): void {
    if (this.bloodLife > 0) {
      this.bloodLife = Math.max(0, this.bloodLife - dt)
      const attribute = this.bloodBurst.geometry.getAttribute('position')
      if (attribute instanceof THREE.BufferAttribute) {
        const array = attribute.array as Float32Array
        for (let i = 0; i < BLOOD_PARTICLE_COUNT; i += 1) {
          const base = i * 3
          this.bloodVelocity[base + 1] -= 3.2 * dt
          array[base] += this.bloodVelocity[base] * dt
          array[base + 1] += this.bloodVelocity[base + 1] * dt
          array[base + 2] += this.bloodVelocity[base + 2] * dt
        }
        attribute.needsUpdate = true
      }
      this.bloodBurst.material.opacity = 0.95 * (this.bloodLife / 0.95) ** 0.7
      if (this.bloodLife === 0) this.bloodBurst.visible = false
    }
    if (this.bloodMistLife > 0 && this.bloodMist) {
      this.bloodMistLife = Math.max(0, this.bloodMistLife - dt)
      const t = 1 - this.bloodMistLife / 0.7
      this.bloodMist.scale.setScalar(0.55 + t * 1.3)
      this.bloodMist.material.opacity = 0.8 * (1 - t) ** 1.4
      if (this.bloodMistLife === 0) this.bloodMist.visible = false
    }
  }

  private buildSparkBurst(): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
    const positions = new Float32Array(SPARK_PARTICLE_COUNT * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.disposableGeometries.add(geometry)
    const material = new THREE.PointsMaterial({
      map: this.textures.get('dust'),
      color: 0xffe6b0,
      size: 0.18,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    })
    this.disposableMaterials.add(material)
    const points = new THREE.Points(geometry, material)
    points.visible = false
    this.scene.add(points)
    return points
  }

  /** 格挡碎屑：护心镜碎裂的金色金属火花（会发光、带一盏短命点光） */
  private spawnSparks(origin: THREE.Vector3): void {
    this.sparkLife = 0.5
    const attribute = this.sparkBurst.geometry.getAttribute('position')
    if (!(attribute instanceof THREE.BufferAttribute)) return
    const material = this.sparkBurst.material
    material.color.setHex(0xffe6b0)
    material.size = 0.18
    material.blending = THREE.AdditiveBlending
    material.needsUpdate = true

    const array = attribute.array as Float32Array
    for (let i = 0; i < SPARK_PARTICLE_COUNT; i += 1) {
      const base = i * 3
      array[base] = origin.x
      array[base + 1] = origin.y
      array[base + 2] = origin.z
      this.sparkVelocity[base] = (Math.random() - 0.5) * 2.6
      this.sparkVelocity[base + 1] = Math.random() * 1.6 - 0.2
      this.sparkVelocity[base + 2] = 1.2 + Math.random() * 2.4
    }
    attribute.needsUpdate = true
    this.sparkBurst.visible = true
    material.opacity = 1

    // 火花是瞬时强光：复用命中补光，否则在暗场里只剩几个像素点
    this.pulseImpactLight(0xffc070, 4, 2, origin, 0.2, 0.32)
  }

  private updateSparks(dt: number): void {
    if (this.sparkLife <= 0) return
    this.sparkLife = Math.max(0, this.sparkLife - dt)
    const attribute = this.sparkBurst.geometry.getAttribute('position')
    if (attribute instanceof THREE.BufferAttribute) {
      const array = attribute.array as Float32Array
      for (let i = 0; i < SPARK_PARTICLE_COUNT; i += 1) {
        const base = i * 3
        this.sparkVelocity[base + 1] -= 7.5 * dt
        array[base] += this.sparkVelocity[base] * dt
        array[base + 1] += this.sparkVelocity[base + 1] * dt
        array[base + 2] += this.sparkVelocity[base + 2] * dt
      }
      attribute.needsUpdate = true
    }
    this.sparkBurst.material.opacity = (this.sparkLife / 0.5) ** 0.6 * (this.sparkBurst.material.blending === THREE.AdditiveBlending ? 1 : 0.85)
    if (this.sparkLife === 0) this.sparkBurst.visible = false
  }

  private buildDeckPile(): void {
    const back = this.textures.get(this.textures.cardBackKey)
    const geometry = createCardGeometry()
    const side = new THREE.MeshStandardMaterial({ color: 0x2c221c, roughness: 0.86 })
    const face = new THREE.MeshStandardMaterial({ map: back, roughness: 0.74, metalness: 0.06 })
    this.disposableGeometries.add(geometry)
    this.disposableMaterials.add(side)
    this.disposableMaterials.add(face)
    const pile = new THREE.InstancedMesh(geometry, [side, face, face], 12)
    const transform = new THREE.Object3D()
    for (let i = 0; i < 12; i += 1) {
      transform.position.set(0, i * (CARD_T + 0.0015), 0)
      transform.rotation.set(0, (Math.random() - 0.5) * 0.12, 0)
      transform.updateMatrix()
      pile.setMatrixAt(i, transform.matrix)
    }
    pile.instanceMatrix.needsUpdate = true
    pile.castShadow = true
    pile.receiveShadow = true
    this.deckGroup.add(pile)
  }

  private applyLevel(levelIndex: number): void {
    const index = Math.min(LEVEL_LOOK.length - 1, Math.max(0, levelIndex))
    this.currentLevelIndex = index
    if (index === this.levelLookIndex) return
    this.levelLookIndex = index
    if (index === 1) {
      this.boss2HeadTwitchLife = 0
      this.boss2HeadTwitchCooldown = BOSS2_HEAD_TWITCH_MIN_DELAY + Math.random() * (BOSS2_HEAD_TWITCH_MAX_DELAY - BOSS2_HEAD_TWITCH_MIN_DELAY)
    }
    const look = LEVEL_LOOK[index]
    if (!look) return
    this.rimLight.color.setHex(look.rim)
    this.fillLight.color.setHex(look.fill)
    this.spot.color.setHex(look.lamp)
  }

  private setMaskTexture(levelIndex: number): void {
    const texture = this.textures.get(this.textures.maskKey(levelIndex))
    this.bossParts.mask.material.map = texture
    this.bossParts.mask.material.needsUpdate = true
    this.bossParts.maskBack.material.map = texture
    this.bossParts.maskBack.material.needsUpdate = true
    this.applyBossMaskModel()
  }

  /** 统一使用一层半身像：模型就绪就换，否则保留程序化 Boss */
  private applyBossMaskModel(): void {
    const model = this.bossModelByLevel[BOSS_VISUAL_LEVEL] ?? null
    if (!model) return
    if (this.activeBossMaskLevel === BOSS_VISUAL_LEVEL) return
    this.activeBossMaskLevel = BOSS_VISUAL_LEVEL

    const stale = this.bossGroup.getObjectByName('BossBustGLB')
    // 克隆与模板共享几何和材质，切层时不能销毁模板资源。
    if (stale) this.bossGroup.remove(stale)

    // 模型自带完整躯干，底座在自身 y=0：直接按世界高度缩放，底座落到桌沿下方
    const bustHeight = BOSS_BUST_HEIGHTS[BOSS_VISUAL_LEVEL] ?? BOSS_BUST_HEIGHTS[0]
    const wrapper = this.placeModel(model, bustHeight, new THREE.Vector3(0, 0, 0), 0, 'height')
    wrapper.name = 'BossBustGLB'
    wrapper.position.set(0, BOSS_BUST_BASE_Y, 0)
    this.bossGroup.add(wrapper)

    // 盯视与摆臂必须驱动骨骼：BossHead/Arm.L 是蒙皮网格节点，转它们会被绑定矩阵抵消。
    // GLTFLoader 会把 UpperArm.L 规范成 UpperArmL。
    const headBone = wrapper.getObjectByName('Head')
    this.bossHeadBone = headBone instanceof THREE.Bone ? headBone : null
    if (this.bossHeadBone) {
      this.bossHeadRest.copy(this.bossHeadBone.quaternion)
      this.bossHeadRestPosition.copy(this.bossHeadBone.position)
    }
    const armLBone = wrapper.getObjectByName('UpperArmL')
    const armRBone = wrapper.getObjectByName('UpperArmR')
    const forearmLBone = wrapper.getObjectByName('ForearmL')
    const forearmRBone = wrapper.getObjectByName('ForearmR')
    const thighLBone = wrapper.getObjectByName('ThighL')
    const thighRBone = wrapper.getObjectByName('ThighR')
    const chestBone = wrapper.getObjectByName('Chest')
    this.bossArmLBone = armLBone instanceof THREE.Bone ? armLBone : null
    this.bossArmRBone = armRBone instanceof THREE.Bone ? armRBone : null
    this.bossForearmLBone = forearmLBone instanceof THREE.Bone ? forearmLBone : null
    this.bossForearmRBone = forearmRBone instanceof THREE.Bone ? forearmRBone : null
    this.bossThighLBone = thighLBone instanceof THREE.Bone ? thighLBone : null
    this.bossThighRBone = thighRBone instanceof THREE.Bone ? thighRBone : null
    this.bossChestBone = chestBone instanceof THREE.Bone ? chestBone : null
    if (this.bossArmLBone) this.bossArmLRest.copy(this.bossArmLBone.quaternion)
    if (this.bossArmRBone) this.bossArmRRest.copy(this.bossArmRBone.quaternion)
    if (this.bossForearmLBone) this.bossForearmLRest.copy(this.bossForearmLBone.quaternion)
    if (this.bossForearmRBone) this.bossForearmRRest.copy(this.bossForearmRBone.quaternion)
    if (this.bossThighLBone) this.bossThighLRest.copy(this.bossThighLBone.quaternion)
    if (this.bossThighRBone) this.bossThighRRest.copy(this.bossThighRBone.quaternion)
    this.bossGroup.updateMatrixWorld(true)
    this.bossForearmLLength = 0
    this.bossForearmRLength = 0
    if (this.bossArmLBone && this.bossForearmLBone) {
      this.bossArmLDirection.copy(this.bossForearmLBone.position).normalize()
      this.bossArmLBone.getWorldPosition(this.bossIkShoulder)
      this.bossForearmLBone.getWorldPosition(this.bossIkElbow)
      this.bossUpperArmLength = this.bossIkShoulder.distanceTo(this.bossIkElbow)
      const hand = this.measureBossHandEffector(wrapper, this.bossForearmLBone)
      if (hand) {
        this.bossHandLOffset.copy(hand.offset)
        this.bossForearmLLength = hand.length
      }
    }
    if (this.bossArmRBone && this.bossForearmRBone) {
      this.bossArmRDirection.copy(this.bossForearmRBone.position).normalize()
      const hand = this.measureBossHandEffector(wrapper, this.bossForearmRBone)
      if (hand) {
        this.bossHandROffset.copy(hand.offset)
        this.bossForearmRLength = hand.length
      }
    }
    this.bossFootLOffset.set(0, 0, 0)
    this.bossFootROffset.set(0, 0, 0)
    if (this.bossThighLBone) {
      const foot = this.measureBossHandEffector(wrapper, this.bossThighLBone)
      if (foot) this.bossFootLOffset.copy(foot.offset)
    }
    if (this.bossThighRBone) {
      const foot = this.measureBossHandEffector(wrapper, this.bossThighRBone)
      if (foot) this.bossFootROffset.copy(foot.offset)
    }
    this.collectBossLimbs(wrapper)

    // 半身像含完整头部与双肩，隐藏程序化面具与躯干
    this.bossParts.mask.visible = false
    this.bossParts.maskBack.visible = false
    this.bossParts.head.visible = false
    this.setProgrammaticBodyVisible(false)
  }

  private measureBossHandEffector(
    wrapper: THREE.Group,
    forearm: THREE.Bone,
  ): { mesh: THREE.SkinnedMesh; offset: THREE.Vector3; length: number } | null {
    const best = { mesh: null as THREE.SkinnedMesh | null, boneIndex: -1, weight: -1 }
    wrapper.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return
      const index = object.skeleton.bones.indexOf(forearm)
      if (index < 0) return
      const skinIndex = object.geometry.getAttribute('skinIndex')
      const skinWeight = object.geometry.getAttribute('skinWeight')
      let total = 0
      for (let i = 0; i < skinIndex.count; i += 1) {
        for (let k = 0; k < 4; k += 1) {
          if (skinIndex.getComponent(i, k) === index) total += skinWeight.getComponent(i, k)
        }
      }
      if (total > best.weight) {
        best.mesh = object
        best.boneIndex = index
        best.weight = total
      }
    })
    const mesh = best.mesh
    const boneIndex = best.boneIndex
    if (!mesh) return null

    // ArmL_3/R_3 蒙皮在上臂；掌心点必须从前臂权重最高的网格远端取样。
    mesh.skeleton.update()
    mesh.updateWorldMatrix(true, false)
    const position = mesh.geometry.getAttribute('position')
    const skinIndex = mesh.geometry.getAttribute('skinIndex')
    const skinWeight = mesh.geometry.getAttribute('skinWeight')
    const elbow = forearm.getWorldPosition(new THREE.Vector3())
    const centroid = new THREE.Vector3()
    const vertex = new THREE.Vector3()
    const candidates: THREE.Vector3[] = []
    for (let i = 0; i < position.count; i += 1) {
      let weight = 0
      for (let k = 0; k < 4; k += 1) {
        if (skinIndex.getComponent(i, k) === boneIndex) weight += skinWeight.getComponent(i, k)
      }
      if (weight < 0.35) continue
      mesh.getVertexPosition(i, vertex)
      vertex.applyMatrix4(mesh.matrixWorld)
      candidates.push(vertex.clone())
      centroid.add(vertex)
    }
    if (candidates.length === 0) return null
    centroid.multiplyScalar(1 / candidates.length)
    const direction = centroid.sub(elbow)
    if (direction.lengthSq() < 1e-6) return null
    direction.normalize()
    const ranked = candidates
      .map((point) => ({ point, projection: point.dot(direction) }))
      .sort((a, b) => b.projection - a.projection)
    const sampleCount = Math.min(ranked.length, Math.max(8, Math.round(ranked.length * 0.12)))
    const palm = new THREE.Vector3()
    for (let i = 0; i < sampleCount; i += 1) palm.add(ranked[i].point)
    palm.multiplyScalar(1 / sampleCount)
    const offset = forearm.worldToLocal(palm.clone())
    return { mesh, offset, length: elbow.distanceTo(palm) }
  }

  /** L2 虫体：按象限拆出的四肢（每肢三段），收好节点与静止姿态，供击倒/起身驱动 */
  private collectBossLimbs(wrapper: THREE.Group): void {
    this.bossLimbGroups.clear()
    this.bossLimbRest.clear()
    this.bossPlantFrom.clear()
    this.bossPlanted = false
    for (const q of ['LF', 'LB', 'RF', 'RB']) {
      const base = wrapper.getObjectByName(`Leg${q}`)
      if (!base) continue
      const segments = [1, 2, 3]
        .map((i) => wrapper.getObjectByName(`Leg${q}_${i}`))
        .filter((node): node is THREE.Object3D => Boolean(node))
      this.bossLimbGroups.set(q, { base, segments })
      this.bossLimbRest.set(q, {
        base: base.rotation.clone(),
        segments: segments.map((seg) => seg.rotation.clone()),
      })
    }
  }

  /** 从乱舞转入起身时记录当前角度，保证「撑桌」是从当下姿态过渡过去的 */
  private capturePlantFrom(): void {
    this.bossPlantFrom.clear()
    for (const [q, entry] of this.bossLimbGroups) {
      this.bossPlantFrom.set(q, {
        base: entry.base.rotation.clone(),
        segments: entry.segments.map((seg) => seg.rotation.x),
      })
    }
  }

  /** L2 四肢：击倒外张、趴地乱舞、起身左右先后搭桌；血袋特写期间冻结 */
  private updateBossLimbs(): void {
    if (this.activeBossMaskLevel !== 1 || this.bossLimbGroups.size === 0 || this.bossPoseHold) return
    const state = this.bossPose.state()
    const st = Math.max(0, this.elapsed - this.bossPoseStateStartedAt)
    const motion = this.reducedMotion ? 0.45 : 1
    for (const [q, entry] of this.bossLimbGroups) {
      const rest = this.bossLimbRest.get(q)!
      const side = q.startsWith('L') ? -1 : 1
      const phase = q === 'LF' ? 0 : q === 'LB' ? 1.7 : q === 'RF' ? 2.6 : 4.1
      if (state === 'impact' || state === 'collapse') {
        const p = clamp01(st / 0.45)
        const from = this.bossPlantFrom.get(q)
        const fx = from?.base.x ?? rest.base.x
        const fy = from?.base.y ?? rest.base.y
        const fz = from?.base.z ?? rest.base.z
        entry.base.rotation.set(
          fx + (rest.base.x + 0.3 * motion - fx) * p,
          fy + (rest.base.y + side * 0.55 * motion - fy) * p,
          fz + (rest.base.z + side * 0.85 * motion - fz) * p,
        )
        entry.segments.forEach((seg, i) => {
          const fromX = from?.segments[i] ?? rest.segments[i].x
          const target = rest.segments[i].x + (0.25 + i * 0.2) * motion
          seg.rotation.x = fromX + (target - fromX) * p
        })
        continue
      }
      if (state === 'prone' || state === 'deadProne') {
        const t = st
        const from = this.bossPlantFrom.get(q)
        const blend = clamp01(t / 0.3)
        const fx = from?.base.x ?? rest.base.x
        const fy = from?.base.y ?? rest.base.y
        const fz = from?.base.z ?? rest.base.z
        const baseX = fx + (rest.base.x + 0.25 * motion - fx) * blend
        const baseY = fy + (rest.base.y + side * 0.55 * motion - fy) * blend
        const baseZ = fz + (rest.base.z + side * 0.65 * motion - fz) * blend
        entry.base.rotation.set(
          baseX + 0.18 * motion * Math.sin(t * 5.3 + phase),
          baseY + 0.22 * motion * Math.sin(t * 3.7 + phase * 1.3),
          baseZ + 0.45 * motion * Math.sin(t * 6.1 + phase),
        )
        entry.segments.forEach((seg, i) => {
          const fromX = from?.segments[i] ?? rest.segments[i].x
          const targetX = fromX + (rest.segments[i].x + 0.2 * motion - fromX) * blend
          seg.rotation.x = targetX + 0.45 * motion * Math.sin(t * (7 + i * 1.3) + phase + i * 0.8)
        })
        continue
      }
      if (state === 'spawn' || (state === 'idle' && !this.bossPlanted)) {
        entry.base.rotation.copy(rest.base)
        entry.segments.forEach((seg, i) => { seg.rotation.x = rest.segments[i].x })
        continue
      }
      const delay = q === 'RF' ? 0 : q === 'RB' ? 0.2 : q === 'LF' ? 0.45 : 0.65
      const plantT = this.bossPlanted ? Math.max(0, this.elapsed - this.bossPlantStartedAt) : 0
      const p = easeInOutCubic(clamp01((plantT - delay) / 0.7))
      const from = this.bossPlantFrom.get(q)
      const targetX = rest.base.x - 0.45
      const targetY = rest.base.y + side * 0.1
      const targetZ = rest.base.z + side * 0.1
      if (from) {
        entry.base.rotation.set(
          from.base.x + (targetX - from.base.x) * p,
          from.base.y + (targetY - from.base.y) * p,
          from.base.z + (targetZ - from.base.z) * p,
        )
        entry.segments.forEach((seg, i) => {
          const fromX = from.segments[i] ?? rest.segments[i].x
          const target = rest.segments[i].x - 0.7 + i * 0.08
          seg.rotation.x = fromX + (target - fromX) * p
        })
      } else {
        entry.base.rotation.set(targetX, targetY, targetZ)
        entry.segments.forEach((seg, i) => { seg.rotation.x = rest.segments[i].x - 0.7 + i * 0.08 })
      }
    }
  }

  /** 半身像模式下隐藏手搓的躯干、帽子、衣领、手臂与剪影板 */
  private setProgrammaticBodyVisible(visible: boolean): void {
    for (const child of this.bossGroup.children) {
      if (child === this.bossParts.head) continue
      if (child.name === 'BossBustGLB') continue
      child.visible = visible
    }
  }

  private syncCards(snapshot: GameSnapshot): void {
    this.setMaskTexture(snapshot.levelIndex)
    for (const actor of ['player', 'boss'] as const) {
      const hand = actor === 'player' ? snapshot.player.visibleHand : snapshot.boss.visibleHand
      const visible = hand.visible.slice(0, MAX_VISIBLE_CARDS)
      for (let i = 0; i < visible.length; i += 1) {
        const card = visible[i]
        const key = `${actor}-${i}`
        let entry = this.cards.get(key)
        if (card) {
          if (!entry) {
            entry = this.spawnCard(actor, i, card, visible.length)
            this.cards.set(key, entry)
          } else {
            const nextKey = this.textures.cardKey(card.rank, card.suit)
            if (entry.cardKey !== nextKey) {
              entry.cardKey = nextKey
              this.applyCardTexture(entry, card)
            }
          }
          this.setCardFaceUp(entry, true)
        } else {
          // 暗牌：先占位显示牌背，亮牌时再翻面
          if (!entry) {
            entry = this.spawnHoleCard(actor, i, visible.length)
            this.cards.set(key, entry)
          }
          this.setCardFaceUp(entry, false)
        }
      }
      for (const [key, entry] of this.cards) {
        if (entry.actor === actor && entry.index >= visible.length) {
          this.removeCard(key, entry)
        }
      }
      this.layoutHand(actor, visible.length)
    }
  }

  /** 翻转卡牌：faceUp=false 时用牌背朝向桌面外侧 */
  private setCardFaceUp(entry: CardEntry, faceUp: boolean): void {
    const target = faceUp ? 0 : Math.PI
    if (Math.abs(entry.mesh.rotation.x - target) < 0.01) return
    const from = entry.mesh.rotation.x
    this.tween({
      duration: 0.36,
      onUpdate: (t) => {
        const eased = easeInOutCubic(t)
        entry.mesh.rotation.x = from + (target - from) * eased
        entry.flip = entry.mesh.rotation.x
      },
    })
  }

  /** 对手的底牌占位：仅渲染牌背 */
  private spawnHoleCard(actor: ActorId, index: number, count: number): CardEntry {
    const geo = createCardGeometry()
    this.disposableGeometries.add(geo)
    const side = new THREE.MeshStandardMaterial({ color: 0x231b16, roughness: 0.88 })
    this.disposableMaterials.add(side)
    const back = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.cardBackKey),
      roughness: 0.76,
      metalness: 0.05,
    })
    this.disposableMaterials.add(back)
    // 与 spawnCard 保持同一朝向：+y 为「朝上」面，翻面时整个牌绕 X 轴翻转
    const materials: THREE.Material[] = [side, back, back]
    const mesh = new THREE.Mesh(geo, materials)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.copy(DECK_POS)
    mesh.position.y += 0.12 + index * 0.004
    mesh.rotation.order = 'YXZ'
    mesh.rotation.set(Math.PI, Math.PI, 0)
    mesh.scale.setScalar(0.65)
    this.cardGroup.add(mesh)

    const entry: CardEntry = {
      mesh,
      actor,
      index,
      cardKey: 'hole',
      flip: Math.PI,
      angle: Math.PI,
    }
    this.animateDeal(entry, index, count)
    return entry
  }

  private spawnCard(actor: ActorId, index: number, card: Card, count: number): CardEntry {
    const geo = createCardGeometry()
    this.disposableGeometries.add(geo)
    const side = new THREE.MeshStandardMaterial({ color: 0x231b16, roughness: 0.88 })
    this.disposableMaterials.add(side)
    const face = new THREE.MeshStandardMaterial({
      roughness: 0.66,
      metalness: 0.04,
      color: 0xd8cfc2,
    })
    this.disposableMaterials.add(face)
    const back = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.cardBackKey),
      roughness: 0.76,
      metalness: 0.05,
    })
    this.disposableMaterials.add(back)
    const materials: THREE.Material[] = [side, face, back]
    const mesh = new THREE.Mesh(geo, materials)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.position.copy(DECK_POS)
    mesh.position.y += 0.12 + index * 0.004
    mesh.rotation.order = 'YXZ'
    mesh.rotation.set(Math.PI, actor === 'player' ? 0 : Math.PI, 0)
    mesh.scale.setScalar(0.65)
    mesh.userData.targetScale = 1
    this.cardGroup.add(mesh)

    const entry: CardEntry = {
      mesh,
      actor,
      index,
      cardKey: '',
      flip: Math.PI,
      angle: actor === 'player' ? 0 : Math.PI,
    }
    this.applyCardTexture(entry, card)
    this.animateDeal(entry, index, count)
    return entry
  }

  private applyCardTexture(entry: CardEntry, card: Card): void {
    const faceMaterial = entry.mesh.material[cardFaceTopIndex()]
    if (faceMaterial instanceof THREE.MeshStandardMaterial) {
      faceMaterial.map = this.textures.get(this.textures.cardKey(card.rank, card.suit))
      faceMaterial.needsUpdate = true
    }
  }

  private animateDeal(entry: CardEntry, index: number, count: number): void {
    // 用最终手牌数定位：第四张直接飞向让位后的槽位，不再先压道具格再被拽回
    const target = this.cardSlot(entry.actor, index, count)
    const start = entry.mesh.position.clone()
    const startScale = 0.65
    // 底牌从发牌起就保持背面朝上，不参与翻开动画
    const faceDown = entry.cardKey === 'hole'
    this.dealingCards.add(entry)
    this.tween({
      duration: 0.52,
      delay: index * 0.04,
      onUpdate: (t) => {
        const eased = easeOutCubic(t)
        entry.mesh.position.lerpVectors(start, target.position, eased)
        entry.mesh.position.y += Math.sin(eased * Math.PI) * 0.5
        entry.mesh.scale.setScalar(startScale + (1 - startScale) * eased)
        entry.mesh.rotation.x = entry.flip
      },
      onComplete: () => {
        this.dealingCards.delete(entry)
        const slot = this.cardSlot(entry.actor, index, count)
        entry.mesh.position.copy(slot.position)
        if (faceDown) return
        const from = entry.flip
        this.tween({
          duration: 0.3,
          delay: 0.06,
          onUpdate: (t) => {
            const eased = easeInOutCubic(t)
            entry.mesh.rotation.x = from + (0 - from) * eased
            entry.flip = entry.mesh.rotation.x
          },
        })
      },
    })
  }

  private cardSlot(actor: ActorId, index: number, count: number): { position: THREE.Vector3; angle: number } {
    const spacing = 0.335
    const total = Math.max(1, count)
    const offset = (index - (total - 1) / 2) * spacing
    // 道具格左缘在 x≈0.51：第四张起右手牌会压进格子，整手向左让位
    const fanHalfWidth = ((total - 1) * spacing) / 2 + CARD_W / 2
    const handShift = Math.max(0, fanHalfWidth - 0.45)
    const z = actor === 'player' ? 0.9 : -0.98
    const y = TABLE_TOP + CARD_T / 2 + 0.006
    const angle = actor === 'player' ? offset * -0.14 : Math.PI + offset * 0.14
    return { position: new THREE.Vector3(offset - handShift, y, z), angle }
  }

  private layoutHand(actor: ActorId, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const entry = this.cards.get(`${actor}-${i}`)
      if (!entry || this.dealingCards.has(entry)) continue
      const slot = this.cardSlot(actor, i, count)
      const mesh = entry.mesh
      const fromPos = mesh.position.clone()
      const fromAngle = entry.angle
      this.tween({
        duration: 0.35,
        onUpdate: (t) => {
          const eased = easeOutCubic(t)
          mesh.position.lerpVectors(fromPos, slot.position, eased)
          entry.angle = fromAngle + (slot.angle - fromAngle) * eased
          mesh.rotation.y = entry.angle
        },
      })
    }
  }

  private removeCard(key: string, entry: CardEntry): void {
    this.cards.delete(key)
    this.cardGroup.remove(entry.mesh)
    entry.mesh.geometry.dispose()
    for (const material of entry.mesh.material) material.dispose()
  }

  private syncItems(snapshot: GameSnapshot): void {
    for (const actor of ['player', 'boss'] as const) {
      const list = actor === 'player' ? snapshot.player.items : snapshot.boss.items
      const wanted = new Map<string, { item: ItemId; index: number }>()
      list.forEach((item, index) => {
        wanted.set(`${actor}-${item}-${index}`, { item, index })
      })
      for (const [key, entry] of this.items) {
        if (entry.actor !== actor) continue
        if (!wanted.has(key)) {
          this.items.delete(key)
          this.itemRoot.remove(entry.group)
          this.disposeObject(entry.group)
          if (this.hovered === entry) this.setHovered(null)
        }
      }
      for (const [key, value] of wanted) {
        if (this.items.has(key)) continue
        const entry = this.spawnItem(actor, value.item, value.index, key)
        this.items.set(key, entry)
      }
      for (const [key, value] of wanted) {
        const entry = this.items.get(key)
        if (!entry) continue
        const slot = this.itemSlot(actor, value.index)
        entry.baseY = slot.y
        const fromPos = entry.group.position.clone()
        this.tween({
          duration: 0.3,
          onUpdate: (t) => {
            entry.group.position.lerpVectors(fromPos, slot, easeOutCubic(t))
          },
        })
      }
    }
  }

  private normalizeItemModel(object: THREE.Object3D, upright = false): void {
    let box = new THREE.Box3().setFromObject(object)
    let size = box.getSize(new THREE.Vector3())
    if (upright) {
      // 立起来：最薄一轴转去朝镜头（+Z），镜面保持竖直
      if (size.x <= size.y && size.x <= size.z) object.rotation.y += Math.PI / 2
      else if (size.y <= size.x && size.y <= size.z) object.rotation.x -= Math.PI / 2
    } else {
      // 平躺：最薄的一轴朝上，避免薄片模型在桌上立着。
      if (size.x <= size.y && size.x <= size.z) object.rotation.z += Math.PI / 2
      else if (size.z <= size.x && size.z <= size.y) object.rotation.x += Math.PI / 2
    }
    object.updateMatrixWorld(true)
    box = new THREE.Box3().setFromObject(object)
    size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z)
    if (longest <= 1e-6) return
    object.scale.setScalar(ITEM_MODEL_SIZE / longest)
    const scaled = new THREE.Box3().setFromObject(object)
    const center = scaled.getCenter(new THREE.Vector3())
    object.position.set(-center.x, -scaled.min.y, -center.z)
  }

  private itemMaterialKind(
    item: ItemId,
    objectName: string,
    source: THREE.MeshStandardMaterial,
  ): ItemTone {
    const object = objectName.toLowerCase()
    const color = source.color.getHex()
    if (item === 'magnifier') {
      if (object.includes('lens')) return 'glass'
      if (object.includes('brassring') || object.includes('ferrule')) return 'brass'
      if (object.includes('brassgrip')) return 'wood'
      return 'iron'
    }
    if (item === 'monocle') return source.name.toLowerCase().includes('glass') ? 'glass' : 'brass'
    if (item === 'aegis') {
      return object.includes('redmirror') || source.name.toLowerCase().includes('glass') ? 'glass' : 'brass'
    }
    if (item === 'iou') {
      if (object.includes('closed')) return 'wood'
      if (color === 0x7d1f18) return 'wax'
      return 'paper'
    }
    if (item === 'seal') {
      if (object.includes('waxdisk') || object.includes('redpaper')) return 'wax'
      if (object.includes('wood') || object.includes('knob')) return 'wood'
      if (object.includes('brass') || object.includes('rim') || object.includes('stud')) return 'brass'
      return 'iron'
    }
    if (item === 'hourglass') return source.transparent ? 'glass' : 'brass'
    if (item === 'dagger') {
      if (object.includes('scabbard')) return 'wood'
      if (color === 0x5e1410) return 'wax'
      if (color === 0x7a4a22) return 'brass'
      return 'iron'
    }
    if (item === 'cutter') {
      if (object.includes('scabbard')) return 'wood'
      if (color === 0xb8a888) return 'paper'
      if (color === 0x6a4a2a) return 'wood'
      return 'iron'
    }
    if (item === 'saw') return color === 0x5a2f1a ? 'wood' : 'iron'
    if (item === 'magnet') return color === 0x9e2f24 ? 'wax' : 'iron'
    if (item === 'sedative') return source.transparent || color === 0x3fae78 ? 'glass' : 'iron'
    if (item === 'hammer') {
      if (object.includes('wood') || object.includes('handle')) return 'wood'
      if (object.includes('rag')) return 'wax'
      if (object.includes('brass') || object.includes('collar') || object.includes('pommel')) return 'brass'
      if (color === 0x7d2a22) return 'wax'
      if (color === 0x4a2d18) return 'wood'
      return 'iron'
    }
    return 'iron'
  }

  private applyItemStyle(object: THREE.Object3D, item: ItemId): THREE.MeshStandardMaterial[] {
    const palette = ITEM_PALETTE[item]
    const cache = new Map<ItemTone, THREE.MeshStandardMaterial>()
    const make = (tone: ItemTone): THREE.MeshStandardMaterial => {
      const cached = cache.get(tone)
      if (cached) return cached
      const style = ITEM_TONE_STYLE[tone]
      const color = palette.tones[tone] ?? style.color
      const material = new THREE.MeshStandardMaterial({
        color,
        metalness: style.metalness,
        roughness: style.roughness,
        emissive: color,
        emissiveIntensity: style.emissiveIntensity,
        transparent: style.transparent ?? false,
        opacity: style.opacity ?? 1,
      })
      material.userData.baseColor = color
      material.userData.baseGlow = style.emissiveIntensity
      material.userData.glowColor = palette.glow
      this.disposableMaterials.add(material)
      cache.set(tone, material)
      return material
    }
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
      // 道具会从 0.001 放大到目标尺寸，禁用裁剪避免缩放后的包围体被误判为不可见。
      child.frustumCulled = false
      const originals = Array.isArray(child.material) ? child.material : [child.material]
      // GLB 常把整个网格压成 0 个 group；此时 material 若是数组，Three 按 group 分发会一次都不画。
      // 单材质必须保留单值形式，否则道具在局内完全隐形。
      const mapped = originals.map((source) => {
        if (!(source instanceof THREE.MeshStandardMaterial)) return source
        return make(this.itemMaterialKind(item, child.name, source))
      })
      child.material = mapped.length === 1 ? mapped[0] : mapped
    })
    return [...cache.values()]
  }

  private buildItemGrid(): void {
    const baseGeo = new THREE.BoxGeometry(ITEM_GRID.slotSize, 0.006, ITEM_GRID.slotSize)
    const borderGeo = new THREE.EdgesGeometry(baseGeo)
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1c1714,
      metalness: 0.35,
      roughness: 0.9,
      emissive: 0x050403,
      emissiveIntensity: 0.14,
    })
    const borderMat = new THREE.LineBasicMaterial({ color: 0xb08540, transparent: true, opacity: 0.9 })
    const barMat = new THREE.MeshStandardMaterial({
      color: 0x8c652f,
      metalness: 0.78,
      roughness: 0.4,
      emissive: 0x2a1908,
      emissiveIntensity: 0.25,
    })
    const horizontalGeo = new THREE.BoxGeometry(ITEM_GRID.slotSize, 0.004, 0.006)
    const verticalGeo = new THREE.BoxGeometry(0.006, 0.004, ITEM_GRID.slotSize)
    this.disposableGeometries.add(baseGeo)
    this.disposableGeometries.add(horizontalGeo)
    this.disposableGeometries.add(verticalGeo)
    this.disposableMaterials.add(baseMat)
    this.disposableMaterials.add(borderMat)
    this.disposableMaterials.add(barMat)

    const slots: THREE.Vector3[] = []
    for (const actor of ['player', 'boss'] as const) {
      for (let index = 0; index < 8; index += 1) slots.push(this.itemSlot(actor, index))
      const grid = actor === 'player' ? ITEM_GRID.player : ITEM_GRID.boss
      const gridLight = new THREE.PointLight(0xffc083, actor === 'player' ? 1.3 : 1.1, 2.3, 2)
      gridLight.position.set(
        grid.originX + ((ITEM_GRID.columns - 1) * ITEM_GRID.spacing) / 2,
        TABLE_TOP + 0.72,
        grid.zSign * (grid.originZ + ITEM_GRID.spacing / 2),
      )
      this.itemGrid.add(gridLight)
    }

    const transform = new THREE.Object3D()
    const bases = new THREE.InstancedMesh(baseGeo, baseMat, slots.length)
    const horizontals = new THREE.InstancedMesh(horizontalGeo, barMat, slots.length * 2)
    const verticals = new THREE.InstancedMesh(verticalGeo, barMat, slots.length * 2)
    const edge = ITEM_GRID.slotSize / 2 - 0.003
    const borderPositions: number[] = []
    const sourceBorder = borderGeo.getAttribute('position')
    slots.forEach((slot, index) => {
      transform.position.set(slot.x, slot.y - 0.003, slot.z)
      transform.updateMatrix()
      bases.setMatrixAt(index, transform.matrix)
      for (let side = 0; side < 2; side += 1) {
        transform.position.set(slot.x, slot.y + 0.002, slot.z + (side === 0 ? -edge : edge))
        transform.updateMatrix()
        horizontals.setMatrixAt(index * 2 + side, transform.matrix)
        transform.position.set(slot.x + (side === 0 ? -edge : edge), slot.y + 0.002, slot.z)
        transform.updateMatrix()
        verticals.setMatrixAt(index * 2 + side, transform.matrix)
      }
      for (let i = 0; i < sourceBorder.count; i += 1) {
        borderPositions.push(sourceBorder.getX(i) + slot.x, sourceBorder.getY(i) + slot.y + 0.001, sourceBorder.getZ(i) + slot.z)
      }
    })
    const mergedBorder = new THREE.BufferGeometry()
    mergedBorder.setAttribute('position', new THREE.Float32BufferAttribute(borderPositions, 3))
    this.disposableGeometries.add(mergedBorder)
    this.disposableGeometries.add(borderGeo)
    bases.instanceMatrix.needsUpdate = true
    horizontals.instanceMatrix.needsUpdate = true
    verticals.instanceMatrix.needsUpdate = true
    bases.receiveShadow = true
    this.itemGrid.add(bases, horizontals, verticals, new THREE.LineSegments(mergedBorder, borderMat))
    this.itemRoot.add(this.itemGrid)
  }

  private buildBulletTray(): void {
    const root = new THREE.Group()
    root.name = 'BulletTray'
    root.position.set(BULLET_TRAY.centerX, TABLE_TOP + 0.002, BULLET_TRAY.centerZ)
    root.rotation.y = -0.06

    const width = BULLET_TRAY.columns * BULLET_TRAY.spacing + 0.08
    const depth = BULLET_TRAY.rows * BULLET_TRAY.spacing + 0.08
    const panelGeo = new THREE.BoxGeometry(width, 0.004, depth)
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x030202,
      metalness: 0.2,
      roughness: 0.96,
      emissive: 0x020101,
      emissiveIntensity: 0.25,
    })
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x8c652f,
      metalness: 0.78,
      roughness: 0.4,
      emissive: 0x2a1908,
      emissiveIntensity: 0.25,
    })
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x14100c,
      metalness: 0.52,
      roughness: 0.62,
      emissive: 0x040302,
      emissiveIntensity: 0.2,
    })
    const slotMat = new THREE.MeshStandardMaterial({
      color: 0x020202,
      metalness: 0.35,
      roughness: 0.9,
    })
    const liveMat = new THREE.MeshStandardMaterial({
      color: 0xb52b24,
      metalness: 0.55,
      roughness: 0.32,
      emissive: 0x5a0805,
      emissiveIntensity: 0.45,
    })
    const blankMat = new THREE.MeshStandardMaterial({
      color: 0x2f6f9e,
      metalness: 0.55,
      roughness: 0.32,
      emissive: 0x071f33,
      emissiveIntensity: 0.45,
    })
    for (const material of [panelMat, rimMat, plateMat, slotMat, liveMat, blankMat]) {
      this.disposableMaterials.add(material)
    }
    this.disposableGeometries.add(panelGeo)

    const panel = new THREE.Mesh(panelGeo, panelMat)
    panel.position.y = 0.001
    panel.receiveShadow = true
    root.add(panel)

    const longWallGeo = new THREE.BoxGeometry(width + 0.04, 0.05, 0.02)
    const shortWallGeo = new THREE.BoxGeometry(0.02, 0.05, depth)
    for (const geo of [longWallGeo, shortWallGeo]) this.disposableGeometries.add(geo)
    for (const z of [-depth / 2 - 0.01, depth / 2 + 0.01]) {
      const wall = new THREE.Mesh(longWallGeo, rimMat)
      wall.position.set(0, 0.025, z)
      wall.castShadow = true
      root.add(wall)
    }
    for (const x of [-width / 2 - 0.01, width / 2 + 0.01]) {
      const wall = new THREE.Mesh(shortWallGeo, rimMat)
      wall.position.set(x, 0.025, 0)
      wall.castShadow = true
      root.add(wall)
    }

    const lift = new THREE.Group()
    lift.name = 'BulletTrayLift'
    root.add(lift)
    const plateGeo = new THREE.BoxGeometry(width - 0.04, 0.016, depth - 0.04)
    this.disposableGeometries.add(plateGeo)
    const plate = new THREE.Mesh(plateGeo, plateMat)
    plate.position.y = 0.012
    plate.receiveShadow = true
    lift.add(plate)

    const slotGeo = new THREE.CylinderGeometry(BULLET_TRAY.slotSize / 2, BULLET_TRAY.slotSize / 2, 0.012, 16)
    const ringGeo = new THREE.TorusGeometry(BULLET_TRAY.slotSize * 0.43, 0.008, 6, 16)
    const bodyGeo = new THREE.CylinderGeometry(0.038, 0.042, 0.13, 10)
    const tipGeo = new THREE.SphereGeometry(0.04, 10, 6)
    const baseGeo = new THREE.CylinderGeometry(0.044, 0.044, 0.018, 10)
    for (const geo of [slotGeo, ringGeo, bodyGeo, tipGeo, baseGeo]) this.disposableGeometries.add(geo)

    const bullets: BulletTrayEntry[] = []
    for (let index = 0; index < BULLET_TRAY.columns * BULLET_TRAY.rows; index += 1) {
      const column = index % BULLET_TRAY.columns
      const row = Math.floor(index / BULLET_TRAY.columns)
      const x = (column - (BULLET_TRAY.columns - 1) / 2) * BULLET_TRAY.spacing
      const z = (row - (BULLET_TRAY.rows - 1) / 2) * BULLET_TRAY.spacing

      const slot = new THREE.Mesh(slotGeo, slotMat)
      slot.position.set(x, 0.024, z)
      lift.add(slot)
      const ring = new THREE.Mesh(ringGeo, rimMat)
      ring.rotation.x = Math.PI / 2
      ring.position.set(x, 0.031, z)
      lift.add(ring)

      const group = new THREE.Group()
      group.name = `BulletTrayRound-${index + 1}`
      group.position.set(x, -0.24, z)
      group.visible = false
      const shell = new THREE.Mesh(bodyGeo, liveMat)
      shell.position.y = 0.075
      shell.castShadow = true
      const tip = new THREE.Mesh(tipGeo, liveMat)
      tip.scale.y = 0.65
      tip.position.y = 0.147
      tip.castShadow = true
      const base = new THREE.Mesh(baseGeo, rimMat)
      base.position.y = 0.012
      group.add(shell, tip, base)
      lift.add(group)
      bullets.push({ group, shell, tip })
    }

    const light = new THREE.PointLight(0xffd2a0, 0, 2.2, 2)
    light.position.set(0, 0.38, 0.08)
    root.add(light)
    this.scene.add(root)
    this.bulletTray = { root, lift, bullets, light, liveMaterial: liveMat, blankMaterial: blankMat, generation: 0, active: false }
  }

  /** 左侧两块补给托盘：玩家左前、Boss 左后，镜像摆放 */
  private buildSupplyTray(): void {
    this.supplyTrays = {
      player: this.buildSupplyTrayFor('player'),
      boss: this.buildSupplyTrayFor('boss'),
    }
  }

  private buildSupplyTrayFor(actor: ActorId): SupplyTrayView {
    const centerZ = actor === 'player' ? SUPPLY_TRAY.playerZ : SUPPLY_TRAY.bossZ
    const root = new THREE.Group()
    root.name = actor === 'player' ? 'SupplyTray-Player' : 'SupplyTray-Boss'
    root.position.set(SUPPLY_TRAY.centerX, TABLE_TOP, centerZ)

    // 井底：格子沉下去后露出的暗色底板，让「凹槽」有底
    const panelGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.halfX * 2 - 0.008,
      0.004,
      SUPPLY_TRAY.halfZ * 2 - 0.008,
    )
    this.disposableGeometries.add(panelGeo)
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x050302,
      metalness: 0.18,
      roughness: 0.97,
      emissive: 0x020101,
      emissiveIntensity: 0.3,
    })
    this.disposableMaterials.add(panelMat)
    const panel = new THREE.Mesh(panelGeo, panelMat)
    panel.position.y = 0.002
    panel.receiveShadow = true
    root.add(panel)

    // 固定围边：不随格子升降，给凹陷一个明确的井口
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x14100c,
      metalness: 0.52,
      roughness: 0.62,
      emissive: 0x040302,
      emissiveIntensity: 0.2,
    })
    this.disposableMaterials.add(wallMat)
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x8c652f,
      metalness: 0.78,
      roughness: 0.4,
      emissive: 0x2a1908,
      emissiveIntensity: 0.25,
    })
    this.disposableMaterials.add(capMat)
    const longWallGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.halfX * 2 + SUPPLY_TRAY.rimThickness * 2,
      SUPPLY_TRAY.rimHeight,
      SUPPLY_TRAY.rimThickness,
    )
    const shortWallGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.rimThickness,
      SUPPLY_TRAY.rimHeight,
      SUPPLY_TRAY.halfZ * 2,
    )
    const longCapGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.halfX * 2 + SUPPLY_TRAY.rimThickness * 2,
      0.012,
      SUPPLY_TRAY.rimThickness + 0.008,
    )
    const shortCapGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.rimThickness + 0.008,
      0.012,
      SUPPLY_TRAY.halfZ * 2,
    )
    for (const geo of [longWallGeo, shortWallGeo, longCapGeo, shortCapGeo]) {
      this.disposableGeometries.add(geo)
    }
    const rimHalfX = SUPPLY_TRAY.halfX + SUPPLY_TRAY.rimThickness / 2
    const rimHalfZ = SUPPLY_TRAY.halfZ + SUPPLY_TRAY.rimThickness / 2
    const addRim = (mesh: THREE.Mesh, x: number, z: number, y: number): void => {
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      root.add(mesh)
    }
    for (const z of [-rimHalfZ, rimHalfZ]) {
      addRim(new THREE.Mesh(longWallGeo, wallMat), 0, z, SUPPLY_TRAY.rimHeight / 2)
      addRim(new THREE.Mesh(longCapGeo, capMat), 0, z, SUPPLY_TRAY.rimHeight + 0.004)
    }
    for (const x of [-rimHalfX, rimHalfX]) {
      addRim(new THREE.Mesh(shortWallGeo, wallMat), x, 0, SUPPLY_TRAY.rimHeight / 2)
      addRim(new THREE.Mesh(shortCapGeo, capMat), x, 0, SUPPLY_TRAY.rimHeight + 0.004)
    }

    // 升降组：托盘板 + 四个候选格一起沉浮
    const lift = new THREE.Group()
    lift.name = actor === 'player' ? 'SupplyLift-Player' : 'SupplyLift-Boss'
    const slabGeo = new THREE.BoxGeometry(
      SUPPLY_TRAY.halfX * 2,
      SUPPLY_TRAY.plateThickness,
      SUPPLY_TRAY.halfZ * 2,
    )
    this.disposableGeometries.add(slabGeo)
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x18110c,
      metalness: 0.42,
      roughness: 0.68,
      emissive: 0x050302,
      emissiveIntensity: 0.18,
    })
    this.disposableMaterials.add(slabMat)
    const slab = new THREE.Mesh(slabGeo, slabMat)
    slab.position.y = SUPPLY_TRAY.plateLift
    slab.castShadow = true
    slab.receiveShadow = true
    lift.add(slab)
    const slabEdgeGeo = new THREE.EdgesGeometry(slabGeo)
    this.disposableGeometries.add(slabEdgeGeo)
    const slabEdgeMat = new THREE.LineBasicMaterial({ color: 0xb08540, transparent: true, opacity: 0.75 })
    this.disposableMaterials.add(slabEdgeMat)
    const slabEdge = new THREE.LineSegments(slabEdgeGeo, slabEdgeMat)
    slabEdge.position.y = SUPPLY_TRAY.plateLift
    lift.add(slabEdge)

    const slots = new THREE.Group()
    slots.name = actor === 'player' ? 'SupplySlots-Player' : 'SupplySlots-Boss'
    slots.position.y = SUPPLY_TRAY.plateLift + SUPPLY_TRAY.plateThickness / 2
    slots.visible = false
    const slotBaseGeo = new THREE.BoxGeometry(SUPPLY_TRAY.slotSize, 0.004, SUPPLY_TRAY.slotSize)
    this.disposableGeometries.add(slotBaseGeo)
    const slotBaseMat = new THREE.MeshStandardMaterial({
      color: 0x0d0a08,
      metalness: 0.3,
      roughness: 0.9,
      emissive: 0x030202,
      emissiveIntensity: 0.2,
    })
    this.disposableMaterials.add(slotBaseMat)
    const slotBarMat = new THREE.MeshStandardMaterial({
      color: 0x8c652f,
      metalness: 0.78,
      roughness: 0.4,
      emissive: 0x2a1908,
      emissiveIntensity: 0.25,
    })
    this.disposableMaterials.add(slotBarMat)
    const slotBarHGeo = new THREE.BoxGeometry(SUPPLY_TRAY.slotSize, 0.008, 0.012)
    const slotBarVGeo = new THREE.BoxGeometry(0.012, 0.008, SUPPLY_TRAY.slotSize)
    this.disposableGeometries.add(slotBarHGeo)
    this.disposableGeometries.add(slotBarVGeo)
    for (let index = 0; index < 4; index += 1) {
      const slot = new THREE.Group()
      slot.name = `SupplySlot-${actor}-${index + 1}`
      const base = new THREE.Mesh(slotBaseGeo, slotBaseMat)
      base.position.y = 0.002
      base.receiveShadow = true
      slot.add(base)
      const edge = SUPPLY_TRAY.slotSize / 2 - 0.006
      for (const z of [-edge, edge]) {
        const bar = new THREE.Mesh(slotBarHGeo, slotBarMat)
        bar.position.set(0, 0.006, z)
        slot.add(bar)
      }
      for (const x of [-edge, edge]) {
        const bar = new THREE.Mesh(slotBarVGeo, slotBarMat)
        bar.position.set(x, 0.006, 0)
        slot.add(bar)
      }
      slots.add(slot)
    }
    lift.add(slots)
    root.add(lift)
    this.itemRoot.add(root)

    // 运行期不增删灯光：两块托盘各一盏补光，初始化建好，只在补给期间调亮度
    const light = new THREE.PointLight(0xffc083, 0, 2.6, 2)
    light.position.set(SUPPLY_TRAY.centerX, TABLE_TOP + 0.78, centerZ)
    this.itemRoot.add(light)

    return {
      actor,
      lift,
      slots,
      light,
      items: new Map(),
      state: 'closed',
      order: [],
      picked: null,
      pendingPick: null,
      generation: 0,
    }
  }

  /** 由快照驱动：玩家托盘跟 supply，Boss 托盘跟 supply / bossSupply */
  private syncSupply(snapshot: GameSnapshot): void {
    const trays = this.supplyTrays
    if (!trays) return
    const playerOptions = snapshot.phase === 'supply' ? snapshot.supplyOptions : []
    const bossOptions =
      snapshot.phase === 'supply' || snapshot.phase === 'bossSupply'
        ? snapshot.bossSupplyOptions
        : []
    this.syncSupplyTray(trays.player, playerOptions, null)
    this.syncSupplyTray(
      trays.boss,
      bossOptions,
      snapshot.phase === 'bossSupply' ? snapshot.bossSupplyPick : null,
    )
  }

  private syncSupplyTray(
    tray: SupplyTrayView,
    options: readonly ItemId[],
    pick: ItemId | null,
  ): void {
    if (!this.supplyRevealAllowed) {
      this.closeSupplyTray(tray)
      return
    }
    if (options.length === 0) {
      this.closeSupplyTray(tray)
      return
    }
    if (pick) {
      if (tray.picked === pick && (tray.state === 'picking' || tray.state === 'picked')) return
      if (tray.state === 'opening') {
        // 玩家可能秒选：等这盘升完，再走 Boss 的挑选动画
        tray.pendingPick = pick
        return
      }
      this.startBossPick(tray, pick)
      return
    }
    if (tray.state === 'open') {
      const same =
        options.length === tray.order.length &&
        options.every((item, index) => item === tray.order[index])
      if (same) return
    }
    if (tray.state === 'opening' || tray.state === 'picking' || tray.state === 'picked') return
    this.openSupplyTray(tray, options)
  }

  /** 开：空盘先沉下去露出井口，道具放进井底，再整组载着道具升回桌面 */
  private openSupplyTray(tray: SupplyTrayView, options: readonly ItemId[]): void {
    tray.generation += 1
    const generation = tray.generation
    tray.state = 'opening'
    tray.order = [...options]
    tray.picked = null
    tray.pendingPick = null
    this.clearTrayItems(tray)
    tray.slots.visible = true
    this.layoutSupplySlots(tray, options.length)
    const down = -SUPPLY_TRAY.travel
    const from = tray.lift.position.y
    this.tween({
      duration: 0.42,
      // 等补给机位基本到位再沉：否则「凹陷」全发生在镜头切换里
      delay: 0.85,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        tray.lift.position.y = from + (down - from) * easeInOutCubic(t)
      },
      onComplete: () => {
        if (generation !== tray.generation) return
        // 道具在桌面以下放好；升起来时才真正进入视野，不再原地缩放出现
        options.forEach((item, index) => this.spawnSupplyItem(tray, item, index, options.length))
        if (tray.pendingPick) {
          this.startBossPick(tray, tray.pendingPick)
          return
        }
        this.tween({
          duration: 0.64,
          delay: 0.1,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.lift.position.y = down + (0 - down) * easeOutCubic(t)
          },
          onComplete: () => {
            if (generation !== tray.generation) return
            tray.state = 'open'
          },
        })
      },
    })
    const light = tray.light
    const fromLight = light.intensity
    this.tween({
      duration: 0.6,
      delay: 1.15,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        const target = tray.actor === 'player' ? 1.35 : 1.05
        light.intensity = fromLight + (target - fromLight) * easeOutCubic(t)
      },
    })
  }

  /** Boss 选定：整盘载着候选沉下去，只带着它挑的一件升回来 */
  private startBossPick(tray: SupplyTrayView, pick: ItemId): void {
    tray.generation += 1
    const generation = tray.generation
    tray.state = 'picking'
    tray.picked = pick
    tray.pendingPick = null
    const down = -SUPPLY_TRAY.travel
    const from = tray.lift.position.y
    this.tween({
      duration: 0.42,
      delay: 0.9,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        tray.lift.position.y = from + (down - from) * easeInOutCubic(t)
      },
      onComplete: () => {
        if (generation !== tray.generation) return
        this.pruneTrayItems(tray, pick)
        this.tween({
          duration: 0.64,
          delay: 0.12,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.lift.position.y = down + (0 - down) * easeOutCubic(t)
          },
          onComplete: () => {
            if (generation !== tray.generation) return
            tray.state = 'picked'
          },
        })
      },
    })
  }

  /** 关：载着剩下的道具先沉进桌面，再空盘升回合拢位 */
  private closeSupplyTray(tray: SupplyTrayView): void {
    if (tray.state === 'closed' || tray.state === 'closing') return
    tray.generation += 1
    const generation = tray.generation
    tray.state = 'closing'
    tray.picked = null
    tray.pendingPick = null
    if (tray.actor === 'player') this.setSupplyHovered(null)
    const light = tray.light
    const fromLight = light.intensity
    this.tween({
      duration: 0.4,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        light.intensity = fromLight - fromLight * easeOutCubic(t)
      },
    })
    const down = -SUPPLY_TRAY.travel
    const from = tray.lift.position.y
    this.tween({
      duration: 0.44,
      delay: 0.08,
      onUpdate: (t) => {
        if (generation !== tray.generation) return
        tray.lift.position.y = from + (down - from) * easeInOutCubic(t)
      },
      onComplete: () => {
        if (generation !== tray.generation) return
        // 道具已经沉到桌面以下才撤掉：不会在台面上凭空消失
        this.clearTrayItems(tray)
        tray.slots.visible = false
        this.tween({
          duration: 0.52,
          delay: 0.06,
          onUpdate: (t) => {
            if (generation !== tray.generation) return
            tray.lift.position.y = down + (0 - down) * easeOutCubic(t)
          },
          onComplete: () => {
            if (generation !== tray.generation) return
            tray.state = 'closed'
            tray.order = []
          },
        })
      },
    })
  }

  /** 候选格按件数居中：两件一排，三件上二下一 */
  private supplySlot(index: number, count: number): THREE.Vector3 {
    const rows = Math.ceil(count / 2)
    const row = Math.floor(index / 2)
    const column = index % 2
    const inRow = Math.min(2, count - row * 2)
    const columnOffset = inRow === 1 ? 0 : (column === 0 ? -0.5 : 0.5) * SUPPLY_TRAY.spacing
    const rowOffset = (row - (rows - 1) / 2) * SUPPLY_TRAY.spacing
    return new THREE.Vector3(
      columnOffset,
      SUPPLY_TRAY.plateLift + SUPPLY_TRAY.plateThickness / 2 + 0.006,
      rowOffset,
    )
  }

  private layoutSupplySlots(tray: SupplyTrayView, count: number): void {
    tray.slots.children.forEach((slot, index) => {
      slot.visible = index < count
      if (index >= count) return
      const position = this.supplySlot(index, count)
      slot.position.set(position.x, 0, position.z)
    })
  }

  private spawnSupplyItem(tray: SupplyTrayView, item: ItemId, index: number, count: number): ItemEntry {
    const group = new THREE.Group()
    const { content, materials } = this.buildItemContent(item)
    group.add(content)
    this.applyItemPose(group, item, tray.actor)
    const slot = this.supplySlot(index, count)
    const key = `${tray.actor}-supply-${item}`
    group.position.copy(slot)
    group.scale.setScalar(ITEM_SCALE)
    group.userData.item = item
    group.userData.actor = tray.actor
    group.userData.key = key
    // 挂进升降组：和格子一起沉浮，不再原地缩放出现
    tray.lift.add(group)
    this.attachItemPickProxy(group, content)
    const entry: ItemEntry = {
      group,
      actor: tray.actor,
      item,
      key,
      hovered: false,
      hoverScale: 1,
      spawnScale: 1,
      spawnTarget: 1,
      baseY: slot.y,
      materials,
    }
    tray.items.set(key, entry)
    if (tray.actor === 'player') this.supplyItems.set(key, entry)
    else this.bossSupplyItems.set(key, entry)
    return entry
  }

  private pruneTrayItems(tray: SupplyTrayView, keep: ItemId): void {
    for (const [key, entry] of [...tray.items]) {
      if (entry.item === keep) continue
      tray.lift.remove(entry.group)
      this.disposeObject(entry.group)
      tray.items.delete(key)
      if (tray.actor === 'player') this.supplyItems.delete(key)
      else this.bossSupplyItems.delete(key)
    }
    // 只剩挑中的一件：挪到正中，收起其余空格，升回来时一眼就能看清它拿了什么
    const kept = [...tray.items.values()][0]
    if (kept) {
      const slot = this.supplySlot(0, 1)
      kept.group.position.copy(slot)
      kept.baseY = slot.y
    }
    this.layoutSupplySlots(tray, 1)
  }

  private clearTrayItems(tray: SupplyTrayView): void {
    if (tray.actor === 'player') this.setSupplyHovered(null)
    for (const [key, entry] of tray.items) {
      tray.lift.remove(entry.group)
      this.disposeObject(entry.group)
      if (tray.actor === 'player') this.supplyItems.delete(key)
      else this.bossSupplyItems.delete(key)
    }
    tray.items.clear()
  }

  /** 玩家栏在右前，敌方栏关于横向中线镜像到右后 */
  private itemSlot(actor: ActorId, index: number): THREE.Vector3 {
    const column = index % ITEM_GRID.columns
    const row = Math.floor(index / ITEM_GRID.columns)
    const grid = actor === 'player' ? ITEM_GRID.player : ITEM_GRID.boss
    return new THREE.Vector3(
      grid.originX + column * ITEM_GRID.spacing,
      TABLE_TOP + 0.02,
      grid.zSign * (grid.originZ + row * ITEM_GRID.spacing),
    )
  }

  /** 道具内容与摆放姿态分离：归一化只作用在 content 上，外层 group 只负责槽位与朝向 */
  private buildItemContent(
    item: ItemId,
    source?: THREE.Object3D,
  ): { content: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
    const upright = item === 'aegis'
    const content = new THREE.Group()
    const template = source ?? this.itemModelTemplates.get(item)
    if (template) {
      const clone = template.clone(true)
      clone.userData.isModelClone = true
      clone.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.userData.sharedGeometry = true
      })
      this.normalizeItemModel(clone, upright)
      content.add(clone)
    } else {
      this.buildItemMesh(item, content, [])
      this.normalizeItemModel(content, upright)
    }
    const materials = this.applyItemStyle(content, item)
    return { content, materials }
  }

  private applyItemPose(group: THREE.Group, item: ItemId, actor: ActorId): void {
    // 放大镜/锤子/手锯平躺，重点端朝向左上（视线远-左），尾端收向右下；护心镜立起朝镜头
    // 手锯（GLB 与程序化几何）刀刃朝向本地 -Z，需与放大镜相反的摆角才能让刃尖朝左上
    // 人机与玩家对坐：所有道具多转 180°（含护心镜），让两边各自看自己的桌面时布局一致
    let yaw = 0
    if (item === 'magnifier' || item === 'hammer') yaw = -Math.PI * 0.75
    else if (item === 'saw') yaw = Math.PI * 0.25
    if (actor !== 'player') yaw += Math.PI
    group.rotation.set(0, yaw, 0)
  }

  private spawnItem(actor: ActorId, item: ItemId, index: number, key: string): ItemEntry {
    const group = new THREE.Group()
    const { content, materials } = this.buildItemContent(item)
    group.add(content)
    this.applyItemPose(group, item, actor)
    const slot = this.itemSlot(actor, index)
    group.position.copy(slot)
    group.position.y += 0.5
    group.scale.setScalar(0.001)
    group.userData.actor = actor
    group.userData.item = item
    group.userData.key = key
    this.itemRoot.add(group)
    this.attachItemPickProxy(group, content)
    const entry: ItemEntry = {
      group,
      actor,
      item,
      key,
      hovered: false,
      hoverScale: 1,
      spawnScale: 0.001,
      spawnTarget: 1,
      baseY: slot.y,
      materials,
    }
    this.tween({
      duration: 0.34,
      onUpdate: (t) => {
        const eased = easeOutCubic(t)
        entry.spawnScale = entry.spawnTarget * (0.001 + eased * 0.999)
        group.position.y = slot.y + (1 - eased) * 0.5
      },
    })
    return entry
  }

  /**
   * 拾取用整体包围盒：手锯、镜圈这类带镂空的模型逐网格射线很难点中，
   * 用一个不可见的盒子把整件道具包起来参与拾取，随道具一起缩放/浮动。
   */
  private attachItemPickProxy(group: THREE.Group, content: THREE.Object3D): void {
    // 逐网格把包围盒换算进 group 本地：直接对世界盒乘逆矩阵会把 45° 摆角重新胀成对角线
    group.updateWorldMatrix(true, true)
    const inv = group.matrixWorld.clone().invert()
    const box = new THREE.Box3()
    const local = new THREE.Matrix4()
    const part = new THREE.Box3()
    content.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.geometry.computeBoundingBox()
      const bounds = child.geometry.boundingBox
      if (!bounds) return
      local.multiplyMatrices(inv, child.matrixWorld)
      box.union(part.copy(bounds).applyMatrix4(local))
    })
    // 略微外扩，轮廓边缘也算命中；仍小于 0.54 的格子，不会串到邻格
    box.expandByVector(new THREE.Vector3(0.01, 0.01, 0.01))
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(
        Math.max(size.x, 0.12),
        Math.max(size.y, 0.06),
        Math.max(size.z, 0.12),
      ),
      new THREE.MeshBasicMaterial({ visible: false }),
    )
    proxy.name = 'ItemPickProxy'
    proxy.position.copy(center)
    group.add(proxy)
  }

  private buildItemMesh(item: ItemId, group: THREE.Group, materials: THREE.MeshStandardMaterial[]): void {
    const add = <G extends THREE.BufferGeometry>(
      geometry: G,
      material: THREE.MeshStandardMaterial,
      configure: (mesh: THREE.Mesh<G, THREE.MeshStandardMaterial>) => void,
    ): THREE.Mesh<G, THREE.MeshStandardMaterial> => {
      this.disposableGeometries.add(geometry)
      this.disposableMaterials.add(material)
      materials.push(material)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.receiveShadow = true
      configure(mesh)
      group.add(mesh)
      return mesh
    }

    switch (item) {
      case 'magnifier': {
        const rimMat = makeStandardMaterial(0x2f6d78, 0.85, 0.3)
        const handleMat = makeStandardMaterial(0x6a3d20, 0.25, 0.65)
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x365f6b,
          metalness: 0.55,
          roughness: 0.12,
          transparent: true,
          opacity: 0.55,
          emissive: 0x0b2229,
          emissiveIntensity: 0.5,
        })
        this.disposableMaterials.add(glassMat)
        // 放大镜平躺：镜面朝上，手柄沿 -Z 伸出（与外层 -135° 摆角配合，镜片朝左上）
        add(new THREE.TorusGeometry(0.13, 0.018, 10, 24), rimMat, (mesh) => {
          mesh.position.set(0, 0.03, 0)
          mesh.rotation.x = -Math.PI / 2
        })
        add(new THREE.CylinderGeometry(0.017, 0.019, 0.2, 10), handleMat, (mesh) => {
          mesh.position.set(0, 0.019, -0.23)
          mesh.rotation.x = Math.PI / 2
        })
        const lensGeo = new THREE.CircleGeometry(0.115, 24)
        this.disposableGeometries.add(lensGeo)
        this.disposableMaterials.add(glassMat)
        const lens = new THREE.Mesh(lensGeo, glassMat)
        lens.position.set(0, 0.033, 0)
        lens.rotation.x = -Math.PI / 2
        group.add(lens)
        break
      }
      case 'sedative': {
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x86c9a8,
          metalness: 0.1,
          roughness: 0.12,
          transparent: true,
          opacity: 0.72,
          emissive: 0x2f7d55,
          emissiveIntensity: 0.3,
        })
        const liquidMat = makeStandardMaterial(0x3fae78, 0.2, 0.35)
        liquidMat.emissive = new THREE.Color(0x1e6b47)
        liquidMat.emissiveIntensity = 0.4
        const metalMat = makeStandardMaterial(0x9aa2a6, 0.9, 0.28)
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.17, 14), glassMat, (mesh) => {
          mesh.name = 'GlassTube'
          mesh.position.z = -0.0064
          mesh.rotation.x = Math.PI / 2
        })
        add(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 12), liquidMat, (mesh) => {
          mesh.name = 'SerumFluid'
          mesh.position.z = -0.02
          mesh.rotation.x = Math.PI / 2
        })
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8), metalMat, (mesh) => {
          mesh.name = 'Needle'
          mesh.position.z = -0.15
          mesh.rotation.x = Math.PI / 2
        })
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 12), metalMat, (mesh) => {
          mesh.name = 'PlungerStop'
          mesh.position.z = 0.043
          mesh.rotation.x = Math.PI / 2
        })
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 10), metalMat, (mesh) => {
          mesh.name = 'Plunger'
          mesh.position.z = 0.077
          mesh.rotation.x = Math.PI / 2
        })
        break
      }
      case 'saw': {
        // 与 item_saw.glb 同轴：刃尖朝本地 -Z，锯柄收在 +Z，替换模型时朝向不翻转
        const bladeMat = makeStandardMaterial(0x9aa2a6, 0.95, 0.28)
        const gripMat = makeStandardMaterial(0x5a2f1a, 0.15, 0.7)
        add(new THREE.BoxGeometry(0.13, 0.018, 0.46), bladeMat, (mesh) => {
          mesh.position.set(0, 0.03, -0.05)
        })
        const toothGeo = new THREE.ConeGeometry(0.018, 0.045, 4)
        this.disposableGeometries.add(toothGeo)
        this.disposableMaterials.add(bladeMat)
        for (let i = 0; i < 9; i += 1) {
          const tooth = new THREE.Mesh(toothGeo, bladeMat)
          tooth.position.set(0.075, 0.03, 0.15 - i * 0.05)
          tooth.rotation.z = -Math.PI / 2
          group.add(tooth)
        }
        add(new THREE.BoxGeometry(0.06, 0.05, 0.16), gripMat, (mesh) => {
          mesh.position.set(0, 0.035, 0.32)
          mesh.rotation.y = -0.1
        })
        add(new THREE.TorusGeometry(0.04, 0.012, 8, 14), gripMat, (mesh) => {
          mesh.position.set(0, 0.04, 0.42)
        })
        break
      }
      case 'magnet': {
        const bodyMat = makeStandardMaterial(0x9e2f24, 0.45, 0.55)
        const tipMat = makeStandardMaterial(0x9fa9b2, 0.95, 0.25)
        const parts = [
          add(new THREE.TorusGeometry(0.12, 0.03, 12, 24, Math.PI), bodyMat, (mesh) => {
            mesh.position.y = 0.12
            mesh.rotation.z = Math.PI
          }),
          add(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12), tipMat, (mesh) => {
            mesh.position.set(-0.12, 0.075, 0)
          }),
          add(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12), tipMat, (mesh) => {
            mesh.position.set(0.12, 0.075, 0)
          }),
        ]
        const magnet = new THREE.Group()
        magnet.name = 'MagnetFallback'
        magnet.rotation.x = Math.PI / 2
        for (const part of parts) {
          group.remove(part)
          magnet.add(part)
        }
        group.add(magnet)
        break
      }
      case 'handcuffs': {
        const steelMat = makeStandardMaterial(0x7d8489, 0.9, 0.3)
        const linkMat = makeStandardMaterial(0x5d6367, 0.95, 0.35)
        for (const x of [-0.09, 0.09]) {
          add(new THREE.TorusGeometry(0.075, 0.016, 10, 22), steelMat, (mesh) => {
            mesh.name = x > 0 ? 'CuffB' : 'CuffA'
            mesh.position.set(x, 0.075, 0)
            mesh.rotation.x = Math.PI / 2
          })
        }
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), linkMat, (mesh) => {
          mesh.position.set(0, 0.075, 0)
          mesh.rotation.z = Math.PI / 2
        })
        add(new THREE.TorusGeometry(0.028, 0.009, 6, 12), linkMat, (mesh) => {
          mesh.position.set(0, 0.075, 0.02)
          mesh.rotation.y = Math.PI / 2
        })
        break
      }
      case 'hourglass': {
        const frameMat = makeStandardMaterial(0x8a6a34, 0.85, 0.32)
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0xe0b878,
          metalness: 0.05,
          roughness: 0.08,
          transparent: true,
          opacity: 0.5,
          emissive: 0x7a4d16,
          emissiveIntensity: 0.35,
        })
        this.disposableMaterials.add(glassMat)
        add(new THREE.CylinderGeometry(0.085, 0.085, 0.022, 14), frameMat, (mesh) => {
          mesh.position.y = 0.02
        })
        add(new THREE.CylinderGeometry(0.085, 0.085, 0.022, 14), frameMat, (mesh) => {
          mesh.position.y = 0.24
        })
        add(new THREE.ConeGeometry(0.08, 0.1, 14), glassMat, (mesh) => {
          mesh.position.y = 0.14
          mesh.rotation.x = Math.PI
        })
        add(new THREE.ConeGeometry(0.08, 0.1, 14), glassMat, (mesh) => {
          mesh.position.y = 0.12
        })
        for (const x of [-0.085, 0.085]) {
          add(new THREE.CylinderGeometry(0.009, 0.009, 0.23, 8), frameMat, (mesh) => {
            mesh.position.set(x, 0.13, 0)
          })
        }
        const sandMat = makeStandardMaterial(0xd8b46a, 0, 1)
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), sandMat, (mesh) => {
          mesh.name = 'SandStream'
          mesh.position.set(0, 0.13, 0)
        })
        break
      }
      case 'dagger': {
        const bladeMat = makeStandardMaterial(0xb8c2c6, 0.98, 0.22)
        const guardMat = makeStandardMaterial(0x7a4a22, 0.9, 0.35)
        const bloodMat = makeStandardMaterial(0x5e1410, 0.35, 0.55)
        add(new THREE.ConeGeometry(0.04, 0.3, 4), bladeMat, (mesh) => {
          mesh.name = 'Blade'
          mesh.position.set(0, 0, -0.12)
          mesh.rotation.x = -Math.PI / 2
          mesh.scale.x = 0.4
        })
        add(new THREE.BoxGeometry(0.19, 0.024, 0.045), guardMat, (mesh) => {
          mesh.position.set(0, 0, 0.02)
        })
        add(new THREE.CylinderGeometry(0.021, 0.024, 0.11, 10), guardMat, (mesh) => {
          mesh.name = 'Handle'
          mesh.position.set(0, 0, 0.08)
          mesh.rotation.x = Math.PI / 2
        })
        add(new THREE.SphereGeometry(0.03, 10, 8), guardMat, (mesh) => {
          mesh.position.set(0, 0, 0.145)
        })
        add(new THREE.BoxGeometry(0.012, 0.012, 0.06), bloodMat, (mesh) => {
          mesh.position.set(0.02, 0, -0.08)
          mesh.rotation.z = 0.2
        })
        break
      }
      case 'aegis': {
        // 护心镜：倾斜立起的铜镜，边缘一圈刻纹
        const bronzeMat = makeStandardMaterial(0x8a6a3a, 0.9, 0.32)
        const faceMat = new THREE.MeshStandardMaterial({
          color: 0xb9a06a,
          metalness: 0.85,
          roughness: 0.18,
          emissive: 0x2a1f0c,
          emissiveIntensity: 0.3,
        })
        this.disposableMaterials.add(faceMat)
        add(new THREE.CylinderGeometry(0.15, 0.15, 0.022, 24), bronzeMat, (mesh) => {
          mesh.position.y = 0.16
          mesh.rotation.x = Math.PI / 2 - 0.35
        })
        add(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 24), faceMat, (mesh) => {
          mesh.position.set(0, 0.163, 0.012)
          mesh.rotation.x = Math.PI / 2 - 0.35
        })
        add(new THREE.TorusGeometry(0.15, 0.014, 8, 24), bronzeMat, (mesh) => {
          mesh.position.y = 0.16
          mesh.rotation.x = -0.35
        })
        add(new THREE.BoxGeometry(0.05, 0.1, 0.03), bronzeMat, (mesh) => {
          mesh.position.set(0, 0.03, -0.045)
        })
        break
      }
      case 'cutter': {
        // 裁纸刀：黄铜小刀压在一张半卷的旧账页上
        const bladeMat = makeStandardMaterial(0x9aa3a8, 0.92, 0.3)
        const gripMat = makeStandardMaterial(0x6a4a2a, 0.08, 0.8)
        const paperMat = makeStandardMaterial(0xb8a888, 0.02, 0.92)
        add(new THREE.BoxGeometry(0.24, 0.012, 0.045), paperMat, (mesh) => {
          mesh.position.y = 0.006
          mesh.rotation.y = 0.35
        })
        add(new THREE.BoxGeometry(0.17, 0.008, 0.03), bladeMat, (mesh) => {
          mesh.position.set(0.02, 0.03, 0)
          mesh.rotation.y = 0.15
        })
        add(new THREE.CylinderGeometry(0.016, 0.014, 0.09, 8), gripMat, (mesh) => {
          mesh.position.set(-0.1, 0.03, -0.01)
          mesh.rotation.z = Math.PI / 2 + 0.15
        })
        break
      }
      case 'iou': {
        // 借据：一张压在铜印下的欠条，边角卷起
        const paperMat = makeStandardMaterial(0xc2b290, 0.01, 0.9)
        const inkMat = makeStandardMaterial(0x2a1a12, 0.0, 0.95)
        const sealMat = makeStandardMaterial(0x7d1f18, 0.25, 0.6)
        add(new THREE.BoxGeometry(0.2, 0.008, 0.26), paperMat, (mesh) => {
          mesh.position.y = 0.004
          mesh.rotation.y = -0.12
        })
        add(new THREE.BoxGeometry(0.02, 0.004, 0.2), inkMat, (mesh) => {
          mesh.position.set(0.055, 0.011, 0)
          mesh.rotation.y = -0.12
        })
        add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), sealMat, (mesh) => {
          mesh.position.set(-0.045, 0.02, 0.06)
        })
        break
      }
      case 'seal': {
        // 封条：一条朱砂封纸压着两枚木签
        const stripMat = makeStandardMaterial(0xb02a1e, 0.02, 0.85)
        const pegMat = makeStandardMaterial(0x8a7350, 0.05, 0.8)
        add(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 8), pegMat, (mesh) => {
          mesh.position.set(-0.05, 0.1, 0)
          mesh.rotation.z = 0.06
        })
        add(new THREE.CylinderGeometry(0.012, 0.014, 0.2, 8), pegMat, (mesh) => {
          mesh.position.set(0.05, 0.1, 0)
          mesh.rotation.z = -0.06
        })
        add(new THREE.BoxGeometry(0.16, 0.006, 0.05), stripMat, (mesh) => {
          mesh.position.set(0, 0.14, 0)
          mesh.rotation.z = 0.05
        })
        break
      }
      case 'monocle': {
        // 单片眼镜：黄铜镜圈 + 镜腿链，斜靠在桌面上
        const rimMat = makeStandardMaterial(0x8a6a3a, 0.92, 0.3)
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0xcfd8d4,
          metalness: 0.1,
          roughness: 0.08,
          transparent: true,
          opacity: 0.45,
        })
        this.disposableMaterials.add(glassMat)
        add(new THREE.TorusGeometry(0.085, 0.01, 8, 24), rimMat, (mesh) => {
          mesh.position.y = 0.095
          mesh.rotation.x = -0.5
        })
        add(new THREE.CircleGeometry(0.078, 24), glassMat, (mesh) => {
          mesh.position.y = 0.096
          mesh.rotation.x = -0.5
        })
        add(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 6), rimMat, (mesh) => {
          mesh.position.set(0.11, 0.03, 0.06)
          mesh.rotation.set(0.4, 0, -0.9)
        })
        break
      }
      case 'hammer': {
        // 重锤：短柄方头锤，锤头缠着脏布条
        const headMat = makeStandardMaterial(0x5a5f63, 0.95, 0.34)
        const haftMat = makeStandardMaterial(0x4a2d18, 0.1, 0.8)
        const ragMat = makeStandardMaterial(0x7d2a22, 0.05, 0.9)
        add(new THREE.BoxGeometry(0.2, 0.09, 0.09), headMat, (mesh) => {
          mesh.position.set(0, 0.19, 0)
          mesh.rotation.z = 0.08
        })
        add(new THREE.CylinderGeometry(0.017, 0.021, 0.26, 10), haftMat, (mesh) => {
          mesh.position.y = 0.06
          mesh.rotation.z = 0.08
        })
        add(new THREE.CylinderGeometry(0.024, 0.024, 0.05, 10), ragMat, (mesh) => {
          mesh.position.y = 0.155
          mesh.rotation.z = 0.08
        })
        add(new THREE.TorusGeometry(0.026, 0.007, 6, 12), haftMat, (mesh) => {
          mesh.position.set(0, -0.06, 0)
          mesh.rotation.x = Math.PI / 2
        })
        break
      }
      default: {
        const fallback = makeStandardMaterial(0x8a8a8a, 0.5, 0.5)
        add(new THREE.BoxGeometry(0.12, 0.12, 0.12), fallback, (mesh) => {
          mesh.position.y = 0.06
        })
      }
    }
  }

  /** 选枪口：点过枪之后只有双方血袋架可点（整个架子连空隙都算），Boss 本体不再参与 */
  private pickShotTargetNode(event: PointerEvent): { target: ActorId; node: THREE.Object3D } | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    let nearest: { target: ActorId; node: THREE.Object3D; distance: number } | null = null
    for (const actor of ['player', 'boss'] as const) {
      const box = this.shotTargetBoxes.get(actor)
      const rack = this.bloodRacks.get(actor)
      if (!box || !rack) continue
      const hit = this.raycaster.ray.intersectBox(box, this.pickHit)
      if (!hit) continue
      const distance = hit.distanceTo(this.raycaster.ray.origin)
      if (!nearest || distance < nearest.distance) {
        nearest = { target: actor, node: rack.group, distance }
      }
    }
    return nearest ? { target: nearest.target, node: nearest.node } : null
  }

  private refreshShotTargetBoxes(): void {
    this.shotTargetBoxes.clear()
    for (const actor of ['player', 'boss'] as const) {
      const rack = this.bloodRacks.get(actor)
      if (!rack) continue
      const box = new THREE.Box3().setFromObject(rack.group)
      box.expandByScalar(0.08)
      this.shotTargetBoxes.set(actor, box)
    }
  }

  private pickShotTarget(event: PointerEvent): ActorId | null {
    return this.pickShotTargetNode(event)?.target ?? null
  }

  /** 枪身悬停/点击判定：直接打枪模型，斜放姿态下比外扩包围盒准 */
  private isPointerOnGun(event: PointerEvent): boolean {
    const holder =
      this.gunShake.getObjectByName('ShotgunGLB') ?? this.gunShake.getObjectByName('GunPlaceholder')
    if (!holder) return false
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.intersectObject(holder, true).length > 0
  }

  private setGunHover(over: boolean, x = 0, y = 0): void {
    if (this.gunHovered === over) {
      if (over) this.callbacks.onGunHover?.({ x, y })
      return
    }
    this.gunHovered = over
    this.callbacks.onGunHover?.(over ? { x, y } : null)
  }

  /** 点枪：进入选枪口状态，两侧架子闪一次，枪身轻抬一下作为回应 */
  private armTargetPick(): void {
    if (!this.targetPickActive || this.targetArmed) return
    this.targetArmed = true
    this.targetArmedAt = this.elapsed
    this.targetArmedHover = null
    this.setGunHover(false)
    this.canvas.style.cursor = ''
    this.captureArmedRacks()
    this.liftGunForTargeting()
  }

  /** 退出选枪口/重新进入前清干净：架子颜色还原、枪身浮窗收起 */
  private disarmTargetPick(): void {
    this.targetArmed = false
    this.targetArmedHover = null
    this.restoreArmedRacks()
    this.setGunHover(false)
  }

  /** 记录双方架子的原发光并统一换成目标色，亮度每帧由 updateArmedRacks 写入 */
  private captureArmedRacks(): void {
    this.restoreArmedRacks()
    for (const actor of ['player', 'boss'] as const) {
      const rack = this.bloodRacks.get(actor)
      if (!rack) continue
      // 血袋是深红，深红自发光几乎看不出来：敌方用亮橙红，自己用冷白
      const tint = new THREE.Color(actor === 'boss' ? 0xff5a33 : 0xbfe0f0)
      const seen = new Set<THREE.Material>()
      rack.group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          if (!(material instanceof THREE.MeshStandardMaterial) || seen.has(material)) continue
          seen.add(material)
          this.targetArmedMaterials.push({
            material,
            emissive: material.emissive.clone(),
            intensity: material.emissiveIntensity,
            actor,
          })
          material.emissive.copy(tint)
        }
      })
    }
  }

  private restoreArmedRacks(): void {
    for (const entry of this.targetArmedMaterials) {
      entry.material.emissive.copy(entry.emissive)
      entry.material.emissiveIntensity = entry.intensity
    }
    this.targetArmedMaterials = []
  }

  /** 进入时闪一次，之后留一层微光；悬停的那一侧再提亮 */
  private updateArmedRacks(): void {
    if (!this.targetArmed || this.targetArmedMaterials.length === 0) return
    const flash = clamp01(1 - (this.elapsed - this.targetArmedAt) / 0.8)
    const flashBoost = flash * flash * 0.45
    for (const entry of this.targetArmedMaterials) {
      const base = entry.actor === 'boss' ? 0.1 : 0.08
      const hover =
        this.targetArmedHover === entry.actor ? (entry.actor === 'boss' ? 0.3 : 0.24) - base : 0
      entry.material.emissiveIntensity = base + hover + flashBoost
    }
  }

  /** 点枪回应的轻抬：落回原位后不改变 holster 高度 */
  private liftGunForTargeting(): void {
    if (this.gunMotionActive) return
    const baseY = this.gunAim.position.y
    const generation = this.gunRaiseGeneration
    this.tween({
      duration: this.reducedMotion ? 0.18 : 0.55,
      onUpdate: (t) => {
        if (generation !== this.gunRaiseGeneration) return
        this.gunAim.position.y = baseY + Math.sin(Math.PI * t) * 0.05
      },
      onComplete: () => {
        if (generation !== this.gunRaiseGeneration) return
        this.gunAim.position.y = baseY
      },
    })
  }

  private handlePointerMove(event: PointerEvent): void {
    if (this.disposed) return
    if (this.targetPickActive) {
      if (this.targetArmed) {
        this.actionHovered = null
        this.setHovered(null)
        this.setSupplyHovered(null)
        const hit = this.pickShotTargetNode(event)
        this.targetArmedHover = hit?.target ?? null
        this.canvas.style.cursor = hit ? 'pointer' : ''
        return
      }
      if (this.isPointerOnGun(event)) {
        const rect = this.canvas.getBoundingClientRect()
        this.actionHovered = null
        this.setHovered(null)
        this.setSupplyHovered(null)
        this.setGunHover(true, event.clientX - rect.left, event.clientY - rect.top)
        this.canvas.style.cursor = 'pointer'
        return
      }
      // 点枪之前只是「还没开始选目标」：清掉枪身浮窗，道具照常悬停/点击
      this.setGunHover(false)
      this.canvas.style.cursor = ''
    }
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const groups: THREE.Object3D[] = []
    this.actionHovered = null
    for (const button of this.actionButtons.values()) groups.push(button.root)
    for (const entry of this.items.values()) groups.push(entry.group)
    // 只有升起完成后才允许悬停/点击；沉在桌面以下的候选不参与拾取
    if (this.supplyTrays?.player.state === 'open') {
      for (const entry of this.supplyItems.values()) groups.push(entry.group)
    }
    const hits = this.raycaster.intersectObjects(groups, true)
    const first = hits[0]
    if (!first) {
      this.setHovered(null)
      this.setSupplyHovered(null)
      return
    }
    let node: THREE.Object3D | null = first.object
    while (node && node.userData.item === undefined && node.userData.tableAction === undefined) {
      node = node.parent
    }
    if (node?.userData.tableAction) {
      this.actionHovered = node.userData.tableAction as TableAction
      this.setHovered(null)
      this.setSupplyHovered(null)
      return
    }
    if (!node) {
      this.setHovered(null)
      this.setSupplyHovered(null)
      return
    }
    const key = node.userData.key as string | undefined
    const supplyEntry = key ? this.supplyItems.get(key) ?? null : null
    if (supplyEntry) {
      this.setHovered(null)
      this.setSupplyHovered(supplyEntry, event.clientX - rect.left, event.clientY - rect.top)
      return
    }
    this.setSupplyHovered(null)
    const entry = key ? this.items.get(key) ?? null : null
    this.setHovered(entry, event.clientX - rect.left, event.clientY - rect.top)
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.disposed || !event.isPrimary || event.button !== 0) return
    const down = this.pointerDownAt
    const pressed = this.actionPressed
    this.pointerDownAt = null
    this.actionPressed = null
    if (!down) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > 6) return
    if (this.targetPickActive) {
      if (this.targetArmed) {
        const target = this.pickShotTarget(event)
        if (target) this.callbacks.onTargetPick?.(target)
        return
      }
      if (this.isPointerOnGun(event)) {
        this.armTargetPick()
        return
      }
      // 未点枪：继续走正常的台面点击，道具在选枪口前仍然可用
    }
    this.handlePointerMove(event)
    if (this.actionHovered) {
      if (pressed === this.actionHovered) this.activateTableAction(this.actionHovered)
      return
    }
    if (pressed) return
    if (this.supplyHovered) {
      const item = this.supplyHovered.item
      this.setSupplyHovered(null)
      this.callbacks.onSupplyPick?.(item)
      return
    }
    const entry = this.hovered
    if (!entry) return
    this.callbacks.onItemClick?.(entry.actor, entry.item)
  }

  private setHovered(entry: ItemEntry | null, x = 0, y = 0): void {
    if (this.hovered === entry) {
      if (entry) {
        const catalog = ITEM_CATALOG[entry.item]
        this.callbacks.onItemHover?.({
          actor: entry.actor,
          item: entry.item,
          name: catalog.name,
          summary: catalog.summary,
          x,
          y,
        })
      }
      return
    }
    if (this.hovered) this.hovered.hovered = false
    this.hovered = entry
    if (!entry) {
      this.callbacks.onItemHover?.(null)
      return
    }
    entry.hovered = true
    const catalog = ITEM_CATALOG[entry.item]
    this.callbacks.onItemHover?.({
      actor: entry.actor,
      item: entry.item,
      name: catalog.name,
      summary: catalog.summary,
      x,
      y,
    })
  }

  private setSupplyHovered(entry: ItemEntry | null, x = 0, y = 0): void {
    if (this.supplyHovered === entry) {
      if (entry) {
        const catalog = ITEM_CATALOG[entry.item]
        this.callbacks.onItemHover?.({
          actor: entry.actor,
          item: entry.item,
          name: catalog.name,
          summary: catalog.summary,
          x,
          y,
          supply: true,
        })
      }
      return
    }
    if (this.supplyHovered) this.supplyHovered.hovered = false
    this.supplyHovered = entry
    if (!entry) {
      if (!this.hovered) this.callbacks.onItemHover?.(null)
      return
    }
    entry.hovered = true
    const catalog = ITEM_CATALOG[entry.item]
    this.callbacks.onItemHover?.({
      actor: entry.actor,
      item: entry.item,
      name: catalog.name,
      summary: catalog.summary,
      x,
      y,
      supply: true,
    })
  }

  /** 台面点数贴片：贴在台呢上，替代 HUD 里的手牌点数 */
  private buildScorePlates(): void {
    for (const actor of ['player', 'boss'] as const) {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 220
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = 4
      const geometry = new THREE.PlaneGeometry(SCORE_PLATE_W, SCORE_PLATE_H)
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      const scale = SCORE_PLATE_SCALE[actor]
      const tilt = SCORE_PLATE_TILT[actor]
      const pos = SCORE_PLATE_POS[actor]
      mesh.rotation.order = 'YXZ'
      // 立起的贴片绕中心翻转：抬高半个贴片高度，让贴近镜头的一边仍贴着台呢
      const yaw = tilt > 0 ? Math.atan2(-pos.x, SCORE_PLATE_VIEW.z - pos.y) : 0
      mesh.rotation.set(-Math.PI / 2 + tilt, yaw, 0)
      const lift = tilt > 0 ? Math.sin(tilt) * (SCORE_PLATE_H * scale) / 2 + 0.03 : 0
      mesh.position.set(pos.x, SCORE_PLATE_Y + lift, pos.y)
      mesh.scale.setScalar(scale)
      mesh.renderOrder = 4
      this.scene.add(mesh)
      this.scorePlates.set(actor, { ctx, texture, mesh, key: 'empty' })
    }
  }

  private syncScores(snapshot: GameSnapshot): void {
    for (const actor of ['player', 'boss'] as const) {
      const plate = this.scorePlates.get(actor)
      if (!plate) continue
      const view = actor === 'player' ? snapshot.player : snapshot.boss
      const shown = evaluateHand(view.visibleHand.visible.filter((card): card is Card => card !== null))
      const hidden = view.visibleHand.visible.some((card) => card === null)
      const dealt = shown.cards.length > 0
      const key = dealt
        ? `${shown.total}|${shown.soft}|${shown.blackjack}|${shown.busted}|${view.standing}|${hidden}`
        : 'empty'
      if (key === plate.key) continue
      plate.key = key
      this.paintScore(actor, plate, {
        total: shown.total,
        soft: shown.soft,
        blackjack: shown.blackjack,
        busted: shown.busted,
        hidden,
        standing: view.standing,
        dealt,
      })
      if (!dealt) continue
      const mesh = plate.mesh
      const base = SCORE_PLATE_SCALE[actor]
      this.tween({
        duration: 0.45,
        onUpdate: (t) => mesh.scale.setScalar(base * (1 + Math.sin(t * Math.PI) * 0.05)),
        onComplete: () => mesh.scale.setScalar(base),
      })
    }
  }

  private paintScore(
    actor: ActorId,
    plate: ScorePlate,
    info: {
      total: number
      soft: boolean
      blackjack: boolean
      busted: boolean
      hidden: boolean
      standing: boolean
      dealt: boolean
    },
  ): void {
    const { ctx, texture } = plate
    const w = 640
    const h = 220
    ctx.clearRect(0, 0, w, h)
    if (!info.dealt) {
      texture.needsUpdate = true
      return
    }
    const isPlayer = actor === 'player'
    const ink = info.busted ? (isPlayer ? '#9a8767' : '#ab4a33') : isPlayer ? '#f4e6c0' : '#ff8a5a'
    const dim = isPlayer ? 'rgba(244,230,192,0.68)' : 'rgba(255,150,100,0.85)'
    const spaced = ctx as CanvasRenderingContext2D & { letterSpacing: string }

    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // 淡淡的暗色晕染底，让字在绿色台呢上立得住，又不像贴了一块面板
    const halo = ctx.createRadialGradient(w / 2, 100, 12, w / 2, 100, 330)
    halo.addColorStop(0, 'rgba(4,8,5,0.3)')
    halo.addColorStop(1, 'rgba(4,8,5,0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)

    // 一圈椭圆印刷线，像台呢自带的标记，也让点数更容易被眼睛抓到
    ctx.beginPath()
    ctx.ellipse(w / 2, 96, 238, 76, 0, 0, Math.PI * 2)
    ctx.strokeStyle = info.busted
      ? isPlayer
        ? 'rgba(154,135,103,0.22)'
        : 'rgba(171,74,51,0.3)'
      : isPlayer
        ? 'rgba(244,230,192,0.24)'
        : 'rgba(255,140,80,0.34)'
    ctx.lineWidth = 7
    ctx.stroke()

    // 主数字 + 暗牌「+ ?」；字要大，远角透视下小字会被压缩得读不出来
    const numText = String(info.total)
    const numFont = '700 152px Impact, "Arial Black", "Microsoft YaHei", sans-serif'
    const qFont = '600 64px "Microsoft YaHei", sans-serif'
    spaced.letterSpacing = '0px'
    ctx.font = numFont
    const numW = ctx.measureText(numText).width
    let qW = 0
    if (info.hidden) {
      ctx.font = qFont
      qW = ctx.measureText('+ ?').width
    }
    const gap = info.hidden ? 24 : 0
    const left = (w - (numW + gap + qW)) / 2
    const numX = left + numW / 2

    ctx.font = numFont
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(6,10,7,0.55)'
    ctx.lineWidth = 11
    ctx.strokeText(numText, numX, 100)
    ctx.shadowColor = 'rgba(0,0,0,0.65)'
    ctx.shadowBlur = 14
    ctx.shadowOffsetY = 6
    ctx.fillStyle = ink
    ctx.fillText(numText, numX, 100)
    if (info.hidden) {
      ctx.font = qFont
      ctx.strokeStyle = 'rgba(6,10,7,0.45)'
      ctx.lineWidth = 7
      ctx.strokeText('+ ?', left + numW + gap + qW / 2, 110)
      ctx.fillStyle = dim
      ctx.fillText('+ ?', left + numW + gap + qW / 2, 110)
    }
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    // 爆牌：数字上一道划叉，不用读字也能认出
    if (info.busted) {
      ctx.strokeStyle = isPlayer ? 'rgba(244,230,192,0.7)' : 'rgba(255,96,64,0.85)'
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.moveTo(left - 16, 138)
      ctx.lineTo(left + numW + 16, 62)
      ctx.stroke()
    }

    const status = info.busted
      ? '爆 牌'
      : info.blackjack
        ? 'BLACKJACK'
        : info.standing
          ? '停 牌'
          : info.soft
            ? '软 牌'
            : ''
    if (status) {
      ctx.font = info.blackjack
        ? '700 32px "Arial Black", "Segoe UI", sans-serif'
        : '600 32px "Microsoft YaHei", "Segoe UI", sans-serif'
      spaced.letterSpacing = info.blackjack ? '5px' : '9px'
      ctx.fillStyle = info.busted
        ? isPlayer
          ? 'rgba(244,230,192,0.6)'
          : 'rgba(255,96,64,0.9)'
        : info.blackjack
          ? '#e8c774'
          : dim
      ctx.strokeStyle = 'rgba(6,10,7,0.45)'
      ctx.lineWidth = 6
      ctx.strokeText(status, w / 2, 194)
      ctx.fillText(status, w / 2, 194)
    }
    ctx.restore()
    texture.needsUpdate = true
  }

  /** 血袋 = 一格生命：掉血从右往左排空，回血重新注满；maxHp 变了整架重建 */
  private syncBlood(snapshot: GameSnapshot): void {
    for (const actor of ['player', 'boss'] as const) {
      if (this.bloodCloseupActor === actor && !this.bloodCloseupDrain) continue
      const closeupDrain = this.bloodCloseupActor === actor && this.bloodCloseupDrain
      const view = actor === 'player' ? snapshot.player : snapshot.boss
      const maxHp = Math.max(1, view.maxHp)
      let rack = this.bloodRacks.get(actor)
      if (!rack || rack.maxHp !== maxHp) {
        if (rack) {
          rack.group.removeFromParent()
          this.disposeObject(rack.group)
          rack.extra.removeFromParent()
          this.disposeObject(rack.extra)
        }
        rack = this.buildBloodRack(actor, maxHp, view.hp)
        this.bloodRacks.set(actor, rack)
        this.refreshShotTargetBoxes()
      }
      for (let i = 0; i < rack.bags.length; i += 1) {
        const bag = rack.bags[i]
        const target = i < view.hp ? 1 : 0
        const from = bag.liquid.scale.y
        if (Math.abs(from - target) < 0.01 || (closeupDrain && bag.fill === target)) continue
        bag.fill = target
        this.tween({
          duration: (0.5 + Math.abs(from - target) * 0.18) * (closeupDrain ? 5 / 3 : 1),
          delay: (rack.bags.length - 1 - i) * 0.04,
          onUpdate: (t) => {
            const f = from + (target - from) * easeInOutCubic(t)
            bag.liquid.scale.y = Math.max(0.001, f)
            bag.liquid.position.y = bag.bottomY + (bag.liquidH * f) / 2
            bag.shell.scale.z = 0.5 * (0.72 + 0.28 * Math.min(1, f * 1.4))
          },
        })
      }
    }
  }

  private buildBloodRack(actor: ActorId, maxHp: number, hp: number): BloodRack {
    const cfg = BLOOD_RACK_LAYOUT[actor]
    const group = new THREE.Group()
    group.name = `BloodRack-${actor}`
    group.position.set(cfg.x, cfg.y, cfg.z)
    group.rotation.y = cfg.yaw
    this.scene.add(group)

    const metal = new THREE.MeshStandardMaterial({
      color: 0x8f959b,
      metalness: 0.82,
      roughness: 0.38,
    })
    this.disposableMaterials.add(metal)
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0xe6dfd0,
      transparent: true,
      opacity: 0.16,
      roughness: 0.12,
      metalness: 0,
      depthWrite: false,
    })
    this.disposableMaterials.add(shellMat)
    const bloodMat = new THREE.MeshStandardMaterial({
      color: 0x6e0b0c,
      emissive: 0x230303,
      roughness: 0.32,
      metalness: 0.05,
    })
    this.disposableMaterials.add(bloodMat)
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x3d1114,
      roughness: 0.55,
      metalness: 0.1,
    })
    this.disposableMaterials.add(tubeMat)

    const baseGeo = new THREE.CylinderGeometry(cfg.baseR, cfg.baseR * 1.18, 0.022, 20)
    this.disposableGeometries.add(baseGeo)
    const base = new THREE.Mesh(baseGeo, metal)
    base.position.y = 0.011
    base.castShadow = true
    base.receiveShadow = true
    group.add(base)

    const poleGeo = new THREE.CylinderGeometry(0.009, 0.009, cfg.poleH, 10)
    this.disposableGeometries.add(poleGeo)
    const pole = new THREE.Mesh(poleGeo, metal)
    pole.position.y = cfg.poleH / 2
    pole.castShadow = true
    group.add(pole)

    const span = cfg.spacing * (maxHp - 1)
    const barGeo = new THREE.CylinderGeometry(0.007, 0.007, span + 0.06, 8)
    this.disposableGeometries.add(barGeo)
    const bar = new THREE.Mesh(barGeo, metal)
    bar.rotation.z = Math.PI / 2
    bar.position.y = cfg.poleH
    group.add(bar)

    // 袋底汇流管：每只袋的短管都插在这根横管上，再由一根细管通到各自一侧
    const manifoldY = cfg.poleH - 0.02 - cfg.bagH - 0.032
    const manifoldGeo = new THREE.CylinderGeometry(0.005, 0.005, span + 0.02, 8)
    this.disposableGeometries.add(manifoldGeo)
    const manifold = new THREE.Mesh(manifoldGeo, tubeMat)
    manifold.rotation.z = Math.PI / 2
    manifold.position.y = manifoldY
    group.add(manifold)

    const shellGeo = new THREE.CapsuleGeometry(cfg.bagW / 2, Math.max(0.01, cfg.bagH - cfg.bagW), 4, 10)
    this.disposableGeometries.add(shellGeo)
    const tabGeo = new THREE.BoxGeometry(0.008, 0.022, 0.008)
    this.disposableGeometries.add(tabGeo)
    const stubGeo = new THREE.CylinderGeometry(0.0042, 0.0042, 0.032, 6)
    this.disposableGeometries.add(stubGeo)

    const bagCenterY = cfg.poleH - 0.02 - cfg.bagH / 2
    const liquidH = cfg.bagH * 0.72
    const bottomY = bagCenterY - cfg.bagH * 0.36
    // 液体盒的高度直接取满袋液高，syncBlood 里 scale.y 就是填充比例
    const liquidGeo = new THREE.BoxGeometry(cfg.bagW * 0.66, liquidH, cfg.bagW * 0.3)
    this.disposableGeometries.add(liquidGeo)
    const labelGeo = new THREE.PlaneGeometry(cfg.bagW * 0.44, cfg.bagH * 0.2)
    this.disposableGeometries.add(labelGeo)
    const labelMat = new THREE.MeshStandardMaterial({
      color: 0xc4b8a2,
      roughness: 0.9,
      metalness: 0,
    })
    this.disposableMaterials.add(labelMat)
    const hookMat = brassMaterial(this.disposableMaterials)
    const bags: BloodBag[] = []
    for (let i = 0; i < maxHp; i += 1) {
      const bx = (i - (maxHp - 1) / 2) * cfg.spacing
      const tab = new THREE.Mesh(tabGeo, hookMat)
      tab.position.set(bx, cfg.poleH - 0.011, 0)
      group.add(tab)

      const shell = new THREE.Mesh(shellGeo, shellMat)
      shell.scale.z = 0.5
      shell.position.set(bx, bagCenterY, 0)
      group.add(shell)

      const liquid = new THREE.Mesh(liquidGeo, bloodMat)
      liquid.position.set(bx, bagCenterY, 0)
      group.add(liquid)

      const label = new THREE.Mesh(labelGeo, labelMat)
      label.position.set(bx, bagCenterY + cfg.bagH * 0.14, cfg.bagW * 0.27)
      group.add(label)

      const stub = new THREE.Mesh(stubGeo, tubeMat)
      stub.position.set(bx, manifoldY + 0.016, 0)
      group.add(stub)

      const bag: BloodBag = { liquid, shell, liquidH, bottomY, fill: i < hp ? 1 : 0 }
      const f = bag.fill
      liquid.scale.y = Math.max(0.001, f)
      liquid.position.y = bottomY + (liquidH * f) / 2
      shell.scale.z = 0.5 * (0.72 + 0.28 * Math.min(1, f * 1.4))
      bags.push(bag)
    }

    // 汇流管到各自一侧的细管（世界坐标，单独挂在场景里，换架时一并销毁）
    const extra = new THREE.Group()
    extra.name = `BloodTube-${actor}`
    const startY = cfg.y + manifoldY
    const points =
      actor === 'player'
        ? [
            new THREE.Vector3(cfg.x, startY, cfg.z),
            new THREE.Vector3(cfg.x - 0.04, startY - 0.16, cfg.z + 0.12),
            new THREE.Vector3(cfg.x - 0.06, TABLE_TOP + 0.05, cfg.z + 0.26),
            new THREE.Vector3(cfg.x - 0.02, TABLE_TOP - 0.32, cfg.z + 0.46),
          ]
        : [
            new THREE.Vector3(cfg.x, startY, cfg.z),
            new THREE.Vector3(cfg.x + 0.16, startY - 0.08, cfg.z + 0.1),
            new THREE.Vector3(cfg.x + 0.4, startY - 0.26, cfg.z + 0.22),
            new THREE.Vector3(-0.62, 1.42, -2.92),
          ]
    const curve = new THREE.CatmullRomCurve3(points)
    const tubeGeo = new THREE.TubeGeometry(curve, 26, 0.0045, 6, false)
    this.disposableGeometries.add(tubeGeo)
    const tube = new THREE.Mesh(tubeGeo, tubeMat)
    extra.add(tube)
    this.scene.add(extra)

    return { group, extra, bags, maxHp }
  }

  private applyOverride(key: string, texture: THREE.Texture): void {
    if (key === 'table') {
      const top = this.tableGroup.getObjectByName('TableTop')
      if (top instanceof THREE.Mesh && top.material instanceof THREE.MeshStandardMaterial) {
        top.material.map = texture
        top.material.needsUpdate = true
      }
      return
    }
    if (key === 'card-back') {
      for (const entry of this.cards.values()) {
        const back = entry.mesh.material[2]
        if (back instanceof THREE.MeshStandardMaterial) {
          back.map = texture
          back.needsUpdate = true
        }
      }
      for (const child of this.deckGroup.children) {
        if (!(child instanceof THREE.Mesh)) continue
        const materials = child.material
        if (!Array.isArray(materials)) continue
        const topFace = materials[1]
        if (topFace instanceof THREE.MeshStandardMaterial) {
          topFace.map = texture
          topFace.needsUpdate = true
        }
      }
      return
    }
    if (key.startsWith('mask-')) {
      if (this.lastSnapshot && key === this.textures.maskKey(this.lastSnapshot.levelIndex)) {
        this.bossParts.mask.material.map = texture
        this.bossParts.mask.material.needsUpdate = true
        this.bossParts.maskBack.material.map = texture
        this.bossParts.maskBack.material.needsUpdate = true
      }
      return
    }
    if (key.startsWith('card-')) {
      const match = /^card-(spade|heart|diamond|club)-(10|[1-9])$/.exec(key)
      if (!match) return
      const suit = match[1] as CardSuit
      const rank = Number(match[2]) as CardRank
      for (const entry of this.cards.values()) {
        if (entry.cardKey !== key) continue
        const material = entry.mesh.material[cardFaceTopIndex()]
        if (material instanceof THREE.MeshStandardMaterial) {
          material.map = texture
          material.needsUpdate = true
        }
        void suit
        void rank
      }
    }
  }

  private resize(): void {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.fov = width / height < 1.2 ? 58 : 48
    this.camera.updateProjectionMatrix()
  }

  private disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points || child instanceof THREE.Sprite) {
        if (!child.userData.sharedGeometry) child.geometry.dispose()
        if (child.userData.sharedMaterial) return
        const material = child.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
      }
    })
  }
}

function brassMaterial(registry: WeakSet<THREE.Material>): THREE.MeshStandardMaterial {
  const material = makeStandardMaterial(0xb08a45, 0.9, 0.3)
  registry.add(material)
  return material
}
