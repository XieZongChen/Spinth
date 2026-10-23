# 只读态收口：spec

> 本文件随仓库提交（`specs/`，实现方案与审查记录）。仓库内产品规格以
> docs/21 §4 为准。

## 0. 一句话目标

只读（`viewport.editable$.value === false`）时，**画布上任何写入口都不得看起来可点**：
命令层已经全守（安全网不动），缺口在「呈现层门禁」与「右键菜单的隐式选区」两处。

完成定义：

- 只读态下，UI 不存在"点击后静默 no-op"的按钮/菜单项，也不存在"只读但可选中"的路径；
- 可写的读操作（缩放/平移/导出/刷新/新建）一律保留；
- 全部行为有单测或 E2E 锚定，`pnpm verify` 与 `pnpm test:e2e` 全绿；
- docs/21 §4 新增「只读可交互面矩阵」，与实现逐行对应。

## 1. 范围

按优先级四块（本交接全部覆盖）：

| 编号 | 事项                                                            | 状态                                    |
| ---- | --------------------------------------------------------------- | --------------------------------------- |
| R1   | 工具坞 undo / redo / delete 的只读门禁                          | 现状缺（见 F1）                         |
| R2   | 浮动件（ActionBar / MindAddButtons）只读不可达                  | 现状可经右键/运行时降级到达（F3/F4/F6） |
| R3   | 右键菜单只读语义（不建选区、不出现死菜单项）                    | 现状完全缺失（F4/F5）                   |
| R4   | 运行时 `updateEditable(false)` 的状态收口（工具/选区/在途手势） | 现状只退编辑会话（F7/F8）               |

### 非目标（本批不做）

- **物理断网（editBlocked）** 的同类矩阵：与只读是两条独立闸门（docs/10 §4），
  单独一批收口，本批只在 docs/21 留一句边界说明。
- 只读态放开选择/复制（docs/21 §6 明确非目标：选择松手会落库，等于半个写者）。
- `BoardPublicApi` 形状变更、`app.ts` 拆分、`ctx: any` 类型化（属 P2 架构收口，另一批）。
- 协同/实时同步。

## 2. 现状与事实（实施前逐条核对，行号为当前 main）

### F1 工具坞三键不看 editable

`packages/react/src/components/Toolbar.tsx:171-204`：undo/redo/delete 的 `disabled`
只取 `!canUndo / !canRedo / selectedCount === 0`；同文件 `:108` 已有 `editable`，
`:142` 只用于工具键。运行时降级后（历史非空、或有选区）三键可点，点击后
`BoardCommands` 静默返回。

### F2 ActionBar 的 disabled 契约只对 action 生效

- `ActionBar.tsx:30-55` `ToggleControl`：完全不读 `item.disabled`；
- `PopoverControl.tsx:76-100`：触发按钮同样不读（面板选项也没有 disabled 概念）；
- 只有 `ActionBar.tsx:71-88` `ActionControl` 读了 `aria-disabled` / `disabled`。

这是 schema 契约的既有漏洞，不只是只读问题——只读收口必须顺带补上，否则
"schema 里标 disabled 但不生效"会再次变成假禁用。

### F3 ActionBar 没有只读分支

`ActionBar.tsx:104-124`：只按 `schema`/`bounds` 是否为 null 决定渲染；删除按钮
（`:161-170`）无任何 disabled 逻辑，导出按钮（`:151-160`）是读操作应当保留。

### F4 右键在只读态仍会建立选区（core 语义 bug）

`packages/core/src/platform/contextMenu/contextMenuService.ts:40-73`：

- `:46` 只判 `modeGuard() !== 'cursor'`，不判 `editable`；
- `:58-62` 命中元素就地 `selector.setSelected([top.id])`；
- `selectorService.setSelected()`（`selectorService.ts:137-149`）是纯状态变更，没有写门禁。

右键是 DOM 事件（不经 viewport 指针分发），因此绕过了
`viewportService.ts:271-291` 的只读闸门。后果：follower 右键元素 → 出现选区框 →
`selected$` 推给 bridge → **ActionBar 整条出现在只读画布上**，六个写控件全可点全 no-op。
这同时违反 docs/21 §4「只读禁止选择」。

### F5 右键菜单项不区分只读

`ContextMenu.tsx:29-82` 元素菜单（复制/剪切/粘贴/置顶/置底/删除）与
`:83-113` 画布菜单（粘贴/全选/导出/适应屏幕）都只按 `canPaste` 判定。
只读时 `canPaste` 仍可能为 true（降级前留下的内部缓冲）。

### F6 MindAddButtons 无门禁

`MindAddButtons.tsx:28-31` 只判 `state` 是否存在；焦点残留时只读也可点（命令层 no-op）。

### F7 运行时降级不退出写工具

`boardCommands.ts:94-102 updateEditable(false)` 只做 `exitActive()` +
`editable$.next(false)` + `setWriteEnabled(false)`。若降级前停在 shape/pen/mind，
`cursorMode` 保持写工具 → ToolGhost 继续画幽灵、该工具的二级菜单继续展开——
UI 宣称"可以画"，而 viewport 已丢弃全部指针。

### F8 运行时降级不清选区、不取消在途手势

- 选区框（`optionLayer`）与 ActionBar 残留，直到用户做别的事；
- 在途拖拽/框选/画笔：`viewportService.ts:290` 对 `!editable` 的 `up` 也直接 return，
  handler 收不到 up，拖拽状态机停在半路（该行与 `:271-282` 注释"up 必须放行"相矛盾，
  只在只读路径上成立）。

### F9 已守住、**不要动**的安全网

- 命令层：`boardCommands.ts:106-108 assertEditable()`；undo/redo/removeSelected
  （`:126-144`）、对齐/分布/编组/层级/微移/脑图增删全部自守。
- 键盘：`keyboardService.ts:88-92` 非白名单键在只读时整条拦。
- 剪贴板：`clipboardService.ts:53/87/123/196`。
- 指针：`viewportService.ts:271-291`。
- 磁盘：`engine.setWriteEnabled` → `DbProvider` 只读 attach（docs/21 §4 磁盘节）。
- 导入菜单：`ProjectMenu.tsx:285`。

## 3. 设计决策

### D1 分层：core 修语义，react 修呈现

| 层    | 职责                                                             | 本批改动                        |
| ----- | ---------------------------------------------------------------- | ------------------------------- |
| core  | 只读时**不该存在的状态**（选区、写工具激活、在途手势、菜单类别） | F4/F7/F8 + `setCursorMode` 钳制 |
| react | 只读时**不该可点的呈现**（禁用 / 隐藏）                          | F1/F2/F3/F6                     |

理由：命令层已守，缺的是"认知一致性"。若把所有 gate 收进 react，F4（core 建选区）
与 F7（core 工具态）永远修不掉；若把 gate 全塞进 core schema，会牵动
`getActionBarSchema` 公开契约与 bridge 的 schema 缓存（当前只在
`selected$/widgetsChanged$/mindFocus` 失效，`editable$` 不在其中——漏一处就是
"降级后 ActionBar 还在"），得不偿失。

### D2 持久铬件禁用，浮动件隐藏

- **禁用**：工具坞、菜单项——常驻/有固定版式，隐藏会造成布局跳动与能力不可发现。
- **隐藏**：ActionBar、MindAddButtons——附着于选区/焦点；只读下这两个对象本就不存在，
  隐藏是语义结果而非特判。
- **清空**：选区框——不残留"已选中"的错觉。

### D3 右键只读降级为画布菜单（core）

只读时：不做命中测试的就地选中、`onWidget` 恒 false、`canPaste` 恒 false。
菜单仍打开，只保留读操作（导出画布 PNG / 适应屏幕）。

被否方案：

- _只读完全不弹菜单_：丢掉合法的导出/适应屏幕入口。
- _照弹元素菜单、只把写项灰掉_：仍会建立选区（违反 docs/21 §4），且一屏六个死按钮。

### D4 运行时降级的收口序列（core `updateEditable(false)`）

严格按此顺序（顺序本身是语义）：

1. `editingService.exitActive()` —— 既有；先把文本编辑会话落库收口。
2. 手势收口，二选一（不要两次 cancel）：
   - `cursorMode` 是写工具 → `viewport.setCursorMode('cursor')`（内部对旧模式发
     `dispatchGestureCancel`，`viewportService.ts:446-449`）；
   - 已是 `cursor`/`hand` → `viewport.dispatchGestureCancel(cursorMode)`（取消框选蓝框）。
3. `viewport.editable$.next(false)` —— **先翻闸门**，其后所有派生状态（工具坞/菜单/
   schema 拉取）第一次计算就看到只读，不存在"先可写一帧"。
4. `selector.setSelected([])` —— 清选区（选区框、ActionBar、MindAdd 连带消失）。
   （步骤 2 若走了 `setCursorMode`，它已顺带清一次，这里幂等。）
5. `engine.setWriteEnabled(false)` —— **最后**：步骤 1 可能刚产生一次文本提交，
   必须先于拒写。

切回可写（`v === true`）保持现状：只翻 `editable$` 与 `setWriteEnabled(true)`，
不恢复工具/选区（无记忆，简单且可预期）。

被否：先 `setWriteEnabled(false)` 再 cancel（cancel 路径若有写会丢）；只清选区不取消手势
（状态机悬挂）；只退工具不清选区（选区框残留）。

### D5 `BoardCommands.setCursorMode` 加只读钳制

宿主可编程调用 `sdk.setCursorMode('pen')`，键盘/工具坞不是唯一入口。规则：
只读且 mode 不属于 `{cursor, hand}` → 落为 `'cursor'`。`hand` 是视图工具，放行。

注意：空格临时抓手走 `ViewportService` 内部直调（`viewportService.ts:422/427`），
不经该闸门——本就不该拦。

### D6 react 四处呈现门禁

| 位置                               | 改法                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `Toolbar.tsx:171-204`              | 三键 `disabled` 前置 `!editable`（delete 仍保留 `selectedCount === 0` 条件）                |
| `ActionBar.tsx:104`                | 取 `editable`，`if (!editable) return null`（放在 `useLayoutEffect` 之后，保持 hooks 顺序） |
| `ToggleControl` / `PopoverControl` | 触发按钮 `disabled={item.disabled === true}` + `disabled:` 样式类（契约修复）               |
| `MindAddButtons.tsx:28`            | 取 `editable`，`if (!editable) return null`                                                 |

不新增 store 字段（`editable` 已在 `spinthStore.ts:36/69`，bridge `:67` 已订阅）。

### D7 接口先行

`IViewportService`（`packages/core/src/types/services.ts:66-71` 附近）补
`dispatchGestureCancel(mode: CursorMode): void`。该方法早已是 `ViewportService`
的公开成员（`viewportService.ts:377-390`，被 `setCursorMode` 与 Esc 使用），只是
没进接口；不进接口就只能靠 `ctx: any` 调，审查会打回。现有测试桩都是
`as unknown as IViewportService`，加方法不会破编译。

## 4. 规格：只读可交互面矩阵（实施后原样写入 docs/21 §4）

| 入口                                                     | 只读表现                                                       | 实现层                         |
| -------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| 工具坞：写工具（shape/text/line/pen/eraser/sticky/mind） | 禁用                                                           | react（既有）                  |
| 工具坞：cursor / hand                                    | 可用                                                           | react（既有）                  |
| 工具坞：undo / redo / delete                             | 禁用                                                           | react（本批）                  |
| 画布指针：选择 / 拖拽 / 框选 / 绘制                      | 丢弃                                                           | core（既有）                   |
| 右键：命中元素                                           | 不选中、不出现元素菜单；出画布菜单                             | core（本批）                   |
| 右键菜单：复制/剪切/置顶/置底/删除                       | 不出现                                                         | core（本批，元素菜单不可达）   |
| 右键菜单：粘贴                                           | 禁用                                                           | core（本批，`canPaste=false`） |
| 右键菜单：导出画布 PNG / 适应屏幕                        | 可用                                                           | —（读操作）                    |
| ActionBar（含删除、样式）                                | 不渲染                                                         | react（本批）                  |
| MindAddButtons（脑图 ＋）                                | 不渲染                                                         | react（本批）                  |
| 键盘：工具键 / 删除 / undo                               | 拦截                                                           | core（既有）                   |
| 键盘：缩放四键 / F / Esc / 空格抓手                      | 可用                                                           | core（既有）                   |
| 项目菜单：导入                                           | 禁用                                                           | app（既有）                    |
| 项目菜单：导出 / 新建画布 / 主题 / 存储面板              | 可用                                                           | —（读/导航）                   |
| 运行时降级（`updateEditable(false)`）                    | 退编辑会话 → 取消手势 → 吃闸门 → 工具回 cursor → 清选区 → 拒写 | core（本批）                   |

## 5. 文件改动清单

core：

- `packages/core/src/types/services.ts` —— `IViewportService.dispatchGestureCancel`
- `packages/core/src/platform/contextMenu/contextMenuService.ts` —— D3
- `packages/core/src/boardCommands.ts` —— D4 序列 + D5 钳制
- `packages/core/src/platform/viewport/viewportService.ts` —— 只加注释（说明 `:290`
  依赖 D4 的手势收口；**不改行为**）

react：

- `packages/react/src/components/Toolbar.tsx`
- `packages/react/src/components/ActionBar.tsx`
- `packages/react/src/components/PopoverControl.tsx`
- `packages/react/src/components/MindAddButtons.tsx`

测试与文档见 §7、§8。

## 6. 实施顺序（每个 commit 独立可回退）

### Step 0 基线 + 红用例（先证明 F4 存在）

- `pnpm install && pnpm verify` 记录基线；
- 先写 `multiTab.spec.ts` 的只读右键用例，跑 `npx playwright test multiTab -g 右键`，
  **必须红**（当前会选中元素且出现 ActionBar）。红了再改实现。
- 红用例留档：这就是"区分验证"（docs/15 §3）。

### Step 1 core 语义（D3 + D4 + D5 + D7）

1. `types/services.ts` 加接口方法（先契约）；
2. `contextMenuService.ts` 只读分支；
3. `boardCommands.ts` 两个方法；
4. 新增两份单测（§7.1），跑 `pnpm -r test`。
5. 提交：`refactor: 只读语义收口（右键不建选区、降级序列）`

### Step 2 react 呈现（D6 + D2 契约修复）

1. Toolbar 三键；
2. ActionBar 早退 + Toggle/Popover 尊重 `disabled`；
3. MindAddButtons 早退；
4. 新增 `readonlyGate.test.tsx`（§7.2）。
5. 提交：`fix: 只读态呈现门禁（工具坞三键/操作栏/脑图按钮）`

### Step 3 E2E

1. `multiTab.spec.ts` 新增 follower 右键用例（Step 0 的红用例转绿）；
2. `smoke.spec.ts` 1.22 原地扩写为"运行时降级收口"（§7.3）。
3. 跑 `pnpm test:e2e`（至少 multiTab / smoke / clipboard / projectFile / toolbar / export）。
4. 提交：`test: 只读态回归（右键不建选区、降级收口）`

### Step 4 文档

docs/21 §4 矩阵 + docs/12 §4 + docs/09 闸门 + docs/13 勾选 + 测试基线数字（§8）。
提交：`docs: 只读可交互面矩阵`

## 7. 测试矩阵

### 7.1 core 单测（vitest）

**新增 `packages/core/src/__tests__/contextMenuReadonly.test.ts`**（`@vitest-environment jsdom`）：

- 桩：`IViewportService`（`container` = div、`editable$`、`cursorMode$`、`toWorld`、
  `querySelector('canvas')` 返回 null）、`selector`（`setSelected` 用 vi.fn）、
  `vmEngine.getVmByPoint` 返回命中/空、`hasClipboard`、`modeGuard`；
- 用例：
  1. `editable=false` + 命中元素 → `setSelected` **零调用**、`options.onWidget === false`、
     `canPaste === false`、`show === true`；
  2. `editable=true` + 命中元素 → `setSelected([id])`、`onWidget === true`（现状回归）；
  3. `editable=false` + 缓冲有内容 → `canPaste === false`（不是 `hasClipboard()` 直通）。

**新增 `packages/core/src/__tests__/updateEditable.test.ts`**：

- 桩 `BoardCommands` 的 `ctx`（viewport/selector/editingService/engine 各带 vi.fn +
  调用序列数组），断言：
  1. `updateEditable(false)`：`exitActive` → 手势收口 → `editable$.next(false)` →
     `setSelected([])` → `setWriteEnabled(false)` 的**调用顺序**；
  2. 当前模式为 `pen` 时走 `setCursorMode('cursor')`，**不再**额外调
     `dispatchGestureCancel`（不双 cancel）；
  3. 当前模式为 `cursor` 时走 `dispatchGestureCancel('cursor')`，不调 `setCursorMode`；
  4. 幂等：连续两次 `updateEditable(false)` 不抛、状态一致（按实现写断言，别锁死实现细节）；
  5. `updateEditable(true)` 只翻闸门 + 恢复写，不触碰选区/工具。
- `setCursorMode` 钳制：只读 + `'pen'` → 实际 `'cursor'`；
  `'hand'` 原样；可写时 `'pen'` 原样。

### 7.2 react 单测（`@vitest-environment jsdom`）

**新增 `packages/react/src/__tests__/readonlyGate.test.tsx`**（沿用
`components.render.test.tsx` 的 `createRoot + act + store 直写` 手法，零新依赖）：

1. `Toolbar`：`editable=false, canUndo=true, canRedo=true, selectedCount=1` →
   撤销/重做/删除三键 `disabled`；`editable=true` → 三键可点（区分验证）。
2. `ActionBar`：注入 `actionBar = { schema: <fake>, bounds: <rect> }` 且
   `editable=false` → `[data-spinth-action-bar]` 数量 0；`editable=true` → 渲染 1 条。
3. `ActionBar` disabled 契约：fake schema 里 popover / toggle / action 各一条
   `disabled: true` → 三个按钮全部 `disabled`（这条与只读无关，是 F2 的回归锁）。
4. `MindAddButtons`：注入 `mindAddButtons` state + `editable=false` → 不渲染；
   `editable=true` → 渲染。

每个用例结束恢复 store 初值（现有用例同款写法）。

### 7.3 E2E

**`multiTab.spec.ts` 新增**：『follower 右键不建选区、无操作栏、菜单只读项』

- leader 建一件并 `ready`；follower 就位；
- follower 右键该元素中心（坐标经探针世界→屏幕换算，遵守 docs/15 §3）；
- 断言：`__spinth.selected$.getValue().length === 0`、
  `[data-spinth-action-bar]` count 0、`[data-spinth-context-menu]` 可见、
  菜单里没有「删除」、有「导出画布 PNG」且「粘贴」disabled、关菜单后 `modelCount` 不变。

**`smoke.spec.ts` 1.22 扩写为运行时降级收口**（保留原徽标断言）：

- 先建矩形 → 切回 cursor → 点击选中（此时 ActionBar 可见、undo 可点）；
- `__spinth.updateEditable(false)`；
- 断言：徽标出现、`[data-spinth-action-bar]` count 0、`__spinth.selected$` 为空、
  `__spinth.cursorMode$` 为 `cursor`、工具栏三键 disabled、写工具 disabled、
  「选择」仍 enabled。

## 8. 文档同步（逐段改，不新增变更记录）

1. **docs/21 §4**：把「只读标签允许 / 禁止」段落换成 §4 的矩阵表（保留磁盘与维护链两段），
   并补两句：右键降级规则、`updateEditable(false)` 六步序列（可压成一行箭头链）。
2. **docs/12 §4 只读提示条段**：补「只读下选择与复制受写门禁限制，右键不建选区」。
3. **docs/12 §4 ActionBar 段**：补「只读态整条不渲染（含删除入口）；样式控件遵守
   schema `disabled` 契约」。
4. **docs/09 §filter 闸门**：补一条「只读态：右键菜单降级为画布菜单（不建选区、
   粘贴与元素项不可达）」。
5. **docs/13 §2 P2**：首条打勾或改写为已完成项。
6. **测试基线数字**：跑 `pnpm -r test` 取真值，同步 docs/13 §1、docs/15 §2、AGENTS.md
   「当前状态」（当前三处口径已漂移：docs/13 写 853、AGENTS 写 857——本批一并校正到真值）。
7. **docs/21 §7 测试锚点**：补新增单测文件名与 E2E 用例名。

## 9. 验收标准

- [ ] `pnpm verify` 全绿（hygiene + lint + prettier + typecheck + 单测 + build）
- [ ] `pnpm test:e2e` 全绿，重点回归：multiTab / smoke / clipboard / projectFile /
      toolbar / export
- [ ] Step 0 的红用例在实现后转绿（区分验证留痕于提交信息或回执）
- [ ] 只读下四个读入口仍可用：缩放、抓手平移、导出项目、导出 PNG
- [ ] 无新增依赖、无 store 字段新增、`BoardPublicApi` 未动
- [ ] docs 矩阵与实现逐行对得上（审查时逐行核）

## 10. 审查清单（方案作者复核用）

架构与铁律：

- [ ] core 只改"语义"（选区/工具/手势），react 只改"呈现"——分层没有串味
- [ ] `dispatchGestureCancel` 进了 `IViewportService`，没有再用 `ctx: any` 偷调
- [ ] 没有为了省事在 `getActionBarSchema` 里塞只读分支（若实现选了该方案：必须同时
      在 bridge 对 `editable$` 失效 schema 缓存，并补缓存测试——默认不接受）
- [ ] 不改命令层守卫、不改 dataEngine/vmEngine

正确性：

- [ ] `updateEditable(false)` 的调用顺序与 D4 一致（`setWriteEnabled(false)` 在最后）
- [ ] 手势收口只发生一次（写工具走 `setCursorMode`，cursor/hand 走 `dispatchGestureCancel`）
- [ ] 只读右键：`setSelected` 零调用（含命中元素路径），`canPaste` 为 false
- [ ] ActionBar 早退放在 hooks 之后，React hooks 顺序稳定
- [ ] Popover/Toggle 的 `disabled` 同时管住点击与样式（`disabled:` 类 + `pointer-events`）
- [ ] 降级后 ToolGhost 不再出现、二级菜单收起（由 D5 钳制保证）

测试质量：

- [ ] 单测用桩，不拉真实 PIXI/DOM 渲染链
- [ ] E2E 断言走探针（`selected$` / `cursorMode$` / `modelCount`），不靠截图或固定坐标
      硬编码（坐标从世界坐标反推）
- [ ] 新用例对旧实现确实红过（区分验证）
- [ ] 没有为了过测放宽既有断言

文档：

- [ ] 矩阵每一行都能在代码里找到对应实现
- [ ] 测试数字三处一致（docs/13、docs/15、AGENTS）
- [ ] 没有把验收流水账写进 docs（只留规格与当前事实）

## 11. 风险、回退

| 风险                               | 影响                                 | 处置                                                     |
| ---------------------------------- | ------------------------------------ | -------------------------------------------------------- |
| 右键语义变更影响既有 E2E           | clipboard.spec 的可写路径用例        | 只读分支用 `editable` 早判，可写路径逐行不动；跑全量 e2e |
| `setCursorMode` 钳制影响内部调用   | 组合根 `boardComposition.ts:340/356` | 只读才钳制；可写路径零变化                               |
| 清选区影响宿主"降级后仍想导出选区" | 无该场景（选区不可得）               | 如有需求另开只读选区模式，不在本批                       |
| 接口新增方法                       | 桩实现断编译                         | 现有桩均 `as unknown as`；typecheck 验证                 |
| E2E flake                          | 右键坐标/角色等待                    | 复用 `waitRole` + 探针换算；必要时 `expect.poll`         |

回退：四个 commit 各自 revert 即回滚；core 与 react 的措置互不依赖（只有合起来才完整）。

## 12. 实施回执（实施 agent 填写，方案作者据此审查）

### 12.1 提交清单

| commit  | 内容                                                                                                                                               | 门禁结果                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| bf5908e | refactor: 只读语义收口（右键不建选区、降级序列）——D3/D4/D5/D7 + contextMenuReadonly 4 例 + updateEditable 9 例 + boardSdkCursorMode 桩补 editable$ | lint/typecheck/单测全绿；红用例随之转绿                                             |
| f6b9af5 | fix: 只读态呈现门禁（工具坞三键/操作栏/脑图按钮）——D6 + F2 契约修复 + readonlyGate 7 例                                                            | lint/typecheck/react 单测 16/16                                                     |
| 34b1a19 | test: 只读态回归（右键不建选区、降级收口）——multiTab 新用例 + smoke 1.22 扩写                                                                      | smoke+multiTab 16/16；clipboard/projectFile/toolbar/export 25/25；fast 全量 161/161 |
| 9490a20 | docs: 只读可交互面矩阵——docs/21 §4 矩阵+序列+边界句、docs/12、docs/09、docs/13、docs/15、AGENTS 数字三处对齐                                       | prettier/hygiene 随最终 verify                                                      |

### 12.2 与方案的偏离

- 无功能性偏离。两处实现层说明：① `updateEditable(false)` 步骤②中 mode 为
  cursor/hand 时调 `dispatchGestureCancel(mode ?? 'cursor')`，`?? 'cursor'` 仅在
  viewport 桩缺 cursorMode$ 时兜底（真实组装恒有值）；② boardSdkCursorMode.test.ts
  的 viewport 桩按计划补了 `editable$`（缺省会误判只读），其余既有 setCursorMode
  测试桩均注入 service 层不经 BoardCommands，无需改动。
- E2E 「只读视图操作」等既有 multiTab 用例零改动；clipboard.spec 右键可写路径复跑绿。

### 12.3 新增测试

- 单测数量：core +13（848→861）/ react +7（9→16），共 877（102 文件）。
- 新增用例名：contextMenuReadonly（只读命中零 setSelected/可写现状回归/只读空白不触碰/
  canPaste 不看 hasClipboard）；updateEditable（pen 序列/ cursor 序列/ hand 序列/幂等/
  切回无记忆 + 钳制四例）；readonlyGate（三键只读禁用/可写区分/ActionBar 不渲染/
  渲染/三类控件 disabled 契约/MindAddButtons 不渲染/渲染）。
- E2E 数量：170 / 18 spec（原 169；multiTab 10→11，smoke 1.22 原地扩写不计数）。

### 12.4 命令输出摘要

- `pnpm verify`：实施前基线与最终全绿（857→877 单测，含 build）。
- `pnpm test:e2e`：fast 层 `--grep-invert "@timing|@bench|@visual"` 161/161 全绿
  （6.6m）；timing+bench 5/5（28.4s，--workers=1）；visual 4/4（27.0s）——三层合计
  170/170。
- 红用例转绿证据：Step 0 新用例在 main@5d02876 上跑 `-g 右键` 失败于
  「selected$.getValue().length 期望 0、实收 1」（F4 实证），bf5908e 后同命令通过
  （16.4s）；提交信息与本地运行记录留痕。

### 12.5 遗留 / 疑问

- 物理断网（editBlocked）同类矩阵：按方案 §1 非目标未动，已在 docs/21 §4 留边界句、
  docs/13 P2 挂账。
- 全选菜单项在画布菜单恒 disabled（既有事实，F5 之外的既有死项）：只读矩阵不受影响，
  是否补「只读态隐藏」或恢复全选能力属产品决策，未在本批处理。

## 13. 审查结论（方案作者，本轮）

**结论：通过，可合并；合并前只需修一行文档数字（F-1）。** 四段提交与方案逐条对得上，
core/react 分层没有串味，命令层守卫未动，回执数据经独立复跑核对属实。

### 13.1 需修（合并前）

- **F-1 覆盖率数字过期**：`docs/15-testing.md` §2 仍写 `65.35 / 55.19 / 56.39 / 67.31`。
  本机 `pnpm test:coverage` 实测 `65.72 / 55.33 / 56.66 / 67.74`（阈值 61/51/52/63 通过）。
  文档只写当前事实，改这一行即可。

### 13.2 非阻塞（建议 follow-up；其中两条是方案遗漏而非实施偏离）

- **F-2 降级不覆盖 rectEditor 手势**（方案遗漏）：`RectEditorService` 用 window 级
  `pointermove/pointerup`（`rectEditorService.ts` 166-167 / 239-240），不经
  viewport handlers；`updateEditable(false)` 的 cancel 只打到 selector。清选区后
  `targetId` 为 null，但 `this.resize` 仍存活，抬手 `onWindowUp` 仍
  `commitResize` 写 Yjs + history。触发面极窄（宿主在拖缩放柄的同一刻降级），当前无
  用户路径；建议下批补 `rectEditor.cancelGesture()` 并在 D4 调用，或把 docs/21 §4
  的"手势收口"限定为"viewport 路由的手势"。
- **F-3 空画布引导不区分只读**（方案遗漏）：`App.tsx:159-168` 在 `modelCount === 0`
  时提示"R 拖出矩形 · S 便签…"，follower 打开空文档会看到无法执行的指令。加 `editable`
  条件或换只读文案。
- **F-4 降级不清已打开的右键菜单**：菜单项（删除/置顶）保持可点、点击静默 no-op。
  `updateEditable(false)` 里补 `this.ctx.contextMenu?.close()` 即可（一行 + 一条断言）。

### 13.3 Nit

- `setCursorMode` 钳制把"无 viewport"当只读（`!this.ctx.viewport?.editable$.value`）：
  当前下游全是可选调用、无副作用，但语义含糊，可写显式三元或加注释。
- smoke 1.22 的 `cursorMode === 'cursor'` 在测试路径上恒真（降级前已切 cursor），
  钳制路径由单测覆盖——注释已说明，保留可接受。
- `updateEditable.test.ts` 的调用序数组不含 `editable$.next`，"先翻闸门再清选区"
  没被锁住；可选补订阅记录。
- multiTab 新用例尾部双页 `cleanupDoc` 是本文件首例（其余用例不清理），无害但风格不一致。

### 13.4 独立核验记录

- `pnpm verify`：全绿（hygiene / lint / prettier / typecheck / 861 + 16 单测 / build），
  与回执一致。
- `pnpm test:coverage`：阈值通过；totals 见 F-1。
- E2E 独立复跑：`playwright test multiTab smoke -g "follower 右键|1.22" --workers=1`
  → 2 passed（23.3s）。
- 计数核对：core 861 + react 16 = 877（102 文件）；E2E 170 = 161 fast + 5 timing/bench + 4 visual；
  multiTab 11 例。
- 提交拆分：bf5908e core / f6b9af5 react / 34b1a19 e2e / 9490a20 docs，无夹带。

### 13.5 待人类确认

- `AGENTS.md` 被改动（基线数字 + 下一阶段重点）。内容与交接方案一致，但仓库约定
  "修改本文件需人类确认"——需用户点头留档。

## 14. 审查修复回执（实施 agent 第二轮，§13 全条目处置）

用户指示「全部都改」——F-1..F-4 与四条 Nit 全部落实，两个 commit：

- **567cff0** `fix: 只读降级补收口（rectEditor 窗口级手势与右键菜单）`
  - F-2：新增 `RectEditorService.cancelGesture()`（撤 window 监听、缩放按
    `applyResizePreview(start, start)` 回落、旋转按起点角度回落、隐藏参考线匹配；
    不 commit 不 stopCapturing），接入 `updateEditable` 步骤②。选了「补实现」
    而非「限定 docs 口径」。`rectEditor.test.ts` +3（缩放取消/旋转取消/无手势
    no-op，均断言迟到 pointerup 不再落库）。
  - F-4：步骤④ 追加 `contextMenu.close()`。
  - Nit-1：钳制改为 `vp && !vp.editable$.value`——无 viewport 不钳制（未知模式
    保守清选区为既有语义，注释与测试明确）。
  - Nit-3：`updateEditable.test.ts` 序数组经 `editable$.subscribe` 记录闸门翻转，
    「先翻闸门 → 再清选区」被锁死；无 viewport 用例 +1。
- **5b5d914** `fix: 空画布引导只读不显示 + 降级钳制 E2E 路径`
  - F-3：`App.tsx` 空画布引导加 `editable` 条件；multiTab「只读不写盘」用例补双向
    断言（follower 无引导 / leader 有引导）。
  - Nit-2：smoke 1.22 尾部补钳制路径（可写 → 按 R 切 shape → 再降级 → poll
    `cursorMode` 为 cursor），原恒真断言随之删除。
  - Nit-4：multiTab 末例内联清理统一为 `cleanupDoc` helper。
- **docs commit（随后）**：F-1 覆盖率行改为修复后复测值 `65.79 / 55.37 / 56.68 /
67.81`（比审查值 65.72/55.33/56.66/67.74 又高——本轮 +4 单测）；docs/21 §4 降级
  序列补 rectEditor/关菜单/空态引导句；docs/12 §6 补只读不显示；基线数字三处
  877→881（core 865 + react 16）。
- 门禁：lint/typecheck 绿；单测 881（core 865 + react 16）；smoke+multiTab 16/16、
  projectFile/clipboard/export/toolbar 25/25；全量 170/170（审查方复跑，6.4m，含 visual 4/4）。

## 16. 第三轮收口（方案作者，审查 F-5~F-8 修复）

本轮由方案作者直接修改并推送，三个 commit：

- **6e0584d** `fix: rectEditor 取消手势通知跟随层并标脏（审查 F-5）`：
  `cancelGesture()` 复位后补 `resizeMove$.next()` / `onRotatePreview?.()` /
  `markRender()`（无手势时不标脏）；单测补"跟随层通知 + 标脏"断言与 no-op 不标脏。
- **e67b8c9** `test: smoke 1.22 补只读钳制直调断言（审查 F-6）`：原来那条改名
  "降级序列的工具复位"，另加只读态 `__spinth.setCursorMode('pen')` → 仍 cursor
  的真钳制断言（去掉 D5 钳制即红）。
- **b71e750** `docs: 测试锚点与降级口径补正（审查 F-6/F-7）`：docs/21 §7 补
  `rectEditor.test.ts` 锚点、docs/15 措辞区分"复位"与"钳制"。
- **9e11e36** `docs: 覆盖率基线随取消手势修复复测`：65.79→**65.81 / 55.38 / 56.68 /
  67.83**（取消手势新增行被测试覆盖，重测后微升）。

核验：`pnpm verify` 全绿（881）；全量 E2E **170/170**（6.4m）；三次推送的
pre-push `pnpm verify` 均通过。

F-8 已处置：§14 末尾悬挂句改为实测结果。**仍未销账**：`AGENTS.md` 的修改需要
人类确认（仓库约定）。

## 15. 第二轮审查结论（方案作者）

**结论：通过，可合并。** 上轮 F-1..F-4 与四条 Nit 全部落实，且经独立核验（不是照抄回执）。

### 15.1 已核验

- `pnpm verify` 全绿；单测 **881**（core 865 + react 16），文件数仍 102。
- `pnpm test:coverage` 实跑 **65.79 / 55.37 / 56.68 / 67.81**——与 `docs/15` 新写入值
  完全一致，F-1 是实测值不是估计。
- E2E 独立复跑 `multiTab -g "只读不写盘"` + `smoke -g "1.22"` → 2 passed（23.8s）。
- 实现细节抽查：`cancelGesture()` 放在清选区**之前**（顺序正确——setSelected([]) 会先
  把 targetId 置空并隐藏编辑器，之后再取消就拿不到 vm 了）；`applyResizePreview(start, start)`
  在 base/pen 两条实现上都退化为恒等（`mapPointsRect` 对零宽高有守卫）；
  `removeEventListener('pointerup')` 与 `{ once: true }` 的注册参数匹配，监听确会撤掉。
- 提交拆分：567cff0 core / 5b5d914 app+e2e / fb64e20 docs，无夹带。

### 15.2 仍非阻塞（可下批）

- **F-5 `cancelGesture()` 不自洽于渲染/跟随层**：复位了 VM 预览但没 `markRender()`，
  也没通知 `resizeMove$`（快捷连接点）与 `onRotatePreview`（锚定线重路由）。当前
  降级路径紧接 `setSelected([])`——`SelectionVm.hide()` 会 `markRender()` 兜住重绘，
  所以现状无可见缺陷；但该方法一旦被 Esc 之类的路径复用就会留下"线停在预览位"的残影。
  建议补三行：`resizeMove$.next()` / `onRotatePreview?.()` / `markRender()`。
- **F-6 smoke 1.22 的"钳制路径"标签名不副实**：去掉 D5 的 `setCursorMode` 钳制后该断言
  仍然绿——因为 `updateEditable` 步骤②本来就会把写工具复位成 cursor，它验证的是降级序列
  而不是钳制。要么把注释/`docs/15` 措辞改成"降级后工具复位"，要么补一条真钳制断言：
  只读态下 `__spinth.setCursorMode('pen')` → poll `cursorMode` 仍为 cursor。
- **F-7 `docs/21` §7 测试锚点未列 `rectEditor.test.ts` 的 cancelGesture 三例**（`docs/15`
  已列），锚点清单不齐。
- **F-8 回执末尾"全量三层复跑见下。"后面没有内容**：补一行结果，或删掉这句。

### 15.3 仍待人类确认

- `AGENTS.md`（本轮只改了基线数字）——仓库约定"修改本文件需人类确认"，仍需用户点头。
