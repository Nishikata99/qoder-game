# BOSS 倒地 / 起身动作系统执行方案

- 文档状态：G0–G7 已完成（G3–G7 待人工验收），分支待推送 / 开 PR
- 基线：`main @ 374f6a4`（2026-11-22）
- 建议分支：`feat/boss-getup-pose`（当前工作分支）
- 建议 PR 标题：`feat(scene): Boss 倒地与起身姿态状态机`
- 范围：只改表现层；`GameEngine.ts` 零改动；第一阶段不新增 GLB

---

## 0. 一句话目标

把 Boss 现在“整体下压后弹回”的单一 tween，替换成一套可中断、可分级、每关独立的 **倒地 → 趴伏 → 撑起 → 直身 → 回稳** 姿态状态机；致死命中保持倒地直到切层，普通命中完整起身。

---

## 1. 已确认的决策

| # | 决策 | 结果 |
| --- | --- | --- |
| 1 | 致死命中是否保持倒地到切层 | **是**。清层横幅、补给、胜利结算期间都不起身 |
| 2 | 是否允许每关不同起身形态 | **是**。L1 人形、L2 低伏体、L3 倒吊体分别定义 profile |
| 3 | 先程序化还是直接做 Blender 剪辑 | **先程序化**，通过真实镜头验收动作节奏后，再评估骨骼动画升级 |

---

## 2. 现状审查结论

### 2.1 没有 Boss 姿态状态机

引擎侧只有 `Phase` 状态机（`idle` / `execution` / `levelClear` / ...），Boss 的表现层只有一个标量：

- `bossKnock: 0..1`（`SceneManager.ts:548`）
- `knockBossDown()` 用两段 tween 把它推到 1 再拉回 0（`SceneManager.ts:1399`）
- `updateBoss()` 直接把标量乘到整体位移和旋转上（`SceneManager.ts:2312-2320`）

结果：没有“段落”，没有姿态层，没有每关差异，也无法表达“死亡后不再起身”。

### 2.2 玩家看到“平躺→直接起立”的直接原因

1. **致死命中仍按普通命中起身**：`playShot()` 不检查 `hpAfter`，所有实弹命中都调用 `knockBossDown()`（`SceneManager.ts:1337-1347`）。`levelClear` 在命中后 1.5s 切到胜利远景（`GameEngine.ts:1287`、`GameEngine.ts:1305`），Boss 会在横幅期间站回来。
2. **倒地姿态被桌面遮没**：L1 高 2.15m、底座 0.26m；`knock=1` 时整体下沉 0.72m、后仰 0.82rad，头顶约 **0.92m**，低于 `TABLE_TOP = 0.98`。桌面机位下几乎完全消失，随后又整块拔起，所以看起来像“从地上直接站起”。
3. **起身是刚体回弹**：没有手撑、肩起、抬头、重心回正的分段。
4. **倒地期间头部仍在扫视**：`updateBoss()` 在应用 knock 之后仍无条件写 `bossHeadNode` 的 yaw/pitch（`SceneManager.ts:2344-2350`），削弱了“失去意识/趴伏”的读感。

### 2.3 两个健壮性问题

- `knockBossDown()` 的冲击段写 `bossKnock = easeOutCubic(t)`，起点恒为 0；如果在起身途中再次中弹，会先瞬间弹直再重新倒下（`SceneManager.ts:1406`）。
- 切层/重开没有显式重置姿态；`applyLevel()` 只换灯色（`SceneManager.ts:3388`），缺少“旧 Boss 倒地状态绝不泄漏到新 Boss”的保证。

### 2.4 资源事实

| 模型 | 动画 | 骨骼 | 可用节点 | 约束 |
| --- | --- | --- | --- | --- |
| `boss_1.glb` | 0 | 0 | `Arm.L`、`Arm.R`、`BossHead`、`Leg.L/R`、`Torso` 六个独立 mesh | 节点无 transform，几何坐标烘焙在世界空间；直接旋转会绕脚底原点 |
| `boss_2.glb` | 0 | 0 | `Boss2_Root` + `BossHead` | 只能整体 + 头部，不能做手臂支撑 |
| `boss_3.glb` | 0 | 0 | `Boss3_SuspensionRoot` + `BossHead` | 倒吊体，不能做地面翻滚，只能摆荡/收轨 |

结论：第一阶段用现有节点做程序化姿态；`boss_1` 的手/头需要运行时包一层肩/颈枢轴；`boss_2/3` 不做手臂动作。

---

## 3. 方案总览

### 3.1 分层

```text
GameEngine（不改）
  └─ GameEvent: shot(hpAfter/damage) / levelClear / gameOver
       └─ SceneManager（只读事件，驱动表现）
            ├─ BossPose.ts（新，纯逻辑状态机）
            ├─ 把采样值应用到 bossGroup / BossHead / Arm.*
            └─ SceneCallbacks.onBossPoseCue → App → SoundEngine（可选音效）
```

### 3.2 状态机

```text
idle ──实弹命中──> impact ──> collapse ──> prone ──> brace ──> push ──> rise ──> recover ──> idle
idle/任意 ──实弹命中且 hpAfter <= 0──> impact ──> collapse ──> deadProne（保持）
层切换 / 重开 / retry ──> spawn ──> idle
```

优先级：`deadProne` > `collapse` > 起身各段 > `idle`。

### 3.3 动作片段

| 片段 | 时长 | 曲线 | 表现 |
| --- | --- | --- | --- |
| `boss_impact` | 0.12s | easeOutCubic | 头胸后挫，肩线压缩 |
| `boss_collapse` | 0.45–0.60s | easeInCubic | 髋部枢轴前扑/侧塌，落点带 3%–5% 过冲 |
| `boss_prone_idle` | 0.70–1.10s | 循环 | 呼吸压到 25%，头部下垂，衣摆/手臂微颤 |
| `boss_getup_brace` | 0.35s | easeOutCubic | 手撑/肩先起，头仍低 |
| `boss_getup_push` | 0.55s | easeInOutCubic | 躯干恢复约 60%，重心前移 |
| `boss_getup_rise` | 0.60s | easeOutCubic | 剩余角度回正，轻微过冲 |
| `boss_getup_settle` | 0.25s | easeOutCubic | 落稳，盯视权重恢复 |
| `boss_death_prone` | 保持 | — | 最后一次下沉/呼气，不再回 idle |
| `boss_spawn` | 0.90–1.20s | easeInOutCubic | 新层从低姿态抬回站立 |

普通流程约 3.0–3.5s；下一次发牌约在命中后 2.4s，起身与玩家回合自然重叠，不需要改引擎时序。

### 3.4 每关 profile

| 关卡 | 枢轴 | 倒地 | 起身 |
| --- | --- | --- | --- |
| L1 人形 | 髋部虚拟枢轴；`BossHead`、`Arm.L/R` 包肩/颈枢轴 | 前扑到桌沿，头/肩保持在桌面以上 0.15–0.30m | 手撑 → 肩起 → 头最后抬 |
| L2 低伏体 | 低位枢轴，无侧滚 | 整体下沉前塌，不做大角度翻滚 | 两次轻颤后拖起，头先抬 |
| L3 倒吊体 | `Boss3_SuspensionRoot` | 绕悬挂点摆荡 + 缓慢自转，不做地面俯仰 | 轨道收短 0.2–0.3m，摆幅衰减后头抬起 |

### 3.5 姿态数据

```ts
type BossPoseState =
  | 'idle' | 'impact' | 'collapse' | 'prone'
  | 'brace' | 'push' | 'rise' | 'recover'
  | 'deadProne' | 'spawn'

interface BossPoseSample {
  pitch: number       // 绕 X，正 = 前扑
  roll: number        // 绕 Z，侧塌
  y: number           // 整体垂直偏移
  z: number           // 整体前后偏移
  headPitch: number   // 相对躯干的低头/抬头
  headRoll: number
  armL: number        // L1 专用，0..1
  armR: number
  lookWeight: number  // 1 = 正常盯视，0 = 完全停止
}

interface BossPoseProfile {
  pivotY: number       // 虚拟枢轴高度
  maxPitch: number
  maxRoll: number
  sink: number
  proneHeadDrop: number
  allowArms: boolean
  durations: { impact; collapse; prone; brace; push; rise; settle }
}
```

`BossPoseController` 接口：

```ts
triggerHit(input: { damage: number; hpAfter: number; maxHp: number; level: number }): void
triggerDefeat(input: { level: number }): void
spawn(level: number): void
reset(): void
update(dt: number): void
sample(): BossPoseSample
state(): BossPoseState
```

### 3.6 虚拟枢轴与头部权重

- 旋转不在脚底原点做，而是在 `pivot = (0, profile.pivotY, 0)` 处做：
  - `translation = pivot - R(pitch, roll) * pivot`
  - 再叠加 profile 的 `sink/z` 偏移。
- 这样不改层级、不影响程序化兜底，也不会让半身像绕脚底甩出去。
- `lookWeight`：
  - `idle = 1`，`impact/collapse = 0`，`prone = 0`
  - `brace = 0.15`，`push = 0.35`，`rise = 0.7`，`recover = 1`
- L1 的 `BossHead` / `Arm.L/R` 在 `applyBossMaskModel()` 里对**克隆体**包枢轴 Group；模板不能被修改。若枢轴验证失败，L1 第一版降级为“整体 + 头部小角度”，手臂动作延后到独立步骤。

---

## 4. 分阶段执行与验收闸门

> 规则：每个闸门完成后更新本文件的勾选与进度表，附证据路径，然后停下等确认；未确认不进入下一阶段，不推送、不开 PR。

### Phase 0：备份与基线

- [x] 备份当前 `src/scene/`、`src/components/`、`src/App.tsx`、`AGENTS.md` 到 `D:\qoderprojects\backups\blood-ante-boss-getup\baseline-20261122\`
- [x] 记录基线：`npm run typecheck`、`npm test`、`npm run build`、`npx playwright test`
- [x] 确认工作区只有既有的 `?? docs/OPTIMIZATION-EXECUTION-PLAN.md` 与本方案文档，不处理它们
- [x] 从 `main` 创建分支 `feat/boss-getup-pose`

**闸门 G0**：基线全绿；备份存在；分支正确。  
**证据**：终端输出摘要、备份目录截图。

**G0 基线结果（2026-11-22）**

- 基线提交：`374f6a4`（`main`）
- 工作分支：`feat/boss-getup-pose`
- 备份目录：`D:\qoderprojects\backups\blood-ante-boss-getup\baseline-20261122\`（`scene/`、`components/`、`App.tsx`、`AGENTS.md`、本方案）
- `npm run typecheck`：通过
- `npm test`：2 个测试文件，69/69 通过（783ms）
- `npm run build`：通过；双入口 `dist/index.html` + `dist/moyan.html`，three 独立块 664.10 kB
- `npx playwright test`：7/7 通过（4.9m）
- 工作区：仅 `?? docs/BOSS-GETUP-EXECUTION-PLAN.md`、`?? docs/OPTIMIZATION-EXECUTION-PLAN.md`

### Phase 1：BossPose 纯逻辑状态机

- [x] 新增 `src/scene/BossPose.ts`
- [x] 定义 `BossPoseState`、`BossPoseSample`、`BossPoseProfile`、`BOSS_POSE_PROFILES`
- [x] 实现 `triggerHit / triggerDefeat / spawn / reset / update / sample`
- [x] 实现“从当前采样值起步”的中断逻辑，禁止归零跳变
- [x] 新增 `src/scene/BossPose.test.ts`
- [x] 测试：致死不回 idle、普通命中回 idle、二次命中连续、切层重置、reduced motion 缩短、采样值有界、prone 时 lookWeight=0
- [x] `npm run typecheck && npm test`

**闸门 G1**：新增测试全绿，既有 69 例不回归。  
**证据**：测试数量与通过输出。

**G1 结果（2026-11-22）**

- 新增文件：`src/scene/BossPose.ts`、`src/scene/BossPose.test.ts`
- 状态机：`idle → impact → collapse → prone → brace → push → rise → recover → idle`；致死时 `impact → collapse → deadProne` 并永久停留
- 三关 profile：L1 人形前扑、L2 低位爬伏、L3 悬吊倒挂；`BOSS_POSE_PROFILES` 长度 3
- 中断策略：`triggerHit` 以当前采样为起点，二次命中单帧通道变化 < 0.05，不归零
- reduced motion：时间轴缩放 0.45，prone 阶段 roll 与手臂幅度为 0
- `npm run typecheck`：通过
- `npm test`：3 个测试文件，78/78 通过（其中 BossPose 9 例；既有 69 例无回归）
- 尚未修改 `SceneManager.ts`，游戏运行时行为与 G0 完全一致

### Phase 2：SceneManager 接入

- [x] 删除 `bossKnock` / `knockGeneration` / `knockBossDown()`（`SceneManager.ts:548-550`、`1399-1422`）
- [x] `playShot()` 按 `hpAfter <= 0` 分流普通/致死；`blocked` 仍不触发姿态（`SceneManager.ts:1337-1347`）
- [x] `updateBoss()` 改为“呼吸/盯视基线 + BossPose 采样 + 虚拟枢轴补偿”（`SceneManager.ts:2312-2355`）
- [x] 倒地/起身期间按 `lookWeight` 抑制头部扫视
- [x] `applySnapshot()` 检测 `levelIndex` 变化或 `boss.hp` 回升，重置并 `spawn()`（`SceneManager.ts:766-776`）
- [x] `applyBossMaskModel()` 重新采集 `BossHead` 与 profile（`SceneManager.ts:3410-3448`）
- [x] 新增 DEV-only `window.__bossPoseDebug`（`state/sample/seek/setProfile`），生产构建摇掉
- [x] `npm run typecheck && npm test && npm run build`

**闸门 G2**：L1 普通命中能完整走完时间线；致死命中进入 `deadProne` 且不再起身；无 console 报错。  
**证据**：`__bossPoseDebug.state()` 时间线日志、构建输出。

**G2 结果（2026-11-22）**

- `SceneManager.ts`：`BossPoseController` 已接入 `playShot()` / `applySnapshot()` / `updateBoss()`；旧 `bossKnock` 整段 tween 已删除
- 姿态映射：呼吸基线 + `BossPose` 采样，绕 `profile.pivotY` 虚拟枢轴旋转并反推平移；头部扫视按 `lookWeight` 衰减，再叠加 `headPitch/headRoll`
- 致死分流：`hpAfter <= 0` 交给 `triggerDefeat()`，停在 `deadProne`；`blocked` 不触发姿态
- 切层/重开：`levelIndex` 变化或 Boss 从 0 血复活时 `spawn()`；Boss 中途补血不再误触发
- DEV 调试：`window.__bossPoseDebug` 提供 `state/sample/hit/defeat/spawn/reset/seek/setProfile`；生产包 `grep __bossPoseDebug` = 0
- L1 普通命中时间线（`hit(2, 1)`，50ms 采样）：`impact 0.00 → collapse 0.15 → prone 0.65 → brace 1.65 → push 2.10 → rise 2.80 → recover 3.60 → idle 3.85`
- L1 致死时间线（`hit(9, 0)`）：`impact 0.00 → collapse 0.15 → deadProne 0.65`，10s 后仍为 `deadProne`
- `npm run typecheck`：通过
- `npm test`：78/78 通过
- `npm run build`：通过；双入口，three 独立块 664.11 kB
- console：仅既有 `PCFSoftShadowMap` 弃用 warning，无新增 error
- 真实镜头视觉调校留到 G3

### Phase 3：L1 视觉调校（真实镜头验收）

- [x] 给 `BossHead`、`Arm.L/R` 建运行时枢轴（仅克隆体）
- [x] 调整 L1 `maxPitch/maxRoll/sink/proneHeadDrop`，保证趴伏时头/肩在桌沿以上
- [x] 检查无穿桌、穿地、头部脱离躯干
- [x] 真实镜头截图：命中后 0.2s / 0.8s / 1.5s / 2.2s / 3.2s
- [x] 对比当前基线，确认“倒下→趴伏→撑起→直身”可读

**闸门 G3**：L1 五帧截图通过人工验收；你确认后才进入 L2/L3。  
**证据**：`D:\qoderprojects\backups\blood-ante-boss-getup\g3-l1\` 下 5 张真实镜头截图。

**G3 结果（2026-11-22）**

- 运行时枢轴：`wrapL1LimbPivots()` 只对克隆体包 `BossHead`（0, 2.07, 0.02）、`Arm.L`（-0.6, 1.74, 0.18）、`Arm.R`（0.6, 1.74, 0.18）三个 Group；几何世界位置用 `node.position.sub(point)` 保持不变
- 姿态映射：头部在静止旋转上叠加 `headPitch/headYaw*lookWeight/headRoll`；双臂叠加 `armL/R × 0.3/0.28`，幅度压低避免烘焙肩部撕裂（当前机位下双臂被躯干遮挡，未见破面）
- L1 profile 最终值：`pivotY 0.85 / maxPitch 0.9 / maxRoll 0.24 / sink 0 / fallZ 0.7 / proneHeadDrop -0.06`
- 调试迭代：`maxPitch 1.12 → 0.9`、`fallZ 0.16 → 0.7`、`sink 0.24 → 0` 把上身前推过桌沿；`proneHeadDrop -0.55 → -0.25 → 0.06 → -0.06`，最终取 -0.06：头部保留在肩线内、帽檐/面具侧脸可见，消除 -0.25 时的颈部断口
- 真实镜头采样（`hit(4, 1)`、1280×800 DPR1、`seek` 后截图）：`0.2s collapse` 直立微后仰 → `0.8s prone` 前扑趴伏 → `1.5s prone` 呼吸起伏 → `2.2s push` 抬头撑起 → `3.2s rise` 直身
- 检查项：头/肩全程在桌沿以上；无穿桌、穿地；颈-肩接缝连续，无头部脱节
- `npm run typecheck`：通过
- `npm test`：78/78 通过
- `npm run build`：通过；双入口，three 独立块 664.11 kB
- console：仅既有 GPU ReadPixels 性能提示与 `PCFSoftShadowMap` 弃用 warning，无 error
- 证据目录：5 张 `l1-*.png`、`capture-g3.cjs`（可复跑）、`zoom-*.png` / `head-*.png`（局部放大检查）、`crop*.ps1`

### Phase 4：L2 / L3 差异化

- [x] L2：低位下沉前塌 + 两次轻颤拖起，禁止大角度侧滚
- [x] L3：绕 `Boss3_SuspensionRoot` 摆荡、缓慢自转、收轨抬起，禁止地面俯仰
- [x] 两关分别截图 5 帧，检查不穿模、不悬空
- [x] 确认 L2/L3 不共用 L1 的手臂逻辑

**闸门 G4**：L2/L3 截图通过；三关形态能一眼区分。  
**证据**：`g4-l2/`、`g4-l3/`。

**G4 结果（2026-11-22）**

- L2 profile：`pivotY 0.9 / maxPitch 0.22 / maxRoll 0.08 / sink 0.42 / fallZ 0.12 / proneHeadDrop 0.32 / riseLift 0 / tremble 0.05 / allowArms false`
  - 下沉主导：趴伏时包围盒底部从 `y 0.63` 降到 `y 0.02`（桌面机位下整体趴在桌上），俯仰仅 0.22rad，无大角度侧滚
  - 拖起颤抖在 `brace/push/rise` 三段连续计时（`getupTime`），`sin(t*11.5) * exp(-t*0.85)`，分段接缝无跳变
- L3 profile：`pivotY 3.08 / maxPitch 0.34 / maxRoll 0.2 / sink 0.08 / fallZ 0 / proneHeadDrop 0.22 / riseLift 0.34 / tremble 0 / allowArms false`
  - 趴伏阶段 `spin += step*0.28` 持续自转 + 绕枢轴钟摆（roll ±0.16、pitch ±0.035），包围盒 x 跨度从 `-1.14..1.14` 摆到 `-2.14..0.29`
  - 起身阶段抬升到 `y 0.34`（收轨），4.2s 回到静止高度前保留摆幅衰减
- 手臂：`allowArms=false` 使 L2/L3 的 `armL/armR` 恒为 0，与 L1 的肩/臂枢轴逻辑完全解耦（单测 `L2 拖起带两次轻颤，L3 悬吊自转且不共用 L1 手臂` 覆盖）
- 真实镜头采样（`hit(4, 1)`、1280×800 DPR1、`seek` 后截图，`shot=table`）：
  - L2：`0.2s collapse → 0.8s prone → 1.5s prone → 2.2s brace → 3.2s rise`，5 帧
  - L3：`0.2s collapse → 0.8s collapse → 1.5s prone → 2.2s brace → 3.2s rise → 4.2s recover`，6 帧
- 三关一眼区分：L1 上身前扑过桌沿（头肩留在桌面以上）；L2 整体沉到桌面、四肢瘫软；L3 悬空摆荡 + 自转 + 双腿收轨
- 检查项：无穿地（L2 最低 y≈0.02 仍在桌面以上）；L3 包围盒不穿地（最低 y≈0.24）；无新增 console error
- 说明：L3 头部在桌面机位上缘被裁切是既有构图（NDC maxY≈1.04–1.14），非本阶段姿态引入；G5 再决定是否加 `bossDown` 机位
- 截图口径修正：首轮 L3 采集在 3.2s 抓到单帧暗场（`g4-l3/l3-3.2s.png`，RGB 1–10），经像素采样与叠加层探测确认是拍摄时序竞态而非遮挡层或代码问题；用带重试/亮度校验的 `capture-g4b.cjs` 复拍得到有效序列，原始异常帧留档在 `g4-l3-invalid-race/`
- `npm run typecheck`：通过
- `npm test`：79/79 通过（BossPose 10 例）
- `npm run build`：通过；双入口，three 独立块 664.11 kB
- 证据目录：`g4-l2/` 5 帧、`g4-l3/` 6 帧 + 6 张 `zoom-*.png` + `capture.json`；可复跑脚本 `capture-g4.cjs`、`capture-g4b.cjs`；源码备份 `g4-src-backup/after-g4/`

**G4 复盘修复：普通命中看不到倒地（2026-11-22）**

- 现象：人工验收反馈「致死动作不错，但单纯击中 Boss 没有动作」。
- 根因：普通命中与致死命中都走 `playShot → triggerHit`，但队友 PR #40 加入的 Boss 血袋特写会在 0.25s 内切走镜头，`impact → collapse` 全程发生在特写里；约 1.5s 回位时 Boss 已趴伏、正在起身，所以观感上「没被打中」。
- 修复（`SceneManager`）：Boss 命中改为「先看塌倒，再切特写」——新增 `waitBossCollapsed` 等到姿态进入起身段（`brace` 或 `deadProne`）才切 `bloodBoss`；特写期间用 `bossPoseHold` 冻结姿态，回位后继续起身；`cancelBloodCloseup` 与结束路径均释放冻结，避免卡死。玩家中弹时序不变（仍先黑屏 1.6s 再看自己血袋）。
- 验证：高频采样确认时间线为 `0.1s impact → 1.2s prone（桌面机位）→ 3.2s brace + 切特写冻结 → 5.0s push 回位 → 5.6s rise`；关键帧 `g4b-fix-hit-closeup/`（0.8s 前扑喷血、1.6s 趴桌、3.2s 特写冻结、5.6s 起身）；`typecheck` / 79 单测 / build / smoke e2e 全绿。

### Phase 5：致死 / 切层 / 重开流程

- [x] 致死命中：`deadProne` 保持到 `levelClear`、`supply`、`victory`
- [x] 清层期间镜头切远景后，Boss 仍可见为倒地剪影
- [x] 选完补给进新层：旧姿态清零，新 Boss 播 `spawn`
- [x] `retryLevel` / `restart`：立即重置，不残留倒地
- [x] 确认不发新的 `GameEvent`、不改引擎时序

**闸门 G5**：完整打一遍 L1→L2→L3，致死、补给、重开、失败重试都不串姿态。  
**证据**：流程录屏或关键帧截图 + `__bossPoseDebug` 状态记录。

**G5 结果（2026-11-22）**

- 修复漏洞：`applySnapshot()` 原来只在 `levelIndex` 变化或 Boss 0 血复活时 `spawn()`；同层 retry（玩家被打死、Boss 未死）两项都不变，会残留起身姿态。抽出 `shouldRespawnBossPose()`（`BossPose.ts`），增加 `phase → reloading` 这一跳判定；`beginLevel` 每次都先拨 `reloading`，切层 / retry / restart 全覆盖，`reloading` 连续快照只触发一次。
- 逐段实测（`g5-flow.cjs`，1280×800 DPR1）：
  - 致死：`deadProne` → `levelClear`（`victory` 机位）→ `supply` 2s 后仍是 `deadProne`，pitch 恒 1.11，无起身
  - 补给进第 2 层：`spawn`（pitch 1.11）→ 2.6s 后 `idle`（pitch 0），新 Boss 站立
  - 同层 retry（起身中段 `prone` → 模拟玩家死亡 `gameOver` → `retryLevel()`）：`spawn` → `idle`，无残留
  - restart（起身中段直接重开）：回第 1 层 `spawn` → `idle`
- 倒地剪影：`levelClear` 远景（补给面板出现前 1–2s）趴伏轮廓、血渍、斗篷清晰可见，见 `g5-flow/lethal-victory-*.png`；补给面板是全屏 70% 黑幕 + 模糊的既有 UI，属该阶段设计
- 无引擎 / GLB 改动，未新增 `GameEvent`；console 无 error
- `npm run typecheck`：通过；`npm test` 85/85；`npm run build` 通过
- 证据目录：`g5-flow/`（`1-levelclear-victory.png`、`2-supply-still-down.png`、`3-level2-idle.png`、`4-retry-settled.png`、`5-restart-settled.png`、`lethal-victory-{0.4,1,1.6,2.2,2.8}.png`、`g5.json`）；可复跑脚本 `g5-flow.cjs`、`g5-silhouette.cjs`

### Phase 6：音效提示与 reduced motion

- [x] `SceneCallbacks` 增加 `onBossPoseCue`（`SceneManager.ts:38-43`）
- [x] `GameCanvas` 转发 cue；`App` 映射到现有合成音效：
  - `down` → `playChairCreak` / `playLowThump`
  - `brace` → L1 `playStitch`，其他 `playItemUse` 的低频变体（不新增素材）
  - `rise` → `playBossBreath`
  - `settle` → `playLowThump`
- [x] 不重复播 `playGunshot`
- [x] `prefers-reduced-motion`：时长压到约 45%，关闭侧滚/手臂/镜头抖动
- [x] 验证音效不早于动作、不滞后超过 80ms

**闸门 G6**：音画同步；reduced motion 下不晕、仍能读出倒地与起身。  
**证据**：音效触发日志、reduced motion 截图/录屏。

**G6 结果（2026-11-22）**

- 实现：`BOSS_POSE_CUES` 把状态映射为 `prone/deadProne → down`、`brace → brace`、`rise → rise`、`recover → settle`；`updateBoss()` 每帧比对上一状态，只在切换帧派发一次（冻结期间状态不变，不会重复）。`App.handleBossPoseCue` 接现有音色：`down` = 低频 thump + 椅子吱呀，`brace` = 缝线，`rise` = Boss 呼吸，`settle` = thump；枪响仍由 `shot` 事件负责，未重复。
- cue 实测（包裹 SceneManager 已注册的真实回调，完整链路 SceneManager → GameCanvas → App）：
  - 普通命中 `hit(2,6)`：`down 640ms → brace 1457ms → rise 2373ms → settle 2974ms`，顺序正确、无重复
  - 致死 `defeat()`：仅 `down 628ms` 一次，不再触发起身 cue
  - `down` 在塌倒阶段即触发（状态进入 `prone` 的帧），与落地同帧，远小于 80ms 阈值
- reduced motion（`prefers-reduced-motion: reduce`）：同一 `hit(2,6)` 1.5s 走完（常规约 3.0s，约 45–50%），序列 `impact → collapse → prone → brace → push → rise → recover → idle` 完整；趴伏时 `roll=0`、`armL=0`（关闭侧滚与手臂）
- 几何比对（`metrics()`）：两种模式 prone 俯仰一致（pitch 0.796、前移 0.62m、`lookWeight=0`）；reduce 仅去掉侧倾与手臂，倒地读感保留
- 证据目录：`g6-cues/`（`g6.json`、`prone-reduce.png`、`prone-no-preference.png`、`reduced-prone-live.png`）；脚本 `g6-cues.cjs`、`g6-metrics.cjs`、`g6-prone2.cjs`；console 无 error

### Phase 7：全量回归与 PR 准备

- [x] `npm run typecheck`
- [x] `npm test`（69 + 新增）
- [x] `npm run build`（双入口都在）
- [x] `npx playwright test`（7 例）
- [x] 更新 `AGENTS.md` 第四节 Boss 动作契约（替换第 115 行旧描述）
- [x] 自查 `git diff`：无引擎改动、无 GLB 改动、无 `console.log`
- [x] 提交分支（**不推送、不开 PR，等确认**）

**闸门 G7**：全部绿；你验收后我再推送并开 PR。  
**证据**：测试/构建/e2e 输出、diff 摘要、截图清单。

**G7 结果（2026-11-22）**

- `npm run typecheck`：通过
- `npm test`：3 个测试文件，85/85 通过（BossPose 16 例，新增 6 例覆盖 `shouldRespawnBossPose`：首次快照不 spawn、普通回合不误触发、切层、0 血复活、同层 retry、reloading 连续快照只触发一次）
- `npm run build`：通过；双入口 `dist/index.html` + `dist/moyan.html`，three 独立块 664.11 kB；生产包 `grep __bossPoseDebug` = 0
- `npx playwright test`：7/7 通过（4.9m）
- `AGENTS.md`：Boss 动作契约替换为 BossPose 状态机 + 三关 profile + `shouldRespawnBossPose` + `onBossPoseCue` 四条
- diff 自查：`src/game/**` 与 `public/models/**` 零改动；全 diff 无 `console.log`；改动集中在 `AGENTS.md`、`App.tsx`、`GameCanvas.tsx`、`SceneManager.ts` + 新增 `BossPose.ts` / `BossPose.test.ts`
- 已提交 `feat/boss-getup-pose` 工作分支，**未推送、未开 PR**，等你验收

---

## 5. 文件改动清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `src/scene/BossPose.ts` | 新增 | 状态机、profile、采样 |
| `src/scene/BossPose.test.ts` | 新增 | 时间线/中断/致死不回 idle |
| `src/scene/SceneManager.ts` | 修改 | 触发分流、姿态合成、重置、回调 |
| `src/components/GameCanvas.tsx` | 修改 | 转发 `onBossPoseCue` |
| `src/App.tsx` | 修改 | cue → SoundEngine |
| `AGENTS.md` | 修改 | 更新 Boss 动作契约 |
| `docs/BOSS-GETUP-EXECUTION-PLAN.md` | 本文件 | 进度勾选与证据 |

**明确不改**：

- `src/game/GameEngine.ts`
- `public/models/boss_*.glb`
- 规则数值、关卡数值、单测中的规则断言
- `vite.config.ts`
- 蔓延子游戏 `src/moyan/**`

---

## 6. 技术细节与边界条件

### 6.1 触发规则

| 条件 | 行为 |
| --- | --- |
| `chamber !== 'live'` | 不触发姿态 |
| `blocked === 'shield'` | 不触发姿态，只保留火花 |
| `damage === 0 && hpAfter > 0` | 不触发姿态 |
| `hpAfter > 0` | `triggerHit`，走完整倒地/起身 |
| `hpAfter <= 0` | `triggerDefeat`，进入 `deadProne`，永不自动起身 |
| `levelIndex` 变化 | `reset()` + `spawn(newLevel)` |
| `boss.hp` 回升（retry/restart） | `reset()` + `spawn(currentLevel)` |
| `roundStart` | **不重置**，允许起身与发牌重叠 |

### 6.2 姿态连续性

- 任何新命中都先 `sample()` 当前值作为新片段起点。
- 连续性测试阈值：相邻 16ms 采样的单通道增量不超过 `0.05`（归一化）。
- 不允许出现 `bossKnock = 0` 这类归零跳变。

### 6.3 镜头与遮挡

- 普通命中：沿用现有血袋特写回归桌面的节奏，`prone` 至少保持 0.7s，确保玩家回到桌面机位时还能看到趴伏与撑起。
- 致死命中：先保持 `deadProne`，再切 `victory` 远景。
- 第一阶段**不新增机位**。如果 G5 截图显示倒地完全被桌面挡住，再单开一个小步骤增加 `bossDown` 机位或调整 `victory` 的 `lookAt` 高度；不提前加。

### 6.4 资源与性能

- 第一阶段只做 transform 插值，不新增 draw call、不新增贴图/音频文件。
- 不引入物理引擎；不做布料/头发模拟。
- `BossPoseController` 每帧 O(1)，采样对象复用，避免 GC。

### 6.5 回滚

- 所有改动集中在 3 个代码文件 + 1 个测试文件 + `AGENTS.md`。
- 如需回滚：`git checkout -- src/scene/SceneManager.ts src/components/GameCanvas.tsx src/App.tsx AGENTS.md`，并删除新增的两个文件。
- 备份目录保留到 PR 合并后再清理。

---

## 7. 验收清单

### 功能

- [ ] 普通实弹命中：impact → collapse → prone → brace → push → rise → recover → idle
- [ ] 致死命中：保持 `deadProne`，清层/补给/结算都不起身
- [ ] 新层：旧姿态清零，新 Boss `spawn`
- [ ] retry/restart：不残留倒地
- [ ] 起身途中再次命中：从当前姿态连续接回，不弹直
- [ ] `blocked`、空膛、自射：不误触发

### 视觉

- [ ] L1/L2/L3 倒地时都有可读剪影，不整块消失
- [ ] 头/肩不穿桌、不穿地、不脱离躯干
- [ ] L1 有手撑/肩起/头最后抬；L2 是拖起；L3 是摆荡收轨
- [ ] 起身不是单一刚体旋转
- [ ] 真实镜头截图通过，不使用俯视调试视角代替

### 性能与回归

- [ ] draw calls 与基线一致（`sampleStats`）
- [ ] 无新增 console 报错
- [ ] `npm run typecheck` 绿
- [ ] `npm test` 全绿（69 + 新增）
- [ ] `npm run build` 绿，双入口都在
- [ ] `npx playwright test` 7/7
- [ ] `GameEngine.ts` diff 为空

---

## 8. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| L1 枢轴重包破坏模型 | 头/手位置错乱 | 只操作克隆体；先用 `__bossPoseDebug` 逐段检查；失败则降级为整体+头部小角度 |
| 倒地仍被桌面遮没 | 玩家看不到姿态 | G3/G5 真实镜头截图门；必要时单开 `bossDown` 机位 |
| 起身与下一回合重叠 | 玩家以为 Boss 未就绪 | 纯表现，不影响规则；保持 3.0–3.5s，不延后发牌 |
| 头部动画与盯视冲突 | 头乱转 | `lookWeight` 分层；L1 用独立枢轴 |
| 切层姿态泄漏 | 新 Boss 一出现就歪 | 显式 `reset()` + `spawn()`，并加单测 |
| 镜头上摇/遮挡导致误判 | 验收争议 | 固定三机位截图 + `__bossPoseDebug` 数值双重证据 |

---

## 9. 后续逼真度路线图

> 第一阶段先解决“有没有”和“读不读得懂”；以下按收益排序，每项都可独立 PR。

### P1：Blender 骨骼 + 动画剪辑（最高收益）

- 给每个 Boss 加最小骨架：
  - L1：root/hips/spine/chest/neck/head + 左右肩/臂
  - L2：root/spine/chest/head（低伏体不需要手臂）
  - L3：轨道 root + 悬挂链 + spine/head
- 导出 6 个 clip：`Hit_Light`、`Hit_Heavy`、`Collapse`、`Prone_Idle`、`GetUp`、`Death`。
- 30fps、无 root motion；保留 `BossHead` 节点供叠加盯视。
- 游戏侧接入 `AnimationMixer`，crossfade 0.15–0.25s，`LoopOnce` + `clampWhenFinished`。
- 验收：真实镜头视频；手/桌沿接触无穿模；倒地剪影仍可见。
- 注意：clip 会覆盖头部旋转，必须把盯视移到子节点或做 additive 层；GLB 已有 22–27MB，重新导出时不要重复烘焙贴图。

### P2：接触与二次运动

- 手撑桌沿：优先用动画里的接触帧，不做完整 IK；必要时加一个简单的手部约束。
- 布料/衣摆：用骨骼或顶点着色器做小幅延迟摆动，不做真实布料模拟。
- 血液/灰尘：倒地落点加一次尘/血滴/桌面震动，起身时衣摆回弹。
- 呼吸：趴伏时改成不规则浅呼吸，起身后 1–2s 才恢复原有节奏。

### P3：情境化表演（便宜且提升明显）

- 按剩余血量分级：
  - 高血量：一次撑起即成功
  - 低血量：第一次撑起失败，手滑/肩塌，第二次才起来
  - 致死：不再起身，只做一次下沉和呼气
- 按伤害/是否锯短枪管改变倒地幅度与趴伏时长。
- 头部表演：趴伏时先挣扎抬眼看玩家一次，再垂下；起身后与玩家对视 0.3–0.5s。
- 每关人格化：
  - L1 缝合女怪：缝线绷紧、肩部抽搐
  - L2 低伏体：指节抓桌、拖行感
  - L3 倒吊体：铁轨棘轮、钟摆衰减

### P4：镜头与声音

- 普通命中不抢玩家操作，只在桌面机位内做轻微构图变化。
- 致死可加一个短暂的 `bossDown` 机位，再切胜利远景；是否加由截图决定。
- 音效按帧对齐：落点 thump、衣料摩擦、缝线、金属轨道、呼吸恢复；全部用现有合成音色，不新增外部素材。
- 避免“每个动作都配一声重音”，留出静默反而更真实。

### P5：调试与自动化验收

- DEV-only `__bossPoseDebug` 支持 `seek(t)`、`step(1/30)`、`setProfile(level)`，方便逐帧截图。
- 录一组 30fps 序列帧，检查：
  - 单帧最大姿态增量（防跳变）
  - 趴伏时头/肩是否在桌沿以上
  - 从命中到回 idle 的总时长
- 自动化阈值可以只做数值断言（姿态曲线），截图仍保留人工验收。

### 建议优先级

1. **本轮 Phase 0–7**：程序化状态机 + 每关 profile + 致死保持倒地
2. **P1 骨骼剪辑**：最大真实感提升，但需要 Blender 重导出与视觉回归
3. **P3 情境化**：成本低，重复游玩收益高
4. **P2 接触/二次运动**：锦上添花
5. **P4/P5**：演出与工具链收尾

---

## 10. 进度记录

| 闸门 | 状态 | 日期 | 提交 | 证据/备注 |
| --- | --- | --- | --- | --- |
| G0 备份与基线 | 完成 | 2026-11-22 | 无提交（工作分支 `feat/boss-getup-pose`） | 备份 `baseline-20261122`；typecheck 绿；69/69；build 双入口；e2e 7/7 |
| G1 BossPose 状态机 | 完成 | 2026-11-22 | 未提交（工作区） | `BossPose.ts` + `BossPose.test.ts`；typecheck 绿；78/78（新增 9 例）；未接 SceneManager |
| G2 SceneManager 接入 | 完成 | 2026-11-22 | 未提交（工作区） | 旧 bossKnock 已删；普通 8 段/致死 3 段时间线通过；78/78；build 绿；生产包无调试钩子 |
| G3 L1 视觉调校 | 完成（待验收） | 2026-11-22 | 未提交（工作区） | L1 运行时头/臂枢轴；profile 调校后五帧真实镜头截图在 `g3-l1/`；78/78；build 绿 |
| G4 L2/L3 差异化 | 完成（待验收） | 2026-11-22 | 未提交（工作区） | L2 下沉+颤动拖起、L3 摆荡+自转+收轨；`g4-l2/` 5 帧、`g4-l3/` 6 帧；79/79；build 绿 |
| G5 致死/切层/重开 | 完成（待验收） | 2026-11-22 | 未提交（工作区） | `shouldRespawnBossPose` 补同层 retry 重置；致死保持 `deadProne`、远景剪影可见、新层 spawn；85/85 |
| G6 音效/reduced motion | 完成（待验收） | 2026-11-22 | 未提交（工作区） | `onBossPoseCue` 链路；cue 序列 640/1457/2373/2974ms；致死仅 down；reduce 1.5s 完成且关侧滚/手臂 |
| G7 回归与 PR 准备 | 完成（待验收） | 2026-11-22 | 未提交（工作区） | typecheck / 85 单测 / build 双入口 / e2e 7/7；AGENTS.md 契约更新；引擎与 GLB 零改动 |

**进度更新规则**：每完成一个闸门，勾选对应任务、填写日期与证据路径，然后停下等确认；未确认不进入下一阶段。

---

## 11. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-22 | 初版：现状审查、状态机设计、分阶段闸门、后续逼真度路线 |
| 2026-11-22 | G1 完成：BossPose 纯状态机与 9 例单元测试落地，78/78 通过 |
| 2026-11-22 | G2 完成：SceneManager 接入姿态采样、致死分流、切层/重开重置与 DEV 调试钩子 |
| 2026-11-22 | G3 完成：L1 运行时头/臂枢轴 + profile 调校，五帧真实镜头截图验收资料备齐，待人工确认 |
| 2026-11-22 | G4 完成：L2 下沉前塌 + 跨段轻颤拖起、L3 绕悬吊枢轴摆荡 + 自转 + 收轨抬起；L2/L3 均禁用手臂；L2 5 帧、L3 6 帧真实镜头截图（含 zoom 与 capture.json），首轮 L3 暗帧确认拍摄竞态并复拍，79/79，build 绿，待人工确认 |
| 2026-11-22 | G4 复盘修复：普通命中因血袋特写切走看不到塌倒 → 改为先播塌倒到趴稳、再切特写并冻结姿态、回位续起身；关键帧 `g4b-fix-hit-closeup/`，typecheck/79 单测/build/smoke e2e 全绿，待人工复验 |
| 2026-11-22 | G5 完成：抽出 `shouldRespawnBossPose()` 补同层 retry 重置漏洞；致死全程 `deadProne`、`levelClear` 远景倒地剪影可见、选补给进新层 spawn；同层 retry 与 restart 均无残留；`g5-flow/` 关键帧 + JSON，85/85，待验收 |
| 2026-11-22 | G6 完成：`onBossPoseCue` 贯通 SceneManager→GameCanvas→App，映射现有合成音色；普通命中 cue 640/1457/2373/2974ms，致死仅 down 一次；reduced motion 1.5s 完成且关侧滚/手臂；`g6-cues/` 证据，待验收 |
| 2026-11-22 | G7 完成：typecheck / 85 单测（新增 6 例 `shouldRespawnBossPose`）/ build 双入口 / e2e 7/7 全绿；AGENTS.md 契约更新；引擎与 GLB 零改动、无 console.log；已提交 `feat/boss-getup-pose`，未推送未开 PR，待验收后推送 |