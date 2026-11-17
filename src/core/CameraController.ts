import gsap from 'gsap'
import * as THREE from 'three'
import type { SceneManager } from './SceneManager'

export type CameraPresetId = 'table' | 'opponent' | 'aim'

interface CameraPreset {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
  /** 鼠标微幅跟随的强度倍率，0 表示完全锁定 */
  sway: number
}

/**
 * 【3D 核心底座 · 队员禁止随意修改】
 * 预设运镜是跨模块 UI 契约：HUD 与小游戏只能按 id 调用，不得自己算机位。
 */
const PRESETS: Record<CameraPresetId, CameraPreset> = {
  table: {
    position: [0, 1.95, 1.62],
    target: [0, 0.02, -0.2],
    fov: 52,
    sway: 0.35,
  },
  opponent: {
    position: [0, 1.3, 2.5],
    target: [0, 0.95, -3.2],
    fov: 60,
    sway: 1,
  },
  aim: {
    position: [0, 1.1, 1.0],
    target: [0, 0.02, -1.5],
    fov: 44,
    sway: 0.4,
  },
}

const SWAY_LIMIT = 0.045

export class CameraController {
  private readonly lookTarget = new THREE.Vector3()
  private readonly desired = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 58 }
  private readonly pointer = new THREE.Vector2()
  private readonly pointerSmooth = new THREE.Vector2()
  private swayScale = 1
  private preset: CameraPresetId = 'opponent'
  private tween: gsap.core.Timeline | null = null

  private readonly onPointerMove = (event: PointerEvent) => {
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      (event.clientY / window.innerHeight) * 2 - 1,
    )
  }

  private readonly onPointerLeave = () => this.pointer.set(0, 0)

  constructor(
    private readonly sceneManager: SceneManager,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    document.addEventListener('pointerleave', this.onPointerLeave)
  }

  get currentPreset(): CameraPresetId {
    return this.preset
  }

  /** GSAP 平滑切换镜头预设 */
  goto(preset: CameraPresetId, duration = 0.9): void {
    const config = PRESETS[preset]
    this.preset = preset
    this.swayScale = config.sway
    this.tween?.kill()
    const timeline = gsap.timeline({ defaults: { ease: 'power3.inOut', duration, overwrite: 'auto' } })
    timeline.to(this.desired.position, {
      x: config.position[0],
      y: config.position[1],
      z: config.position[2],
    }, 0)
    timeline.to(this.desired.target, {
      x: config.target[0],
      y: config.target[1],
      z: config.target[2],
    }, 0)
    timeline.to(this.desired, { fov: config.fov }, 0)
    this.tween = timeline
  }

  /** 瞬时应用预设（初始化用，无过渡） */
  snap(preset: CameraPresetId): void {
    const config = PRESETS[preset]
    this.preset = preset
    this.swayScale = config.sway
    this.desired.position.fromArray(config.position)
    this.desired.target.fromArray(config.target)
    this.desired.fov = config.fov
    this.applyFrame()
  }

  /** 每帧调用：鼠标阻尼 + 屏幕震动叠加 */
  update(dt: number): void {
    // 帧率无关的指数平滑：60fps 下约 0.18 的跟随速度
    const alpha = 1 - Math.exp(-12 * Math.min(dt, 0.05))
    this.pointerSmooth.lerp(this.pointer, alpha)
    this.applyFrame()
  }

  dispose(): void {
    this.tween?.kill()
    window.removeEventListener('pointermove', this.onPointerMove)
    document.removeEventListener('pointerleave', this.onPointerLeave)
  }

  private applyFrame(): void {
    const { camera, sceneManager } = this
    const swayX = -this.pointerSmooth.x * SWAY_LIMIT * this.swayScale
    const swayY = this.pointerSmooth.y * SWAY_LIMIT * 0.6 * this.swayScale

    camera.position.set(
      this.desired.position.x + swayX + sceneManager.shakeOffset.x,
      this.desired.position.y + swayY + sceneManager.shakeOffset.y,
      this.desired.position.z + sceneManager.shakeOffset.z,
    )
    this.lookTarget.set(
      this.desired.target.x + swayX * 2.2,
      this.desired.target.y + swayY * 2.2,
      this.desired.target.z,
    )
    camera.lookAt(this.lookTarget)

    if (Math.abs(camera.fov - this.desired.fov) > 0.01) {
      camera.fov = this.desired.fov
      camera.updateProjectionMatrix()
    }
  }
}
