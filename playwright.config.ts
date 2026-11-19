import { defineConfig } from '@playwright/test'

/** 冒烟测试跑生产构建：先在本地 npm run build，CI 里 build 步骤已在前 */
export default defineConfig({
  testDir: './e2e',
  // 用 .e2e.ts 后缀与 Vitest 的 *.spec.ts 区分，避免两个 runner 互相捡文件
  testMatch: '**/*.e2e.ts',
  // 无头环境是软件渲染，引擎定时器会比真机慢一个数量级，超时给足
  timeout: 180_000,
  fullyParallel: false,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    viewport: { width: 960, height: 640 },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
