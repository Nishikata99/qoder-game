import * as THREE from 'three'

/**
 * 【3D 核心底座 · 队员禁止随意修改】
 * 唯一持有 WebGLRenderer / Scene / 灯光 / 赌桌的场景根。
 * 业务模块只能通过 GameRegistry 拿到 tableRoot 挂载 Group，不得自行创建 renderer。
 */
export class SceneManager {
  readonly scene: THREE.Scene
  readonly renderer: THREE.WebGLRenderer
  /** 赌桌局部坐标系：所有小游戏道具的父节点 */
  readonly tableRoot: THREE.Group
  readonly camera: THREE.PerspectiveCamera

  private readonly timer = new THREE.Timer()
  private readonly shake = { intensity: 0, duration: 0, elapsed: 0 }
  /** 每帧更新的震动偏移，由 CameraController 叠加到最终机位 */
  readonly shakeOffset = new THREE.Vector3()
  private readonly spotlightRig: THREE.Group
  private readonly onResize = () => this.resize()
  private renderCallbacks: Array<(dt: number, elapsed: number) => void> = []

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#050407')
    this.scene.fog = new THREE.FogExp2('#050407', 0.075)

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.05, 120)
    this.camera.position.set(0, 1.55, 2.1)

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'

    this.tableRoot = new THREE.Group()
    this.tableRoot.name = 'tableRoot'
    this.scene.add(this.tableRoot)

    this.spotlightRig = new THREE.Group()
    this.spotlightRig.name = 'spotlightRig'
    this.scene.add(this.spotlightRig)

    this.buildEnvironment()
    this.buildTable()
    this.resize()
    window.addEventListener('resize', this.onResize)
  }

  /** 注册每帧回调，返回注销函数 */
  onFrame(callback: (dt: number, elapsed: number) => void): () => void {
    this.renderCallbacks.push(callback)
    return () => {
      this.renderCallbacks = this.renderCallbacks.filter((entry) => entry !== callback)
    }
  }

  /** 屏幕震动，由 EventBus 的 fx:shake 驱动 */
  triggerShake(intensity = 0.35, duration = 0.45): void {
    this.shake.intensity = intensity
    this.shake.duration = duration
    this.shake.elapsed = 0
  }

  start(): void {
    this.timer.connect(document)
    this.renderer.setAnimationLoop(() => {
      this.timer.update()
      const dt = Math.min(this.timer.getDelta(), 0.05)
      const elapsed = this.timer.getElapsed()
      for (const callback of this.renderCallbacks) callback(dt, elapsed)
      this.applyShake(dt)
      this.renderer.render(this.scene, this.camera)
    })
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null)
    this.timer.dispose()
    window.removeEventListener('resize', this.onResize)
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        disposeMaterial(object.material)
      }
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private applyShake(dt: number): void {
    this.shakeOffset.set(0, 0, 0)
    if (this.shake.duration <= 0) return
    this.shake.elapsed += dt
    const progress = this.shake.elapsed / this.shake.duration
    if (progress >= 1) {
      this.shake.duration = 0
      return
    }
    const decay = (1 - progress) * this.shake.intensity
    this.shakeOffset.set(
      (Math.random() - 0.5) * decay,
      (Math.random() - 0.5) * decay,
      (Math.random() - 0.5) * decay * 0.5,
    )
  }

  private resize(): void {
    const width = this.container.clientWidth || window.innerWidth
    const height = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  private buildEnvironment(): void {
    const ambient = new THREE.AmbientLight('#6b4450', 1.15)
    this.scene.add(ambient)

    const fill = new THREE.HemisphereLight('#8a5f6e', '#120a0d', 0.75)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight('#7a2436', 0.85)
    rim.position.set(-4, 5, -6)
    this.scene.add(rim)

    // 桌面上方的暗黑聚光灯：锥形光斑 + 阴影
    const spot = new THREE.SpotLight('#ffcbb0', 42, 16, Math.PI / 4.6, 0.55, 1.1)
    spot.position.set(0, 5.6, 0.6)
    spot.target.position.set(0, -0.4, -0.2)
    spot.castShadow = true
    spot.shadow.mapSize.set(1024, 1024)
    spot.shadow.bias = -0.0008
    spot.shadow.camera.near = 1
    spot.shadow.camera.far = 14
    this.spotlightRig.add(spot)
    this.spotlightRig.add(spot.target)

    // 桌面正上方的暖色补光，保证绒布与道具可辨
    const tableFill = new THREE.PointLight('#ff9d7a', 9, 7, 1.4)
    tableFill.position.set(0, 1.7, 0)
    this.spotlightRig.add(tableFill)

    const cool = new THREE.PointLight('#5f86ff', 9, 9, 1.6)
    cool.position.set(2.6, 2.0, -3.0)
    this.spotlightRig.add(cool)

    const ember = new THREE.PointLight('#ff4a1f', 7, 7, 1.6)
    ember.position.set(-2.4, 1.2, -1.6)
    this.spotlightRig.add(ember)
  }

  private buildTable(): void {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(22, 64),
      new THREE.MeshStandardMaterial({ color: '#0a0809', roughness: 1, metalness: 0 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.42
    floor.receiveShadow = true
    this.scene.add(floor)

    const feltTexture = createFeltTexture()
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.85, 0.3, 64),
      new THREE.MeshStandardMaterial({ color: '#3d0d18', roughness: 0.95, metalness: 0.05, map: feltTexture }),
    )
    // 约定：y = 0 就是绒布表面，小游戏 Group 的原点直接落在桌面上
    felt.position.y = -0.15
    felt.receiveShadow = true
    felt.castShadow = true
    this.tableRoot.add(felt)

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(2.72, 0.075, 16, 96),
      new THREE.MeshStandardMaterial({ color: '#8a5c26', roughness: 0.35, metalness: 0.9 }),
    )
    rim.rotation.x = Math.PI / 2
    rim.position.y = 0.0
    rim.castShadow = true
    this.tableRoot.add(rim)

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(2.66, 64),
      new THREE.MeshStandardMaterial({ color: '#2a0810', roughness: 0.85, metalness: 0.1, map: feltTexture }),
    )
    top.rotation.x = -Math.PI / 2
    top.position.y = 0.002
    top.receiveShadow = true
    this.tableRoot.add(top)

    // 中央印记：告诉队员道具组的合法落点范围
    const sigil = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 0.86, 64),
      new THREE.MeshBasicMaterial({ color: '#b8323f', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    )
    sigil.rotation.x = -Math.PI / 2
    sigil.position.y = 0.006
    this.tableRoot.add(sigil)
  }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose()
    return
  }
  material.dispose()
}

/** 程序化绒布贴图，避免依赖外部贴图导致部署 404 */
function createFeltTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#36080f'
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 9000; i += 1) {
      const shade = 20 + Math.random() * 40
      ctx.fillStyle = `rgba(${shade + 30}, ${shade * 0.28}, ${shade * 0.42}, 0.55)`
      ctx.fillRect(Math.random() * size, Math.random() * size, 1.4, 1.4)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  return texture
}
