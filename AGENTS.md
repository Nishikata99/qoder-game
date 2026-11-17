# AGENTS.md

> 给全队 Qoder AI 与人类成员的 3D 协作开发规范。**先读完再动代码。**

## 项目

《Blood Ante · 血色底注》— 第一人称 3D 暗黑桌面博弈游戏（恶魔轮盘 × 21 点 × 可扩展桌面小游戏）。
技术栈：Vite 8 + TypeScript 7 + Three.js r187 + GSAP 3 + Tailwind CSS 4。

```bash
npm run dev        # 开发服务器（默认 5173）
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 仅类型检查
npm run preview    # 预览 dist
```

## 一、目录归属：每人只改自己的文件夹

```text
src/
├── core/                    【3D 核心底座】⚠️ 全员共用，禁止随意修改
│   ├── SceneManager.ts      Scene / Renderer / 灯光 / 赌桌几何
│   ├── CameraController.ts  第一人称鼠标微晃 + GSAP 视角预设
│   ├── GameStore.ts         血量 / 筹码 / 回合 / 道具栏（唯一状态源）
│   ├── EventBus.ts          全局事件总线（带类型契约）
│   └── GameRegistry.ts      小游戏挂载/卸载中心
├── ui/                      【2D 悬浮层】改动需通知 UI 负责人
│   ├── HudOverlay.ts        血量条 / 道具栏 / 字幕 / 准星
│   └── LobbyOverlay.ts      模式菜单 / 结算弹窗 / 视角预设按钮
├── games/                   【业务隔离区】⭐ 只改自己那一份
│   ├── blackjack/           成员 A
│   ├── buckshot-roulette/   成员 B
│   └── template-minigame/   成员 C/D 接入模板
└── main.ts                  总入口（注册表装配、事件接线）
```

**提交 PR 时，`src/games/<你的模块>/` 之外的文件应尽量不出现 diff。**
确实需要改 `core/`、`ui/`、`main.ts`（例如新增全局事件、注册表接口变化）时，必须在 PR 描述里注明「跨层契约变更」，并同步更新本文件。

## 二、小游戏怎么接入（唯一标准姿势）

1. 复制 `src/games/template-minigame/` → `src/games/<your-game>/`
2. 实现 `Minigame` 接口（见 `src/core/GameRegistry.ts`）：

```ts
export interface Minigame {
  readonly id: string            // 与文件夹名保持一致，如 'poker-dice'
  readonly title: string         // 菜单展示名
  build(ctx: MinigameContext): THREE.Group | Promise<THREE.Group>
  update?(dt: number, elapsed: number): void
  dispose?(): void               // 只需释放自己额外持有的资源
}
```

3. 在 `src/main.ts` 里 `registry.register(new YourGame())`
4. 在 `src/main.ts` 的 `games` 数组加一条菜单项（`status: 'ready' | 'wip'`）

### 坐标系约定（重要）

- 你返回的 `THREE.Group` 原点 = **赌桌绒布表面中心**，`y = 0` 就是桌面。
- 桌面可玩半径约 **2.2**（单位=米），UI 遮挡区在屏幕底部约 1/4。道具尽量放在半径 1.2 内。
- Run `registry` 会自动做入场缩放动画，**不要再自己写挂载动画**。

## 三、硬性禁止

| 禁止 | 原因 |
| --- | --- |
| `new THREE.WebGLRenderer()` | 全队共用一个 renderer |
| `new THREE.PerspectiveCamera()` / `new THREE.Scene()` | 共用同一台相机与场景 |
| 修改 `sceneManager.tableRoot` 下的赌桌 mesh | 属于核心底座资产 |
| 直接改别人 `src/games/<other>/` 的代码 | 业务隔离，冲突高发 |
| 在代码里写 `/models/...` 绝对路径 | 部署到子路径会 404，必须 `./models/...` |
| `window.addEventListener('click' ...)` 处理场景点击 | 会误吃 UI 点击；请判断 `event.target instanceof HTMLCanvasElement` |

## 四、必须通过契约通信

### 状态读写 —— `ctx.store`（GameStore）

```ts
ctx.store.snapshot                       // 只读快照
ctx.store.damage('opponent', 2)          // 返回 { applied, hp }
ctx.store.heal('player', 1)
ctx.store.nextTurn()                     // 内部会 round += 1
ctx.store.addChips(3)
```

**不要在小游戏里自己维护一份血量/回合副本。** 所有界面显示都来自 `GameStore`。

### 事件上报 —— `ctx.bus`（EventBus）

```ts
ctx.bus.emit('battle:damage', { side: 'player', amount: 2, reason: '实弹' })
ctx.bus.emit('fx:shake', { intensity: 0.5, duration: 0.5 })
ctx.bus.emit('fx:flash', { color: '#ff5a3c' })
ctx.bus.emit('ui:subtitle', { text: '爆牌', duration: 2 })
ctx.bus.emit('battle:result', { gameId: 'blackjack', winner: 'player', summary: '庄家爆牌' })
```

> ⚠️ `store.damage()` **不会**自动广播事件：需要 HUD 弹出伤害数字、触发震屏时，必须显式 `emit('battle:damage')` 与 `emit('fx:...')`（参考 `buckshot-roulette`）。

新增事件类型 → 在 `src/core/EventBus.ts` 的 `BattleEvents` 里加字段，这是**跨层契约变更**，需在 PR 里说明。

### 运镜 —— `ctx.cameraController`

```ts
ctx.cameraController.goto('aim', 0.4)     // 'table' | 'opponent' | 'aim'
```

不要在游戏里直接设置 `camera.position`。

## 五、资源与部署

- `vite.config.ts` 已固定 `base: './'`，**不要改**。
- 模型放 `public/models/<你的模块>/xxx.glb`，音效放 `public/audio/<你的模块>/`。
- 加载示例：

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const loader = new GLTFLoader()
const gltf = await loader.loadAsync('./models/blackjack/chip-tower.glb')  // 相对路径
```

- `.gitignore` 已忽略 `node_modules/`、`dist/`、`.DS_Store`，**不要提交构建产物**。

## 六、Git 分工流程

远端：`https://github.com/Nishikata99/qoder-game`（公开发布分支为 `main`）。

每位成员一个长期分支，禁止直接推 `main`：

```bash
git checkout -b feat/blackjack        # 成员A
git checkout -b feat/buckshot         # 成员B
git checkout -b feat/new-minigame     # 成员C/D
```

日常：

```bash
git fetch origin
git rebase origin/main          # 保持线性历史，减少冲突
git add src/games/<你的模块>/
git commit -m "feat(blackjack): 发牌动画落地"
git push -u origin feat/blackjack
```

- 从 `main` 开 PR，标题格式：`feat(<模块>): <说明>` / `fix(<模块>): <说明>`
- 合并前必须 `npm run build` 通过（含 `tsc -b` 类型检查）
- 冲突高发区：`src/main.ts`（注册表）—— 新增模块只在 `register(...)` 与 `games` 数组各加一行，避免整块重排

### 认证

凭据由 `gh` 作为 git credential helper 提供，**无需令牌，不要向任何人索要 PAT**。推送前可先 `gh auth status` 确认。

## 七、代码风格

- TypeScript `strict` 已开启；不要用 `any`、`@ts-ignore`
- 不要留 `console.log` 调试代码（`console.warn/error` 用于异常分支可以）
- GSAP 动画统一用 `power2/3`、`back.out` 系缓动，时长 0.2–0.9s
- 新增注释只写「为什么」，不写「做了什么」
