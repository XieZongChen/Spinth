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
`BOARD_PUBLIC_MEMBERS` 见 core 的 boardPublicApi.ts）；运行时同源：`createBoard()`
返回该 allowlist 的冻结投影（内部字段不可枚举/不可读/不可调用，specs/runtime-narrowing）。
allowlist 漏成员时这两个模块先编译红——它们是公开面的真实验证面。

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
- 宿主浮层快捷键闸门契约：app 壳的模态面板（项目菜单/存储面板）根节点打
  `data-spinth-ui-modal` 标记（常量 `UI_MODAL_ATTR`），App 经
  `config.isUiModalOpen = isHostUiModalOpen` 注入 core 快捷键闸门——标记存在 ⟺
  面板打开；新增宿主浮层必须打标（docs/09 filter 闸门）。右键菜单不打标（core
  `contextMenu` 已是真源，双源会掩盖回归）。
- 宿主铬件标记契约：常驻可聚焦铬件（当前只有 PWA 更新横幅）根节点打
  `data-spinth-ui`（常量 `UI_CHROME_ATTR`，单源 core/shortcuts、`@spinth/react`
  转发）——焦点落在该子树内时快捷键闸门按焦点作用域静默（区别于 modal 的
  存在性判定）。新增打标前必须检查该子树是否依赖画布快捷键（打标即全静默）；
  工具栏/菜单等现有铬件维持现状，不扩大。
- ActionBar 定位几何在 `actionBarLayout.ts` 纯函数；宽度/高度/容器宽/安全区全部在
  `useLayoutEffect` 内测量（渲染期零 DOM 读取），`resize`/`orientationchange`
  失效重算（真机旋转/软键盘改变安全区）；上下翻转判定用 max(实测栏高, 40)——
  栏高随根字号的 rem 缩放，根字号 16px 下实测 38–39px，位置与只用估算一致。
- ContextMenu 定位几何在 `menuPlacement.ts` 纯函数（翻转 + 四面夹取）：首帧按估算
  尺寸同步定位（夹取保证在视口内），`useLayoutEffect` 实测面板尺寸与估算不同才
  重定位（绘制前完成，无中间帧）；实测值按打开签名（x/y/onWidget）隔离，菜单开着
  时重开不残留旧尺寸。

### 3.1 拖拽中隐藏

拖拽/缩放进行中，bridge 收到 `dragMove$` 后把 `actionBar` 与 `mindAddButtons` 置
`null`——浮层不跟随手势、不遮挡落点；松手落库后 `widgetsChanged$` 触发重算并恢复。
这是 docs/14 规则 2 的 UI 侧配套：手势期只做视觉预览，落库后才广播新几何。

## 4. 组件清单

| 组件             | 职责                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Board`          | #stage-container 挂载 + SDK 生命周期（StrictMode 双挂载防御；经 `createBoard()` 拿冻结公共投影，DEV 原子挂载 `__spinth` 公开投影与 `__spinthDebug.__debug` 调试面，生产构建剥离）+ 主题注入；画布宿主语义（`role=application` + 白板描述 + 快捷键帮助文本 + canvas aria-hidden，specs/a11y-closeout §8） |
| `Icon`           | 语义名图标注册表（lucide + 内联 SVG）；禁止直接 import 图标库                                                                                                                                                                                                                                            |
| `Toolbar`        | 底部工具坞；常驻二级菜单；工具主题色；会话级默认参数；roving 焦点（单 Tab 停靠，方向键在按钮间移动）                                                                                                                                                                                                     |
| `ToolFlyout`     | 工具坞常驻二级菜单面板（可见性 = 工具激活的纯派生状态）；roving（both 方向）；锚点由 Toolbar layout effect 受控提供（宿主 ref 晚于子树 effect，首帧直读必空），测量失败 rAF 补帧重试，resize/滚动失效同帧重算                                                                                            |
| `ContextMenu`    | 右键菜单；图标 + 快捷键 chip；role=menu + menuitem；翻转 + 四面夹取（含安全区，实测尺寸定位，§3）；键盘协议（方向键/Home/End/Esc/Tab，焦点归还，Shift+F10 打开）                                                                                                                                         |
| `ZoomControl`    | 缩放胶囊（−/百分比/＋）；三钮 aria-label（适应屏幕钮名称带当前百分比）                                                                                                                                                                                                                                   |
| `ActionBar`      | 选中浮动操作栏；schema v2 驱动；多选八键 + 编组单钮；只读态整条不渲染（含删除入口）                                                                                                                                                                                                                      |
| `PopoverControl` | ActionBar 多级控件（一级当前值 + ▾，二级面板）；触发钮遵守 schema `disabled` 契约（与 toggle/action 同款禁用态）；面板 roving + 关闭回焦触发钮                                                                                                                                                           |
| `Announcer`      | 唯一 polite live region（sr-only 常驻，role=status + aria-atomic）：store 六字段差分播报（加载完成/选中变化/工具切换/保存失败/只读切换），200ms 防抖合并；文案源在 `a11y/announcement.ts` 纯函数                                                                                                         |
| `Tooltip`        | 通用悬停提示（400ms、focus 可达、disabled 抑制；`w-max` + 视口上限，超宽折行不撑出横滚）                                                                                                                                                                                                                 |
| `ErrorState`     | 共享错误态（role=alert + 标题聚焦 + 详情可滚）；ErrorBoundary 与初始化失败共用                                                                                                                                                                                                                           |
| `OfflineBar`     | 离线提示条（协同宿主用；单机 `editBlocked` 恒 false 不可达）                                                                                                                                                                                                                                             |
| `MindAddButtons` | 脑图节点 +/− 按钮（定位数学在 `mindAddLayout.ts` 纯函数，视口钳制）                                                                                                                                                                                                                                      |
| `ToolGhost`      | 工具幽灵；ref 直写 transform，不进 React 渲染                                                                                                                                                                                                                                                            |
| `DotGrid`        | 画布点阵；CSS radial-gradient；命令式重定位                                                                                                                                                                                                                                                              |

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
项目菜单 / 右键菜单 fixed + 视口 clamp（项目菜单与存储面板先定位后挂载——
首帧 static 会挤歪锚点按钮的测量，另有 maxHeight 纵向兜底；二级菜单 portal
挂 body、-9999 隐藏至首测落位，滚动/resize 失效重算）；选中操作栏
`max-w` 钳制、Popover 面板 `w-max + flex-wrap` 换行收纳；脑图 +/- 按钮经
`mindAddLayout.ts` 纯函数钳进容器；触控目标 ≥24（WCAG 2.2 AA 2.5.8）。九个面的
390 布局矩阵回归在 `e2e/mobile.spec.ts`（M1–M9，helpers/layoutE2e.ts）；只读态
保留缩放/平移，选择与复制受写门禁限制。

重排与缩放（specs/a11y-closeout §7）：`max-[379px]` 紧凑顶栏（内边距/间距减半、
字标隐藏、存储按钮仅圆点、胶囊加 title/aria-label——390 及以上逐像素不变，
断点必须避开 M1 截断基线）；320×640 重排与 720×450（200% 缩放代理）布局矩阵在
`e2e/a11yLayout.spec.ts`（Z1/Z2/R1/S1 十例，页面级无二维滚动；工具坞内部横滚
属工具栏自身滚动区，#stage-container 豁免）。纯文本缩放（根字号 16→32px）的
精确性与布局矩阵在 `e2e/textScale.spec.ts`（T1–T6，见 §5 字号单位策略）。

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
    提示/面板定位/右键菜单夹取/选中操作栏左右夹取均计入（a11yLayout S1-c
    断言四类浮层不进 inset）。
  - 对比度护栏：`e2e/a11y.spec.ts` 从浏览器计算样式取色断言（21 组令牌配对 ×
    浅/深 + 实际元素，含 tool-*-ink 八组与激活工具钮/flyout 选中项元素面），
    不在测试里持有颜色字面量。
- `index.css` 的 `@theme inline` 把令牌映射为 Tailwind 工具类；
  `data-theme` 切换 `:root` 变量即整站换肤。
- 字号单位策略（WCAG 1.4.4 文本缩放，specs/rem-typography）：铬件字号只用 rem，
  随浏览器默认字号缩放；画布与铬件是两套单位系统，只统一铬件内部。
  - 根锚点：`index.css` 的 `html { font-size: 100% }`。禁止给 html/body 写死像素或
    62.5%；字号不用 em（随父级漂移）、vw 或 clamp()（跟视口、可封顶，均无视用户偏好）。
  - 刻度：Tailwind `text-xs`（12）/`text-sm`（14，自带行高）+ `@theme inline` 四个令牌
    `text-3xs`（10）/`text-2xs`（11）/`text-md`（13）/`text-brand`（15，仅顶栏字标，
    不是标题层级）。令牌只给字号、不带行高，行高继承根的 1.5；需要继承行高的 12px
    写 `text-[0.75rem]`（换 `text-xs` 会把行高从 18px 改成 16px）。换算 px ÷ 16 写精确小数。
  - 容器与字号同批：由文本撑高的盒子不得 px 定高（菜单行 `min-h-[2.125rem]`）；右键菜单
    宽 `13.5rem` + `max-w-[calc(100vw-1rem)]`；Tooltip `w-max` + 视口上限。依赖面板尺寸
    的定位跟随实测（右键菜单、ActionBar，见 §3）。
  - px 保留区：文档 `fontSize`（世界单位，缩放由视口 zoom 承担）与 PIXI 字号、DOM 文本
    编辑层（`richTextEditor` / `plainTextKernel`，须与画布逐像素对齐）、canvas 测量字体串、
    交互几何常量、1px 描边/焦点环/阴影、媒体查询断点（媒体查询的 rem 按初始字号解析）、
    图标尺寸。
  - 护栏：`node scripts/check-font-units.mjs`（verify 与 CI gate；扫三包 src 与
    index.html 的 px 字号四类写法——Tailwind 任意值 / CSS 声明 / JS px 串 / `.tsx` 数字
    字号，白名单为文件级并写理由，无行内豁免；每次运行先跑内置夹具自检）。
- 首绘由 index.html 内联脚本预置 `data-theme`（防暗色白屏闪烁）；
  持久化只发生在用户显式切换；无保存偏好时跟随系统主题变化。
- 画布底色与点阵由 DOM 承载（PIXI `backgroundAlpha: 0`）；换肤即 CSS 令牌切换。
- core 默认文字色（TEXT/LINE 无 override）随主题：app theme state → Board theme prop →
  门面 `setTheme`（公共投影）→ `setTextTheme + vmEngine.refreshAll()`。
- 字体：Nunito Variable（@fontsource，离线可用）；CJK 回退系统字。
- `@source '../../react/src'` 必须保留：react 源码直引不经 node_modules，
  缺此行组件全部丢样式。
- react 包宿主契约：语义令牌、工具类映射、动效类、字体、源扫描五项。

## 6. 启动链路

1. index.html 静态首帧（品牌标 + 背景色，无 JS）。
2. 生产构建注册 Service Worker（`src/pwa/serviceWorker.ts`，注册 URL 与 scope 走
   `publicAsset()`/`SITE_BASE`，`updateViaCache:'none'`；SW 激活即 `claim()`，
   首装无需二次刷新即受控）。**dev 不注册**——HMR 与 React refresh 不受影响；
   注册失败（隐私模式/CSP）吞错降级为在线使用。
3. React 挂载 `Board`；`docState !== 'synced'` 时显示“正在恢复画布…”。
4. SDK 初始化完成 → onReady → 隐藏 loading；空画布显示快捷键引导（只读态不显示——
   引导全是写指令，docs/21 §4）。
5. 新版本送达：`waiting` 出现时顶部居中横幅「新版本可用」（`PwaUpdateBanner`，
   `role=status`、与 OfflineBar 同锚点且互斥）；用户点击「刷新」→ `SKIP_WAITING`
   → 仅点击方 reload；「稍后」= 本会话不再提示（specs/pwa.md）。
6. 初始化失败 → 共享 `ErrorState`（IndexedDB 禁用/配额满等），不永久卡 loading：
   容器唯一 `role="alert"`，标题挂载即聚焦（读屏先读标题），详情为错误 message
   （非堆栈）且 `overflow-wrap:anywhere` + 内部滚动（390px 长串不撑破布局），
   主按钮 `accent-fill` ≥4.5:1；文案顺序「标题→建议→详情」。渲染异常走同款
   `ErrorBoundary`（class 组件，React 唯一 error boundary 形态）。

## 7. app 层

- 无路由：单编辑页，URL 参数 `?doc=xxx`；默认 docId 随机 8 位并稳定在 sessionStorage。
- 单机版不读取远端地址或协同参数；不传 `wsUrl`。
- 主题、顶栏、错误边界、空态属于 app 壳；画布 UI 由 react 包提供。
- PWA 设施全部在 app 壳 `src/pwa/`（注册控制器、更新横幅、SW 与构建期清单）；
  SW 是独立全局：源码禁依赖框架/SDK/Node 内建（eslint 强制），缓存策略纯函数化
  （`cachePolicy`/`precacheManifest`，单测覆盖），版本由 dist 产物实算（specs/pwa.md）。
