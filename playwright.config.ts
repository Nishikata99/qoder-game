import { defineConfig } from '@playwright/test'

/** 冒烟测试跑生产构建：先在本地 npm run build，CI 里 build 步骤已在前 */
export default defineConfig({
  testDir: './e2e',
  // 用 .e2e.ts 后缀与 Vitest 的 *.spec.ts 区分，避免两个 runner 互相捡文件
  testMatch: '**/*.e2e.ts',
  testIgnore: '**/*.dev.e2e.ts',
  // 无头环境是软件渲染，引擎定时器会比真机慢一个数量级，超时给足
  timeout: 480_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  // 软件渲染下两个 WebGL 页面互抢 CPU：导演时钟随 fps 降速，并行时入场真实时长翻倍，
  // intro/smoke 的超时会被误判成回归。串行让每个用例独占渲染资源
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    reducedMotion: 'reduce',
    viewport: { width: 960, height: 640 },
    // 无头软件渲染按像素量计费：全分辨率只有 2~3fps，降到 0.25 约 10fps。
    // 布局断言只看 CSS 像素，降 DPR 不影响任何被测尺寸
    deviceScaleFactor: 0.25,
  },
  webServer: {
    // 显式绑定 127.0.0.1：CI 上 localhost 可能先解析到 ::1，导致探测一直超时
    command: 'npm run preview -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
