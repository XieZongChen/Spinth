# common/ — 框架内共享工具

- `render.ts`：按需渲染调度（全局 _renderId 脏计数 + `@render()` 方法装饰器的等价显式实现）
- `geometry.ts`：矩形/点/线段求交、距离、包含等几何工具
- `color.ts`：颜色工具（HSL 亮度推导边框色等）
- `constants.ts`：全局常量（吸附阈值、缩放上下限、圆角半径等）

要求：本目录不依赖 platform/widgets（只被它们依赖）。
