import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** 窄屏下真正会出问题的是横向：纵向超出由 overflow-hidden / 弹窗内滚动兜住 */
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
] as const

/**
 * 逐元素量横向越界。
 * 注意 main 带 overflow-hidden，document.scrollWidth 恒等于视口宽，
 * 光断言它抓不到任何问题，必须看元素自己的 getBoundingClientRect。
 * 弹窗内部靠 overflow-y-auto 滚动，其子元素算作「预期内」，跳过。
 */
function probeHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const insideScroller = (el: Element) => {
      let node = el.parentElement
      while (node && node !== document.body) {
        const style = getComputedStyle(node)
        const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll'
        if (scrolls && node.scrollHeight > node.clientHeight + 1) return true
        node = node.parentElement
      }
      return false
    }

    const offenders: { cls: string; text: string; left: number; right: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) continue
      if (rect.left >= -0.5 && rect.right <= vw + 0.5) continue
      if (insideScroller(el)) continue
      offenders.push({
        cls: String(el.className).slice(0, 60),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      })
    }

    // main 虽然 overflow-hidden，scrollWidth 仍反映内容宽度，能抓到右侧越界
    const main = document.querySelector('main')

    return {
      viewportWidth: vw,
      docScrollWidth: document.documentElement.scrollWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : 0,
      offenders,
    }
  })
}

/** 控件必须完整落在视口内：320 下曾经有两个按钮各出界 6px */
async function expectInsideViewport(page: Page, locator: Locator, axes: 'x' | 'xy' = 'x') {
  const box = await locator.boundingBox()
  expect(box, '控件应可见').not.toBeNull()
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  expect(box!.x, '左边不得出界').toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width, '右边不得出界').toBeLessThanOrEqual(width + 0.5)
  if (axes === 'xy') {
    expect(box!.y, '上边不得出界').toBeGreaterThanOrEqual(-0.5)
    expect(box!.y + box!.height, '下边不得出界').toBeLessThanOrEqual(height + 0.5)
  }
}

async function dismissGuide(page: Page) {
  const guide = page.getByRole('dialog', { name: '开局说明' })
  if ((await guide.count()) === 0) return
  await page.getByRole('button', { name: '我知道了' }).click()
  await expect(guide).toBeHidden()
}

for (const vp of VIEWPORTS) {
  test.describe(`窄屏 ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('引导卡与规则图鉴不越出横向边界', async ({ page }) => {
      await page.goto('./')

      await expect(page.getByRole('dialog', { name: '开局说明' })).toBeVisible({ timeout: 30_000 })
      let report = await probeHorizontalOverflow(page)
      expect(report.docScrollWidth).toBeLessThanOrEqual(report.viewportWidth)
      expect(report.mainOverflow).toBeLessThanOrEqual(0)
      expect(report.offenders).toEqual([])
      await expectInsideViewport(page, page.getByRole('button', { name: '我知道了' }))
      await expectInsideViewport(page, page.getByRole('button', { name: '看完整规则' }))

      await page.getByRole('button', { name: '看完整规则' }).click()
      const rules = page.getByRole('dialog', { name: '规则与图鉴' })
      await expect(rules).toBeVisible()
      report = await probeHorizontalOverflow(page)
      expect(report.offenders).toEqual([])
      await expectInsideViewport(page, page.getByRole('button', { name: '关闭 ESC' }))

      await page.getByRole('button', { name: '关闭 ESC' }).click()
      await expect(rules).toBeHidden()
    })

    test('牌桌操作栏与角落工具不越界也不重叠', async ({ page }) => {
      await page.goto('./')

      const start = page.getByRole('button', { name: '坐下，开始交易' })
      await expect(start).toBeVisible({ timeout: 30_000 })
      await expectInsideViewport(page, start, 'xy')
      await dismissGuide(page)
      await start.click()

      // 等引擎发完牌进入玩家回合；无头软件渲染下定时器很慢，给足超时
      const hit = page.getByRole('button', { name: /要牌/ })
      const stand = page.getByRole('button', { name: /停牌/ })
      await expect(hit).toBeEnabled({ timeout: 60_000 })

      for (const locator of [hit, stand]) {
        await expectInsideViewport(page, locator, 'xy')
      }

      const cornerChip = page.getByRole('button', { name: '规则 / 图鉴' })
      const volumeChip = page.getByRole('button', { name: /音量/ })
      const slider = page.getByLabel('主音量')
      for (const locator of [cornerChip, volumeChip, slider]) {
        await expectInsideViewport(page, locator, 'xy')
      }

      // 角落工具曾经压在「停牌」上：抬到操作栏上方后两者不能再重叠
      const [volumeBox, hitBox] = await Promise.all([
        volumeChip.boundingBox(),
        hit.boundingBox(),
      ])
      expect(volumeBox!.y + volumeBox!.height).toBeLessThanOrEqual(hitBox!.y)

      const report = await probeHorizontalOverflow(page)
      expect(report.docScrollWidth).toBeLessThanOrEqual(report.viewportWidth)
      expect(report.mainOverflow).toBeLessThanOrEqual(0)
      expect(report.offenders).toEqual([])
    })
  })
}
