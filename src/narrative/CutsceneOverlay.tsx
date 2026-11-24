import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import { Cutscene2D, type Playable2D, type PlayableLine } from './Cutscene2D'
import { EnemyDialogueBox } from './EnemyDialogueBox'
import { PIXEL_HEIGHT, PIXEL_WIDTH } from './pixelDraw'

const CHAR_MS = 65
const PAUSE_MS = 260
const PAUSE_CHARS = '，。、！？…—'

/** 与 NarrativeOverlay 同一套打字节奏，但时钟取自 2D 导演层（暂停即冻结） */
function TypedLine({
  line,
  director,
}: {
  readonly line: PlayableLine
  readonly director: Cutscene2D
}) {
  const ref = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const el = ref.current
      if (!el) return
      // 字幕从本句 at 起笔，与画面关键帧同步
      const elapsed = (director.now() - line.at) * 1000
      let acc = 0
      let count = 0
      for (const ch of line.text) {
        if (elapsed < acc) break
        count += 1
        acc += CHAR_MS + (PAUSE_CHARS.includes(ch) ? PAUSE_MS : 0)
      }
      el.textContent = elapsed > 0 ? line.text.slice(0, count) : ''
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [line, director])

  return <span ref={ref} />
}

/** 结局模式：胜利不可跳（长按兜底），失败显示跳过按钮 */
export type OverlayMode = 'transition' | 'ending'

export function CutsceneOverlay({
  spec,
  sound,
  mode = 'transition',
  skippable = true,
  onResumeEngine,
  onFinish,
  onDirector,
}: {
  readonly spec: Playable2D
  readonly sound: SoundEngine
  readonly mode?: OverlayMode
  readonly skippable?: boolean
  readonly onResumeEngine?: () => void
  readonly onFinish: () => void
  readonly onDirector: (director: Cutscene2D | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishRef = useRef(onFinish)
  const resumeRef = useRef(onResumeEngine)
  const directorCbRef = useRef(onDirector)
  const directorRef = useRef<Cutscene2D | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const [director, setDirector] = useState<Cutscene2D | null>(null)
  const [line, setLine] = useState<PlayableLine | null>(null)

  useEffect(() => {
    finishRef.current = onFinish
    resumeRef.current = onResumeEngine
    directorCbRef.current = onDirector
  }, [onFinish, onResumeEngine, onDirector])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const instance = new Cutscene2D(el, spec, {
      sound,
      onResumeEngine: mode === 'transition' ? () => resumeRef.current?.() : undefined,
      onFinish: () => finishRef.current(),
    })
    directorRef.current = instance
    setDirector(instance)
    directorCbRef.current(instance)
    instance.start()

    // 字幕随导演时钟切换：从 rAF 里比对当前命中句
    let raf = 0
    let current: PlayableLine | null = null
    const watch = () => {
      raf = requestAnimationFrame(watch)
      const next = Cutscene2D.lineAt(spec, instance.now())
      if (next !== current) {
        current = next
        setLine(next)
      }
    }
    raf = requestAnimationFrame(watch)

    return () => {
      cancelAnimationFrame(raf)
      instance.dispose()
      directorRef.current = null
      directorCbRef.current(null)
      setDirector(null)
      setLine(null)
    }
  }, [spec, sound, mode])

  // 不可跳过的结局（胜利）：长按 Space/Esc 3s 兜底，防设备卡死
  const holdGuard = mode === 'ending' && !skippable

  useEffect(() => {
    if (!holdGuard) return
    const startHold = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ' && event.key !== 'Escape') return
      if (holdTimerRef.current !== null) return
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null
        directorRef.current?.skip()
      }, 3000)
    }
    const endHold = () => {
      if (holdTimerRef.current !== null) {
        window.clearTimeout(holdTimerRef.current)
        holdTimerRef.current = null
      }
    }
    window.addEventListener('keydown', startHold)
    window.addEventListener('keyup', endHold)
    window.addEventListener('blur', endHold)
    return () => {
      window.removeEventListener('keydown', startHold)
      window.removeEventListener('keyup', endHold)
      window.removeEventListener('blur', endHold)
      endHold()
    }
  }, [holdGuard])

  const showSkipButton = mode === 'transition' ? true : skippable
  const enemyAnchor = spec.dialogueAnchor
  const getEnemyAnchor = () => {
    const canvas = canvasRef.current
    if (!canvas || !enemyAnchor) return { x: 0.5, y: 0.35, visible: false }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (rect.left + (enemyAnchor.x / PIXEL_WIDTH) * rect.width) / window.innerWidth,
      y: (rect.top + (enemyAnchor.y / PIXEL_HEIGHT) * rect.height) / window.innerHeight,
      visible: true,
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black"
      data-testid="cutscene-overlay"
    >
      <canvas
        ref={canvasRef}
        className="cutscene-canvas block"
        style={{ imageRendering: 'pixelated' }}
      />
      {line?.channel === 'enemy' && director ? (
        <EnemyDialogueBox getAnchor={getEnemyAnchor}>
          <TypedLine key={line.at} line={line} director={director} />
        </EnemyDialogueBox>
      ) : line && director ? (
        <div data-testid="bottom-dialogue" className="pointer-events-none absolute inset-x-0 bottom-[5vh] flex min-h-[4.5rem] items-start justify-center px-6">
          <p
            className={`narrative-subtitle max-w-lg px-4 py-1.5 text-center font-display text-base leading-relaxed tracking-[0.18em] ${
              line.channel === 'sister' ? 'sister-dialogue text-amber-100/95' : 'text-bone-200/95'
            }`}
          >
            <TypedLine key={line.at} line={line} director={director} />
          </p>
        </div>
      ) : null}
      {showSkipButton ? (
        <button
          type="button"
          onClick={() => directorRef.current?.skip()}
          className="absolute right-4 bottom-[3vh] border border-white/12 bg-black/55 px-3 py-1.5 text-[10px] tracking-[0.3em] text-bone-200/55 uppercase backdrop-blur-sm hover:border-rust-500/50 hover:text-bone-200/85"
        >
          空格跳过
        </button>
      ) : null}
    </div>
  )
}
