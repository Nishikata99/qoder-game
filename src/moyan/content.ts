import type { PixelArtKey } from '../scene/PixelArt'

export const N = 7

export type Side = 'player' | 'ai'
export type Organ = 'lung' | 'liver' | 'kidney' | 'stomach'
export type ItemId =
  | 'stethoscope'
  | 'transplant'
  | 'steal'
  | 'adrenaline'
  | 'fever'

export const ORGANS: readonly Organ[] = ['lung', 'liver', 'kidney', 'stomach']

export const PENALTY_ITEMS: readonly ItemId[] = ['adrenaline', 'fever']

export const ORGAN_NAMES: Readonly<Record<Organ, string>> = {
  lung: '肺',
  liver: '肝',
  kidney: '肾',
  stomach: '胃',
}

export const ORGAN_SHORT: Readonly<Record<Organ, string>> = {
  lung: '屏息跳牌',
  liver: '每 3 回合自选清毒',
  kidney: '翻到时可修好一个坏死器官并恢复其功能',
  stomach: '道具上限 3',
}

export const ORGAN_DESC: Readonly<Record<Organ, string>> = {
  lung: '每局 2 次：屏息跳过 1 次翻牌，毒不扩散',
  liver: '每 3 个自己的回合固定触发：由你选择自己半场 1 格导电毒，变回未翻牌（不会让自己无牌可翻）',
  kidney: '被翻到后（自己翻或对方注射器注入都算）：修复机会归翻牌方，可修自己一个坏死器官（包括自己的肾）：修好坏死墙、清掉周围一圈毒并恢复功能；若翻牌方没有坏死器官则机会失效',
  stomach: '道具上限 3；失去时上限变 1，并随机弃掉多余道具，直到只剩 1 件',
}

export const ITEM_NAMES: Readonly<Record<ItemId, string>> = {
  stethoscope: '听诊器',
  transplant: '注射器',
  steal: '手术钳',
  adrenaline: '肾上腺素',
  fever: '病毒',
}

export const ITEM_DESC: Readonly<Record<ItemId, string>> = {
  stethoscope: '查看 1 张未翻牌（3 秒，旁边小窗仅你可见）',
  transplant: '抽取自己 1 格毒，注射到对方半场一张挨着导电毒的未翻牌上；落点变毒格，若是器官则进入坏死；每回合限 1 次，对方心脏若已挨毒可直接斩心（坏死墙不可选）',
  steal: '从对方背包夹取 1 件道具',
  adrenaline: '惩罚：立即额外翻 1 张',
  fever: '惩罚：感染病毒，本回合及接下来 2 个自己的回合不能用道具',
}

export const ITEM_ICON: Readonly<Record<ItemId, PixelArtKey>> = {
  stethoscope: 'stethoscope',
  transplant: 'syringe',
  steal: 'forceps',
  adrenaline: 'adrenaline',
  fever: 'virus',
}

export function sideName(side: Side): string {
  return side === 'player' ? '你' : 'AI'
}