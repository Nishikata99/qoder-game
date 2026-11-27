import { describe, expect, it } from 'vitest'
import { ITEM_IDS } from '../game/GameEngine'
import { ITEM_ACTION_SPECS, itemActionCamera } from './itemActionConfig'

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
