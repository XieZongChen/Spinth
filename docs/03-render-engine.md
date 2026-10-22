# 03 — 渲染引擎（PIXI 8）与视口

## 1. 设计目标

- **按需渲染**：静止时零 GPU 消耗；任何状态变化只触发一次渲染。
- 视口状态单一数据源：`vpScale$ / vpBounds$ / vpTransform$`，派发自动节流。
- 分层渲染：控件层（按 zOrder 排序）与交互层（选中框/参考线/协同光标）分离。
- 画布底色与点阵由 DOM 承载，不进入 WebGL，也不参与导出。

## 2. PIXI 8 适配要点

| 主题     | 实现                                                         |
| -------- | ------------------------------------------------------------ |
| 初始化   | `await app.init({...})` 异步初始化                           |
| Graphics | 链式 `moveTo/roundRect` + `fill({color, alpha})/stroke(...)` |
| 抗锯齿   | v8 Graphics 渲染器原生 AA，不再需要额外 smooth 插件          |
| 分层     | 不引入 `@pixi/layers`；widgetLayer 按 zOrder 字符串物理排序  |
| 纹理     | `renderer.generateTexture` / `renderer.extract` 保留         |
| 事件     | v8 内建 `eventMode` + `hitArea`                              |
| Ticker   | `app.ticker.stop()`，走自有 rAF 按需渲染                     |

## 3. 按需渲染管线

```
common/render.ts:
  let renderId = 0;
  export function markRender() { renderId++; }

BoardApplication:
  app.ticker.stop()
  rAF 循环比较「上次渲染时的 renderId」
    变了 → app.render()
    没变 → 跳过
```

- 每个 Vm 的 render 尾部、每个 Service 修改交互层视觉后显式调用 `markRender()`。
- 不依赖装饰器魔法；调试时可用 `__spinth.__debug.renderCount` 观察是否多渲染。
- 视口动画使用 pixi-viewport 内建 `animate`，不引入额外补间库。

## 4. 舞台分层

```
Stage（canvas 透明，backgroundAlpha: 0）
 └── Viewport（pixi-viewport）
      ├── widgetLayer   控件层（按 zOrder 物理排序）
      └── optionLayer   交互层（选中框/参考线/框选/协同光标），后添加恒在上

DOM 层（canvas 之下）：画布底色 + DotGrid 点阵（§6）
```

背景不是画布内容：不参与 zOrder、不被导出、不参与 culling。

## 5. 视口配置与状态派发

```ts
viewport
  .drag({ clampWheel: false, pressDrag: true })
  .wheel({ smooth: 3, trackpadPinch: true, wheelZoom: false, percent: 0.1 })
  .clampZoom({ minScale: 0.05, maxScale: 4 });
```

- 裸滚轮 = 平移；按住 `metaKey/ctrlKey` 时切缩放。
- cursor 模式下暂停 viewport drag；hand/space 模式才拖拽平移。
- 监听 `moved` + 微任务合并，派发 `vpScale$ / vpBounds$ / vpTransform$`。
- `setPageScale` 必须带 position：pixi-viewport 在无 position 时只改 scale 不 emit
  `moved`，状态流会滞后。缺省取当前视口中心世界坐标补齐。
- 首次进入不恢复上次视角；`zoomToFit` 按 widgetLayer 包围盒计算，padding 默认 100。

## 6. 点阵背景（DOM/CSS 层）

- 点阵是页面装饰，不是画布内容；由 @spinth/react 的 `DotGrid` 用 CSS
  `radial-gradient` 平铺承载。
- 画布底色同理：PIXI `backgroundAlpha: 0`，底色由 body 的 `--spinth-canvas` 提供。
- 网格模型：
  - 点距世界锚定：`P = W × scale`，W 基础 16px；P < 12 屏幕 px 时 W 翻倍。
  - 点径钳制：`D = clamp(scale, 1, 4)` 屏幕 px。
  - 对齐：点在格中心，格点 ≡ 世界坐标 0 (mod W)，由平移取模 + 过盈边距实现。
- 性能：pan 只写 `transform: translate3d`；背景 paint 属性只在点距变化时更新；
  zustand 命令式订阅 + ref 直写，不进 React 渲染。

## 7. 工具状态机（cursorMode）

```ts
type CursorMode =
  'cursor' | 'hand' | 'shape' | 'sticky' | 'text' | 'pen' | 'line' | 'eraser' | 'mind';
```

- `ViewportService.registerGlobalEventListener(mode, handlers)` 按模式注册
  `onPointerDown/Move/Up/UpOutside/RightClick`；工具切换 = 换 handler，不改事件管线。
- 所有 handler 入口检查 `editable$` 与 `editBlocked$`。
- undo 边界（`stopCapturing`）由各服务在自身手势结束时调用，不在分发层统一处理。
- 只读态：写工具禁用；选择/平移/缩放/复制仍可用。

## 8. 导出 PNG

- 双入口：
  - 选中集导出：ActionBar 「导出 PNG」；
  - 整画布导出：右键画布菜单「导出画布 PNG」。
- 管线：`BoardCommands.exportPNG(mode)` → `renderer.extract.download`：
  - target = `widgetLayer`（optionLayer 的选区框/参考线天然排除）；
  - frame：selection = `getSelectionBounds()`，canvas = `widgetLayer.getLocalBounds()`；
  - 外扩 32px 呼吸边距；空画布/零选中 no-op。
- 分辨率：默认 2x；最长边超过 8192px 时按比例降 resolution，仍超则跳过并告警。
- culling 必须挂起：`culling.suspendForExport()` 全量置回并返回恢复闭包，否则视窗外
  控件在 extract 重渲染时缺失。
- 底色：读取 `--spinth-canvas`（getComputedStyle，fallback #ffffff）；暗色主题导暗底。
- 文件名：`spinth-board.png` / `spinth-selection.png`。

## 9. 空间索引与 culling

- `SpatialIndex`：均匀网格（格宽 512），getBounds → cell 增量维护。
- 命中/框选/吸附候选先格查询再精判；`CullingService` 按 `vpBounds$` 查可视格集合，
  diff 翻转 widget `renderable`（不动 `visible`，保留事件语义）。
- 256px margin 防抖；MIND_MAP 整图豁免（树增长不触发几何 diff，索引会过期）。
- 导出时挂起 culling（§8）。

## 10. 当前边界

- 大画布导出格式/分辨率选项、剪贴板复制、缩略图管线未实现。
- 旋转件的参考线/等间距排除、awareness 框恒 AABB（首版降级，docs/05 §8）。
