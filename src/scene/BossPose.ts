export type BossPoseState =
  | 'idle'
  | 'impact'
  | 'launch'
  | 'down'
  | 'collapse'
  | 'prone'
  | 'plant'
  | 'brace'
  | 'push'
  | 'rise'
  | 'recover'
  | 'struggle'
  | 'still'
  | 'headTurn'
  | 'deadProne'
  | 'spawn'

export interface BossPoseSample {
  pitch: number
  yaw: number
  roll: number
  y: number
  z: number
  headPitch: number
  headYaw: number
  headRoll: number
  armL: number
  armR: number
  forearmL: number
  forearmR: number
  legL: number
  legR: number
  lookWeight: number
}

export interface BossPoseDurations {
  impact: number
  launch: number
  down: number
  plant: number
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
  readonly controlled?: boolean
  readonly suspended?: boolean
}

export interface BossPoseOptions {
  readonly reducedMotion?: boolean
}

const SPAWN_DURATION = 1.05
const SUSPENDED_STRUGGLE_DURATION = 1.55
const SUSPENDED_STILL_DURATION = 0.22
const SUSPENDED_HEAD_TURN_DURATION = 0.52
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
    durations: { impact: 0.12, launch: 0.42, down: 0.58, plant: 0.48, collapse: 0.5, prone: 0.9, brace: 0.55, push: 0.75, rise: 0.75, settle: 0.35 },
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
    durations: { impact: 0.12, launch: 0.42, down: 0.58, plant: 0.48, collapse: 0.55, prone: 1, brace: 0.4, push: 0.65, rise: 0.6, settle: 0.3 },
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
    durations: { impact: 0.12, launch: 0.42, down: 0.58, plant: 0.48, collapse: 0.7, prone: 0.8, brace: 0.4, push: 0.7, rise: 0.8, settle: 0.3 },
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
    headYaw: 0,
    headRoll: 0,
    armL: 0,
    armR: 0,
    forearmL: 0,
    forearmR: 0,
    legL: 0,
    legR: 0,
    lookWeight: 1,
  }
}

function copySample(sample: BossPoseSample): BossPoseSample {
  return { ...sample }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function remap01(value: number, start: number, end: number): number {
  return clamp01((value - start) / Math.max(0.001, end - start))
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
    headYaw: lerp(a.headYaw, b.headYaw, t),
    headRoll: lerp(a.headRoll, b.headRoll, t),
    armL: lerp(a.armL, b.armL, t),
    armR: lerp(a.armR, b.armR, t),
    forearmL: lerp(a.forearmL, b.forearmL, t),
    forearmR: lerp(a.forearmR, b.forearmR, t),
    legL: lerp(a.legL, b.legL, t),
    legR: lerp(a.legR, b.legR, t),
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
  private knockback = false
  private controlled = false
  private suspended = false
  /** 起身段累计时间：L2 的两次轻颤跨 brace/push/rise 连续采样 */
  private getupTime = 0
  /** L3 悬吊自转：只在趴伏/致死趴伏时累积，起身阶段回正 */
  private spin = 0
  private plantHold = false
  private stillHold = false

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

  stateProgress(): number {
    if (!Number.isFinite(this.stateDuration)) return 1
    return clamp01(this.stateTime / Math.max(0.001, this.stateDuration))
  }

  holdBeforePlant(): void {
    this.plantHold = true
  }

  releasePlantHold(): void {
    this.plantHold = false
  }

  holdBeforeStill(): void {
    this.stillHold = true
  }

  releaseStillHold(): void {
    this.stillHold = false
  }

  triggerHit(hit: BossPoseHit): void {
    this.plantHold = false
    this.stillHold = false
    if (this.stateValue === 'deadProne') return
    if (hit.hpAfter <= 0) {
      this.triggerDefeat(hit.level)
      return
    }
    if (hit.damage <= 0) return

    this.applyLevel(hit.level)
    this.lethal = false
    this.suspended = hit.suspended === true
    this.knockback = this.profileIndex === 0 && !this.suspended
    this.controlled = hit.controlled === true
    this.hpRatio = hit.maxHp > 0 ? clamp01(hit.hpAfter / hit.maxHp) : 0
    const rawSeverity = (hit.damage - 2) / 6 + (1 - this.hpRatio) * 0.45
    this.severity = clamp01(rawSeverity)
    this.from = copySample(this.current)
    this.enter('impact')
  }

  triggerDefeat(level: number): void {
    if (this.stateValue === 'deadProne') return
    this.plantHold = false
    this.stillHold = false
    this.suspended = false
    this.applyLevel(level)
    this.lethal = true
    this.knockback = false
    this.controlled = false
    this.severity = 1
    this.hpRatio = 0
    this.from = copySample(this.current)
    this.enter('impact')
  }

  spawn(level: number): void {
    this.applyLevel(level)
    this.plantHold = false
    this.stillHold = false
    this.suspended = false
    this.lethal = false
    this.knockback = false
    this.controlled = false
    this.severity = 0
    this.hpRatio = 1
    this.spin = 0
    this.from = copySample(this.current)
    this.enter('spawn')
  }

  reset(): void {
    this.plantHold = false
    this.stillHold = false
    this.suspended = false
    this.stateValue = 'idle'
    this.stateTime = 0
    this.stateDuration = Number.POSITIVE_INFINITY
    this.from = zeroSample()
    this.target = zeroSample()
    this.current = zeroSample()
    this.severity = 0
    this.hpRatio = 1
    this.lethal = false
    this.knockback = false
    this.controlled = false
    this.getupTime = 0
    this.spin = 0
  }

  update(dt: number): void {
    if (this.plantHold && this.stateValue === 'plant') return
    if (this.stillHold && this.stateValue === 'still') return
    const step = Math.min(Math.max(dt, 0), MAX_STEP)
    if (step <= 0) return
    this.stateTime += step

    switch (this.stateValue) {
      case 'idle':
        this.current = zeroSample()
        break
      case 'impact':
        this.updateSegment(
          1,
          easeOutCubic,
          this.suspended ? 'struggle' : this.controlled ? 'launch' : this.knockback ? 'launch' : 'collapse',
        )
        break
      case 'launch':
        if (this.controlled) this.updateControlledSegment('down')
        else this.updateSegment(1, easeOutCubic, 'down')
        break
      case 'down':
        if (this.controlled) this.updateControlledSegment('plant')
        else this.updateSegment(1, easeInCubic, 'plant')
        break
      case 'plant':
        if (this.controlled) this.updateControlledSegment('brace')
        else this.updateSegment(1, easeInOutCubic, 'brace')
        break
      case 'collapse':
        this.updateSegment(1, easeInCubic, this.lethal ? 'deadProne' : 'prone')
        break
      case 'prone':
        this.updateProne(step)
        break
      case 'brace':
        this.getupTime += step
        if (this.controlled) this.updateControlledSegment('push')
        else this.updateSegment(1, easeOutCubic, 'push')
        break
      case 'push':
        this.getupTime += step
        if (this.controlled) this.updateControlledSegment('rise')
        else this.updateSegment(1, easeInOutCubic, 'rise')
        break
      case 'rise':
        this.getupTime += step
        if (this.controlled) this.updateControlledSegment('recover')
        else this.updateSegment(1, easeOutCubic, 'recover')
        break
      case 'recover':
        if (this.controlled) this.updateControlledSegment('idle')
        else this.updateSegment(1, easeOutCubic, 'idle')
        break
      case 'struggle':
        this.updateSuspendedStruggle()
        break
      case 'still':
        this.updateSegment(1, easeInOutCubic, 'headTurn')
        break
      case 'headTurn':
        this.updateSuspendedHeadTurn()
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
      case 'launch':
        this.target = this.controlled ? this.controlledStaggerPose() : this.launchPose()
        this.stateDuration = this.durationOf('launch')
        break
      case 'down':
        this.target = this.controlled ? this.controlledPronePose() : this.downPose()
        this.stateDuration = this.durationOf('down')
        break
      case 'plant':
        this.target = this.controlled ? this.controlledPronePose() : this.plantPose()
        this.stateDuration = this.durationOf('plant')
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
        this.target = this.controlled
          ? this.controlledBracePose()
          : this.knockback ? this.bracePose() : this.getupPose('brace')
        this.stateDuration = this.durationOf('brace')
        break
      case 'push':
        this.target = this.controlled
          ? this.controlledPushPose()
          : this.knockback ? this.pushPose() : this.getupPose('push')
        this.stateDuration = this.durationOf('push')
        break
      case 'rise':
        this.target = this.controlled ? this.controlledRisePose() : this.getupPose('rise')
        this.stateDuration = this.durationOf('rise')
        break
      case 'recover':
        this.target = zeroSample()
        this.stateDuration = this.durationOf('settle')
        break
      case 'struggle':
        this.target = this.suspendedStrugglePose()
        this.stateDuration = SUSPENDED_STRUGGLE_DURATION * this.timeScale()
        break
      case 'still':
        this.target = this.suspendedStillPose()
        this.stateDuration = SUSPENDED_STILL_DURATION * this.timeScale()
        break
      case 'headTurn':
        this.target = this.suspendedHeadTurnPose()
        this.stateDuration = SUSPENDED_HEAD_TURN_DURATION * this.timeScale()
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

  private updateControlledSegment(next: BossPoseState): void {
    const duration = Math.max(0.001, this.stateDuration)
    if (this.stateTime >= duration) {
      this.current = copySample(this.target)
      this.enter(next)
      return
    }

    const t = clamp01(this.stateTime / duration)
    this.current = copySample(this.from)
    switch (this.stateValue) {
      case 'launch': {
        const stagger = easeOutCubic(remap01(t, 0, 0.58))
        this.current = lerpSample(this.from, this.target, stagger)
        break
      }
      case 'down': {
        const fall = easeInCubic(remap01(t, 0.18, 1))
        this.current = lerpSample(this.from, this.target, fall)
        break
      }
      case 'plant': {
        this.current = lerpSample(this.from, this.target, easeInOutCubic(t))
        if (!this.reducedMotionValue) {
          const first = this.controlledPulse(t, 0.24, 0.17)
          const second = this.controlledPulse(t, 0.64, 0.2)
          this.current.headPitch += -0.42 * first + 0.3 * second
          this.current.headRoll += -0.32 * first + 0.46 * second
          this.current.yaw += 0.12 * first - 0.16 * second
          this.current.roll += -0.16 * first + 0.2 * second
          this.current.armR += 0.75 * first
          this.current.forearmR += 0.55 * first
          this.current.armL += 0.7 * second
          this.current.forearmL += 0.6 * second
        }
        break
      }
      case 'brace': {
        this.applyControlledHead(easeOutCubic(remap01(t, 0, 0.52)))
        this.applyControlledBody(easeInOutCubic(remap01(t, 0.2, 0.9)))
        this.applyControlledArms(easeOutCubic(remap01(t, 0.48, 1)))
        break
      }
      case 'push': {
        this.applyControlledHead(easeOutCubic(remap01(t, 0, 0.35)))
        this.applyControlledBody(easeOutCubic(remap01(t, 0.04, 0.62)))
        this.applyControlledArms(easeInOutCubic(remap01(t, 0.48, 1)))
        break
      }
      case 'rise': {
        this.applyControlledBody(easeOutCubic(remap01(t, 0, 0.6)))
        this.applyControlledArms(easeOutCubic(remap01(t, 0.22, 0.9)))
        this.applyControlledHead(easeOutCubic(remap01(t, 0.52, 1)))
        break
      }
      case 'recover': {
        this.applyControlledHead(easeOutCubic(remap01(t, 0.18, 1)))
        this.applyControlledBody(easeOutCubic(t))
        this.applyControlledArms(easeOutCubic(t))
        break
      }
    }
  }

  private applyControlledHead(t: number): void {
    this.current.headPitch = lerp(this.from.headPitch, this.target.headPitch, t)
    this.current.headRoll = lerp(this.from.headRoll, this.target.headRoll, t)
  }

  private applyControlledBody(t: number): void {
    this.current.pitch = lerp(this.from.pitch, this.target.pitch, t)
    this.current.yaw = lerp(this.from.yaw, this.target.yaw, t)
    this.current.roll = lerp(this.from.roll, this.target.roll, t)
    this.current.y = lerp(this.from.y, this.target.y, t)
    this.current.z = lerp(this.from.z, this.target.z, t)
    this.current.lookWeight = lerp(this.from.lookWeight, this.target.lookWeight, t)
  }

  private applyControlledArms(t: number): void {
    this.current.armL = lerp(this.from.armL, this.target.armL, t)
    this.current.armR = lerp(this.from.armR, this.target.armR, t)
    this.current.forearmL = lerp(this.from.forearmL, this.target.forearmL, t)
    this.current.forearmR = lerp(this.from.forearmR, this.target.forearmR, t)
  }

  private controlledPulse(t: number, center: number, width: number): number {
    const local = (t - center) / width
    return Math.abs(local) < 1 ? Math.sin(local * Math.PI) : 0
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
    if (this.controlled || profile.tremble <= 0 || this.reducedMotionValue) return
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

  private updateSuspendedStruggle(): void {
    const t = clamp01(this.stateTime / Math.max(0.001, this.stateDuration))
    if (t >= 1) {
      this.current = this.suspendedStillPose()
      this.enter('still')
      return
    }

    const motion = this.reducedMotionValue ? 0.28 : 1
    const coil = easeOutCubic(remap01(t, 0, 0.22))
    const current = lerpSample(this.from, this.target, coil)
    const time = this.stateTime
    current.pitch += (Math.sin(time * 15.5) * 0.13 + Math.sin(time * 25.3) * 0.035) * motion
    current.yaw += Math.sin(time * 12.7 + 0.4) * 0.17 * motion
    current.roll += Math.sin(time * 18.1 + 1.1) * 0.2 * motion
    current.y += Math.sin(time * 21.7) * 0.045 * motion
    current.z += Math.sin(time * 10.9 + 0.8) * 0.08 * motion
    current.headPitch += Math.sin(time * 23.3) * 0.18 * motion
    current.headRoll += Math.sin(time * 19.7 + 0.3) * 0.28 * motion
    current.headYaw = lerp(
      this.from.headYaw,
      Math.PI,
      easeOutCubic(remap01(t, 0, 0.42)),
    ) + Math.sin(time * 17.1) * 0.07 * motion
    current.armL = this.target.armL + Math.sin(time * 19.4) * 0.62 * motion
    current.armR = this.target.armR + Math.sin(time * 17.2 + 1.7) * 0.68 * motion
    current.forearmL = this.target.forearmL + Math.sin(time * 24.6 + 0.5) * 0.72 * motion
    current.forearmR = this.target.forearmR + Math.sin(time * 21.8 + 2.1) * 0.78 * motion
    current.legL = this.target.legL + Math.sin(time * 14.2) * 0.42 * motion
    current.legR = this.target.legR + Math.sin(time * 16.7 + 1.2) * 0.46 * motion
    current.lookWeight = 0
    this.current = current
  }

  private updateSuspendedHeadTurn(): void {
    const t = clamp01(this.stateTime / Math.max(0.001, this.stateDuration))
    if (t >= 1) {
      this.current = this.suspendedHeadTurnPose()
      this.enter('recover')
      return
    }
    this.current = lerpSample(this.from, this.target, easeInOutCubic(remap01(t, 0, 0.25)))
    const turn = easeOutCubic(remap01(t, 0.08, 0.48))
    this.current.headYaw = lerp(Math.PI + 0.08, 0, turn)
  }

  private suspendedStrugglePose(): BossPoseSample {
    return {
      pitch: 0.08,
      yaw: 0.04,
      roll: -0.14,
      y: 0.035,
      z: 0.08,
      headPitch: -0.24,
      headYaw: Math.PI,
      headRoll: 0.2,
      armL: 0.92,
      armR: 0.82,
      forearmL: 0.58,
      forearmR: 0.64,
      legL: 0.3,
      legR: 0.22,
      lookWeight: 0,
    }
  }

  private suspendedStillPose(): BossPoseSample {
    return {
      pitch: 0.03,
      yaw: 0,
      roll: 0,
      y: -0.025,
      z: 0,
      headPitch: -0.1,
      headYaw: Math.PI,
      headRoll: 0,
      armL: 0.12,
      armR: 0.1,
      forearmL: 0.04,
      forearmR: 0.04,
      legL: 0.08,
      legR: 0.08,
      lookWeight: 0,
    }
  }

  private suspendedHeadTurnPose(): BossPoseSample {
    return {
      ...this.suspendedStillPose(),
      headPitch: 0,
      headYaw: 0,
      armL: 0.06,
      armR: 0.06,
      forearmL: 0,
      forearmR: 0,
      legL: 0.08,
      legR: 0.08,
    }
  }

  private launchPose(): BossPoseSample {
    const motion = this.reducedMotionValue ? 0.55 : 1
    return {
      pitch: -0.58 * motion,
      yaw: -0.08 * motion,
      roll: -0.16 * motion,
      y: 0.45 * motion,
      z: -1.25 * motion,
      headPitch: 0.16,
      headRoll: -0.08 * motion,
      armL: 0.85,
      armR: 0.7,
      forearmL: -0.45,
      forearmR: -0.35,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0,
    }
  }

  private downPose(): BossPoseSample {
    const motion = this.reducedMotionValue ? 0.55 : 1
    return {
      pitch: 1.22 * motion,
      yaw: 0,
      roll: this.reducedMotionValue ? 0 : 0.18,
      y: -1.2,
      z: -0.35,
      headPitch: -0.28,
      headRoll: 0,
      armL: 0.35,
      armR: 0.3,
      forearmL: -0.2,
      forearmR: -0.15,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0,
    }
  }

  private plantPose(): BossPoseSample {
    return {
      pitch: 0.38,
      yaw: -0.1,
      roll: -0.08,
      y: -0.58,
      z: 0.3,
      headPitch: 0.3,
      headRoll: -0.05,
      armL: 1.25,
      armR: 0.25,
      forearmL: 0.9,
      forearmR: -0.15,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.08,
    }
  }

  private bracePose(): BossPoseSample {
    return {
      pitch: 0.5,
      yaw: 0.05,
      roll: 0.04,
      y: -0.38,
      z: 0.2,
      headPitch: 0.34,
      headRoll: 0.03,
      armL: 1.35,
      armR: 1.35,
      forearmL: 1,
      forearmR: 1,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.18,
    }
  }

  private pushPose(): BossPoseSample {
    return {
      pitch: 0.3,
      yaw: 0,
      roll: 0,
      y: -0.08,
      z: 0.1,
      headPitch: 0.22,
      headRoll: 0,
      armL: 1.1,
      armR: 1.1,
      forearmL: 0.8,
      forearmR: 0.8,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.45,
    }
  }

  private controlledStaggerPose(): BossPoseSample {
    const motion = this.reducedMotionValue ? 0.55 : 1
    return {
      pitch: -0.38 * motion,
      yaw: 0.24 * motion,
      roll: -0.28 * motion,
      y: 0.12 * motion,
      z: -0.65 * motion,
      headPitch: 0.24 * motion,
      headRoll: -0.52 * motion,
      armL: 0.15,
      armR: 1.05 * motion,
      forearmL: -0.35 * motion,
      forearmR: 0.7 * motion,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0,
    }
  }

  private controlledPronePose(): BossPoseSample {
    const motion = this.reducedMotionValue ? 0.55 : 1
    return {
      pitch: 0.72 * motion,
      yaw: 0.18 * motion,
      roll: -0.24 * motion,
      y: -0.34,
      z: 0.2 * motion,
      headPitch: 0.65 * motion,
      headRoll: -0.38 * motion,
      armL: 0.25,
      armR: 0.85 * motion,
      forearmL: -0.25 * motion,
      forearmR: 0.55 * motion,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0,
    }
  }

  private controlledBracePose(): BossPoseSample {
    return {
      pitch: 0.56,
      yaw: 0.12,
      roll: -0.18,
      y: -0.24,
      z: 0.14,
      headPitch: 0.16,
      headRoll: -0.12,
      armL: 0.45,
      armR: 0.95,
      forearmL: 0.1,
      forearmR: 0.62,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.08,
    }
  }

  private controlledPushPose(): BossPoseSample {
    return {
      pitch: 0.35,
      yaw: 0.04,
      roll: -0.06,
      y: -0.25,
      z: 0.04,
      headPitch: -0.08,
      headRoll: 0.05,
      armL: 0.6,
      armR: 1.05,
      forearmL: 0.28,
      forearmR: 0.72,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.32,
    }
  }

  private controlledRisePose(): BossPoseSample {
    return {
      pitch: -0.05,
      yaw: 0,
      roll: 0,
      y: 0.02,
      z: 0,
      headPitch: 0.1,
      headRoll: -0.1,
      armL: 0.08,
      armR: 0.18,
      forearmL: -0.12,
      forearmR: 0.08,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.65,
    }
  }

  private impactTarget(from: BossPoseSample): BossPoseSample {
    const profile = this.profile
    if (this.suspended) {
      return {
        ...from,
        pitch: -0.05,
        roll: -0.08,
        y: from.y + 0.025,
        headPitch: -0.16,
        headYaw: 0,
        headRoll: 0.12,
        armL: 0.25,
        armR: 0.2,
        forearmL: 0.18,
        forearmR: 0.16,
        legL: 0.12,
        legR: 0.12,
        lookWeight: 0,
      }
    }
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
        headYaw: 0,
        legL: 0,
        legR: 0,
        lookWeight: 0,
      }
    }
    // 起身途中再次中弹：从当前姿态向下压一点，禁止归零跳变
    return {
      ...from,
      pitch: from.pitch + 0.03,
      y: from.y - 0.008,
      headPitch: from.headPitch + 0.05,
      headYaw: 0,
      legL: 0,
      legR: 0,
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
      forearmL: 0,
      forearmR: 0,
      headYaw: 0,
      legL: 0,
      legR: 0,
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
        forearmL: 0,
        forearmR: 0,
        headYaw: 0,
        legL: 0,
        legR: 0,
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
        forearmL: 0,
        forearmR: 0,
        headYaw: 0,
        legL: 0,
        legR: 0,
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
      forearmL: 0,
      forearmR: 0,
      headYaw: 0,
      legL: 0,
      legR: 0,
      lookWeight: 0.65,
    }
  }
}