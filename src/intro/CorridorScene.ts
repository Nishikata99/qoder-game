import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { SoundEngine } from '../audio/SoundEngine'
import { TextureFactory } from '../scene/TextureFactory'

// 紧张探索步速：10.4m / 11s ≈ 0.95m/s，sine 缓动峰值 ≈1.5m/s
const WALK_SECONDS = 11
const WALK_END_Z = -10.4
const OPEN_SECONDS = 1.1
const GLITCH_SECONDS = 1.2
const BLACK_SECONDS = 1.0

const CorridorCrtShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    glitch: { value: 0 },
    blackout: { value: 0 },
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
    uniform float time;
    uniform float glitch;
    uniform float blackout;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec2 uv = vUv;
      float tear = step(0.995 - glitch * 0.08, rand(vec2(floor(uv.y * 90.0), floor(time * 17.0))));
      uv.x += tear * (rand(vec2(time, uv.y)) - 0.5) * 0.12 * glitch;
      float ab = 0.0015 + glitch * 0.008;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + vec2(ab, 0.0)).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - vec2(ab, 0.0)).b;
      float scan = 1.0 - (0.5 + 0.5 * sin(uv.y * 900.0)) * (0.08 + glitch * 0.35);
      col *= scan;
      col += (rand(uv * (time + 0.01)) - 0.5) * (0.02 + glitch * 0.12);
      float vig = smoothstep(0.95, 0.35, distance(uv, vec2(0.5)));
      col *= mix(0.35, 1.0, vig);
      col = mix(col, vec3(0.0), blackout);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

type Phase = 'loading' | 'ready' | 'walk' | 'choose' | 'openingL' | 'glitch' | 'black' | 'done'

interface CorridorCallbacks {
  readonly onReady: () => void
  readonly onDoorPhase: () => void
  readonly onComplete: () => void
  /** 行走途中的独白字幕：text 为 null 表示到点收起 */
  readonly onWalkLine: (text: string | null) => void
}

/** 行走字幕时间表（秒，相对 beginWalk）：血契动机 → 21 袋底注 → 临近双门 */
const WALK_LINES: ReadonlyArray<{ at: number; end: number; text: string; sfx?: 'paperRustle' | 'lowThump' }> = [
  { at: 1.0, end: 4.3, text: '手里只剩半张血契。另一半，被小棠带进了这底下。', sfx: 'paperRustle' },
  { at: 5.0, end: 8.2, text: '她替我签了名，进门凑那二十一袋血。' },
  { at: 8.8, end: 10.8, text: '尽头有两扇铁门。', sfx: 'lowThump' },
]

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

/** 梦核走廊序章：独立 Three 场景，右门 CRT 故障黑场后回调，交由 App 接进入场导演层 */
export class CorridorScene {
  private readonly canvas: HTMLCanvasElement
  private readonly sound: SoundEngine
  private readonly callbacks: CorridorCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly textures = new TextureFactory()
  private dust: THREE.Points | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly composer: EffectComposer
  private readonly crtPass: ShaderPass
  private readonly lamp = new THREE.PointLight(0xff9e52, 20, 14, 2)
  private readonly resizeObserver: ResizeObserver
  private doorPivotL: THREE.Object3D | null = null
  private doorPivotR: THREE.Object3D | null = null
  private phase: Phase = 'loading'
  private phaseTime = 0
  private elapsed = 0
  private lastTs: number | null = null
  private rafId: number | null = null
  private disposed = false
  private jitterY = 0
  private gazeX = 0
  private gazeY = 1.5
  private openFrom = 0
  private openFromL = 0
  private walkLineIndex = 0
  private walkLineOpen = false

  constructor(canvas: HTMLCanvasElement, sound: SoundEngine, callbacks: CorridorCallbacks) {
    this.canvas = canvas
    this.sound = sound
    this.callbacks = callbacks
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.05, 40)
    this.camera.position.set(0, 1.6, 0)
    this.scene.fog = new THREE.FogExp2(0x030504, 0.085)
    this.scene.add(new THREE.HemisphereLight(0x1a2018, 0x05060a, 0.22))
    this.lamp.position.set(0, 2.45, -12)
    this.lamp.castShadow = true
    this.lamp.shadow.mapSize.set(512, 512)
    this.lamp.shadow.bias = -0.002
    this.scene.add(this.lamp)
    const fill = new THREE.PointLight(0x5a728f, 2.2, 10, 2)
    fill.position.set(0, 2.4, -1)
    this.scene.add(fill)
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.crtPass = new ShaderPass(CorridorCrtShader)
    this.composer.addPass(this.crtPass)
    this.composer.addPass(new OutputPass())
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
  }

  start(): void {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/corridor.glb`, (gltf) => {
      if (this.disposed) {
        this.disposeObject(gltf.scene)
        return
      }
      this.scene.add(gltf.scene)
      this.doorPivotL = gltf.scene.getObjectByName('DoorPivotL') ?? null
      this.doorPivotR = gltf.scene.getObjectByName('DoorPivotR') ?? null
      this.retexture(gltf.scene)
      this.buildAtmosphere()
      if (this.phase === 'loading') {
        this.phase = 'ready'
        this.callbacks.onReady()
      }
    })
    this.rafId = requestAnimationFrame(this.tick)
  }

  /** 「开始」点击后才起走：音频已在 App 解锁，此时才开底噪 */
  beginWalk(): void {
    if (this.phase !== 'ready') return
    this.sound.startCorridorDrone()
    this.phase = 'walk'
    this.phaseTime = 0
    this.walkLineIndex = 0
    this.walkLineOpen = false
  }

  chooseDoor(side: 'L' | 'R'): void {
    if (this.phase !== 'choose' && this.phase !== 'openingL') return
    if (side === 'L') {
      // 别馆封契中：只给开门动画与落锁声，不转场；DLC 接入时替换此分支即可
      this.phase = 'openingL'
      this.phaseTime = 0
      this.openFromL = this.doorPivotL?.rotation.y ?? 0
      this.sound.playDoorCreak()
      this.sound.playDoorLock()
      return
    }
    this.phase = 'glitch'
    this.phaseTime = 0
    this.openFrom = this.doorPivotR?.rotation.y ?? 0
    this.sound.playDoorCreak()
    this.sound.playTinnitus()
    this.sound.setCorridorDroneLevel(3.2, 0.6)
  }

  private readonly tick = (ts: number): void => {
    if (this.disposed) return
    this.rafId = requestAnimationFrame(this.tick)
    if (this.lastTs === null) {
      this.lastTs = ts
      return
    }
    const dt = Math.min(0.05, (ts - this.lastTs) / 1000)
    this.lastTs = ts
    this.elapsed += dt
    this.phaseTime += dt

    // 呼吸浮动 + 随机游走抖动（比逐帧白噪声柔和）
    this.jitterY = THREE.MathUtils.clamp(this.jitterY + (Math.random() - 0.5) * 0.0012, -0.012, 0.012)
    const breathe = Math.sin(this.elapsed * 2.1) * 0.012 + this.jitterY
    const glitch = this.crtPass.uniforms.glitch!.value as number

    if (this.phase === 'walk') {
      const t = Math.min(1, this.phaseTime / WALK_SECONDS)
      this.updateWalkLines()
      this.camera.position.z = WALK_END_Z * easeInOutSine(t)
      // 步态对齐 0.95m/s：约 1.65 步/s 的碎步、左右换重心 + 一点失衡漂移
      this.camera.position.x = Math.sin(this.elapsed * 5.2) * 0.035 + Math.sin(this.elapsed * 1.1) * 0.02
      const stepBob = Math.abs(Math.sin(this.elapsed * 5.2)) * 0.008
      this.camera.position.y = 1.6 + breathe + stepBob
      // 紧张张望：左右门、天花板缓慢游移，最后 1.2s 缓慢回正
      const recentre = THREE.MathUtils.smoothstep(this.phaseTime, WALK_SECONDS - 1.3, WALK_SECONDS - 0.1)
      const amp = 1 - recentre
      const targetX = (Math.sin(this.elapsed * 0.55) * 0.5 + Math.sin(this.elapsed * 0.23 + 1.1) * 0.3) * 4 * amp
      const targetY = 1.5 + (Math.sin(this.elapsed * 0.42 + 0.7) * 0.5 + Math.sin(this.elapsed * 0.19) * 0.3) * 2.5 * amp
      const k = Math.min(1, dt * 1.6)
      this.gazeX += (targetX - this.gazeX) * k
      this.gazeY += (targetY - this.gazeY) * k
      this.camera.lookAt(this.gazeX, this.gazeY, -14)
      this.camera.rotateZ(Math.sin(this.elapsed * 1.1) * 0.015)
      if (t >= 1) {
        this.phase = 'choose'
        this.phaseTime = 0
        this.callbacks.onDoorPhase()
      }
    } else if (this.phase === 'choose' || this.phase === 'openingL') {
      this.camera.position.y = 1.6 + breathe
      const k = Math.min(1, dt * 1.6)
      this.gazeX += (0 - this.gazeX) * k
      this.gazeY += (1.5 - this.gazeY) * k
      this.camera.lookAt(this.gazeX, this.gazeY, -14)
      if (this.phase === 'openingL' && this.doorPivotL) {
        const t = Math.min(1, this.phaseTime / OPEN_SECONDS)
        this.doorPivotL.rotation.y = this.openFromL + easeInOutCubic(t) * 1.85
      }
    } else if (this.phase === 'glitch') {
      const t = Math.min(1, this.phaseTime / GLITCH_SECONDS)
      this.crtPass.uniforms.glitch!.value = t
      this.camera.position.y = 1.6 + breathe + (Math.random() - 0.5) * 0.05 * t
      this.camera.lookAt(this.gazeX, this.gazeY, -14)
      this.camera.rotateZ((Math.random() - 0.5) * 0.06 * t)
      if (this.doorPivotR) {
        const open = Math.min(1, this.phaseTime / OPEN_SECONDS)
        this.doorPivotR.rotation.y = this.openFrom - easeInOutCubic(open) * 1.85
      }
      if (t >= 1) {
        this.phase = 'black'
        this.phaseTime = 0
      }
    } else if (this.phase === 'black') {
      const t = Math.min(1, this.phaseTime / BLACK_SECONDS)
      this.crtPass.uniforms.blackout!.value = t
      if (t >= 1) {
        this.phase = 'done'
        this.callbacks.onComplete()
      }
    }

    this.lamp.intensity = 20 * (0.9 + Math.random() * 0.1) * (1 - glitch * 0.4)
    if (this.dust) {
      this.dust.rotation.y = Math.sin(this.elapsed * 0.05) * 0.03
      this.dust.position.y = Math.sin(this.elapsed * 0.3) * 0.05
    }
    this.crtPass.uniforms.time!.value = this.elapsed
    this.composer.render()
  }

  private retexture(root: THREE.Object3D): void {
    const wallTex = this.textures.get('corridor-wall')
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping
    wallTex.repeat.set(4, 1)
    const floorTex = this.textures.get('corridor-floor')
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
    floorTex.repeat.set(2, 12)
    const doorTex = this.textures.get('corridor-door')
    const rustTex = this.textures.get('corridor-rust')
    rustTex.wrapS = rustTex.wrapT = THREE.RepeatWrapping
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, bumpMap: wallTex, bumpScale: 0.03, roughness: 0.96 })
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 0.02, roughness: 0.8 })
    const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, bumpMap: doorTex, bumpScale: 0.02, roughness: 0.85 })
    const rustMat = new THREE.MeshStandardMaterial({ map: rustTex, bumpMap: rustTex, bumpScale: 0.015, roughness: 0.62, metalness: 0.45 })
    const ceilMat = new THREE.MeshStandardMaterial({ map: wallTex, color: 0x777777, roughness: 0.96 })
    const replaced = new Set<THREE.Material>()
    root.traverse((object) => {
      if (object.name.startsWith('Peel')) {
        // 几何剥片太「剪纸」，剥落感全部交给贴图
        object.visible = false
        return
      }
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      if (!(object.material instanceof THREE.Material)) return
      const name = object.material.name
      if (name === 'MAT_Wall_Peeling' || name === 'MAT_Wall_Stain') {
        replaced.add(object.material)
        object.material = wallMat
      } else if (name === 'MAT_Floor_Damp') {
        replaced.add(object.material)
        object.material = floorMat
      } else if (name === 'MAT_Ceiling') {
        replaced.add(object.material)
        object.material = ceilMat
      } else if (name === 'MAT_Door_Wood' || name === 'MAT_Door_Wood_B') {
        replaced.add(object.material)
        object.material = doorMat
      } else if (name === 'MAT_Frame' || name === 'MAT_RustPipe') {
        replaced.add(object.material)
        object.material = rustMat
      }
    })
    for (const material of replaced) material.dispose()
  }

  private buildAtmosphere(): void {
    const coneGeo = new THREE.ConeGeometry(1.1, 2.45, 24, 1, true)
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffc084,
      transparent: true,
      opacity: 0.045,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const cone = new THREE.Mesh(coneGeo, coneMat)
    cone.position.set(0, 1.22, -12)
    this.scene.add(cone)

    const count = 120
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 2.2
      positions[i * 3 + 1] = Math.random() * 2.8 + 0.2
      positions[i * 3 + 2] = -Math.random() * 13
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const dustMat = new THREE.PointsMaterial({
      color: 0x9a8f7a,
      size: 0.02,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })
    this.dust = new THREE.Points(dustGeo, dustMat)
    this.scene.add(this.dust)

    // 积水：只借吊灯反光的湿亮斑
    const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0a0d0c, roughness: 0.08, metalness: 0.55 })
    for (const [x, z, sx, sz] of [
      [-0.45, -3.2, 0.7, 1.1],
      [0.5, -7.6, 0.9, 1.4],
      [-0.2, -11.2, 0.6, 0.8],
    ] as const) {
      const puddle = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), puddleMat)
      puddle.rotation.x = -Math.PI / 2
      puddle.position.set(x, 0.006, z)
      puddle.receiveShadow = true
      this.scene.add(puddle)
    }
  }

  private updateWalkLines(): void {
    const line = WALK_LINES[this.walkLineIndex]
    if (!line) {
      if (this.walkLineOpen) {
        this.walkLineOpen = false
        this.callbacks.onWalkLine(null)
      }
      return
    }
    if (!this.walkLineOpen && this.phaseTime >= line.at) {
      this.walkLineOpen = true
      this.callbacks.onWalkLine(line.text)
      if (line.sfx === 'paperRustle') this.sound.playPaperRustle()
      else if (line.sfx === 'lowThump') this.sound.playLowThump()
      return
    }
    if (this.walkLineOpen && this.phaseTime >= line.end) {
      this.walkLineOpen = false
      this.walkLineIndex += 1
      this.callbacks.onWalkLine(null)
    }
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.rafId !== null) cancelAnimationFrame(this.rafId)
    this.resizeObserver.disconnect()
    this.sound.stopCorridorDrone(0.4)
    this.disposeObject(this.scene)
    this.crtPass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
