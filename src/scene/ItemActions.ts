import * as THREE from 'three'
import type { ActorId, Card, GameEvent, GameSnapshot, ItemId } from '../game/GameEngine'

export const ITEM_ACTION_TIMINGS: Record<ItemId, { start: number; contact: number; commit: number; end: number; release: number }> = {
  sedative: { start: 0.8, contact: 1.2, commit: 2.8, end: 3.6, release: 3.1 },
  dagger: { start: 0.8, contact: 1.25, commit: 2.7, end: 3.8, release: 3.3 },
  magnifier: { start: 0.6, contact: 0.9, commit: 1, end: 3.2, release: 2.8 },
  monocle: { start: 0.6, contact: 0.9, commit: 1, end: 3.4, release: 3 },
  saw: { start: 0.7, contact: 0.9, commit: 2.6, end: 3.4, release: 3 },
  hammer: { start: 0.7, contact: 1.35, commit: 1.4, end: 2.6, release: 2.2 },
  handcuffs: { start: 0.6, contact: 1.5, commit: 2, end: 2.8, release: 2.3 },
  aegis: { start: 0.6, contact: 1.4, commit: 1.7, end: 2.5, release: 2.1 },
  magnet: { start: 0.6, contact: 0.8, commit: 2, end: 2.8, release: 2.4 },
  cutter: { start: 0.5, contact: 1, commit: 1.9, end: 2.7, release: 2.3 },
  iou: { start: 0.7, contact: 1.55, commit: 2.1, end: 3, release: 2.6 },
  seal: { start: 0.6, contact: 1.25, commit: 2, end: 2.8, release: 2.4 },
  hourglass: { start: 0.7, contact: 1.5, commit: 2, end: 3, release: 2.6 },
}

export function isItemPresentationEvent(event: GameEvent): boolean {
  return ['itemUsed', 'chamberRevealed', 'magnetSwap', 'hourglass', 'daggerReshuffle', 'cardCuttered', 'iouSigned', 'cardSealed', 'deckPeeked'].includes(event.type)
}

export type ItemActionCue = 'pickup' | 'contact' | 'finish'
export interface ItemActionStatus { item: ItemId; actor: ActorId; time: number; phase: '起手' | '等待选牌' | '执行' | '收尾'; canSkip: boolean }

interface ActionDeps {
  scene: THREE.Scene
  tableY: number
  prop: (item: ItemId) => THREE.Group
  hand: () => THREE.Object3D | undefined
  card: (actor: ActorId, card: Card) => THREE.Mesh | null
  gunPoint: (part: 'barrel' | 'receiver') => THREE.Vector3
  focus: (point: THREE.Vector3, actor: ActorId) => void
  rest: () => void
  commit: () => void
  cue: (item: ItemId, cue: ItemActionCue) => void
  status: (status: ItemActionStatus | null) => void
  restHands: (visible: boolean) => void
  saw: () => void
  reload: () => void
}

const clamp = (n: number) => THREE.MathUtils.clamp(n, 0, 1)
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t) }
const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a))
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function material(color: number, metalness = 0, roughness?: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: roughness ?? (metalness ? 0.5 : 1), metalness })
}
function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, pos = v(0, 0, 0)): THREE.Mesh {
  const obj = new THREE.Mesh(geometry, mat)
  obj.position.copy(pos)
  obj.castShadow = true
  obj.receiveShadow = true
  return obj
}
/** meshopt 解码出的属性是归一化整型 + 交错存储，直接在上面 computeVertexNormals 会把
 *  米制几何的微小叉积量化成 0（法线全零 → 光照全零 → 手是纯黑剪影）。
 *  先展开成 Float32 属性，后续烘焙矩阵与握持形变都在浮点上做。 */
function toFloatGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(source.attributes)) {
    const array = new Float32Array(attr.count * attr.itemSize)
    for (let i = 0; i < attr.count; i += 1) {
      for (let c = 0; c < attr.itemSize; c += 1) array[i * attr.itemSize + c] = attr.getComponent(i, c)
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, attr.itemSize))
  }
  if (source.index) geometry.setIndex(source.index.clone())
  return geometry
}
function dispose(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    geometries.add(obj.geometry)
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat)
  })
  root.removeFromParent()
  for (const geo of geometries) geo.dispose()
  for (const mat of materials) {
    if (mat.userData.actionTexture && mat instanceof THREE.MeshStandardMaterial) mat.map?.dispose()
    mat.dispose()
  }
}

class ActionHand {
  readonly root = new THREE.Group()
  private readonly parts: { mesh: THREE.Mesh; points: Float32Array }[] = []
  private curl = -1
  /** 手掌在动作特写里应有的长度（米）；按实际包围盒归一化，不依赖模型的导出单位 */
  private static readonly HAND_LENGTH = 0.165
  constructor(template: THREE.Object3D | undefined, left: boolean, actor: ActorId, level: number) {
    const skin = material(actor === 'player' ? 0x80604f : level === 1 ? 0x40332e : 0x6e685f)
    skin.roughness = 0.88
    const model = template?.clone(true)
    if (model) {
      // clone 出来的子树还没跑过矩阵更新，Nail 这类挂在缩放父级下的网格 obj.matrix 仍是单位阵；
      // 直接 applyMatrix4(obj.matrix) 会得到 [-1,1] 的原始顶点，在世界里被父级放大成几米碎面
      model.updateMatrixWorld(true)
      model.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        if (!obj.name.includes('Skin') && !obj.name.includes('Nail')) { obj.visible = false; return }
        obj.geometry = toFloatGeometry(obj.geometry)
        obj.geometry.applyMatrix4(obj.matrixWorld)
        obj.position.set(0, 0, 0)
        obj.rotation.set(0, 0, 0)
        obj.scale.setScalar(1)
        obj.material = obj.name.includes('Nail') ? material(0x5a4a3c) : skin
        obj.frustumCulled = false
        obj.castShadow = true
        // 直接 new Float32Array(position.array) 在 meshopt 解压出的交错/带偏移 buffer 上会复制错位，
        // 拿到 1166 这种垃圾值；grip 用它重写顶点会把烘好的米制几何覆盖成巨块，必须逐顶点读取
        const posAttr = obj.geometry.attributes.position!
        const src = new Float32Array(posAttr.count * 3)
        for (let i = 0; i < posAttr.count; i += 1) {
          src[i * 3] = posAttr.getX(i)
          src[i * 3 + 1] = posAttr.getY(i)
          src[i * 3 + 2] = posAttr.getZ(i)
        }
        this.parts.push({ mesh: obj, points: src })
      })
      // meshopt 重导出的手模型各网格自带不同缩放（Skin 0.107、Nail 0.008），
      // 上面 applyMatrix4(matrixWorld) 已把缩放烘进顶点、还原成米制几何，
      // 之后按最长边重新归一化即可；早期版本误用未更新的 obj.matrix，Nail 会保留 [-1,1] 原始顶点被放大成碎面
      model.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(model)
      const longest = Math.max(...box.getSize(new THREE.Vector3()).toArray())
      const fit = longest > 1e-6 ? ActionHand.HAND_LENGTH / longest : 0.78
      model.scale.set(left ? -fit : fit, fit, fit)
      model.position.z = 0.062
      this.root.add(model)
    } else {
      const palm = mesh(new THREE.SphereGeometry(1, 16, 12), skin)
      palm.scale.set(0.095, 0.037, 0.115)
      this.root.add(palm)
      for (let i = 0; i < 5; i += 1) {
        const finger = mesh(new THREE.CapsuleGeometry(0.018, 0.13, 4, 8), skin, v((i - 2) * 0.035, 0, -0.11))
        finger.rotation.x = Math.PI / 2
        this.root.add(finger)
      }
    }
    // 近景机位沿 +z 正对玩家手部且俯角较大：任何朝 +z 或朝下的袖筒/前臂
    // 都会正对镜头（顶盖糊成黑球或肉筒）。手掌本身带腕，直接收在画框内即可
    if (actor !== 'player') {
      const cuff = mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.12, 14), material(0x322b27), v(0, -0.03, 0.14))
      cuff.rotation.set(Math.PI / 2 + 1.2, 0, left ? 0.22 : -0.22)
      this.root.add(cuff)
    }
    this.grip(0)
  }
  grip(value: number): void {
    if (Math.abs(value - this.curl) < 0.015) return
    this.curl = value
    for (const part of this.parts) {
      const pos = part.mesh.geometry.attributes.position!
      for (let i = 0; i < pos.count; i += 1) {
        const x = part.points[i * 3]!, y = part.points[i * 3 + 1]!, z = part.points[i * 3 + 2]!
        const thumb = x < -0.049
        const hinge = thumb ? -0.044 : -0.082
        const length = Math.max(0, hinge - z)
        const angle = value * (thumb ? 1.15 : 1.9) * clamp(length / 0.067)
        pos.setXYZ(i, x + (thumb ? value * length * 0.32 : 0), y - Math.sin(angle) * length, z > hinge ? z : hinge - Math.cos(angle) * length)
      }
      pos.needsUpdate = true
      part.mesh.geometry.computeVertexNormals()
    }
  }
}

interface Remnant { root: THREE.Object3D; item: ItemId; actor: ActorId; round: number; level: number; persistent: boolean }
interface MovingCard { obj: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; original: THREE.Mesh }
interface ActiveAction {
  item: ItemId; actor: ActorId; snapshot: GameSnapshot; time: number; waiting: boolean; chosen: boolean; cancelled: boolean
  root: THREE.Group; prop: THREE.Group; left: ActionHand; right: ActionHand; target: THREE.Vector3; from: THREE.Vector3
  parts: Map<string, THREE.Object3D>; moving: MovingCard[]; contact: boolean; committed: boolean; resolve: () => void; ready: Promise<void>
}

export class ItemActions {
  private active: ActiveAction | null = null
  private readonly remnants: Remnant[] = []
  private paused = false
  private latest: GameSnapshot | null = null
  constructor(private readonly deps: ActionDeps) {}
  get busy(): boolean { return this.active !== null }
  get activeName(): string { return this.active ? this.active.root.name : '' }
  get waiting(): boolean { return this.active?.waiting ?? false }
  get committed(): boolean { return this.active?.committed ?? false }
  whenReady(): Promise<void> { return this.active?.ready ?? Promise.resolve() }
  getStatus(): ItemActionStatus | null {
    const a = this.active
    if (!a) return null
    const spec = ITEM_ACTION_TIMINGS[a.item]
    return { item: a.item, actor: a.actor, time: a.time, phase: a.waiting && a.time >= spec.start ? '等待选牌' : a.time < spec.start ? '起手' : a.time < spec.release ? '执行' : '收尾', canSkip: !a.waiting && a.time >= spec.release }
  }
  skip(): boolean {
    const a = this.active
    if (!a || this.paused || !this.getStatus()?.canSkip) return false
    a.time = ITEM_ACTION_TIMINGS[a.item].end
    this.update(0)
    return true
  }
  /** 仅供开发期逐帧验收：把动作拨到指定时刻并立刻重摆双手 */
  seek(seconds: number): ItemActionStatus | null {
    const a = this.active
    if (!a) return null
    const spec = ITEM_ACTION_TIMINGS[a.item]
    a.time = Math.max(0, Math.min(a.waiting ? spec.start : spec.end, seconds))
    this.pose(a)
    return this.getStatus()
  }
  hold(value: boolean): void {
    this.held = value
  }
  private held = false
  start(actor: ActorId, item: ItemId, before: GameSnapshot, from: THREE.Vector3): void {
    this.cancel()
    const root = new THREE.Group()
    root.name = `ItemAction-${actor}-${item}`
    root.position.set(0, this.deps.tableY, actor === 'player' ? 1.12 : -1.12)
    root.rotation.y = actor === 'player' ? 0 : Math.PI
    this.deps.scene.add(root)
    const prop = this.deps.prop(item)
    prop.scale.setScalar(0.62)
    this.tameProp(prop)
    root.add(prop)
    const left = new ActionHand(this.deps.hand(), true, actor, before.levelIndex)
    const right = new ActionHand(this.deps.hand(), false, actor, before.levelIndex)
    root.add(left.root, right.root)
    right.root.name = `${root.name}-right`
    left.root.name = `${root.name}-left`
    let resolve!: () => void
    const ready = new Promise<void>((done) => { resolve = done })
    root.updateWorldMatrix(true, true)
    const a: ActiveAction = {
      actor, item, snapshot: before, root, prop, left, right, from: root.worldToLocal(from.clone()), target: v(0.12, 0.38, -0.1),
      time: 0, waiting: actor === 'player' && (item === 'cutter' || item === 'seal'), chosen: false, cancelled: false,
      parts: new Map(), moving: [], contact: false, committed: false, resolve, ready,
    }
    this.active = a
    this.setup(a)
    this.deps.restHands(false)
    this.deps.focus(root.localToWorld(this.peakFocus(a)), actor)
    this.deps.cue(item, 'pickup')
    this.update(0)
  }
  /** 动作最饱满时刻道具所在的位置（动作根本地坐标）。
   *  机位距离固定、锚点取道具本身，各道具在画框里的占比才一致；
   *  共用一个固定锚点会让举到半空的沙漏出画、前伸的护心镜占掉半屏 */
  private peakFocus(a: ActiveAction): THREE.Vector3 {
    const spec = ITEM_ACTION_TIMINGS[a.item]
    const hero = a.item === 'cutter' ? a.parts.get('cutter')
      : a.item === 'monocle' ? a.parts.get('monocle')
      : a.item === 'saw' ? a.parts.get('saw')
      : a.item === 'iou' ? a.parts.get('paper')
      : a.item === 'seal' ? a.parts.get('strip')
      : a.prop
    const node = hero ?? a.prop
    const saved = a.time
    // 磁铁的两张牌分别在自己和对手手牌区，取结算帧会贴到对面去；
    // setup 里已经把 target 定成自己牌上方，直接用它当锚点
    if (a.item === 'magnet') return a.target.clone()
    // 取结算帧：道具落在最终受力位置，构图不会跟着抬手高点漂。
    // 切牌刀在 1.8s 后会 clone 半张牌，采样停在它之前
    a.time = a.item === 'cutter' ? Math.min(spec.commit, 1.79) : spec.commit
    this.pose(a)
    const point = node.position.clone()
    // 避开桌面贴图里的长直线装饰，同时保持道具在画面中心附近。
    if (a.item === 'sedative') point.y -= 0.28
    if (a.item === 'hourglass') point.x -= 0.14
    a.time = saved
    this.pose(a)
    return point
  }
  private tameProp(root: THREE.Object3D): void {
    // 近景里 GLB 的高金属度会直接镜面反射环境光，刀身与镜面糊成白条；
    // 动作道具只是手里的一件旧物，压暗并提高粗糙度才看得清轮廓
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of materials) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue
        // 透明玻璃只保留透光，不投射实心剪影。
        if (mat.transparent || mat.opacity < 1) { obj.castShadow = false; mat.side = THREE.DoubleSide; continue }
        mat.metalness = Math.min(mat.metalness, 0.35)
        mat.roughness = Math.max(mat.roughness, 0.7)
        mat.color.multiplyScalar(0.62)
        mat.emissiveIntensity *= 0.1
        mat.envMapIntensity = 0.3
      }
    })
  }
  private setup(a: ActiveAction): void {
    const { item, root, prop, parts } = a
    const add = (name: string, obj: THREE.Object3D) => { obj.name = name; root.add(obj); parts.set(name, obj); return obj }
    if (item === 'saw' || item === 'hammer' || item === 'magnifier') {
      // 工具处理的是摆在桌沿近侧的枪管段：真实枪身太远，手部动作会在镜头里缩成一团。
      // 近景里这段管壁几乎贴着镜头，尺寸和金属度都要压下来，否则一格白柱挡住整张桌子
      a.target.set(item === 'saw' ? 0.02 : 0.06, item === 'saw' ? 0.38 : 0.43, -0.24)
      const workpiece = item === 'saw'
        ? mesh(new THREE.BoxGeometry(0.24, 0.035, 0.055), material(0x58564f, 0.35, 0.85))
        : mesh(
          new THREE.CylinderGeometry(0.022, 0.022, 0.17, 16, 1, true),
          material(item === 'magnifier' ? 0x4a4439 : 0x58564f, item === 'magnifier' ? 0.1 : 0.4, 0.9),
        )
      workpiece.position.copy(a.target).add(v(0, -0.09, 0))
      if (item !== 'saw') workpiece.rotation.z = Math.PI / 2
      add('workpiece', workpiece)
    }
    if (item === 'sedative') {
      // 桌上道具统一归一化到 0.5m，直接沿用会把针筒放大到手掌的 1.5 倍。
      // 动作里按真实注射器比例重新缩小，保持筒身略短于手指到腕部的长度。
      prop.scale.setScalar(0.44)
      const cap = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), material(0x969c8d))
      cap.rotation.x = Math.PI / 2
      add('cap', cap)
      const dot = mesh(new THREE.CircleGeometry(0.012, 12), material(0x53100d))
      dot.rotation.x = -Math.PI / 2
      dot.visible = false
      add('puncture', dot)
    }
    if (item === 'aegis') {
      prop.scale.setScalar(0.42)
      const pulse = mesh(
        new THREE.TorusGeometry(0.115, 0.004, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xffc15a, transparent: true, opacity: 0.8, depthWrite: false }),
      )
      pulse.visible = false
      add('shieldPulse', pulse)
    }
    if (item === 'dagger') {
      const drop = mesh(new THREE.SphereGeometry(0.011, 10, 8), material(0x5a120e))
      add('blood', drop).visible = false
    }
    if (item === 'saw') {
      prop.visible = false
      const saw = new THREE.Group()
      const shape = new THREE.Shape()
      shape.moveTo(-0.18, 0.035)
      shape.lineTo(0.11, 0.035)
      shape.lineTo(0.11, -0.035)
      for (let i = 0; i < 15; i += 1) {
        const x = 0.11 - i * 0.0193
        shape.lineTo(x - 0.0096, -0.035)
        shape.lineTo(x - 0.0193, -0.044)
      }
      shape.lineTo(-0.18, -0.035)
      shape.closePath()
      const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false })
      bladeGeo.translate(0, 0, -0.004)
      saw.add(mesh(bladeGeo, material(0xa4a8a5, 0.45, 0.58)))
      const handleShape = new THREE.Shape()
      handleShape.moveTo(0.1, -0.052); handleShape.lineTo(0.23, -0.052); handleShape.lineTo(0.23, 0.052); handleShape.lineTo(0.1, 0.052); handleShape.closePath()
      const hole = new THREE.Path()
      hole.moveTo(0.14, -0.026); hole.lineTo(0.14, 0.026); hole.lineTo(0.205, 0.026); hole.lineTo(0.205, -0.026); hole.closePath()
      handleShape.holes.push(hole)
      const handleGeo = new THREE.ExtrudeGeometry(handleShape, { depth: 0.034, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 })
      handleGeo.translate(0, 0, -0.017)
      saw.add(mesh(handleGeo, material(0x684226, 0, 0.82)))
      saw.add(mesh(new THREE.BoxGeometry(0.018, 0.082, 0.042), material(0xa18148, 0.55, 0.5), v(0.095, 0, 0)))
      add('saw', saw)
      const offcut = mesh(new THREE.BoxGeometry(0.07, 0.035, 0.055), material(0x67655f, 0.4, 0.8))
      add('offcut', offcut).visible = false
    }
    if (item === 'hammer') {
      prop.scale.setScalar(0.52)
      const impact = mesh(
        new THREE.RingGeometry(0.026, 0.035, 24),
        new THREE.MeshBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0.8, depthWrite: false }),
      )
      impact.rotation.x = -Math.PI / 2
      impact.visible = false
      add('impact', impact)
    }
    if (item === 'handcuffs') {
      a.target.set(-0.25, 0.23, -1.95)
      const wrist = new ActionHand(this.deps.hand(), true, a.actor === 'player' ? 'boss' : 'player', a.snapshot.levelIndex)
      wrist.root.rotation.y = Math.PI
      wrist.root.position.copy(a.target).add(v(0, 0, -0.12))
      const sleeve = mesh(new THREE.CylinderGeometry(0.052, 0.066, 0.24, 14), material(a.snapshot.levelIndex === 1 ? 0x2c2522 : 0x34302b), v(0, 0, 0.25))
      sleeve.rotation.x = Math.PI / 2
      wrist.root.add(sleeve)
      add('targetWrist', wrist.root)
    }
    if (item === 'iou') {
      prop.visible = false
      const paper = this.paper('借 据\n\n血债记于此局\n\n立据人：', 0.42, 0.55)
      add('paper', paper)
      const stamp = mesh(new THREE.CircleGeometry(0.045, 20), material(0x771c18))
      stamp.scale.x = 0.65
      stamp.rotation.x = -Math.PI / 2
      add('stamp', stamp).visible = false
      const signature = new THREE.Group()
      const ink = new THREE.MeshBasicMaterial({ color: 0x531b17 })
      signature.add(mesh(new THREE.PlaneGeometry(0.065, 0.003), ink, v(0.025, 0, 0)))
      const stroke2 = mesh(new THREE.PlaneGeometry(0.052, 0.003), ink, v(0.018, -0.012, 0))
      stroke2.rotation.z = -0.18; signature.add(stroke2)
      const stroke3 = mesh(new THREE.PlaneGeometry(0.038, 0.003), ink, v(0.01, -0.023, 0))
      stroke3.rotation.z = 0.22; signature.add(stroke3)
      signature.position.set(-0.055, -0.13, 0.002)
      signature.scale.x = 0.01
      paper.add(signature)
      parts.set('signature', signature)
      const pen = new THREE.Group()
      pen.add(mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.13, 10), material(0x322a26), v(0, 0.07, 0)))
      const nib = mesh(new THREE.ConeGeometry(0.006, 0.024, 10), material(0xb89a5c, 0.6, 0.4), v(0, 0.008, 0))
      nib.rotation.z = Math.PI
      pen.add(nib)
      add('pen', pen)
      const stampTool = new THREE.Group()
      stampTool.add(mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.012, 20), material(0x771c18), v(0, 0.006, 0)))
      stampTool.add(mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.05, 12), material(0x5b3b25), v(0, 0.036, 0)))
      stampTool.visible = false
      add('stampTool', stampTool)
      a.target.set(-0.1, 0.045, -0.3)
    }
    if (item === 'seal') {
      const strip = this.paper('封  契', 0.26, 0.095, true)
      add('strip', strip)
      const wax = mesh(new THREE.CylinderGeometry(0.032, 0.035, 0.009, 20), material(0x8f1d18, 0.05, 0.55))
      wax.visible = false
      add('wax', wax)
    }
    if (item === 'cutter') {
      // Imported cutter is a solid dagger; the close-up needs an independently retractable blade.
      prop.visible = false
      const tool = new THREE.Group()
      tool.add(mesh(new THREE.BoxGeometry(0.046, 0.03, 0.18), material(0x777d7e, 0.55, 0.5)))
      tool.add(mesh(new THREE.BoxGeometry(0.054, 0.038, 0.105), material(0x2d2926, 0, 0.86), v(0, 0, 0.025)))
      tool.add(mesh(new THREE.BoxGeometry(0.03, 0.008, 0.18), material(0xaab2b3, 0.6, 0.42), v(0, 0.019, 0)))
      tool.add(mesh(new THREE.BoxGeometry(0.034, 0.014, 0.032), material(0x4b5152, 0.45, 0.55), v(0, 0.026, -0.052)))
      const bladeShape = new THREE.Shape()
      bladeShape.moveTo(-0.019, 0); bladeShape.lineTo(0.019, 0); bladeShape.lineTo(0.013, 0.145); bladeShape.lineTo(-0.004, 0.17); bladeShape.lineTo(-0.019, 0.17); bladeShape.closePath()
      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: false })
      bladeGeo.rotateX(-Math.PI / 2)
      bladeGeo.translate(0, 0, -0.075)
      const blade = mesh(bladeGeo, material(0xc6d0d2, 0.65, 0.38))
      tool.add(blade)
      parts.set('blade', blade)
      add('cutter', tool)
    }
    if (item === 'monocle') {
      prop.visible = false
      const lens = new THREE.Group()
      lens.add(mesh(new THREE.TorusGeometry(0.085, 0.009, 10, 32), material(0x9c7d45, 0.45, 0.62)))
      const glass = mesh(new THREE.CircleGeometry(0.078, 32), new THREE.MeshStandardMaterial({ color: 0x6a8c91, transparent: true, opacity: 0.2, side: THREE.DoubleSide, roughness: 0.35, depthWrite: false }))
      lens.add(glass)
      for (let i = 0; i < 7; i += 1) {
        const link = mesh(new THREE.TorusGeometry(0.008, 0.0022, 5, 8), material(0x927849, 0.45, 0.62), v(0.085 + Math.sin(i * 0.55) * 0.014, -i * 0.019, 0))
        link.rotation.y = i % 2 ? Math.PI / 2 : 0
        lens.add(link)
      }
      const glint = new THREE.Group()
      const glintMat = new THREE.MeshBasicMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.85, depthWrite: false })
      glint.add(mesh(new THREE.PlaneGeometry(0.055, 0.004), glintMat))
      glint.add(mesh(new THREE.PlaneGeometry(0.004, 0.055), glintMat))
      glint.position.z = 0.005
      glint.visible = false
      lens.add(glint)
      parts.set('glint', glint)
      add('monocle', lens)
    }
    if (item === 'hourglass') {
      prop.scale.setScalar(0.42)
    }
    if (item === 'magnet') {
      prop.scale.setScalar(0.48)
      const field = new THREE.Group()
      const fieldMat = new THREE.MeshBasicMaterial({ color: 0x79b7ff, transparent: true, opacity: 0.35, depthWrite: false })
      for (let i = 0; i < 2; i += 1) {
        const arc = mesh(new THREE.TorusGeometry(0.065 + i * 0.025, 0.0025, 5, 24, Math.PI), fieldMat)
        arc.rotation.z = Math.PI
        arc.position.y = -i * 0.018
        field.add(arc)
      }
      field.visible = false
      add('magnetField', field)
      const mine = a.snapshot[a.actor].hand.cards
      const foeActor = a.actor === 'player' ? 'boss' : 'player'
      const theirs = a.snapshot[foeActor].hand.cards
      const first = mine[a.actor === 'player' ? mine.length - 1 : 0]
      const second = theirs[foeActor === 'player' ? theirs.length - 1 : 0]
      if (first && second) {
        const c1 = this.copyCard(a, a.actor, first), c2 = this.copyCard(a, foeActor, second)
        if (c1 && c2) {
          c1.to.copy(c2.from); c2.to.copy(c1.from)
          a.target.copy(c1.from).add(v(0, 0.14, 0))
        }
      }
    }
  }
  private paper(text: string, width: number, height: number, red = false): THREE.Mesh {
    const canvas = document.createElement('canvas')
    const landscape = width > height
    canvas.width = landscape ? 512 : 256; canvas.height = landscape ? 192 : 384
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = red ? '#731d16' : '#b4a079'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = red ? '#c6a87b' : '#5b4630'; ctx.lineWidth = 4; ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24)
    ctx.fillStyle = red ? '#d2b78f' : '#332b22'; ctx.font = landscape ? '54px serif' : '30px serif'
    text.split('\n').forEach((line, i) => ctx.fillText(line, landscape ? 150 : 28, landscape ? 116 : 62 + i * 45))
    for (let i = 0; i < 60; i += 1) { ctx.fillStyle = `rgba(50,25,12,${0.015 + (i % 5) * 0.01})`; ctx.fillRect((i * 73) % canvas.width, (i * 97) % canvas.height, 8, 20) }
    // 纸面压掉两档白：纯白受桌面暖光一打就过 bloom 阈值，字迹会被光晕吃掉
    const mat = material(0xa89c86); mat.map = new THREE.CanvasTexture(canvas); mat.map.colorSpace = THREE.SRGBColorSpace; mat.side = THREE.DoubleSide; mat.userData.actionTexture = true
    const obj = mesh(new THREE.PlaneGeometry(width, height), mat)
    obj.rotation.x = -Math.PI / 2
    return obj
  }
  private copyCard(a: ActiveAction, actor: ActorId, card: Card): MovingCard | null {
    const original = this.deps.card(actor, card)
    if (!original) return null
    const obj = original.clone()
    obj.geometry = original.geometry.clone()
    obj.material = Array.isArray(original.material) ? original.material.map((mat) => mat.clone()) : original.material.clone()
    const from = a.root.worldToLocal(original.getWorldPosition(new THREE.Vector3()))
    obj.position.copy(from)
    obj.rotation.y -= a.root.rotation.y
    a.root.add(obj)
    original.visible = false
    const moving = { obj, original, from, to: from.clone() }
    a.moving.push(moving)
    return moving
  }
  cancelChoice(): void {
    const a = this.active
    if (!a || !a.waiting) return
    a.waiting = false
    a.cancelled = true
    a.time = Math.max(a.time, ITEM_ACTION_TIMINGS[a.item].release)
    this.deps.status(this.getStatus())
  }
  choose(card: Card): void {
    const a = this.active
    if (!a || !a.waiting) return
    a.waiting = false; a.chosen = true
    const actor = a.item === 'seal' ? 'boss' : a.actor
    const copy = this.copyCard(a, actor, card)
    if (copy) a.target.copy(copy.from).add(v(0, 0.035, 0))
    // 选牌后道具下移到牌面，机位跟着降到牌面高度，避免只拍到桌沿；
    // 但不能贴到牌面上，否则持刀手会挡满整个画面。
    // 注意 a.target 是动作根本地坐标（根已抬高到桌面），不能拿世界桌高来比
    const follow = a.target.clone()
    follow.y = Math.max(a.target.y + 0.16, 0.34)
    this.deps.focus(a.root.localToWorld(follow), a.actor)
  }
  /** 仅供开发期逐帧验收：等待选牌的道具当前可选的牌 */
  previewCards(): Card[] {
    const a = this.active
    if (!a || !a.waiting) return []
    if (a.item === 'cutter') return [...a.snapshot.player.hand.cards]
    if (a.item === 'seal') return a.snapshot.boss.hand.cards.filter((card): card is Card => card !== null)
    return []
  }
  sync(snapshot: GameSnapshot): void {
    this.paused = snapshot.paused
    const previous = this.latest
    this.latest = snapshot
    if (this.active) this.removeStaleRemnants(snapshot)
    if (previous && (snapshot.levelIndex !== previous.levelIndex || snapshot.round !== previous.round || (snapshot.phase === 'reloading' && previous.phase !== 'reloading') || snapshot.phase === 'idle' || snapshot.phase === 'gameOver' || snapshot.phase === 'victory')) this.cancel()
    const a = this.active
    if (a?.waiting && !snapshot.cardChoice) {
      a.waiting = false; a.cancelled = true
      a.time = Math.max(a.time, ITEM_ACTION_TIMINGS[a.item].release)
    }
    if (!a) this.removeStaleRemnants(snapshot)
  }

  private removeStaleRemnants(snapshot: GameSnapshot): void {
    for (let i = this.remnants.length - 1; i >= 0; i -= 1) {
      const r = this.remnants[i]!
      const view = snapshot[r.actor]
      const foe = snapshot[r.actor === 'player' ? 'boss' : 'player']
      const expired = r.level !== snapshot.levelIndex || snapshot.phase === 'reloading' || snapshot.phase === 'idle' ||
        (r.item === 'aegis' ? view.shield === 0 : r.item === 'handcuffs' ? !foe.skipTurn : r.item === 'hourglass' ? !snapshot.hourglassActive : r.round !== snapshot.round)
      if (expired) { dispose(r.root); this.remnants.splice(i, 1) }
    }
  }
  update(dt: number): void {
    const a = this.active
    if (!a || this.paused || this.held) { if (a && this.held) this.pose(a); return }
    const spec = ITEM_ACTION_TIMINGS[a.item]
    a.time = Math.min(spec.end, a.time + dt)
    if (a.waiting) a.time = Math.min(a.time, spec.start)
    this.pose(a)
    if (!a.cancelled && a.time >= spec.contact && !a.contact) { a.contact = true; this.deps.cue(a.item, 'contact') }
    if (!a.cancelled && a.time >= spec.commit && !a.committed) {
      a.committed = true
      if (a.item === 'saw') this.deps.saw()
      if (a.item === 'dagger') this.deps.reload()
      this.deps.commit()
    }
    this.deps.status(this.getStatus())
    if (a.time >= spec.end) this.finish(a)
  }
  private pose(a: ActiveAction): void {
    const { prop, left, right, item, time: t, target, parts } = a
    const spec = ITEM_ACTION_TIMINGS[item]
    const take = span(t, 0, spec.start)
    const out = span(t, spec.release, spec.end)
    const restR = v(0.43, 0.1, 0.25), restL = v(-0.43, 0.1, 0.25)
    const tool = item === 'cutter' ? parts.get('cutter')! : item === 'monocle' ? parts.get('monocle')! : item === 'saw' ? parts.get('saw')! : prop
    tool.position.lerpVectors(a.from, target, take)
    tool.rotation.set(0, 0, 0)
    const gripOffset = v(0.018, 0.03, 0.12)
    let support = target.clone().add(v(-0.28, -0.15, 0.05))
    left.root.rotation.set(0, 0, 0)
    right.root.rotation.set(0, -0.15, 0)
    right.grip(take * (1 - out) * 0.95)
    left.grip(take * (1 - out) * 0.4)
    if (item === 'sedative') {
      support = v(-0.28, 0.4, 0.02)
      left.root.rotation.set(0.2, -0.55, Math.PI * 0.62)
      left.grip(span(t, 1.1, 1.4) * (1 - span(t, 2.9, 3.5)) * 0.7)
      // 针筒横在左前臂上方，针尖朝腕部；推药时只有活塞向后走
      tool.rotation.set(0.08, Math.PI / 2, Math.PI / 2)
      const insert = span(t, 0.85, 1.25)
      tool.position.copy(v(-0.23, 0.53, -0.02)).lerp(v(-0.23, 0.47, -0.02), insert * (1 - span(t, 2.8, 3.1)))
      if (t < spec.start) tool.position.lerpVectors(a.from, v(-0.23, 0.53, -0.02), take)
      const pushed = span(t, 1.4, 2.8)
      prop.traverse((obj) => {
        if (!obj.userData.actionBasePosition) obj.userData.actionBasePosition = obj.position.clone()
        const base = obj.userData.actionBasePosition as THREE.Vector3
        if (obj.name === 'Plunger' || obj.name === 'PlungerStop') obj.position.z = base.z - pushed * 0.065
        if (obj.name === 'SerumFluid') { obj.scale.z = Math.max(0.015, 1 - pushed); obj.position.z = base.z - pushed * 0.035 }
      })
      const cap = parts.get('cap')!
      cap.position.set(-0.3, 0.03 + (1 - span(t, 0.3, 0.8)) * 0.3, -0.08)
      const dot = parts.get('puncture')!
      dot.visible = t > 2.95; dot.position.set(-0.23, 0.415, -0.02)
      gripOffset.set(0.07, -0.01, 0.11)
    } else if (item === 'dagger') {
      support = v(-0.25, 0.29, -0.17)
      left.root.rotation.set(0.1, -0.6, Math.PI * 0.55)
      left.grip(span(t, 1, 1.4) * 0.6 * (1 - out))
      tool.rotation.set(0.1, 1.25, -0.3)
      const draw = span(t, 0.8, 1.35)
      tool.position.set(0.15 - draw * 0.27, 0.34 + Math.sin(draw * Math.PI) * 0.07, -0.16)
      const cuts = span(t, 1.35, 2.55) * (1 - span(t, 2.55, 2.7))
      tool.position.y -= Math.abs(Math.sin((t - 1.35) * Math.PI * 2.4)) * 0.035 * cuts
      if (t < 0.8) tool.position.lerpVectors(a.from, v(0.15, 0.34, -0.16), take)
      gripOffset.set(0, 0, 0.115).applyQuaternion(tool.quaternion)
      gripOffset.y += 0.018
      right.root.rotation.set(tool.rotation.x * 0.4, tool.rotation.y, tool.rotation.z * 0.5)
      const drop = parts.get('blood')!
      drop.visible = t > 1.3
      drop.position.set(-0.2, 0.275 * (1 - span(t, 1.4, 1.85)) + 0.006, -0.18)
      drop.scale.set(1, t > 1.85 ? 0.35 : 1, 1)
    } else if (item === 'magnifier') {
      tool.rotation.set(0, Math.PI + 0.18, -0.08)
      tool.position.y += Math.sin(t * 4) * 0.008 * (1 - out)
      gripOffset.set(0, 0.01, -0.19).applyQuaternion(tool.quaternion)
      support = tool.position.clone().add(v(-0.11, -0.06, 0.02))
      left.root.rotation.set(0.15, -0.5, Math.PI * 0.42)
      left.grip(take * (1 - out) * 0.62)
    } else if (item === 'monocle') {
      const lift = span(t, 0.55, 1.05)
      const inspect = span(t, 1, 2.5) * (1 - out)
      tool.position.set(0.02, 0.42 + lift * 0.15 + Math.sin(t * 3) * 0.006 * inspect, 0.1)
      if (t < spec.start) tool.position.lerpVectors(a.from, v(0.02, 0.57, 0.1), take)
      tool.rotation.set(-0.2, 0.12, Math.sin(t * 2) * 0.06 * inspect)
      gripOffset.set(0.1, 0, 0)
      support = tool.position.clone().add(v(-0.1, 0.025, 0.015))
      left.root.rotation.set(0.1, -0.35, -Math.PI * 0.35)
      left.grip(take * (1 - out) * 0.58)
      right.root.rotation.z = -0.18
      const glint = parts.get('glint')!
      const shine = span(t, 1.25, 1.45) * (1 - span(t, 1.75, 1.95))
      glint.visible = shine > 0.01
      glint.scale.setScalar(0.5 + shine * 0.8)
      glint.position.x = -0.025 + span(t, 1.25, 1.95) * 0.05
      glint.rotation.z = span(t, 1.25, 1.95) * 0.5
    } else if (item === 'saw') {
      tool.rotation.set(0, 0, 0)
      const stroke = t > 0.7 && t < 2.6 ? Math.sin((t - spec.start) * Math.PI * 3.2) : 0
      tool.position.copy(target).add(v(stroke * 0.1, -0.015, 0.02))
      if (t < spec.start) tool.position.lerpVectors(a.from, target.clone().add(v(0, -0.015, 0.02)), take)
      gripOffset.set(0.17, 0.005, 0.035)
      right.root.rotation.z = -0.12
      support = target.clone().add(v(-0.17, -0.075, 0.015))
      left.root.rotation.set(0.15, -0.3, Math.PI * 0.48)
      left.grip(take * (1 - out) * 0.48)
      const offcut = parts.get('offcut')!
      offcut.visible = t >= 2.6
      offcut.position.copy(target).add(v(-0.12 - span(t, 2.6, 3.1) * 0.16, -0.09, 0.02))
      offcut.rotation.set(0, 0, span(t, 2.6, 3.1) * Math.PI)
    } else if (item === 'hammer') {
      const impact = span(t, 1.05, 1.35)
      tool.position.y += (0.52 * take * (1 - impact)) + Math.sin(span(t, 1.35, 1.8) * Math.PI) * 0.14
      tool.rotation.x = -0.55 * (1 - impact)
      gripOffset.set(0, 0.02, 0.15)
      support = target.clone().add(v(-0.16, -0.1, 0.1))
      left.root.rotation.set(0.1, -0.4, Math.PI * 0.45)
      left.grip(take * (1 - out) * 0.45)
      const flash = parts.get('impact') as THREE.Mesh
      const flashMat = flash.material as THREE.MeshBasicMaterial
      const burst = span(t, 1.3, 1.42) * (1 - span(t, 1.55, 1.75))
      flash.visible = burst > 0.01
      flash.position.copy(target).add(v(0, -0.065, 0.02))
      flash.scale.setScalar(0.7 + span(t, 1.3, 1.75) * 1.8)
      flashMat.opacity = burst * 0.75
    } else if (item === 'handcuffs') {
      tool.rotation.x = Math.PI / 2 * span(t, 0.7, 1.4)
      tool.position.y += (1 - span(t, 0.6, 1.5)) * 0.1
      const cuff = prop.getObjectByName('CuffB')
      if (cuff) cuff.rotation.z = (1 - span(t, 1.3, 1.65)) * 1.2
      support = target.clone().add(v(-0.2, -0.08, 0.02))
      left.root.rotation.set(0.1, -0.45, Math.PI * 0.42)
      left.grip(take * (1 - out) * 0.5)
    } else if (item === 'aegis') {
      const raise = span(t, 0.55, 1.35)
      const brace = Math.sin(span(t, 1.35, 1.75) * Math.PI) * 0.035
      tool.position.set(0, 0.08 + raise * 0.38 + brace, 0.3 - raise * 0.08)
      if (t < spec.start) tool.position.lerpVectors(a.from, v(0, 0.08, 0.3), take)
      tool.rotation.set(-0.12 * raise, 0, Math.sin(t * 2.2) * 0.025 * raise)
      tool.position.lerp(v(-0.78, 0.02, -0.2), out)
      gripOffset.set(0.12, 0.035, 0.06)
      support = tool.position.clone().add(v(-0.13, 0.035, 0.06))
      left.root.rotation.set(0.1, -0.45, -Math.PI * 0.28)
      left.grip(take * (1 - out) * 0.62)
      const pulse = parts.get('shieldPulse') as THREE.Mesh
      const pulseMat = pulse.material as THREE.MeshBasicMaterial
      const glow = span(t, 1.5, 1.65) * (1 - span(t, 1.95, 2.2))
      pulse.visible = glow > 0.01
      pulse.position.copy(tool.position).add(v(0, 0.08, 0.015))
      pulse.rotation.copy(tool.rotation)
      pulse.scale.setScalar(0.85 + span(t, 1.5, 2.2) * 0.65)
      pulseMat.opacity = glow * 0.72
    } else if (item === 'magnet') {
      const p = span(t, 0.75, 1.95)
      a.moving.forEach((card, i) => {
        card.obj.position.lerpVectors(card.from, card.to, p)
        card.obj.position.y += Math.sin(p * Math.PI) * (i === 0 ? 0.12 : 0.22)
        card.obj.rotation.z = Math.sin(p * Math.PI) * (i === 0 ? 0.12 : -0.12)
      })
      if (a.moving[0]) tool.position.copy(a.moving[0].obj.position).add(v(0, 0.12, 0.05))
      tool.rotation.z = Math.sin(t * 4) * 0.06 * (1 - out)
      support = tool.position.clone().add(v(-0.11, -0.015, 0.055))
      left.root.rotation.set(0.1, -0.4, -Math.PI * 0.3)
      left.grip(take * (1 - out) * 0.58)
      gripOffset.set(0.11, 0.015, 0.06)
      const field = parts.get('magnetField')!
      field.visible = t > 0.75 && t < 2.05
      field.position.copy(tool.position).add(v(0, -0.07, 0.015))
      field.scale.setScalar(0.9 + Math.sin(t * 9) * 0.08)
    } else if (item === 'cutter') {
      const blade = parts.get('blade')!
      if (a.waiting || !a.chosen) {
        // 等待玩家点牌：刀已亮出、片已推出，但手停在手牌右侧不再前进
        tool.position.set(0.3, 0.19, 0.08)
        tool.rotation.set(0, Math.PI / 2, 0.18)
        blade.scale.z = Math.max(0.02, take)
        support = restL.clone()
        gripOffset.set(0.11, 0.01, 0)
      } else if (a.cancelled) {
        tool.position.set(-0.5, 0.05, -0.1)
        tool.rotation.set(0, Math.PI / 2, 0)
        blade.scale.z = 0.02
        support = restL.clone()
      } else {
        tool.position.copy(target).add(v(-0.13 + span(t, 0.9, 1.8) * 0.26, 0.055, 0.04))
        tool.rotation.set(0, Math.PI / 2, 0)
        blade.scale.z = Math.max(0.02, 1 - out)
        support = target.clone().add(v(-0.16, 0.025, 0.12))
        left.root.rotation.set(0.12, -0.35, Math.PI * 0.42)
        left.grip(take * (1 - out) * 0.28)
        gripOffset.set(0.12, 0.018, 0)
        if (t >= 1.8 && a.moving[0]) {
          const c = a.moving[0]
          if (!parts.has('half')) {
            const half = c.obj.clone()
            half.geometry = c.obj.geometry.clone()
            half.material = Array.isArray(c.obj.material) ? c.obj.material.map((m) => m.clone()) : c.obj.material.clone()
            c.obj.scale.x *= 0.5
            half.scale.x *= 0.5
            a.root.add(half)
            parts.set('half', half)
          }
          const half = parts.get('half')!
          const split = span(t, 1.8, 2.4)
          c.obj.position.copy(c.from).add(v(-0.09 - split * 0.32, 0.012, 0.1 * split))
          half.position.copy(c.from).add(v(0.09 + split * 0.08, 0.018, 0.22 * split))
          half.rotation.y = split * 0.4
        }
      }
    } else if (item === 'iou') {
      const paper = parts.get('paper')!
      paper.position.copy(target).add(v(0, 0, -span(t, 2.1, 2.6) * 0.12))
      support = paper.position.clone().add(v(-0.2, 0.04, 0.06))
      const pen = parts.get('pen')!
      const stampTool = parts.get('stampTool')!
      const signature = parts.get('signature')!
      const sign = span(t, 1.05, 1.55)
      const signed = span(t, 1.15, 1.7)
      const lift = span(t, 1.8, 2.15)
      const press = span(t, 1.9, 2.08) * (1 - span(t, 2.2, 2.45))
      signature.visible = signed > 0.01
      signature.scale.x = Math.max(0.01, signed)
      if (t < 1.82) {
        tool.position.copy(paper.position).add(v(-0.055 + sign * 0.12, 0.025 + (1 - sign) * 0.12 + lift * 0.14, 0.07))
        pen.visible = out < 0.8
        pen.position.copy(tool.position)
        pen.rotation.set(0.35, 0, -0.5 + Math.sin(t * 18) * 0.06 * sign * (1 - lift))
        gripOffset.set(0, 0.07, 0).applyQuaternion(pen.quaternion)
        stampTool.visible = false
      } else {
        pen.visible = false
        stampTool.visible = out < 0.8
        tool.position.copy(paper.position).add(v(0.04, 0.012 + (1 - press) * 0.15, 0.12))
        stampTool.position.copy(tool.position)
        stampTool.rotation.set(0, 0, Math.sin(t * 10) * 0.025 * (1 - press))
        gripOffset.set(0, 0.045, 0)
      }
      right.root.rotation.z = -0.35
      const stamp = parts.get('stamp')!
      stamp.visible = t > 1.98; stamp.position.copy(paper.position).add(v(0.04, 0.004, 0.12))
      const stampPop = span(t, 1.98, 2.12)
      stamp.scale.set(0.65 * Math.max(0.01, stampPop), 0.65 * Math.max(0.01, stampPop), 1)
    } else if (item === 'seal') {
      tool.visible = false
      const strip = parts.get('strip')!
      const place = span(t, 0.75, 1.2)
      strip.position.copy(target).add(v(0, (1 - place) * 0.18, 0))
      strip.rotation.z = 0.12 * (1 - place)
      if (!a.chosen) strip.position.set(0, 0.22, -0.12)
      const press = span(t, 1.55, 1.78) * (1 - span(t, 2.0, 2.25))
      if (t < 1.55) {
        tool.position.copy(strip.position).add(v(0, 0.035, 0))
        gripOffset.set(0.14, 0.02, 0)
      } else {
        tool.position.copy(strip.position).add(v(0, 0.035 + (1 - press) * 0.08, 0.055))
        gripOffset.set(0, 0.025, 0.075)
      }
      support = strip.position.clone().add(v(-0.14, 0.02, 0))
      left.root.rotation.set(0.1, -0.35, -Math.PI * 0.28)
      left.grip(take * (1 - out) * 0.4)
      const wax = parts.get('wax')!
      wax.visible = t > 1.72
      wax.position.copy(strip.position).add(v(0, 0.009, 0))
      const waxPop = span(t, 1.72, 1.9)
      wax.scale.set(Math.max(0.01, waxPop), 1, Math.max(0.01, waxPop))
    } else if (item === 'hourglass') {
      const flip = span(t, 0.7, 1.65)
      const lift = span(t, 0.55, 1.1)
      tool.rotation.set(-0.12, 0, Math.PI / 2 + flip * Math.PI)
      tool.position.set(0.04, 0.25 + lift * 0.12 + Math.sin(lift * Math.PI) * 0.025, 0.12)
      if (t < spec.start) tool.position.lerpVectors(a.from, v(0.04, 0.25, 0.12), take)
      gripOffset.set(0.078, 0, 0.055).applyQuaternion(tool.quaternion)
      support = tool.position.clone().add(v(-0.078, 0, 0.055).applyQuaternion(tool.quaternion))
      left.grip(take * (1 - out) * 0.62)
      right.grip(take * (1 - out) * 0.72)
      const stream = prop.getObjectByName('SandStream')
      if (stream) stream.scale.y = t > 1.65 ? 0.6 + Math.sin(t * 15) * 0.2 : 1
    }
    const used = v(-0.75, 0.035, -0.13)
    if (!['aegis', 'handcuffs', 'hourglass', 'seal', 'iou'].includes(item)) tool.position.lerp(used, out)
    if (item === 'hourglass') { tool.position.lerp(v(-0.62, 0.115, -0.35), out) }
    if (item === 'handcuffs' || item === 'aegis') tool.position.y -= out * 0.02
    right.root.position.copy(tool.position).add(gripOffset)
    right.root.position.lerp(restR, out)
    if (t < spec.start && !['sedative', 'dagger'].includes(item)) right.root.position.lerpVectors(restR, tool.position.clone().add(gripOffset), Math.min(1, take * 2))
    left.root.position.lerpVectors(restL, support, take * (1 - out))
    right.root.visible = out < 0.995
    left.root.visible = out < 0.995
  }
  private finish(a: ActiveAction): void {
    for (const card of a.moving) card.original.visible = true
    a.left.root.removeFromParent(); a.right.root.removeFromParent()
    dispose(a.left.root); dispose(a.right.root)
    if (a.cancelled) {
      for (const obj of a.parts.values()) obj.visible = false
      a.prop.visible = true
      a.prop.position.set(-0.75, 0.04, -0.13)
    }
    if (a.item === 'magnet') for (const card of a.moving) dispose(card.obj)
    if (a.item === 'sedative') a.parts.get('puncture')?.removeFromParent()
    a.root.name = `Used-${a.actor}-${a.item}`
    this.remnants.push({ root: a.root, item: a.item, actor: a.actor, round: a.snapshot.round, level: a.snapshot.levelIndex, persistent: ['aegis', 'handcuffs', 'hourglass'].includes(a.item) })
    this.active = null
    this.deps.commit()
    this.deps.cue(a.item, 'finish')
    this.deps.status(null)
    this.deps.rest()
    this.deps.restHands(true)
    a.resolve()
  }
  breakShield(actor: ActorId): void {
    const shield = this.remnants.find(r => r.item === 'aegis' && r.actor === actor)
    if (!shield) return
    shield.root.rotation.z += 0.4
    shield.root.position.y -= 0.14
  }
  cancel(): void {
    const a = this.active
    if (!a) return
    this.active = null
    for (const card of a.moving) card.original.visible = true
    dispose(a.root)
    this.deps.status(null)
    this.deps.restHands(true)
    a.resolve()
  }
  dispose(): void {
    this.cancel()
    for (const r of this.remnants) dispose(r.root)
    this.remnants.length = 0
  }
}
