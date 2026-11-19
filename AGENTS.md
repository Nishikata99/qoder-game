# AGENTS.md

> 给全队 Qoder AI 与人类成员的协作规范。**先读完再动代码。**

## 项目

《Blood Ante · 血色底注》— 第一人称 3D 暗黑桌面博弈：21 点 × 恶魔轮盘 × 三关处决。
React 19 + TypeScript 7 + Three.js r187 + Tailwind CSS 4。所有贴图由 Canvas 2D 程序化生成，零外部美术资源。

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 仅类型检查
npm run preview    # 预览 dist
npm test           # Vitest 单元测试（引擎核心规则）
```

复现对局问题时，开发模式可加 `?seed=12345` 固定发牌与 AI 随机序列（仅 DEV 生效，生产构建始终用 `Math.random`）。

## 一、分层架构：三层，单向依赖

```text
src/
├── game/GameEngine.ts        【纯逻辑】规则状态机，不 import React / Three / DOM
├── scene/                    【表现层】只读 snapshot，输出画面
│   ├── SceneManager.ts       3D 场景、运镜、动画、3D 道具拾取
│   └── TextureFactory.ts     程序化贴图 + public/assets 热替换
├── audio/SoundEngine.ts      【音效】Web Audio 实时合成
├── components/               【桥接】
│   ├── GameCanvas.tsx        画布挂载 + 事件转发 + 道具浮窗
│   └── RulesModal.tsx        规则与道具图鉴
├── App.tsx                   【UI 覆盖层】HUD（状态/弹仓）、演出、结算、事件接线
└── index.css                 Tailwind 入口 + 做旧金属按钮等样式
```

依赖方向严格单向：`game` ← `scene` / `audio` ← `components` ← `App`。
**`game/GameEngine.ts` 不得 import 任何层级的东西**：它是纯逻辑状态机，不依赖 React / Three / DOM。注意它内部用 `setTimeout` 控制发牌、AI 思考与处决停顿，**测试时须配合假定时器（Vitest fake timers）或后续引入时钟注入**，不能直接按同步纯函数断言。

## 二、跨层契约（改动必须同步三处）

### `GameSnapshot` —— 引擎 → UI / 场景

```ts
{
  phase, levelIndex, level, round,
  player: ActorView, boss: ActorView,      // 含 hp / items / hand / visibleHand
  cylinder: CylinderView,                  // 剩余实弹/空弹、是否被放大镜窥视
  turn,
  pendingShot,                             // targeting 阶段持枪者；非该阶段为 null
  damageBonus, crisisStacks,               // damageBonus = 走火遗恨（永久叠加直到中弹）
  hourglassActive,                         // 本局沙漏反转为低分胜
  unlockedItems, inputLocked, log,
}
```

> 改字段时：`GameEngine.ts` 定义 → `SceneManager.applySnapshot` 消费 → `App.tsx` 展示，三处一起改。

### `GameEvent` —— 引擎 → 音效 / 演出

新增事件类型后，必须在 `App.tsx` 的 `handleEventSound` 里接音效、在 `GameCanvas.tsx` 的 `applyVisualEvent` 里接运镜，否则事件静默失效。

### 动作入口

所有玩家意图只能走引擎方法：`hit()` / `stand()` / `useItem(id)` / `chooseTarget(target)` / `restart()` / `advanceLevel()`。
**禁止在 UI 或场景里改血量、手牌、弹仓。**

### 手牌点数（台面贴片，不进 HUD）

点数由 `SceneManager.buildScorePlates` 的两块贴地 Canvas 贴片直接画在台呢上：`syncScores()` 按 `visibleHand.visible` 过滤暗牌后调 `evaluateHand`，只在「点数/软牌/黑杰克/爆牌/停牌/暗牌」组合变化时重绘并做一次缩放脉冲。HUD 的 `ActorPanel` 只剩状态与道具数，**血量由 3D 血袋显示，不要再往面板里加点数或血条**。贴片避开卡牌/道具/血袋架/牌堆：玩家在 `(0, 1.52)` 平贴台呢；Boss 在对面右侧 `(1.5, -1.15)`，按 `SCORE_PLATE_TILT` 立起 ~0.5rad 并 yaw 朝主镜头（`SCORE_PLATE_VIEW`），抬高半高让近边贴着台呢——远侧平贴会被透视压扁，读数极差；枪身占满中央横带，别把 Boss 贴片放回中间。两块都画一圈椭圆印刷线当台呢标记，暗牌显示 `+ ?`，爆牌以划叉标记。改位置/缩放/倾角都要按真实游戏镜头截图确认，不能只看俯视。

### 血量（3D 血袋，不进 HUD）

每格生命对应架上一只血袋：`syncBlood()` 以 `ActorView.maxHp` 决定袋数、`hp` 决定注满的袋数，掉血从右往左排空、回血重新注满；`maxHp` 变化时整架重建。位置/尺寸集中在 `BLOOD_RACK_LAYOUT`（玩家小架在桌面左前角，Boss 落地架在左后侧），单袋液体盒高度取满袋液高，`liquid.scale.y` 就是填充比例——**不要把液体几何高度写成 1 再用 scale 当比例**，会变成一米高的红板。细管（汇流管→各自身体）挂在独立 `extra` 组里用世界坐标，换架时随 `rack.extra` 一并销毁。改布局后必须按真实游戏镜头截图确认双方都能读出剩余袋数。

## 三、规则要点（易踩坑）

| 规则 | 实现位置 | 注意 |
| --- | --- | --- |
| 对手 1 明 1 暗 | `withHoleCard()` / `ActorView.visibleHand` | 点数额始终按真实手牌算，只隐藏**显示**；亮牌在 `settleRound` 开头。`withHoleCard` 必须每次从 `cards` 重建 `visible`——若 hidden=false 时直接返回原对象，暗牌就永远翻不回来 |
| 战斗日志 | `dealTo()` / `App.tsx` 的 `LogPanel` | HUD 只显示最后 3 条。对手暗牌发下时日志写「它扣下一张暗牌」，**不能**写牌面与点数；亮牌时在 `settleRound` 补「亮出底牌」 |
| 枪口选择 | `phase='targeting'` + `chooseTarget()` | 只有玩家持枪才等输入；Boss 持枪由 `chooseBossTarget()` 自动决定。台面点数贴片必须按 `visible` 手牌重新计算，不能用 `visibleHand.total`（那是真实点数） |
| 伤害公式 | `resolveShot()` | 实弹基础 2 + 黑杰克 1 + 碾压（赢家手牌≥20）1 + 遗恨 N，锯子整体 ×2；空膛 0 |
| 锯子翻倍 | `sawBoost` | 不是 +1，是**整体翻倍**；只在**真的打出实弹**时消耗，空膛不浪费 |
| 空膛对己 | `resolveShot()` 的 `selfShot` 分支 | 空膛摸一件道具（`chamberRecovered` 事件）；实弹则伤害打在自己身上 |
| 磁铁换明牌 | `applyItem` 的 `magnet` 分支 | **必须换明牌**：Boss 的明牌是第 1 张（第 2 张是暗牌），玩家取最后一张；换完立刻亮底牌 |
| 沙漏低分胜 | `settleRound` + `bossTarget()` | 爆牌**永远**直接判负；沙漏生效时 AI 立即停牌（再摸只会把自己推高） |
| 匕首重洗 | `applyItem` 的 `dagger` 分支 | 手牌必须立即重发，否则 0 对 0 卡死回合 |
| 走火遗恨 | `damageBonus` | 永久叠加；只有**真的中弹**才清零（包括对自己开枪） |
| 弹仓 | `Cylinder.reload()` | 4~6 发、实弹 2~3 发；打空才重装 |

`LEVELS` 里 `hp` 是对手生命、`playerHp` 是玩家生命，二者每层重置。改数值只动这一处。

## 四、3D 场景约定

- 桌面高度常量 `TABLE_TOP`，所有桌上物件 y 从它起算。
- `gaming_table.glb` 的台呢面在模型自身 y=0，加载后整体抬到 `TABLE_TOP`；**改桌高只改 `TABLE_TOP` 一处**。
- `room_environment.glb` 以世界原点为地面（y=0），顶棚 `CEILING_Y = 6.0`；吊灯构件单独拆给 `lampRig` 保留摆动。
- **聚光灯必须挂在灯罩下沿（`LAMP_SHADE_BOT_Y`）**，放罩体内会被罩壁完全遮挡，桌面出现一大片黑斑。
- **Boss 半身像必须含完整躯干**：`boss_*.glb` 的包围盒是 W≈1.6–1.8m、H≈2.0–2.6m、D≈0.8–1.3m，底座在自身 y=0。只有头/兜帽的模型按高度归一化后会变成 3m 宽的巨脸，必须重做而不是缩放。
- **`BOSS_Z = -3.0`**：桌体后沿 z=-2.23，斗篷前沿约 0.55m，中心必须在 -2.78 之后；`BOSS_BUST_BASE_Y = 0.26` 让下摆被桌沿挡住，形成“坐在桌后”。
- Boss 的呼吸/盯视作用在 `bossGroup`（整体）与 `bossHeadNode`（`BossHead` 节点）上，模型面朝 +Z，`rotation.y` 即左右转。
- **冷色轮廓光强度上限约 10**：高于此值整个躯干会被照成一块蓝板，失去剪影感。
- 卡牌材质数组顺序：`[side, side, 朝上面, 朝下面, side, side]`；`rotation.x = Math.PI` 表示翻面。
- 道具拾取：`raycaster` → 沿 `parent` 找 `userData.item` → `callbacks.onItemClick`。
- 血袋架布局集中在 `BLOOD_RACK_LAYOUT`；玩家架占桌面左前角，Boss 架落地在左后侧，袋口高度要露出桌沿之上。
- 运镜用 `setShot(shot, duration)`，不要直接改 `camera.position`。
- **枪口朝向**：`gunAim` 是枪的瞄准枢轴，执行阶段由 `updateGunAim` 算 yaw/pitch 指向 `BOSS_HIT_POINT` 或镜头；枪口火光、膛内提示也挂在它下面。不要再动 `gunGroup.rotation.y` 摆枪。换 GLB 时占位枪要用 `removeFromParent()` 摘下（它挂在 `gunAim` 下，`gunGroup.remove` 摘不到，会叠成两把枪）。枪口火光位置从模型 `MuzzlePoint` 计算，装填时推拉 `PumpSlide`，不要再假设火光固定在 -1.06。
- 实弹命中 Boss 时 `spawnBlood(BOSS_HIT_POINT)` 生成血珠 + 血雾 + 瞬时光，并触发 `knockBossDown()`：`bossKnock`（0..1）叠加在呼吸动画上把整个 `bossGroup` 压下去，停一拍再缓慢起身，用 generation 计数取消上一轮起身 tween。
- 玩家中弹是纯 DOM 覆盖层：`.blood-splatter` 血斑 + `.vision-blur`（`backdrop-filter`，只糊画布，HUD 保持清晰），在 `App.tsx` 的 `handleEventSound` 里由实弹事件驱动；不要用后期处理去做模糊。
- **Blender 程序化节点图无法导出到 glTF**：噪声/渐变接 Base Color 会被压成纯白。要么把颜色烘焙进顶点色（`COLOR_0`），要么只给 Principled 一个平涂 Base Color；后者导出为 `baseColorFactor`，**是线性色值**，游戏里还会再乘 0.42，按 `目标线性色 ÷ 0.42` 反推，否则会像白模。

## 五、美术资源热替换

### 3D 模型（`public/models/*.glb`，13 个在用）

| 文件 | 用途 | 约束 |
| --- | --- | --- |
| `gaming_table.glb` | 重型钢板赌桌 | 台呢面在模型 y=0；场景里抬到 `TABLE_TOP` |
| `room_environment.glb` | 地下铁皮密室 + 工业吊灯 | 地面在 y=0；吊灯节点名以 `Lamp` 开头 |
| `shotgun.glb` | 泵动霰弹枪 | 枪口朝 glTF -Z；`MuzzlePoint` 空物体标定枪口（火光位置），`PumpSlide` 是装填动画推拉节点 |
| `boss_1/2/3.glb` | 三层半身像（完整躯干） | 面朝 +Z，底部中心为原点，头部节点名 `BossHead` |
| `item_*.glb` | 7 件桌面道具 | 尺寸 0.15–0.30m，底部 z=0 |

缺文件时自动回退程序化几何（控制台 warn，不报错）。

### 贴图覆盖（`public/assets/`，仅开发模式）

| 文件 | 用途 |
| --- | --- |
| `card-back.png` | 卡牌背面 |
| `mask-1.png` / `mask-2.png` / `mask-3.png` | 三层 Boss 面具（建议透明通道） |
| `table.png` | 桌面锈迹 |

删除文件即回退程序化贴图。

## 六、部署

`vite.config.ts` 固定 `base: './'`，**不要改**。`dist/` 可直接部署到任意静态托管（Qoder Sites / GitHub Pages 子路径），不会资源 404。

## 七、Git 分工流程

远端：`https://github.com/Nishikata99/qoder-game`（公开发布分支 `main`）。

每位成员一个长期分支，禁止直推 `main`：

```bash
git checkout -b feat/blackjack-ui     # 例：21 点 HUD 改造
git checkout -b feat/sound-pass       # 例：音效统一调音
```

日常：

```bash
git fetch origin
git rebase origin/main
git add src/<改动范围>
git commit -m "feat(<范围>): <说明>"
git push -u origin <分支名>
```

- 从 `main` 开 PR，标题 `feat(<范围>): <说明>` / `fix(<范围>): <说明>`
- **`main` 已开启分支保护**：必须走 PR、必须通过 `build` 检查、至少 1 个 review、禁止强推与删除
- 队长（仓库管理员）保留绕过权限，用于紧急修复
- 合并前 `npm run build` 必须通过
- 冲突高发区：`game/GameEngine.ts` 与 `App.tsx`，改契约前先在群里对齐

### 认证

凭据由 `gh` 作为 git credential helper 提供，**无需令牌，不要向任何人索要 PAT**。

## 八、新人上手（第一台新电脑必读）

```bash
git clone https://github.com/Nishikata99/qoder-game.git
cd qoder-game
npm install
npm run dev        # 打开 http://localhost:5173 确认能跑
```

### 三个会让人以为"仓库坏了"的坑

**1. `git push origin main` 被拒绝**

这是分支保护生效，**不是权限问题**。`main` 只能通过 PR 合入：

```bash
git checkout -b feat/<你的功能>
git commit -m "feat(scope): 说明"
git push -u origin feat/<你的功能>
# 然后在 GitHub 页面点 Compare & pull request
```

**2. 第一次 `git status` 显示几十个文件被改动**

Windows 的 `core.autocrlf=true` 与仓库的 LF 存储冲突。**不要提交这些改动**，执行一次即可消除：

```bash
git add --renormalize .
git status
```

若仍有残留，检查 `git config core.autocrlf` 应为 `true`（检出时转 CRLF 是正常的，仓库内始终存 LF）。

**3. `npm install` 报 `csstype` 404**

上游 `csstype@3.2.4` 的 tarball 曾发布损坏。`package.json` 已用 `overrides` 钉到可用的 `3.2.3`，不要删掉这段配置。

### `package-lock.json` 冲突不要手工合并

两人同时装包导致的 lock 冲突，手工解必然出错。正确做法：

```bash
git checkout --theirs package-lock.json   # 或 --ours，选一个
rm -rf node_modules
npm install
git add package-lock.json
```

### 提交前自检

```bash
npm run build      # 必须通过，否则 PR 的 build 检查会红
```

CI 在 PR 上会自动跑 `npm ci && npm test && npm run build`，红色 PR 无法合并。

## 九、代码风格

- TypeScript `strict` 已开启；不要用 `any`、`@ts-ignore`
- 不留 `console.log`；`console.warn/error` 只用于真正的异常分支，设计内的降级（如 GLB 缺失回退程序化几何）用 `console.debug`
- 注释只写「为什么」，不写「做了什么」
- 演出节奏：发牌 340ms、AI 思考 620–900ms、处决停顿 2.9s；不要随手改这些时长
