# 可访问性与移动端布局收口（批次 A）：spec

> 本文件是设计与验收依据。实施由另一个 agent 执行，本文件作者只做设计与审查。
> 随仓库提交（`specs/`）。产品规格落点：`docs/12`、`docs/21 §4`、`docs/10 §4`、`docs/15`。
> 行号取自当前工作树；实施前请按符号名复核，行号漂移不作为失败理由。

## 0. 一句话目标

三件用户可见的事各自收口：**颜色不靠低对比度**（危险/强调/三级文本达到 WCAG 2.2 AA）、
**错误态有语义也有出口**（不再白屏/卡 loading）、**390px 下每个浮层都在视口内**。
物理断网不作为交互矩阵展开——单机模式下它不可达，本轮把它固化成可执行的不变量。

## 1. 完成定义（缺一不可）

1. 浅色/深色两套主题下，下列语义对达到 WCAG 2.2 AA：正文 4.5:1、图形/控件边界 3:1；
   由 E2E 从**真实计算样式**取色断言（不是把 hex 写死在测试里自证）。
2. 错误态只有一套实现：`role="alert"`、标题可聚焦、详情可滚动、主按钮 ≥4.5:1；
   IndexedDB 不可用时 390px 不白屏、不横滚、有重试出口。
3. 390×844 下九个浮层/铬件全部在视口内，且工具坞与缩放胶囊不重叠、文档不横向滚动；
   工具坞按钮保持 40×40（不被 flex 压扁）、其余交互控件 ≥24×24；390×480 小高度下
   项目菜单不越界且可内部滚动。发现的越界与不达标在同一批修掉，不挂账。
4. 单机断网是「不可达」不变量：`editBlocked` 恒 false，断网仍可创建/撤销/落盘，
   `OfflineBar` 不出现；有 core 单测 + E2E 回归。不含断网首开/刷新（见 §8.5）。
5. `pnpm verify` 与 `pnpm test:e2e` 全绿；测试数、spec 数按实测写回 docs/15 与 AGENTS。
6. 视觉基线不变（四张快照只裁 canvas，DOM 铬件不在内）。若出现差异，先解释再更新。
7. 不新增运行时依赖；不改 `dataEngine` / `vmEngine` / 指针分发主路径。
8. `docs/12`、`docs/13`、`docs/15`、`docs/21`、`AGENTS.md` 当前状态同步。

## 2. 范围

| 编号 | 交付物                               | 性质             | 风险                 |
| ---- | ------------------------------------ | ---------------- | -------------------- |
| A1   | 语义色角色拆分 + 对比度 E2E 护栏     | 只改令牌与 class | 低（颜色观感略变）   |
| A2   | 共享 `ErrorState` + 两条错误路径接入 | 组件重构 + 语义  | 低（文案/结构不变）  |
| A3   | 390px 布局矩阵 + 脑图按钮钳制        | 测试 + 小修      | 中（会暴露既有越界） |
| A4   | 单机断网不变量 + 测试 + 文档         | 测试 + 文档      | 低                   |

### 2.1 非目标（本批不做）

- 右键菜单的键盘协议（方向键 / roving focus）。现状刻意不设 `role="menu"`
  （`ContextMenu.tsx:129` 注释已说明），本轮不改这个取舍。
- 工具音色图标对 `tool-*-soft` 底的对比度审计（`TONE_ACTIVE` 八组）。属独立的
  视觉可读性问题，另行排期。
- 200% 文本缩放、`viewport-fit=cover` / 安全区、屏幕阅读器全量巡检。
- Service Worker / PWA / 离线首开与刷新：A4 只锁「页面已加载后断网可编辑」；
  真离线刷新要处理 Pages 子路径 scope、缓存版本与 CSP，另立 spec。
- 协同模式下的 `editBlocked` 交互矩阵（需要先有协同宿主；本批只锁单机不变量）。
- Linux 视觉基线、CI 视觉阻塞化、`app.ts` 拆分等 P2 项。
- 新增依赖：不引 `axe-core`、`@testing-library`、`floating-ui`。

## 3. 现状事实（实测，实施前核对）

### 3.1 颜色：三类真实的 AA 失败

对比度按 WCAG 相对亮度在 sRGB 下计算，取整到两位。失败项：

| 用途               | 前景 / 背景           | 比值 | 结论         | 使用点                                                                                                       |
| ------------------ | --------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| 危险文本（浅）     | `#e5484d` / `#f8f9fa` | 3.71 | 失败（<4.5） | `ErrorBoundary.tsx:27`、`App.tsx:182`                                                                        |
| 危险文本（浅）     | `#e5484d` / `#ffffff` | 3.91 | 失败         | `StoragePanel.tsx:85/92/167`、`ProjectMenu.tsx:340`                                                          |
| 危险文本（浅）     | `#e5484d` / `#fdecec` | 3.43 | 失败         | `StorageStatusButton.tsx:127`、`ContextMenu.tsx:149` hover                                                   |
| 危险填充白字（浅） | `#ffffff` / `#e5484d` | 3.91 | 失败         | `OfflineBar.tsx:14`                                                                                          |
| 强调填充白字（浅） | `#ffffff` / `#7c5cfc` | 4.38 | 失败         | `ErrorBoundary.tsx:34`、`App.tsx:190`、`ReadOnlyNotice.tsx:26`、`ProjectMenu.tsx:321`、`StoragePanel.tsx:25` |
| 危险填充白字（深） | `#ffffff` / `#ff6369` | 2.90 | 失败         | `OfflineBar.tsx:14`（深色）                                                                                  |
| 强调填充白字（深） | `#ffffff` / `#9d87ff` | 2.86 | 失败         | 上述按钮（深色）；同主题 `--spinth-on-accent` 本可给 6.24，但代码写死 `text-white`                           |
| 三级文本（浅）     | `#6f6f7f` / `#f3f3f7` | 4.46 | 失败         | docId 胶囊（`App.tsx:83`）、右键菜单 kbd（`ContextMenu.tsx:162`）                                            |
| 三级文本（深）     | `#8b8b98` / `#26262f` | 4.46 | 失败         | 存储面板正文（`StoragePanel.tsx:23`）、项目菜单 warning 列表                                                 |
| 三级文本（深）     | `#8b8b98` / `#2f2f3a` | 3.93 | 失败         | docId 胶囊、kbd                                                                                              |
| 警示文本（浅）     | `#b45309` / `#fef3c7` | 4.51 | 临界通过     | 存储配额 warn 文案                                                                                           |

已通过、但必须纳入护栏的项（防止后续改色回退）：

| 用途           | 前景 / 背景                   | 浅           | 深           |
| -------------- | ----------------------------- | ------------ | ------------ |
| 一级文本       | text-1 / canvas               | 15.89        | 14.67        |
| 二级文本       | text-2 / surface              | 6.47         | 6.23         |
| 危险文本       | danger-ink / canvas           | 6.24（新值） | 5.90（新值） |
| 危险文本       | danger-ink / surface          | 6.57（新值） | 5.17（新值） |
| 危险文本       | danger-ink / danger-soft      | 5.76（新值） | 5.04（新值） |
| 填充按钮       | on-accent / accent-fill       | 5.53（新值） | 6.24（新值） |
| 填充按钮 hover | on-accent / accent-fill-hover | 6.62（新值） | 8.03（新值） |
| 焦点环 / 图形  | accent / canvas               | 4.16（≥3）   | 5.99（≥3）   |
| 危险图形       | danger / surface              | 3.91（≥3）   | 5.17（≥3）   |

### 3.2 错误态：两套实现、零语义

- `packages/react/src/components/ErrorBoundary.tsx`：渲染期异常兜底，内联 markup，
  没有 `role`、没有焦点管理、根节点用 `h-screen`（移动端 100vh 会被浏览器栏裁切）。
- `packages/app/src/App.tsx:178-194`：初始化失败 overlay，另一套内联 markup，
  文案与样式和上面高度重复；条件为 `loading && initError`。
- 失败源：`Board.tsx:50-59` 捕获 `initialize` 拒绝后写 `initError`，此前只 console。
- 两处都只测了「文案 + 按钮存在」（`components.render.test.tsx:62-86`）。
- 详情文本没有长串换行/滚动约束；错误消息可能含 URL 或长 token。

### 3.3 390px：十二个面，覆盖极不均匀

| 面            | 机制                                                  | 现有覆盖             | 缺口                                                                            |
| ------------- | ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------- |
| 顶栏 / docId  | `truncate` + `min-w-0`                                | multiTab 390 用例    | 截断本身未断言                                                                  |
| 工具坞        | `max-w-[calc(100vw-16px)]` + `max-md:overflow-x-auto` | 无                   | 内部横滚/视口内/按钮尺寸；flex 默认 shrink，390 下可能压到 40 以下（M2 先测量） |
| 工具二级菜单  | portal + fixed + 视口 clamp                           | toolbar 390 用例     | 仅「可点」，未断言四边                                                          |
| 缩放胶囊      | `bottom-5 right-5`                                    | 无                   | 视口内、与工具坞不重叠                                                          |
| 项目菜单      | fixed + 水平 clamp                                    | projectFile 390 用例 | 无 `maxHeight`；小高度会越界                                                    |
| 存储面板      | fixed + 水平 clamp + `maxHeight`                      | storage 390 用例     | 已足够，本轮不重复                                                              |
| 只读提示条    | 顶部居中 + `max-w`                                    | multiTab 390 用例    | 已足够，本轮不重复                                                              |
| 选中操作栏    | 宽度实测 + 水平 clamp                                 | 无                   | 靠边选区、Popover 面板                                                          |
| 右键菜单      | 常量尺寸翻转                                          | 无                   | 右下/左上边缘翻转                                                               |
| 脑图 +/- 按钮 | 纯算术，无 clamp                                      | 无                   | **靠边节点按钮会出视口（主要缺陷）**                                            |
| 空画布提示    | 居中卡片                                              | 无                   | 无最大宽度，窄屏换行未断言                                                      |
| 错误 overlay  | 新组件                                                | 无                   | 见 A2                                                                           |

### 3.4 物理断网：单机不可达

- `NetworkService` 的 `blockOnOffline` 默认 false（`networkService.ts:20`）；
  组合根按 `!!config.wsUrl` 决定（`boardComposition.ts:334-336`）。
- app 壳从不传 `wsUrl`（`App.tsx:147-152` 只传 docId/editable/assetMaintenance），
  因此单机 `editBlocked$` 恒 false，`OfflineBar`（`App.tsx:177`）不可达。
- `OfflineBar.tsx:4` 注释写「单机模式提示条」，与实现/产品口径矛盾；本轮改注释与文档。
- 没有 `NetworkService` 单测；docs/21 §4 末尾仍写「另行收口」。

## 4. 设计决策

**D1 危险色按角色拆，不按深浅拆。**

`--spinth-danger` 继续表示图形/进度/圆点（对白底 3.91，满足 3:1）；新增
`--spinth-danger-ink` 专供文字与图标（浅色更深、深色保持品牌红）。不新增
`--spinth-danger-fill`：本仓没有「危险填充 + 白字」的合法用法，状态条改为
soft 底 + ink 字 + danger 描边，从根上消灭白字压红底。

**D2 填充按钮统一用 `accent-fill` + `on-accent`。**

`--spinth-accent` 是品牌色（焦点环、描边、图标），不作为白字底板。新增
`--spinth-accent-fill` / `--spinth-accent-fill-hover`，配既有 `--spinth-on-accent`。
不直接把 `--spinth-accent` 调暗：那会连带改动焦点环与品牌观感，且深色主题下
「越暗越对」并不成立。所有 `text-white` 从组件里消失。

**D3 三级文本一并修。**

浅色 `text-3` 在 `surface-hover` 上 4.46，深色在 `surface` 上 4.46、`surface-hover`
上 3.93——都是真实使用面（docId 胶囊、kbd、存储面板正文）。只调 `text-3` 的值，
不动层级结构：浅色 `#6f6f7f → #67677a`，深色 `#8b8b98 → #9c9ca9`。深色
`text-3` 与 `text-2` 的差距变小，但字号/字重仍承担层级，可接受；若实施后观感
不可接受，允许把 `text-2` 再提亮一档并补断言，但不允许放弃 4.5:1。

**D4 错误态收敛为 `ErrorState` 一个展示组件。**

放在 `@spinth/react`（与 ErrorBoundary 同包），纯展示、不读 store、不依赖 Icon；
ErrorBoundary 与 app 壳各自只决定标题/说明/详情/动作。ErrorBoundary 必须保留
class 组件形态（React 唯一 error boundary）。

**D5 错误态可访问性契约。**

- `role="alert"` 只设一次（容器），不再加 `aria-live`，避免双重播报；
- 标题 `<h1 tabIndex={-1}>` 挂载后 `focus({ preventScroll: true })`，读屏先读标题；
- 详情用 `<p>`，`overflow-wrap:anywhere` + `max-h-32 overflow-y-auto`，不暴露堆栈；
- 主按钮是唯一动作，Tab 可达；不做焦点陷阱（终态页面，没有「返回应用」语义）；
- 颜色不是唯一信息：标题文案已说明「失败/异常」。

**D6 错误态 E2E 用 `indexedDB` 注入，不加生产测试钩子。**

`page.addInitScript` 把 `window.indexedDB` 定义成抛错的 getter → `openDb` 的 Promise
立即 reject → `composeBoard` reject → `Board` catch → `initError`。不引入
`?__e2e=1` 之类的生产分支。若该注入在未来浏览器失效，退化为
`Object.defineProperty(window, 'indexedDB', { value: undefined })`（断言错误页
出现即可，不断言具体 message）。

**D7 颜色护栏放 E2E，不为一个断言新开 vitest 工程。**

颜色令牌只存在于 `packages/app/src/styles/tokens.css`，最终值由浏览器计算；
`packages/app` 目前没有 vitest 工程。新增工程只为读 CSS 属基础设施膨胀。
E2E 在 fast 层（CI gate）跑，足以拦截回退。对比度数学写成 e2e helper 的纯函数，
在 `a11y.spec.ts` 内使用；不用第三方库。

**D8 脑图按钮钳制抽纯函数。**

定位数学从 `MindAddButtons` 抽到 `mindAddLayout.ts`，输入节点 bounds + 槽位 +
可用区域，输出钳制后的槽位；组件只负责测量与渲染。纯函数进 react 现有 node
单测工程，覆盖四边与四向。

**D9 单机断网：不改行为，只固化不变量。**

不实现 `editBlocked` 矩阵（无可达路径），不删除 `OfflineBar`（协同宿主未来要用），
不把它从 app 壳摘掉（零成本且保持单机/协同同一套壳）。用「断言它不出现 + 断网仍可
编辑」把当前语义锁死；`wsUrl` 一旦进入启动路径，这个测试会先红，提醒补矩阵。

**D10 不引入 `viewport-fit=cover` / `env(safe-area-inset-*)`。**

Safari 默认已把布局视口收进安全区；开启 cover 需要重排顶栏/底部铬件并补一套安全区
测试，超出本批。作为移动端挂账记录，不在本批「顺手做」。

## 5. A1：语义色与对比度

### 5.1 令牌变更（`tokens.css`）

| 令牌                               | 浅色           | 深色           | 角色                |
| ---------------------------------- | -------------- | -------------- | ------------------- |
| `--spinth-danger-ink`（新）        | `#b42318`      | `#ff6369`      | 危险文字/图标       |
| `--spinth-accent-fill`（新）       | `#6a47f2`      | `#9d87ff`      | 填充按钮底          |
| `--spinth-accent-fill-hover`（新） | `#5b39e6`      | `#b3a1ff`      | 填充按钮 hover      |
| `--spinth-text-3`（改值）          | `#67677a`      | `#9c9ca9`      | 三级文本            |
| `--spinth-danger`                  | 保持 `#e5484d` | 保持 `#ff6369` | 图形/进度/圆点/描边 |
| `--spinth-accent`                  | 保持 `#7c5cfc` | 保持 `#9d87ff` | 品牌/焦点环         |

- `index.css` 的 `@theme inline` 增加 `--color-danger-ink`、`--color-accent-fill`、
  `--color-accent-fill-hover` 三行，顺序与 tokens 一致。
- `--spinth-on-accent` 已存在（浅 `#ffffff` / 深 `#17171e`），本批首次真正消费；
  `--spinth-accent-strong` 保留给宿主兼容，本仓迁移后不再有 `hover:bg-accent-strong`。
- 不在组件里写裸 hex；不为深色另写一套 class。

### 5.2 使用点迁移（逐条改，不留 `text-white`）

| 文件:行                       | 现状                                           | 改为                                                       |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `ErrorBoundary.tsx:27`        | `text-danger`                                  | `text-danger-ink`                                          |
| `ErrorBoundary.tsx:34`        | `bg-accent text-white`                         | `bg-accent-fill text-on-accent hover:bg-accent-fill-hover` |
| `App.tsx:182`                 | `text-danger`                                  | `text-danger-ink`                                          |
| `App.tsx:190`                 | `bg-accent text-white`                         | 同上（A2 后这段由 ErrorState 接管）                        |
| `ReadOnlyNotice.tsx:26`       | `bg-accent text-white`                         | `bg-accent-fill text-on-accent hover:bg-accent-fill-hover` |
| `StoragePanel.tsx:25`         | `bg-accent ... hover:bg-accent-strong`         | `bg-accent-fill ... hover:bg-accent-fill-hover`            |
| `StoragePanel.tsx:85/92/167`  | `text-danger`                                  | `text-danger-ink`                                          |
| `StorageStatusButton.tsx:127` | `bg-danger-soft text-danger hover:text-danger` | `bg-danger-soft text-danger-ink hover:text-danger-ink`     |
| `ContextMenu.tsx:149`         | `text-danger hover:bg-danger-soft`             | `text-danger-ink hover:bg-danger-soft`                     |
| `ContextMenu.tsx:155`         | `text-danger`（图标）                          | `text-danger-ink`                                          |
| `ActionBar.tsx:171`           | `hover:text-danger`                            | `hover:text-danger-ink`                                    |
| `ProjectMenu.tsx:321`         | `bg-accent text-white`                         | `bg-accent-fill text-on-accent hover:bg-accent-fill-hover` |
| `ProjectMenu.tsx:340`         | `text-danger`                                  | `text-danger-ink`                                          |
| `OfflineBar.tsx:14`           | `bg-danger text-white`                         | `border border-danger bg-danger-soft text-danger-ink`      |

迁移后全仓断言：`text-danger` 作为文字/图标色的用法清零（图标也改 `danger-ink`）；
`bg-danger` / `border-danger` 仍用于图形、进度与描边。`text-white` 在 `packages/react`、
`packages/app` 应清零（`packages/core` 的 canvas 绘制不用 Tailwind，不在范围内）。

### 5.3 对比度护栏（`e2e/a11y.spec.ts`）

断言读取 `getComputedStyle(document.documentElement).getPropertyValue(...)` 的**计算值**，
不读测试里的字面量。下表是当前预期值，供审查比对，不作为断言输入：

| 配对                          | 浅色  | 深色  | 阈值 |
| ----------------------------- | ----- | ----- | ---- |
| text-1 / canvas               | 15.89 | 14.67 | 4.5  |
| text-2 / surface              | 6.47  | 6.23  | 4.5  |
| text-3 / canvas               | 5.25  | 6.31  | 4.5  |
| text-3 / surface              | 5.53  | 5.53  | 4.5  |
| text-3 / surface-hover        | 5.00  | 4.87  | 4.5  |
| danger-ink / canvas           | 6.24  | 5.90  | 4.5  |
| danger-ink / surface          | 6.57  | 5.17  | 4.5  |
| danger-ink / danger-soft      | 5.76  | 5.04  | 4.5  |
| warning / warning-soft        | 4.51  | 8.12  | 4.5  |
| on-accent / accent-fill       | 5.53  | 6.24  | 4.5  |
| on-accent / accent-fill-hover | 6.62  | 8.03  | 4.5  |
| accent / canvas（非文字）     | 4.16  | 5.99  | 3    |
| danger / surface（非文字）    | 3.91  | 5.17  | 3    |

实际元素（真实 DOM，浅/深各跑一遍）：

- docId 胶囊：`text-ink-3` on `bg-surface-hover`（旧值 4.46/3.93 的实锤面）；
- 工具坞未激活按钮：`text-ink-2` on `bg-surface`；
- 右键菜单：kbd 的 `text-ink-3` on `bg-surface-hover` + 「删除」项的
  `text-danger-ink` on 菜单 surface；
- 错误态：标题 `text-danger-ink` on canvas、主按钮 `text-on-accent` on `accent-fill`。

helper 必须同时解析 `#rgb` / `#rrggbb` 与 `rgb()` / `rgba()`：CSS 自定义属性经
`getPropertyValue` 返回的是原样 token，元素 `color`/`backgroundColor` 返回的是 `rgb()`。
不支持 alpha（当前所有断言面都是不透明色）；遇到 alpha 直接红，不静默近似。

任一项低于阈值即红，错误消息必须打印两个颜色值、比值与元素 selector。

### 5.4 视觉影响

四张视觉快照的 clip 都只覆盖 canvas（`visual.spec.ts:21`），DOM 铬件不在内，因此
本批**不应**产生快照差异。仍需跑一次确认；若出现差异，按「先解释根因（是否动了
canvas 底色/点阵/默认文字色）再更新基线」处理，不得直接 `--update-snapshots`。

## 6. A2：共享错误态

### 6.1 组件契约

新增 `packages/react/src/components/ErrorState.tsx`，从 `packages/react/src/index.ts` 导出。

```tsx
interface IErrorStateProps {
  kind: 'init' | 'render';
  title: string;
  description?: string;
  detail?: string;
  actionLabel: string;
  onAction: () => void;
}
```

结构（class 名称是建议值，语义标记是硬要求）：

```tsx
<section
  role="alert"
  data-spinth-error-state=""
  data-spinth-error-kind={kind}
  className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-y-auto bg-canvas p-6 text-center"
>
  <h1
    ref={headingRef}
    tabIndex={-1}
    data-spinth-error-heading=""
    className="text-sm font-semibold text-danger-ink"
  >
    {title}
  </h1>
  {description && <p className="max-w-md text-xs leading-5 text-ink-3">{description}</p>}
  {detail && (
    <p
      data-spinth-error-detail=""
      className="max-h-32 max-w-md overflow-y-auto rounded-md bg-surface px-3 py-2 text-left text-[11px] leading-4 text-ink-3 [overflow-wrap:anywhere]"
    >
      {detail}
    </p>
  )}
  <button
    type="button"
    onClick={onAction}
    className="rounded-md bg-accent-fill px-4 py-1.5 text-xs font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover"
  >
    {actionLabel}
  </button>
</section>
```

焦点：`useEffect(() => headingRef.current?.focus({ preventScroll: true }), [])`。
组件不读 store、不接 Icon、不引路由；父层负责尺寸（`h-dvh` 或 `absolute inset-0`）。

### 6.2 两个接入点

- `ErrorBoundary`：返回
  `<div className="h-dvh w-full bg-canvas"><ErrorState kind="render" title="页面出现异常" detail={message} actionLabel="重新加载" onAction={() => window.location.reload()} /></div>`。
  保留 `componentDidCatch` 的 console 记录；保留 class 形态。
- `App`：`loading && initError` 分支改为
  `<div className="absolute inset-0 z-10 bg-canvas"><ErrorState kind="init" title="画布初始化失败" description="浏览器存储不可用（私密模式 / 配额满）时无法恢复本地画布，可清理站点数据后重试" detail={initError} actionLabel="重试" onAction={() => window.location.reload()} /></div>`。
  文案顺序从「标题→详情→建议」改为「标题→建议→详情」，内容不变。

### 6.3 单测（`components.render.test.tsx`）

- `ErrorState`：`role="alert"`；标题/说明/详情都在；`document.activeElement` 是标题；
  点主按钮触发 `onAction`；`detail` 为空时不渲染 `[data-spinth-error-detail]`。
- `ErrorBoundary`：现有断言保留（「页面出现异常」+ message + 「重新加载」），追加
  `host.querySelector('[role="alert"]')` 非空。
- `OfflineBar`：保留既有渲染断言；可加 class 断言（soft 底）但不要锁死整串 class。

### 6.4 E2E（`a11y.spec.ts`）

注入与断言：

```ts
await page.addInitScript(() => {
  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    get() {
      throw new DOMException('IndexedDB blocked (e2e)', 'InvalidStateError');
    },
  });
});
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`/?doc=${docId}`);
const state = page.locator('[data-spinth-error-state]');
await expect(state).toBeVisible({ timeout: 20_000 });
await expect(state).toHaveAttribute('role', 'alert'); // 用 getByRole('alert') 亦可
await expect(page.getByRole('heading', { name: '画布初始化失败' })).toBeFocused();
await expect(page.locator('[data-spinth-error-detail]')).toContainText('IndexedDB blocked');
await expect(page.getByText('正在恢复画布…')).toHaveCount(0);
```

再断言：错误卡四边在 390×844 内；`document.documentElement.scrollWidth <= 390`；
标题/主按钮的实测对比度 ≥4.5（复用 A1 helper）；切 `data-theme='dark'` 后重复颜色
断言（DOM 计算样式即时生效，不必 reload）。

## 7. A3：390px 布局矩阵

### 7.1 稳定选择器（只加属性，不改行为）

| 面                                                                        | 新增/既有标记                             |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| 工具坞                                                                    | 新增 `data-spinth-toolbar`                |
| 缩放胶囊                                                                  | 新增 `data-spinth-zoom`                   |
| 脑图 +/-                                                                  | 每个按钮新增 `data-spinth-mind-add={key}` |
| docId 胶囊                                                                | 新增 `data-spinth-doc-id`                 |
| 空画布提示                                                                | 新增 `data-spinth-empty-hint`             |
| 离线提示条                                                                | 新增 `data-spinth-offline-bar`            |
| 错误态                                                                    | 见 §6                                     |
| 二级菜单 / 操作栏 / Popover / 右键菜单 / 项目菜单 / 存储面板 / 只读提示条 | 已有 `data-spinth-*`，直接用              |

规格：E2E 不得用 Tailwind class 选择器定位上述面；新增标记统一加在根节点上
（脑图按钮除外）。

### 7.2 公共助手（`e2e/helpers/layoutE2e.ts`）

- `MOBILE = { width: 390, height: 844 }`；
- `openBoard(page, docId)`：`goto` + 等 `__spinth` synced + `document.fonts.ready` +
  两帧 rAF（几何稳定）；
- `boxWithin(locator, viewport, pad = 0)`：`boundingBox()` 为 null 直接抛带 selector
  的错误；断言 `x >= pad`、`y >= pad`、`x+w <= width-pad`、`y+h <= height-pad`，
  容差 0.5px；
- `noDocHScroll(page)`：`documentElement.scrollWidth <= innerWidth` 且 `body` 同；
- `intersects(a, b)`：矩形相交判定（工具坞 vs 缩放胶囊）；
- `minTarget(locator, 24)`：WCAG 2.2 AA 2.5.8 下限 24×24；**不要求 44**。工具坞另
  要求 40×40（设计目标，见 M2）。

### 7.3 用例（`e2e/mobile.spec.ts`，`test.use({ viewport: MOBILE })`）

| #   | 面               | 断言                                                                                                                                                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | 壳层             | 用 24 字符 docId：header 高 44；无文档横滚；docId 胶囊 `scrollWidth > clientWidth`（确实截断）；所有顶栏按钮 ≥24（存储状态按钮现高约 20，需 `min-h-6`）                                                 |
| M2  | 工具坞           | 坞四边在视口内；坞内按钮实测：<32 视为被压缩（预期红）；修成 40×40 且 `scrollWidth > clientWidth`（390 横滚是 docs/12 的口径）；文档不横滚。若产品决定改为压缩，先改 docs/12 与阈值                     |
| M3  | 二级菜单         | 打开矩形工具二级菜单：面板四边在视口内（pad 8）、顶边 ≥44；点「椭圆」后 `aria-checked` 转移且面板仍在视口内                                                                                             |
| M4  | 缩放胶囊         | 四边在视口内；与工具坞矩形不相交；点放大后百分比文本变化                                                                                                                                                |
| M5  | 项目菜单         | 390×844：四边在视口内（右 ≤382、下 ≤836）、计算样式 `maxHeight` 有限且 `overflowY` 可滚；Escape 关闭且焦点回按钮。改 390×480 重开：下边 ≤472，内容超高时 `scrollHeight > clientHeight` 且末项可滚到可见 |
| M6  | 右键菜单         | 视口右下角（宽−10、高−10）右键：四边在视口内；左上画布角（10、header 高+10）右键：`x >= 0`、`y >= 44`；两处都可点「适应屏幕」                                                                           |
| M7  | 操作栏 + Popover | 画布右下建形并选中：`[data-spinth-action-bar]` 四边在视口内；打开第一个 `[data-spinth-popover]` 触发钮，`[data-spinth-popover-panel]` 四边在视口内                                                      |
| M8  | 脑图 +/-         | 在画布右缘左侧约 90px 处建根（坐标由 canvas box 推导）并点根聚焦：`[data-spinth-mind-add]` 数量 ≥2、每个 28×28 且四边在视口内                                                                           |
| M9  | 空画布提示       | 新文档：`[data-spinth-empty-hint]` 四边在视口内、宽度 ≤ `100vw-32px`                                                                                                                                    |

不复制的面：只读提示条（`multiTab.spec` 390 用例）、存储面板（`storage.spec` 390
用例）、项目文件 390（`projectFile.spec`）。本批只在 helper/文档里引用，避免双份
维护。

### 7.4 先跑后修：预计要修的五处

1. **工具坞被压扁（必修，先测量）**：坞是 `left-1/2` 的绝对定位 flex 容器，宽度走
   shrink-to-fit；`max-w` 不是宽度，加上按钮默认 `flex-shrink:1`，390 下可用宽度只有
   半个视口，12 个工具会被压到 ~20px。修法：坞加 `w-max`（宽度取 max-content，再由
   `max-w` 封顶），每个工具/动作按钮加 `shrink-0`，`max-md:overflow-x-auto` 保留。
   目标：按钮 40×40、坞内横滚、文档不滚。若实测本来就溢出，则只补断言。
2. **存储状态按钮高度**：`StorageStatusButton.tsx:125` 的 `py-0.5 + text-xs` 实测约 20px，
   低于 WCAG 2.2 AA 的 24×24。加 `min-h-6`（24px）即可，不改字号与宽度。
3. **脑图 +/- 越界（必修）**：`MindAddButtons` 现在直接输出 `slotLeft - BTN - GAP` /
   `slotRight + GAP`，无边界。抽 `mindAddLayout.ts`：
   ```ts
   export function buildMindAddSlots(input: {
     bounds: { x: number; y: number; width: number; height: number };
     isRoot: boolean;
     direction: 'left' | 'right';
     slotLeft: number;
     slotRight: number;
     area: { width: number; height: number };
   }): Array<{ key: 'left' | 'right' | 'sibling'; left: number; top: number }>;
   ```
   每个 `left/top` 钳到 `[4, area - BTN - 4]`；语义不变（左槽仍是左子，不做左右翻转，
   避免按钮语义与位置矛盾）。组件用 `useLayoutEffect` 量父容器（`main`）尺寸，
   首帧兜底 `window.innerWidth / window.innerHeight`；量到后同步 setState。
   单测覆盖：四边钳制、根/非根、左/右/同级槽位数量、居中不位移。
4. **项目菜单纵向越界（防御性加固）**：`ProjectMenu.tsx:118-128` 的 `panelStyle` 补
   `maxHeight: calc(100dvh - top - 8px)` + `overflowY: 'auto'`（照抄
   `StorageStatusButton.tsx:30-37` 的既有做法）。默认内容在 844/480 高度都放得下，
   本项是为 warning/导入确认叠加后的内容增长兜底，M5 同时作为回归。
5. **空画布提示宽度（便宜就修）**：`App.tsx:165` 卡片加
   `max-w-[calc(100vw-32px)]`，让 320~390 下文案换行而不是溢出。

若 M1–M9 暴露其它越界，同批修；修不了的（需要重排版）在本文件 §12 记录并给出
挂账理由，不允许把断言放宽成「只要有 box 就算过」。

## 8. A4：单机断网不变量

### 8.1 结论

单机模式**不做** `editBlocked` 交互矩阵：没有 `wsUrl` 就没有阻断路径。要做的是把
「不可达 + 离线可编辑」变成测试，并把 docs 的口径改对。

### 8.2 core 单测（`networkService.test.ts`，jsdom）

- 默认构造 + `navigator.onLine=false` → `editBlocked$.value === false`；
- `blockOnOffline:true` + 离线 → true；派发 `online` → false；再 `offline` → true；
- `dispose()` 后派发事件不再改值（监听已摘）。

### 8.3 E2E（`smoke.spec.ts` 追加一例）

```ts
await context.setOffline(true);
expect(await page.evaluate(() => navigator.onLine)).toBe(false);
// 建一个矩形 → modelCount 1；撤销 → 0；persisted(page) 仍为 saved
// `[data-spinth-offline-bar]`、`[data-spinth-readonly-pill]` 均为 0
await context.setOffline(false);
```

边界：项目没有 Service Worker，**不要**在断网时 reload 验证「刷新恢复」——那会
加载不到 Vite 资源，测的是网络不是产品。刷新恢复已有离线语义由 IndexedDB 保证，
不在本用例内。

### 8.4 文档

- `docs/10 §4`：改写为「单机不传 `wsUrl` → `blockOnOffline=false` → `editBlocked` 恒
  false；断网仍可编辑、撤销；**有网刷新后**从 IndexedDB 恢复（无 Service Worker，
  离线首开/刷新不在支持范围）；离线可编辑有 E2E 回归」——重点是消掉原句「刷新恢复」
  容易被读成「断网刷新也能恢复」的歧义。
- `docs/21 §4` 末尾：把「另行收口」改成上述事实 + 「`OfflineBar` 仅协同宿主可达」。
- `docs/12 §4` 组件表 `OfflineBar` 行：注明「协同宿主用；单机不可达」。
- `docs/13 §3` 决策台账加一条：单机 `editBlocked` 不可达，矩阵留到协同批。

### 8.5 部署边界（GitHub Pages）

A4 不改变部署形态：仍是纯静态 SPA，Pages 仍用 `SPINTH_BASE=/<repo>/` 构建
（`.github/workflows/pages.yml`）；A4 的 spec/e2e 不进 `dist`，不新增依赖、不加
Service Worker、不改 `base` / `siteBase`。因此「有网打开 → 断网继续编辑」在 Pages 上
成立；「断网首开 / 断网刷新」仍不支持（现状如此，不是 A4 引入）。若未来要补，
Service Worker 需同时处理 Pages 子路径 scope、缓存版本与 CSP，另立 spec。

## 9. 实施顺序（每步可独立回滚）

| 步  | 内容                                                                          | 主要文件                                                                                                               | 门禁                                |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | A1 令牌 + 映射 + 使用点迁移 + 对比度 E2E                                      | `tokens.css`、`index.css`、九个使用点文件、`a11y.spec.ts`、`helpers/a11yE2e.ts`                                        | `pnpm verify` + `a11y.spec`         |
| 2   | A2 `ErrorState` + 两处接入 + 单测 + 错误 E2E                                  | `ErrorState.tsx`、`ErrorBoundary.tsx`、`App.tsx`、`index.ts`、两个测试文件                                             | `pnpm verify` + `a11y.spec`         |
| 3   | A3 标记 + helper + mobile 用例（先跑，记录红项）                              | 组件标记、`layoutE2e.ts`、`mobile.spec.ts`                                                                             | `mobile.spec`（允许红，红项进 §12） |
| 4   | A3 修复（工具坞 shrink、存储按钮 24、脑图钳制、项目菜单 maxHeight、提示宽度） | `Toolbar.tsx`、`StorageStatusButton.tsx`、`mindAddLayout.ts`、`MindAddButtons.tsx`、`ProjectMenu.tsx`、`App.tsx`、单测 | `pnpm verify` + `mobile.spec` 全绿  |
| 5   | A4 单测 + E2E + docs                                                          | `networkService.test.ts`、`smoke.spec.ts`、docs                                                                        | 定向 E2E + `pnpm verify`            |
| 6   | 文档与数字收尾                                                                | docs/12/13/15/21、AGENTS                                                                                               | `pnpm verify`                       |

建议提交粒度：1 与 2 可合并为「可访问性」一笔；3 与 4 分开（测试红 → 修复绿，审查
能看出先后）。提交信息用现有前缀：`feat|fix|test|docs: 中文描述`。

## 10. 验收与门禁

```bash
pnpm verify
pnpm test:e2e
# 视觉确认（基线固定环境）：
E2E_VISUAL_CHANNEL=bundled npx playwright test --grep "@visual"
```

逐条对照 §1：

- [ ] A1：E2E 打印的每个配对 ≥ 阈值；全仓 `text-white` 清零、文字色不再用 `text-danger`
- [ ] A2：错误态 role/focus/detail/对比度/390 全过；`ErrorBoundary` 单测仍绿
- [ ] A3：M1–M9 全绿；工具坞按钮 40×40 且内部横滚可滚；存储状态按钮 ≥24；脑图钳制单测覆盖四边
- [ ] A4：`NetworkService` 单测 + 断网 E2E 绿；docs 口径更新（含消掉「刷新恢复」歧义、注明 Pages 部署边界）
- [ ] 视觉 4/4 不变（或差异有根因说明）
- [ ] 测试数/spec 数按实测写回 `docs/15`、`docs/13`、`AGENTS.md`
- [ ] `pnpm hygiene` 绿；specs 不含本机路径/用户名/邮箱
- [ ] 没有新增依赖；`package.json` 无 diff（若必须新增，先停下来问）

## 11. 审查清单（设计者验收用）

1. **颜色**：tokens 两套都加/改了吗？`@theme inline` 映射齐全吗？有没有组件继续写
   `text-white` / 裸 hex？`text-danger` 是否只剩图形语义？
2. **数值**：E2E 打印的是计算值还是硬编码？改动令牌后测试会不会跟着改常量一起
   「自洽地绿」？（必须读 CSSOM，不能读测试常量。）
3. **错误态**：`role="alert"` 是否只有一个？标题是否真的 `document.activeElement`？
   详情是否是错误 message 而非堆栈？长串在 390 下是否 `overflow-wrap:anywhere`？
   `ErrorBoundary` 是否仍是 class？
4. **移动端**：断言是否只用 `data-spinth-*`，没有 class 选择器？坐标是否从 canvas
   box/探针推导，而不是手写？是否等过字体与两帧 rAF？
5. **先红后绿**：§12 是否有 M3–M9 的失败清单与修复对应关系？旧实现跑新用例是否
   会红（至少脑图一条要能复现）？
6. **断网**：E2E 是否断言了 `navigator.onLine === false` 这个前置条件？有没有偷偷
   在断网时 reload？`OfflineBar` 是否仍保留、只是不可达？
7. **边界**：有没有动 `dataEngine`/`vmEngine`/指针分发？有没有为测试加生产开关？
   有没有引入 44×44 的强制改版或 `viewport-fit=cover`？
8. **数字**：单测/spec/用例数是否实测？`docs/15` 与 `AGENTS.md` 是否一致？
9. **视觉**：快照是否真的没变？若变了，理由是否只指向 DOM 而非 canvas？
10. **卫生**：`pnpm hygiene` 绿；spec 内无本机绝对路径、用户名、邮箱、外部项目名。

## 12. 实施记录（实施 agent 填写）

> 只记事实与证据，不写流水账。审查后保留。

| 项          | 结论 / 证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 实测比值 | E2E 全绿（a11y.spec 令牌矩阵 ×2 + 实际元素 ×2）。关键修复值：浅 text-3/surface-hover 5.00（原 4.46）、深 text-3/surface-hover 4.87（原 3.93）、danger-ink/danger-soft 5.76/5.04、on-accent/accent-fill 5.53/6.24、on-accent/accent-fill-hover 6.62/8.03；图形线 accent/canvas 4.16/5.99、danger/surface 3.91/5.17（≥3）。实际元素面（docId 胶囊、工具坞未激活钮、右键菜单 kbd 与删除项）全过                                                                                                                                                                                                                                                                           |
| A3 先跑红项 | 五项（`mobile.spec --retries 0` 旧代码实测）：M1 存储状态按钮高 20 < 24；M2 工具坞按钮 #9 宽 17.97 < 40（flex 压缩实锤）；M5 项目菜单 `maxHeight=none`（无纵向兜底）；M7 ActionBar 右缘 391 > 390（栏宽 383 > 可用 374，clamp 无退让——spec 预判外新发现）；M8 脑图 +/- 右缘 612 > 390（主缺陷实锤）。M3/M4/M6/M9 首跑即绿                                                                                                                                                                                                                                                                                                                                              |
| A3 修复     | 七处：① 工具坞 `w-max` + 按钮与分隔线 `shrink-0`（40×40 + 坞内横滚 + 文档不滚）；② 存储状态按钮 `min-h-6`；③ `mindAddLayout.ts` 纯函数钳制（[4, area-BTN-4]，8 单测覆盖四边/根非根/槽位/极端值）+ 组件 useLayoutEffect 量 `<main>`；④ ProjectMenu `maxHeight: calc(100dvh - top - 8px)` + `overflowY: auto`；⑤ 空画布提示 `max-w-[calc(100vw-32px)]`；⑥ ActionBar `max-w-[calc(100%-16px)]`（新发现：不加 overflow——Tooltip 是 absolute 子元素会被轴联动裁掉）；⑦ PopoverControl 钳制改「先 min 上界再 max 下界」+ 面板 `w-max max-w flex-wrap`（新发现：面板宽于视口时旧顺序取负坐标 -272；shrink-to-fit 的 min-content 只有一个按钮宽导致竖排 650px 高）。M1–M9 全绿 |
| A4 断网     | 单测 4 例（默认离线不阻断 / blockOnOffline 三态翻转 / 构造即离线初值 true / dispose 摘监听）；E2E：`navigator.onLine === false` 前置断言 → modelCount 0→1（创建）→0（撤销）→ persistState saved → `[data-spinth-offline-bar]`/`[data-spinth-readonly-pill]` 均 0；断网中未 reload                                                                                                                                                                                                                                                                                                                                                                                      |
| 测试计数    | 单测 895（core 869 + react 26）；E2E 20 spec / 186 用例全绿（smoke 6、a11y 6、mobile 9 为本批新增/扩展）；视觉 4/4 不变                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 视觉基线    | 无差异（四张快照 clip 只裁 canvas，本批只动 DOM 铬件与令牌——canvas 底色/点阵/默认文字色令牌未变）。实跑环境为 macOS 系统 Chrome：§10 的 bundled 环境在本机 macOS 13 无法安装 chromium 1248（Playwright 不支持 mac13，非本批引入），与既往基线环境一致                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 未决        | 无。挂账七项进 docs/13 §3（右键键盘协议、tool-soft 对比度、200% 缩放/安全区、Service Worker、协同 editBlocked 矩阵、屏读巡检、Linux 基线）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 附注        | 步骤 0 额外修复：`readonlyGate.test.tsx` 改名 `readonlyGate.render.test.tsx`——原文件名不匹配 vitest include（`*.render.test.tsx`），是没在跑的孤儿测试（docs/15 曾记 react 16 例与实际 9 例不符）；恢复拾取后 7 例全绿（无回归）                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 13. 文档同步清单

| 文件        | 位置        | 写什么                                                                                                     |
| ----------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `docs/12`   | §4 组件表   | 加 `ErrorState`；`OfflineBar` 注「单机不可达」                                                             |
| `docs/12`   | §5 令牌     | 三个新令牌 + `text-3` 新值 + 角色分工（danger 图形 / danger-ink 文字）                                     |
| `docs/12`   | §6 启动链路 | 错误态第 4 步补语义（role/焦点/详情）与 390 行为                                                           |
| `docs/12`   | 移动端段    | 390 矩阵覆盖范围与 `mobile.spec` 锚点                                                                      |
| `docs/21`   | §4 末尾     | 单机 `editBlocked` 不可达；矩阵留到协同批                                                                  |
| `docs/10`   | §4          | `wsUrl` → `blockOnOffline` 机制与不变量；「刷新恢复」改为「有网刷新后从 IndexedDB 恢复（离线刷新不支持）」 |
| `docs/15`   | §2 基线     | 单测/spec/用例数；新增 a11y/mobile 专项一行                                                                |
| `docs/13`   | §2 P2       | 勾掉三项；§3 加两条决策（颜色角色、单机断网）                                                              |
| `AGENTS.md` | 当前状态    | 测试数/用例数、下一阶段表述                                                                                |

## 14. 挂账（本批不做，写进 docs/13）

- 右键菜单键盘协议（方向键/roving focus/焦点归还）。
- 工具音色图标对 soft 底的对比度（八组 tool tone）。
- 200% 文本缩放与安全区（`viewport-fit=cover` + `env(safe-area-inset-*)`）。
- Service Worker / PWA 离线首开与刷新（Pages 子路径 scope + 缓存版本 + CSP）。
- 协同宿主下的 `editBlocked` 交互面矩阵（等 `wsUrl` 进入启动路径）。
- 屏读全量巡检（表单/画布可访问名、画布内容替代文本）。
- Linux 视觉基线（既有挂账，不在本批）。
