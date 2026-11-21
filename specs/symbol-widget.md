# 符号控件（SYMBOL）技术方案

> 状态：**设计定稿，待实施**。本文件是 docs/13 阶段 4.3「网络拓扑 / 架构图」的前置底座，
> 4.7 BPMN 的符号随后复用；4.6 的分栏类图不在此列。
>
> 已拍板（用户决策，不再重开）：
>
> 1. 标签放在图形外、且**计入控件 bbox**（图形区 + 标签区两段几何）。
> 2. 图形资产采用**内置 SVG 资产**。
> 3. `eng-database / eng-queue / eng-file / eng-folder` 四型在符号控件中各做一份（形状保留）。
> 4. 支持**逐实例着色**（`color` optional）；缺省随主题墨色。
>
> 配套：`specs/network-diagram.md`（4.3 图种设计）。

## 0. 摘要

### 0.1 一句话

新增 `SYMBOL` 控件：**一个矢量图标 + 一行外置标签**，标签计入 bbox；图标来自内置 SVG
资产（自绘单色线稿），构建期内联为 TS 常量，运行时零网络请求、零资产引用。

### 0.2 关键决策

| 编号 | 决策     | 结论                                                                    | 主要理由                                              |
| ---- | -------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| D1   | 承载     | 新增 widget type `SYMBOL`，不扩 `ShapeType`                             | 标签外置与形状的「框内文字」是两套几何契约            |
| D2   | 标签几何 | 图形区 + 标签区，标签**计入 bbox**                                      | 命中 / 框选 / 对齐 / 导出天然一致；标签外溢问题不存在 |
| D3   | 图形资产 | 内置 SVG 资产，构建期内联为 TS 常量                                     | 矢量清晰、可着色、离线零成本、可单测；运行时不解码    |
| D4   | 标签数据 | 纯文本 `label`，单行，≤ 64 字符                                         | 符号名是标识不是富文本；单行让几何稳定                |
| D5   | 锚点     | 贴**图形区**四边（`t ∈ [0,1]`），标签区不参与锚定                       | 连线落在图标上而不是名字上                            |
| D6   | 尺寸能力 | 可缩放；不旋转；无 autoHeight；标签带恒高 24                            | 图标不该被文字撑变形；标签带恒定 = 几何与对齐可预测   |
| D7   | 容错     | 未知 `symbol` id 渲染占位图，不阻断导入                                 | 项目文件跨版本 / 未来符号包更安全                     |
| D8   | 公开面   | 不新增 `BoardSDK` 成员；`CursorMode` 增 `'symbol'`；导出类型            | 工具默认值走既有 `setDefaultToolOption`，无需新命令   |
| D9   | 资产来源 | 自绘，不引第三方图标库                                                  | 许可与来源卫生零负担                                  |
| D10  | 与 IMAGE | 一期不吸收「IMAGE 当图标」场景；列路线图二期                            | 先保证 4.3 交付，IMAGE 替换涉及资产 / 导出迁移        |
| D11  | 着色     | per-实例 `color`（optional），缺省随主题；色板复用 `TEXT_COLOR_PALETTE` | 图标与标签同色；写入即固定（同 textColor 语义）       |

### 0.3 不做什么

- 多行标签 / 富文本 / 自动换行；旋转；符号内状态（端口号、告警、选中态标记）。
- 自定义符号上传、运行时符号包加载、SVG 外链。
- 容器语义（子元素归属、裁剪、带子移动）——属于 4.4 的 FRAME，符号只是图元。
- 语义模型（设备类型校验、连接规则、拓扑自动布局）。

## 1. 动机与边界

### 1.1 形状装不下符号

现有 20 型形状全部是「一个轮廓 + 框内文字」：`shapeVm` 用 `insetRectOf` 逐型算内接箱，
文字垂直居中、溢出裁剪。按「图形是否靠内部细节识别 / 文字是否有干净主体」审计：

| 分类                 | 型                                                                                                                                                                 | 结论                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 文字容器（正确设计） | rect、round-rect、ellipse、diamond、triangle-up/down、parallelogram-left/right、stadium、document、hexagon、predefined-process、trapezoid-up/down、delay、off-page | 流程图语义就是「写着步骤名的框」；内接箱正是为文字服务      |
| 混合态               | eng-database、eng-queue                                                                                                                                            | 端头已让开、文字放在「身」里；拓扑图惯例却是图标 + 下方名字 |
| 偏符号（图标语义）   | eng-file、eng-folder                                                                                                                                               | 折角 / 标签页占据顶部，文字被挤到剩余区                     |

补充证据：全库只有 3 型有内部细节线（`drawShapeDetails`：predefined-process 双竖线、
eng-database 顶盖内弧、eng-queue 右端内弧），而网络符号恰恰靠细节线识别（箭头、砖缝、端口）。
形状模型没有「图形区 / 标签区」两段几何，把标签塞进框内是唯一解——这正是要新增控件的原因。

### 1.2 为什么不是扩 ShapeType

- `ShapeType` 的每个值都隐含「文字在框内」契约，并被 ActionBar 的类型切换当作可互换容器
  （`SHAPE_TYPE_OPTIONS` 20 项平铺）。加 `net-*` 会同时污染这两条语义。
- 符号需要图形区 / 标签区两段几何、锚点只贴图形区、标签单行纯文本——这些都不该由
  `insetRectOf` 承担，也不该让 20 型形状继承。
- 枚举会从 20 涨到 30+，且 4.7 BPMN 还要再来一批；新增类型是更干净的扩展位。

### 1.3 为什么不是 IMAGE + TEXT

现状放图标 = `IMAGE`（只有 `src/rotation/groupId`，没有标签字段）+ 独立 `TEXT`：
两个对象、移动要手动同步、项目文件要带位图资产（资产 GC / MIME / 体积）、缩放糊。
符号控件把「图标 + 名字」收成一个对象，且图形是矢量、数据里零资产引用。

二期可考虑让符号控件吸收「用户自带图标」的场景（路线图挂账），一期不做。

### 1.4 与 eng-* 形状的关系

形状侧的四个 `eng-*` **保持不动**（老文档零迁移）；符号侧各做一份同名语义的图标：
`net-database / data-queue / doc-file / doc-folder`。两者并存，差别是标签位置与几何契约。
将来若要收编形状侧，属于另一件事，必须做旧文档兼容。

### 1.5 与 4.4 容器的关系

符号不是容器：没有子元素归属、没有裁剪、不参与「移动容器带子」。集群 / 区域在 4.3 用
矩形 + 标题 + 编组近似（见 `specs/network-diagram.md` §5）。

## 2. 数据模型

### 2.1 schema

```ts
// packages/core/src/types/widget.ts
export const SymbolSchema = z.object({
  id: z.string(),
  type: z.literal('SYMBOL'),
  zOrder: z.string(),
  /** 符号种类 id；未知值降级占位（D7），不用 enum 以免旧客户端导入新文件失败 */
  symbol: z.string().default('net-server'),
  /** 外置标签（纯文本，单行，≤ 64 字符）；空串 = 只画图标 */
  label: z.string().default(''),
  /** 逐实例着色（hex）；缺省 = 主题文字色（light #333333 / dark #ededf2） */
  color: z.string().optional(),
  ...GroupIdField,
});
export type SymbolData = z.infer<typeof SymbolSchema>;
```

几何字段（x/y/width/height）不入 schema 主对象，走独立 rect YKeyValue——与 SHAPE 同一条
扁平化路径（docs/02 §2）。

### 2.2 字段语义

| 字段      | 类型    | 缺省         | 语义                                          |
| --------- | ------- | ------------ | --------------------------------------------- |
| `symbol`  | string  | `net-server` | 图标 id，见 §4.1 清单；未知值 → 占位图        |
| `label`   | string  | `''`         | 纯文本（不是 HTML）；渲染与编辑都按纯文本处理 |
| `color`   | string? | 无（随主题） | 图标与标签的着色；缺省跟随主题墨色            |
| `groupId` | string? | 无           | 编组标记，与自由六类同语义（docs/18）         |

### 2.3 与 SHAPE 的差异

| 维度       | SHAPE                            | SYMBOL                                       |
| ---------- | -------------------------------- | -------------------------------------------- |
| 文字位置   | 框内内接箱，垂直居中             | 图形下方固定标签带（24 高）                  |
| 文本数据   | HTML（TipTap）                   | 纯文本 `label`                               |
| 形状切换   | ActionBar 可换 20 型             | ActionBar 可换符号种类（图形区不变）         |
| 锚点       | 轮廓交点（`outlineAnchor`）      | 图形区矩形四边（覆写 `getAnchorPoint`）      |
| autoHeight | 有（撑高形状）                   | 无（高度恒用户控制）                         |
| 旋转       | 数据能力保留（入口隐藏）         | 不支持（`rotatable: false`）                 |
| 样式       | fill / borderColor / borderWidth | 单色着色：`color` optional（图标与标签同色） |

### 2.4 注册

```ts
// packages/core/src/types/widget.ts —— WIDGET_REGISTRY
SYMBOL: {
  family: 'widget',
  schema: SymbolSchema,
  capabilities: {
    rotatable: false,
    groupable: true,
    resizable: true,
    movable: true,
    selectable: true,
    keepRatio: false,
    editable: true,      // 标签走统一编辑会话
    referenceable: true, // 参考线参照物
    erasable: false,
  },
},
```

`editable: true` 会让 `TYPES_WHERE('editable')` 自动把 SYMBOL 纳入编辑会话与 ENTER 派生集；
相应单测期望（`widgetRegistry.test` 的 editable / referenceable 列表）需要同步。

### 2.5 持久化 / 撤销 / 剪贴板 / 项目文件

- 持久化：SYMBOL 进 `WIDGET_RUNTIME` 即被 IndexedDB 恢复链路覆盖，无额外代码。
- 撤销：创建 / 改标签 / 改种类 / 改颜色 / 移动 / 缩放全部走 Model 写，走既有事务与 500ms 捕获窗。
- 剪贴板：`clipboardService` 按快照复制、`id` 重排、`groupId` 重映射，SYMBOL 无需分支；
  与锚定线同批复制的端点重映射同样生效（`idMap` 覆盖全部类型）。
- 项目文件：schema 校验来自注册表；符号不产生资产条目（与 IMAGE 的关键差别）。

### 2.6 旧文档零迁移

新类型是增量：老文档没有 SYMBOL，渲染与校验都不受影响。反之，旧客户端打开含 SYMBOL 的
新项目文件会因未知类型被跳过并给 warning（docs/20 既有行为），不会崩。

## 3. 几何契约

### 3.1 常量（单源 `symbolGeometry.ts`）

| 常量                       | 值  | 含义                                 |
| -------------------------- | --- | ------------------------------------ |
| `SYMBOL_LABEL_FONT_SIZE`   | 16  | 与 SHAPE 正文默认字号一致            |
| `SYMBOL_LABEL_LINE_HEIGHT` | 24  | 1.5 倍行高                           |
| `SYMBOL_LABEL_BAND`        | 24  | 标签带高度（**恒定**，空标签也保留） |
| `SYMBOL_LABEL_GAP`         | 8   | 图形区与标签带间距                   |
| `SYMBOL_DEFAULT_WIDTH`     | 96  | 单击创建默认宽                       |
| `SYMBOL_DEFAULT_HEIGHT`    | 128 | 96 图形 + 8 间距 + 24 标签带         |
| `SYMBOL_MIN_WIDTH`         | 48  | 软下限（拖拽创建草稿钳制）           |
| `SYMBOL_MIN_HEIGHT`        | 56  | 24 图形 + 32；再低只退化不禁止       |
| `SYMBOL_LABEL_MAX_CHARS`   | 64  | 落库截断                             |
| `SYMBOL_LABEL_PADDING_X`   | 4   | 标签左右内边距（渲染与编辑同源）     |

标签带恒定的理由：文本从无到有、字号不变、编辑中途不跳几何；同排符号的基线天然一致，
对齐工具与参考线不会因为「有没有名字」而错位。

### 3.2 派生矩形（局部系，左上原点）

```ts
glyphRect = { x: 0, y: 0, width: w, height: Math.max(h - SYMBOL_LABEL_BAND - SYMBOL_LABEL_GAP, 0) };
labelRect = {
  x: 0,
  y: Math.max(h - SYMBOL_LABEL_BAND, 0),
  width: w,
  height: Math.min(SYMBOL_LABEL_BAND, h),
};
```

图标按 `contain` 适配图形区（不改宽高比）：`s = min(glyphRect.width / VB, glyphRect.height / VB)`，
其中 `VB = 48`（资产 viewBox），`x = (glyphRect.width - VB·s)/2`、`y` 同式；图形区宽高不等时
左右或上下留白。**不拉伸**——设备图标被拉扁会立刻露馅。

### 3.3 缩放与退化

- 缩放只改 bbox：标签带高度不变，图形区吃剩余高度；宽度只影响留白与标签可写宽度。
- 高度 < 32 时图形区高度 ≤ 0：**不画图标**，仅标签（标签带贴底）；高度 < 24 时标签带被压扁，
  **不画标签**（只剩空白框，仍可选中与缩放）。
  不额外加硬下限（缩放基座是通用 RectEditor，不为单一类型开特例）；编辑框仍可用。
- 默认尺寸 96×128；拖拽创建沿用 `DRAG_TRACTION_SCREEN = 10` 屏幕 px 的单击 / 拖拽分界，
  草稿钳制到 `SYMBOL_MIN_*`（与形状 / 便签同一基类语义）。

### 3.4 锚点

`getAnchorPoint(join, t, geom?)` 覆写为**图形区矩形**的边点：

```ts
const g = geom ?? this.getHostGeom();
const r = g.rect;
const bottom = r.height - SYMBOL_LABEL_BAND - SYMBOL_LABEL_GAP; // 图形区底边
top:    { x: r.x + r.width * t, y: r.y }
bottom: { x: r.x + r.width * t, y: r.y + Math.max(bottom, 0) }
left:   { x: r.x, y: r.y + Math.max(bottom, 0) * t }
right:  { x: r.x + r.width, y: r.y + Math.max(bottom, 0) * t }
```

- `t = 0.5` = 图形区边中点；显式 `startPort/endPort` 照常沿图形区边滑动（4.1 契约）。
- 悬停连接点 / quick-add ghost 走 `outlineAnchorsOf` → `getAnchorPoint`，无需另接。
- 旋转恒 0（`rotatable: false`），不做旋转后的锚点回投。

**已知取舍**：从下方进入的连线落在图形区底边，会横穿标签带。缓解：标签单行、线多从侧上方
进入；后续可做标签避让或标签底片（挂账，不在本期）。

### 3.5 命中与选择

- `hitTestPoint` / `hitTestRect` 用**整个 bbox**（图形 + 间距 + 标签）：点名字也算选中，
  否则用户点标签会「点空」。
- 双击标签 / 单击已选中 → 进入编辑（§5.5）。
- 选择框、缩放柄、对齐、分布、参考线、编组、层级全部按 bbox（含标签）走通用实现。

### 3.6 能力位汇总

见 §2.4。拖动 / 缩放走基类矩形实现，无 points 型覆写；`getLocalRect` / `getBounds` /
`getHostGeom` 用基类。

## 4. 资产管线

### 4.1 源文件与清单

设计源：`packages/core/src/widgets/symbol/assets/<id>.svg`，每型一个文件。

| id                  | 名称     | 分组     | 形态（设计稿口径）    |
| ------------------- | -------- | -------- | --------------------- |
| `net-server`        | 服务器   | 网络设备 | 塔式机箱 + 三条槽位线 |
| `net-router`        | 路由器   | 网络设备 | 圆形 + 四向箭头       |
| `net-switch`        | 交换机   | 网络设备 | 扁矩形 + 左右端口箭头 |
| `net-firewall`      | 防火墙   | 网络设备 | 砖墙（交错砖缝）      |
| `net-cloud`         | 云       | 网络设备 | 云朵轮廓              |
| `net-load-balancer` | 负载均衡 | 网络设备 | 矩形 + 一进多出箭头   |
| `net-internet`      | 互联网   | 网络设备 | 地球经纬线            |
| `net-user`          | 用户     | 网络设备 | 人形（头 + 肩）       |
| `net-database`      | 数据库   | 数据存储 | 竖圆柱 + 顶盖弧线     |
| `net-storage`       | 存储     | 数据存储 | 三层叠盘              |
| `data-queue`        | 队列     | 数据存储 | 横置滚筒              |
| `doc-file`          | 文件     | 文档     | 折角页                |
| `doc-folder`        | 文件夹   | 文档     | 标签页文件夹          |

`SYMBOL_KINDS` 由生成文件导出（`keyof typeof SYMBOL_GLYPHS`），ActionBar / 工具坞 / 测试
共用同一份清单；新增符号 = 加一个 SVG + 重跑生成脚本。

### 4.2 生成脚本

`scripts/build-symbol-glyphs.mjs`：

- 输入 `packages/core/src/widgets/symbol/assets/*.svg`，按 id 字典序输出
  `packages/core/src/widgets/symbol/symbolGlyphs.generated.ts`；
- 产物形如 `export const SYMBOL_GLYPHS = { 'net-router': '<svg viewBox="0 0 48 48" ...>...</svg>', ... } as const;`
- `--check` = 重算并与磁盘比对，不一致退出码 1（提示「跑 pnpm symbols:build」）；
- `pnpm symbols:build` / `pnpm symbols:check` 两个脚本，`check` 接入 `pnpm verify`
  （与 `gen-third-party-notices --check` 同一位置习惯）；
- 输出确定性：按 id 排序、去除空白差异、不含时间戳 / 路径。

### 4.3 资产约束（生成期硬校验）

- 根元素只有 `viewBox="0 0 48 48"`（不写 `width/height`，不写其他布局属性）；
- 允许元素：`g / path / circle / rect / line`（**不含 polyline/polygon**——PIXI
  `GraphicsContext.svg` 对 points 属性「逗号+空格混合」解析有缺陷，实测渲染成
  乱线出界；多段折线一律 path 表达，表达力等价。实施勘误 2026-11-20）；
- 允许属性白名单：`d / cx / cy / r / x / y / width / height / x1 / y1 / x2 / y2 / points /
fill / fill-rule / clip-rule / stroke / stroke-width / stroke-linecap / stroke-linejoin`；
- **禁止**：`style / class / id / href / xlink / use / image / text / defs / filter /
gradient / mask / transform / polyline / polygon`（一期不做变换与渐变；需要旋转
  就在设计稿里画正）；
- 颜色：`fill` / `stroke` 只允许 `none` 或 `currentColor`（生成时归一为纯白
  `#ffffff` 作为 tint 的乘法基色——实施勘误 2026-11-20：PIXI tint 是逐通道乘法
  （`multiplyHexColors: c = a·b/255`，8.22 实测），黑基色 × 任何 tint = 黑，
  本节原文的 `#000000` 与「黑×色=色」不成立，白（255×tint=tint）是唯一能让
  tint 呈现目标色的基色）；出现任何硬编码颜色即报错；
- 单文件 ≤ 6 KB；路径点数不做硬限制，但设计上保持「48 视方格内 1.5~2px 描边」的线稿密度。

### 4.4 运行时渲染与缓存

- 着色单源 `resolveSymbolColor(data)`：`data.color ?? defaultTextColor()`（light `#333333` /
  dark `#ededf2`）；图标与标签同色，显式 `color` 不随主题反转（与 `textColor` 同语义：
  实例数据）。
- **用 tint 渲染，不替换 SVG 字符串**：资产生成时把 `currentColor` 归一为纯白
  `#ffffff`（tint 的乘法基色，见 §4.3 勘误），运行时 `glyph.tint = hexToNum(color)`；
  主题切换只改 tint，不重建 context（PIXI 8 的 `Container.tint` 对 Graphics 生效，
  浅 / 深双主题实机验证通过）。
- 上下文缓存：**按 kind** 一个共享 `GraphicsContext`（`new GraphicsContext().svg(svg)`），
  VM 用 `new Graphics({ context })` 复用；传入的 context 不随 Graphics 销毁（PIXI 8 契约）。
  颜色不进缓存键，任意色值不会撑大缓存。
- 标签颜色单独走 `DocDisplay` 的 style（不继承父容器 tint），与图标用同一个解析色。
- 每帧重绘只做 `scale.set(s)` 与 `position.set(x, y)`；描边随缩放变粗是矢量语义，
  资产按 48 视方 / 2px 描边设计，默认 96 显示时约 4px 视觉线宽。
- 主题切换：`vmEngine.refreshAll` 触发重算 tint 与标签色（无显式 color 时两者都变）。

### 4.5 离线 / PWA / 导出

- 资产内联在 JS chunk 里：无新增网络请求、无 SW 预缓存条目变化（预缓存清单仍覆盖全部
  chunk）；构建后的 `check-pages-build` 断言不受影响。
- PNG 导出走 `renderer.extract`，符号是矢量绘制，任意缩放下边缘清晰。
- 项目文件无资产条目，体积只随标签文本增长。

### 4.6 许可与仓库卫生

资产全部自绘，不复制第三方图标库；不写来源项目名。若未来引入外部图标集，必须单独过
许可与 `pnpm hygiene`（来源与署名要求），本期不引入。

### 4.7 失败兜底

- 生成文件缺失 / 某 kind 无资产：单测直接红（`SYMBOL_KINDS` 与 `SYMBOL_GLYPHS` 必须一一对应）。
- 运行时未知 id（旧版本打开新文件）：画占位图（虚线方框 + 中心问号），标签照常显示；
  **不抛错、不阻断导入**。
- `Graphics.svg` 解析异常：捕获后落占位图，不让单个符号拖垮整帧渲染。

## 5. 文本与编辑

### 5.1 内核

复用统一编辑会话（docs/17）与 HTML 编辑器，但**落库是纯文本**：

- `TextService.EDITABLE_TYPES` 由 `TYPES_WHERE('editable')` 派生，SYMBOL 自动进入；
- `getContent` 把 `label` 转成单段 HTML（`<p>转义文本</p>`）；
- 提交时 `htmlToPlainText` → 去换行（连续空白折成一个空格）→ `trim` → 截 64 字符。

### 5.2 编辑框几何

`getRect` 返回标签带中心，`anchor: 'center'`（与 SHAPE 同款，打字时上下对称生长）：

```ts
{
  x: b.x + b.width / 2,
  y: b.y + b.height - SYMBOL_LABEL_BAND / 2,
  width: Math.max(b.width - SYMBOL_LABEL_PADDING_X * 2, st.minWidth),
  height: 0,
  rotation: undefined,
}
```

编辑器字色 = `resolveSymbolColor(data)`（与画布标签同源，进入 / 退出编辑不跳色）。

### 5.3 落库规则

- 事务：`model.update({ label })`；不改几何（无 autoHeight）。
- 空标签合法：清空后标签带保留、不塌陷。
- 截断只发生在渲染：落库保留完整文本（≤ 64 字符），编辑框里可看全文。
- 编辑中主题切换 / 改种类：会话保持（样式随 `editStyleOf` 重放）。

### 5.4 渲染

- **单行**：textEngine 的 `overflow: 'hidden'` 未实现（measure.ts 标注 Pending，docs/07 §5），
  所以标签不走自动换行——按可用宽度 `w - 2 × SYMBOL_LABEL_PADDING_X` 用 `IMeasurer`（
  `createCanvasMeasurer`）做逐字截断，超宽时末尾补 `…`；数据里保留完整 64 字符，
  加宽控件后完整名字回来。
- `DocDisplay` 放在 `labelRect` 内，段落 `align: 'center'`，只消费截断后的单行文本。
- 垂直在标签带内居中；颜色 = `resolveSymbolColor(data)`；字号 16 / 行高 24 与编辑框同源常量。
- 无标签时只画图标；编辑态隐藏画布标签（编辑器接管），与 SHAPE 同一套 `_textEditing` 守卫。

### 5.5 进入编辑

与 SHAPE 完全一致：双击、或单击已选中项；创建后**不自动进编辑**（拖拽画图后直接弹键盘
会打断连击摆放）。创建后单击是选中，再单击进编辑。

### 5.6 只读

`enterEdit` / 提交 / 创建 / 种类切换全部有既有的只读闸门（service 早退 + UI 禁用），
符号不新增旁路。

## 6. 工具与交互

### 6.1 工具与创建

- `CursorMode` 增 `'symbol'`（公开联合类型增量；`setCursorMode` 的只读钳制自动覆盖）。
- `SymbolService extends DragCreateServiceBase`：`scope = 'symbol'`，
  `defaultSize = { width: 96, height: 128 }`，`minDraftSize = { width: 48, height: 56 }`。
- 单击：默认尺寸、以按下点为中心、工具保持可连击（与形状一致）；拖拽：跟手草稿、
  松手选中并回选择工具；网格吸附经 `bindGridSnap` 接线（起止角量化）。
- 创建写 `{ type: 'SYMBOL', symbol: 当前种类, label: '', zOrder, ...rect }`，一次事务。

### 6.2 种类记忆

会话级（不落库、不持久化）：`defaultSymbol` + `defaultSymbol$: BehaviorSubject<SymbolKind>`，
经 `syncToolOption('symbol', 'kind', v)` 进工具参数聚合表；`setDefaultToolOption` 增
`tool === 'symbol' && key === 'kind'` 分支。默认 `net-server`。

### 6.3 快捷键

`tool.symbol = 'n'`（`n` 当前无绑定；docs/09 清单同步）。`KeyboardService` 的 switch 增
`tool.symbol → setCursorMode('symbol')`。只读态由工具键统一闸门拦截。

### 6.4 工具坞

- 一个「符号」入口（`IconName 'symbol'`），标题 `符号 (N)`，主题色**沿用 shape 槽位**
  （不新增 `tool-symbol-*`，避免多一套 Tailwind 安全类与对比度护栏）。
- 二级菜单：`SYMBOL_OPTIONS` 13 项平铺（>8 自动两行 grid，与 20 型形状同款），选中项点亮。

### 6.5 ToolGhost

符号按钮拖动预览用**静态**「符号」图标（不渲染具体 SVG；DOM 侧不引 SVG 字符串）。
当前种类的名字可在 tooltip 体现，实现从简。

### 6.6 ActionBar

`case 'SYMBOL'`：两个 popover——

- 「符号类型」→ `SYMBOL_OPTIONS`，写 `{ symbol: id }`；多选按首个选中项取值（与 SHAPE 同款）；
- 「颜色」→ `TEXT_COLOR_PALETTE`（与 TEXT 同源），写 `{ color }`；触发钮缺省显示主题墨色点。
  **无「跟随主题」还原项**——与 `textColor` / `borderColor` 一致（写入即固定；避免
  「删除字段」写路径未定义，docs/04 §8.3 先例）。

两者都走 `updateSelectedStyle` 既有通道，无需新命令；不提供填充 / 边框（符号没有这些语义）。

### 6.7 其他交互

右键菜单、层级命令、复制粘贴、删除、编组、对齐分布、参考线、框选、边缘滚屏、多标签只读
全部通用；符号不新增手势。

## 7. 渲染与性能

### 7.1 Vm 结构

`SymbolVm extends BaseWidgetVm`（参考 `ShapeVm` 的 root / pivot 结构）：

```
root (pivot = 中心，applyRootTransform(x, y, w, h, 0))
├── glyphLayer: Graphics（共享 context，scale/position 适配图形区）
└── labelDisplay: DocDisplay（标签带内，居中；编辑态移除）
```

- 重绘守卫键：`symbol / label / width / height / themeVersion / _textEditing`；
  纯平移走快速路径（只改 root.position）。
- 编辑态：隐藏 `labelDisplay`，其余不变。

### 7.2 性能

- 单个符号每帧只做 scale/position；SVG 解析只在首次（按 kind@color 缓存）。
- 规模预期：一张拓扑图 10–30 个符号，远低于渲染压力阈值；不需要纹理化 / 合批。
- `getBounds` 含标签带（空间索引与 culling 用）；符号不参与编组时也不特殊。

## 8. 集成清单

| 位置                                                    | 改动                                                                                       | 备注                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| `types/widget.ts`                                       | `SymbolSchema` + `WIDGET_REGISTRY.SYMBOL`                                                  | 能力位见 §2.4             |
| `widgetRuntime.ts`                                      | `SYMBOL: { modelToken, vmToken, createModel, createVm }`                                   | 引擎与装配循环零改动      |
| `types/services.ts`                                     | `CursorMode` 增 `'symbol'`                                                                 | 公开联合类型增量          |
| `types/index.ts` / `index.ts`                           | 导出 `SymbolData` / `SymbolKind` / `SYMBOL_OPTIONS`                                        | 包入口                    |
| `widgets/symbol/*`                                      | Model / Vm / Service / geometry / glyphs / assets                                          | 三件套 + 注册             |
| `boardAssemblyInteraction.ts`                           | 构造 `SymbolService`、`initialize()`、`bindGridSnap`、同步工具参数；`onActivate` 增 SYMBOL | 顺序在 selector 之后      |
| `app.ts` / `boardPublicApi.ts`                          | BoardSDK 增 `symbolService` 字段；`BoardInternalMember` 同步归类                           | 编译期分类锁会逼出遗漏    |
| `boardTeardown.ts`                                      | 销毁序列加 `host.symbolService?.dispose()`                                                 | 与 shapeService 同段      |
| `boardCommands.ts`                                      | `setDefaultToolOption` 增 `symbol/kind` 分支                                               | 无新公开命令              |
| `boardActionBar.ts`                                     | `case 'SYMBOL'` popover                                                                    | 选项单源 `SYMBOL_OPTIONS` |
| `textService.ts`                                        | `getRect` / `getContent` 的 SYMBOL 分支                                                    | 编辑会话                  |
| `textEditStyle.ts`                                      | `editStyleOf('SYMBOL')`：16 / 24 / `resolveSymbolColor`                                    | 渲染与编辑同源            |
| `textCommit.ts`                                         | SYMBOL 分支：HTML → 纯文本 → 截断，只写 label                                              | 不改几何                  |
| `platform/keyboard/shortcuts.ts` + `keyboardService.ts` | `tool.symbol = 'n'`                                                                        | 只读闸门自动覆盖          |
| `spinth/react` Toolbar / Icon / announcement            | 工具入口、图标、播报「符号」                                                               | 对比度与 390px 布局       |
| `scripts/build-symbol-glyphs.mjs` + `package.json`      | 生成与 `--check`，接 verify                                                                | 确定性产物                |

**不变量**：不改 `dataEngine` / `vmEngine`；不新增 `BoardSDK` 公开成员；`WIDGET_REGISTRY`
仍是 schema + 能力位单源。

## 9. 测试计划

### 9.1 单测

- `symbolGeometry.test.ts`：默认 96×128 的图形区 / 标签带；h 缩小时图形区归零；
  contain 适配的留白；四边锚点在 `t = 0 / 0.5 / 1` 的坐标；标签带不参与锚点。
- `symbolLabel.test.ts`：超宽标签截断到单行 + 省略号；加宽后恢复；空标签不渲染。
- `symbolGlyphs.test.ts`：`SYMBOL_KINDS` 与 `SYMBOL_GLYPHS` 一一对应；
  每个字符串含 `<svg` 且不含禁用 token（`style=` / `<defs` / `href` / 硬编码色）；
  `--check` 的负向夹具（改动生成文件 → 校验红）。
- `symbolSchema.test.ts`：缺省值（含 `color` 缺省 = 无字段）；未知 symbol id 保留原值；
  label 截断在提交路径。
- `symbolColor.test.ts`：`resolveSymbolColor` 缺省随主题、显式 color 优先且不随主题变；
  `TEXT_COLOR_PALETTE` 每个色在浅 / 深两种画布底至少一底 ≥ 4.5:1（文本口径），
  主题墨色在两种底上都 ≥ 4.5:1。
- `widgetRegistry.test.ts`：editable / referenceable 期望列表更新；能力位断言。
- `textService` 扩展：SYMBOL 进入 / 退出编辑、空标签、清空后几何不变。
- `projectRoundTrip.test.ts`：含 SYMBOL 的项目文件往返，label 与 symbol 保真。
- 剪贴板扩展：符号 + 锚定线同批复制，端点重映射到新符号。
- 只读：service 早退（不创建、不改标签）。

### 9.2 E2E（`symbol.spec.ts`）

- S-1 工具坞选符号 → 单击创建 → 模型计数 +1、类型 SYMBOL、默认 net-server。
- S-2 拖拽创建：尺寸跟手、松手选中并回选择工具；<10px 滑移仍是单击。
- S-3 双击进编辑、输入名字、Esc 取消不落库；回车落库后画布出现标签。
- S-4 标签渲染在图形下方（探针读 bbox 与标签位置），缩放窗口后仍一致。
- S-5 连线吸附到图形区底边（端点 y = 图形区底，而不是 bbox 底）；移动符号线跟随。
- S-6 ActionBar 切种类：几何与标签不变、图形更换。
- S-7 撤销 / 重做：创建 + 命名各为独立撤销步；刷新恢复。
- S-8 只读：工具禁用、双击不进编辑。
- S-9 着色：ActionBar 选色 → 图标与标签同步变色；撤销一步回到主题色；刷新后保真。

### 9.3 视觉

4.3 的 `network-sample` 覆盖符号的最终观感（含标签对齐与深色主题）。

## 10. 验收清单

- [ ] `SYMBOL` 注册进入 `WIDGET_REGISTRY` / `WIDGET_RUNTIME`，旧文档零迁移。
- [ ] 标签外置且计入 bbox；选择 / 框选 / 对齐 / 导出与图形区一致。
- [ ] 锚点贴图形区四边，标签区不参与。
- [ ] 13 个符号资产齐全，生成脚本 `--check` 绿，verify 接入。
- [ ] 工具坞可创建、可连击、可切种类；快捷键 N。
- [ ] 逐实例着色：缺省随主题、显式色图标与标签同色、撤销 / 刷新保真、色板对比度护栏绿。
- [ ] 编辑会话完整：进入 / 提交 / 取消 / 只读 / 主题。
- [ ] 撤销、持久化、项目文件、剪贴板、导出全部通过。
- [ ] 单测 / E2E / 视觉基线全绿，`pnpm verify` 通过。

## 11. 手工验收

1. 工具坞点「符号」，在画布连点 10 次：10 个默认服务器图标，工具保持激活。
2. 双击第 1 个，输入「核心交换机」，回车：名字在图标下方居中，不挤压图标。
3. 拖动右下角缩放到很窄（宽 60）与很矮（高 40）：图标等比缩小 / 消失只剩名字，不拉伸。
4. 从图标底边拉一条 ELBOWED 线到另一个符号：线贴图形区底边，不贴标签带底。
5. 切换深色主题：未着色的图标与名字同步变色；显式着色的保持原色（实例数据语义）。
6. ActionBar 给一个符号选红色：图标与标签同时变红；撤销一步回到主题色。
7. 复制粘贴两个符号并改名：互不影响；撤销一次回到粘贴前。
8. 刷新页面、导出 PNG、导出项目文件再导入：图标、名字、颜色全部保真。
9. 只读标签页打开：工具按钮禁用、双击无反应，但图仍可平移缩放。

## 12. 风险与挂账

| 项                   | 现状 / 决策                                              | 后续                                      |
| -------------------- | -------------------------------------------------------- | ----------------------------------------- |
| 从下方连线穿过标签   | 接受；标签单行、线多从侧上进入                           | 标签避让 / 底片（二期）                   |
| 多行标签             | 单行 + 末尾省略号（渲染期截断）                          | 两行上限（按真实反馈）                    |
| 显式颜色不随主题反转 | 实例数据语义（同 textColor），写入即固定                 | 若需要「随主题切换的语义色」另做色角色    |
| 旋转                 | 不支持                                                   | 与 SHAPE 旋转入口一起评估                 |
| 自定义符号 / 符号包  | 内置 13 个                                               | 用户图标上传（吸收 IMAGE 图标场景，二期） |
| 未知 kind            | 占位图，导图不崩                                         | 版本化符号包与迁移                        |
| CursorMode 增量      | 公开类型加一个成员                                       | 发布说明标注（非破坏性）                  |
| tint 着色            | 已实机验证生效（白基色乘法，浅 / 深主题 + 25% 缩放实测） | 无需回退；基色勘误记录见 §4.3             |

## 13. 实施顺序（可回退小步）

1. **骨架 + 1 个图标**：`SymbolSchema` / `WIDGET_REGISTRY` / `WIDGET_RUNTIME` / 几何纯函数 /
   Vm（tint + 标签）/ Service / 工具入口；先用 `net-router` 一个 SVG 跑通生成脚本与渲染，
   浅色与深色主题各看一眼。
2. **第二个图标 + 观感确认**：加 `net-database`（圆柱，与形状 `eng-database` 对照），
   确认线宽 / 圆角 / 100% 与 25% 缩放的观感后再批量。**此步停下等用户确认，不要直接画完
   13 个**（图标质量是唯一需要人眼拍板的产物）。
3. **交互接入**：工具坞二级菜单 / ToolGhost / ActionBar（种类 + 颜色）/ 编辑会话 /
   快捷键 N / 只读闸门；单测覆盖几何、锚点、截断、着色、落库。
4. **资产批量 + 护栏**：其余 11 个 SVG + `--check` 接 verify + 资产约束负向夹具 +
   `symbol.spec.ts` S-1…S-9。
5. **docs 同步**：见 §14。

## 14. docs 同步（实施末）

| 文档    | 改什么                                                                 |
| ------- | ---------------------------------------------------------------------- |
| docs/04 | 控件表加 `SYMBOL`；补符号控件小节（schema / 能力位 / 标签几何 / 着色） |
| docs/07 | 文本层：符号标签的单行截断、编辑 profile                               |
| docs/09 | 快捷键 N（符号工具）                                                   |
| docs/12 | 工具坞单入口 + 二级菜单；ActionBar 颜色 popover                        |
| docs/15 | 单测 / E2E 计数与 spec 名                                              |
| docs/17 | 编辑 profile：SYMBOL 的编辑框几何与纯文本落库                          |
| docs/20 | 项目文件：符号零资产条目（与 IMAGE 的差别）                            |
| docs/13 | 4.3 状态随实施推进（完成后再改「已实施」）                             |
