import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import { CorridorScene } from '../intro/CorridorScene'

const CHAR_MS = 65
const PAUSE_MS = 260
const PAUSE_CHARS = '，。、！？…—'
const LEFT_DOOR_HINT_MS = 3200

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
        acc += CHAR_MS + (PAUSE_CHARS.includes(ch) ? PAUSE_MS : 0)
      }
      setTyped(count)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [text])
  return <>{text.slice(0, typed)}</>
}

/** 梦核走廊序章：点击「走进走廊」后触发；右门 → CRT 故障 → 黑场 → onIntroComplete */
export function CorridorIntro({
  sound,
  onStart,
  onIntroComplete,
}: {
  readonly sound: SoundEngine
  readonly onStart: () => void | Promise<void>
  readonly onIntroComplete: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CorridorScene | null>(null)
  const completeRef = useRef(onIntroComplete)
  const startRef = useRef(onStart)
  const doneRef = useRef(false)
  const leftHintTimer = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [started, setStarted] = useState(false)
  const [doorPhase, setDoorPhase] = useState(false)
  const [walkLine, setWalkLine] = useState<string | null>(null)
  const [leftHint, setLeftHint] = useState(false)

  useEffect(() => {
    completeRef.current = onIntroComplete
    startRef.current = onStart
  }, [onIntroComplete, onStart])

  useEffect(() => {
    const scene = new CorridorScene(canvasRef.current!, sound, {
      onReady: () => setReady(true),
      onDoorPhase: () => setDoorPhase(true),
      onWalkLine: setWalkLine,
      onComplete: () => {
        if (doneRef.current) return
        doneRef.current = true
        completeRef.current()
      },
    })
    sceneRef.current = scene
    scene.start()
    return () => {
      if (leftHintTimer.current !== null) window.clearTimeout(leftHintTimer.current)
      scene.dispose()
    }
  }, [sound])

  async function handleStart() {
    setStarted(true)
    await startRef.current()
    sceneRef.current?.beginWalk()
  }

  function handleLeftDoor() {
    sceneRef.current?.chooseDoor('L')
    setLeftHint(true)
    if (leftHintTimer.current !== null) window.clearTimeout(leftHintTimer.current)
    leftHintTimer.current = window.setTimeout(() => setLeftHint(false), LEFT_DOOR_HINT_MS)
  }

  const subtitle = walkLine ?? (leftHint ? '铁链还锁着。别馆的牌桌尚未开席——小棠走的是右门。' : null)

  return (
    <div className="absolute inset-0 z-40 bg-black" data-testid="corridor-intro">
      <canvas ref={canvasRef} className="h-full w-full" />
      {subtitle ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[24vh] flex justify-center px-6">
          <p className="corridor-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] text-bone-200/90">
            <TypedLine key={subtitle} text={subtitle} />
          </p>
        </div>
      ) : null}
      {ready && !started && !doorPhase ? (
        <div className="absolute inset-x-0 bottom-[10vh] flex justify-center">
          <button type="button" className="metal-btn metal-btn--primary" onClick={() => void handleStart()}>
            走进走廊
          </button>
        </div>
      ) : null}
      {doorPhase ? (
        <div className="absolute inset-x-0 bottom-[10vh] flex justify-center gap-6">
          <button type="button" className="metal-btn" onClick={handleLeftDoor}>
            左门 · 别馆（封契中）
          </button>
          <button
            type="button"
            className="metal-btn metal-btn--primary"
            onClick={() => sceneRef.current?.chooseDoor('R')}
          >
            右门 · 贰拾壹
          </button>
        </div>
      ) : null}
    </div>
  )
}
