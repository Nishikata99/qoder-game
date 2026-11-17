import { useEffect, useState, type ReactNode } from 'react'
import { ITEM_CATALOG, ITEM_IDS, LEVELS, LEVEL_UNLOCKS } from '../game/GameEngine'
import type { ItemId } from '../game/GameEngine'

export type ModalTab = 'rules' | 'items'

const RULES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '走完二十一',
    body: '双方各持两张牌，你全明牌，对手一张明牌一张暗牌。点数更接近 21 且不爆牌的一方赢得本轮，并用左轮向对方开一枪。',
  },
  {
    title: 'A 的算法',
    body: 'A 可记作 1 或 11，系统自动取不爆牌的最大值。软牌（仍含 11 点 A）会在牌面标记。',
  },
  {
    title: '爆牌即处决',
    body: '任一方点数超过 21 点，立刻判负并直接进入处决阶段，不再比较点数。',
  },
  {
    title: '黑杰克暴击',
    body: '起手两张牌恰好 21 点即黑杰克，触发处决过载，本轮实弹伤害 +1。',
  },
  {
    title: '走火危机',
    body: '双方同点则无人开枪：各摸一件道具，且基础伤害永久 +1（可叠加）。只有有人真的中弹后才会清零。',
  },
  {
    title: '左轮弹仓',
    body: '每轮随机装入 3~6 发子弹（实弹/空弹混合）并打乱顺序，逐发消耗不重洗；打空后才重新装填下一轮。',
  },
  {
    title: '层数与补给',
    body: '第 1/2/3 层对手生命为 3/4/5，开局补给 2/3/4 件道具。第 2 层解锁磁铁与手铐，第 3 层解锁沙漏与匕首。',
  },
]

export function RulesModal({
  initialTab,
  onClose,
}: {
  initialTab: ModalTab
  onClose: () => void
}) {
  const [tab, setTab] = useState<ModalTab>(initialTab)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[82vh] w-full max-w-2xl overflow-y-auto border border-rust-500/30 bg-abyss-900/95 p-6 shadow-2xl shadow-black/80"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex gap-3">
            <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>
              规则
            </TabButton>
            <TabButton active={tab === 'items'} onClick={() => setTab('items')}>
              道具图鉴
            </TabButton>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs tracking-[0.3em] text-bone-200/40 uppercase hover:text-bone-200/80"
          >
            关闭 ESC
          </button>
        </div>

        {tab === 'rules' ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {RULES.map((rule, index) => (
              <section key={rule.title} className="border-l border-rust-500/25 pl-3">
                <p className="text-[10px] tracking-[0.3em] text-rust-400/70">
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-1 font-display text-base text-bone-200">{rule.title}</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-bone-200/55">{rule.body}</p>
              </section>
            ))}
            <section className="border-l border-rust-500/25 pl-3 sm:col-span-2">
              <h3 className="font-display text-base text-bone-200">三层结构</h3>
              <ul className="mt-2 grid gap-1 text-[11px] text-bone-200/55 sm:grid-cols-3">
                {LEVELS.map((level, index) => (
                  <li key={level.id}>
                    <span className="text-rust-400/80">第 {index + 1} 层 · {level.name}</span>
                    <br />
                    生命 {level.hp} · 补给 {level.supply}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {ITEM_IDS.map((item) => (
              <ItemCard key={item} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-1 pb-1 text-xs tracking-[0.25em] uppercase transition-colors ${
        active
          ? 'border-rust-400 text-bone-200'
          : 'border-transparent text-bone-200/35 hover:text-bone-200/65'
      }`}
    >
      {children}
    </button>
  )
}

function ItemCard({ item }: { item: ItemId }) {
  const catalog = ITEM_CATALOG[item]
  const unlockLevel = LEVEL_UNLOCKS.findIndex((tier) => tier.includes(item))
  return (
    <article className="flex gap-3 border border-white/5 bg-black/25 p-3">
      <span className="font-display text-2xl text-rust-400/80">{catalog.glyph}</span>
      <div>
        <h3 className="font-display text-sm text-bone-200">{catalog.name}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-bone-200/55">{catalog.summary}</p>
        <p className="mt-1 text-[10px] tracking-[0.2em] text-bone-200/30 uppercase">
          {unlockLevel <= 0 ? '初始可用' : `第 ${unlockLevel + 1} 层解锁`}
        </p>
      </div>
    </article>
  )
}
