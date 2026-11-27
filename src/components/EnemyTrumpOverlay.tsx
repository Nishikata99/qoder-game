import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { TrumpId } from '../game/GameEngine'
import { TrumpFace } from './TrumpHandOverlay'

/**
 * 敌方亮王牌：卡面与玩家手牌同一套，但从上方区域侧滑入场，
 * 位置比玩家底部的王牌扇高，一眼能区分归属；点空白或 5s 后从另一侧滑出。
 */
export function EnemyTrumpOverlay({ trump, onDismiss }: { readonly trump: TrumpId; readonly onDismiss: () => void }) {
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const dismissTimer = useRef<number | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const close = () => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    dismissTimer.current = window.setTimeout(() => onDismissRef.current(), 320)
  }

  useEffect(() => {
    const auto = window.setTimeout(close, 9000)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(auto)
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <div
      data-testid="enemy-trump-overlay"
      role="dialog"
      aria-label="敌方王牌"
      className={`absolute inset-0 z-40 flex items-start justify-center overflow-hidden px-4 pt-[14vh] transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(ellipse at 50% 32%, rgba(4,6,5,0.04), rgba(4,6,5,0.55))' }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="pointer-events-none absolute left-1/2 top-[5.5vh] -translate-x-1/2 text-center">
        <p className="font-display text-sm tracking-[0.32em] text-red-200/75">它亮出了一张王牌</p>
        <p className="mt-1 text-[10px] tracking-[0.24em] text-bone-200/35 uppercase">点击空白处收起 · ESC</p>
      </div>
      <div
        className={`trump-card pointer-events-auto relative h-[36vh] max-h-[330px] min-h-[220px] w-[15vw] min-w-[132px] max-w-[178px] border-2 border-amber-300/65 bg-[#1b1511] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.72)] ${closing ? 'trump-card-out' : 'trump-card-in'}`}
        style={{ '--fan': '-4deg', '--lift': '0px' } as CSSProperties}
      >
        <TrumpFace trump={trump} />
      </div>
    </div>
  )
}
