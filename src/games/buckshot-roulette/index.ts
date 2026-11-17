import gsap from 'gsap'
import * as THREE from 'three'
import type { Minigame, MinigameContext } from '../../core/GameRegistry'

/**
 * 【成员B · 恶魔轮盘】桌上生成 3D 霰弹枪与弹仓，点击扳机开火。
 * 逻辑只在这里：选出实弹/空包弹 → 通过 EventBus 汇报伤害与震动。
 * 主框架（HudOverlay / GameStore）负责扣血与 UI。
 *
 * public/models/buckshot-roulette/shotgun.glb  可替换程序化枪模
 * public/audio/buckshot-roulette/*.mp3         可放置上膛/空击/枪响
 */

interface Shell {
  live: boolean
  mesh: THREE.Mesh
}

export class BuckshotRouletteGame implements Minigame {
  readonly id = 'buckshot-roulette'
  readonly title = '恶魔轮盘 · 12 号霰弹'

  private root: THREE.Group | null = null
  private context: MinigameContext | null = null
  private gun: THREE.Group | null = null
  private hammer: THREE.Mesh | null = null
  private readonly shells: Shell[] = []
  private chamberIndex = 0
  private busy = false
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()

  build(context: MinigameContext): THREE.Group {
    this.context = context
    const root = new THREE.Group()
    this.root = root

    const gun = buildShotgun()
    gun.position.set(0.06, 0.1, 0.2)
    gun.rotation.set(0, -0.28, 0.03)
    gun.scale.setScalar(0.82)
    this.gun = gun
    root.add(gun)

    this.hammer = gun.getObjectByName('hammer') as THREE.Mesh | null

    const tray = new THREE.Group()
    tray.name = 'shellTray'
    root.add(tray)
    const count = 6
    for (let i = 0; i < count; i += 1) {
      const live = i % 2 === 0
      const mesh = createShell(live)
      mesh.scale.setScalar(0.9)
      const offset = i - (count - 1) / 2
      mesh.position.set(offset * 0.2, 0.06, -0.5 + Math.abs(offset) * 0.035)
      mesh.rotation.set(0, offset * 0.12, Math.PI / 2)
      tray.add(mesh)
      this.shells.push({ live, mesh })
    }

    window.addEventListener('pointerdown', this.onPointerDown)
    context.bus.emit('ui:subtitle', { text: '点击枪身扣动扳机 · 实弹造成 2 点伤害', duration: 3.8 })
    return root
  }

  update(_dt: number, elapsed: number): void {
    if (!this.gun || this.busy) return
    this.gun.position.y = 0.1 + Math.sin(elapsed * 1.4) * 0.006
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown)
    this.shells.length = 0
    this.gun = null
    this.hammer = null
    this.root = null
    this.context = null
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const root = this.root
    const context = this.context
    if (!root || !context || this.busy) return
    if (!(event.target instanceof HTMLCanvasElement)) return

    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, context.sceneManager.camera)
    if (this.raycaster.intersectObject(root, true).length === 0) return
    this.pullTrigger()
  }

  private pullTrigger(): void {
    const gun = this.gun
    const context = this.context
    const shell = this.shells[this.chamberIndex % this.shells.length]
    if (!gun || !context || !shell) return

    this.busy = true
    context.cameraController.goto('aim', 0.28)

    const timeline = gsap.timeline({
      onComplete: () => {
        this.busy = false
        context.cameraController.goto('table', 0.5)
      },
    })

    // 抬枪 → 扣锤 → 结果
    timeline.to(gun.rotation, { x: -0.18, duration: 0.18, ease: 'power2.out' }, 0)
    timeline.to(gun.position, { y: 0.2, z: 0.22, duration: 0.18, ease: 'power2.out' }, 0)
    if (this.hammer) {
      timeline.to(this.hammer.rotation, { x: -0.6, duration: 0.1, ease: 'power3.out' }, 0.16)
    }
    timeline.add(() => this.fire(shell), 0.3)
    timeline.to(gun.rotation, { x: 0.22, duration: 0.1, ease: 'power4.out' }, 0.32)

    this.chamberIndex += 1
  }

  private fire(shell: Shell): void {
    const gun = this.gun
    const context = this.context
    if (!gun || !context) return

    const target = context.store.snapshot.turn === 'player' ? 'opponent' : 'player'

    if (shell.live) {
      const muzzle = new THREE.Vector3(0, 0.02, -0.92)
      gun.localToWorld(muzzle)
      const flash = createMuzzleFlash()
      flash.position.copy(muzzle)
      context.sceneManager.tableRoot.add(flash)
      gsap.to(flash.scale, { x: 2.4, y: 2.4, z: 2.4, duration: 0.08, yoyo: true, repeat: 1 })
      gsap.to(flash.material as THREE.Material, {
        opacity: 0,
        duration: 0.22,
        onComplete: () => {
          context.sceneManager.tableRoot.remove(flash)
          flash.geometry.dispose()
          ;(flash.material as THREE.Material).dispose()
        },
      })

      const { applied } = context.store.damage(target, 2)
      context.bus.emit('battle:damage', { side: target, amount: applied, reason: '实弹' })
      context.bus.emit('fx:shake', { intensity: 0.5, duration: 0.5 })
      context.bus.emit('fx:flash', { color: '#ff5a3c' })
      context.bus.emit('ui:subtitle', {
        text: target === 'player' ? '实弹命中 · 你扣了血' : '实弹命中 · 对手扣了血',
        duration: 2.2,
      })
    } else {
      context.bus.emit('fx:shake', { intensity: 0.16, duration: 0.22 })
      context.bus.emit('ui:subtitle', { text: '咔哒 · 空包弹', duration: 1.8 })
    }

    gsap.to(shell.mesh.material as THREE.MeshStandardMaterial, {
      color: shell.live ? '#3a0d10' : '#2c2c2c',
      duration: 0.4,
    })
    gsap.to(shell.mesh.scale, { x: 0.8, y: 0.8, z: 0.8, duration: 0.3 })

    // 每两发换边，把回合交还给主框架
    if (this.chamberIndex % 2 === 1) context.store.nextTurn()
  }
}

function buildShotgun(): THREE.Group {
  const gun = new THREE.Group()
  gun.name = 'shotgun'

  const steel = new THREE.MeshStandardMaterial({ color: '#2b2b31', roughness: 0.38, metalness: 0.85 })
  const darkSteel = new THREE.MeshStandardMaterial({ color: '#17161a', roughness: 0.55, metalness: 0.7 })
  const wood = new THREE.MeshStandardMaterial({ color: '#4a2318', roughness: 0.72, metalness: 0.05 })

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.92, 18), steel)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 0.055, -0.42)
  barrel.castShadow = true
  gun.add(barrel)

  const underBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.6, 14), darkSteel)
  underBarrel.rotation.x = Math.PI / 2
  underBarrel.position.set(0, -0.03, -0.3)
  gun.add(underBarrel)

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.34), darkSteel)
  receiver.position.set(0, 0, 0.02)
  receiver.castShadow = true
  gun.add(receiver)

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.14, 0.42), wood)
  stock.position.set(0, -0.03, 0.34)
  stock.rotation.x = -0.18
  stock.castShadow = true
  gun.add(stock)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), wood)
  grip.position.set(0, -0.16, 0.2)
  grip.rotation.x = 0.32
  gun.add(grip)

  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.05), steel)
  hammer.name = 'hammer'
  hammer.position.set(0, 0.08, 0.16)
  gun.add(hammer)

  const triggerGuard = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 8, 20, Math.PI), steel)
  triggerGuard.position.set(0, -0.09, 0.1)
  triggerGuard.rotation.set(0, Math.PI / 2, Math.PI)
  gun.add(triggerGuard)

  return gun
}

function createShell(live: boolean): THREE.Mesh {
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.11, 14),
    new THREE.MeshStandardMaterial({
      color: live ? '#c22a2a' : '#3d5f6b',
      roughness: 0.42,
      metalness: live ? 0.25 : 0.55,
      emissive: live ? '#4a0606' : '#04161c',
      emissiveIntensity: 0.6,
    }),
  )
  shell.castShadow = true
  return shell
}

function createMuzzleFlash(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: 0.9 }),
  )
}
