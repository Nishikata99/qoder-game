# 外部 3D 模型

按模块建子目录，必须使用相对路径引用（`base: './'`）：

| 目录 | 归属 | 说明 |
| --- | --- | --- |
| `shared/` | 全员共用 | 赌桌、筹码、灯具等。改动需在 #art-shared 通知 |
| `blackjack/` | 成员A | 牌盒、筹码塔等 |
| `buckshot-roulette/` | 成员B | 霰弹枪、弹壳等 |
| `template-minigame/` | 模板 | 接入示例参考 |

加载示例：

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
// 注意用 ./ 相对路径，且文件放在 public/models/<模块>/
const gltf = await loader.loadAsync('./models/blackjack/chip-tower.glb')
group.add(gltf.scene)
```

约定：单个 `.glb` 建议 < 5 MB；贴图用 KTX2/Draco 压缩；不要在代码里写死 `/models/...` 绝对路径。
