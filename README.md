# Blood Ante · 血色底注

第一人称 3D 暗黑桌面博弈游戏。恶魔轮盘 × 21 点 × 可扩展桌面小游戏，运行在同一个赌桌上。

**技术栈**：Vite 8 · TypeScript 7 · Three.js r187 · GSAP 3 · Tailwind CSS 4

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b + vite build，产物在 dist/
npm run preview    # 预览生产构建
```

## 玩法（当前骨架）

| 模块 | 交互 | 效果 |
| --- | --- | --- |
| 恶魔轮盘 | 点击桌面上的霰弹枪 | 实弹对手扣 2 血 + 震屏闪光；空包弹只有咔哒声 |
| 21 点 | 点击右上角牌堆 | 3D 发牌动画，玩家/对手各一排 |
| 模板 · 骰盅 | 点击骰盅 | 摇晃 → 点数判定 → 扣血，接入参考实现 |

`Esc` / `Tab` 呼出菜单，右上角「菜单」按钮同样可用。

## 架构

```text
核心场景底座（core）+ 独立 3D 游戏道具组（games/*/index.ts 返回 THREE.Group）
```

- `src/core/` — 共享 Scene / Camera / Renderer / 赌桌 / 状态 / 事件总线 / 模块注册中心
- `src/ui/` — Tailwind 悬浮 HUD 与菜单层，只读 store、订阅 bus
- `src/games/` — 每人一个文件夹，互不改动；模块通过 `Minigame` 接口接入

新增小游戏的完整步骤见 **[AGENTS.md](./AGENTS.md)**。

## 部署

`vite.config.ts` 固定 `base: './'`，`dist/` 可直接部署到任意静态托管（Qoder Sites、GitHub Pages 子路径均可）而不会出现资源 404。

## 目录

```text
public/
├── models/{shared,blackjack,buckshot-roulette}/   # .glb 按模块存放
└── audio/{shared,blackjack,buckshot-roulette}/    # 音效按模块存放
src/
├── core/     SceneManager · CameraController · GameStore · EventBus · GameRegistry
├── ui/       HudOverlay · LobbyOverlay
├── games/    blackjack · buckshot-roulette · template-minigame
├── main.ts
└── style.css
```
