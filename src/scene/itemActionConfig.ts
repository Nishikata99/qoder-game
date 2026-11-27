import type { ActionVisualId } from '../game/GameEngine'

export type ItemActionTiming = { start: number; contact: number; commit: number; end: number; release: number }
export type Vec3Tuple = readonly [number, number, number]
export type RemnantPolicy = 'round' | 'cuffs' | 'hourglass'
export type ItemActionSound = 'metal' | 'paper' | 'glass' | 'soft'

export interface ItemActionSpec {
  readonly timings: ItemActionTiming
  readonly propScale: number
  readonly target: Vec3Tuple
  readonly hero?: 'cutter' | 'saw' | 'paper' | 'strip'
  readonly focusOffset: Vec3Tuple
  readonly grip: { readonly offset: Vec3Tuple; readonly local?: boolean }
  readonly support: { readonly offset: Vec3Tuple; readonly from: 'target' | 'tool' | 'paper' | 'strip'; readonly local?: boolean }
  readonly leftRotation: Vec3Tuple
  readonly rightRotation: Vec3Tuple
  readonly leftGrip: number
  readonly rightGrip: number
  readonly remnant: RemnantPolicy
  readonly sound: ItemActionSound
  readonly camera?: { readonly distance: number; readonly fov: number }
}

const DEFAULT_SPEC = {
  propScale: 0.62,
  target: [0.12, 0.38, -0.1] as Vec3Tuple,
  focusOffset: [0, 0, 0] as Vec3Tuple,
  grip: { offset: [0.018, 0.03, 0.12] as Vec3Tuple },
  support: { offset: [-0.28, -0.15, 0.05] as Vec3Tuple, from: 'target' as const },
  leftRotation: [0, 0, 0] as Vec3Tuple,
  rightRotation: [0, -0.15, 0] as Vec3Tuple,
  leftGrip: 0.4,
  rightGrip: 0.95,
  remnant: 'round' as const,
  sound: 'metal' as const,
}

const spec = (timings: ItemActionTiming, overrides: Partial<ItemActionSpec> = {}): ItemActionSpec => ({ ...DEFAULT_SPEC, timings, ...overrides })

export const ITEM_ACTION_SPECS: Readonly<Record<ActionVisualId, ItemActionSpec>> = {
  sedative: spec(
    { start: 0.8, contact: 1.2, commit: 2.8, end: 3.6, release: 3.1 },
    {
      propScale: 0.44,
      focusOffset: [0, -0.28, 0],
      grip: { offset: [0.07, -0.01, 0.11] },
      support: { offset: [-0.4, 0.02, 0.12], from: 'target' },
      leftRotation: [0.2, -0.55, Math.PI * 0.62],
      sound: 'soft',
    },
  ),
  magnifier: spec(
    { start: 0.6, contact: 0.9, commit: 1, end: 3.2, release: 2.8 },
    {
      target: [0.06, 0.43, -0.24],
      grip: { offset: [0, 0.01, -0.19], local: true },
      support: { offset: [-0.11, -0.06, 0.02], from: 'tool' },
      leftRotation: [0.15, -0.5, Math.PI * 0.42],
      leftGrip: 0.62,
      sound: 'glass',
    },
  ),
  saw: spec(
    { start: 0.7, contact: 0.9, commit: 2.6, end: 3.4, release: 3 },
    {
      target: [0.02, 0.38, -0.24],
      hero: 'saw',
      grip: { offset: [0.17, 0.005, 0.035] },
      support: { offset: [-0.17, -0.075, 0.015], from: 'target' },
      leftRotation: [0.15, -0.3, Math.PI * 0.48],
      rightRotation: [0, -0.15, -0.12],
      leftGrip: 0.48,
    },
  ),
  hammer: spec(
    { start: 0.7, contact: 1.35, commit: 1.4, end: 2.6, release: 2.2 },
    {
      propScale: 0.52,
      target: [0.06, 0.43, -0.24],
      grip: { offset: [0, 0.02, -0.15], local: true },
      support: { offset: [-0.16, -0.1, 0.1], from: 'target' },
      leftRotation: [0.1, -0.4, Math.PI * 0.45],
      leftGrip: 0.45,
    },
  ),
  handcuffs: spec(
    { start: 0.6, contact: 1.5, commit: 2, end: 2.8, release: 2.3 },
    {
      target: [-0.25, 0.23, -1.95],
      support: { offset: [-0.2, -0.08, 0.02], from: 'target' },
      leftRotation: [0.1, -0.45, Math.PI * 0.42],
      leftGrip: 0.5,
      remnant: 'cuffs',
      camera: { distance: 1.55, fov: 36 },
    },
  ),
  aegis: spec(
    { start: 0.6, contact: 1.4, commit: 1.7, end: 2.5, release: 2.1 },
    {
      propScale: 0.42,
      grip: { offset: [0.12, 0.035, 0.06] },
      support: { offset: [-0.13, 0.035, 0.06], from: 'tool' },
      leftRotation: [0.1, -0.45, -Math.PI * 0.28],
      leftGrip: 0.62,
      sound: 'glass',
      camera: { distance: 1.8, fov: 37 },
    },
  ),
  magnet: spec(
    { start: 0.6, contact: 0.8, commit: 2, end: 2.8, release: 2.4 },
    {
      propScale: 0.48,
      grip: { offset: [0.11, 0.015, 0.06] },
      support: { offset: [-0.11, -0.015, 0.055], from: 'tool' },
      leftRotation: [0.1, -0.4, -Math.PI * 0.3],
      leftGrip: 0.58,
    },
  ),
  cutter: spec(
    { start: 0.5, contact: 1, commit: 1.9, end: 2.7, release: 2.3 },
    {
      hero: 'cutter',
      grip: { offset: [0.025, 0.018, 0] },
      support: { offset: [-0.16, 0.025, 0.12], from: 'target' },
      leftRotation: [0.12, -0.35, Math.PI * 0.42],
      leftGrip: 0.28,
      camera: { distance: 1.5, fov: 35 },
    },
  ),
  iou: spec(
    { start: 0.7, contact: 1.55, commit: 2.1, end: 3, release: 2.6 },
    {
      hero: 'paper',
      target: [-0.1, 0.006, -0.3],
      support: { offset: [-0.2, 0.04, 0.06], from: 'paper' },
      rightRotation: [0, -0.15, -0.35],
      remnant: 'round',
      sound: 'paper',
      camera: { distance: 1.5, fov: 35 },
    },
  ),
  seal: spec(
    { start: 0.6, contact: 1.25, commit: 2, end: 2.8, release: 2.4 },
    {
      hero: 'strip',
      support: { offset: [-0.14, 0.02, 0], from: 'strip' },
      leftRotation: [0.1, -0.35, -Math.PI * 0.28],
      leftGrip: 0.4,
      sound: 'paper',
      camera: { distance: 1.5, fov: 35 },
    },
  ),
  gloves: spec(
    { start: 0.6, contact: 1.1, commit: 1.6, end: 2.8, release: 2.4 },
    {
      propScale: 0.5,
      target: [0.78, 1.12, -0.92],
      grip: { offset: [0.04, 0.02, 0.08] },
      support: { offset: [-0.18, -0.08, 0.04], from: 'tool' },
      leftRotation: [0.1, -0.35, -Math.PI * 0.3],
      leftGrip: 0.55,
      sound: 'soft',
      camera: { distance: 1.7, fov: 38 },
    },
  ),
  hourglass: spec(
    { start: 0.7, contact: 1.5, commit: 2, end: 3, release: 2.6 },
    {
      propScale: 0.42,
      focusOffset: [-0.14, 0, 0],
      grip: { offset: [0.078, 0, 0.055], local: true },
      support: { offset: [-0.078, 0, 0.055], from: 'tool', local: true },
      leftGrip: 0.62,
      rightGrip: 0.72,
      remnant: 'hourglass',
      sound: 'glass',
      camera: { distance: 1.55, fov: 36 },
    },
  ),
}

export function itemActionCamera(item: ActionVisualId): { distance: number; fov: number } {
  return ITEM_ACTION_SPECS[item].camera ?? { distance: 1.62, fov: 36 }
}

/** 血注驻场区：牌落在血架右侧的空桌（压不到计分数字）；Boss 侧 x 不变、z 取反并转身朝 Boss。
 * 沙漏立在驻场牌后侧的空位，避开手牌、牌面、按键与计分数字，保证互不穿模。 */
export const BLOOD_ANTE_SLOT = { x: -0.565, z: 1.34, angle: -0.14 } as const
export const BLOOD_ANTE_HOURGLASS = { x: -0.6, z: 0.96 } as const
