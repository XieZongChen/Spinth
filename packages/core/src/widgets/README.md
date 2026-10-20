# widgets/ — 控件（每种一个子目录，三件套）

每种控件由三个文件组成（规格见 docs/04-widget-system.md）：

- `xxxModel.ts` — 数据层：持有 yData: Y.Map（唯一数据源，toJSON 实时投影，无副本）；zod schema；initialize/initializeY 双路径
- `xxxVm.ts` — 视图层：持有 PIXI root；observeDeep 订阅 → setState → diff → render；实现 hitTest
- `xxxService.ts` — 交互层：注册全局指针回调（按 cursorMode）；工具态与创建流程

现有控件：`shape/`（四型 + 图形内文字）、`sticky/`、`text/`、`line/`、`pen/`、
`image/`、`mind/`；`eraser/` 为纯工具型特例（无 Model/Vm——橡皮不产生数据，
Service + 圆形指示器两文件）。控件清单与 eraser 行为规格见 docs/04 §8。
