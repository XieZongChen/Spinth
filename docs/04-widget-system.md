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
- 新能力字段一律 `optional()` 零迁移：老文档缺字段时消费侧 `?? 缺省`
  （如形状 borderColor/borderWidth/fill、线 startPort/endPort），渲染逐字节不变。
- 视图偏好（主题、网格吸附开关）不入 Model/文档：经 localStorage 持久化 +
  服务流广播（`gridSnap$`/`setGridSnap`），只门控落点量化。

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
- 多图元工具（sequence）：一个 `CursorMode` 只能注册一组处理器——`SequenceService`
  是 `'sequence'` 的唯一注册者，其 `handlers` 逐成员转发到当前图元的服务；图元
  服务照常继承基类但不注册（`LifelineService.initialize()` 抛错防误调，
  specs/sequence-diagram §7.1）。
- 单击与拖拽画图的分界：默认为位移 ≥ 10 屏幕 px（欧氏距离，每帧按缩放换算；与
  docs/05 §4.1 起拖阻尼 `DRAG_TRACTION_SCREEN` 同值）。低于分界一律按单击收尾
  （shape/sticky 一致）：默认尺寸、以**按下点**为中心、仅划撤销边界，不选中、工具
  保持激活（可连击放置）；拖拽画图松手选中新件并回选择工具。sticky 仅分界覆写为
  两轴各 ≥ 24 屏幕 px，回缩冻结。
- 非创建型交互（pen/line/text/eraser）自行 `registerGlobalEventListener`。
- 工具默认参数是 Service 会话态（不落库、不持久化）：shapeType、lineType、penColor、
  stickyColor、fontSize、eraserRadius、时序图图元种类（sequence kind）。SDK 聚合为 `defaultToolOptions$` +
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
  MIND_MAP: { family: 'tree', schema: MindMapSchema, capabilities: { ... } },
  ORG_CHART: { family: 'tree', schema: OrgChartSchema, capabilities: { ... } },
  IMAGE: { schema: ImageSchema, capabilities: { ... } },
  SYMBOL: { schema: SymbolSchema, capabilities: { ... } },
  FRAME: { schema: FrameSchema, capabilities: { ... } },
  LIFELINE: { schema: LifelineSchema, capabilities: { ... } },
} as const;
```

- `WIDGET_RUNTIME`（widgetRuntime.ts）：组合根装配 Model/Vm 的 token + 工厂单源；
  `WidgetDataUnion` 直接从 `WIDGET_REGISTRY` 派生（类型注册表 = schema 域 + 运行时域各一处）。
- 唯一构造入口 `createBoard()`（createBoard.ts）：内部 `new BoardSDK()` 后返回公开投影，
  类不导出到包入口；`BoardSDK.initialize` → `composeBoard` 显式注册 token、构造服务、接线事件。
- 新增类型只扩展注册表与三件套，不改 dataEngine/vmEngine 的分发逻辑。
- `BoardSDK` 携门面基类 `BoardFacade`（boardFacade.ts）：17 条输出流 getter 与
  31 条纯命令委托在基类，服务字段/生命周期/查询留在 `BoardSDK`——对外形状
  不变（继承成员仍在实例上）。

## 4. 能力位

`rotatable / groupable / resizable / movable / selectable / keepRatio / editable /
referenceable / erasable`

`keepRatio` 仅 IMAGE 置 true：手柄缩放按住 Shift 时锁定宽高比，普通拖拽自由
缩放（docs/05 §4.4）。其余能力位的消费点与语义见 `types/widget.ts` 注释。

注册表每项含 `family: 'widget' | 'tree'`（docs/22 §1）：family 是引擎层
唯一判据（vmEngine 查询豁免 / culling 豁免 / selector 节点拖拽分流走
`isTreeWidgetType()`）；树种类差异在 `widgets/tree/registry.ts` 的
`TREE_KINDS`（编译锁：键集 ≡ family 'tree' 类型集）。

| 类型      | 旋转 | 编组 | 缩放 | 可编辑 | 参考线 | 橡皮 |
| --------- | ---- | ---- | ---- | ------ | ------ | ---- |
| SHAPE     | —†   | ✓    | ✓    | ✓      | ✓      | —    |
| TEXT      | —†   | ✓    | ✓    | ✓      | ✓      | —    |
| STICKY    | —†   | ✓    | ✓    | ✓      | ✓      | —    |
| IMAGE     | —†   | ✓    | ✓    | —      | ✓      | —    |
| SYMBOL    | —    | ✓    | ✓    | ✓      | ✓      | —    |
| FRAME     | —    | —    | ✓    | —*     | ✓      | —    |
| LIFELINE  | —    | ✓    | ✓    | —*     | ✓      | —    |
| LINE      | —    | ✓*   | —    | —      | —      | —    |
| PEN       | —    | ✓    | ✓    | —      | —      | ✓    |
| MIND_MAP  | —    | —    | —    | —      | —      | —    |
| ORG_CHART | —    | —    | —    | —      | —      | —    |

- LINE 类型级可组，锚定态由 `groupOps` 运行时判定。
- FRAME（specs/container-frame）：不可编组（几何归属与选择聚合两套语义不混用）；
  标题走自有 plain 内核会话（`editable: false`，同 LINE 线上文字先例——不走
  统一编辑会话通道）；命中 = 标题带 ∪ 边框环（内部空白不命中，docs/05 §3）。
- LIFELINE（specs/sequence-diagram）：标签走自有 plain 内核会话（`editable: false`，
  FRAME 同款）；命中 = 头框 ∪ 轴带（§8.5）；缩放经 `constrainResize` 探针整形
  （docs/05 §4.4）；避障豁免（docs/08 §4）；不带 `parentId`（不进容器，docs/02）。
- † `rotatable` 是旋转手柄入口闸门（唯一消费点 rectEditorService）。SHAPE/TEXT/
  STICKY/IMAGE 四类支持 rotation 数据，入口暂时隐藏而置 false；渲染/命中/缩放/
  锚定等数据能力保留，恢复 = 四类改回 true（docs/05 §8）。SYMBOL 无 rotation 字段、
  能力位恒 false，不属于上述四类。

## 5. BaseVm / VmEngine

```
setState(partial)
  → 合并进 batchState
  → 微任务合批
  → forceUpdate:
      shouldUpdate → beforeUpdate → 赋值 state → render(prev, next) → afterUpdate
      → afterUpdate 发出 onStateChanged$（渲染完成后才广播）
```

写前 diff（`BaseWidgetVm.setState`）的基准是「已应用 state + 待合批 partial」：微任务
未跑时 `state` 仍是上一帧，只对它比较会把同一 tick 内「写回已应用值」的 partial 判成
同值丢弃，合批后 state 停在前一条而文档已变。diff 为空才跳过合批。

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

## 8. 控件清单

| 控件      | 说明                                                                           |
| --------- | ------------------------------------------------------------------------------ |
| SHAPE     | 20 型形状（四基础 + 16 扩展），图形内文字，默认 rect                           |
| STICKY    | 便签，共享文本测量/渲染管线                                                    |
| TEXT      | 富文本，三态模型（docs/07）                                                    |
| LINE      | 直线/正交/曲线，锚定、箭头、线上文字、quick-add（docs/08）                     |
| PEN       | 画笔，60ms 采样，points 增量写                                                 |
| IMAGE     | 图片，本地资产引用 + 失败回退 data URL（docs/19）                              |
| SYMBOL    | 符号：内置矢量图标 + 外置单行标签（§8.4，specs/symbol-widget）                 |
| FRAME     | 容器：标题带 + 背景 + 边框，子元素 parentId 归属/级联（specs/container-frame） |
| LIFELINE  | 时序图生命线：参与者头框 + 竖直虚线轴（§8.5，specs/sequence-diagram）          |
| MIND_MAP  | 脑图，节点级选中/拖拽重排/快捷键（docs/11）                                    |
| ORG_CHART | 组织架构图，层级对齐布局/正交总线/折叠（docs/22）                              |
| ERASER    | 纯工具型，无 Model/Vm；只擦 PEN，分段擦除（§8.1）                              |

### 8.1 橡皮

- 语义：分段擦除，只擦 PEN 笔画；扫过部分消失，剩余分段保留（交点级边界）。
- 手势：按下拖拽扫过；点击擦单点圆；Esc/V 退出；拖动中 Esc = undo 本手势且不切模式。
- 半径：屏幕 10px 默认 ÷ vpScale；`[ ]` 步进 4，钳制 4–40。
- 落库：一个事务三分支——全擦删 / 剩一段 setPoints / 多段原设首段 + 新建其余；
  undo 靠 captureTimeout 窗口合并为一步。
- 切割数学：`common/geometry.eraseStrokeAgainstSweep`，纯函数带单测。

### 8.2 形状 20 型

- 形状类型由 `SHAPE_TYPE_OPTIONS` 单一源维护：四基础型 + 流程图/工程图扩展，共 20 型。
- 几何内接、路径绘制与带字撑高见 `shapeGeometry.ts` / `shapePath.ts` / docs/17 §6。

### 8.3 形状样式

- 样式字段 optional 零迁移：`color`（填充色）/ `fill`（solid|none，none = 只描边
  不填充）/ `borderColor` / `borderWidth`（档位 1/2/4）/ `borderStyle`
  （solid|dashed|none）。
- 解析单源 `shapeStyle.resolveShapeStyle`：缺省回退（无新字段的老文档渲染不变），
  渲染与导出同源。
- 默认字色随填充自适应（`shapeVm.defaultTextColorForFill`，specs/flowchart-closeout
  §16）：浅填充维持 `#333333`、深填充（对比度 <4.5:1）切 `#ffffff`、无填充（文字
  直对画布底，与 TEXT 同场景）随主题默认（`defaultTextColor()`：light `#333333` /
  dark `#ededf2`）；实色填充的字色不主题化（填充色是实例数据）；per-实例 `textColor`
  恒优先。渲染快速路径带主题版本守卫（`setTheme → refreshAll` 生效）；编辑器字色
  同源（`textEditStyle.editStyleOf` SHAPE 分支走同一函数）。文字色板
  `TEXT_COLOR_PALETTE` 深浅双底各可达（护栏单测 `shapeContrast.test.ts`、
  `textEditStyle.test.ts`）。
- 边框色板含 `#ffffff`：定位为**深色填充上的选项**（浅底上低对比，属用户显式
  选择；默认派生边框 = darkenHex(color, 0.25) 不受影响）。
- 「白底黑框」一次配出：填充 `#ffffff` + 边框 `#000000` + 宽 2（specs/flowchart-closeout
  §4.2；色板含黑白两色与无填充/无边框态）。

### 8.4 符号（SYMBOL）

矢量图标 + 外置单行标签的图元（specs/symbol-widget，4.3 网络拓扑的设备底座）：

- 数据：`symbol`（种类 id，未知值渲染占位图不阻断导入）、`label`（纯文本
  ≤64 字素，空串只画图标）、`color`（逐实例着色，缺省随主题墨色
  `resolveSymbolColor` 单源——图标与标签同色、写入即固定不随主题反转）、
  `groupId`；几何走独立 rect（SHAPE 同一扁平化路径）。
- 两段几何（`symbolGeometry.ts` 单源）：图形区 + 恒 24 标签带（间距 2，
  计入 bbox；命中/框选/对齐/导出按整 bbox）；默认 100×126；图标 contain
  适配不拉伸；锚点只贴图形区四边（`t∈[0,1]`），标签带不参与锚定。
- 资产：`widgets/symbol/assets/*.svg` 自绘单色线稿（48 viewBox / 2px 描边 /
  currentColor），`scripts/build-symbol-glyphs.mjs` 构建期内联为
  `symbolGlyphs.generated.ts`（硬校验：元素/属性白名单、禁 polyline/polygon
  （PIXI SVG 解析缺陷）与硬编码色；`pnpm symbols:check` 接 verify）。
- 渲染：按 kind 共享 `GraphicsContext`（`new GraphicsContext().svg()`），
  颜色走 `tint`（生成期 currentColor 归一为纯白 `#ffffff`——PIXI tint 是
  逐通道乘法，白是唯一能呈现 tint 色的乘法基色）；颜色不进缓存键。
- 工具：`SymbolService extends DragCreateServiceBase`（scope `symbol`、
  单击默认尺寸按下点居中可连击）；`CursorMode 'symbol'`、快捷键 N、
  种类记忆经 `setDefaultToolOption('symbol','kind',·)`。
- 标签编辑走统一编辑会话（docs/17 SYMBOL profile：标签带中心 anchor
  center、纯文本落库、渲染期单行截断 + 省略号——数据恒存完整 64 字素）。
- 项目文件零资产条目（与 IMAGE 的关键差别）；不旋转、无 autoHeight。

### 8.5 生命线（LIFELINE，时序图）

UML 时序图的参与者图元（specs/sequence-diagram）。时序图按批落地：当前只有生命线；
消息、激活条、组合片段与轴锚定未做——生命线对连线工具是普通矩形控件。

- 数据：`label`（参与者名，纯文本单行，落库清洗 ≤64 字素，空串只有头框）、`head`
  （`box` 缺省 / `actor`——小人绘制未做，此前按加高的头框渲染）、`groupId`；
  **不带 `parentId`**（不进容器，docs/02）。几何 = 整条（头 + 轴）的 bbox，轴在
  水平中心；默认 120×520。
- 几何单源 `lifelineGeometry.ts`（纯函数）：头区高 36（actor 72）、轴自头区底边到
  bbox 底边、缩放下限 60×120；点命中 / 框选 = 头框 ∪ 轴带（半宽 = 屏幕 6px 按
  vpScale 折算、钳 6…24，每帧现算）——bbox 内轴旁空白不命中，框选只擦过轴旁空白
  不入选。
- 渲染：头框 `#ffffff` 填充 + 1px `#333333` 描边，居中单行标签（14/20，超宽逐字素
  截断 + 省略号，数据恒存完整标签），轴为 1px 虚线（手工点划）、色随主题墨色
  （快速路径以主题版本守卫）。高度不足头区高时不画轴、宽度 < 24 时标签为空。
- 缩放：`constrainResize` 探针整形（docs/05 §4.4）——被拖边跟手，宽度 = 2 × 被拖边
  到轴的距离（轴不因缩放移动）。
- 避障豁免：`isRouteObstacle()` 恒 false（docs/08 §4）——通用折线穿过生命线不绕行。
- 工具：`LifelineService extends DragCreateServiceBase`（单击默认尺寸按下点居中、
  草稿下限 60×120、网格吸附接线），由 `SequenceService` 转发；工具坞「时序图 (Q)」
  单入口，图元种类经二级菜单选择、记忆走工具默认参数（docs/12）。
- 标签编辑走自有 plain 内核会话（docs/17）：再点一次已选中的头框进入（点轴不算），
  Enter 恒提交，空标签保留，一次编辑一步 undo。
- 不旋转；ActionBar 暂无样式项；老客户端按未知类型隔离。
