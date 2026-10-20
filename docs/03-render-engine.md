# 03 — 渲染引擎

## 1. 技术栈

- PIXI 8 + pixi-viewport。
- 画布容器由 `BoardApplication` 管理；`ticker` 停用，改用按需 rAF。
- 只有 `renderId` 变化时调用 `app.render()`，静止时零 GPU 消耗。

## 2. 视口

- 平移/缩放由 pixi-viewport 承担。
- 世界坐标与屏幕坐标转换统一经 ViewportService。
- 缩放感知的命中、手柄和参考线阈值必须除以 `pageScale`。

## 3. 分层

- DOM：画布底色、点阵背景。
- Canvas：控件层、选择框、参考线、幽灵预览。
- zOrder 使用 fractional indexing 字符串，按字典序物理排序。

## 4. 性能

- 视口外控件通过 CullingService 跳过渲染。
- 空间索引增量维护；命中/框选先格查询再精判。
- 文本/图片按需纹理化，避免每帧重建。
- 大图先按长边 480px 缩小为可操作尺寸。

## 5. 视觉同步

拖拽/缩放只允许改 `root.position`、`root.scale`、选择框；松手必须用最后一帧
目标矩形写回 Model。跟随框绝对定位，禁止增量累加。
