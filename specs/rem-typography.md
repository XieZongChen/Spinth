# 字号单位迁移（px → rem）技术方案

> 状态：设计定稿，待实施。执行者按 §9 批次落地，实测数字回填 §12；设计自审见 §13。
> 关联：[specs/a11y-closeout.md](a11y-closeout.md) §13.5-3、[docs/13](../docs/13-roadmap.md) §3.1、
> [docs/12](../docs/12-ui-layer.md) §5、[docs/15](../docs/15-testing.md) §3。

## 0. 结论摘要

| #   | 议题   | 结论                                                                  | 决策 |
| --- | ------ | --------------------------------------------------------------------- | ---- |
| 1   | 迁移面 | 全仓 46 处文本尺寸中 33 处已是 rem，真正要迁的只有 **13 处 px**       | D3   |
| 2   | 单位制 | 字号一律 rem（1/16 精确分数），禁止 em / vw / clamp()                 | D1   |
| 3   | 根字号 | 显式 `html { font-size: 100% }`：rem 跟浏览器默认字号，任何地方不写死 | D1   |
| 4   | 令牌   | 新增 4 个令牌（10/11/13/15）；12px 两处保留任意值以免改行高           | D2   |
| 5   | 行高   | 新令牌**不带** line-height（现状 `text-[13px]` 只输出 font-size）     | D2   |
| 6   | 容器   | 34px 定高行 → rem 最小高；216px 菜单宽 → rem + 视口上限               | D4   |
| 7   | 定位   | CSS/JS 双源常量失效：改为「常量初值 + 挂载后测量同帧再夹取」          | D5   |
| 8   | 边界   | 画布世界单位、DOM 文本编辑层、交互几何保持 px（清单见 §4.7）          | D6   |
| 9   | 护栏   | `scripts/check-font-units.mjs` 进 `pnpm verify` 与 CI gate            | D7   |
| 10  | 验收   | 1x 逐像素不变（computed style 精确到 0.5px）+ 200% 文本无裁切/无重叠  | §7   |

## 1. 目标与非目标

### 1.1 目标

1. **WCAG 1.4.4 文本缩放**：浏览器默认字号调到 200%（根字号 16 → 32px）时，
   全部铬件文本随之放大，不裁切、不重叠、不撑出视口、页面不横向滚动。
2. **单一单位制**：铬件字号只有一种单位（rem）；任何 px 字号都会被脚本拦截。
3. **1x 零漂移**：根字号 16px 时渲染与今天逐像素一致（视觉基线零 diff、
   E2E 几何断言不改）。
4. **可维护**：新增/改字号有明确落点（令牌或既有 Tailwind 刻度），不再出现
   "13px 与 12px 混排、缩放时层级反转"。

### 1.2 非目标

- **不做字号阶梯归一**：10/11/13/15 与 Tailwind 的 12/14 并存是现状设计，
  归一到 4/8 阶梯会改观感，属产品决策，另案（§4.10）。
- **不动画布文字**：文档 `fontSize` 是世界单位数据，PIXI 渲染，缩放由视口
  zoom 承担；rem 在 canvas 里没有意义（§4.7）。
- **不动 DOM 文本编辑层**：`richTextEditor` / `plainTextKernel` 必须以 px
  对齐画布 WYSIWYG，改 rem 会与 PIXI 字号错位（§4.7）。
- **不动图标尺寸**：图标是图形不是文本；1.4.4 不要求。已知 200% 下图标相对
  变小（现状即如此，本批不引入回归），列为可选后续（§13.4）。
- **不动断点**：`max-[379px]` 等媒体查询保持 px——媒体查询里的 rem/em 按
  浏览器**初始**字号解析，不是根元素字号，改单位会改变断点语义。
- **不动 1px 描边/阴影/圆角**：物理栅格与视觉规格，与字号无关。
- **不把间距改回 px**：Tailwind 间距本身就是 rem（§2.4），200% 时铬件整体放大——
  这与 1.4.4 不冲突，且等价于窄视口场景（Z1 720×450 已覆盖）。只放大字号、
  不同步容器，反而会让比例失衡。
- **不引入依赖、不改主题色、不改 Yjs 数据、不改公开 API**。

## 2. 现状与约束

### 2.1 待迁移清单（13 处）

行号为撰写时定位锚点，实施按内容匹配（文件行号会漂移）；路径前缀
`react/` = `packages/react`，`app/` = `packages/app`。

| #   | 文件:行                                    | 现值          | 目标             | 角色                     |
| --- | ------------------------------------------ | ------------- | ---------------- | ------------------------ |
| 1   | `react/src/components/OfflineBar.tsx:17`   | `text-[12px]` | `text-[0.75rem]` | 离线状态条               |
| 2   | `react/src/components/ErrorState.tsx:58`   | `text-[11px]` | `text-2xs`       | 错误详情（含 leading-4） |
| 3   | `react/src/components/Tooltip.tsx:53`      | `text-[11px]` | `text-2xs`       | 悬停提示                 |
| 4   | `react/src/components/ContextMenu.tsx:233` | `text-[13px]` | `text-md`        | 右键菜单项（定高行）     |
| 5   | `react/src/components/ContextMenu.tsx:248` | `text-[10px]` | `text-3xs`       | 快捷键徽标 kbd           |
| 6   | `app/src/ReadOnlyNotice.tsx:22`            | `text-[13px]` | `text-md`        | 只读提示主文案           |
| 7   | `app/src/App.tsx:98`                       | `text-[15px]` | `text-brand`     | 品牌词标 spinth          |
| 8   | `app/src/App.tsx:228`                      | `text-[13px]` | `text-md`        | "正在恢复画布…"          |
| 9   | `app/src/StoragePanel.tsx:68`              | `text-[13px]` | `text-md`        | 存储面板标题             |
| 10  | `app/src/StoragePanel.tsx:178`             | `text-[11px]` | `text-2xs`       | 存储说明                 |
| 11  | `app/src/StoragePanel.tsx:198`             | `text-[11px]` | `text-2xs`       | 存储脚注                 |
| 12  | `app/src/pwa/PwaUpdateBanner.tsx:49`       | `text-[12px]` | `text-[0.75rem]` | 更新横幅                 |
| 13  | `app/src/ProjectMenu.tsx:251`              | `text-[13px]` | `text-md`        | 项目菜单项（定高行）     |

统计：15px ×1、13px ×5、12px ×2、11px ×4、10px ×1 = 13 处。其中 11 处落到
4 个新令牌，2 处 12px 走任意值 `text-[0.75rem]`（理由见 §4.3 的"12px 陷阱"）。

### 2.2 已达标、本批不许动的 33 处

| 类        | 数量 | 位置                            | 说明                                   |
| --------- | ---- | ------------------------------- | -------------------------------------- |
| `text-xs` | 31   | 顶栏/面板/坞/flyout/空态/错误态 | Tailwind 默认 `0.75rem` + 行高 1.3333  |
| `text-sm` | 2    | `ErrorState` 标题、空画布提示   | Tailwind 默认 `0.875rem` + 行高 1.4286 |

这两档**已经是 rem**，且带 Tailwind 的行高变量。它们不是迁移对象；改动会
破坏 1x 零漂移（行高变化），并让 31 处文本进入本批审查面。

### 2.3 代码地图

| 文件                                             | 现状                                    | 本方案改动                                      |
| ------------------------------------------------ | --------------------------------------- | ----------------------------------------------- |
| `app/src/index.css`（165 行）                    | `@theme inline` 映射颜色；无字号令牌    | +4 个 `--text-*`；+ `html { font-size: 100% }`  |
| `react/src/components/ContextMenu.tsx`（257 行） | 行 `h-[34px]`、宽 `w-[216px]`、常量夹取 | 行改 min-h、宽改 rem + 上限；抽定位纯函数并测量 |
| `app/src/ProjectMenu.tsx`（382 行）              | 菜单项 `h-[34px]`                       | 改 min-h                                        |
| `react/src/components/ActionBar.tsx`             | 只测宽，翻转用 `BAR_HEIGHT_EST=40`      | 补测高，取 `max(measured, EST)`                 |
| `react/src/components/actionBarLayout.ts`        | `computeBarLayout` 无高度入参           | 可选 `barH` 入参（默认 EST，1x 不变）           |
| `react/src/components/Tooltip.tsx`（65 行）      | `whitespace-nowrap` 定宽不折行          | `w-max` + `max-w`，超宽折行                     |
| 上表 13 处调用点                                 | 见 §2.1                                 | 换令牌                                          |
| `scripts/check-font-units.mjs`（新增约 120 行）  | 不存在                                  | 新护栏；接入 verify + CI                        |
| `packages/app/e2e/textScale.spec.ts`（新增）     | 不存在                                  | 1x 精确性 / 200% 矩阵                           |

### 2.4 关键事实（实施前必须知道）

1. **Tailwind v4 的间距本来就是 rem**：构建产物 `--spacing:.25rem`，
   `p-1.5` 编译为 `calc(var(--spacing) * 1.5)`。所以 200% 根字号下，顶栏
   （`2.75rem`）、按钮盒、间距、圆角**今天就会整体放大**；唯独 13 处 px
   字号不动——这才是"层级反转"的根因。
2. **根元素没有 font-size 声明**：`index.html` 与 `index.css` 都没有，
   rem 取浏览器默认（16px）。preflight 另有
   `html{line-height:1.5;-webkit-text-size-adjust:100%}`。
3. **`text-[13px]` 只输出 font-size**：构建产物里该档只声明 `font-size: 13px`，
   不含 line-height（行高继承 1.5）。令牌若带 line-height 会改布局——必须保持"只给字号"。
4. **`text-xs` 带行高**：`.text-xs` 声明 `font-size:var(--text-xs)` 与
   `line-height:var(--text-xs--line-height)`，其中
   `--text-xs--line-height:calc(1/.75)`。把 12px 任意值换成 `text-xs`
   会改行高（§4.3）。
5. **CSS/JS 双源**：`ContextMenu.tsx:16-19` 的 `MENU_W=216`、`ITEM_H=34`、
   `DIVIDER_H=9` 与 CSS 类名里的 216/34 是同一组数字的两份拷贝；
   `menuH` 估算还硬编码了 `+12`（上下 py-1.5）与 `+2`（边框）。
6. **视觉基线只截画布**：5 张基线（delay-tall / theme-light / theme-dark /
   marks-render / rotate-45）的 clip 全在画布区域，**拍不到 chrome**。
   视觉零 diff 只能证明"没有波及画布"，不能证明"铬件没变"。
7. **现有 Z2 只覆盖空态**：`a11yLayout.spec.ts:85-107` 注入
   `html{font-size:200%}` 后只断言空画布提示不裁字、坞在视口、无横滚；
   菜单、面板、提示条全未覆盖。
8. **整数 px 在 rem 里是精确值**：16 = 2⁴，任何整数 px 除以 16 都是有限小数
   （10→0.625、11→0.6875、13→0.8125、15→0.9375），不存在舍入误差。

### 2.5 现状缺陷（实施前先跑红留证据）

| #   | 缺陷                        | 证据（算术）                                                                                 |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- |
| F1  | 200% 下字号层级反转         | 根字号 32px：`text-xs` 12→**24px**，`text-[13px]` 仍是 **13px**——菜单项比 docId 胶囊还小     |
| F2  | 只改字号会造出新缺陷        | 13px→26px 后行盒 = 26×1.5 = **39px**，而右键/项目菜单行固定 **34px**（溢出 5px、相邻行重叠） |
| F3  | CSS 改宽后 JS 夹取失准      | 216px 常量做翻转/夹取；宽度若变 13.5rem（200% 时 432px），右缘菜单会被判定"放得下"而越界     |
| F4  | 200% 下工具提示可能撑破视口 | `whitespace-nowrap` + 字号翻倍：长标签宽度翻倍且不折行，绝对定位可能制造横向滚动             |
| F5  | 覆盖缺口                    | 13 处字号分布在 9 个文件，现有 E2E 一处未断言                                                |

**红证据跑法**（实施第 1 步，记录到 §12）：注入 `html{font-size:32px}`，
打开右键菜单，读 `getComputedStyle(菜单项).fontSize`，应为 `13px`（缺陷）；
同时读 docId 胶囊，应为 `24px`（对比）。

## 3. 目标行为

### 3.1 1x（根字号 16px）——零漂移

- 13 处字号 computed 值与今天完全一致（13/12/11/10/15px）。
- 行高完全一致（13px 项仍是 19.5px；12px 横幅仍是 18px）。
- 右键菜单宽 216px、行高 34px；项目菜单行高 34px。
- 现有 E2E 几何断言（Z1 720×450、R1 320×640、M1–M9 390）不修改、全绿。
- 视觉基线零 diff。

### 3.2 200% 文本（根字号 32px）

| 位置            | 1x 字号/行高 | 200% 字号/行高 |
| --------------- | ------------ | -------------- |
| 品牌词标        | 15 / 22.5px  | 30 / 45px      |
| 右键菜单项      | 13 / 19.5px  | 26 / 39px      |
| 快捷键徽标      | 10 / 15px    | 20 / 30px      |
| 工具提示        | 11 / 16.5px  | 22 / 33px      |
| 离线条/更新横幅 | 12 / 18px    | 24 / 36px      |

- 菜单项高度从 34px 变 68px（2.125rem），相邻行不重叠。
- 右键菜单宽 432px（13.5rem），但不超过 `100vw - 1rem`；菜单整体在视口内。
- 菜单高于视口时内部滚动（`max-h` 生效），不裁内容。
- 页面无横向滚动；工具提示折行而不是撑宽。
- 键盘打开菜单（Shift+F10）不触发焦点滚动（`window.scrollY === 0`）。

### 3.3 页面缩放 200%（720×450）不变

页面缩放会同时放大 px 与 rem，与本次迁移正交。Z1 矩阵保持原样、原断言。

### 3.4 不变式

- 零 Yjs 写、零 undo 项、零 PIXI 变更。
- 公开 API 零变化（`BOARD_PUBLIC_MEMBERS` 不动）。
- 主题/令牌颜色零变化；对比度护栏不动。
- PWA 预缓存清单由构建期扫描生成，随哈希自然更新，不手改。
- 单文件 < 400 行（ContextMenu 抽函数后约 250 行；新文件 < 100 行）。

## 4. 设计

### 4.1 数据流

```text
浏览器默认字号（设置页）/ 页面缩放
        │
        ├─ html { font-size: 100% }            ← 唯一入口，禁止写死 px
        │        ├─ rem 字号令牌 ──────────────→ chrome 文本
        │        └─ Tailwind rem 间距/高度 ────→ chrome 容器与命中盒
        │
        └─ 页面缩放 200% ─→ px 与 rem 一起放大（1.4.4 的既有覆盖路径）

画布（不进 rem 体系）
  Yjs fontSize（世界单位） ─→ PIXI TextStyle ─→ ×zoom ─→ 屏幕 px
                                        └─→ DOM 编辑层（px，WYSIWYG 对齐）
```

要点：**chrome 与画布是两套单位系统**。本次只统一 chrome 内部；画布保持
"世界单位 × zoom → 屏幕 px"，任何把画布侧改成 rem 的做法都会破坏
所见即所得（§4.7）。

### 4.2 D1：根字号与单位制

- 在 `app/src/index.css` 的 `@layer base` 增加：

  ```css
  html {
    /* rem 的唯一锚点：跟随浏览器"默认字号"设置；写死 px 会让用户偏好失效
       （WCAG 1.4.4 的文本缩放路径） */
    font-size: 100%;
  }
  ```

  `100%` 与默认值等价 → 1x 零漂移；显式声明的作用是挡住后续"给 html 设
  16px"这类会让 rem 退化成 px 的改动。

- **禁止**：`html/body { font-size: 16px }`、`font-size: 62.5%`、
  `clamp()/vw` 参与字号（页面缩放时行为不可控，且无视用户偏好）。
- **禁止 em 做字号**：em 依赖父级字号，嵌套组件会随上下文漂移；rem 只认
  根元素，语义稳定。
- 媒体查询保持 px（见 §1.2）。

### 4.3 D2：令牌层

在 `index.css` 既有 `@theme inline` 块内追加（与颜色令牌同块，注释区分用途）：

| 令牌           | 值          | 1x  | 200% | 消费者                   |
| -------------- | ----------- | --- | ---- | ------------------------ |
| `--text-3xs`   | `0.625rem`  | 10  | 20   | 快捷键徽标 kbd           |
| `--text-2xs`   | `0.6875rem` | 11  | 22   | 提示/说明/错误详情       |
| `--text-md`    | `0.8125rem` | 13  | 26   | 菜单项/面板标题/只读提示 |
| `--text-brand` | `0.9375rem` | 15  | 30   | 品牌词标（唯一消费者）   |

规则：

1. **不带 line-height**。不写 `--text-md--line-height`，让 Tailwind 只输出
   font-size（与今天的 `text-[13px]` 完全一致）。若构建产物出现行高，见
   §6.1 的构建断言与 §8 R1 的处置。设计期已用 `tailwindcss@4.3.3` 的
   `compile` API 实测：`@theme inline` 下输出 `.text-md { font-size: 0.8125rem }`，
   无 line-height；`text-[0.75rem]` 同形（只出 font-size）。
2. **不放进 `tokens.css`**。那里是"运行时可切换"的语义色源（`data-theme`
   整体换肤）；字号没有运行时切换需求，放进 `@theme` 即可，避免多一层
   var 间接。
3. **命名按刻度位置，不按语义**：同一 13px 在菜单/面板/提示里承担不同角色，
   角色名会在复用时说谎；3xs/2xs 沿用 Tailwind 位置命名，md 表示 xs(12) 与
   sm(14) 之间的中档。`brand` 是唯一按角色命名的（唯一消费者是顶栏词标），
   注释里写明"不是标题层级"。
4. **不改 Tailwind 默认的 `--text-xs` / `--text-sm`**：它们带行高变量，
   改值会波及 33 处已达标文本。

**12px 陷阱（重要）**：两处 12px 若写成 `text-xs`，行高会从继承的 1.5 变成
Tailwind 的 1.3333（18px → 16px），违反 1x 零漂移。因此这两处写
`text-[0.75rem]`——与今天的 `text-[12px]` 编译结果同形（只出 font-size）。
代价是 12px 存在两种写法；归一需连行高一起改，属后续项（§13.4）。

### 4.4 D3：转换规则

- 公式：`rem = px / 16`，**写成精确小数，不四舍五入**。
- 对照表：10→`0.625`、11→`0.6875`、12→`0.75`、13→`0.8125`、
  14→`0.875`、15→`0.9375`。
- 允许 `text-[0.75rem]` 这类"精确 rem 任意值"；禁止 `text-[13px]`。
- 一次只改单位，不顺手改字重/字距/颜色/断点。

### 4.5 D4：容器与字号同批（"字号不能单独迁移"）

规则：**凡由文本撑高的盒子，不得用 px 定高**。现状只有两类违规：

| 位置                                | 现值        | 改为                                   | 1x 等价性                   |
| ----------------------------------- | ----------- | -------------------------------------- | --------------------------- |
| `ContextMenu` 菜单行                | `h-[34px]`  | `min-h-[2.125rem]`                     | 内容 19.5px < 34 → 仍是 34  |
| `ProjectMenu` 菜单项（`itemClass`） | `h-[34px]`  | `min-h-[2.125rem]`                     | 同上                        |
| `ContextMenu` 面板宽                | `w-[216px]` | `w-[13.5rem] max-w-[calc(100vw-1rem)]` | 1440/390/320 视口下均为 216 |

为什么必须同批：只把字号改成 rem，26px 文本会塞进 34px 定高行（行盒 39px），
产生溢出与相邻行重叠（F2）——这是本方案最容易被漏掉的一步。

为什么宽度也要改：菜单行内边距/图标槽/间距都是 rem，200% 时固定 216px 的
可用文本宽度只剩约 96px（26px 字 → 每行 3–4 个汉字），实际不可读；改成 rem
后按比例放大，再加视口上限兜住窄屏。

Tooltip（与文本承载相关，但改的是"不折行"）：

- `whitespace-nowrap` → 去掉，改 `w-max max-w-[calc(100vw-1rem)]`。
- 1x：标签都很短，`w-max` 宽度与今天一致（单行、同宽）。
- 200%：超宽时折行，而不是把视口撑出横向滚动（F4）。

### 4.6 D5：定位跟随实测（CSS/JS 双源收口）

**问题**：菜单的翻转与夹取用常量 `MENU_W/ITEM_H` 计算，CSS 改成 rem 后两者
不再同步；实测尺寸还会因为文本折行而变化。

**约束（历史教训，来自 `ContextMenu.tsx` 顶部注释）**：曾用 "state + effect
量宽"被回滚——跨次打开残留旧尺寸导致先按旧翻转渲染再闪回，且修正延迟一帧。
本设计必须同时满足：不闪、不滚屏、焦点不跳。

**方案**：

1. 抽纯函数 `react/src/components/menuPlacement.ts`（接口先行）：

   ```ts
   export interface IMenuGeometry {
     /** 右键点（视口坐标） */
     anchor: { x: number; y: number };
     /** 面板尺寸：优先实测，未测到用估算 */
     size: { width: number; height: number };
     viewport: { width: number; height: number };
     safe: ISafeInsets;
   }
   export interface IMenuPlacement {
     left: number;
     top: number;
   }
   /** 越过右/下缘先翻转，再夹进「安全区 + 8px」可视矩形；语义与现状逐行等价 */
   export function placeMenu(g: IMenuGeometry): IMenuPlacement;
   /** 未测量时的估算：width=216、height=Σ行(34)/分隔(9)+12+2（现状公式） */
   export function estimateMenuSize(
     itemCount: number,
     dividerCount: number,
   ): { width: number; height: number };
   ```

2. 组件首帧用估算尺寸定位（**始终落在视口内**，绝不先摆到 `-9999px`——
   键盘打开菜单会聚焦首项，离屏定位可能触发焦点滚动）。
3. `useLayoutEffect` 读 `offsetWidth/offsetHeight`，与估算不同才 `setState`；
   React 在绘制前同步重渲染 → 用户看不到中间帧。
4. 测量为 0（jsdom 单测）时保持估算值，既有组件测试不炸。
5. 面板随每次打开重新挂载，测量状态天然清空（实现若发现未重挂，需在
   `show` 变化时重置）。
6. 常量降级为"预测量兜底"，不再承担最终定位。

**ActionBar**（同源问题）：只测了宽，翻转用 `BAR_HEIGHT_EST=40`。补测
`offsetHeight`，传入 `barH = Math.max(measured ?? 0, BAR_HEIGHT_EST)`：

- 1x：实测约 38px < 40 → 仍用 40 → **位置与今天完全一致**。
- 200%：实测约 76px > 40 → 用实测 → 操作栏不再压住选区。

`computeBarLayout` 增加可选入参 `barH`（默认 `BAR_HEIGHT_EST`），既有真值表
测试不改。

### 4.7 D6：px 保留区（明确边界，防止误迁）

| 位置                                                               | 为什么不能 rem                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Yjs `fontSize` / PIXI `TextStyle.fontSize`                         | 文档数据是世界单位，缩放由 zoom 承担；rem 在 canvas 无定义        |
| `platform/textEngine/richTextEditor.ts`（字号拼接为 px 串）        | DOM 编辑层必须与画布字号逐 px 对齐（WYSIWYG），rem 会随根字号漂移 |
| `platform/textEngine/plainTextKernel.ts`（世界字号 × scale 的 px） | 同上：屏幕像素 = 世界字号 × 缩放                                  |
| `platform/textEngine/measure.ts` 的 `ctx.font`                     | canvas 2D 字体串只接受 px                                         |
| `actionBarLayout.ts` 几何常量（12/34/40/320）                      | 屏幕空间定位数学；rem 化会让几何依赖根字号且无对应需求            |
| 选择框/手柄/吸附阈值/边缘滚屏热区                                  | 指针物理量，与字号无关                                            |
| 1px 分隔线、2px 焦点环、阴影、圆角                                 | 物理栅格/视觉规格                                                 |
| 媒体查询断点 `max-[379px]` / `max-[419px]`                         | 视口语义；媒体查询 rem 按"初始字号"而非根元素字号解析             |
| 图标 `size`（lucide）                                              | 图形；1.4.4 不要求，后续可选（§13.4）                             |

护栏会守住前几行所在文件（白名单 + 理由），其余出现 px 字号一律红。

### 4.8 D7：护栏脚本（机器守住"不再出现 px 字号"）

新增 `scripts/check-font-units.mjs`（纯 node stdlib，无依赖，零安装可跑）：

- 扫描：`packages/{core,react,app}/src/**/*.{ts,tsx,css}` +
  `packages/app/index.html`。
- 三条模式：
  1. Tailwind 任意 px 字号：`text-[13px]` 形式；
  2. CSS 声明：`font-size: 13px`；
  3. 内联/JS 赋值：`fontSize: '13px'`，以及以 px 结尾的模板字符串字号赋值。
- 白名单（文件级，硬编码理由）：
  - `packages/core/src/platform/textEngine/richTextEditor.ts`
  - `packages/core/src/platform/textEngine/plainTextKernel.ts`
- 输出：`path:line: 命中片段` + 汇总；命中 exit 1，干净 exit 0。
- `--self-test`：内置 8 条夹具（3 条命中 / 3 条不命中 / 白名单 / rem 任意值），
  自检不过直接 exit 1——护栏自己也要有区分验证。
- 接入：
  - `package.json` 的 `verify`：`pnpm lint` 之后插入
    `node scripts/check-font-units.mjs`；
  - `.github/workflows/ci.yml` gate：与 `check-visual-baselines` 同位置
    （checkout 后、install 前，纯 node 不需要依赖），命名"字号单位检查"。
- 不做行内豁免：要豁免就进白名单并写理由，强制走审查。

### 4.9 D8：为什么不用 `clamp()` / `vw` / 容器查询

- `vw` 字号随视口而非用户偏好变，200% 页面缩放时字号会被"抵消"，历史上
  是 1.4.4 的经典反模式。
- `clamp()` 有上限，用户调到 200% 时会被封顶，直接违反"文本可放大"。
- 容器查询解决的是组件自适应，不是用户字号偏好。

### 4.10 D9：为什么本批不做字号归一

现网 5 档（10/11/12/13/15）+ Tailwind 2 档（12/14）确实冗余。归一到
4/8 阶梯需要改观感（kbd 变大、品牌词标变小），会同时动视觉基线与设计稿，
属产品决策。本方案先把"单位"统一，把"刻度"留给独立批次——两件事混在一起
会让"1x 零漂移"这个验收条件失效。

## 5. 兼容与不变量

- **公开 API**：零变化（纯 CSS 类与组件内部逻辑）→ 不构成 semver 破坏。
- **数据**：零 Yjs 读写变化；不迁移任何持久化数据。
- **主题**：颜色令牌、对比度护栏、`data-theme` 切换全部不动。
- **PWA**：CSS 哈希变化 → 构建期预缓存清单自然更新；`check-pages-build` 不受影响。
- **性能**：菜单打开时多一次 `offsetWidth/offsetHeight` 读取（布局已完成，
  无强制回流）；无 rAF、无监听器新增；画布渲染路径零改动。
- **行数**：`ContextMenu` 抽函数后约 250 行；`menuPlacement.ts` 约 70 行；
  `ProjectMenu` 不变。

## 6. 测试方案

### 6.1 单测

| 文件                                            | 新增    | 覆盖                                                                                    |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| `react/src/components/menuPlacement.test.ts`    | 新 5 例 | 右缘翻转 / 下缘翻转 / 安全区左夹取 / 安全区右夹取 / 面板宽于视口贴左下限                |
| `react/src/components/actionBarLayout.test.ts`  | +3 例   | `barH` 缺省等于 EST（1x 真值不变）/ `barH=80` 上方放不下翻下方 / `barH` 参与 `top` 计算 |
| `scripts/check-font-units.mjs` 的 `--self-test` | 8 夹具  | 三条模式命中 + rem 任意值/普通数字/白名单不命中                                         |

构建断言（写进实施记录，人工一次性）：`pnpm build` 后

```bash
grep -o '\.text-md{[^}]*}' packages/app/dist/assets/*.css
# 期望：.text-md{font-size:.8125rem}      ← 无 line-height
grep -o '\.text-3xs{[^}]*}' packages/app/dist/assets/*.css
# 期望：.text-3xs{font-size:.625rem}
```

若出现 line-height：改为显式 `--text-md--line-height: 1.5` 并复核继承链
（见 §8 R1），或用 `text-[0.8125rem]` 兜底并记录。

### 6.2 E2E（新增 `packages/app/e2e/textScale.spec.ts`，5 例）

不塞进 `a11yLayout.spec.ts`（已 273 行，避免逼近 400 行与职责混杂）。
复用 `helpers/layoutE2e.ts`，新增两个 helper：

- `setRootFontSize(page, px)`：`addStyleTag` 注入
  `html{font-size:<px>px !important}`，再等两帧 rAF。
- `assertRowsDisjoint(locator)`：逐项比对 `boundingBox`，后者 `top` 必须
  ≥ 前者 `bottom - 0.5`。

| 用例           | 视口 / 根字号 | 断言                                                                                                                             |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| T1 1x 精确性   | 1440×900 / 16 | 根字号 16；菜单项 13px/19.5px；kbd 10px/15px；提示 11px/16.5px；横幅 12px/18px；词标 15px/22.5px；菜单宽 216                     |
| T2 200% 精确性 | 1440×900 / 32 | 同上全部 ×2（26/39、20/30、22/33、24/36、30/45）；菜单宽 432                                                                     |
| T3 200% 菜单   | 1440×900 / 32 | 菜单四边在视口（pad 8）；行不重叠；行高 68；菜单高于视口时可滚（`scrollHeight > clientHeight` 且 max-height ≤ 视口）；页面无横滚 |
| T4 200% 面板   | 1440×900 / 32 | 项目菜单行不重叠且在视口；存储面板行不裁字（`assertNoTextClip`）；坞按钮 hover 出 tooltip 后其 box 在视口内                      |
| T5 200% 键盘   | 1440×900 / 32 | Shift+F10 打开菜单后 `window.scrollY === 0`；焦点在菜单内；Esc 后焦点回画布                                                      |

断言纪律：一律 `getComputedStyle` 读**真实计算值**（不读类名/内联样式），
几何用 `boundingBox`，定位用 `data-spinth-*` 标记。

### 6.3 视觉快照

- 期望：**零 diff**（5 张基线全在画布，本批不碰画布）。
- darwin：`npx playwright test packages/app/e2e/visual.spec.ts`。
- linux（触及画布才必须；本批理论上不需要，但合并前按仪式跑一次更稳）：
  `pnpm visual:linux`。
- 若出现 diff：**视为缺陷信号**，先查是否误改了画布侧或全局字号，不允许直接
  `--update` 重录基线。

### 6.4 手工（无法自动化，写入 §12）

1. Chrome「设置 → 外观 → 字号」调到"大/特大"（真实用户偏好路径，不是注入
   `html font-size`），检查 1.4.4 四项：菜单、面板、提示、横幅。
2. macOS Safari 同项（系统最小字号设置）。
3. 页面缩放 200% 复核（应与今天一致）。
4. 200% 下用键盘完整走一遍右键菜单（Shift+F10 → ↓ → Enter → Esc）。

## 7. 验收清单

```bash
pnpm verify                     # 含新护栏；全绿
pnpm test:e2e                   # 主配置 + pwa；新 spec 5 例全绿
npx playwright test packages/app/e2e/a11yLayout.spec.ts \
  packages/app/e2e/mobile.spec.ts \
  packages/app/e2e/a11yKeyboard.spec.ts   # 1x 几何与键盘协议不回归
npx playwright test packages/app/e2e/visual.spec.ts   # 零 diff
```

判定：

- [ ] 13 处 px 字号清零（护栏扫描 0 命中）。
- [ ] 1x computed 字号/行高与 §3.2 左列逐项相等。
- [ ] 200% 下 §3.2 右列逐项相等，且 T3–T5 全绿。
- [ ] 视觉基线零 diff；Z1/R1/M1–M9 未修改且全绿。
- [ ] `pnpm verify` 绿；CI gate 新增步骤绿。

## 8. 风险与回滚

| #   | 风险                                 | 触发信号                                | 处置                                                                                                                      |
| --- | ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| R1  | 令牌意外带出 line-height             | 构建产物含 `line-height`；T1 行高断言红 | 移除该键；若 Tailwind 强制生成，则显式 `--text-*--line-height:1.5` 并复核祖先 `leading-*`，或退回 `text-[0.8125rem]` 兜底 |
| R2  | 测量后二次定位造成闪烁/焦点滚动      | T5 红；肉眼可见跳位                     | 首帧必须已在视口内；只在 layout effect 内修正；禁止离屏首帧                                                               |
| R3  | 菜单宽改 rem 后窄屏越界              | R1-c / Z1-b 红                          | `max-w-[calc(100vw-1rem)]` 兜底；夹取用实测宽                                                                             |
| R4  | 12px 误写成 `text-xs`                | T1 行高断言红（18 → 16）                | 保持 `text-[0.75rem]`；归一另案                                                                                           |
| R5  | 护栏误伤（注释/文档/测试夹具）       | 脚本红但无真实违规                      | 只扫源码目录；白名单必须带理由；不做行内豁免                                                                              |
| R6  | 图标在 200% 下相对变小（现状即如此） | 观感，不触发断言                        | 记录为已知限制，不在本批扩面（§13.4）                                                                                     |
| R7  | 320px + 200% 组合（超出 1.4.4 基线） | 手工发现                                | 不作门禁；记录；必要时单独评估                                                                                            |

回滚：本方案不涉及数据与公开 API，按 §9 的提交粒度 `git revert` 即可；
S1 与 S2 必须同进同退（只回退 S1 会留下"34px 定高 + 13px 字号"的中间态，
虽然与今天等价，但会掩盖 200% 缺陷）。

## 9. 实施批次（每步独立可回退，每步 `pnpm verify`）

| 步  | 内容                                                                                                         | 验证                              | 提交信息建议                           |
| --- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- | -------------------------------------- |
| S0  | 跑红留证据：注入 32px 根字号，记录菜单项 13px / 胶囊 24px 的实测值（回填 §12）                               | 手工/临时脚本                     | 不单独提交                             |
| S1  | 加 4 个令牌 + `html{font-size:100%}`；13 处字号替换                                                          | `pnpm verify`；T1 精确性          | `feat(ui): 铬件字号迁移为 rem 令牌`    |
| S2  | 容器同批：两处 min-h、菜单宽 rem + 上限、tooltip 折行；抽 `menuPlacement` 并测量；ActionBar 补 `barH` + 单测 | `pnpm verify`；T2–T5；R1/Z1       | `fix(ui): 文本承载容器随根字号缩放`    |
| S3  | `check-font-units.mjs` + `--self-test` + verify/CI 接线                                                      | 脚本自检；`pnpm verify`           | `chore(guard): 禁止 px 字号并接入门禁` |
| S4  | `textScale.spec.ts` 5 例 + `layoutE2e` 两个 helper                                                           | `pnpm test:e2e`                   | `test(e2e): 文本缩放 1x/200% 矩阵`     |
| S5  | 文档同步（§10）+ 本文件 §12 回填 + 基线数字校正                                                              | `pnpm verify`（prettier/hygiene） | `docs: 字号单位策略与基线同步`         |

纪律：S1/S2 同一 PR；S3 之后任何新增 px 字号都会在门禁前红。

## 10. 文档同步清单

| 文件                                             | 改什么                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [docs/12](../docs/12-ui-layer.md) §5             | 新增"字号单位策略"：rem 唯一、令牌表、12px 例外、px 保留区、护栏命令                |
| [docs/15](../docs/15-testing.md) §3              | 断言纪律加一条：文本缩放断言用 computed style + 行高，不靠截图；§2 基线数字一并校正 |
| [docs/13](../docs/13-roadmap.md) §3.1 / §1       | 勾掉"px→rem 全量迁移"，移入"已完成批次"；§1 基线数字更新                            |
| [specs/a11y-closeout.md](a11y-closeout.md) §13.5 | 第 3 条改为"已收口，见 specs/rem-typography"                                        |
| `AGENTS.md`「当前状态」                          | 追加本批一句话 + 单测/E2E 计数                                                      |
| [docs/01](../docs/01-conventions.md) §5          | 校正 `verify` 组成注释（当前缺 hygiene/license/visual），补 `check-font-units`      |
| 本文件 §12                                       | 实施记录与实测值                                                                    |

> 注意：[docs/15](../docs/15-testing.md) §2 当前数字（1036 单测 / 45 spec / 218 例）
> 与 `AGENTS.md`（1091 / 47 / 232）不一致，属既有滞后；本批实施后必须用
> 实测值统一，不要照抄任何一侧。

## 11. 红线（执行 agent 必读）

1. 不改画布侧任何字号（PIXI/measure/DOM 编辑层），不改 Yjs 数据与导出。
2. 不引入依赖；护栏脚本只用 node stdlib。
3. 不做字号阶梯归一、不改 `text-xs`/`text-sm` 的值与行高。
4. 不动视觉基线；出现 diff 先查因，禁止 `--update` 掩盖。
5. 不改媒体查询断点单位。
6. 不加 `!important` 覆盖用户根字号。
7. 每步 `pnpm verify`；S4 完成后补跑 `test:e2e` 全量。
8. 保持单文件 < 400 行；`ContextMenu` 的定位数学必须落在纯函数文件里。

## 12. 实施记录（待回填）

| 项                                    | 值             |
| ------------------------------------- | -------------- |
| S0 红证据（200% 下菜单项 / 胶囊字号） | 待填           |
| 构建产物 `.text-md` 实际声明          | 待填           |
| 新增/变更测试计数                     | 待填           |
| 视觉基线 diff                         | 待填（预期 0） |
| 手工 1–4 结果                         | 待填           |

> 设计期已用 `tailwindcss@4.3.3` 的 `compile` API 验证：`@theme inline` 下
> `--text-md` 只输出 `font-size`，无 line-height；`text-[0.75rem]` 同形。
> 构建产物与 CI 断言仍需在 S1 由执行者回填。

## 13. 设计审查

### 13.1 约束检查（对照 AGENTS 八条）

| 铁律           | 本方案是否符合                              |
| -------------- | ------------------------------------------- |
| 1 文档即规格   | 先改 docs/12/15 再改码；本文件是实施依据    |
| 2 接口先行     | `menuPlacement` 先定 interface + 真值表单测 |
| 3 数据流       | 零 Yjs / 零 PIXI 写                         |
| 4 显式依赖     | 无 DI / 注册表变化                          |
| 5 单文件单职责 | 抽纯函数，ContextMenu 约 250 行             |
| 6 测试护栏     | 单测 + E2E 5 例 + 视觉零 diff + 脚本护栏    |
| 7 三件套       | 不新增控件                                  |
| 8 单机优先     | 纯前端，无网络依赖                          |

### 13.2 决策台账

- **D1** 根字号 100% + rem 唯一制：不写死、不用 em/vw/clamp。
- **D2** 4 个新令牌（10/11/13/15），不带 line-height；12/14 沿用 Tailwind。
- **D3** 精确 1/16 换算；12px 两处用 `text-[0.75rem]` 保行高。
- **D4** 容器与字号同批：min-h、宽 rem + 视口上限、tooltip 折行。
- **D5** 常量降级为初值，挂载后测量同帧再夹取；ActionBar 取 `max(measured, EST)`。
- **D6** 画布/编辑层/交互几何保持 px，白名单化。
- **D7** 脚本护栏进 verify + CI，禁止行内豁免。
- **D8** 不用 `clamp()`/`vw`/容器查询：字号必须跟用户偏好走，不能跟视口、不能封顶。
- **D9** 刻度归一另案，避免与"零漂移"验收冲突。

### 13.3 自审发现（写稿过程中修正的点）

1. **13px 与 12px 混排才是真缺陷**：不是"全是 px"，而是"一半 rem 一半 px"——
   200% 时 12px→24px、13px 不动，层级反转（F1）。只迁 13px、把 12px 留在
   原地的方案也能消掉"菜单比胶囊小"，但那两处文本就永远不放大（等于放弃它们
   的 1.4.4），且同类文本出现两种缩放行为，故 12px 也统一为 rem 任意值。
2. **字号不能单独迁移**：13px→26px 后行盒 39px > 34px 定高（F2）；容器必须
   同批，否则"修了 a11y 造了溢出"。
3. **12px 不能直接换成 `text-xs`**：Tailwind 的 `text-xs` 带 1.3333 行高，
   会改 1x 渲染；改用 `text-[0.75rem]`。这是"零漂移"验收能成立的关键细节。
4. **双源常量不能只改 CSS**：`MENU_W/ITEM_H` 与 CSS 是两份拷贝（F3）；
   但历史上"state + effect 量宽"因闪烁被回滚，所以设计成"首帧在视口内 +
   layout effect 同帧修正"，而不是离屏测量。
5. **视觉基线证不了 chrome**：5 张全是画布 clip（§2.4-6），必须补
   computed-style 精确性用例，否则"视觉零 diff"会给出虚假安全感。
6. **tooltip 是不折行的**：200% 下可能撑出横向滚动（F4），且现有 Z2 不覆盖。
7. **docs/15 §2 数字已滞后**：与 AGENTS 差一整批，实施时统一，避免又留一份
   过期基线。
8. **ActionBar 直接用实测高会在 1x 下移 2px**（实测 38 < 估算 40）→ 取
   `max(measured, EST)` 既保 1x 又修 200%。
9. **320px + 200% 超出 1.4.4 基线**（基线是 1280 宽 200% 文本），不设为门禁，
   避免用不合理组合制造假红。
10. **浏览器设置与注入样式是两条路径**：E2E 注入只能证明 rem 生效，真实
    偏好路径必须留一条手工项。

### 13.4 开放问题（不在本批）

1. **图标随字号缩放**：200% 下 15px 图标配 2× 按钮盒，观感偏小。需要把
   `Icon` 的 `size` 从 px 数字改成 rem/em 类名，21 处调用点；需产品确认。
2. **刻度归一**：10/11/12/13/15 与 12/14 合并成 4/8 阶梯；会改观感与视觉基线。
3. **iOS 动态字体**：Safari 的"文字大小"走 Dynamic Type，rem 不响应；
   若要支持需另设根字号映射（当前不承诺）。
4. **12px 双写法**：若未来统一 `text-xs` 的行高语义，可把两处任意值并入令牌。

## 附录 A：换算表

| px  | rem    | px  | rem    |
| --- | ------ | --- | ------ |
| 10  | 0.625  | 14  | 0.875  |
| 11  | 0.6875 | 15  | 0.9375 |
| 12  | 0.75   | 16  | 1      |
| 13  | 0.8125 | 34  | 2.125  |
| 216 | 13.5   | —   | —      |
