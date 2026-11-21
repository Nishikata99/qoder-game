import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
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

export interface ItemHoverPayload {
  readonly actor: ActorId
  readonly item: ItemId
  readonly name: string
  readonly summary: string
  readonly x: number
  readonly y: number
}

export interface SceneCallbacks {
  readonly onItemHover?: (payload: ItemHoverPayload | null) => void
  readonly onItemClick?: (actor: ActorId, item: ItemId) => void
}

export type CameraShot =
  | 'table'
  | 'bloodPlayer'
  | 'bloodBoss'
  | 'cylinder'
  | 'magnify'
  | 'execute'
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
  readonly blocked: 'shield' | 'decoy' | null
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
  baseY: number
  phase: number
  materials: THREE.MeshStandardMaterial[]
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
const DECK_POS = new THREE.Vector3(2.42, TABLE_TOP + 0.06, 0.16)
const MAX_VISIBLE_CARDS = 8
const ITEM_SCALE = 1.0
/** 手牌点数直接印在台呢上：贴片中心（世界坐标）与尺寸，避开卡牌/道具/血袋架/牌堆/后侧围栏 */
const SCORE_PLATE_Y = TABLE_TOP + 0.004
const SCORE_PLATE_W = 1.34
const SCORE_PLATE_H = 0.46
const SCORE_PLATE_POS: Readonly<Record<ActorId, THREE.Vector2>> = {
  player: new THREE.Vector2(0, 1.52),
  // 放在自己点数的对面右侧、贴着后沿的空台呢上，离 Boss 卡牌与枪身都够远
  boss: new THREE.Vector2(1.5, -1.15),
}
/** Boss 侧离镜头远、视角更斜，贴片按比例放大才能与玩家侧同样好读 */
const SCORE_PLATE_SCALE: Readonly<Record<ActorId, number>> = { player: 1, boss: 1.5 }
/** 对面贴片立起一点正对镜头，否则远侧透视会把字压扁；0 = 平贴台呢 */
const SCORE_PLATE_TILT: Readonly<Record<ActorId, number>> = { player: 0, boss: 0.5 }
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
    z: -2.72,
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
  | 'gaming_table'
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
}

const MODEL_BASE = './models'

// 爬行 Boss 按低矮轮廓定高，不能沿用直立半身像的缩放。
const BOSS_BUST_HEIGHTS = [2.15, 1.7, 3.0] as const
/** 半身像胸口高度占整体高度的比例，用于换算瞄准点 */
const BOSS_CHEST_RATIO = 0.64
/** 半身像底座（斗篷下摆）压到桌面以下，被桌沿挡住，形成「坐在桌后」的错觉 */
const BOSS_BUST_BASE_Y = 0.26
/** Boss 站在桌后：桌体后沿 z=-2.23，斗篷前半 z≈-0.51 缩放后约 0.55m，
 * 所以中心必须在 -2.23-0.55=-2.78 之后，否则会穿进桌体 */
const BOSS_Z = -3.0
const BOSS_CRAWLER_BASE_Y = 0.65
const BOSS_CRAWLER_Z_OFFSET = -1.2

/** 密室顶棚高度（米）；吊灯摆动以这里为枢轴 */
const CEILING_Y = 6.0
/** 灯罩下沿在世界坐标中的高度，聚光灯挂在这里才不会被罩体遮挡 */
const LAMP_SHADE_BOT_Y = 4.02

/** 枪口瞄准的旋转中心：枪座落在桌面上的位置 */
const GUN_PIVOT = new THREE.Vector3(0, TABLE_TOP + 0.075, 0.08)
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
  return 2
}

export class SceneManager {
  private readonly container: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly callbacks: SceneCallbacks
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
  private readonly items = new Map<string, ItemEntry>()
  private readonly disposableGeometries = new Set<THREE.BufferGeometry>()
  private readonly disposableMaterials = new Set<THREE.Material>()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly listenerCleanup: Array<() => void> = []
  private readonly motionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
  /** 系统级「减少动态效果」：只抑制震屏与镜头漂移，保留运镜与发牌演出 */
  private reducedMotion = false
  private readonly onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches
    if (event.matches) this.shakeTime = 0
  }
  private statFrames = 0
  private statElapsed = 0
  private readonly resizeObserver: ResizeObserver
  private readonly scratchVector = new THREE.Vector3()
  private readonly scratchHitPoint = new THREE.Vector3()

  private readonly gltfLoader = new GLTFLoader()
  /** 已加载的模型模板；缺失表示加载失败或尚未完成，此时回退程序化几何 */
  private readonly models = new Map<ModelKey, THREE.Object3D>()
  private envTexture: THREE.Texture | null = null
  private readonly pendingModels: Array<Promise<void>> = []
  private readonly bossModelByLevel: Array<THREE.Object3D | null> = [null, null, null]
  /** 当前挂在 Boss 头上的 GLB 面具关卡，-1 表示仍用贴图面具 */
  private activeBossMaskLevel = -1
  /** GLB 半身像里的头部节点，用于「盯视」动画 */
  private bossHeadNode: THREE.Object3D | null = null
  /** 道具模型模板（按 item id），供 UI 图鉴与桌面摆件复用 */
  private readonly itemModelTemplates = new Map<ItemId, THREE.Object3D>()
  private readonly scorePlates = new Map<ActorId, ScorePlate>()
  private readonly bloodRacks = new Map<ActorId, BloodRack>()
  private readonly chains = new Map<ActorId, ChainEntry>()
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
  /** 0..1 的倒地量，叠加在呼吸动画上：命中时冲到 1 再缓慢回到 0 */
  private bossKnock = 0
  private knockGeneration = 0

  private readonly roomGroup = new THREE.Group()
  private readonly tableGroup = new THREE.Group()
  private readonly bossGroup = new THREE.Group()
  private readonly gunGroup = new THREE.Group()
  /** 瞄准枢轴：挂在枪座位置，yaw/pitch 绕它旋转，枪口才能真的对准目标 */
  private readonly gunAim = new THREE.Group()
  private readonly deckGroup = new THREE.Group()
  private readonly cardGroup = new THREE.Group()
  private readonly itemRoot = new THREE.Group()
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
  private pendingResolutionShot: { shot: 'death' | 'victory'; duration: number } | null = null
  private revealGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null
  private revealLight: THREE.PointLight | null = null
  private revealGlowLife = 0
  private aimTarget: ActorId = 'boss'
  /** 处决推近进度 0..1；作为视线方向上的偏移叠在相机基座上 */
  private executionPush = 0
  private executionPushGeneration = 0
  private gunRestYaw = 1.02
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

    this.buildRoom()
    this.buildTable()
    this.bossParts = this.buildBoss()
    const gun = this.buildGunPlaceholder()
    this.gunAim.position.copy(GUN_PIVOT)
    this.gunAim.rotation.order = 'YXZ'
    this.gunAim.rotation.y = this.gunRestYaw
    this.gunAim.add(gun.root)
    this.gunGroup.add(this.gunAim)
    this.drum = gun.drum
    this.muzzleLight = gun.muzzleLight
    this.flash = gun.flash
    this.bloodBurst = this.buildBloodBurst()
    this.sparkBurst = this.buildSparkBurst()

    const lighting = this.buildLighting()
    this.spot = lighting.spot
    this.rimLight = lighting.rim
    this.fillLight = lighting.fill

    this.dust = this.buildDust()
    this.deckGroup.position.copy(DECK_POS)
    this.buildDeckPile()
    this.buildScorePlates()
    this.buildNarrativeProps()

    this.preloadModels()

    this.textures.startWatching()
    const unwatch = this.textures.onOverride((key, texture) => this.applyOverride(key, texture))
    this.listenerCleanup.push(unwatch)

    if (this.motionQuery) {
      this.reducedMotion = this.motionQuery.matches
      this.motionQuery.addEventListener('change', this.onMotionPreferenceChange)
      this.listenerCleanup.push(() =>
        this.motionQuery?.removeEventListener('change', this.onMotionPreferenceChange),
      )
    }

    this.onPointerMove = (event) => this.handlePointerMove(event)
    this.onPointerLeave = () => this.setHovered(null)
    this.onPointerDown = (event) => {
      this.pointerDownAt = { x: event.clientX, y: event.clientY }
    }
    this.onPointerUp = (event) => this.handlePointerUp(event)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    this.timer.connect(document)
    this.tick = this.tick.bind(this)
    this.rafId = requestAnimationFrame(this.tick)
  }

  applySnapshot(snapshot: GameSnapshot): void {
    if (this.disposed) return
    this.lastSnapshot = snapshot
    this.applyLevel(snapshot.levelIndex)
    this.syncCards(snapshot)
    this.syncItems(snapshot)
    this.syncScores(snapshot)
    this.syncBlood(snapshot)
    this.syncChains(snapshot)
    this.hourglassTarget = snapshot.hourglassActive ? 1 : 0
  }

  /** Blends the camera to a named shot; `hold` keeps it there until another shot is set. */
  setShot(shot: CameraShot, duration = 0.9): void {
    if (this.disposed) return
    const realtimeBlend = shot === 'bloodPlayer' || shot === 'bloodBoss' || (shot === 'table' && this.isCloseupShot())
    if (shot !== 'bloodPlayer' && shot !== 'bloodBoss') this.cancelBloodCloseup()
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
      this.gunAim.add(halo)
      this.revealGlow = halo
    }
    const glow = this.revealGlow
    // 位置改用瞄准枢轴的局部坐标：转轮中心正上方
    const cylinderY = 0.075
    glow.visible = true
    glow.position.set(0, cylinderY, -0.09)
    glow.material.color.setHex(live ? 0xff2a18 : 0x2f8cff)
    glow.material.opacity = 0
    glow.scale.setScalar(0.2)
    if (!this.revealLight) {
      const light = new THREE.PointLight(0xff2a18, 0, 1.6, 2)
      light.position.set(0, cylinderY + 0.06, -0.09)
      this.gunAim.add(light)
      this.revealLight = light
    }
    const light = this.revealLight
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
    const deathShot = payload.lethal && payload.target === 'player'
    this.setShot('execute', 0.85)
    this.aimTarget = payload.target
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
      case 'cylinder':
        return {
          position: new THREE.Vector3(0.62, 2.16, 1.75),
          lookAt: new THREE.Vector3(0, 1.0, 0.04),
          fov: 36,
        }
      case 'magnify':
        return {
          position: new THREE.Vector3(0.68, 2.02, 1.62),
          lookAt: new THREE.Vector3(0, 1.0, 0.06),
          fov: 30,
        }
      case 'execute':
        return {
          position: new THREE.Vector3(0.32, 2.16, 1.66),
          lookAt: new THREE.Vector3(0, 1.2, -0.95),
          fov: 38,
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
    return this.bloodCloseupActor !== null
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

  private bloodDrainSettled(actor: ActorId): boolean {
    const rack = this.bloodRacks.get(actor)
    const snapshot = this.lastSnapshot
    if (!rack || !snapshot) return true
    const hp = actor === 'player' ? snapshot.player.hp : snapshot.boss.hp
    return rack.bags.every((bag, index) => Math.abs(bag.liquid.scale.y - (index < hp ? 1 : 0)) < 0.01)
  }

  private async runBloodCloseup(actor: ActorId, hpAfter: number, generation: number): Promise<void> {
    const shot: CameraShot = actor === 'player' ? 'bloodPlayer' : 'bloodBoss'
    if (!await this.waitBloodCloseup(actor === 'player' ? 1400 : 250, generation)) return
    this.setShot(shot, 0.55)
    if (!await this.waitBloodCloseup(750, generation)) return
    this.bloodCloseupDrain = true
    this.syncBlood(this.lastSnapshot!)
    while (!this.bloodDrainSettled(actor)) {
      if (!await this.waitBloodCloseup(100, generation)) return
    }
    if (!await this.waitBloodCloseup(250, generation)) return
    const resolution = this.pendingResolutionShot
    this.pendingResolutionShot = null
    this.bloodCloseupActor = null
    this.bloodCloseupDrain = false
    if (resolution) {
      this.setShot(resolution.shot, resolution.duration)
      return
    }
    if (hpAfter > 0) this.setShot('table', 0.7)
  }

  private playBloodCloseup(actor: ActorId, hpAfter: number, damage: number): boolean {
    if (damage <= 0 || this.reducedMotion) return false
    this.cancelBloodCloseup()
    const generation = this.bloodCloseupGeneration
    this.bloodCloseupActor = actor
    void this.runBloodCloseup(actor, hpAfter, generation)
    return true
  }

  playShot(payload: ShotPayload): void {
    if (this.disposed) return
    const live = payload.chamber === 'live'
    this.flash.visible = true
    this.flash.material.opacity = live ? 1 : 0.35
    this.flash.material.color.setHex(live ? 0xffc060 : 0x9fb8c8)
    this.flash.scale.setScalar(live ? 0.42 : 0.22)
    this.tween({
      duration: 0.14,
      onUpdate: (t) => {
        this.flash.scale.setScalar((live ? 0.42 : 0.22) * (0.75 + t * 0.9))
        this.flash.material.opacity = (1 - t) * (live ? 1 : 0.4)
      },
      onComplete: () => {
        this.flash.visible = false
        this.flash.material.opacity = 0
      },
    })
    this.muzzleLight.color.setHex(live ? 0xffb060 : 0x8fb4c8)
    this.muzzleLight.intensity = live ? 26 : 4
    this.tween({
      duration: 0.22,
      onUpdate: (t) => {
        this.muzzleLight.intensity = (live ? 26 : 4) * (1 - t) ** 2
      },
    })

    if (live && payload.target === 'boss') {
      const origin = this.bossHitPoint(this.scratchHitPoint)
      if (payload.blocked) {
        // 被挡下：Boss 不受伤，也不闪白、不后仰，只给一次材质化的碎屑反馈
        this.spawnSparks(origin, payload.blocked)
      } else {
        this.flashBoss()
        this.spawnBlood(origin)
        this.knockBossDown()
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

    if (!this.playBloodCloseup(payload.target, payload.hpAfter, payload.damage)) {
      this.resetShot(1.1)
    }
    this.shake(live ? 0.11 : 0.018, live ? 0.6 : 0.3)
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

  /** 命中：先被压下去，停顿一拍，再慢慢撑起来 */
  private knockBossDown(): void {
    this.knockGeneration += 1
    const generation = this.knockGeneration
    this.tween({
      duration: 0.24,
      onUpdate: (t) => {
        if (generation !== this.knockGeneration) return
        this.bossKnock = easeOutCubic(t)
      },
    })
    this.tween({
      duration: 2.6,
      delay: 0.9,
      onUpdate: (t) => {
        if (generation !== this.knockGeneration) return
        // 前 30% 还趴着，之后才缓缓起身
        this.bossKnock = 1 - easeInOutCubic(clamp01((t - 0.3) / 0.7))
      },
      onComplete: () => {
        if (generation !== this.knockGeneration) return
        this.bossKnock = 0
      },
    })
  }

  playReload(): void {
    if (this.disposed) return
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

  playItemUse(actor: ActorId, item: ItemId): void {
    if (this.disposed) return
    const found = [...this.items.values()].find(
      (entry) => entry.actor === actor && entry.item === item && entry.group.visible,
    )
    if (!found) return
    this.items.delete(found.key)
    if (this.hovered === found) this.setHovered(null)
    const startY = found.group.position.y
    const startScale = found.group.scale.x
    this.tween({
      duration: 0.75,
      onUpdate: (t) => {
        found.group.position.y = startY + 0.75 * easeOutCubic(t)
        found.group.rotation.y = t * Math.PI * 3
        const scale = startScale * (1 - t) ** 1.4
        found.group.scale.setScalar(Math.max(0.001, scale))
        for (const mat of found.materials) mat.emissiveIntensity = 0.6 + t * 2.4
      },
      onComplete: () => {
        this.itemRoot.remove(found.group)
        this.disposeObject(found.group)
      },
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.callbacks.onItemHover?.(null)
    for (const entry of this.items.values()) this.disposeObject(entry.group)
    this.items.clear()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
      }
    })
    this.textures.dispose()
    for (const plate of this.scorePlates.values()) plate.texture.dispose()
    this.envTexture?.dispose()
    this.models.clear()
    this.itemModelTemplates.clear()
    this.composer.dispose()
    this.renderer.dispose()
  }

  /** 用 GLB 模型替换某个已存在道具的程序化几何（保留外层的缩放/悬停动画） */
  private replaceItemMesh(entry: ItemEntry, source: THREE.Object3D): void {
    const stale: THREE.Object3D[] = []
    for (const child of entry.group.children) {
      if (child.userData.isModelClone) continue
      stale.push(child)
    }
    for (const child of stale) {
      entry.group.remove(child)
      this.disposeObject(child)
    }
    entry.materials.length = 0

    const clone = source.clone(true)
    clone.userData.isModelClone = true
    // 道具目标尺寸 0.28m；归一到底座 y=0、水平居中
    const box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    const longest = Math.max(size.x, size.y, size.z)
    if (longest > 1e-6) clone.scale.setScalar(0.28 / longest)
    const scaled = new THREE.Box3().setFromObject(clone)
    const center = scaled.getCenter(new THREE.Vector3())
    clone.position.set(-center.x, -scaled.min.y, -center.z)

    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            entry.materials.push(material)
          }
        }
      }
    })
    entry.group.add(clone)
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /** 异步载入全部 GLB；失败的模型保持缺失，渲染时自动回退到程序化几何 */
  private preloadModels(): void {
    const keys: ModelKey[] = [
      'shotgun',
      'boss_1',
      'boss_2',
      'boss_3',
      'item_magnifier',
      'item_syringe',
      'item_saw',
      'item_magnet',
      'item_handcuffs',
      'item_hourglass',
      'item_dagger',
      'gaming_table',
      'room_environment',
      'gothic_statue',
      'marble_bust_01',
      'player_hand',
    ]
    // 大件场景模型不必和道具一样压那么暗，否则整个桌面沉进黑里
    const dimFor = (key: ModelKey): number => {
      if (key === 'gaming_table') return 0.82
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
      return key === 'gothic_statue' || key === 'marble_bust_01' ? 0.62 : GLB_ALBEDO_DIM
    }
    for (const key of keys) {
      const task = this.gltfLoader
        .loadAsync(`${MODEL_BASE}/${key}.glb`)
        .then((gltf: GLTF) => {
          if (this.disposed) return
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
        })
        .catch((error: unknown) => {
          // 缺模型不是致命错误：程序化几何继续兜底
          console.debug(`[SceneManager] 模型 ${key}.glb 加载失败，回退程序化几何`, error)
        })
      this.pendingModels.push(task)
    }
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
    const clone = source.clone(true)
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
        // 已是当前层就立刻换；否则等 setMaskTexture 在切层时处理
        if (level === this.currentLevelIndex) this.applyBossMaskModel(level)
        break
      }
      case 'gaming_table': {
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
    }
  }

  /** 第一人称前景：右手原模、左手镜像，腕部朝向玩家，指尖自然伸向桌面 */
  private buildIntroHands(source: THREE.Object3D): void {
    if (this.introHands || this.disposed) return
    const group = new THREE.Group()
    for (const side of [-1, 1]) {
      const hand = source.clone(true)
      hand.scale.set(1.15 * side, 1.15, 1.15)
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

    // 枪口火光与点光原本挂在程序化模型里，换模型前先挪到瞄准枢轴，否则一起被销毁
    this.gunAim.add(this.flash, this.muzzleLight)
    this.gunAim.add(holder)
    // 枪口锚点随模型缩放/居中移动，火光必须贴着真实枪口；先刷矩阵再换算成枢轴局部坐标
    this.gunAim.updateWorldMatrix(true, true)
    const muzzle = clone.getObjectByName('MuzzlePoint')
    if (muzzle) {
      const muzzleLocal = muzzle.getWorldPosition(new THREE.Vector3())
      this.gunAim.worldToLocal(muzzleLocal)
      this.flash.position.copy(muzzleLocal)
      this.muzzleLight.position.copy(muzzleLocal)
    }

    if (placeholder) {
      // 占位枪挂在 gunAim 下，必须从真实父节点摘下，否则两把枪叠在一起
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
  }

  /**
   * 用 Blender 重型钢板赌桌替换程序化桌体。
   * 模型台呢面在 glTF 的 y=0，这里整体抬到 TABLE_TOP，卡牌/道具/枪无需改坐标即可贴合。
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
    // 模型原地不动：台呢面本来就是 y=0，只需整体上移到桌面高度
    clone.position.set(0, TABLE_TOP, 0)
    clone.name = 'GamingTableGLB'
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
    const dt = Math.min(this.timer.getDelta(), 1 / 20)
    this.elapsed += dt
    this.updateTweens(dt)
    this.updateLighting()
    this.updateBoss(dt)
    this.updateDust(dt)
    this.updateBlood(dt)
    this.updateSparks(dt)
    this.updateHourglass(dt)
    this.updateNarrativeGrade(dt)
    this.updateChains(dt)
    this.updateGunAim(dt)
    this.updateItems(dt)
    this.updateCards(dt)
    this.updateCamera(dt)
    this.composer.render(dt)
    this.sampleStats(dt)
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
    return this.shot === 'bloodPlayer' || this.shot === 'bloodBoss'
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
      this.turnGun(yaw, pitch, dt)
    } else {
      this.turnGun(this.gunRestYaw, 0, dt)
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

  /** 短弧插值：yaw 绕过 ±π 时不会倒着甩一整圈 */
  private turnGun(yaw: number, pitch: number, dt: number): void {
    const k = Math.min(1, dt * 5.5)
    const yawDelta = Math.atan2(Math.sin(yaw - this.gunAim.rotation.y), Math.cos(yaw - this.gunAim.rotation.y))
    const pitchDelta = Math.atan2(Math.sin(pitch - this.gunAim.rotation.x), Math.cos(pitch - this.gunAim.rotation.x))
    this.gunAim.rotation.y += yawDelta * k
    this.gunAim.rotation.x += pitchDelta * k
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

  private updateBoss(dt: number): void {
    const t = this.elapsed
    // 呼吸：三个不成整数比的正弦叠加，周期压在 4~6 秒，避免机械重复感
    const breath = Math.sin(t * 1.32) * 0.018 + Math.sin(t * 0.61 + 1.7) * 0.010
    const knock = this.bossKnock
    this.bossGroup.position.y = breath - knock * 0.72
    // 吸气时胸口微微前压，呼气抬回；中弹时整个上半身后仰并侧倾
    this.bossGroup.rotation.x = -breath * 0.55 - knock * 0.82
    this.bossGroup.rotation.z = knock * 0.2

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

    if (this.bossHeadNode) {
      this.bossHeadNode.rotation.y = yaw
      this.bossHeadNode.rotation.x = pitch
    } else {
      // 程序化 Boss 兜底：沿用旧的可动头部
      this.bossParts.head.rotation.y = yaw
      this.bossParts.head.rotation.x = pitch
      const maskBob = Math.sin(t * 1.6) * 0.004
      this.bossParts.mask.position.y = (this.bossParts.mask.userData.baseY as number) + maskBob
      this.bossParts.maskBack.position.y = (this.bossParts.maskBack.userData.baseY as number) + maskBob
    }
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
      const bustHeight = BOSS_BUST_HEIGHTS[this.currentLevelIndex] ?? BOSS_BUST_HEIGHTS[0]
      if (this.currentLevelIndex === 1) {
        this.bossHitPoint(group.position)
        group.position.y -= 0.18
      } else {
        group.position.set(0, BOSS_BUST_BASE_Y + bustHeight * 0.42, BOSS_Z + 0.55)
      }
      group.scale.setScalar(2.4)
      group.rotation.z = 0.05
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

  /**
   * 磁铁换牌：一张牌从对手明牌位沿弧线飞到自己最后一张明牌位，
   * 用一张临时贴图牌做替身，落位后销毁；快照同步会各自就位。
   */
  playMagnetSwap(card: Card): void {
    if (this.disposed) return
    const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H)
    this.disposableGeometries.add(geo)
    const side = new THREE.MeshStandardMaterial({ color: 0x231b16, roughness: 0.88 })
    this.disposableMaterials.add(side)
    const face = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.cardKey(card.rank, card.suit)),
      roughness: 0.66,
      metalness: 0.04,
    })
    this.disposableMaterials.add(face)
    const back = new THREE.MeshStandardMaterial({
      map: this.textures.get(this.textures.cardBackKey),
      roughness: 0.76,
      metalness: 0.05,
    })
    this.disposableMaterials.add(back)
    const mesh = new THREE.Mesh(geo, [side, side, face, back, side, side])
    mesh.castShadow = true

    const bossCount = Math.max(1, this.handCount('boss'))
    const playerCount = Math.max(1, this.handCount('player'))
    const from = this.cardSlot('boss', bossCount - 1, bossCount).position.clone()
    const to = this.cardSlot('player', playerCount - 1, playerCount).position.clone()
    const lift = this.reducedMotion ? 0.08 : 0.55
    mesh.position.copy(from)
    mesh.position.y += 0.02
    mesh.rotation.order = 'YXZ'
    mesh.rotation.set(0, Math.PI, 0)
    mesh.scale.setScalar(0.72)
    this.cardGroup.add(mesh)

    this.tween({
      duration: this.reducedMotion ? 0.22 : 0.72,
      onUpdate: (t) => {
        const eased = easeInOutCubic(t)
        mesh.position.lerpVectors(from, to, eased)
        mesh.position.y += Math.sin(eased * Math.PI) * lift
        mesh.rotation.y = Math.PI + eased * Math.PI * 2
        mesh.rotation.z = Math.sin(eased * Math.PI) * 0.5
        mesh.scale.setScalar(0.72 + eased * 0.28)
      },
      onComplete: () => {
        mesh.removeFromParent()
        this.disposeObject(mesh)
      },
    })
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
    for (const entry of this.items.values()) {
      const target = entry.hovered ? 1.18 : 1
      entry.hoverScale += (target - entry.hoverScale) * Math.min(1, dt * 12)
      entry.group.scale.setScalar(ITEM_SCALE * entry.hoverScale * entry.spawnScale)
      const hoverLift = entry.hovered ? 0.04 : 0
      entry.group.position.y = entry.baseY + Math.sin(this.elapsed * 2 + entry.phase) * 0.006 + hoverLift
      entry.group.rotation.y = Math.sin(this.elapsed * 0.8 + entry.phase) * 0.12
      const glowTarget = entry.hovered ? 1.1 : 0
      for (const material of entry.materials) {
        material.emissiveIntensity += (glowTarget - material.emissiveIntensity) * Math.min(1, dt * 10)
      }
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
    const spot = new THREE.SpotLight(0xffc98c, 70, 18, 0.88, 0.78, 1.2)
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
    const drumGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.17, 6)
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
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2
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
      depthWrite: false,
      toneMapped: false,
    })
    this.disposableMaterials.add(flashMat)
    const flash = new THREE.Sprite(flashMat)
    flash.position.set(0, 0.06, -1.06)
    flash.scale.setScalar(0.3)
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
    const bustHeight = BOSS_BUST_HEIGHTS[this.currentLevelIndex] ?? BOSS_BUST_HEIGHTS[0]
    return out.set(0, BOSS_BUST_BASE_Y + bustHeight * BOSS_CHEST_RATIO, BOSS_Z + 0.62)
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
    const impact = new THREE.PointLight(0xff2a14, 16, 4.5, 2)
    impact.position.copy(origin)
    impact.position.z += 0.15
    this.scene.add(impact)
    this.tween({
      duration: 0.3,
      onUpdate: (t) => {
        impact.intensity = 16 * (1 - t) ** 2
      },
      onComplete: () => {
        this.scene.remove(impact)
        impact.dispose()
      },
    })
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

  /**
   * 格挡碎屑：护心镜是金色金属火花（会发光、带一盏短命点光），
   * 诱饵是哑光的稻草/陶土渣（重、不发光），两者一眼能分清是被什么挡下的
   */
  private spawnSparks(origin: THREE.Vector3, kind: 'shield' | 'decoy'): void {
    this.sparkLife = 0.5
    const attribute = this.sparkBurst.geometry.getAttribute('position')
    if (!(attribute instanceof THREE.BufferAttribute)) return
    const material = this.sparkBurst.material
    const shield = kind === 'shield'
    material.color.setHex(shield ? 0xffe6b0 : 0x9c7a4a)
    material.size = shield ? 0.18 : 0.11
    material.blending = shield ? THREE.AdditiveBlending : THREE.NormalBlending
    material.needsUpdate = true

    const array = attribute.array as Float32Array
    for (let i = 0; i < SPARK_PARTICLE_COUNT; i += 1) {
      const base = i * 3
      array[base] = origin.x
      array[base + 1] = origin.y
      array[base + 2] = origin.z
      if (shield) {
        this.sparkVelocity[base] = (Math.random() - 0.5) * 2.6
        this.sparkVelocity[base + 1] = Math.random() * 1.6 - 0.2
        this.sparkVelocity[base + 2] = 1.2 + Math.random() * 2.4
      } else {
        // 稻草渣更重、更贴近命中点往下掉
        this.sparkVelocity[base] = (Math.random() - 0.5) * 1.1
        this.sparkVelocity[base + 1] = Math.random() * 0.8 - 0.3
        this.sparkVelocity[base + 2] = 0.5 + Math.random() * 1.2
      }
    }
    attribute.needsUpdate = true
    this.sparkBurst.visible = true
    material.opacity = shield ? 1 : 0.85

    if (!shield) return
    // 火花是瞬时强光：补一盏短命点光，否则在暗场里只剩几个像素点
    const impact = new THREE.PointLight(0xffc070, 4, 2, 2)
    impact.position.copy(origin)
    impact.position.z += 0.2
    this.scene.add(impact)
    this.tween({
      duration: 0.32,
      onUpdate: (t) => {
        impact.intensity = 4 * (1 - t) ** 2
      },
      onComplete: () => {
        this.scene.remove(impact)
        impact.dispose()
      },
    })
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
    for (let i = 0; i < 12; i += 1) {
      const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H)
      this.disposableGeometries.add(geo)
      const side = new THREE.MeshStandardMaterial({ color: 0x2c221c, roughness: 0.86 })
      this.disposableMaterials.add(side)
      const face = new THREE.MeshStandardMaterial({
        map: back,
        roughness: 0.74,
        metalness: 0.06,
      })
      this.disposableMaterials.add(face)
      const mesh = new THREE.Mesh(geo, [side, side, face, side, side, side])
      mesh.position.set(0, i * (CARD_T + 0.0015), 0)
      mesh.rotation.y = (Math.random() - 0.5) * 0.12
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.deckGroup.add(mesh)
    }
  }

  private applyLevel(levelIndex: number): void {
    const index = Math.min(LEVEL_LOOK.length - 1, Math.max(0, levelIndex))
    this.currentLevelIndex = index
    if (index === this.levelLookIndex) return
    this.levelLookIndex = index
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
    this.applyBossMaskModel(levelIndex)
  }

  /** 关卡对应的 GLB 已就绪就换成半身像，否则保留程序化 Boss */
  private applyBossMaskModel(levelIndex: number): void {
    const model = this.bossModelByLevel[levelIndex] ?? null
    if (!model) return
    if (this.activeBossMaskLevel === levelIndex) return
    this.activeBossMaskLevel = levelIndex

    const stale = this.bossGroup.getObjectByName('BossBustGLB')
    // 克隆与模板共享几何和材质，切层时不能销毁模板资源。
    if (stale) this.bossGroup.remove(stale)

    // 模型自带完整躯干，底座在自身 y=0：直接按世界高度缩放，底座落到桌沿下方
    const bustHeight = BOSS_BUST_HEIGHTS[levelIndex] ?? BOSS_BUST_HEIGHTS[0]
    const wrapper = this.placeModel(model, bustHeight, new THREE.Vector3(0, 0, 0), 0, 'height')
    wrapper.name = 'BossBustGLB'
    wrapper.position.set(
      0,
      levelIndex === 1 ? BOSS_CRAWLER_BASE_Y : BOSS_BUST_BASE_Y,
      levelIndex === 1 ? BOSS_CRAWLER_Z_OFFSET : 0,
    )
    this.bossGroup.add(wrapper)

    // 头部单独取出来做「盯视」动画；模型面朝 +Z，rotation.y 即为左右转
    const head = wrapper.getObjectByName('BossHead')
    this.bossHeadNode = head instanceof THREE.Object3D ? head : null

    // 半身像含完整头部与双肩，隐藏程序化面具与躯干
    this.bossParts.mask.visible = false
    this.bossParts.maskBack.visible = false
    this.bossParts.head.visible = false
    this.setProgrammaticBodyVisible(false)
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
            entry = this.spawnCard(actor, i, card)
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
            entry = this.spawnHoleCard(actor, i)
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
  private spawnHoleCard(actor: ActorId, index: number): CardEntry {
    const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H)
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
    const materials: THREE.Material[] = [side, side, back, back, side, side]
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
    this.animateDeal(entry, index)
    return entry
  }

  private spawnCard(actor: ActorId, index: number, card: Card): CardEntry {
    const geo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_H)
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
    const materials: THREE.Material[] = [side, side, face, back, side, side]
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
    this.animateDeal(entry, index)
    return entry
  }

  private applyCardTexture(entry: CardEntry, card: Card): void {
    const faceMaterial = entry.mesh.material[cardFaceTopIndex()]
    if (faceMaterial instanceof THREE.MeshStandardMaterial) {
      faceMaterial.map = this.textures.get(this.textures.cardKey(card.rank, card.suit))
      faceMaterial.needsUpdate = true
    }
  }

  private animateDeal(entry: CardEntry, index: number): void {
    const target = this.cardSlot(entry.actor, index, this.handCount(entry.actor))
    const start = entry.mesh.position.clone()
    const startScale = 0.65
    // 底牌从发牌起就保持背面朝上，不参与翻开动画
    const faceDown = entry.cardKey === 'hole'
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
        const slot = this.cardSlot(entry.actor, index, this.handCount(entry.actor))
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

  private handCount(actor: ActorId): number {
    let count = 0
    for (const entry of this.cards.values()) {
      if (entry.actor === actor) count += 1
    }
    return count
  }

  private cardSlot(actor: ActorId, index: number, count: number): { position: THREE.Vector3; angle: number } {
    const spacing = 0.335
    const total = Math.max(1, count)
    const offset = (index - (total - 1) / 2) * spacing
    const z = actor === 'player' ? 0.9 : -0.98
    const y = TABLE_TOP + CARD_T / 2 + 0.006
    const angle = actor === 'player' ? offset * -0.14 : Math.PI + offset * 0.14
    return { position: new THREE.Vector3(offset, y, z), angle }
  }

  private layoutHand(actor: ActorId, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const entry = this.cards.get(`${actor}-${i}`)
      if (!entry) continue
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
        const entry = this.spawnItem(actor, value.item, value.index, key, list.length)
        this.items.set(key, entry)
      }
      for (const [key, value] of wanted) {
        const entry = this.items.get(key)
        if (!entry) continue
        const slot = this.itemSlot(actor, value.index, list.length)
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

  private itemSlot(actor: ActorId, index: number, count: number): THREE.Vector3 {
    const total = Math.max(1, count)
    if (actor === 'player') {
      // 血袋架占住近处左角，道具沿右侧排开
      const spacing = 0.4
      const width = (total - 1) * spacing
      const lastX = 1.1
      const firstX = lastX - width
      return new THREE.Vector3(firstX + index * spacing, TABLE_TOP + 0.02, 1.1)
    }
    const spacing = 0.5
    const offset = (index - (total - 1) / 2) * spacing
    return new THREE.Vector3(offset, TABLE_TOP + 0.02, -1.55)
  }

  private spawnItem(actor: ActorId, item: ItemId, index: number, key: string, count: number): ItemEntry {
    const group = new THREE.Group()
    const materials: THREE.MeshStandardMaterial[] = []
    const template = this.itemModelTemplates.get(item)
    if (template) {
      // 模型已就绪：直接用 GLB，尺寸与贴地在这里归一
      const clone = template.clone(true)
      clone.userData.isModelClone = true
      const box = new THREE.Box3().setFromObject(clone)
      const size = box.getSize(new THREE.Vector3())
      const longest = Math.max(size.x, size.y, size.z)
      if (longest > 1e-6) clone.scale.setScalar(0.28 / longest)
      const scaled = new THREE.Box3().setFromObject(clone)
      const center = scaled.getCenter(new THREE.Vector3())
      clone.position.set(-center.x, -scaled.min.y, -center.z)
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true
          child.receiveShadow = true
          const list = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of list) {
            if (material instanceof THREE.MeshStandardMaterial) {
              materials.push(material)
            }
          }
        }
      })
      group.add(clone)
    } else {
      this.buildItemMesh(item, group, materials)
    }
    const slot = this.itemSlot(actor, index, count)
    group.position.copy(slot)
    group.position.y += 0.5
    group.scale.setScalar(0.001)
    group.userData.actor = actor
    group.userData.item = item
    group.userData.key = key
    this.itemRoot.add(group)
    const entry: ItemEntry = {
      group,
      actor,
      item,
      key,
      hovered: false,
      hoverScale: 1,
      spawnScale: 0.001,
      baseY: slot.y,
      phase: index * 1.7,
      materials,
    }
    this.tween({
      duration: 0.34,
      onUpdate: (t) => {
        const eased = easeOutCubic(t)
        entry.spawnScale = 0.001 + eased * 0.999
        group.position.y = slot.y + (1 - eased) * 0.5
      },
    })
    for (const material of materials) {
      material.emissive = new THREE.Color(0x000000)
      material.emissiveIntensity = 0
    }
    return entry
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
        add(new THREE.TorusGeometry(0.13, 0.018, 10, 24), rimMat, (mesh) => {
          mesh.position.set(0, 0.13, 0)
          mesh.rotation.x = -0.5
        })
        add(new THREE.CylinderGeometry(0.017, 0.019, 0.2, 10), handleMat, (mesh) => {
          mesh.position.set(0, 0.035, 0.13)
          mesh.rotation.x = Math.PI / 2 - 0.5
        })
        const lensGeo = new THREE.CircleGeometry(0.115, 24)
        this.disposableGeometries.add(lensGeo)
        this.disposableMaterials.add(glassMat)
        const lens = new THREE.Mesh(lensGeo, glassMat)
        lens.position.set(0, 0.135, 0)
        lens.rotation.x = -0.5
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
        this.disposableMaterials.add(glassMat)
        const liquidMat = makeStandardMaterial(0x3fae78, 0.2, 0.35)
        liquidMat.emissive = new THREE.Color(0x1e6b47)
        liquidMat.emissiveIntensity = 0.4
        const capMat = makeStandardMaterial(0x8a8578, 0.7, 0.4)
        add(new THREE.CylinderGeometry(0.05, 0.05, 0.17, 14), glassMat, (mesh) => {
          mesh.position.y = 0.085
        })
        add(new THREE.CylinderGeometry(0.036, 0.036, 0.09, 12), liquidMat, (mesh) => {
          mesh.position.y = 0.05
        })
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), capMat, (mesh) => {
          mesh.position.y = 0.19
        })
        add(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 8), capMat, (mesh) => {
          mesh.position.set(0.05, 0.1, 0)
          mesh.rotation.z = 0.4
        })
        break
      }
      case 'saw': {
        const bladeMat = makeStandardMaterial(0x9aa2a6, 0.95, 0.28)
        const gripMat = makeStandardMaterial(0x5a2f1a, 0.15, 0.7)
        add(new THREE.BoxGeometry(0.46, 0.018, 0.13), bladeMat, (mesh) => {
          mesh.position.set(0.05, 0.03, 0)
        })
        const toothGeo = new THREE.ConeGeometry(0.018, 0.045, 4)
        this.disposableGeometries.add(toothGeo)
        this.disposableMaterials.add(bladeMat)
        for (let i = 0; i < 9; i += 1) {
          const tooth = new THREE.Mesh(toothGeo, bladeMat)
          tooth.position.set(-0.15 + i * 0.05, 0.03, 0.075)
          tooth.rotation.x = Math.PI / 2
          group.add(tooth)
        }
        add(new THREE.BoxGeometry(0.16, 0.05, 0.06), gripMat, (mesh) => {
          mesh.position.set(-0.32, 0.035, 0)
          mesh.rotation.y = 0.1
        })
        add(new THREE.TorusGeometry(0.04, 0.012, 8, 14), gripMat, (mesh) => {
          mesh.position.set(-0.42, 0.04, 0)
          mesh.rotation.y = Math.PI / 2
        })
        break
      }
      case 'magnet': {
        const bodyMat = makeStandardMaterial(0x9e2f24, 0.45, 0.55)
        const tipMat = makeStandardMaterial(0x9fa9b2, 0.95, 0.25)
        add(new THREE.TorusGeometry(0.12, 0.03, 12, 24, Math.PI), bodyMat, (mesh) => {
          mesh.position.y = 0.12
          mesh.rotation.z = Math.PI
        })
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12), tipMat, (mesh) => {
          mesh.position.set(-0.12, 0.075, 0)
        })
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12), tipMat, (mesh) => {
          mesh.position.set(0.12, 0.075, 0)
        })
        break
      }
      case 'handcuffs': {
        const steelMat = makeStandardMaterial(0x7d8489, 0.9, 0.3)
        const linkMat = makeStandardMaterial(0x5d6367, 0.95, 0.35)
        for (const x of [-0.09, 0.09]) {
          add(new THREE.TorusGeometry(0.075, 0.016, 10, 22), steelMat, (mesh) => {
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
        break
      }
      case 'dagger': {
        const bladeMat = makeStandardMaterial(0xb8c2c6, 0.98, 0.22)
        const guardMat = makeStandardMaterial(0x7a4a22, 0.9, 0.35)
        const bloodMat = makeStandardMaterial(0x5e1410, 0.35, 0.55)
        add(new THREE.ConeGeometry(0.04, 0.3, 4), bladeMat, (mesh) => {
          mesh.position.set(0, 0.2, 0)
          mesh.rotation.y = Math.PI / 4
          mesh.scale.z = 0.4
        })
        add(new THREE.BoxGeometry(0.19, 0.024, 0.045), guardMat, (mesh) => {
          mesh.position.y = 0.06
        })
        add(new THREE.CylinderGeometry(0.021, 0.024, 0.11, 10), guardMat, (mesh) => {
          mesh.position.y = 0.005
        })
        add(new THREE.SphereGeometry(0.03, 10, 8), guardMat, (mesh) => {
          mesh.position.y = -0.05
        })
        add(new THREE.BoxGeometry(0.012, 0.06, 0.012), bloodMat, (mesh) => {
          mesh.position.set(0.02, 0.16, 0.01)
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
      case 'decoy': {
        // 诱饵：一尊粗糙的小泥偶，头顶插着草标
        const clayMat = makeStandardMaterial(0x6b5238, 0.15, 0.85)
        const strawMat = makeStandardMaterial(0xb59a52, 0.05, 0.9)
        add(new THREE.CapsuleGeometry(0.055, 0.1, 6, 12), clayMat, (mesh) => {
          mesh.position.y = 0.085
        })
        add(new THREE.SphereGeometry(0.055, 14, 10), clayMat, (mesh) => {
          mesh.position.y = 0.19
        })
        add(new THREE.BoxGeometry(0.11, 0.02, 0.02), clayMat, (mesh) => {
          mesh.position.y = 0.13
        })
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 6), strawMat, (mesh) => {
          mesh.position.set(0, 0.26, 0)
        })
        add(new THREE.BoxGeometry(0.07, 0.04, 0.006), strawMat, (mesh) => {
          mesh.position.set(0, 0.3, 0)
          mesh.rotation.z = 0.3
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

  private handlePointerMove(event: PointerEvent): void {
    if (this.disposed) return
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const groups: THREE.Object3D[] = []
    for (const entry of this.items.values()) groups.push(entry.group)
    const hits = this.raycaster.intersectObjects(groups, true)
    const first = hits[0]
    if (!first) {
      this.setHovered(null)
      return
    }
    let node: THREE.Object3D | null = first.object
    while (node && node.userData.item === undefined) {
      node = node.parent
    }
    if (!node) {
      this.setHovered(null)
      return
    }
    const key = node.userData.key as string | undefined
    const entry = key ? this.items.get(key) ?? null : null
    this.setHovered(entry, event.clientX - rect.left, event.clientY - rect.top)
  }

  private handlePointerUp(event: PointerEvent): void {
    if (this.disposed) return
    const down = this.pointerDownAt
    this.pointerDownAt = null
    if (!down) return
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y)
    if (moved > 6) return
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
        const back = entry.mesh.material[3]
        if (back instanceof THREE.MeshStandardMaterial) {
          back.map = texture
          back.needsUpdate = true
        }
      }
      for (const child of this.deckGroup.children) {
        if (!(child instanceof THREE.Mesh)) continue
        const materials = child.material
        if (!Array.isArray(materials)) continue
        const topFace = materials[2]
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
        child.geometry.dispose()
        const material = child.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else material.dispose()
      }
    })
  }
}

function brassMaterial(registry: Set<THREE.Material>): THREE.MeshStandardMaterial {
  const material = makeStandardMaterial(0xb08a45, 0.9, 0.3)
  registry.add(material)
  return material
}
