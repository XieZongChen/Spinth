# UML 时序图（4.5）技术方案

> 对应 docs/13 阶段 4.5「UML 时序图」，走该节「补足 / 开发」的 A 路线（图元套件）；
> B 路线（SEQUENCE 语义控件：参与者 / 消息序列 / 自动布局 / 编号）明确后置。
>
> 状态：**实施中——分批实施，批次 1（地基 + 生命线）进行中**，批次划分见 §12、
> 实施记录见 §19。十项拍板（2026-11-26）全部按推荐方案定稿，结论见 §0.2，
> 取舍理由见 §15；被否决的分支已从正文删除。
>
> 依据：docs 00–22 相关篇目；specs/container-frame、specs/symbol-widget、
> specs/flowchart-closeout 三份先例；代码事实核对到函数级（2026-11-25；行数与
> 切回折线路由于 2026-11-26 复核）。

## 0. 摘要

### 0.1 一句话

新增 `LIFELINE`（参与者头 + 竖直虚线轴）与 `ACTIVATION`（绑定生命线的激活条）两个
控件；消息复用 `LINE`，在连线子系统补「轴锚定」一簇能力（按下点定端口、消息恒
水平、沿轴平移、加长保高度、自消息）；组合片段复用 `FRAME` 预设。全部写入走既有
Yjs 事务，旧文档零迁移，流程图连线行为逐字节不变。

### 0.2 关键决策（先看结论）

D1–D14 连同 §15 的十项拍板，已于 2026-11-26 全部按推荐方案定稿。

| 编号 | 分叉         | 结论                                                                                                    | 主要理由                                                                                     |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| D1   | 消息承载     | 复用 `LINE` + 拉线策略，不新建 MESSAGE 控件                                                             | 线型 / 箭头 / 虚线 / 标签 / 剪贴板 / 撤销 / 导出 / 只读全部现成；新控件要把这一圈重做        |
| D2   | 轴锚点       | 生命线覆写 `getAnchorPoint`，任何 join 都落在轴上；port = 轴上高度比例                                  | SYMBOL 图形区锚点先例；端口字段、跟随、落库零新增                                            |
| D3   | 端口来源     | 轴宿主上的按下点 / 松开点直接写显式 port                                                                | 新线缺省落 0.5 中点，否则全部消息堆在生命线中点                                              |
| D4   | 消息方向     | 时序工具建出的消息恒水平（终点取起点高度）                                                              | 消息是水平箭头；要斜线用通用连线工具                                                         |
| D5   | 消息移动     | 直线轴消息可拖线身、可上下微移，两端同步                                                                | 「线不可整体拖动」让改时间位置只能逐个拖端点                                                 |
| D6   | 高度稳定     | 生命线顶边或高度变化后重写其上端口，保住绝对高度                                                        | port 是比例；加长生命线不该把已有消息按比例推走                                              |
| D7   | 激活条       | 独立控件，`lifelineId` 绑定生命线，随生命线移动 / 复制；删生命线连带删条，消息只解绑                    | 纯 SHAPE 不跟随，且会被片段容器收养；连子删同 FRAME，一步 undo 可回                          |
| D8   | 消息附着     | 消息只附生命线轴；轴被激活条覆盖时锚点让到条边                                                          | 调整激活条不该拖走消息端点                                                                   |
| D9   | 组合片段     | `FRAME` 预设（无填充 + 标题即类型）；分隔线 = 两端自由的虚线                                            | 4.4 底座已交付标题、边框、命中；专用五角标签页收益低                                         |
| D10  | 线上文字侧别 | `LINE` 增 optional `textSide`（上方 / 下方），本批做                                                    | 消息标签按惯例在线上方；流程图、类图的连线标签同受益                                         |
| D11  | 工具入口     | 工具坞单入口「时序图 (Q)」+ 三组二级菜单，单一 `CursorMode 'sequence'`；第 12 钮，主题色沿用 shape 槽位 | 一个模式只能注册一组指针处理器；树形图单入口先例；Q 是空闲字母里唯一能让人联想到 sequence 的 |
| D12  | 模板         | 不做；样本进 E2E 夹具与视觉基线                                                                         | 用户面没有插入示例的机制；不在 4.5 完成标志内                                                |
| D13  | actor 头     | 本批做（批次 4）：`head: 'box' \| 'actor'`，ActionBar「头部样式」切换                                   | 登录时序样本用到；成本是一个小人群制 + 一项 ActionBar                                        |
| D14  | 范围         | §0.3 范围外清单照单确认，本批不追加                                                                     | 十项拍板时一并确认                                                                           |

### 0.3 不做什么

- 语义模型：不做 SEQUENCE 语义控件（参与者 / 消息序列 / 自动布局 / 编号 / 校验）。
- create / destroy 消息、丢失 / 发现消息、时长约束、门、交互引用（ref）专用形状。
- 嵌套激活条；消息自动回水平；激活条与片段的自动排布。
- 逐实例着色（生命线与激活条外观固定）；模板 / 示例库；SVG 导出。
- 不改 dataEngine / vmEngine / culling / 空间索引 / 导出 / 项目文件管线；
  `FrameService` 的归属逻辑不改（只加一个创建预设读取）。
- 不新增 `BoardPublicApi` 成员（71 不变）；`CursorMode` 增 `'sequence'` 属类型面 additive。

### 0.4 分工

- **设计 / 审查**：本文件作者。实施偏差、口径歧义、新增分叉回写 §19 并找设计者确认，
  不得自行扩大范围。
- **实施**：另一 agent。顺序见 §12，硬约束见 §17，交付前自检 §18。

## 1. 现状审计

### 1.1 能力地图与现状基线

gap 编号 G-01…G-11 贯穿全文；`—` = 无缺口。

| #   | 能力            | 现状基线                                                  | 时序图需要                           | gap       |
| --- | --------------- | --------------------------------------------------------- | ------------------------------------ | --------- |
| A   | 参与者与生命线  | 无（SHAPE + 竖直虚线可拼，但两件、不跟随、轴上不可锚）    | 头 + 轴一件，轴上任意高度可锚        | G-01 G-02 |
| B   | 激活条          | 无                                                        | 贴轴细条，随生命线走                 | G-03      |
| C   | 消息线型        | 三线型 × 首尾独立四态箭头 × 虚线 × 线宽                   | 同步 / 异步 / 返回三种配出来         | —         |
| D   | 消息创建        | 拉线落边中点 0.5，端口只能事后拖端点                      | 按下点 / 松开点即端口，消息恒水平    | G-04      |
| E   | 消息移动        | 线不可整体拖动；纯线选区不建拖拽会话                      | 拖线身、上下键改时间位置，两端同步   | G-05      |
| F   | 高度稳定        | 宿主缩放后锚点按比例重算                                  | 加长生命线，消息不动                 | G-06      |
| G   | 自消息          | 同边自环仅 ELBOWED 且端口缺省 0.5；直线同节点是两点间线段 | 同轴不同高度的小环                   | G-07      |
| H   | 消息标签        | 单标签居中镂空，只能沿路径滑                              | 标签在线上方                         | G-08      |
| I   | 组合片段        | FRAME：标题带 + 边框 + 命中带                             | 透明框 + 类型标题 + else 分隔        | G-09      |
| J   | 容器归属        | 七类可归属；FRAME / 树 / 画笔 / 连线不参与                | 生命线、激活条不进容器               | G-10      |
| K   | 对齐 / 吸附     | 参考线 + 等间距 + 对齐分布                                | 顶对齐、等间距；对齐分布时激活条随行 | G-11      |
| L   | 目标拾取 / 避障 | 非 LINE / PEN 即连线目标与 quick-add 宿主；缺省入障碍集合 | 激活条不拦指针；生命线不作障碍       | G-10      |
| M   | 工具入口        | 工具坞 11 钮；一模式一组指针处理器；无模板机制            | 单入口多图元                         | —         |
| N   | 数据            | Yjs + undo + IndexedDB + 项目文件 + 只读                  | 新类型、新字段零迁移                 | —         |

### 1.2 缺口逐条（代码事实）

- **G-01 生命线图元不存在**。20 型 SHAPE 都是「轮廓 + 框内文字」（specs/symbol-widget
  §1.1 的审计同样成立）。用 SHAPE + 竖直虚线拼是两个控件：移动不跟随，虚线也不能作
  锚定宿主（`lineHitTest.hitWidget` 只认控件 bbox 边）。
- **G-02 锚点只在 bbox 边上**。锚点单源是 `IBaseWidgetVm.getAnchorPoint(join, t, geom?)`，
  基类按 bbox 边插值。`lineGeometry.nearestJoin` 用归一化偏移判最近边，
  `|dx| > |dy|` 才返回 left / right——落在高瘦矩形中部的按下点会被判成 top 或 bottom。
- **G-03 激活条不存在**。`frameOps.isAutoAdoptableType('SHAPE')` 为真：在片段内画出的
  窄矩形会被 FRAME 收养，拖片段时条跟走、生命线不动。
- **G-04 拉线不写端口**。`LineDrawSession.pointerDown` / `applyMove` 经
  `nodeAnchorPoint(..., join)` 取点，t 恒 0.5；`startPort` / `endPort` 只有端点拖拽
  （`LineEndpointDrag.onMove`）会写，且只保留两位小数。
- **G-05 线不可整体拖动**（docs/08 §3 成文边界）。`LineVm` 的四个交互几何覆写是空
  操作；`selectorDragOps.createDragState` 对纯线选区直接返回 null；线身抓取
  （`lineSegTextSlide.maybeSegmentSlideGrab`）只认 ELBOWED。
- **G-06 端口是边长比例**。宿主高度变化后 `LineAnchorFollow.routeLinePoints` 按
  `t × 新边长` 重算。缩放期间没有连线跟随（`resizeMove$` 唯一订阅者是 `followQuickDots`）；
  松手后的 `rectEditor.onResizeCommitted` 只给新矩形，拿不到旧几何。
- **G-07 自消息路由不完整**。`routeSelfLoop` 同边分支在两端点相距 ≥ 8 世界 px 时原样
  保留两端并出 4 点环（深度 `NODE_MARGIN` 30）——这部分可用。但该分支只在 ELBOWED、
  非 pinned、两端 join 齐备时进入；`routeLinePoints` 对 STRAIGHT 同节点线只在两锚点
  之间连一条直线（与轴重合，不可见）；端口缺省两端 0.5，会走「锚点重合、跨度 80」分支。
- **G-08 线上文字只有骑线镂空一种形态**。`lineVmText.computeLineTextKnockout` 把文字
  中心放在路径点上并挖空线身；`LineSchema` 注释写明「align 恒 center，不加字段」。
- **G-09 FRAME 离「片段」差三项**：建出来缺省是不透明白底且在最上层，会盖住先画的
  生命线与消息；没有「类型 + 守卫」的预设入口；else 分隔没有对应物。
- **G-10 新类型的缺省行为对时序图件不合适**。`isAutoAdoptableType` 只排除
  FRAME / PEN / LINE / 树；`hitWidget` 只跳过 LINE / PEN；`lineQuickAdd.maybeAnchorGrab`
  对任何旋转为 0 的非线单选都出四向连接点与 quick-add；`lineRoute.collectRouteObstacles`
  只豁免 `isRouteObstacle()` 返回 false 的宿主（目前仅无填充 SHAPE）。
- **G-11 对齐 / 分布按参与体逐件位移**。`alignCommands` 把 FRAME 整体剔除（「容器子集
  移动」接进 delta 分摊是后置能力）。生命线需要参与对齐分布（顶对齐、等间距），
  其激活条必须随行，否则「分布水平」一次就把全部激活条留在原地。

### 1.3 为什么消息复用 LINE 而不是新建 MESSAGE 控件

| 维度                        | 复用 LINE                                         | 新建 MESSAGE 控件           |
| --------------------------- | ------------------------------------------------- | --------------------------- |
| 线型 / 箭头 / 虚线          | 现成（`dashed`、`startArrow` / `endArrow`）       | 重做渲染与 ActionBar        |
| 标签                        | 现成（双击建文字、沿路径滑、编辑会话）            | 重做                        |
| 删除宿主                    | 现成（`unbindFrom` 解绑不删）                     | 重做                        |
| 剪贴板                      | 现成（端点同批重映射、批外解绑）                  | 加一条重映射分支            |
| 撤销 / 持久化 / 导出 / 只读 | 现成                                              | 逐项接入                    |
| 测试护栏                    | lineCreate / lineEndpoint / lineText 等 7 个 spec | 从零写                      |
| 代价                        | 连线子系统 5 处增量，全部以「轴宿主」为门         | §9 清单约 40 处触点再走一遍 |

B 路线的语义控件另有价值（自动布局、编号），不属于 A，本 spec 不预造它的抽象。

### 1.4 为什么激活条是独立控件

| 维度           | 纯 SHAPE 窄矩形                  | 生命线内嵌数据             | 独立控件 + 绑定（本 spec）   |
| -------------- | -------------------------------- | -------------------------- | ---------------------------- |
| 随生命线移动   | 否                               | 是                         | 是（级联展开）               |
| 调整范围       | 通用缩放手柄                     | 要自造子元素手柄与焦点体系 | 通用缩放手柄（只开纵向）     |
| 被片段容器收养 | 是（误收）                       | 不适用                     | 否（schema 不带 `parentId`） |
| 与消息端点关系 | 会被当成锚定宿主，改条即拖走端点 | 消息只认轴                 | 消息只认轴，条只影响箭头让位 |
| 剪贴板 / 删除  | 通用                             | 随生命线，最省             | 桶映射 + 连带删除            |
| 新增交互面     | 无                               | 子元素选中、手柄、删除拦截 | 无（全是通用控件交互）       |
| 主要风险       | 条与线分家                       | 第三套子元素编辑体系       | 绑定写入的时序               |

### 1.5 与既有引擎的接缝

| 接缝                      | 时序图件如何接                                                | 是否改平台层                   |
| ------------------------- | ------------------------------------------------------------- | ------------------------------ |
| Model / VM                | 标准三件套 + `WIDGET_RUNTIME` 注册两行                        | 否                             |
| 空间索引 / culling        | 普通 widget，按 bbox 入索引                                   | 否                             |
| 命中                      | `LifelineVm.hitTestPoint` = 头框 ∪ 轴带；`hitTestRect` 同口径 | 否                             |
| 连线目标拾取              | `hitWidget` 增「不是连线目标则跳过」探针                      | lineHitTest 一处               |
| 拖拽 / 微移 / 删除 / 复制 | 激活条随生命线：经 `IFrameLookup` 复合查找                    | 调用方零改动，注入点换对象     |
| 对齐 / 分布               | 生命线照常参与；随行激活条按宿主位移                          | alignCommands 一处             |
| 连线跟随                  | 宿主几何变化照常触发；激活条变化时重路由其生命线              | 钩子里多问一个探针             |
| 缩放松手                  | 多传起始矩形，供端口重写                                      | rectEditorService 一处         |
| 剪贴板                    | `lifelineId` 桶映射（LINE 端点先例）                          | clipboardService 一个分支      |
| 容器归属                  | 不参与（无字段 + 双重拒绝）                                   | frameOps / frameService 各一行 |
| 项目文件 / 导出 PNG       | 字节级复制 / 舞台通用渲染                                     | 否                             |
| 只读                      | 工具钳制 + 指针分发丢弃 + 命令守卫                            | 否                             |
| 参考线                    | `referenceable: true`                                         | 否                             |

### 1.6 代码硬约束

- **行数余量**：`lineService.ts` 368（批次 1 瘦身后；原 397）、`selectorService.ts` 398、`rectEditorService.ts` 398、
  `boardActionBar.ts` 382、`lineVm.ts` 362、`lineAnchorFollow.ts` 347。400 行铁律没有
  自动门禁（eslint 无 `max-lines`，scripts 无检查），靠人工与审查。本 spec 对
  `selectorService.ts` 零改动；`lineService.ts` 只许净增 ≤ 2 行，新增行为全部落新
  协作者；`rectEditorService.ts` 批次 1 接整形探针后 399 行，之后要改
  `onResizeCommitted` 签名（§4.7），改前先把旋转手势拆成协作者腾行数（缩放的单帧
  计算已在 `resizeMath.planResize`，没有余量可挪）。
- **`types/widget.ts` 已 551 行**，是唯一超限的非测试源码（另有 react `Icon.tsx`）。
  本 spec 按约定仍把 schema 写在这里，行数债登记在 §14，不在本批拆。
- **一模式一组指针处理器**：`viewportPointerInput.register` 是 `handlers.set(mode, …)`。
  一个 CursorMode 只能有一个注册者。
- **平台层不 import widgets**：selector / clipboard / layer 只依赖 `IFrameLookup`。
  `alignCommands` 例外地经 `IBoardCommandHost.frame` 拿到具体类型 `FrameService`。
- **服务层不得按 type 分支**（docs/14 规则 6）：宿主差异一律走 VM 可选探针。
- **事务内不读 vm**（specs/container-frame §6.6 陷阱 1）；**同一事务内「创建新件后紧接
  写入」对新件的 vm 观察者不可见**（同表陷阱 11）——新件的事实必须写进创建数据。

### 1.7 审计副产物（存量问题，不属本 spec 范围）

写本 spec 时登记的五个存量问题，已按人类指令于 2026-11-26 全部修完并推送（每项
一笔提交；X2 / X5 的口径由人类拍板）。

| #   | 现象                                                                             | 依据与修法                                                                                                                               | 提交      |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| X1  | 线型从 STRAIGHT 切到 ELBOWED 时，已有自环被改写成非环路径                        | `rerouteLine` 改走 `routeLinePoints` 单源；触发点收进切型事务（顺带修掉撤销裂项、重做丢失、pinned 被覆盖），specs/flowchart-closeout §24 | `f6c2ea0` |
| X2  | 混合选区拖拽时，未移动的自由线按「虚拟位移」参与容器归属判定，可能被误收或误清父 | `reconcileOne` 对全部连线早退；人类拍板「连线一律不参与」，specs/container-frame §16                                                     | `aabe2a8` |
| X3  | 切到容器、组织架构工具时不播报                                                   | react `announcement.ts` 的 `TOOL_NAMES` 补 `frame` / `org` 并加编译锁                                                                    | `625d7ac` |
| X4  | `FrameService` 不在销毁序列                                                      | `boardTeardown.ts` 补 `frame` 行（早于 engine），specs/container-frame §16                                                               | `ba9ef82` |
| X5  | `IMAGE` 的 `keepRatio` 在手柄缩放时不生效                                        | 人类拍板「普通拖拽自由、按住 Shift 锁比例」，specs/image-ratio-lock                                                                      | `0d57861` |

## 2. 数据模型

### 2.1 LIFELINE schema

```ts
/** 生命线（specs/sequence-diagram §2.1）：参与者头 + 竖直虚线轴。轴上高度是连线
 *  端口参数 t 的定义域（§3.2）。optional 无 default 的字段缺省由消费侧常量兜底。
 *  不带 parentId：生命线不进容器（§2.5 S5） */
export const LifelineSchema = z.object({
  id: z.string(),
  type: z.literal('LIFELINE'),
  zOrder: z.string(),
  /** 参与者名（纯文本单行 ≤ 64 字素，非 HTML）；空串 = 只有头框 */
  label: z.string().default(''),
  /** 头部样式：box（缺省，矩形）/ actor（小人）。未知值装载时按键删除，回落 box */
  head: z.enum(['box', 'actor']).optional(),
  ...GroupIdField,
});
export type LifelineData = z.infer<typeof LifelineSchema>;
```

几何走独立 rect（SHAPE / SYMBOL 同一扁平化路径）：`x / y / width / height` 是整条
生命线（头 + 轴）的 bbox，轴在水平中心。

### 2.2 ACTIVATION schema

```ts
/** 激活条（specs/sequence-diagram §2.2）：贴在生命线轴上的细条，宽度恒定（§3.4）。
 *  不带 parentId：激活条不进容器（§2.5 S5） */
export const ActivationSchema = z.object({
  id: z.string(),
  type: z.literal('ACTIVATION'),
  zOrder: z.string(),
  /** 绑定的生命线；缺省 = 未绑定（孤儿 / 批外粘贴 / 自由条） */
  lifelineId: z.string().optional(),
  ...GroupIdField,
});
export type ActivationData = z.infer<typeof ActivationSchema>;
```

外观固定（§3.6），不设颜色字段。

### 2.3 LINE 增量

```ts
// LineSchema 追加
/** 线上文字侧别（§4.9）：缺省 = 骑线镂空（旧文档逐字节不变）；
 *  above / below = 线上方 / 线下方，不镂空 */
textSide: z.enum(['above', 'below']).optional(),
```

不新增线型、不新增箭头值、不新增「是否消息」标记——轴消息是纯派生判定（§2.5 S2）。

### 2.4 注册与能力位

```ts
LIFELINE: {
  family: 'widget',
  schema: LifelineSchema,
  capabilities: {
    rotatable: false,
    groupable: true,
    resizable: true,
    movable: true,
    selectable: true,
    keepRatio: false,
    editable: false,      // 标签走自有 plain 内核会话（FRAME 先例，§3.7）
    referenceable: true,  // 顶对齐 / 等间距 / 激活条吸中心线
    erasable: false,
  },
},
ACTIVATION: {
  family: 'widget',
  schema: ActivationSchema,
  capabilities: {
    rotatable: false,
    groupable: true,
    resizable: true,
    movable: true,
    selectable: true,
    keepRatio: false,
    editable: false,
    referenceable: true,
    erasable: false,
  },
},
```

`WIDGET_RUNTIME` 增两项。`widgetRegistry.test.ts` 的类型清单与 `TYPES_WHERE` 期望集同步。

### 2.5 不变量

| 编号 | 不变量                                                                                                                              | 保障点                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S1   | 轴宿主唯一：`getAxisAnchor` 只由 `LifelineVm` 实现；轴长 < 1 时返回 null（按普通件处理）                                            | 单测 + 注册表锁                                        |
| S2   | 轴消息判定纯派生、不落标记：`horizontal` = STRAIGHT ∧ 两端锚定在两个不同的轴宿主；`self` = ELBOWED ∧ 非 pinned ∧ 两端锚定在同一条轴 | `sequenceOps.axisMessageKind`                          |
| S3   | 轴宿主上的端口在创建时即写入显式值，保留 4 位小数；缺省仍按 0.5 解读                                                                | 拉线策略落库 + 单测                                    |
| S4   | 激活条至多绑定一个存活 LIFELINE；孤儿 `lifelineId` 读取侧按未绑定处理、不改写数据                                                   | 读取侧过滤（group「消解不清理」同款，undo 后绑定复活） |
| S5   | 时序图件不进容器：两类 schema 不带 `parentId`，自动归属与拖放判定双重拒绝                                                           | `isAutoAdoptableType` + `reconcileOne`                 |
| S6   | 激活条宽度恒为 `ACTIVATION_WIDTH`，任何缩放路径落库不变                                                                             | `ActivationVm.commitResize` / `applyResizePreview`     |
| S7   | 绑定写入与触发操作同一事务（拖放 / 微移）或同一撤销捕获窗（创建 / 粘贴收尾）                                                        | `reconcileActivations` 只在事务内调；粘贴收尾另起事务  |
| S8   | 策略缺省时拉线行为逐字节不变；旧文档（无新类型、无 `textSide`）渲染逐字节不变                                                       | 单测锁创建数据 + 视觉基线全量不变                      |

### 2.6 兼容与降级

- **旧文档零迁移**：新类型是增量；`textSide` 是 optional，老线缺字段走原渲染分支。
- **老客户端打开新文档**：LIFELINE / ACTIVATION 进未知类型隔离区（+warning），
  `textSide` 作为未知键保留——老客户端看到的是一张少了生命线、消息线留在原位的图。
- **孤儿激活条**（生命线被隔离、批外粘贴、跨文档剪贴板）：按未绑定细条渲染与交互。
- **项目文件**：`document.yjs` 字节级复制，导入不逐件校验（docs/20 §7）。
- **跨表粘贴**：`lifelineId` 在 schema 内，经 `text/html` / `text/plain` 往返不丢。

## 3. 生命线：几何与渲染

### 3.1 常量（单源 `widgets/sequence/lifelineGeometry.ts`）

| 常量                         | 值        | 含义                                    |
| ---------------------------- | --------- | --------------------------------------- |
| `LIFELINE_HEAD_HEIGHT`       | 36        | box 头高（世界 px）                     |
| `LIFELINE_ACTOR_HEAD_HEIGHT` | 72        | actor 头区高（小人 44 + 标签带）        |
| `LIFELINE_DEFAULT_WIDTH`     | 120       | 单击创建默认宽                          |
| `LIFELINE_DEFAULT_HEIGHT`    | 520       | 单击创建默认高（含头）                  |
| `LIFELINE_MIN_WIDTH`         | 60        | 手柄缩放下限                            |
| `LIFELINE_MIN_HEIGHT`        | 120       | 手柄缩放下限（保证轴长 ≥ 84）           |
| `LIFELINE_LABEL_FONT_SIZE`   | 14        | 标签字号                                |
| `LIFELINE_LABEL_LINE_HEIGHT` | 20        | 标签行高（编辑器与画布同源）            |
| `LIFELINE_LABEL_PAD_X`       | 8         | 标签左右内边距                          |
| `LIFELINE_AXIS_HIT_SCREEN`   | 6         | 轴命中半宽（屏幕 px，命中时折算世界值） |
| `LIFELINE_AXIS_HIT_MAX`      | 24        | 折算后的世界值上限                      |
| `LIFELINE_HEAD_COLOR`        | `#ffffff` | 头框填充                                |
| `LIFELINE_HEAD_BORDER`       | `#333333` | 头框描边与标签色                        |
| `LIFELINE_AXIS_DASH`         | `[6, 6]`  | 轴虚线（世界 px）                       |

标签落库清洗沿用 SYMBOL 口径（连续空白折一空格、trim、截 64 字素）与渲染截断
（超宽逐字素截断加省略号）。两者上提为通用纯函数，落点
`platform/textEngine/labelText.ts`：`clampSingleLineLabel(raw, maxChars)`、
`truncateWithEllipsis(text, maxWidth, measure)`、`truncateLabelToWidth(label,
maxWidth, style, measurer)`。不放 `common/`——`common/README.md` 约定本目录不
依赖 platform / widgets，而截断依赖文字测量。SYMBOL 与 FRAME 改引用（原
`clampSymbolLabel`、`truncateTitle` 留作薄包装），行为不变。

### 3.2 轴锚点

**批次**：本节整体属批次 2（轴锚定 + 消息）。批次 1 的生命线不覆写 `getAnchorPoint`，
对既有连线工具是普通矩形控件——连接点画在 bbox 边上、线也落在 bbox 边上，前后一致；
轴锚定与悬停反馈、quick-add 资格（§4.8）同批落地，避免过渡期不一致。

```ts
/** 轴的世界坐标（geom 缺省 = 当前宿主几何，预览敏感）；null = 无轴 */
export function lifelineAxis(rect: IRect, head: LifelineHead): IAxisAnchor | null;
// { x: rect.x + rect.width / 2, top: rect.y + 头高, bottom: rect.y + rect.height }

/** 轴上高度 ↔ 端口 */
export function axisAnchorPoint(axis: IAxisAnchor, t: number): IPoint;
export function axisJoinFor(axis: IAxisAnchor, p: IPoint): JoinDir; // p.x ≥ axis.x ? 'right' : 'left'
export function axisPortFor(axis: IAxisAnchor, y: number): number; // clamp01((y − top) / (bottom − top))，r4

/** 轴锚点：y = 轴上高度；x = 轴 + sign(join) × (barHalf − LINE_END_GAP) */
export function lifelineAxisAnchor(
  axis: IAxisAnchor,
  join: JoinDir,
  t: number,
  barHalf: number,
): IPoint;
```

- `sign(join)`：right = +1、left = −1、top / bottom = 0。
- **`barHalf`**：绑定在本生命线上、且纵向覆盖该高度的激活条的半宽（多条取最大），
  无覆盖为 0。由 `LifelineVm` 经构造注入的 `getBars()` 现查（返回各条 `getBounds()`，
  预览敏感），VM 不持服务引用。
- **为什么减 `LINE_END_GAP`**：连线两端视觉各收缩一个留隙（`linePath.insetEnds`）。
  锚点向内让出一个留隙后，线身与箭头恰好停在条边或轴上；不让位则箭头悬在轴外
  5px，或被激活条盖住半个箭头。
- `LifelineVm.getAnchorPoint(join, t, geom)` 覆写为上式（SYMBOL 图形区锚点同款）。
  旋转恒 0，无 θ 回投。
- `LifelineVm.getAxisAnchor(geom)` 实现 §4.1 探针。

### 3.3 命中

- `hitTestPoint(p)` = 点在头框内 ∨（`|p.x − axis.x| ≤ half` ∧ `axis.top ≤ p.y ≤ axis.bottom`）。
  `half = clamp(LIFELINE_AXIS_HIT_SCREEN / scale, LIFELINE_AXIS_HIT_SCREEN, LIFELINE_AXIS_HIT_MAX)`，
  每次命中现算（FRAME 边框环同款）。
- `hitTestRect(r)` = r 与头框相交 ∨ r 与轴带（宽 `2 × half`）相交。不用缺省的整 bbox：
  生命线 bbox 有 120 宽，框选擦过轴旁空白不该选中它。
- `getBounds()` / `getLocalRect()` / `getHostGeom()` 与 `FrameVm` 同构（pivot = 中心，
  `getHostGeom` 预览敏感）。

### 3.4 激活条几何

| 常量                      | 值  | 含义                            |
| ------------------------- | --- | ------------------------------- |
| `ACTIVATION_WIDTH`        | 10  | 恒定宽度（世界 px）             |
| `ACTIVATION_MIN_HEIGHT`   | 16  | 高度下限                        |
| `ACTIVATION_DEFAULT_DROP` | 80  | 单击创建时向下延伸的长度        |
| `ACTIVATION_BIND_TOL`     | 6   | 绑定判定的中心线容差（世界 px） |

```ts
/** 落点绑定判定：条中心线在容差内贴合某条生命线的轴，且与轴段有纵向重叠 */
export function resolveActivationHost(
  bar: IRect,
  hosts: ReadonlyArray<{ id: string; axis: IAxisAnchor }>,
): string | undefined;
```

### 3.5 缩放语义

整形走缩放服务的可选探针，不在 VM 的预览 / 落库方法里各做一遍：
`IBaseWidgetVm.constrainResize?(start, next)` 返回整形后的目标矩形，
`rectEditorService.onWindowMove` 在 `resizeMath.planResize` 末位应用——预览、编辑框、
选区框、落库拿到的是同一个矩形，拖拽中框与图形始终贴合（VM 层各自整形会让编辑框按
未整形的矩形画）。θ ≠ 0 的旋转态不调用整形：需要整形的控件都不可旋转。

- **生命线**：宽度变化以轴为对称轴（`x = axisX − width / 2`，轴的 x 永不因缩放移动，
  绑定的激活条因此不需要跟随）；高度钳到 `LIFELINE_MIN_HEIGHT` 以上。整形函数
  `constrainLifelineResize(start, next)` 是纯函数。
- **激活条**：只保留高度变化；`width` 恒写 `ACTIVATION_WIDTH`，`x = 中心 − 半宽`。
  四角与左右边手柄外观照常（per-type 手柄集不存在，§14 登记），拖它们编辑框与条
  一起不动。

### 3.6 绘制

- **生命线**：头框（`LIFELINE_HEAD_COLOR` 填充 + 1px `LIFELINE_HEAD_BORDER`）居中
  单行标签；轴自头框底边到 bbox 底边，1px 虚线，颜色 = 主题墨色 `defaultTextColor()`。
  `head: 'actor'` 时不画框，画小人（头圆 + 躯干 + 两臂 + 两腿，主题墨色），标签在
  小人下方。
- **退化不抛错**：高度 < 头高时轴长 ≤ 0，不画轴；宽度 < 24 时标签截断为空。
- **激活条**：矩形，`#ffffff` 填充 + 1px `#333333` 描边，无圆角。绑定与否外观相同。
- 重绘守卫键：`label / head / width / height / themeVersion / _labelEditing`；纯平移
  走快速路径。
- 两类都实现 `isRouteObstacle()` 返回 false（无填充 SHAPE 同款豁免，否则通用折线
  会绕开每一条生命线）。

### 3.7 标签编辑

`lifelineLabelEditor.ts`，`frameTitleEditor.ts` 同款：plain 内核、`nodeKey: 'label'`、
Enter 恒提交、空文本 keep、`onExit` 时写过才 `stopCapturing`、只读早退在入口。
`getRect()` = 头框内缩 `LIFELINE_LABEL_PAD_X`（实时求值）；actor 头取标签带。
进入入口：再点一次**头框**（§7.2）；点轴不算。

## 4. 连线子系统增量

本节每一项都以「端点宿主是轴宿主」为门；门外的线行为逐字节不变（S8）。
**批次**：§4 整体属批次 2 及之后；批次 1 对连线子系统只有 `lineService.ts` 的零行为
瘦身（§7.1）与生命线的 `isRouteObstacle()` 豁免（§3.6）。

### 4.1 宿主探针（`types/base.ts`，`IBaseWidgetVm` 的可选成员）

```ts
/** 缩放整形（§3.5；批次 1）：返回整形后的目标矩形，预览 / 编辑框 / 落库同源。
 *  缺省 = 不整形 */
export interface IResizeConstrainVm {
  constrainResize(start: IRect, next: IRect): IRect;
}

export interface IAxisAnchor {
  x: number;
  top: number;
  bottom: number;
}

/** 轴锚定宿主（LifelineVm 实现） */
export interface IAxisAnchorVm {
  getAxisAnchor(geom?: IHostGeom): IAxisAnchor | null;
}
/** false = 不作连线目标：hitWidget 跳过它继续取下层（ActivationVm 实现） */
export interface IConnectionTargetVm {
  isConnectionTarget(): boolean;
}
/** 本件移动 / 缩放 / 新建 / 删除后需要重路由的锚定宿主；缺省 = [自身 id]
 *  （ActivationVm 返回 [lifelineId]，未绑定返回 []） */
export interface IAnchorFollowHostsVm {
  anchorFollowHosts(): string[];
}
/** 两端都锚在生命线轴上的直线，可沿轴平移（LineVm 实现） */
export interface IAxisMessageVm {
  isAxisMessage(): boolean;
}
```

### 4.2 落点策略：按下点 / 松开点写显式端口

```ts
// widgets/line/lineAxisAnchor.ts —— 纯函数
export function isAxisHost(vm): boolean;
export function resolveAnchorPick(
  vm,
  geom: IHostGeom,
  p: IPoint,
): { join: JoinDir; port: number | undefined };
```

- 轴宿主：`join = axisJoinFor`（指针在轴的哪一侧），`port = axisPortFor`（r4）。
- 其他宿主：`join = nearestJoin`，`port = undefined`——与今日逐字节一致。
- 消费点三处：`LineDrawSession.pointerDown` / `applyMove`（新增：port 有值即写入
  `startPort` / `endPort`）、`LineEndpointDrag.onMove`（替换其内联投影）。
- **为什么是 4 位小数**：端点拖拽今天写两位小数。两位小数在 520 高的轴上量化到 5px，
  在 1000 高的轴上量化到 10px——「加长保高度」重写端口时消息会可见地跳。普通件维持
  两位小数不变。

### 4.3 拉线策略

```ts
// widgets/line/lineAxisAnchor.ts
export interface ILineDrawPolicy {
  /** 建线样式预设（字段优先于会话默认） */
  style: Partial<Pick<LineData, 'lineType' | 'startArrow' | 'endArrow' | 'dashed' | 'textSide'>>;
  /** 终点高度锁定为起点高度（钳到目标轴范围） */
  horizontal: boolean;
  /** 两端必须落在轴宿主上：起点不是 → 不建线；终点不是 → 松手删除草稿 */
  requireAxisTargets: boolean;
  /** 忽略控件命中，两端都落自由点 */
  freeEnds: boolean;
  /** 同一宿主松手 = 自消息：纵向间距 ≥ 8 落 ELBOWED 自环，否则取消 */
  selfMessage: boolean;
}
```

`ILineDrawHost` 增 `getDrawPolicy?(): ILineDrawPolicy | undefined`。缺省 undefined =
既有行为。`LineService` 把自己的「line 模式处理器对象」提为只读属性 `drawHandlers`
（注册与被转发共用同一对象），`SequenceService` 直接转发（§7.1）。

| 预设     | lineType | startArrow | endArrow | dashed | textSide | horizontal | requireAxisTargets | selfMessage |
| -------- | -------- | ---------- | -------- | ------ | -------- | ---------- | ------------------ | ----------- |
| 同步消息 | ELBOWED† | none       | solid    | false  | above    | 是         | 是                 | 是          |
| 异步消息 | ELBOWED† | none       | arrow    | false  | above    | 是         | 是                 | 是          |
| 返回消息 | ELBOWED† | none       | arrow    | true   | above    | 是         | 是                 | 是          |
| 分隔线   | STRAIGHT | none       | none     | true   | —        | 否         | 否（freeEnds）     | 否          |

† 三类消息的草稿都按 ELBOWED 建；落定时按 §4.4 第 3 步定线型——跨轴消息改
STRAIGHT，自消息保留 ELBOWED。

### 4.4 消息创建与落定

1. **按下**：命中轴宿主 → 起点 = 按下高度（§4.2），建草稿；命中非轴宿主或空白 →
   不建线，零写入。
2. **拖动**：指针在轴宿主上 → 终点 = 钳到该轴范围的起点高度；不在 → 终点跟指针
   （既有自由端预览）。
3. **松手**（`settle`）：
   - 在**另一条**轴上 → 写 `endNodeId / endJoin / endPort`，并把两端 join 按方向
     归一（起点 = 去向侧，终点 = 来向侧），线型改 STRAIGHT；一步撤销；工具保持激活。
   - 在**同一条**轴上且纵向间距 ≥ 8 → 自消息（§4.6）。
   - 其他 → 删除草稿。时序图没有悬空消息。

join 归一的理由：箭头让位方向由 join 决定（§3.2），而 `axisJoinFor` 取的是指针侧；
不归一的话从轴右侧按下、向左画的消息，箭头会让向远侧。

### 4.5 轴消息平移（G-05）

- **判定**：S2。`LineVm.isAxisMessage()` 在 render 时按锚定字段重算并缓存。
- **拖线身**：`createDragState` 的规则由「纯线选区不建会话」改为「没有任何可平移件
  的线选区不建会话」。会话内全部是轴消息时置 `DragState.axis = 'v'`：
  `applyDragMove` 把 dx 置 0，只做纵向吸附，选区框只动 y。
- **预览**：`LineVm.applyDragPreview` 对轴消息写 `root.position = (0, dy)`，其余线仍空操作。
- **落库**：`LineVm.commitDrag` 写 `{ startPort, endPort, points }` 单次 update。dy 先
  钳到「两端都留在各自轴内」的范围（`sequenceOps.shiftedAxisPorts`）；dy = 0 不写。
  points 由两端宿主的 `getAnchorPoint` 现算（含条边让位）。
- **键盘**：`nudgeSelected` 已对所有选中件逐个调 `commitDrag`，↑ / ↓ 自动生效；
  ← / → 因 dy = 0 零写入。
- **端点手柄照旧**：拖单个端点只改那一端（消息可以变斜）。
- 线身抓取范围：距两端点 > 12 屏幕 px（端点手柄优先）。STRAIGHT 不进段滑移分支，
  `lineService.handleGestureDown` 无需改动。
- **悬停光标**（批次 4）：轴消息线身——距两端 > 12 屏幕 px 且距线身 ≤ 8 屏幕 px——hover
  显示 `ns-resize`，不出胶囊高亮；其余 STRAIGHT 线维持无光标。`resolveLineHover`
  增可选实参 `axisMessage`（缺省 false = 现状），只在光标分支多一条；
  `lineHoverOverlay.ts`（已 397 行）只多传一个实参。

### 4.6 自消息（G-07）

- 触发：§4.4 第 3 步。保留草稿的 ELBOWED，两端 join = 按下点所在侧，
  `startPort` = 按下高度，`endPort` = 松手高度。
- 路由走既有 `routeSelfLoop` 同边分支（两端相距 ≥ 8 时原样保留、4 点环、深度 30）。
- **草稿按 ELBOWED 建**（新线默认即 ELBOWED，docs/08 §4）；跨轴消息在落定事务内
  改 STRAIGHT。自环路由 `routeSelfLoop` 的同边分支只对 ELBOWED、非 pinned 的线生效
  （§1.2 G-07），按 STRAIGHT 建的草稿拿不到环。落定时的全量重排（`reattachAll`）
  走同一路由，环点不变即零写入。切回 ELBOWED 的重路由只由 `updateSelectedStyle`
  在用户切型时触发（X1 已修，§1.7），拉线落定不经过它。
- 自消息不可拖线身平移（ELBOWED 线身是段滑移）；上下微移经 `commitDrag` 有效
  （S2 的 `self` 分支同样位移两端 port）。

### 4.7 加长保高度（G-06）

- `IRectEditorService.onResizeCommitted` 签名增起始矩形：`(id, next, start)`
  （`rectEditorService.onWindowUp` 作用域内 `start` 现成可得）。
- 组合根在既有急刻重路由之前调用
  `rewirePortsAfterResize(id, { rect: start }, { rect: next })`（`LineAnchorFollow`
  的新协作者）：宿主是轴宿主时，对其上每个锚定端——旧锚点 = 旧几何 + 旧 port 求点，
  新 port = 新轴上同高度的 port（r4）——有变化才写。
- 调用位置在 `commitResize` 之后、`stopCapturing` 之前 = 与缩放同一撤销项。
- 钳到底：新轴变短时，落到轴外的端钳到 t = 1。用户把生命线拖短到消息以下属误操作，
  不做阻止。
- 纯平移（拖拽、微移、对齐、分布）不改 t，不需要重写。

### 4.8 目标拾取、quick-add、避障

- `lineHitTest.hitWidget` 两段循环都加一条：`isConnectionTarget() === false` 的件跳过
  （与 LINE / PEN 并列）。指针落在激活条上时取到下层的生命线。
- `lineQuickAdd.maybeAnchorGrab` 与选中态连接点绘制共用资格判定 `canQuickAdd(vm)`：
  轴宿主与 `isConnectionTarget() === false` 的件返回 false——不出四向连接点，
  点击也不触发 quick-add。拉线悬停反馈（轴上的点）保留。
- 避障：§3.6 的 `isRouteObstacle` 豁免，`lineRoute.ts` 零改动。

### 4.9 线上文字侧别（G-08）

- `lineVmText` 增 `textAnchorOf(pts, style, textNode)`：缺省 = 路径点（现状）；
  `above` / `below` = 路径点沿法向偏移 `文字高 / 2 + KNOCKOUT_PADDING`，不镂空。
  「上方」= 路径方向的左侧法向（屏幕系 y 向下，左→右的水平线其上方为 y 负向）。
  文字不旋转。渲染、编辑框（`lineTextEditor.getRect`）、文字命中（`lineVmHit`）
  三处改用这一单源。
- ActionBar：LINE 增「文字位置」popover（线上 / 上方 / 下方，id = `textSide`，
  走 `updateSelectedStyle` 通用通道；选「线上」写 `undefined`，与 `textColor` 还原同款）。

## 5. 激活条绑定

### 5.1 绑定判据

对激活条 A 与生命线 L（L ≠ A）：`|A.cx − L.axis.x| ≤ ACTIVATION_BIND_TOL` ∧
A 与 `[L.axis.top, L.axis.bottom]` 有纵向重叠 → 绑定 L（多条命中取 zOrder 最上者）；
否则不绑定。绑定成立时同事务把 `A.x` 归中（`L.axis.x − ACTIVATION_WIDTH / 2`）。

### 5.2 写入时机

| 触发        | 时机                                       | 事务                                    |
| ----------- | ------------------------------------------ | --------------------------------------- |
| 工具创建    | 创建数据直接带 `lifelineId`，x 即归中      | 与创建同一步（陷阱 11：不走创建后写入） |
| 拖放 / 微移 | 落库事务内，对**展开前选区**中的激活条判定 | 与移动同一事务（S7）                    |
| 粘贴收尾    | 粘贴批之后另起事务，只处理无绑定的副本     | 与粘贴同一捕获窗                        |
| undo / redo | 不重判                                     | 既有状态还原                            |

参考线会把条的垂直中心线吸到生命线的中心参考线（两者都 `referenceable`），
沿轴上下拖时天然保持贴合；横向拖出容差即解绑。

### 5.3 级联复合查找

容器的级联钩子经 `IFrameLookup` 注入，selector / clipboard / layer 的调用点都不认
具体类型（`alignCommands` 是例外，它拿的是具体类型，见下）。激活条的
「随生命线」做成同一接口上的**复合查找**，三处注入点换成它，调用方零改动：

```ts
// widgets/sequence/sequenceCascade.ts
export interface IActivationLookup {
  /** 生命线 → 并入其绑定的激活条 */
  expandActivations(ids: string[]): string[];
  /** 落点绑定判定并落库。只在事务内调用 */
  reconcileActivations(ids: string[], rectOf: (id: string) => IRect): void;
  /** 粘贴收尾：无绑定的激活条落在轴上即绑定。只在事务内调用 */
  adoptActivationsByLanding(ids: string[]): void;
}

export function composeCascadeLookup(
  frame: IFrameLookup,
  seq: IActivationLookup | null,
): IFrameLookup;
// expandForCascade = 两者并集去重保序；reconcileParents / adoptByLanding = 两者依次调用；
// 其余五个方法直通 frame
```

随之落地的三处：

- `IBoardCommandHost` 增 `cascade: IFrameLookup | null`（缺省回落到 `frame`），
  `alignCommands` 改读 `cascade`。`BoardSDK` 同步增字段并归入内部成员分类。
- `layerService` 的注入点也换成复合查找（`computeLayerClamps` 直通 frame，行为不变）。
- 复合查找的三项激活条方法由 `SequenceService` 实现，平台层仍不 import widgets。

### 5.4 复制 / 剪切 / 粘贴

- **复制 / 剪切**：`expandForCascade` 已含「生命线 → 其激活条」，快照自动带上；
  展开序把生命线排在它的条之前，粘贴后层级天然正确。
- **粘贴**：`pasteSnapshots` 增一个分支（LINE 端点同款）——`lifelineId` 同批 → 新
  生命线 id；批外 → 删键。随后 `adoptByLanding`（复合）给无绑定的副本做落点绑定。
- 消息不在级联内：只复制生命线时，锚定其上的消息不随行，与「复制形状不复制
  连线」一致。

### 5.5 删除

- 删生命线 → 连带删除其激活条（`removeSelected` 经 `expandForCascade`，
  单事务一步 undo，FRAME 连子删同款）。
- 锚定其上的消息保持既有语义：端点解绑、points 不动，「清理悬空连线」可一键清。

## 6. 组合片段

### 6.1 片段 = FRAME 预设

- `FrameService` 增会话态 `createPreset: (() => Partial<FrameData>) | null`，
  `createWidget` 合并它的返回值；缺省 null，容器工具行为不变。
- 片段预设：`{ title: 关键字, fill: 'none' }`。关键字：alt / opt / loop / par。
  守卫文本直接写进标题（「alt [密码正确]」），经既有的标题 plain 编辑修改。
- 创建手势与容器工具相同：单击 320×220 按下点居中，拖拽画框。

### 6.2 else 分隔

分隔线是「两端自由的虚线直线」（§4.3 预设），从第一条生命线左侧的空白拖到最后
一条右侧的空白。需要标签时放一个 TEXT 写「else」。片段内部空白不拦截指针
（FRAME 命中只在标题带与边框环），起止点落在片段内不会被吸走。

### 6.3 与时序图件的关系

| 对象     | 建片段之后                                   | 拖动片段 |
| -------- | -------------------------------------------- | -------- |
| 生命线   | 不被收养（S5）                               | 不动     |
| 激活条   | 不被收养（S5）；片段内新建的也不归属         | 不动     |
| 消息     | 锚定线本就不参与归属                         | 不动     |
| 片段自身 | 缺省在最上层；无填充，只有边框与标题压在图上 | 只动自己 |

### 6.4 嵌套

两个 FRAME 都不带 `parentId`，视觉上可以嵌套，外层不带动内层。ALT 套 LOOP 时
用户分别摆、分别移。这是 4.4「单层归属」的直接后果，不在本批解。

## 7. 交互

### 7.1 创建

`SequenceService` 是 `CursorMode 'sequence'` 的**唯一**指针注册者，按当前图元种类
转发（§1.6：一模式一组处理器）。种类是会话态（不落库），经
`setDefaultToolOption('sequence', 'kind', v)` 记忆，缺省 `lifeline`。

| kind id                                             | 名称   | 手势                       | 转发到                            | 落库                                  |
| --------------------------------------------------- | ------ | -------------------------- | --------------------------------- | ------------------------------------- |
| `lifeline`                                          | 生命线 | 单击 / 拖拽画图            | `LifelineService.handlers`        | LIFELINE                              |
| `activation`                                        | 激活条 | 轴上按下，纵向拖           | `SequenceService` 自实现          | ACTIVATION（创建数据带 `lifelineId`） |
| `message-sync` / `message-async` / `message-return` | 消息   | 轴上按下，拖到另一条轴松手 | `lineService.drawHandlers` + 策略 | LINE                                  |
| `divider`                                           | 分隔线 | 空白处按下拖出             | `lineService.drawHandlers` + 策略 | LINE（两端自由）                      |
| `fragment-alt` / `-opt` / `-loop` / `-par`          | 片段   | 单击 / 拖拽画框            | `sdk.frame.handlers` + 预设       | FRAME                                 |

两项前置重构（零行为变化，单独提交）：

- `DragCreateServiceBase` 把 `initialize()` 里注册的处理器对象提为只读属性
  `handlers`，注册与被转发共用同一对象。
- `LineService` 同款提 `drawHandlers`；六个协作者（悬停浮层、拉线状态机、quickAdd、
  anchorFollow、endpointDragCtl、segTextSlide）的构造迁入 `lineCollaborators.ts` 的
  工厂（只构造、不登记），`initialize()` 只做一次按序登记，397 → 368 行。释放顺序
  等于登记顺序（`Disposable` 正向遍历），`lineServiceWiring.test` 锁定；工厂只在
  `initialize()` 里调用，构造函数不碰依赖（`lineDefaultType.test.ts` 有断言）。

`LifelineService.initialize()` 直接抛错而不是靠约定「不调」：它注册的 `scope` 就是
`'sequence'`，误调会覆盖 `SequenceService` 的注册（§9.6 第 6 条）。

各创建手势的收尾口径：

- **生命线**：同形状工具——单击默认尺寸、按下点居中、工具保持可连击；拖拽画图
  松手选中并回选择工具；滑移 < 10 屏幕 px 仍按单击。
- **激活条**：按下必须命中轴宿主，否则不建。拖拽：x 归中、y = 按下高度、高度跟手
  （钳 ≥ 16，底不出轴底），松手选中并回选择工具。单击：从按下高度向下 80，
  工具保持。
- **消息 / 分隔线**：§4.4；落定后选中该线、工具保持激活。

### 7.2 交互矩阵（实施者按此逐行自检）

| 手势                            | 生命线                     | 激活条（已绑定）              | 消息                 | 片段             |
| ------------------------------- | -------------------------- | ----------------------------- | -------------------- | ---------------- |
| 单击头框 / 条身 / 线身 / 标题带 | 选中                       | 选中                          | 选中（线身）         | 选中             |
| 单击轴旁空白                    | 不命中（清选区）           | —                             | —                    | 不命中（清选区） |
| 再点一次（已选中）              | 头框 → 进标签编辑；轴 → 无 | 无                            | 无（双击才建文字）   | 进标题编辑       |
| 拖动                            | 带激活条；消息跟随         | 自由拖；松手判绑定并归中      | 只动 y，两端同步     | 只动自己         |
| 线身上下键                      | 四向微移，带激活条         | 四向；绑定中被 reconcile 归中 | ↑ ↓ 有效，← → 零写入 | 四向             |
| 拖底边手柄加长                  | 消息高度不变               | 不适用                        | —                    | —                |
| 缩放手柄                        | 宽度对称、高度有下限       | 只改高度                      | 不适用               | 通用             |
| 拖端点圆点                      | —                          | —                             | 只改该端             | —                |
| 框选                            | 头框或轴带相交才入选       | 相交即入选                    | bbox 相交即入选      | 全含才入选       |
| 对齐 / 分布                     | 参与且带激活条             | 参与                          | 不参与（锚定线）     | 不参与           |
| 删除                            | 连带激活条                 | 单删                          | 单删                 | 单删             |
| 复制                            | 带激活条                   | 单独复制，粘贴后按落点重绑    | 端点同批重映射       | 通用             |
| 进容器                          | 否                         | 否                            | 否（锚定线本就否）   | —                |
| 只读                            | 不可建 / 不可拖 / 不进编辑 | 同左                          | 同左                 | 同左             |

### 7.3 只读与离线

指针驱动的工具走中央闸门（`viewportPointerInput` + `setCursorMode` 只读钳制），
`SequenceService` 无非指针入口，不需要自检。标签编辑入口自检 `editable$`。
离线无额外分支。

### 7.4 工具与快捷键

- `CursorMode` 增 `'sequence'`；`CURSOR_STYLES.sequence = 'crosshair'`。
- 快捷键 **Q**：`DEFAULT_SHORTCUTS` 增 `{ id: 'tool.sequence', keys: 'q' }`，
  `KeyboardService.bindAll` 增对应 `case`。Q 当前未被占用（已占用 13 个字母：
  v h r n t l p e s m o c f）。只读闸门自动覆盖。

## 8. UI

### 8.1 工具坞

- 单一按钮：id `sequence`、mode `'sequence'`、标题「时序图 (Q)」、排在树形图之后
  （第 12 钮）。主题色沿用 shape 槽位（不新增 `tool-sequence-*`，避免对比度护栏扩散）。
- 二级菜单用动态组（树形图先例 `buildSubMenuGroups`），三组共用一个当前值——
  静态组每组各有一个 current，会出现两组同时点亮：

| 组   | 选项                           |
| ---- | ------------------------------ |
| 图元 | 生命线 / 激活条 / 分隔线       |
| 消息 | 同步消息 / 异步消息 / 返回消息 |
| 片段 | alt / opt / loop / par         |

- 种类记忆走工具参数通道：`SequenceService.kind$` → 组合根
  `sdk.syncToolOption('sequence', 'kind', v)`，Toolbar 读 `defaultToolOptions`
  （符号按钮同款，缺省值在 Toolbar 兜底）。不新增 store 字段——`treeKind` 是从
  `cursorMode$` 派生的，带不了工具参数。批次 1 的图元组只有「生命线」，其余组与
  选项随各自批次追加。
- `ToolGhost` 增 `sequence` 条目（静态图标）；`IconName` 增 `'sequence'`
  （内联 SVG：三条竖向虚线 + 一条横向箭头；lucide 1.59 无贴切导出）。
- 播报：react `announcement.ts` 的 `TOOL_NAMES` 增 `sequence: '时序图'`。

### 8.2 ActionBar

| 单选类型   | 项                     | 说明                                                          |
| ---------- | ---------------------- | ------------------------------------------------------------- |
| LIFELINE   | 头部样式（`head`）     | 矩形 / 小人；项定义抽 `widgets/sequence/lifelineActionBar.ts` |
| ACTIVATION | （无样式项）           | 走 `default` 分支的空栏即可                                   |
| LINE       | 文字位置（`textSide`） | §4.9；LINE 项同批抽 `widgets/line/lineActionBar.ts`           |

`boardActionBar.ts` 已 382 行：LIFELINE 分支只留一行委托。

### 8.3 其余

右键菜单、ToolFlyout 键盘协议、PopoverControl 不新增组件。工具坞 390px 下按既有
`w-max + shrink-0` 内滚，不新造布局。

## 9. 引擎边界与改动清单

### 9.1 不改

`dataEngine` / `vmEngine` / `cullingService` / `spatialIndex` / `exportCommand` /
`projectImport` / `projectExport` / `historyService` / `selectorService.ts` /
`lineRoute.ts` / `lineRouteSelfLoop.ts` / `FrameService` 的归属逻辑。

### 9.2 改动点（文件级，按实施顺序）

| #   | 文件                                                                                                     | 改动                                                                                                                                                           | 批次      |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | `widgets/base/dragCreateServiceBase.ts`                                                                  | 处理器对象提为 `handlers`（前置重构）                                                                                                                          | 1         |
| 2   | `widgets/line/lineService.ts` + `lineCollaborators.ts`                                                   | `drawHandlers`；协作者构造迁工厂（前置重构，净减行）                                                                                                           | 1         |
| 3   | `platform/textEngine/labelText.ts`、`widgets/symbol/symbolGeometry.ts`、`widgets/frame/frameGeometry.ts` | 标签清洗 / 截断上提（前置重构）                                                                                                                                | 1         |
| 4   | `common/geometry.ts`、`widgets/line/linePath.ts`                                                         | `LINE_END_GAP` 上提，linePath 改引用                                                                                                                           | 2         |
| 5   | `types/widget.ts`                                                                                        | 两个 schema、`LineSchema.textSide`、注册表两项                                                                                                                 | 1 / 3 / 4 |
| 6   | `types/base.ts`                                                                                          | `IAxisAnchor` + 四个可选探针；`constrainResize` 整形探针                                                                                                       | 1 / 2 / 3 |
| 7   | `types/services.ts`                                                                                      | `CursorMode`；`onResizeCommitted` 三参；`IActivationLookup`；`ILineDrawPolicy`                                                                                 | 1 / 2 / 3 |
| 8   | `types/index.ts`、`index.ts`                                                                             | 类型与选项常量导出                                                                                                                                             | 1 起      |
| 9   | `tokens.ts`、`widgetRuntime.ts`                                                                          | `Tokens.SequenceLookup`；两项工厂（Vm 注入只读查询）                                                                                                           | 1 / 2 / 3 |
| 10  | `widgets/sequence/lifelineGeometry.ts`                                                                   | 常量 + §3.1–3.2 纯函数                                                                                                                                         | 1 / 2     |
| 11  | `widgets/sequence/lifelineModel.ts` / `lifelineVm.ts`                                                    | 三件套前两件；命中、轴锚点、缩放整形、避障豁免                                                                                                                 | 1 / 2     |
| 12  | `widgets/sequence/lifelineLabelEditor.ts`                                                                | plain 内核标签会话                                                                                                                                             | 1         |
| 13  | `widgets/line/lineAxisAnchor.ts`                                                                         | 落点策略、`ILineDrawPolicy` 与预设、join 归一                                                                                                                  | 2         |
| 14  | `widgets/line/lineDrawSession.ts`                                                                        | 策略接入（§4.2–4.4、§4.6）                                                                                                                                     | 2         |
| 15  | `widgets/line/lineEndpointDrag.ts`                                                                       | 改用 `resolveAnchorPick`                                                                                                                                       | 2         |
| 16  | `widgets/line/lineHitTest.ts` / `lineQuickAdd.ts` / `lineHoverOverlay.ts` / `lineHoverMath.ts`           | 连接目标跳过；quick-add 资格单源；轴消息悬停光标                                                                                                               | 2 / 3 / 4 |
| 17  | `widgets/sequence/sequenceOps.ts`                                                                        | 轴消息判定、端口平移、缩放后端口、绑定判定（纯函数）                                                                                                           | 2 / 3     |
| 18  | `widgets/line/lineVm.ts`                                                                                 | 轴消息平移两覆写 + `isAxisMessage`                                                                                                                             | 2         |
| 19  | `platform/selector/selectorDragOps.ts`                                                                   | `createDragState` 规则；纵向会话                                                                                                                               | 2         |
| 20  | `widgets/line/lineAxisResize.ts`                                                                         | `rewirePortsAfterResize`；`previewFollow` 的宿主扩展                                                                                                           | 2 / 3     |
| 21  | `platform/rectEditor/rectEditorService.ts` + `rectEditorRotate.ts`                                       | 整形探针接线（批次 1）；旋转手势拆出协作者（前置重构，零行为）；`onResizeCommitted` 传 `start`                                                                 | 1 / 2     |
| 22  | `widgets/line/lineVmText.ts` / `lineTextEditor.ts` / `lineVmHit.ts`                                      | `textAnchorOf` 单源（§4.9）                                                                                                                                    | 4         |
| 23  | `widgets/sequence/activationModel.ts` / `activationVm.ts`                                                | 激活条控件；锁宽缩放；两个探针                                                                                                                                 | 3         |
| 24  | `widgets/sequence/sequenceCascade.ts`                                                                    | `IActivationLookup` 实现 + `composeCascadeLookup`                                                                                                              | 3         |
| 25  | `platform/clipboard/clipboardService.ts`                                                                 | `lifelineId` 桶映射                                                                                                                                            | 3         |
| 26  | `alignCommands.ts`、`boardHost.ts`、`boardPublicApi.ts`                                                  | `cascade` 成员；随行件按宿主位移                                                                                                                               | 3         |
| 27  | `widgets/frame/frameOps.ts` / `frameService.ts`                                                          | 归属排除两类（批次 1 先排除 LIFELINE）；`createPreset`（批次 4）                                                                                               | 1 / 4     |
| 28  | `widgets/sequence/sequenceService.ts`、`sequenceOptions.ts`                                              | 工具注册与转发、种类记忆；激活条手势与绑定实现随后续批次追加                                                                                                   | 1 起      |
| 29  | `widgets/sequence/lifelineActionBar.ts`、`boardActionBar.ts`                                             | ActionBar 两项                                                                                                                                                 | 4         |
| 30  | `app.ts`、`boardAssemblyInteraction.ts`、`boardAssemblyTools.ts`、`boardCommands.ts`、`boardTeardown.ts` | 装配、`onActivate` 分支（在 `boardAssemblyInteraction.ts`）、`setDefaultToolOption` 分支（在 `boardCommands.ts`）、销毁；`cascade` 组合与 Token 注册随后续批次 | 1 起      |
| 31  | `platform/keyboard/shortcuts.ts` / `keyboardService.ts`、`platform/viewport/viewportService.ts`          | 快捷键 Q、光标                                                                                                                                                 | 1         |
| 32  | react：`Toolbar.tsx`、`ToolGhost.tsx`、`Icon.tsx`、`a11y/announcement.ts`                                | 工具坞与播报                                                                                                                                                   | 1 起      |
| 33  | `__tests__/widgetRegistry.test.ts` 及各新单测                                                            | §11.1                                                                                                                                                          | 1 起      |
| 34  | `packages/app/e2e/sequence.spec.ts`、`helpers/sequenceE2e.ts`、`visual.spec.ts`                          | §11.2–11.3                                                                                                                                                     | 1 / 5     |
| 35  | `docs/*`、`AGENTS.md`                                                                                    | §13；每批落地后同步该批事实                                                                                                                                    | 1 起      |

### 9.3 公开面

- `BoardPublicApi` 71 成员**不变**：时序图没有必须暴露的命令。`BoardInternalMember`
  增 `sequence`、`lifeline`（服务字段，批次 1）与 `cascade`（复合查找，批次 3），
  分类编译锁会逼出遗漏。
- `CursorMode` 增 `'sequence'`（类型面 additive）。
- 包入口新增导出：`LifelineData`、`ActivationData`、`SequenceKind`、
  `SEQUENCE_ELEMENT_OPTIONS`、`SEQUENCE_MESSAGE_OPTIONS`、`SEQUENCE_FRAGMENT_OPTIONS`。
- DEV 探针：`vmStates` 透传 `vm.state`，`label / head / lifelineId / startPort /
endPort / textSide` 自动可断言，零新增探针。

### 9.4 接口签名（实施按此落地，签名不得漂移）

```ts
// ---- types/services.ts ----
export interface IActivationLookup {
  expandActivations(ids: string[]): string[];
  reconcileActivations(ids: string[], rectOf: (id: string) => IRect): void;
  adoptActivationsByLanding(ids: string[]): void;
}

/** VM 只读查询（LifelineVm / LineVm 经构造注入；组合根晚绑定注册 Tokens.SequenceLookup） */
export interface ISequenceLookup {
  /** 轴宿主的轴；非轴宿主或未组装返回 null */
  axisOf(id: string): IAxisAnchor | null;
  /** 绑定在某条生命线上的激活条的世界矩形（预览敏感） */
  barsOf(lifelineId: string): IRect[];
}

// rectEditor：可选整形探针（§3.5；批次 1）——planResize 末位应用，θ ≠ 0 不调用
constrainResize?(start: IRect, next: IRect): IRect;
// 批次 2 起：缩放松手钩子带起始矩形
onResizeCommitted?: (id: string, next: IRect, start: IRect) => void;

// ---- widgets/sequence/sequenceOps.ts（纯函数） ----
export type AxisMessageKind = 'horizontal' | 'self' | null;
export function axisMessageKind(
  data: { lineType: string; startNodeId: string | null; endNodeId: string | null },
  axisOf: (id: string) => IAxisAnchor | null,
): AxisMessageKind;
/** 两端 port 同移 dy；返回钳制后的 dy 与新 port（r4） */
export function shiftedAxisPorts(
  ends: ReadonlyArray<{ axis: IAxisAnchor; port: number }>,
  dy: number,
): { dy: number; ports: number[] };
export function constrainLifelineResize(start: IRect, next: IRect): IRect;

// ---- widgets/sequence/sequenceService.ts ----
export class SequenceService extends Disposable implements IActivationLookup, ISequenceLookup {
  readonly kind$: BehaviorSubject<SequenceKind>;
  initialize(): void; // 唯一注册 'sequence' 模式
  expandActivations(ids: string[]): string[];
  reconcileActivations(ids: string[], rectOf: (id: string) => IRect): void;
  adoptActivationsByLanding(ids: string[]): void;
  axisOf(id: string): IAxisAnchor | null;
  barsOf(lifelineId: string): IRect[];
}

// ---- widgets/line/lineAxisResize.ts ----
export function rewirePortsAfterResize(
  hostId: string,
  prev: IHostGeom,
  next: IHostGeom,
  ctx: { engine; vmEngine },
): void;
```

### 9.5 装配与晚绑定

- `sdk.lifeline = new LifelineService(...)` 与 `sdk.sequence = new SequenceService(...)`
  放在 `sdk.frame` 与 `sdk.lineService` 之后（后者随批次 2 起要转发两者的处理器）。
  `LifelineService` **不调 `initialize()`**（方法本身抛错，§7.1），只 `bindGridSnap`；
  `SequenceService.initialize()` 是 `'sequence'` 模式的唯一注册。
- `sdk.cascade = composeCascadeLookup(sdk.frame, sdk.sequence)`；selector、clipboard、
  layer 三处 `getFrames` 与命令宿主的 `cascade` 都指向它。
- `Tokens.SequenceLookup` 在 `SequenceService` 构造后注册；Vm 工厂在锚点求值时
  才 `resolve`（此时已注册），`axisOf` 对未注册返回 null。
- `onDragCommitted` / `onResizeCommitted` 里对每个 id 调 `anchorFollowHosts()`，
  对返回的每个宿主重路由（缺省探针 = 自身，既有行为不变）。
- `onActivate`（`boardAssemblyInteraction.ts`）增分支：`type === 'LIFELINE'` 且 `world`
  落在头框内 → 进标签编辑。`boardCommands.ts` 只加 `setDefaultToolOption` 的
  `'sequence'` 分支。
- 销毁序列加 `host.sequence?.dispose()` 与 `host.lifeline?.dispose()`（两行都带
  `?.`：`boardSdkDispose.test.ts` 的桩只注入部分字段）。

### 9.6 必须避开的陷阱（逐条对账）

| #   | 陷阱                                     | 正确做法                                                                                                                                                      |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 自消息草稿按 STRAIGHT 建、落定切 ELBOWED | 草稿按 ELBOWED 建；按 STRAIGHT 建的草稿拿不到自环路由，落定再切还多一次切型事务（§4.6）                                                                       |
| 2   | 轴宿主端口沿用两位小数                   | 轴宿主 r4；普通件维持 r2（§4.2）                                                                                                                              |
| 3   | 用 `nearestJoin` 给轴宿主选边            | `axisJoinFor`；前者对高瘦矩形返回 top / bottom                                                                                                                |
| 4   | 锚点直接取轴上点                         | 让出一个 `LINE_END_GAP`，方向随 join（§3.2）                                                                                                                  |
| 5   | 多个服务各自注册 `'sequence'`            | `handlers.set` 后者覆盖前者；只有 SequenceService 注册                                                                                                        |
| 6   | `LifelineService.initialize()`           | 它的 scope 也是 `'sequence'`，会覆盖注册；方法直接抛错（§7.1）                                                                                                |
| 7   | 激活条创建后再写 `lifelineId`            | 写进创建数据（陷阱 11）                                                                                                                                       |
| 8   | 绑定写在拖拽事务之外                     | undo 裂项；在 `commitDrag` 的 transact 内（S7）                                                                                                               |
| 9   | 对齐 / 分布只位移参与体                  | 生命线的随行激活条按宿主 delta 同事务位移（§1.2 G-11）                                                                                                        |
| 10  | `previewFollow` 只认 `selected$`         | 拖激活条时把其生命线并入「移动宿主集」（§4.1 探针）                                                                                                           |
| 11  | 在 `lineService.ts` 里写新逻辑           | 已 397 行；新行为落新协作者，本文件只留一行转发                                                                                                               |
| 12  | 策略缺省时也走新分支                     | `getDrawPolicy()` 返回 undefined 即原路径；单测锁创建数据逐字节相等                                                                                           |
| 13  | 事务内读 `vm.getBounds()`                | 微任务合批旧值；`rectOf` 用算术或 `model.toJSON()`                                                                                                            |
| 15  | 在 vm 的 diff 观察者里补写派生数据       | 并入触发它的命令事务：微任务相晚于 `stopCapturing` 会裂成独立撤销项，undo·redo 触发同一 diff 还会覆盖恢复出的状态并清空重做栈（specs/flowchart-closeout §24） |
| 16  | 把生命线 / 激活条加进 `ParentIdField`    | 不带字段，归属结构上不可写（S5）                                                                                                                              |
| 17  | 贴着 400 行的文件直接加逻辑              | `lineService.ts` 先瘦身到 ≤ 370；`rectEditorService.ts` 批次 1 后 399 行、再动先拆旋转手势；`lineHoverOverlay.ts` 397 行：只加实参（§1.6）                    |

## 10. 性能

- 锚点求值多一次 `barsOf`：对本生命线的激活条 O(k) 扫描，k 是单条生命线上的条数
  （个位到十几）。一次 `reattachAll` 的总量 = 线数 × k，时序图规模下可忽略。
- `isAxisMessage()` 在 render 时算一次并缓存，拖拽会话每帧只读布尔。
- 轴消息平移每帧只写 `root.position`，零 Yjs 写；松手一次 update。
- `rewirePortsAfterResize` 只扫锚定在被缩放宿主上的线，且 port 不变不写。
- 规模预期：一张时序图 5–20 条生命线、10–40 条消息、约等量的激活条，远低于
  性能基准（docs/16 §7）的 1000 控件。

## 11. 验收

### 11.1 单测（vitest）

| 文件                                               | 覆盖                                                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lifelineGeometry.test.ts`                         | 头框 / 轴派生；`axisAnchorPoint` 钳制；`axisJoinFor`；`axisPortFor`；锚点让位方向 × 条半宽；命中（头 / 轴带 / 轴旁 / 退化）                            |
| `sequenceOps.test.ts`                              | `axisMessageKind` 全分支；`shiftedAxisPorts` 钳制与幂等；`resolveActivationHost`（容差内 / 外 / 无纵向重叠 / 多宿主取最上）；`constrainLifelineResize` |
| `lineAxisAnchor.test.ts`                           | `resolveAnchorPick`：轴宿主与普通件；四类预设的内容；join 归一                                                                                         |
| `lineDrawPolicy.test.ts`                           | 策略缺省 → 创建数据与现状逐字节相等（S8）；有策略 → 写显式 port / 预设 / 落空删除 / 自消息保留 ELBOWED                                                 |
| `lineAxisResize.test.ts`                           | 轴加长 / 缩短 / 顶边下移后端点绝对高度不变；落轴外钳 1；port 不变零写入；非轴宿主 no-op                                                                |
| `lineTextSide.test.ts`                             | 缺省锚点 = 路径点（现状）；above / below 偏移方向与距离                                                                                                |
| `selectorDrag.test.ts`（扩）                       | 轴消息纯线选区建会话且 `axis = 'v'`；混有线与普通线仍不建；预览只动 y                                                                                  |
| `sequenceService.test.ts`                          | 按种类转发到 `lifeline.handlers`、事件时解析目标种类（批次 1）；激活条创建带 `lifelineId` 且 x 归中；起点非轴不建；只读早退                            |
| `lifelineLabelEditor.test.ts`                      | descriptor 形状；只读早退；点不在头框内拒绝；Enter 提交；空文本保留；写过才 `stopCapturing`；清洗（空白折一 / 截 64 字素）（批次 1）                   |
| `labelText.test.ts`                                | 上提后的清洗与截断逐值不变（特征测试，批次 1）                                                                                                         |
| `sequenceCascade.test.ts`                          | 复合查找的展开并集去重保序；reconcile / adopt 两者依次调用；其余直通 frame                                                                             |
| `sequenceBinding.test.ts`                          | 拖入绑定并归中、拖出解绑、微移归中、孤儿不改写；真 Y.Doc + 真引擎下与移动同事务一步 undo                                                               |
| `clipboardSequence.test.ts`                        | 同批 `lifelineId` 重映射；批外删键；粘贴收尾落点重绑；容器先入批顺序不受影响                                                                           |
| `alignCommand.test.ts`（扩）                       | 生命线参与对齐时随行激活条同 delta；FRAME 仍被剔除                                                                                                     |
| `frameService.test.ts`（扩）                       | LIFELINE / ACTIVATION 不被自动归属、不被拖放归属；`createPreset` 合并且缺省不变                                                                        |
| `lineAnchorFollow.test.ts`（扩）                   | 拖激活条时消息端点视觉跟随；删激活条后端点让位复位；`rerouteLine` 对自消息不再被触发                                                                   |
| `lineHoverMath.test.ts`（扩）                      | 轴消息线身 hover 光标 `ns-resize`；端点 12 屏幕 px 内仍 grab；普通 STRAIGHT 线无光标（现状）                                                           |
| `lifelineVmRender.test.ts`、`activationVm.test.ts` | 渲染分支、主题双态、缩放整形、探针返回值；生命线另测：头框 ∪ 轴带命中、`isRouteObstacle()` 为 false、`constrainResize` 接纯函数（批次 1）              |
| `shapeContrast.test.ts`（扩）                      | 生命线标签 / 激活条边框对各自填充 ≥ 4.5:1（#333333 对 #ffffff）                                                                                        |
| `widgetRegistry.test.ts`                           | 十二类型清单；能力位；`TYPES_WHERE` 期望集                                                                                                             |

### 11.2 E2E（`sequence.spec.ts`）

探针 = `__spinthDebug.__debug`。批量路径（粘贴、恢复）后的绑定断言读
`engine.getModelById(id).toJSON()` 文档真值（specs/container-frame §6.6 陷阱 11）。
新增 `e2e/helpers/sequenceE2e.ts`：`createLifeline`、`axisScreenPoint`（轴上高度 →
屏幕坐标）、`drawMessage`、`messageOf`，避免逐例手写手势。

| 用例 | 断言                                                                                                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-1  | 生命线创建：单击默认尺寸按下点居中、工具保持；拖拽画图松手选中并回选择工具；滑移 < 10px 仍按单击                                                                   |
| Q-2  | 标签编辑：再点头框进编辑、Enter 落库；空标签保留；一步 undo；点轴不进编辑                                                                                          |
| Q-3  | 同步消息：从 A 轴按下拖到 B 轴 → STRAIGHT、实心箭头、两端 `startPort` / `endPort` 等于按下高度、两端 y 相差 < 0.5                                                  |
| Q-4  | 返回 / 异步消息预设：`dashed` 与 `endArrow` 落库值；消息标签在线上方（批次 4 追加）                                                                                |
| Q-5  | 落空取消：松手在空白或非轴宿主 → 模型计数不变；起点不在轴上 → 不建线                                                                                               |
| Q-6  | 自消息：同轴纵向拖 ≥ 8px → ELBOWED、4 点环、朝按下侧；间距 < 8px → 取消                                                                                            |
| Q-7  | 消息平移：拖线身 +60 → 两端 y 同移、仍水平、一步 undo；↑ ↓ 微移有效、← → 零写入                                                                                    |
| Q-8  | 加长保高度：拖生命线底边手柄 +200 → 其上消息 y 逐值不变（port 被重写）；缩短后钳底                                                                                 |
| Q-9  | 生命线移动：水平拖 → 消息与激活条跟随；顶边对齐吸附到相邻生命线                                                                                                    |
| Q-10 | 激活条：轴上创建并绑定；拖离解绑；拖回重绑并归中；删生命线连带删、一步 undo 全回                                                                                   |
| Q-11 | 条边让位：无条时箭头停在轴上；建覆盖该高度的条后端点 x = 轴 ± 5；条加长后另一条消息翻转；消息数据不变                                                              |
| Q-12 | 片段：预设落库（`fill: 'none'`、标题）；内部空白点击穿透到消息；拖片段不动生命线与激活条                                                                           |
| Q-13 | 不进容器：片段内建生命线与激活条 → 文档无 `parentId`                                                                                                               |
| Q-14 | 复制粘贴：复制生命线带激活条、`lifelineId` 指向副本；单独粘贴的条落在轴上重绑                                                                                      |
| Q-15 | 流程图回归：两个普通形状间拉线仍落 0.5 中点且无 port；普通直线线身仍不可拖                                                                                         |
| Q-16 | 只读：按 Q 被钳回 cursor、工具钮禁用、不进标签编辑、拖动不写                                                                                                       |
| Q-17 | 项目文件往返 + 导出 PNG；刷新恢复                                                                                                                                  |
| Q-18 | 390px：工具坞第 12 钮可达、三组二级菜单、无横向溢出；快捷键 Q 与种类切换                                                                                           |
| Q-19 | 打磨（批次 4）：ActionBar「头部样式」切小人 → `head: 'actor'` 落库、一步 undo；轴消息线身 hover 光标 `ns-resize`（端点附近仍 grab）；普通 STRAIGHT 线 hover 无光标 |
| Q-20 | 命中口径（批次 1）：点轴旁空白（bbox 内、轴带外）不选中、点轴选中；框选只碰头旁空白不入选、擦过轴带入选                                                            |
| Q-21 | 缩放整形（批次 1）：拖 east 手柄宽度对称、轴 x 不变；拖到 60 以下钳 60；高度钳 120；拖拽中编辑框与图形贴合                                                         |
| Q-22 | 不进容器与避障豁免（批次 1）：容器内建生命线 → 文档无 `parentId`；通用折线穿过生命线 bbox 不绕行                                                                   |
| Q-23 | 刷新恢复与项目文件往返（批次 1：生命线与标签；后续批次追加消息 / 激活条 / 片段）                                                                                   |

批次与用例的对应：批次 1 = Q-1、Q-2、Q-16、Q-18（只验证图元组）、Q-20…Q-23；批次 2 =
Q-3…Q-9、Q-15；批次 3 = Q-10、Q-11、Q-13、Q-14；批次 4 = Q-4 标签断言、Q-12、Q-19。
Q-17、Q-18 随各批追加内容。

### 11.3 视觉基线

`sequence-sample`——登录时序，进 E2E 夹具：

- 生命线三条：x = 240 / 560 / 880，宽 120，顶 y = 120，高 720；「用户」用 actor 头。
- 消息五条：用户→客户端「输入账号密码」(y 220)；客户端→服务端「登录请求」(y 300)；
  服务端自消息「校验」(y 380)；服务端→客户端 返回「令牌」(y 460)；
  alt 片段内客户端→用户 返回「进入首页」(y 560) 与「提示失败」(y 700)。
- 片段：alt，x 160…1040、y 520…760，标题「alt [令牌有效]」；else 分隔线 y 640。
- 激活条两条：客户端 y 300…760，服务端 y 300…460。
- 截图前清点断言 `{ lifeline: 3, line: 6, frame: 1, activation: 2 }`，page 级 clip
  （specs/linux-visual §14.10 口径）。
- 双平台各 1 张；提交前 `pnpm visual:linux -- --stability` 双跑全等。
- 既有 11 张基线逐字节不变（S8）；工具坞多一钮，涉及工具坞入镜的基线按
  specs/container-frame 的做法删文件强制重生成。

### 11.4 门禁与回归面

`pnpm verify` + `pnpm test:e2e` + `pnpm visual:linux` 全绿；新增文件均 < 400 行。
必跑回归：`mobile.spec`、`a11yLayout.spec`、`textScale.spec`、`a11yKeyboard.spec`、
`a11y.spec`、`toolbarMenu.spec`（工具坞 +1 钮）；
`flowchart.spec`、`lineCreate` / `lineEndpoint` / `lineSelect` / `lineStyle` /
`lineText` / `lineQuickAdd` / `toolbarLine`（连线子系统与 hover 光标）；
`styleResize.spec` / `rotate.spec` / `rotateAnchor.spec` / `alignAnchor.spec` /
`imageResize.spec`（缩放整形探针）；
`container.spec` C-1…C-18
（级联查找换对象）；`clipboard.spec`、`align.spec`、`refline.spec`、
`historyLayer.spec`、`shortcuts.spec`、`debugSurface.spec`、`network.spec`、
`symbol.spec`（锚点单源与标签函数上提）。

### 11.5 手工验收

1. 用时序图工具连点三个位置：三条生命线头部对齐；拖第二条，参考线把它吸到等间距。
2. 从第一条轴的中部拖到第二条轴再拖到第三条轴，连画三条消息：全部水平、箭头停在轴上、
   高度就是按下高度。
3. 双击一条消息输入文字：文字在线上方，线不断。
4. 拖一条消息的线身上下移动、再按上下键：两端一起走，不出生命线两头。
5. 拖第一条生命线的底边把轴加长一截：已有消息纹丝不动。
6. 在第二条轴上按下向下拖出一个激活条；把第一条消息的终点附近也建一个：
   穿过条的消息箭头改停在条边。拖动条的上沿：消息不动。
7. 横向拖第二条生命线到别处：条和消息都跟着走。单独拖条离开轴再拖回：条居中。
8. 从一条轴按下、往下拖 30px 松手：出现向右的小环；从轴左侧按下再做一次：环朝左。
9. 选 alt 在消息区域画一个框：既有内容不动、框内点击仍能选中消息；再点标题带把标题
   改成「alt [已注册]」；用分隔线在框内画一条横线。
10. 0.2x 与 4x 缩放下都能点中轴选中生命线；390px 下工具坞能滚到时序图并打开二级菜单。

## 12. 实施分批

2026-11-26 人类拍板分批实施：每批是一轮审查的单位——批末同步该批事实到 docs、
跑全量 `pnpm test:e2e`、确认 HEAD 的 CI `gate`；下一批开工前再规划。每批若干提交
（`feat:` / `refactor:` / `test:` / `docs:` 前缀 + 中文描述），每笔可单独回退。推送时
pre-push 钩子跑完整 `pnpm verify`，所以**每笔提交都必须自洽全绿**——编译锁相关的
改动不能拆到两笔里。

| 批次 | 内容                                                                                                                                                         | 出口（断言）                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1    | 地基 + 生命线：三笔零行为重构 → 生命线几何 → 缩放整形探针 → LIFELINE 控件 → 标签编辑 → SequenceService 与装配 → 工具坞入口与快捷键 Q → E2E → 视觉基线 → docs | Q-1、Q-2、Q-16、Q-18（图元组）、Q-20…Q-23 绿；`lineService.ts` ≤ 370 行；连线行为逐字节不变 |
| 2    | 轴锚定 + 消息：落点策略、拉线策略、三类消息、quick-add 资格、轴消息平移、加长保高度、自消息；旋转手势拆出 `rectEditorService`                                | Q-3…Q-9、Q-15 绿                                                                            |
| 3    | 激活条：控件、绑定、复合查找、剪贴板、对齐随行                                                                                                               | Q-10、Q-11、Q-13、Q-14 绿                                                                   |
| 4    | 组合片段（FRAME 预设 + 分隔线）+ 打磨：线上文字侧别、actor 头、轴消息悬停光标、ActionBar                                                                     | Q-4 标签断言、Q-12、Q-19 绿                                                                 |
| 5    | `sequence-sample` 视觉基线双平台 → 最终 docs 与 roadmap §4.5                                                                                                 | `verify` / `test:e2e` / `visual:linux` 全绿                                                 |

批次 2–5 的细化到各自规划时再定。Q-4 的「消息标签在线上方」断言随批次 4 追加。
工具坞入镜内容变化的批次都要更新视觉基线（强制重生成，§11.3）。

## 13. 文档同步清单

| 文档      | 改什么                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| docs/04   | §3 注册表示例补 SYMBOL / FRAME / LIFELINE / ACTIVATION；§4 能力位表加两行；§8 控件清单加两行并补时序图件小节                 |
| docs/08   | §3 轴锚定与按下点端口；「线不可整体拖动」补轴消息例外；§6 线上文字侧别；§7 自消息；§9 挂账更新；§10.2 hover 光标补轴消息线身 |
| docs/05   | §4.4 线例外补充「轴消息可沿轴平移，键盘纵向微移有效」；缩放松手钩子带起始矩形                                                |
| docs/06   | §2 参照物清单改为「由能力位派生」并列全当前类型                                                                              |
| docs/03   | §7 `CursorMode` 联合补齐到当前全部取值                                                                                       |
| docs/02   | 容器归属不变量补一句：时序图件不带 `parentId`；激活条绑定的读侧降级                                                          |
| docs/09   | 快捷键表增 Q                                                                                                                 |
| docs/12   | 工具坞增「时序图」                                                                                                           |
| docs/13   | §4.5 状态随各批更新；§4.0 底座表登记「轴锚定」在 4.5 首发                                                                    |
| docs/15   | 单测 / E2E 计数与用例清单；基线张数                                                                                          |
| AGENTS.md | 「当前状态」补 4.5 各批落地情况（该文件改动需人类确认）                                                                      |

原则：docs 只写当前事实；每批落地后同步该批事实；过程与决策留在本文件。

## 14. 风险与回滚

| 风险                                         | 影响                       | 缓解 / 回滚                                                                                                                           |
| -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 连线子系统回归                               | 流程图连线行为漂移         | 全部增量以轴宿主为门；S8 单测锁创建数据；连线 7 个 spec 必跑                                                                          |
| 级联查找换对象影响容器                       | 拖拽 / 删除 / 复制带子异常 | 复合查找只做并集与依次调用；`container.spec` C-1…C-18 必跑                                                                            |
| 端口精度或让位方向写错                       | 消息高度跳变、箭头悬空     | `lineAxisAnchor` / `lineAxisResize` 纯函数单测逐值锁；Q-3、Q-8                                                                        |
| 片段在最上层压住图                           | 边框与标题叠在消息上       | 无填充 + 命中只在带与环；「片段自动置底」列挂账                                                                                       |
| 工具坞第 12 钮挤爆窄屏                       | 390px 布局                 | 既有内滚口径；`mobile.spec` / `a11yLayout.spec` 必跑                                                                                  |
| 行数铁律                                     | 审查返工                   | 前置重构先腾行数；`selectorService.ts` 零改动；新文件各 < 300 行；`rectEditorService.ts` 先拆旋转手势、`lineHoverOverlay.ts` 只加实参 |
| 存量行数债                                   | `types/widget.ts` 继续变长 | 本批 +约 50 行；拆分另立重构，不混入本批                                                                                              |
| 激活条与消息语义不一致（用户预期条带动消息） | 体感                       | 已拍板「消息只认轴」（§15 第 3 条）；调整条只重路由箭头让位，消息数据不动；两种口径实现成本相近，改口径时只换锚点来源                 |

回滚：LIFELINE / ACTIVATION 是新增类型，删注册项即回退，已存文档中的两类进隔离区、
数据不损坏；`textSide` 与显式 port 是 optional 字段，老客户端按未知键保留。

## 15. 拍板记录

2026-11-26，人类拍板：以下十项**全部按推荐方案**定稿。正文即定稿口径；本节保留
每项的取舍理由与未取的替代，供实施与后续审查对照。

| #   | 事项                        | 结论                                                                                 | 未取的替代及其问题                                             |
| --- | --------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1   | 消息交互缺口的范围（D3–D6） | 五项全做                                                                             | 只做创建：消息画出来就改不了时间位置，加长生命线还会把消息推走 |
| 2   | 激活条形态（D7）            | 独立控件 + `lifelineId` 绑定                                                         | 纯 SHAPE 窄矩形预设：不随生命线、会被片段收养                  |
| 3   | 消息附着口径（D8）          | 消息只认轴，激活条只影响箭头让位                                                     | 消息直接锚到激活条边：实现更省，但调整条会拖走消息端点         |
| 4   | 删生命线与激活条            | 连带删除（FRAME 连子删先例，一步 undo 可回）；消息维持「解绑不删」                   | 不连带：留下孤儿条，与容器连子删的口径不一致                   |
| 5   | 组合片段（D9）              | `FRAME` 预设。接受两个局限：标题带是整宽矩形而非五角标签页；嵌套片段只做视觉嵌套     | 专用五角标签页控件：收益低于成本                               |
| 6   | 线上文字侧别（D10）         | 本批做（批次 4）。它是 4.6 类图、4.7 的连线标签同样需要的底座                        | 延后：消息标签只能骑线镂空                                     |
| 7   | actor 头                    | 本批做（批次 4）。只在「登录时序」样本里用到一次                                     | 延后：样本的「用户」只能用 box 头，不影响完成标志              |
| 8   | 模板（D12）                 | 不做。需要先有「插入示例」这项通用能力，不应为 4.5 单独造                            | 为 4.5 单独造插入示例机制                                      |
| 9   | 工具入口与快捷键（D11）     | Q、工具坞第 12 钮、主题色沿用 shape 槽位。Q 是空闲字母里唯一能让人联想到 sequence 的 | 其他字母：联想度不如 Q                                         |
| 10  | 范围外清单（§0.3）          | 照单确认，没有必须进本批的项                                                         | —                                                              |

## 16. 设计自审（铁律对账）

| 铁律                                           | 本设计的落点                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档即规格                                     | §13 同步清单；每批落地后同步该批事实（§12）                                                                                                |
| 接口先行                                       | §2 schema、§4.1 探针、§9.4 签名均先于实现                                                                                                  |
| 数据流：禁绕过 Yjs 改 VM / PIXI                | 拖拽期只写 `root.position`；松手一次 update；绑定写只在事务内（S7）                                                                        |
| 显式依赖                                       | VM 的只读查询经构造注入 + Token 晚绑定；服务字段走组合根；无全局单例                                                                       |
| 单文件单职责 < 400 行                          | 新文件各 < 300 行；`lineService.ts` 先瘦身再接；`selectorService.ts` 零改动；`rectEditorService.ts` 先拆旋转手势再改签名                   |
| 测试护栏                                       | §11.1 二十组单测 + §11.2 二十三例 E2E + 视觉基线 + 必跑回归面                                                                              |
| 新增控件 = 三件套                              | LIFELINE / ACTIVATION 各三件套 + 注册；不改 dataEngine / vmEngine                                                                          |
| 单机优先                                       | 零服务端、零网络；种类记忆是会话态                                                                                                         |
| 渲染同步六条                                   | 平移预览绝对定位（规则 1）；会话标记 `DragState.axis` 由 Service 持有（规则 3）；松手用最后一帧 dy（规则 5）；宿主差异走 VM 探针（规则 6） |
| 公共 API 收口                                  | 无新公开成员；三个内部成员（`sequence`、`lifeline`、`cascade`）经分类编译锁；`CursorMode` additive                                         |
| 新控件接入只读 / 持久化 / 导出 / 剪贴板 / 撤销 | §7.3、§2.6、§9.1、§5.4、S7                                                                                                                 |

## 17. 实施手册（给实施 agent）

1. **先读**：docs/08、docs/05 §4、docs/14、specs/container-frame §4.2 与 §6.6、
   specs/flowchart-closeout §7。
2. **顺序即依赖**：§9.2 的 #1–#3 是零行为重构（批次 1），各自单独提交并跑全量单测
   后再往下；#21 的旋转手势拆出同款（批次 2，零行为、单独提交，先于签名改动）。
   零行为重构的护栏是重构前后都绿的特征测试，不是先红后绿。
3. **每一项先落一条会红的测试**：纯函数先写单测；编排 bug 的护栏先在旧实现上跑红。
4. **门禁**：提交后立即推送，pre-push 钩子跑完整 `pnpm verify`（约 3 分钟，期间不要
   改工作区）；不要 `--no-verify`。改交互的批补跑 §11.4 的回归面。
5. **遇到歧义**：在 §19 记一行「原文 → 实际做法 → 理由」，并找设计者确认；不要自行
   扩大范围。
6. **不要碰**：`selectorService.ts`、`lineRoute.ts`、`lineRouteSelfLoop.ts`、
   `FrameService` 的归属方法。发现必须改时先停下确认。
7. **E2E 写法**：坐标从探针世界坐标反推屏幕坐标（加画布偏移与顶栏 44px），不手写
   屏幕数字；批量路径后的断言读文档真值。既有 helper `createTwoRects` 实际只建出
   一个矩形（拖拽画图后工具回选择模式，specs/flowchart-closeout §24）——需要两端
   锚定的线时自己建矩形，在边内侧按下 / 松手。
8. **基线**：改工具坞后删 `theme-*-darwin.png` 强制重生成（2% 容差会吞掉少一个
   按钮的漂移）；提交前跑 `--stability`。

## 18. 审查清单（设计者复核时逐条核对）

- [ ] 轴宿主判定没有落到 type 分支：连线、selector、rectEditor 的改动里没有
      `=== 'LIFELINE'` / `=== 'ACTIVATION'`。
- [ ] 策略缺省路径的创建数据与现状逐字节相等（单测在旧实现上跑过）。
- [ ] 自消息草稿是 ELBOWED；没有依赖 `rerouteLine`。
- [ ] 轴宿主端口 4 位小数；普通件端口仍是 2 位。
- [ ] 绑定写与移动同事务；粘贴收尾另起事务；undo / redo 不重判。
- [ ] 对齐 / 分布带上了随行激活条；FRAME 仍被剔除。
- [ ] 加长保高度在缩放同一撤销项内，且 port 不变时零写入。
- [ ] `lineService.ts`、`selectorService.ts`、`boardActionBar.ts`、`rectEditorService.ts`、
      `lineHoverOverlay.ts` 都 < 400 行；旋转手势拆出后既有 rotate 单测全绿。
- [ ] 新增文件全部 < 400 行；`types/widget.ts` 的增量只含 schema 与注册项。
- [ ] 批次 4 三项（线上文字侧别、actor 头、轴消息悬停光标）都在；Q-4 标签断言与 Q-19 绿。
- [ ] 批次 1：生命线没有覆写 `getAnchorPoint`（轴锚定在批次 2）；`LifelineService.initialize()` 抛错有单测；缩放整形经 `constrainResize` 探针、θ ≠ 0 不调用，Q-21 的编辑框与图形贴合。
- [ ] 既有 11 张视觉基线逐字节不变（工具坞入镜的除外）。
- [ ] 公开面 71 成员不变；`BoardInternalMember` 的新增项分类正确。
- [ ] docs/04、08、05、06 与实现一致；docs/13 §4.5 状态已改写。

## 19. 实施记录（实施 agent 填写）

### 19.1 批次 1：地基 + 生命线

**开工前的订正（2026-11-26，规划阶段读码发现；正文已同步改写）**

| 原文                                              | 实际做法                                                       | 理由                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §3.1、§9.2 #3：标签函数上提 `common/labelText.ts` | 落到 `platform/textEngine/labelText.ts`                        | `common/README.md` 约定 common 不依赖 platform / widgets；截断依赖文字测量                                                     |
| §9.2 #30：`onActivate` 分支在 `boardCommands.ts`  | 在 `boardAssemblyInteraction.ts`                               | 该回调的组合根接线在那里；`boardCommands.ts` 只有 `setDefaultToolOption` 分支                                                  |
| §8.1：store 增 `sequenceKind` 镜像                | 走工具参数通道，Toolbar 读 `defaultToolOptions`                | `treeKind` 是从 `cursorMode$` 派生的，带不了工具参数；符号按钮已有同款通道                                                     |
| §9.3、§9.5：`sequence` / `sequenceService` 混用   | 统一为 `sequence`、`lifeline`                                  | `BoardInternalMember` 编译锁按字段名                                                                                           |
| §7.1、§9.2 #2：工厂放 `lineQuickAddHost.ts`       | 另起 `lineCollaborators.ts`                                    | 该文件现只放 quick-add 的宿主适配器；三个协作者的构造是另一职责                                                                |
| §3.2、§4.2、§4.8：轴锚定属 P0                     | 整体归批次 2；`IAxisAnchor` 类型与 `LINE_END_GAP` 上提一并后移 | 人类拍板：第一批里生命线对既有连线工具是普通矩形控件，连接点与落点一致；轴锚定必须连同悬停反馈、quick-add 资格一起改连线子系统 |
| §3.5：生命线在 VM 的预览 / 落库方法里整形         | 经 `constrainResize` 探针整形                                  | 人类拍板：VM 层整形时编辑框按未整形的矩形画，宽度对称与触到下限时框与图形不贴合                                                |

**提交**（随各笔回填）

| #   | 提交 | 内容 | 实测 |
| --- | ---- | ---- | ---- |
