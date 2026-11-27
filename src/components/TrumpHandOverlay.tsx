import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { TRUMP_CATALOG, type TrumpId } from '../game/GameEngine'

/** 王牌卡面：玩家手牌与敌方亮牌共用同一套视觉，避免两处样式漂移 */
export function TrumpFace({ trump }: { readonly trump: TrumpId }) {
  const definition = TRUMP_CATALOG[trump]
  return (
    <>
      <span className="absolute inset-[7px] border border-amber-200/25" />
      <span className="relative flex h-full flex-col items-center text-center">
        <span className="mt-3 font-display text-[10px] tracking-[0.28em] text-amber-200/55 uppercase">Trump</span>
        <span className="my-2 font-display text-5xl leading-none text-amber-200">{definition.glyph}</span>
        <span className="font-display text-lg leading-tight text-bone-100">{definition.name}</span>
        <span className="mt-0.5 font-display text-[9px] tracking-[0.16em] text-bone-200/40 uppercase">{definition.enName}</span>
        <span className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-bone-200/65">{definition.summary}</span>
      </span>
    </>
  )
}

export function TrumpHandOverlay({
  cards,
  onUse,
  onClose,
}: {
  readonly cards: readonly TrumpId[]
  readonly onUse: (index: number) => void
  readonly onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimer = useRef<number | null>(null)

  const close = (useIndex?: number) => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (useIndex === undefined) onClose()
      else onUse(useIndex)
    }, 320)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    }
  }, [])

  if (cards.length === 0) return null

  return (
    <div
      data-testid="trump-hand-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="王牌手牌"
      className={`absolute inset-0 z-50 flex items-end justify-center overflow-hidden px-4 pb-[12vh] transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(ellipse at 50% 58%, rgba(4,6,5,0.12), rgba(4,6,5,0.76))' }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-[16vh] -translate-x-1/2 text-center">
        <p className="font-display text-xl tracking-[0.32em] text-amber-200/85">选择王牌</p>
        <p className="mt-2 text-[10px] tracking-[0.24em] text-bone-200/45 uppercase">点击空白处收起 · ESC</p>
      </div>

      <div className="pointer-events-none flex items-end justify-center">
        {cards.map((trump, index) => {
          const definition = TRUMP_CATALOG[trump]
          const center = (cards.length - 1) / 2
          const narrow = window.innerWidth <= 420
          const fan = (index - center) * (narrow ? 2.5 : 8)
          const lift = Math.abs(index - center) * (narrow ? 4 : 9)
          const style = {
            '--fan': `${fan}deg`,
            '--lift': `${lift}px`,
            animationDelay: `${index * 45}ms`,
            zIndex: index + 1,
            marginLeft: index === 0 ? 0 : narrow ? '-62px' : '-42px',
          } as CSSProperties
          return (
            <button
              key={`${trump}-${index}`}
              type="button"
              aria-label={`使用${definition.name}（${definition.enName}）：${definition.summary}`}
              className={`trump-card pointer-events-auto relative h-[36vh] max-h-[330px] min-h-[220px] w-[15vw] min-w-[132px] max-w-[178px] origin-bottom border-2 border-amber-300/65 bg-[#1b1511] p-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.72)] transition-[filter,transform] duration-150 hover:z-20 hover:brightness-125 ${closing ? 'trump-card-out' : 'trump-card-in'}`}
              style={style}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => close(index)}
            >
              <TrumpFace trump={trump} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
