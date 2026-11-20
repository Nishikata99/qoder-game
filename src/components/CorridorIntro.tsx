import { useEffect, useRef, useState } from 'react'
import type { SoundEngine } from '../audio/SoundEngine'
import { CorridorScene } from '../intro/CorridorScene'

/** 梦核走廊序章：首次点击「坐下」后触发；右门 → CRT 故障 → 黑场 → onIntroComplete；左门 → 蔓延子游戏 */
export function CorridorIntro({
  sound,
  onStart,
  onIntroComplete,
  onEnterMoyan,
}: {
  readonly sound: SoundEngine
  readonly onStart: () => void | Promise<void>
  readonly onIntroComplete: () => void
  readonly onEnterMoyan: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<CorridorScene | null>(null)
  const completeRef = useRef(onIntroComplete)
  const startRef = useRef(onStart)
  const enterMoyanRef = useRef(onEnterMoyan)
  const doneRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [started, setStarted] = useState(false)
  const [doorPhase, setDoorPhase] = useState(false)

  useEffect(() => {
    completeRef.current = onIntroComplete
    startRef.current = onStart
    enterMoyanRef.current = onEnterMoyan
  }, [onIntroComplete, onStart, onEnterMoyan])

  useEffect(() => {
    const scene = new CorridorScene(canvasRef.current!, sound, {
      onReady: () => setReady(true),
      onDoorPhase: () => setDoorPhase(true),
      onComplete: () => {
        if (doneRef.current) return
        doneRef.current = true
        completeRef.current()
      },
      onEnterMoyan: () => enterMoyanRef.current(),
    })
    sceneRef.current = scene
    scene.start()
    return () => scene.dispose()
  }, [sound])

  async function handleStart() {
    setStarted(true)
    await startRef.current()
    sceneRef.current?.beginWalk()
  }

  return (
    <div className="absolute inset-0 z-40 bg-black" data-testid="corridor-intro">
      <canvas ref={canvasRef} className="h-full w-full" />
      {ready && !started && !doorPhase ? (
        <div className="absolute inset-x-0 bottom-[10vh] flex justify-center">
          <button type="button" className="metal-btn metal-btn--primary" onClick={() => void handleStart()}>
            开始
          </button>
        </div>
      ) : null}
      {doorPhase ? (
        <div className="absolute inset-x-0 bottom-[10vh] flex justify-center gap-6">
          <button type="button" className="metal-btn" onClick={() => sceneRef.current?.chooseDoor('L')}>
            左门
          </button>
          <button
            type="button"
            className="metal-btn metal-btn--primary"
            onClick={() => sceneRef.current?.chooseDoor('R')}
          >
            右门
          </button>
        </div>
      ) : null}
    </div>
  )
}
