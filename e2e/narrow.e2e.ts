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

    // sr-only 裁切的兜底控件子元素自身仍保留原始尺寸，跳过以免误报越界
    const insideSrOnly = (el: Element) => {
      let node: Element | null = el
      while (node && node !== document.body) {
        if (node.classList.contains('sr-only')) return true
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
      if (insideSrOnly(el)) continue
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
  await page.getByRole('button', { name: '知道了' }).click()
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
      await expectInsideViewport(page, page.getByRole('button', { name: '知道了' }))
      await expectInsideViewport(page, page.getByRole('button', { name: '查看完整血契' }))

      await page.getByRole('button', { name: '查看完整血契' }).click()
      const rules = page.getByRole('dialog', { name: '规则与图鉴' })
      await expect(rules).toBeVisible()
      report = await probeHorizontalOverflow(page)
      expect(report.offenders).toEqual([])
      await expectInsideViewport(page, page.getByRole('button', { name: '关闭 ESC' }))

      await page.getByRole('button', { name: '关闭 ESC' }).click()
      await expect(rules).toBeHidden()
    })

    test('桌沿按键与角落工具不越界也不重叠', async ({ page }) => {
      await page.goto('./')

      const start = page.getByRole('button', { name: '走进走廊', exact: true })
      // 走廊入口已改为点画面进入：DOM 按钮只是读屏兜底（sr-only），不参与布局越界检查
      await expect(start).toBeAttached({ timeout: 30_000 })
      await dismissGuide(page)
      await start.evaluate((el) => (el as HTMLElement).click())

      const leftDoor = page.getByRole('button', { name: '左门 · 血色底注' })
      await leftDoor.waitFor({ timeout: 60_000 })
      await leftDoor.evaluate((el) => (el as HTMLElement).click())

      // 要牌/停牌已改为场景内实体按键：投影到屏幕后再断言，
      // 不再取 DOM 按钮的 boundingBox（那只是无障碍兜底，恒在屏外裁切）
      await page.waitForFunction(
        () => (window as unknown as { __scene?: { canUseTableActions(): boolean } }).__scene?.canUseTableActions(),
        undefined,
        { timeout: 300_000 },
      )

      const keyRects = await page.evaluate(() => {
        interface Vec {
          clone(): Vec
          set(x: number, y: number, z: number): Vec
          applyMatrix4(matrix: unknown): Vec
          project(camera: unknown): { x: number; y: number }
        }
        interface Root {
          updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void
          position: Vec
          matrixWorld: unknown
        }
        const scene = (
          window as unknown as {
            __scene: {
              getCamera(): unknown
              actionButtons: Map<string, { root: Root }>
            }
          }
        ).__scene
        const cam = scene.getCamera()
        return [...scene.actionButtons].map(([action, button]) => {
          const root = button.root
          root.updateWorldMatrix(true, true)
          let left = Infinity
          let right = -Infinity
          let top = Infinity
          let bottom = -Infinity
          for (const sx of [-0.32, 0.32]) {
            for (const sy of [-0.045, 0.1025]) {
              for (const sz of [-0.22, 0.22]) {
                const v = root.position.clone().set(sx, sy, sz)
                v.applyMatrix4(root.matrixWorld)
                const p = v.project(cam)
                const x = ((p.x + 1) * window.innerWidth) / 2
                const y = ((1 - p.y) * window.innerHeight) / 2
                left = Math.min(left, x)
                right = Math.max(right, x)
                top = Math.min(top, y)
                bottom = Math.max(bottom, y)
              }
            }
          }
          return { action, left, right, top, bottom, cx: (left + right) / 2, cy: (top + bottom) / 2 }
        })
      })
      expect(keyRects.map((key) => key.action).sort()).toEqual(['hit', 'stand'])

      const hintBox = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[aria-live="polite"]')].find((node) =>
          node.textContent?.includes('桌沿键'),
        )
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      })

      const overlaps = (
        a: { left: number; right: number; top: number; bottom: number },
        b: { left: number; right: number; top: number; bottom: number },
      ) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

      for (const key of keyRects) {
        expect(key.left, `${key.action} 左边出界`).toBeGreaterThan(0)
        expect(key.right, `${key.action} 右边出界`).toBeLessThan(vp.width)
        expect(key.top, `${key.action} 上边出界`).toBeGreaterThan(0)
        expect(key.bottom, `${key.action} 下边出界`).toBeLessThan(vp.height)
        const tag = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
          { x: key.cx, y: key.cy },
        )
        expect(tag, `${key.action} 被 DOM 覆盖`).toBe('CANVAS')
      }
      // 首回合提示贴在按键下方，不能盖住键面
      if (hintBox) {
        for (const key of keyRects) expect(overlaps(hintBox, key)).toBe(false)
      }

      // 提示条消失后角落工具才回到同一条底边：此时不得压住实体键
      await page
        .waitForFunction(
          () =>
            ![...document.querySelectorAll('[aria-live="polite"]')].some((node) =>
              node.textContent?.includes('桌沿键'),
            ),
          undefined,
          { timeout: 20_000 },
        )
        .catch(() => {})

      const cornerChip = page.getByRole('button', { name: '规则 / 图鉴' })
      const volumeChip = page.getByRole('button', { name: /音量/ })
      const slider = page.getByLabel('主音量')
      for (const locator of [cornerChip, volumeChip, slider]) {
        await expectInsideViewport(page, locator, 'xy')
        const box = await locator.boundingBox()
        if (!box) continue
        const rect = { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height }
        for (const key of keyRects) expect(overlaps(rect, key), `${key.action} 被角落工具遮住`).toBe(false)
      }

      const report = await probeHorizontalOverflow(page)
      expect(report.docScrollWidth).toBeLessThanOrEqual(report.viewportWidth)
      expect(report.mainOverflow).toBeLessThanOrEqual(0)
      expect(report.offenders).toEqual([])
    })
  })
}
