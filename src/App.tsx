import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoundEngine } from './audio/SoundEngine'
import { GameCanvas, ItemTooltip } from './components/GameCanvas'
import { RulesModal, type ModalTab } from './components/RulesModal'
import { NarrativeDirector, type NarrativeMode, type NarrativeVisual } from './narrative/NarrativeDirector'
import { DevBridge } from './game/DevBridge'
import { DevPanel } from './components/DevPanel'
import { CorridorIntro } from './components/CorridorIntro'
import { NarrativeOverlay } from './narrative/NarrativeOverlay'
import type { ItemHoverPayload } from './scene/SceneManager'
import type { SceneManager } from './scene/SceneManager'
import type { ActorId, ActorView, Card, GameEvent, GameSnapshot, ItemId } from './game/GameEngine'
import {
  GameEngine,
  ITEM_CATALOG,
  LEVELS,
  createSeededRandom,
  evaluateHand,
  formatCard as formatCardLabel,
} from './game/GameEngine'

interface RelayBanner {
  readonly id: number
  readonly live: number
  readonly blank: number
  readonly level: number
}

interface LootBanner {
  readonly id: number
  readonly level: number
  readonly items: readonly ItemId[]
}

const FADE_MS = 2400
const GUIDE_KEY = 'blood-ante.guideSeen'

const GUIDE_LINES = [
  '谁的点数更接近 21，谁赢下这一轮。',
  '赢家拿枪：可以射向对面，也可以射向自己。',
  '射向对面造成伤害；对自己开空膛，白拿一件道具。',
] as const

/** 首次进入的三句话规则；localStorage 记住已读，之后只在角落留一个「规则 / 图鉴」入口 */
function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    return true
  }
}

function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_KEY, '1')
  } catch {
    // 隐私模式写入会抛错，忽略即可，最多下次再弹一次
  }
}

/** 开发期可用 ?seed=12345 复现同一局的发牌序列；生产构建始终使用 Math.random */
function resolveRng(): (() => number) | undefined {
  if (!import.meta.env.DEV) return undefined
  const raw = new URLSearchParams(window.location.search).get('seed')
  if (raw === null) return undefined
  const seed = Number(raw)
  if (!Number.isFinite(seed)) return undefined
  console.debug(`[BloodAnte] 使用固定种子 ${seed}，复现同一局请保留该参数`)
  return createSeededRandom(seed)
}

export default function App() {
  const [sound] = useState(() => new SoundEngine())
  const [game] = useState(
    () => new GameEngine({ dealDelayMs: 340, thinkDelayMs: 800, rng: resolveRng() }),
  )
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const snapshotRef = useRef<GameSnapshot | null>(null)
  snapshotRef.current = snapshot
  const [hover, setHover] = useState<ItemHoverPayload | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0.85)
  const [modal, setModal] = useState<ModalTab | null>(null)
  const [guideOpen, setGuideOpen] = useState(() => !hasSeenGuide())
  const [relay, setRelay] = useState<RelayBanner | null>(null)
  const [loot, setLoot] = useState<LootBanner | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bloodFlash, setBloodFlash] = useState(0)
  const [bloodSplatter, setBloodSplatter] = useState(0)
  const [visionBlur, setVisionBlur] = useState(0)
  const [narrative, setNarrative] = useState<NarrativeVisual | null>(null)
  const [clueLine, setClueLine] = useState<string | null>(null)
  const [devOpen, setDevOpen] = useState(false)
  const [corridorState, setCorridorState] = useState<'idle' | 'playing' | 'done'>('idle')
  const pendingIntroRef = useRef(false)
  const devEPresses = useRef<number[]>([])
  const narrativeRef = useRef<NarrativeVisual | null>(null)
  const sceneRef = useRef<SceneManager | null>(null)
  const directorRef = useRef<NarrativeDirector | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const relayTimer = useRef<number | null>(null)
  const lootTimer = useRef<number | null>(null)
  const bloodTimer = useRef<number | null>(null)
  const splatterTimer = useRef<number | null>(null)
  const blurTimer = useRef<number | null>(null)
  const bannerId = useRef(0)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400)
  }, [])

  const handleEventSound = useCallback(
    (event: GameEvent) => {
      switch (event.type) {
        case 'cardDealt':
          sound.playCardSlide()
          break
        case 'shot':
          if (event.chamber === 'live') {
            // 自己中弹才保留完整耳鸣长尾，打向对手时缩短以避免拖沓
            sound.playGunshot({ selfShot: event.target === 'player' })
            if (event.blocked !== null) {
              showNotice(event.blocked === 'shield' ? '护心镜碎裂：伤害被完全挡下' : '替身被击中：子弹落空')
              break
            }
            setBloodFlash((n) => n + 1)
            if (bloodTimer.current !== null) window.clearTimeout(bloodTimer.current)
            bloodTimer.current = window.setTimeout(() => setBloodFlash(0), 900)
            if (event.target === 'player') {
              setBloodSplatter((n) => n + 1)
              if (splatterTimer.current !== null) window.clearTimeout(splatterTimer.current)
              splatterTimer.current = window.setTimeout(() => setBloodSplatter(0), 1500)
              setVisionBlur((n) => n + 1)
              if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
              blurTimer.current = window.setTimeout(() => setVisionBlur(0), 1100)
            }
          } else {
            sound.playClickEmpty()
          }
          break
        case 'itemUsed':
          sound.playItemUse()
          break
        case 'magnetSwap':
          sound.playItemUse()
          showNotice(`磁铁换牌：你拿到 ${formatCardLabel(event.card)}`)
          break
        case 'hourglass':
          sound.playHourglass()
          showNotice('沙漏逆转：本局点数更小者获胜')
          break
        case 'chamberRevealed':
          if (event.actor === 'player') {
            showNotice(event.chamber === 'live' ? '放大镜：膛内是实弹' : '放大镜：膛内是空膛')
          }
          break
        case 'chamberRecovered':
          if (event.actor === 'player') {
            showNotice(`空膛回收：获得【${ITEM_CATALOG[event.item].name}】`)
          }
          break
        case 'daggerReshuffle':
          sound.playItemUse()
          sound.playReload()
          showNotice(`匕首献祭：重装 ${event.live} 实 ${event.blank} 空`)
          break
        case 'notice':
          showNotice(event.message)
          break
        case 'reload':
          sound.playReload()
          bannerId.current += 1
          setRelay({ id: bannerId.current, live: event.live, blank: event.blank, level: 0 })
          if (relayTimer.current !== null) window.clearTimeout(relayTimer.current)
          relayTimer.current = window.setTimeout(() => setRelay(null), FADE_MS)
          break
        case 'levelClear':
          bannerId.current += 1
          break
        case 'supplyOffer':
          sound.playItemUse()
          break
        case 'lootUnlocked':
          bannerId.current += 1
          setLoot({ id: bannerId.current, level: event.level, items: event.items })
          if (lootTimer.current !== null) window.clearTimeout(lootTimer.current)
          lootTimer.current = window.setTimeout(() => setLoot(null), 5200)
          break
        default:
          break
      }
    },
    [showNotice, sound],
  )

  const soundHandlerRef = useRef(handleEventSound)
  useEffect(() => {
    soundHandlerRef.current = handleEventSound
  }, [handleEventSound])

  const narrativeHandlerRef = useRef(handleEventNarrative)
  useEffect(() => {
    narrativeHandlerRef.current = handleEventNarrative
  })

  useEffect(() => {
    return game.subscribe((event, snap) => {
      setSnapshot(snap)
      if (event.type !== 'state') {
        soundHandlerRef.current(event)
        narrativeHandlerRef.current(event)
      }
    })
  }, [game])

  // 入场未播完时排队的线索句，等导演层交出控制权再显示
  useEffect(() => {
    if (narrative || !pendingClueRef.current) return
    const line = pendingClueRef.current
    pendingClueRef.current = null
    showClueLine(line)
  }, [narrative])

  useEffect(() => {
    sound.setMasterVolume(muted ? 0 : volume)
  }, [muted, volume, sound])

  useEffect(() => () => sound.dispose(), [sound])

  useEffect(() => {
    narrativeRef.current = narrative
  }, [narrative])

  useEffect(() => () => directorRef.current?.stop(), [])

  // 快捷键只是键位映射到同一批引擎动作，所有阶段/输入锁校验仍由 canAct 与引擎负责
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return
      }
      const snap = snapshotRef.current
      // 开发者面板：1.6s 内连按 4 次 E 打开，关闭后需再次连按；E 不与任何游戏键位冲突
      if (event.key.toLowerCase() === 'e') {
        const presses = devEPresses.current
        presses.push(Date.now())
        if (presses.length > 4) presses.shift()
        if (presses.length === 4 && presses[3]! - presses[0]! <= 1600) {
          setDevOpen(true)
          devEPresses.current = []
        }
      }
      if (!snap) return
      if (narrativeRef.current) return
      if (snap.phase === 'execution') {
        if (event.code === 'Space' || event.key === ' ') {
          event.preventDefault()
          game.skipExecution()
        }
        return
      }
      if (snap.phase === 'targeting') {
        if (snap.pendingShot !== 'player') return
        const key = event.key.toLowerCase()
        if (key === 'f' || key === '1') {
          event.preventDefault()
          game.chooseTarget('boss')
        } else if (key === 'r' || key === '2') {
          event.preventDefault()
          game.chooseTarget('player')
        }
        return
      }
      if (snap.phase === 'supply') {
        const index = Number(event.key)
        if (Number.isInteger(index) && index >= 1 && index <= snap.supplyOptions.length) {
          event.preventDefault()
          const item = snap.supplyOptions[index - 1]
          if (item) game.chooseSupply(item)
        }
        return
      }
      if (snap.phase !== 'playerTurn') return
      const key = event.key.toLowerCase()
      if (key === 'h') {
        event.preventDefault()
        game.hit()
      } else if (key === 's') {
        event.preventDefault()
        game.stand()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [game])

  const hpRatio =
    snapshot && snapshot.player.maxHp > 0 ? snapshot.player.hp / snapshot.player.maxHp : 1
  const alive = (snapshot?.player.hp ?? 0) > 0
  const bpm = Math.round(64 + (1 - hpRatio) * 66)
  useEffect(() => {
    if (!alive) return
    // 外层鼓点也得跟着 bpm 走，否则血越少只有双拍间距变、整体节奏不变
    const id = window.setInterval(() => {
      if (document.hidden) return
      sound.playHeartbeat(bpm)
    }, Math.round(60000 / bpm))
    return () => window.clearInterval(id)
  }, [alive, bpm, sound])

  // 切后台冻结整条音频图：suspend 期间 currentTime 不走，排队的心跳会在回来时一起炸开
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) sound.suspend()
      else sound.resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [sound])

  const devBridge = useMemo(() => new DevBridge(game), [game])

  const unlocked = useMemo(
    () => new Set<ItemId>(snapshot?.unlockedItems ?? []),
    [snapshot?.unlockedItems],
  )

  async function startGame() {
    await sound.unlock()
    sound.setMasterVolume(muted ? 0 : volume)
    if (!sound.isAmbientPlaying) sound.startAmbient()
    void sound.startRoomTone(`${import.meta.env.BASE_URL}audio/room-tone.ogg`)
    // 走廊里的「开始」：解锁音频后人开始往前走，右门黑场结束才进入入场导演层
    setCorridorState('playing')
  }

  function handleCorridorComplete() {
    pendingIntroRef.current = true
    setCorridorState('done')
  }

  /** 左门：整页切到蔓延子游戏的独立入口 */
  function enterMoyan() {
    window.location.assign(`${import.meta.env.BASE_URL}moyan.html`)
  }

  const pendingClueRef = useRef<string | null>(null)
  const clueTimer = useRef<number | null>(null)

  function showClueLine(text: string) {
    setClueLine(text)
    if (clueTimer.current !== null) window.clearTimeout(clueTimer.current)
    clueTimer.current = window.setTimeout(() => setClueLine(null), 6000)
  }

  function handleEventNarrative(event: GameEvent) {
    // directorRef 在 beginNarrative 里同步赋值；narrativeRef 要等一次渲染才同步。
    // 同一帧内「开叙事 + 来事件」时只看 narrativeRef 会误判成空闲
    const narrativeBusy = narrativeRef.current !== null || directorRef.current !== null
    // 结局 B：赢下第三章 → 团聚·吞噬即重逢；结算屏等导演层播完再出现
    if (event.type === 'gameOver' && event.winner === 'player' && !narrativeBusy) {
      beginNarrative('endingB')
      return
    }
    if (event.type === 'levelClear' && !narrativeBusy) {
      if (event.level === 1) beginNarrative('t2')
      else if (event.level === 2) beginNarrative('t3')
      return
    }
    if (event.type !== 'roundStart') return
    // ch1 第一次 roundStart：入场 Boss 半句的后半句；入场没播完就排队
    if (event.level === 1 && event.round === 1) {
      const line = '她也说，赢了就能往下走。'
      if (narrativeBusy) pendingClueRef.current = line
      else showClueLine(line)
    }
    // ch3 第一次 roundStart：刻痕名单扫镜再回桌面；延半拍让 GameCanvas 的 resetShot 先落
    if (event.level === 3 && event.round === 1) {
      const scene = sceneRef.current
      window.setTimeout(() => scene?.setShot('tally', 1.2), 150)
      window.setTimeout(() => scene?.setShot('table', 1.2), 2900)
    }
  }

  /** 入场 / restart 迷你入场 / 章节过渡：导演层接管，播完才把控制权交给引擎 */
  function beginNarrative(mode: NarrativeMode) {
    const scene = sceneRef.current
    if (!scene) return
    directorRef.current?.stop()
    const director = new NarrativeDirector({
      scene,
      sound,
      onVisual: setNarrative,
      onGameStart: () => {
        if (mode === 'intro') game.start()
        else game.restart()
      },
      onFinish: () => {
        setNarrative(null)
        directorRef.current = null
      },
    })
    directorRef.current = director
    director.start(mode)
  }

  const narrativeActive = narrative !== null

  // DEV 专用验证口：生产构建被 import.meta.env.DEV 摇掉，不随游戏发布
  if (import.meta.env.DEV) {
    ;(window as unknown as { __narrativeDebug?: unknown }).__narrativeDebug = {
      play: (mode: NarrativeMode) => beginNarrative(mode),
      scene: () => sceneRef.current,
      game,
    }
  }

  function handleItemUse(actor: ActorId, item: ItemId) {
    if (actor !== 'player') {
      showNotice('那是它的东西。')
      return
    }
    if (!snapshot) return
    if (snapshot.phase !== 'playerTurn') {
      showNotice('现在不是使用道具的时机。')
      return
    }
    if (snapshot.inputLocked) {
      showNotice('动作还没结束。')
      return
    }
    if (!unlocked.has(item)) {
      showNotice(`【${ITEM_CATALOG[item].name}】尚未解锁。`)
      return
    }
    game.useItem(item)
  }

  const phase = snapshot?.phase ?? 'idle'
  const started = snapshot?.started ?? false
  const playerTurn = phase === 'playerTurn'
  const locked = snapshot?.player.skipTurn ?? false
  const inputLocked = snapshot?.inputLocked ?? false
  const canAct = playerTurn && !locked && !inputLocked
  const finished = phase === 'gameOver' || phase === 'victory'
  const level = snapshot?.level ?? (LEVELS[0] as (typeof LEVELS)[number])

  return (
    <main className="relative h-full w-full overflow-hidden bg-abyss-950">
      <div className="absolute inset-0">
        {corridorState === 'done' ? (
          <GameCanvas
            engine={game}
            snapshot={snapshot}
            onItemUse={handleItemUse}
            onHoverChange={setHover}
            onSceneReady={(scene) => {
              sceneRef.current = scene
              // 走廊黑场后 GameCanvas 重新挂载：SceneManager 就位即开始入场
              if (pendingIntroRef.current && corridorState === 'done') {
                pendingIntroRef.current = false
                beginNarrative('intro')
              }
            }}
          />
        ) : null}
        {corridorState !== 'done' ? (
          <CorridorIntro
            sound={sound}
            onStart={startGame}
            onIntroComplete={handleCorridorComplete}
            onEnterMoyan={enterMoyan}
          />
        ) : null}
      </div>

      {/* Blood vignette flash on a live hit. */}
      <div
        key={bloodFlash}
        className={`pointer-events-none absolute inset-0 ${bloodFlash > 0 ? 'blood-flash' : 'opacity-0'}`}
        style={{
          background:
            'radial-gradient(ellipse 78% 70% at 50% 50%, rgba(120,0,0,0) 38%, rgba(122,8,6,0.42) 72%, rgba(58,0,0,0.86) 100%)',
        }}
      />

      {/* 自己中弹：镜头被血糊住，比边缘暗红更强的一层血斑 */}
      <div
        key={`splat-${bloodSplatter}`}
        className={`pointer-events-none absolute inset-0 ${bloodSplatter > 0 ? 'blood-splatter' : 'opacity-0'}`}
        style={{
          background:
            'radial-gradient(circle 30vmin at 24% 20%, rgba(104,0,0,0.92) 0%, rgba(104,0,0,0.5) 40%, rgba(104,0,0,0) 72%), radial-gradient(circle 24vmin at 76% 68%, rgba(78,0,0,0.88) 0%, rgba(78,0,0,0.38) 44%, rgba(78,0,0,0) 76%), radial-gradient(circle 58vmin at 54% 44%, rgba(56,0,0,0.52) 0%, rgba(56,0,0,0.24) 55%, rgba(56,0,0,0) 84%)',
        }}
      />

      {/* 自己中弹：世界瞬间失焦，只模糊画布，HUD 保持清晰 */}
      <div
        key={`blur-${visionBlur}`}
        className={`pointer-events-none absolute inset-0 ${visionBlur > 0 ? 'vision-blur' : 'opacity-0'}`}
        style={{ backdropFilter: 'blur(9px) saturate(0.65)', WebkitBackdropFilter: 'blur(9px) saturate(0.65)' }}
      />

      {/* Minimal corner chrome. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 transition-opacity duration-700 ${narrativeActive ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="flex items-center gap-3">
          <span className="h-[1px] w-8 bg-rust-500/50 max-[420px]:hidden" />
          <p className="text-[9px] tracking-[0.42em] text-bone-200/35 uppercase">
            Abyss XXI · 第 {level.id} 层
          </p>
        </div>
        {snapshot && started ? (
          <p className="text-[9px] tracking-[0.3em] text-bone-200/25 uppercase">
            回合 {snapshot.round || 1} · {phaseLabel(phase)}
          </p>
        ) : null}
      </div>

      {/* Hand totals live on the felt itself (SceneManager score plates); panels keep vitals/status. */}
      {snapshot && started ? (
        <div
          className={`transition-opacity duration-1000 ${narrativeActive ? 'opacity-0' : 'opacity-100'}`}
        >
          <ActorPanel className="top-14 left-4" label="你" actor={snapshot.player} accent />
          <ActorPanel className="top-14 right-4" label="它" actor={snapshot.boss} />
          <LogPanel snapshot={snapshot} />
          <CylinderPanel snapshot={snapshot} />
        </div>
      ) : null}

      {/* Bottom control rail. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-5">
        {narrativeActive ? null : !started ? null : phase === 'targeting' ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[9px] tracking-[0.4em] text-rust-400/80 uppercase">
              {snapshot?.pendingShot === 'player' ? '这一轮你赢了 · 选择枪口' : '它在决定枪口'}
            </p>
            {snapshot?.pendingShot === 'player' ? (
              <div className="flex items-center gap-3">
                <MetalButton tone="primary" onClick={() => game.chooseTarget('boss')}>
                  射向它{' '}
                  <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45 max-[420px]:hidden">
                    FIRE · F
                  </span>
                </MetalButton>
                <MetalButton
                  tone="secondary"
                  onClick={() => game.chooseTarget('player')}
                  hint="对自己开枪：空膛可摸一件道具，实弹则你自己受伤"
                >
                  射向自己{' '}
                  <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45 max-[420px]:hidden">
                    RISK · R
                  </span>
                </MetalButton>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <MetalButton
              tone="primary"
              disabled={!canAct}
              onClick={() => game.hit()}
              hint={locked ? '手铐锁住了你的手腕' : undefined}
            >
              要牌{' '}
              <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45 max-[420px]:hidden">
                HIT · H
              </span>
            </MetalButton>
            <MetalButton tone="secondary" disabled={!canAct} onClick={() => game.stand()}>
              停牌{' '}
              <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45 max-[420px]:hidden">
                STAND · S
              </span>
            </MetalButton>
          </div>
        )}

        <div className="flex items-center gap-2 text-[9px] tracking-[0.2em] text-bone-200/30 uppercase">
          <span>
            {phase === 'targeting'
              ? snapshot?.pendingShot === 'player'
                ? targetHint(snapshot)
                : ' ' 
              : canAct
                ? '选择要牌或停牌'
                : locked && playerTurn
                  ? '本回合被封锁'
                  : inputLocked
                    ? '…'
                    : ' '}
          </span>
        </div>
      </div>

      {/* Corner utilities: volume + codex.
          窄屏改成横排抬到操作栏上方，否则会和底部按钮叠在一起 */}
      <div
        className={`absolute right-4 bottom-4 flex flex-col items-end gap-2 transition-opacity duration-700 max-[420px]:right-3 max-[420px]:bottom-[6.25rem] max-[420px]:flex-row max-[420px]:items-center ${narrativeActive ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <button
          type="button"
          onClick={() => setModal(modal === 'items' ? null : 'items')}
          className="corner-chip"
        >
          规则 / 图鉴
        </button>
        <button
          type="button"
          onClick={() => setMuted((value) => !value)}
          className="corner-chip"
          aria-pressed={muted}
        >
          {muted ? '音量 关' : '音量 开'}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="主音量"
          onChange={(event) => {
            setVolume(Number(event.target.value))
            setMuted(false)
          }}
          className="volume-slider w-24 max-[420px]:w-20"
        />
      </div>

      {/* Reload banner. */}
      {relay ? (
        <div
          key={relay.id}
          className="slide-banner absolute inset-x-0 top-[16%] flex justify-center"
        >
          <div className="flex flex-col items-center gap-1 border-y border-rust-500/25 bg-black/55 px-10 py-3 backdrop-blur-sm">
            <p className="text-[9px] tracking-[0.42em] text-bone-200/35 uppercase">Loading cylinder</p>
            <p className="font-display text-lg text-bone-200">
              装入 <span className="text-rust-400">{relay.live}</span> 发实弹，
              <span className="text-sky-300">{relay.blank}</span> 发空弹
            </p>
          </div>
        </div>
      ) : null}

      {/* Loot banner. */}
      {loot ? (
        <div
          key={loot.id}
          className="loot-banner absolute inset-x-0 top-[24%] flex justify-center"
        >
          <div className="flex flex-col items-center gap-2 border border-rust-500/35 bg-abyss-900/90 px-8 py-4 shadow-[0_0_40px_rgba(180,85,45,0.18)]">
            <p className="text-[9px] tracking-[0.4em] text-rust-400/80 uppercase">
              第 {loot.level - 1} 层已清空 · 解锁新道具
            </p>
            <div className="flex items-center gap-4">
              {loot.items.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="font-display text-xl text-rust-400/90">
                    {ITEM_CATALOG[item].glyph}
                  </span>
                  <span className="text-xs text-bone-200/80">{ITEM_CATALOG[item].name}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-bone-200/35">正在前往第 {loot.level} 层……</p>
          </div>
        </div>
      ) : null}

      {/* Supply pick: one item only, then the door opens. */}
      {phase === 'supply' && snapshot ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="层间补给"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto border border-rust-500/35 bg-abyss-900/95 p-5 shadow-2xl shadow-black/80"
          >
            <p className="text-[9px] tracking-[0.45em] text-rust-400/75 uppercase">before the next door</p>
            <h2 className="mt-2 font-display text-2xl text-bone-200">门前的补给</h2>
            <p className="mt-1 text-[11px] text-bone-200/45">只能带走一件。选中的道具会跟到下一层。</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {snapshot.supplyOptions.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => game.chooseSupply(item)}
                  className="group flex flex-col items-start gap-1 border border-white/8 bg-black/30 p-3 text-left transition-colors hover:border-rust-500/60 hover:bg-rust-500/10"
                >
                  <span className="flex w-full items-center justify-between">
                    <span className="font-display text-2xl text-rust-400/85">
                      {ITEM_CATALOG[item].glyph}
                    </span>
                    <span className="text-[9px] tracking-[0.25em] text-bone-200/25 uppercase">
                      {index + 1}
                    </span>
                  </span>
                  <span className="font-display text-sm text-bone-200">{ITEM_CATALOG[item].name}</span>
                  <span className="text-[10px] leading-relaxed text-bone-200/50">
                    {ITEM_CATALOG[item].summary}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[9px] tracking-[0.2em] text-bone-200/25 uppercase">
              快捷键 1 / 2 / 3 · 12 秒后自动带走第一件
            </p>
          </div>
        </div>
      ) : null}

      {/* Execution flavour line. */}
      {phase === 'execution' ? (
        <div className="pointer-events-none absolute inset-x-0 top-[18%] flex flex-col items-center gap-1">
          <p className="execution-pulse text-[10px] tracking-[0.44em] text-rust-400/70 uppercase">
            屏住呼吸
          </p>
          <p className="text-[9px] tracking-[0.3em] text-bone-200/30 uppercase">空格跳过</p>
        </div>
      ) : null}

      {/* Death / victory end screens. */}
      {finished && !narrativeActive ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-black/78 px-6 py-8 text-center backdrop-blur-sm">
          {phase === 'victory' ? (
            <>
              <p className="text-[9px] tracking-[0.5em] text-rust-400/80 uppercase">run the gauntlet</p>
              <h2 className="font-display text-4xl text-bone-200">深渊幸存者</h2>
              <p className="max-w-md text-xs leading-relaxed text-bone-200/50">
                三轮锈蚀的轮盘都已停转。你带着仍然发烫的枪口走出地下室——
                但走廊尽头的灯，还亮着。
              </p>
              <dl className="grid grid-cols-3 gap-6 text-[10px] text-bone-200/45">
                <div>
                  <dt className="text-bone-200/25">层数</dt>
                  <dd className="mt-1 font-display text-base text-bone-200">3 / 3</dd>
                </div>
                <div>
                  <dt className="text-bone-200/25">残存生命</dt>
                  <dd className="mt-1 font-display text-base text-bone-200">
                    {snapshot?.player.hp ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-bone-200/25">回合数</dt>
                  <dd className="mt-1 font-display text-base text-bone-200">
                    {snapshot?.round ?? 0}
                  </dd>
                </div>
              </dl>
              <div className="mt-2 flex gap-3">
                <MetalButton tone="primary" onClick={() => beginNarrative('restart')}>
                  再次走进深渊
                </MetalButton>
                <MetalButton tone="ghost" onClick={() => setModal('rules')}>
                  查看规则
                </MetalButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-[9px] tracking-[0.5em] text-rust-500/70 uppercase">specimen acquired</p>
              <h2 className="font-display text-4xl text-bone-200/90">你已成为实验品</h2>
              <p className="max-w-md text-xs leading-relaxed text-bone-200/45">
                轮盘在你身上完成了它想要的实验。灯没有熄灭，只是换了一位坐下的客人。
              </p>
              <dl className="grid grid-cols-3 gap-6 text-[10px] text-bone-200/45">
                <div>
                  <dt className="text-bone-200/25">倒下于</dt>
                  <dd className="mt-1 font-display text-base text-bone-200/80">
                    第 {(snapshot?.levelIndex ?? 0) + 1} 层
                  </dd>
                </div>
                <div>
                  <dt className="text-bone-200/25">回合数</dt>
                  <dd className="mt-1 font-display text-base text-bone-200/80">
                    {snapshot?.round ?? 0}
                  </dd>
                </div>
                <div>
                  <dt className="text-bone-200/25">对手</dt>
                  <dd className="mt-1 font-display text-base text-bone-200/80">{level.name}</dd>
                </div>
              </dl>
              <div className="mt-2 flex gap-3">
                <MetalButton tone="primary" onClick={() => beginNarrative('restart')}>
                  重新成为实验品
                </MetalButton>
                <MetalButton tone="ghost" onClick={() => setModal('rules')}>
                  查看规则
                </MetalButton>
              </div>
            </>
          )}
        </div>
      ) : null}

      {notice ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center">
          <p className="rounded-sm border border-white/8 bg-black/70 px-4 py-1.5 text-[10px] tracking-[0.15em] text-bone-200/65">
            {notice}
          </p>
        </div>
      ) : null}

      {guideOpen && !started ? (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/82 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="开局说明"
        >
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto border border-rust-500/35 bg-abyss-900/95 p-6 shadow-2xl shadow-black/80">
            <p className="text-[9px] tracking-[0.45em] text-rust-400/75 uppercase">
              before you sit down
            </p>
            <h2 className="mt-2 font-display text-2xl text-bone-200">三句话，坐上这张桌子</h2>
            <ol className="mt-5 space-y-3">
              {GUIDE_LINES.map((line, index) => (
                <li key={line} className="flex gap-3">
                  <span className="font-display text-sm text-rust-400/80">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <p className="text-xs leading-relaxed text-bone-200/65">{line}</p>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  markGuideSeen()
                  setGuideOpen(false)
                  setModal('rules')
                }}
                className="text-[10px] tracking-[0.25em] text-bone-200/35 uppercase hover:text-bone-200/70"
              >
                看完整规则
              </button>
              <MetalButton
                tone="primary"
                onClick={() => {
                  markGuideSeen()
                  setGuideOpen(false)
                }}
              >
                我知道了
              </MetalButton>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? <RulesModal initialTab={modal} onClose={() => setModal(null)} /> : null}

      {clueLine && !narrativeActive ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[16vh] z-20 flex justify-center px-6">
          <p className="clue-line narrative-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] text-bone-200/85">
            {clueLine}
          </p>
        </div>
      ) : null}

      {narrative && directorRef.current ? (
        <NarrativeOverlay director={directorRef.current} sound={sound} visual={narrative} />
      ) : null}

      {devOpen ? (
        <DevPanel
          snapshot={snapshot}
          onWinLevel={() => devBridge.winLevel()}
          onSetPlayerTotal={(total) => devBridge.setPlayerTotal(total)}
          onForceChamber={(chamber) => devBridge.forceChamber(chamber)}
          onGrantItem={(item) => devBridge.grantItem(item)}
          onClose={() => setDevOpen(false)}
        />
      ) : null}

      <ItemTooltip payload={hover} />
    </main>
  )
}

function ActorPanel({
  className,
  label,
  actor,
  accent = false,
}: {
  className: string
  label: string
  actor: ActorView
  accent?: boolean
}) {
  const visibleCards = actor.visibleHand.visible.filter((card): card is Card => card !== null)
  const shown = evaluateHand(visibleCards)
  return (
    <div
      className={`pointer-events-none absolute w-36 border bg-black/50 px-3 py-2 backdrop-blur-sm max-[420px]:w-32 ${
        accent ? 'border-rust-500/35' : 'border-white/8'
      } ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] text-bone-200/40 uppercase">{label}</span>
      </div>
      <p className="mt-1 flex items-center gap-2 text-[9px] tracking-[0.15em] text-bone-200/30">
        <span>
          {shown.busted ? '爆牌' : actor.standing ? '已停牌' : '在局中'} · 道具 {actor.items.length}
        </span>
        {actor.sawBoost > 0 ? <span className="text-amber-300/80">锯</span> : null}
        {actor.shield > 0 ? <span className="text-sky-300/80">盾</span> : null}
        {actor.decoy > 0 ? <span className="text-fuchsia-300/70">饵</span> : null}
      </p>
    </div>
  )
}

function LogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const lines = snapshot.log.slice(-3)
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-36 right-4 w-64 space-y-1 text-right max-[420px]:w-40">
      {lines.map((line, index) => (
        <p
          key={index}
          className={`line-clamp-2 text-[10px] leading-relaxed [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] ${
            index === lines.length - 1 ? 'text-bone-200/65' : 'text-bone-200/30'
          }`}
        >
          {line}
        </p>
      ))}
    </div>
  )
}

function CylinderPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const { cylinder, damageBonus, hourglassActive } = snapshot
  // 窄屏把弹仓挪到左上角：留在下方会盖住牌桌上的手牌点数
  return (
    <div className="pointer-events-none absolute bottom-24 left-4 w-40 border border-white/8 bg-black/50 px-3 py-2 backdrop-blur-sm max-[420px]:top-32 max-[420px]:bottom-auto max-[420px]:w-32">
      <div className="flex items-center justify-between text-[9px] tracking-[0.2em] text-bone-200/35 uppercase">
        <span>弹仓</span>
        <span className="text-bone-200/60">
          {cylinder.remaining}/{cylinder.total}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px] tracking-[0.12em]">
        <span className="text-rust-400/90">实 {cylinder.live}</span>
        <span className="text-sky-300/80">空 {cylinder.blank}</span>
      </div>
      {cylinder.revealed ? (
        <p
          className={`mt-1 text-[10px] tracking-[0.12em] ${
            cylinder.revealed === 'live' ? 'text-rust-400' : 'text-sky-300'
          }`}
        >
          膛内 · {cylinder.revealed === 'live' ? '实弹' : '空膛'}
        </p>
      ) : null}
      {damageBonus > 0 ? (
        <p className="mt-1 text-[10px] tracking-[0.12em] text-amber-300/90">
          走火遗恨 +{damageBonus}
        </p>
      ) : null}
      {hourglassActive ? (
        <p className="mt-1 text-[10px] tracking-[0.12em] text-fuchsia-300/80">沙漏逆转 · 低者胜</p>
      ) : null}
    </div>
  )
}

function targetHint(snapshot: GameSnapshot): string {
  const revealed = snapshot.cylinder.revealed
  if (revealed === 'blank') return '膛内是空膛：对自己开枪可以摸一件道具'
  if (revealed === 'live') return '膛内是实弹：对自己开枪会受伤'
  return '膛内未知：对自己开枪是赌博'
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'reloading':
      return '装弹'
    case 'dealing':
      return '发牌'
    case 'playerTurn':
      return '你的行动'
    case 'bossTurn':
      return '它在行动'
    case 'resolving':
      return '结算'
    case 'targeting':
      return '选择枪口'
    case 'execution':
      return '处决'
    case 'roundEnd':
      return '回合结束'
    case 'levelClear':
      return '层已净空'
    case 'supply':
      return '挑选补给'
    case 'gameOver':
      return '实验结束'
    case 'victory':
      return '幸存'
    default:
      return '待机'
  }
}

function MetalButton({
  tone,
  disabled,
  onClick,
  children,
  hint,
}: {
  tone: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  hint?: string | undefined
}) {
  const toneClass =
    tone === 'primary'
      ? 'metal-btn metal-btn--primary'
      : tone === 'secondary'
        ? 'metal-btn metal-btn--secondary'
        : 'metal-btn metal-btn--ghost'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`${toneClass} ${disabled ? 'is-disabled' : ''}`}
    >
      {children}
    </button>
  )
}
