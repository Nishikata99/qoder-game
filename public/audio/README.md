# 音效

按模块建子目录：`shared/`、`blackjack/`、`buckshot-roulette/`。

约定：

- 格式优先 `.mp3`（兼容性最好），短音效可用 `.ogg`
- 单文件 < 500 KB，循环 BGM 用流式加载
- 必须用相对路径：`./audio/buckshot-roulette/shot.mp3`
- 浏览器音频需用户手势后才能播放，首次播放请挂在 pointerdown/click 上
