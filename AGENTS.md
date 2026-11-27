# AGENTS.md — spinth 开发约定

> 本文件是 AI 助手与人类开发者在 spinth 仓库工作的最高优先级约定。
> 与代码冲突时，以本文件与 `docs/` 为准；修改本文件需人类确认。

## 项目是什么

spinth 是一个**本地优先的白板与思维导图编辑器**。当前阶段只做单机版：文档、
撤销历史和图片资产保存在浏览器，不依赖服务端、账号或网络。

核心架构一句话：**所有写操作只写 Yjs；所有渲染只订阅 Yjs。**

## 仓库结构

```
packages/core    @spinth/core    框架无关 SDK（PIXI 8 + Yjs）
packages/react   @spinth/react   zustand 只读镜像 + DOM UI
packages/app     @spinth/app     应用壳（Vite + React 19）
docs/            规格文档（本仓库自己的文档）
```

当前没有 `packages/server`。协同是后置能力，不属于本阶段。

## 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm hygiene
pnpm verify
pnpm verify:log
```

提交前必须全绿：`pnpm verify`（hygiene + lint + prettier + typecheck + `pnpm -r test` + build）。
跑门禁用 `pnpm verify:log`（或 `set -o pipefail`）——裸 `pnpm verify | tail` 会用 tail 的
退出码掩盖红测试；pre-push 钩子同样会跑一次 `pnpm verify`。
Node >= 24，pnpm 11.28.5。

## 八条铁律

1. **文档即规格**：实现前先读对应 docs；实现与文档不一致时先改文档或说明理由。
2. **接口先行**：先在 `packages/core/src/types/` 写 TS interface + zod schema。
3. **数据流铁律**：禁止绕过 Yjs 直接改 VM/PIXI；拖拽/缩放只允许视觉预览，松手必须经 Model 写回。
4. **显式依赖**：构造函数注入，通过 ServiceRegistry 获取依赖；禁止装饰器 DI 和全局单例。
5. **单文件单职责**：非测试代码目标 < 400 行，超过就拆 Service/Vm/工具；测试文件按文件/功能域拆分，不套用 400 行上限。
6. **测试护栏**：纯逻辑有 vitest；编排有桩测试；整机链路有 Playwright。提交前 `pnpm verify`，改交互补跑 `pnpm test:e2e`。
7. **新增控件 = 三件套**：`xxxModel.ts` + `xxxVm.ts` + `xxxService.ts` + 注册；不改 dataEngine/vmEngine。
8. **单机优先**：启动主路径不启用服务端、账号或远端同步；协同相关代码不得进入默认启动路径。本地文档必须能离线编辑、刷新恢复。

## 渲染同步铁律

拖拽/缩放系列 bug 的六条规则：跟随框绝对定位禁止增量累加 / setState 先渲染后广播 /
交互数学无隐式跨帧状态（会话状态由 Service 显式传参）/ 几何读取缩放感知 /
松手落库用最后一帧输出 / 交互几何 per-type 契约。
回归测试：`__tests__/renderSync.test.ts`、`adsorber.test.ts`、`refLineService.test.ts`。
违反任何一条 = 重做。

## 代码风格

- TS strict（含 `noUncheckedIndexedAccess`）。
- 文件：`xxxService.ts / xxxVm.ts / xxxModel.ts`；接口 `I` 前缀；rx 流 `$` 后缀；常量 UPPER_SNAKE。
- 注释解释“为什么”（约束、踩坑、算法出处），不复述“是什么”。
- 提交信息：`feat|fix|docs|refactor|test|chore: 中文描述`。

## 文档迭代与仓库卫生

- 文档只写**当前事实**（格式、契约、约束、当前验收状态）；不写日期、提交哈希、PR 编号、验收流水账，也不追加“此前/现在/已修复”叙事。历史由 git 提交信息承载。
- 修改能力时**直接改写对应段落**，不新增变更记录；文档与代码不一致时先改文档。
- 实现方案与审查记录写入 `specs/<功能名>.md`（按功能命名、无前缀），随代码提交；`specs/` 是过程文档，允许提交哈希与实施过程记录，不受 `docs/` 的“只写当前事实”约束。
- `specs/` **不豁免隐私与来源要求**：本机路径、用户名、邮箱、密钥由通用规则拦截；其他项目名称等来源信息由本机 `.hygiene.local.json` 的拒绝词拦截（全库 `denyPatterns`，可按路径收窄；名称不入库）。
- 代理计划、评审草稿与 `HANDOFF*` / `*handoff*` 不入库：只保留在本机，写本机 `.git/info/exclude`，由 `pnpm hygiene` 拦截。
- 验收清单、手工验证步骤与运行手册不写入 `docs/`；它们属于 `specs/` 下的实现文档。docs 只保留规格、约束、架构与当前边界。
- 仓库内容不得包含本机绝对路径、用户名、邮箱、其他项目名称或来源痕迹。需要本地拒绝词时写 `.hygiene.local.json`（ignored），不要写进仓库。
- `pnpm install` 会安装 pre-commit（staged 卫生）与 pre-push（`pnpm verify`）钩子；
  已有自定义钩子不会被覆盖。绕过钩子（`--no-verify`）等于放弃本地门禁，CI 仍是 backstop。

## docs 索引

完整阅读路径与任务路由见 [docs/README.md](docs/README.md)；代码注释中的 `docs/NN §M`
必须能在对应篇目中找到。

| 篇目                      | 主题                                 |
| ------------------------- | ------------------------------------ |
| 00-overview               | 产品定位、架构铁律、包边界           |
| 01-conventions            | 仓库约定、技术栈、ADR、AI 工作流     |
| 02-data-engine            | Yjs、IndexedDB、undo、replay、持久化 |
| 03-render-engine          | PIXI、视口、分层、按需渲染、导出     |
| 04-widget-system          | Model/Vm/Service、注册表、能力位     |
| 05-selection-drag         | 选中、拖拽、缩放、旋转、对齐/分布    |
| 06-refline                | 参考线吸附、等间距                   |
| 07-text                   | 三态文本、测量引擎、两级渲染         |
| 08-line                   | 连线、路由、锚定、线上文字           |
| 09-clipboard-shortcuts    | 剪贴板、快捷键、闸门                 |
| 10-collaboration          | 未来协同边界（当前不启用）           |
| 11-mindmap                | 脑图数据、布局、拖拽、导航           |
| 12-ui-layer               | zustand 桥、DOM UI、主题、启动链路   |
| 13-roadmap                | 路线图、优先级、决策台账             |
| 14-render-sync-principles | 拖拽/缩放六条同步规则                |
| 15-testing                | 单测/编排/E2E/视觉基线               |
| 16-performance            | 空间索引、culling、性能债            |
| 17-editing-service        | 统一编辑会话、双内核、profile        |
| 18-group                  | 编组数据模型、命令、选择集成         |
| 19-assets                 | 本地资产、GC、失败回退               |
| 20-project-file           | 项目文件格式、导出/导入              |
| 21-multi-tab              | 多标签单写者、只读跟随、接管         |
| 22-tree-diagrams          | 树形图族架构、kind 注册、扩展指南    |

## AI 工作流

1. 读 `docs/13-roadmap.md` 确认当前阶段。
2. 读相关 docs + `packages/core/src/types/` 现有契约。
3. 不确定的设计点先提问，不猜。
4. 顺序：types → 纯逻辑（带单测）→ PIXI 视图 → Service 接线 → 手动验证 → 同步 docs。
5. 每完成一个可验证单元就自检 lint/test/typecheck。
6. 小步提交，每步可回退。

## 当前状态

单机基线已完成：画布、形状/文本/便签/连线/画笔/图片/脑图/**符号控件**（图标+
外置标签，specs/symbol-widget）、**网络拓扑 4.3**（避障豁免/区域近似/N-1..N-11/
network-sample 基线，specs/network-diagram）、多选/编组/对齐/
参考线（旋转手柄入口暂隐藏——rotation 数据能力全保留，specs/rotate-hide）、富文本/排版/橡皮、撤销/重做、IndexedDB 持久化、本地资产库、移动端工具菜单、
项目文件导出/导入（`.spinth.zip`，docs/20）、存储状态面板（docs/02 §6.1）、
多标签单写者/只读跟随（docs/21）、资产/图片生命周期（加载会话/纹理共享/
纹理保活/重试/GC 分片预算，docs/19 + specs/texture-keepalive）、只读态收口
（右键不建选区、呈现门禁、运行时降级序列，
docs/21 §4）、可访问性与移动端收口批次 A（语义色 WCAG AA + 对比度护栏、共享
错误态 role=alert、390px 九面布局矩阵、单机断网不变量，specs/a11y-mobile）、
公共 API 收口与 P2 架构收口（`BoardPublicApi` allowlist + 分类编译锁、
`boardCommands` 宿主契约类型化、`app.ts` 门面化 + `BoardFacade` 纯委托基类、
`WIDGET_RUNTIME` 类型注册表单源，specs/api-surface）、可访问性挂账收口批次 B
（右键菜单键盘协议 roving + Shift+F10 + 菜单期快捷键闸门、工具主题色 `-ink`
按角色拆分 4.5:1、320 重排/200% 缩放/安全区矩阵、画布 role=application +
Announcer 播报器，specs/a11y-closeout）。
PWA/Service Worker 平台能力已落地（specs/pwa.md）：manifest + 192/512/maskable
图标、子路径 SW（scope=base，注册经 `publicAsset()`）、构建期实算预缓存清单
（含懒加载 chunk，latin 字体白名单）、导航 network-first + shell 回退、字体 SWR、
跨源/非 GET/Range 直通、waiting + 用户确认的可控更新（横幅只刷新点击方）、
`check-pages-build` 六断言、`__BUILD_TAG__` 构建标记；dev 不注册 SW；附带修复
zod JIT 探测在生产 CSP 下触发 securitypolicyviolation 的存量缺陷（jitless）。
Linux 视觉基线已落地（specs/linux-visual）：`@playwright/test` 精确 pin、
官方 playwright 镜像派生（fonts-noto-cjk 版本必传 + Noto Sans CJK SC 定档 +
构建期 fc 断言，镜像 tag 含环境指纹）、`pnpm visual:linux` 容器执行器
（`--update` 自带新容器复验，提交前先跑 `--stability` 双跑全等——specs §10.3
仪式，脚本不强制）、基线齐全护栏接入 verify 与 CI gate、visual job 真门禁
（update dispatch 跳过校验直接生成）；darwin/linux 双平台各 5 张基线。

边缘自动滚屏已落地（specs/edge-auto-scroll）：元素/脑图节点拖拽进 120px
边缘热区按帧平移视口（速度随距边缘距离连续线性增长 `v = 1080 × (1 − d/120)`
屏幕 px/s、dt 钳 50ms；56px 三档已由线性斜坡修订取代），补偿走输入层
`replayLastPointerMove`（同一屏幕坐标重放 move，世界坐标每帧现算）；越阻尼
才启用、松手/取消/离容器/管线拒发即停，落库语义不变（一次拖拽一次撤销）；
复审返工补齐回归测试与异常兜底、抽 `selectorMarquee.ts`；手工验收五项待人工
（specs/edge-auto-scroll §13.5）。

滚屏拖拽 culling 误剔已修复：拖拽预览只改 root、空间索引停在旧几何，边缘
滚屏推远视口后指针下的被拖元素被误剔（松手才恢复）——culling 对预览 id
（`ISelectorService.previewIds`，core 内部契约）用实时 `getBounds()` 复核，
索引仍只反映数据几何（E2E E-6 先红后绿锁死，specs/edge-auto-scroll 修订）。

工具坞二级菜单首击不出现已修复：React 宿主 ref 晚于子树 layout effect 挂载，
ToolFlyout 首测闩死 `visibility:hidden`（dev StrictMode 掩盖、生产在 Toolbar
无关重渲染后才现身）——锚点改由 Toolbar layout effect 受控提供 + 面板 rAF
补帧重试与 resize/滚动失效重算（组件单测先红后绿 + 390 触摸 E2E）。

缩放手柄松手误进编辑已修复：rectEditor 手柄 down `stopPropagation`、up 仍冒泡
到 stage，selector 由手柄手势抑制单击激活；抑制生命周期 = 匹配手势指针
（pointerId + 主键），终止 = window up / pointercancel / lostpointercapture /
cancelGesture（单源清除，selector 只读判定）。手柄 down 同时 `setPointerCapture`
（支持 capture 的环境下视口/窗口外松开 up 仍送达；捕获异常丢失由
lostpointercapture 回滚收口）；window move 只认手势指针且主键仍按下，异指针、
副键或已松主键的 move 不更新预览。误进的 edit 早退会保留 resize preview
scale，使选区/编辑框脱离图形（selectorDrag + rectEditor 手势指针生命周期
单测、styleResize 内向松手/中途失焦/异指针 up/异指 cancel 出视口、touchPen
触摸缩放 E2E 锁定）。

框选边缘滚屏已落地（specs/marquee-auto-scroll）：三路拖拽同属滚屏——框选复用
同一 `EdgeAutoScrollService`，以屏幕位移 ≥10px（`MARQUEE_TRACTION_SCREEN` 锁存）
为起拖判据且只门控滚屏（矩形/选中从 down 起过程即结果不变），选中集按帧与上次
写入序列去重（滚屏稳态零 `setSelected`），selector marquee 分支净增一行上报
（仍在 400 行铁律内）；零 Yjs 写、零公开 API/调试探针变更；复审返工收口（E2E 假绿
补强、基线数字重测、docs/05 Esc 停滚偏差修正，specs §13.5）；手工验收五项
待人工（specs/marquee-auto-scroll §8.4）。

运行时收窄已落地（specs/runtime-narrowing，S1–S7 全量）：`createBoard()` 唯一
公开构造入口返回 `BOARD_PUBLIC_MEMBERS` 68 成员冻结投影（内部字段不可枚举、
不可读、不可调用；`BoardSDK` 不再导出）；DEV 双句柄 `window.__spinth` = 公开
投影、`window.__spinthDebug.__debug` = 内部探针（engine/viewport/assetStore/
lastAssetMaintenance 四个不可枚举逃生口，经 `@spinth/core/dev` 动态入口、原子
曝光、按身份卸载）；生产构建 `__spinth`/`__spinthDebug`/`__debug`/
`spinth:core-dev-debug` 四标记字节级零残留（check-debug-bundle 接入 build，
负向注入验证真跑），`SPINTH_E2E=1` 构建保留只读探针（公开子集 + modelCount）；
E2E 探针路径全量迁移 `__spinthDebug.__debug`，公开化 `toScreenPoint`/
`persistState$`/`selected$`，新增 debugSurface.spec 与 pwa P7 零探针用例。

可访问性遗留 P0 批次已落地（specs/a11y-closeout §13.5 第 1/7/8/9 条）：宿主浮层
（项目菜单/存储面板）打 `data-spinth-ui-modal` 标记、经 `IBoardConfig.isUiModalOpen`
注入并入快捷键闸门（`menuOpen`→`uiModalOpen`，与右键菜单取或）；指针主键过滤补
真值表单测与 CDP 触摸/笔 E2E；操作栏定位几何抽 `actionBarLayout.ts`、安全区移入
layout effect 并随 resize/orientationchange 重算；roving autoFocus 补「重渲染不抢
焦点」定点单测。

nightly 视觉门禁已修复（specs/linux-visual §14.9）：base 按 digest pin（同 tag 上游
重发已实测）、pnpm 构建期内置进镜像（不再依赖 corepack）、装依赖前工具链预检
（node 主版本 / pnpm 版本等值断言）、安装失败文案带真实尾行；宿主常驻铬件按
焦点作用域并入快捷键闸门（PWA 更新横幅打 `data-spinth-ui`，§13.5-10 已收口）。

字号单位迁移已落地（specs/rem-typography，WCAG 1.4.4 文本缩放）：铬件 13 处 px
字号统一为 rem 令牌（`text-3xs/2xs/md/brand` 只给字号不带行高；两处 12px 写
`text-[0.75rem]` 保继承行高），`html { font-size: 100% }` 为唯一锚点；文本承载
容器同批随根字号缩放（菜单行 `min-h`、右键菜单宽 rem + 视口上限、Tooltip 超宽
折行）；右键菜单定位抽 `menuPlacement` 纯函数（首帧估算、挂载后实测同帧重定位、
按打开签名隔离），ActionBar 翻转用 max(实测栏高, 40)；`check-font-units` 护栏
（14 条夹具自检）进 verify 与 CI gate；1x 铬件逐值零漂移，根字号 32px 下
textScale T1–T6 全绿；浏览器默认字号设置页与 Safari 两项待人工（specs §12）。

参考线吸附手感批已落地（specs/refline-snap-feel，含独立复审全量收口）：吸附
粘滞（上一帧命中线由 RefLineService 持有、显式传参绕过方向过滤——拖过线
1~阈值 px 拉回、越阈即释放，更近新线照常切换；docs/14 规则 3：交互数学禁
**隐式**读取上一帧，跨帧会话状态由 Service 显式传参）；方向过滤带
threshold/3 死区（净位移过小时不过滤，手抖符号翻转不丢候选）；不设已贴合
跳过（贴合/亚像素缝隙照常命中画线，对准时反馈持续显示）；边线↔中心线互吸
（拖拽三条线全参与配对；缩放取阈值内最近**有效**线——吸附后尺寸越 minSize
的候选回退次近）；对齐与等间距同轴偏差最小者胜（平局对齐胜）；热路径先阈值
筛再判粘滞、空粘滞零 key 格式化。refline E2E 6 用例：A1 置脏、B 间隙等距、
C 粘滞落库（关粘滞停 403、开粘滞落 400）、D 端部间隙链、E 端部中心链、
F 中置中心正中。

等间距端部链式已落地（specs/spacing-endchain，docs/06 §7）：被拖件单侧有邻居
（≥2）时两种链解取偏差小者、重合时边间隙优先——边间隙链「与最近邻的间隙 =
最近邻与其外侧连续次邻的间隙」、中心链「三心等差 A.cx = 2·P.cx − Q.cx」（拖
一排两端间隙/中心两种等距都出徽标）；参考值 ≤ 0 不触发；只取最近邻+连续次邻
一对；中置两侧语义不变（中心等距偏差 0 照常显徽标）。

工具单击创建滑移容差已落地（specs/click-create-slip，docs/04 §2）：形状工具
单击与拖拽画图的分界为 10 屏幕 px（复用 `common/interaction.ts` 的
`DRAG_TRACTION_SCREEN`，与选中起拖、框选滚屏判据同源），低于分界一律按单击——
默认尺寸、以按下点为中心、工具保持可连击、不选中；单击手抖不再画出 8×8 小
图形。便签门控维持两轴各 ≥ 24px，单击落点同为按下点居中（shape/sticky 一致）。

标准流程图能力已落地（docs/13 阶段 4.1，specs/flowchart-closeout，含两轮复审
返工全量收口）：形状样式三字段（fill/borderColor/borderWidth——白底黑框一次配出、
无填充两态、无填充态 ActionBar 如实显示）；20 型轮廓锚点单源
（`getAnchorPoint` → `outlineAnchor`，反馈层指示器/外移快照/抓取热区/quick-add
ghost 起点与落线起点同源，非矩形形状锚点贴轮廓）；同边多线默认单点
（2026-11-15 B：自动错开取消，同边线共享 0.5 中点引出、允许重叠；需要分开时
手动拖端点写显式 port；同边自环两端恒 0.5，U 形跨度由 routeSelfLoop 按目标
展开，多自环嵌套跨度保留）；ELBOWED 全局避障 + 紧凑自环 +
拐点手柄（微移 <4px 线身/文字回提交态，三类手势同款）+ 悬空线一键清理；网格吸附
开关（四处落库量化：拖拽/缩放/创建含便签/自由线端点，参考线含等间距先于网格；
视图偏好 localStorage、销毁入 disposeBoard 序列）；ActionBar 窄屏 flex-wrap
收纳 + 默认字色随填充自适应且**编辑器与渲染单源**（黑填充白字、无填充随主题
dark #ededf2，对比度护栏 `shapeContrast.test`/`textEditStyle.test`，白边框定位
深底选项；popover 选项钮 28px——44px 实测过大用户拍板回落，触摸目标口径 ≥24px）。
E2E flowchart 15 例 + 视觉 S1 场景（stadium/菱形/矩形 + 回边 + 三标签）基线双平台
（视觉用例除 theme 双态整帧（设计意图）外已 clip 化/清 UI 入镜，DOM chrome 不再
误伤基线，specs/linux-visual §14.10）；同边多自环嵌套展开（spanScale 跨度/车道
分层）；`lastRouteObstacles` 探针字面量生产零残留（check-debug-bundle 扩扫）。

交互三修已落地（specs/actionbar-popover-mutex / quick-add-respread /
line-body-drag-near-shape）：ActionBar popover 开合单源互斥（openPopoverId
上提 ActionBar、PopoverControl 受控，bar 内 pointerdown 统一收起）；quick-add
点击落定与拉线同源触发全量重排（同边默认 0.5 单点，落定重排 samePoints
零写；删除目标形状后悬空线原位不扭）；连线近形禁拖（segmentBodyGrabbable
单源门控抓取/胶囊/hover 光标：近形带 = 距锚定端 30 屏显 px + 锚定侧段长
<30 世界整段，锚定侧带外可拖均为正交拆段（自由端侧首/末段——非唯一段——
短段走斜连退化，自由唯一段仍拆五点正交）、端点
圆点拖拽保留，docs/08 §10.3 二次拍板；纯线选区不建拖拽会话——空会话曾致
ActionBar 停隐不恢复）。
审查返工收口同批落地：hover 胶囊高亮索引空间对齐过滤后锚点集（resolveLineHover
带 anchored，lineHoverMath 单测补齐 5 例）；lineText 双胶囊用例经二次拍板恢复双胶囊断言（远端胶囊照常）；lineService/lineHoverOverlay 拆回 400 行内
（quick-add host 工厂迁 lineQuickAddHost + hover 几何纯函数迁 lineHoverMath）；
popover 只读往返清开合 + 栏内收起回焦触发钮；quick-add 单撤销单元收口（LineVm
初始 state 默认 ELBOWED 对齐「新线一律折线」+ quickAddConnectedShape 的
stopCapturing 经 queueMicrotask 延后一拍——新建形状首帧几何广播的挂线 reattach
滞后写并入同捕获窗，一次 quick-add 恒一步 undo、不暴露 [0,0] 草稿中间态）。

树形图族（specs/tree-diagrams，docs/22）已落地并完成一轮审查返工（f7948fd..2c41d54）：
树命令只读早退与 kind 守卫、applySelection family 化（org 选中不再清焦点）、
org 语义统一（AddButtons 下+右/成员 N/零 direction+lineColor 污染/连线 ORG_LINE
固定灰蓝/卡片 min 120 宽）、徽标 hiddenCount 不冒泡（仅自身折叠节点显示）、
focusAfterDelete 经 kind 策略分派、preview 圆角、Toolbar 稳定 id、
treeService 383 行/treeDragController 375 行（400 铁律内），treeMapVm 300 /
treeFocusController 271 / treeOps 255（设计预算内）。三轮返工（a96681f 后）：
org 多子 ↓ 的 spanOf 主轴分派（top-down 沿 x——曾落 else 恒选最左子）、
getFocusedOrientation 对齐 TreeOrientation、darwin 三张基线经容差陷阱
（--update 在 2% 容差内不重写）删后强制重生成（md5 变化 + 目视 +
根无徽标数据断言）、双平台 --stability 逐字节全等。骨架层：mind 目录迁移
`widgets/tree`（family 'tree' 三注册表/TREE_KINDS 编译锁/公开导出冻结 +
golden 布局夹具）；折叠（collapsed 入文档、ActionBar/Cmd+. 徽标点击、
命中/导航/框选/落点排隐藏、自动展开、序列化透传）；脑图竖向（orientation
图字段、布局严格转置、连线镜像、导航键位映射、落点轴参数化、ActionBar
排列切换）；ORG_CHART（层对齐布局 + 正交总线 + 卡片样式 + 父/子/兄弟导航 +
三带落点 + 跨种类拖拽字段投影）；工具坞收编单一「树形图」入口（类型二级
菜单/kind 记忆/M/O 直达）；公开面新增 getTreeAddButtons/toggleTreeCollapse/
setTreeOrientation（旧 mind 名称全保留，68→71 成员）。

容器 / Frame 底座已落地（docs/13 阶段 4.4 容器底座，specs/container-frame，
含实施记录与八条解读回填 §16）：FRAME 控件（标题带 + 背景 + 边框；命中 =
标题带 ∪ 边框环，边框环屏幕 px 折算 8/vpScale 上限 32——内部空白不命中）；
子元素 `parentId` 归属（自由七类 optional 字段，锚定线运行时排除；判据世界
AABB 三态带滞回：全含设父/相交保持/完全离开清父，FrameService 唯一写入口
I5，与触发操作同事务 I6）；拖拽/删除/复制/微移级联带子（展开前选区
selectedIds 单独保持，归属只判用户选中件）；缩放不缩放子；图层钳制经
`IFrameLookup.computeLayerClamps`（容器恒在子之下 I3，公开面 71 不变）；
参考线参照物排除面扩为 `selected$ ∪ previewIds`；框选归并经
`createMarqueeFrameFilter` 闭包（全含才入选/子剔除/组在容器内不拆组——
几何归属优先于选择聚合）；剪贴板 parentId 桶映射（批外父置空）+ 粘贴容器先入批 + 粘贴落点归属（无父副本
完全落进容器即归属，`adoptByLanding`——创建与粘贴收尾共用，画笔/连线不参与）；
标题 plain 编辑（单击已选中标题带，Enter 恒提交，treeNodeEditor 同款）；
工具坞「容器 (C)」（f 被 view.zoomFit 占用）+ ActionBar 样式五项 + 右键
「移出容器」（updateSelectedStyle parentId 分流 detachSelection）；标题缺省
色随带底自适应（defaultTextColorForFill 同款判据，双态护栏 ≥4.5:1）。
E2E container.spec C-1..C-17 + 视觉 container-sample 双平台基线
（--stability 11 张逐字节全等）；老文档零迁移、老客户端开新文档 FRAME 隔离、parentId 未知键保留。审查返工已
收口：归属写入同事务钳制容器 zOrder（拖入路径 I3 补全 + C-7/C-10 补强 +
darwin theme 基线强制重生成 + I2 口径改「运行时排除」+ ActionBar/selector
拆分全部 <400 行）；三轮收口：undo·redo 恢复不重判（批量上下文 + 已有父两道
守卫，橡皮拆段继承 parentId，真引擎集成测试）、粘贴批容器先入批（同事务内创建
后钳制对 vm 观察者不可见——文档钳了渲染没动）、E2E 归属断言读文档真值；后续
拍板实施：VM 基类 `setState` 的 diff 基准含待合批 partial（同 tick 写回已应用值
不再丢弃）、画笔与连线不参与自动归属（模型矩形是占位值）、粘贴落点归属（无父
副本完全落进容器即归属，与粘贴同一步 undo），specs/container-frame §16。

UML 时序图批次 1（地基 + 生命线）已落地（specs/sequence-diagram，实施记录
见其 §19.1）：LIFELINE 控件——头框 + 居中标签 + 竖直虚线轴，命中 = 头框 ∪
轴带（半宽按屏幕 px 折算，轴旁空白不命中），缩放经 `constrainResize` 探针整形
（被拖边跟手、宽度以轴对称、下限 60×120），`isRouteObstacle()` 豁免避障，
schema 不带 parentId 不进容器。
标签 plain 编辑（再点头框进入、Enter 恒提交、空标签保留；plain 内核补
`textAlign`）。工具坞「时序图 (Q)」第 12 钮——`sequence` 光标模式由
SequenceService 唯一注册并按图元种类转发，种类记忆走工具默认参数通道。
通用底座：`planResize` 末位整形探针（签名带手柄方向，整形须保持被拖边）、
`platform/textEngine/labelText` 单行标签清洗 / 截断单源、拖拽创建基类 `handlers`
只读属性、连线服务六协作者迁 `lineCollaborators.ts`（lineService 397 → 368）。
E2E sequence.spec 8 例（Q-1/Q-2/Q-16/Q-18/Q-20…Q-23）；theme 双态 4 张基线随
工具坞第 12 钮重生成。挂账：暗色 theme linux 基线 `--stability` 首轮出现一次
±1 抗锯齿抖动（复跑 11 张全等，根因未定位，specs §19.1）。
±1 抗锯齿抖动（复跑 11 张全等，根因未定位，specs §19.1）。

UML 时序图批次 2（轴锚定 + 消息）已落地（specs/sequence-diagram，实施记录与偏差
见其 §19.2）：生命线实现 `getAxisAnchor` 探针并覆写 `getAnchorPoint`——连线落在
轴上（四个 join 的 t 都是轴上高度比例，x 让出一个线端留隙）；轴宿主无 quick-add
资格（`lineHitTest.canQuickAdd` 单源：不出四向连接点，连线工具悬停出轴上单点；
`hitWidget` 容差环按到轴段的距离）。落点单源 `resolveAnchorPick`：轴宿主按指针
所在侧选边、端口 4 位小数，其他宿主逐字节不变，创建数据只在端口有值时写键。
消息复用 LINE：
`ILineDrawPolicy` + 三类预设（同步实心箭头 / 异步开放箭头 / 返回虚线），工具坞
二级菜单 = 图元组 + 消息组（动态组共用当前值），SequenceService 把消息种类转发到
`lineService.drawHandlers` 并经 `drawPolicyProbe` 注入策略（只在 sequence 模式下
生效，通用连线工具不受影响）；按下必须在轴上、终点钳到起点高度、同轴纵向 ≥ 8 出
ELBOWED 自环、落空取消；草稿走非跟踪 origin 不入撤销栈，落定 = 非跟踪删草稿 +
跟踪事务建终线（消息路径在 `lineMessageDraft.ts`）。轴消息判定纯派生
（`lineAxisMessage.ts`），线身可拖、↑ ↓ 微移有效（一次写 `{ startPort, endPort,
points }`，dy 钳到两端留在轴内），线选区拖拽会话恒纵向（`DragState.axis = 'v'`，
`snapForDrag` 轴向实参），线身 hover `ns-resize`。缩放松手钩子
`onResizeCommitted(id, next, start)` 带起始矩形，`rewirePortsAfterResize` 先按旧
锚点高度重写消息端口再急切重路由（加长保高度）。前置重构：旋转手势拆出
`rectEditorRotate.ts`（rectEditorService 399 → 345 行，零行为）。E2E
sequenceMessage.spec 10 例（Q-3…Q-9、Q-15、Q-19 悬停光标部分、轴上悬停点；五处
关键门控做过变异验证）。批次 3–5（激活条 / 组合片段与打磨 / 视觉基线与收尾）待
规划。贴上限待下沉：`lineVm.ts` 397、`lineHoverOverlay.ts` 395、
`selectorService.ts` 398 行。

当前实测基线：`pnpm verify` 通过；1715 单测（core 1589 + react 88 + app 38）；
E2E 60 spec / 360 例（主配置 353 --list 实测，含 @visual 10；pwa 7 独立配置；
全量实测 358 通过 + 2 跳过（旋转手柄暂跳 specs/rotate-hide），0 failed；时序图批次 2 E2E +10 例（sequenceMessage.spec）+ 单测 +91
（specs/sequence-diagram §19.2）；时序图批次 1 E2E +8 例（sequence.spec）+ 单测 +97
（specs/sequence-diagram §19.1）；符号控件 E2E +9（symbol S-1..S-9）+ 单测 +46；
网络拓扑 +11 例 network.spec N-1..N-11 含避障豁免回归/同边
多线/项目文件往返+PNG/只读；容器底座 +18 例 container.spec C-1..C-18 +
单测 +105（specs/container-frame §8）；树形图族 19 例；flowchart 15 例；
存量修复五项 E2E +6 例（lineStyle 线型切回折线 5、imageResize 1）+
单测 +38（specs/flowchart-closeout §24、specs/image-ratio-lock）；
视觉 10/10 双平台（11 张基线含 network-sample 网络拓扑样本——4.3 交付、
container-sample 三泳道样本——4.4 交付；theme 双态 darwin/linux 随工具坞
时序图钮重生成）；
图片/资产专项 12/12；a11y 6/6；mobile 9/9；a11yKeyboard 12/12；
a11yLayout 10/10；textScale 6/6；touchPen 3/3；debugSurface 3/3；
pwa 7/7 含 P7 零探针 + dev 不注册 1）。

发布状态：当前版本 `1.0.1` 已发布（tag `v1.0.1` + GitHub Release）；仓库
public，线上地址 `https://xiezongchen.github.io/Spinth/`，`main` 的 required
check 为 `gate`。

下一阶段：常见图能力续批（docs/13 阶段 4，按 跨职能 / 泳道 → UML 时序 →
UML 类图 / ER → BPMN 顺序；标准流程图、树形图族、网络拓扑 4.3 已完成，
Phase 4 可选增强见 specs/tree-diagrams §13；**UML 时序图（4.5）分批实施中——
批次 1（地基 + 生命线）、批次 2（轴锚定 + 消息）已落地**，下一步规划批次 3
（激活条：轴上按下纵向拖、绑定生命线、条边让位；`rectEditorService` 已腾出行数，
动 lineVm / lineHoverOverlay / selectorService 前先下沉纯函数）——
specs/sequence-diagram.md §12）→
协同最后（docs/10，不进入默认启动路径）；
1.0 后可访问性与平台遗留按资源并行（docs/13 §3）。

可访问性遗留（画布内容朗读/幽灵对比度等）见 docs/13 §3 与
specs/a11y-closeout §13.5；PWA 安装与移动端真机待人工项见 specs/pwa.md §14
与 specs/oss-release.md §8.5。
