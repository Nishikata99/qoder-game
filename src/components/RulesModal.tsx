import { useRef, useState, type ReactNode } from 'react'
import { ITEM_CATALOG, ITEM_IDS, LEVELS, LEVEL_UNLOCKS, TRUMP_CATALOG, TRUMP_IDS } from '../game/GameEngine'
import type { ItemId, TrumpId } from '../game/GameEngine'
import { bossName, itemFlavor } from '../narrative/copy'
import { useDialogFocus } from './useDialogFocus'

export type ModalTab = 'rules' | 'trumps' | 'items'

const RULES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '二十一袋血契',
    body: '双方各发两张牌，各一张明牌、一张暗牌。严格交替行动：每次只摸一张或停牌；双方必须连续两轮不使用王牌并停牌才结算，中途要牌或使用王牌会重新累计，对手加牌会恢复你的行动权。',
  },
  {
    title: '数字牌堆',
    body: '牌堆为数字 1~11，共 11 张，无重复，双方共用。所有牌按固定点数相加，没有 A，也没有软牌；每个回合重新洗牌。',
  },
  {
    title: '爆牌即处决',
    body: '任一方超过本局目标值即爆牌。只有一方爆牌时爆牌方输；双方都爆牌时，点数更小、离目标更近的一方获胜；双方点数完全相同则平局。爆牌后不能再要牌，只能打王牌或停牌。',
  },
  {
    title: '目标值与满点',
    body: '默认目标 21，血注王牌可改为 24 / 27。你赢下本轮且最终点数正好等于目标值时，额外获得一件随机道具。',
  },
  {
    title: '枪口裁决',
    body: '持枪者可射向对面，也可对准自己。对敌人开空枪会把枪权交给对方；对自己开空膛不拿任何道具，本次开枪直接结束，不能继续开。手铐可以阻止一次对敌空枪的枪权转移。牌局阶段只能使用王牌；8 件普通道具只在拿枪后、开枪前使用。',
  },
  {
    title: '血契结算',
    body: '实弹基础 1 血；锯子 +1。护心镜不挡子弹，而是公开退掉膛内当前这一发（该发从本局弹仓移除，退出的是实弹还是空膛双方都看得见）。牌局点数不再直接增加伤害，空膛不扣血。',
  },
  {
    title: '王牌卡',
    body: '共 14 张，按单卡权重抽取。每回合双方各抽 2 张，要牌时小概率再抽 1 张；局末最多保留 1 张。血注会覆盖其他目标王牌，销注可移除对手的目标王牌。',
  },
  {
    title: '平局',
    body: '双方同点或爆得一样多时不开枪，各摸一件道具，然后进入下一回合。',
  },
  {
    title: '霰弹枪弹仓',
    body: '第一层开局固定 1 实 1 空。之后随层数与回合逐步增加，首次达到 8 发后，后续重装随机 2~8 发；非 2 发时实弹 2~4 发且不超过总数一半，奇数可多 1 发。顺序随机打乱，每扣一次消耗一发，打空后才重新装填。',
  },
  {
    title: '门前补给',
    body: '清空一层后，门前会摆出补给，随机留下一件收进你的背包，然后自动开门。第 1 层摆两件，之后摆三件。Boss 也在同一批候选里随机拿一件，不需要任何操作。',
  },
  {
    title: '三层赎价',
    body: '第 1/2/3 层：对手生命 4/5/6，你的血袋 4/4/4，开局补给 0/1/1 件，每次重装补给 1/2/4 件。第 1 层解锁放大镜、镇定剂、锯子；第 2 层解锁手铐、护心镜、借据；第 3 层解锁重锤、窃贼手套。Boss 与玩家共用同一份已解锁道具池。',
  },
  {
    title: '快捷键',
    body: 'H 要牌、S 停牌；持枪时先点桌上的枪，再点对手的血袋射向它、点自己的血袋对自己开枪（也可按 F/1、R/2）。',
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
            <TabButton active={tab === 'trumps'} onClick={() => setTab('trumps')}>
              王牌图鉴
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
        ) : tab === 'trumps' ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {TRUMP_IDS.map((trump) => (
              <TrumpCard key={trump} trump={trump} />
            ))}
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

function TrumpCard({ trump }: { trump: TrumpId }) {
  const catalog = TRUMP_CATALOG[trump]
  return (
    <article className="flex gap-3 border border-rust-500/10 bg-black/25 p-3">
      <span className="font-display text-2xl text-amber-300/80">{catalog.glyph}</span>
      <div>
        <h3 className="font-display text-sm text-bone-200">{catalog.name}</h3>
        <p className="mt-0.5 font-display text-[10px] tracking-[0.16em] text-bone-200/40 uppercase">{catalog.enName}</p>
        <p className="mt-1 text-xs leading-relaxed text-bone-200/70">{catalog.summary}</p>
      </div>
    </article>
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
