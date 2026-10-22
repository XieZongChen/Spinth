# 12 — UI 层（@spinth/react）：zustand 桥、DOM UI 与启动链路

## 1. 设计原则

- core 不知道 React 的存在；UI 只通过「rxjs 输出流 + 拉取式查询（读）」与
  「命令方法（写）」和 SDK 通信。
- **只读镜像 + 命令分离**：store 没有 reducer/action，只有 SDK 推来的状态；
  命令是独立模块的纯转发函数。
- 高频视口流不进 React 渲染路径；低频状态才走 selector 订阅。

## 2. store / bridge / commands

```ts
interface SpinthUiState {
  sdkVersion;
  currentPhase;
  docState: DocState;
  wsState: WsState; // 单机恒 off
  editBlocked: boolean; // 物理断网
  editable: boolean;
  isOnline: boolean;
  cursorMode: CursorMode;
  pageScale: number;
  vpBounds: Rect | null;
  selectedCount: number;
  canUndo;
  canRedo;
  contextMenu: { show; x; y; onWidget; canPaste } | null;
  actionBar: { schema; bounds } | null;
  mindAddButtons: IMindAddButtonsState | null;
  mindGhostSuppressed: boolean;
  defaultToolOptions: Record<string, Record<string, string>>;
}
```

桥接两类通道：

1. **流订阅**：docState$ / wsState$ / editBlocked$ / editable$ / cursorMode$ /
   vpScale$ / vpBounds$ / selected$ / canUndo$ / canRedo$ / contextMenuOptions$ /
   mindGhostSuppressed$ / defaultToolOptions$。
2. **拉取式聚合**：`syncActionBar()` 调 `getActionBarSchema()` +
   `getSelectionBounds()`，世界包络 → 屏幕矩形一次写入；`syncMindButtons()`
   调 `getMindAddButtons()`。重算触发：selected$/widgetsChanged$/mindFocusChanged$/
   vpScale$/vpBounds$；拖拽中（dragMove$）置 null 隐藏。

命令模块全部是 `sdk.xxx()` 薄转发：setCursorMode、setPageScale、zoomIn/Out/ToFit、
undo/redo、removeSelected、copy/cut/paste、图层、ActionBar 样式、脑图节点、对齐/分布。

## 3. DOM UI 与画布坐标同步

```
SDK：getSelectionBounds() = 选中 vm 世界包络
  → bridge toScreenPoint → 屏幕矩形（canvas/main 局部坐标）

ActionBar / MindAddButtons：纯算术定位
  选区上方居中 + 视口钳制 + 下方翻转
```

- `TOPBAR_HEIGHT = 44` 是全局坐标补偿常量，定义在 react 唯一位置。
- `toScreen/bounds` 输出 canvas/main 局部坐标（不含顶栏偏移）；只有
  「DOM 页坐标 ↔ 画布局部」互转才 +/− 44。挂在 `<main>` 内的浮层直接使用局部坐标，
  再加 44 会双计偏移。
- 不引入 floating-ui：位置由选区矩形 + 固定偏移 + 视口钳制直接推导；浮层间无叠放仲裁。
- 高频跟随 UI（点阵/工具幽灵）走 zustand 命令式订阅 + ref 直写 transform。

### 3.1 拖拽中隐藏

拖拽/缩放进行中，bridge 收到 `dragMove$` 后把 `actionBar` 与 `mindAddButtons` 置
`null`——浮层不跟随手势、不遮挡落点；松手落库后 `widgetsChanged$` 触发重算并恢复。
这是 docs/14 规则 2 的 UI 侧配套：手势期只做视觉预览，落库后才广播新几何。

## 4. 组件清单

| 组件             | 职责                                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `Board`          | #stage-container 挂载 + SDK 生命周期（StrictMode 双挂载防御）+ 主题注入 |
| `Icon`           | 语义名图标注册表（lucide + 内联 SVG）；禁止直接 import 图标库           |
| `Toolbar`        | 底部工具坞；常驻二级菜单；工具音色；会话级默认参数                      |
| `ToolFlyout`     | 工具坞常驻二级菜单面板（可见性 = 工具激活的纯派生状态）                 |
| `ContextMenu`    | 右键菜单；图标 + 快捷键 chip；边缘翻转                                  |
| `ZoomControl`    | 缩放胶囊（−/百分比/＋）                                                 |
| `ActionBar`      | 选中浮动操作栏；schema v2 驱动；多选八键 + 编组单钮                     |
| `PopoverControl` | ActionBar 多级控件（一级当前值 + ▾，二级面板）                          |
| `Tooltip`        | 通用悬停提示（400ms、focus 可达、disabled 抑制）                        |
| `OfflineBar`     | 离线提示条                                                              |
| `MindAddButtons` | 脑图节点 +/− 按钮（纯算术定位）                                         |
| `ToolGhost`      | 工具幽灵；ref 直写 transform，不进 React 渲染                           |
| `DotGrid`        | 画布点阵；CSS radial-gradient；命令式重定位                             |

顶栏（app 壳，44px）：品牌标 + `spinth` 字标 + docId 胶囊（390px 截断）；右侧只读徽标
（`data-spinth-readonly-pill`，按标签角色区分提示文案——多标签口径见
[21-multi-tab](21-multi-tab.md)）/ 本地存储入口（`StorageStatusButton.tsx`：已保存 /
保存中 / 保存失败 三态，点击打开「本地存储」面板 `StoragePanel.tsx`——文档保存重试、
浏览器持久化申请、用量/配额压力、备份入口，docs/02 §6.1）/ 复制链接 / 新建 / 项目菜单
（导出/导入 `.spinth.zip`，docs/20 §9；`ProjectMenu.tsx` 受控开合；导入在只读态
disabled）/ 主题切换。
单机版不显示“已同步”或任何远端连接状态。

只读提示条（app 壳 `ReadOnlyNotice.tsx`，`data-spinth-readonly-notice`）：仅多标签
follower 角色渲染，说明本页只读与接管行为，提供「刷新」与会话内「知道了」。

移动端：390px 下 docId 截断（胶囊 min-w-0 + truncate，顶栏不换行不横滚），工具坞横向
滚动，二级菜单与存储面板 fixed + 视口 clamp（面板先定位后挂载——首帧 static 会挤歪
锚点按钮的测量）；只读态保留缩放/平移，选择与复制受写门禁限制。

## 5. 主题与样式架构

- 语义令牌唯一色源：`packages/app/src/styles/tokens.css`，以 CSS 自定义属性定义
  canvas/surface/edge/ink/accent/danger/warning/工具色/阴影；组件只消费语义类。
- `index.css` 的 `@theme inline` 把令牌映射为 Tailwind 工具类；
  `data-theme` 切换 `:root` 变量即整站换肤。
- 首绘由 index.html 内联脚本预置 `data-theme`（防暗色白屏闪烁）；
  持久化只发生在用户显式切换；无保存偏好时跟随系统主题变化。
- 画布底色与点阵由 DOM 承载（PIXI `backgroundAlpha: 0`）；换肤即 CSS 令牌切换。
- core 默认文字色（TEXT/LINE 无 override）随主题：app theme state → Board theme prop →
  `BoardSDK.setTheme` → `setTextTheme + vmEngine.refreshAll()`。
- 字体：Nunito Variable（@fontsource，离线可用）；CJK 回退系统字。
- `@source '../../react/src'` 必须保留：react 源码直引不经 node_modules，
  缺此行组件全部丢样式。
- react 包宿主契约：语义令牌、工具类映射、动效类、字体、源扫描五项。

## 6. 启动链路

1. index.html 静态首帧（品牌标 + 背景色，无 JS）。
2. React 挂载 `Board`；`docState !== 'synced'` 时显示“正在恢复画布…”。
3. SDK 初始化完成 → onReady → 隐藏 loading；空画布显示快捷键引导。
4. 初始化失败 → 错误卡 + 重试按钮（IndexedDB 禁用/配额满等），不永久卡 loading。

## 7. app 层

- 无路由：单编辑页，URL 参数 `?doc=xxx`；默认 docId 随机 8 位并稳定在 sessionStorage。
- 单机版不读取远端地址或协同参数；不传 `wsUrl`。
- 主题、顶栏、错误边界、空态属于 app 壳；画布 UI 由 react 包提供。
