import type { Side } from './GameStore'

/**
 * 跨层契约之一：所有小游戏与主框架之间只允许通过此事件表通信。
 * 新增事件必须在此补充类型，禁止使用字符串直传的裸事件。
 */
export interface BattleEvents {
  'battle:damage': { side: Side; amount: number; reason: string }
  'battle:chips': { amount: number; reason: string }
  'battle:turn': { side: Side }
  'battle:result': { gameId: string; winner: Side | 'draw'; summary: string }
  'fx:shake': { intensity?: number; duration?: number }
  'fx:flash': { color?: string }
  'ui:subtitle': { text: string; duration?: number }
  'game:mounted': { id: string; title: string }
}

type Handler = (payload: never) => void

export class EventBus {
  private readonly handlers = new Map<keyof BattleEvents, Set<Handler>>()

  on<K extends keyof BattleEvents>(type: K, handler: (payload: BattleEvents[K]) => void): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    const wrapped = handler as unknown as Handler
    set.add(wrapped)
    return () => {
      set.delete(wrapped)
    }
  }

  off<K extends keyof BattleEvents>(type: K, handler: (payload: BattleEvents[K]) => void): void {
    this.handlers.get(type)?.delete(handler as unknown as Handler)
  }

  emit<K extends keyof BattleEvents>(type: K, payload: BattleEvents[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const handler of [...set]) {
      ;(handler as unknown as (p: BattleEvents[K]) => void)(payload)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
