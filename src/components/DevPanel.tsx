import { useState } from 'react'
import { ITEM_CATALOG, ITEM_IDS, type Chamber, type GameSnapshot, type ItemId } from '../game/GameEngine'

const btn =
  'border border-rust-500/40 px-2 py-1 text-[0.65rem] tracking-wider text-bone-200/85 transition-colors hover:border-rust-400 hover:text-white'

export function DevPanel({
  snapshot,
  onWinLevel,
  onSetPlayerTotal,
  onForceChamber,
  onGrantItem,
  onClose,
}: {
  readonly snapshot: GameSnapshot | null
  readonly onWinLevel: () => void
  readonly onSetPlayerTotal: (total: number) => void
  readonly onForceChamber: (chamber: Chamber) => void
  readonly onGrantItem: (item: ItemId) => void
  readonly onClose: () => void
}) {
  const [total, setTotal] = useState(21)
  const [item, setItem] = useState<ItemId>('magnifier')

  return (
    <div
      data-testid="dev-panel"
      className="absolute top-1/2 right-4 z-[60] w-64 -translate-y-1/2 border border-rust-500/50 bg-abyss-900/95 p-4 text-xs text-bone-200 shadow-2xl backdrop-blur-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="tracking-[0.25em] text-rust-400">开发者面板</span>
        <button type="button" aria-label="关闭开发者面板" className={btn} onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="mb-3 text-[0.65rem] text-bone-200/50">
        {snapshot
          ? `第 ${snapshot.levelIndex + 1} 层 · ${snapshot.phase} · 手牌 ${snapshot.player.hand.total} 点`
          : '未开局'}
      </p>

      <div className="space-y-3">
        <button type="button" className={`${btn} w-full`} onClick={onWinLevel}>
          直接赢下这一关
        </button>

        <div>
          <p className="mb-1 text-bone-200/60">手牌点数（2–21）</p>
          <div className="flex gap-2">
            <input
              type="number"
              min={2}
              max={21}
              value={total}
              aria-label="目标点数"
              onChange={(event) => setTotal(Number(event.target.value))}
              className="w-16 border border-rust-500/40 bg-black/60 px-2 py-1 text-[0.65rem]"
            />
            <button type="button" className={btn} onClick={() => onSetPlayerTotal(total)}>
              应用
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-bone-200/60">下一枪强制</p>
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => onForceChamber('live')}>
              实弹
            </button>
            <button type="button" className={btn} onClick={() => onForceChamber('blank')}>
              空弹
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1 text-bone-200/60">获取道具（满 8 件替换最早）</p>
          <div className="flex gap-2">
            <select
              value={item}
              aria-label="选择道具"
              onChange={(event) => setItem(event.target.value as ItemId)}
              className="flex-1 border border-rust-500/40 bg-black/60 px-2 py-1 text-[0.65rem]"
            >
              {ITEM_IDS.map((id) => (
                <option key={id} value={id}>
                  {ITEM_CATALOG[id].name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={() => onGrantItem(item)}>
              获取
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
