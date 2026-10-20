# 04 — 控件系统：Model / Vm / Service 三件套

## 1. 设计目标

- 新增控件不改引擎：三件套 + 注册，dataEngine/vmEngine 零改动。
- VM 是数据驱动的投影：`(model 数据, VM state) → PIXI 树`，不缓存业务数据。
- 生命周期统一：创建、更新、销毁走同一条路径。
- 契约先行：schema 在 `types/widget.ts` 声明，类型与运行时校验同源。

## 2. 三件套契约

### Model（数据层）

```ts
class ShapeModel extends BaseModel<ShapeData & IRect> {
  protected readonly schema = ShapeSchema;
  readonly capabilities = { ... };

  initialize(data): Y.Map;      // 本地新建
  initializeY(yData): void;     // 恢复/远端：补 rect、消毒、绑定
  update(patch): void;          // 合并 → clamp → schema 校验 → DataProcessor
  toJSON(): ShapeData & IRect;  // 实时投影
}
```

- `capabilities` 由控件自声明，交互层通过 `WIDGET_REGISTRY` / `TYPES_WHERE` 查询。
- 几何字段不进入 schema 主对象，统一存 yRect；`toJSON()` 摊平为 x/y/width/height。

### Vm（视图层）

```ts
class ShapeVm extends BaseWidgetVm<ShapeData & IRect> {
  readonly root = new Graphics();
  readonly type = 'SHAPE';

  protected onModelUpdate(): void; // setModel 后订阅 model / rect
  render(prev, next): void; // 全量重绘 root
  hitTestPoint(p): boolean;
  hitTestRect(r): boolean;
  getBounds(): IRect; // 世界 AABB（旋转感知）
  getLocalRect(): IRect; // 未旋转数据矩形
}
```

- `setState(next, local)`：deep diff → 微任务合批 → `render(prev, next)` →
  `onStateChanged$.next({ diff, local })`。
- 广播必须在渲染完成后发出；订阅者读 `getBounds()` 恒为新帧（docs/14 规则 2）。

### Service（交互层）

```ts
class ShapeService extends DragCreateServiceBase {
  protected readonly scope = 'shape';
  protected readonly defaultSize = { width: 120, height: 80 };
  protected readonly minDraftSize = { width: 8, height: 8 };
  protected createWidget(x, y, w, h): string;
}
```

- 创建型工具（shape/sticky）继承 `DragCreateServiceBase`：down 记起点 → move 过阈值
  建草稿并跟手 → up 收尾；子类只声明 scope / 默认尺寸 / 阈值语义 / createWidget。
- 非创建型交互（pen/line/text/eraser）自行 `registerGlobalEventListener`。
- 工具默认参数是 Service 会话态（不落库、不持久化）：shapeType、lineType、penColor、
  stickyColor、fontSize、eraserRadius。SDK 聚合为 `defaultToolOptions$` +
  `setDefaultToolOption(tool, key, value)`；ActionBar / ToolFlyout 同源消费。

## 3. 注册表与组合根

```ts
// types/widget.ts：schema + capabilities 单源
export const WIDGET_REGISTRY = {
  SHAPE: { schema: ShapeSchema, capabilities: { ... } },
  TEXT:  { schema: TextSchema,  capabilities: { ... } },
  LINE:  { schema: LineSchema,  capabilities: { ... } },
  PEN:   { schema: PenSchema,   capabilities: { ... } },
  STICKY:{ schema: StickySchema,capabilities: { ... } },
  MIND_MAP: { schema: MindMapSchema, capabilities: { ... } },
  IMAGE: { schema: ImageSchema, capabilities: { ... } },
} as const;
```

- `WIDGET_TOKENS` / `WIDGET_FACTORIES`：组合根装配 Model/Vm 工厂。
- `BoardSDK.initialize` → `composeBoard` 显式注册 token、构造服务、接线事件。
- 新增类型只扩展注册表与三件套，不改 dataEngine/vmEngine 的分发逻辑。

## 4. 能力位

`rotatable / groupable / resizable / movable / selectable / keepRatio / editable /
referenceable / erasable`

| 类型     | 旋转 | 编组 | 缩放 | 可编辑 | 参考线 | 橡皮 |
| -------- | ---- | ---- | ---- | ------ | ------ | ---- |
| SHAPE    | ✓    | ✓    | ✓    | ✓      | ✓      | —    |
| TEXT     | ✓    | ✓    | ✓    | ✓      | ✓      | —    |
| STICKY   | ✓    | ✓    | ✓    | ✓      | ✓      | —    |
| IMAGE    | ✓    | ✓    | ✓    | —      | ✓      | —    |
| LINE     | —    | ✓*   | —    | —      | —      | —    |
| PEN      | —    | ✓    | ✓    | —      | —      | ✓    |
| MIND_MAP | —    | —    | —    | —      | —      | —    |

- LINE 类型级可组，锚定态由 `groupOps` 运行时判定。

## 5. BaseVm / VmEngine

```
setState(partial)
  → 合并进 batchState
  → 微任务合批
  → forceUpdate:
      shouldUpdate → beforeUpdate → 赋值 state → render(prev, next) → afterUpdate
      → afterUpdate 发出 onStateChanged$（渲染完成后才广播）
```

```
VmEngine.initialize():
  dataEngine.onModelCreated$ → resolve(vmTokens[type]) → vm.setModel(model)
                            → vm.root.zOrder = data.zOrder → viewport.addWidget(root)
  dataEngine.onModelRemoved$ → viewport.removeWidget(roots) → vm.onRemoved$
```

- 空间查询：`getVmByPoint / getVmByRect` 先空间索引粗筛，再各 VM hitTest + zOrder 排序。
- MIND_MAP 的节点借所在 map 的 zOrder；节点级选中走焦点体系（docs/11）。

## 6. ActionBar schema

- Model 不再暴露属性面板描述；core 产出纯数据 `IActionBarSchema`
  （kind/label/options/disabled），react 统一承载样式与交互。
- 支持单选/多选/脑图焦点；多选几何命令八键（对齐六向 + 分布两向）在 schema 生成处
  按可移动参与数表达禁用态。
- 详细 UI 规格见 docs/12 §4；命令实现见 `boardCommands.ts`。

## 7. 新增控件 checklist

1. 在 `types/widget.ts` 加 zod schema + 判别联合分支。
2. 在 `widgets/xxx/` 写三件套（Model/Vm/Service；创建型继承基类）。
3. 在 `WIDGET_REGISTRY` 登记 schema/capabilities。
4. 在 `WIDGET_TOKENS` / `WIDGET_FACTORIES` 登记 model/vm token。
5. 在组合根构造 Service 并 `initialize()`。
6. 补单测：Model 校验/clamp、纯函数数学、交互编排桩测试。
7. 更新 docs 与 E2E 探针。

## 8. 控件清单

| 控件     | 说明                                                       |
| -------- | ---------------------------------------------------------- |
| SHAPE    | 20 型形状（四基础 + 16 扩展），图形内文字，默认 rect       |
| STICKY   | 便签，共享文本测量/渲染管线                                |
| TEXT     | 富文本，三态模型（docs/07）                                |
| LINE     | 直线/正交/曲线，锚定、箭头、线上文字、quick-add（docs/08） |
| PEN      | 画笔，60ms 采样，points 增量写                             |
| IMAGE    | 图片，本地资产引用 + 失败回退 data URL（docs/19）          |
| MIND_MAP | 脑图，节点级选中/拖拽重排/快捷键（docs/11）                |
| ERASER   | 纯工具型，无 Model/Vm；只擦 PEN，分段擦除（§8.1）          |

### 8.1 橡皮

- 语义：分段擦除，只擦 PEN 笔画；扫过部分消失，剩余分段保留（交点级边界）。
- 手势：按下拖拽扫过；点击擦单点圆；Esc/V 退出；拖动中 Esc = undo 本手势且不切模式。
- 半径：屏幕 10px 默认 ÷ vpScale；`[ ]` 步进 4，钳制 4–40。
- 落库：一个事务三分支——全擦删 / 剩一段 setPoints / 多段原设首段 + 新建其余；
  undo 靠 captureTimeout 窗口合并为一步。
- 切割数学：`common/geometry.eraseStrokeAgainstSweep`，纯函数带单测。

## 9. 验收

- [x] 创建→渲染→拖动→undo→redo→删除，无一处直接改 VM。
- [x] 同值 update 不产生 op；非法字段被拒；超限 clamp。
- [x] 新增控件零改 dataEngine/vmEngine。
- [x] 形状 20 型、线三型、橡皮分段均有单测/E2E。
