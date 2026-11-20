import { useEffect, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import type { NarrativeDirector, NarrativeVisual } from './NarrativeDirector'

const CHAR_MS = 65
const PAUSE_MS = 260
const PAUSE_CHARS = '，。、！？…—'

export function NarrativeOverlay({
  director,
  sound,
  visual,
}: {
  readonly director: NarrativeDirector
  readonly sound: SoundEngine
  readonly visual: NarrativeVisual
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
        acc += CHAR_MS + (PAUSE_CHARS.includes(ch) ? PAUSE_MS : 0)
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
      <div
        className="absolute inset-0 bg-black transition-opacity duration-700"
        style={{ opacity: visual.black }}
      />
      <div
        className="narrative-bar absolute inset-x-0 top-0 bg-black"
        style={{ height: visual.letterbox ? '9vh' : '0vh' }}
      />
      <div
        className="narrative-bar absolute inset-x-0 bottom-0 bg-black"
        style={{ height: visual.letterbox ? '9vh' : '0vh' }}
      />
      {/* T3 账页：右侧滑入停两拍，「小满。已收。」即字幕，不另加旁白 */}
      <div
        className="pointer-events-none absolute top-1/2 right-[7vw] w-56 p-5 font-display shadow-2xl transition-transform duration-700"
        style={{
          transform: `translateY(-50%) rotate(2deg) translateX(${visual.ledger ? '0%' : '150%'})`,
          background: 'linear-gradient(160deg, #c9b998, #b3a184)',
          color: '#2c2016',
        }}
      >
        <p className="text-[0.6rem] tracking-[0.3em] opacity-60">账房 · 欠收登记</p>
        <div className="mt-3 space-y-2 border-t border-[#5a4632]/40 pt-3">
          <div className="h-px bg-[#5a4632]/25" />
          <div className="h-px bg-[#5a4632]/25" />
          <div className="h-px bg-[#5a4632]/25" />
          <p className="pt-2 text-lg tracking-[0.2em]">小满。已收。</p>
        </div>
      </div>
      {subtitle ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[12vh] flex justify-center px-6">
          <p className="narrative-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] text-bone-200/90">
            {subtitle.text.slice(0, typed)}
          </p>
        </div>
      ) : null}
    </div>
  )
}