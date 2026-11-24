import { useEffect, useRef, type ReactNode } from 'react'

interface DialogueAnchor {
  readonly x: number
  readonly y: number
  readonly visible: boolean
}

export function EnemyDialogueBox({
  children,
  getAnchor,
}: {
  readonly children: ReactNode
  readonly getAnchor: () => DialogueAnchor
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const getAnchorRef = useRef(getAnchor)
  getAnchorRef.current = getAnchor

  useEffect(() => {
    let raf = 0
    const update = () => {
      const box = boxRef.current
      if (!box) {
        raf = requestAnimationFrame(update)
        return
      }
      const anchor = getAnchorRef.current()
      if (!anchor.visible) {
        box.style.visibility = 'hidden'
        box.style.opacity = '0'
        raf = requestAnimationFrame(update)
        return
      }
      const width = box.offsetWidth
      const height = box.offsetHeight
      const left = Math.max(16, Math.min(anchor.x * window.innerWidth + 84, window.innerWidth - width - 16))
      const top = Math.max(16, Math.min(anchor.y * window.innerHeight - height / 2, window.innerHeight - height - 16))
      box.style.visibility = 'visible'
      box.style.left = `${left}px`
      box.style.top = `${top}px`
      box.style.opacity = '1'
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={boxRef}
      data-testid="enemy-dialogue-box"
      className="pointer-events-none absolute z-20 w-[min(22rem,34vw)] border border-red-900/60 bg-black/85 px-4 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
      style={{ left: 16, top: 16, opacity: 0 }}
    >
      <span className="absolute top-1/2 -left-1.5 h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-red-900/60 bg-black/85" />
      <div className="narrative-subtitle font-display text-sm leading-relaxed tracking-[0.12em] text-red-50/90">
        {children}
      </div>
    </div>
  )
}
