import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js'
import {
  ITEM_CATALOG,
  type ActorId,
  type Card,
  type CardRank,
  type CardSuit,
  type Chamber,
  type GameSnapshot,
  type ItemId,
} from '../game/GameEngine'
import { TextureFactory, type CrtData } from './TextureFactory'

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

export type CameraShot = 'table' | 'cylinder' | 'magnify' | 'execute' | 'death' | 'victory'

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
  readonly sawed: boolean
  readonly blackjack: boolean
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

interface TorsoParts {
  readonly head: THREE.Object3D
  readonly mask: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
  readonly maskBack: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>
}

const TABLE_TOP = 0.98
const CARD_W = 0.3
const CARD_H = 0.42
const CARD_T = 0.012
const DECK_POS = new THREE.Vector3(2.42, TABLE_TOP + 0.06, 0.16)
const MAX_VISIBLE_CARDS = 8
const ITEM_SCALE = 1.0
const LEVEL_LOOK: ReadonlyArray<{
  readonly rim: number
  readonly fill: number
  readonly lamp: number
}> = [
  { rim: 0xff5a2a, fill: 0x2f4763, lamp: 0xffb066 },
  { rim: 0xffa53a, fill: 0x3a4f63, lamp: 0xffa951 },
  { rim: 0xff2f22, fill: 0x3a2c4f, lamp: 0xff8a52 },
]

const PHASE_LABEL: Readonly<Record<string, string>> = {
  idle: '待机',
  dealing: '发牌中',
  playerTurn: '你的回合',
  bossTurn: '对手回合',
  resolving: '结算中',
  roundEnd: '回合结束',
  levelClear: '层间休整',
  gameOver: '你已阵亡',
  victory: '深渊沉寂',
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
  private readonly resizeObserver: ResizeObserver
  private readonly scratchVector = new THREE.Vector3()

  private readonly roomGroup = new THREE.Group()
  private readonly tableGroup = new THREE.Group()
  private readonly bossGroup = new THREE.Group()
  private readonly gunGroup = new THREE.Group()
  private readonly deckGroup = new THREE.Group()
  private readonly cardGroup = new THREE.Group()
  private readonly itemRoot = new THREE.Group()
  private readonly lampRig = new THREE.Group()
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly spot: THREE.SpotLight
  private readonly rimLight: THREE.PointLight
  private readonly fillLight: THREE.PointLight
  private readonly muzzleLight: THREE.PointLight
  private readonly flash: THREE.Sprite
  private readonly bossParts: TorsoParts
  private readonly crtScreen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly crtLight: THREE.PointLight
  private readonly drum: THREE.Group

  private cameraBase = new THREE.Vector3(0, 3.62, 4.92)
  private cameraLookAt = new THREE.Vector3(0, 1.02, -0.62)
  private readonly cameraFrom = new THREE.Vector3(0, 3.62, 4.92)
  private readonly lookFrom = new THREE.Vector3(0, 1.02, -0.62)
  private readonly cameraTo = new THREE.Vector3(0, 3.62, 4.92)
  private readonly lookTo = new THREE.Vector3(0, 1.02, -0.62)
  private cameraBlend = 1
  private cameraBlendDuration = 1
  private fovFrom = 48
  private fovTo = 48
  private shot: CameraShot = 'table'
  private revealGlow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null
  private revealLight: THREE.PointLight | null = null
  private revealGlowLife = 0
  private aimTarget: ActorId = 'boss'
  private aimBlend = 0
  private aimDuration = 0.8
  private gunRestYaw = 1.02
  private shakeTime = 0
  private shakeDuration = 0
  private shakeStrength = 0
  private hovered: ItemEntry | null = null
  private pointerDownAt: { x: number; y: number } | null = null
  private rafId = 0
  private elapsed = 0
  private levelLookIndex = 0
  private lastCrtKey = ''
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
    this.renderer.toneMappingExposure = 1.16
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x050505)
    this.scene.fog = new THREE.FogExp2(0x060606, 0.062)

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80)
    this.camera.position.copy(this.cameraBase)
    this.camera.lookAt(this.cameraLookAt)

    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)

    // Very restrained bloom: only the lamp, muzzle flash and CRT phosphor bloom.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.42, 0.9)
    this.composer.addPass(this.bloomPass)

    this.vignettePass = new ShaderPass(VignetteShader)
    this.vignettePass.uniforms.offset!.value = 0.92
    this.vignettePass.uniforms.darkness!.value = 1.14
    this.composer.addPass(this.vignettePass)

    // OutputPass owns tone mapping + sRGB conversion when rendering through the composer.
    this.composer.addPass(new OutputPass())

    this.scene.add(this.roomGroup, this.tableGroup, this.bossGroup, this.gunGroup, this.deckGroup, this.cardGroup, this.itemRoot, this.lampRig)

    this.buildRoom()
    this.buildTable()
    this.bossParts = this.buildBoss()
    const gun = this.buildRevolver()
    this.gunGroup.add(gun.root)
    this.gunGroup.rotation.y = this.gunRestYaw
    this.drum = gun.drum
    this.muzzleLight = gun.muzzleLight
    this.flash = gun.flash

    const crt = this.buildCrt()
    this.crtScreen = crt.screen
    this.crtLight = crt.light

    const lighting = this.buildLighting()
    this.spot = lighting.spot
    this.rimLight = lighting.rim
    this.fillLight = lighting.fill

    this.dust = this.buildDust()
    this.deckGroup.position.copy(DECK_POS)
    this.buildDeckPile()

    this.textures.startWatching()
    const unwatch = this.textures.onOverride((key, texture) => this.applyOverride(key, texture))
    this.listenerCleanup.push(unwatch)

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
    this.paintCrt(snapshot)
  }

  /** Blends the camera to a named shot; `hold` keeps it there until another shot is set. */
  setShot(shot: CameraShot, duration = 0.9): void {
    if (this.disposed) return
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
    this.revealGlowLife = shot === 'magnify' ? 3.2 : 0
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
      this.gunGroup.add(halo)
      this.revealGlow = halo
    }
    const glow = this.revealGlow
    const cylinderY = TABLE_TOP + 0.2
    glow.visible = true
    glow.position.set(0, cylinderY, -0.09)
    glow.material.color.setHex(live ? 0xff2a18 : 0x2f8cff)
    glow.material.opacity = 0
    glow.scale.setScalar(0.2)
    if (!this.revealLight) {
      const light = new THREE.PointLight(0xff2a18, 0, 1.6, 2)
      light.position.set(0, cylinderY + 0.06, -0.09)
      this.gunGroup.add(light)
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
    this.revealGlowLife = 2.6
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
    this.aimBlend = 0
    this.aimDuration = 0.85
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

  private shotFraming(shot: CameraShot): {
    position: THREE.Vector3
    lookAt: THREE.Vector3
    fov: number
  } {
    switch (shot) {
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
      case 'table':
      default:
        return {
          position: new THREE.Vector3(0, 3.62, 4.92),
          lookAt: new THREE.Vector3(0, 1.02, -0.62),
          fov: 48,
        }
    }
  }

  playShot(payload: ShotPayload): void {
    if (this.disposed) return
    const live = payload.chamber === 'live'
    const muzzleWorld = new THREE.Vector3()
    this.flash.getWorldPosition(muzzleWorld)
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
    this.muzzleLight.position.copy(muzzleWorld).sub(this.gunGroup.position)
    this.muzzleLight.color.setHex(live ? 0xffb060 : 0x8fb4c8)
    this.muzzleLight.intensity = live ? 26 : 4
    this.tween({
      duration: 0.22,
      onUpdate: (t) => {
        this.muzzleLight.intensity = (live ? 26 : 4) * (1 - t) ** 2
      },
    })

    const recoil = live ? 0.16 : 0.05
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

    this.shake(live ? 0.085 : 0.018, live ? 0.6 : 0.3)
  }

  playReload(): void {
    if (this.disposed) return
    const start = this.drum.rotation.z
    this.tween({
      duration: 0.7,
      onUpdate: (t) => {
        this.drum.rotation.z = start + t * Math.PI * 2
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
    this.composer.dispose()
    this.renderer.dispose()
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

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
    this.updateGunAim(dt)
    this.updateItems(dt)
    this.updateCards(dt)
    this.updateCamera(dt)
    this.textures.crt.needsUpdate = false
    this.composer.render(dt)
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
    this.shakeStrength = Math.max(this.shakeStrength, strength)
    this.shakeDuration = Math.max(this.shakeDuration, duration)
    this.shakeTime = Math.max(this.shakeTime, duration)
  }

  private updateCamera(dt: number): void {
    if (this.cameraBlend < 1) {
      this.cameraBlend = Math.min(1, this.cameraBlend + dt / this.cameraBlendDuration)
      const eased = easeInOutCubic(this.cameraBlend)
      this.cameraBase.lerpVectors(this.cameraFrom, this.cameraTo, eased)
      this.cameraLookAt.lerpVectors(this.lookFrom, this.lookTo, eased)
      const fov = this.fovFrom + (this.fovTo - this.fovFrom) * eased
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = fov
        this.camera.updateProjectionMatrix()
      }
    }

    const breathe = Math.sin(this.elapsed * 0.62) * 0.012
    let sx = 0
    let sy = 0
    let sz = 0
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt)
      const decay = this.shakeTime / Math.max(0.001, this.shakeDuration)
      const amp = this.shakeStrength * decay * decay
      sx = (Math.random() - 0.5) * amp * 2
      sy = (Math.random() - 0.5) * amp * 2
      sz = (Math.random() - 0.5) * amp
      if (this.shakeTime === 0) this.shakeStrength = 0
    }
    const drift = this.shot === 'table' ? 1 : 0.22
    this.camera.position.set(
      this.cameraBase.x + Math.sin(this.elapsed * 0.21) * 0.035 * drift + sx,
      this.cameraBase.y + breathe * drift + sy,
      this.cameraBase.z + Math.cos(this.elapsed * 0.17) * 0.02 * drift + sz,
    )
    if (this.aimBlend < 1 && this.shot === 'execute') {
      this.aimBlend = Math.min(1, this.aimBlend + dt / Math.max(0.001, this.aimDuration))
    }
    this.spaceLook()
  }

  private updateGunAim(dt: number): void {
    const targetYaw =
      this.shot === 'execute' && this.aimBlend > 0
        ? this.aimTarget === 'player'
          ? this.gunRestYaw + Math.PI * 0.86
          : this.gunRestYaw - 0.18
        : this.gunRestYaw
    const currentYaw = this.gunGroup.rotation.y
    const nextYaw = currentYaw + (targetYaw - currentYaw) * Math.min(1, dt * 4.5)
    this.gunGroup.rotation.y = nextYaw
    if (this.revealGlowLife > 0) {
      this.revealGlowLife = Math.max(0, this.revealGlowLife - dt)
      if (this.revealGlow) {
        const pulse = 0.78 + Math.sin(this.elapsed * 6.5) * 0.22
        const fade = Math.min(1, this.revealGlowLife)
        this.revealGlow.material.opacity = 0.46 * pulse * fade
        this.revealGlow.scale.setScalar(1.24 * (0.94 + pulse * 0.08))
        if (this.revealLight) this.revealLight.intensity = 2.2 * pulse * fade
      }
    } else if (this.revealLight) {
      this.revealLight.intensity = 0
    }
  }

  private spaceLook(): void {
    const look = this.scratchVector
    look.copy(this.cameraLookAt)
    look.x += Math.sin(this.elapsed * 0.27) * 0.02
    look.y += Math.sin(this.elapsed * 0.33) * 0.012
    this.camera.lookAt(look)
  }

  private updateLighting(): void {
    const fade = 0.93 + Math.sin(this.elapsed * 7.1) * 0.03 + Math.sin(this.elapsed * 17.3) * 0.02
    this.spot.intensity = 165 * fade
    this.spot.position.x = -0.45 + Math.sin(this.elapsed * 0.9) * 0.09
    this.spot.position.z = 0.15 + Math.cos(this.elapsed * 0.72) * 0.07
    this.lampRig.rotation.z = Math.sin(this.elapsed * 0.9) * 0.05
    this.lampRig.rotation.x = Math.cos(this.elapsed * 0.72) * 0.035
    const crtPulse = 0.85 + Math.sin(this.elapsed * 11) * 0.06 + Math.random() * 0.05
    this.crtLight.intensity = 1.5 * crtPulse
    this.crtScreen.material.opacity = 0.92 + Math.sin(this.elapsed * 23) * 0.03
  }

  private updateBoss(dt: number): void {
    const breath = Math.sin(this.elapsed * 1.15) * 0.012
    this.bossGroup.position.y = breath
    this.bossParts.head.rotation.y = Math.sin(this.elapsed * 0.42) * 0.09
    this.bossParts.head.rotation.x = Math.sin(this.elapsed * 0.31) * 0.04
    this.bossParts.mask.position.y = this.bossParts.mask.userData.baseY as number
    this.bossParts.maskBack.position.y = this.bossParts.maskBack.userData.baseY as number
    const maskBob = Math.sin(this.elapsed * 1.6) * 0.004
    this.bossParts.mask.position.y += maskBob
    this.bossParts.maskBack.position.y += maskBob
    void dt
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
    return group
  }

  private buildLighting(): { spot: THREE.SpotLight; rim: THREE.PointLight; fill: THREE.PointLight } {
    const ambient = new THREE.HemisphereLight(0x2b3a4a, 0x120c08, 0.55)
    this.scene.add(ambient)

    const spot = new THREE.SpotLight(0xffc38a, 165, 18, 0.78, 0.82, 1.3)
    spot.position.set(-0.45, 5.1, 0.15)
    spot.castShadow = true
    spot.shadow.mapSize.set(2048, 2048)
    spot.shadow.camera.near = 0.6
    spot.shadow.camera.far = 14
    spot.shadow.bias = -0.0006
    spot.shadow.normalBias = 0.022
    spot.shadow.radius = 3
    spot.target.position.set(0, 0.9, -0.15)
    this.scene.add(spot, spot.target)

    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffc184,
      transparent: true,
      opacity: 0.014,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.disposableMaterials.add(coneMat)
    const coneGeo = new THREE.ConeGeometry(2.2, 4.1, 32, 1, true)
    this.disposableGeometries.add(coneGeo)
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.set(-0.4, 3.0, 0.1)
    this.roomGroup.add(cone)

    const rim = new THREE.PointLight(0xff7a3a, 13, 9, 1.7)
    rim.position.set(0.15, 2.85, -3.55)
    this.scene.add(rim)

    const fill = new THREE.PointLight(0x3d5a7a, 7, 9, 2)
    fill.position.set(-3.4, 1.9, 1.4)
    this.scene.add(fill)

    const rear = new THREE.PointLight(0x6a1a12, 6, 7, 2)
    rear.position.set(3.6, 1.2, -3.2)
    this.scene.add(rear)

    const face = new THREE.PointLight(0xffcba8, 2.6, 4.2, 2)
    face.position.set(0, 2.5, -1.15)
    this.scene.add(face)

    const torso = new THREE.PointLight(0x8fb0d0, 2.2, 3.4, 2)
    torso.position.set(0, 1.2, -1.0)
    this.scene.add(torso)

    const nearFill = new THREE.PointLight(0xffcf9f, 9, 8, 2)
    nearFill.position.set(0, 2.6, 3.4)
    this.scene.add(nearFill)

    const tableWash = new THREE.SpotLight(0xffd9b0, 26, 9, 0.95, 0.9, 1.2)
    tableWash.position.set(0, 6.2, 2.2)
    tableWash.target.position.set(0, 0.98, 0.6)
    this.scene.add(tableWash, tableWash.target)

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
    top.position.y = TABLE_TOP - 0.11
    top.castShadow = true
    top.receiveShadow = true
    this.tableGroup.add(top)

    const trimMat = makeStandardMaterial(0x241b16, 0.9, 0.4)
    this.disposableMaterials.add(trimMat)
    const trimGeo = new THREE.BoxGeometry(6.75, 0.06, 4.05)
    this.disposableGeometries.add(trimGeo)
    const trim = new THREE.Mesh(trimGeo, trimMat)
    trim.position.y = TABLE_TOP - 0.235
    trim.castShadow = true
    this.tableGroup.add(trim)

    const legGeo = new THREE.CylinderGeometry(0.12, 0.09, TABLE_TOP - 0.24, 10)
    this.disposableGeometries.add(legGeo)
    for (const x of [-2.9, 2.9]) {
      for (const z of [-1.6, 1.6]) {
        const leg = new THREE.Mesh(legGeo, trimMat)
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
    ring.rotation.x = -Math.PI / 2
    ring.position.set(0, TABLE_TOP + 0.002, -0.05)
    this.tableGroup.add(ring)
  }

  private buildBoss(): TorsoParts {
    this.bossGroup.position.set(0, -0.1, -2.2)
    this.bossGroup.scale.setScalar(0.82)

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

  private buildRevolver(): {
    root: THREE.Group
    drum: THREE.Group
    muzzleLight: THREE.PointLight
    flash: THREE.Sprite
  } {
    const root = new THREE.Group()
    root.position.set(0.0, TABLE_TOP + 0.075, 0.08)

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

  private buildCrt(): { screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight } {
    const group = new THREE.Group()
    group.position.set(-0.96, TABLE_TOP + 0.005, 1.24)
    // 屏幕朝向玩家相机，保证 CRT 内容可读
    group.rotation.y = 0.52
    group.scale.setScalar(0.9)
    this.tableGroup.add(group)

    const caseMat = new THREE.MeshStandardMaterial({
      color: 0x35302a,
      metalness: 0.35,
      roughness: 0.68,
    })
    this.disposableMaterials.add(caseMat)
    const caseGeo = new THREE.BoxGeometry(0.72, 0.56, 0.5)
    this.disposableGeometries.add(caseGeo)
    const body = new THREE.Mesh(caseGeo, caseMat)
    body.position.y = 0.28
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
    group.rotation.x = -0.06

    const frontMat = new THREE.MeshStandardMaterial({
      color: 0x2a251f,
      metalness: 0.2,
      roughness: 0.8,
    })
    this.disposableMaterials.add(frontMat)
    const bezelGeo = new THREE.BoxGeometry(0.66, 0.5, 0.03)
    this.disposableGeometries.add(bezelGeo)
    const bezel = new THREE.Mesh(bezelGeo, frontMat)
    bezel.position.set(0, 0.3, 0.255)
    group.add(bezel)

    const screenMat = new THREE.MeshBasicMaterial({
      map: this.textures.crt,
      toneMapped: false,
      transparent: true,
      opacity: 0.98,
      color: 0xd6ffe2,
    })
    this.disposableMaterials.add(screenMat)
    const screenGeo = new THREE.PlaneGeometry(0.5, 0.375)
    this.disposableGeometries.add(screenGeo)
    const screen = new THREE.Mesh(screenGeo, screenMat)
    screen.position.set(0, 0.315, 0.272)
    group.add(screen)

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x90ffb8,
      transparent: true,
      opacity: 0.05,
      roughness: 0.08,
      metalness: 0.1,
      emissiveIntensity: 0.15,
    })
    this.disposableMaterials.add(glassMat)
    const glass = new THREE.Mesh(screenGeo, glassMat)
    glass.position.set(0, 0.315, 0.279)
    group.add(glass)

    const knobGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.03, 12)
    this.disposableGeometries.add(knobGeo)
    for (const x of [-0.24, -0.17]) {
      const knob = new THREE.Mesh(knobGeo, brassMaterial(this.disposableMaterials))
      knob.rotation.x = Math.PI / 2
      knob.position.set(x, 0.095, 0.27)
      group.add(knob)
    }

    const ledGeo = new THREE.SphereGeometry(0.011, 8, 6)
    this.disposableGeometries.add(ledGeo)
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x6cff9a })
    this.disposableMaterials.add(ledMat)
    const led = new THREE.Mesh(ledGeo, ledMat)
    led.position.set(0.265, 0.095, 0.27)
    group.add(led)

    const light = new THREE.PointLight(0x4dff8f, 3.4, 3.2, 2)
    light.position.set(0, 0.33, 0.55)
    group.add(light)

    return { screen, light }
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
      // Keep the row inside the near-right quadrant: the CRT owns the left corner.
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
    this.buildItemMesh(item, group, materials)
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

  private paintCrt(snapshot: GameSnapshot): void {
    const data: CrtData = {
      level: snapshot.levelIndex + 1,
      levelName: snapshot.level.name,
      playerHp: snapshot.player.hp,
      playerMax: snapshot.player.maxHp,
      bossHp: snapshot.boss.hp,
      bossMax: snapshot.boss.maxHp,
      live: snapshot.cylinder.live,
      blank: snapshot.cylinder.blank,
      multiplier: 1 + snapshot.damageBonus,
      phase: PHASE_LABEL[snapshot.phase] ?? snapshot.phase,
      turn: snapshot.turn === 'player' ? '你' : snapshot.turn === 'boss' ? '它' : '—',
      hourglass: snapshot.hourglassActive,
    }
    const key = JSON.stringify(data)
    if (key === this.lastCrtKey) return
    this.lastCrtKey = key
    this.textures.paintCrt(data)
  }

  private applyOverride(key: string, texture: THREE.Texture): void {
    if (key === 'table') {
      const top = this.tableGroup.children[0]
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
