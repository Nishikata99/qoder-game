import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import { CorridorScene } from '../intro/CorridorScene'
import { LongPressSkipIndicator } from './LongPressSkipIndicator'
import { TYPE_CHAR_MS, TYPE_PAUSE_CHARS, TYPE_PAUSE_MS } from '../narrative/dialogue'

/** 打字机字幕：与 NarrativeOverlay 同一节奏，走廊独白用 */
function TypedLine({ text }: { readonly text: string }) {
  const [typed, setTyped] = useState(0)
  useEffect(() => {
    setTyped(0)
    let raf = 0
    const start = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const elapsed = now - start
      let acc = 0
      let count = 0
      for (const ch of text) {
        if (elapsed < acc) break
        count += 1
        acc += TYPE_CHAR_MS + (TYPE_PAUSE_CHARS.includes(ch) ? TYPE_PAUSE_MS : 0)
      }
      setTyped(count)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [text])
  return <>{text.slice(0, typed)}</>
}

/** 梦核走廊序章：点画面起步；左门开新局，右门无存档时封死、有存档时点牌/门续玩 */
export function CorridorIntro({
  sound,
  onStart,
  onIntroComplete,
  onNewRun,
  resumeLevel,
  onResumeLevel,
}: {
  readonly sound: SoundEngine
  readonly onStart: () => void | Promise<void>
  readonly onIntroComplete: () => void
  /** 左门：新开一局，需要清掉旧存档 */
  readonly onNewRun: () => void
  /** 有存档时显示为几层，null 则右门封死 */
  readonly resumeLevel: number | null
  readonly onResumeLevel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CorridorScene | null>(null)
  const completeRef = useRef(onIntroComplete)
  const startRef = useRef(onStart)
  const newRunRef = useRef(onNewRun)
  const resumeRef = useRef(onResumeLevel)
  const resumeLevelRef = useRef(resumeLevel)
  const doneRef = useRef(false)
  const startedRef = useRef(false)
  const startWalkRef = useRef<() => void>(() => {})
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [walking, setWalking] = useState(false)
  const [doorPhase, setDoorPhase] = useState(false)
  const [chosen, setChosen] = useState(false)
  const [hoveredDoor, setHoveredDoor] = useState<'L' | 'R' | null>(null)
  const [walkLine, setWalkLine] = useState<string | null>(null)

  useEffect(() => {
    completeRef.current = onIntroComplete
    startRef.current = onStart
    newRunRef.current = onNewRun
    resumeRef.current = onResumeLevel
    resumeLevelRef.current = resumeLevel
  }, [onIntroComplete, onStart, onNewRun, onResumeLevel, resumeLevel])

  useEffect(() => {
    const scene = new CorridorScene(
      canvasRef.current!,
      sound,
      {
        onReady: () => setReady(true),
        onLoadError: setLoadError,
        onDoorPhase: () => setDoorPhase(true),
        onWalkLine: setWalkLine,
        onComplete: () => {
          if (doneRef.current) return
          doneRef.current = true
          completeRef.current()
        },
        onRequestStart: () => startWalkRef.current(),
        onWalkStart: () => setWalking(true),
        onDoorHover: setHoveredDoor,
        onNewRun: () => newRunRef.current(),
        onResume: () => resumeRef.current(),
        onDoorChosen: () => setChosen(true),
      },
      resumeLevelRef.current,
    )
    sceneRef.current = scene
    scene.start()
    if (import.meta.env.DEV) {
      ;(window as unknown as { __corridorDebug?: CorridorScene }).__corridorDebug = scene
    }
    return () => {
      if (import.meta.env.DEV) {
        delete (window as unknown as { __corridorDebug?: CorridorScene }).__corridorDebug
      }
      scene.dispose()
    }
  }, [sound])

  async function handleStart() {
    if (startedRef.current || doneRef.current) return
    startedRef.current = true
    setStarted(true)
    await startRef.current()
    sceneRef.current?.beginWalk()
  }
  startWalkRef.current = () => void handleStart()

  const subtitle = walkLine
  const doorHint =
    hoveredDoor === 'L'
      ? '左门 · 血色底注'
      : hoveredDoor === 'R'
        ? resumeLevel !== null
          ? `右门 · 继续第 ${resumeLevel} 层`
          : '右门封着 · 锁眼被人灌了铅'
        : resumeLevel !== null
          ? '左门新开一局 · 右门继续'
          : '左门新开一局 · 右门封死'

  return (
    <div className="absolute inset-0 z-40 bg-black" data-testid="corridor-intro">
      <canvas ref={canvasRef} className="h-full w-full" />
      <span className="sr-live" aria-live="polite">{walkLine}</span>
      {loadError ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/85 px-6 text-center" role="alert">
          <p className="font-display text-base tracking-[0.12em] text-bone-200">{loadError}</p>
          <button type="button" className="metal-btn min-h-11 px-6" onClick={() => sceneRef.current?.retry()}>重试</button>
        </div>
      ) : null}
      {subtitle ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[24vh] flex justify-center px-6">
          <p className="corridor-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] text-bone-200/90">
            <TypedLine key={subtitle} text={subtitle} />
          </p>
        </div>
      ) : null}
      {ready && !started && !doorPhase ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[10vh] flex justify-center px-6">
          <p className="font-display text-sm tracking-[0.3em] text-bone-200/60">点击画面 · 走进走廊</p>
        </div>
      ) : null}
      {doorPhase && !chosen ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[10vh] flex justify-center px-6">
          <p className="font-display text-base tracking-[0.26em] text-bone-200/80">{doorHint}</p>
        </div>
      ) : null}
      {walking && !doorPhase && !chosen ? (
        <LongPressSkipIndicator active onComplete={() => sceneRef.current?.skip()} />
      ) : null}
      {/* 场景已接管指针；这些仅留给读屏与自动化测试 */}
      {ready && !started && !doorPhase ? (
        <button type="button" className="sr-only left-0 top-0" onClick={() => void handleStart()}>
          走进走廊
        </button>
      ) : null}
      {doorPhase ? (
        <>
          <button type="button" className="sr-only" onClick={() => sceneRef.current?.chooseDoor('L')}>
            左门 · 开始新局（清除旧检查点）
          </button>
          <button type="button" className="sr-only" onClick={() => sceneRef.current?.chooseDoor('R')}>
            {resumeLevel !== null ? `右门 · 继续第 ${resumeLevel} 层` : '右门 · 封死'}
          </button>
        </>
      ) : null}
    </div>
  )
}
