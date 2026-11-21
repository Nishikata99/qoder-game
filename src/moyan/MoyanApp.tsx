import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  ITEM_DESC,
  ITEM_ICON,
  ITEM_NAMES,
  ORGAN_DESC,
  ORGAN_NAMES,
  ORGAN_SHORT,
  ORGANS,
  PENALTY_ITEMS,
  type ItemId,
  type Organ,
  type Side,
} from './content'
import {
  MoyanEngine,
  type Cell,
  type PlayerView,
  type Snapshot,
} from './engine'
import { MoyanScene, type SlotHover, type TileHover } from './scene'
import { CardFlipSound } from './flipSound'
import { iconUrl } from './icons'
import './moyan.css'

interface Tip {
  readonly title: string
  readonly body: string
  readonly x: number
  readonly y: number
}

const CELL_ITEMS: readonly ItemId[] = ['stethoscope', 'transplant']

function pendingItem(s: Snapshot): ItemId | null {
  if (!s.pending) return null
  return CELL_ITEMS.includes(s.pending.kind as ItemId) ? (s.pending.kind as ItemId) : null
}

function hintOf(s: Snapshot): string {
  if (s.over) return s.winner === 'player' ? '心脏落定，你还活着。' : '毒已经扩散到尽头。'
  if (s.pending?.kind === 'replace') return '背包已满：选择要替换掉的道具，或放弃新道具。'
  if (s.pending?.kind === 'steal') return '手术钳：选择要从 AI 背包夹走的道具。'
  if (s.pending?.kind === 'liver') return '肝触发：点击自己半场的一格导电毒，把它变回未翻牌（必须选择）。'
  if (s.pending?.kind === 'transplant') {
    return s.pending.from
      ? '注射器：点击对方半场一张挨着导电毒的未翻牌（心脏若已挨毒可直接斩心）。'
      : '注射器：先后点击自己半场的一格毒。'
  }
  if (s.pending?.kind === 'stethoscope') return '听诊器：点击一张未翻牌，牌面只有你能看到。'
  if (s.repair) {
    return s.repair.some((target) => target.organ === 'kidney')
      ? '肾的修复机会：点击左侧发光的器官，修好坏死墙并恢复功能；肾自己也可以修。'
      : '肾的修复机会：点击左侧发光的器官，修好它的坏死墙、清掉周围一圈毒，并恢复该器官功能。'
  }
  if (s.turn === 'ai') return s.peekViewer === 'ai' ? 'AI 正在用听诊器窥视你的牌。' : 'AI 正在行动……'
  if (s.players.player.weakenedThisTurn) return '虚弱中：本回合不能使用道具，只能翻牌。'
  if (s.flipsRemaining > 1) return `肾上腺素：本回合还需翻 ${s.flipsRemaining} 张。`
  if (s.transplantUsedThisTurn) return '本回合已经用过注射器。点击发绿光的格子翻牌。'
  return '点击发绿光的格子翻牌；先用道具可以改变局势。'
}

function peekFace(cell: Cell): { title: string; sub: string; art: string; penalty: boolean } {
  if (cell.type === 'heart') {
    return { title: '心脏', sub: '翻开即输。', art: iconUrl('heart'), penalty: true }
  }
  if (cell.type === 'organ' && cell.organ) {
    return {
      title: `器官 · ${ORGAN_NAMES[cell.organ]}`,
      sub: ORGAN_DESC[cell.organ],
      art: iconUrl(cell.organ),
      penalty: false,
    }
  }
  if (cell.type === 'item' && cell.item) {
    return {
      title: `${PENALTY_ITEMS.includes(cell.item) ? '惩罚' : '道具'} · ${ITEM_NAMES[cell.item]}`,
      sub: ITEM_DESC[cell.item],
      art: iconUrl(ITEM_ICON[cell.item]),
      penalty: PENALTY_ITEMS.includes(cell.item),
    }
  }
  return { title: '普通毒液', sub: '没有额外效果。', art: iconUrl('venom'), penalty: false }
}

function cellTip(cell: Cell, halfTurn: number): { title: string; body: string } {
  // 心脏格从不翻牌，必须先判类型，否则永远落到“未翻牌”分支
  if (cell.type === 'heart') return { title: '心脏', body: '翻开即输。' }
  if (!cell.revealed) return { title: '未翻牌', body: '毒液覆盖，内容未知。' }
  if (cell.cleared) return { title: '已清除', body: '毒液已被清除，这里不会继续向外蔓延。' }
  if (cell.wallUntil > halfTurn) {
    const rounds = Math.ceil((cell.wallUntil - halfTurn) / 2)
    return {
      title: '坏死墙',
      body: `还剩 ${rounds} 回合：毒液不能穿过，注射器也无法选中。`,
    }
  }
  if (cell.type === 'source') return { title: '毒源', body: '毒液从这里持续向四周蔓延。' }
  if (cell.type === 'organ' && cell.organ) {
    return { title: `器官 · ${ORGAN_NAMES[cell.organ]}`, body: ORGAN_DESC[cell.organ] }
  }
  if (cell.type === 'item' && cell.item) {
    return {
      title: `${PENALTY_ITEMS.includes(cell.item) ? '惩罚' : '道具'} · ${ITEM_NAMES[cell.item]}`,
      body: ITEM_DESC[cell.item],
    }
  }
  return { title: '毒液', body: '毒液已经蔓延到这里，与它相邻的未翻牌可以被翻开。' }
}

function organCellOf(s: Snapshot, side: Side, organ: Organ): Cell | null {
  for (const row of s.board) {
    for (const cell of row) {
      if (cell.type !== 'organ' || cell.organ !== organ) continue
      const owner: Side | null = cell.r <= 2 ? 'ai' : cell.r >= 4 ? 'player' : null
      if (owner === side) return cell
    }
  }
  return null
}

function wallRoundsOf(cell: Cell | null, halfTurn: number): number | null {
  if (!cell || !cell.revealed || cell.cleared || cell.wallUntil <= halfTurn) return null
  return Math.ceil((cell.wallUntil - halfTurn) / 2)
}

function OrganCard({
  side,
  organ,
  view,
  wall,
  repair,
  onRepair,
  onTip,
}: {
  side: Side
  organ: Organ
  view: PlayerView
  wall: number | null
  repair: { readonly ring: number } | null
  onRepair?: () => void
  onTip: (tip: Tip | null) => void
}): JSX.Element {
  const alive = view.organs[organ]
  const extra =
    organ === 'lung' ? `×${view.lungLeft}` : organ === 'stomach' && !alive ? '上限 1' : ''
  const body = `${ORGAN_DESC[organ]}${alive ? '' : ' 这个器官已经失去。'}${
    organ === 'lung' ? ` 剩余 ${view.lungLeft} 次。` : ''
  }${wall !== null ? ` 坏死还剩 ${wall} 回合，期间不能被注射器选中。` : ''}${
    repair ? ` 点击修复：清除坏死墙，清掉周围 ${repair.ring} 格毒，并恢复这个器官的功能。` : ''
  }`
  return (
    <div
      className={`organ${alive ? '' : ' dead'}${side === 'ai' ? ' ai-organ' : ''}${
        repair ? ' repairable' : ''
      }`}
      role={repair ? 'button' : undefined}
      onClick={repair ? onRepair : undefined}
      onMouseEnter={(event) =>
        onTip({ title: ORGAN_NAMES[organ], body, x: event.clientX, y: event.clientY })
      }
      onMouseMove={(event) => onTip({ title: ORGAN_NAMES[organ], body, x: event.clientX, y: event.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <div className="organ-top">
        <span className="organ-name">
          <img className="px organ-icon" src={iconUrl(organ)} alt="" />
          {ORGAN_NAMES[organ]}
        </span>
        <small>{repair ? '点击修复' : wall !== null ? `坏死 ${wall} 轮` : extra}</small>
      </div>
      <em>
        {repair
          ? `清除坏死墙 + 周围 ${repair.ring} 格毒，恢复功能`
          : wall !== null
            ? '坏死中：注射器无法选中'
            : organ === 'stomach' && !alive
              ? '道具上限 1'
              : ORGAN_SHORT[organ]}
      </em>
    </div>
  )
}

function ItemIcon({ item }: { item: ItemId }): JSX.Element {
  return <img className="px item-icon" src={iconUrl(ITEM_ICON[item])} alt="" />
}

export default function MoyanApp(): JSX.Element {
  const engineRef = useRef<MoyanEngine | null>(null)
  const sceneRef = useRef<MoyanScene | null>(null)
  const mountRef = useRef<HTMLDivElement | null>(null)
  const [flipSound] = useState(() => new CardFlipSound())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const logRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<{ r: number; c: number } | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const engine = new MoyanEngine()
    engineRef.current = engine
    const scene = new MoyanScene(mount, {
      onFlipStart: (flipTime) => flipSound.play(flipTime),
      onCleanse: () => flipSound.playCleanse(),
      onTileClick: (r, c) => engine.cellClicked(r, c),
      onTileHover: (h: TileHover | null) => {
        const next = h ? { r: h.r, c: h.c } : null
        const prev = hoverRef.current
        if ((prev?.r ?? -1) !== (next?.r ?? -1) || (prev?.c ?? -1) !== (next?.c ?? -1)) {
          hoverRef.current = next
          setHover(next)
        }
        if (!h) {
          setTip(null)
          return
        }
        const cell = engine.getSnapshot().board[h.r]?.[h.c]
        if (!cell) return
        setTip({ ...cellTip(cell, engine.getSnapshot().halfTurn), x: h.clientX, y: h.clientY })
      },
      onSlotClick: (side, index) => {
        if (side !== 'player') return
        const item = engine.getSnapshot().players.player.items[index]
        if (item) engine.startItem(item)
      },
      onSlotHover: (h: SlotHover | null) => {
        if (!h || h.side !== 'player') {
          setTip(null)
          return
        }
        const item = engine.getSnapshot().players.player.items[h.index]
        if (!item) {
          setTip(null)
          return
        }
        setTip({ title: ITEM_NAMES[item], body: ITEM_DESC[item], x: h.clientX, y: h.clientY })
      },
    })
    sceneRef.current = scene
    engine.setIdleProbe(() => scene.idleSeconds())
    const unsubscribe = engine.subscribe((s) => {
      setSnapshot(s)
      scene.setSnapshot(s)
    })
    return () => {
      unsubscribe()
      engine.setIdleProbe(null)
      scene.dispose()
      sceneRef.current = null
      engineRef.current = null
    }
  }, [flipSound])

  useEffect(() => {
    flipSound.preload()
    const unlock = (): void => flipSound.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      flipSound.dispose()
    }
  }, [flipSound])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setTip(null)
      setRulesOpen(false)
      engineRef.current?.cancelPending()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snapshot?.log.length])

  const showTip = useCallback((next: Tip | null) => setTip(next), [])

  const s = snapshot
  if (!s) {
    return (
      <div className="moyan-app">
        <div className="moyan-view" ref={mountRef} />
        <div className="moyan-loading">毒液渗开中……</div>
      </div>
    )
  }

  const player = s.players.player
  const ai = s.players.ai
  const active = pendingItem(s)
  const peekCell = s.peek ? s.board[s.peek.r]?.[s.peek.c] : null
  const peek = peekCell && s.peekViewer === 'player' ? peekFace(peekCell) : null
  const lungDisabled =
    s.turn !== 'player' ||
    s.over ||
    s.locked ||
    s.pending !== null ||
    s.flipsRemaining > 1 ||
    !player.organs.lung ||
    player.lungLeft <= 0

  return (
    <div className="moyan-app">
      <div className="moyan-view" ref={mountRef} />

      <header className="moyan-head">
        <div className="brand">
          <b>蔓延</b>
          <span>SPREAD · 7×7</span>
        </div>
        <div className={`turn-pill ${s.over ? 'over' : s.turn}`}>
          {s.over ? (s.winner === 'player' ? '你赢了' : '你输了') : s.turn === 'player' ? '你的回合' : 'AI 回合'}
        </div>
        <div className="head-actions">
          <button className="ghost" onClick={() => setRulesOpen(true)}>
            规则
          </button>
          <button className="ghost" onClick={() => engineRef.current?.restart()}>
            重开
          </button>
          <button className="ghost" onClick={() => window.location.assign(`${import.meta.env.BASE_URL}`)}>
            返回走廊
          </button>
        </div>
      </header>

      <aside className="side left">
        <section className="block">
          <div className="block-title">
            <span>你 · 器官</span>
            <small>{player.weakenedThisTurn ? '虚弱' : ''}</small>
          </div>
          <div className="organ-grid">
            {ORGANS.map((organ) => {
              const cell = organCellOf(s, 'player', organ)
              const repair = s.repair?.find((target) => target.organ === organ) ?? null
              return (
                <OrganCard
                  key={organ}
                  side="player"
                  organ={organ}
                  view={player}
                  wall={wallRoundsOf(cell, s.halfTurn)}
                  repair={repair}
                  onRepair={repair ? () => engineRef.current?.repairKidney(repair.r, repair.c) : undefined}
                  onTip={showTip}
                />
              )
            })}
          </div>
        </section>

        <section className="block grow">
          <div className="block-title">
            <span>背包</span>
            <small>
              {player.items.length}/{player.itemCap}
            </small>
          </div>
          <div className="item-list">
            {player.items.length === 0 && <div className="empty">空</div>}
            {player.items.map((item, index) => {
              const used = item === 'transplant' && s.transplantUsedThisTurn
              const selected = active === item
              return (
                <button
                  key={`${item}-${index}`}
                  className={`item-btn${selected ? ' selected' : ''}${PENALTY_ITEMS.includes(item) ? ' penalty' : ''}`}
                  disabled={!s.canPickItem || used}
                  onMouseEnter={(event) =>
                    showTip({
                      title: ITEM_NAMES[item],
                      body: `${ITEM_DESC[item]}${used ? ' 本回合已使用过。' : ''}`,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseMove={(event) =>
                    showTip({
                      title: ITEM_NAMES[item],
                      body: `${ITEM_DESC[item]}${used ? ' 本回合已使用过。' : ''}`,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }
                  onMouseLeave={() => showTip(null)}
                  onClick={() => engineRef.current?.startItem(item)}
                >
                  <ItemIcon item={item} />
                  <b>{ITEM_NAMES[item]}</b>
                  <span>{used ? '本回合已使用' : selected ? '已选中，再点取消' : ITEM_DESC[item]}</span>
                </button>
              )
            })}
          </div>
          <button className="wide" disabled={lungDisabled} onClick={() => engineRef.current?.lung()}>
            {player.organs.lung ? `屏息（剩 ${player.lungLeft} 次）` : '屏息（肺已失去）'}
          </button>
        </section>
      </aside>

      <div className="center-bottom">
        <div className="hint">{hintOf(s)}</div>
        <div className="hint-sub">
          <span>第 {Math.floor(s.halfTurn / 2) + 1} 手</span>
          <span>·</span>
          <span>毒源已蔓延 {s.halfTurn} 次</span>
          {active && <button className="link" onClick={() => engineRef.current?.cancelPending()}>取消道具</button>}
          {s.repair && (
            <button className="link" onClick={() => engineRef.current?.skipKidneyRepair()}>
              放弃肾修复
            </button>
          )}
        </div>
      </div>

      <aside className="side right">
        <section className="block">
          <div className="block-title">
            <span>AI · 器官</span>
            <small>{ai.weakenedThisTurn ? '虚弱' : ''}</small>
          </div>
          <div className="organ-grid">
            {ORGANS.map((organ) => (
              <OrganCard
                key={organ}
                side="ai"
                organ={organ}
                view={ai}
                wall={wallRoundsOf(organCellOf(s, 'ai', organ), s.halfTurn)}
                repair={null}
                onTip={showTip}
              />
            ))}
          </div>
        </section>

        <section className="block">
          <div className="block-title">
            <span>AI 背包</span>
            <small>
              {ai.items.length}/{ai.itemCap}
            </small>
          </div>
          <div className="ai-items">
            {ai.items.length === 0 && <div className="empty">空</div>}
            {ai.items.map((item, index) => (
              <div
                key={`${item}-${index}`}
                className={`item-pill${PENALTY_ITEMS.includes(item) ? ' penalty' : ''}`}
                onMouseEnter={(event) =>
                  showTip({
                    title: ITEM_NAMES[item],
                    body: ITEM_DESC[item],
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseMove={(event) =>
                  showTip({
                    title: ITEM_NAMES[item],
                    body: ITEM_DESC[item],
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
                onMouseLeave={() => showTip(null)}
              >
                <ItemIcon item={item} />
                {ITEM_NAMES[item]}
              </div>
            ))}
          </div>
        </section>

        <section className="block grow log-block">
          <div className="block-title">
            <span>战报</span>
            <small>{s.log.length}</small>
          </div>
          <div className="log" ref={logRef}>
            {s.log.map((line, index) => (
              <p key={index} className={line.kind ?? undefined}>
                {line.text}
              </p>
            ))}
          </div>
        </section>
      </aside>

      {peek && (
        <div className={`peek-window${peek.penalty ? ' penalty' : ''}`}>
          <img className="px peek-icon" src={peek.art} alt="" />
          <div className="peek-title">{peek.title}</div>
          <div className="peek-sub">{peek.sub}</div>
          <div className="peek-caption">只有你能看到</div>
        </div>
      )}

      {hover && (
        <div className="cell-coord">
          {`${String.fromCharCode(65 + hover.c)}${hover.r + 1}`}
        </div>
      )}

      {tip && (
        <div
          className="tip"
          style={{
            left: Math.max(8, Math.min(tip.x + 14, window.innerWidth - 278)),
            top: Math.max(8, Math.min(tip.y + 16, window.innerHeight - 130)),
          }}
        >
          <b>{tip.title}</b>
          <span>{tip.body}</span>
        </div>
      )}

      {s.pending?.kind === 'replace' && s.pending.newItem && (
        <div className="overlay">
          <div className="modal">
            <h2>背包已满</h2>
            <p className="modal-desc">
              获得「{ITEM_NAMES[s.pending.newItem]}」，选择要替换掉的道具。
            </p>
            <div className="modal-items">
              {player.items.map((item, index) => (
                <button key={`${item}-${index}`} className="item-btn" onClick={() => engineRef.current?.resolveReplace(index)}>
                  <ItemIcon item={item} />
                  <b>{ITEM_NAMES[item]}</b>
                  <span>{ITEM_DESC[item]}</span>
                </button>
              ))}
            </div>
            <button className="ghost wide" onClick={() => engineRef.current?.resolveReplace(null)}>
              放弃新道具
            </button>
          </div>
        </div>
      )}

      {s.pending?.kind === 'steal' && (
        <div className="overlay">
          <div className="modal">
            <h2>手术钳</h2>
            <p className="modal-desc">选择要从 AI 背包夹走的道具。</p>
            <div className="modal-items">
              {ai.items.map((item, index) => (
                <button key={`${item}-${index}`} className="item-btn" onClick={() => engineRef.current?.resolveSteal(index)}>
                  <ItemIcon item={item} />
                  <b>{ITEM_NAMES[item]}</b>
                  <span>{ITEM_DESC[item]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {s.over && (
        <div className="overlay">
          <div className={`result ${s.winner === 'player' ? 'win' : 'lose'}`}>
            <h2>{s.winner === 'player' ? '毒停在你面前' : '毒蔓延进心脏'}</h2>
            <p>{s.log[s.log.length - 1]?.text}</p>
            <button className="wide" onClick={() => engineRef.current?.restart()}>
              再来一局
            </button>
          </div>
        </div>
      )}

      {rulesOpen && (
        <div className="overlay" onClick={() => setRulesOpen(false)}>
          <div className="rules" onClick={(event) => event.stopPropagation()}>
            <h2>蔓延 · 规则</h2>
            <p>
              <b>目标</b>：自己的心脏被翻开就输（自己翻，或被对方用注射器翻开）；对方心脏先被翻开则你赢。
            </p>
            <p>
              <b>棋盘</b>：7×7。毒液从中心 (4,4) 开始。你的心脏在第 7 行，AI 心脏在第 1 行，位置公开。你只能翻 4–7 行，AI 只能翻 1–4 行，第 4 行共用。
            </p>
            <p>
              <b>回合</b>：先用任意数量道具，然后必须翻 1 张与毒液正交相邻、且在自己行内的牌；翻开的格子成为毒液。没有合法牌 = 闷死 = 输；心脏本身也是合法牌，翻它 = 输。
            </p>
            <p>
              <b>器官</b>（开局全部生效；翻到器官牌会失去对应被动，并进入 6 回合坏死，只有肾能修回一个）：肺 2 次屏息跳过翻牌；肝每 3 个自己的回合固定触发，由你选择自己半场 1 格导电毒变回未翻牌；肾被翻到时（自己翻或对方注射器注入都算），修复机会归翻牌方：自己翻就修自己的器官；对方翻到你的肾，则由对方修他自己的器官（包括他自己的肾）。修复效果：坏死墙消失，周围一圈普通毒变回未翻牌，该器官功能恢复；肾自身照常坏死；胃让道具上限变 3（失去后上限变 1，并随机弃掉多余道具）。
            </p>
            <p>
              <b>坏死墙</b>：翻开的器官格 6 回合内为坏死墙，毒液不能穿过；坏死期间该格不能被注射器选中。墙自然到期只解除坏死，器官功能不会恢复；只有肾的修复能同时恢复该器官的功能。
            </p>
            <p>
              <b>道具</b>：听诊器看牌 3 秒；注射器抽取自己 1 格毒注射到对方半场，落点变成毒格（器官则进入坏死），每回合限 1 次，可直接斩心；手术钳夹走对方 1 件道具。肾上腺素立即额外翻 1 张；病毒感染后本回合及接下来 2 个自己的回合不能用道具。
            </p>
            <p>
              <b>先手</b>：首局玩家先手，之后上一局胜者先手。Esc 取消当前道具。
            </p>
            <button className="wide" onClick={() => setRulesOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}