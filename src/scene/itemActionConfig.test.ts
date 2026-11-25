import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ITEM_IDS } from '../game/GameEngine'
import { ITEM_ACTION_SPECS, itemActionCamera } from './itemActionConfig'
import { ITEM_ACTION_CUES, actionEase, disposeActionObject, gripEnvelope, resolveActionAnchor } from './ItemActions'

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

  it('每件道具都有唯一且落在执行段的语义音效节点', () => {
    for (const item of ITEM_IDS) {
      const cues = ITEM_ACTION_CUES[item]
      expect(cues?.length, item).toBeGreaterThan(0)
      expect(new Set(cues?.map(([cue]) => cue)).size, item).toBe(cues?.length)
      for (const [, time] of cues ?? []) {
        expect(time, item).toBeGreaterThanOrEqual(ITEM_ACTION_SPECS[item].timings.contact)
        expect(time, item).toBeLessThanOrEqual(ITEM_ACTION_SPECS[item].timings.commit)
      }
    }
  })

  it('动作销毁共享模板几何时只释放自有几何', () => {
    const shared = new THREE.BoxGeometry(1, 1, 1)
    const owned = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial()
    const sharedMesh = new THREE.Mesh(shared, material)
    sharedMesh.userData.sharedGeometry = true
    const ownedMesh = new THREE.Mesh(owned, material)
    const root = new THREE.Group()
    root.add(sharedMesh, ownedMesh)
    let sharedDisposed = 0
    let ownedDisposed = 0
    shared.addEventListener('dispose', () => { sharedDisposed += 1 })
    owned.addEventListener('dispose', () => { ownedDisposed += 1 })
    disposeActionObject(root)
    expect(sharedDisposed).toBe(0)
    expect(ownedDisposed).toBe(1)
  })

  it('拾取与释放使用不同的速度曲线', () => {
    expect(actionEase(0, 'pickup')).toBe(0)
    expect(actionEase(1, 'pickup')).toBe(1)
    expect(actionEase(0.5, 'pickup')).toBeGreaterThan(0.5)
    expect(actionEase(0.5, 'release')).toBeLessThan(0.5)
  })

  it('手指在接近握点时收紧，在撤离前松开', () => {
    expect(gripEnvelope(0, 0.8, 3.1, 3.6)).toBe(0)
    expect(gripEnvelope(0.8, 0.8, 3.1, 3.6)).toBe(1)
    expect(gripEnvelope(3.1, 0.8, 3.1, 3.6)).toBe(1)
    expect(gripEnvelope(3.6, 0.8, 3.1, 3.6)).toBe(0)
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
