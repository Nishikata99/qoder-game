import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

test('首次进入 → 坐下 → 连续停牌 → 扣下扳机', async ({ page }) => {
  // 处决阶段只有约 2.9s，还会被平局重发牌推迟，轮询容易错过；
  // 用 MutationObserver 在页面里锁存，测试结束时再读标记
  await page.addInitScript(() => {
    localStorage.setItem('blood-ante.narrativeSeen.intro', '1')
    localStorage.setItem('blood-ante.narrativeSeen.restart', '1')
    localStorage.setItem('blood-ante.guideSeen', '1')
    localStorage.setItem('blood-ante.hint.firstTurn', '1')
    const probe = window as unknown as { __fired?: boolean }
    probe.__fired = false
    const check = () => {
      if (document.body?.textContent?.includes('· 开枪')) probe.__fired = true
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

  await page.goto('./?skipcutscene=1')

  const start = page.getByRole('button', { name: '走进走廊', exact: true })
  await expect(start).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog', { name: '开局说明' })).toHaveCount(0)

  await start.evaluate((el) => (el as HTMLElement).click())

  const leftDoor = page.getByRole('button', { name: '左门 · 开始新局（清除旧检查点）' })
  await leftDoor.waitFor({ timeout: 60_000 })
  await leftDoor.evaluate((el) => (el as HTMLElement).click())

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

  let remainingBeforeShot = Number(await page.locator('main').getAttribute('data-cylinder-remaining'))

  // CI 软件渲染比本地慢数倍，轮询预算要留到接近用例总超时
  const deadline = Date.now() + 420_000
  while (Date.now() < deadline) {
    if (await fired()) break
    if (await fireAtBoss.isVisible().catch(() => false)) {
      remainingBeforeShot = Number(await page.locator('main').getAttribute('data-cylinder-remaining'))
      await domClick(fireAtBoss)
      await page.waitForTimeout(600)
    } else if ((await stand.count()) > 0 && (await stand.isEnabled().catch(() => false))) {
      remainingBeforeShot = Number(await page.locator('main').getAttribute('data-cylinder-remaining'))
      await domClick(stand)
      // 双轮停牌确认会在 Boss 行动后重新回到玩家回合，下一轮循环继续停牌
      await page.waitForTimeout(300)
    } else {
      await page.waitForTimeout(300)
    }
  }

  expect(await fired()).toBe(true)
  await page.waitForFunction(
    (remaining) => {
      const main = document.querySelector('main')
      return main?.getAttribute('data-engine-phase') !== 'execution' &&
        Number(main?.getAttribute('data-cylinder-remaining')) < remaining
    },
    remainingBeforeShot,
    { timeout: 60_000 },
  )
})

test('运行时错误显示可恢复提示', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('button', { name: '走进走廊', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'E2E 运行时错误探针' }))
  })
  await expect(page.getByRole('status')).toHaveText('游戏遇到运行时错误，请刷新后重试。')
})

test('第一批外置音效全部可下载并解码', async ({ page }) => {
  await page.goto('./')
  const files = [
    'sfx/shotgun-blast.mp3',
    'sfx/shotgun-reload.mp3',
    'sfx/shotgun-pump.wav',
    'sfx/chamber-click.mp3',
    'sfx/card-shuffle.wav',
    'sfx/cards-table.mp3',
    'sfx/paper-rustle.mp3',
    'sfx/hammer-hit.wav',
    'sfx/glass-clink.wav',
    'sfx/door-close.wav',
    'sfx/heartbeat-single.wav',
    'sfx/heartbeat-fast.wav',
    'audio/room-tone.mp3',
  ]
  const decoded = await page.evaluate(async (paths) => {
    const context = new AudioContext()
    try {
      return await Promise.all(paths.map(async (path) => {
        const response = await fetch(`./${path}`)
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
        const buffer = await context.decodeAudioData(await response.arrayBuffer())
        return { path, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels }
      }))
    } finally {
      await context.close()
    }
  }, files)
  expect(decoded).toHaveLength(files.length)
  for (const item of decoded) {
    expect(item.duration, item.path).toBeGreaterThan(0.05)
    expect(item.sampleRate, item.path).toBeGreaterThanOrEqual(22_000)
  }
  expect(decoded.find((item) => item.path === 'audio/room-tone.mp3')?.duration ?? 0).toBeGreaterThan(30)
})
