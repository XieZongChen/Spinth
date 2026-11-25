# 容器 / Frame（4.4 泳道底座）技术方案

> 对应 docs/13 阶段 4.4「跨职能 / 泳道图」的第一段：容器底座。
> 本 spec 只覆盖 **FRAME 控件 + 子元素归属**；SWIMLANE 专属控件（车道表头/行布局
> 编辑）不在本 spec，见 §9 分期。4.4 的完成标志「3 泳道审批流程」用
> **3 个 FRAME 组合**达成（docs/13 §4.4 明确允许「MVP 先 FRAME + 手工泳道矩形」）。

## 0. 摘要

### 0.1 一句话

新增 `FRAME` 控件（标题带 + 背景 + 边框）与子元素 `parentId` 归属；容器拖动/删除/
复制带子，缩放不缩放子，不裁剪，单层归属，全部写入走既有 Yjs 事务。

### 0.2 关键决策（先看结论）

| 分叉        | 定案                                                                             | 理由                                                                                                              |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 归属表达    | **子元素挂 `parentId`**（容器不存 `childIds`）                                   | 与 `groupId` 同构：单写点、无数组一致性、删除/撤销天然安全、粘贴按桶重映射；查询子元素 O(n) 扫描与 groupOf 同量级 |
| 层级        | **单层**（容器不得再挂 parentId）                                                | 嵌套会把 culling / 导出 / 剪贴板 / undo 全部拖进递归                                                              |
| 容器形态    | **新控件 FRAME**（不是扩 SHAPE）                                                 | 20 型 SHAPE 是「轮廓 + 框内文字」，没有标题带、没有背景/子元素语义；扩 SHAPE 会把命中与文字内接搅在一起           |
| 泳道        | **3 个 FRAME 组合**（`headerSide: 'left'` 表达行泳道）                           | docs/13 §4.4 允许先手工泳道；SWIMLANE 控件二期再升级                                                              |
| 裁剪        | **不裁剪**（子元素越界照常可见）                                                 | 裁剪要同时改渲染掩膜、命中、导出与截图，收益低于成本                                                              |
| 删除容器    | **连子删**，单事务一步 undo；不做可配置                                          | 可配置 = 两套测试面；「移出容器」已有显式出口                                                                     |
| 缩放容器    | **不缩放子**（只改容器 rect）                                                    | 容器是布局单元不是变换单元；缩放子会引入 scale 与数据不一致                                                       |
| 命中区域    | **标题带 + 边框环**；内部空白不命中容器                                          | 内部命中会让一张大容器吃掉全画布点击；标题带是天然的抓取把手（设计工具通行心智）                                  |
| 命中尺度    | 边框环按**屏幕 px 折算**（`8 / vpScale`，世界值上限 32）                         | 0.2x 缩放下 8 世界 px 只有 1.6 屏幕 px，容器会变得抓不住                                                          |
| 建容器      | **不收养既有元素**                                                               | 一次误画会把半张图吞进容器；归属只来自「落入」（创建在框内 / 拖进框内）或显式菜单                                 |
| 归属时机    | 创建时全含 → 归属；拖放落点全含 → 归属；**完全离开** → 脱离；相交但不全含 → 保持 | 全含判据有滞回，拖动中途不会反复改父；「完全离开」是唯一脱离条件，行为可预期                                      |
| 对齐 / 分布 | **容器不参与**（与锚定线同款剔除）                                               | 容器参与就必须把「容器子集移动」接进 delta 分摊，MVP 不做；单容器选中时对齐键自然禁用                             |
| 图层命令    | 照常执行，但**容器 key 钳制在其最低子元素之下**                                  | 保证「容器恒在子之下」不变量，否则容器盖住子元素后点击全被容器吃掉                                                |
| 编组        | 容器 `groupable: false`；容器**内**的元素可照常编组                              | 容器与组是两套语义（几何归属 vs 选择聚合），混用会产生「半组在容器内」的未定义态                                  |
| 标题编辑    | 自有 plain 内核会话；能力位 `editable: false`                                    | 标题是纯文本单行（同脑图节点），不能进 TYPES_WHERE('editable') 的富文本通道（那条通道写 `text` 字段）             |
| 快捷键      | **C**（Container）；不用 F                                                       | `f` 已被 `view.zoomFit`「适应屏幕」占用（右键菜单 hint 即 F）；抢键会破坏既有习惯                                 |

### 0.3 不做什么

- 不做裁剪 / 溢出隐藏 / 滚动容器 / 自动布局（auto-layout）。
- 不做嵌套容器、容器套树形图（MIND_MAP / ORG_CHART 不进容器）。
- 不做 SWIMLANE 专属控件（车道数编辑、车道拖拽排序、合并拆分车道）。
- 不做「建容器收养既有元素」的批量父化（§12 已拍板不做）。
- 不做 BPMN 池/泳道语义（4.7 复用本底座，届时另立 spec）。
- 不改 dataEngine / vmEngine / culling / 空间索引 / 导出管线 / 项目文件管线。
- 不新增公开 API 成员（`BoardPublicApi` 71 成员不变）；`CursorMode` 增量 `'frame'` 属类型面 additive。

### 0.4 分工

- **设计 / 审查**：本文件作者。实施偏差、口径歧义、新增分叉一律回写 §16 并找设计者确认，不得自行扩大范围。
- **实施**：另一 agent。执行顺序见 §9，硬约束见 §14，交付前自检 §15。

## 1. 现状审计

### 1.1 现有能力与缺口

| 能力     | 现状                                                | 4.4 需要                               |
| -------- | --------------------------------------------------- | -------------------------------------- |
| 选择聚合 | `groupId` 标记制（docs/18）：成员仅打标，无渲染单元 | 几何归属 + 渲染单元 + 标题             |
| 父子关系 | **不存在**（`parentId` 仅存在于树节点头内部）       | 扁平文档上的父子                       |
| 容器渲染 | 无                                                  | 背景 + 边框 + 标题带                   |
| 移动带子 | 无                                                  | 拖容器带全部子元素                     |
| 删除级联 | 无（`removeByIds` 平铺删除）                        | 连子删                                 |
| 命中     | `getVmByPoint` 按 zOrder 降序 + `hitTestPoint`      | 容器只在标题带/边框环命中              |
| 框选     | `getVmByRect` 相交即入，组按「整组全入框」过滤      | 容器按「全含才入」过滤，且与组互斥归并 |
| 裁剪     | 无                                                  | 明确不做                               |
| 图层     | fractional indexing，任意改 key                     | 容器 key 恒低于子元素                  |

### 1.2 为什么不能复用 group

| 维度     | group（docs/18）                   | 容器（本 spec）                            |
| -------- | ---------------------------------- | ------------------------------------------ |
| 本质     | 选择聚合层：选区自动扩展为成员全集 | 画布实体：有渲染、标题、几何               |
| 进入方式 | 点任一成员 = 整组选中              | 点子元素 = 选子元素本身，容器不参与        |
| 移动     | 成员各自平移（选区就是全集）       | 只移动容器，**子元素被动跟随**（选区不变） |
| 删除     | 成员逐个删（选区全集）             | 容器删除触发级联（子元素不在选区）         |
| 复制     | 逐成员快照                         | 复制容器自动带子                           |
| 层级     | 建组时成员 zOrder 归拢             | 容器恒在子元素之下                         |
| 叠放     | 成员彼此平级                       | 父子两级，命中分层                         |

结论：容器**不复用** `groupId`，也不把容器做成「特殊组」。两者可共存（容器内的元素可以互相编组），但语义独立、代码路径独立。

### 1.3 为什么新增 FRAME 而不是扩 SHAPE

- SHAPE 的渲染契约是「轮廓 + 框内文字（HTML / 自动撑高 / 内接几何）」，FRAME 的契约是「标题带 + 背景 + 边框 + 空的内部」——两套几何与文本语义。
- SHAPE 的 `autoHeight`、`insetRectOf`、轮廓锚点对容器全部无意义；反过来容器的标题带、子元素归属对 SHAPE 全部无意义。
- 扩 ShapeType 会让 20 型轮廓表、锚点单源、视觉基线全部被一个非同质成员污染。

### 1.4 与既有引擎的接缝

| 接缝               | 容器如何接                                                     | 是否改引擎                                  |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| Model / VM         | 标准三件套 + `WIDGET_RUNTIME` 注册                             | 否                                          |
| 空间索引 / culling | 容器是普通 widget（`family: 'widget'`），按 bounds 入索引      | 否                                          |
| 命中               | `FrameVm.hitTestPoint` 覆写为「标题带 ∪ 边框环」               | 否                                          |
| 框选               | `MarqueeSession` 增加容器过滤闭包（与 groupFilter 并列）       | 否（换调用方）                              |
| 拖拽               | 选区含容器时**只对本次会话**展开 ids（选区不变）               | 否（`DragState` 加一个字段 + 一个可选钩子） |
| 微移               | `nudgeSelected` 同款展开                                       | 否                                          |
| 删除               | `selector.removeSelected` 前展开                               | 否                                          |
| 剪贴板             | 复制/剪切展开；粘贴时 parentId 桶重映射                        | 否（同 groupId 先例）                       |
| 图层               | 变更后钳制容器 key                                             | 否                                          |
| 项目文件           | 字节级复制，零改动；老客户端未知类型隔离 + parentId 未知键保留 | 否                                          |
| 导出 PNG           | 容器在 widgetLayer 内，零改动                                  | 否                                          |
| 只读               | `editable$` 闸门（工具钳制 + 指针分发丢弃 + 命令守卫）         | 否                                          |
| 参考线             | 参照物排除面从 `selected$` 扩到 `selected$ ∪ previewIds`       | 否（refLineService 一行）                   |

### 1.5 代码硬约束

- 单文件 < 400 行：`frameVm` / `frameService` / `frameOps`（纯逻辑）三文件，与既有 shape/sticky 同款切分。
- 注册三表：`WIDGET_REGISTRY`（schema 域）+ `WIDGET_RUNTIME`（Model/Vm 域）；Service 不入注册表（手工装配，docs/04 §3）。
- 不改 `dataEngine` / `vmEngine`：容器的一切写入都走 `model.update` / `model.updateRect`。
- 新增依赖一律**可选尾参 + 缺省值**（`getFrames: () => FrameService | null = () => null`），
  既有单测构造点零改动（`selectorDrag/selectorMarquee/clipboardSymbol/mindDragWiring` 等 5 处）。

## 2. 数据模型

### 2.1 FRAME schema

```ts
/** 容器（specs/container-frame §2.1）：标题带 + 背景 + 边框，内部不承载文字；
 *  optional 无 default 的字段一律「缺省由消费侧常量兜底」，旧文档零迁移 */
export const FrameSchema = z.object({
  id: z.string(),
  type: z.literal('FRAME'),
  zOrder: z.string(),
  /** 标题（纯文本单行，非 HTML；空串 = 只有带、无文字） */
  title: z.string().default(''),
  /** 背景色；fill 'none' 时不画底 */
  color: z.string().default('#ffffff'),
  fill: z.enum(['solid', 'none']).optional(),
  /** 边框：未写 borderColor = 派生暗色（与 SHAPE 同口径：写死不自适应） */
  borderColor: z.string().optional(),
  borderWidth: z.number().optional(),
  borderStyle: z.enum(['solid', 'dashed', 'none']).default('solid'),
  /** 标题带位置：top（默认，标题条在上） / left（行泳道，左侧表头列） */
  headerSide: z.enum(['top', 'left']).optional(),
  /** 标题文字色；缺省 = 主题墨色（light #333333 / dark #ededf2） */
  titleColor: z.string().optional(),
});
export type FrameData = z.infer<typeof FrameSchema>;
```

不引入 `childIds`、不引入 `lanes`（SWIMLANE 二期另立字段）。

### 2.2 子元素 parentId

```ts
/** 容器归属标记（specs/container-frame §2.2）：optional 无 default——旧文档
 *  零迁移，字段不存在即顶层；仅自由七类引入，锚定线与树控件运行时排除 */
export const ParentIdField = {
  parentId: z.string().optional(),
} as const;
```

spread 进 **SHAPE / TEXT / STICKY / IMAGE / PEN / SYMBOL / LINE** 七个 schema（与
`GroupIdField` 同址）。`FRAME` / `MIND_MAP` / `ORG_CHART` 不带该字段。

清父用 `update({ parentId: undefined })`（同 `groupId` 先例；zod `optional` 放行，
`DataProcessor.update` 同值跳过，语义等同上层的「键删除投影」）。不要绕过 Model 手写 `yData.delete`。

### 2.3 不变量

| 编号 | 不变量                                                                         | 保障点                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1   | 单层：`parentId` 只能指向 `type === 'FRAME'` 的存活控件；FRAME 自身无 parentId | 命令层（写入口只有 `FrameService`）+ 读取侧「孤儿即顶层」降级                                                                                                    |
| I2   | 锚定线（任一端有 `startNodeId/endNodeId`）运行时排除出归属体系                 | 写入侧拒绝（FrameService）；读取侧排除（`childIds`/`expandForCascade` 过滤）。转锚定不清字段——stale `parentId` 为惰性数据（任何归属/级联/移出路径不读它，§16 ②） |
| I3   | 容器的 `zOrder` 恒小于其全部子元素的 `zOrder`                                  | 归属写入后钳制 + 图层命令后钳制（`clampFrameZOrder` 单源）+ 粘贴容器先入批（§4.7）                                                                               |
| I4   | 子元素的 `parentId` 指向的容器被删时，字段不自动清理（孤儿即顶层）             | 与 group「组消解不清理字段」同款：undo 恢复后归属自动复活                                                                                                        |
| I5   | 归属只由三类路径写入：创建时全含、落点（拖放 / 粘贴收尾）、右键显式菜单        | `FrameService` 之外无写入口；undo·redo 恢复是既有状态的还原，不重判（§4.2）                                                                                      |
| I6   | 归属写入与触发操作同一事务（一次 undo 回退到底）                               | `commitDrag` 的 transact 内、`nudgeSelected` 的 transact 内                                                                                                      |

### 2.4 归属判据（几何三态）

对元素 E 与容器 F（`F.type === 'FRAME'`，F ≠ E）：

| 关系 | 判据                                         | 动作                                           |
| ---- | -------------------------------------------- | ---------------------------------------------- |
| 全含 | E 的 AABB 完全落在 F 的 AABB 内              | `parentId := F.id`（多个命中取 zOrder 最上者） |
| 相交 | 相交但不全含                                 | **保持原状**（不改父）                         |
| 全离 | 与「当前父容器」完全不相交且不全含于任何容器 | `parentId := undefined`                        |
| 无关 | 与任何容器都不相交且无父                     | 无动作                                         |

判据用世界 AABB，不用中心点：全含/全离是两侧都明确的边界，中间的「相交带」是滞回区，拖动过程中不会因为跨线抖动而反复改父。

```ts
// frameOps.ts —— 纯逻辑，无服务依赖，全部可单测
export type ParentUpdate = string | undefined | null; // string = 设父；undefined = 清父；null = 不改

export function resolveParentUpdate(args: {
  /** 当前父 id（无 = undefined） */
  parentId: string | undefined;
  /** 当前父的 AABB（父已被删/非容器 = null） */
  parentRect: IRect | null;
  /** 元素移动后的 AABB */
  selfRect: IRect;
  /** 全部存活容器（id + zOrder + AABB；不含自身） */
  frames: ReadonlyArray<{ id: string; zOrder: string; rect: IRect }>;
}): ParentUpdate;
```

判定顺序（**顺序即语义，不得重排**）：

1. `parentId && parentRect && fullyContains(parentRect, selfRect)` → `null`（原地不动，即使别的容器也全含）
2. 否则取 `frames` 中「全含 selfRect」且 zOrder 最上者 → 该 id（与当前父相同则 `null`）
3. 否则 `parentId && parentRect && !intersects(parentRect, selfRect)` → `undefined`（完全离开才脱离）
4. 否则 `null`

### 2.5 兼容与降级

- **旧文档零迁移**：新字段全 optional；老客户端打开新文档时 `FRAME` 进隔离区
  （`quarantinedIds`，+warning），`parentId` 作为未知键保留（sanitize 只删
  schema 已知且非法的键）——老客户端看到的是一张没有容器但元素位置完好的图。
- **新客户端打开老文档**：无 `FRAME` 即无归属，所有元素按顶层处理。
- **孤儿 parentId**（父被删/被隔离/指向非容器）：读取侧一律按顶层处理，
  **不改写数据**（与 group 消解规则同款，undo 后归属复活）。
- **项目文件**：`document.yjs` 字节级复制，导入不逐件校验（docs/20 §7）。容器与
  归属随文档往返，零额外处理。
- **跨表粘贴**：`parentId` 在 schema 内，所以经 `text/html` / `text/plain` 序列化
  往返不丢；批外父在粘贴时置空（§4.7）。

### 2.6 注册与能力位

```ts
FRAME: {
  family: 'widget',
  schema: FrameSchema,
  capabilities: {
    rotatable: false,     // 容器不旋转（旋转变换与子元素坐标无解）
    groupable: false,     // 容器与组互斥（§4.13）
    resizable: true,
    movable: true,
    selectable: true,
    keepRatio: false,
    editable: false,      // 标题走自有 plain 内核（同 LINE 线上文字先例）
    referenceable: true,  // 参考线可吸附容器边（泳道对齐刚需）
    erasable: false,
  },
},
```

`WIDGET_RUNTIME` 增 `FRAME: { modelToken, vmToken, createModel, createVm }`。
`FrameModel` 仅 `constructor(processor)` + `capabilities` + `schema` 三行（同 stickyModel）。

## 3. 几何与渲染

### 3.1 常量（单源 frameGeometry.ts）

```ts
export const FRAME_HEADER_TOP = 28; // 顶部标题带高（世界 px）
export const FRAME_HEADER_LEFT = 112; // 左侧表头列宽（行泳道）
export const FRAME_PAD_X = 10; // 标题左内边距
export const FRAME_TITLE_FONT = 13; // 标题字号
export const FRAME_HIT_EDGE = 8; // 边框命中环宽（屏幕 px，命中时折算世界值）
export const FRAME_HIT_EDGE_MAX = 32; // 折算后的世界值上限（防 0.05x 下环宽过大）
export const FRAME_DEFAULT_SIZE = { width: 320, height: 220 };
export const FRAME_MIN_SIZE = { width: 40, height: 40 };
export const FRAME_DEFAULT_COLOR = '#ffffff';
export const FRAME_DEFAULT_BORDER = '#94a3b8';
```

### 3.2 标题带几何

```ts
/** 标题带矩形（局部系，左上原点）：top = 整宽 × 28；left = 112 × 整高 */
export function frameHeaderRect(w: number, h: number, side: 'top' | 'left'): IRect;

/** 标题文字可用宽（top = w - 2×PAD；left = 112 - 2×PAD） */
export function frameTitleWidth(w: number, h: number, side: 'top' | 'left'): number;

/** 单行截断：超出可用宽时按字符二分找最长前缀 + '…'（同 SYMBOL 标签口径） */
export function truncateTitle(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string;
```

- `top`：标题在带内左对齐、垂直居中。
- `left`：标题在表头列内左对齐、**垂直居中**（不是贴顶），超出列高时不画。
- 退化（`h < 24` 或 `w < 24`）：标题不画，容器照常渲染——渲染不得因退化抛错。

### 3.3 命中区域

```ts
/** 容器命中 = 标题带 ∪ 边框环（不含内部空白）。
 *  edgeWorld = FRAME_HIT_EDGE / vpScale 并钳到 [FRAME_HIT_EDGE, FRAME_HIT_EDGE_MAX]。
 *  标题带：明确的抓取把手（泳道 = 抓表头）；边框环：贴边也能选中。 */
export function frameHitTest(
  p: IPoint,
  rect: IRect,
  side: 'top' | 'left',
  edgeWorld: number,
): boolean;
```

- `FrameVm.hitTestPoint` 通过构造注入的 `getScale: () => number`（缺省 `() => 1`）现算 edgeWorld，
  不缓存（缩放随时变）。
- 内部空白**不命中**容器：点空白 = 清选区（既有画布语义），不会被大容器吃掉。
- 子元素是独立顶层 widget（zOrder 更高），点它们命中它们自己——不需要「Alt 进容器」，
  与 docs/13 §4.4 原表述「Alt / 双击进子元素」**不同**，落地后同步 docs/13（§10 已列）。

### 3.4 绘制

- 底：`fill: 'solid'` 画 `color`，`'none'` 不画。
- 边：`borderStyle` 实线/虚线/无（虚线常量与 SHAPE 同源）。
- 标题带：与底同色（`'none'` 时透明）；带与主体之间一条同边框色分隔线（top 带画
  底边线，left 带画右边线）——泳道「行」的视觉分隔，不额外建元素。
- 标题：单行、左对齐、垂直居中，超出可用宽截断加省略号（`truncateTitle`）。
- 不裁剪子元素（子元素不是容器的子树，渲染上互不相干）。

### 3.5 缩放与移动

- 缩放：`rectEditor` 既有手柄，`commitResize` 只写容器 rect，子元素不动（不缩放、不挪位）。
- 移动：拖动会话展开（§4.4），落库时容器与子元素各自写自己的 x/y（points 型写 points）。
- 旋转：不支持（`rotatable: false`，无手柄入口）。

## 4. 交互

### 4.1 创建

`FrameService extends DragCreateServiceBase`：

- `scope: 'frame'`，`defaultSize = FRAME_DEFAULT_SIZE`，`minDraftSize = FRAME_MIN_SIZE`。
- 单击：以按下点为中心建 320×220（与形状/便签同款），工具保持可连击。
- 拖拽：> 10 屏幕 px（`DRAG_TRACTION_SCREEN`）起拖，跟手画框；松手选中新容器并回 cursor。
- 网格吸附：沿用基类（起止角量化），零新增逻辑。
- 创建**不收养**既有元素（§12 已拍板）。
- 创建后立刻做一次「创建即归属」判定（§4.2），归属新容器自己的新子元素——通常为空，
  但若用户在容器内连击建件，容器本身不会被收养（容器无 parentId 字段）。

### 4.2 归属写入时机

| 触发             | 时机                                         | 事务                                                                |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| 创建时全含       | `onModelCreated$` 订阅（`adoptOnCreate`）    | 与创建同一 undo 单元（拖拽创建与单击创建都以 `stopCapturing` 收口） |
| 拖放全含 / 全离  | `commitDrag` 的 transact **内**，写 x/y 之后 | 与移动同一事务（I6）                                                |
| 微移全含 / 全离  | `nudgeSelected` 的 transact 内               | 同上                                                                |
| 右键「移出容器」 | 菜单命令                                     | 单独事务 + `stopCapturing`                                          |

拖放归属只对**展开前选区**（`DragState.selectedIds`）判定，且剔除其中的 FRAME 自身；
子元素跟着移动不打标，避免它们被重新判父。

**「创建时全含」只服务工具在事务外新建的无父件**，三类新建不重判：

- 批量上下文的创建事件（粘贴批 / undo·redo 恢复 / replay·远端插入）：复制或恢复的是
  既有状态，`parentId` 已由粘贴桶映射或快照给足。重判会让副本、恢复件与原状态分叉
  ——「缩小容器」产生的框外子（仍持有 `parentId`，缩放不重判）在恢复时被三态判据按
  「完全离开」清父。粘贴副本的归属不由创建事件决定，而由 §4.7 的落点归属负责。
- 已带 `parentId` 的新件（归属是既定事实；含同批尚未建出的容器）。
- 画笔与连线（`isAutoAdoptableType`，§12 已拍板）：两类落笔即建件，几何在 `points`、
  模型矩形是占位值 `{0,0,100,100}`——按矩形判会被盖住左上角的容器误收，画在别处
  容器里的也不会归属。不参与自动归属；要归属可拖入（拖放判定走 `getLocalRect`，
  两类即真实包围盒）。

实现：`FrameService` 监听 `yDoc` 的 `beforeAllTransactions` / `afterAllTransactions`
置批量上下文标记——工具的 `engine.add` 在事务外调用，其内层事务收尾之后才发
`onModelCreated$`；粘贴批发在事务体内，恢复批发在观察者相。判定依赖 Yjs 事务生命周期
时序，桩测不出，真引擎回归在 `frameAdoptionFidelity.test.ts`。橡皮拆段在事务内新建
笔迹段，同批继承 `parentId`（不走创建归属，漏带即脱容器）。

自动归属的落点判定是 `FrameService.adoptByLanding(ids)`，创建与粘贴收尾共用：只处理
「无父且可自动归属」的件，完全落进某存活容器（多容器取最上者）即设父并钳制其层级
（I3），跨出边界保持顶层。拖放 / 微移落点是另一入口 `reconcileParents`（带滞回的
三态判定，可清父）。

### 4.3 框选口径

`MarqueeSession` 在既有 `groupFilter` 之后并列一个容器归并步骤。算法（顺序固定）：

```ts
// frameOps.ts
export function mergeFramesIntoSelection(args: {
  /** 组过滤后的命中（zOrder 降序，getVmByRect 的稳定序） */
  ids: string[];
  marquee: IRect;
  /** 全部存活容器（id + AABB） */
  frames: ReadonlyArray<{ id: string; rect: IRect }>;
  /** 容器 → 全部存活子元素 */
  childIdsOf: (frameId: string) => string[];
  /** 本次结果涉及的、且存活成员 ≥2 的组的全部成员（GroupService 提供） */
  groupedIds: ReadonlySet<string>;
}): string[];
```

1. `fully = frames.filter(f => fullyContains(marquee, f.rect))`（**全含才入选**，半含剔除）。
2. 若某容器的子元素里有 `groupedIds` 成员 → 该容器**不入选**（不拆组）。
3. 入选容器的子元素从结果里剔除（子随容器走，不需要单独选中）。
4. 其余元素保持原序。

语义边界：容器移动会带走容器内的组员，组外成员不动——组是选择层、容器是几何层，
几何归属优先（写进 docs/18 交叉引用）。

### 4.4 拖拽带子

- `DragState` 增 `selectedIds: string[]`（**展开前**选区，提交时归属判定用）。
- 展开在 `selector.onPointerDown` 建会话处：`ids = frames.expandForCascade(selectionIds)`
  （容器 → 并入全部存活子元素，Set 去重保序）。
- 预览：`applyDragMove` 对展开后 ids 逐个 `applyDragPreview`（零逻辑改动）；`previewIds`
  随之覆盖子元素（culling 预览复核天然生效）。
- 落库：`commitDrag` 对展开后 ids 逐个 commitDrag；随后**同一 transact 内**调用
  `ctx.reconcileParents?.(d.selectedIds, rectOf)`。
- 取消：`cancelDrag` 对展开后 ids 复位（零改动）。
- 参考线/网格：基准仍是 `initialUnion`（含子元素的包络 ⊇ 容器），吸附语义不变。

**`rectOf` 契约（关键陷阱）**：事务内 vm 尚未重渲染（`setState` 是微任务合批），
`vm.getBounds()` / `vm.root.zOrder` 都还是旧值。`rectOf` 必须是算术：

```ts
const rectOf = (id: string): IRect => {
  const init = d.initial.get(id);
  if (init) return { ...init, x: init.x + dx, y: init.y + dy }; // 本次拖动的件：初值 + 末帧位移
  const data = engine.getModelById(id)?.toJSON(); // 未移动的容器：直接读 model（权威值）
  return { x: data.x, y: data.y, width: data.width, height: data.height };
};
```

**参考线排除面**：`refLineService` 目前按 `selected$` 排除参照物；拖容器时子元素
**不在选区**却跟着动，会被当成参照物 → 容器吸到自己的子元素上。必须在收集参照物时
同时排除 `selector.previewIds`（一行），并补单测（§8.1 `refLineService.test`）。

### 4.5 微移（方向键）

`nudgeSelected` 先展开容器到子元素再去重（`selectedIds` 记展开前），单事务 commitDrag，
并在同一事务里跑同款 `rectOf` 归属判定（矩形取 `getLocalRect()` 加位移）。
选区不变，一次 undo 回退整段位移。

### 4.6 删除

`selector.removeSelected`：`ids = frames.expandForCascade(selection)` → `engine.removeByIds(ids)` 单事务。

- `BoardCommands.removeSelected` 的脑图节点分支在 selector 之前，不受影响。
- 容器被删后子元素也删，无孤儿写。
- undo 一步恢复容器 + 子元素 + 各自的 `parentId`（字段随 Y.Map 一起回滚）。
- 锚定到被删子元素的连线：既有 reattach 把端点置空（行为不变）。

### 4.7 复制 / 剪切 / 粘贴

- **复制/剪切展开**：`handleCopy` / `copySelected` 取快照前展开容器 → 子元素。
  剪切按展开集删除。
- **粘贴重映射**（`pasteSnapshots`）：
  - `idMap` 既有；
  - `parentId` 按**桶映射**（同 `groupIdMap` 先例）：批内首次见到的旧 parentId → 新 id；
    批外父（复制了子元素但没复制容器）→ `undefined`（原归属不随副本走）；
  - 顺序：**容器先入批**——快照按「FRAME 在前、其余保持原序」重排后逐个 `engine.add`，
    同一事务。新件 zOrder 按入批序递增生成，副本容器的 key 必然低于批内全部子元素（I3）。
  - **不做事后钳制写入**：外层事务内紧随创建的写入对刚挂上的 vm 观察者不可见
    （§6.6 陷阱 11）——文档钳了、`root.zOrder` 没动，白底容器盖住子副本直到刷新。
- **落点归属**（§12 已拍板）：粘贴批事务收尾后、`stopCapturing` 之前，对本批新件调
  `adoptByLanding`——无父副本完全落进存活容器（含同批的容器副本）即归属，与拖放落点
  同款全含判据；带父副本（桶映射给足）与画笔 / 连线副本不参与。必须放在粘贴批之外
  另起事务：批内写入对刚建 vm 的观察者不可见（§6.6 陷阱 11）；与粘贴同一捕获窗，
  一步 undo。纯文本 / 图片粘贴走事务外 `engine.add`，由创建即归属处理，口径一致。
- **跨表粘贴**：来源是非本页 JSON 时同样走桶映射（idMap 只有本批，批外一律置空）。

### 4.8 图层命令

`LayerService.apply`：用 `vm.root.zOrder` 算 delta（事务外，语义不变），把「变更后 zOrder 表」
喂给 `clampFrameZOrder` 算出容器额外钳制，再单事务写入全部变更。
语义：容器置顶 = 置到「子元素之下最高处」，视觉上仍在其子之下。

### 4.9 对齐 / 分布

`resolveAlignParticipant` 对 `vm.type === 'FRAME'` 返回 `null`（与锚定线同款剔除）——
参与数不足时 ActionBar 的六向对齐/两向分布各自禁用（既有 disabled 逻辑）。
容器内的元素照常按普通参与者处理。

### 4.10 标题编辑

- 入口：单击已选中的容器（`selector.onActivate` → `boardAssemblyInteraction` 分派
  `type === 'FRAME'` → `frameService.enterTitleEdit(id)`）。容器只在标题带/边框环命中，
  「点标题带」就是天然入口。
- 内核：**plain**（textarea，与脑图节点同款）。descriptor：
  - `getRect()`：标题文字区（世界坐标，实时求值；left 侧垂直居中）；
  - `getContent()`：`title`；
  - `onCommit(text)`：同值跳过，否则 `update({ title })`；
  - `emptyTextPolicy: 'keep'`（空标题不删容器）；
  - `onPlainKeyDown`：Enter 提交退出并返回 true（标题单行，不做 Shift+Enter 换行）；
  - `onExit`：本次写过 → `history.stopCapturing()`（一次编辑一步 undo）；没写过不切窗。
- 只读：`viewport.editable$.value === false` 时入口直接返回。
- 编辑期容器照常渲染（标题在带上，不会与画布文字双显）。

### 4.11 只读与离线

- `setCursorMode('frame')` 在只读态被钳成 `cursor`（既有逻辑，零改动）。
- 指针分发在只读态整条丢弃（既有 `viewportPointerInput` 闸门），创建/拖动/归属全部不可写。
- 删除/微移/右键菜单命令走各自 `editable$` 守卫（既有）。
- 离线（无 ws / 断网）：容器与归属走 IndexedDB 同一持久化路径，无额外分支。

### 4.12 工具与快捷键

- `CursorMode` 增 `'frame'`。
- 快捷键 **C**：`DEFAULT_SHORTCUTS` 增 `{ id: 'tool.frame', keys: 'c', description: '容器工具' }`，
  `KeyboardService` 增 `case 'tool.frame'` → `setCursorMode('frame')`。
  **不要用 F**：`view.zoomFit` 已占用（右键菜单 hint F）。
- 工具坞单入口「容器 (C)」，无二级菜单；`ToolGhost` 增 `frame` 条目（图标 + shape 主题色槽位）。

### 4.13 与编组的组合规则

- 容器不可编组（`groupable: false`）。
- 容器内的元素可编组（组是选择层，不关心容器）。
- 框选时容器与「被选中的组」互斥：容器子元素里有选中组的成员 → 容器不入选（§4.3 第 2 步）。
- 容器移动带走容器内组员，组外成员不动（§4.3 语义边界）。

### 4.14 交互矩阵（实施者按此逐行自检）

| 手势            | 容器                       | 容器内子元素                |
| --------------- | -------------------------- | --------------------------- |
| 单击标题带/边框 | 选中容器                   | —                           |
| 单击内部空白    | 不入容器命中 → 清选区      | —                           |
| 单击子元素      | —                          | 选中子元素（容器不参与）    |
| 拖容器          | 移动 + 带子                | 被动跟随（无归属变化）      |
| 拖子元素        | —                          | 只动它自己；全含/全离时改父 |
| 框选            | 全含才入选                 | 容器入选时子元素不并入      |
| 缩放            | 只改容器 rect              | 不变形、不挪位              |
| 删除            | 连子删                     | 单独删                      |
| 复制            | 带子                       | 单独复制 → 粘贴后父置空     |
| 对齐/分布       | 不参与                     | 正常参与                    |
| 图层            | 钳在子之下                 | 正常                        |
| 只读            | 不可建/不可拖/不进标题编辑 | 同左                        |

## 5. UI

### 5.1 工具坞

单一按钮，图标 `frame`，主题色 shape 槽位（不新增 `tool-frame-*` 安全类，避免对比度护栏扩散）。
布局风险：工具坞按钮数 +1，390px 移动端需回归 ``mobile.spec` / ``a11yLayout.spec`；溢出时按
既有 `flex-wrap` 口径处理，不新造布局。

图标：`IconName` 增 `'frame'`，优先 lucide `Frame`；当前依赖版本无该导出时用
`SquareDashed`（已在用）兜底——两条路都要过 `lint`（未使用导入即红）。

### 5.2 ActionBar（单选容器）

| 项       | id / kind               | 值                                                                  |
| -------- | ----------------------- | ------------------------------------------------------------------- |
| 背景色   | `color` / popover       | `fill === 'none' ? 'none' : color`（含「无填充」项，同 SHAPE 分流） |
| 边框色   | `borderColor` / popover | `borderColor`（缺省显示派生色点）                                   |
| 边框线型 | `borderStyle` / popover | solid / dashed / none                                               |
| 边框宽   | `borderWidth` / popover | 复用 `SHAPE_BORDER_WIDTH_OPTIONS`（1/2/4）                          |
| 标题位置 | `headerSide` / popover  | top / left                                                          |

- 全部 id 与 schema 字段同名 → 走 `updateSelectedStyle` 通用通道（无新命令）。
  `color: 'none'` → `fill: 'none'` 的分流已存在，容器自动继承。
- 多选分支：容器不参与对齐/分布计数（§4.9），「编组」按钮对本选择集禁用（容器不可组）。

### 5.3 右键菜单

增「移出容器」：`IContextMenuState` 增 `canDetach`；选中集里存在 `parentId` 时可用；
只读态恒 false。命令 = 清父 + `stopCapturing`。
不增「放入容器」（拖放已覆盖，避免两套入口）。

### 5.4 主题与对比度

- 背景/边框/标题色都走实例字段，缺省值在 light/dark 下各取主题常量。
- 标题文字与标题带底色需 ≥ 4.5:1（沿 `shapeContrast.test` 口径补一条护栏）：白底深字、
  深底浅字两态。

## 6. 引擎边界与改动清单

### 6.1 不改

`dataEngine` / `vmEngine` / `cullingService` / `spatialIndex` / `exportCommand` /
`projectImport` / `projectExport` / `historyService`。

### 6.2 改动点（文件级，按实施顺序）

| #   | 文件                                                               | 改动                                                                                                    |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | types/widget.ts                                                    | `FrameSchema` + `ParentIdField` + 七 schema spread + `WIDGET_REGISTRY.FRAME`                            |
| 2   | types/services.ts                                                  | `CursorMode` 增 `'frame'`；`IFrameLookup` 接口；`IContextMenuState` 增 `canDetach`                      |
| 3   | widgetRuntime.ts                                                   | `FRAME` 一项（Model/Vm 工厂）                                                                           |
| 4   | widgets/frame/frameModel.ts                                        | 19 行（同 stickyModel）                                                                                 |
| 5   | widgets/frame/frameGeometry.ts                                     | 常量 + 标题带/命中/截断纯函数                                                                           |
| 6   | widgets/frame/frameOps.ts                                          | `resolveParentUpdate / expandContainers / clampFrameZOrder / remapParentIds / mergeFramesIntoSelection` |
| 7   | widgets/frame/frameVm.ts                                           | 渲染 + `hitTestPoint` + `getBounds` + `getScale` 注入                                                   |
| 8   | widgets/frame/frameService.ts                                      | 创建工具 + 归属 + 展开 + 标题编辑 + 菜单态（超 400 行拆 `frameTitleEditor`）                            |
| 9   | platform/selector/selectorDragOps.ts                               | `DragState.selectedIds` + `reconcileParents` 钩子（事务内）                                             |
| 10  | platform/selector/selectorService.ts                               | 拖拽/删除前展开；`getFrames` 可选尾参（返回 IFrameLookup 或 null）；`onActivate` 分派注释               |
| 11  | platform/selector/selectorMarquee.ts                               | `mergeFramesIntoSelection` 接线                                                                         |
| 12  | platform/refLine/refLineService.ts                                 | 参照物排除 `previewIds`                                                                                 |
| 13  | alignCommands.ts                                                   | `resolveAlignParticipant` 剔 FRAME                                                                      |
| 14  | platform/layer/layerService.ts                                     | 落地前 `clampFrameZOrder`                                                                               |
| 15  | platform/clipboard/clipboardService.ts                             | 展开 + parentId 桶映射 + 容器先入批                                                                     |
| 16  | platform/contextMenu/contextMenuService.ts                         | `canDetach` 计算                                                                                        |
| 17  | boardActionBar.ts                                                  | `case 'FRAME'`                                                                                          |
| 18  | boardAssemblyInteraction.ts                                        | `sdk.frame` 装配 + `onActivate` 分支 + `selector.onDragCommitted` 不变                                  |
| 19  | boardHost.ts / boardAssemblyTools.ts                               | `frame` 字段 + 键盘 handler                                                                             |
| 20  | platform/keyboard/shortcuts.ts + keyboardService.ts                | `tool.frame` 定义与分支                                                                                 |
| 21  | packages/react/components/{Toolbar,ToolGhost,Icon,ContextMenu}.tsx | UI 条目                                                                                                 |
| 22  | docs/*                                                             | §10 清单                                                                                                |

### 6.3 公开面

- `BoardPublicApi` 71 成员**不变**：容器没有必须暴露的命令（创建走工具、移出走右键）。
- `CursorMode` 增量 `'frame'`（类型面 additive，不违反 1.0.x「破坏性变更走主版本」）。
- DEV 探针：`vmStates` 已透传 `vm.state`，`parentId/title/headerSide/zOrder` 自动可断言，零新增探针。

### 6.4 接口签名（实施按此落地，签名不得漂移）

```ts
// ---- types/services.ts：接口层（平台层只依赖接口，不 import widgets/frame——
// 分层纪律同 ITreeDragDelegate 先例；否则 platform → widgets 反指）
export interface IFrameLookup {
  isFrame(id: string): boolean;
  /** 容器的全部存活子元素（保持 zOrder 升序；无子 = []） */
  childIds(frameId: string): string[];
  /** 容器 → 并入全部存活子元素（Set 去重保序；非容器原样保留） */
  expandForCascade(ids: string[]): string[];
  /** 归属三态判定并落库。**只在事务内调用**；rectOf 见 §4.4（事务内不许读 vm） */
  reconcileParents(ids: string[], rectOf: (id: string) => IRect): void;
  /** 自动归属的落点判定（创建 / 粘贴收尾）：只处理无父且可自动归属的件，完全落进
   *  存活容器即设父。只在事务内调用，由调用方收口撤销窗 */
  adoptByLanding(ids: string[]): void;
  /** 图层命令落地前的容器额外钳制（§4.8，§16 ③）：post = 叠加 delta 后的 zOrder 表 */
  computeLayerClamps(post: ReadonlyArray<{ id: string; zOrder: string }>): Array<{
    id: string;
    zOrder: string;
  }>;
  /** 框选容器归并闭包（§4.3）；无容器返回 null */
  createMarqueeFrameFilter(
    groups: { groupOf(id: string): string | undefined; membersOf(groupId: string): string[] } | null,
  ): ((hitIds: string[], marquee: IRect) => string[]) | null;
}

// ---- widgets/frame/frameOps.ts：纯逻辑 ----
export function expandContainers(ids: string[], frames: IFrameLookup): string[];

/** 容器 key 必须 < 全部子元素 key。无需调整返回 null */
export function clampFrameZOrder(
  items: ReadonlyArray<{ id: string; zOrder: string }>,
  frameId: string,
  childIds: string[],
): string | null;

export function resolveParentUpdate(args: {
  parentId: string | undefined;
  parentRect: IRect | null;
  selfRect: IRect;
  frames: ReadonlyArray<{ id: string; zOrder: string; rect: IRect }>;
}): ParentUpdate;

export function remapParentIds(
  snapshots: ReadonlyArray<{ id: string; parentId?: string }>,
  idMap: ReadonlyMap<string, string>,
): Map<string, string | undefined>;

// ---- widgets/frame/frameService.ts：服务 ----
export class FrameService extends DragCreateServiceBase implements IFrameLookup {
  isFrame(id: string): boolean;
  childIds(frameId: string): string[];
  expandForCascade(ids: string[]): string[]; // = expandContainers
  adoptOnCreate(id: string): void; // 创建即归属：只服务工具在事务外新建的件 → adoptByLanding
  adoptByLanding(ids: string[]): void; // 落点归属（创建 / 粘贴收尾共用；调用方负责事务）
  reconcileParents(ids: string[], rectOf: (id: string) => IRect): void; // 只在事务内调用
  detachSelection(): void; // 右键「移出容器」
  canDetachSelection(): boolean;
  enterTitleEdit(id: string): boolean; // false = 只读 / 非容器 / 未组装
}

// ---- selector（可选尾参，既有测试零改动；类型面只认接口）----
getFrames?: () => IFrameLookup | null;

export interface ISelectorDragContext {
  /** 事务内钩子：ids = 展开前选区（缺省 = 无容器语义，老桩零改动） */
  reconcileParents?: (ids: string[], rectOf: (id: string) => IRect) => void;
}
```

### 6.5 装配与晚绑定

- `sdk.frame = new FrameService(viewport, engine, vmEngine, selector, history, editingService)`
  放在 `boardAssemblyInteraction` 的 editingService 之后（需要 plain 内核）。
- `selector` 用惰性 getter `() => sdk.frame`（同 `getGroups` 先例，避免构造环）。
- 销毁：`boardTeardown` 的 `host.frame?.dispose()`，紧随 `symbolService`、早于 `engine`——
  摘 yDoc 批量事务监听、退订 `onModelCreated$`（该 Subject 永不 complete，不入序列则
  引擎一直持有服务）。护栏 `boardSdkDispose.test.ts`（调用一次 + 序早于 engine）。
- 容器 **不**注册进 `WIDGET_RUNTIME` 之外的表；Service 不入注册表（docs/04 §3）。

### 6.6 必须避开的陷阱（逐条对账）

| #   | 陷阱                                         | 正确做法                                                                                                                                                                                                                                           |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 事务内读 `vm.getBounds()` / `vm.root.zOrder` | 都是微任务合批后的旧值；用算术或 `model.toJSON()`                                                                                                                                                                                                  |
| 2   | 归属写放在 transact 外                       | undo 裂项；必须在 `commitDrag` / `nudge` 的 transact 内（I6）                                                                                                                                                                                      |
| 3   | 参考线参照物只排除 `selected$`               | 拖容器时子元素不在选区却被当参照物 → 追加排除 `previewIds`                                                                                                                                                                                         |
| 4   | 容器进对齐参与集                             | delta 只移动容器、子元素留在原地；必须返回 null                                                                                                                                                                                                    |
| 5   | 粘贴不做 parentId 桶映射                     | 粘贴体指向**原**容器，拖原件会带走副本                                                                                                                                                                                                             |
| 6   | 建容器顺手收养既有元素                       | §12 已否决                                                                                                                                                                                                                                         |
| 7   | 展开时不去重/丢序                            | 用 Set 保插入序；`[frame, child, child]` 不得重复 commit                                                                                                                                                                                           |
| 8   | 标题编辑走 `TYPES_WHERE('editable')`         | 那条通道写 `text` 字段；容器用自有 plain 会话                                                                                                                                                                                                      |
| 9   | 命中区域用整块矩形                           | 会吃掉内部点击；必须标题带 ∪ 边框环                                                                                                                                                                                                                |
| 10  | 徽标/选中态订阅漏容器                        | `onSelected$` 由 `setSelected` 统一派发，无需额外接线                                                                                                                                                                                              |
| 11  | 同一事务内「创建新件后紧接 update」新件      | yjs 不为本事务新建的类型登记变更（`addChangedTypeToTransaction` 要求类型的 item 早于本事务且未删除），观察者不触发——vm.state / `root.zOrder` 停在创建值而文档已变。新件的事实写进创建数据（粘贴容器先入批、橡皮拆段带 `parentId`），或移到事务外写 |

## 7. 性能

- 归属判定：落点后对 `selectedIds` 逐个 × 容器扫描 → O(k·n)。1e3 控件、k < 10 可接受。
  不做容器索引（容器数量级 < 50）。
- 展开/级联：O(n) 一遍扫描，与 `groupService.indexMembers` 同款。
- 渲染：容器是普通 Graphics + Text，进 culling 与空间索引，无新增渲染路径。
- 已知取舍：容器不裁剪，越界子元素照常绘制（回到普通 culling 语义）。

## 8. 验收

### 8.1 单测（vitest）

| 文件                               | 覆盖                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| frameGeometry.test.ts              | 标题带 top/left 几何、退化不抛、命中（带内/环内/内部空白/环外）、`truncateTitle`                                                                                                                                         |
| frameOps.test.ts                   | `resolveParentUpdate` 四态与判定顺序、多容器取最上、`expandContainers` 去重保序、`clampFrameZOrder`（含 prev=null 边界）、`remapParentIds`（桶映射/批外置空）、`mergeFramesIntoSelection`（全含/半含/不拆组/子元素剔除） |
| frameService.test.ts               | 创建即归属同事务、已有父/批量上下文不重判、画笔与连线不参与、删容器连子、微移展开、设父同事务钳制与零钳制写、图层钳制、`detachSelection`、只读早退、一次 undo                                                            |
| frameAdoptionFidelity.test.ts      | 真 Y.Doc + 真 DataEngine + 真 HistoryService：工具创建归属；粘贴批 / undo·redo 恢复不重判（已有父不清、无父不收养）、无幻影撤销项、标记不粘连（§4.2）                                                                    |
| clipboardFrame.test.ts（扩）       | 粘贴收尾调 adoptByLanding 的时序（粘贴批之后另起事务、stopCapturing 之前）；无容器语义不调                                                                                                                               |
| clipboardLanding.test.ts           | 真 Y.Doc + 真引擎 + 真 ClipboardService：无父副本落进容器归属、跨界保持顶层、带父副本不改判、落在同批容器副本内归属、一步 undo / redo 保留、画笔副本不参与                                                               |
| frameTitleEditor.test.ts           | 提交/同值不写/空标题 keep/Enter 提交/Esc 丢弃/只读早退                                                                                                                                                                   |
| selectorDrag.test.ts（扩）         | 拖容器：展开 ids、`selectedIds` 未展开、预览/取消/提交各分支                                                                                                                                                             |
| selectorMarquee.test.ts（扩）      | 容器全含入选、半含剔除、组在容器内不拆组                                                                                                                                                                                 |
| refLineService.test.ts（扩）       | 拖容器时子元素不进参照物                                                                                                                                                                                                 |
| alignCommand.test.ts（扩）         | 容器不计入参与数（对齐/分布禁用态）                                                                                                                                                                                      |
| widgetRegistry.test.ts（自动覆盖） | 三表一致、能力位、Union 锁                                                                                                                                                                                               |

### 8.2 E2E（`container.spec.ts`）

| 用例                    | 断言（探针 = `__spinthDebug.__debug.vmStates`；批量路径的归属断言读 `model.toJSON()` 文档真值——vm 状态在粘贴批 / 恢复批后可能陈旧，§6.6 陷阱 11）                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-1 创建与标题          | 拖拽画容器 → 选中；改标题 → `title` 落库；一步 undo 回空标题                                                                                                                               |
| C-2 创建即归属          | 容器内画形状 → 该形状 `parentId === frame.id`                                                                                                                                              |
| C-3 拖动带子            | 拖容器 (+80,+40) → 子元素 x/y 同步位移；undo 一步全回                                                                                                                                      |
| C-4 拖出脱离            | 子元素完全拖出 → `parentId` 消失；只相交（部分在外）时不变                                                                                                                                 |
| C-5 拖入归属            | 外部形状完全拖进 → `parentId` 写入                                                                                                                                                         |
| C-6 删除级联            | 删容器 → 容器与子元素都消失；undo 一步全回（含 parentId）                                                                                                                                  |
| C-7 缩放不缩放子        | 拖角放大容器 → 子元素 rect 逐值不变                                                                                                                                                        |
| C-8 复制粘贴            | 复制容器 → 粘贴：新容器 + 新子元素，`parentId` 指向新容器；拖新容器，原件不动                                                                                                              |
| C-9 框选口径            | 全含容器入选且子元素不并入；半含容器不入选                                                                                                                                                 |
| C-10 容器在子之下       | 容器置顶（Cmd+Alt+]）→ 点其子元素命中子元素（`getVmByPoint` 首项）                                                                                                                         |
| C-11 只读               | 只读态按 C 不出工具、拖动不写、标题不进编辑、右键无「移出容器」                                                                                                                            |
| C-12 项目文件           | 导出 → 导入：容器/标题/`parentId`/headerSide 全部往返                                                                                                                                      |
| C-13 三泳道样本         | 3 个 `headerSide:'left'` 容器 + 每行 2 任务 + 跨行正交连线；移动第 2 行 → 该行任务跟随、他行不动；导出 PNG 成功                                                                            |
| C-14 恢复保真           | 框外子随容器删除后 undo：文档 `parentId` 仍是原容器、容器几何只回退删除、再 undo 回退缩放（无幻影撤销项）；先画后框的形状 undo 后仍是顶层                                                  |
| C-15 粘贴保真与落点归属 | 复制「容器 + 框外子」→ 副本子 `parentId` 指向副本容器（文档真值）；无父件的副本落进容器内即归属（文档与 vm 状态一致）→ 拖容器副本跟随 → 一步 undo 回退拖动、再一步回退粘贴 → redo 保留归属 |
| C-16 粘贴层级           | 选区序 [子, 容器] 粘贴：副本容器 zOrder 在文档层与渲染层（`vmPositions` 的 `root.zOrder`）都低于副本子；点子副本中心命中子副本                                                             |
| C-17 不误收画笔         | 左上角有容器时，在别处画一笔画笔、拉一条自由线：两者文档均无 `parentId`（前置断言占位矩形确在容器内、线确为自由线）                                                                        |

E2E 辅助：在 `e2e/helpers/widgetProbeE2e.ts` 加 `createFrameByDrag(page, rect)`（按 C、拖框、Esc 回 cursor），
C-1..C-13 共用，避免 13 份手写手势。

### 8.3 视觉基线

- `container-sample`：三泳道（左表头）+ 每行 2 个形状 + 跨泳道正交连线 + 一条容器边框。
- 双平台（darwin / linux）各 1 张；提交前 `pnpm visual:linux -- --stability` 双跑全等。
- 场景内清 UI 入镜（除 theme 双态外一律 clip，specs/linux-visual §14.10 口径）。

### 8.4 门禁

`pnpm verify` + `pnpm test:e2e` + `pnpm visual:linux` 全绿；新增文件均 < 400 行；
`check-visual-baselines` 认到新基线。

### 8.5 与既有用例的回归面（必须跑，不许跳过）

`mobile.spec`（工具坞 +1 按钮）、`a11yLayout.spec`、`flowchart.spec`、
`historyLayer.spec`（图层命令）、`align.spec`、`clipboard.spec`、`groupOps.spec`、
`refline.spec`、`projectFile.spec`、`multiTabReadonly.spec`。

### 8.6 手工验收

1. 画容器 → 里面画 3 个形状 → 拖容器：形状跟随、选区框跟随、网格/参考线正常。
2. 把形状分几次拖出容器：跨界期间不脱离，完全出去才脱离；再拖回来自动归属。
3. 删容器 → 一步 undo 恢复，形状仍在原位、仍归属。
4. 复制容器 → 粘贴 → 拖动其一，另一个不动。
5. 0.2x 与 4x 缩放下都能靠标题带/边框选中容器（命中环折算生效）。
6. 只读标签页：容器可见、工具不可用、拖动无效。
7. 390px：工具坞「容器」可达、画框可手指操作、无横向溢出。

## 9. 实施分期

| 期  | 内容                                                                            | 出口（命令 + 断言）             |
| --- | ------------------------------------------------------------------------------- | ------------------------------- |
| P0  | schema + 注册 + Model/Vm + 几何/命中 + 单测                                     | `pnpm -r test` 绿；容器能画出来 |
| P1  | 归属（创建/落点/脱离/移出）+ 拖拽展开 + 微移 + 删除级联 + 图层钳制 + 参考线排除 | C-2/3/4/5/6/10 绿               |
| P2  | 剪贴板展开/重映射 + 框选归并 + 对齐剔除 + 标题编辑                              | C-8/9 绿 + 对应单测             |
| P3  | 工具坞 / ActionBar / 右键 / 快捷键 C / ToolGhost / 对比度护栏                   | C-1/11 绿；`mobile.spec` 绿     |
| P4  | 三泳道样本 E2E + 视觉基线 + docs 同步                                           | C-13 + 视觉双平台绿             |

每期一次提交（`feat: ` 前缀 + 中文描述），可单独回退；P1 之前不要动剪贴板与框选。

## 10. 文档同步清单

| 文档      | 改什么                                                                 |
| --------- | ---------------------------------------------------------------------- |
| docs/04   | §4 能力位表加 FRAME；§8 控件清单加一行（容器/标题带/归属）             |
| docs/05   | §3 选中口径（容器命中带）；§4 拖拽带子；§6 微移展开；§7 对齐剔除       |
| docs/02   | §2 文档结构：parentId 字段与归属不变量                                 |
| docs/16   | §1 culling/索引：容器无特殊处理（一句）                                |
| docs/18   | 「容器与编组的关系」交叉引用（几何层优先）                             |
| docs/09   | 右键菜单增「移出容器」；快捷键表增 C                                   |
| docs/12   | 工具坞增「容器 (C)」、ActionBar 容器项                                 |
| docs/13   | §4.4 状态改「已完成（容器底座）」；§4.0 底座表「容器/Frame」标注已落地 |
| docs/15   | 单测/E2E 计数与用例清单                                                |
| AGENTS.md | 「当前状态」补 4.4 容器底座一段                                        |

## 11. 风险与回滚

| 风险                      | 处置                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| 落点自动归属「吞件」意外  | 全含判据有滞回 + 「移出容器」显式出口 + 建容器不收养；若用户仍觉意外，退回「只创建时归属 + 菜单归属」 |
| 容器盖住子元素导致点不到  | I3（归属/图层/粘贴三处钳制）+ C-10 锁死                                                               |
| 大容器吃掉画布点击        | 命中只认标题带/边框环；内部空白照常清选区                                                             |
| undo 裂项                 | 归属写必须在触发事务内（I6）；C-3/C-6 断一步 undo                                                     |
| 参考线吸到自己的子元素    | 参照物排除 previewIds + 单测                                                                          |
| 组 + 容器框选边界         | §4.3 四条规则 + 单测；不做自动拆分                                                                    |
| 老客户端打开新文档        | 未知类型隔离 + 未知键保留，元素位置不丢（§2.5）                                                       |
| 工具坞 9 个按钮挤爆 390px | P3 跑 mobile/a11yLayout；溢出走既有 flex-wrap                                                         |
| 400 行铁律                | Service 超限拆 `frameTitleEditor` / `frameAdoption`                                                   |
| 快捷键冲突                | 已核：C 未被占用；F 属 view.zoomFit 不得占用                                                          |

回滚：`FRAME` 是新增类型，回退只需删注册项与相关文件；已存文档中的 `FRAME`
在老版本进隔离区，`parentId` 键保留，数据不损坏。

## 12. 已拍板与挂账

**已拍板（2026-11-22，人类确认）**

1. **建容器不收养既有元素**：归属只来自「落入」（在框内创建 / 拖进去）或右键显式命令。
2. **容器内部空白不命中**：只认标题带 + 边框环；点空白照常清选区。
3. **容器工具快捷键**：人类原定 F；核查发现 F 已被「适应屏幕」占用（`view.zoomFit`，
   右键菜单 hint 即 F），**改用 C**（Container）。若后续坚持 F，需把 zoomFit 改绑
   （破坏既有习惯），不在本批范围。
4. 其余 §0.2 全部口径（单层、不裁剪、连子删、不缩放子、容器在子之下、容器不参与对齐、
   容器不可编组）一并确认。

**挂账（不在本批）**

- SWIMLANE 专属控件（车道增删/排序/合并、右侧提示列）——二期 `specs/swimlane.md`。
- 嵌套容器、容器内自动布局、容器收养既有元素、容器旋转。
- BPMN 池/泳道语义（4.7 另立 spec）。
- 自由线拖端点后不重判归属（端点拖拽不经 `reconcileParents`；画笔与连线已不参与自动
  归属，此缺口只影响「拖入过容器的自由线再把端点拖出容器」）。

**已拍板（实施期补充，2026-11-24 人类确认）**

- **粘贴落点归属**：粘贴出的无父副本完全落进存活容器即归属（与拖放落点同款判据；
  带父副本、画笔 / 连线副本不参与）。实施时曾先定为「粘贴不触发归属」，三种粘贴
  （文本 / 图片 / 快照）行为不一致，人类拍板改为归属。代价：粘贴结果取决于落点处的
  容器（应用内落点恒为视口中心），归属带来级联移动与连子删。
- **画笔与连线的自动归属只堵错误归属**：两类不参与创建 / 粘贴落点的自动归属，
  不做收笔后按整笔全含的补判；要归属可拖入。

## 13. 设计自审（铁律对账）

| 铁律           | 落点                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| 1 文档即规格   | 本 spec + §10 同步清单                                                                                         |
| 2 接口先行     | §2 schema、§6.4 签名先于实现                                                                                   |
| 3 数据流铁律   | 拖拽只做视觉预览；松手经 commitDrag + 事务内归属写回；无绕过 Yjs 的写                                          |
| 4 显式依赖     | FrameService 构造注入六依赖；晚绑定用惰性 getter，无全局单例                                                   |
| 5 单文件单职责 | §6.2 已切分；超 400 行再拆                                                                                     |
| 6 测试护栏     | 纯逻辑单测 / 服务桩测 / 整机 E2E / 视觉基线四层                                                                |
| 7 三件套       | Model/Vm/Service + 双表注册；不改 dataEngine/vmEngine                                                          |
| 8 单机优先     | 零服务端依赖；容器与归属全在本地 Y.Doc                                                                         |
| 渲染同步六条   | 展开后逐个 applyDragPreview（绝对定位）+ 松手末帧落库；无增量累加、无隐式跨帧状态（事务内一律算术或 model 读） |

## 14. 实施手册（给实施 agent）

**顺序**：P0 → P1 → P2 → P3 → P4（§9）。每期结束必须跑：

```bash
pnpm -r test          # 或至少 pnpm --filter @spinth/core test
pnpm typecheck
pnpm lint
pnpm format:check
```

P1/P2 完成后追加 `pnpm test:e2e -- container.spec.ts`；P4 完成后跑全量 `pnpm verify` + `pnpm test:e2e` + `pnpm visual:linux`。

**硬约束**

1. 不改 `dataEngine` / `vmEngine` / `culling` / 导出 / 项目文件 / history。
2. 不新增 `BoardPublicApi` 成员（`boardPublicApi.ts` 的 allowlist 保持 71）。
3. 新依赖一律可选尾参（§6.4），既有测试构造点零改动。
4. 单文件 < 400 行；新文件命名 `frameXxx.ts`。
5. 事务内不读 vm 的几何/zOrder（§6.6-1）。
6. 归属写只经 `FrameService`（I5）；其它模块只调用，不手写 `update({ parentId })`。

**遇到歧义**：先按本 spec 最近条款实现并在 §16 记一行；若 spec 无对应条款，停下来问设计者，
不要自造语义（尤其：命中规则、归属判据、事务边界、公开面）。

## 15. 审查清单（设计者复核时逐条核对）

1. 命中是否真的「标题带 ∪ 边框环」（手点内部空白 → 清选区，不选容器）。
2. 归属四态顺序是否与 §2.4 一致（尤其「仍全含于当前父 → 不改」优先于「换父」）。
3. 拖容器：`selectedIds` 未展开、`ids` 已展开；一次 undo；子元素 x/y 精确等于 delta。
4. 事务内没有 vm 读取（搜 `getBounds()` / `root.zOrder` 出现在 commit 路径）。
5. 参考线参照物已排除 `previewIds`。
6. 删除/复制/剪切/微移四路都走 `expandForCascade`。
7. 粘贴 `parentId` 桶映射 + 批外置空 + 容器先入批（§4.7）。
8. 图层命令后容器仍在其子之下（C-10）。
9. 对齐/分布参与集不含容器（按钮禁用态正确）。
10. 只读四闸门（工具/指针/命令/标题编辑）都在。
11. 公开面 71 不变；`CursorMode` 只多 `'frame'`。
12. 文档同步清单 10 项逐条落地；`pnpm verify` 与全量 E2E 绿。

## 16. 实施记录（实施 agent 填写）

| 期  | 提交                                                                                   | 实测                                                                                      | 偏差 / 决策                                                                 |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P0  | f5e146a / 7f0c0b4 / 219530f / 4107948                                                  | core 单测绿；容器可渲染（vmStates 可断言）                                                | 注册三表与 Model/Vm 同笔提交（WIDGET_RUNTIME satisfies 键锁要求三表同步落） |
| P1  | 7726da6 / b86f379 / 3de9622 / ba0d97f / 57b4731 + container.spec（C-2..C-6/C-10 全绿） | 单测 1334 绿；E2E 6 例绿                                                                  | 见解读 ①②③④                                                                 |
| P2  | 9ccf3d3（P2-10/P2-11/P2-12 三笔）                                                      | 单测 1346 绿；E2E C-8/C-9 绿                                                              | 见解读 ③⑤                                                                   |
| P3  | 16e8e0d / 499ca63 + 669d0b8（桩补）                                                    | mobile 9 + a11yLayout 10 回归绿；E2E C-1/C-11 绿                                          | 见解读 ⑥                                                                    |
| P4  | 3f4ac4c                                                                                | C-12/C-13 绿；visual:linux --update + --stability 11 张 SHA-256 全等；darwin 基线目检通过 | —                                                                           |

**实施解读回填（按 §14「遇到歧义记一行」）**

- ① **「创建即归属」接线**：§6.2 改动清单不含各创建服务——FrameService.initialize
  订阅 `engine.onModelCreated$` 对每个新建控件调 `adoptOnCreate`（跳过
  FRAME/树/锚定线）；与创建同一 undo 捕获窗（创建工具 up 才 stopCapturing）。
- ② **锚定线 I2 落地口径**：按 §2.2「运行时排除」——FrameService `childIds`/
  `expandForCascade` 读侧过滤 + `reconcileOne` 写侧拒绝；不改
  lineEndpointDrag.ts（不在 §6.2 清单）。存量锚定线带 stale parentId 为惰性
  数据（任何级联/归属路径都不读它）。
- ③ **platform → widgets 零反指的代价**：layerService/selectorMarquee 需要容器
  纯逻辑，但 platform 层 import widgets 无先例——`IFrameLookup` 增
  `computeLayerClamps(post)` 与 `createMarqueeFrameFilter(groups)` 两方法
  （实现都在 FrameService、纯函数仍在 frameOps）：签名面较 §6.4 扩两方法，
  其余逐字一致。
- ④ **drag/微移 rectOf**：commitDrag transact 内联闭包（initial+末帧位移，
  未动件 fallback model）；nudgeSelected 同款（getLocalRect+位移）。
- ⑤ **粘贴层级**：容器快照排到批首，zOrder 按入批序递增生成，副本容器 key
  必然低于批内全部子元素（genInitialOrder 递增）。初版按本节原文「全部 add 后再
  对批内容器 `clampFrameZOrder`」落地，三轮审查实测该写入不达渲染层——同事务内
  紧随创建的写入对刚挂上的 vm 观察者不可见（§6.6 陷阱 11），改为容器先入批。
- ⑥ **右键「移出容器」命令通道**：公开面 71 不变——经
  `updateSelectedStyle({parentId: undefined})` 通用通道在 styleCommands 分流
  到 `FrameService.detachSelection`（treeCollapsed/treeOrientation 同款分流
  先例），I5 唯一写入口保住。
- ⑦ **标题缺省色**：§2.1「主题墨色」与 §5.4 双态护栏冲突（dark 墨色 #ededf2
  落白带 1.87:1）——按 §5.4 落地 `resolveFrameTitleColor`（titleColor 优先；
  填充实色随带底自适应 #333/#fff（SHAPE defaultTextColorForFill 同款判据）；
  无填充对画布走主题墨色）；护栏测试在 shapeContrast.test。
- ⑧ **E2E 桩口径**：engine.add 不生成 id（data.id 直用）——页内生成；不包
  外层 transact（外层事务内创建后紧接的写入对 mid-transaction 挂上的 vm 观察者
  不可见，vm.state 停在创建值——生产路径的工具创建无此外来事务）。批量路径
  （粘贴批 / 恢复批）的归属断言一律读 `model.toJSON()` 文档真值（C-14/C-15），
  层级断言另读 `vmPositions` 的 `root.zOrder`（C-16）。

**审查返工（2026-11-22 第二轮审查，全部收口 fdfaea0..6156ba3）**

- P1：归属写入后未钳制 zOrder（I3 拖入路径缺位——先有内容后画泳道再拖入时
  白底盖住子元素）。修法：`reconcileOne` 设父分支同事务内联 `clampFrameInTx`
  （不走 `clampFrame()`——它自开事务 + stopCapturing 会裂 undo 项）；单测先红
  后绿 + C-10 补 zOrder 断言与拖入钳制场景。
- C-7 缺失补齐（缩放手柄外扩 → 子 rect 逐值不变）；darwin theme 双态基线
  陈旧（工具坞 10 钮）删文件强制重生成（2% 容差会吞掉少一个按钮的漂移）。
- I2 口径改「运行时排除」（写侧拒绝 + 读取侧过滤；转锚定不清字段——stale
  parentId 惰性），`detachSelection`/`canDetachSelection` 同款拒绝锚定线。
- 400 行：boardActionBar 435 → 383（FRAME 五项抽 `frameActionBar.ts`）；
  selectorService 432 → 398（树按下门 `selectorTreeGate.ts`、框选闭包构建
  `buildFrameMarqueeFilter`、选区框同步 `syncSelectionFrame` 三刀拆出，逻辑
  逐字搬移零行为漂移——60 项 selector/mind 单测全绿）。
- 文档订正：AGENTS 计数（1468 单测 / 57 spec 331 例）与「八条解读」、
  docs/05 标题层级（4.4 复位 h3、容器拖拽带子改挂 §4.6）、docs/15 明细账
  （clipboardFrame 4 + selectorMarquee +1）。

**审查返工（2026-11-24 第三轮审查，全部收口 4a992e5..ed22b7b 及文档同步提交）**

- P2 `adoptOnCreate` 重判既有归属：审查给出的场景是「缩小容器产生的框外子在粘贴时
  被三态判据按完全离开清父」。读码发现面更大——undo·redo 恢复（观察者相重建模型
  → 同一创建事件）同样重判，且无父件被收养（先画后框的形状删后 undo 进了后画的
  容器；粘贴的无父件落进容器也被收养）。审查建议的「parentId 已指向存活 FRAME 则
  返回」只盖住前一半：恢复批里容器与子同批重建，顺序不保证子建时容器已存活。
  修法两道守卫——① 批量上下文不重判（`yDoc` 的 `beforeAllTransactions` /
  `afterAllTransactions` 置标记；工具创建在事务外，`DataEngineService.add` 的内层
  事务收尾之后才发 `onModelCreated$`）；② 已带 `parentId` 不重判。§4.2 同步。
- 连带：橡皮拆段在事务内新建笔迹段，此前靠「碰巧重判」兜底归属——批量上下文抑制
  后会永久脱容器，改为创建数据继承 `parentId`（单测补齐）。
- 真引擎集成测试 `frameAdoptionFidelity.test.ts`（真 Y.Doc + 真 DataEngine + 真
  HistoryService）：修前 5 红 1 绿，修后 6 绿。桩测的 vmEngine 即时一致，测不出
  「同批容器尚未建出」的时序。
- **E2E 假绿**（补审查建议的 E2E 锁时发现）：C-14/C-15 初版读 `vmStates`，修前实现
  下照常通过。探针实证旧代码确实写了清父值、文档已无父，但 `vm.state` 仍显示归属
  ——批量路径中紧随创建的写入不达 vm 状态（§6.6 陷阱 11；当时另叠着 VM 基类
  丢写一因，见下）。即旧 bug 的真实表现是「文档丢归属、界面照旧」，刷新后子件变顶层、拖容器
  不带它。C-14/C-15 改读 `model.toJSON()`，修前实现下两例均红。
- **粘贴层级不达渲染层**（由上一条延伸发现，审查清单外）：选区序 [子, 容器]
  （先点子再 Shift 点容器）时粘贴批子先入批，容器副本 zOrder 更高；原
  `computeLayerClamps(zTable)` 的事后钳制与创建同事务——文档钳了、`root.zOrder`
  没动，白底容器盖住子副本直到刷新（C-16 文档层通过、渲染层先红）。修法：容器
  先入批（§4.7 / §16 ⑤）。原单测只断言「有一次 zOrder 写入」、桩返回的甚至不是
  更低的 key，改为断言入批序与 key 关系。
- 行为决策（超出审查清单）：粘贴快照不触发创建归属——无父件的副本落进容器内仍是
  顶层（I5 三条写路径不含粘贴；要归属就拖一下）。纯文本/图片粘贴走事务外
  `engine.add`，仍按创建处理。
- P3：`clampFrame()` 生产零调用已删（归属钳制唯一入口 = `reconcileOne` 设父分支
  `clampFrameBelowChildren`，即二轮的 `clampFrameInTx`；图层命令走
  `computeLayerClamps`）；`swatches` 提至 `actionBarOptions` 单源（boardActionBar
  / frameActionBar 共用）；C-10 拖入钳制补 undo 断言（位移 + 设父 + 钳制同事务
  一并回退）。
- 实证方法备忘：Shift 加选在 E2E 里必须 `keyboard.down('Shift')` 显式按住——
  `mouse.click` 的 `modifiers` 选项在本应用不产生 shiftKey（实测选区被替换）。
- 全仓扫描：生产代码里「事务内 add 后紧接 update」只有橡皮拆段一处，且对新段只走
  创建数据——陷阱 11 在本批无其他实例。
- **VM 基类既有缺陷（清单外，同批修复）**：`BaseWidgetVm.setState` 的 diff 曾对尚未
  应用微任务合批的旧 state 计算——同一 tick 内「`setModel` 快照含某键 → 写回初值」
  的第二条 partial 被判同值丢弃，vm.state 与文档分叉（独立单测复现：真 Y.Doc +
  VM 子类，`setModel` 后同 tick 清键，文档无键而 state 留旧值）。它是上面 E2E
  假绿的直接原因之一。修法：diff 基准改为「已应用 state + 待合批 partial」
  （`base/baseWidgetVm.ts`）；锁在 `renderSync.test.ts` 两条（直接写回 / `setModel`
  后同 tick 清键，修前均红）。全仓 14 处 `engine.add` 之后紧接写入的只有 1 处且
  写的是另一个模型——修复前无已知触发路径，属预防性修复。

**后续实施（2026-11-24，人类拍板后）**

- **VM 基类丢写已修**：`BaseWidgetVm.setState` 的 diff 基准改为「已应用 state + 待合批
  partial」（见上文「VM 基类既有缺陷」）。`renderSync.test.ts` 两条锁修前均红。
- **画笔与连线的创建归属**（规划修复时的核查发现，人类拍板「只堵错误归属」）：两类
  落笔即建件，建件数据不含矩形，模型矩形取默认占位值 `{0,0,100,100}` 且从不随
  `points` 更新；创建归属却按模型矩形判定。实测（E2E C-17 修前）：左上角画一个
  容器，在 (600..720, 400..440) 画一笔，笔画的 `parentId` 等于该容器。修法：
  `frameOps.isAutoAdoptableType` 单源判定参与资格，`adoptOnCreate` 守卫。不做收笔后
  按整笔全含的补判——画在容器里的笔画保持顶层，要归属拖入。
- **粘贴落点归属（同批实施，人类拍板 B）**：`IFrameLookup` 增 `adoptByLanding(ids)`，
  自动归属的参与资格（无父 + `isAutoAdoptableType`）在 FrameService 单源；创建即归属
  守卫后委托它，`ClipboardService.pasteSnapshots` 在粘贴批事务之后、`stopCapturing`
  之前另起事务调用（批内写入对刚建 vm 的观察者不可见；同一捕获窗 = 一步 undo）。
  真引擎集成 `clipboardLanding.test.ts` 6 例（`makeFrameEnv` 自 frameAdoptionFidelity
  抽到 helpers 共用），E2E C-15 后半段翻转并补拖容器跟随 / 两步 undo / redo。反向
  验证：禁用该调用，4 例单测 + C-15 后半段应红。

**后续修复（2026-11-26）**

- **FrameService 纳入销毁序列**：`boardTeardown.ts` 此前没有 `frame` 行（符号控件有、
  容器漏了）。`initialize()` 注册的 `onModelCreated$` 订阅永不 complete，引擎一直
  持有 FrameService；yDoc 两个批量事务监听也要到 `engine.dispose()` 才随文档销毁。
  修法：`host.frame?.dispose()` 紧随 `symbolService`（早于 engine）。护栏
  `boardSdkDispose.test.ts`（dispose 一次 + 调用序早于 engine + 二次不再执行），
  修前红。
