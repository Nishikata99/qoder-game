import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoundEngine } from './audio/SoundEngine'
import { GameCanvas, GunTooltip, ItemTooltip } from './components/GameCanvas'
import { RulesModal, type ModalTab } from './components/RulesModal'
import { NarrativeDirector, type NarrativeMode, type NarrativeVisual } from './narrative/NarrativeDirector'
import { DevBridge } from './game/DevBridge'
import { DevPanel } from './components/DevPanel'
import { CorridorIntro } from './components/CorridorIntro'
import { NarrativeOverlay } from './narrative/NarrativeOverlay'
import { CutsceneOverlay } from './narrative/CutsceneOverlay'
import { EnemyDialogueBox } from './narrative/EnemyDialogueBox'
import type { DialogueChannel } from './narrative/dialogue'
import { cutsceneFor } from './narrative/cutsceneScript'
import { ENDINGS, type EndingSpec } from './narrative/endingScript'
import type { Cutscene2D, Playable2D } from './narrative/Cutscene2D'
import type { GunHoverPayload, ItemHoverPayload } from './scene/SceneManager'
import type { QualityPreset, SceneManager } from './scene/SceneManager'
import type { BossPoseCue } from './scene/SceneManager'
import type { ItemActionCue } from './scene/ItemActions'
import { ITEM_ACTION_SPECS } from './scene/itemActionConfig'
import type { ActorId, ActorView, Card, GameEvent, GameSnapshot, ItemId } from './game/GameEngine'
import {
  GameEngine,
  ITEM_CATALOG,
  ITEM_IDS,
  LEVELS,
  MAX_ITEMS,
  PLAYER_ITEM_CAP,
  createSeededRandom,
  evaluateHand,
  formatCard as formatCardLabel,
} from './game/GameEngine'
import { bossName, levelTitle, narrativeLog } from './narrative/copy'
import { useDialogFocus } from './components/useDialogFocus'

interface LootBanner {
  readonly id: number
  readonly level: number
  readonly items: readonly ItemId[]
}

interface ClueLine {
  readonly text: string
  readonly channel: DialogueChannel
  readonly durationMs: number
}

const GUIDE_KEY = 'blood-ante.guideSeen'

const GUIDE_LINES = [
  '比 21 点：要牌或停牌；赢下这轮，枪就归你。牌库只有 A–10，没有 J/Q/K。',
  '枪口由你定：射它，或射自己。对自己开未知空膛，桌下可能回一件遗物。',
  '三层赎契：每层血袋重置；清层只能带走一件补给。',
] as const

const NARRATIVE_SEEN: Readonly<Record<NarrativeMode, string>> = {
  intro: 'blood-ante.narrativeSeen.intro',
  restart: 'blood-ante.narrativeSeen.restart',
  t2: 'blood-ante.narrativeSeen.t2',
  t3: 'blood-ante.narrativeSeen.t3',
  endingB: 'blood-ante.narrativeSeen.endingB',
}

const FIRST_TURN_HINT_KEY = 'blood-ante.hint.firstTurn'
const TARGET_HINT_KEY = 'blood-ante.hint.targetPick'
const SETTINGS_KEY = 'blood-ante.settings.v1'
const CHECKPOINT_KEY = 'blood-ante.checkpoint.v1'
const CUTSCENE_SEEN_KEY = 'blood-ante.cutsceneSeen.v1'

function readCutsceneSeen(): readonly number[] {
  try {
    const raw = window.localStorage.getItem(CUTSCENE_SEEN_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const seen = (parsed as Record<string, unknown>).seen
    if (!Array.isArray(seen)) return []
    return seen.filter((v): v is number => typeof v === 'number' && Number.isInteger(v))
  } catch {
    return []
  }
}

function markCutsceneSeen(levelIndex: number): void {
  try {
    const seen = new Set(readCutsceneSeen())
    seen.add(levelIndex)
    window.localStorage.setItem(CUTSCENE_SEEN_KEY, JSON.stringify({ v: 1, seen: [...seen] }))
  } catch {
    // 写不进去就下次再看一遍，不阻塞流程
  }
}

function clearCutsceneSeen(): void {
  try {
    window.localStorage.removeItem(CUTSCENE_SEEN_KEY)
  } catch {
    // 清不掉时下一轮重开会重播，不影响流程
  }
}

interface StoredSettings {
  readonly muted: boolean
  readonly volume: number
  readonly quality: string
}

interface StoredCheckpoint {
  readonly levelIndex: number
  readonly carryOver: readonly ItemId[]
  readonly runRounds: number
}

function readSettings(): Partial<StoredSettings> {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const value = parsed as Record<string, unknown>
    return {
      muted: typeof value.muted === 'boolean' ? value.muted : undefined,
      volume: typeof value.volume === 'number' ? value.volume : undefined,
      quality: typeof value.quality === 'string' ? value.quality : undefined,
    }
  } catch {
    return {}
  }
}

function writeSettings(settings: StoredSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ v: 1, ...settings }))
  } catch {
    // 隐私模式写不进去，本次会话内仍然生效
  }
}

function readCheckpoint(): StoredCheckpoint | null {
  try {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const value = parsed as Record<string, unknown>
    const levelIndex = value.levelIndex
    if (value.v !== 1 || typeof levelIndex !== 'number' || !Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex >= LEVELS.length) return null
    const carryOver = Array.isArray(value.carryOver)
      ? value.carryOver.filter((item): item is ItemId => typeof item === 'string' && ITEM_IDS.includes(item as ItemId)).slice(0, MAX_ITEMS)
      : []
    const runRounds = typeof value.runRounds === 'number' && Number.isInteger(value.runRounds) && value.runRounds >= 0 ? value.runRounds : 0
    return { levelIndex, carryOver, runRounds }
  } catch {
    return null
  }
}

function writeCheckpoint(checkpoint: StoredCheckpoint): void {
  try {
    window.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ v: 1, ...checkpoint }))
  } catch {
    // 存不下检查点时最多刷新后回第一层
  }
}

function clearCheckpoint(): void {
  try {
    window.localStorage.removeItem(CHECKPOINT_KEY)
  } catch {
    // 忽略
  }
}

/** 首次进入的三句话规则；localStorage 记住已读，之后只在角落留一个「规则 / 图鉴」入口 */
function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === '1'
  } catch {
    // 隐私模式读不到 localStorage 时应当看到引导，而不是静默跳过
    return false
  }
}

function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_KEY, '1')
  } catch {
    // 隐私模式写入会抛错，忽略即可，最多下次再弹一次
  }
}

function hasSeenNarrative(mode: NarrativeMode): boolean {
  try {
    return window.localStorage.getItem(NARRATIVE_SEEN[mode]) === '1'
  } catch {
    return false
  }
}

function markNarrativeSeen(mode: NarrativeMode): void {
  try {
    window.localStorage.setItem(NARRATIVE_SEEN[mode], '1')
  } catch {
    // 写不进去就下次再看一遍，不阻塞流程
  }
}

function hasSeenFirstTurnHint(): boolean {
  try {
    return window.localStorage.getItem(FIRST_TURN_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markFirstTurnHintSeen(): void {
  try {
    window.localStorage.setItem(FIRST_TURN_HINT_KEY, '1')
  } catch {
    // 隐私模式：最多重复提示一次
  }
}

function hasSeenTargetHint(): boolean {
  try {
    return window.localStorage.getItem(TARGET_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function markTargetHintSeen(): void {
  try {
    window.localStorage.setItem(TARGET_HINT_KEY, '1')
  } catch {
    // 隐私模式：最多重复提示一次
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
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(() => game.getItemPresentationSnapshot())
  const [sceneSnapshot, setSceneSnapshot] = useState<GameSnapshot | null>(() => game.getSnapshot())
  const snapshotRef = useRef<GameSnapshot | null>(null)
  snapshotRef.current = snapshot
  const [hover, setHover] = useState<ItemHoverPayload | null>(null)
  const [gunHover, setGunHover] = useState<GunHoverPayload | null>(null)
  const [muted, setMuted] = useState(() => readSettings().muted ?? false)
  const [volume, setVolume] = useState(() => {
    const stored = readSettings().volume
    return typeof stored === 'number' ? Math.min(1, Math.max(0, stored)) : 0.85
  })
  const [quality, setQuality] = useState(() => readSettings().quality ?? 'auto')
  const [modal, setModal] = useState<ModalTab | null>(null)
  const [guideOpen, setGuideOpen] = useState(() => !hasSeenGuide())
  const [loot, setLoot] = useState<LootBanner | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bloodFlash, setBloodFlash] = useState(0)
  const [muzzleFlash, setMuzzleFlash] = useState(0)
  const [bloodSplatter, setBloodSplatter] = useState(0)
  const [visionBlur, setVisionBlur] = useState(0)
  const [wakeBlur, setWakeBlur] = useState(0)
  const [narrative, setNarrative] = useState<NarrativeVisual | null>(null)
  const [clueLine, setClueLine] = useState<ClueLine | null>(null)
  const [devOpen, setDevOpen] = useState(false)
  const [corridorState, setCorridorState] = useState<'idle' | 'playing' | 'done'>('idle')
  const [skipAvailable, setSkipAvailable] = useState(false)
  const [cutscene, setCutscene] = useState<Playable2D | null>(null)
  const [cutsceneKind, setCutsceneKind] = useState<'transition' | 'ending'>('transition')
  const [showFirstTurnHint, setShowFirstTurnHint] = useState(false)
  const firstTurnHintShownRef = useRef(false)
  const [showTargetHint, setShowTargetHint] = useState(false)
  const targetHintShownRef = useRef(false)
  const [paused, setPaused] = useState(false)
  const [checkpoint, setCheckpoint] = useState<StoredCheckpoint | null>(() => readCheckpoint())
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [spokenLine, setSpokenLine] = useState('')
  const guideRef = useRef<HTMLDivElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  const pendingIntroRef = useRef(false)
  const devEPresses = useRef<number[]>([])
  const narrativeRef = useRef<NarrativeVisual | null>(null)
  const sceneRef = useRef<SceneManager | null>(null)
  const directorRef = useRef<NarrativeDirector | null>(null)
  const narrativeModeRef = useRef<NarrativeMode | null>(null)
  /** 胜利结局：3D endingB 播完后要接的 2D 续篇（一次性） */
  const endingThenCutsceneRef = useRef<(() => void) | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const lootTimer = useRef<number | null>(null)
  const bloodTimer = useRef<number | null>(null)
  const muzzleTimer = useRef<number | null>(null)
  const splatterTimer = useRef<number | null>(null)
  const blurTimer = useRef<number | null>(null)
  const wakeBlurTimer = useRef<number | null>(null)
  const bannerId = useRef(0)
  const startedRef = useRef(false)
  const finishedRef = useRef(false)
  const cutsceneDirectorRef = useRef<Cutscene2D | null>(null)
  const cutsceneActiveRef = useRef(false)
  const cutsceneNextRef = useRef<(() => void) | null>(null)
  const cutsceneKindRef = useRef<'transition' | 'ending'>('transition')
  const cutsceneSkippableRef = useRef(true)

  /**
   * 关卡间 2D 过场只叠在 beginLevel 的 reloading 黑场上，播完自动卸载，不改引擎时序。
   * e2e 要能被跳过：`?skipcutscene=1` 或自动化环境（navigator.webdriver）直接不挂载，
   * 否则清层用例会被这 2.4s 额外耗时拖到超时。
   */
  const cutsceneDisabledRef = useRef(false)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    const automated = (window.navigator as { webdriver?: boolean }).webdriver === true
    const forced = params.get('cutscene') === '1'
    cutsceneDisabledRef.current = params.get('skipcutscene') === '1' || (automated && !forced)
  }

  const beginCutscene = useCallback((levelIndex: number, force = false) => {
    if (cutsceneDisabledRef.current && !force) return
    const spec = cutsceneFor(levelIndex)
    if (!spec || cutsceneActiveRef.current) return
    cutsceneActiveRef.current = true
    // checkpoint 时引擎已进入 reloading，但 beginLevel 的 2.6s 计时马上就要开始；
    // 暂停把它挂起（delay 尚未 start），过场尾部再恢复，避免过场被黑窗截断。
    game.pause()
    setCutsceneKind('transition')
    cutsceneKindRef.current = 'transition'
    cutsceneSkippableRef.current = true
    setCutscene(spec)
  }, [game])

  const resumeEngineAfterCutscene = useCallback(() => {
    if (!cutsceneActiveRef.current) return
    game.resume()
  }, [game])

  const finishCutscene = useCallback(() => {
    if (!cutsceneActiveRef.current) return
    cutsceneActiveRef.current = false
    cutsceneDirectorRef.current = null
    // 兜底：任何异常路径下都不让引擎留在挂起状态
    if (game.isPaused) game.resume()
    // 结局：播完后若还有下一步（胜利→2D 续篇），交给挂起的回调
    const next = cutsceneNextRef.current
    cutsceneNextRef.current = null
    if (next) {
      setCutscene(null)
      next()
      return
    }
    setCutscene(null)
  }, [game])

  const skipCutscene = useCallback(() => {
    cutsceneDirectorRef.current?.skip()
  }, [])

  /** 开一段结局 2D（引擎已终局，不 pause/resume） */
  const beginEnding = useCallback(
    (id: EndingSpec['id'], onDone?: () => void) => {
      if (cutsceneDisabledRef.current) {
        onDone?.()
        return
      }
      cutsceneActiveRef.current = true
      cutsceneNextRef.current = onDone ?? null
      const spec = ENDINGS[id]
      cutsceneKindRef.current = 'ending'
      cutsceneSkippableRef.current = spec.skippable
      setCutsceneKind('ending')
      setCutscene(spec)
    },
    [],
  )

  const togglePause = useCallback(
    (next: boolean) => {
      if (next) {
        if (!startedRef.current || finishedRef.current) return
        game.pause()
        directorRef.current?.pause()
        cutsceneDirectorRef.current?.pause()
        sound.suspend()
      } else {
        game.resume()
        directorRef.current?.resume()
        cutsceneDirectorRef.current?.resume()
        sound.resume()
      }
      setPaused(next)
    },
    [game, sound],
  )

  const applyQuality = useCallback((scene: SceneManager, preset: string) => {
    const resolved: QualityPreset =
      preset === 'high' || preset === 'balanced' || preset === 'low'
        ? preset
        : window.matchMedia('(pointer: coarse)').matches ||
            (navigator.hardwareConcurrency ?? 8) <= 4
          ? 'balanced'
          : 'high'
    scene.setQuality(resolved)
  }, [])

  useDialogFocus(guideRef, () => setGuideOpen(false), guideOpen)
  useDialogFocus(logRef, () => setLogOpen(false), logOpen)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2400)
  }, [])

  const handleItemCue = useCallback((item: ItemId, cue: ItemActionCue) => {
    if (cue === 'pickup') sound.playItemUse()
    else if (cue === 'finish') {
      if (ITEM_ACTION_SPECS[item].sound === 'paper') sound.playPaperRustle()
    } else if (cue === 'needleSeat') sound.playItemContact('soft')
    else if (cue === 'bladeCut' || cue === 'cuffLock') sound.playItemContact('metal')
    else if (cue === 'cardExchange') sound.playPaperRustle()
    else if (cue === 'stampPress') {
      sound.playLowThump()
      sound.playPaperRustle()
    } else if (cue === 'flipComplete' || cue === 'shieldRaise' || cue === 'focus') sound.playItemContact('glass')
    else if (cue === 'sawCut' || cue === 'hammerImpact') sound.playLowThump()
  }, [sound])

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
            // 自射时枪口精灵落在画面上缘之外，靠一层屏幕空间爆闪补「砰」的读感
            if (event.target === 'player') {
              setMuzzleFlash((n) => n + 1)
              if (muzzleTimer.current !== null) window.clearTimeout(muzzleTimer.current)
              muzzleTimer.current = window.setTimeout(() => setMuzzleFlash(0), 160)
            }
            if (event.blocked !== null) {
              showNotice('护心镜碎裂：伤害被完全挡下')
              setSpokenLine('实弹被护心镜完全挡下。')
              break
            }
            setSpokenLine(
              event.target === 'player'
                ? `你受到 ${event.damage} 点伤害。`
                : `对手受到 ${event.damage} 点伤害。`,
            )
            setBloodFlash((n) => n + 1)
            if (bloodTimer.current !== null) window.clearTimeout(bloodTimer.current)
            bloodTimer.current = window.setTimeout(() => setBloodFlash(0), 900)
            if (event.target === 'player') {
              setBloodSplatter((n) => n + 1)
              if (splatterTimer.current !== null) window.clearTimeout(splatterTimer.current)
              splatterTimer.current = window.setTimeout(() => setBloodSplatter(0), 1500)
              setVisionBlur(0)
              if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
              // 黑屏等枪口火光熄灭后再硬切进入。
              // 睁眼模糊也必须等这一刻才挂上：它挂载即满糊+压暗，枪响帧会直接糊掉枪口火光
              blurTimer.current = window.setTimeout(() => {
                setVisionBlur((n) => n + 1)
                blurTimer.current = window.setTimeout(() => setVisionBlur(0), 1500)
                setWakeBlur((n) => n + 1)
                if (wakeBlurTimer.current !== null) window.clearTimeout(wakeBlurTimer.current)
                // 2000ms 动画在黑屏挂上后 2.1s 全清，2.25s 才开始撑桌起身
                wakeBlurTimer.current = window.setTimeout(() => setWakeBlur(0), 2150)
              }, 100)
            }
          } else {
            sound.playClickEmpty()
          }
          break
        case 'itemUsed':
          break
        case 'magnetSwap':
          showNotice(`磁铁换牌：${event.actor === 'player' ? '你' : '它'}拿到 ${formatCardLabel(event.card)}`)
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
          sound.playReload()
          break
        case 'cardCuttered':
          if (event.actor === 'player') {
            showNotice(`裁纸刀：裁掉了 ${formatCardLabel(event.old)}`)
          }
          break
        case 'iouSigned':
          if (event.actor === 'player') {
            showNotice('借据落印：本局赢下的实弹 +2，输掉时挨的实弹 +1')
          }
          break
        case 'cardSealed':
          if (event.actor === 'player') {
            showNotice(`封条贴住 ${formatCardLabel(event.card)}，本局不计点`)
          }
          break
        case 'deckPeeked':
          if (event.actor === 'player') {
            showNotice(`单片眼镜：牌靴顶部 ${event.cards.map((card) => formatCardLabel(card)).join('、')}`)
          }
          break
        case 'notice':
          showNotice(event.message)
          break
        case 'reload':
          sound.playReload()
          break
        case 'levelClear':
          bannerId.current += 1
          break
        case 'supplyOffer':
          sound.playItemUse()
          break
        case 'bossSupply':
          sound.playLowThump()
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
      setSnapshot(game.getItemPresentationSnapshot())
      setSceneSnapshot(snap)
      if (event.type !== 'state') {
        soundHandlerRef.current(event)
        narrativeHandlerRef.current(event)
      }
    })
  }, [game])

  // 入场未播完时排队的线索句，等导演层交出控制权再显示
  useEffect(() => {
    if (narrative || !pendingClueRef.current) return
    const lines = pendingClueRef.current
    pendingClueRef.current = null
    showDialogueSequence(lines)
  }, [narrative])

  useEffect(() => {
    sound.setMasterVolume(muted ? 0 : volume)
    writeSettings({ muted, volume, quality })
  }, [muted, volume, quality, sound])

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
      // 2D 过场期间吞掉所有游戏键。
      // 关卡间过场与失败结局：Space/Esc 跳过；胜利结局不可跳过（长按兜底在覆盖层里处理）。
      if (cutsceneActiveRef.current) {
        event.preventDefault()
        if (cutsceneKindRef.current === 'ending' && !cutsceneSkippableRef.current) return
        if (event.code === 'Space' || event.key === ' ' || event.key === 'Escape') {
          skipCutscene()
        }
        return
      }
      // Esc：暂停/继续；弹窗或叙事期间交给它们自己处理
      if (event.key === 'Escape') {
        if (modal !== null || narrativeRef.current !== null) return
        if (!startedRef.current || finishedRef.current) return
        event.preventDefault()
        togglePause(!paused)
        return
      }
      if (paused) return
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
        if (!event.repeat) sceneRef.current?.activateTableAction('hit')
      } else if (key === 's') {
        event.preventDefault()
        if (!event.repeat) sceneRef.current?.activateTableAction('stand')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [game, togglePause, paused, modal, skipCutscene])

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

  // 切后台冻结音频图并暂停整局：回来不自动续，避免 Boss 回合在后台跑完
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        sound.suspend()
        directorRef.current?.pause()
        if (startedRef.current && !finishedRef.current) togglePause(true)
      } else {
        sound.resume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [sound, togglePause])

  useEffect(() => {
    startedRef.current = snapshot?.started ?? false
    finishedRef.current = snapshot?.phase === 'gameOver' || snapshot?.phase === 'victory'
  }, [snapshot?.started, snapshot?.phase])

  useEffect(() => {
    if (!snapshot || snapshot.phase !== 'playerTurn' || snapshot.round !== 1) return
    if (firstTurnHintShownRef.current || hasSeenFirstTurnHint()) return
    firstTurnHintShownRef.current = true
    markFirstTurnHintSeen()
    setShowFirstTurnHint(true)
    // 不在 effect cleanup 里清定时器：开发模式 StrictMode 的二次挂载会立刻取消它
    window.setTimeout(() => setShowFirstTurnHint(false), 8000)
  }, [snapshot?.phase, snapshot?.round])

  const finishFirstTurnHint = useCallback(() => {
    setShowFirstTurnHint(false)
  }, [])

  useEffect(() => {
    if (!snapshot || snapshot.phase !== 'targeting' || snapshot.pendingShot !== 'player') return
    if (targetHintShownRef.current || hasSeenTargetHint()) return
    targetHintShownRef.current = true
    markTargetHintSeen()
    setShowTargetHint(true)
    // 同首回合提示：不清理定时器，避免 StrictMode 二次挂载立刻收掉；时长与 clue-line 动画对齐
    window.setTimeout(() => setShowTargetHint(false), 6000)
  }, [snapshot?.phase, snapshot?.pendingShot])

  const devBridge = useMemo(() => new DevBridge(game), [game])

  // 仅开发期道具动作验收入口：生产构建会被摇掉
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const host = window as unknown as { __itemActionDebug?: unknown }
    host.__itemActionDebug = {
      grant: (item: ItemId) => devBridge.grantItem(item),
      hp: (value: number) => devBridge.setPlayerHp(value),
      chamber: (value: 'live' | 'blank') => devBridge.forceChamber(value),
      budget: () => devBridge.resetItemBudget(),
      use: (item: ItemId) => game.useItem(item),
      status: () => sceneRef.current?.itemActionStatus() ?? null,
      skip: () => sceneRef.current?.skipItemAction() ?? false,
      cancel: () => sceneRef.current?.cancelItemAction(),
      seek: (t: number) => sceneRef.current?.seekItemAction(t) ?? null,
      hold: (v: boolean) => sceneRef.current?.holdItemAction(v),
      preview: (item: ItemId, actor: 'player' | 'boss' = 'player') => sceneRef.current?.previewItemAction(item, actor) ?? false,
      cards: () => sceneRef.current?.previewItemCards() ?? [],
      pick: (index: number) => sceneRef.current?.previewChooseCard(index) ?? false,
      probe: () => sceneRef.current?.previewItemProbe() ?? null,
      memory: () => sceneRef.current?.previewRenderMemory() ?? null,
      phase: () => game.getSnapshot().phase,
      items: () => [...game.getSnapshot().player.items],
      choose: (index: number) => {
        const card = game.getSnapshot().cardChoice?.cards[index]
        if (card) sceneRef.current?.chooseItemCard(card)
        return game.resolveCardChoice(index)
      },
      cancelChoice: () => game.cancelCardChoice(),
    }
    return () => { delete host.__itemActionDebug }
  }, [game, devBridge])

  // 姿态段落音效：枪响已由 shot 事件播过，这里只补落地/撑起/直身/落稳
  const handleBossPoseCue = useCallback(
    (cue: BossPoseCue) => {
      switch (cue) {
        case 'down':
          sound.playLowThump()
          sound.playChairCreak()
          break
        case 'brace':
          sound.playStitch()
          break
        case 'rise':
          sound.playBossBreath()
          break
        case 'settle':
          sound.playLowThump()
          break
        default:
          break
      }
    },
    [sound],
  )

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

  /** 右门存根牌：带存档时点它直接回到对应层，不再重走序章 */
  function resumeFromCorridor() {
    if (!checkpoint) return
    void sound.unlock()
    sound.setMasterVolume(muted ? 0 : volume)
    if (!sound.isAmbientPlaying) sound.startAmbient()
    void sound.startRoomTone(`${import.meta.env.BASE_URL}audio/room-tone.ogg`)
    setCorridorState('done')
    game.startAtLevel(checkpoint.levelIndex, checkpoint.carryOver, true)
  }

  /** 左门新开一局：旧存档立即作废，避免重载后还能从右门续旧进度 */
  function handleNewRun() {
    clearCheckpoint()
    setCheckpoint(null)
  }

  const pendingClueRef = useRef<readonly ClueLine[] | null>(null)
  const clueTimer = useRef<number | null>(null)
  const clueTimersRef = useRef<number[]>([])

  function clearClueTimers() {
    if (clueTimer.current !== null) window.clearTimeout(clueTimer.current)
    clueTimer.current = null
    for (const timer of clueTimersRef.current) window.clearTimeout(timer)
    clueTimersRef.current = []
  }

  function showClueLine(text: string, durationMs = 6000, channel: DialogueChannel = 'player') {
    setClueLine({ text, durationMs, channel })
    if (clueTimer.current !== null) window.clearTimeout(clueTimer.current)
    clueTimer.current = window.setTimeout(() => setClueLine(null), durationMs)
  }

  function showDialogueSequence(lines: readonly ClueLine[]) {
    clearClueTimers()
    let delay = 0
    for (const line of lines) {
      const timer = window.setTimeout(() => showClueLine(line.text, line.durationMs, line.channel), delay)
      clueTimersRef.current.push(timer)
      delay += line.durationMs
    }
  }

  useEffect(() => () => clearClueTimers(), [])

  function handleEventNarrative(event: GameEvent) {
    // 只在结果节点播报，不做每回合点数播报
    if (event.type === 'bust') {
      setSpokenLine(event.actor === 'player' ? '你爆牌了。' : '对手爆牌了。')
    } else if (event.type === 'tie') {
      setSpokenLine('双方同点，本轮不开枪，走火遗恨加一。')
    }
    if (event.type === 'checkpoint') {
      const next: StoredCheckpoint = {
        levelIndex: event.levelIndex,
        carryOver: [...event.carryOver],
        runRounds: event.runRounds,
      }
      writeCheckpoint(next)
      setCheckpoint(next)
      // 关卡间 2D 过场：只在首次进入第 2/3 层时播；读档已看过的层不重播。
      // 延一帧，让同 tick 的 reload 横幅先挂上，避免两层覆盖同时出现。
      const seen = readCutsceneSeen()
      if (event.levelIndex >= 1 && !seen.includes(event.levelIndex)) {
        markCutsceneSeen(event.levelIndex)
        const level = event.levelIndex
        window.setTimeout(() => beginCutscene(level), 0)
      }
      return
    }
    if (event.type === 'gameOver') {
      clearCheckpoint()
      setCheckpoint(null)
    }
    // directorRef 在 beginNarrative 里同步赋值；narrativeRef 要等一次渲染才同步。
    // 同一帧内「开叙事 + 来事件」时只看 narrativeRef 会误判成空闲
    const narrativeBusy = narrativeRef.current !== null || directorRef.current !== null
    // 胜利：3D endingB（缝线透光→伸手→黑屏）在前，播完接 2D「赎契」续篇；两段都不可跳过
    if (event.type === 'gameOver' && event.winner === 'player' && !narrativeBusy) {
      endingThenCutsceneRef.current = () => beginEnding('win')
      beginNarrative('endingB')
      return
    }
    // 失败：直接 2D「补针」，可跳过
    if (event.type === 'gameOver' && event.winner === 'boss' && !narrativeBusy) {
      beginEnding('lose')
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
      const lines: readonly ClueLine[] = [
        { text: '你妹妹血很凉，手却稳。她付了七袋，才走到下一张桌。', durationMs: 3600, channel: 'enemy' },
        { text: '她还活着？', durationMs: 1200, channel: 'player' },
        { text: '活着。她的账，还没清。', durationMs: 2200, channel: 'enemy' },
      ]
      if (narrativeBusy) pendingClueRef.current = lines
      else showDialogueSequence(lines)
    }
    // ch3 第一次 roundStart：刻痕名单扫镜再回桌面；延半拍让 GameCanvas 的 resetShot 先落
    if (event.level === 3 && event.round === 1) {
      const scene = sceneRef.current
      window.setTimeout(() => scene?.setShot('tally', 1.2), 150)
      window.setTimeout(() => scene?.setShot('table', 1.2), 2900)
      sound.playStitch()
      window.setTimeout(
        () => showDialogueSequence([
          { text: '名单末位是小棠。下面，留给你。', durationMs: 2600, channel: 'enemy' },
          { text: '她最会算牌。', durationMs: 1300, channel: 'player' },
          { text: '我现在，用她的记性算牌。', durationMs: 2400, channel: 'enemy' },
        ]),
        3000,
      )
    }
  }

  /** 入场 / restart 迷你入场 / 章节过渡：导演层接管，播完才把控制权交给引擎 */
  function beginNarrative(mode: NarrativeMode) {
    const scene = sceneRef.current
    if (!scene) return
    directorRef.current?.stop()
    narrativeModeRef.current = mode
    // 已看过的段落给跳过入口；首见仍完整播放
    setSkipAvailable(hasSeenNarrative(mode))
    const director = new NarrativeDirector({
      scene,
      sound,
      onVisual: setNarrative,
      onGameStart: () => {
        if (mode === 'intro') {
          clearCutsceneSeen()
          game.start()
        } else {
          // restart 是全新一局：过场去重集合随之清空，第二/三层重新播
          clearCutsceneSeen()
          game.restart()
        }
      },
      onFinish: () => {
        markNarrativeSeen(mode)
        setSkipAvailable(false)
        setNarrative(null)
        directorRef.current = null
        narrativeModeRef.current = null
        // 胜利结局：3D 段播完，接 2D 续篇（若本次是胜利分支）
        const cont = endingThenCutsceneRef.current
        endingThenCutsceneRef.current = null
        if (cont) window.setTimeout(cont, 0)
      },
    })
    directorRef.current = director
    director.start(mode)
  }

  function skipNarrative() {
    const director = directorRef.current
    const mode = narrativeModeRef.current
    if (!director || !mode) return
    markNarrativeSeen(mode)
    setSkipAvailable(false)
    director.skip()
  }

  // 2D 过场（关卡间/结局）与叙事导演层都会占满画面，HUD 与各种提示要一起让位
  const narrativeActive = narrative !== null || cutscene !== null

  // DEV 专用验证口：生产构建被 import.meta.env.DEV 摇掉，不随游戏发布
  if (import.meta.env.DEV) {
    ;(window as unknown as { __narrativeDebug?: unknown }).__narrativeDebug = {
      play: (mode: NarrativeMode) => beginNarrative(mode),
      scene: () => sceneRef.current,
      game,
    }
    ;(window as unknown as { __cutsceneDebug?: unknown }).__cutsceneDebug = {
      play: (levelIndex: number) => beginCutscene(levelIndex, true),
      playEnding: (id: EndingSpec['id']) => beginEnding(id),
      skip: () => skipCutscene(),
      active: () => cutsceneActiveRef.current,
      seek: (seconds: number) => {
        const director = cutsceneDirectorRef.current as
          | (Cutscene2D & { debugSeek?: (t: number) => void })
          | null
        director?.debugSeek?.(seconds)
      },
      clearSeen: () => clearCutsceneSeen(),
      seen: () => [...readCutsceneSeen()],
    }
  }

  function handleItemUse(actor: ActorId, item: ItemId) {
    if (actor !== 'player') {
      showNotice('那是它的东西。')
      return
    }
    if (!snapshot) return
    const shotWindow = snapshot.phase === 'targeting' && snapshot.pendingShot === 'player'
    if (snapshot.phase !== 'playerTurn' && !shotWindow) {
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
    if (snapshot.player.itemsUsedThisTurn >= PLAYER_ITEM_CAP) {
      showNotice('本回合的道具已经用尽。')
      return
    }
    game.useItem(item)
  }

  const phase = snapshot?.phase ?? 'idle'
  const started = snapshot?.started ?? false
  const playerTurn = phase === 'playerTurn'
  const locked = snapshot?.player.skipTurn ?? false
  const inputLocked = snapshot?.inputLocked ?? false
  const canAct = playerTurn && !locked && !inputLocked && !snapshot?.cardChoice
  const finished = phase === 'gameOver' || phase === 'victory'
  const level = snapshot?.level ?? (LEVELS[0] as (typeof LEVELS)[number])

  return (
    <main
      className="relative h-full w-full overflow-hidden bg-abyss-950"
      data-engine-phase={snapshot?.phase}
      data-input-locked={snapshot?.inputLocked}
      data-player-hp={snapshot?.player.hp}
      data-boss-hp={snapshot?.boss.hp}
      data-cylinder-remaining={snapshot?.cylinder.remaining}
    >
      <div className="absolute inset-0">
        {corridorState === 'done' ? (
          <GameCanvas
            engine={game}
            snapshot={sceneSnapshot}
            tableActionsAllowed={canAct && !snapshot?.paused && !narrativeActive && modal === null}
            supplyRevealAllowed={!narrativeActive}
            onTableAction={(action) => {
              const current = game.getSnapshot()
              if (current.phase !== 'playerTurn' || current.paused || current.inputLocked ||
                current.player.skipTurn || current.cardChoice || narrativeRef.current ||
                directorRef.current || modal !== null) return false
              finishFirstTurnHint()
              return action === 'hit' ? game.hit() : game.stand()
            }}
            onItemUse={handleItemUse}
            onItemCue={handleItemCue}
            onSupplyPick={(item) => game.chooseSupply(item)}
            onTargetPick={(target) => game.chooseTarget(target)}
            onHoverChange={setHover}
            onGunHoverChange={setGunHover}
            onBossPoseCue={handleBossPoseCue}
            onSceneReady={(scene) => {
              sceneRef.current = scene
              applyQuality(scene, quality)
              // 走廊黑场后 GameCanvas 重新挂载：SceneManager 就位即开始入场
              if (pendingIntroRef.current && corridorState === 'done') {
                pendingIntroRef.current = false
                beginNarrative('intro')
                return
              }
              // 开发模式 StrictMode 会重建 SceneManager；导演层必须改绑新场景，
              // 否则字幕继续走，setShot / setNarrativeGrade 却都落在已销毁的场景上
              if (narrativeModeRef.current) beginNarrative(narrativeModeRef.current)
            }}
            onLoadProgress={(progress) => setLoadProgress(progress)}
            onLoadError={() => setLoadFailed(true)}
          />
        ) : null}
        {corridorState !== 'done' ? (
          <CorridorIntro
            sound={sound}
            onStart={startGame}
            onIntroComplete={handleCorridorComplete}
            onNewRun={handleNewRun}
            resumeLevel={checkpoint && !started ? checkpoint.levelIndex + 1 : null}
            onResumeLevel={resumeFromCorridor}
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

      {/* 自己开枪：枪口在画面上缘外，用屏幕空间爆闪替代看不见的精灵 */}
      <div
        key={`muzzle-${muzzleFlash}`}
        className={`pointer-events-none absolute inset-0 ${muzzleFlash > 0 ? 'muzzle-burst' : 'opacity-0'}`}
      />

      {/* 自己中弹：先黑屏，再模糊睁眼；镜头等视野恢复后才移向血袋。 */}
      <div
        key={`blackout-${visionBlur}`}
        className={`pointer-events-none absolute inset-0 z-40 ${visionBlur > 0 ? 'vr-blackout' : 'opacity-0'}`}
      />
      <div
        key={`blur-${visionBlur}`}
        className={`pointer-events-none absolute inset-0 z-[41] ${visionBlur > 0 ? 'vr-blur' : 'opacity-0'}`}
      />
      <div
        key={`wake-${wakeBlur}`}
        className={`pointer-events-none absolute inset-0 z-[42] ${wakeBlur > 0 ? 'wake-blur' : 'opacity-0'}`}
      />

      {/* Minimal corner chrome. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4 transition-opacity duration-700 ${narrativeActive ? 'opacity-0' : 'opacity-100'}`}
      >
        <div className="flex items-center gap-3">
          <span className="h-[1px] w-8 bg-rust-500/50 max-[420px]:hidden" />
          <p className="text-[11px] tracking-[0.4em] text-bone-200/55 uppercase">
            Blood Ante · 第 {level.id} 层
          </p>
        </div>
        {snapshot && started ? (
          <p className="text-[11px] tracking-[0.28em] text-bone-200/45 uppercase">
            回合 {snapshot.round || 1} · {phaseLabel(phase)}
            {snapshot.deckRemaining !== null ? ` · 牌靴 ${snapshot.deckRemaining}` : ''}
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
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4"
        style={{ paddingBottom: 'max(1.25rem, var(--safe-bottom))' }}
      >
        {narrativeActive ? null : !started ? null : phase === 'targeting' ? (
          <div className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-4 focus-within:left-1/2 focus-within:-translate-x-1/2 focus-within:flex focus-within:gap-4 focus-within:bg-black focus-within:p-3">
            {snapshot?.pendingShot === 'player' ? (
              <>
                <button type="button" onClick={() => game.chooseTarget('boss')}>
                  射向它
                </button>
                <button type="button" onClick={() => game.chooseTarget('player')}>
                  射向自己
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2 text-[9px] tracking-[0.2em] text-bone-200/30 uppercase">
          <span>
            {phase === 'targeting'
              ? snapshot?.pendingShot === 'player'
                ? targetHint(snapshot)
                : ' ' 
              : locked && playerTurn
                ? '本回合被封锁'
                : ' '}
          </span>
        </div>
      </div>

      {/* Corner utilities: volume + codex.
          窄屏横排贴底避开桌沿按键；只有枪口选择阶段抬到操作栏上方，
          首回合提示显示期间先让位（提示条占同一条底边） */}
      <div
        className={`absolute right-4 bottom-4 flex flex-col items-end gap-2 transition-opacity duration-700 max-[420px]:right-3 max-[420px]:flex-row max-[420px]:items-center ${
          snapshot?.phase === 'targeting' && snapshot?.pendingShot === 'player'
            ? 'max-[420px]:bottom-[6.25rem]'
            : 'max-[420px]:bottom-4'
        } ${showFirstTurnHint ? 'corner-tools--defer' : ''} ${
          narrativeActive ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
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
          onClick={() => setLogOpen(true)}
          className="corner-chip"
        >
          战报
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

      {/* Supply pick: 候选道具摆在桌面左侧托盘里，点桌面上的道具即可带走。 */}
      {phase === 'supply' && snapshot ? (
        <div className="pointer-events-none absolute inset-x-0 top-[8%] z-30 flex justify-center px-4">
          <div className="flex flex-col items-center gap-1.5 border border-rust-500/30 bg-abyss-900/80 px-8 py-3 text-center shadow-lg shadow-black/60 backdrop-blur-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-[9px] tracking-[0.45em] text-rust-400/75 uppercase">before the next door</span>
              <span className="font-display text-lg text-bone-200">门前的补给</span>
              <span className="text-[11px] tracking-[0.1em] text-rust-300/75">
                {snapshot.paused ? '已暂停' : '挑好再开门'}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-bone-200/70">
              {snapshot.supplyOptions.map((item, index) => (
                <span key={item} className="flex items-center gap-1">
                  <span className="text-[9px] tracking-[0.2em] text-rust-400/60">{index + 1}</span>
                  <span className="font-display text-bone-200">{ITEM_CATALOG[item].name}</span>
                </span>
              ))}
            </div>
            <p className="text-[9px] tracking-[0.22em] text-bone-200/30 uppercase">
              点击桌上托盘里的道具 · 或按 1 / 2 / 3
            </p>
          </div>
        </div>
      ) : null}

      {/* Boss supply beat: 玩家选完后镜头切到它那侧的托盘，看它带走一件。 */}
      {phase === 'bossSupply' && snapshot ? (
        <div className="pointer-events-none absolute inset-x-0 top-[8%] z-30 flex justify-center px-4">
          <div className="flex flex-col items-center gap-1.5 border border-rust-500/25 bg-abyss-900/75 px-8 py-2.5 text-center shadow-lg shadow-black/60 backdrop-blur-sm">
            <div className="flex items-baseline gap-3">
              <span className="text-[9px] tracking-[0.45em] text-rust-400/70 uppercase">same table, one more hand</span>
              <span className="font-display text-base text-bone-200/90">它也伸手挑了一件</span>
            </div>
            <p className="text-[9px] tracking-[0.22em] text-bone-200/30 uppercase">
              它把补给收进斗篷 · 下一层的门就快开了
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

      {logOpen && snapshot ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="战报"
          onClick={() => setLogOpen(false)}
        >
          <div
            className="max-h-[82dvh] w-full max-w-xl overflow-y-auto border border-rust-500/30 bg-abyss-900/95 p-5 shadow-2xl shadow-black/80"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg text-bone-200">战报</h2>
              <button
                type="button"
                onClick={() => setLogOpen(false)}
                className="text-[10px] tracking-[0.3em] text-bone-200/45 uppercase hover:text-bone-200/80"
              >
                关闭 ESC
              </button>
            </div>
            <div className="mt-4 space-y-1.5">
              {snapshot.log.slice(-60).map((line, index) => (
                <p
                  key={index}
                  className="text-[12px] leading-relaxed text-bone-200/55 [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
                >
                  {narrativeLog(line, snapshot.levelIndex)}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-live">
        {spokenLine}
      </p>

      {/* 首层关键模型加载进度：程序化画面先跑，不黑屏 */}
      {corridorState === 'done' && loadProgress && loadProgress.loaded < loadProgress.total && !finished ? (
        <div className="pointer-events-none absolute inset-x-0 top-[12vh] z-20 flex justify-center">
          <p className="rounded-sm border border-white/8 bg-black/65 px-3 py-1.5 text-[10px] tracking-[0.25em] text-bone-200/55 uppercase">
            正在摆桌… {loadProgress.loaded}/{loadProgress.total}
          </p>
        </div>
      ) : null}
      {loadFailed ? (
        <div className="pointer-events-none absolute inset-x-0 top-[16vh] z-20 flex justify-center">
          <p className="rounded-sm border border-rust-500/30 bg-black/70 px-3 py-1.5 text-[10px] tracking-[0.15em] text-rust-300/70">
            部分模型未能加载，已使用占位几何
          </p>
        </div>
      ) : null}

      {/* Death / victory end screens. */}
      {paused && !finished ? (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-black/80 px-6 text-center backdrop-blur-sm">
          <p className="text-[9px] tracking-[0.5em] text-rust-400/70 uppercase">the table waits</p>
          <h2 className="font-display text-3xl text-bone-200/90">暂停</h2>
          <p className="max-w-xs text-[11px] leading-relaxed text-bone-200/40">
            {snapshot?.phase === 'supply' ? '补给计时已冻结，继续后按剩余时间走。' : '轮盘、子弹与呼吸都停在原处。'}
          </p>
          <div className="flex flex-col items-center gap-2">
            <MetalButton tone="primary" onClick={() => togglePause(false)}>
              继续
            </MetalButton>
            <label className="mt-1 flex items-center gap-2 text-[10px] tracking-[0.2em] text-bone-200/40 uppercase">
              画质
              <select
                value={quality}
                onChange={(event) => {
                  setQuality(event.target.value)
                  if (sceneRef.current) {
                    applyQuality(sceneRef.current, event.target.value)
                  }
                }}
                className="border border-white/10 bg-black/60 px-2 py-1 text-[10px] tracking-[0.15em] text-bone-200/75"
              >
                <option value="auto">自动</option>
                <option value="high">高</option>
                <option value="balanced">均衡</option>
                <option value="low">低</option>
              </select>
            </label>
            <MetalButton tone="ghost" onClick={() => setModal('rules')}>
              查看血契
            </MetalButton>
          </div>
        </div>
      ) : null}

      {finished && !narrativeActive ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 overflow-y-auto bg-black/78 px-6 py-8 text-center backdrop-blur-sm">
          {phase === 'victory' ? (
            <>
              <p className="text-[9px] tracking-[0.5em] text-rust-400/80 uppercase">debt paid in blood</p>
              <h2 className="font-display text-4xl text-bone-200">血契已赎</h2>
              <p className="max-w-md text-xs leading-relaxed text-bone-200/50">
                三层二十一袋血已清，缝线里的那声回响终于停了。你攥着半张染血的契纸、端着发烫的枪口走出地下室——可走廊尽头的灯，和另一扇铁门后的牌桌，依然亮着。
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
                  再次推开铁门
                </MetalButton>
                <MetalButton tone="ghost" onClick={() => setModal('rules')}>
                  查看血契
                </MetalButton>
              </div>
            </>
          ) : (
            <>
              <p className="text-[9px] tracking-[0.5em] text-rust-500/70 uppercase">stitched into the ledger</p>
              <h2 className="font-display text-4xl text-bone-200/90">补针完成</h2>
              <p className="max-w-md text-xs leading-relaxed text-bone-200/45">
                你的名字填上了「小棠」下方那道新鲜的空槽。血袋空了，针脚合上了，走廊尽头的灯还在等下一位签契的人。
              </p>
              <dl className="grid grid-cols-3 gap-6 text-[10px] text-bone-200/45">
                <div>
                  <dt className="text-bone-200/25">倒下于</dt>
                  <dd className="mt-1 font-display text-base text-bone-200/80">
                    第 {(snapshot?.levelIndex ?? 0) + 1} 层 · {levelTitle(snapshot?.levelIndex ?? 0)}
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
                  <dd className="mt-1 font-display text-base text-bone-200/80">
                    {bossName(snapshot?.levelIndex ?? 0)}
                  </dd>
                </div>
              </dl>
              <div className="mt-2 flex gap-3">
                <MetalButton tone="primary" onClick={() => beginNarrative('restart')}>
                  重新坐上牌桌
                </MetalButton>
                <MetalButton
                  tone="secondary"
                  onClick={() => {
                    // 死亡后从本层重来 = 重走这一层，过场重播；只有读档（继续第 N 层）才跳过
                    const seen = readCutsceneSeen().filter((v) => v !== (snapshot?.levelIndex ?? 0))
                    try {
                      window.localStorage.setItem(CUTSCENE_SEEN_KEY, JSON.stringify({ v: 1, seen }))
                    } catch {
                      // 写不进去最多是少播一次，不阻塞重来
                    }
                    if (game.retryLevel()) setCorridorState('done')
                  }}
                >
                  从第 {(snapshot?.levelIndex ?? 0) + 1} 层重来
                </MetalButton>
                <MetalButton tone="ghost" onClick={() => setModal('rules')}>
                  查看血契
                </MetalButton>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* 提示条贴底，落在桌沿按键下方，不遮挡实体键 */}
      {showFirstTurnHint && snapshot && !narrativeActive ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3"
        >
          <p className="rounded-sm border border-rust-500/35 bg-black/90 px-3 py-1.5 text-center text-[10px] leading-relaxed tracking-[0.08em] text-bone-200/80 shadow-lg shadow-black/60">
            你 {snapshot.player.visibleHand.total} 点 · 明牌{' '}
            {snapshot.boss.visibleHand.visible.filter((card): card is Card => card !== null).reduce(
              (sum, card) => sum + (card.rank === 1 ? 11 : card.rank),
              0,
            )}{' '}
            点 · 点桌沿键或按 H / S
          </p>
        </div>
      ) : null}

      {showTargetHint && !showFirstTurnHint && snapshot && !narrativeActive ? (
        <div className="pointer-events-none absolute inset-0 z-20 -translate-y-10 flex items-center justify-center px-6">
          <p className="clue-line narrative-subtitle max-w-2xl text-center font-display text-[15px] leading-relaxed tracking-[0.18em] text-bone-100/90">
            点枪拿起裁决权，再点任一方的血袋扣下扳机
          </p>
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
          <div
            ref={guideRef}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto border border-rust-500/35 bg-abyss-900/95 p-6 shadow-2xl shadow-black/80"
          >
            <p className="text-[9px] tracking-[0.45em] text-rust-400/75 uppercase">
              blood ante · 血契须知
            </p>
            <h2 className="mt-2 font-display text-2xl text-bone-200">三句话，签下这张牌桌</h2>
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
                查看完整血契
              </button>
              <MetalButton
                tone="primary"
                onClick={() => {
                  markGuideSeen()
                  setGuideOpen(false)
                }}
              >
                知道了
              </MetalButton>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? <RulesModal initialTab={modal} onClose={() => setModal(null)} /> : null}

      {snapshot?.cardChoice && !narrativeActive ? (
        <div className="absolute inset-x-0 bottom-28 z-30 flex justify-center px-4">
          <div className="max-w-lg rounded-sm border border-rust-500/40 bg-abyss-900/95 p-3 shadow-2xl shadow-black/70">
            <p className="text-center text-[11px] tracking-[0.15em] text-rust-300/75">
              {snapshot.cardChoice.kind === 'cutter' ? '选择要裁掉的一张牌' : '选择要封住的明牌'}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              {snapshot.cardChoice.cards.map((card, index) => (
                <button
                  key={`${card.id}-${index}`}
                  type="button"
                  onClick={() => {
                    sceneRef.current?.chooseItemCard(card)
                    game.resolveCardChoice(index)
                  }}
                  className="min-w-12 border border-white/12 bg-black/40 px-2 py-1.5 font-display text-sm text-bone-200/85 transition-colors hover:border-rust-500/60 hover:bg-rust-500/15"
                >
                  {formatCardLabel(card)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  sceneRef.current?.cancelItemChoice()
                  game.cancelCardChoice()
                }}
                className="px-2 py-1.5 text-[10px] tracking-[0.2em] text-bone-200/35 uppercase hover:text-bone-200/70"
              >
                放弃
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {clueLine && !narrativeActive ? (
        clueLine.channel === 'enemy' ? (
          <EnemyDialogueBox
            getAnchor={() => sceneRef.current?.getBossDialogueAnchor() ?? { x: 0.5, y: 0.35, visible: false }}
          >
            <p
              className="clue-line narrative-subtitle font-display text-sm leading-relaxed tracking-[0.12em] text-red-50/90"
              style={{ animationDuration: `${clueLine.durationMs}ms` }}
            >
              {clueLine.text}
            </p>
          </EnemyDialogueBox>
        ) : (
          // 窄屏首回合：剧情行会横穿桌沿按键，让位给首次操作提示
          <div
            data-testid="bottom-dialogue"
            className={`pointer-events-none absolute inset-x-0 bottom-[16vh] z-20 flex justify-center px-6 ${showFirstTurnHint ? 'max-[420px]:opacity-0' : ''}`}
          >
            <p
              className={`clue-line narrative-subtitle max-w-xl text-center font-display text-base tracking-[0.18em] ${
                clueLine.channel === 'sister' ? 'sister-dialogue text-amber-100/95' : 'text-bone-200/85'
              }`}
              style={{ animationDuration: `${clueLine.durationMs}ms` }}
            >
              {clueLine.text}
            </p>
          </div>
        )
      ) : null}

      {cutscene ? (
        <CutsceneOverlay
          spec={cutscene}
          sound={sound}
          mode={cutsceneKind}
          skippable={cutsceneKind === 'ending' ? (cutscene as EndingSpec).skippable : true}
          onResumeEngine={cutsceneKind === 'transition' ? resumeEngineAfterCutscene : undefined}
          onFinish={finishCutscene}
          onDirector={(director) => {
            cutsceneDirectorRef.current = director
          }}
        />
      ) : null}

      {narrative && directorRef.current ? (
        <NarrativeOverlay
          director={directorRef.current}
          sound={sound}
          visual={narrative}
          canSkip={skipAvailable}
          onSkip={skipNarrative}
        />
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
      <GunTooltip payload={narrativeActive ? null : gunHover} />
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
        <span className="text-[11px] tracking-[0.25em] text-bone-200/60 uppercase">{label}</span>
      </div>
      <p className="mt-1 flex items-center gap-2 text-[11px] tracking-[0.12em] text-bone-200/50">
        <span>
          {shown.busted ? '爆牌' : actor.standing ? '已停牌' : '在局中'} · 道具 {actor.items.length}
          {actor.id === 'player' ? ` · 用 ${actor.itemsUsedThisTurn}/${PLAYER_ITEM_CAP}` : ''}
        </span>
        {actor.sawBoost > 0 ? <span className="text-amber-300/80">锯</span> : null}
        {actor.shield > 0 ? <span className="text-sky-300/80">盾</span> : null}
        {actor.iou > 0 ? <span className="text-rose-300/80">债</span> : null}
      </p>
    </div>
  )
}

function LogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const lines = snapshot.log.slice(-3).map((line) => narrativeLog(line, snapshot.levelIndex))
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-36 right-4 w-64 space-y-1 text-right max-[420px]:w-40">
      {lines.map((line, index) => (
        <p
          key={index}
          className={`line-clamp-2 text-[12px] leading-relaxed [text-shadow:0_1px_3px_rgba(0,0,0,0.9)] ${
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
    case 'bossSupply':
      return '它挑补给'
    case 'gameOver':
      return '血契已收'
    case 'victory':
      return '赎契成功'
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
