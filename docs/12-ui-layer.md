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

桥与命令模块经 `BoardPublicApi` 收窄消费（公共面 = allowlist + 编译期分类锁，
`BOARD_PUBLIC_MEMBERS` 见 core 的 boardPublicApi.ts）：allowlist 漏成员时这两个
模块先编译红——它们是公开面的真实验证面。

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

| 组件             | 职责                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Board`          | #stage-container 挂载 + SDK 生命周期（StrictMode 双挂载防御）+ 主题注入；画布宿主语义（`role=application` + 白板描述 + 快捷键帮助文本 + canvas aria-hidden，specs/a11y-closeout §8）             |
| `Icon`           | 语义名图标注册表（lucide + 内联 SVG）；禁止直接 import 图标库                                                                                                                                    |
| `Toolbar`        | 底部工具坞；常驻二级菜单；工具主题色；会话级默认参数；roving 焦点（单 Tab 停靠，方向键在按钮间移动）                                                                                             |
| `ToolFlyout`     | 工具坞常驻二级菜单面板（可见性 = 工具激活的纯派生状态）；roving（both 方向）                                                                                                                     |
| `ContextMenu`    | 右键菜单；图标 + 快捷键 chip；role=menu + menuitem；翻转 + 四面夹取（含安全区）；键盘协议（方向键/Home/End/Esc/Tab，焦点归还，Shift+F10 打开）                                                   |
| `ZoomControl`    | 缩放胶囊（−/百分比/＋）；三钮 aria-label（适应屏幕钮名称带当前百分比）                                                                                                                           |
| `ActionBar`      | 选中浮动操作栏；schema v2 驱动；多选八键 + 编组单钮；只读态整条不渲染（含删除入口）                                                                                                              |
| `PopoverControl` | ActionBar 多级控件（一级当前值 + ▾，二级面板）；触发钮遵守 schema `disabled` 契约（与 toggle/action 同款禁用态）；面板 roving + 关闭回焦触发钮                                                   |
| `Announcer`      | 唯一 polite live region（sr-only 常驻，role=status + aria-atomic）：store 六字段差分播报（加载完成/选中变化/工具切换/保存失败/只读切换），200ms 防抖合并；文案源在 `a11y/announcement.ts` 纯函数 |
| `Tooltip`        | 通用悬停提示（400ms、focus 可达、disabled 抑制）                                                                                                                                                 |
| `ErrorState`     | 共享错误态（role=alert + 标题聚焦 + 详情可滚）；ErrorBoundary 与初始化失败共用                                                                                                                   |
| `OfflineBar`     | 离线提示条（协同宿主用；单机 `editBlocked` 恒 false 不可达）                                                                                                                                     |
| `MindAddButtons` | 脑图节点 +/− 按钮（定位数学在 `mindAddLayout.ts` 纯函数，视口钳制）                                                                                                                              |
| `ToolGhost`      | 工具幽灵；ref 直写 transform，不进 React 渲染                                                                                                                                                    |
| `DotGrid`        | 画布点阵；CSS radial-gradient；命令式重定位                                                                                                                                                      |

Roving 焦点协议（specs/a11y-closeout §5）：纯函数 `a11y/rovingFocus.ts`（方向键步进/
跳禁用/wrap）+ hook `a11y/useRovingFocus`（容器级 keydown/focusin，单 Tab 停靠）；
五个消费者（ContextMenu/Toolbar/ToolFlyout/PopoverControl/ProjectMenu）共用同一协议。
菜单语义统一 role=menu + menuitem(menuitemradio)/separator；ContextMenu 打开聚焦
首个非禁用项，Esc/Tab/选项三路关闭统一归还焦点（点外部不归还——指针语义是去别处）。

顶栏（app 壳，44px）：品牌标 + `spinth` 字标 + docId 胶囊（390px 截断）；右侧只读徽标
（`data-spinth-readonly-pill`，按标签角色区分提示文案——多标签口径见
[21-multi-tab](21-multi-tab.md)）/ 本地存储入口（`StorageStatusButton.tsx`：已保存 /
保存中 / 保存失败 三态，点击打开「本地存储」面板 `StoragePanel.tsx`——文档保存重试、
浏览器持久化申请、用量/配额压力、备份入口，docs/02 §6.1）/ 复制链接 / 新建 / 项目菜单
（导出/导入 `.spinth.zip`，docs/20 §9；`ProjectMenu.tsx` 受控开合；导入在只读态
disabled）/ 主题切换。
单机版不显示“已同步”或任何远端连接状态。

只读提示条（app 壳 `ReadOnlyNotice.tsx`，`data-spinth-readonly-notice`）：仅多标签
follower 角色渲染，说明本页只读与接管行为，提供「刷新」与会话内「知道了」。只读下
选择与复制受写门禁限制，右键不建选区（完整矩阵见 [21-multi-tab](21-multi-tab.md) §4）。

移动端：390px 下 docId 截断（胶囊 min-w-0 + truncate，顶栏不换行不横滚），工具坞
`w-max + shrink-0` 保按钮 40×40、坞内横向滚动（文档不滚）；二级菜单 / 存储面板 /
项目菜单 / 右键菜单 fixed + 视口 clamp（面板先定位后挂载——首帧 static 会挤歪
锚点按钮的测量；项目菜单与存储面板另有 maxHeight 纵向兜底）；选中操作栏
`max-w` 钳制、Popover 面板 `w-max + flex-wrap` 换行收纳；脑图 +/- 按钮经
`mindAddLayout.ts` 纯函数钳进容器；触控目标 ≥24（WCAG 2.2 AA 2.5.8）。九个面的
390 布局矩阵回归在 `e2e/mobile.spec.ts`（M1–M9，helpers/layoutE2e.ts）；只读态
保留缩放/平移，选择与复制受写门禁限制。

重排与缩放（specs/a11y-closeout §7）：`max-[379px]` 紧凑顶栏（内边距/间距减半、
字标隐藏、存储按钮仅圆点、胶囊加 title/aria-label——390 及以上逐像素不变，
断点必须避开 M1 截断基线）；320×640 重排与 720×450（200% 缩放代理）布局矩阵在
`e2e/a11yLayout.spec.ts`（Z1/Z2/R1/S1 八例，页面级无二维滚动；工具坞内部横滚
属工具栏自身滚动区，#stage-container 豁免）。

## 5. 主题与样式架构

- 语义令牌唯一色源：`packages/app/src/styles/tokens.css`，以 CSS 自定义属性定义
  canvas/surface/edge/ink/accent/danger/warning/工具色/阴影；组件只消费语义类。
- 颜色按**角色**拆分（WCAG 2.2 AA）：
  - `danger` 是图形色（圆点/进度/描边，≥3:1）；文字与图标一律 `danger-ink`
    （≥4.5:1，浅 `#b42318` / 深 `#ff6369`）。填充按钮不白字压红底——
    危险提示走 soft 底 + ink 字 + danger 描边。
  - `accent` 是品牌色（焦点环/描边/图标，≥3:1）；填充按钮一律
    `accent-fill` + `on-accent`（含 hover `accent-fill-hover`），不用品牌紫压白字；
    组件禁止 `text-white`。
  - `text-3` 按最暗实际底（surface-hover）定值：浅 `#67677a` / 深 `#9c9ca9`。
  - 工具主题色按角色拆 `-ink`（specs/a11y-closeout §6）：本体 = 画布图形/色点/
    幽灵预览；`tool-*-ink` = soft 底上的前景（图标/文字）——flyout 选中项含纯文本
    （字号/线宽数字），统一按文字 4.5:1 定值；深色本体已达标，`-ink` 别名本体。
  - 安全区变量四条（`--spinth-safe-top/right/bottom/left`）包一层 `env()`：
    E2E 覆盖这层变量注入测试值（env 本身不可伪造）；顶栏/工具坞/缩放胶囊/只读
    提示/面板定位/右键菜单夹取均计入。
  - 对比度护栏：`e2e/a11y.spec.ts` 从浏览器计算样式取色断言（21 组令牌配对 ×
    浅/深 + 实际元素，含 tool-*-ink 八组与激活工具钮/flyout 选中项元素面），
    不在测试里持有颜色字面量。
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
3. SDK 初始化完成 → onReady → 隐藏 loading；空画布显示快捷键引导（只读态不显示——
   引导全是写指令，docs/21 §4）。
4. 初始化失败 → 共享 `ErrorState`（IndexedDB 禁用/配额满等），不永久卡 loading：
   容器唯一 `role="alert"`，标题挂载即聚焦（读屏先读标题），详情为错误 message
   （非堆栈）且 `overflow-wrap:anywhere` + 内部滚动（390px 长串不撑破布局），
   主按钮 `accent-fill` ≥4.5:1；文案顺序「标题→建议→详情」。渲染异常走同款
   `ErrorBoundary`（class 组件，React 唯一 error boundary 形态）。

## 7. app 层

- 无路由：单编辑页，URL 参数 `?doc=xxx`；默认 docId 随机 8 位并稳定在 sessionStorage。
- 单机版不读取远端地址或协同参数；不传 `wsUrl`。
- 主题、顶栏、错误边界、空态属于 app 壳；画布 UI 由 react 包提供。
