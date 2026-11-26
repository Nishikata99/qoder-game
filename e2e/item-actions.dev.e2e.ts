import { expect, test } from '@playwright/test'

type ItemId = 'sedative' | 'dagger' | 'magnifier' | 'monocle' | 'saw' | 'hammer' | 'handcuffs' | 'aegis' | 'magnet' | 'cutter' | 'iou' | 'seal' | 'hourglass'

declare global {
  interface Window {
    __itemActionDebug?: {
      phase(): string
      status(): { item: ItemId; actor: 'player' | 'boss'; time: number } | null
      items(): ItemId[]
      cards(): unknown[]
      grant(item: ItemId): void
      hp(value: number): void
      chamber(value: 'live' | 'blank'): void
      budget(): void
      use(item: ItemId): boolean
      choose(index: number): boolean
      cancelChoice(): boolean
      hold(value: boolean): void
      seek(time: number): unknown
      skip(): boolean
      preview(item: ItemId, actor?: 'player' | 'boss'): boolean
      probe(): { camera: number[]; fov: number } | null
      cancel(): void
    }
    __scene?: { itemActions: { dispose(): void }; getCamera(): { fov: number } }
  }
}

async function enterGame(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('./?seed=12345&skipcutscene=1')
  await page.evaluate(() => {
    for (const key of ['blood-ante.checkpoint.v1', 'blood-ante.cutsceneSeen.v1', 'blood-ante.hint.firstTurn', 'blood-ante.hint.targetPick']) localStorage.removeItem(key)
  })
  await page.reload()
  const start = page.getByRole('button', { name: '走进走廊' })
  await start.waitFor({ state: 'attached', timeout: 30_000 })
  await start.evaluate((element) => (element as HTMLElement).click())
  const leftDoor = page.getByRole('button', { name: '左门 · 开始新局（清除旧检查点）' })
  await leftDoor.waitFor({ state: 'attached', timeout: 60_000 })
  await leftDoor.evaluate((element) => (element as HTMLElement).click())
  await page.waitForFunction(() => window.__itemActionDebug?.phase() === 'playerTurn', undefined, { timeout: 180_000 })
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-input-locked') === 'false', undefined, { timeout: 30_000 })
}

test('开发者面板开关不触发暂停', async ({ page }) => {
  await enterGame(page)
  for (let index = 0; index < 4; index += 1) await page.keyboard.press('e')
  await expect(page.getByTestId('dev-panel')).toBeVisible()
  await expect(page.getByRole('dialog', { name: '游戏暂停' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('dev-panel')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: '游戏暂停' })).toHaveCount(0)
})

test('玩家 13 件道具走真实引擎与演出闸门', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await enterGame(page)
  const items: ItemId[] = ['sedative', 'dagger', 'magnifier', 'monocle', 'saw', 'hammer', 'handcuffs', 'aegis', 'magnet', 'cutter', 'iou', 'seal', 'hourglass']
  for (const item of items) {
    const { used, beforeCount } = await page.evaluate((item) => {
      const debug = window.__itemActionDebug!
      if (item === 'sedative' || item === 'dagger') debug.hp(2)
      if (item === 'hammer') debug.chamber('blank')
      debug.grant(item)
      const beforeCount = debug.items().filter((value) => value === item).length
      return { used: debug.use(item), beforeCount }
    }, item)
    expect(used, item).toBe(true)
    await page.waitForFunction(() => window.__itemActionDebug?.status() !== null)
    if (item === 'cutter' || item === 'seal') {
      await page.waitForFunction(() => (window.__itemActionDebug?.cards().length ?? 0) > 0)
      expect(await page.evaluate(() => window.__itemActionDebug!.choose(0)), item).toBe(true)
    }
    await page.evaluate(() => {
      const debug = window.__itemActionDebug!
      debug.hold(true)
      debug.seek(99)
      debug.hold(false)
      debug.skip()
    })
    await page.waitForFunction(() => window.__itemActionDebug?.status() === null)
    await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-input-locked') === 'false')
    await page.evaluate(() => window.__itemActionDebug!.budget())
    expect(await page.evaluate((item) => window.__itemActionDebug!.items().filter((value) => value === item).length, item), item).toBe(beforeCount - 1)
  }
  expect(errors).toEqual([])
})

test('裁纸刀放弃选牌后归还真道具并结束演出', async ({ page }) => {
  await enterGame(page)
  expect(await page.evaluate(() => { const debug = window.__itemActionDebug!; debug.grant('cutter'); return debug.use('cutter') })).toBe(true)
  await page.waitForFunction(() => window.__itemActionDebug?.status() !== null)
  await page.waitForFunction(() => (window.__itemActionDebug?.cards().length ?? 0) > 0)
  expect(await page.evaluate(() => window.__itemActionDebug!.cancelChoice())).toBe(true)
  await page.evaluate(() => { const debug = window.__itemActionDebug!; debug.hold(true); debug.seek(99); debug.hold(false); debug.skip() })
  await page.waitForFunction(() => window.__itemActionDebug?.status() === null)
  await page.waitForFunction(() => document.querySelector('main')?.getAttribute('data-input-locked') === 'false')
  expect(await page.evaluate(() => window.__itemActionDebug!.items().includes('cutter'))).toBe(true)
})

test('Boss 合法八件道具保持桌面机位', async ({ page }) => {
  await enterGame(page)
  await page.waitForFunction(() => Math.abs((window.__scene?.getCamera().fov ?? 0) - 48) < 0.2)
  const items: ItemId[] = ['magnifier', 'sedative', 'saw', 'magnet', 'handcuffs', 'aegis', 'dagger', 'hammer']
  for (const item of items) {
    const probe = await page.evaluate((item) => {
      const debug = window.__itemActionDebug!
      debug.preview(item, 'boss')
      debug.hold(true)
      debug.seek(1.8)
      return { status: debug.status(), probe: debug.probe() }
    }, item)
    expect(probe.status?.actor, item).toBe('boss')
    expect(probe.probe?.fov, item).toBeCloseTo(48, 0)
    await page.evaluate(() => { window.__itemActionDebug!.cancel(); window.__scene!.itemActions.dispose() })
  }
})
