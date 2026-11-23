# Blood Ante · 关卡间 2D 过场方案评估

> 目标：在「一关结束到下一关之间」加入 2D 像素风过场动画（含人物）。
> 本文档 = 现状梳理 + 多方案对比 + 选定方向（D）+ 可直接施工的提示词。
> 施工提示词见文末 `§6`，可直接整段复制给 Qoder CN。

---

## 1. 现状梳理（阅读基线）

### 1.1 技术栈

| 层 | 技术 |
|---|---|
| 框架 | React 19 + TypeScript ~7.0（`tsc -b` 构建） |
| 3D | Three.js r187（`src/scene/SceneManager.ts` 5473 行，`src/intro/CorridorScene.ts` 走廊独立场景） |
| 动画 | GSAP（`^3.15.1`，主要在 2D DOM / CSS 过渡里也可手写） |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`） |
| 音效 | 100% Web Audio 实时合成（`src/audio/SoundEngine.ts`，零外部素材） |
| 构建 | Vite 8，双入口 `index.html` + `moyan.html`，`base: './'` |
| 测试 | Vitest（引擎单测）+ Playwright（e2e） |

关键事实：**贴图全部由 Canvas 2D 程序化生成**（`TextureFactory.ts` / `PixelArt.ts`），零外部美术素材是硬约束。所以「像素 2D 带人物」的最自然落点就是 **Canvas 2D 程序化绘制 + 序列帧渲染**，而不是视频文件或成堆 PNG。

### 1.2 三层分层（严格单向依赖）

```
game/GameEngine.ts   【纯逻辑状态机】不 import React/Three/DOM
scene/               【3D 表现】只读 snapshot
audio/               【音效】合成
components/          【桥接】GameCanvas / RulesModal / useDialogFocus
App.tsx              【UI 覆盖层】HUD、演出、结算、事件接线
```

### 1.3 关卡结构与切换逻辑（关键）

- 三层：`LEVELS[0..2]`（`GameEngine.ts` 第 170 行），第 3 层 Boss 倒下直接进 `victory`。
- 玩家可见的「关」= 引擎的 `levelIndex`。清一层的完整链路：

```
boss.hp <= 0
  → resolveDeaths()（第 1317 行）
      levelIndex >= last ? victory
      : phase='levelClear' + dispatch levelClear + offerSupply()
  → offerSupply()（第 1355 行）
      await wait(SUPPLY_DELAY_MS=2600)   // 2.6s 清层横幅窗口
      → phase='supply'，摆出 2~3 件候选，waitSupplyPick()（12s 超时自动取第一件）
      → carryOver.push(picked)
      → generation++ / cancelTimers()
      → beginLevel(levelIndex+1)（第 930 行）
```

- 注意：**`levelClear` 没有暴露给 UI 一个「玩家点了下一关」的按钮**，进下一层由引擎在 `supply` 选完后自动 `beginLevel`。所以「进关前插过场」的切口在 `beginLevel` 开头那段 `await this.wait(2600)` 里。
- 现有章节过渡：`App.tsx` 第 673 行监听 `levelClear`，`event.level===1 → beginNarrative('t2')`，`===2 → beginNarrative('t3')`。也就是说 **T2/T3 已经占了 levelClear→supply 这一段窗口**（纯字幕 + 3D 机位）。你选的 D 要插在「补给选完、`beginLevel` 开打前」，和 T2/T3 不重叠、不打架。

### 1.4 已有过场 / UI 系统（可复用）

| 系统 | 文件 | 能力 |
|---|---|---|
| 叙事导演层 | `narrative/NarrativeDirector.ts` | rAF 时钟推进 beat；`pause/resume/skip`；后台标签页自动暂停 |
| 叙事覆盖层 | `narrative/NarrativeOverlay.tsx` | 黑幕 opacity、对焦 blur、letterbox、账页卡片、打字机字幕（65ms/字，标点 +260ms） |
| 分镜脚本 | `narrative/script.ts` | `NarrativeBeat` 结构：`at / shot / shotDuration / line / lineEnd / sfx / grade / black / letterbox / ledger / mood / action` |
| 走廊序章 | `intro/CorridorScene.ts` + `components/CorridorIntro.tsx` | 独立 Three 场景 + CRT glitch 后处理 + 回调 onComplete（可参考它的自包含生命週期） |
| 像素美术 | `scene/PixelArt.ts` / `TextureFactory.ts` | 程序化 Canvas 贴图范式，像素风人物可直接沿用这套绘制思路 |
| 存档/检查点 | `App.tsx` `CHECKPOINT_KEY` + `game.startAtLevel()` | localStorage 存 `{levelIndex, carryOver, runRounds}`；刷新后「继续第 N 层」按钮 → `startAtLevel` → `beginLevel` |

### 1.5 存档/读档需要过场的路径（重要）

- 正常：`levelClear → supply → beginLevel(N+1)` → **要播**（第 2、3 层首次进入）。
- 读档：`App.tsx:822` 的「继续第 N 层」按钮 → `game.startAtLevel(levelIndex, carryOver)` → `beginLevel`。**这条也会进 `beginLevel`**，如果过场只按「进 N 层就播」判断，读档回到第 2/3 层会重播。所以必须加「本 run 是否已播过」的标记（存在 `NARRATIVE_SEEN` 同理的 localStorage 或内存 ref），读档不重播。

### 1.6 时长预算（来自 `NARRATIVE-HANDOFF.md` §7.3）

| 段落 | 上限 |
|---|---|
| 章节过渡 T2 / T3 | 各 6.5s |
| 重开 | 4.2s |
| 结局 | 7.2s |

**新增 2D 过场不能把「清层到能操作下一关」的总等待拉爆。** 你选的 D 是压在 `beginLevel` 的 2.6s 窗口里再加上去，建议单段 2D 过场 **≤ 4s**，且可跳过，避免「每关之间又卡 6 秒」的观感。

---

## 2. 多方案对比

| 方案 | 切口 | 形态 | 适用场景 | 实现成本 | 对现有代码改动范围 |
|---|---|---|---|---|---|
| **A 独立 2D 层叠在 T2/T3 之上** | `levelClear` 事件后 | 新建 2D Canvas 覆盖层，先播 2D 再交回 T2/T3 | 想保留现有字幕过渡、再叠视觉 | 中 | 新增 `narrative/Cutscene2D.*`；改 `App.tsx` `handleEventNarrative`；引擎零改 |
| **B 2D 替换 T2/T3** | `levelClear` 事件 | 彻底用 2D 过场替掉字幕过渡 | 视觉最统一，一次做干净 | 高 | 退役 / 改写 `T2_BEATS / T3_BEATS` 消费路径 + e2e 重跑 |
| **C 只做通关整段** | `gameOver(winner=player)` 前 | 结局前一段 2D | 范围最小，只收尾 | 低 | `App.tsx` 结局 B 分支前插一段 |
| **D 每关进关前前置动画（选定）** | `beginLevel` 前 2.6s 窗口 | 进第 2、3 层前，补给选完后播像素 2D 前置段 | 最贴合「关与关之间」直觉；不改 `levelClear→supply` 与 T2/T3 | 中低 | 新增 `narrative/Cutscene2D.*` + `App.tsx` 监听 `checkpoint`/`roundStart` 前一刻挂载；引擎零改；存档需加「已播」去重 |

**为什么选 D**：切口干净（在 `beginLevel` 的 2.6s 横幅窗口），和已有 T2/T3 不抢同一窗口；引擎 `GameEngine.ts` 一行不用动；2D 层可以完全自包含（照 `CorridorScene` 的生命週期做），失败可回退（不播就是原本的 2.6s 黑场横幅）。

**D 的注意点（必须写进提示词）**：
1. 触发时机：`levelClear → supply 选完 → carryOver 落定 → 即将 beginLevel(N+1)`，`N ∈ {1,2}`（第 2、3 层）。
2. 不能拖垮补给：过场在补给选完**之后**播，不占用 12s 补给窗口。
3. 读档去重：`startAtLevel` 进入的层不重播（用「本 run 已播关卡集合」去重）。
4. e2e：现有 4 个用例走完 40s 入场，若过场默认播放，e2e 需要能跳过（提供 `?skipcutscene=1` 或 DEV 口）。

---

## 3. 选定方向 D · 技术设计要点

- **渲染载体**：`<canvas>` + 2D context，逐帧 `requestAnimationFrame` 画像素场景与人物。沿用 `PixelArt.ts` 的调色板/像素块绘制范式，保证和全项目「程序化 Canvas」一致，零外部 PNG/视频。
- **人物表现**：像素风剪影/半身像，用矩形色块 + 明暗两档拼出轮廓，关键帧（入场、抬手、转身、定格）用「画格序列」实现——即 `frames[i]` 是一组绘制指令，`i` 随时间推进，等价于手绘序列帧但不落地成图片文件。
- **分镜层次**：至少 3 层视差——背景（门/墙/血袋架剪影）静止或极慢平移；中景（Boss 剪影/人物）中速；前景（灰尘、火光粒子、letterbox 字）快速。营造纵深。
- **时长**：单段 2.5~4s，可跳过可重播。
- **分辨率适配**：内部按逻辑分辨率绘制（如 480×270），`canvas` 用 `image-rendering: pixelated`，CSS 拉满容器，`devicePixelRatio` 只在整数倍缩放时提升，避免像素糊边。
- **音频**：复用 `SoundEngine` 现有合成音效（`playDoorLock / playLowThump / playBossBreath / playStitch / playCoin` 等），不新增音频素材；若确需新音色，用 Web Audio 现场合成配方。

---

## 4. 与现有系统的接线点

| 接线 | 现状 | 改动 |
|---|---|---|
| 触发 | `App.tsx` 订阅 `game.subscribe`，收到 `checkpoint` 事件（`beginLevel` 第 960 行 dispatch） | 在 `checkpoint` 事件、且 `phase` 即将 reloading 时，判断是否本 run 首见该层 → 播 2D 过场 |
| 挂载 2D 层 | `App.tsx` 顶层 JSX，`narrativeActive` 已有同类覆盖层 | 新增 `<CutsceneOverlay>` 条件渲染，z-index 与 `NarrativeOverlay` 同级（z-40） |
| 跳过 | `skipNarrative()` 已有范式 | 2D 层自带 `onSkip`，键盘 Space/Esc 复用 |
| 暂停 | `togglePause` 调 `directorRef.current?.pause()` | 2D 层同样实现 `pause()/resume()`，接进 `togglePause` |
| 存档 | `checkpoint` 写 localStorage | 玩家可跳过后照常存档；「已播集合」另存一个 key（如 `blood-ante.cutsceneSeen.v1`） |
| 读档 | `startAtLevel` 直接 `beginLevel` | 用「已播集合」判断，读档层已在集合里则不播 |

---

## 5. 施工前置清单（给 Qoder 的输入）

- 读：`src/narrative/NarrativeDirector.ts`、`src/narrative/NarrativeOverlay.tsx`、`src/narrative/script.ts`、`src/scene/PixelArt.ts`、`src/components/CorridorIntro.tsx`（自包含层范式）、`src/App.tsx`（`handleEventNarrative` / `beginNarrative` / `togglePause` / checkpoint 分支）、`src/game/GameEngine.ts` 的 `Phase` / `GameSnapshot` / `beginLevel` / `offerSupply` / `checkpoint` 事件。
- 禁止改：`src/game/GameEngine.ts`（一行不改）。
- 需要新增：`src/narrative/Cutscene2D.ts`（导演/绘制）、`src/narrative/CutsceneOverlay.tsx`（React 覆盖层）、`src/narrative/cutsceneScript.ts`（分镜数据）。

---

## 6. 可直接交给 Qoder CN 执行的提示词

> 从下面 「=== PROMPT BEGIN ===」 到 「=== PROMPT END ===」 整段复制，粘给 Qoder CN。

=== PROMPT BEGIN ===

# 任务：为《Blood Ante · 血色底注》在「每一关开始之前」加入 2D 像素过场动画

## 0. 项目背景

《Blood Ante · 血色底注》是第一人称 3D 暗黑桌面博弈恐怖游戏：21 点决定谁拿枪、俄罗斯轮盘决定谁流血，穿过三层地牢的 Boss。技术栈 React 19 + TypeScript ~7 + Three.js r187 + Tailwind CSS 4 + Web Audio 实时合成（**零外部美术素材，所有贴图程序化 Canvas 生成**）。构建 Vite 8，双入口 `index.html` / `moyan.html`，`base:'./'`。

工作目录：`D:\qoderprojects\blood-ante`。

## 1. 相关文件路径（先读再动手）

- `src/game/GameEngine.ts` — 纯逻辑状态机。只看不改。重点读：`Phase`（第 3 行）、`GameSnapshot`（第 236 行）、`beginLevel`（第 930 行）、`offerSupply`（第 1355 行）、`resolveDeaths`（第 1317 行）、`checkpoint` 事件（第 960 行 dispatch）。
- `src/narrative/NarrativeDirector.ts` — 现有叙事导演层（rAF 推进、pause/resume/skip），2D 过场导演层照它的结构写。
- `src/narrative/NarrativeOverlay.tsx` — 现有覆盖层（黑幕/letterbox/打字机），2D 层与之同级 z-index。
- `src/narrative/script.ts` — 现有分镜 beat 结构，2D 分镜数据结构参考它。
- `src/scene/PixelArt.ts`、`src/scene/TextureFactory.ts` — 程序化 Canvas 绘制范式，像素画法沿用它的调色板与色块思路。
- `src/components/CorridorIntro.tsx` + `src/intro/CorridorScene.ts` — 自包含过场层的生命週期范式（创建→start→dispose)，2D 层照抄这套。
- `src/App.tsx` — `handleEventNarrative`（第 644 行）、`beginNarrative`（第 699 行）、`skipNarrative`（第 726 行）、`togglePause`（第 251 行）、checkpoint 分支（第 651 行）、「继续第 N 层」按钮（第 822 行 → `startAtLevel`）。
- `src/audio/SoundEngine.ts` — 复用现有合成音效，不新增音频文件。

## 2. 目标与硬约束

- 在「一关结束 → 下一关开始」之间，插入一段 **2D 像素风、带人物的手绘过场动画**。
- **禁止修改 `src/game/GameEngine.ts`，一行都不能改。**
- **零外部美术素材**：2D 过场必须用 Canvas 2D 程序化绘制（像素块 + 序列帧式的绘制指令帧），不允许引入 PNG 序列帧、精灵图集或视频文件（webm/mp4）。
- 音频只用 `SoundEngine` 现有合成音效；若确需新音色，用 Web Audio 现场合成配方，不落地音频文件。
- 遵守分层单向依赖：`game ← scene/audio ← components ← App`。新增 2D 层只能被 `App.tsx` 调用，不得反向依赖引擎。

## 3. 触发时机与流程

### 3.1 触发条件
- 发生在玩家清层、完成层间补给选择（`supply` 阶段 `chooseSupply` 完毕、`carryOver` 已落定）之后、引擎 `beginLevel(N+1)` 正式开打之前。
- 具体落点：`App.tsx` 订阅 `game.subscribe` 收到的 `checkpoint` 事件（`GameEngine.ts` 第 960 行在 `beginLevel` 里 dispatch，携带 `levelIndex`）。当收到 `checkpoint` 且其 `levelIndex ∈ {1, 2}`（即即将进入第 2、3 层）时，触发对应关的 2D 过场。
- 第 1 层不触发（第 1 层由 40 秒入场 + 走廊铺满，不重复）。
- 第 3 层 Boss 倒下进 `victory`，不属于「进下一关」，不触发本过场。
- 实现方式建议：2D 过场作为一层覆盖在引擎 `beginLevel` 的 2.6s 横幅窗口上播放（引擎此时处于 `reloading`，输入本就锁死），播完 / 跳过后不阻塞引擎，引擎原时序不变。**不得让 2D 过场篡改引擎时序或相位。**

### 3.2 流程
1. 收到 `checkpoint(levelIndex=N)`：
   - 若本 run 已播过第 N 层（见 3.4 去重），直接跳过，走原流程。
   - 否则置 `cutsceneActive = true`，挂载 2D 覆盖层，调 `SoundEngine` 播开场音效（如 `playDoorLock` / `playLowThump`）。
2. **淡入**：从全黑 `opacity:1` 起始，约 400ms 淡入到画面（`black:1 → 0`）。
3. 播放分镜帧序列（见 §4），期间引擎照常在后台 `reloading`。
4. **淡出**：末段约 400ms 渐黑，`black:0 → 1`，随后与本层 `beginLevel` 的 reloading 黑场衔接，`cutsceneActive=false`，卸载覆盖层。
5. 全过程最长不超过 **4 秒**（含淡入淡出）；超时自动结束，防卡死。

### 3.3 跳过与重播
- **跳过**：播放期间按 `Space` 或 `Esc` 立即淡出（≤200ms）结束过场，交回引擎。跳过按钮在画面右下角淡显「空格跳过」（复用 `App.tsx` 现有跳过字幕的样式约定）。
- **重播**：提供内部接口 `replayCutscene(levelIndex)`（DEV 口可挂到 `window.__cutsceneDebug`，生产摇掉），用于调试与验收；玩家侧不做重播 UI。
- 跳过后标记该层「已播」，不再重播。

### 3.4 存档 / 读档兼容（务必实现）
- 正常推进：`levelClear → supply → beginLevel(N+1)` 整条链路照常播（第 2、3 层首见时）。
- 读档：`App.tsx` 的「继续第 N 层」按钮走 `game.startAtLevel(levelIndex, carryOver)` → `beginLevel`，**这条路径进入第 2/3 层不得重播已看过的过场**。
- 去重实现：维护「本 run 已播关卡集合」，落 `localStorage` key 例如 `blood-ante.cutsceneSeen.v1`（形如 `{v:1, seen:[2,3]}`）；进入某层前若已在集合中则不播。新开一局（`restart` / 全新 run）清空该集合。
- 暂停兼容：`togglePause(true)` 时 2D 层必须同步 `pause()`（停 rAF、冻结帧），`resume()` 时继续；接进 `App.tsx` 的 `togglePause`（第 251 行）与 `directorRef` 同一套调用里。

## 4. 动画表现要求

### 4.1 分镜层次（至少三层视差纵深）
- **背景层**（最慢/静止）：地牢剪影——门框、砖墙、血袋架、吊灯微光。像素块拼，暗调。
- **中景层**（中速平移）：人物/ Boss 像素剪影，是本段的主角。带关键帧动作（例如：推门、抬手、转身、低头、举起之物）。
- **前景层**（最快）：飘尘、火星/血滴粒子、跨时间闪烁的 letterbox 黑边、最后一个字/符的淡入。
- 层次之间用不同平移速率制造视差；人物始终是视觉中心。

### 4.2 像素风带人物的具体画法
- 采用固定逻辑分辨率（建议 320×180 或 480×270），像素块整数对齐。
- 人物用「绘制指令帧」组成序列：`frames: (ctx, w, h, t) => void[]`，每帧是一组矩形/像素点绘制，按时间轴推进，等价手绘序列帧但不落地图片。
- 调色板控制在 6~10 色（暗红/锈褐/骨白/黑），与游戏整体做旧金属暗调一致；参考 `PixelArt.ts` 的取色。
- 人物不追求写实，追求剪影辨识度 + 2~3 个记忆点动作（如抬手、垂头、门缝光扫过）。

### 4.3 时长
- 单段 2.5~4 秒。建议：
  - 进第 2 层：~3.0s（账房，火烧账页剪影 + 收账人抬手）。
  - 进第 3 层：~3.5s（刑台，缝合女怪剪影 + 刻痕名单滑入）。
- 分镜数据写成 `src/narrative/cutsceneScript.ts`，结构参考 `script.ts` 的 beat（`at` 秒、`frame` 关键帧、`sfx` 音效、`black` 淡入淡出、`line` 可选短字幕）。

### 4.4 分辨率适配
- `<canvas>` 用 `image-rendering: pixelated`，内部分辨率固定为逻辑分辨率，CSS 以 `width/height:100%` 拉满父容器。
- 只在整数倍缩放时用 `devicePixelRatio` 提升清晰度，避免非整数缩放导致像素糊边。
- 监听 `resize`（`ResizeObserver` 或 window resize），重算 canvas 显示尺寸，绘制内容按逻辑坐标不变。
- 竖屏/横屏、`100dvh`：覆盖层用 `absolute inset-0`，letterbox 用像素高度随容器百分比。

## 5. 资源与代码组织约束

- 新增文件仅限：
  - `src/narrative/cutsceneScript.ts` — 分镜数据（分层帧、时间轴、音效、字幕）。
  - `src/narrative/Cutscene2D.ts` — 像素绘制 + rAF 导演层（照 `NarrativeDirector` / `CorridorScene` 的生命週期，提供 `start/stop/pause/resume/skip/dispose/now`）。
  - `src/narrative/CutsceneOverlay.tsx` — React 覆盖层（canvas 挂载、跳过按钮、淡入淡出样式）。
- 可改动的现有文件仅限 `src/App.tsx`（接线 + 状态 + 去重 + 暂停 + DEV 口）与 `src/index.css`（如需 letterbox/跳过按钮样式，尽量用现有 `.narrative-bar` / `.metal-btn` 类）。
- **不得改动**：`src/game/GameEngine.ts` 及其单测 `GameEngine.test.ts`、`src/scene/SceneManager.ts` 的对外接口、`src/audio/SoundEngine.ts` 的现有方法签名。
- 类型严格：`tsc -b` 必须零错误；不得用 `any` 兜底（DEV 口 `window.__cutsceneDebug` 可沿用现有 `as unknown as` 写法）。
- 依赖：只用项目已有依赖（React / Three / GSAP），不新增 npm 包。
- 构建产物：`npm run build` 通过；2D 层代码要能被 tree-shake（生产不残留调试口）。

## 6. 验收标准

1. **功能**：完成第 1 层 → 补给选完后、进第 2 层前，出现像素 2D 过场（带人物、三层视差、淡入淡出）；完成第 2 层 → 进第 3 层前同样出现对应过场；进第 1 层与进 victory 不出现。
2. **跳过**：播放中按 Space / Esc 立即淡出结束，无卡顿、无残留遮罩，引擎正常进入 reloading → 发牌。
3. **读档不重播**：刷新页面后点「继续第 N 层」，若该层过场已看过则不播；未见过的仍播。
4. **暂停**：暂停时过场画面冻结、恢复后继续。
5. **时长**：单段 ≤ 4 秒；不增加「清层到能操作下一关」超过 4 秒的额外等待（不含玩家自己看补给的时间）。
6. **视觉**：像素清晰（`image-rendering: pixelated` 生效，无糊边），人物剪影可辨识，三层视差有纵深，暗调贴合游戏整体。
7. **分辨率**：在 1280×720 / 1920×1080 / 手机竖屏下均正确 letterbox、无拉伸变形、无黑边溢出。
8. **工程**：`npm run typecheck`、`npm test`、`npm run build` 全绿；e2e 3 个 spec 可通过（如过场影响 e2e 时序，提供 `?skipcutscene=1` 或 DEV 口让 e2e 跳过）。
9. **零外部素材**：`public/` 下不新增任何图片/视频；2D 内容全部 Canvas 程序化绘制。
10. **截图验收**：按真实游戏镜头与真实视口截图，确认淡入、人物动作帧、淡出三张关键帧，附在交付说明里。

## 7. 禁止改动的事项

- 不得修改 `src/game/GameEngine.ts`（含相位链、发牌、补给 `offerSupply`、`beginLevel`、`checkpoint` 事件）。
- 不得改变「21 点 × 俄罗斯轮盘」核心循环、三层结构与逐层变难、一命到底。
- 不得把 2D 过场做成阻塞引擎的同步等待，不得篡改 `beginLevel` 的 2.6s reloading 时序（过场是叠加层，引擎照常跑）。
- 不得引入外部图片/精灵图/视频文件，不得替换现有程序化贴图体系。
- 不得修改现有 T2/T3 章节过渡（`script.ts` 的 `T2_BEATS`/`T3_BEATS`）与入场/结局分镜。
- 不得改动 `NarrativeDirector` / `NarrativeOverlay` 的既有对外行为（可复用，不得破坏）。
- 不得新增 npm 依赖，不得绕过 `tsc` 类型检查。
- 不得改存档 key 语义（`blood-ante.checkpoint.v1` 结构不变；「已播集合」用独立新 key）。
- 不得修改台词/剧情既定文本（除非本任务数据里明确给出的过场字幕）。

## 8. 交付说明

完成后请给出：新增/修改文件清单、2D 过场分镜数据（第 2 层 / 第 3 层两张 beat 表：`at / frame 关键帧 / sfx / line`）、三张关键帧截图（淡入/动作/淡出）、`typecheck/test/build` 结果、以及读档不重播的验证步骤。

=== PROMPT END ===
