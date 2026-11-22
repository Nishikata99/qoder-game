export type BossPoseState =
  | 'idle'
  | 'impact'
  | 'collapse'
  | 'prone'
  | 'brace'
  | 'push'
  | 'rise'
  | 'recover'
  | 'deadProne'
  | 'spawn'

export interface BossPoseSample {
  pitch: number
  yaw: number
  roll: number
  y: number
  z: number
  headPitch: number
  headRoll: number
  armL: number
  armR: number
  lookWeight: number
}

export interface BossPoseDurations {
  impact: number
  collapse: number
  prone: number
  brace: number
  push: number
  rise: number
  settle: number
}

export interface BossPoseProfile {
  /** 虚拟枢轴高度：旋转绕这里发生，避免整尊半身像绕脚底甩动 */
  readonly pivotY: number
  readonly maxPitch: number
  readonly maxRoll: number
  readonly sink: number
  readonly fallZ: number
  readonly proneHeadDrop: number
  /** 倒吊类 Boss 在起身阶段先被轨道抬高，再回落到静止高度 */
  readonly riseLift: number
  /** 拖起阶段的颤抖幅度（弧度），仅低位爬伏类使用 */
  readonly tremble: number
  readonly allowArms: boolean
  readonly durations: BossPoseDurations
}

export interface BossPoseHit {
  readonly damage: number
  readonly hpAfter: number
  readonly maxHp: number
  readonly level: number
}

export interface BossPoseOptions {
  readonly reducedMotion?: boolean
}

const SPAWN_DURATION = 1.05
const REDUCED_TIME_SCALE = 0.45
/** 场景 tick 已把 dt 钳在 1/20；这里再限一次，防止测试/掉帧一次跨过整段 */
const MAX_STEP = 0.05

export const BOSS_POSE_PROFILES: readonly BossPoseProfile[] = [
  {
    // L1 人形：上身前扑过桌沿，头肩必须留在桌面以上
    pivotY: 0.85,
    maxPitch: 0.9,
    maxRoll: 0.24,
    sink: 0,
    fallZ: 0.7,
    proneHeadDrop: -0.06,
    riseLift: 0,
    tremble: 0,
    allowArms: true,
    durations: { impact: 0.12, collapse: 0.5, prone: 0.9, brace: 0.35, push: 0.55, rise: 0.6, settle: 0.25 },
  },
  {
    // L2 低伏体：虫身沿 Z 轴长 3.4m，大俯仰会把尾端当杠杆甩上画面外；
    // 改为小角度前塌 + 下沉主导，尾部只随躯干整体下坠
    pivotY: 0.9,
    maxPitch: 0.22,
    maxRoll: 0.08,
    sink: 0.42,
    fallZ: 0.12,
    proneHeadDrop: 0.32,
    riseLift: 0,
    tremble: 0.05,
    allowArms: false,
    durations: { impact: 0.12, collapse: 0.55, prone: 1, brace: 0.4, push: 0.65, rise: 0.6, settle: 0.3 },
  },
  {
    // L3 倒吊体：枢轴取 GLB 的 Boss3_SuspensionRoot 世界高度（0.26 + 2.824）
    pivotY: 3.08,
    maxPitch: 0.34,
    maxRoll: 0.2,
    sink: 0.08,
    fallZ: 0,
    proneHeadDrop: 0.22,
    riseLift: 0.34,
    tremble: 0,
    allowArms: false,
    durations: { impact: 0.12, collapse: 0.7, prone: 0.8, brace: 0.4, push: 0.7, rise: 0.8, settle: 0.3 },
  },
]

function zeroSample(): BossPoseSample {
  return {
    pitch: 0,
    yaw: 0,
    roll: 0,
    y: 0,
    z: 0,
    headPitch: 0,
    headRoll: 0,
    armL: 0,
    armR: 0,
    lookWeight: 1,
  }
}

function copySample(sample: BossPoseSample): BossPoseSample {
  return { ...sample }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpSample(a: BossPoseSample, b: BossPoseSample, t: number): BossPoseSample {
  return {
    pitch: lerp(a.pitch, b.pitch, t),
    yaw: lerp(a.yaw, b.yaw, t),
    roll: lerp(a.roll, b.roll, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
    headPitch: lerp(a.headPitch, b.headPitch, t),
    headRoll: lerp(a.headRoll, b.headRoll, t),
    armL: lerp(a.armL, b.armL, t),
    armR: lerp(a.armR, b.armR, t),
    lookWeight: lerp(a.lookWeight, b.lookWeight, t),
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function easeInCubic(t: number): number {
  return t ** 3
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}

/**
 * 新一局开始时让新 Boss 播 spawn 并清掉旧姿态的依据。
 * beginLevel 每次都先把 phase 拨到 reloading，切层 / retry / restart 都会经过；
 * 同层 retry 时 levelIndex 和 Boss 血量都可能不变，必须靠 reloading 这一跳兜住。
 */
export interface BossPoseSnapshotFacts {
  readonly phase: string
  readonly levelIndex: number
  readonly boss: { readonly hp: number }
}

export function shouldRespawnBossPose(
  previous: BossPoseSnapshotFacts | null,
  current: BossPoseSnapshotFacts,
): boolean {
  if (!previous) return false
  if (current.levelIndex !== previous.levelIndex) return true
  if (previous.boss.hp <= 0 && current.boss.hp > 0) return true
  return current.phase === 'reloading' && previous.phase !== 'reloading'
}

/**
 * Boss 倒地/起身的纯逻辑状态机。SceneManager 只负责把采样值映射到 Three 对象。
 *
 * 普通命中：impact → collapse → prone → brace → push → rise → recover → idle
 * 致死命中：impact → collapse → deadProne（保持，直到 reset/spawn）
 */
export class BossPoseController {
  private profileIndex = 0
  private stateValue: BossPoseState = 'idle'
  private stateTime = 0
  private stateDuration = Number.POSITIVE_INFINITY
  private from: BossPoseSample = zeroSample()
  private target: BossPoseSample = zeroSample()
  private current: BossPoseSample = zeroSample()
  private reducedMotionValue: boolean
  private severity = 0
  private hpRatio = 1
  private lethal = false
  /** 起身段累计时间：L2 的两次轻颤跨 brace/push/rise 连续采样 */
  private getupTime = 0
  /** L3 悬吊自转：只在趴伏/致死趴伏时累积，起身阶段回正 */
  private spin = 0

  constructor(options: BossPoseOptions = {}) {
    this.reducedMotionValue = options.reducedMotion ?? false
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotionValue = value
  }

  state(): BossPoseState {
    return this.stateValue
  }

  /** 切换关卡 profile；不改当前姿态，下一次触发时按新关卡计算幅度 */
  setProfile(level: number): void {
    this.applyLevel(level)
  }

  sample(): BossPoseSample {
    return copySample(this.current)
  }

  triggerHit(hit: BossPoseHit): void {
    if (this.stateValue === 'deadProne') return
    if (hit.hpAfter <= 0) {
      this.triggerDefeat(hit.level)
      return
    }
    if (hit.damage <= 0) return

    this.applyLevel(hit.level)
    this.lethal = false
    this.hpRatio = hit.maxHp > 0 ? clamp01(hit.hpAfter / hit.maxHp) : 0
    const rawSeverity = (hit.damage - 2) / 6 + (1 - this.hpRatio) * 0.45
    this.severity = clamp01(rawSeverity)
    this.from = copySample(this.current)
    this.enter('impact')
  }

  triggerDefeat(level: number): void {
    if (this.stateValue === 'deadProne') return
    this.applyLevel(level)
    this.lethal = true
    this.severity = 1
    this.hpRatio = 0
    this.from = copySample(this.current)
    this.enter('impact')
  }

  spawn(level: number): void {
    this.applyLevel(level)
    this.lethal = false
    this.severity = 0
    this.hpRatio = 1
    this.spin = 0
    this.from = copySample(this.current)
    this.enter('spawn')
  }

  reset(): void {
    this.stateValue = 'idle'
    this.stateTime = 0
    this.stateDuration = Number.POSITIVE_INFINITY
    this.from = zeroSample()
    this.target = zeroSample()
    this.current = zeroSample()
    this.severity = 0
    this.hpRatio = 1
    this.lethal = false
    this.getupTime = 0
    this.spin = 0
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), MAX_STEP)
    if (step <= 0) return
    this.stateTime += step

    switch (this.stateValue) {
      case 'idle':
        this.current = zeroSample()
        break
      case 'impact':
        this.updateSegment(1, easeOutCubic, 'collapse')
        break
      case 'collapse':
        this.updateSegment(1, easeInCubic, this.lethal ? 'deadProne' : 'prone')
        break
      case 'prone':
        this.updateProne(step)
        break
      case 'brace':
        this.getupTime += step
        this.updateSegment(1, easeOutCubic, 'push')
        break
      case 'push':
        this.getupTime += step
        this.updateSegment(1, easeInOutCubic, 'rise')
        break
      case 'rise':
        this.getupTime += step
        this.updateSegment(1, easeOutCubic, 'recover')
        break
      case 'recover':
        this.updateSegment(1, easeOutCubic, 'idle')
        break
      case 'deadProne':
        this.updateDeadProne(step)
        break
      case 'spawn':
        this.updateSpawn()
        break
    }

    if (this.stateValue === 'brace' || this.stateValue === 'push' || this.stateValue === 'rise') {
      this.applyGetupTremble()
    }
  }

  private get profile(): BossPoseProfile {
    return BOSS_POSE_PROFILES[this.profileIndex] ?? BOSS_POSE_PROFILES[0]
  }

  private applyLevel(level: number): void {
    const index = Math.max(0, Math.min(BOSS_POSE_PROFILES.length - 1, Math.floor(level)))
    this.profileIndex = index
  }

  private timeScale(): number {
    return this.reducedMotionValue ? REDUCED_TIME_SCALE : 1
  }

  private durationOf(name: keyof BossPoseDurations): number {
    const base = this.profile.durations[name]
    if (name === 'prone') return base * this.timeScale() * (0.9 + this.severity * 0.35)
    if (name === 'brace' || name === 'push' || name === 'rise') {
      return base * this.timeScale() * (1 + (1 - this.hpRatio) * 0.3)
    }
    return base * this.timeScale()
  }

  private enter(state: BossPoseState): void {
    this.stateValue = state
    this.stateTime = 0
    this.from = copySample(this.current)

    switch (state) {
      case 'impact':
        this.target = this.impactTarget(this.from)
        this.stateDuration = this.durationOf('impact')
        break
      case 'collapse':
        this.target = this.collapseTarget()
        this.stateDuration = this.durationOf('collapse')
        break
      case 'prone':
        this.target = this.pronePose()
        this.stateDuration = this.durationOf('prone')
        break
      case 'brace':
        this.getupTime = 0
        this.target = this.getupPose('brace')
        this.stateDuration = this.durationOf('brace')
        break
      case 'push':
        this.target = this.getupPose('push')
        this.stateDuration = this.durationOf('push')
        break
      case 'rise':
        this.target = this.getupPose('rise')
        this.stateDuration = this.durationOf('rise')
        break
      case 'recover':
        this.target = zeroSample()
        this.stateDuration = this.durationOf('settle')
        break
      case 'deadProne':
        this.target = this.pronePose()
        this.stateDuration = Number.POSITIVE_INFINITY
        break
      case 'spawn':
        this.target = zeroSample()
        this.stateDuration = SPAWN_DURATION * this.timeScale()
        break
      case 'idle':
        this.target = zeroSample()
        this.current = zeroSample()
        this.stateDuration = Number.POSITIVE_INFINITY
        break
    }
  }

  private updateSegment(
    durationScale: number,
    ease: (t: number) => number,
    next: BossPoseState,
  ): void {
    const duration = Math.max(0.001, this.stateDuration * durationScale)
    if (this.stateTime >= duration) {
      this.current = copySample(this.target)
      this.enter(next)
      return
    }
    this.current = lerpSample(this.from, this.target, ease(clamp01(this.stateTime / duration)))
  }

  private updateProne(step: number): void {
    const settleDuration = this.reducedMotionValue ? 0.08 : 0.18
    const settle = easeOutCubic(clamp01(this.stateTime / settleDuration))
    const base = lerpSample(this.from, this.target, settle)
    const breath = Math.sin(this.stateTime * 2.1) * 0.006
    base.y += breath
    base.pitch += breath * 0.5
    base.headPitch += breath * 0.8
    if (!this.reducedMotionValue) {
      const sway = Math.sin(this.stateTime * 1.35) * 0.01 * Math.exp(-this.stateTime * 0.4)
      base.roll += sway
      base.headRoll += sway * 0.5
    }
    if (this.profileIndex === 2 && !this.reducedMotionValue) {
      // 悬吊体：绕轨枢轴来回摆荡，同时缓慢自转
      this.spin += step * 0.28
      base.yaw = this.spin
      base.roll += Math.sin(this.stateTime * 1.05) * 0.16
      base.pitch += Math.sin(this.stateTime * 1.05 + 0.7) * 0.035
    }
    this.current = base

    if (this.stateTime >= this.stateDuration) {
      this.from = copySample(this.current)
      this.enter('brace')
    }
  }

  private updateDeadProne(step: number): void {
    const settleDuration = this.reducedMotionValue ? 0.1 : 0.3
    const base = lerpSample(
      this.from,
      this.target,
      easeOutCubic(clamp01(this.stateTime / settleDuration)),
    )
    const exhale = 0.02 * easeOutCubic(clamp01(this.stateTime / 1.4))
    base.y -= exhale
    base.pitch += exhale * 0.4
    base.headPitch += exhale * 1.2
    if (this.profileIndex === 2 && !this.reducedMotionValue) {
      this.spin += step * 0.16
      base.yaw = this.spin
      base.roll += Math.sin(this.stateTime * 0.8) * 0.1
    }
    this.current = base
  }

  /** L2 低位体拖起时带两次轻微颤抖；跨三个起身段连续计时，避免分段跳变 */
  private applyGetupTremble(): void {
    const profile = this.profile
    if (profile.tremble <= 0 || this.reducedMotionValue) return
    const shake = Math.sin(this.getupTime * 11.5) * profile.tremble * Math.exp(-this.getupTime * 0.85)
    this.current.pitch += shake
    this.current.headPitch += shake * 0.7
    this.current.y += Math.abs(shake) * 0.3
  }

  private updateSpawn(): void {
    const t = clamp01(this.stateTime / Math.max(0.001, this.stateDuration))
    this.current = lerpSample(this.from, this.target, easeInOutCubic(t))
    if (this.stateTime >= this.stateDuration) {
      this.current = zeroSample()
      this.enter('idle')
    }
  }

  private impactTarget(from: BossPoseSample): BossPoseSample {
    const profile = this.profile
    const idleish =
      Math.abs(from.pitch) < 0.06 && Math.abs(from.roll) < 0.06 && from.lookWeight > 0.5
    if (idleish) {
      const recoilScale = this.reducedMotionValue ? 0.5 : 1
      return {
        ...from,
        pitch: -profile.maxPitch * 0.06 * recoilScale,
        y: from.y + 0.012,
        z: from.z - 0.02,
        headPitch: -profile.proneHeadDrop * 0.18,
        headRoll: 0,
        armL: profile.allowArms ? 0.12 : 0,
        armR: profile.allowArms ? 0.1 : 0,
        lookWeight: 0,
      }
    }
    // 起身途中再次中弹：从当前姿态向下压一点，禁止归零跳变
    return {
      ...from,
      pitch: from.pitch + 0.03,
      y: from.y - 0.008,
      headPitch: from.headPitch + 0.05,
      lookWeight: 0,
    }
  }

  private collapseTarget(): BossPoseSample {
    const prone = this.pronePose()
    const overshoot = this.lethal ? 1.02 : 1.04
    return {
      ...prone,
      pitch: prone.pitch * overshoot,
      roll: prone.roll * overshoot,
      y: prone.y * overshoot,
      z: prone.z * overshoot,
      headPitch: prone.headPitch * overshoot,
      headRoll: prone.headRoll * overshoot,
    }
  }

  private pronePose(): BossPoseSample {
    const profile = this.profile
    const amplitude = (0.85 + this.severity * 0.3) * (this.lethal ? 1.06 : 1)
    const roll = this.reducedMotionValue ? 0 : profile.maxRoll * amplitude
    return {
      pitch: profile.maxPitch * amplitude,
      yaw: this.profileIndex === 2 ? this.spin : 0,
      roll,
      y: -profile.sink * (0.9 + this.severity * 0.2),
      z: profile.fallZ * amplitude,
      headPitch: profile.proneHeadDrop * (0.9 + this.severity * 0.2),
      headRoll: this.reducedMotionValue ? 0 : roll * 0.6,
      armL: profile.allowArms && !this.reducedMotionValue ? 0.92 : 0,
      armR: profile.allowArms && !this.reducedMotionValue ? 0.78 : 0,
      lookWeight: 0,
    }
  }

  private getupPose(phase: 'brace' | 'push' | 'rise'): BossPoseSample {
    const prone = this.pronePose()
    const profile = this.profile
    if (phase === 'brace') {
      return {
        pitch: prone.pitch * 0.78,
        yaw: prone.yaw * 0.75,
        roll: prone.roll * 0.72,
        y: prone.y * 0.7 + profile.riseLift * 0.2,
        z: prone.z * 0.7,
        headPitch: prone.headPitch * 0.88,
        headRoll: prone.headRoll * 0.72,
        armL: prone.armL * 0.92,
        armR: prone.armR * 0.92,
        lookWeight: 0.12,
      }
    }
    if (phase === 'push') {
      return {
        pitch: prone.pitch * 0.36,
        yaw: prone.yaw * 0.35,
        roll: prone.roll * 0.36,
        y: prone.y * 0.22 + profile.riseLift * 0.75,
        z: prone.z * 0.36,
        headPitch: prone.headPitch * 0.55,
        headRoll: prone.headRoll * 0.36,
        armL: prone.armL * 0.45,
        armR: prone.armR * 0.45,
        lookWeight: 0.28,
      }
    }
    return {
      pitch: -profile.maxPitch * 0.04,
      yaw: 0,
      roll: -profile.maxRoll * 0.03,
      y: profile.riseLift,
      z: 0,
      headPitch: -profile.proneHeadDrop * 0.05,
      headRoll: 0,
      armL: 0,
      armR: 0,
      lookWeight: 0.65,
    }
  }
}