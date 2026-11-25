import { useEffect, useRef, useState } from 'react'

const RADIUS = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const RESET_SECONDS = 0.22

export function LongPressSkipIndicator({
  active,
  duration = 1.5,
  onComplete,
}: {
  readonly active: boolean
  readonly duration?: number
  readonly onComplete: () => void
}) {
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const holdingRef = useRef(false)
  const completedRef = useRef(false)
  const lastRef = useRef(0)
  const completeRef = useRef(onComplete)

  useEffect(() => {
    completeRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    progressRef.current = 0
    holdingRef.current = false
    completedRef.current = false
    lastRef.current = 0
    setProgress(0)
    if (!active) return

    let raf = 0
    const frame = (now: number) => {
      if (completedRef.current) return
      if (lastRef.current === 0) lastRef.current = now
      const dt = Math.max(0, (now - lastRef.current) / 1000)
      lastRef.current = now
      if (holdingRef.current) {
        progressRef.current = Math.min(1, progressRef.current + dt / duration)
      } else {
        progressRef.current = Math.max(0, progressRef.current - dt / RESET_SECONDS)
      }
      setProgress(progressRef.current)
      if (progressRef.current >= 1) {
        completedRef.current = true
        holdingRef.current = false
        completeRef.current()
        return
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const isSpace = (event: KeyboardEvent) => event.code === 'Space' || event.key === ' '
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSpace(event) || event.repeat || completedRef.current) return
      event.preventDefault()
      holdingRef.current = true
      lastRef.current = performance.now()
    }
    const release = () => {
      holdingRef.current = false
      lastRef.current = performance.now()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpace(event)) return
      event.preventDefault()
      release()
    }
    const onVisibility = () => { if (document.hidden) release() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, duration])

  if (!active) return null
  const percent = Math.round(progress * 100)
  return (
    <div
      className="pointer-events-auto absolute right-4 bottom-[4vh] z-10 flex cursor-pointer touch-none select-none items-center gap-2 text-bone-200/65"
      data-testid="corridor-hold-skip"
      data-progress={percent}
      role="button"
      tabIndex={0}
      aria-label="长按空格或触摸跳过廊道剧情"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        holdingRef.current = true
        lastRef.current = performance.now()
      }}
      onPointerUp={() => {
        holdingRef.current = false
        lastRef.current = performance.now()
      }}
      onPointerCancel={() => {
        holdingRef.current = false
        lastRef.current = performance.now()
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.repeat) return
        event.preventDefault()
        holdingRef.current = true
        lastRef.current = performance.now()
      }}
      onKeyUp={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        holdingRef.current = false
        lastRef.current = performance.now()
      }}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={RADIUS} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.45" />
        <circle
          cx="24"
          cy="24"
          r={RADIUS}
          fill="none"
          stroke="#d06a45"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className="font-display text-[10px] tracking-[0.24em] whitespace-nowrap">长按跳过</span>
    </div>
  )
}
