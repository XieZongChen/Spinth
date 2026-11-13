# 08 — 连线（Line）

## 1. 设计目标

- 连线可锚定到任意 widget 的边，跟随移动自动重算路由。
- 三种线型：STRAIGHT / ELBOWED / CURVE。
- 箭头、线宽、颜色、虚线、线上文字可配。
- 线不可整体拖动/缩放：交互 = 拖端点重锚定、拖段滑移、随锚定节点移动、ActionBar 改样式。

## 2. 数据结构

```ts
const LineSchema = z.object({
  id: z.string(),
  type: z.literal('LINE'),
  zOrder: z.string(),

  points: z.array(z.tuple([z.number(), z.number()])),

  startNodeId: z.string().nullable().default(null),
  endNodeId: z.string().nullable().default(null),
  startJoin: z.enum(['top', 'right', 'bottom', 'left']).nullable().default(null),
  endJoin: z.enum(['top', 'right', 'bottom', 'left']).nullable().default(null),
  // 沿边锚点参数（0~1，optional 零迁移）：显式 port 优先，缺省走同边错开分配
  startPort: z.number().min(0).max(1).optional(),
  endPort: z.number().min(0).max(1).optional(),
  color: z.string().default('#4b5563'),
  strokeWidth: z.number().default(2),
  lineType: z.enum(['STRAIGHT', 'ELBOWED', 'CURVE']).default('STRAIGHT'),
  pinned: z.boolean().default(false),
  startArrow: z.enum(['none', 'arrow', 'solid', 'diamond']).default('none'),
  endArrow: z.enum(['none', 'arrow', 'solid', 'diamond']).default('arrow'),
  dashed: z.boolean().default(false),

  text: z.string().default(''),
  textRatio: z.number().min(0).max(1).default(0.5),
  fontSize: z.number().optional(),
  textColor: z.string().optional(),
});
```

## 3. 锚定与跟随

- 锚点单源 `IBaseWidgetVm.getAnchorPoint(join, t?, geom?)`：基类按 bbox 边插值
  （`anchorOf`，t 缺省 0.5 = 边中点，θ 感知）；`ShapeVm` 覆写为**轮廓交点**
  （`shapeOutline.outlineAnchor`——diamond/triangle 等非矩形锚点贴轮廓，不悬空
  于 bbox 边上）。`geom` 可显式传入权威几何：几何命令事务后急切 reattach 时
  vm root 尚未应用新帧，读 vm 会滞后一拍产生幻影撤销项。
- 沿边参数 t 的取值序：显式 `startPort/endPort`（端点拖拽落定投影落库）>
  同边多线错开分配 > 0.5。错开分配为纯派生不落库：同节点、同 join（同一
  锚边，含出发与进入两向）的 n 条线端按 id 字典序分 `0.2 + 0.6×(i+1)/(n+1)`
  （自环同边两端各占一槽）；拉线落定 / 删线 / 删节点余线均触发全量重排
  （加删线后仍均分），samePoints 守卫保证零位移线零写入。
- 悬停 widget：连接点判定取四向外移点最近侧（外移 24px 屏幕恒定）；锚点
  指示器圆点、外移点快照、抓取热区与 quick-add ghost 起点共用同一轮廓锚点
  集合（`lineGeometry.outlineAnchorsOf` → `getAnchorPoint`，与真实锚定同
  一单源——非矩形形状上可见圆点即落线起点）。
- widget 移动/缩放 → 订阅其 `onStateChanged$` → 重算关联线 points（微任务合并）。
- 解绑：拖离锚点后 `nodeId/join` 置 null，端点自由。
- 删除锚定节点：`onModelRemoved$` 将该端 `nodeId/join` 置 null，points 不动；
  与删除同处 500ms 捕获窗 = 一个撤销单元。
- **整体拖动/缩放为空操作**：`LineVm` 的四个交互几何覆写保留空操作语义，
  拖线身不会平移线，缩放也不生效。自由线只在对齐/分布命令中经 points 平移参与。
- 键盘微移对线无效；线的移动只能拖端点重锚定或随锚定节点移动。

## 4. 正交路由

```
routeElbow(start, startJoin, end, endJoin, startNode?, endNode?, obstacles?):
  1. 两端沿 join 方向外扩 margin（30/60/90 三级）生成走廊点
  2. 候选中转 = 两轴交点（2 种）+ 同侧对开时的中线走廊
  3. 过滤：任一段不穿过两端节点与第三方障碍（矩形内缩 0.5 判交，
     锚点边界接触放行）
  4. 择优：不穿障碍 > 拐点最少 > 总长最短；全挡死退回首候选（无解仍连通）
```

- **全局避障**：`collectRouteObstacles`（lineRoute.ts 单源）取两端点外扩
  `OBSTACLE_PAD=120` 包围盒内候选 → 排除 LINE/PEN 与两端节点 → 旋转件保守
  外接（rotatedRectBounds）→ 按中心距升序取前 `MAX_OBSTACLES=32`。五路共用：
  reattach / previewFollow / rerouteLine / 拉线预览 / 端点拖拽；pinned 分支
  不避障（用户手滑优先）。dev 探针 `lastRouteObstacles` 记录最近一次集合。
- 同向对开（top→top 等）中线必须钳制到两侧走廊点之外，避免重影路由。
- `mergeCollinear` 迭代至收敛，清理重复/共线邻接。
- 拐点吸附：内部「抖动拐」（jog < 2×R）对齐到较长段拉直（`absorbTinyJogs`）。
- ELBOWED 渲染：逐拐点 quadraticCurveTo R14 圆角（首尾端点精确，箭头贴齐）。
- 新线默认 ELBOWED；两端同轴对齐时路由自然退化为直线。

### 曲线（CURVE）

- `curveControlPoints`：三次贝塞尔 [p0, c1, c2, p3]，切向 = 相邻点方向；
  锚定线走廊点恰好是边法向，ELBOWED 切 CURVE 自然得 S 弯；两点线退化为直线。
- 控制臂长 = 两端距 × 0.4。
- `flattenCurve`：24 段采样折线（弦高误差 < 0.3%）；命中/文字 ratio/箭头切线/
  bbox/虚线切分复用折线管线。
- 曲线无段语义：无段条、段滑移禁用；锚定跟随只重贴两端点。

## 5. 箭头

- 首尾独立四态：`none` / `arrow`（开放）/ `solid`（实心三角）/ `diamond`（菱形）；
  默认 start=none、end=arrow。
- 箭长 `ARROW_LEN=10` 世界像素，开放箭头张开半角 `ARROW_ANGLE=π/7`（≈25.7°）。
- 首尾段方向确定后且线段长度超过阈值才绘制（首/末段须长于箭头，否则视觉挤压）；
  被线上文字遮挡时不绘制。
- 菱形箭头长轴 1.4×箭头长、短轴 0.7×，前顶点贴端点，实心填充与 solid 同色。

## 6. 线上文字

- `textRatio` 换算路径定位点（`pointAtRatio`）。
- **双击线身**在双击位置创建文字（双击点 → `ratioAtPoint`）；单击无编辑语义
  （单击是选中/段滑移/胶囊手势）。
- ratio 与首次内容写入合并落库（一个撤销单元）。
- 编辑经统一编辑会话接入（`lineTextEditor.ts` 为 descriptor 工厂）：
  ratio 锚定、镂空喂框、host 回调；空文本退出只清 text 不删线（`keep`）。
- 线上文字排版 override（fontSize/textColor）经 descriptor style 消费。
- 编辑态选框：透明底 + 功能蓝 1.5px 描边 + 圆角 6px + padding 6px 10px + 文字居中；
  宽度 max-content 自适应（min 60 / max 240）；编辑器中心对准锚点。
- 编辑期间 PIXI 文字隐藏（只留 DOM），镂空矩形按编辑器实测几何构造；
  空文字即断线，打字变宽即时跟随（`onFrameChange` 不等 34ms 节流）。
- 非编辑态镂空：文字 bbox + 4px padding。
- 编辑期手柄全收；退出后仍单选则恢复；二次进入光标落内容末尾。
- 线身镂空用分段 stroke（`slicePathExcludingRect`），不用 shader filter；
  虚线同理分段（`slicePathByDash`），相位跨拐点连续。
- 文字沿路径拖：按住文字沿路径拖动，ratioAtPoint 实时反算（钳制 0.05~0.95），
  preview 零模型写，松手单事务落库 textRatio；位移 < 4px 无操作。

## 7. 交互流程

```
pointerdown（line 模式）
  → 悬停 widget 则吸附边锚点为起点；否则自由起点
  → 创建两点重合的临时线
pointermove
  → 实时更新 endNodeId/endJoin + 重算路由
pointerup
  → 起终点重合（< 4px）且非自环 → 删除（未拖出）；从 A 拖回 A → 紧凑自环落盘
  → 工具保持激活（Esc/V 切回）
```

- **自环**（`startNodeId === endNodeId !== null`）：显式环路，`routeSelfLoop`
  生成——同 join 出 U 形（锚点重合时按跨度 `max(80, 边长×0.5)` 展开在边内）、
  异 join 出矩形环（对边绕近侧车道、邻边走外角点）；全部线段轴对齐不自交。
  路由优先级：`pinned`（用户手滑）> 自环 > 常规 `routeElbow`。端点可重锚定、
  可拖段、可加箭头与标签；一端解绑退化为断头线；删除宿主节点两侧锚定同置
  null。

- 命中检测：8px（除以 scale）容差的逐段线段-点距离。
- 悬停 widget 显示四边中点连接点（lineAnchorIndicator），选中形状时四向连接点常显。
- 从连接点按下 = 建线实时跟随；点击（位移 < 4px）= quick-add：连线 + 默认矩形。
- quick-add 方向被已有形状占据 → 只建连线并选中；方向已有带线元素 → 新形状交替错开成列。
- 决策统一收口 `quickAddPlan`（hover 预览与点击共用的单一事实源）。

### 7.5 lineService 拆分

| 协作者                | 职责                                                     |
| --------------------- | -------------------------------------------------------- |
| `lineTextEditor.ts`   | 线上文字编辑 descriptor 工厂                             |
| `lineHoverOverlay.ts` | 选中/hover 浮层四渲染件 + 探针快照                       |
| `lineQuickAdd.ts`     | 连接点手势 + quickAddPlan 单一决策                       |
| `lineAnchorFollow.ts` | 模型→路由域（reattach/rerouteLine/previewFollow/unbind） |
| `lineEndpointDrag.ts` | 端点重锚定/解绑手势                                      |
| `lineSegTextSlide.ts` | 文字滑移 + 段滑移 waypoint 两个手势会话                  |

## 9. 挂账

- ELBOWED 内部拐点手柄（拖拽正交保形 + pinned）与段滑移并存；「线不可整体
  拖动」边界维持——拐点编辑不改锚点，整体平移仍只能随锚定节点。
- 旋转件参考线/等间距排除、awareness 框恒 AABB。

## 10. 交互能力

### 10.1 样式

- ActionBar 线型/箭头/颜色切换（popover 多级控件，docs/12 §5）。
- 菱形箭头、虚线、线宽四档 1/2/4/8。
- 选中态：端点圆点（实心蓝 + 白描边）、段中点蓝条胶囊、hover 放大。

### 10.2 选中态

- 单选连线不画 bbox 选区框（points bbox 对 U 形线会框住空区）。
- 多选含线仍画 union 框；ActionBar 定位走独立 `getSelectionBounds`。
- hover cursor：端点 grab / 段条 move。

### 10.3 拖段体验

- 线身任意点按住即拖所在段；hover 与按下共用「距段线身最近段 ≤ 8 屏幕像素」口径。
- 方向光标：水平段上下拖（ns-resize）、垂直段左右拖（ew-resize），光标指拖动方向（法向）。
- 唯一段拆五点：两端锚点保持 + 拆 `[a, a+stub·dir, +off·n, +off·n, b−stub·dir, b]`，
  全程正交；offset=0 时 mergeCollinear 清回原形。
- 首末段两档：长段（≥ 30）拆几字形保正交；短段斜连退化（锚点保持 + 拐点平移求交）。
- 段滑移落库 `{points, pinned:true}`；端点重锚定/切 lineType 复位 pinned。
- 两端视觉留隙：`LINE_END_GAP = 5` 世界像素；stroke/箭头/镂空走收缩后视觉路径，
  points/命中/段滑移/hover/文字 ratio 语义不动。
