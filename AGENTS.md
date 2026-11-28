# AGENTS.md

> 给全队 Qoder AI 与人类成员的协作规范。**先读完再动代码。**

## 项目

《Blood Ante · 血色底注》— 第一人称 3D 暗黑桌面博弈：21 点 × 血注王牌 × 三层处决。
React 19 + TypeScript ~7 + Three.js r187 + Tailwind CSS 4 + Vite 8。场景模型为自建 GLB，贴图由 Canvas 2D 程序化生成，音效以 Web Audio 实时合成为主、`public/audio` 存少量采样。

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 仅类型检查
npm run preview    # 预览 dist
npm test           # Vitest 单元测试（引擎规则）
npm run test:e2e   # Playwright 端到端（自动 build + preview）
npm run editor     # 本地数据编辑器 http://127.0.0.1:4798/
```

复现对局问题时，开发模式可加 `?seed=12345` 固定发牌与 AI 随机序列（仅 DEV 生效，生产构建始终用 `Math.random`）。

## 一、分层架构：单向依赖

```text
src/
├── data/                    数据化配置（game / narrative / beats / cutscenes）
├── game/GameEngine.ts       【纯逻辑】规则状态机，不 import React / Three / DOM
├── scene/                   【表现层】只读 snapshot，输出画面
│   ├── SceneManager.ts      3D 场景、运镜、动画、3D 道具拾取
│   └── TextureFactory.ts    程序化贴图 + public/assets 热替换
├── audio/SoundEngine.ts     【音效】Web Audio 实时合成
├── components/              【桥接】
│   ├── GameCanvas.tsx       画布挂载 + 事件转发 + 道具浮窗
│   ├── RulesModal.tsx       规则与图鉴
│   ├── TrumpHandOverlay.tsx 玩家血注王牌浮层
│   ├── EnemyTrumpOverlay.tsx 敌方王牌横幅
│   └── MobileControls.tsx   触控 HUD + 横屏门禁 + useMobileLayout
├── intro/CorridorScene.ts   走廊序章
├── narrative/               旁白导演、2D 像素过场与结局
├── App.tsx                  【UI 覆盖层】HUD、演出、结算、事件接线
└── index.css                Tailwind 入口 + 做旧金属按钮等样式
```

依赖方向严格单向：`data` ← `game` / `narrative` / `App`，`game` ← `scene` / `audio` ← `components` ← `App`。
**`game/GameEngine.ts` 不得 import 任何层级的东西**（`data/*.json` 除外）：它是纯逻辑状态机，不依赖 React / Three / DOM。注意它内部用 `setTimeout` 控制发牌、AI 思考与处决停顿，**测试时须配合假定时器（Vitest fake timers）**，不能直接按同步纯函数断言。

## 二、跨层契约（改动必须同步三处）

### `GameSnapshot` —— 引擎 → UI / 场景

```ts
{
  phase, started, levelIndex, level, round, runRounds,
  player: ActorView, boss: ActorView,      // hp / maxHp / items / trumps / hand / visibleHand
  cylinder: CylinderView,                  // 剩余实弹/空弹、是否被放大镜窥视
  turn, pendingShot,                       // targeting 阶段的持枪者；其他阶段 null
  roundTarget,                             // 默认 21，血注王牌可改为 24 / 27
  lastPerfectWin,                          // 玩家上一局是否满点（正好等于目标）获胜
  tableTrumps,                             // 双方台面上的目标王牌；后打出的覆盖先前的
  unlockedItems,                           // 当前层已解锁道具
  supplyOptions, supplyPick,               // supply 阶段：候选与系统随机留下的那件
  bossSupplyOptions, bossSupplyPick,       // supply / bossSupply：Boss 的候选与选中件
  inputLocked, paused, log,
}
```

> 改字段时：`GameEngine.ts` 定义 → `SceneManager.applySnapshot` 消费 → `App.tsx` 展示，三处一起改。

### `GameEvent` —— 引擎 → 音效 / 演出

`state / notice / roundStart / cardDealt / turn / playerTableAction / bossBark / bust / itemDrawn / itemUsed / chamberRevealed / chamberFlipped / chamberDiscarded / trumpPlayed / perfectWin / execution / shot / reload / tie / supplyOffer / supplyPick / bossSupply / lootUnlocked / levelClear / checkpoint / gameOver / victory`。
新增事件类型后，必须在 `App.tsx` 的 `handleEventSound` 里接音效、在 `GameCanvas.tsx` 的 `applyVisualEvent` 里接运镜，否则事件静默失效。

### 动作入口

所有玩家意图只能走引擎方法：`hit()` / `stand()` / `useTrump(index)` / `useItem(id, target?)` / `chooseTarget(target)` / `restart()` / `advanceLevel()`。
- `hit` / `stand` / `useTrump`：仅 `playerTurn`。
- `useItem` / `chooseTarget`：仅玩家持枪的 `targeting` 阶段。
**禁止在 UI 或场景里改血量、手牌、弹仓。**

### 层间补给

- 开局：`beginLevel` 给双方各发 `level.supply` 件（第 1/2/3 层为 0/1/2）。
- 清层：先播 2.6s 横幅，再进入 `supply` 摆出候选（首层 2 件，之后 3 件，`supplyOptions`）。**玩家不点击**：候选停留 3.2s 后系统等概率留一件（`supplyPick`），整盘沉下只留它再升回；随后 `bossSupply` 用同一套动作为 Boss 随机留一件。
- 选中件先存进 `carryOver` / `carryOverBoss`，因为下一层 `beginLevel` 会重建双方 `ActorRuntime`。
- T2/T3 章节叙事期间引擎保持 `pause()`，叙事结束（或跳过）才放行补给，否则整套演出会在覆盖层背后播完。

### 关卡间 2D 像素过场

进第 2、3 层前叠一段 2D 像素过场（`src/narrative/cutsceneScript.ts` 分镜 + `Cutscene2D.ts` rAF 导演 + `CutsceneOverlay.tsx` 覆盖层），全程 Canvas 程序化绘制，**不引入任何图片/视频**。

- 切口：`checkpoint` 事件（`beginLevel` 内 dispatch，此时引擎已是 `reloading`、输入锁死）。过场开始即 `game.pause()` 挂起引擎，到 `duration - 2.6s` 时 `game.resume()`，让装弹与发牌正好落在淡出窗口——**相位链不动，玩家只多等约 4.4s**。`duration` 需 ≥6s、≤8s（`cutsceneScript.test.ts` 断言）。
- 第 1 层不播（入场 + 走廊已铺满），第 3 层 Boss 倒下进 `victory` 也不播。
- 每段配 2 句字幕（`lines`，按 `at/end` 命中、不重叠），从导演时钟起笔打字；字幕带半透明背景板。
- 去重：`blood-ante.cutsceneSeen.v1` 存 `{v:1, seen:[层 levelIndex]}`。正常推进播一次；**读档（继续第 N 层）不重播**；`restart` 清空；**死亡后「从第 N 层重来」会重播**。
- 跳过：过场期间 Space/Esc → `Cutscene2D.skip()`，0.18s 淡出后卸载；其他游戏键全部吞掉。
- 暂停：`togglePause` 同时 `pause/resume` 过场导演层。
- e2e：`?skipcutscene=1` 或自动化环境（`navigator.webdriver`）默认不挂载；`?cutscene=1` 强制播放；`?replaycutscene=1` 清掉已看记录后重播。
- 改分镜只动 `cutsceneScript.ts` 与 `src/data/cutscenes.json`。

### 结局 2D 像素过场

两段结局过场在 `src/narrative/endingScript.ts`，与关卡间过场共用 `Cutscene2D` 导演层和 `CutsceneOverlay` 覆盖层（`mode="ending"`，不恢复引擎）。

- **胜利**：3D `endingB` 播完后，`onFinish` 续接 2D「赎契」8.5s → 结算屏。**不可直接跳过**：长按 Space/Esc 3 秒才生效（防设备卡死）。
- **失败**：玩家血袋见底 → 2D「补针」7.0s → 结算屏。可跳过：Space/Esc/按钮，0.18s 淡出。
- 两段都计入 `narrativeActive`，结算屏 gate 用 `finished && !narrativeActive`。
- 胜利 3D→2D 靠 `endingThenCutsceneRef` 在 3D `onFinish` 里续接，衔接处两边都是全黑帧 + 缝线声。
- 调试：`?cutscene=1` + `__cutsceneDebug.playEnding('win'|'lose')`。

### 手牌点数（台面贴片，不进 HUD）

点数由 `SceneManager.buildScorePlates` 的两块贴地 Canvas 贴片直接画在台呢上。**玩家暗牌点数刻在牌背、自己可见，因此玩家贴片显示真实总分；Boss 贴片只计可见牌（暗牌显示 `+ ?`）**。贴片只在「点数/软牌/爆牌/停牌/暗牌」组合变化时重绘并做一次缩放脉冲。

- 玩家贴片在 `(0, 1.52)` 平贴台呢；Boss 贴片在对侧右侧 `(1.5, -1.15)`，按 `SCORE_PLATE_TILT` 立起 ~0.5rad 并 yaw 朝主镜头。
- 枪身占满中央横带，别把 Boss 贴片放回中间。
- 改位置/缩放/倾角都要按真实游戏镜头截图确认，不能只看俯视。

### 血量（3D 血袋，不进 HUD）

每格生命对应架上一只血袋：`syncBlood()` 以 `ActorView.maxHp` 决定袋数、`hp` 决定注满的袋数，掉血从右往左排空、回血重新注满；`maxHp` 变化时整架重建。位置/尺寸集中在 `BLOOD_RACK_LAYOUT`。单袋液体盒高度取满袋液高，`liquid.scale.y` 就是填充比例——**不要把液体几何高度写成 1 再用 scale 当比例**。细管挂在独立 `extra` 组里用世界坐标，换架时随 `rack.extra` 一并销毁。**HUD 不再显示血条、点数或弹仓条**，只有层数/回合与角落入口。

## 三、规则要点（易踩坑）

| 规则 | 实现位置 | 注意 |
| --- | --- | --- |
| 牌堆 | `createDeck()` / `startRound()` | 11 张牌，点数 1–11 各一张、花色轮转；**每回合整副重洗**，没有 J/Q/K，也没有 A 的软硬切换 |
| 暗牌 | `withHoleCard()` / `syncCards()` | 双方各 1 明 1 暗；玩家的暗牌点数刻在牌背（自己可见），Boss 暗牌不可见；`settleRound` 开头亮底牌。`withHoleCard` 必须每次从 `cards` 重建 `visible`——若 hidden=false 时直接返回原对象，暗牌就永远翻不回来 |
| 战斗日志 | `dealTo()` / `App.tsx` 的「战报」弹窗 | HUD 不再常驻日志；对手暗牌发下时日志写「它扣下一张暗牌」，**不能**写牌面与点数；亮牌时在 `settleRound` 补「亮出底牌」 |
| 枪口选择 | `phase='targeting'` + `chooseTarget()` | 只有玩家持枪才等输入；Boss 持枪由 `chooseBossTarget()` 自动决定（看穿空膛会自射）。贴片必须按 `visible` 重算，不能用 `visibleHand.total` |
| 伤害公式 | `resolveShot()` | 实弹固定 1 点；锯子 +1；**没有黑杰克/碾压/遗恨加成** |
| 满点 | `settleRound()` | 赢家总点数正好等于 `roundTarget`（21/24/27）→ 额外拿一件道具，不额外加伤害 |
| 平局 | `settleRound()` | 双方都不爆且同点 → 不开枪，各摸一件；双方都爆 → 点数小者胜，同点仍平局 |
| 爆牌 | `finishPlayerHit()` / `runBossTurn()` | 玩家爆牌后回合仍归玩家，只能打王牌抬目标或停牌；Boss 爆牌自动停牌 |
| 锯子 | `sawBoost` | 是 **+1**，不是翻倍；只在**真的打出实弹**时消耗，空膛不浪费 |
| 空膛对己 | `resolveShot()` 的 `selfShot` 分支 | 空膛只结束本轮、不发道具；实弹则伤害打在自己身上。Boss 看穿空膛依旧自射 |
| 手铐 | `gunCuffed` | 只拦「对对手开空枪」的枪权转移；自射不受影响；开枪后清除 |
| 道具时机 | `useItem()` | **只有持枪阶段（targeting）能用道具**，21 点阶段只能用王牌；每次使用有演出，演出期间输入锁定 |
| 王牌时机 | `useTrump()` | 仅 `playerTurn`，一回合可多次；目标王牌会重算双方爆牌并重置停牌，双方重新获得行动权 |
| 目标王牌覆盖 | `tableTrumps` | 后打出的目标王牌清空双方台面旧目标；`销注` 移除对方目标并恢复 21 |
| 封牌/割牌/易牌 | `useTrumpInternal()` | 只动「最后一张明牌」，暗牌不能选中；弹回的牌洗回牌堆 |
| 索牌·二~七 | `useTrumpInternal()` | 从当前牌堆抽指定数字；已不在牌堆则王牌落空（仍消耗） |
| 以爱资敌 | `useTrumpInternal()` | 优先给对手最贴近且不爆的牌；没有安全牌就给最小的一张，哪怕爆牌 |
| 弹仓 | `Cylinder.reload()` / `cylinderCapacity()` | 容量 `min(8, 2 + 层数×2 + ⌊(回合-1)/2⌋)`；2 发固定 1 实 1 空，更多时 2–4 实且不超半数；达到过 8 发后每次重装 2–8 随机；打空才重装 |
| 道具上限 | `MAX_ITEMS` / `ITEM_CAP` | 总携带 8 件；单类另有上限（镇定剂/借据 4，重锤/手套 2，其余 8） |
| 窃贼手套 | `resolveItemEffect()` 的 `gloves` 分支 | 不能偷手套；偷到的道具当前不可用会放回，手套不消耗 |

`LEVELS` 来自 `src/data/game.json`：`hp` 是对手生命、`playerHp` 是玩家生命，二者每层重置；改数值只动 JSON。

## 四、3D 场景约定

- 桌面高度常量 `TABLE_TOP`，所有桌上物件 y 从它起算。
- `gaming_table.glb` 的台呢面在模型自身 y=0，加载后整体抬到 `TABLE_TOP`；**改桌高只改 `TABLE_TOP` 一处**。
- `room_environment.glb` 以世界原点为地面（y=0），顶棚 `CEILING_Y = 6.0`；吊灯构件单独拆给 `lampRig` 保留摆动。
- **聚光灯必须挂在灯罩下沿（`LAMP_SHADE_BOT_Y = 4.02`）**，放罩体内会被罩壁完全遮挡，桌面出现一大片黑斑。
- **Boss 半身像必须含完整躯干**：`boss_*.glb` 的包围盒是 W≈1.6–1.8m、H≈2.0–2.6m、D≈0.8–1.3m，底座在自身 y=0。只有头/兜帽的模型按高度归一化后会变成 3m 宽的巨脸，必须重做而不是缩放。
- **`BOSS_Z = -3.4`**：中心必须在桌后沿之外；`BOSS_BUST_BASE_Y = 0.26` 让下摆被桌沿挡住，形成“坐在桌后”。
- Boss 的呼吸/盯视作用在 `bossGroup`（整体）与 `bossHeadNode`（`BossHead` 节点）上，模型面朝 +Z，`rotation.y` 即左右转。
- **冷色轮廓光强度上限约 10**：高于此值整个躯干会被照成一块蓝板，失去剪影感。
- 卡牌材质数组顺序：`[side, side, 朝上面, 朝下面, side, side]`；`rotation.x = Math.PI` 表示翻面。
- 道具拾取：`raycaster` → 沿 `parent` 找 `userData.item` → `callbacks.onItemClick`。道具 id → GLB 的映射在 `ITEM_MODEL`，缺 GLB 时回退程序化几何。
- 血袋架布局集中在 `BLOOD_RACK_LAYOUT`；玩家架占桌面左前角，Boss 架落地在左后侧，袋口高度要露出桌沿之上。
- 运镜用 `setShot(shot, duration)`，不要直接改 `camera.position`。
- **枪口朝向**：`gunAim` 是枪的瞄准枢轴，执行阶段由 `updateGunAim` 算 yaw/pitch 指向 `bossHitPoint()` 或镜头；枪口火光、膛内提示也挂在它下面。不要再动 `gunGroup.rotation.y` 摆枪。换 GLB 时占位枪要用 `removeFromParent()` 摘下（它挂在 `gunAim` 下，`gunGroup.remove` 摘不到，会叠成两把枪）。枪口火光位置从模型 `MuzzlePoint` 计算，装填时推拉 `PumpSlide`，不要再假设火光固定在 -1.06。
- 执枪回合开始时枪从桌底弹出，21 点阶段藏枪；相关状态机在 `SceneManager` 的 gun 部分。
- **中弹点不是常量**：`bossHitPoint(out)` 按当前关卡从 `BOSS_BUST_HEIGHTS` 换算（胸口约在整体高度 64% 处），换关后自动跟着半身像变高，不要再写死坐标。
- 实弹命中 Boss 走 `BossPoseController`（`src/scene/BossPose.ts`）姿态状态机：`impact → collapse → prone → brace → push → rise → recover → idle`；致死命中停在 `deadProne` 直到切层/重开，普通命中约 3.0–3.5s 完整起身。采样值绕 `profile.pivotY` 虚拟枢轴旋转后反推平移，不要再写死整体下压/回弹的 tween。
- 三关 profile 各自定义（`BOSS_POSE_PROFILES`）：L1 人形前扑 + 运行时肩/颈枢轴驱动手臂头部；L2 低位下沉前塌 + 跨段轻颤拖起，禁大角度侧滚；L3 绕 `Boss3_SuspensionRoot` 摆荡 + 自转 + 收轨抬起，禁地面俯仰。L2/L3 `allowArms=false`，不共用 L1 手臂逻辑。
- 切层 / retry / restart 都经过 `phase = reloading`，`shouldRespawnBossPose()` 靠这一跳（外加层数变化、Boss 0 血复活）触发 `spawn()`；同层 retry 时层数与血量可能都不变，别只判断这两项。
- 姿态段落音效走 `SceneCallbacks.onBossPoseCue`（`down/brace/rise/settle`），只在状态切换帧派发一次；枪响仍由 `shot` 事件负责，不要重复播。
- **背景陈设放 `propsGroup`，不要塞 `roomGroup`**：`swapRoom()` 会清空 `roomGroup`，道具会跟着被删。`refreshProps()` 每次整组重建，旧克隆只 `remove` 不 dispose——几何与材质和 `models` 里的模板共享，销毁会把模板一起废掉。
- 玩家中弹是纯 DOM 覆盖层：`.blood-splatter` 血斑 + `.vision-blur`（`backdrop-filter`，只糊画布，HUD 保持清晰），在 `App.tsx` 的 `handleEventSound` 里由实弹事件驱动；不要用后期处理去做模糊。
- **Blender 程序化节点图无法导出到 glTF**：噪声/渐变接 Base Color 会被压成纯白。要么把颜色烘焙进顶点色（`COLOR_0`），要么只给 Principled 一个平涂 Base Color；后者导出为 `baseColorFactor`，**是线性色值**，游戏里还会再乘 0.42，按 `目标线性色 ÷ 0.42` 反推，否则会像白模。

## 五、美术资源热替换

### 3D 模型（`public/models/*.glb`，24 个文件）

`SceneManager` 的 `ModelKey` 覆盖 21 个在用模型；`corridor.glb` 由 `CorridorScene` 加载，`crt_monitor.glb` 为遗留文件。

| 文件 | 用途 | 约束 |
| --- | --- | --- |
| `gaming_table.glb` / `table_gothic.glb` | 赌桌 | 台呢面在模型 y=0；场景里抬到 `TABLE_TOP` |
| `room_environment.glb` | 地下铁皮密室 + 工业吊灯 | 地面在 y=0；吊灯节点名以 `Lamp` 开头 |
| `corridor.glb` | 走廊序章 | 由 `CorridorScene` 单独加载 |
| `shotgun.glb` | 泵动霰弹枪 | 枪口朝 glTF -Z；`MuzzlePoint` 空物体标定枪口，`PumpSlide` 是装填动画推拉节点 |
| `boss_1/2/3.glb` | 三层半身像（完整躯干） | 面朝 +Z，底部中心为原点，头部节点名 `BossHead` |
| `gothic_statue.glb` / `marble_bust_01.glb` | 背景陈设（Poly Haven CC0） | 面朝 +Z，底座在自身 y=0；带贴图，压暗系数走 `albedoDimFor` |
| `item_*.glb` | 道具模型（含遗留动画用的沙漏/磁铁/裁纸刀/封条） | 尺寸 0.15–0.30m，底部 z=0 |
| `player_hand.glb` | 玩家手部 | 用于按键/持枪动画 |

**带贴图的模型不走顶点色分支**：`tuneGltfMaterial(material, vertexDim, albedoDim)` 的第三个参数只对无顶点色的模型生效，新增贴图模型要在 `preloadModels` 的 `albedoDimFor` 里单独给值，否则一律被压到 `GLB_ALBEDO_DIM = 0.42`，在暗场里等于看不见。

缺文件时自动回退程序化几何（`console.debug`，不报错）。

### 贴图覆盖（`public/assets/`，仅开发模式）

| 文件 | 用途 |
| --- | --- |
| `table.png` | 桌面锈迹 |
| `card-back.png` | 卡牌背面 |
| `dust.png` | 空气尘埃 |
| `mask-1.png` / `mask-2.png` / `mask-3.png` | 三层 Boss 面具（建议透明通道） |

删除文件即回退程序化贴图；`public/assets/` 不存在时属正常情况。

## 六、数据化配置与本地编辑器

- `src/data/game.json`：三关数值（`hp` / `playerHp` / `supply` / `reloadSupply` / `personality`）、王牌权重与图鉴、道具图鉴、音效路径。
- `src/data/narrative.json`：Boss 名、三关名与标题、道具风味文本。
- `src/data/beats.json`：序章/重开/T2/T3 台词与线索，频道仅 `player / enemy / sister`。
- `src/data/cutscenes.json`：层间过场与两段结局的分镜。
- `npm run editor`：编辑器跑在 4798；保存前校验结构，写回 JSON、把旧文件备份到 `backups/editor/`，并自动重建 `dist`。预览另开 `npm run preview`。
- 改数值/文案只动 JSON；`dataSchema.test.ts` 与编辑器校验会拦截结构错误。层间过场 `duration` 必须 6–8 秒。

## 七、移动端横屏

- 只有粗指针设备（`matchMedia('(pointer: coarse)')`）才挂触控层与横屏门禁；桌面鼠标下 `coarse`/`portrait` 均为 false，键鼠行为不变。
- 竖屏显示 `RotateGate`；横屏显示触控 HUD（要牌/停牌、道具、王牌、枪口选择）。
- 触控按钮与桌面快捷键走同一套引擎校验（`handleMobileAction` / `onTableAction`），不得在组件里改状态。
- 枪口选择按钮在枪完全举起前保持禁用（`targetPickReady` 来自 `SceneManager.refreshTargetPick()`）。
- 安全区用 `env(safe-area-inset-*)`；触控尺寸样式集中在 `index.css` 的 `.is-touch` 段。

## 八、测试与调试

- 单元：`npm test`（Vitest）。引擎核心规则、DevBridge、道具动作、Boss 姿态、过场/结局脚本、数据 schema 都有测试。
- 端到端：`npm run test:e2e`。Playwright 配置固定 `workers: 1`、`deviceScaleFactor: 0.25`（软件渲染下降低像素量），`webServer` 自动 `build + preview` 到 4173。
- 开发期 URL 参数：`?seed=N`（仅 DEV）、`?skipcutscene=1`、`?cutscene=1`、`?replaycutscene=1`。
- DEV 调试钩子：`__narrativeDebug`（`play / scene / game`）、`__cutsceneDebug`（`play / playEnding / skip / active / seek`）、`__itemActionDebug`（道具动作预览与状态）。开发面板：1.6 秒内连按 4 次 E。
- 提交 PR 前必须 `npm run build` 通过；CI 会跑 `npm ci && npm test && npm run build`。

## 九、部署

`vite.config.ts` 固定 `base: './'`，**不要改**。`dist/` 可直接部署到任意静态托管（Qoder Sites / GitHub Pages 子路径），不会资源 404。
Qoder Sites 的 `.站点名称.qoder.site` 描述文件由工具生成与维护，不要手写或改字段。

## 十、Git 分工流程

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

- 从 `main` 开 PR，标题 `feat(<范围>): <说明>` / `fix(<范围>): <说明>` / `docs(<范围>): <说明>`
- **`main` 已开启分支保护**：必须走 PR、必须通过 `build` 检查、至少 1 个 review、禁止强推与删除
- 队长（仓库管理员）保留绕过权限，用于紧急修复
- 合并前 `npm run build` 必须通过
- 冲突高发区：`game/GameEngine.ts`、`App.tsx`、`src/data/*.json`，改契约前先在群里对齐

### 认证

凭据由 `gh` 作为 git credential helper 提供，**无需令牌，不要向任何人索要 PAT**。
GitHub 443 偶发连不上时，先确认本机代理是否失效；必要时用 `git -c http.proxy= -c https.proxy= -c http.version=HTTP/1.1 <命令>` 直连。

## 十一、新人上手（第一台新电脑必读）

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
npm test           # 引擎规则改动必须跑
```

CFI 在 PR 上会自动跑 `npm ci && npm test && npm run build`，红色 PR 无法合并。

## 十二、代码风格

- TypeScript `strict` 已开启；不要用 `any`、`@ts-ignore`
- 不留 `console.log`；`console.warn/error` 只用于真正的异常分支，设计内的降级（如 GLB 缺失回退程序化几何）用 `console.debug`
- 注释只写「为什么」，不写「做了什么」
- 演出节奏：发牌 340ms、AI 思考 620–900ms、处决停顿 2.9s；不要随手改这些时长
