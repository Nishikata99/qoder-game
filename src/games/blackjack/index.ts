import gsap from 'gsap'
import * as THREE from 'three'
import type { Minigame, MinigameContext } from '../../core/GameRegistry'

/**
 * 【成员A · 21点】在赌桌中央生成 3D 牌堆，按点击顺序发牌。
 * 只允许修改本文件夹；与主框架的交互仅通过 MinigameContext 暴露的 store/bus。
 *
 * public/models/blackjack/  可放置牌桌专属 .glb（如筹码塔）
 * public/audio/blackjack/   可放置发牌音效
 */

const CARD_W = 0.3
const CARD_H = 0.42
const CARD_T = 0.01

export class BlackjackGame implements Minigame {
  readonly id = 'blackjack'
  readonly title = '21 点 · 黑杰克'

  private root: THREE.Group | null = null
  private context: MinigameContext | null = null
  private readonly cards: THREE.Group[] = []
  private dealIndex = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly deckOrigin = new THREE.Vector3(0.78, 0, -0.62)

  build(context: MinigameContext): THREE.Group {
    this.context = context
    const root = new THREE.Group()
    this.root = root

    const deck = createDeck(CARD_W, CARD_H, CARD_T)
    deck.position.copy(this.deckOrigin)
    deck.rotation.y = -0.18
    root.add(deck)

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.075, 32),
      new THREE.MeshBasicMaterial({ color: '#d5303f', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.position.set(-0.35, 0.004, 0.05)
    root.add(marker)

    window.addEventListener('pointerdown', this.onPointerDown)
    context.bus.emit('ui:subtitle', { text: '点击筹码区发牌 · 21 点', duration: 3.5 })
    return root
  }

  update(_dt: number, elapsed: number): void {
    const deck = this.root?.children[0]
    if (deck) deck.rotation.z = Math.sin(elapsed * 0.7) * 0.012
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown)
    this.cards.length = 0
    this.root = null
    this.context = null
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const root = this.root
    const context = this.context
    if (!root || !context) return
    // 只有点在 3D 画布上才算数，避免菜单/HUD 点击误触
    if (!(event.target instanceof HTMLCanvasElement)) return

    this.pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, context.sceneManager.camera)
    const hit = this.raycaster.intersectObject(root, true)[0]
    if (!hit) return
    this.dealCard()
  }

  private dealCard(): void {
    const root = this.root
    if (!root) return

    const card = createCard(CARD_W, CARD_H, CARD_T, this.dealIndex % 2 === 0)
    card.position.copy(this.deckOrigin)
    card.position.y = CARD_T * 6
    root.add(card)
    this.cards.push(card)
    this.dealIndex += 1

    // 发牌落点：对手区在远侧一排、玩家区在近侧一排，各 5 个扇位
    const toPlayer = this.dealIndex % 2 === 1
    const slotIndex = Math.floor(this.cards.length / 2)
    const lane = slotIndex % 5
    const zBase = toPlayer ? 0.1 : -0.36
    const target = new THREE.Vector3(-0.5 + lane * 0.22, CARD_T * (slotIndex + 1) + 0.002, zBase)
    const rotation = toPlayer ? 0.1 : Math.PI - 0.1

    gsap.to(card.position, { ...target, duration: 0.48, ease: 'power2.out' })
    gsap.to(card.rotation, { y: rotation, z: (lane - 2) * 0.03, duration: 0.48, ease: 'power2.out' })

    this.context?.bus.emit('ui:subtitle', {
      text: toPlayer ? `发牌 → 你（第 ${slotIndex + 1} 张）` : `发牌 → 对手（第 ${slotIndex + 1} 张）`,
      duration: 1.2,
    })
  }
}

function createDeck(width: number, height: number, thickness: number): THREE.Group {
  const group = new THREE.Group()
  for (let i = 0; i < 14; i += 1) {
    const card = createCard(width, height, thickness, false)
    card.position.set((Math.random() - 0.5) * 0.012, i * thickness * 1.05, (Math.random() - 0.5) * 0.012)
    card.rotation.y = (Math.random() - 0.5) * 0.06
    group.add(card)
  }
  return group
}

let backTexture: THREE.CanvasTexture | null = null
let pipTexture: THREE.CanvasTexture | null = null

function getBackTexture(): THREE.CanvasTexture {
  backTexture ??= createBackTexture()
  return backTexture
}

function getPipTexture(): THREE.CanvasTexture {
  pipTexture ??= createPipTexture()
  return pipTexture
}

function createCard(width: number, height: number, thickness: number, faceUp: boolean): THREE.Group {
  const group = new THREE.Group()

  const faceMaterial = new THREE.MeshStandardMaterial({
    color: '#e8dfd2',
    roughness: 0.72,
    metalness: 0.02,
    map: getPipTexture(),
  })
  const backMaterial = new THREE.MeshStandardMaterial({
    color: '#8a3a44',
    roughness: 0.72,
    metalness: 0.04,
    map: getBackTexture(),
  })
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#cfc4b4', roughness: 0.85 })

  // BoxGeometry 材质顺序：+x, -x, +y(顶), -y(底), +z, -z
  // 牌平躺时，从正上方看到的是 +y 面
  const top = faceUp ? faceMaterial : backMaterial
  const bottom = faceUp ? backMaterial : faceMaterial
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, height), [
    edgeMaterial,
    edgeMaterial,
    top,
    bottom,
    edgeMaterial,
    edgeMaterial,
  ])
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  return group
}

function createBackTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#5c0f1b'
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(232, 223, 210, 0.28)'
    ctx.lineWidth = 2
    for (let i = -size; i < size * 2; i += 14) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + size, size)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i, size)
      ctx.lineTo(i + size, 0)
      ctx.stroke()
    }
  }
  return new THREE.CanvasTexture(canvas)
}

function createPipTexture(): THREE.CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#efe6d8'
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#8f1f2e'
    ctx.font = 'bold 64px Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('A', size / 2, size / 2)
  }
  return new THREE.CanvasTexture(canvas)
}
