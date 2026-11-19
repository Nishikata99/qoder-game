import { expect, test } from '@playwright/test'

test('首次进入 → 坐下 → 发牌 → 停牌 → 进入选择枪口', async ({ page }) => {
  await page.goto('./')

  // 首次访问必弹三句话引导
  const guide = page.getByRole('dialog', { name: '开局说明' })
  await expect(guide).toBeVisible()
  await page.getByRole('button', { name: '我知道了' }).click()
  await expect(guide).toBeHidden()

  await page.getByRole('button', { name: '坐下，开始交易' }).click()

  // 等发牌结束进入玩家回合，停牌交给对手
  await expect(page.getByText('你的行动')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: /停牌/ }).click()

  // 无论本轮谁赢，最终都要进入「选择枪口」
  await expect(page.getByText('选择枪口')).toBeVisible({ timeout: 120_000 })
})
