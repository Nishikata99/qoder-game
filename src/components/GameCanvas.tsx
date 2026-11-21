import { useEffect, useRef, useState } from 'react'
import type { ActorId, GameEvent, GameSnapshot, ItemId } from '../game/GameEngine'
import type { GameEngine } from '../game/GameEngine'
import { SceneManager } from '../scene/SceneManager'
import type { ItemHoverPayload } from '../scene/SceneManager'
import { itemFlavor } from '../narrative/copy'

export interface GameCanvasProps {
  readonly engine: GameEngine
  readonly snapshot: GameSnapshot | null
  readonly onItemUse?: (actor: ActorId, item: ItemId) => void
  readonly onHoverChange?: (payload: ItemHoverPayload | null) => void
  readonly onSceneReady?: (scene: SceneManager) => void
}

export function GameCanvas({
  engine,
  snapshot,
  onItemUse,
  onHoverChange,
  onSceneReady,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<SceneManager | null>(null)
  const callbacksRef = useRef({ onItemUse, onHoverChange })
  const readyRef = useRef(onSceneReady)
  const [error, setError] = useState<string | null>(null)
  const setErrorRef = useRef(setError)

  useEffect(() => {
    callbacksRef.current = { onItemUse, onHoverChange }
    readyRef.current = onSceneReady
    setErrorRef.current = setError
  }, [onItemUse, onHoverChange, onSceneReady, setError])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    let manager: SceneManager | null = null
    try {
      manager = new SceneManager(host, canvas, {
        onItemHover: (payload) => callbacksRef.current.onHoverChange?.(payload),
        onItemClick: (actor, item) => callbacksRef.current.onItemUse?.(actor, item),
      })
    } catch (err) {
      setErrorRef.current(err instanceof Error ? err.message : '无法创建 WebGL 场景')
      return
    }

    sceneRef.current = manager
    readyRef.current?.(manager)

    return () => {
      manager?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!snapshot) return
    sceneRef.current?.applySnapshot(snapshot)
  }, [snapshot])

  useEffect(() => {
    return engine.subscribe((event) => {
      const scene = sceneRef.current
      if (scene) applyVisualEvent(scene, event)
    })
  }, [engine])

  function applyVisualEvent(scene: SceneManager, event: GameEvent): void {
    switch (event.type) {
      case 'state':
        scene.applySnapshot(event.snapshot)
        break
      case 'reload':
        scene.playReload()
        scene.setShot('cylinder', 0.9)
        break
      case 'roundStart':
        scene.resetShot(0.85)
        break
      case 'execution':
        scene.playExecution({
          by: event.by,
          target: event.target,
          chamber: event.chamber,
          lethal: event.lethal,
        })
        break
      case 'shot':
        scene.playShot({
          by: event.by,
          target: event.target,
          chamber: event.chamber,
          damage: event.damage,
          sawed: event.sawed,
          blackjack: event.blackjack,
          blocked: event.blocked,
        })
        scene.resetShot(1.1)
        break
      case 'chamberRevealed':
        scene.revealChamber(event.chamber)
        scene.setShot('magnify', 0.75)
        break
      case 'itemUsed':
        scene.playItemUse(event.actor, event.item)
        break
      case 'magnetSwap':
        scene.playMagnetSwap(event.card)
        break
      case 'hourglass':
        scene.playHourglass()
        break
      case 'levelClear':
        scene.setShot('victory', 1.4)
        break
      case 'supplyOffer':
        // 补给面板是纯 DOM 覆盖层，机位停在清层后的远景，别跟着回合机位抖
        scene.setShot('victory', 1.2)
        break
      case 'gameOver':
        scene.setShot(event.winner === 'boss' ? 'death' : 'victory', 1.6)
        break
      default:
        break
    }
  }

  return (
    <div ref={hostRef} className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        aria-label="Blood Ante · 血色底注 3D 牌桌场景"
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 58% at 50% 46%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0.82) 84%, rgba(0,0,0,0.96) 100%)',
        }}
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-abyss-950/90 p-6 text-center">
          <div>
            <p className="text-sm tracking-widest text-rust-400 uppercase">WebGL unavailable</p>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-bone-200/60">
              {error}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ItemTooltip({ payload }: { payload: ItemHoverPayload | null }) {
  if (!payload) return null
  const owner = payload.actor === 'player' ? '你的道具' : '对手的道具'
  const usable = payload.actor === 'player'
  return (
    <div
      className="pointer-events-none fixed z-50 max-w-56 rounded-sm border border-rust-500/40 bg-abyss-900/95 px-3 py-2 shadow-lg shadow-black/60 backdrop-blur-sm"
      style={{ left: payload.x + 16, top: payload.y + 16 }}
    >
      <p className="font-display text-sm text-bone-200">{payload.name}</p>
      <p className="mt-0.5 text-[10px] tracking-widest text-rust-400 uppercase">{owner}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-bone-200/60">{payload.summary}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-rust-300/60 italic">
        {itemFlavor(payload.item)}
      </p>
      {!usable ? <p className="mt-1 text-[10px] text-bone-200/35">无法动用对手的道具</p> : null}
    </div>
  )
}
