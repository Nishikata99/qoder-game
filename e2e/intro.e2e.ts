import { expect, test } from '@playwright/test'

test('入场不可跳过：黑边字幕逐拍出现，结束后 overlay 移除、牌桌可操作', async ({ page }) => {
  await page.goto('./')

  const start = page.getByRole('button', { name: '走进走廊', exact: true })
  await expect(start).toBeVisible({ timeout: 30_000 })
  const guide = page.getByRole('dialog', { name: '开局说明' })
  if ((await guide.count()) > 0) {
    await page.getByRole('button', { name: '坐上牌桌' }).click()
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

  // 第一句字幕：时钟 2.6s 起，软件渲染半速下真实约 5~8s
  await expect(page.locator('.narrative-subtitle')).toHaveText('这是哪儿……我怎么坐在这？', {
    timeout: 30_000,
  })
  // 打字机期间黑幕已升起（2.5s 拍点 black:0），不能盖死活画面
  const black = overlay.locator(':scope > div').first()
  await expect(black).toHaveCSS('opacity', '0', { timeout: 15_000 })

  // 40s 时钟在 fps≈10 时真实约 80s，留一倍余量
  await expect(overlay).toHaveCount(0, { timeout: 300_000 })
  await expect(page.getByRole('button', { name: /要牌/ })).toBeEnabled({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /跳过|skip/i })).toHaveCount(0)
})
