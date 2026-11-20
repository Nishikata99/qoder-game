const SOURCE_URL = `${import.meta.env.BASE_URL}sfx/card-flip.wav`
const REFERENCE_FLIP = 0.62
const VOLUME = 0.85

/**
 * playCardFlip 的 A 版素材：mixkit 甩牌 + 落桌声剪辑，0ms 开翻、620ms 落牌。
 * 文件按 flipTime 等比变速，让落桌声对上 organ 牌 0.694s 的翻牌动画。
 */
export class CardFlipSound {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private buffer: AudioBuffer | null = null
  private noise: AudioBuffer | null = null
  private loading: Promise<void> | null = null
  private disposed = false

  preload(): void {
    if (this.loading || this.buffer || this.disposed) return
    const ctx = this.ensureContext()
    if (!ctx) return
    this.loading = fetch(SOURCE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`card-flip.wav ${res.status}`)
        return res.arrayBuffer()
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        if (!this.disposed) this.buffer = buffer
      })
      .catch(() => {
        this.loading = null
      })
  }

  /** 首次用户手势时调用；浏览器要求手势之后才能出声。 */
  unlock(): void {
    const ctx = this.ensureContext()
    if (ctx && ctx.state === 'suspended') void ctx.resume()
    this.preload()
  }

  play(flipTime: number): void {
    const ctx = this.ctx
    if (!ctx || !this.buffer || this.disposed) {
      this.preload()
      return
    }
    if (ctx.state === 'suspended') void ctx.resume()
    const source = ctx.createBufferSource()
    source.buffer = this.buffer
    source.playbackRate.value = Math.min(1.25, Math.max(0.75, REFERENCE_FLIP / flipTime))
    source.connect(this.output(ctx))
    source.start()
  }

   /** 清毒（肝把毒变回未翻牌，或注射器抽走来源格）时的短促擦拭声。 */
  playCleanse(): void {
    const ctx = this.ctx
    if (!ctx || this.disposed) return
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime + 0.01
    const source = ctx.createBufferSource()
    source.buffer = this.noiseBuffer(ctx)
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.9
    filter.frequency.setValueAtTime(2600, t)
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.26)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    source.connect(filter).connect(gain).connect(this.output(ctx))
    source.start(t, 0)
    source.stop(t + 0.32)
    this.tone(t + 0.07, 0.16, 1180, 1560, 0.06)
  }

  dispose(): void {
    this.disposed = true
    this.buffer = null
    this.noise = null
    this.loading = null
    const ctx = this.ctx
    this.ctx = null
    this.out = null
    if (ctx && ctx.state !== 'closed') void ctx.close()
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx || this.disposed) return this.ctx
    if (typeof window === 'undefined') return null
    this.ctx = new AudioContext({ latencyHint: 'interactive' })
    return this.ctx
  }

  private output(ctx: AudioContext): GainNode {
    if (this.out) return this.out
    const out = ctx.createGain()
    out.gain.value = VOLUME
    out.connect(ctx.destination)
    this.out = out
    return out
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    this.noise = buffer
    return buffer
  }

  private tone(when: number, duration: number, fromHz: number, toHz: number, peak: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(Math.max(1, fromHz), when)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), when + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    osc.connect(gain).connect(this.output(ctx))
    osc.start(when)
    osc.stop(when + duration + 0.03)
  }
}
