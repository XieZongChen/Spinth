# common/ — 框架内共享工具

- `render.ts`：按需渲染调度（全局 `renderId` 脏计数 + 显式 `markRender()`）。
- `geometry.ts`：矩形/点/线段求交、距离、包含、点集变换、橡皮扫掠切割。
- `color.ts`：颜色工具（HSL 亮度推导边框色等）。
- `selectionStyle.ts`：选中态视觉常量唯一色源。

要求：本目录不依赖 platform/widgets（只被它们依赖）。
