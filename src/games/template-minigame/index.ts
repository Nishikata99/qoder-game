import gsap from 'gsap'
import * as THREE from 'three'
import type { Minigame, MinigameContext } from '../../core/GameRegistry'

/**
 * 【成员C/D 参考模板】最小可运行的标准 3D 桌面小游戏。
 *
 * 接入步骤：
 * 1. 复制本文件夹 → src/games/<your-game>/
 * 2. 改 id / title，build() 里往返回的 THREE.Group 塞你的道具
 * 3. 在 src/main.ts 的 register 列表里加上 new YourGame()
 * 4. 在 LobbyOverlay 的 games 数组里加一条菜单项
 *
 * 硬性约束（见 AGENTS.md）：
 * - 不要 new WebGLRenderer / PerspectiveCamera / Scene
 * - 不要直接改 SceneManager 的赌桌 mesh
 * - 胜负/扣血/震动一律走 context.bus.emit(...)；血量读写走 context.store
 * - 资源路径使用相对路径：`models/<game>/xxx.glb`
 */
export class TemplateMinigame implements Minigame {
  readonly id = 'template-minigame'
  readonly title = '模板 · 骷髅骰盅'

  private root: THREE.Group | null = null
  private cup: THREE.Group | null = null
  private context: MinigameContext | null = null
  private rolling = false
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()

  build(context: MinigameContext): THREE.Group {
    this.context = context
    const root = new THREE.Group()
    this.root = root

    const cup = new THREE.Group()
    cup.name = 'cup'
    cup.position.set(0, 0.16, -0.28)
    this.cup = cup
    root.add(cup)

    const leather = new THREE.MeshStandardMaterial({ color: '#3a1519', roughness: 0.7, metalness: 0.1 })
    const rimMaterial = new THREE.MeshStandardMaterial({ color: '#a37a34', roughness: 0.3, metalness: 0.9 })

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.28, 32, 1, true), leather)
    body.castShadow = true
    body.receiveShadow = true
    cup.add(body)

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), leather)
    cap.position.y = 0.14
    cap.scale.y = 0.7
    cap.castShadow = true
    cup.add(cap)

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 10, 40), rimMaterial)
    rim.rotation.x = Math.PI / 2
    rim.position.y = -0.14
    cup.add(rim)

    const dice = new THREE.Group()
    dice.name = 'dice'
    dice.position.set(0, 0, -0.28)
    root.add(dice)
    for (let i = 0; i < 3; i += 1) {
      const die = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.055, 0.055),
        new THREE.MeshStandardMaterial({ color: '#e8dfd2', roughness: 0.5, metalness: 0.05 }),
      )
      die.position.set((i - 1) * 0.055, 0.03, (i % 2) * 0.035)
      die.rotation.set(i, i * 0.7, i * 0.3)
      die.castShadow = true
      dice.add(die)
    }

    window.addEventListener('pointerdown', this.onPointerDown)
    context.bus.emit('ui:subtitle', { text: '点击骰盅摇晃 · 示例模块', duration: 3.2 })
    return root
  }

  update(_dt: number, elapsed: number): void {
    if (!this.cup || this.rolling) return
    this.cup.position.y = 0.16 + Math.sin(elapsed * 1.2) * 0.004
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown)
    this.root = null
    this.cup = null
    this.context = null
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const root = this.root
    const context = this.context
    if (!root || !context || this.rolling) return
    if (!(event.target instanceof HTMLCanvasElement)) return

    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, context.sceneManager.camera)
    if (this.raycaster.intersectObject(root, true).length === 0) return
    this.shakeCup()
  }

  private shakeCup(): void {
    const cup = this.cup
    const context = this.context
    if (!cup || !context) return
    this.rolling = true
    context.cameraController.goto('aim', 0.5)

    const timeline = gsap.timeline({
      onComplete: () => {
        this.rolling = false
        context.cameraController.goto('table', 0.8)
      },
    })

    timeline.to(cup.position, { y: 0.26, duration: 0.22, ease: 'power2.out' })
    timeline.to(cup.rotation, { z: 0.22, duration: 0.14, yoyo: true, repeat: 5, ease: 'sine.inOut' })
    timeline.to(cup.rotation, { z: 0, duration: 0.18 })
    timeline.to(cup.position, { y: 0.16, duration: 0.24, ease: 'bounce.out' })

    timeline.add(() => {
      const total = Math.floor(Math.random() * 9) + 3
      const target: 'player' | 'opponent' = total >= 8 ? 'opponent' : 'player'
      context.bus.emit('ui:subtitle', { text: `骰子点数 ${total} · ${target === 'opponent' ? '对手' : '你'}承受结果`, duration: 2.6 })
      context.bus.emit('fx:shake', { intensity: 0.25, duration: 0.3 })

      if (total >= 8) {
        const { applied } = context.store.damage(target, 1)
        context.bus.emit('battle:damage', { side: target, amount: applied, reason: '骰盅' })
        context.store.nextTurn()
      }
    })
  }
}
