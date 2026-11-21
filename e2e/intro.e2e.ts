import { expect, test } from '@playwright/test'

test('首见入场不可跳过；已看过后出现跳过入口', async ({ page }) => {
  await page.addInitScript(() => {
    // 首见：清掉已读标记，确保这一轮必须完整播放
    try {
      window.localStorage.removeItem('blood-ante.narrativeSeen.intro')
    } catch {
      // 隐私模式下无法清理，交给后续断言兜底
    }
  })
  await page.goto('./')

  const start = page.getByRole('button', { name: '走进走廊', exact: true })
  await expect(start).toBeVisible({ timeout: 30_000 })
  const guide = page.getByRole('dialog', { name: '开局说明' })
  if ((await guide.count()) > 0) {
    await page.getByRole('button', { name: '知道了' }).click()
    await expect(guide).toBeHidden()
  }
  await start.click()

  // 走廊序章：约 11s 前进结束后出现门按钮（软件渲染时钟半速会更长），点右门进黑场与入场
  const rightDoor = page.getByRole('button', { name: '右门' })
  await rightDoor.waitFor({ timeout: 60_000 })
  await rightDoor.evaluate((el) => (el as HTMLElement).click())

  const overlay = page.getByTestId('narrative-overlay')
  await expect(overlay).toBeVisible()
  // 任何时刻都不存在跳过入口
  await expect(page.getByRole('button', { name: /跳过|skip/i })).toHaveCount(0)

  // 第一句字幕：时钟 1.8s 起；实时时钟下不再等半速
  await expect(page.locator('.narrative-subtitle')).toHaveText('这是哪儿……我怎么坐在这？', {
    timeout: 30_000,
  })
  // 打字机期间黑幕已升起（2.5s 拍点 black:0），不能盖死活画面
  const black = overlay.locator(':scope > div').first()
  await expect(black).toHaveCSS('opacity', '0', { timeout: 15_000 })

  // 40s 时钟按真实时间推进（实时时钟 + 0.25s 上限），软件渲染下不再成倍慢放
  await expect(overlay).toHaveCount(0, { timeout: 120_000 })
  await expect(page.getByRole('button', { name: /要牌/ })).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /跳过|skip/i })).toHaveCount(0)
})

test('已看过后重新进入：出现跳过本段，点击直接交出控制权', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('blood-ante.narrativeSeen.intro', '1')
      window.localStorage.setItem('blood-ante.guideSeen', '1')
    } catch {
      // 隐私模式下跳过入口不会出现，测试退化为超时失败，属于预期
    }
  })
  await page.goto('./')

  const start = page.getByRole('button', { name: '走进走廊', exact: true })
  await expect(start).toBeVisible({ timeout: 30_000 })
  await start.click()

  const rightDoor = page.getByRole('button', { name: '右门' })
  await rightDoor.waitFor({ timeout: 60_000 })
  await rightDoor.evaluate((el) => (el as HTMLElement).click())

  const skip = page.getByRole('button', { name: '跳过本段' })
  await expect(skip).toBeVisible({ timeout: 30_000 })
  await skip.click()
  await expect(page.getByTestId('narrative-overlay')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByRole('button', { name: /要牌/ })).toBeEnabled({ timeout: 30_000 })
})
