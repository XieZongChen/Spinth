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

- 目标 VM 实现 `getAnchorsData()`：四边中点坐标；连线按 `startJoin/endJoin` 取锚点。
- 悬停 widget：小节点取最近边，大节点按象限精确方向。
- widget 移动/缩放 → 订阅其 `onStateChanged$` → 重算关联线 points（微任务合并）。
- 解绑：拖离锚点后 `nodeId/join` 置 null，端点自由。
- 删除锚定节点：`onModelRemoved$` 将该端 `nodeId/join` 置 null，points 不动；
  与删除同处 500ms 捕获窗 = 一个撤销单元。
- **整体拖动/缩放为空操作**：`LineVm` 的四个交互几何覆写保留空操作语义，
  拖线身不会平移线，缩放也不生效。自由线只在对齐/分布命令中经 points 平移参与。
- 键盘微移对线无效；线的移动只能拖端点重锚定或随锚定节点移动。

## 4. 正交路由

```
routeElbow(start, startJoin, end, endJoin, startNode?, endNode?):
  1. 两端沿 join 方向外扩 margin（30/60/90 三级）生成走廊点
  2. 候选中转 = 两轴交点（2 种）+ 同侧对开时的中线走廊
  3. 过滤：任一段不穿过两端节点（矩形内缩 0.5 判交，锚点边界接触放行）
  4. 择优：不穿节点 > 拐点最少 > 总长最短；全挡死退回首候选
```

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

- 四种：开放箭头（45°）、内实心三角（30°）、外实心三角、菱形。
- 首尾段方向确定后且线段长度超过阈值才绘制；被线上文字遮挡时不绘制。
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
  → 起终点重合 || 起终点同一 widget → 删除；否则落盘
  → 工具保持激活（Esc/V 切回）
```

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

## 8. 验收

- [x] 两矩形间拖出 ELBOWED 连线，移动任一端矩形自动重路由且不穿节点。
- [x] 箭头样式、虚线、线宽正确渲染；菱形箭头已落地。
- [x] 双击已选中连线添加文字，文字处线身镂空；文字沿路径滑移。
- [x] 删除锚定节点后连线端点保持原位（解绑），undo 恢复形状与锚定。
- [x] 拖线身无整体平移；拖段/端点/文字各有明确手势。

## 9. 挂账

- 拐点显隐（points 第三元）未落地。
- 线身 waypoint 用户拐点编辑与「线不可整体拖动」的边界需再拍板。
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
