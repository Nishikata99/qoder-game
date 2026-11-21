/**
 * 叙事文案层：引擎（GameEngine.ts）保持零修改，所有面向玩家的叙事措辞在这里映射。
 * 依据 docs/NARRATIVE-REWORK-PLAN.md（小棠血契版）。
 */

/** 三层 Boss 与地点：LEVELS 里的 name/title 是引擎数据，这里只做展示层替换 */
export const LEVEL_NARRATIVE: ReadonlyArray<{ name: string; title: string }> = [
  { name: '验血官', title: '一层 · 验血厅' },
  { name: '赖账犬', title: '二层 · 欠收账房' },
  { name: '缝账人', title: '三层 · 补针刑台' },
]

export function bossName(levelIndex: number): string {
  return LEVEL_NARRATIVE[levelIndex]?.name ?? '缝账人'
}

export function levelTitle(levelIndex: number): string {
  return LEVEL_NARRATIVE[levelIndex]?.title ?? '三层 · 补针刑台'
}

/** 道具机制说明沿用引擎 ITEM_CATALOG，叙事批注只追加在图鉴/悬浮提示里 */
export const ITEM_FLAVOR: Readonly<Record<string, string>> = {
  magnifier: '验血官挑针头用的旧镜片，能照穿铁锈里的死活。',
  sedative: '门厅发的廉价药剂，管身上还留着一道指甲掐痕。',
  saw: '锯短枪管，让下一枪的血债翻倍偿还。',
  magnet: '账房老千藏在袖口里的旧磁石，早被血浸锈了。',
  handcuffs: '二楼锁过赖账人的铁铐，钥匙早就扔进了下水道。',
  aegis: '一块裂了缝的铜镜，背面刻着前人没写完的半个姓。',
  hourglass: '沙漏底座用针尖划着一个极小的「棠」字——她曾靠它翻过盘。',
  dagger: '刀柄缠着染血的棉线，割开手腕就能逼牌桌重洗。',
  decoy: '一只缝着纽扣眼的破布偶，替坐过这里的人挡过一枪。',
  hammer: '刑台边钉刻痕名单的铁锤，能把侥幸生生砸成死局。',
}

export function itemFlavor(itemId: string): string | undefined {
  return ITEM_FLAVOR[itemId]
}

/** 旧 Boss 名 → 新 Boss 名：引擎日志与快照里带的是旧名，展示时统一替换 */
const LEGACY_BOSS_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['锈蚀看门人', '验血官'],
  ['赌命收账人', '赖账犬'],
  ['深渊执刑者', '缝账人'],
]

/** 叙事向日志条目的替换；纯机制日志（伤害数字、道具使用、装填）保持引擎原文 */
const LOG_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^深渊在呼吸。锈蚀的轮盘正在等待一笔交易。$/, '地下室很冷。血袋架滴了一声，牌桌正在等你的底注。'],
  [/^你坐下，牌桌另一端的影子抬起头。$/, '你按住带抓痕的椅扶手，对面的影子抬起了头。'],
  [/^(—— 第 \d+ 层 · )[^—]+( ——)$/, '$1' + '$LEVEL_TITLE' + '$2'],
  [/^「(.+)」把一枚生锈的转轮推到你面前。$/, '「$1」把浸满铁锈味的霰弹枪推过桌沿。'],
  [/^你爆牌了。手指停在半空。$/, '超过二十一点。你的手指僵在牌背上。'],
  [/^21 点。你选择停牌。$/, '刚好二十一点。你扣下牌。'],
  [/^你停牌在 (\d+) 点。$/, '你在 $1 点停手。'],
  [/^它爆牌了，喉咙里滚出一声低笑。$/, '它爆牌了，面具与缝线底下滚出一声干涩的笑。'],
  [/^它亮出底牌 (.+)，共 (\d+) 点。$/, '它翻开底牌 $1，共 $2 点。'],
  [/^走火危机：双方都停在 (\d+) 点，这一枪没人开。$/, '血契僵持：双方同停 $1 点，这一枪暂且压下。'],
  [/^轮盘发出空转的咔哒声。走火遗恨 \+1，此后实弹伤害 \+(\d+)。$/, '撞针空响。走火遗恨 +1，此后实弹血息 +$1。'],
  [/^「(.+)」把枪口对准(自己|你)。$/, '「$1」抬起枪管，对准了$2。'],
  [/^「(.+)」倒下了。下一层的门正在开启……$/, '「$1」倒在血泊里。通往下一层的铁门松开了锁……'],
  [/^轮盘停转。深渊把你的名字刻进了铁锈里。$/, '缝线彻底松脱。二十一袋血的契约，到此两清。'],
  [/^你的呼吸停在了牌桌上。轮盘继续转动。$/, '血袋见底了。三楼名单的最后一道空槽，添上了你的名字。'],
  [/^门前的桌上摆着三件补给，你只能带走一件。$/, '门前摆着三件前人留下的遗物，你只能带走一件。'],
  [/^你把【(.+)】别在腰间，推开了下一道生锈的铁门。$/, '你收起【$1】，攥紧半张契纸，推开了下一道铁门。'],
]

export function narrativeLog(line: string, levelIndex: number): string {
  let result = line
  for (const [pattern, replacement] of LOG_RULES) {
    if (!pattern.test(result)) continue
    if (replacement.includes('$LEVEL_TITLE')) {
      result = result.replace(pattern, replacement.replace('$LEVEL_TITLE', levelTitle(levelIndex)))
    } else {
      result = result.replace(pattern, replacement)
    }
    break
  }
  for (const [legacy, current] of LEGACY_BOSS_NAMES) {
    result = result.replaceAll(legacy, current)
  }
  return result
}
