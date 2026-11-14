# ActionBar popover 互斥（单源受控开合）

## 0. 结论摘要

ActionBar 上多个 popover 触发钮可以同时打开各自的二级面板。根因有二：每个
`PopoverControl` 各持私有 `useState(open)` 互不通信；ActionBar 容器为防画布
pointerdown 语义做的 `stopPropagation` 使 bar 内点击到不了各控件挂在 window 的
outside-click 监听——点另一个触发钮时旧面板不关、新面板又开。现将开合状态上提
为 ActionBar 单一的 `openPopoverId`（受控组件），天然互斥。

## 1. 根因

- `PopoverControl.tsx`：`const [open, setOpen] = useState(false)` 私有状态，
  触发钮 `setOpen(o => !o)` 只影响自己；
- `ActionBar.tsx` 容器 `onPointerDown={(e) => e.stopPropagation()}`（防画布
  手势，必须保留）——React 根容器代理的 synthetic stopPropagation 同时止住原生
  事件冒泡到 window，bar 内任何点击（其他触发钮/toggle/删除/导出）都进不了
  PopoverControl 的 window pointerdown outside-click；outside-click 只对 bar 外
  （画布）生效。

## 2. 方案（Toolbar cursorMode 同款单源模式）

- `ActionBar.tsx` 持唯一 `openPopoverId: string | null`，`renderSchema` 给每个
  PopoverControl 传 `open={openPopoverId === item.id}` 与 `onOpenChange`；
- 容器 `onPointerDown` 在原 stopPropagation 之后追加：`openPopoverId` 非空且
  target 不在 `[data-spinth-popover="${openPopoverId}"]` 内 → 清空（覆盖点 bar
  内非面板控件的收起路径）；点其他触发钮时 pointerdown 先清、随后的 click 再开
  新面板；
- `useEffect(() => setOpenPopoverId(null), [schema])`：选区/schema 重建即收起
  （面板语义属于旧 schema）；
- `PopoverControl.tsx` 改受控：删内部 useState，`closeAndRefocus`/Esc/
  outside-click/选项点击统一 `onOpenChange(false)`；回焦、roving、面板定位不动；
- `onOpenChange` 经 latest-ref 透传：宿主每次渲染重建内联回调，Esc/outside-click
  两个 window 监听只随 `open` 挂卸（不再随宿主重渲染反复挂卸）。

## 3. 测试

- 组件测试 `packages/react/src/__tests__/actionBarPopover.render.test.tsx`（6 例）：
  连点两个触发钮同屏至多一面板（aria-expanded 联动）/ 点 bar 空白收起并回焦 /
  只读往返不重开 / Esc 收起回焦 / schema 重建收起 / 宿主重渲染不重挂 Esc/外点
  监听（latest-ref 回归锁）；
- E2E `lineStyle.spec.ts`「ActionBar popover 互斥」：连点线型→线宽面板恒 1、
  首触发钮 `aria-expanded=false`；点虚线 toggle 收起（bar 内 pointerdown 路径）。

## 4. 边界

- 画布侧点击关闭仍走 PopoverControl 的 window outside-click（画布事件不经过
  bar 容器，不受 stopPropagation 影响）；
- 多面板同开时「Esc 一次全关」的旧怪象随单源消失（同一时刻至多一个监听）；
- 只读/接管往返（editable 翻 false 再回 true，schema 引用未变）时清空
  openPopoverId——否则旧面板在恢复可写时自动弹回（2026-11 审查返工；bounds
  不进 effect 依赖，避免拖拽每帧关面板）；
- bar 内 pointerdown 统一收起时回焦当前面板触发钮——面板卸载焦点不落地
  （specs/a11y-closeout §5.7 同款意图；点其他按钮时浏览器随后的 mousedown
  聚焦覆盖，不冲突）。
