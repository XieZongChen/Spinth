# common/ — 框架内共享工具

- `render.ts`：按需渲染调度（全局 `renderId` 脏计数 + 显式 `markRender()`）。
- `geometry.ts`：矩形/点/线段求交、距离、包含、点集变换、橡皮扫掠切割。
- `color.ts`：颜色工具（HSL 亮度推导边框色等）。
- `selectionStyle.ts`：选中态视觉常量唯一色源。
- `interaction.ts`：跨层共享的交互阈值常量（屏幕 px，如起拖阻尼 `DRAG_TRACTION_SCREEN`）。

要求：本目录不依赖 platform/widgets（只被它们依赖）。
