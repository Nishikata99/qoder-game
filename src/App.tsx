import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoundEngine } from './audio/SoundEngine'
import { GameCanvas, ItemTooltip } from './components/GameCanvas'
import { RulesModal, type ModalTab } from './components/RulesModal'
import type { ItemHoverPayload } from './scene/SceneManager'
import type { ActorId, ActorView, Card, GameEvent, GameSnapshot, ItemId } from './game/GameEngine'
import {
  GameEngine,
  ITEM_CATALOG,
  LEVELS,
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

export default function App() {
  const [sound] = useState(() => new SoundEngine())
  const [game] = useState(() => new GameEngine({ dealDelayMs: 340, thinkDelayMs: 800 }))
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [hover, setHover] = useState<ItemHoverPayload | null>(null)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0.85)
  const [modal, setModal] = useState<ModalTab | null>(null)
  const [relay, setRelay] = useState<RelayBanner | null>(null)
  const [loot, setLoot] = useState<LootBanner | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bloodFlash, setBloodFlash] = useState(0)
  const noticeTimer = useRef<number | null>(null)
  const relayTimer = useRef<number | null>(null)
  const lootTimer = useRef<number | null>(null)
  const bloodTimer = useRef<number | null>(null)
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
            sound.playGunshot()
            setBloodFlash((n) => n + 1)
            if (bloodTimer.current !== null) window.clearTimeout(bloodTimer.current)
            bloodTimer.current = window.setTimeout(() => setBloodFlash(0), 900)
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
          sound.playItemUse()
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

  useEffect(() => {
    return game.subscribe((event, snap) => {
      setSnapshot(snap)
      if (event.type !== 'state') soundHandlerRef.current(event)
    })
  }, [game])

  useEffect(() => {
    sound.setMasterVolume(muted ? 0 : volume)
  }, [muted, volume, sound])

  useEffect(() => () => sound.dispose(), [sound])

  const hpRatio =
    snapshot && snapshot.player.maxHp > 0 ? snapshot.player.hp / snapshot.player.maxHp : 1
  const alive = (snapshot?.player.hp ?? 0) > 0
  const bpm = Math.round(64 + (1 - hpRatio) * 66)
  useEffect(() => {
    if (!alive) return
    const id = window.setInterval(() => sound.playHeartbeat(bpm), 1250)
    return () => window.clearInterval(id)
  }, [alive, bpm, sound])

  const unlocked = useMemo(
    () => new Set<ItemId>(snapshot?.unlockedItems ?? []),
    [snapshot?.unlockedItems],
  )

  async function startGame() {
    await sound.unlock()
    sound.setMasterVolume(muted ? 0 : volume)
    if (!sound.isAmbientPlaying) sound.startAmbient()
    game.start()
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
        <GameCanvas
          engine={game}
          snapshot={snapshot}
          onItemUse={handleItemUse}
          onHoverChange={setHover}
        />
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

      {/* Minimal corner chrome. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="flex items-center gap-3">
          <span className="h-[1px] w-8 bg-rust-500/50" />
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

      {/* Hand totals: blackjack needs the numbers on screen, not mental arithmetic. */}
      {snapshot && started ? (
        <>
          <ActorPanel className="top-14 left-4" label="你" actor={snapshot.player} accent />
          <ActorPanel className="top-14 right-4" label="它" actor={snapshot.boss} />
          <LogPanel snapshot={snapshot} />
          <CylinderPanel snapshot={snapshot} />
        </>
      ) : null}

      {/* Bottom control rail. */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-5">
        {!started ? (
          <MetalButton tone="primary" onClick={() => void startGame()}>
            坐下，开始交易
          </MetalButton>
        ) : phase === 'targeting' ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[9px] tracking-[0.4em] text-rust-400/80 uppercase">
              {snapshot?.pendingShot === 'player' ? '这一轮你赢了 · 选择枪口' : '它在决定枪口'}
            </p>
            {snapshot?.pendingShot === 'player' ? (
              <div className="flex items-center gap-3">
                <MetalButton tone="primary" onClick={() => game.chooseTarget('boss')}>
                  射向它 <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45">FIRE</span>
                </MetalButton>
                <MetalButton
                  tone="secondary"
                  onClick={() => game.chooseTarget('player')}
                  hint="对自己开枪：空膛可摸一件道具，实弹则你自己受伤"
                >
                  射向自己 <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45">RISK</span>
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
              要牌 <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45">HIT</span>
            </MetalButton>
            <MetalButton tone="secondary" disabled={!canAct} onClick={() => game.stand()}>
              停牌 <span className="ml-1 text-[8px] tracking-[0.3em] opacity-45">STAND</span>
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

      {/* Corner utilities: volume + codex. */}
      <div className="absolute right-4 bottom-4 flex flex-col items-end gap-2">
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
          className="volume-slider w-24"
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

      {/* Execution flavour line. */}
      {phase === 'execution' ? (
        <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center">
          <p className="execution-pulse text-[10px] tracking-[0.44em] text-rust-400/70 uppercase">
            屏住呼吸
          </p>
        </div>
      ) : null}

      {/* Death / victory end screens. */}
      {finished ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-black/78 px-6 text-center backdrop-blur-sm">
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
                <MetalButton tone="primary" onClick={() => game.restart()}>
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
                <MetalButton tone="primary" onClick={() => game.restart()}>
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

      {modal ? <RulesModal initialTab={modal} onClose={() => setModal(null)} /> : null}

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
  const hidden = actor.visibleHand.visible.some((card) => card === null)
  return (
    <div
      className={`pointer-events-none absolute w-36 border bg-black/50 px-3 py-2 backdrop-blur-sm ${
        accent ? 'border-rust-500/35' : 'border-white/8'
      } ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] tracking-[0.3em] text-bone-200/40 uppercase">{label}</span>
        <span className="flex gap-1">
          {Array.from({ length: actor.maxHp }, (_, index) => (
            <span
              key={index}
              className={`h-1 w-3 ${
                index < actor.hp ? (accent ? 'bg-rust-400/90' : 'bg-bone-200/55') : 'bg-white/10'
              }`}
            />
          ))}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-display text-2xl leading-none text-bone-200">{shown.total}</span>
        {hidden ? <span className="text-sm text-bone-200/35">+ ?</span> : null}
        {shown.soft ? (
          <span className="text-[9px] tracking-[0.2em] text-sky-300/70">软</span>
        ) : null}
        {shown.blackjack ? (
          <span className="text-[9px] tracking-[0.2em] text-rust-400">BJ</span>
        ) : null}
        <span className="text-[9px] tracking-[0.2em] text-bone-200/30">点</span>
      </div>
      <p className="mt-1 flex items-center gap-2 text-[9px] tracking-[0.15em] text-bone-200/30">
        <span>
          {shown.busted ? '爆牌' : actor.standing ? '已停牌' : '在局中'} · 道具 {actor.items.length}
        </span>
        {actor.sawBoost > 0 ? <span className="text-amber-300/80">锯</span> : null}
      </p>
    </div>
  )
}

function LogPanel({ snapshot }: { snapshot: GameSnapshot }) {
  const lines = snapshot.log.slice(-3)
  if (lines.length === 0) return null
  return (
    <div className="pointer-events-none absolute top-36 right-4 w-64 space-y-1 text-right">
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
  return (
    <div className="pointer-events-none absolute bottom-24 left-4 w-40 border border-white/8 bg-black/50 px-3 py-2 backdrop-blur-sm">
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
