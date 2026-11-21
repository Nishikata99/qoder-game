import { useRef, useState, type ReactNode } from 'react'
import { ITEM_CATALOG, ITEM_IDS, LEVELS, LEVEL_UNLOCKS } from '../game/GameEngine'
import type { ItemId } from '../game/GameEngine'
import { bossName, itemFlavor } from '../narrative/copy'
import { useDialogFocus } from './useDialogFocus'

export type ModalTab = 'rules' | 'items'

const RULES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '二十一袋血契',
    body: '双方各发两张牌，你全明牌，对手一明一暗。点数更接近 21 且不爆牌者赢下本轮、夺得霰弹枪——由持枪者决定枪口朝向。',
  },
  {
    title: 'A 的算法',
    body: 'A 可记作 1 或 11，系统自动取不爆牌的最大值。软牌（仍含 11 点 A）会在牌面标记。',
  },
  {
    title: '爆牌即处决',
    body: '任一方超过 21 点立刻视作违约判负，直接面对这一枪——但弹仓里也可能是空膛。',
  },
  {
    title: '黑杰克暴击',
    body: '起手两张牌恰好 21 点即黑杰克，本枪实弹伤害 +1。',
  },
  {
    title: '碾压加注',
    body: '赢下本轮时手牌达到 20 点及以上，本枪实弹伤害再 +1。牌越重，枪越狠。',
  },
  {
    title: '枪口裁决',
    body: '持枪者可射向对面，也可对准自己。对自己扣响空膛，牌桌会赏你一件遗物道具；若打出实弹，则由自己流血。每回合最多使用 3 件道具。',
  },
  {
    title: '血契结算',
    body: '实弹基础 2 血；黑杰克 +1；碾压 +1；走火遗恨 +N；锯子整体翻倍。空膛不扣血。',
  },
  {
    title: '走火遗恨',
    body: '双方同点视作僵持罚息：本轮不开枪，各摸一件道具，且走火遗恨 +1（可叠加）。只有真正扣血才会清零；被护心镜完全挡下时，遗恨保留。借据会在赢下时 +2、输掉时 +1。',
  },
  {
    title: '霰弹枪弹仓',
    body: '每次装填 4~6 发，含 2~3 发实弹，顺序随机打乱。每扣一次消耗一发、中途不重洗，打空后才重新装填。',
  },
  {
    title: '层间遗物',
    body: '清空一层后，门前会摆出前人留下的遗物，你只能带走一件进入下一层。第 1 层摆两件，之后摆三件；12 秒未选将自动拿走第一件。',
  },
  {
    title: '三层赎价',
    body: '第 1/2/3 层：对手生命 6/8/8，你的血袋 7/7/7（合计 21 袋），开局补给 2/3/4 件。第 2 层解锁磁铁、手铐、护心镜、裁纸刀、借据；第 3 层解锁沙漏、匕首、重锤、封条、单片眼镜。Boss 只会携带自己会用到的道具，沙漏为玩家专属。',
  },
  {
    title: '快捷键',
    body: 'H 要牌、S 停牌；持枪时 F 或 1 射向它、R 或 2 射向自己。快捷键与按钮共用同一套阶段校验。',
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
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useDialogFocus(dialogRef, onClose)

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/78 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="规则与图鉴"
    >
      <div
        ref={dialogRef}
        className="relative max-h-[82dvh] w-full max-w-2xl overflow-y-auto border border-rust-500/30 bg-abyss-900/95 p-6 shadow-2xl shadow-black/80"
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
                <p className="mt-1 text-xs leading-relaxed text-bone-200/70">{rule.body}</p>
              </section>
            ))}
            <section className="border-l border-rust-500/25 pl-3 sm:col-span-2">
              <h3 className="font-display text-base text-bone-200">三层结构</h3>
              <ul className="mt-2 grid gap-1 text-xs text-bone-200/70 sm:grid-cols-3">
                {LEVELS.map((level, index) => (
                  <li key={level.id}>
                    <span className="text-rust-400/80">第 {index + 1} 层 · {bossName(index)}</span>
                    <br />
                    你 {level.playerHp} / 它 {level.hp} · 补给 {level.supply}
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
        <p className="mt-1 text-xs leading-relaxed text-bone-200/70">{catalog.summary}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-rust-300/60 italic">{itemFlavor(item)}</p>
        <p className="mt-1 text-[10px] tracking-[0.2em] text-bone-200/30 uppercase">
          {unlockLevel <= 0 ? '初始可用' : `第 ${unlockLevel + 1} 层解锁`}
        </p>
      </div>
    </article>
  )
}
