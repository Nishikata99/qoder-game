import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { GameSnapshot } from '../game/GameEngine'
import { ItemActions } from './ItemActions'

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    phase: 'playerTurn',
    paused: false,
    levelIndex: 0,
    round: 1,
    player: { hand: { cards: [] }, shield: 0, skipTurn: false },
    boss: { hand: { cards: [] }, shield: 0, skipTurn: false },
    hourglassActive: false,
    ...overrides,
  } as unknown as GameSnapshot
}

function harness(reducedMotion = false) {
  const scene = new THREE.Scene()
  const deps = {
    scene,
    tableY: 1,
    prop: () => {
      const group = new THREE.Group()
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()))
      return group
    },
    hand: () => undefined,
    card: () => null,
    focus: vi.fn(),
    rest: vi.fn(),
    commit: vi.fn(),
    cue: vi.fn(),
    status: vi.fn(),
    restHands: vi.fn(),
    reducedMotion: () => reducedMotion,
    saw: vi.fn(),
    reload: vi.fn(),
  }
  return { scene, deps, actions: new ItemActions(deps) }
}

describe('ItemActions 状态机', () => {
  it('暂停后动作时间不推进', () => {
    const { actions } = harness()
    actions.start('player', 'hammer', snapshot(), new THREE.Vector3())
    actions.sync(snapshot({ paused: true }))
    actions.update(1)
    expect(actions.getStatus()?.time).toBe(0)
    actions.dispose()
  })

  it('取消后不再触发接触或提交', () => {
    const { actions, deps } = harness()
    actions.start('player', 'hammer', snapshot(), new THREE.Vector3())
    actions.update(0.2)
    actions.cancel()
    actions.update(2)
    expect(actions.getStatus()).toBeNull()
    expect(deps.cue).not.toHaveBeenCalledWith('hammer', 'contact')
    expect(deps.commit).not.toHaveBeenCalled()
  })

  it('释放点前不能跳过，释放后只结算一次', () => {
    const { actions, deps } = harness()
    actions.start('player', 'hammer', snapshot(), new THREE.Vector3())
    actions.seek(1)
    expect(actions.skip()).toBe(false)
    actions.seek(2.2)
    expect(actions.skip()).toBe(true)
    expect(actions.getStatus()).toBeNull()
    expect(deps.commit).toHaveBeenCalled()
  })

  it('减弱动态保持阶段顺序但更快完成', () => {
    const run = (reduced: boolean) => {
      const { actions } = harness(reduced)
      actions.start('player', 'hammer', snapshot(), new THREE.Vector3())
      let frames = 0
      while (actions.busy && frames < 300) {
        actions.update(0.05)
        frames += 1
      }
      actions.dispose()
      return frames
    }
    expect(run(true)).toBeLessThan(run(false))
  })

  it('回合变化后清理 Used 残留', () => {
    const { actions, scene } = harness()
    actions.start('player', 'hammer', snapshot(), new THREE.Vector3())
    actions.seek(2.6)
    actions.skip()
    expect(scene.getObjectByName('Used-player-hammer')).toBeTruthy()
    actions.sync(snapshot({ round: 2 }))
    expect(scene.getObjectByName('Used-player-hammer')).toBeFalsy()
    actions.dispose()
  })

  it('语义 cue 按 pickup、contact、动作节点、finish 顺序触发', () => {
    const { actions, deps } = harness()
    actions.start('player', 'magnifier', snapshot(), new THREE.Vector3())
    for (let i = 0; i < 100 && actions.busy; i += 1) actions.update(0.05)
    expect(deps.cue.mock.calls.map(([, cue]) => cue)).toEqual(['pickup', 'contact', 'finish'])
    expect(deps.focus).toHaveBeenCalled()
    actions.dispose()
  })
})
