import { useEffect, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import type { NarrativeDirector, NarrativeVisual } from './NarrativeDirector'
import { EnemyDialogueBox } from './EnemyDialogueBox'
import { TYPE_CHAR_MS, TYPE_PAUSE_CHARS, TYPE_PAUSE_MS } from './dialogue'

export function NarrativeOverlay({
  director,
  sound,
  visual,
  canSkip,
  onSkip,
}: {
  readonly director: NarrativeDirector
  readonly sound: SoundEngine
  readonly visual: NarrativeVisual
  readonly canSkip: boolean
  readonly onSkip: () => void
}) {
  const [typed, setTyped] = useState(0)
  const subtitle = visual.subtitle

  useEffect(() => {
    if (!subtitle) {
      setTyped(0)
      return
    }
    let raf = 0
    let last = -1
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const elapsed = (director.now() - subtitle.at) * 1000
      let acc = 0
      let count = 0
      for (const ch of subtitle.text) {
        if (elapsed < acc) break
        count += 1
        acc += TYPE_CHAR_MS + (TYPE_PAUSE_CHARS.includes(ch) ? TYPE_PAUSE_MS : 0)
      }
      if (count !== last) {
        if (count > last && last >= 0) sound.playTypeTick()
        last = count
        setTyped(count)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [subtitle, director, sound])

  if (!visual.active) return null

  return (
    <div className="absolute inset-0 z-40" data-testid="narrative-overlay">
      <span className="sr-live" aria-live="polite">{subtitle?.text}</span>
      <div
        className="absolute inset-0 bg-black transition-opacity duration-700"
        style={{ opacity: visual.black }}
      />
      <div
        className="narrative-focus pointer-events-none absolute inset-0"
        style={{
          backdropFilter: `blur(${visual.focus}px)`,
          WebkitBackdropFilter: `blur(${visual.focus}px)`,
          transition: 'backdrop-filter 1.6s ease-out, -webkit-backdrop-filter 1.6s ease-out',
        }}
      />
      <div
        className="narrative-bar absolute inset-x-0 top-0 bg-black"
        style={{ height: visual.letterbox ? '9vh' : '0vh' }}
      />
      <div
        className="narrative-bar absolute inset-x-0 bottom-0 bg-black"
        style={{ height: visual.letterbox ? '9vh' : '0vh' }}
      />
      {/* T3 账页：右侧滑入停两拍，转记记录即字幕，不另加旁白 */}
      <div
        className="pointer-events-none absolute top-1/2 right-[7vw] w-56 p-5 font-display shadow-2xl transition-transform duration-700"
        style={{
          transform: `translateY(-50%) rotate(2deg) translateX(${visual.ledger ? '0%' : '150%'})`,
          background: 'linear-gradient(160deg, #c9b998, #b3a184)',
          color: '#2c2016',
        }}
      >
        <p className="text-[0.6rem] tracking-[0.3em] opacity-60">账房 · 血债转记</p>
        <div className="mt-3 space-y-2 border-t border-[#5a4632]/40 pt-3">
          <div className="h-px bg-[#5a4632]/25" />
          <div className="h-px bg-[#5a4632]/25" />
          <div className="h-px bg-[#5a4632]/25" />
          <dl className="space-y-1.5 pt-2 text-[0.8rem] leading-relaxed tracking-[0.08em]">
            <div className="flex justify-between gap-2">
              <dt className="opacity-55">原担保人</dt>
              <dd>小棠</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-55">欠血</dt>
              <dd>已付七袋</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="opacity-55">去向</dt>
              <dd className="text-right">转三楼补针 · 已收</dd>
            </div>
          </dl>
        </div>
      </div>
      {subtitle?.channel === 'enemy' ? (
        <EnemyDialogueBox getAnchor={() => director.bossDialogueAnchor()}>
          {subtitle.text.slice(0, typed)}
        </EnemyDialogueBox>
      ) : subtitle ? (
        <div data-testid="bottom-dialogue" className="pointer-events-none absolute inset-x-0 bottom-[12vh] flex justify-center px-6">
          <p
            className={`narrative-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] ${
              subtitle.channel === 'sister' ? 'sister-dialogue text-amber-100/95' : 'text-bone-200/90'
            }`}
          >
            {subtitle.text.slice(0, typed)}
          </p>
        </div>
      ) : null}
      {canSkip ? (
        <button
          type="button"
          onClick={onSkip}
          className="absolute right-4 bottom-[4vh] z-10 border border-white/12 bg-black/55 px-3 py-1.5 text-[10px] tracking-[0.3em] text-bone-200/55 uppercase backdrop-blur-sm hover:border-rust-500/50 hover:text-bone-200/85"
        >
          跳过本段
        </button>
      ) : null}
    </div>
  )
}