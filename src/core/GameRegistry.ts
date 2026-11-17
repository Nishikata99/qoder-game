import gsap from 'gsap'
import * as THREE from 'three'
import type { CameraController } from './CameraController'
import type { EventBus } from './EventBus'
import type { GameStore } from './GameStore'
import type { SceneManager } from './SceneManager'

/** 传给每个小游戏的环境依赖，禁止自带 renderer / 摄像机 */
export interface MinigameContext {
  readonly sceneManager: SceneManager
  readonly cameraController: CameraController
  readonly store: GameStore
  readonly bus: EventBus
}

/**
 * 【跨层契约】小游戏模块必须实现的接口。
 * - build 只负责生成挂在自己 THREE.Group 下的内容，坐标系原点位于桌面中心
 * - build 可以 async（加载 .glb 时返回 Promise），registry 会等待并处理卸载竞态
 * - dispose 只需释放自己额外持有的资源（贴图、音频），Group 内几何体由 registry 回收
 */
export interface Minigame {
  readonly id: string
  readonly title: string
  build(context: MinigameContext): THREE.Group | Promise<THREE.Group>
  update?(dt: number, elapsed: number): void
  dispose?(): void
}

interface MountedGame {
  game: Minigame
  group: THREE.Group
  stopFrame: () => void
}

/**
 * 【3D 核心底座 · 队员禁止随意修改】
 * 唯一允许把 THREE.Group 挂到赌桌上的入口。
 * 同一时间只允许一个游戏处于挂载状态，切换时先卸载旧游戏。
 */
export class GameRegistry {
  private readonly games = new Map<string, Minigame>()
  private mounted: MountedGame | null = null
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly context: MinigameContext) {}

  register(...games: Minigame[]): void {
    for (const game of games) this.games.set(game.id, game)
  }

  list(): Array<{ id: string; title: string }> {
    return [...this.games.values()].map(({ id, title }) => ({ id, title }))
  }

  get mountedId(): string | null {
    return this.mounted?.game.id ?? null
  }

  /** 串行化挂载，避免快速连点造成两个游戏同时存在 */
  mount(id: string): Promise<void> {
    this.pending = this.pending.then(() => this.mountInternal(id)).catch((error: unknown) => {
      console.error('[GameRegistry] 挂载失败', error)
      this.context.bus.emit('ui:subtitle', { text: '模块加载失败，请查看控制台', duration: 3 })
    })
    return this.pending
  }

  unmount(): Promise<void> {
    this.pending = this.pending.then(() => this.unmountInternal()).catch((error: unknown) => {
      console.error('[GameRegistry] 卸载失败', error)
    })
    return this.pending
  }

  async switchTo(id: string): Promise<void> {
    await this.unmount()
    await this.mount(id)
  }

  private async mountInternal(id: string): Promise<void> {
    if (this.mounted?.game.id === id) return
    await this.unmountInternal()

    const game = this.games.get(id)
    if (!game) {
      console.warn(`[GameRegistry] 未注册的小游戏: ${id}`)
      return
    }

    const group = await game.build(this.context)
    // build 期间可能被新的挂载请求顶掉
    if (this.mounted) {
      disposeObject3D(group)
      game.dispose?.()
      return
    }

    group.name = `minigame:${id}`
    group.userData.gameId = id
    // 入场动画只做缩放与微升，不改变道具组在桌面上的落点
    group.scale.setScalar(0.001)
    this.context.sceneManager.tableRoot.add(group)

    gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.4)' })

    const stopFrame = game.update
      ? this.context.sceneManager.onFrame((dt, elapsed) => game.update?.(dt, elapsed))
      : () => {}

    this.mounted = { game, group, stopFrame }
    this.context.store.setActiveGame(id)
    this.context.bus.emit('game:mounted', { id, title: game.title })
    this.context.bus.emit('ui:subtitle', { text: game.title, duration: 2.4 })
  }

  private async unmountInternal(): Promise<void> {
    const current = this.mounted
    if (!current) return
    this.mounted = null
    current.stopFrame()

    await new Promise<void>((resolve) => {
      const timeline = gsap.timeline({ onComplete: () => resolve() })
      timeline.to(current.group.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.28, ease: 'power2.in' }, 0)
    })

    this.context.sceneManager.tableRoot.remove(current.group)
    disposeObject3D(current.group)
    current.game.dispose?.()
    this.context.store.setActiveGame(null)
  }
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
  })
}
