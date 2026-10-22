# 18 — 编组 Group（成员 groupId 标记制）

## 0. 拍板记录

| 分叉           | 定案                                                                  | 落点 |
| -------------- | --------------------------------------------------------------------- | ---- |
| schema 路线    | 成员挂 optional `groupId`，无容器元素（扁平 Y.Array 不造父子树）      | §2   |
| 框选口径       | 整组全入框才选中整组；半组命中 = 该组完全不入选                       | §4.3 |
| 进入组内       | Alt+点击直选单体（双击语义保留给文字编辑）                            | §4.2 |
| 可组范围       | 仅自由元素：SHAPE/TEXT/STICKY/IMAGE/PEN/自由 LINE；脑图与锚定连线排除 | §3.1 |
| 单钮两可态     | 恰一整组/兜底显示“解组”；多整组、整组+散件、Alt 部分一律“编组”        | §3.4 |
| 单选分支解组钮 | 不显示；快捷键覆盖                                                    | §3.4 |

## 1. 设计目标与非目标

组是**选择聚合层**，不是画布实体：无组渲染单元、无组样式/命名、无组级变换。
一切“整组行为”由“选区自动扩展为成员全集”+“既有平铺多选机制”组合涌现——
拖动/删除/剪切/复制/微移/层级移动/awareness 远端选区/导出选区全部零改动。

非目标（挂账 §8）：嵌套编组、组级样式与命名、组整体旋转/缩放、脑图节点与锚定连线入组。

## 2. 数据模型

- `GroupIdField = { groupId: z.string().optional() }`，spread 混入六 schema
  （SHAPE/TEXT/STICKY/IMAGE/PEN/LINE）——optional 无 default，旧文档零迁移，
  消费侧字段不存在即无组。
- groupId 用 `genId()` 生成，不前缀（对消费者不透明）。
- 组消解规则：同 groupId 存活成员 ≤ 1 时组语义自然失效（点击 = 选它自己），
  不自动清理字段——被删成员经 undo 恢复后组自动复活；主动清理反而破坏复活。
- 锚定不变式：锚定连线不得持有 groupId；自由线转锚定（端点吸附宿主）时同事务清除。
- 能力位：`groupable` 类型级静态声明（六类 true、MIND_MAP false；
  LINE 锚定态排除是运行时判定，不进能力位）。

## 3. 命令与事务

### 3.1 建组 groupSelection()

- 入口：多选 ≥2，且选中集全部为可组元素（类型能力位 + LINE 运行时无锚点）；
  含脑图或锚定线 → 整命令拒绝（ActionBar 禁用态同条件，不部分建组）。
- 行为：新 groupId → `engine.transact` 内逐成员 `update({ groupId })`
  （已在旧组的成员被拉入新组——单层模型下 re-group 即改籍）+ zOrder 归拢
  （§3.3）→ `history.stopCapturing()`。一步 undo。选区不变。
- 快捷键 Mod+G（Cmd+G 默认查找下一个，keydown preventDefault 拦截；Ctrl 系双注册）。
- UI 入口：ActionBar 多选区组切换单钮（§3.4）。

### 3.2 解组 ungroupSelection()

- 口径：选中集涉及的每个组整组解（Alt 单选一名成员也算涉及）。
- 行为：`engine.transact` 内对每组成员 `update({ groupId: undefined })`
  → `stopCapturing()`。解组后选区保持原成员集不变。
- 快捷键 Mod+Shift+G；ActionBar 经 §3.4 单钮解组态可达。

### 3.3 zOrder 归拢（建组时一次性）

成员层级可能与其他元素交错（成员 z 1、3 中夹外元素 2），不归拢则“组移到顶层”
后仍然夹层。建组事务内把成员移到连续区段：保持相对序，置于原成员最高 zOrder 处
（复用 layerOps 的“选中集整体移动保序”数学）。

### 3.4 ActionBar 组切换单钮

多选区一个按钮按选择态切换（`groupService.getGroupActionState()` 单源；
schema 随 `widgetsChanged$` 重算——编组落库后选区不变、按钮自动翻转）：

| 选择态                                      | 显示         | 语义                                            |
| ------------------------------------------- | ------------ | ----------------------------------------------- |
| ≥2 散件（无组）                             | 编组         | 建组                                            |
| 恰一个整组（唯一涉及组且选中集 = 成员全集） | 解组         | 整组解                                          |
| 多整组 / 整组+散件 / Alt 部分成员+散件      | 编组         | 合并 / 收编 / 改籍（点完恰成一整组 → 翻“解组”） |
| 涉组且编组不可行（锚定线/脑图 + 组员）      | 解组         | 兜底——否则死按钮                                |
| 含不可组且不涉组                            | 编组（禁用） | 显示但禁用                                      |

单选分支（Alt 单选组内一员）不显示该钮——与对齐键口径一致，快捷键覆盖。

## 4. 选择集成

### 4.1 点击扩展

命中元素带 groupId 且非 Alt → `setSelected(该组存活成员全集, zOrder 序)`——
选中顺序语义保持（脑图复制依赖顺序，同款约束）。

### 4.2 Alt 直选 / shift 整组切换 / 双击编辑路径

- Alt+点击：跳过扩展，仅选命中单体——此后 RectEditor 单选手柄（缩放/旋转）
  自然可用，即“进入组改单体”；Esc 清空选区，不回整组。
- Shift+点击组员：整组加/移除切换（与单元素 shift toggle 同构）。
- 双击进文字编辑：要求单选——组选态下双击不触发编辑；组内编辑 = Alt 选单体后
  再点一次（两次点击，成本可接受）。

### 4.3 框选口径（整组全入框）

marquee 命中集后处理：凡带 groupId 的成员，其组全部存活成员 bounds 落入 marquee
矩形才保留整组；否则该组全部成员剔除。无组元素照旧相交即选。
过程与松手同口径（实时高亮即最终结果，不闪变）；组索引按手势建一次。

## 5. 各路径集成

| 路径                          | 行为                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| 拖动/删除/剪切/复制/微移/层级 | 零改动（选区已是成员全集，平铺机制天然整组）                               |
| 对齐/分布（docs/05 §7）       | 组参与体折叠：同组参与成员并为一参与体（union rect），delta 摊回组内每成员 |
| 粘贴（docs/09）               | 快照自带 groupId；同源组一桶一**新** groupId（一拷贝一组）                 |
| undo/redo                     | 建组/解组各一步；undo 成员删除 = 组复活                                    |
| 协同                          | groupId 普通字段更新，Yjs per-key LWW；两端同时编组后写胜，可接受          |
| awareness/导出/参考线         | 零改动（成员各自 bounds，与多选现状一致）                                  |

## 6. 纯函数层 groupOps.ts

- `expandIdsToGroups(ids, groupOf)`：点击/shift 扩展。
- `filterMarqueeByGroups(hitIds, marqueeRect, boundsOf, groupOf)`：框选口径。
- `partitionGroupable(ids, modelOf)`：建组校验（类型能力位 + LINE 锚定态）。
- `collectInvolvedGroupIds(ids, groupOf)`：解组涉及组。
- `collapseGroupParticipants(parts, groupOf)`：对齐参与体折叠。
- `computeGroupZOrderContraction`：建组 zOrder 归拢（复用 layerOps 数学）。

## 8. 挂账

- 嵌套编组（`groupId` → `groupIds` 迁移；可参考 penModel 的 initializeY 一次性迁移）。
- 组整体旋转/缩放（与旋转批多选挂账合并）。
- 组命名/样式。
- 右键菜单入口（若首版未含）。
