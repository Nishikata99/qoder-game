import { useEffect, useState } from 'react'
import type { ActorId, GameSnapshot } from '../game/GameEngine'
import type { TableAction } from '../scene/SceneManager'

const COARSE_POINTER = '(pointer: coarse)'
const PORTRAIT = '(orientation: portrait)'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 只认粗指针（手机/平板）；桌面鼠标永远 false，保证电脑端零变化 */
export function useMobileLayout(): { readonly coarse: boolean; readonly portrait: boolean } {
  return { coarse: useMediaQuery(COARSE_POINTER), portrait: useMediaQuery(PORTRAIT) }
}

export function RotateGate({ active }: { readonly active: boolean }) {
  if (!active) return null
  return (
    <div
      data-testid="rotate-gate"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-abyss-950 px-8 text-center"
    >
      <div className="rotate-phone h-16 w-28 rounded-md border-2 border-bone-200/45">
        <div className="m-1.5 h-[calc(100%-0.75rem)] rounded-sm border border-bone-200/15" />
      </div>
      <p className="font-display text-2xl tracking-[0.2em] text-bone-200/90">请横屏游玩</p>
      <p className="max-w-xs text-xs leading-relaxed text-bone-200/45">
        牌桌和操作键需要横向空间，把手机转过来即可继续
      </p>
    </div>
  )
}

export function MobileControls({
  snapshot,
  visible,
  actionsAllowed,
  onAction,
  onTrump,
  onTarget,
  targetReady,
}: {
  readonly snapshot: GameSnapshot | null
  readonly visible: boolean
  readonly actionsAllowed: boolean
  readonly onAction: (action: TableAction) => void
  readonly onTrump: () => void
  readonly onTarget: (target: ActorId) => void
  readonly targetReady: boolean
}) {
  if (!visible || !snapshot) return null
  const targeting = snapshot.phase === 'targeting' && snapshot.pendingShot === 'player'
  if (snapshot.phase !== 'playerTurn' && !targeting) return null

  const busted = snapshot.player.hand.busted
  const trumps = snapshot.player.trumps.length
  const hitDisabled = !actionsAllowed || busted
  const standDisabled = !actionsAllowed
  const trumpDisabled = !actionsAllowed || trumps === 0

  return (
    <div
      data-testid="mobile-controls"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex flex-col items-center gap-1.5 px-3"
      style={{ paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}
    >
      {targeting ? (
        <>
          <p className="rounded-sm border border-rust-500/30 bg-black/70 px-3 py-1 text-[10px] tracking-[0.22em] text-rust-300/70">
            {targetReady ? '选择枪口' : '枪正在举起…'}
          </p>
          <div className="touch-bar pointer-events-auto flex items-stretch gap-2">
            <button
              type="button"
              data-testid="mobile-shoot-boss"
              disabled={!targetReady}
              onClick={() => onTarget('boss')}
              className={`metal-btn metal-btn--primary touch-danger min-h-12 min-w-0 px-5 py-3 text-[0.72rem] ${targetReady ? '' : 'is-disabled'}`}
            >
              射向它
            </button>
            <button
              type="button"
              data-testid="mobile-shoot-player"
              disabled={!targetReady}
              onClick={() => onTarget('player')}
              className={`metal-btn metal-btn--primary touch-danger min-h-12 min-w-0 px-5 py-3 text-[0.72rem] ${targetReady ? '' : 'is-disabled'}`}
            >
              射向自己
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="touch-bar pointer-events-auto flex items-stretch gap-2">
            <button
              type="button"
              data-testid="mobile-hit"
              disabled={hitDisabled}
              onClick={() => onAction('hit')}
              className={`metal-btn min-h-12 min-w-0 px-5 py-3 text-[0.72rem] ${hitDisabled ? 'is-disabled' : ''}`}
            >
              要牌
            </button>
            <button
              type="button"
              data-testid="mobile-stand"
              disabled={standDisabled}
              onClick={() => onAction('stand')}
              className={`metal-btn min-h-12 min-w-0 px-5 py-3 text-[0.72rem] ${standDisabled ? 'is-disabled' : ''}`}
            >
              停牌
            </button>
            {trumps > 0 ? (
              <button
                type="button"
                data-testid="mobile-trump"
                disabled={trumpDisabled}
                onClick={onTrump}
                className={`metal-btn metal-btn--ghost min-h-12 min-w-0 px-4 py-3 text-[0.68rem] ${trumpDisabled ? 'is-disabled' : ''}`}
              >
                王牌 {trumps}
              </button>
            ) : null}
          </div>
          {busted ? (
            <p className="text-[10px] tracking-[0.12em] text-rust-300/70">已爆牌，只能停牌或打王牌</p>
          ) : null}
        </>
      )}
    </div>
  )
}