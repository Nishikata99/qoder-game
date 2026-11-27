import { useEffect, useRef, useState } from 'react'
import type { ActionVisualId, ActorId, GameEvent, GameSnapshot, ItemId } from '../game/GameEngine'
import { trumpAnimationItem, type GameEngine } from '../game/GameEngine'
import { SceneManager } from '../scene/SceneManager'
import type { GunHoverPayload, ItemHoverPayload, TableAction } from '../scene/SceneManager'
import type { BossPoseCue, SceneLoadProgress } from '../scene/SceneManager'
import type { ItemActionCue, ItemActionStatus } from '../scene/ItemActions'
import { itemFlavor } from '../narrative/copy'

export interface GameCanvasProps {
  readonly engine: GameEngine
  readonly snapshot: GameSnapshot | null
  readonly tableActionsAllowed: boolean
  readonly supplyRevealAllowed: boolean
  readonly stealTargeting?: boolean
  readonly onTableAction: (action: TableAction) => boolean
  readonly onItemUse?: (actor: ActorId, item: ItemId) => void
  readonly onTrumpDeckClick?: () => void
  readonly onTargetPick?: (target: ActorId) => void
  readonly onHoverChange?: (payload: ItemHoverPayload | null) => void
  readonly onGunHoverChange?: (payload: GunHoverPayload | null) => void
  readonly onBossPoseCue?: (cue: BossPoseCue) => void
  readonly onSceneReady?: (scene: SceneManager) => void
  readonly onLoadProgress?: (progress: SceneLoadProgress) => void
  readonly onLoadError?: (key: string, error: unknown) => void
  readonly onItemCue?: (item: ActionVisualId, cue: ItemActionCue) => void
  readonly onItemActionStatus?: (status: ItemActionStatus | null) => void
  readonly onItemPresented?: (event: GameEvent) => void
  readonly onItemSnapshot?: (snapshot: GameSnapshot) => void
}

export function GameCanvas({
  engine,
  snapshot,
  tableActionsAllowed,
  supplyRevealAllowed,
  stealTargeting = false,
  onTableAction,
  onItemUse,
  onTrumpDeckClick,
  onTargetPick,
  onHoverChange,
  onGunHoverChange,
  onBossPoseCue,
  onSceneReady,
  onLoadProgress,
  onLoadError,
  onItemCue,
  onItemActionStatus,
  onItemPresented,
  onItemSnapshot,
}: GameCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<SceneManager | null>(null)
  const callbacksRef = useRef({ onTableAction, onItemUse, onTrumpDeckClick, onTargetPick, onHoverChange, onGunHoverChange, onBossPoseCue, onLoadProgress, onLoadError, onItemCue, onItemActionStatus, onItemPresented, onItemSnapshot })
  const readyRef = useRef(onSceneReady)
  const [error, setError] = useState<string | null>(null)
  const setErrorRef = useRef(setError)

  useEffect(() => {
    callbacksRef.current = { onTableAction, onItemUse, onTrumpDeckClick, onTargetPick, onHoverChange, onGunHoverChange, onBossPoseCue, onLoadProgress, onLoadError, onItemCue, onItemActionStatus, onItemPresented, onItemSnapshot }
    readyRef.current = onSceneReady
    setErrorRef.current = setError
  }, [onTableAction, onItemUse, onTrumpDeckClick, onTargetPick, onHoverChange, onGunHoverChange, onBossPoseCue, onSceneReady, onLoadProgress, onLoadError, onItemCue, onItemActionStatus, onItemPresented, onItemSnapshot, setError])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    let manager: SceneManager | null = null
    try {
      manager = new SceneManager(host, canvas, {
        onTableAction: (action) => callbacksRef.current.onTableAction(action),
        onItemHover: (payload) => callbacksRef.current.onHoverChange?.(payload),
        onGunHover: (payload) => callbacksRef.current.onGunHoverChange?.(payload),
        onItemClick: (actor, item) => callbacksRef.current.onItemUse?.(actor, item),
        onTrumpDeckClick: () => callbacksRef.current.onTrumpDeckClick?.(),
        onTargetPick: (target) => callbacksRef.current.onTargetPick?.(target),
        onBossPoseCue: (cue) => callbacksRef.current.onBossPoseCue?.(cue),
        onLoadProgress: (progress) => callbacksRef.current.onLoadProgress?.(progress),
        onLoadError: (key, err) => callbacksRef.current.onLoadError?.(key, err),
        onItemActionCue: (item, cue) => callbacksRef.current.onItemCue?.(item, cue),
        onItemActionStatus: (status) => callbacksRef.current.onItemActionStatus?.(status),
        onItemPresented: (event) => callbacksRef.current.onItemPresented?.(event),
        onItemSnapshot: (snapshot) => callbacksRef.current.onItemSnapshot?.(snapshot),
      })
    } catch (err) {
      setErrorRef.current(err instanceof Error ? err.message : '无法创建 WebGL 场景')
      return
    }

    sceneRef.current = manager
    // 发牌闸门：等枪放平、镜头回位后再让引擎进入下一回合
    engine.setPresentationGate(() => manager.whenReadyForDeal())
    engine.setItemPresentationGate(() => manager.whenItemReady())
    readyRef.current?.(manager)

    return () => {
      engine.setItemPresentationGate(null)
      engine.setPresentationGate(null)
      manager?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setTableActionsAllowed(tableActionsAllowed)
    sceneRef.current?.setSupplyRevealAllowed(supplyRevealAllowed)
    if (!snapshot) return
    sceneRef.current?.applySnapshot(snapshot)
  }, [snapshot, tableActionsAllowed, supplyRevealAllowed])

  useEffect(() => {
    sceneRef.current?.setStealTargeting(stealTargeting)
  }, [stealTargeting])

  useEffect(() => {
    return engine.subscribe((event, eventSnapshot) => {
      const scene = sceneRef.current
      if (scene) applyVisualEvent(scene, event, eventSnapshot)
    })
  }, [engine])

  function applyVisualEvent(scene: SceneManager, event: GameEvent, eventSnapshot: GameSnapshot): void {
    switch (event.type) {
      case 'state':
        scene.applySnapshot(event.snapshot)
        break
      case 'reload':
        scene.playReload(event.live, event.blank)
        break
      case 'roundStart':
        // 新一局 / 首层第一回合：枪先平躺回桌面
        if (event.level === 1 && event.round === 1) scene.restGunOnTable()
        if (!scene.isBloodCloseupActive()) scene.resetShot(0.85)
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
          hpAfter: (event.target === 'player' ? eventSnapshot.player : eventSnapshot.boss).hp,
          sawed: event.sawed,
        })
        break
      case 'chamberDiscarded':
        // 护心镜退弹是公开信息：弹壳当着双方的面从转轮里弹到桌上
        scene.playChamberEject(event.actor, event.chamber)
        break
      case 'chamberRevealed':
        // 只有玩家自己的窥视才在台面揭晓读数；Boss 的窥视不能泄漏给玩家
        if (event.actor === 'player') {
          scene.revealChamber(event.chamber)
          scene.setShot('magnify', 0.75)
        }
        break
      case 'chamberFlipped':
        if (event.actor === 'player') scene.revealChamber(event.chamber)
        break
      case 'itemUsed':
        // 派生事件（读数、换牌、沙漏反转）由引擎在动作收尾后才放
        scene.playItemUse(event.actor, event.item)
        break
      case 'playerTableAction':
        scene.playPlayerTableAction(event.action)
        break
      case 'bossBark':
        scene.playBossTableAction(event.action, event.hand)
        break
      case 'trumpPlayed': {
        const visual = trumpAnimationItem(event.trump)
        if (visual) scene.playItemUse(event.actor, visual)
        break
      }
      case 'levelClear':
        scene.setResolutionShot('victory', 1.4)
        break
      case 'supplyOffer':
        // 补给在桌面左侧托盘里进行：切到托盘机位，候选道具由快照驱动升起
        scene.setShot('supply', 1.2)
        break
      case 'bossSupply':
        // 玩家选完，镜头切到左后侧的 Boss 托盘看它挑
        scene.setShot('supplyBoss', 1.0)
        break
      case 'gameOver':
        scene.setResolutionShot(event.winner === 'boss' ? 'death' : 'victory', 1.6)
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
      <div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-4 focus-within:left-1/2 focus-within:-translate-x-1/2 focus-within:flex focus-within:gap-4 focus-within:bg-black focus-within:p-3">
        <button type="button" aria-keyshortcuts="H" disabled={!tableActionsAllowed || (snapshot?.player.hand.busted ?? false)}
          onClick={() => sceneRef.current?.activateTableAction('hit')}>要牌</button>
        <button type="button" aria-keyshortcuts="S" disabled={!tableActionsAllowed}
          onClick={() => sceneRef.current?.activateTableAction('stand')}>停牌</button>
      </div>
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-abyss-950/90 p-6 text-center">
          <div>
            <p className="text-sm tracking-widest text-rust-400 uppercase">无法启动 3D 牌桌</p>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-bone-200/60">
              请开启浏览器硬件加速后刷新。若仍无法进入，请尝试更新浏览器。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ItemTooltip({ payload }: { payload: ItemHoverPayload | null }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!payload || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const margin = 8
    let left = payload.x + 16
    let top = payload.y + 16
    if (left + rect.width > window.innerWidth - margin) left = payload.x - rect.width - 16
    if (top + rect.height > window.innerHeight - margin) top = payload.y - rect.height - 16
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))
    setPos({ left, top })
  }, [payload])

  if (!payload) return null
  const owner = payload.supply ? '门前的补给' : payload.steal ? '对手的道具 · 手套选中' : payload.actor === 'player' ? '你的道具' : '对手的道具'
  const usable = payload.supply || payload.steal || payload.actor === 'player'
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 max-w-56 rounded-sm border border-rust-500/40 bg-abyss-900/95 px-3 py-2 shadow-lg shadow-black/60 backdrop-blur-sm"
      style={{ left: pos?.left ?? payload.x + 16, top: pos?.top ?? payload.y + 16 }}
    >
      <p className="font-display text-sm text-bone-200">{payload.name}</p>
      <p className="mt-0.5 text-[10px] tracking-widest text-rust-400 uppercase">{owner}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-bone-200/90">{payload.summary}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-bone-200/45 italic">
        {itemFlavor(payload.item)}
      </p>
      {payload.steal ? (
        <p className="mt-1 text-[10px] text-rust-300/70">点击偷走这一件，并立即使用</p>
      ) : payload.supply ? (
        <p className="mt-1 text-[10px] text-rust-300/70">点击带走这一件</p>
      ) : !usable ? (
        <p className="mt-1 text-[10px] text-bone-200/35">无法动用对手的道具</p>
      ) : null}
    </div>
  )
}

export function GunTooltip({ payload }: { payload: GunHoverPayload | null }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!payload || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const margin = 8
    let left = payload.x + 16
    let top = payload.y + 16
    if (left + rect.width > window.innerWidth - margin) left = payload.x - rect.width - 16
    if (top + rect.height > window.innerHeight - margin) top = payload.y - rect.height - 16
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))
    setPos({ left, top })
  }, [payload])

  if (!payload) return null
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed z-50 max-w-80 rounded-sm border border-rust-500/40 bg-abyss-900/95 px-3 py-2 shadow-lg shadow-black/60 backdrop-blur-sm"
      style={{ left: pos?.left ?? payload.x + 16, top: pos?.top ?? payload.y + 16 }}
    >
      <p className="font-display text-sm text-bone-200">
        点击枪 · 决定枪口朝向（对手 / 自己）
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-bone-200/45">随后点任一方的血袋扣下扳机</p>
    </div>
  )
}
