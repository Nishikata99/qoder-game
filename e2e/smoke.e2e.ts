import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

test('首次进入 → 坐下 → 停牌 → 扣下扳机', async ({ page }) => {
  // 处决阶段只有约 2.9s，还会被平局重发牌推迟，轮询容易错过；
  // 用 MutationObserver 在页面里锁存，测试结束时再读标记
  await page.addInitScript(() => {
    const probe = window as unknown as { __fired?: boolean }
    probe.__fired = false
    const check = () => {
      if (document.body?.textContent?.includes('· 处决')) probe.__fired = true
    }
    const attach = () => {
      new MutationObserver(check).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      })
      check()
    }
    if (document.body) attach()
    else document.addEventListener('DOMContentLoaded', attach)
  })

  await page.goto('./')

  // 首次进入的引导卡片可能先遮住开始按钮：出现就关掉，没出现直接开始
  const start = page.getByRole('button', { name: '坐下，开始交易' })
  // 引导卡片和开始按钮在同一次渲染里出现，按钮始终在 DOM 中（被遮住也算 visible），
  // 不能用 .or() 断言二者之一——strict mode 会因为同时命中两个元素而报错
  await expect(start).toBeVisible({ timeout: 30_000 })

  const guide = page.getByRole('dialog', { name: '开局说明' })
  if ((await guide.count()) > 0) {
    await page.getByRole('button', { name: '我知道了' }).click()
    await expect(guide).toBeHidden()
  }

  await start.click()

  // 一直推进到枪响。生产构建不能传 ?seed，每轮结果随机：
  // 平局会重发牌回到「你的行动」，对手赢下回合会自动开枪，
  // 玩家赢下回合必须自己选枪口，否则引擎会一直等输入。
  // 无头软件渲染帧率很低时，Playwright 的 click() 连可操作性检查都过不去（事件一个都不派发），
  // 因此直接用 DOM click 驱动按钮：React 的 onClick 照常触发。
  const stand = page.getByRole('button', { name: /停牌/ })
  const fireAtBoss = page.getByRole('button', { name: /射向它/ })
  const domClick = async (locator: Locator) => {
    await locator.evaluate((el) => (el as HTMLElement).click()).catch(() => {})
  }
  const fired = () =>
    page.evaluate(() => Boolean((window as unknown as { __fired?: boolean }).__fired))

  const deadline = Date.now() + 110_000
  while (Date.now() < deadline) {
    if (await fired()) break
    if (await fireAtBoss.isVisible().catch(() => false)) {
      await domClick(fireAtBoss)
      await page.waitForTimeout(600)
    } else if ((await stand.count()) > 0 && (await stand.isEnabled().catch(() => false))) {
      await domClick(stand)
      // 等这一回合确实离开玩家回合，避免下一轮循环重复点击
      await page
        .waitForFunction(() => !document.body.textContent?.includes('· 你的行动'), undefined, {
          timeout: 5_000,
        })
        .catch(() => {})
    } else {
      await page.waitForTimeout(300)
    }
  }

  expect(await fired()).toBe(true)
})
