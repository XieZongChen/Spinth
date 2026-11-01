# 可访问性挂账收口（批次 B）——技术方案与设计审查

> 对应 [docs/13](../docs/13-roadmap.md) §3 的可访问性挂账四项：右键菜单键盘协议、
> 工具主题色对 soft 底对比度、200% 缩放与安全区、屏读全量巡检。
> 基线：`main @ b0b8b94`（2026-10-25）。文内行号为撰写时口径，实施后以代码为准。
> 状态：**已实施完成**（2026-10-25，六步提交 867cb13 → edf26ab → 410fe7d →
> 1c8c6c7 → 32b8917 → 文档提交；实测记录与三个衍生缺陷修复见 §13.4）。
> 唯一待人工项：§8.7 VoiceOver 清单。
> 本文件是过程文档（允许行号/预估/实测记录）；`docs/` 只吸收当前事实。
> 术语勘误：撰写稿用「工具音色」，入库时已全仓改为「工具主题色」（用户口径）。

## 0. 拍板结论

| 项                   | 结论                                                  |
| -------------------- | ----------------------------------------------------- |
| 规格落点             | 新建本文件（无重名，不加日期后缀）                    |
| 缩放验收             | WCAG 1.4.4 与 1.4.10 **两条都做**，拆成两组独立用例集 |
| PWA / Service Worker | **不纳入本批**（平台挂账另行立项）                    |

## 1. 目标与范围

### 1.1 目标

把四条可访问性挂账一次性收口到「有护栏、可回归」的状态：

- **W1 键盘协议**：右键菜单可用键盘完整操作（打开→遍历→触发→关闭→焦点归还），
  菜单打开期间画布快捷键不穿透。
- **W2 对比度**：八组工具主题色（含 `ink`）在各自 soft 底上 ≥4.5:1（浅色/深色）。
- **W3 缩放与重排**：200% 页面缩放（720×450 有效视口）与 320px 重排下铬件不丢功能、
  不裁字、页面无二维滚动；刘海安全区生效。
- **W4 屏读**：画布有可访问名与说明、状态有播报、图标按钮有稳定可访问名、
  焦点顺序收敛（工具栏单 Tab 停靠）。

### 1.2 非目标（明确不做）

- 画布内容的元素级朗读（canvas 文本镜像/读屏游标）——需要独立的内容镜像层。
- PWA / Service Worker / 离线首开刷新。
- Linux 视觉基线（docs/13 §2 CI 挂账）。
- 协同 `editBlocked` 交互面矩阵（后置）。
- 宿主浮层（项目菜单/存储面板）的全局快捷键闸门——见 §13.5 开放项。
- 全量 px→rem 字号迁移（技术债，口径见 §3.2）。

## 2. 现状与证据

### 2.1 缺口清单

| #   | 位置                                                                                                                                                       | 现状（实测/读码）                                                              | 影响                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------- |
| E1  | [ContextMenu.tsx](../packages/react/src/components/ContextMenu.tsx) 128-137                                                                                | 容器无 `role`，项是可 Tab 的 button；129 行注释明说「协议未实现所以不设 role」 | 屏读不知道这是菜单；无方向键           |
| E2  | 同上 116-119                                                                                                                                               | 只做左右/上下翻转，无安全区、无纵向 clamp                                      | 450px 高度下可能越界（W3）             |
| E3  | [contextMenuService.ts](../packages/core/src/platform/contextMenu/contextMenuService.ts) 87-99                                                             | 外点关闭、Esc 关闭在 window 冒泡层；无焦点记录/归还                            | Esc 同时触发全局「清选区」（E4）       |
| E4  | [keyboardService.ts](../packages/core/src/platform/keyboard/keyboardService.ts) 46-56                                                                      | 闸门只判输入态，不判「菜单开着」                                               | 菜单开着按 Delete 删选中、按字母切工具 |
| E5  | [Toolbar.tsx](../packages/react/src/components/Toolbar.tsx) 128-133                                                                                        | `role=toolbar` 但 12+ 个按钮各自是 Tab 停靠点                                  | 键盘用户穿越工具坞要按 12 次 Tab       |
| E6  | [ToolFlyout.tsx](../packages/react/src/components/ToolFlyout.tsx) 60-77、[PopoverControl.tsx](../packages/react/src/components/PopoverControl.tsx) 117-125 | `role=menu` 但无方向键导航                                                     | 进入面板后只能 Tab，逐项穿越           |
| E7  | [ProjectMenu.tsx](../packages/app/src/ProjectMenu.tsx) 144-151                                                                                             | `role=menu`，打开聚焦首项，但无方向键                                          | 与 E6 同一协议缺口（跨包）             |
| E8  | [tokens.css](../packages/app/src/styles/tokens.css) 54-68 + [Toolbar.tsx](../packages/react/src/components/Toolbar.tsx) 89-99                              | 浅色下工具色对自身 soft 底 1.90–3.80                                           | 5/7 组低于 1.4.11 的 3:1（§6.1 实测）  |
| E9  | [index.html](../packages/app/index.html) 5                                                                                                                 | `viewport-fit` 缺失；全仓无 `env(safe-area-inset-*)`                           | 刘海/圆角设备上顶栏与底坞压安全区      |
| E10 | [App.tsx](../packages/app/src/App.tsx) 79-146                                                                                                              | 顶栏固定 44px，右组 5 个控件 + 存储按钮；320 下估算 436px                      | 1.4.10 直接红（§7.3）                  |
| E11 | [Board.tsx](../packages/react/src/components/Board.tsx) 82-89                                                                                              | `#stage-container` 无 role/无 tabIndex/无可访问名                              | 画布对屏读是「无名画布」               |
| E12 | [StorageStatusButton.tsx](../packages/app/src/StorageStatusButton.tsx) 122                                                                                 | 保存状态按钮自带 `aria-live=polite`                                            | 与 W4 播报器会双重播报                 |
| E13 | [ZoomControl.tsx](../packages/react/src/components/ZoomControl.tsx) 17-40、[App.tsx](../packages/app/src/App.tsx) 134-144                                  | 图标按钮只有 `title`，无 `aria-label`                                          | 可访问名依赖 title 回退，AT 兼容面窄   |
| E14 | [ReadOnlyNotice.tsx](../packages/app/src/ReadOnlyNotice.tsx) 12-16                                                                                         | `role=status` 容器里放两个按钮                                                 | live region 内含交互控件，播报语义混乱 |

### 2.2 已有护栏（必须保持绿）

- `a11y.spec.ts`：13 组令牌配对 × 浅/深 + 2 组实际元素，CSSOM 取色；测试里无颜色字面量。
- `mobile.spec.ts`：390×844 九面矩阵 M1–M9；M1 断言长 docId 胶囊**确实截断**
  （`scrollWidth - clientWidth > 0`）——这条是 W3 断点的硬约束。
- `coverage.spec.ts:477-484`：聚焦工具按钮按 Tab，焦点必须移走——W1 的 roving 不能破坏它。
- `toolbar.spec.ts:82`：`toHaveAccessibleName('椭圆 (R)')`——W4 加 `aria-label`
  必须逐字保留该串。
- 视觉 4/4 的 clip 均落在画布区（`canvasClip` 从 y=44 起），改顶栏/工具色不应触发重基线。

### 2.3 预判数据（实施时先跑红实测替换）

- 320px 顶栏固有宽度估算：左组品牌 28 + 词标 48 + 间距 20 + 胶囊最小 20 ≈ 116；
  右组存储 64 + 4×32 + 间距 32 = 288；内边距 32 → **≈436px**，超出 320 约 116px。
- 浅色工具主题色对 soft 底（floor 两位）：hand 2.42、shape 2.93、text 3.80、line 2.31、
  pen 2.67、sticky 1.90、mind 3.06；深色最低 4.89（text）——浅色 5 组红、深色全绿。

## 3. 验收口径

### 3.1 WCAG 映射

| 条目                     | 级别 | 本批对应                                    |
| ------------------------ | ---- | ------------------------------------------- |
| 1.4.4 Resize Text        | AA   | Z1/Z2（§7.1）                               |
| 1.4.10 Reflow            | AA   | R1（§7.2）                                  |
| 1.4.11 Non-text Contrast | AA   | W2（工具图标/选中态）                       |
| 2.1.1 Keyboard           | A    | W1（菜单开合、遍历、触发）                  |
| 2.4.3 Focus Order        | A    | W1 roving + W4 焦点顺序                     |
| 2.4.7 Focus Visible      | AA   | 沿用全局 `:focus-visible`，菜单项不额外自绘 |
| 4.1.2 Name, Role, Value  | A    | W1 菜单语义 + W4 可访问名                   |
| 4.1.3 Status Messages    | AA   | W4 播报器                                   |

### 3.2 1.4.4 的测试代理（重要）

浏览器页面缩放在 1440×900 上放大 200%，等价于 **720×450 CSS 视口、字号不变**。
因此 Z1 用 `viewport 720×450` 作为 1.4.4 的忠实代理（真实缩放时 CSS 尺寸不变，
只是视口减半）。补充 Z2：`html { font-size: 200% }` 只放大 rem 文本，覆盖
「用户调大默认字号」这一路径。

说明：仓内字号 px/rem 混用（`text-[13px]` 为 px，`text-xs` 为 rem）。页面缩放对两者
都生效；纯文本缩放只对 rem 生效。**1.4.4 的合规由 Z1 承担**，Z2 是补充护栏；
全量 rem 化列入技术债，不在本批（避免全仓样式回归）。

390×844 + 200% 不作为验收面：那不是 WCAG 口径，且移动端捏合缩放由 UA 处理。

### 3.3 1.4.10 的豁免边界

- **在范围内**：顶栏、工具坞、二级菜单、缩放胶囊、操作栏、项目菜单、存储面板、
  右键菜单、只读提示、空画布提示。
- **豁免**：`#stage-container`（白板/脑图是「必须二维布局才有意义」的内容）。
- **工具坞的内部横向滚动**：属于工具栏自身的可滚动区域，页面级仍断言无二维滚动；
  这在验收记录里写明，避免被读成「用内滚绕过 1.4.10」。
- 320×640 是主断言面（纵向滚动内容）；256px 高度只适用于横向滚动内容，不适用本应用。

### 3.4 断言的共同纪律

- 只用 `data-spinth-*` 稳定标记定位；不写 Tailwind class 选择器。
- 坐标一律 `boundingBox` + 实测，不手写视口常量（复用 `layoutE2e.ts`）。
- 先跑红并记录实测值（写回本文件 §13.4），再修。

## 4. 总体设计与文件地图

### 4.1 新增文件

| 文件                                           | 职责                                                    |
| ---------------------------------------------- | ------------------------------------------------------- |
| `packages/react/src/a11y/rovingFocus.ts`       | 纯函数：方向键→步进、跳过禁用、首尾、wrap               |
| `packages/react/src/a11y/rovingFocus.test.ts`  | 纯函数单测                                              |
| `packages/react/src/a11y/useRovingFocus.ts`    | DOM 契约 hook（容器级 keydown/focusin + 单一 Tab 停靠） |
| `packages/react/src/a11y/announcement.ts`      | 纯函数：状态快照差分 → 播报文案（或 null）              |
| `packages/react/src/a11y/announcement.test.ts` | 差分矩阵单测                                            |
| `packages/react/src/a11y/safeArea.ts`          | 安全区 inset 读取（四向，兜底 0）                       |
| `packages/react/src/a11y/safeArea.test.ts`     | 解析/兜底单测                                           |
| `packages/react/src/components/Announcer.tsx`  | 唯一 polite live region（sr-only）                      |
| `packages/app/e2e/a11yLayout.spec.ts`          | Z1/Z2/R1/S1 布局与缩放矩阵                              |
| `packages/app/e2e/a11yKeyboard.spec.ts`        | 菜单键盘协议 / 焦点顺序 / 可访问名                      |

### 4.2 修改文件（按包）

| 包    | 文件                                                        | 改动                                                                       |
| ----- | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| core  | `platform/keyboard/shortcuts.ts`                            | 新增纯函数 `shortcutGateAllows`（输入态 + 菜单态）                         |
| core  | `platform/keyboard/keyboardService.ts`                      | `isUiModalOpen` 注入点；filter 改调纯函数                                  |
| core  | `platform/contextMenu/contextMenuService.ts`                | `openFromKeyboard()`；Shift+F10 / Menu 键原生监听；`openAt` 收敛           |
| core  | `boardComposition.ts`                                       | 接线 `keyboard.isUiModalOpen`；构造顺序注释                                |
| core  | `boardCommands.ts` / `boardFacade.ts` / `boardPublicApi.ts` | 新增命令 `openContextMenuFromKeyboard` 并归类                              |
| react | `components/ContextMenu.tsx`                                | 语义、roving、焦点归还、安全区 clamp                                       |
| react | `components/Toolbar.tsx`                                    | roving（单 Tab 停靠）+ ink 令牌                                            |
| react | `components/ToolFlyout.tsx` / `PopoverControl.tsx`          | roving；Popover 关闭回焦触发钮                                             |
| react | `components/Board.tsx`                                      | `role=application`、可访问名、`tabIndex=0`、帮助文本、canvas `aria-hidden` |
| react | `components/ZoomControl.tsx` / `index.ts`                   | `aria-label`；导出 Announcer/hook                                          |
| app   | `index.html`                                                | `viewport-fit=cover`                                                       |
| app   | `src/index.css`                                             | 安全区变量；紧凑顶栏如需辅助类                                             |
| app   | `src/styles/tokens.css`                                     | 7 个 `--spinth-tool-*-ink`（浅色给值、深色别名）                           |
| app   | `src/App.tsx`                                               | 紧凑顶栏、安全区、`h1`、`Announcer`、可访问名                              |
| app   | `src/ProjectMenu.tsx`                                       | roving；安全区                                                             |
| app   | `src/StorageStatusButton.tsx` / `StoragePanel.tsx`          | 移除按钮 aria-live；安全区 clamp                                           |
| app   | `src/ReadOnlyNotice.tsx`                                    | `role=status` → `role=region`；安全区 top                                  |
| e2e   | `helpers/layoutE2e.ts`                                      | `COMPACT`/`ZOOM_200` 常量、`applySafeArea`、`assertNoTextClip`             |
| e2e   | `mobile.spec.ts`                                            | 390 基线不动（只加不改）                                                   |

### 4.3 依赖顺序

```
W2 对比度（独立）
W3 缩放/安全区（独立，先落几何）
W1 键盘（依赖 core 闸门 + roving 模块）
W4 屏读（依赖 W1 的 roving 与 stage 可聚焦）
```

铁律不变：不改 dataEngine/vmEngine；不新增依赖；写路径仍只经 Model→Yjs；
只是 DOM 语义与交互层改动。

## 5. W1 键盘与焦点协议

### 5.1 纯函数：rovingFocus.ts

```ts
export type RovingOrientation = 'vertical' | 'horizontal' | 'both';

/** 方向键 → 步进；非该方向的键返回 0（不拦截，交还浏览器/全局） */
export function stepForKey(key: string, orientation: RovingOrientation): -1 | 0 | 1;

/** 从 current 出发按 step 找下一个可用项；全禁用返回 -1；wrap=false 时到边界返回 -1 */
export function nextEnabledIndex(
  disabled: readonly boolean[],
  current: number,
  step: -1 | 1,
  wrap: boolean,
): number;

/** 首/尾可用项；全禁用返回 -1 */
export function edgeEnabledIndex(disabled: readonly boolean[], edge: 'first' | 'last'): number;
```

单测矩阵（≥9）：跳过禁用、跨分隔线、wrap 真/假、全禁用、current 越界、
`both` 接受四向、`vertical` 忽略左右、`horizontal` 忽略上下、Home/End。

### 5.2 Hook：useRovingFocus

```ts
export interface IUseRovingFocusOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  orientation: RovingOrientation;
  wrap?: boolean; // 默认 true
  autoFocus?: 'first' | 'last' | false; // 默认 false
  itemSelector?: string; // 默认 '[data-roving-item]:not([disabled])'
}
export function useRovingFocus(o: IUseRovingFocusOptions): {
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  onFocus: (e: React.FocusEvent<HTMLElement>) => void;
};
```

DOM 契约（写进注释，消费者必须遵守）：

1. 每个可聚焦项加 `data-roving-item`，JSX 初始 `tabIndex={-1}`；
2. hook 挂载后把唯一活动项设为 `tabIndex=0`（单 Tab 停靠）；
3. keydown 只处理本方向键 + Home/End，命中即 `preventDefault()` 并 `.focus()`；
4. `focusin` 冒泡到容器时更新活动项（鼠标点选后 Tab 停靠跟随）；
5. 容器内没有任何可用项时不做任何事（不抢焦点、不抛错）。

### 5.3 ContextMenu 语义与行为

```tsx
<div
  data-spinth-context-menu
  role="menu"
  aria-label={options.onWidget ? '元素操作' : '画布操作'}
  aria-orientation="vertical"
  ref={menuRef}
  onKeyDown={onKeyDown}
  onFocus={onFocus}
>
  <div role="separator" aria-hidden />
  <button data-roving-item tabIndex={-1} role="menuitem" />
</div>
```

行为契约：

| 事件            | 行为                                                                         |
| --------------- | ---------------------------------------------------------------------------- |
| 打开            | `useLayoutEffect` 聚焦首个非禁用项；记录 `document.activeElement` 为归还目标 |
| ArrowUp/Down    | 循环移动（跳过 disabled）；preventDefault                                    |
| Home/End        | 首/尾可用项                                                                  |
| Enter/Space     | 原生 click（button 语义，不自定义）                                          |
| Esc             | 关闭 + 归还焦点 + `stopPropagation()`（不再触发全局清选区）                  |
| Tab / Shift+Tab | 关闭 + 归还焦点到归还目标（**不**做焦点陷阱）                                |
| 点外部          | 关闭，**不**归还焦点（指针语义是去别处）                                     |
| 点菜单项        | 执行动作 → 关闭 → 归还焦点；异步动作（复制/剪切）在 `.then` 后归还           |

为什么 Tab 回焦而不是继续往页面下一个元素：菜单非模态、不做陷阱；React 卸载节点
的时机与浏览器默认 Tab 行为存在竞态，显式归还目标是确定性的（决策 D2）。

组件结构约束（实施容易踩）：当前 `ContextMenu` 在 `show=false` 时提前 return，
直接加 hook 会违反 hooks 顺序。必须拆成 `ContextMenu`（只判空、不调 hook）+
`ContextMenuPanel`（roving/焦点记录/归还全部在面板内）。同理，`useLayoutEffect`
的首项聚焦与 `returnFocusRef` 记录都放在 Panel 的挂载路径上，关闭路径统一走
`closeAndRestore()`，避免四条关闭路径各写一份归还逻辑。

### 5.4 焦点归还矩阵

| 打开方式            | 打开时焦点          | 关闭方式         | 归还目标                               |
| ------------------- | ------------------- | ---------------- | -------------------------------------- |
| 指针右键            | 原焦点（常为 body） | Esc / 选项 / Tab | `#stage-container`（W4 前退化为 body） |
| 指针右键            | 原焦点在某按钮      | 同上             | 该按钮（若仍 connected）               |
| Shift+F10 / Menu 键 | 画布/stage          | 同上             | stage                                  |
| 任意                | 任意                | 点外部           | 不归还（浏览器把焦点交给点击目标）     |

实现：打开时 `returnFocusRef.current = document.activeElement`；归还是
`isConnected && !== document.body` 才用，否则 `stage`。归还后若 stage 不存在，静默跳过。

### 5.5 菜单期快捷键闸门（core）

现状：右键菜单开着时焦点在 body，hotkeys 照常命中——Delete 会删掉菜单背后的选中，
字母会切工具（E4）。修复放在**唯一闸门**（filter），不做 React 捕获层吞键：

```ts
// shortcuts.ts
export interface IShortcutGateInput {
  editableAtCapture: boolean;
  uiModalOpen: boolean;
  target: EventTarget | null;
  key: string;
}
export function shortcutGateAllows(input: IShortcutGateInput): boolean;
```

规则（顺序即优先级）：输入态 → false；菜单开着 → false；单独修饰键 → true；其余 true。

```ts
// keyboardService.ts
isUiModalOpen: () => (boolean = () => false);
// ...
hotkeys.filter = (event) =>
  shortcutGateAllows({
    editableAtCapture: this.editableAtCapture,
    uiModalOpen: this.isUiModalOpen(),
    target: event.target,
    key: (event.key ?? '').toLowerCase(),
  });
```

组合根（`boardComposition.ts`，紧跟 `isBlocked` 接线之后）：

```ts
sdk.keyboard.isUiModalOpen = () => sdk.contextMenu?.options$.value.show ?? false;
```

构造顺序约束：`contextMenu`（324 行）先于 `keyboard`（338 行），闭包引用安全；
该顺序已有注释，补一句「晚于 contextMenu 构造」。

注意：`filter` 只挡 hotkeys 快捷键；菜单自身 keydown 在 React 根上先跑，
方向键/Enter/Tab 不依赖它。Esc 双路径：菜单 stopPropagation 后 service 的 window
监听收不到；若焦点意外在外，service 兜底关闭（幂等）。

### 5.6 键盘打开路径

没有键盘打开路径，键盘协议只有一半。设计：

- 在 `ContextMenuService.initialize()` 增加原生 capture 监听（不塞进 hotkeys，
  规避 `ContextMenu` 键名兼容问题）：

```ts
const onKeyOpen = (e: KeyboardEvent): void => {
  if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
  if (isEditableTarget(e.target)) return;
  e.preventDefault();
  this.openFromKeyboard();
};
window.addEventListener('keydown', onKeyOpen, true);
```

- `openFromKeyboard()`：
  1. 只读（`!viewport.editable$`）→ 画布菜单：视口中心、`onWidget=false`、
     `canPaste=false`（与右键只读分支同语义，docs/21 §4）；
  2. 可写且有选中 → 选中世界外接矩形中心 → `viewport.worldToClient(center)` 作为屏幕锚点，
     `onWidget=true`，`canPaste=hasClipboard()`；
  3. 可写无选中 → `viewport.getPageBounds()` 中心 → `worldToClient` 中心、
     `onWidget=false`。
- 公开面：新增命令 `openContextMenuFromKeyboard()`（命令类，加入
  `BOARD_PUBLIC_MEMBERS` 的「命令」区，编译期分类锁必须绿）；react
  `spinthCommands.openContextMenuFromKeyboard()` 转发。
- 不改 `contextMenuOptions$` 形状（仍是 `show/x/y/onWidget/canPaste`），
  桥与既有测试零改动。

写进 docs/09 §2 快捷键表：`shift+f10 / menu` 打开右键菜单（只读可用，菜单为画布菜单）。

### 5.7 其它消费者（同一 hook）

| 组件                | orientation | autoFocus | wrap  | 备注                                       |
| ------------------- | ----------- | --------- | ----- | ------------------------------------------ |
| Toolbar             | horizontal  | false     | false | 工具坞单 Tab 停靠；方向键在按钮间移动      |
| ContextMenu         | vertical    | first     | true  | 焦点矩阵见 5.3                             |
| ToolFlyout          | both        | false     | true  | 常驻面板，Tab 进入后方向键生效             |
| PopoverControl 面板 | both        | false     | true  | 关闭（选项/外点/Esc）归还触发钮            |
| ProjectMenu         | vertical    | first     | true  | 删除本地「聚焦首项」effect，改由 hook 承担 |

ProjectMenu 在 app 包：`useRovingFocus` 经 `@spinth/react` 导出（新增公共导出，
不是 SDK 公共面，不受 allowlist 约束）。

### 5.8 测试计划

core（+6~8）：

- `shortcutGateAllows` 真值表 5 例；
- `ContextMenuService.openFromKeyboard`：只读→画布菜单/无选中→中心/有选中→onWidget
  （jsdom + viewport 桩，`worldToClient` 返回固定值）；
- Shift+F10 监听：命中开菜单、输入态不开、Menu 键同样；
- 只读下 canPaste 恒 false。

react（+20）：

- `rovingFocus` 纯函数 9 例；
- ContextMenu：打开聚焦首项、方向键跳过禁用、Esc 关闭并回焦、Tab 关闭、点外部不回焦；
- Toolbar：仅一个 `tabIndex=0`，方向键移动，禁用项跳过；
- ProjectMenu/ToolFlyout/Popover：各 1 例方向键。

E2E（+4~5，`a11yKeyboard.spec.ts`）：

1. 右键 → ArrowDown ×2 → Enter（选中可观测项）→ 断言命令生效 + 菜单关闭；
2. 右键 → Esc → 断言菜单消失、选区仍在（证明全局清选区未触发）、焦点回 stage；
3. 焦点在 stage → Shift+F10 → 菜单出现、首项聚焦；
4. 菜单开着按 Delete → 选中仍在（闸门）；
5. Tab 序列：header → stage → toolbar（单停靠）→ zoom，中间不出现 12 个工具按钮。

### 5.9 风险

- **role=application 未做前**，焦点归还目标为 body；顺序上 W1 先给 stage 加
  `tabIndex=0`（W4 再补 role/aria），避免中间态难看。
- 闸门全静默会挡 Cmd+Z：接受（菜单内容基于打开瞬间的选中集，撤销会让菜单指向已删元素）。
- `coverage.spec.ts` 的 Tab 断言：roving 后从按钮 Tab 仍会移出工具坞 → 绿。

## 6. W2 工具主题色对比度

### 6.1 实测（floor 两位，当前值）

| 组                                   | 浅色 fg/soft | 深色 fg/soft |
| ------------------------------------ | ------------ | ------------ |
| ink（`text-ink` / `surface-active`） | 14.11        | 8.59         |
| hand                                 | 2.42 ✗       | 6.06         |
| shape                                | 2.93 ✗       | 5.80         |
| text                                 | 3.80         | 4.89         |
| line                                 | 2.31 ✗       | 6.19         |
| pen                                  | 2.67 ✗       | 5.98         |
| sticky                               | 1.90 ✗       | 7.00         |
| mind                                 | 3.06         | 5.39         |

浅色 5 组低于 3:1；深色全绿。`text`/`mind` 虽过 3:1，但见 §6.3 的 4.5 理由。

### 6.2 令牌设计：按角色拆分（沿用 `danger-ink` 先例）

新增 7 个 `--spinth-tool-*-ink`，语义 = **soft 底上的前景（图标/文字）**；
原 `--spinth-tool-*` 保留 = 图形/色点/幽灵预览/画布相关用色。

浅色提案（已算 floor，均 ≥4.65）：

| 令牌   | 现值（图形） | 新 ink  | 对 soft 比 |
| ------ | ------------ | ------- | ---------- |
| hand   | #e8843c      | #a9571a | 4.65       |
| shape  | #3e8bff      | #1a63cc | 5.02       |
| text   | #7c5cfc      | #5b3ad6 | 6.04       |
| line   | #0fb5a6      | #08786d | 4.82       |
| pen    | #2fa96e      | #1b7047 | 5.44       |
| sticky | #efa424      | #8f6200 | 4.87       |
| mind   | #e0559c      | #b03574 | 5.05       |

深色：现值已 ≥4.89，`-ink` 直接别名现值（单源，避免两份色值漂移）：

```css
[data-theme='dark'] {
  --spinth-tool-hand-ink: var(--spinth-tool-hand);
  /* ... 7 组 */
}
```

`index.css` 的 `@theme inline` 同步 7 行 `--color-tool-*-ink`（否则工具类扫不到）。

### 6.3 为什么阈值是 4.5 而不是 3

`ToolFlyout` 的选中项用 `activeClass`（即 `bg-tool-*-soft text-tool-*`），其中形状变体
里有纯文本项（字号数字）。图标只需 3:1（1.4.11），但**文字**需要 4.5:1（1.4.3）。
统一按 4.5 定值，避免「图标过、文本不过」的角色分裂。

应用点：`Toolbar.tsx` 的 `TONE_ACTIVE` 八个条目改 `text-tool-*-ink`（ink 组不变）。
`ToolFlyout` 通过 `activeClass` 自动继承。`MindAddButtons` 的 `text-tool-mind`
在 surface 上为 3.53（≥3，图标），保持现值不动；`ToolGhost` 是画布上的大尺寸预览，
保持现值（非本批验收面，记入 §13.5）。

### 6.4 护栏

1. `a11y.spec.ts` 的 `TOKEN_PAIRS` 增加 8 组 ×（浅/深）：每组 `fg=--spinth-tool-*-ink`、
   `bg=--spinth-tool-*-soft`、`min=4.5`；ink 组 `fg=--spinth-text-1`、
   `bg=--spinth-surface-active`。
2. 元素面 2 例：激活工具按钮（`[data-spinth-toolbar] button[aria-pressed="true"]`）与
   flyout 选中项（`[role="menuitemradio"][aria-checked="true"]`）取计算样式，证明类名接对了
   （令牌对只能证明色值，证明不了用法）。
3. 先红：先加配对，旧令牌下 5 组红并记录实测；再改令牌转绿。

### 6.5 测试

- 无新增单测（颜色是 CSS 变量，纯逻辑无意义）；
- E2E：a11y.spec 仍 6 例（循环内配对增加，用例数不变）；
- 视觉：clip 只在画布，工具坞激活色变化不进基线；仍须跑 4/4 确认。

## 7. W3 缩放、重排、安全区

### 7.1 1.4.4 矩阵（Z1/Z2）

**Z1 = 720×450（页面缩放 200% 的代理）**，每面断言「四边在视口内 + 可操作 +
文字不裁」：

| 面                  | 断言                                                      |
| ------------------- | --------------------------------------------------------- |
| 顶栏                | 所有按钮 ≥24×24、可访问名非空、胶囊截断不撑高；无横向裁切 |
| 工具坞              | 坞内可横滚、按钮 40×40、坞四边在视口                      |
| 二级菜单（r 激活）  | 面板四边在视口（pad 8）、顶边 ≥ 顶栏下缘                  |
| 缩放胶囊            | 在视口内、与坞不重叠                                      |
| 右键菜单            | 在视口内（含贴底翻转 + clamp）                            |
| 项目菜单 / 存储面板 | 在视口内、`maxHeight` 生效、内部可滚、底部不越界          |
| 操作栏              | 选中一个形状后四边在视口内                                |
| 空画布提示          | 不越界（A3 已修，回归）                                   |

**Z2 = 1440×900 + `html{font-size:200%}`**：只断言 rem 文本面——顶栏按钮可访问名、
菜单项高度随 rem 增长后不裁字（`assertNoTextClip`）、坞仍可横滚且不压出视口。
写明这是补充护栏，不是 1.4.4 的主证据。

### 7.2 1.4.10 矩阵（R1 = 320×640）

| 用例          | 断言                                                            |
| ------------- | --------------------------------------------------------------- |
| R1-a 顶栏     | 6 个控件全部可见、无裁切、宽度和 ≤320；胶囊截断；header 高度 44 |
| R1-b 工具坞   | 坞四边在视口、内部横滚、**页面**无横滚（`noDocHScroll`）        |
| R1-c 面板     | 项目菜单/存储面板宽 ≤304、四边在视口、内部纵向可滚              |
| R1-d 右键菜单 | 贴右/贴底打开时仍在视口内（翻转 + clamp）                       |
| R1-e 操作栏   | 选中形状后不越界（既有多选/操作栏回归）                         |

### 7.3 紧凑顶栏（320 的修法）

预算：320 − 内边距 16 − 右组（存储 24 + 4×32 + 间距 16 = 168）− 品牌 28 − 间距 8
≈ 100px 留给 docId 胶囊 → 够截断显示。

`max-[379px]` 触发（**不是** 419）：M1 在 390 断言胶囊 `scrollWidth > clientWidth`，
断点一旦覆盖 390，胶囊不再溢出，A3 基线立刻漂。379 保证 390 及以上的现状逐像素不变。

| 元素              | 390 及以上  | <380                                                    |
| ----------------- | ----------- | ------------------------------------------------------- |
| header 水平内边距 | `px-4`      | `px-2`                                                  |
| 右侧按钮组间距    | `gap-2`     | `gap-1`                                                 |
| 词标「spinth」    | 显示        | 隐藏（品牌图保留）                                      |
| 存储按钮          | 圆点 + 文本 | 仅圆点（`px-1.5`；`aria-label` 已含状态）               |
| docId 胶囊        | 截断        | 截断 + `title={docId}` + `aria-label={'文档 ' + docId}` |

实现用 Tailwind 任意变体（`max-[379px]:hidden` 等），不写媒体查询散落各处。
选择「压缩 + 保留全部功能」，而不是隐藏「复制链接/新建」，因为 1.4.10 不接受功能丢失。

### 7.4 安全区令牌

`index.html`：`<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />`。

`index.css` 的 base 层：

```css
:root {
  --spinth-safe-top: env(safe-area-inset-top, 0px);
  --spinth-safe-right: env(safe-area-inset-right, 0px);
  --spinth-safe-bottom: env(safe-area-inset-bottom, 0px);
  --spinth-safe-left: env(safe-area-inset-left, 0px);
}
```

为什么用自定义属性包一层：E2E 无法伪造 `env()`，但可以覆盖这层变量
（`page.addStyleTag`），从而在 CI 里真实断言安全区行为。

| 组件              | 改动                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| header            | `h-[calc(2.75rem+var(--spinth-safe-top))] pt-[…]`、左右内边距同法（0 时仍 44，M1 不回归）                            |
| 工具坞            | `bottom-[calc(1.25rem+var(--spinth-safe-bottom))]`；`max-md` 的 5rem 同法                                            |
| 缩放胶囊          | bottom/right 同上                                                                                                    |
| 只读提示          | `top-[calc(0.75rem+var(--spinth-safe-top))]`                                                                         |
| 项目菜单/存储面板 | JS 读取 inset：`maxHeight = calc(100dvh - top - 8px - safeBottom)`，宽度 `min(320px, 100vw-16px-safeLeft-safeRight)` |
| 右键菜单          | 翻转/夹取把 inset 计入（见 7.5）                                                                                     |
| 操作栏            | 左右夹取 `8 + safeLeft/Right`                                                                                        |

新增 `packages/react/src/a11y/safeArea.ts`：`readSafeInsets()` 读 computed style，
返回四向数值（无 CSS 环境/解析失败一律 0）；供 ActionBar/ContextMenu 的 JS 定位用。
纯函数部分（解析/兜底）单测 3 例。

### 7.5 右键菜单 clamp（同时服务 450 高与 320 宽）

`ContextMenu` 现在的翻转在 450px 高度下可能仍然越界（菜单高 ≈ 7×34+分隔+12 ≈ 289）。
改为四面夹取：

```ts
const inset = readSafeInsets();
const minX = inset.left + 8;
const maxX = window.innerWidth - inset.right - 8 - MENU_W;
const minY = inset.top + 8;
const maxY = window.innerHeight - inset.bottom - 8 - menuH;
const left = clamp(flipX ? x - MENU_W : x, minX, Math.max(minX, maxX));
const top = clamp(flipY ? y - menuH : y, minY, Math.max(minY, maxY));
```

`maxY < minY`（菜单比可视区高）时取 `minY` 并允许菜单自身
`max-h-[calc(100dvh-16px)] overflow-y-auto`。这同时把 1.4.4 的 450 高场景收口。

### 7.6 用例与 helper

`helpers/layoutE2e.ts` 新增：

```ts
export const COMPACT = { width: 320, height: 640 } as const;
export const ZOOM_200 = { width: 720, height: 450 } as const;
export async function applySafeArea(
  page: Page,
  inset: Partial<{ top: number; right: number; bottom: number; left: number }>,
): Promise<void>;
export async function assertNoTextClip(locator: Locator): Promise<void>; // scrollWidth<=clientWidth+1 且 scrollHeight<=clientHeight+1
```

`assertNoTextClip` 的边界：只看「不应滚动」的叶子文本容器（顶栏标签、菜单项、
面板行）；工具坞/面板这类显式滚动容器排除，否则会误红。

用例文件 `a11yLayout.spec.ts`（独立 `test.use`，避免污染 mobile.spec 的 390）：
Z1 2 例（壳层+面板 / 菜单+操作栏）、Z2 1 例、R1 3 例（壳层 / 坞+面板 / 菜单+操作栏）、
S1 2 例（竖屏 notch / 横屏左右 inset）。合计 8 例。

### 7.7 风险

- 顶栏 calc 高度写错 → M1 44px 立即红，属于好红。
- 断点覆盖 390 → M1 截断断言红；已用 379 规避，实施后必须跑 mobile.spec。
- 安全区变量在桌面为 0；任何「只在 env 有值时才正确」的写法都会在 CI 绿、真机红，
  所以 S1 必须覆盖注入路径，而不是只断言默认 0。
- iOS 真机行为（`visualViewport`、动态工具栏）不在 CI 范围，只做桌面 Chromium 的
  CSS 行为断言；真机验收写进人工清单（§8.7）。

## 8. W4 屏读与语义

### 8.1 语义地图

| 区域        | 语义                                               | 可访问名                    | 状态                              |
| ----------- | -------------------------------------------------- | --------------------------- | --------------------------------- |
| 页面标题    | `h1`（sr-only）                                    | spinth 白板                 | —                                 |
| 顶栏        | `header`（banner）                                 | —                           | —                                 |
| 主区        | `main`                                             | 画布区域                    | —                                 |
| 画布宿主    | `role=application` + `aria-roledescription="白板"` | 白板画布                    | `aria-describedby` 指向快捷键说明 |
| 画布 canvas | `aria-hidden="true"`                               | —                           | 纯渲染面                          |
| 工具坞      | `role=toolbar`（已有）                             | 画板工具                    | roving 单停靠                     |
| 菜单/面板   | `role=menu` / `dialog`（已有）                     | 元素操作/画布操作/项目/存储 | roving                            |
| 播报器      | `role=status` `aria-atomic`（sr-only）             | —                           | 见 8.3                            |

### 8.2 画布：为什么用 application

本应用把单字母键（v/r/t/l/p/e/s/m）作为工具快捷键、方向键微移、Esc 取消。
`role=application` 让屏读把按键透传给应用；`role=group` 下这些键在浏览模式下会被
读屏吞掉（用户必须先切模式）。代价是**必须提供退出路径与说明**：

- `tabIndex=0`，Tab 进入、Tab 离开；
- `aria-describedby` 指向 sr-only 帮助：方向键微移（Shift 10px）、V/H/R/T/L/P/E/S/M
  切换工具、Cmd/Ctrl+Z 撤销、Delete 删除、Esc 取消、Shift+F10 打开菜单、Tab 离开；
- 人工 VoiceOver 验收（§8.7）不通过则回退 `role=group` + 保留帮助文本（决策 D8）。

画布内容替代文本的分层（对应挂账里「画布内容替代文本」一项）：
容器名 = 「白板画布」；加载完成播报「画布已加载，N 个元素」；选中变化播报
「已选中 N 个元素」；菜单/工具变更各自播报。**元素级文本朗读**（把画布里的文字
逐条读出来）需要内容镜像层，明确不在本批（§13.5 第 2 条），避免用一句静态
aria-label 假装覆盖。

### 8.3 播报器

纯函数（可单测）：

```ts
export interface IAnnouncementSnapshot {
  docState: DocState;
  modelCount: number;
  selectedCount: number;
  cursorMode: CursorMode;
  persistState: 'saved' | 'saving' | 'failed';
  editable: boolean;
}
/** 只对「有意义的跃迁」出文案；返回 null 表示不播报 */
export function announcementFor(
  prev: IAnnouncementSnapshot,
  next: IAnnouncementSnapshot,
): string | null;
```

| 跃迁                        | 文案                         |
| --------------------------- | ---------------------------- |
| `docState → synced`（首次） | 画布已加载，N 个元素         |
| `selectedCount` 变化        | 已选中 N 个元素 / 已取消选择 |
| `cursorMode` 变化           | 当前工具：矩形               |
| `persistState → failed`     | 保存失败，可在顶栏重试       |
| `failed → saved`            | 已恢复保存                   |
| `editable true→false`       | 此画布已切换为只读           |
| `editable false→true`       | 此画布已恢复可编辑           |

组件 `Announcer.tsx`：

- 挂载一个 sr-only `role="status" aria-atomic="true" data-spinth-announcer`；
- 订阅 store 六字段，用 `useRef` 存上一快照，effect 里调纯函数；
- 200ms 防抖（合并连续选中变化）；同一文案重复时先清空再置入（保证二次播报）；
- 组件全程在 DOM 里（live region 必须先存在才能播报）。

去重：**移除** `StorageStatusButton` 的 `aria-live`（按钮名仍含「已保存/保存中/失败」，
聚焦时读到当前态）；`ReadOnlyNotice` 改 `role=region aria-label=只读提示`，由播报器
在 `editable` 跃迁时播报。`OfflineBar`/`ErrorState` 的既有 `role=status/alert` 保留。

### 8.4 可访问名收口

| 控件            | 现状                  | 改为                                                              |
| --------------- | --------------------- | ----------------------------------------------------------------- |
| 主题切换        | title only            | `aria-label` = 同 title                                           |
| 工具坞 12 钮    | title（含快捷键提示） | `aria-label` 逐字保留 title 文案（`toolbar.spec` 的名称断言不变） |
| 缩放三钮        | title only            | `aria-label`：缩小 / 适应屏幕（当前 N%）/ 放大                    |
| 导入 file input | 无                    | `aria-label="导入项目文件"`，保持 `hidden`（不进 Tab）            |
| docId 胶囊      | 纯文本                | 加 `title` + `aria-label`（非交互，不加 role）                    |

E2E 护栏：对 `header button, [data-spinth-toolbar] button, [data-spinth-zoom] button,
[data-spinth-action-bar] button, [data-spinth-tool-flyout] button` 逐个
`toHaveAccessibleName(/\S/)`。

### 8.5 焦点顺序契约

DOM 顺序（同步后）：顶栏 5 钮 → 画布（stage，1 停靠）→ 工具坞（1 停靠）→ 缩放 3 钮
→ 操作栏（选中时）→ 脑图 +/−（有焦点时）→ 只读提示按钮（follower）→ 离线条（不可聚焦）。

断言：

1. 打开页面后 Tab 8 次内到达 `[data-spinth-stage]`；
2. 工具坞只占 1 个停靠（遍历时连续两次 `document.activeElement` 不在坞内）；
3. 菜单关闭时 `[role=menuitem]` 数量为 0（不留在 Tab 序）；
4. 菜单打开时方向键在项间移动、Tab 后焦点离开菜单。

### 8.6 表单与隐藏控件

全仓仅一个 `input[type=file]`（导入），视觉隐藏、由菜单项触发。加 `aria-label` 后，
「表单标签」项以「无可见表单控件」记录，不留空口说白话。

### 8.7 自动化边界 + 人工清单

CI 能证：语义属性、可访问名、焦点移动、live region 文案、Tab 序。
CI 不能证：真实读屏的播报质量。人工清单（写在本文件，不进 docs）：

| #   | 步骤（macOS VoiceOver） | 预期                                          |
| --- | ----------------------- | --------------------------------------------- |
| M1  | 打开画布，VO 读页面     | 先报「spinth 白板」标题与「画布区域」landmark |
| M2  | Tab 到画布              | 报「白板画布，application」+ 帮助摘要         |
| M3  | 选中两个形状            | 200ms 内播报「已选中 2 个元素」               |
| M4  | Shift+F10               | 菜单打开，「元素操作，菜单」，首项聚焦        |
| M5  | ↓↓ Enter                | 执行对应命令并播报结果（若命令有状态变化）    |
| M6  | Esc                     | 菜单关闭，焦点回到画布；选区仍在              |
| M7  | 模拟存储失败            | 播报「保存失败，可在顶栏重试」                |
| M8  | 打开项目菜单            | 「项目，菜单」，首项聚焦，方向键可达          |

## 9. 实施顺序

每步独立提交、独立可回退；每步先跑红留证据（实测值回填 §13.4）。

**Step 0 基线**：`pnpm verify` +
`npx playwright test --grep-invert "@timing|@bench|@visual"` 全绿，记录 909 单测 / 186 用例。

**Step 1 · W2 对比度**（最小闭环）

1. a11y.spec 加 8 组配对 + 2 元素面 → 红，记录 5 组比值；
2. tokens.css 加 7 个 ink + index.css 映射 + TONE_ACTIVE 切换 → 绿；
3. `npx playwright test packages/app/e2e/a11y.spec.ts`；确认视觉 4/4。

提交：`feat: 工具主题色按角色拆 ink 令牌（soft 底 4.5:1 护栏）`

**Step 2 · W3 缩放/重排/安全区**（几何风险前置）

1. 先写 `a11yLayout.spec.ts` 的 R1-a/R1-b 并跑红，记录 320 顶栏实测宽度；
2. 紧凑顶栏 + 安全区变量 + meta + clamp；
3. 补 Z1/Z2/S1 用例 → 全绿；跑 `mobile.spec`（M1 必须绿）、`toolbar.spec`。

提交：`feat: 320 重排与 200% 缩放收口（紧凑顶栏/安全区/浮层夹取）`

**Step 3 · W1 键盘**

1. 写 roving 纯函数单测（先红）→ 实现；写 gate 真值表（先红）→ 实现；
2. 接 ContextMenu + Toolbar + 三个菜单消费者；
3. 接键盘打开（service + 命令 + allowlist 分类锁）；
4. core/react 单测绿 → 写 `a11yKeyboard.spec.ts`；
5. 跑 `coverage.spec`（Tab 断言）与 `toolbar.spec`。

提交：`feat: 右键菜单键盘协议与菜单期快捷键闸门（roving focus）`

**Step 4 · W4 屏读**

1. Board 语义 + Announcer 纯函数单测 → 组件；
2. 可访问名收口 + 移除按钮 aria-live + 只读提示 role；
3. E2E：焦点顺序 / 名称扫描 / 播报文案；
4. 人工清单过一遍（本机 VoiceOver），结果写回本文件。

提交：`feat: 画布语义与状态播报（屏读巡检收口）`

**Step 5 · 文档**：按 §11 同步；`pnpm verify`；更新 §13.4 实测记录。

## 10. 测试与基线（预估）

| 层         | 现有          | 本批增量           | 预计           |
| ---------- | ------------- | ------------------ | -------------- |
| core 单测  | 883           | +6~8               | ~890           |
| react 单测 | 26            | +24~28             | ~52            |
| 合计单测   | 909           | +30~36             | ~942           |
| E2E 用例   | 186 / 20 spec | +12~13             | ~199 / 22 spec |
| 视觉       | 4/4           | 0（clip 只含画布） | 4/4            |

跑法：`pnpm verify`；交互面补
`npx playwright test --grep-invert "@timing|@bench|@visual"`；
视觉单独 `npx playwright test --grep "@visual"`（本地，darwin 基线）。
最终数字以实跑为准，写进 docs/15 与本文件 §13.4。

## 11. 文档同步清单

| 文件                 | 位置              | 写什么（当前事实口吻）                                           |
| -------------------- | ----------------- | ---------------------------------------------------------------- |
| docs/09              | §2 filter 闸门    | 菜单打开时快捷键全静默；Shift+F10/Menu 打开菜单                  |
| docs/12              | §4 组件清单       | Announcer（唯一 polite live region）、roving 焦点协议、菜单语义  |
| docs/12              | §5 令牌           | 7 个 tool-ink + 四条安全区变量；配对计数 13 → 21                 |
| docs/12              | §7 app 壳         | 紧凑顶栏断点（<380）与安全区落点                                 |
| docs/13              | §2 P2 UI/可访问性 | 四项勾掉；§3 删除「可访问性挂账」，保留 PWA/协同/Linux           |
| docs/15              | §2 基线           | 单测/用例/spec 数；a11y 专项加「菜单键盘 / 缩放重排 / 播报」一行 |
| docs/21              | §4 只读面         | 只读下 Shift+F10 打开画布菜单（键盘路径）                        |
| AGENTS.md            | 当前状态          | 测试数、下一阶段表述（剩 PWA 与 Linux 基线）                     |
| specs/a11y-mobile.md | §14               | 挂账承接改指本文件（一行交叉引用）                               |

`docs/` 不写验收步骤与人工清单；人工清单只在本文件 §8.7。

## 12. 风险与回滚

| 风险                        | 概率 | 影响 | 缓解                                   |
| --------------------------- | ---- | ---- | -------------------------------------- |
| role=application 读屏体验差 | 中   | 高   | 人工清单 M2；回退 group + 帮助文本     |
| roving 改变既有 Tab 行为    | 中   | 中   | coverage.spec Tab 断言 + 手工穿越      |
| 320 断点误伤 390            | 低   | 高   | 断点 379；M1 必跑                      |
| 安全区 calc 写错顶栏高度    | 低   | 中   | 默认 0 时仍 44；M1 护栏                |
| 工具 ink 色偏离品牌观感     | 中   | 低   | 仅改 soft 底前景；图形色不动；视觉复核 |
| 播报过噪                    | 中   | 中   | 200ms 合并 + 跃迁表 + 人工试听         |
| allowlist 分类锁红          | 低   | 低   | 新命令显式归「命令」区，tsc 立即报     |
| 菜单闸门挡掉预期快捷键      | 低   | 低   | 决策 D3 记录；菜单内可用菜单项完成     |

回滚：四个 W 各自独立提交；W2 回滚 = tokens/index.css/Toolbar；W3 回滚 = 样式/meta + 1 spec；
W1 回滚 = 菜单组件 + core 4 文件；W4 回滚 = 语义属性 + 播报组件。无数据格式变更，无需迁移。

## 13. 设计审查

### 13.1 约束检查

| 约束                     | 结论                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| 数据流铁律（只写 Yjs）   | 本批不碰写路径；菜单项仍走既有命令                                                 |
| 接口先行                 | 新契约先定在 `shortcuts.ts` / `rovingFocus.ts` / `announcement.ts`，均带纯函数单测 |
| 单文件 < 400 行          | ContextMenu 171 → 预计 ~230；Toolbar 210 → ~235；Announcer < 80                    |
| 不改 dataEngine/vmEngine | 成立                                                                               |
| 无新依赖                 | 成立（不引 testing-library / floating-ui）                                         |
| 单机优先                 | 成立（无网络/账号路径）                                                            |
| 公共 API 收口            | 只加 1 条命令并归类；不改流形状                                                    |

### 13.2 决策台账

| #   | 决策                                                    | 理由                                                        | 被否的替代                       |
| --- | ------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| D1  | 共享 roving 纯函数 + hook，五个消费者                   | 同一协议重复五次必然漂移                                    | 只在 ContextMenu 内联            |
| D2  | Tab 关闭菜单并显式回焦，不做焦点陷阱                    | 菜单非模态；卸载时机 vs 默认 Tab 有竞态                     | 让浏览器自然 Tab（不确定）       |
| D3  | 菜单开着时**全部**快捷键静默                            | 菜单内容基于打开瞬间的选中集，撤销/删除会让它指向已失效对象 | 只挡无修饰键                     |
| D4  | 闸门放 core filter（注入 predicate），不放 React 捕获层 | hotkeys 挂 document，捕获层吞键依赖事件顺序，脆             | window capture + stopPropagation |
| D5  | 工具 ink 统一 4.5                                       | flyout 选中项含文字，图标 3:1 不够                          | 3:1（会留下文字红）              |
| D6  | 只加 `-ink`，不改原 tool 色                             | 原色还承担图形/幽灵/色点语义，改动面大且破坏「点亮」隐喻    | 全局调暗工具色                   |
| D7  | 320 用紧凑顶栏而非隐藏按钮                              | 1.4.10 不接受功能丢失                                       | 窄屏隐藏次要按钮                 |
| D8  | 画布用 role=application                                 | 单字母键 + 方向键需要透传；group 会被浏览模式吞             | group（保留为回退）              |
| D9  | 播报器唯一 live region，移除按钮上的 aria-live          | 双 live region 会重复播报                                   | 保留按钮播报                     |
| D10 | 1.4.4 用 720×450 页面缩放代理                           | 等价变换；390+200% 不是 WCAG 口径                           | 只测 390 下 200%                 |

### 13.3 复审修正（写稿过程中改掉的）

1. 紧凑断点初定 419 → 改为 **379**：390 的 M1 依赖胶囊截断，419 会让基线漂。
2. 工具 ink 初定 3:1 → 改 **4.5**：flyout 选中项有文本。
3. 闸门初版想做成「只挡无修饰键」→ 改**全静默**：Cmd+Z 会让菜单指向已删元素。
4. 键盘打开初版塞进 hotkeys → 改 service 原生监听：`ContextMenu` 键名在 hotkeys 的
   映射不可靠，且 capture 顺序可控。
5. ProjectMenu 初版排除在共享 hook 外 → 纳入：它已有 `role=menu` 却无方向键，
   属于同一协议缺口，改动是纯增量。
6. 初版给菜单加 focus trap → 否掉：非模态，会让 Tab 无法离开。

### 13.4 实施记录

2026-10-25 实施完成，六步提交：867cb13 规格入库（含全仓「工具音色」→「工具主题色」
术语修正）→ edf26ab W2 → 410fe7d W3 → 1c8c6c7 W1 → 32b8917 W4 → 文档提交。
每步独立提交、每步 `pnpm verify` 全绿。

| 项                      | 实测/结论                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 320 顶栏（修前/修后）   | 修前：顶栏不横溢但 docId 胶囊被 min-w-0 压到 **20px**（信息丢失型红，比预估 436px 溢出更隐蔽）；项目菜单左缘 **-40px** 越界。修后（紧凑顶栏 + 左缘钳制）：R1-a/R1-b/R1-c 绿，胶囊 ≥60px 可读 + 截断                                                                                                                       |
| 200% 缩放首个红项       | Z1-b 右键菜单底边越界 2px（menuH 估算漏上下边框各 1px）；R1-a 紧凑存储按钮 18px < 24（触控目标）；另 Z2/S1 首版把 `test.use` 写进 test 体（Playwright 不允许）——结构性而非产品红                                                                                                                                          |
| 浅色工具主题色修前实测  | a11y.spec 红跑实测：hand **2.42**（其余组与 §6.1 预估一致：shape 2.93/text 3.80/line 2.31/pen 2.67/sticky 1.90/mind 3.06——七组全低于 4.5）；修后 -ink 全组 ≥4.65（spec §6.2 提案值），配对 13 → 21 组双主题绿                                                                                                             |
| 单测/E2E 最终计数       | 单测 **945**（core 894 + react 51，+36：gate 真值表 5 + openFromKeyboard/监听 6 + rovingFocus 9 + safeArea 3 + announcement 8 + 菜单协议渲染 5）；E2E **22 spec / 204 例**（实施 +16 例至 202，复审返工 +2 例：右键断言 + S1-c，见 §14）；coverage 67.76/59.1/69.73/58.55（语/支/行/函；阈值 61/51/63/52 不破，收尾实测） |
| 人工 VoiceOver（M1–M8） | **待人工执行**（§8.7 清单；CI 只证语义属性/焦点/文案，读屏播报质量需真机 VoiceOver——与既往批次「验收人签收」同模式）                                                                                                                                                                                                      |
| 视觉 4/4 是否需重基线   | 不需要——工具坞激活色变化不进基线（clip 只含画布区），visual 4/4 全绿（收尾全量复跑）                                                                                                                                                                                                                                      |

实施中发现并修复的三个衍生缺陷（规格未预判，均有红证据）：

1. **Tab 键盘陷阱（2.1.1）**：hotkeys 的 `mind.addChild` 绑定 `tab` 无条件
   preventDefault——body 焦点下按 Tab 8 次焦点纹丝不动（Tab 序用例首红实锤）。
   修法沿用 mindNavigate 先例：handler 返回 false = 未消费 → 不 preventDefault，
   Tab/Enter 走原生焦点序列（`mindService.addChild/addSibling` 返回 boolean，
   谓词与 treeOps 同源 `getFocused()`——首版用 `getFocusedState()` 因几何快照
   在桩环境恒 null 误伤 mindBranchColor 用例，已改）。
2. **右键触发内联编辑器抢焦点**：右键已选中的形状会走「单击激活」路径异步开出
   TipTap 编辑器，其挂载焦点抢走菜单首项聚焦（probe 实锤：菜单 open + 焦点在
   ProseMirror）。修法两层：viewport 派发层右键 down/up 不进模式 handlers
   （IPointerEventInfo 无 button 字段，在 pixi stage 事件循环过滤 `e.button !== 0`
   ——touch/pen 归一为 0 不受影响）；ContextMenuService 开菜单前 `exitEdit()`
   收口可能已开的编辑会话。
3. **StrictMode 双跑污染焦点记录**：dev 双挂载下 record effect 第二遍会把已聚焦
   的菜单项记成归还目标（Esc 后焦点掉 body）。修法：记录时排除菜单内部元素
   （菜单自身永远不是合法归还目标）。

| 项（补充）          | 实测/结论                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| a11yKeyboard 首红项 | 菜单遍历/Esc 回焦/Tab 序三例（上述三缺陷的直接面）；修复后 8/8                                                                        |
| 旧用例适配          | clipboard/export/mobile/multiTab 四 spec 的菜单项定位 `getByRole('button')` → `'menuitem'`（role 升级的断言面同步，非行为变化）       |
| 播报优先级修订      | cursorMode 提到 selectedCount 之前（换工具必伴随清选区，播工具名比「已取消选择」信息量高——W4 E2E 实测后调整，announcement.test 同步） |

### 13.5 开放项与后续

1. ~~**宿主浮层快捷键闸门**~~ **已收口**（P0 批次）：闸门字段改名 `uiModalOpen` 并
   双源取或——右键菜单开合 ∥ 宿主浮层谓词（`IBoardConfig.isUiModalOpen` 注入
   `@spinth/react` 的 `isHostUiModalOpen`，查面板根节点 `data-spinth-ui-modal`
   标记）。项目菜单/存储面板已打标；单测 `uiModal.test.ts` + 真值表改名 +
   `a11yKeyboard.spec.ts` 三例（开面板 Delete/方向键静默、关面板不残留）。
2. **画布内容朗读**：元素级文本镜像/虚拟游标，需要独立的内容层，不与本批混做。
3. **px→rem 文本**：1.4.4 由页面缩放覆盖；纯文本缩放覆盖面有限，列为样式技术债。
4. **ToolGhost/画布图形对比**：幽灵预览在画布上最低 1.99（sticky），属非文本图形；
   是否抬到 3:1 需产品判断（会改变工具预览观感），本批不动。
5. **Linux 视觉基线 / PWA**：各自立项，不在本文件。
6. **ToolFlyout 的 Tab 顺序**：portal 到 body 使面板落在文档焦点序末尾（aria
   关联属性已补，屏读可感知面板存在）；键盘到达面板需穿过全部铬件。修复要动
   DOM 结构（面板挂回工具坞内或 Tab 序注入），与移动端 390 裁剪修复的 portal
   方案冲突，需另案权衡。
7. ~~**指针过滤的 touch/pen 自动化覆盖**~~ **已收口**（P0 批次）：单测真值表
   `pointerButtonFilter.test.ts`（缺省 button/0/2 与通道差异 7 例）+ 真浏览器
   `touchPen.spec.ts`（CDP `Input.dispatchTouchEvent` 与 `pointerType:'pen'`
   各一例，拖拽建件实证不被误挡）。
8. ~~**ActionBar 渲染期读安全区**~~ **已收口**（P0 批次）：几何抽
   `actionBarLayout.ts` 纯函数（单测含 safe 全 0 逐像素回归锚点）；宽度/容器宽/
   安全区合并进同一 `useLayoutEffect`，渲染期零 DOM 读取；
   `resize`/`orientationchange` 失效重算（`a11yLayout.spec.ts` S1-d 挂载后
   注入再 resize 断言重算）。
9. ~~**autoFocus 一次性的定点单测**~~ **已收口**（P0 批次）：
   `rovingAutoFocus.render.test.tsx` 四例——挂载聚焦首项+唯一停靠位、重渲染
   （busy 换文案）不抢非 roving 焦点、容器清空再填充重新聚焦、`autoFocus:false`
   不聚焦但停靠位仍在。
10. **宿主非模态浮层的闸门覆盖**（P0 复审提出）：PWA 更新横幅可聚焦但不是模态
    （role=status，仅在 waiting 期出现），未打 `data-spinth-ui-modal`——焦点在其
    按钮上按 Delete/方向键仍落到画布。与 §13.5-1 同机制，判据需产品拍板：横幅
    是否算「浮层」（算则打标即收口，不算则维持现状并在 docs/09 注明例外）。

## 14. 复审记录（2026-10-25，独立复跑门禁）

复审结论：W1–W4 落地真实、护栏到位，产品行为无回归；但当时「202 全绿」不成立
（a11y.spec 稳定 4/6）+ 两处规格项未实现 + 文档数字漂移。返工四笔提交
（791c7ab / 3321d9f / 41fea43 / b2bc9e2——两笔代码测试 + 两笔文档），全部处置如下：

| 级别 | 发现                                                                                                                                                                                                          | 处置                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | a11y.spec 两元素对比度用例红：固定 `waitForTimeout(250)` 等过渡是结构性脆弱（复审对照实证：纯 HTML 1s transition 在本环境约 700ms 才起跳，窗口内读到「浅色起始帧+深色底」2.31 假红 / rgba(0.694) 半透明抛错） | openBoard 抽 `disableTransitions`（全局 `transition:none !important` 注入，对比度只关心终值），错误态用例（自导航不走 openBoard）同样注入；两处 250ms 删除/降 50ms。6/6 绿 |
| P1   | ActionBar 安全区漏接（§7.4「左右夹取 8 + safeLeft/Right」未实现，docs/12 清单曾随之排除——文档迁就实现）                                                                                                       | ActionBar 左右夹取计入 `readSafeInsets()`；docs/12 清单补回 + S1-c 断言                                                                                                    |
| P1   | 工具坞按钮无 aria-label（§8.4 要求逐字保留 title 加 aria-label；名称扫描靠 title 回退假绿掩盖）                                                                                                               | 工具钮 + 后段三键补 `aria-label={title}`；名称扫描对点名三组（顶栏/工具坞/缩放）加显式 `aria-label` 断言                                                                   |
| P1   | AGENTS 201→202、a11y 6/6 未绿先写；docs/15 coverage 旧值 65.81/55.38/56.68/67.83 + 阈值顺序 61/51/52/63 与 vitest.config 不符                                                                                 | 复审后统一为 204 例 / a11y 6/6 实测 / coverage 67.76/59.1/69.73/58.55（语/支/行/函，收尾实测）、阈值 61/51/63/52                                                           |
| P2   | S1 只测顶栏/坞/缩放，面板/右键菜单/操作栏「改了没测」                                                                                                                                                         | 新增 S1-c：注入 left/right 44 后断言项目菜单/存储面板/右键菜单/操作栏不进 inset                                                                                            |
| P2   | 右键主键过滤（核心指针语义变更）无显式断言；且 `e.button !== 0` 对 `button === undefined`（pixi 缺省）会误挡合法指针                                                                                          | 过滤加 `e.button != null` 防卫；a11yKeyboard 新增「右键已选中件不开内联编辑器 + 焦点在菜单首项」显式用例                                                                   |
| P2   | useRovingFocus 的 autoFocus 每渲染执行——ProjectMenu busy/warning 重渲染会把焦点从非 roving 按钮拉回菜单项                                                                                                     | autoFocus 一次性 ref（容器清空时重置——面板条件卸载再打开视为新挂载，否则第二次打开不聚焦首项）                                                                             |
| P2   | ToolFlyout portal 到 body，工具按钮无 haspopup/expanded/controls，屏读不知道有变体面板                                                                                                                        | 工具钮（有 subMenuGroups 者）加三属性，flyout 容器固定 `id=spinth-tool-flyout`                                                                                             |
| P2   | 测试小问题：selected$ 探针类型嵌套箭头；contextMenuProtocol Tab 用例卸载后旧 NodeList 空断言                                                                                                                  | 均已修                                                                                                                                                                     |

复审后实测：单测 945（core 894 + react 51）不变；E2E 22 spec / **204 例**
（a11yKeyboard 9 + a11yLayout 9，+2 例）；visual 4/4；coverage
67.76 / 59.1 / 69.73 / 58.55。VoiceOver 人工清单（§8.7）仍待人工执行。

## 附录 A：颜色计算口径

- 比值使用 `packages/app/e2e/helpers/a11yE2e.ts` 的 `contrastRatio`（sRGB 相对亮度，
  向下取整两位），与既有护栏同源；本文表格即用该口径计算。
- 提案值均保留 ≥0.15 的余量（最低 hand 4.65 / line 4.82），避免取整抖动翻红。

## 附录 B：关键文件索引（撰写时）

| 主题          | 文件                                                                        |
| ------------- | --------------------------------------------------------------------------- |
| 菜单服务/状态 | `packages/core/src/platform/contextMenu/contextMenuService.ts`              |
| 快捷键闸门    | `packages/core/src/platform/keyboard/{keyboardService,shortcuts}.ts`        |
| 组合根        | `packages/core/src/boardComposition.ts`（324 contextMenu / 338 keyboard）   |
| 公共面        | `packages/core/src/boardPublicApi.ts`（命令区 45-83）                       |
| 菜单渲染      | `packages/react/src/components/ContextMenu.tsx`                             |
| 工具坞        | `packages/react/src/components/Toolbar.tsx`（TONE_ACTIVE 89-99）            |
| 令牌          | `packages/app/src/styles/tokens.css` / `packages/app/src/index.css`         |
| 顶栏          | `packages/app/src/App.tsx`（79-146）                                        |
| 布局护栏      | `packages/app/e2e/{mobile,a11y}.spec.ts` + `helpers/{layoutE2e,a11yE2e}.ts` |
