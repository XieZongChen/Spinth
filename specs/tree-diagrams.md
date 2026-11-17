# 树形图族（Tree Diagram Family）技术方案

> 状态：**已实施（Phase 0-3 全量）+ 三轮外部审查返工收口
> （f7948fd..d1b5a2a）**。Phase 4 可选增强未做；手工验收六项（§14.5）待人工。
> 复审按 §16 清单逐条核对。
>
> 基线：mind-horizontal/mind-vertical/org-sample + theme 双态共 9 张，
> darwin 系统 Chrome / linux 容器各一套；三轮返工后已按当前代码重生成
> （darwin 三张经删后重生成，org 根无徽标另有数据断言）。双平台
> `--stability` 双跑记录见 AGENTS 当前状态；脚本本身不强制
> （specs/linux-visual §10.3）。
> 范围：`packages/core` 树形控件族、`@spinth/react` 工具入口/浮层、docs 与测试。
> 本文是过程文档（specs/），记录设计结论、实施顺序与验收口径；当前事实以 docs/ 为准。

## 0. 摘要

### 0.1 一句话

把现有 `MIND_MAP` 的**树数据、增量同步、编辑、撤销、持久化、焦点宿主**抽成公共骨架；
把**布局、连线、导航、落点、节点样式**抽成按 kind 注入的策略；在这个骨架上派生两种树：

- `MIND_MAP`：脑图语义。新增**上下排列**（与左右排列同一套逻辑侧，物理轴镜像）与**折叠**。
- `ORG_CHART`：组织架构语义。上→下、**按层对齐**、按子树宽度横向排布、卡片节点、折叠。

两者是**同一 family 下的两个 widget type**，不是同一个类型的 `layout` 开关，也不是两份实现。

### 0.2 关键决策（先看结论）

| 编号 | 决策         | 结论                                                                                 | 主要理由                                                         |
| ---- | ------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| D1   | 家族承载     | `family: 'tree'` + `TREE_KINDS` 注册表                                               | 引擎只认 family，种类只认策略；新增种类不改引擎                  |
| D2   | 控件类型     | 保留 `MIND_MAP`，新增 `ORG_CHART`                                                    | 改 type 破坏 1.0 旧文档；单类型带 kind 会让能力/命令/schema 混叉 |
| D3   | 公共骨架     | 组合优先：`TreeMapModel/TreeNodeModel/TreeMapVm/TreeService/TreeOps` 基类 + 策略接口 | 共享编排，不共享语义；避免深继承树                               |
| D4   | 逻辑侧       | `direction` 只存**逻辑侧** `left/right`；`orientation` 决定物理轴                    | 上下排列不重写任何节点数据；旧客户端仍能按左右打开               |
| D5   | 折叠         | 节点可选字段 `collapsed`，**入文档**、一次切换一步撤销                               | 刷新/导出/多标签一致；“折叠 + 导出”完成标志成立                  |
| D6   | 组织架构布局 | 全局按层定 y、按子树宽度定 x、父在子跨度上居中                                       | 脑图的“子树各自居中”会让同层节点错层，不是组织架构图             |
| D7   | 种类切换     | 不做整图 mind↔org 转换；子树可跨种类拖拽                                             | 两种语义不同；整图转换规则成本高、收益低                         |
| D8   | 公开面       | BoardSDK/包入口**只增不删**；旧 `mind*` 名称保留                                     | 1.0 是公开 API 基线；1.x 不做破坏性变更                          |
| D9   | 工具入口     | 一个「树形图」按钮 + 二级菜单切 kind；M=脑图、O=组织架构直达；按钮走记忆             | 不增坞内按钮；分类可见；默认脑图；M 语义不变                     |

### 0.3 不做什么

- 不做部门/区域**容器**（4.4 的 FRAME）；组织架构 MVP 用层级与卡片表达部门。
- 不做**节点级连线**（虚线汇报/矩阵汇报）：LINE 锚点只认 widget，树节点不是 widget；树模型单父。
- 不做 BPMN/UML/泳道/时序；不做 SVG 导出；不做协同 awareness 的节点级语义扩展。
- 不做节点级多选/框选、节点级复制粘贴；折叠全部/展开全部列 backlog。
- 不做运行时 mind↔org 整图互转。

---

## 1. 现状审计

### 1.1 现有树是什么

一张脑图 = 一个 `MIND_MAP` widget，内部是递归 `MIND_NODE` 树；节点不是 widget、不进
zOrder（[docs/11 §0](../docs/11-mindmap.md)）。关键事实：

| 层   | 现状                                                                                     | 文件                                                     |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 数据 | `root` Y.Map 树；节点字段 `id/text/direction/lineColor/children`；`toJSON` 剥离 children | `widgets/mind/mindMapModel.ts`、`mindNodeModel.ts`       |
| 同步 | `yChildren.observe` delta → 内存 splice → `childrenChange$`；Vm 增量 build/destroy       | `mindNodeModel.ts`、`mindMapVm.ts`                       |
| 布局 | 左右分侧；按**子树高度**纵向堆叠、父在子组中垂直居中；根层垂直平衡；根锚定左上角         | `mindLayout.ts`                                          |
| 连线 | 根→一级二次贝塞尔（t 参数）；普通节点鱼骨折线 + R8 真圆弧                                | `mindDrawerMath.ts`、`mindMapVm.drawConnectors`          |
| 节点 | 单 `text`；字号按深度 28/18/14；宽 ≤360 换行；一级分支色描边                             | `mindNodeVm.ts`                                          |
| 焦点 | `focusedNodeId` 瞬态；左右侧向方向键；安全区跟随                                         | `mindFocusController.ts`、`mindNav.ts`                   |
| 拖拽 | 10px 判拖；拖影；全图 DropArea 缓存；跨图搬移/拖出成图                                   | `mindDragController.ts`、`mindDropHit.ts`、`dropArea.ts` |
| 编辑 | 统一编辑会话 plain 内核；节点内联 textarea                                               | `mindNodeEditor.ts`                                      |
| 操作 | Tab 建子 / Enter 建同级 / Delete；树写序列化搬移                                         | `mindTreeOps.ts`                                         |

### 1.2 能力矩阵：现有 vs 两种目标

| 能力                             | 现有 MIND_MAP      | 脑图竖向           | 组织架构      | 结论                    |
| -------------------------------- | ------------------ | ------------------ | ------------- | ----------------------- |
| 单根/单父/有序/无限层            | 有                 | 有                 | 有            | **数据层复用**          |
| 增量树同步                       | 有                 | 有                 | 有            | 复用                    |
| Tab/Enter/Delete/撤销/持久化     | 有                 | 有                 | 有            | 复用                    |
| 跨父移动/跨图拖拽                | 有                 | 有                 | 有            | 复用（补种类转换）      |
| 焦点体系/选区框/视窗跟随         | 有                 | 有                 | 有            | 复用（导航策略换）      |
| 左右排列                         | 有                 | —                  | —             | 冻结                    |
| 上下排列                         | 无                 | **新增**           | —             | 布局/连线/落点/导航镜像 |
| 同层对齐（level y）              | 无（子树各自居中） | 无（保持脑图错落） | **需要**      | org 专属布局            |
| 按子树宽度排布                   | 无                 | 无                 | **需要**      | org 专属布局            |
| 折叠                             | 无                 | **新增**           | **新增**      | 共享数据 + 交互         |
| 卡片节点（标题；副标题 Phase 4） | 单文本             | 单文本             | **需要**      | 样式策略                |
| 正交总线连线                     | 无（鱼骨）         | 无（镜像鱼骨）     | **需要**      | 连线策略                |
| 方向键语义                       | 左右侧向           | 镜像               | 父/子/兄弟    | 导航策略                |
| 拖拽落点轴                       | y 轴三层           | 镜像               | x 轴分区      | 落点策略                |
| 部门容器                         | 无                 | 无                 | 可后置（4.4） | 非本批                  |
| 跨节点虚线/多父                  | 无                 | 无                 | 可选，非目标  | 硬缺口，不做            |

### 1.3 两种树本质不同：不是“把脑图竖过来”

**脑图（含竖向）**：每个父节点独立排自己的子树，子树整体在父节点**跨轴方向**居中；不同分支的
同层节点**不要求同一条线**。它追求“分支各自生长”的错落感。

**组织架构**：所有同层节点落在**同一条水平线**（level y），横向位置由子树宽度决定，父节点
在子节点跨度上居中。它追求“层级对齐”的秩序感。

因此：

- 脑图竖向 = 现有递归布局的**转置**：纵向堆叠换成横向堆叠、垂直居中换成水平居中、
  上下间距换成左右间距。算法可镜像，测试可对称断言。
- 组织架构 = **另一套布局模型**：先自底向上算子树宽度，再自顶向下按层定 y、按槽位定 x。
  它不能由脑图布局加参数得到；转置现有算法会得到“父居中但同层错层”的结果。

这是新增 kind、而不是给脑图加一个 `layout` 参数的根本原因。

### 1.4 现状耦合点（必须一起改，否则 ORG_CHART 接不进来）

| 位置                                                    | 现状                                                         | 影响                       |
| ------------------------------------------------------- | ------------------------------------------------------------ | -------------------------- |
| `platform/vmEngine/vmEngineService.ts`                  | `mindVmIds` 硬编码 `type === 'MIND_MAP'`；树图对空间索引豁免 | 新 tree kind 会漏查询/命中 |
| `platform/spatial/cullingService.ts`                    | `type === 'MIND_MAP' → continue`                             | 新 tree kind 会被误裁      |
| `platform/selector/selectorService.ts`                  | `top.type === 'MIND_MAP'` 才走节点拖拽                       | 新 kind 拖不动节点         |
| `platform/keyboard/keyboardService.ts` + `shortcuts.ts` | mind 专用 handler/Tab/Enter/方向键                           | 新 kind 键盘失效           |
| `boardActionBar.ts`                                     | `case 'MIND_MAP'` 节点分支色                                 | 新 kind 无操作栏           |
| `boardQueries.ts`                                       | `getMindAddButtons` 左右槽位                                 | 竖向/org 无法出按钮        |
| `debugSnapshot.ts`                                      | `mindNodes/mindFocus`                                        | E2E 探针不覆盖新 kind      |
| `index.ts`                                              | 导出 `layoutMindTree/IMindNodeSpec/MIND_*` 等                | 重构必须保留这些公开导出   |
| `boardPublicApi.ts`                                     | `mindService` 内部字段、`mind*` 命令                         | 新增公开面要分类锁         |

### 1.5 现有代码的硬约束

- **400 行铁律**：`mindDragController` 372、`mindFocusController` 349、`mindService` 366、
  `mindMapVm` 326 都已贴上限；加竖向/org 分支前必须先拆。
- **公开导出**：`BRANCH_COLORS/branchColorAt/IMindNodeSpec/layoutMindTree/ILayoutNode/ILayoutResult/
MIND_ROOT_STYLE/MIND_NODE_STYLE/MIND_COLORS/NODE_MAX_WIDTH` 从包入口导出，重构后必须原样可用。
- **数据零迁移**：新增字段一律 optional；旧文档不重建、不补写。
- **单文件单职责**：布局/连线/落点/导航必须是纯逻辑独立文件，Vm 不写算法。

---

## 2. 设计目标

1. **一套骨架，多种树**：树数据/同步/编辑/撤销/持久化/焦点宿主只实现一次。
2. **语义在 kind，编排在骨架**：kind 只提供策略与配置；骨架不出现 `if kind === 'org'`。
3. **数据零迁移**：`MIND_MAP` 旧文档行为逐像素冻结；新字段 optional。
4. **脑图竖向是镜像，不是新模型**：逻辑侧不变，物理轴由 orientation 决定；切换不重写节点。
5. **组织架构是独立布局模型**：按层对齐、子树宽度、正交总线；不受脑图错落语义牵制。
6. **折叠是一等能力**：入文档、可撤销、影响布局/命中/导航/导出，两种树共享。
7. **公开面只增不删**：BoardSDK 与包入口保持 1.0 兼容；新能力走 allowlist 增量。
8. **可扩展**：未来加“文件树/放射脑图”只加 kind 配置 + 策略，不改引擎、不改骨架。
9. **可审查**：每个纯逻辑有单测，每个交互有 E2E，关键图种有视觉基线。

---

## 3. 总体架构

### 3.1 家族、种类、方向、侧

```
Tree family（family: 'tree'）
├── MIND_MAP   kind=mind   orientations: horizontal | vertical
│                sides: left | right（逻辑侧；vertical 时 left=上、right=下）
└── ORG_CHART  kind=org    orientations: top-down（MVP）| left-right（后置）
                 sides: 无（children 顺序即左右顺序）
```

术语：

- **kind**：树语义（脑图/组织架构/未来种类），决定布局/连线/导航/落点/样式。
- **orientation**：同一 kind 的物理轴变体；脑图左右/上下，org 上→下/左→右。
- **side**：脑图的**逻辑分支侧** `left/right`，不随 orientation 改变含义。
- **family**：控件实现族；`family: 'tree'` 的唯一含义是“节点不是 widget、几何由树布局派生、
  空间索引与 culling 豁免”。

### 3.2 分层与依赖

```
types/                       schema、family、公共类型（不 import widgets）
  widget.ts                  WIDGET_REGISTRY（family/schema/capabilities）
  tree.ts                    TreeOrientation / TreeSide / ITreeNodeSpec / ITreeAddButtonsState

widgets/tree/                骨架 + 策略 + 种类配置
  kinds/mind.ts, org.ts      只提供配置与策略工厂
  registry.ts                TREE_KINDS（type → kind）
  treeMapModel.ts            图级 Model 基类
  treeNodeModel.ts           节点 Model（增量树）
  treeSpec.ts                JSON↔Y 树、跨种类字段过滤
  treeMapVm.ts               图级 Vm 基类（同步/测量/布局调度/命中/几何）
  treeNodeVm.ts              节点 Vm 基类（标题/副标题/徽标）
  layout/                    mindHorizontal / mindVertical / org / types
  connector/                 mind / org / orthogonal / types
  nav/                       mind / org / types
  drop/                      dropArea（轴泛化）/ mind / org / preview / types
  drag/treeDragController.ts
  focus/treeFocusController.ts
  edit/treeNodeEditor.ts
  ops/treeOps.ts
  tool/treeToolController.ts
  service/treeService.ts

widgetRuntime.ts             组合根：MIND_MAP/ORG_CHART → Model/Vm 工厂
platform/*                   只依赖 family 与 registry，不依赖具体 kind
```

依赖方向：`types ← widgets/tree ← widgetRuntime/组合根`；`platform` 只 import `types`。
kind 配置只 import 纯策略模块，不 import Model/Vm/Service（避免环）。

### 3.3 三张注册表

1. **`WIDGET_REGISTRY`（types/widget.ts）**：`family + schema + capabilities`。
   - 现有七类补 `family: 'widget'`；`MIND_MAP` 与 `ORG_CHART` 为 `family: 'tree'`。
   - `family` 是编译期字面量；`TreeWidgetType` 由它派生，防“注册表加了、种类表没加”。
2. **`WIDGET_RUNTIME`（widgetRuntime.ts）**：type → model/vm token + 工厂。
   - `MIND_MAP → MindMapModel/MindMapVm`；`ORG_CHART → OrgChartModel/OrgChartVm`。
   - 两个 Vm 都是 `TreeMapVm` 的薄子类（构造时注入 kind），不复制逻辑。
3. **`TREE_KINDS`（widgets/tree/registry.ts）**：type → `ITreeKind`。
   - 编译期锁：键集 ≡ 注册表里 `family === 'tree'` 的类型集。

### 3.4 核心接口（示意，实施可按文件拆分）

```ts
type TreeWidgetType = 'MIND_MAP' | 'ORG_CHART';
type TreeOrientation = 'horizontal' | 'vertical' | 'top-down' | 'left-right';
type TreeSide = 'left' | 'right'; // 逻辑侧

interface ITreeLayoutNode {
  id: string;
  width: number;
  height: number;
  direction?: TreeSide;
  collapsed?: boolean;
  children: ITreeLayoutNode[]; // 调用方已剔除折叠节点的后代
}

type ConnectorCmd = IConnectorCmd; // 现有类型：moveTo/lineTo/arc/cubicTo

interface ITreeNavCtx {
  parentOf(id: string): string | null;
  childrenOf(id: string): string[];
  sideOf(id: string): TreeSide | null;
  // 主轴跨度：axis 由宿主按 orientation 分派（mind horizontal→y；
  // vertical / org top-down→x；org left-right Phase 4 届时→y）——
  // 实现见 focus/treeFocusController.ts navigate 的 alongX
  spanOf(id: string): { start: number; end: number } | null;
  isCollapsed(id: string): boolean;
}

interface ITreeDropTarget {
  kind: 'asChild' | 'asSibling';
  nodeId?: string; // asChild 的目标父
  parentId?: string; // asSibling 的父
  index: number; // children 绝对下标
  side?: TreeSide; // mind 逻辑侧；org 无
}
interface ITreeDropPreview {
  block: IRect;
  cmds: ConnectorCmd[];
}

interface ITreeKind {
  readonly type: TreeWidgetType;
  readonly defaultOrientation: TreeOrientation;
  readonly orientations: readonly TreeOrientation[];
  readonly supportsSides: boolean; // mind true / org false
  readonly supportsLineColor: boolean; // mind true / org false
  readonly supportsSubtitle: boolean; // Phase 4 起 org true；mind false
  layout(o: TreeOrientation): ITreeLayout;
  connector(o: TreeOrientation): ITreeConnector;
  nav(o: TreeOrientation): ITreeNav;
  drop(o: TreeOrientation): ITreeDrop;
  readonly style: ITreeStyle;
  readonly defaultRootText: string;
  defaultChildText(n: number): string;
}

interface ITreeLayout {
  layout(root: ITreeLayoutNode): ITreeLayoutResult;
}
interface ITreeLayoutResult {
  positions: Map<string, { x: number; y: number }>; // 相对根左上角
  bbox: IRect;
  levels?: Map<string, number>; // org 测试/调试用
}

interface ITreeConnector {
  path(edge: ITreeEdge): ConnectorCmd[];
}
interface ITreeEdge {
  parent: IRect;
  child: IRect;
  side: TreeSide | null; // org = null
  depth: number;
}

interface ITreeNav {
  navigate(
    currentId: string,
    key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
    ctx: ITreeNavCtx,
  ): string | null;
  focusAfterDelete(nodeId: string, ctx: ITreeNavCtx): string | null;
}

interface ITreeDropHost {
  mapId: string;
  rootOrigin: { x: number; y: number }; // 世界坐标
  nodeRect(id: string): IRect | null; // 局部坐标
  parentOf(id: string): string | null;
  childrenOf(id: string): string[];
  sideOf(id: string): TreeSide | null;
  isCollapsed(id: string): boolean;
}
interface ITreeDropAreas {
  hitTest(world: IPoint): ITreeDropTarget | null;
}
interface ITreeDrop {
  buildAreas(host: ITreeDropHost, excludeSubtreeId: string): ITreeDropAreas;
  preview(target: ITreeDropTarget, host: ITreeDropHost): ITreeDropPreview;
}
```

> 接口只锁“骨架需要知道的最小面”。drop 用窄 host 结构而非 `TreeMapVm`，避免
> kind 配置反向依赖 Vm 造成环；骨架提供 adapter。不要为未来种类预造事件总线/插件生命周期。

### 3.5 数据流

```
写：pointer/keyboard → TreeService/TreeOps → Yjs transact（唯一写源）
读：Yjs delta → TreeNodeModel → TreeMapVm.syncTree（增量 Vm）
    → buildLayoutSpec（测量尺寸 + 折叠可见性）
    → kind.layout(orientation)（纯函数）
    → positions/bbox + kind.connector（纯命令）→ Graphics
    → markRender + onStateChanged$（bbox 变化才广播）
```

图纸规则：

- 交互期零 Yjs 写；拖拽/预览只改 Vm。
- 松手落库用最后一帧命中的 drop target（docs/14 规则 4）。
- 布局是派生视觉，不写 rect；rect 只在整图拖拽时改。
- 折叠是**文档写**（唯一例外：它本来就是文档状态），但仍走 Model/Yjs。

### 3.6 为什么是“两个 widget type + 共享骨架”

| 方案                                   | 数据/契约                 | 优点                                 | 缺点                                                                           | 结论   |
| -------------------------------------- | ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| A. `MIND_MAP` + `layout: 'org'`        | 旧类型不变                | 复用最多、可切形态                   | 能力/命令/样式/schema 长期分叉；org 语义寄生在脑图上；后续每个功能都要双态定义 | 否     |
| B. 单 `TREE` + `kind`                  | 需改 type 或做迁移        | 分类干净                             | 1.0 旧文档/公开类型破坏；capabilities 并集；命令按 kind 分支                   | 否     |
| C. `MIND_MAP` + `ORG_CHART` + 共享骨架 | 各自 schema，节点字段共享 | 零迁移；语义清晰；注册表驱动；可扩展 | 多一个注册项                                                                   | **是** |

“树形图分类”落在三处：`family: 'tree'`、`TREE_KINDS` 注册表、工具坞的树形工具组（§10）。

### 3.7 未来种类如何派生

以“文件树（缩进列表）”为例，只需：

1. 加 `TREE_FILE` schema + `WIDGET_REGISTRY`（family tree）+ `WIDGET_RUNTIME` 工厂；
2. 写 `layout/fileTree.ts`（每层 x 缩进、y 行高）、`connector/none.ts`、`nav/file.ts`、
   `drop/file.ts`、`style/file.ts`；
3. `TREE_KINDS` 加一项；工具坞加一个入口。

不改 `TreeMapVm/TreeService/TreeOps`，不改 vmEngine/culling/selector，不改公开 API 形状。
放射脑图同理（layout/connector 换，折叠/编辑/拖拽复用）。

---

## 4. 数据模型

### 4.1 节点字段（两种树共享）

| 字段        | 类型     | 写入方     | 消费方              | 说明                                             |
| ----------- | -------- | ---------- | ------------------- | ------------------------------------------------ |
| `id`        | string   | 创建       | 全部                | 树内唯一；不进 widgets 语义                      |
| `text`      | string   | 编辑/创建  | 全部                | 标题/节点文案                                    |
| `subtitle`  | string?  | Phase 4    | org 样式（Phase 4） | 副标题（职务/部门）；mind 不渲染；与编辑一起启用 |
| `collapsed` | boolean? | 折叠命令   | 布局/命中/导航/导出 | 缺省 = 展开                                      |
| `direction` | `'left'  | 'right'`?  | 脑图建子/拖拽       | mind 布局/导航/落点                              | **逻辑侧**；仅根的直接子节点落盘，深层继承 |
| `lineColor` | string?  | 脑图分支色 | mind 连线/描边      | 仅根的直接子节点落盘，深层继承                   |
| `children`  | Y.Array  | 树写       | 全部                | 递归                                             |

- `toJSON` 仍只含自身字段（剥离 children）——叶编辑不能触发祖先 O(子树) 序列化。
- `subtitle/collapsed` 缺省不补写；旧文档零迁移。
- `direction` 不扩成 up/down。**物理方向由 orientation 映射**：
  - horizontal：left = 左、right = 右；
  - vertical：left = 上、right = 下。
    好处：上下排列切换**不重写任何节点**；旧客户端打开竖向图仍能按左右分支渲染（降级而非损坏）。

### 4.2 图字段

```ts
// MIND_MAP
{ id, type: 'MIND_MAP', zOrder, orientation?: 'horizontal' | 'vertical', root?: unknown }
// ORG_CHART（MVP 只写 top-down；left-right 为 Phase 4 的 enum 扩宽，零迁移）
{ id, type: 'ORG_CHART', zOrder, orientation?: 'top-down', root?: unknown }
```

- `orientation` optional；缺省取 kind 默认（mind=horizontal，org=top-down）。
- `root` 仍为 `z.unknown()`（树结构由 TreeModel 构建期校验/兜底；schema 只放行）。
- 几何 `x/y` 锚定**根节点左上角**；`width/height` 是布局派生占位，不落库真实 bbox。

### 4.3 字段 × 种类矩阵

| 字段      | MIND_MAP         | ORG_CHART            |
| --------- | ---------------- | -------------------- |
| text      | 渲染/编辑        | 渲染/编辑            |
| subtitle  | 不渲染（保留）   | Phase 4：渲染 + 编辑 |
| collapsed | 渲染/交互        | 渲染/交互            |
| direction | 布局/导航/落点   | 忽略（写入时剥离）   |
| lineColor | 连线/描边/操作栏 | 忽略（写入时剥离）   |

跨种类写边界（`treeSpec.ts` 的 `projectSpecFor(kind, spec)`）：

- mind → org：递归剥离 `direction/lineColor`；
- org → mind：保留 text/subtitle/collapsed；落点为根的直接子节点时按落点侧写入 `direction`、
  按插入位分配 `lineColor`；普通节点清空继承新父。

### 4.4 方向与 orientation 的切换

- 切换只写图字段 `orientation`，**一个事务、一步撤销**；不重写节点。
- 布局/连线/导航/落点按新 orientation 重新映射逻辑侧。
- 撤销恢复 orientation 即恢复原排列；无转换命令、无数据迁移。
- 旧客户端打开 `orientation: 'vertical'` 的文档：忽略字段，按 horizontal 渲染；分支分组不变。

### 4.5 折叠写入

```ts
setCollapsed(nodeId, next) {
  const node = findNode(...);
  doc.transact(() => node.yMap.set('collapsed', next));
  history.stopCapturing(); // 一次切换一步撤销
}
```

- 折叠/展开是文档写；只读态禁用（与“所有写门禁”一致）。
- 折叠时若焦点在隐藏后代：焦点移到被折叠节点（显式，不等 getFocused 自愈）。
- 编辑态中触发折叠：先退出编辑会话，再写。
- 在折叠节点上建子/拖入子：同一事务内 `collapsed=false`，否则新节点不可见；仍是一步撤销。
- 导出 PNG 按当前可见布局（折叠子树不出现）；项目文件保存折叠状态；多标签由文档同步。

### 4.6 序列化与复制

- `yTreeToSpec` 透传 `subtitle/collapsed/direction/lineColor`；`buildYTree` 对称。
- 跨图/跨种类搬移走“序列化 → 删除 → 反序列化插入”（协同安全，沿用 docs/11 §6）。
- 剪贴板整图复制：`model.toJSON()` 含 `root` 树 → 粘贴重建；两种树同路径。
  节点级复制不做（非目标）。
- 项目文件是 Yjs 全量快照，不逐件校验 schema；新 kind 自动随文档导出/导入。
- 历史隔离：折叠、搬移、orientation 切换都 `stopCapturing()`，避免与相邻命令并项。

### 4.7 错误与边界

- 缺 `root`：沿用 `TreeMapModel.root` 抛错 + 现有隔离区/损坏文档策略；不静默造空树。
- 未知 kind/type：`WIDGET_RUNTIME` 未注册即抛（现有 vmEngine 行为）；`treeKindOf` 返回
  null 的路径只用于防御，不在正常装配路径。
- 非法 orientation：按 kind 默认处理并 warn（不写回文档）。
- 折叠无子节点：no-op（不写 `collapsed:true`，避免空徽标）。
- 根节点不可拖拽、不可作为 `asSibling` 目标；拖起子树整棵排除。
- 删根 = 删整图（沿用现有语义）。
- 跨种类搬移时目标 kind 不支持的字段在写边界剥离，不做“保留但隐藏”的脏数据。

---

## 5. 布局

### 5.1 公共输入输出

- 输入是**可见树**：`collapsed` 节点的 children 已被调用方剔除；节点带测量尺寸与逻辑侧。
- 输出 `positions`（相对根左上角）、`bbox`；org 额外输出 `levels`（depth 索引）。
- 纯函数：不 import PIXI/Yjs/服务；测试只喂数字。
- 根锚定：positions 根 `(0,0)`；允许负坐标（左/上展开）；Vm 的 rect 仍是根左上角。

### 5.2 脑图横向（冻结）

现有 `layoutMindTree` 逐字保留：

- 根层水平偏移 100、深层 48；根层兄弟间距 `max(50 − 上一子树下方空白, 38)`，深层 4；
- 左右两侧子树各自纵向堆叠、整体垂直居中于父中心；根层首/末子中点对齐根中点；
- bbox 取全树 min/max（含左树负向）。

**行为冻结要求**：Phase 0 重构前后，同一夹具的逐节点 positions/bbox 完全一致；现有单测不改断言。

### 5.3 脑图竖向（新增）

横向算法的**转置**，不是 org 布局：

| 横向                           | 竖向                           |
| ------------------------------ | ------------------------------ |
| 子树按**高度**纵向堆叠         | 子树按**宽度**横向堆叠         |
| 父在子组中**垂直**居中         | 父在子组中**水平**居中         |
| 根层垂直平衡（首/末子 y 中点） | 根层水平平衡（首/末子 x 中点） |
| 子节点在父左/右，水平偏移      | 子节点在父上/下，垂直偏移      |
| 连线水平出、垂直干             | 连线垂直出、水平干             |

- 逻辑侧不变：left=上、right=下；同一份 children 顺序在两侧内部按轴堆叠。
- 常量沿用：root 100 / node 48 / margin 50 / cross 38 / deep 4。
- 允许负 y（上侧展开）；bbox 处理同左树。
- 长文本换行、节点尺寸测量完全复用，不需要新测量逻辑。

伪代码（与横向一一对应）：

```
layoutVertical(root):
  positions[root] = (0,0)
  for side in [right(down), left(up)]:
    kids = children with effectiveSide == side
    layoutSideVertical(kids, isUp, root.w, root.h)
  bbox = union(根 + 两侧)
layoutSideVertical(kids, isUp, parentW, parentH, isRootSide):
  offset = isRootSide ? 100 : 48
  laid = kids.map(k => layoutVertical(k))
  cursorX = 0; for i>0: gap = isRootSide ? max(50 - lastRightBlank, 38) : 4
  totalW = Σ subtreeW + gaps
  startX = parentW/2 - totalW/2
  if isRootSide: 首/末子本体中心的中点对齐 parentW/2
  childY = isUp ? -offset - child.h : parentH + offset
```

### 5.4 组织架构上→下（新增）

**模型**：按层定 y、按子树宽度定 x、父在子跨度上居中。

```
// 1) 自底向上：子树宽度
subtreeW(leaf) = node.w
subtreeW(node) = max(node.w, Σ subtreeW(child) + GAP*(n-1))

// 2) 每层最大高度 → 层顶
maxH[d] = max(node.h for depth d)
levelTop[0] = 0
levelTop[d+1] = levelTop[d] + maxH[d] + LEVEL_GAP

// 3) 自顶向下：x 槽位
assign(node, x, depth):
  node.x = x; node.y = levelTop[depth]
  blockW = Σ subtreeW(child) + GAP*(n-1)
  cursor = node.x + node.w/2 - blockW/2
  for child:
    slotW = subtreeW(child)
    assign(child, cursor + (slotW - child.w)/2, depth+1)
    cursor += slotW + GAP
```

常量（初始值，视觉调试后可调）：

| 常量                | 值     | 含义                       |
| ------------------- | ------ | -------------------------- |
| `ORG_LEVEL_GAP`     | 56     | 上一层最大底边到下一层层顶 |
| `ORG_SIBLING_GAP`   | 24     | 相邻子树之间               |
| `ORG_CARD_MIN_W`    | 120    | 卡片最小宽                 |
| `ORG_CARD_MAX_W`    | 260    | 卡片最大宽（超出换行）     |
| `ORG_CARD_PAD_X/Y`  | 12 / 8 | 卡片内边距                 |
| `ORG_TITLE/SUB_GAP` | 2      | 标题与副标题间距           |

边界：

- 单子节点：父与子同 x 中线，连线竖直（无折弯）。
- 不同子树高度不同：下一层层顶取上一层**最大底边** + gap，保证同层严格对齐。
- 折叠节点无子参与布局；其徽标显示隐藏后代数（§8.4）。
- 根在 `(0,0)`，子块居中于根 → bbox 可能负 x；Vm 的 bbox 偏移与拖动预览沿用脑图语义。
- `left-right` 变体：同一算法转置 x/y（Phase 4）；接口已按 orientation 分派。

### 5.5 布局切换与重排

- 任何树变化（结构/文本/折叠/尺寸）→ 微任务合批 → 一次全量布局（沿用现有 `scheduleRelayout`）。
- orientation 变化走同一条重排路径；不产生节点写。
- 性能：O(n) 测量 + O(n) 布局；折叠徽标后代计数在 spec 构建时一次后序统计，
  禁止每个节点 O(子树) 重算。典型 <500 节点无性能债。

---

## 6. 连线

### 6.1 接口

连线策略输出**纯命令数组**（`moveTo/lineTo/arc/cubicTo`），Vm 只负责 `Graphics` 执行。
好处：根贝塞尔也能单测；预览与实物共用同一函数。

### 6.2 脑图横向（冻结）

- 根→一级：t 参数曲线起点 + 二次贝塞尔（`rootT/rootStartX/rootEnd`）。
- 普通：鱼骨折线 + 聚合线 24 + R8 圆弧。
- 线宽 4；分支色沿父链继承；兜底 `#22ab68`。

### 6.3 脑图竖向（镜像）

- 根起点在根上/下边，t 参数按**水平距离**计算；控制点纵向 20%。
- 普通节点：垂直出（聚合线 24）→ 水平干 → R8 圆弧 → 子节点上/下边中点。
- 单子节点同轴：直接竖直/水平直线（沿用横向的 delta 判据）。

### 6.4 组织架构（正交总线）

```
父底中心 (px, pb)
  → 竖线到 midY = pb + (ct - pb)/2
  → 水平母线到子 x
  → 竖线到子顶中心 (cx, ct)
```

- 拐角 R8 圆角（命令生成器 `orthogonalPath(points, r)`，纯函数）。
- 同 x（单子/居中）：一条竖线，无水平段。
- 线宽 2；颜色 `ORG_LINE = '#64748b'`（白底 4.8:1、深底 ~3.5:1，见 §7.4 对比度）。
- 折叠子树不画；徽标盖住父底中点（节点层在 drawer 之上）。

### 6.5 预览

拖拽预览与实物同源：

- 脑图：40×16 预置块 + 预连线（根贝塞尔 / 鱼骨）。
- 组织架构：预置块 = 被拖卡片尺寸（clamp 到 min/max），预连线用 org 正交路径。
- 预览绝对定位在 `optionLayer`；不写 Yjs；松手按最后一帧命中落库。

---

## 7. 节点呈现

### 7.1 策略接口

```ts
interface ITreeStyle {
  presentation(node: { text: string; subtitle?: string }, depth: number): ITreeNodePresentation;
}
interface ITreeNodePresentation {
  title: { text; fontSize; fontWeight; fill; wrapWidth };
  subtitle?: { text; fontSize; fontWeight; fill; wrapWidth };
  padding: { x; y };
  gap;
  radius;
  fill;
  stroke;
  strokeWidth;
  minWidth;
  maxWidth;
  badge?: { fill; text; radius }; // 折叠徽标
}
```

Vm 按 presentation 设置 PIXI `Text`，测量宽高后绘制圆角底/描边。测量与渲染同源，
禁止在布局里另算字号/内边距。

### 7.2 脑图（冻结）

- 根 28px 深底白字；一级 18px；其余 14px；maxWidth 360；一级分支色描边。
- 选中视觉仍走 SelectionVm 框（节点不自画焦点描边）。
- 新增折叠徽标：见 §8.4。

### 7.3 组织架构卡片

| 项     | 值                                                  |
| ------ | --------------------------------------------------- |
| 标题   | 14px / 600 / `#1f2937`                              |
| 副标题 | 12px / 400 / `#4b5563`（Phase 4：渲染 + 编辑）      |
| 卡片   | 白底 `#ffffff`、描边 `#cbd5e1` 1px、R6、内边距 12×8 |
| 根卡片 | 同款，描边 2px（视觉锚点，不放大字号）              |
| 宽     | `clamp(测量宽, 120, 260)`；标题/副标题各自换行      |
| 高     | `padY*2 + 标题高 + (副标题 ? gap+副标题高 : 0)`     |
| 连线   | `#64748b` 2px                                       |

- 不做“同层等宽”：名字长短差异大时等宽会留白或截断；用 clamp + 父居中保持秩序。
- 深浅主题都用白卡：画布深色下白卡可读；描边/连线对比度按 §7.4 护栏。
- 卡片不随主题切换反色（与现有脑图固定色板一致；后续若做主题化，改 style 单源）。

### 7.4 对比度与可访问性

- 标题 vs 白底 ≥ 12:1；副标题 ≥ 7:1；连线 vs 浅色画布 ≥ 4.5:1、vs 深色 ≥ 3:1。
- 新增单测 `orgStyleContrast.test`（同 `shapeContrast` 模式）：配对断言，改色即红。
- 折叠徽标 24px 直径（100% 缩放下达 2.5.8 的 24px 目标）；更小缩放下仍可用
  ActionBar/快捷键展开（记录为画布控件的固有限制）。
- 画布内容仍不在 DOM（与现有脑图节点一致）；屏幕阅读器内容层是 docs/13 §3 挂账，不在本批。

---

## 8. 交互

### 8.1 焦点与导航

| 场景     | 脑图横向                        | 脑图竖向               | 组织架构                   |
| -------- | ------------------------------- | ---------------------- | -------------------------- |
| ↑        | 同侧前兄弟（到边界上溯叔）      | 左侧=子、右侧=父       | 父节点                     |
| ↓        | 同侧后兄弟                      | 左侧=父、右侧=子       | 最近的子（无子/折叠=不动） |
| ←        | 左树=子、右树=父；根=左侧最近子 | 前兄弟（到边界上溯叔） | 前兄弟                     |
| →        | 右树=子、左树=父；根=右侧最近子 | 后兄弟                 | 后兄弟                     |
| 根 ↑/↓   | —                               | 上侧/下侧最近子        | ↓ 最近子                   |
| 删除焦点 | 同侧后→前→父；根侧删空回根      | 同侧后→前→父           | 后→前→父；边界不跨叔       |

- 脑图竖向是横向的**镜像**：逻辑侧 same，物理键映射换轴。
- org 的兄弟导航**不跨叔节点**（与脑图不同；组织架构的层级语义更强，跨叔跳转会迷路）。
- 焦点安全区跟随沿用（左/右/上 10、下 96）。
- 折叠节点视为叶子：↓/→ 不进入隐藏子树。
- 焦点在隐藏后代（undo/远端折叠）→ 自愈到最近的可见祖先。

### 8.2 键盘与编辑

| 键          | 行为                                                               |
| ----------- | ------------------------------------------------------------------ |
| Tab         | 建子并聚焦（折叠节点自动展开）；根层按逻辑侧规则取侧（仅 mind）    |
| Enter       | 建同级（根上退化为建子）；org 插到当前节点之后                     |
| Shift+Enter | 编辑态换行（textarea 默认）                                        |
| Delete      | 删节点（删根=删整图）；焦点按 §8.1                                 |
| 方向键      | 树焦点下由树消费，不落回 1px 微移                                  |
| Cmd/Ctrl+.  | 折叠/展开焦点节点（新增；实施时验证 hotkeys-js 对 `.` 的键名支持） |
| 任意单字符  | 选中态键入=进编辑并替换（沿用）                                    |

- 编辑走统一编辑会话 plain 内核；样式由 `kind.style` 生成（org 卡片图标/内边距）。
- org MVP 只内联编辑标题；副标题 Phase 4 与渲染/编辑一起启用（ActionBar/卡片编辑器再定）。
- 编辑态 Tab 建子、Cmd/Ctrl+± 缩放等行为沿用。

### 8.3 拖拽与落点

公共外壳（两种树共享）：

- 10 屏幕 px 判拖；本体半透明 + `generateTexture` 拖影；会话级落点缓存；
- 源图优先；跨图/跨种类搬移；空白处拖出成新图（源 kind）；
- 松手：moved / new-map / click 三分支；落库用最后一帧 target；
- 全程遵守 docs/14 六条同步规则。

落点策略：

**脑图横向（冻结）**：现有 DropArea 三层热区（本体+上下 80/朝子侧 120、父区全高带、
子节点零宽竖条）；根左右半区；距离最小者胜。

**脑图竖向（镜像）**：轴换成 x——本体+左右 80/朝子侧 120；父区全宽带；子节点零高横条；
根上下半区。同一套几何函数按 axis 参数化，避免复制两份。

**组织架构（新）**：

```
节点本体分三带：
  左 25% → 插入到该节点之前（asSibling index = 该节点下标）
  右 25% → 插入到该节点之后（index = 下标 + 1）
  中间 50% → asChild（追加到子列表末尾）
根节点：
  左/右 25% → 子列表首/尾；中间 → asChild
父节点子行：
  子节点之间的水平缝隙 → 插入该下标（零宽条命中）
  父卡片下方 24px 内的空带 → asChild（追加）
```

- 命中优先级：节点本体三带 > 子节点之间的缝隙 > 父卡片下方空带 > 空白（拖出成新图）。
  同一优先级内取距离最近者（与脑图 DropArea 的 distance 口径一致）。
- 折叠节点作为 `asChild` 目标：落下后同一事务展开，新节点可见。
- 拖起子树（自身+后代）不作为任何目标；隐藏子树不参与命中。
- 预览块尺寸 = 被拖卡片测量尺寸；预连线用 org 正交路径；落点后布局重排以最终结果为准。
- 跨种类：mind→org 剥离 direction/lineColor；org→mind 按落点侧写 direction、根层分配分支色。
- 拖出成新图：源 kind；新图 orientation 取该 kind 的默认（mind 横向 / org 上→下），
  之后由该图的 ActionBar 切换。

### 8.4 折叠（共享）

**数据与可见性**

- `collapsed: true` 的节点保留；其全部后代不可见（不出现在布局、连线、命中、导航、框选、AddButtons）。
- Vm 仍为所有节点持有 Vm（增量同步简单），隐藏节点 `visible/renderable=false`；
  内存 O(n)，后续若树很大再做“隐藏子树销毁 Vm”的优化。
- 隐藏后代数量在 spec 构建时后序统计：`hiddenCount = Σ(1 + child.hiddenCount)`。

**视觉**

- 仅**折叠节点**显示徽标：直径 24，深色底白字（`+N` 或 chevron）。
  - 脑图：非根节点取“朝子侧”的边中点——横向 left 树取左边、right 树取右边；
    竖向 left(上)取上边、right(下)取下边。根节点取右下角（横竖通用，避开两侧分支）。
  - org：卡片底边中点（盖住父底连线起点）。
- 展开态不显示常驻徽标（避免每个节点挂饰物）；折叠入口靠 ActionBar/快捷键。
- 选中框仍框节点本体（不含徽标）。

**交互**

- ActionBar toggle：`treeCollapsed`（有子节点时出现；值=collapsed）。
- 快捷键 Cmd/Ctrl+. 对焦点节点切换。
- 点击折叠徽标 = 展开。selector 在按下树节点、启动拖拽会话**之前**先问
  `treeDragDelegate.hitToggle(mapId, world)`：命中徽标则照常建立该图选中/节点焦点，
  执行 toggle 并消费本次按下（**不建拖拽会话**）；未命中才走 `startDrag`。
  只读态 `hitToggle` 返回 false（指针分发已整条丢弃）。
- 折叠后若焦点在隐藏后代 → 焦点移到折叠节点；正在编辑则先退出编辑。
- 折叠节点上 Tab/拖入子 → 自动展开（同一事务，一步撤销）。

**与其它系统**

- 导出 PNG：按当前可见布局；项目文件：折叠状态随文档；多标签：随文档同步。
- 只读：折叠命令/徽标全部禁用（文档写）。只读追随者看到写者折叠后的布局。
- 撤销：一次切换一步；撤销后布局/焦点自愈。
- 连线锚定整图：bbox 变化触发 reattach（沿用现有 state diff 机制）。

### 8.5 AddButtons（+ / 同级）

- 从 `MindAddButtons` 泛化为 `TreeAddButtons`；按钮 28px、间距 8、容器边距 4（沿用）。
- 槽位按 kind/orientation 生成：

| kind/orientation | 建子槽                        | 同级槽               |
| ---------------- | ----------------------------- | -------------------- |
| mind horizontal  | 左/右（根双侧；非根只在本侧） | 下                   |
| mind vertical    | 上/下                         | 右（同级按水平顺序） |
| org              | 下                            | 右                   |

- 槽位坐标由 core 的 `getTreeAddButtons` 返回（屏幕坐标 + logical side），react 只渲染/钳制。
- 旧 `getMindAddButtons` 保留：mind horizontal 映射旧形状；其它情况返回 null（宿主若仍用旧查询，
  竖向/org 不出按钮；新宿主用新查询）。包内 react 全量迁移到新查询。

### 8.6 只读与降级

- 工具：只读时树形图工具禁用（与其它写工具一致）。
- 节点焦点/选区：只读态指针分发整条丢弃、右键不建选区、降级清选区（docs/21 §4）；
  树焦点/选区随之不存在，折叠/编辑/拖拽/建子全禁。
- 折叠/编辑/拖拽/建子：命令层自守 + 呈现层禁用。
- 只读追随者看到写者的折叠/布局；自己不产生写。

### 8.7 移动端

- 工具坞仍是 8 个按钮（树形图一个入口），390 下坞内横滚现状不变；树形图按钮 40×40，
  二级菜单 portal + 视口 clamp（现有 ToolFlyout）。
- AddButtons 两轴钳制（`treeAddLayout.ts` 纯函数）。
- 折叠徽标 24px；更小缩放下用 ActionBar/快捷键。
- 触控目标 ≥24；拖拽判拖 10px 沿用。

---

## 9. 控件注册与跨引擎改动

### 9.1 新增 `ORG_CHART` 的注册清单

| 位置                                                                      | 改动                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `types/widget.ts`                                                         | `OrgChartSchema`；`WIDGET_REGISTRY.ORG_CHART`（family tree、capabilities）；`WidgetDataUnion` 由注册表派生（保持 compile lock） |
| `types/base.ts`                                                           | `IWidgetCapabilities` 不变；family 不进能力位                                                                                   |
| `widgetRuntime.ts`                                                        | `ORG_CHART` 的 model/vm token 与工厂                                                                                            |
| `widgets/tree/kinds/org.ts`                                               | kind 配置与策略工厂                                                                                                             |
| `TREE_KINDS`                                                              | 注册 org                                                                                                                        |
| `CursorMode`                                                              | 加 `'org'`                                                                                                                      |
| `shortcuts.ts` / `keyboardService.ts`                                     | `tool.mind`（M）与 `tool.org`（O）直达；树折叠键；Tab/Enter/方向键路由不变                                                      |
| `Toolbar.tsx`                                                             | 一个「树形图」入口（动态标题/aria）+ 类型二级菜单；动态组需 ToolDef 扩展                                                        |
| `ToolGhost.tsx`                                                           | 按当前 kind 出幽灵（mind/org）                                                                                                  |
| `Icon.tsx`                                                                | `tree`（ListTree）/`orgchart`（Network）/折叠 icon                                                                              |
| `boardActionBar.ts`                                                       | org case（折叠；orientation 仅当多档）                                                                                          |
| `styleCommands.ts`                                                        | `treeCollapsed`/`treeOrientation` 分流；lineColor 走 tree kind 判定                                                             |
| `boardAssemblyInteraction.ts`                                             | `onActivate` 的 MIND_MAP 判定改 family；线锚定整图注释同步                                                                      |
| `boardQueries.ts`                                                         | 树查询泛化；新 `getTreeAddButtons`                                                                                              |
| `debugSnapshot.ts`                                                        | 节点带 kind/collapsed/visible；焦点带 kind/orientation                                                                          |
| `boardPublicApi.ts`                                                       | 新公开成员分类；`treeService` 内部成员                                                                                          |
| `index.ts`                                                                | 新类型/常量导出；旧 mind 导出原样；`TREE_KIND_OPTIONS`/`TREE_ORIENTATION_OPTIONS`                                               |
| `app.ts` / `boardHost.ts` / `boardStreams.ts` / `boardFacade.ts`          | `treeService` 字段、流 getter、新命令委托                                                                                       |
| `boardAssemblyTools.ts` / `boardTeardown.ts`                              | 注册 mind+org 指针模式；dispose 序列                                                                                            |
| react `Toolbar/ToolGhost/Icon/MindAddButtons/bridge/spinthStore/commands` | 树形图入口、动态 flyout、kind 幽灵、树槽位、新命令                                                                              |
| docs                                                                      | 11/22/04/12/15/13/README                                                                                                        |

`ORG_CHART` 的 capabilities 与 `MIND_MAP` 相同：`rotatable/groupable/resizable/editable/
referenceable/erasable=false`，`movable/selectable=true`；节点级选中仍走焦点体系。

> `TREE_KIND_OPTIONS`（脑图/组织架构）放 core（与 `SHAPE_TYPE_OPTIONS` 同层），只给
> Toolbar 类型菜单；`TREE_ORIENTATION_OPTIONS`（左右/上下）只给 ActionBar——排列是图属性，
> 不进工具菜单，也不做会话默认。
> 工具入口的 kind 记忆不新增 core 公共命令：由 `cursorMode$` 镜像到 store `treeKind`，
> 按钮点击 `setCursorMode(treeKind)`；M/O 直达仍走既有 `setCursorMode`，无需 TreeService 新状态。

### 9.2 family 字段与引擎泛化

`WIDGET_REGISTRY` 每项加 `family: 'widget' | 'tree'`：

```ts
export const WIDGET_REGISTRY = {
  SHAPE: { family: 'widget', schema: ShapeSchema, capabilities: {...} },
  // ...
  MIND_MAP: { family: 'tree', schema: MindMapSchema, capabilities: {...} },
  ORG_CHART: { family: 'tree', schema: OrgChartSchema, capabilities: {...} },
} as const;
```

- 派生 `TreeWidgetType`（编译期）与 `isTreeWidgetType(type)`（运行时）。
- `vmEngine`：`mindVmIds` 改名 `treeVmIds`，加入条件改 `isTreeWidgetType`；
  查询候选/索引豁免不变。
- `cullingService`：`if (isTreeWidgetType(vm.type)) continue`。
- `selectorService` / `selectorMarquee`：树判定改 family；拖拽委托改 `treeDragDelegate`。
- `rectEditor` / `projection` / `spatial`：无逻辑改动（projection 的 `root` 丢弃本就通用）。
- `CanvasToken`/主题：无。

> 这是本方案唯一允许改 `vmEngine/culling/selector` 的地方：把硬编码类型改成 family 判定。
> 不是“为新控件加分支”，而是把已有树特例泛化；改完七类控件行为不变。

### 9.3 禁止项

- 禁止在骨架里写 `if (vm.type === 'ORG_CHART')`；种类差异只进 `TREE_KINDS`。
- 禁止在 layout/connector/nav/drop 里 import PIXI/Yjs/服务。
- 禁止为 org 复制一套 `TreeMapVm`/`TreeService`。
- 禁止改 `dataEngine` 的写入/分发逻辑（树节点不是 widget，继续走 Model 直写）。
- 禁止把 `collapsed` 放 localStorage/会话态（会破坏导出/多标签一致性）。

---

## 10. UI 入口

### 10.1 工具坞、快捷键、幽灵

- 工具坞只有一个「树形图」入口：图标 `tree`，主题色 `mind`；按钮标题/aria
  随当前 kind 显示「树形图 · 脑图 (M)」/「树形图 · 组织架构 (O)」，不再有独立 org 按钮。
- 激活即显示常驻二级菜单（ToolFlyout）：只有**类型组**——脑图 / 组织架构
  （`TREE_KIND_OPTIONS`，图标 mindmap/orgchart，当前项点亮）。
- 切类型 = `setCursorMode('mind'|'org')`，工具保持激活，幽灵/画布创建随 kind 切换；
  菜单里不出现排列/其他图属性。
- **排列是图属性，不进工具菜单**：新图默认横向（org 上→下），选中图后在 ActionBar
  的 `treeOrientation` 切换；`TREE_ORIENTATION_OPTIONS` 只给 ActionBar，不做会话默认。
- **会话记忆**：`treeKind` 初始 `mind`，随 cursorMode 更新；工具一次性创建后回 cursor，
  下次点树形图按钮回到上次 kind。M = 脑图直达、O = 组织架构直达；M/O 都更新记忆。
  按钮标题的快捷键提示随 kind 显示 `(M)` / `(O)`，与直达键一致。
  若希望“每次激活都回脑图”，改激活逻辑一处即可（默认不做）。
- 工具定义扩展（react）：`ToolDef` 支持稳定 `id`（key）、`modes?: CursorMode[]`（active 判定）、
  `activate?: () => void`（点击入口）、`buildSubMenuGroups?: () => ToolSubMenuGroup[]`（动态组）、
  标题/aria 由当前 kind 计算；其余七个工具的静态配置不变。
- ToolGhost：按当前 kind 显示（mindmap/orgchart 图标）；悬停任意树图时抑制
  （`ghostSuppressed` 泛化）。
- 390px：仍 8 个按钮，坞内横滚现状不变；flyout 沿用 portal + 视口 clamp。

### 10.2 ActionBar

单棵树选中时（根焦点=整图）：

| 场景                | 项                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------ |
| mind 根 / mind 节点 | `lineColor`（仅节点焦点）、`treeCollapsed`（有子时）、`treeOrientation`（左右/上下） |
| org 根 / org 节点   | `treeCollapsed`（有子时）；orientation 仅当 kind 支持多档（MVP 隐藏）                |
| 其它类型            | 不变                                                                                 |

- `treeOrientation` 是图属性（模型字段），不进工具偏好、不做会话默认；切换只影响当前图，
  一步撤销。
- `getFocusedState` 扩为内部通用快照：`{ kind, orientation, side, nodeId, isRoot,
worldRect, collapsed, hasChildren }`；槽位只在 `getTreeAddButtons` 里按 kind/orientation
  计算；旧 `getMindAddButtons` 只取所需子集。
- item id 用 `treeCollapsed` / `treeOrientation`；react 现有 toggle/popover 直接工作。
- `updateSelectedStyle` 前置分流：`treeCollapsed` → `treeService.setCollapsedFocused(bool)`；
  `treeOrientation` → `treeService.setOrientation(selectedMapId, value)`；不进通用 widget update。
- 只读态整条不渲染（现有门禁）。
- 方向/聚焦变化后 schema 重算：沿用 bridge 的 `mindFocusChanged$` 失效链路（改名 tree 亦可）。

### 10.3 AddButtons

- `TreeAddButtons` 组件替换 `MindAddButtons`；store 字段 `treeAddButtons`。
- 槽位纯函数 `treeAddLayout.ts`：输入 bounds、kind、orientation、isRoot、side、容器尺寸，
  输出带 `{ key, side?, left, top }`；两轴 clamp。
- 命令：建子 `mindAddChild(side?)`（逻辑侧）、同级 `mindAddSibling()`；公开名称不变。
- 折叠节点上建子：服务自动展开（§8.4）。

### 10.4 文案与图标

- 工具入口：树形图；标题/aria 随当前 kind 为「树形图 · 脑图 (M)」/
  「树形图 · 组织架构 (O)」；M = 脑图、O = 组织架构直达。
- ActionBar：折叠子树 / 展开子树；排列方向：左右 / 上下。
- 图标：`tree`（ListTree）、`mindmap`（Waypoints）、`orgchart`（Network）、
  `collapse`（ChevronsDownUp）、`expand`（ChevronsUpDown）。
- 默认根文案：mind「中心主题」；org「负责人」。默认子文案：mind「子节点 N」；org「成员 N」。

---

## 11. 公开 API 与兼容

### 11.1 BoardSDK 增量

新增（进 allowlist + 分类锁 + 测试）：

| 成员                 | 签名                                 | 说明                                |
| -------------------- | ------------------------------------ | ----------------------------------- |
| `getTreeAddButtons`  | `() => ITreeAddButtonsState \| null` | 新查询；旧 `getMindAddButtons` 保留 |
| `toggleTreeCollapse` | `() => void`                         | 焦点节点折叠/展开；只读 no-op       |
| `setTreeOrientation` | `(o: TreeOrientation) => void`       | 选中树图的 orientation              |

保持不变：

- `mindAddChild(direction?: 'left'|'right')`：逻辑侧，签名不变；
- `mindAddSibling/mindDeleteFocused`；
- `mindGhostSuppressed$` / `mindFocusChanged$`：语义扩展到所有 tree kind，名称保留；
- `getMindAddButtons`：mind horizontal 返回旧形状；其它返回 null（兼容壳）。

内部字段 `mindService` 改名 `treeService`（进 `BoardInternalMember`；不是公开面）。

### 11.2 包入口导出冻结

| 现导出                                                       | 迁移后                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `layoutMindTree`                                             | 从 `widgets/tree/layout/mindHorizontal` re-export，签名不变         |
| `ILayoutNode/ILayoutResult`                                  | 从 layout/types re-export，字段不变（org 结果多 optional `levels`） |
| `IMindNodeSpec`                                              | 别名 `ITreeNodeSpec`（新增 subtitle/collapsed optional）            |
| `BRANCH_COLORS/branchColorAt`                                | 从 kind/mind re-export                                              |
| `MIND_ROOT_STYLE/MIND_NODE_STYLE/MIND_COLORS/NODE_MAX_WIDTH` | 从 kind/mind/style re-export                                        |
| `IMindAddButtonsState`                                       | 保留；新增 `ITreeAddButtonsState`                                   |
| `IMindDragDelegate`                                          | 别名 `ITreeDragDelegate`（新增可选方法）                            |
| `CursorMode`                                                 | 加 `'org'`（拓宽，非破坏）                                          |
| `MindMapSchema/MindMapData`                                  | 保留；新增 `OrgChartSchema/OrgChartData`                            |

新增导出：`TreeOrientation/TreeSide/ITreeNodeSpec/ITreeAddButtonsState/OrgChartSchema/OrgChartData/
TREE_KIND_OPTIONS/TREE_ORIENTATION_OPTIONS`。

> 工具入口是 UI 层的组合，不引入 `'tree'` CursorMode：底层仍是 `'mind'/'org'`，
> `setCursorMode('mind'|'org')` 语义不变；树形图入口只在 react 层把两者合成一个按钮。

- 加一个 `publicExports.test.ts`：断言旧符号仍可 import/调用，防重构误删。
- 新增 `ORG_CHART` 会让 `IWidgetData` union 多一个成员：宿主若对 widget 类型做穷举
  `switch`，会在编译期出现“未处理新类型”的提示——这是新类型的预期影响，不是破坏性
  删除；不删旧成员、不改旧语义。
- 1.x 只增不删；重命名一律留别名到主版本。

### 11.3 查询契约

```ts
interface ITreeAddButtonsState {
  kind: TreeWidgetType;
  orientation: TreeOrientation;
  isRoot: boolean;
  bounds: IRect; // 屏幕坐标（canvas 局部）
  slots: Array<{
    key: 'child' | 'sibling';
    side?: TreeSide; // child 槽的逻辑侧（org 无；同 key 靠 side 区分）
    left: number;
    top: number; // 屏幕坐标
  }>;
}
```

- 只读/拖拽中/非 cursor 模式/无焦点 → null（沿用旧查询四个早退）。
- `getMindAddButtons` 映射：仅当 kind=mind 且 orientation=horizontal；否则 null。

### 11.4 版本策略

- `1.x`：新增 type、字段 optional、公开成员增量；不删/不改旧语义。
- 旧客户端打开新文档：orientation/collapsed 忽略（布局降级）；ORG_CHART 类型未知时按现有
  数据引擎的未知类型策略处理（本地单机无协同，风险可接受；项目文件由新客户端打开）。
- 主版本才考虑 mind↔org 转换或重命名 `mind*` 命令。

---

## 12. 文件改造地图

### 12.1 目标目录

```
packages/core/src/widgets/tree/
  registry.ts                    TREE_KINDS + 类型锁
  kinds/mind.ts                  mind kind 配置
  kinds/org.ts                   org kind 配置
  kinds/mind/style.ts            MIND_* 常量（公开 re-export 源）
  kinds/mind/colors.ts           BRANCH_COLORS/branchColorAt
  model/treeMapModel.ts          图 Model 基类
  model/treeNodeModel.ts         节点 Model
  model/treeSpec.ts              JSON↔Y、kind 字段投影、findNode/navTree
  vm/treeMapVm.ts                图 Vm 基类（同步/测量/调度/命中/几何）
  vm/treeNodeVm.ts               节点 Vm 基类
  vm/treeDrawer.ts               连线绘制（策略命令 → Graphics）
  layout/types.ts                ILayoutNode/Result 接口（公开别名源）
  layout/mindHorizontal.ts       现有算法（冻结）
  layout/mindVertical.ts         新增（镜像）
  layout/org.ts                  新增（层对齐）
  connector/types.ts             ConnectorCmd/ITreeConnector
  connector/mind.ts              贝塞尔 + 鱼骨（横/竖）
  connector/org.ts               正交总线
  connector/orthogonal.ts        圆角折线纯函数
  nav/types.ts                   ITreeNav/INavNode
  nav/mind.ts                    横向现有 + 竖向镜像
  nav/org.ts                     父/子/兄弟
  drop/types.ts                  ITreeDropTarget/策略
  drop/dropArea.ts               轴参数化三层热区
  drop/mind.ts                   横向/竖向
  drop/org.ts                    三带 + 子行缝隙
  drop/preview.ts                预置块 + 预连线
  drag/treeDragController.ts     公共拖拽外壳
  focus/treeFocusController.ts   焦点域
  edit/treeNodeEditor.ts         编辑会话
  ops/treeOps.ts                 树写/折叠/orientation
  tool/treeToolController.ts     建图/幽灵
  service/treeService.ts         交互层
```

### 12.2 现状 → 目标映射

| 现状                     | 目标                                          | 说明                              |
| ------------------------ | --------------------------------------------- | --------------------------------- |
| `mindNodeModel.ts`       | `model/treeNodeModel.ts`                      | 加 subtitle/collapsed；逻辑侧不变 |
| `mindMapModel.ts`        | `model/treeMapModel.ts` + `model/treeSpec.ts` | 分支色/搜索/navTree 拆出          |
| `mindMapVm.ts`           | `vm/treeMapVm.ts` + `vm/treeDrawer.ts`        | 布局/连线调用策略；拆分保 400     |
| `mindNodeVm.ts`          | `vm/treeNodeVm.ts` + kind style               | 节点测量/绘制基类                 |
| `mindLayout.ts`          | `layout/mindHorizontal.ts` + types            | 公开 `layoutMindTree` re-export   |
| `mindDrawerMath.ts`      | `connector/mind.ts` + orthogonal              | 横向冻结；根贝塞尔改出命令        |
| `dropArea.ts`            | `drop/dropArea.ts`                            | 轴参数化（x/y）                   |
| `mindDropHit.ts`         | `drop/mind.ts`                                | 横向/竖向共用                     |
| `mindDropPreview.ts`     | `drop/preview.ts`                             | 策略产出 block+cmds               |
| `mindDragController.ts`  | `drag/treeDragController.ts`                  | kind 策略 + 跨种类转换            |
| `mindFocusController.ts` | `focus/treeFocusController.ts`                | 导航策略                          |
| `mindNav.ts`             | `nav/mind.ts` + `nav/org.ts`                  | 横向现有；竖向镜像；org 新        |
| `mindNodeEditor.ts`      | `edit/treeNodeEditor.ts`                      | 样式由 kind 给                    |
| `mindTreeOps.ts`         | `ops/treeOps.ts`                              | 折叠/orientation/种类投影         |
| `mindToolController.ts`  | `tool/treeToolController.ts`                  | mode→kind                         |
| `mindService.ts`         | `service/treeService.ts`                      | 组合根；公开命名保留              |
| `mindAddLayout.ts`       | `treeAddLayout.ts`（react）                   | 两轴/kind 槽位                    |
| `MindAddButtons.tsx`     | `TreeAddButtons.tsx`                          | store 字段同步改名                |

### 12.3 行数与拆分预算

| 文件                           | 预算 | 说明                                    |
| ------------------------------ | ---- | --------------------------------------- |
| `treeMapVm.ts`                 | ≤320 | 同步/测量/调度/命中/几何；连线拆 drawer |
| `treeDragController.ts`        | ≤400 | 会话/拖影/三分支；落点拆 drop/*         |
| `treeFocusController.ts`       | ≤280 | 焦点/跟随/选区委托；导航拆 nav/*        |
| `treeService.ts`               | ≤400 | 组合与转发；不写算法                    |
| `treeOps.ts`                   | ≤300 | 写编排；折叠/orientation 独立函数       |
| `treeNodeVm.ts`                | ≤260 | 标题/副标题/徽标                        |
| 每个 layout/connector/nav/drop | ≤220 | 纯逻辑                                  |

> 拆分后实际：treeDrag 375 / treeService 383 / treeMapVm 300 / focus 271 / ops 255。
> 初版估算 300/340 对 service/drag 偏紧，实际未破 400 铁律；保持现有职责边界，
> 不再为凑估算拆散转发层。若实施中出现超 400，先拆文件再继续，不得用 eslint 豁免。

### 12.4 组合根、react、docs 改动地图

| 文件                                                                      | 改动                                                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `app.ts`                                                                  | `mindService` 字段改 `treeService`；新查询/命令委托；`boardHost`/`boardStreams` 同步                        |
| `types/index.ts`                                                          | 导出 `OrgChartSchema/OrgChartData/TreeOrientation/TreeSide/ITreeAddButtonsState`                            |
| `boardCommands.ts`                                                        | `removeSelected` 的节点分流改 tree；`toggleTreeCollapse/setTreeOrientation` 命令                            |
| `boardHost.ts` / `boardStreams.ts` / `boardFacade.ts`                     | 内部字段/流 getter/新命令（`toggleTreeCollapse`、`setTreeOrientation`）                                     |
| `boardAssemblyTools.ts`                                                   | `TreeService` 构造；`registerGlobalEventListener('mind'/'org')`；selector 委托                              |
| `boardTeardown.ts`                                                        | `treeService.dispose()`（编辑退出 → 拖拽取消 → 服务释放）                                                   |
| `boardDebug.ts`                                                           | 探针 deps 改名；`mindNodes/mindFocus` 字段保留并增补                                                        |
| `packages/react/src/store/bridge.ts`                                      | `treeAddButtons` 拉取；cursorMode→`treeKind` 记忆镜像；`mindFocusChanged$` 失效链路；`widgetsChanged$` 重算 |
| `packages/react/src/store/spinthStore.ts` / `commands.ts`                 | `treeAddButtons`/`treeKind` 字段；折叠/orientation 命令；树形图入口激活                                     |
| `packages/react/src/components/Toolbar.tsx`                               | 树形图单入口；动态标题/aria；类型组；`ToolDef` 扩 id/modes/activate/buildSubMenuGroups                      |
| `packages/react/src/components/ToolGhost.tsx`                             | 按当前 kind 出幽灵；树工具抑制通用化                                                                        |
| `packages/react/src/components/Icon.tsx`                                  | `tree` / `mindmap` / `orgchart` / `collapse` / `expand`                                                     |
| `packages/react/src/components/MindAddButtons.tsx` → `TreeAddButtons.tsx` | 通用槽位渲染；两轴 clamp                                                                                    |
| `packages/react/src/mindAddLayout.ts` → `treeAddLayout.ts`                | 纯函数槽位（§8.5）                                                                                          |
| `packages/react/src/components/ActionBar.tsx`                             | **不改渲染分支**：新项走现有 toggle/popover；只加命令分发（若需要）                                         |

docs：

| 文档                             | 改动                                                                |
| -------------------------------- | ------------------------------------------------------------------- |
| `docs/11-mindmap.md`             | 逻辑侧 + orientation；折叠；工具入口改树形图；文件路径；AddButtons  |
| `docs/22-tree-diagrams.md`（新） | 树形图族架构、kind 注册、org 布局/样式/交互、扩展指南               |
| `docs/04-widget-system.md`       | `family` 字段、注册表、能力表、ORG_CHART 清单                       |
| `docs/12-ui-layer.md`            | 树形图单入口、类型二级菜单、TreeAddButtons、ActionBar 排列项        |
| `docs/15-testing.md`             | 新 spec/单测/视觉基线/计数                                          |
| `docs/09-clipboard-shortcuts.md` | M=脑图、O=组织架构；折叠快捷键；树焦点键位表                        |
| `docs/21-multi-tab.md`           | 只读工具清单把 mind 改为「树形图（脑图/组织架构）」；折叠只读语义   |
| `docs/05-selection-drag.md`      | tree 的 rect 型默认实现/选区框沿用；无缩放/旋转                     |
| `docs/16-performance.md`         | culling/空间索引的 tree family 豁免；折叠隐藏节点                   |
| `docs/13-roadmap.md`             | 4.2 状态与完成标志                                                  |
| `docs/README.md`                 | 索引加 22                                                           |
| `AGENTS.md`                      | docs 索引加 22——**需人类确认**（仓库约定：改 AGENTS.md 需人类确认） |

---

## 13. 实施阶段

每个阶段独立提交、独立验收、可回退。阶段 0 不动行为；阶段 1 起才有用户可见变化。

### Phase 0 — 骨架抽取（无行为变化）

**范围**

1. `WIDGET_REGISTRY` 加 `family`；`isTreeWidgetType`；vmEngine/culling 改 family 判定。
2. `git mv widgets/mind → widgets/tree`；拆 Model/Vm/Service/Tool 基类与 kind 配置；
   仅注册 mind kind。
3. selector/keyboard/actionbar/queries/debug/service 字段改名（`treeService`）；
   公开名称与包导出全部保留。
4. 新增 `TREE_KINDS` 类型锁、publicExports 测试、布局冻结夹具。

**验收**

- `pnpm verify` 全绿；Phase 0 当时 1288 单测断言零改动（除 import 路径/字段名机械更新）。
- 现有 mind E2E 全绿；视觉基线零变化。
- 同一夹具横向布局 positions/bbox 与改造前逐值一致（golden）。
- 无新增用户可见文案/工具/按钮。

**风险**：机械迁移面积大。缓解：先 family/引擎（0a）→ 再移动+基类（0b）→ 再服务/查询改名（0c），
每步单独 verify。

### Phase 1 — 折叠（共享能力，先在 mind 落地）

**范围**：节点 `collapsed`；布局可见性；Vm 隐藏；命中/导航/框选/AddButtons 跳过；
ActionBar toggle；Cmd/Ctrl+.；折叠徽标 + 点击展开；自动展开（建子/拖入）；撤销/持久化/导出；
只读门禁；单测 + E2E + docs/11。

**验收**

- 折叠后：子树不渲染、bbox 收缩、ActionBar 跟随、T 导出无隐藏节点。
- 展开/折叠各一步撤销；刷新/重开/项目文件往返保持。
- 焦点在隐藏后代时自愈；折叠节点建子自动展开且仍一步撤销。
- 只读不产生折叠写；多标签追随者看到写者状态。
- 现有 mind E2E 全绿（未折叠路径零变化）。

### Phase 2 — 脑图竖向

**范围**：`orientation` 字段；`layout/mindVertical`；竖向连线；导航映射；落点镜像；
AddButtons 槽位；ActionBar 排列切换；单测 + E2E + 视觉；docs/11。

> 工具入口本阶段保持原「脑图」按钮；排列只走 ActionBar 的图属性，不存在工具默认值，
> Phase 3 收编入口时也不需要迁移排列偏好。

**验收**

- 新建竖向图：根居中、分支上下、同侧子树横向堆叠、父在子组中水平居中。
- 方向键：上侧 ↑子/↓父，下侧 ↓子/↑父；←→ 兄弟；根 ↑/↓ 取两侧最近子。
- 拖拽落点：上下侧正确插入；预览块位置/预连线与实物同向。
- 切换 orientation：一步撤销；节点数据零重写；旧文档仍按横向打开。
- 横向现有 E2E/视觉零变化。

### Phase 3 — 组织架构 `ORG_CHART`

**范围**：schema/类型/注册；org 布局/连线/卡片/导航/落点；**工具坞收编为单一「树形图」入口**
（类型二级菜单、kind 记忆、M/O 直达、kind 幽灵）；ActionBar 折叠/排列；AddButtons；
跨种类拖拽；E2E + 视觉 + 移动端 + 对比度；docs 全量按 §12.4
（至少 11/22/04/09/12/15/21/13/README）。

**验收**

- 3 层样本：同层节点 y 严格相等；父在子跨度中心；子树不重叠；单子竖直连线。
- Tab/Enter 建节点；拖拽重排/跨父/跨图；折叠/展开；只读；项目文件往返。
- 390px：仍是 8 个按钮；树形图入口可见，二级菜单可切到组织架构并建图；触控目标达标。
- 视觉基线：org 样本（双平台）；横向/竖向脑图基线不回归。
- `pnpm verify` + 全量 E2E 绿；无 debug 生产残留。

### Phase 4 — 可选增强（不阻塞 4.2 完成）

- org 副标题字段 + 渲染 + 编辑一起做（`subtitle` optional，零迁移）：ActionBar/卡片编辑器
  二选一，按真实使用反馈定；与 Phase 3 的标题-only 卡片相比，这是独立的一步。
- org `left-right` orientation。
- 折叠全部/展开全部；hover 折叠入口（展开态）。
- 部门容器（4.4 FRAME）替代手工层级表达。
- 文件树/放射脑图等新 kind。

---

## 14. 测试与验收

### 14.1 单测矩阵

| 域       | 用例                                                             |
| -------- | ---------------------------------------------------------------- |
| 注册表   | family 键集 ≡ TREE_KINDS；ORG_CHART schema/capabilities；编译锁  |
| 布局横向 | 现有用例全保留 + golden positions（冻结）                        |
| 布局竖向 | 与横向的转置性质（坐标互换）、根平衡、负 bbox、长文本、单子      |
| 布局 org | 层 y 相等、子树不重叠、父居中、单子竖直、变高卡片、折叠可见性    |
| 连线     | 横向冻结；竖向镜像；org 正交命令/圆角/单子；预览同源             |
| 导航     | 横向现有；竖向映射；org 父/子/兄弟/删除焦点/折叠叶子             |
| 落点     | 横向现有；竖向镜像；org 三带/缝隙/根/折叠自动展开/跨种类字段投影 |
| 折叠     | 可见集、隐藏计数、焦点自愈、一步撤销、自动展开、序列化           |
| 样式     | org 测量（标题换行/宽度）；副标题测量 Phase 4；对比度护栏        |
| 公开面   | 新成员分类锁；旧包导出仍可用；旧查询兼容壳                       |

### 14.2 E2E

| spec                                                                                       | 覆盖                                                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `treeTool.spec.ts`                                                                         | 单入口默认脑图、类型切换、kind 记忆、M/O 直达、幽灵、390            |
| `mindVertical.spec.ts`                                                                     | 竖向建图/连建/方向键/拖拽/切换 orientation/一步撤销/重载            |
| `treeCollapse.spec.ts`                                                                     | ActionBar 折叠、快捷键、徽标展开、bbox 收缩、导出、撤销、重载、只读 |
| `orgChart.spec.ts`                                                                         | 建图、2–3 层、同层 y 对齐、父居中、拖拽重排/跨父、折叠、项目往返    |
| `treeCrossKind.spec.ts`（可选）                                                            | mind 子树拖入 org（字段剥离）与反向（侧/色分配）                    |
| 现有 mind specs                                                                            | 横向全绿；工具入口改为树形图（动态 aria 含“脑图”时保留旧选择器），  |
| 建议统一走 helper `selectTreeTool(page,'mind')`，避免裸 `getByRole(/脑图/)` 的 strict 冲突 |

E2E 坐标从探针 worldRect 反推，禁手写屏幕数字；探针字段 `mindNodes` 保留并新增
`kind/collapsed/visible/depth/subtitle`。

### 14.3 视觉基线

- 新增：`mind-horizontal`（现有脑图无基线，本批补）、`mind-vertical`、`org-sample`。
- org 样本：CEO → 3 部门 → 2 组；含一个折叠分支；清选区/关 ActionBar 后截画布区。
- 双平台（darwin/linux）+ `--stability` 双跑；沿用 specs/linux-visual 仪式。
- 现有 6 张基线不动（flowchart/theme/rotate/marks/delay）。

### 14.4 非功能

- **性能**：500 节点 org 布局 <16ms 目标（单测基准可选）；折叠切换不重建全树 Vm。
- **只读**：折叠/编辑/拖拽全禁；追随者布局同步。
- **多标签**：写者折叠 → follower 可见；接管/刷新不丢。
- **a11y**：工具按钮名/40×40/主题色对比；ActionBar toggle aria-pressed；AddButtons aria-label；
  折叠徽标 24px；画布内容朗读仍挂账。
- **移动端**：390 树形图入口 + 二级菜单切 org 建图、AddButtons 钳制、8 键横滚现状不变。
- **无调试残留**：新探针字段只经 dev 入口；生产构建零标记。

### 14.5 手工验收（写入 specs，不进 docs）——待人工执行

> 自动化已覆盖：T-1..T-6（treeCollapse）、V-1..V-3（mindVertical）、
> TT-1..TT-5（treeTool）、OC-1..OC-4（orgChart）；org-sample 基线含折叠分支。
> 以下六项需人工目视/真机确认：

1. 脑图左右 → 上下切换：分支上下分布、方向键符合表、撤销一步回左右。
2. 折叠 3 层子树：布局收缩、导出无隐藏节点、刷新保持、撤销恢复。
3. org：3 层 + 折叠 + 拖拽换父 + 跨图拖拽 + 导出 PNG + 项目往返。
4. 390 触摸：树形图入口 → 二级菜单切组织架构 → 建图、Tab 加节点、折叠徽标点击。
5. 只读双标签：写者折叠，follower 看到且不能改。
6. 深色主题：org 卡片/连线对比度目视正常。

---

## 15. 风险与缓解

| 风险                     | 影响 | 缓解                                                               |
| ------------------------ | ---- | ------------------------------------------------------------------ |
| 骨架抽取回归脑图         | 高   | Phase 0 零行为；golden positions；全量 mind E2E；机械迁移分三步    |
| 400 行超限               | 中   | §12.3 预算；先拆后加；禁止豁免                                     |
| 策略过度抽象             | 中   | 只抽五类策略；不造事件总线/插件生命周期；kind 配置保持声明式       |
| 折叠撤销噪音             | 低   | 一次切换一步；文档说明                                             |
| 跨种类字段污染           | 中   | 写边界投影（§4.3）；单测覆盖双向                                   |
| 公开导出误删             | 高   | publicExports 测试 + 别名保留 + 审查清单                           |
| E2E 探针改名破测试       | 中   | `mindNodes/mindFocus` 名称保留，只加字段                           |
| 树形图入口迁移破 E2E     | 中   | 动态 aria 含当前 kind；统一 helper；新 `treeTool.spec` 锁切换/记忆 |
| 类型切换后 flyout 状态   | 低   | 单组两组选项，切 kind 只改 current；补 current/焦点不丢用例        |
| org 布局“能用但不精致”   | 中   | 纯函数 + 视觉基线 + 常量可调；不承诺自动紧凑                       |
| 折叠只读不可操作         | 低   | 明确为文档写；follower 跟随写者                                    |
| orientation 旧客户端降级 | 低   | 逻辑侧不重写；旧客户端按横向渲染                                   |

### 15.1 待拍板（已给默认，实施按默认走；如需改在开工前说）

1. org MVP 卡片：标题必填；副标题（渲染+编辑）Phase 4 一起做——默认。
2. 折叠入口：ActionBar + Cmd/Ctrl+. + 折叠徽标点击——默认；展开态不做 hover 常驻钮。
3. 跨种类拖拽：允许，字段按目标 kind 投影——默认。
4. 工具入口：**单一「树形图」按钮 + 二级菜单切类型**；初始脑图、会话记住上次 kind；
   M = 脑图、O = 组织架构直达——默认。
5. 只读折叠：禁用（文档写）——默认。
6. 默认文案：org 根「负责人」、子「成员 N」——默认。
7. 公开新增：`getTreeAddButtons/toggleTreeCollapse/setTreeOrientation`——默认。
8. 排列：图属性（默认 mind=横向、org=上→下）；只在 ActionBar 切，不进工具菜单——默认。

---

## 16. 审查清单（实施后逐条核对）

### 架构

- [ ] 骨架无 `if type/kind === ...` 分支；种类差异只在 `TREE_KINDS` 与策略文件。
- [ ] `family: 'tree'` 是引擎唯一判据；vmEngine/culling/selector 无新硬编码类型。
- [ ] layout/connector/nav/drop 纯逻辑，无 PIXI/Yjs/服务 import。
- [ ] 没有为 org 复制 `TreeMapVm/TreeService/TreeOps`。
- [ ] 每个文件 ≤400 行；拆分与 §12.3 一致。

### 数据与兼容

- [ ] 新字段全部 optional；旧文档不重建/不补写。
- [ ] `direction` 仍是 left/right；orientation 切换不写节点。
- [ ] 折叠一次切换一步撤销；自动展开不拆成两步。
- [ ] 跨种类写边界按目标 kind 投影，无 direction/lineColor 污染。
- [ ] 包入口旧导出全部仍可用；BoardSDK 旧成员语义不变。

### 交互

- [ ] 三种布局的导航/落点与 §8 表一致。
- [ ] 拖拽预览绝对定位；松手用最后一帧命中；交互期零 Yjs 写。
- [ ] 折叠节点：布局/连线/命中/导航/框选/AddButtons 全部排除隐藏后代。
- [ ] 焦点隐藏自愈；删节点焦点规则正确。
- [ ] 只读：折叠/编辑/拖拽/建子全禁；追随者布局同步。

### UI

- [ ] 树形图单入口 40×40；标题/aria 含当前 kind；M=脑图、O=组织架构；无第 9 个按钮。
- [ ] 二级菜单只有类型组（脑图/组织架构）；切类型保持激活；排列只在 ActionBar。
- [ ] 会话 kind 记忆：初始脑图；创建回 cursor 后再激活仍回上次 kind。
- [ ] 390：8 键横滚现状不变；flyout 可切 org 并建图；无 strict-mode 选择器歧义。
- [ ] ActionBar toggle/popover 走现有 schema，不新增 react 分支。
- [ ] AddButtons 两轴钳制；竖向/org 槽位正确。
- [ ] org 卡片/连线对比度护栏绿。
- [ ] 折叠徽标 24px；点击展开在只读态不消费。

### 测试与文档

- [ ] 现有单测除“注册表键集 + 机械 import/字段名”外无断言放宽；全绿。
- [ ] 新单测覆盖 §14.1；E2E 覆盖 §14.2；视觉基线 §14.3 双平台。
- [ ] `pnpm verify` + 全量 E2E 绿；无未跟踪 actuals。
- [ ] docs/11、22、04、12、15、13、README 同步；AGENTS 索引（需人类确认）。
- [ ] 无本机路径/用户名/调试字面量入库。

---

## 17. 后续（不在本方案内）

- 容器 / Frame（docs/13 4.4）：部门/区域框、移动带子、裁剪；org 的“部门容器”随后升级。
- 节点级连线 / 多父：虚线汇报、矩阵组织；需要扩 LINE 锚点模型，成本高。
- BPMN/UML/泳道：按 docs/13 阶段 4 顺序，依赖容器与箭头族。
- 节点级内容朗读（a11y）：独立内容层，与树渲染解耦。
- 大树的隐藏子树 Vm 销毁、虚拟化：性能专项。
- SVG 导出：另立抽象，不承诺。
