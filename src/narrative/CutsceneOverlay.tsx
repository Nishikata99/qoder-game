import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import { Cutscene2D } from './Cutscene2D'
import type { CutsceneLine, CutsceneSpec } from './cutsceneScript'

const CHAR_MS = 65
const PAUSE_MS = 260
const PAUSE_CHARS = '，。、！？…—'

/** 与 NarrativeOverlay 同一套打字节奏，但时钟取自 2D 导演层（暂停即冻结） */
function TypedLine({
  line,
  director,
}: {
  readonly line: CutsceneLine
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

/**
 * 关卡间 2D 过场覆盖层：叠在引擎 reloading 之上（此期间引擎是被挂起的），
 * 播完由 onFinish 卸载，同时 director 已提前恢复引擎。
 */
export function CutsceneOverlay({
  spec,
  sound,
  onResumeEngine,
  onFinish,
  onDirector,
}: {
  readonly spec: CutsceneSpec
  readonly sound: SoundEngine
  readonly onResumeEngine: () => void
  readonly onFinish: () => void
  readonly onDirector: (director: Cutscene2D | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const finishRef = useRef(onFinish)
  const resumeRef = useRef(onResumeEngine)
  const directorCbRef = useRef(onDirector)
  const [director, setDirector] = useState<Cutscene2D | null>(null)
  const [line, setLine] = useState<CutsceneLine | null>(null)

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
      onResumeEngine: () => resumeRef.current(),
      onFinish: () => finishRef.current(),
    })
    setDirector(instance)
    directorCbRef.current(instance)
    instance.start()

    // 字幕随导演时钟切换：从 rAF 里比对当前命中句
    let raf = 0
    let current: CutsceneLine | null = null
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
      directorCbRef.current(null)
      setDirector(null)
      setLine(null)
    }
  }, [spec, sound])

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
      {/* 字幕压在画面底部：桌面上的手/账页动作都在下沿，用半透明背景板隔开保证可读 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[5vh] flex min-h-[4.5rem] items-start justify-center px-6">
        <p className="narrative-subtitle max-w-lg bg-black/55 px-4 py-1.5 text-center font-display text-base leading-relaxed tracking-[0.18em] text-bone-200/95">
          {director && line ? <TypedLine key={line.at} line={line} director={director} /> : null}
        </p>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-[3vh] flex justify-center">
        <p className="text-[9px] tracking-[0.3em] text-bone-200/30 uppercase">空格跳过</p>
      </div>
    </div>
  )
}
