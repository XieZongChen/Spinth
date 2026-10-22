# 11 — 脑图（Mind Map）

## 0. 范围与状态

一张脑图 = 一个 `MIND_MAP` widget，内部是递归 `MIND_NODE` 树。节点不是独立
widget，不进 widgets 数组、不占 zOrder。当前已落地：

- 节点级选中：点根 = 整图选中；点子节点 = 节点选中；
- Tab/Enter 建子/同级，方向键导航，Delete 删节点；
- 拖拽重排 + 跨图拖拽 + 落点预览；
- 递归自排版、冒泡收敛、根锚定；
- 连线 drawer（普通节点折线 + 根二次贝塞尔）；
- 节点文字编辑走统一编辑会话的 plain 内核（textarea）。

非目标：独立节点 widget、节点级多选/框选、节点级 awareness 渲染、模板系统。
模板系统已移除；新脑图直接创建空根。

## 1. 设计目标

- 布局不用全局 tidy tree：每个节点 VM 在 render 时排自己的 children，尺寸变化
  自底向上冒泡触发整树收敛，天然支持并发子树编辑。
- 整体移动只在整图选中态有效；拖动子节点 = 重排，不是平移。
- 节点文本编辑、拖拽重排、快捷键体验完整。

## 2. 数据结构

```
MIND_MAP (widgets 数组内一个 Y.Map)
 ├── type: 'MIND_MAP', zOrder
 ├── rect: YKeyValue 四键齐全       // 只消费 x/y（锚定根节点左上角），
 │                                  // w/h = 树包围盒派生占位
 └── root: Y.Map (MindNode)
      ├── id, type: 'MIND_NODE'
      ├── text: string               // 纯字符串（plain 内核）
      ├── direction?: 'left' | 'right' // 仅根的直接子节点有
      ├── lineColor?, lineType?      // 缺省沿父链继承
      └── children: Y.Array<Y.Map>   // 递归
```

- 样式继承：`getLineColor()` 自身有值取自身，否则问 parent——分支主题设一次色，
  整棵子树继承。
- 节点能力：`movable/resizable false`；节点级选中由脑图服务层承载，不走
  widget capabilities 注册表。
- `MindMapVm` 承担整图 rect 语义，交互几何继承 docs/05 §4.4 的 rect 型默认实现
  （整体拖动/缩放零覆写）。

## 3. 增量树同步（Model 层）

```
MindNodeModel 初始化:
  递归为每个 child 建 Model（双向 map/parent 引用）
  yChildren.observe(delta):
    把 Yjs delta（retain/delete/insert）转译为内存 children 数组的 splice
    → childrenChange$.next(Delta<IMindNodeModel>[])
```

- VM 据 delta 增量 buildChild/destroyChild，不重建整棵树。
- 顺序：先应用更新，再销毁被删 VM（避免选区 bounds 抖动）。
- **硬规定**：`MindNodeModel.toJSON` 必须剥离 `children`（state 只含自身字段）；
  子树只经 `childrenChange$` 驱动。否则每个节点 state 装整棵子树，
  叶子一次编辑 = 全部祖先 O(子树) 序列化 + diff。

## 4. 递归自排版（VM 层）

### 布局常量

| 常量                     | 值                 | 含义                   |
| ------------------------ | ------------------ | ---------------------- |
| `HORIZONTAL_OFFSET_ROOT` | 100                | 根→次级节点水平间距    |
| `HORIZONTAL_OFFSET_NODE` | 48                 | 普通父子水平间距       |
| `VERTICAL_NODE_MARGIN`   | 4                  | 兄弟节点垂直间距       |
| `VERTICAL_MARGIN_SECOND` | 50                 | 次级层额外间距         |
| `VERTICAL_MARGIN_CROSS`  | 38                 | 根层兄弟间距下限       |
| 根节点字号 / padding     | 28px / 32×24       | 深色圆角底（radius 8） |
| 一级节点字号             | 18px               |                        |
| 其余节点字号             | 14px，maxWidth 360 | 超宽换行               |

### 算法

```
render(node):
  1. drawChildren(node.children, direction):
       根节点：takeWith(direction == left) 左右分侧
       childX = left ? parent.x - OFFSET - w : parent.right + OFFSET
       childY 累加：根层间距 = max(50 − lastBottom, 38)，深层固定 4
  2. 父子互居中:
       子树高 < 父节点高 → 子节点组整体垂直居中
       否则 → 父节点在子树中垂直居中
  3. 根节点垂直平衡（每侧独立）:
       首/末子节点本体中点围成区间的中点对齐根节点中点
```

### 冒泡重排

```
任何节点尺寸变化
  → onStateChanged$ 的尺寸 diff（docs/14 规则 2：渲染后广播）
  → 父节点订阅 → 逐级冒泡到根
  → MindMapVm 重定位整图
```

- 禁止自造 layout 事件；微任务合批，同帧多节点变化只收敛一次。
- **根锚定语义**：map 的 rect.x/y 锚定根节点左上角且不动；根平衡/父子互居中
  的平移只发生在树内局部坐标，禁止「layout 算出根位移 → 写回 rect → 再 layout」
  的循环。只有整图被拖拽时 rect 才变。

## 5. 连线绘制（drawer）

- 普通节点：折线 + 真 `arc()` R8（8 象限分情况，`nodeConnectorPath` 返回画笔指令）；
  聚合线长度 24（兄弟共享垂直段，鱼骨视觉）。
- 线宽 4（根/普通同宽）；兜底分支色 `#22ab68`。
- 根节点：二次贝塞尔；控制点 `cpX = startX + (endX-startX)×0.2, cpY = endY`。
- 起点参数 t（根连线数学）：
  - `f(x)` 三段函数（x = 子节点与根中心的垂直距离）：指数段、线性段、饱和段；
  - `t = isLeft ? 2w·f(x)-1 : 1-2w·f(x)`；
  - `w = 0.5`；起点 `startX = middleX + axisWidth·t`，
    `axisWidth = rootWidth/2 - ROOT_CURVE_START_PADDING(24)`；
  - 数值参数具名化，禁止魔法数字：阈值 h=1500、指数段 a=0.9/d=10/s1=0.9、
    线性段斜率 s2=0.08、饱和值 0.98、过点 [0.17,0.32]/[0.83,0.56]。
- 曲线参数写在 `mindDrawerMath.ts` 纯函数 + 单测（单调性/边界/对称性）。

## 6. 拖拽重排（MindDragController + DropArea）

### DropArea（三层矩形热区）

```
area:      节点本体 + 上下各扩 80px + 朝子节点侧扩 120px
current:   节点所在列 × 扩区全高 → 与非根节点做兄弟（before/after）
children:  每个子节点贴父侧的零宽竖条，按子节点中线分段 → 插入下标 i
根节点:    左右半区各建一区；current → 该侧首/末位
命中给 distance：跨候选取最小者；根命中直接返回
```

- 目标语义：`asChild{nodeId,index,direction?}` / `asSibling{parentId,index}`；
  index 换算走「侧向序号 → children 绝对下标」。
- DropArea 装配与树级命中在 `mindDropHit.ts` 纯函数模块；热区集按拖拽会话缓存，
  拖拽期间模型零写入。
- 拖拽判定：单轴位移 ≥ 10 屏幕像素。

### 流程

```
dragStart: 选中节点半透明 + 生成拖影快照（绝对定位跟手）
dragMove:  hitDropAnyMap：源脑图优先，其余 MIND_MAP 按序取首个命中
           合法性：拖起子树（自身 + 后代）不作为落点
           渲染 40×16 蓝色预置块 + 预连线
dragEnd:   命中 → move()（目标图内按 index 插入，序列化→删除→反序列化）
           未命中 → 拖出成一张新脑图
```

- `move()` 用序列化→删除→反序列化插入，不用 Yjs 引用搬移（协同安全）。
- 颜色规则：移入根且同图、自身带色 → 保留原色；跨图或无色 → 按落位分配未占用色；
  移入普通节点 → 清空继承新父。同父内前移做 index 补偿。
- 拖拽全程遵守 docs/14 六规则：拖影/落点预览绝对定位、松手用最后命中的 drop 目标。

## 7. 焦点导航（MindFocusController）

实现：`mindNav.ts` 纯函数 + `MindService`。

- 方向键智能判断：左树的 ← 是子节点、→ 是父节点（右树相反）；根节点 ←/→ 分别取
  左右子树中与根中点最近的子节点。
- ↑↓ 走同侧兄弟：先在同侧逐位扫描，到数据边界时上溯叔节点再下钻其首/末子。
- 视窗跟随：节点与安全区两轴相交长度不足节点尺寸时滚动；安全区左右上 10px、
  下方 96px（让开底部工具坞与右下缩放胶囊）。
- 坐标统一到屏幕空间，避免非 100% 缩放下世界坐标与 clientRect 口径不一致。
- 方向键在脑图焦点下一律被消费，不落回 1px 微移。

## 8. 快捷键与操作

| 键          | 动作                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Tab         | 选中态：建子节点并聚焦；根层未指定侧向时按三规则取侧；编辑态：先落库当前文本，再建子并继续编辑 |
| Enter       | 选中态：建同级节点（根节点上退化为建子）；编辑态：退出并移末尾                                 |
| Shift+Enter | 编辑态换行（textarea 默认行为，不拦截）                                                        |
| Cmd/Ctrl+±  | 编辑态转发缩放画布                                                                             |
| 任意单字符  | 选中态直接键入 = 进编辑并全量替换节点文案（空格与修饰键组合除外）                              |
| 方向键      | 节点间导航（§7）                                                                               |
| Delete      | 删除节点（删根 = 删除整张脑图）；焦点按同侧后兄弟 → 前兄弟 → 父规则转移                        |

- 连续 Tab 建节点每步 `stopCapturing()`（逐步撤销）。
- 节点编辑：再点一次已选中节点进编辑（与 TEXT/STICKY 同一激活通道，无时间窗）；
  输入即落库（34ms 节流），退出统一 flush。
- 工具模式 `mind`：按下空白落盘建图；跟随示意是 react 层 `ToolGhost`（DOM 幽灵），
  悬停已有图的隐藏由 core 经 `mindGhostSuppressed$` 发布。

## 9. 布局与交互规格

- Tab 连建多层时布局自动收敛；连续建节点逐步撤销。
- 长文本节点宽度到 360px 上限自动换行，父/子树联动重排。
- 拖节点到兄弟缝隙显示蓝色预置块与预连线，落下后顺序正确、连线圆滑。
- 拖节点到空白处生成新脑图，原树移除。
- 左树右树同时存在时，根连线起点分布符合 t 参数曲线。
- 节点级选中：点根整图、点子节点节点框；Delete/Tab/Enter 作用于焦点。
