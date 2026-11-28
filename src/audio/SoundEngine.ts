export interface SoundEngineOptions {
  readonly masterVolume?: number
}

interface AmbientGraph {
  readonly output: GainNode
  readonly sources: readonly AudioScheduledSourceNode[]
}

interface RoomToneGraph {
  readonly source: AudioBufferSourceNode
  readonly gain: GainNode
}

const SECONDS = 1

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Fully synthesised soundscape built on the native Web Audio API.
 * No audio files, buffers from disk, or third-party libraries are used.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null
  private input: AudioNode | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private ambient: AmbientGraph | null = null
  private roomTone: RoomToneGraph | null = null
  private roomToneBuffer: AudioBuffer | null = null
  private introDoorBuffer: AudioBuffer | null = null
  private introDoorUrl: string | null = null
  private emptyClickBuffer: AudioBuffer | null = null
  private emptyClickUrl: string | null = null
  private cardDealBuffer: AudioBuffer | null = null
  private cardDealUrl: string | null = null
  private supplySlideBuffer: AudioBuffer | null = null
  private supplySlideUrl: string | null = null
  private volume: number

  constructor(options: SoundEngineOptions = {}) {
    this.volume = clamp(options.masterVolume ?? 0.9, 0, 1)
  }

  get isReady(): boolean {
    return this.ctx !== null
  }

  get isAmbientPlaying(): boolean {
    return this.ambient !== null
  }

  get masterVolume(): number {
    return this.volume
  }

  setMasterVolume(value: number): void {
    this.volume = clamp(value, 0, 1)
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05)
    }
  }

  /** Must be called from a user gesture before playback on most browsers. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  /** 后台标签页冻结整条音频图：suspend 期间 currentTime 停滞，回来时不会补播积压的节拍 */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend()
  }

  resume(): void {
    if (this.ctx?.state !== 'suspended') return
    this.ctx.resume().catch((error: unknown) => {
      console.warn('Audio context resume was rejected', error)
    })
  }

  /** Low basement mains hum, sub rumble and a slowly breathing noise bed. */
  startAmbient(): void {
    if (this.ambient) return
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.02

    const output = ctx.createGain()
    output.gain.setValueAtTime(0, t)
    output.gain.linearRampToValueAtTime(0.5, t + 1.8)
    output.connect(this.inputNode)

    const sources: AudioScheduledSourceNode[] = []

    const rumble = ctx.createOscillator()
    rumble.type = 'sine'
    rumble.frequency.value = 33.5
    const rumbleGain = ctx.createGain()
    rumbleGain.gain.value = 0.3
    rumble.connect(rumbleGain).connect(output)

    const shadow = ctx.createOscillator()
    shadow.type = 'sine'
    shadow.frequency.value = 41.2
    const shadowGain = ctx.createGain()
    shadowGain.gain.value = 0.1
    shadow.connect(shadowGain).connect(output)

    const hum = ctx.createOscillator()
    hum.type = 'sawtooth'
    hum.frequency.value = 50
    const humFilter = this.createFilter('lowpass', 190, 0.8)
    const humGain = ctx.createGain()
    humGain.gain.value = 0.04
    hum.connect(humFilter).connect(humGain).connect(output)

    const arc = ctx.createOscillator()
    arc.type = 'triangle'
    arc.frequency.value = 100
    const arcGain = ctx.createGain()
    arcGain.gain.value = 0.008
    arc.connect(arcGain).connect(output)

    const air = this.noiseSource(true)
    const airFilter = this.createFilter('lowpass', 360, 0.6)
    const airGain = ctx.createGain()
    airGain.gain.value = 0.22
    air.connect(airFilter).connect(airGain).connect(output)

    const breath = ctx.createOscillator()
    breath.type = 'sine'
    breath.frequency.value = 0.06
    const breathDepth = ctx.createGain()
    breathDepth.gain.value = 0.1
    breath.connect(breathDepth).connect(airGain.gain)

    const hiss = this.noiseSource(true)
    const hissFilter = this.createFilter('bandpass', 1350, 0.7)
    const hissGain = ctx.createGain()
    hissGain.gain.value = 0.016
    hiss.connect(hissFilter).connect(hissGain).connect(output)

    const hissLfo = ctx.createOscillator()
    hissLfo.type = 'sine'
    hissLfo.frequency.value = 0.037
    const hissDepth = ctx.createGain()
    hissDepth.gain.value = 0.006
    hissLfo.connect(hissDepth).connect(hissGain.gain)

    const oscillators = [rumble, shadow, hum, arc, breath, hissLfo]
    for (const osc of oscillators) {
      osc.start(t)
      sources.push(osc)
    }
    air.start(t, 0)
    hiss.start(t, 0.4)
    sources.push(air, hiss)

    this.ambient = { output, sources }
  }

  stopAmbient(fadeSeconds = 0.8): void {
    const ambient = this.ambient
    const ctx = this.ctx
    if (!ambient || !ctx) return
    this.ambient = null
    const t = ctx.currentTime
    ambient.output.gain.cancelScheduledValues(t)
    ambient.output.gain.setValueAtTime(ambient.output.gain.value, t)
    ambient.output.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fadeSeconds))
    for (const source of ambient.sources) {
      try {
        source.stop(t + fadeSeconds + 0.05)
      } catch {
        // A source may already have been stopped; nothing to do.
      }
    }
  }

  /** Friction of a card dragged across a coarse table, with a soft landing tap. */
  playCardSlide(): void {
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.005
    const duration = 0.4
    const source = this.noiseSource()
    const filter = this.createFilter('bandpass', 900, 0.9)
    filter.frequency.setValueAtTime(650, t)
    filter.frequency.exponentialRampToValueAtTime(3100, t + 0.14)
    filter.frequency.exponentialRampToValueAtTime(520, t + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.38, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.2)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    const flutter = ctx.createOscillator()
    flutter.type = 'sine'
    flutter.frequency.value = 27
    const flutterDepth = ctx.createGain()
    flutterDepth.gain.value = 0.06
    flutter.connect(flutterDepth).connect(gain.gain)
    source.connect(filter).connect(gain).connect(this.inputNode)
    source.start(t, Math.random() * 0.8)
    source.stop(t + duration + 0.05)
    flutter.start(t)
    flutter.stop(t + duration + 0.05)

    this.noiseHit(t + duration - 0.03, 0.08, 240, 0.8, 0.1, 'lowpass')
  }

  /** Dry metallic striker hitting an empty chamber. */
  playClickEmpty(): void {
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.005
    this.noiseHit(t, 0.035, 3200, 1.2, 0.24, 'highpass')
    this.tone(t, 0.055, 2740, 2100, 0.1, 'triangle')
    this.tone(t + 0.004, 0.16, 5100, 4300, 0.04, 'sine')
    this.tone(t, 0.06, 180, 120, 0.07, 'sine')
    this.noiseHit(t + 0.035, 0.06, 1800, 2.5, 0.06, 'bandpass')
  }

  /**
   * Deafening live round followed by a two second ringing decay.
   * 打向自己（或自己中弹）保留完整耳鸣；打向对手时缩短尾音，避免吞掉局间节奏。
   */
  playGunshot({ selfShot }: { selfShot: boolean }): void {
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.005

    this.noiseHit(t, 0.07, 1900, 0.7, 1, 'highpass')

    const bodySource = this.noiseSource()
    const bodyFilter = this.createFilter('lowpass', 2600, 0.6)
    bodyFilter.frequency.setValueAtTime(5200, t)
    bodyFilter.frequency.exponentialRampToValueAtTime(420, t + 0.42)
    const shaper = ctx.createWaveShaper()
    const curve = new Float32Array(512)
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i * 2) / (curve.length - 1) - 1
      curve[i] = Math.tanh(x * 4.5)
    }
    shaper.curve = curve
    shaper.oversample = '2x'
    const bodyGain = ctx.createGain()
    bodyGain.gain.setValueAtTime(0.0001, t)
    bodyGain.gain.exponentialRampToValueAtTime(1, t + 0.006)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    bodySource.connect(bodyFilter).connect(shaper).connect(bodyGain).connect(this.inputNode)
    bodySource.start(t, Math.random() * 0.5)
    bodySource.stop(t + 0.6)

    const delay = ctx.createDelay(0.4)
    delay.delayTime.value = 0.115
    const feedback = ctx.createGain()
    feedback.gain.setValueAtTime(0.36, t)
    feedback.gain.exponentialRampToValueAtTime(0.0001, t + 1.7)
    const damp = this.createFilter('lowpass', 1700, 0.5)
    const wet = ctx.createGain()
    wet.gain.value = 0.24
    bodyGain.connect(delay).connect(damp).connect(feedback).connect(delay)
    damp.connect(wet).connect(this.inputNode)

    this.tone(t, 0.5, 92, 34, 1, 'sine')

    // 耳鸣尾音：打对手时压到 0.8s 并降 6dB
    const ringDuration = selfShot ? 2 : 0.8
    const ringLevel = selfShot ? 1 : 0.5
    const ringStart = t + 0.09
    const ringEnd = ringStart + ringDuration
    const ring = ctx.createOscillator()
    ring.type = 'sine'
    ring.frequency.value = 4300
    const ringGain = ctx.createGain()
    ringGain.gain.setValueAtTime(0.0001, ringStart)
    ringGain.gain.linearRampToValueAtTime(0.075 * ringLevel, ringStart + 0.05)
    ringGain.gain.exponentialRampToValueAtTime(0.055 * ringLevel, ringStart + ringDuration * 0.25)
    ringGain.gain.exponentialRampToValueAtTime(0.02 * ringLevel, ringStart + ringDuration * 0.6)
    ringGain.gain.exponentialRampToValueAtTime(0.005 * ringLevel, ringStart + ringDuration * 0.875)
    ringGain.gain.exponentialRampToValueAtTime(0.0001, ringEnd)
    ring.connect(ringGain).connect(this.inputNode)
    ring.start(ringStart)
    ring.stop(ringEnd + 0.05)

    const overtone = ctx.createOscillator()
    overtone.type = 'sine'
    overtone.frequency.value = 6450
    const overtoneGain = ctx.createGain()
    overtoneGain.gain.setValueAtTime(0.0001, ringStart)
    overtoneGain.gain.linearRampToValueAtTime(0.028 * ringLevel, ringStart + ringDuration * 0.035)
    overtoneGain.gain.exponentialRampToValueAtTime(0.02 * ringLevel, ringStart + ringDuration * 0.275)
    overtoneGain.gain.exponentialRampToValueAtTime(0.008 * ringLevel, ringStart + ringDuration * 0.625)
    overtoneGain.gain.exponentialRampToValueAtTime(0.002 * ringLevel, ringStart + ringDuration * 0.9)
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, ringEnd - 0.05)
    overtone.connect(overtoneGain).connect(this.inputNode)
    overtone.start(ringStart)
    overtone.stop(ringEnd)

    const hiss = this.noiseSource()
    const hissFilter = this.createFilter('bandpass', 5600, 1.4)
    const hissGain = ctx.createGain()
    hissGain.gain.setValueAtTime(0.0001, ringStart)
    hissGain.gain.exponentialRampToValueAtTime(0.016 * ringLevel, ringStart + ringDuration * 0.025)
    hissGain.gain.exponentialRampToValueAtTime(0.006 * ringLevel, ringStart + ringDuration * 0.55)
    hissGain.gain.exponentialRampToValueAtTime(0.0015 * ringLevel, ringStart + ringDuration * 0.9)
    hissGain.gain.exponentialRampToValueAtTime(0.0001, ringEnd)
    hiss.connect(hissFilter).connect(hissGain).connect(this.inputNode)
    hiss.start(ringStart, 0.2)
    hiss.stop(ringEnd + 0.05)
  }

  /** One lub-dub cycle; callers repeat it faster as health drops. */
  playHeartbeat(bpm: number): void {
    const ctx = this.ensureContext()
    const safeBpm = Number.isFinite(bpm) ? clamp(bpm, 40, 200) : 72
    const interval = 60 / safeBpm
    const t = ctx.currentTime + 0.01
    this.thump(t, 0.26)
    this.thump(t + Math.min(interval * 0.32, 0.3), 0.17)
  }

  /** 外部底噪（环境录音主体）：fetch→decode→loop→compressor 前；失败回落纯合成床 */
  async startRoomTone(url: string): Promise<boolean> {
    const ctx = this.ensureContext()
    if (!this.roomToneBuffer) {
      try {
        const response = await fetch(url)
        if (!response.ok) return false
        this.roomToneBuffer = await ctx.decodeAudioData(await response.arrayBuffer())
      } catch {
        return false
      }
    }
    if (this.roomTone) return true
    const t = ctx.currentTime + 0.02
    const source = ctx.createBufferSource()
    source.buffer = this.roomToneBuffer
    source.loop = true
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.5, t + 1.8)
    source.connect(gain).connect(this.inputNode)
    source.start(t, Math.random() * 0.5)
    this.roomTone = { source, gain }
    // 外部底噪在时合成床退居兜底
    if (this.ambient) this.ambient.output.gain.setTargetAtTime(0.25, t, 0.5)
    return true
  }

  setRoomToneLevel(level: number, fade = 0.6): void {
    if (!this.roomTone || !this.ctx) return
    this.roomTone.gain.gain.setTargetAtTime(clamp(level, 0, 1), this.ctx.currentTime, fade / 3)
  }

  stopRoomTone(fade = 0.8): void {
    const tone = this.roomTone
    const ctx = this.ctx
    if (!tone || !ctx) return
    this.roomTone = null
    const t = ctx.currentTime
    tone.gain.gain.cancelScheduledValues(t)
    tone.gain.gain.setValueAtTime(tone.gain.gain.value, t)
    tone.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fade))
    try {
      tone.source.stop(t + fade + 0.05)
    } catch {
      // 可能已停止
    }
    if (this.ambient) this.ambient.output.gain.setTargetAtTime(0.5, t, 0.5)
  }

  /** 打字机键音：极短的机械 tick */
  playTypeTick(): void {
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.002
    this.noiseHit(t, 0.014, 3800, 2, 0.045, 'highpass')
    this.tone(t, 0.02, 1250, 900, 0.02, 'square')
  }

  /** 走廊底噪：38Hz 低鸣 + 低通噪声，随 CRT 故障加深 */
  private corridorDrone: { output: GainNode; sources: AudioScheduledSourceNode[] } | null = null

  startCorridorDrone(): void {
    if (this.corridorDrone) return
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.02
    const output = ctx.createGain()
    output.gain.setValueAtTime(0, t)
    output.gain.linearRampToValueAtTime(0.4, t + 1.2)
    output.connect(this.inputNode)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 38
    const oscGain = ctx.createGain()
    oscGain.gain.value = 0.5
    osc.connect(oscGain).connect(output)
    const noise = this.noiseSource()
    const filter = this.createFilter('lowpass', 110, 0.8)
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.6
    noise.connect(filter).connect(noiseGain).connect(output)
    osc.start(t)
    noise.start(t)
    this.corridorDrone = { output, sources: [osc, noise] }
  }

  setCorridorDroneLevel(level: number, fade = 0.3): void {
    const ctx = this.ctx
    if (!this.corridorDrone || !ctx) return
    this.corridorDrone.output.gain.setTargetAtTime(0.4 * level, ctx.currentTime, fade)
  }

  stopCorridorDrone(fadeSeconds = 0.5): void {
    const drone = this.corridorDrone
    const ctx = this.ctx
    if (!drone || !ctx) return
    this.corridorDrone = null
    const t = ctx.currentTime
    drone.output.gain.cancelScheduledValues(t)
    drone.output.gain.setValueAtTime(drone.output.gain.value, t)
    drone.output.gain.linearRampToValueAtTime(0, t + Math.max(0.05, fadeSeconds))
    for (const source of drone.sources) {
      try {
        source.stop(t + fadeSeconds + 0.05)
      } catch {
        // 已停止的节点重复 stop 会抛错，忽略
      }
    }
  }

  /** 预解码实录门轴声（fetch→decode），点门时零延迟触发；失败时门无声 */
  async preloadIntroDoor(url: string): Promise<boolean> {
    if (this.introDoorBuffer && this.introDoorUrl === url) return true
    const ctx = this.ensureContext()
    try {
      const response = await fetch(url)
      if (!response.ok) return false
      this.introDoorBuffer = await ctx.decodeAudioData(await response.arrayBuffer())
      this.introDoorUrl = url
      return true
    } catch {
      this.introDoorBuffer = null
      this.introDoorUrl = null
      return false
    }
  }

  /** 预解码发牌的拍桌实录，失败时回落合成滑牌声 */
  async preloadCardDeal(url: string): Promise<boolean> {
    if (this.cardDealBuffer && this.cardDealUrl === url) return true
    const ctx = this.ensureContext()
    try {
      const response = await fetch(url)
      if (!response.ok) return false
      this.cardDealBuffer = await ctx.decodeAudioData(await response.arrayBuffer())
      this.cardDealUrl = url
      return true
    } catch {
      this.cardDealBuffer = null
      this.cardDealUrl = null
      return false
    }
  }

  /** 预解码补给托盘滑轨（Mixkit #1524），点开补给时零延迟触发 */
  async preloadSupplySlide(url: string): Promise<boolean> {
    if (this.supplySlideBuffer && this.supplySlideUrl === url) return true
    const ctx = this.ensureContext()
    try {
      const response = await fetch(url)
      if (!response.ok) return false
      this.supplySlideBuffer = await ctx.decodeAudioData(await response.arrayBuffer())
      this.supplySlideUrl = url
      return true
    } catch {
      this.supplySlideBuffer = null
      this.supplySlideUrl = null
      return false
    }
  }

  /**
   * 发牌：录音是「牌拍在桌上」的一声，不是滑牌，所以让拍击点落在卡片快就位时。
   * 动画用 easeOutCubic、总长 0.52s：0.20s 时卡片已走完 76%，0.26s 走完 88%。
   * 录音 0.097s 前是静音、峰值在 0.159s，因此起点延后 0.20s、从 0.097s 起播，
   * 峰值落在 0.262s，尾部静音截断到 0.18s 长度。
   * 素材是 22.05kHz 单声道 WAV（OGG 在 iOS Safari 上不支持）。
   */
  playCardDealRecorded(): boolean {
    const ctx = this.ensureContext()
    if (!this.cardDealBuffer) {
      this.playCardSlide()
      return false
    }
    const t = ctx.currentTime + 0.2
    const source = ctx.createBufferSource()
    source.buffer = this.cardDealBuffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(1, t)
    gain.gain.setValueAtTime(1, t + 0.165)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.18)
    source.connect(gain).connect(this.inputNode)
    source.start(t, 0.097, 0.18)
    return true
  }

  /**
   * 道具格升起：托盘 0.64s、easeOutCubic 走完 0.42m。
   * 滑轨 #1524 从 0.19s 起播、×1.45，播到 0.64s（源 1.12s 已衰减到 -55dB，尾部再淡 25ms）。
   * 只这一层，不叠落座咔哒；录音峰值 -14.3dBFS，给 2.4 倍补到约 -6.7。
   */
  playSupplyTrayRise(): boolean {
    const ctx = this.ensureContext()
    if (!this.supplySlideBuffer) return false
    const t = ctx.currentTime + 0.01
    const slide = ctx.createBufferSource()
    slide.buffer = this.supplySlideBuffer
    slide.playbackRate.value = 1.45
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(2.4, t)
    gain.gain.setValueAtTime(2.4, t + 0.615)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.64)
    slide.connect(gain).connect(this.inputNode)
    slide.start(t, 0.19)
    slide.stop(t + 0.645)
    return true
  }

  /**
   * 装弹时弹仓总览：8 颗子弹从 0.46s 起逐个升起，最后一颗约 1.30s 到位。
   * 同一条 #1524 滑轨，从 0.19s 起、×1.0 播 0.90s（源 1.09s 已到 -55dB），尾部 30ms 淡出。
   */
  playBulletTrayReveal(): boolean {
    const ctx = this.ensureContext()
    if (!this.supplySlideBuffer) return false
    const t = ctx.currentTime + 0.01
    const slide = ctx.createBufferSource()
    slide.buffer = this.supplySlideBuffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(2.4, t)
    gain.gain.setValueAtTime(2.4, t + 0.87)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.9)
    slide.connect(gain).connect(this.inputNode)
    slide.start(t, 0.19)
    slide.stop(t + 0.905)
    return true
  }

  /** 预解码空膛击发的实录咔哒声，失败时回落合成声 */
  async preloadEmptyClick(url: string): Promise<boolean> {
    if (this.emptyClickBuffer && this.emptyClickUrl === url) return true
    const ctx = this.ensureContext()
    try {
      const response = await fetch(url)
      if (!response.ok) return false
      this.emptyClickBuffer = await ctx.decodeAudioData(await response.arrayBuffer())
      this.emptyClickUrl = url
      return true
    } catch {
      this.emptyClickBuffer = null
      this.emptyClickUrl = null
      return false
    }
  }

  /**
   * 空膛击发：只取录音里第一下咔哒（0.19–0.30s），与 0.1s 枪口闪光同帧起、在后坐收尾前结束。
   * 录音本身峰值 +2.3dBFS（两处削波），所以增益压到 0.7。
   */
  playEmptyClickRecorded(): boolean {
    const ctx = this.ensureContext()
    if (!this.emptyClickBuffer) {
      this.playClickEmpty()
      return false
    }
    const t = ctx.currentTime + 0.005
    const source = ctx.createBufferSource()
    source.buffer = this.emptyClickBuffer
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.7, t)
    gain.gain.setValueAtTime(0.7, t + 0.09)
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.115)
    source.connect(gain).connect(this.inputNode)
    source.start(t, 0.19)
    source.stop(t + 0.12)
    return true
  }


  /**
   * 开头推门：与左门 1.1 秒开门动画对齐。
   * 录音 0.131s 前是静音、0.802s 后是静音，所以从 0.131s 起播；
   * rate 0.7909 使 0.671s 的有效声音拉长到约 0.85s，收在门将转完时。
   */
  playIntroDoor(): boolean {
    const ctx = this.ensureContext()
    if (!this.introDoorBuffer) return false
    const t = ctx.currentTime + 0.01
    const source = ctx.createBufferSource()
    source.buffer = this.introDoorBuffer
    source.playbackRate.value = 0.7909
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.88, t)
    source.connect(gain).connect(this.inputNode)
    source.start(t, 0.131)
    source.stop(t + 1.1)
    return true
  }

  /** 推门瞬间的耳鸣：3.2kHz 细高频，慢起快收 */
  playTinnitus(): void {
    const ctx = this.ensureContext()
    const t = ctx.currentTime + 0.005
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 3200
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.02, t + 0.4)
    gain.gain.linearRampToValueAtTime(0.0001, t + 2.6)
    osc.connect(gain).connect(this.inputNode)
    osc.start(t)
    osc.stop(t + 2.7)
  }

  dispose(): void {
    this.stopAmbient(0.05)
    this.stopCorridorDrone(0.05)
    this.stopRoomTone(0.05)
    this.roomToneBuffer = null
    this.introDoorBuffer = null
    this.introDoorUrl = null
    this.emptyClickBuffer = null
    this.emptyClickUrl = null
    this.cardDealBuffer = null
    this.cardDealUrl = null
    this.supplySlideBuffer = null
    this.supplySlideUrl = null
    const ctx = this.ctx
    this.ctx = null
    this.input = null
    this.master = null
    this.noiseBuffer = null
    if (ctx && ctx.state !== 'closed') {
      void ctx.close()
    }
  }

  private ensureContext(): AudioContext {
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined') {
      throw new Error('Web Audio API is not available in this environment')
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -16
    compressor.knee.value = 22
    compressor.ratio.value = 7
    compressor.attack.value = 0.002
    compressor.release.value = 0.26

    const master = ctx.createGain()
    master.gain.value = this.volume
    compressor.connect(master)
    master.connect(ctx.destination)

    this.ctx = ctx
    this.input = compressor
    this.master = master
    return ctx
  }

  private get inputNode(): AudioNode {
    if (!this.input) throw new Error('Audio graph is not initialised')
    return this.input
  }

  private createFilter(type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const ctx = this.ensureContext()
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = frequency
    filter.Q.value = q
    return filter
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const ctx = this.ensureContext()
    const source = ctx.createBufferSource()
    source.buffer = this.getNoiseBuffer()
    source.loop = loop
    return source
  }

  private getNoiseBuffer(): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer
    const ctx = this.ensureContext()
    const length = Math.floor(ctx.sampleRate * 2 * SECONDS)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private tone(
    when: number,
    duration: number,
    fromHz: number,
    toHz: number,
    peak: number,
    type: OscillatorType,
  ): void {
    const ctx = this.ensureContext()
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(Math.max(1, fromHz), when)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), when + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    osc.connect(gain).connect(this.inputNode)
    osc.start(when)
    osc.stop(when + duration + 0.03)
  }

  private noiseHit(
    when: number,
    duration: number,
    frequency: number,
    q: number,
    peak: number,
    type: BiquadFilterType,
  ): void {
    const ctx = this.ensureContext()
    const source = this.noiseSource()
    const filter = this.createFilter(type, frequency, q)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    source.connect(filter).connect(gain).connect(this.inputNode)
    source.start(when, Math.random() * 0.8)
    source.stop(when + duration + 0.03)
  }

  private thump(when: number, peak: number): void {
    this.tone(when, 0.22, 68, 34, peak, 'sine')
    this.noiseHit(when, 0.09, 120, 0.9, peak * 0.18, 'lowpass')
  }
}
