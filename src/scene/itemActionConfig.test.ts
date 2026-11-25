import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ITEM_IDS } from '../game/GameEngine'
import { ITEM_ACTION_SPECS, itemActionCamera } from './itemActionConfig'
import { resolveActionAnchor } from './ItemActions'

describe('item action config', () => {
  it('为每件道具定义完整且有序的时间轴', () => {
    for (const item of ITEM_IDS) {
      const spec = ITEM_ACTION_SPECS[item]
      expect(spec, item).toBeDefined()
      expect(spec.timings.start).toBeLessThan(spec.timings.contact)
      expect(spec.timings.contact).toBeLessThanOrEqual(spec.timings.commit)
      expect(spec.timings.commit).toBeLessThan(spec.timings.release)
      expect(spec.timings.release).toBeLessThan(spec.timings.end)
    }
  })

  it('沙漏的左手支撑点跟随道具翻转', () => {
    expect(ITEM_ACTION_SPECS.hourglass.support.local).toBe(true)
    const base = new THREE.Vector3(0.04, 0.37, 0.12)
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI))
    const before = resolveActionAnchor(base, ITEM_ACTION_SPECS.hourglass.support.offset, true)
    const after = resolveActionAnchor(base, ITEM_ACTION_SPECS.hourglass.support.offset, true, rotation)
    expect(after.distanceTo(before)).toBeCloseTo(0.156, 5)
    expect(after.distanceTo(base)).toBeCloseTo(before.distanceTo(base), 5)
  })

  it('世界锚点不会随道具旋转漂移', () => {
    const base = new THREE.Vector3(1, 2, 3)
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI))
    const anchor = resolveActionAnchor(base, [0.1, 0.2, 0.3], false, rotation)
    expect(anchor.toArray()).toEqual([1.1, 2.2, 3.3])
  })

  it('握持力度、缩放和玩家机位参数始终有效', () => {
    for (const item of ITEM_IDS) {
      const spec = ITEM_ACTION_SPECS[item]
      expect(spec.propScale).toBeGreaterThan(0)
      expect(spec.leftGrip).toBeGreaterThanOrEqual(0)
      expect(spec.leftGrip).toBeLessThanOrEqual(1)
      expect(spec.rightGrip).toBeGreaterThanOrEqual(0)
      expect(spec.rightGrip).toBeLessThanOrEqual(1)
      const camera = itemActionCamera(item)
      expect(camera.distance).toBeGreaterThan(0)
      expect(camera.fov).toBeGreaterThan(0)
    }
  })
})
