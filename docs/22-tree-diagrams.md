# 22 — 树形图族（Tree Diagram Family）

> 范围：树形图族的架构（family/kind/策略）、`MIND_MAP` 与 `ORG_CHART` 两个
> widget type 的共有骨架与差异策略、扩展指南。脑图交互细节见 docs/11；
> 实施过程与审查记录在 specs/tree-diagrams。

## 0. 范围与状态

树形图族 = family `'tree'` 的控件集合（当前 `MIND_MAP`、`ORG_CHART`）：
节点不是 widget、几何由树布局派生、空间索引与 culling 豁免。公共骨架
（树数据/增量同步/编辑/撤销/持久化/焦点宿主）只实现一次；语义差异
（布局/连线/导航/落点/样式）按 kind 注入策略。

已完成：脑图横向（冻结）+ 竖向 + 折叠；组织架构 top-down + 折叠 + 跨种类
拖拽；工具坞单入口（类型二级菜单）。

## 1. 三张注册表

| 注册表            | 位置                       | 内容                                   |
| ----------------- | -------------------------- | -------------------------------------- |
| `WIDGET_REGISTRY` | `types/widget.ts`          | `family + schema + capabilities` 单源  |
| `WIDGET_RUNTIME`  | `widgetRuntime.ts`         | type → Model/Vm token + 工厂（组合根） |
| `TREE_KINDS`      | `widgets/tree/registry.ts` | type → `ITreeKind`（策略配置单源）     |

- `family: 'tree'` 是引擎唯一判据：vmEngine 查询豁免（`treeVmIds`）、
  culling 豁免、selector 节点拖拽分流都走 `isTreeWidgetType()`。
- `TreeWidgetType` 由注册表 family 派生（编译期）；`TREE_KINDS` 键集与
  family 类型集双向编译锁（注册表加树类型而种类表没加即编译红）。
- 新增树类型三处都要加（注册表 / 运行时 / 种类表），缺一处编译期即红。

## 2. kind 策略面（ITreeKind）

```
ITreeKind = {
  type, defaultOrientation, orientations,
  supportsSides, supportsLineColor, connectorLineWidth, connectorFallback,
  style: ITreeStyle,                // presentation(node, depth) 测量渲染单源
  defaultRootText, defaultChildText,
  layout(o): ITreeLayout,           // 布局策略（纯函数）
  connector(o): ITreeConnector,     // 连线策略（纯命令数组）
  nav(o): ITreeNav,                  // 方向键导航策略
  drop(o): ITreeDrop,                // 落点装配/命中策略
}
```

- 骨架（TreeMapModel/TreeMapVm/TreeService/TreeOps）**零种类分支**——差异
  只经 `kind.xxx(orientation)` 分派；`orientation` 是图字段（缺省回 kind
  默认）。
- 策略模块（layout/connector/nav/drop）禁 import PIXI/Yjs/服务。
- 连线策略输出纯命令数组（`IConnectorCmd`：moveTo/lineTo/arc/cubicTo），
  Vm 只负责 Graphics 执行——根贝塞尔也能单测、预览与实物同源。

## 3. 数据模型（两种树共享）

节点字段：`id / text / collapsed? / direction? / lineColor? / children`。

- `direction` 恒**逻辑侧** left/right（仅根的直接子节点落盘，深层继承）；
  物理方向由 `orientation` 映射：mind horizontal left=左、vertical left=上。
  切换 orientation 不重写任何节点；旧客户端按横向渲染降级不损坏。
- `collapsed`（折叠）入文档：缺省 = 展开（零迁移）；一次切换一步撤销；
  序列化（复制/搬移）透传。
- 跨种类写边界（`projectSpecFor`，specs §4.3）：mind→org 剥
  direction/lineColor；org→mind 落根层按落点侧写 direction、按插入位
  分配 lineColor。

图字段：`orientation?: 'horizontal'|'vertical'`（mind）/
`'top-down'`（org MVP）——optional 无 default，消费侧 `?? kind 默认`。

## 4. 布局

- **mind 横向**（`layout/mindHorizontal.ts`，行为冻结）：左右分侧、子树
  按高纵向堆叠、父垂直居中、根层垂直平衡；golden 冻结测试锁逐值。
- **mind 竖向**（`layout/mindVertical.ts`）：横向的**严格转置**（输入宽高
  互换 → 冻结横向实现 → 输出坐标互换）——常量同值、转置对称单测锁死。
- **org top-down**（`layout/org.ts`）：自底向上子树宽度 → 按层定 y（层顶 =
  上一层最大底边 + 56）→ 自顶向下 x 槽位（父在子跨度居中、GAP 24）。
  单子同 x 中线（竖直连线）；`levels` 输出层深。

## 5. 连线

- mind 横向：根→一级 t 参数二次贝塞尔（升阶 cubic 命令输出）；普通鱼骨
  （聚合线 24 + R8 圆弧）；线宽 4、分支色沿父链继承。
- mind 竖向：横向命令经 (x,y) 互换镜像（arc 角度 θ↦π/2−θ、ccw 翻转）。
- org：正交总线（父底中心 → midY → 子 x → 子顶中心），`orthogonalPath`
  圆角折线（R8、共线自动退化）；线宽 2、色 `#64748b`。

## 6. 折叠（两种树共享）

- 折叠节点的子树不进布局/渲染（Vm 保留 `visible=false`）/命中/导航/
  框选/落点/AddButtons；隐藏后代数一次后序统计（O(n)）。
- 徽标：直径 24 深底白字 `+N`；锚在朝子侧边中点（mind 横向左/右边、
  竖向上/下边；org 卡片底边中点）；根恒右下角。点击徽标 = 展开
  （selector 在节点拖拽判定前先查命中，不建拖拽会话）。
- 入口：ActionBar `treeCollapsed` toggle（有子才出现）、Cmd/Ctrl+.、
  徽标点击。折叠时焦点在隐藏后代 → 移到折叠节点；折叠节点上 Tab 建子 /
  拖入子同一事务自动展开（一步撤销）。

## 7. 导航与落点

| 场景     | mind 横向                        | mind 竖向          | org                    |
| -------- | -------------------------------- | ------------------ | ---------------------- |
| ↑ / ↓    | 同侧前/后兄弟                    | 左侧=子/父（按侧） | ↑ 父 / ↓ 最近的子      |
| ← / →    | 左树子/右树父                    | 前/后兄弟          | 前/后兄弟（不跨叔）    |
| 删除焦点 | 同侧后→前→父（经 kind.nav 分派） | 同                 | 后→前→父；根删除无落点 |

落点：mind = DropArea 三层热区（横 y 轴 / 竖 x 轴参数化）；org = 节点
本体三带（左 25% 前插 / 中 50% asChild / 右 25% 后插）> 子缝隙 > 父下
24px 空带。跨图/跨种类搬移走「序列化 → 删除 → 投影 → 反序列化插入」。

## 8. 工具入口与 UI

- 工具坞**单入口**「树形图」（图标 tree、tone mind）：标题/aria 随当前
  kind（「树形图 · 脑图 (M)」/「树形图 · 组织架构 (O)」）；激活即显示
  类型二级菜单（`TREE_KIND_OPTIONS`，切换保持激活）；kind 记忆随 M/O
  直达更新。`TREE_ORIENTATION_OPTIONS`（左右/上下）只给 ActionBar——
  排列是图属性不进工具菜单。
- AddButtons：`getTreeAddButtons`（core）按 kind/orientation 出槽位
  （mind 横向左/右+下、竖向上/下+右；org 下+右）；react `TreeAddButtons`
  只钳制与渲染（两轴 clamp）。
- 探针：`mindNodes/mindFocus` 字段名保留只加字段（节点带
  collapsed/visible/hiddenCount；焦点带 kind/orientation）。

## 9. 公开面

- 旧 mind 名称全部保留（`mindAddChild/mindAddSibling/mindDeleteFocused/
getMindAddButtons/mindGhostSuppressed$/mindFocusChanged$` 及包入口
  `layoutMindTree/BRANCH_COLORS/MIND_*` 等）——1.x 只增不删。
- 新增：`getTreeAddButtons/toggleTreeCollapse/setTreeOrientation`
  （BoardSDK）与 `TreeOrientation/TreeSide/ITreeNodeSpec/
ITreeAddButtonsState/OrgChartSchema/OrgChartData/TREE_KIND_OPTIONS/
TREE_ORIENTATION_OPTIONS`（包入口）。`IMindNodeSpec/IMindDragDelegate`
  为别名（`ITreeNodeSpec/ITreeDragDelegate`）。

## 10. 扩展指南（新树种类）

以文件树（缩进列表）为例：

1. `types/widget.ts` 加 `TREE_FILE` schema + 注册（family tree）；
   `widgetRuntime.ts` 加工厂。
2. 写纯策略：`layout/fileTree.ts`（每层 x 缩进、y 行高）、
   `connector/none.ts`、`nav/file.ts`、`drop/file.ts`、
   `kinds/file/style.ts`；`kinds/file.ts` 组装 ITreeKind。
3. `TREE_KINDS` 加一项；工具坞 `TREE_KIND_OPTIONS` 加一个选项。

不改 TreeMapVm/TreeService/TreeOps，不改 vmEngine/culling/selector，
不改公开 API 形状。
