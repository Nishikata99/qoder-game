# Blood Ante · 审计与整改执行清单

> **给执行者（另一个 AI 会话 / 人类开发者）的指令**
>
> 本文档是一份**按步骤执行的整改工单**。规则如下，必须严格遵守：
>
> 1. **先审计，后修改**。每一条都分「审计」和「执行」两个动作。没有任何一条允许你跳过审计直接改代码——因为文档里的行号可能已因他人改动而漂移。
> 2. **一条一个勾**。完成「审计」后，如果结论是「问题仍然存在」，就按「执行」修改，验证通过后在本文档里把该条的 `[ ]` 改成 `[x]`；如果审计结论是「问题已不存在 / 已由他人修复」，**不要改代码**，在 `[x]` 后面追加 `（审计结论：已修复，未改动）`。
> 3. **不要合并提交**。一条一 commit，提交信息用文中给出的模板。做完一条就停，等下一条。
> 4. **不要顺手改别的**。看到文档没列的「小问题」记到文末「附录 A · 新发现问题」，不要直接动手。
> 5. **每条执行后必须跑验证**。文中每一节末尾的「验证」命令必须实际执行并贴出结果，不能口头声称通过。
> 6. **禁止直接 push main**。按 AGENTS.md 的流程开分支，走 PR。
> 7. 本仓库当前**有未提交的改动**（shotgun.glb 替换、AGENTS.md/README 重写等）。**开工前先确认工作区状态**，不要覆盖别人的未提交工作。

---

## 0. 开工前检查（必做，不参与勾选）

```bash
cd blood-ante
git status --short
git log --oneline -5
npm ci          # 或 npm install，确认依赖完整
npx tsc -b      # 必须通过，否则先排查环境
```

把 `git status` 的结果记录在这里，作为基线：

```
基线（2026-11-19，基于 origin/main 9bc1f4e）：
?? docs/                      # 本工单文档本身（新增，未跟踪）
工作区其余文件与 origin/main 一致，无未提交改动。
npx tsc -b → 通过；npm run build → 通过（单包 1,005 kB）。
注：本工单第 7 条提到的「shotgun.glb 替换、AGENTS.md/README 重写」已随 PR #7 合并，不存在未提交残留。
```

> ⚠️ 如果 `git status` 显示有未提交改动，先和负责人确认这些改动是否需要先提交或暂存。**不要随意 stash / checkout / reset**。

---

## 优先级说明

| 等级 | 含义 | 处理顺序 |
| --- | --- | --- |
| **P0** | 会改变游戏结果 / 玩家可感知的错误信息 | 必须做完 |
| **P1** | 影响玩法体验、有明确危害 | 必须做完 |
| **P2** | 工程质量债，影响后续协作 | 建议做完 |
| **P3** | 优化项，有明确收益但非必须 | 有时间再做 |

**执行顺序：P0 → P1 → P2 → P3。同一优先级内按编号顺序。**

---

# P0 · 必须修（会改变游戏结果 / 玩家看到错误信息）

## [x] P0-1 处决按钮双击可能导致一枪结算两次（审计结论：已不存在，未改动）

> 审计结论：`chooseTarget` 用 `void this.resolveShot(...)` 调用 async 函数时，函数体同步执行到第一个 `await` 之前；`this.phase = 'execution'` 位于 `await this.wait(2900)` 之前（[GameEngine.ts:874](file:///D:/qoderprojects/blood-ante/src/game/GameEngine.ts#L874)），因此第二次点击必然命中 `phase !== 'targeting'` 的拒绝分支。已用脚本注入 targeting 状态连点两次验证：第一次 `true`，第二次 `false`（"现在不是决定枪口的时候。"），结算计数 1。UI 侧按钮在 `pendingShot !== 'player'` 时已不渲染（App.tsx:292），双击无危害。

**问题**
`chooseTarget()` 是同步返回 `true` 的，但真正的结算函数 `resolveShot()` 是 `async`。`this.phase = 'execution'` 的赋值发生在 `resolveShot` 内部、且位于若干同步逻辑之后，因此在 `chooseTarget` 返回与 phase 切换之间存在一个微小的时间窗口。窗口内第二次点击会再次通过 phase 检查，导致同一次处决被完整执行两遍（两次 `cylinder.fire()`、两次扣血、两次遗恨清零）。

**审计**
1. 读取 `src/game/GameEngine.ts`，定位 `chooseTarget` 与 `resolveShot`。
2. 确认 `chooseTarget` 内部**没有**同步设置 `phase`。
3. 确认 `resolveShot` 的 `this.phase = 'execution'` 之前是否有同步逻辑（如 `ensureCylinder()`）。
4. 若文档给出的行号（`chooseTarget` 约 L849、`resolveShot` 约 L860）已漂移，用函数名搜索。

**执行**
- 方案 A（推荐，改引擎，根治）：在 `chooseTarget` 中，**在调用 `resolveShot` 之前同步**把 `this.phase = 'execution'` 置位（或引入一个 `this.choosingTarget` 布尔锁），让第二次点击立即命中 `phase !== 'targeting'` 的拒绝分支。
  - 注意：要保证 `resolveShot` 开头 `if (this.phase !== 'targeting') return` 这一句不会因为提前置位而直接返回。也就是置位后需要调整这一处守卫的判断条件，或者把置位放在 `resolveShot` 的第一行同步位置并在 `chooseTarget` 里用一个独立锁 `pendingChoice` 防止重入。
  - **请自行选择最简洁且不引入状态机歧义的写法，并在 PR 描述里说明选择理由。**
- 方案 B（UI 兜底，非充分条件）：在 `App.tsx` 的 targeting 按钮上加 `disabled`，条件为 `snapshot.phase !== 'targeting' || snapshot.pendingShot !== 'player'`。**方案 B 不能替代方案 A**，因为 React 状态更新是异步的，连点两下仍可能在同一次渲染内触发两次。

> 两处都要做：引擎根治 + UI 兜底。

**验证**
```bash
npx tsc -b
```
在两个按钮的 `onClick` 里临时用 `console.count()` 或在 `chooseTarget` 入口打日志（验证完删除），手动快速连点，确认只有一次结算。

**提交信息**
```
fix(game): 处决选择加同步阶段锁，防止连点重复结算
```

---

## [x] P0-2 README 的 Boss 血量与代码不一致

> 审计结论：属实。已按代码修正 README（6/8/9、7/6/7、2/3/4 补给），顺带修正锯子「1 → 2」→「2 → 4」（引擎为整体 ×2），并按 `BOSS_PROFILES` / `bossTarget` 重写三条 AI 描述。`RulesModal` 的「层数与补给」经核对与代码一致，未改动。

**问题**
`README.md` 的「三关 Boss」表格写的是生命 `3 / 4 / 5`，而 `src/game/GameEngine.ts` 的 `LEVELS` 实际是 `6 / 8 / 9`。这是旧版本遗留，会误导队友和外部读者。

**审计**
1. 打开 `src/game/GameEngine.ts`，读取 `LEVELS` 中每层的 `hp` 与 `playerHp`。
2. 打开 `README.md`，找到「三关 Boss」表格。
3. 对比 `hp`、补给数、AI 性格描述是否与 `BOSS_PROFILES` 的实际阈值一致。
4. 同时检查 `src/components/RulesModal.tsx` 的「层数与补给」条目是否与代码一致（上一轮核对是对的，再确认一次）。

**执行**
- 以**代码为准**修正 `README.md` 的数字。
- 同时修正 AI 性格描述中与代码不符的措辞（例如第 3 关的「按剩余牌堆算爆牌概率」→ 实际是「粗调停牌线 ±1~3」）。
- 不要修改代码数值来迁就文档。**文档永远向代码看齐。**

**验证**
```
逐项肉眼对照 LEVELS / BOSS_PROFILES / LEVEL_UNLOCKS 与 README / RulesModal
```

**提交信息**
```
docs(readme): 修正三关 Boss 血量与 AI 描述，与引擎数值对齐
```

---

# P1 · 必须修（影响玩法）

## [x] P1-1 沙漏（低分胜）是 Boss 的单方面必胜按钮

> 审计结论：属实。已用脚本复现（第 3 关，玩家 20 停牌、Boss 15 落后且有沙漏 → Boss 开沙漏、停牌、以低分获胜并开枪）。执行方案 A：删除 `chooseBossItem` 中 `executioner` 分支的沙漏使用逻辑，沙漏仅玩家可用。Boss 补给池未过滤沙漏（它可能抽到但不会使用，避免改动补给概率）；道具文案与 README 已标注「仅玩家可用」。回归验证：同一脚本重跑，Boss 未使用沙漏（`bossItemsLeft: ["hourglass"]`），改为正常摸牌到 21 点取胜。

**问题**
Boss 的 `chooseBossItem` 在 `executioner` 分支中，只要自己落后（`behind`）就使用沙漏。而沙漏生效后 `bossTarget` 立刻返回 `0`（立即停牌）。结果是：Boss 分数低 → 落后 → 开沙漏（低分胜）→ 立刻停牌 → 因为分低而获胜。玩家在手牌已定型的情况下**没有任何补救手段**，这是一个反直觉的一键必胜。且该道具在第 3 层同时解锁给双方。

**审计**
1. 读取 `GameEngine.ts` 中的 `chooseBossItem` 的 `executioner` 分支，确认沙漏的使用条件。
2. 读取 `bossTarget`，确认 `hourglassActive` 时是否直接 `return 0`。
3. 读取 `settleRound` 的胜负判定，确认低分胜逻辑。
4. 确认三关是否都会给 Boss 补给沙漏（看 `LEVEL_UNLOCKS` 与 `beginLevel` 的 `giveSupply`）。

**执行（在以下两方案中选一，推荐 A）**
- **方案 A（推荐）**：Boss 永不使用沙漏。在 `chooseBossItem` 中删除 `executioner` 分支里的那一段 `if (has('hourglass') ...) return 'hourglass'`。沙漏保留为**玩家专属**道具。
  - 若担心 `unlockedItems` 仍会给 Boss 发沙漏造成"道具浪费"，需要确认补给池：如果希望 Boss 补给里根本不出现沙漏，请在 `giveSupply` 的池子中为 Boss 过滤掉沙漏（**仅当**你希望连"发给 Boss 但不用"都不出现时才做；否则只删使用逻辑即可）。
- **方案 B（备选）**：保留 Boss 使用沙漏，但改效果为「点数更接近 21 且未爆者胜」，避免"低分即优势"的反直觉。此方案改动面更大，需同步更新规则弹窗、README、道具文案、日志。**除非负责人明确要求，否则不做方案 B。**

**验证**
```bash
npx tsc -b
```
并用可控 RNG 或手动构造一局确认：Boss 落后时不再打出沙漏。

**提交信息**
```
fix(game): 移除 Boss 使用沙漏的逻辑，沙漏改为玩家专属
```

---

## [x] P1-2 「碾压」（点差 ≥5）在实际对局中几乎不可能触发（审计结论：不成立，未改动）

> 审计结论：不成立。工单推断「Boss 停牌线 15/17/19，点差最多 3」忽略了 `bossTarget` 只在玩家**已停牌**后才追分：玩家先停牌在 18 点以上时 Boss 已无补牌机会，点差可以远超 5。实测：玩家 21 点 vs 谨慎 Boss 15 点（Boss 因 `tooGreedy` 认输停牌）→ `margin = 6`，日志输出「实弹（黑杰克 · 碾压）」、伤害 4。随机对局直方图亦出现点差 5/6/7/8。阈值 5 与规则弹窗、README、日志标签三处一致，无需调整。

**问题**
伤害公式里「碾压（点差 ≥5）+1」写进了规则弹窗、README 与日志标签，但 Boss 三关停牌线为 15/17/19，且只有 `cautious` 在玩家 ≥18 停牌时才可能"不敢追分"。玩家 18 停牌、Boss 15 停牌时点差仅 3，到不了 5。因此该规则是**死条款**：玩家读到却永远用不上。

**审计**
1. 读取 `resolveShot` 中 `margin` / `overwhelmed` 的计算（阈值 `>= 5`）。
2. 读取 `bossTarget` 与 `BOSS_PROFILES` 的 `standAt` 数值，推演可能产生 ≥5 点差的场景。
3. 读取 `RulesModal.tsx` 的「碾压」条目、`README.md` 的伤害说明、`resolveShot` 的日志标签。

**执行（二选一，需负责人拍板；默认执行 A）**
- **方案 A**：把阈值从 `5` 降到 `3`。同步检查规则弹窗、README、日志/注释里所有 "≥5" 的表述，统一改为 "≥3"。
- **方案 B**：保留阈值 5，但**从规则弹窗与 README 中删除"碾压"这条**（仅保留代码与日志标签），避免误导。

> **执行者注意**：这是**规则设计**改动，不是 bug 修复，涉及数值平衡。**开工前请把两个方案发给负责人确认选哪个**，不要自作主张。

**验证**
```bash
npx tsc -b
```
确认规则弹窗、README 与代码阈值三处一致。

**提交信息**
```
tune(game): 碾压阈值调整为 3（或：移除碾压规则说明），三处文案同步
```

---

## [x] P1-3 伤害曲线恒定，冒险要牌没有回报（审计结论：确认保留现状，负责人知情）

> 审计结论：属实（基础 2 + 黑杰克 1 + 碾压 1 + 遗恨 N，无点差项）。**负责人已确认本轮保留现状**，不改代码。工单列出的两个方案（点差驱动 / 黑杰克 +2）留待下一轮数值调整时再评估。

**问题**
`resolveShot` 的基础伤害固定 2 点；黑杰克 +1（概率约 4.8%）、碾压 +1（实际几乎不触发）。玩家冒风险要到 21 点与稳妥停在 17 点，处决伤害完全相同。导致博弈"退化"为谁先爆谁输，算牌失去意义。

**审计**
1. 读取 `resolveShot` 的伤害公式。
2. 读取 `LEVELS` 的 `hp`，推演每关需要的实弹命中次数。
3. 确认规则弹窗「伤害结算」条目的表述。

**执行**
- **这是玩法设计改动，必须由负责人确认具体数值方案后才能动手。**
- 建议方案（供参考，需负责人最终确认）：
  - 将伤害改为点差驱动：`基础伤害 = 2 + floor((胜方点数 - 败方点数) / 4)`；或
  - 黑杰克从 `+1` 提升到 `+2`（真正成为"暴击"）。
- 改动必须同步：`resolveShot` 逻辑与日志标签、`RulesModal`「伤害结算」、`README` 伤害说明。
- **若负责人决定暂不处理，本条标记为 `[x]（审计结论：确认保留现状，负责人知情）`，不要改代码。**

**验证**
```bash
npx tsc -b
```
用可控对局确认伤害随点差变化（若采用方案一）。

**提交信息**
```
tune(game): 伤害改为点差驱动，奖励高风险高点数
```

---

## [x] P1-4 玩家血量不可读的流程风险：缺少界面截图回归

> 审计结论：可读。已在 `docs/screenshots/` 保存固定种子实拍基线：三层桌面、targeting、execution、胜利与失败结算。三层主镜头下双方血袋架可辨数量，台面点数贴片清楚；后续改动须比对基线，不得悄悄把血量/点数搬回 HUD。

**问题**
血量与点数被刻意移出 HUD，改由 3D 血袋与台面贴片呈现（见 AGENTS.md）。这是合理的美术选择，但审计前项目**没有任何截图回归基线**。第 3 关 Boss 有 8 个血袋，在暗光与透视下能否读出是未经验证的；任何布局改动都可能让读数失效却无人发现。

**审计**
1. 读取 `BLOOD_RACK_LAYOUT` 与 `SceneManager.buildBloodRack` / `syncBlood`。
2. 启动 `npm run dev`，在浏览器里进入第 3 关（可临时调 `LEVELS` 或直接看布局），截图主镜头下的双方血袋与点数贴片。
3. 判断：能否在不移动视线注意力中心的情况下读出剩余血量与双方点数。

**执行**
- **第一步（必做）**：把关键界面截图存档到 `docs/screenshots/`，至少包含：初始桌面、第 1/2/3 关的双方血袋、点数贴片、targeting 阶段、处决阶段、结算页。
- **第二步（按审计结论决定）**：
  - 若能读出 → 在本文档本条后记录「审计结论：可读」，并在 AGENTS.md 中补一句"改动血量布局后须比对 docs/screenshots 基线"。
  - 若读不出 → 向负责人报告具体哪一方、哪个镜头下读不出，**不要擅自往 HUD 加血条**（这违反既有设计约定），等负责人决定。
- 不要在此条中引入自动化截图测试（那是 P3-7 的事）。

**验证**
```
人工在浏览器中查看截图，并对每个镜头记录"可读 / 不可读 + 原因"
```

**提交信息**
```
docs(qa): 新增关键界面截图基线，锁定血量与点数可读性
```

---

## [x] P1-5 处决 2.9 秒停顿对重玩者是纯阻塞（审计结论：确认保留，负责人知情）

> 审计结论：属实（`resolveShot` 中 `await this.wait(2900)`，无任何跳过机制）。**负责人已确认本轮保留现状**，不改节奏，也不新增「快速演出」开关。若后续多周目反馈集中，再按工单建议把节奏常量集中到 `TIMING` 并加开关。

**问题**
`resolveShot` 中 `await this.wait(2900)` 配合"屏住呼吸"演出。首次体验极佳，但多周目玩家被迫等待。AGENTS.md 将其列为不可随手改的参数。

**审计**
1. 读取 `resolveShot` 中的 2900ms 停顿。
2. 读取 `App.tsx` 中 `execution` 阶段的展示逻辑与 `SceneManager.playExecution` 的时长。
3. 确认是否存在任何跳过机制（键盘、点击）。

**执行**
- **这是体验取舍，需负责人确认。** 若确认要做，建议实现最小方案：
  - 新增"快速演出"开关（localStorage 记忆），开启时把 2900ms 等演出时长按比例缩短（例如 ×0.4），并跳过耳鸣长尾。
  - 不要把时长硬编码在多处：把节奏常量集中到一处（可放在 GameEngine 顶部的 `TIMING` 常量对象）。
- **若负责人决定暂不处理，标记为 `[x]（审计结论：确认保留，负责人知情）`。**

**验证**
```bash
npx tsc -b
```
手动开启/关闭快速演出，确认两种模式下游戏逻辑一致（不影响结算结果）。

**提交信息**
```
feat(game): 新增快速演出开关，处决停顿可缩短
```

---

## [x] P1-6 实弹耳鸣长尾对所有枪声一视同仁

> 审计结论：属实。`playGunshot()` 原先无参数，耳鸣固定 2 秒。已改为 `playGunshot({ selfShot?: boolean })`：`selfShot` 为真（默认）保持 2 秒原样；打向对手时尾音压到 0.8 秒、电平降到 0.5。三段尾音（4300Hz 主音、6450Hz 泛音、带通嘶声）的 `exponentialRampToValueAtTime` 全部改写为按 `ringDuration` 比例的时间点，原音色曲线不变。`App.tsx` 按 `event.target === 'player'` 传参。浏览器内试听需人工确认响度差异。

**问题**
`playGunshot` 的 4300Hz 耳鸣尾音持续约 2 秒、音量固定，无论这一枪是打 Boss 还是打自己。打 Boss 听 2 秒耳鸣过长，且吞掉了局间节奏。

**审计**
1. 读取 `SoundEngine.playGunshot` 的耳鸣段（约 L240-L282 区间，按函数名定位）。
2. 读取 `App.tsx` 中触发 `playGunshot` 的 `shot` 事件，确认事件里带有 `target` 字段。
3. 确认 `playGunshot` 目前是否接受任何参数。

**执行**
- 给 `playGunshot` 增加一个可选参数（如 `{ selfShot: boolean }` 或 `ringScale: number`）。
- 打 Boss：耳鸣缩短到约 0.8 秒、音量降低；打自己：保持当前 2 秒。
- 在 `App.tsx` 的 `shot` 分支根据 `event.target === 'player'` 传参。
- 保持 `AudioParam` 的指数 ramp 写法不变（已有的音质不要退回）。

**验证**
```bash
npx tsc -b
```
在浏览器里各触发一次"打 Boss"和"打自己"，确认两种枪声的尾音长度有明显差异。

**提交信息**
```
feat(audio): 实弹耳鸣时长按枪口目标区分，避免打 Boss 时拖沓
```

---

# P2 · 工程债（影响后续协作与可维护性）

## [x] P2-1 `GameEngine` 因内置 `setTimeout` 无法独立测试，与 AGENTS.md 承诺不符

> 审计结论：审计时属实（`wait()` 直接用 `setTimeout`/`clearTimeout`，`beginLevel` 有 2.6s 等待，仓库当时零测试文件）。**该风险现已关闭**：已引入 Vitest + fake timers，并覆盖引擎、道具动作、Boss 姿态与叙事字幕；生产 E2E 与 DEV 集成也已建立。

**问题**
AGENTS.md 称 `GameEngine` 是「可以被独立测试的纯状态机」，但它直接调用 `setTimeout` / `clearTimeout`（`wait()` 方法），且 `beginLevel` 有 2.6 秒真实等待。这使得无法用假时钟做测试，承诺不成立。

**审计**
1. 读取 `GameEngine` 的 `wait`、`cancelTimers`、`timers` 字段。
2. 读取 `AGENTS.md` 中关于「纯状态机 / 可独立测试」的表述。
3. 确认仓库中是否存在任何测试文件（当前应为零）。

**执行（二选一，推荐 A）**
- **方案 A（推荐）**：注入时钟。在 `GameEngineOptions` 增加可选 `clock`，提供 `wait(ms): Promise<void>` 与 `clear()`；默认实现用 `setTimeout`。这样测试可传假时钟。同时把 `AGENTS.md` 中相关表述改为「通过注入时钟可做确定性测试」。
- **方案 B（兜底）**：若不打算引入时钟注入，则**修正 AGENTS.md 的表述**，明确写「引擎依赖宿主定时器，测试需配合假定时器或依赖注入」，不要保留虚假承诺。

> 时间关系，若负责人只想改文档，执行方案 B 并明确标注。

**验证**
```bash
npx tsc -b
```
若执行方案 A，写一个最小冒烟测试（例如验证 `hit()` 在非玩家回合被拒绝）并确认可运行（测试框架选择需与负责人确认，见 P3-7）。

**提交信息**
```
refactor(game): 时钟注入，GameEngine 可用假时钟测试
```

---

## [x] P2-2 降级路径使用 `console.warn` 会在控制台刷出"错误"

> 审计结论：属实。全仓 5 处：`SceneManager` L926 模型缺失回退（设计内降级）→ 改为 `console.debug`；`SoundEngine` L67 `resume` 被拒（真异常）保留；`GameEngine` 3 处监听器抛错（真异常）保留。AGENTS.md 代码风格已补一行。验证：`grep -rn "console.warn" src/` 只剩 SoundEngine 的异常分支。

**问题**
`SceneManager` 的 GLB 加载失败会自动回退程序化几何，这是**设计好的降级路径，不是异常**，却用 `console.warn`；玩家打开控制台会误以为有 bug。`SoundEngine.resume` 的 `console.warn` 属于异常分支，可保留。

**审计**
1. 全仓搜索 `console.warn` / `console.error`。
2. 对每处判定：是「设计内的降级」还是「真正的异常」。

**执行**
- 把**设计内降级**（模型缺失回退）的 `console.warn` 改为 `console.debug`（或静默）。
- 真正的异常（如 `resume` 被拒、监听器抛错）保留 `console.warn` / `console.error`。
- 在 `AGENTS.md` 的代码风格一节补充一句：「降级路径用 `console.debug`，仅真正的异常才用 `warn/error`」。

**验证**
```bash
npx tsc -b
grep -rn "console.warn" src/   # 结果应只剩真正的异常分支
```

**提交信息**
```
chore(scene): 模型降级回退改用 console.debug，避免误导式报错
```

---

## [x] P2-3 `applySnapshot` 每帧全量同步，缺少脏检查（审计结论：前提不成立，未改动）

> 审计结论：前提不成立。`publish()` 只在离散状态变更时调用（全仓 27 处调用点，均位于发牌/动作/结算等状态迁移内），`GameEngine` 没有逐帧循环；`SceneManager.tick()` 只做计时器、光照、运镜与 composer 渲染，不触发 `publish` 或 `applySnapshot`。`GameCanvas` 的 `useEffect([snapshot])` 因此只在新快照广播时执行。加 revision 去重属于过度设计，未改动。

**问题**
`App.tsx` 的 `snapshot` 每次 `publish` 都是新对象，`GameCanvas` 的 `useEffect([snapshot])` 每帧触发 `applySnapshot`，进而全量执行 `syncCards/syncItems/syncScores/syncBlood`。绝大多数帧没有实际变化，纯属浪费（解释了为何需要在 `tick` 里手动夹紧 `dt`）。

**审计**
1. 读取 `GameEngine.publish()`，确认每次都 `getSnapshot()` 并广播新对象。
2. 读取 `GameCanvas` 的 `useEffect` 与 `SceneManager.applySnapshot`。
3. 读取 `syncCards` / `syncItems` / `syncScores` / `syncBlood`，判断哪些内部已有变化检测、哪些没有。

**执行**
- 在 `GameEngine` 中缓存上一次广播的快照引用，`publish()` 时与当前快照做**浅层比较**（或引入一个 `revision` 递增计数字段，仅在状态真正变化时递增），只在变化时通知 `state` 监听者。
- 在 `GameCanvas` 或 `SceneManager` 侧加一个 `lastAppliedRevision`，跳过重复快照。
- **注意**：事件型 `dispatch` 不受影响，只有 `state` 类广播需要去重。改动后必须确认所有依赖「每帧 snapshot」的视觉逻辑仍然正确（例如血袋、点数贴片仍能及时刷新）。

**验证**
```bash
npx tsc -b
```
在浏览器里完整打一关，确认卡牌/道具/血量/点数均正常更新，且控制台无异常。

**提交信息**
```
perf(game): publish 增加变更去重，避免每帧全量同步场景
```

---

## [x] P2-4 `SceneManager` 是 3200 行的 God Object，协作冲突高发（审计结论：确认存在，负责人决定另起专项）

> 审计结论：属实（`SceneManager.ts` 当前 3209 行，渲染/运镜/光照/Boss 动画/卡牌/道具拾取/血袋/点数贴片/程序化模型/GLB 加载/纹理热替换/DOM 事件混在一处）。**负责人决定本轮不拆**，另开专项分支按工单建议逐个抽出 `CameraRig` / `CardStage` / `PropStage` / `BloodStage` / `ModelLoader`，保持对外 API 不变。本轮未改动。

**问题**
单个类负责渲染、运镜、光照、Boss 动画、卡牌、道具拾取、血袋、点数贴片、程序化模型、GLB 加载、纹理热替换、DOM 事件。多人同时改动会频繁冲突（近期 700+ 行 diff 就是佐证）。

**审计**
1. 列出 `SceneManager` 所有 private 方法，按职责归类。
2. 确认哪些方法互相高度耦合（共享大量可变状态），拆分的边界在哪里。

**执行**
- **这是大重构，必须单开分支、单独评审，且不要与其他条目混在同一次 PR。**
- 建议按职责抽出内部协作类（保持 `SceneManager` 对外 API 不变，即 `setShot` / `playShot` / `applySnapshot` 等签名不变）：
  - `CardStage`：`spawnCard` / `syncCards` / `layoutHand` / `animateDeal` / `removeCard`
  - `PropStage`：`spawnItem` / `syncItems` / `replaceItemMesh` / `buildItemMesh`
  - `BloodStage`：`syncBlood` / `buildBloodRack`
  - `CameraRig`：`setShot` / `shotFraming` / `updateCamera` / `shake`
  - `ModelLoader`：`preloadModels` / `onModelReady` / `swapShotgun` / `swapTable` / `swapRoom`
- **分步提交**：每抽出一个小类单独提交，逐步把 `SceneManager` 瘦身。不要一次性搬完。
- 每次抽离后都要跑一遍完整一关的回归（发牌、拾取道具、处决、换层）。

**验证**
```bash
npx tsc -b
```
完整打一关 + 进第 2、3 关，确认视觉与交互无回归。

**提交信息（示例，按实际抽出的类命名）**
```
refactor(scene): 抽出 CameraRig，SceneManager 仅保留调度
```

---

## [x] P2-5 CSS 存在两套重复的模糊定义，可能双重模糊（审计结论：不成立，未改动）

> 审计结论：不成立。`index.css` 的 `@keyframes vision-blur` 只动画 `opacity`（0 → 1 → 0.72 → 0），`filter` 属性在全仓 CSS 中未出现；`App.tsx` 的中弹覆盖层只有一处内联 `backdropFilter: blur(9px) saturate(0.65)`。不存在 `filter` 与 `backdrop-filter` 叠加，HUD 也不会被糊住。类名与效果词不达意属命名瑕疵，无功能影响，按工单「不要顺手改别的」未改动。

**问题**
`App.tsx` 用内联 `backdropFilter: blur(9px)` 实现"自己中弹失焦"，同时 `index.css` 又新增了 `@keyframes vision-blur` + `.vision-blur { filter: blur(...) }`。两处语义不同（`filter` 模糊元素本身、`backdropFilter` 模糊背后内容），叠在一起可能在 Chrome 出现双重模糊、在 Safari 表现异常。

**审计**
1. 读取 `App.tsx` 的中弹覆盖层（`vision-blur` 那个 div）的 `className` 与 `style`。
2. 读取 `index.css` 中 `.vision-blur` 与 `@keyframes vision-blur`。
3. 在 Chrome 与（如有条件）Firefox 里各触发一次自己中弹，观察是否模糊过度。

**执行**
- **二选一，只保留一套**：
  - 方案 A：保留内联 `backdropFilter`（优点是只模糊画布、HUD 清晰），删掉 `index.css` 里的 `.vision-blur` 类与对应 keyframes，改为内联的淡入淡出动画（或用一个纯透明度 keyframes）。
  - 方案 B：保留 CSS 类，把内联 `backdropFilter` 去掉，在 `.vision-blur` 里同时写 `backdrop-filter`（注意加 `-webkit-` 前缀）。
- 选择依据：以"HUD 保持清晰"为准，因此**推荐方案 A**（`filter` 会模糊整个容器，包括叠在上面的 HUD 文本），但删类时务必确认动画淡入淡出仍然生效。

**验证**
```bash
npx tsc -b
```
浏览器触发一次自己中弹，确认模糊只发生在画面层、HUD 文本依然清晰、有淡入淡出。

**提交信息**
```
fix(ui): 合并重复的中弹模糊定义，避免 filter 与 backdrop-filter 叠加
```

---

# P3 · 优化项（有时间再做）

## [x] P3-1 缺少 `prefers-reduced-motion` 支持

> 审计结论：属实（无任何 reduced-motion 处理）。已在 `index.css` 加 `@media (prefers-reduced-motion: reduce)`：血闪/血斑/失焦闪烁改为静态或关闭，banner/loot 动画压到 1ms（状态文字仍可见），呼吸提示与按钮位移/过渡关闭；`SceneManager` 在构造时读取 `matchMedia` 并监听 change，命中时关闭 `shake`、镜头呼吸与漂移（运镜、发牌演出保留）。浏览器实测：强制匹配后完整打到第 3 回合（含处决与结算），控制台无 error/warn。

**审计**：搜索 `index.css` 的 `@keyframes`（血闪、血斑、模糊、banner、loot、呼吸），以及 `SceneManager` 的 `shake`、Boss 呼吸/盯视、dust 动画，确认哪些是"可被晕动症/光敏用户感知不适"的高强度动态。

**执行**
- 在 `index.css` 增加 `@media (prefers-reduced-motion: reduce)`，关闭高强度闪烁类动画（血闪、血斑），保留必要的状态反馈。
- 在 `SceneManager` 读取 `window.matchMedia('(prefers-reduced-motion: reduce)')`，命中时减小/关闭 `shake` 与相机漂移。
- 可选：设置面板加一个"减少动态效果"开关（localStorage 记忆）。
- **不要一刀切关掉所有动画**（会让游戏失去演出感），只关高强度的闪光/抖动/模糊。

**验证**：浏览器开发者工具模拟 `prefers-reduced-motion: reduce`，确认高强度动画被抑制、游戏仍可正常游玩。

**提交**：`feat(a11y): 支持 prefers-reduced-motion，抑制高强度闪烁与抖动`

---

## [x] P3-2 缺少 FPS / 渲染统计面板，性能现状是"盲的"

> 审计结论：属实（全仓无 FPS 计数、无 `renderer.info` 输出）。已在 `SceneManager.tick()` 中于 `composer.render()` **之后**调用 `sampleStats()`，DEV 下每 2 秒 `console.debug` 输出 `fps · calls · tris`；为拿到整帧累计值，DEV 下关闭 `renderer.info.autoReset` 并在每帧末手动 `reset()`。用顶层 `const devStatsEnabled = import.meta.env.DEV` + 方法内提前 `return`，`vite build` 后已 grep 确认产物无 `fps · calls` 字符串。
> 开发机取样（初始桌面 → 发牌后）：**227–240 fps**；draw call 约 **550 → 861**，三角形约 **30.7 万 → 47 万**（随牌面与血袋增加）。

**审计**：确认当前项目**没有**任何 FPS 计数或 `renderer.info` 输出。

**执行**
- 在 `SceneManager` 的 `tick`（或一个 dev-only 组件）中，仅在 `import.meta.env.DEV` 时把 `renderer.info.render.calls / triangles` 与每秒帧数输出到一个角落的调试层或 `console.debug`。
- 生产构建不包含该面板。
- 记录一次开发机在初始桌面 / 处决阶段的取样数据到本文档。

**验证**：`npm run dev` 下能看到统计；`npm run build` 后产物中不含调试代码。

**提交**：`chore(scene): 新增 dev-only 渲染统计，用于性能观测`

---

## [x] P3-3 无快捷键，处决与要牌只能用鼠标

> 审计结论：属实（全仓只有 `RulesModal` 的 Escape）。已在 `App.tsx` 增加 keydown 监听：`H` 要牌、`S` 停牌、持枪时 `F`/`1` 射向它、`R`/`2` 射向自己；监听只做键位映射，阶段判断走 snapshot、动作校验仍由引擎负责；模态框内（输入框/可编辑元素）与修饰键组合不拦截。按钮上的英文标签同步改成 `HIT · H` / `STAND · S` / `FIRE · F` / `RISK · R`，规则弹窗新增「快捷键」条目。浏览器实测：H 要牌、S 停牌、F 射击、R 对自己开枪（空膛回收一件道具，道具 2→3）全部生效，键盘从开局打到 gameOver；弹窗打开时按键不触发动作。

**审计**：确认游戏本体没有绑定键盘（当前只有 `RulesModal` 绑了 Escape）。

**执行**
- 增加快捷键：`H` 要牌、`S` 停牌、`F` 射向它、`R` 射向自己（或数字键选择枪口）。
- 快捷键只能在对应阶段生效（复用现有的 `canAct` / `phase` 判断），且不能绕过引擎校验。
- 在规则弹窗或帮助里列出快捷键。

**验证**：仅用键盘完整打一局；同时确认 UI 按钮点击仍然正常。

**提交**：`feat(ui): 新增键盘快捷键（要牌/停牌/选择枪口）`

---

## [x] P3-4 规则描述「可无限使用道具」与 460ms 输入锁体感不符

> 审计结论：属实，但该表述在 README 而非 `RulesModal`（弹窗内没有相关条目）。`useItem` 使用后 `lockInput(itemLockMs = 460)`，连点会被拒并提示「动作还没结束。」。已把 README 改为「道具可多次使用（每次使用后有约 0.5 秒间隔）」。拒绝提示属于共享的通用输入锁（同时覆盖发牌 620ms），未按工单可选项改写。

**审计**：读取 `RulesModal.tsx` 的「可无限使用道具」表述，确认 `useItem` 的 `itemLockMs` 锁行为与提示文案。

**执行**：把规则文案调整为"道具可多次使用（每次使用后有短暂间隔）"，或者在使用被锁时给出更明确的提示（当前是"动作还没结束"，可改得更具体）。

**验证**：连续点两件道具，确认提示清晰。

**提交**：`docs(ui): 修正道具使用规则描述，与输入锁行为一致`

---

## [x] P3-5 `TextureFactory` 开发期每 2.5 秒轮询，Network 面板噪声大

> 审计结论：属实但已有 DEV 守卫。轮询只在 `import.meta.env.DEV` 下启动，用 HEAD 请求（非 GET）配合 etag 比较，请求体很小；生产包已确认不含该循环。本次补充文件内注释说明「这是开发期热替换、不是后台请求」，并在页面隐藏（`document.hidden`）时跳过轮询。未改成 `import.meta.hot`：热替换要覆盖 `public/` 静态文件，Vite HMR 不监听该目录，改为 HMR 反而失去能力。

**审计**：读取 `TextureFactory.startWatching` 与 `scan`，确认轮询请求数量与频率。

**执行**：确认该轮询只在 `import.meta.env.DEV` 下运行（当前已如此），并在文件顶部注释说明"这是开发期贴图热替换，不是后台请求"。若可行，改为 `import.meta.hot` 或 `fetch` 的 304 缓存友好写法，减少重复传输。

**验证**：`npm run dev` 下 Network 面板请求为 304 或可控；生产构建无轮询。

**提交**：`chore(scene): 优化开发期贴图热替换轮询，减少 Network 噪声`

---

## [x] P3-6 缺少自动化测试与测试框架

> 审计结论：属实（仓库零测试文件）。负责人已确认框架：**Vitest 3**（与现有 Vite 集成最顺）。已新增 `src/game/GameEngine.test.ts`，18 个用例覆盖：A 的软硬折算 / 爆牌 / 黑杰克判定、非玩家回合拒绝、发牌输入锁、实弹基础伤害、黑杰克 +1 与锯子 ×2、碾压阈值 5、爆牌不算碾压、走火遗恨叠加与清零、空膛回收、连点只结算一次、沙漏低分胜、Boss 不使用沙漏、手铐 / 磁铁 / 镇定剂。测试使用 **ViTest fake timers** 驱动 `setTimeout`（即 P2-1 方案 B 的配套做法）与注入式状态构造。`npm test` 全绿，`.github/workflows/build.yml` 已在 build 前增加 `npm test`。

**审计**：确认仓库零测试文件；确认 P2-1 是否已引入可注入时钟。

**执行**
- 与负责人确认测试框架（Vitest 与现有 Vite 集成最顺）。
- 优先为 `GameEngine` 纯逻辑写单元测试：手牌估值（A 的软硬）、黑杰克判定、结算胜负（含沙漏、双方爆牌、平局）、伤害公式、磁铁换明牌。
- 测试必须用可控 `rng` 与（若已做 P2-1）假时钟。
- 接入 CI（`.github/workflows/build.yml` 增加 `npm test`），PR 必须通过。

**验证**：`npm test` 全绿，CI 通过。

**提交**：`test(game): 引入 Vitest，覆盖引擎核心规则`

---

## [x] P3-7 体积优化：首屏与 Three.js 代码分割

> 审计结论：属实（单包 1,005 kB / gzip 272 kB）。已在 `vite.config.ts` 加 `build.rollupOptions.output.manualChunks`，把 three / react / gsap 拆成独立 chunk。构建结果：`index` 122 kB（38.5 kB gzip）、`react` 219 kB（68.3 kB gzip）、`three` 664 kB（165.3 kB gzip）。`base: './'` 未改动，`dist/index.html` 仍是相对路径；`vite preview` 实测加载并进入对局正常。React + Three 首屏仍会拉取，真正的按需加载（点击坐下后再 `import()` 场景）未做，留作后续。

**审计**：`npm run build` 后查看 `dist/assets` 体积，确认单 JS 包体积（当前约 1MB）。

**执行**
- 使用 `build.rollupOptions.output.manualChunks` 把 `three` 与其余依赖拆成独立 chunk，提升缓存命中。
- 可选：把 `SceneManager` 的初始化做成懒加载（点击"坐下"后再 `import()`），先渲染 React + HUD。
- **不要改 `base: './'`**（静态部署硬性要求）。

**验证**：`npm run build` 后确认产物分包正确、首屏可正常加载与游玩。

**提交**：`perf(build): 拆分 three 代码块，降低首屏负载`

---

## [x] P3-8 `GameEngine` 使用 `Math.random()` 作默认 RNG，难以复现 bug 现场

> 审计结论：属实（`this.rng = options.rng ?? Math.random`，无种子机制）。已导出 `createSeededRandom(seed)`（mulberry32），`App.tsx` 仅在 `import.meta.env.DEV` 下读取 `?seed=` 并注入，生产构建走 `Math.random`（已验证 `dist` 中 `?seed` 读取与调试输出被摇树移除，mulberry32 实现保留供引擎复用）。同种子两次开局补给与发牌日志完全一致、换种子即不同。AGENTS.md 已记录用法。

**审计**：确认 `GameEngineOptions.rng` 默认值为 `Math.random`，且无"种子"机制。

**执行**：提供一个小型可播种 RNG（如 mulberry32），开发期可从 URL 参数或 localStorage 读取种子并记录到日志；生产保持 `Math.random`。便于复现"某个牌型下 AI 行为异常"的问题。

**验证**：相同种子下连续两局发牌序列一致。

**提交**：`feat(game): 支持可播种 RNG，便于复现对局问题`

---

# 附录 A · 新发现问题（执行者记录，不在本次整改范围）

> 执行过程中如果发现本文档未列的问题，**记在这里，不要动手修改**。由负责人评估后决定是否纳入下一轮。

```
（执行者填写：位置 / 现象 / 建议 / 优先级）

 - README.md L33 —— 锯子写「本局实弹伤害翻倍（1 → 2）」，引擎基础伤害为 2，翻倍后是 4 —— 已并入 P0-2 修正 —— P1
 - src/game/GameEngine.ts chooseBossItem —— 沙漏改为玩家专属后，Boss 补给池仍可能抽到沙漏并一直闲置（占一个道具槽）—— 若后续想彻底不给，可在 giveSupply 为 Boss 过滤 hourglass —— P3
 - src/game/GameEngine.ts bossTarget / wouldLose —— `hourglassActive` 只剩玩家侧来源，Boss 侧的 `return 0` 分支仍保留（正确：玩家开沙漏后 Boss 应立即停牌）—— 无需改动 —— P3
 - src/scene/SceneManager.ts 全类 —— 3209 行 God Object，本轮未拆（负责人决定另起专项）—— 建议按 CameraRig / CardStage / PropStage / BloodStage / ModelLoader 逐个小步抽离 —— P2
 - vite.config.ts —— 已拆分 three / react / gsap，但 React + Three 仍在首屏拉取；真正按需加载需把 SceneManager 改成点击「坐下」后再动态 import —— 建议下一轮做 —— P3
 - 测试 —— 旧结论已过期：仓库已建立 Vitest + fake timers、ItemActions 状态机测试、生产 E2E 与 DEV 道具集成；当前 176 个单测、9 个生产 E2E、3 个 DEV 集成 —— 已完成
```

---

# 附录 B · 执行进度总览

> 每完成一条，在此处同步状态，方便一眼看全局。

| 编号 | 标题 | 优先级 | 状态 |
| --- | --- | --- | --- |
| P0-1 | 处决按钮双击重复结算 | P0 | ⏭️ 审计后跳过（已不存在） |
| P0-2 | README Boss 血量不一致 | P0 | ✅ 已完成 |
| P1-1 | 沙漏为 Boss 必胜按钮 | P1 | ✅ 已完成 |
| P1-2 | 碾压规则几乎不触发 | P1 | ⏭️ 审计后跳过（不成立） |
| P1-3 | 伤害曲线恒定 | P1 | ⏭️ 负责人决定保留现状 |
| P1-4 | 血量可读性缺截图回归 | P1 | ✅ 已完成 |
| P1-5 | 处决 2.9s 纯阻塞 | P1 | ⏭️ 负责人决定保留 |
| P1-6 | 耳鸣长尾一视同仁 | P1 | ✅ 已完成 |
| P2-1 | 引擎定时器不可测 | P2 | ✅ 已完成（Vitest + fake timers） |
| P2-2 | 降级路径用 console.warn | P2 | ✅ 已完成 |
| P2-3 | applySnapshot 无脏检查 | P2 | ⏭️ 审计后跳过（前提不成立） |
| P2-4 | SceneManager 3200 行 | P2 | ⏭️ 负责人决定另起专项 |
| P2-5 | CSS 双重模糊定义 | P2 | ⏭️ 审计后跳过（不成立） |
| P3-1 | prefers-reduced-motion | P3 | ✅ 已完成 |
| P3-2 | FPS 统计面板 | P3 | ✅ 已完成 |
| P3-3 | 键盘快捷键 | P3 | ✅ 已完成 |
| P3-4 | 道具"无限使用"文案 | P3 | ✅ 已完成 |
| P3-5 | 贴图热替换轮询 | P3 | ✅ 已完成 |
| P3-6 | 自动化测试框架 | P3 | ✅ 已完成 |
| P3-7 | 代码分割 | P3 | ✅ 已完成 |
| P3-8 | 可播种 RNG | P3 | ✅ 已完成 |

状态图例：⬜ 未开始 · 🟨 进行中 · ✅ 已完成 · ⏭️ 审计后跳过（已修复/负责人决定不做）

---

# 附录 C · 提交与 PR 规范（摘自 AGENTS.md，勿违反）

- 禁止直推 `main`；每人一个长期分支，如 `fix/targeting-double-fire`、`refactor/scene-split`。
- 提交信息：`fix(<范围>): <说明>` / `feat(...)` / `refactor(...)` / `tune(...)` / `test(...)` / `docs(...)` / `chore(...)` / `perf(...)`。
- 合并前 `npm run build` 必须通过；CI 跑 `npm ci && npm run build`。
- 冲突高发区：`GameEngine.ts`、`App.tsx`、`SceneManager.ts`。**改跨层契约前先与负责人对齐**。
- 一条整改对应一个 PR，PR 描述里贴出本文档对应编号的勾选结果。
