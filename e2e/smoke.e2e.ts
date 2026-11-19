import { expect, test } from '@playwright/test'

test('首次进入 → 坐下 → 发牌 → 停牌 → 进入选择枪口', async ({ page }) => {
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

  // 等发牌结束进入玩家回合，停牌交给对手
  await expect(page.getByText('你的行动')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: /停牌/ }).click()

  // 无论本轮谁赢，最终都要进入「选择枪口」
  await expect(page.getByText('选择枪口')).toBeVisible({ timeout: 120_000 })
})
