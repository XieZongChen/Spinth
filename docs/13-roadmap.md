# 13 — 路线图与决策台账

## 1. 当前基线

已完成单机基线：

- [x] Yjs 文档 + IndexedDB 双 store + undo/redo + compaction
- [x] PIXI 画布、视口、按需渲染、空间索引、culling
- [x] SHAPE / TEXT / STICKY / LINE / PEN / IMAGE / MIND_MAP
- [x] 多选、编组、对齐/分布、参考线吸附（旋转手柄入口暂隐藏，rotation 数据能力保留——specs/rotate-hide）
- [x] 富文本编辑、排版 override、marks、橡皮分段擦除
- [x] 本地资产库、图片 GC、失败回退、资产/图片生命周期（加载会话/纹理共享/保活窗口/重试/GC 分片）
- [x] 390px 移动端工具菜单
- [x] 只读态收口：右键不建选区、工具坞/操作栏/脑图按钮呈现门禁、运行时降级序列
      （docs/21 §4 只读可交互面矩阵）
- [x] 1155 单测（core 1039 + react 78 + app 38）、E2E 49 spec / 253 例（251 通过 + 2 跳过为旋转手柄用例暂跳，specs/rotate-hide）、视觉 4/4（darwin/linux 双平台基线，docs/15 §4）、图片/资产专项 12/12、`pnpm verify` 通过

当前版本 `1.0.1`（已发布，tag `v1.0.1`），仓库已开源；1.0 是首个公开 API 基线。

## 2. 阶段路线

当前执行顺序固定为五段：

| 阶段 | 主题           | 交付                                                         |
| ---- | -------------- | ------------------------------------------------------------ |
| 1    | 发布前工程债   | 拆大文件、纹理保活、边缘自动滚屏、运行时收窄                 |
| 2    | 开源发布 v1.0  | 发布清仓、仓库公开、CI 实证、GitHub Pages、v1.0.0            |
| 3    | 1.0 后平台收口 | 可访问性大项、平台人工验收、可选能力（与主计划并行，不阻塞） |
| 4    | 常见图能力     | 七类图按序检查与补足（当前主计划，见 §4）                    |
| 5    | 协同           | 最后评估；不进入默认启动路径                                 |

排序约束：

- 运行时收窄是破坏性内部 API 变更，必须在 1.0 公开前完成；1.0 后只做兼容演进。
- 拆大文件先行，降低后续三项的审查与回滚成本。
- 纹理保活与边缘自动滚屏不改 Yjs 数据面，可独立提交、独立回退。
- 开源发布要求代码面与仓库卫生稳定，排在工程债之后。
- 阶段 3 的可访问性大项与平台人工验收按资源并行，不阻塞阶段 4；未完成项继续挂账。
- 阶段 4 的七类图顺序固定，不重排；跨项底座（§4.0）在首次被需要时落地，不预造大而全。
- 协同依赖真实公开使用反馈，放最后；当前不建服务端、不改默认启动路径。

### 阶段 1 — 发布前工程债

阶段 1 内部顺序：拆大文件 → 纹理保活 → 边缘自动滚屏 → 运行时收窄。
前三项已完成（specs/split-large-files、specs/texture-keepalive、
specs/edge-auto-scroll）；运行时收窄最后，避免新代码与新探针二次迁移。

#### 1.1 拆大文件

目标：非测试源码单文件 < 400 行；单测与 E2E 按文件/功能域拆分，不套用 400 行上限，也不机械卡行数。

- [x] 核心源码（10 个 >400 行文件）：`lineMath` 拆为 geometry/route/path/handles
      域模块 + 显式 barrel；`lineService` 抽 `LineDrawSession` + `lineHitTest`；
      `dbProvider` 拆 `dbSchema`/`dbWriteQueue`/`dbMaintenance`；`viewportService`
      拆 `viewportPointerInput`/`viewportZoom`；`selectorService` 抽
      `selectorDragOps`；`boardComposition` 拆 5 个装配阶段 helper + 维护调度；
      `textService` 拆 `textEditStyle`/`textCommit`；`lineVm` 拆
      `lineVmText`/`lineVmHit`；`lineHoverOverlay` 抽 `lineHoverMath`；
      `types/widget` 外移 ActionBar 契约至 `types/actionBar`（re-export 保持
      import 路径）。
- [x] 单测（5 个 >400 行文件）：拆为 lineGeometry/lineRoute/linePinned/linePath/
      lineHandles/lineSchema、mindBuild/mindTool/mindEdit/mindSelect、dbProvider.store/
      writeQueue/compaction/readonly、mindDragLegality/Text/Drop、
      shapeInset/Height/VmRender + 3 个 `__tests__/helpers/` fixture。
- [x] E2E spec（10 个 >400 行文件）：widgets→line*/pen/eraser 8 个、
      mind→Tool/Layout/Select/NodeEdit 4 个、textEdit→Text/Shape/Style 3 个、
      image→Create/Asset/Lifecycle 3 个、toolbar→Menu/Line 2 个、align→基础+
      Anchor 2 个、group→Create/Ops 2 个、coverage→historyLayer/styleResize/
      shortcuts 3 个、multiTab→Role/Readonly 2 个、rotate→基础+Anchor 2 个；
      公共探针抽 `e2e/helpers/`（board/widget/mind/text/image + 各域 helper）。
- 拆分纪律：只移动 + 改 import，不改断言/实现/默认值；每拆一个文件独立提交；
  测试数与拆分前一致；`pnpm verify` 与相关 E2E 全绿。
- E2E 拆分排在最后：按 spec 域逐文件提交，先拆 `widgets`/`mind`/`textEdit`，
  不阻塞阶段 1 其余三项与阶段 2。
- 方案与审查：[specs/split-large-files.md](../specs/split-large-files.md)。

#### 1.2 纹理保活

- [x] `ImageTextureCache` 引用归零后进入保活窗口（默认 5s，构造参数可配）；窗口内
      重新 acquire 复用同一纹理，窗口结束仍为零引用才 `destroy(true)`。
- [x] 双上限：保活条目数 + 估算显存；超限按 LRU 立即销毁。`dispose` 全量销毁；
      页面 `pagehide` 只清**空闲**条目与保活定时器（在租条目保留，防 bfcache
      恢复后画面破损）。
- [x] 租约/GC 语义：保活条目继续持有 URL 租约并计入 GC 持活（窗口结束才归还），
      GC 不误删仍可复用的资产。
- [x] 测试：假定时器覆盖窗口内复用/窗口后销毁/超限逐出/dispose/pagehide 清理；
      undo 恢复路径断言不重复 decode（注入计数）+ E2E uid 复用断言；pagehide
      接线 E2E（清空闲/留在租）。
- 验收：`pnpm verify`；无定时器泄漏；纹理与 URL 计数在空闲前/空闲中/到期后
  平衡（1/1 → 1/1 → 0/0）。
- 规格：docs/19 §3、specs/texture-keepalive（已实施）、specs/assets-lifecycle §3.2。

#### 1.3 边缘自动滚屏

- [x] 拖拽进入视口边缘热区时 rAF 平移 viewport，并按当前屏幕坐标重放 dragMove
      补偿；速度随距边缘距离连续线性增长（docs/05 §4.5）。
- [x] 停止条件：松手、Esc、指针离开窗口、切只读、进入文本编辑；停止时清 rAF。
- [x] 覆盖画布控件拖拽与脑图节点拖拽（`isDragMoved` 同一滚屏服务）。
- [x] 与参考线吸附、选区框、ActionBar 跟随、最后一帧落库一致；禁止增量累加。
- [x] 测试：热区/线性速度曲线/停止条件/坐标补偿单测；E2E 拖到边缘后画布滚动且
      落点正确。
- 规格：specs/edge-auto-scroll（已实施）。
- 验收：`pnpm verify` + E2E 全量绿；无 rAF 泄漏；一次拖拽只写一次 Yjs。
- [ ] 手工验收五项待人工执行（specs/edge-auto-scroll §13.5）：四边四角多选/
      编组手感、0.05x/4x 缩放、Esc/切工具/只读三种停滚、脑图大树跨屏拖影、
      390px 触摸真机——机制路径已由单测/E2E 覆盖，此项为手感与真机确认。

#### 1.4 运行时收窄

- [x] 公开面从类型 allowlist 变为运行时 allowlist：`createBoard()` 唯一构造入口
      返回 `BOARD_PUBLIC_MEMBERS` 冻结投影；internal 字段不可枚举、不可读、不可调用
      （specs/runtime-narrowing §3.3/§3.4）。
- [x] 调试面分离：DEV 下 `window.__spinth` = 公开投影、`window.__spinthDebug.__debug`
      = 内部探针（四个不可枚举逃生口：engine/viewport/assetStore/
      lastAssetMaintenance）；生产构建四标记字节级零残留（产物扫描
      check-debug-bundle 接入 build），`SPINTH_E2E` 构建保留只读探针
      （`__spinth` 公开子集 + `__spinthDebug.__debug.modelCount`）。
- [x] 迁移现有 E2E 探针：内部断言改走 `__spinthDebug.__debug`；能换公开查询/
      命令的已换（`toScreenPoint`/`persistState$`/`selected$`）。
- [x] 1.0 前完成并作为公开 API 基线；1.0 后不再做破坏性收窄。
- [x] 测试：运行时 allowlist（core 单测 + debugSurface.spec 3 例）、生产构建
      探针不存在（扫描 + pwa P7 零探针）、E2E 全量绿；`BoardPublicApi` 类型锁继续保留。
- 验收：`pnpm verify` + E2E 全量；宿主侧无 internal 字段可读。
- 规格：specs/runtime-narrowing（已实施）、specs/api-surface §1.2/A9、docs/12。

### 阶段 2 — 开源发布 v1.0

#### 2.1 发布清仓

- [x] 许可证与第三方声明：`LICENSE`（MIT）、`THIRD_PARTY_NOTICES`（脚本生成，
      `pnpm license:check` 白名单门禁接入 verify）。
- [x] 对外 README：英文主文档 + 中文版（`README.zh-CN.md`），含在线 Demo、功能、
      快速开始、架构、浏览器支持、隐私、License、Contributing；截图/GIF 待补
      （specs/oss-release.md）。
- [x] 社区文件：CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、Issue/PR 模板、CHANGELOG；
      举报通道走 GitHub 私有渠道，不写入邮箱。
- [x] 版本与页面元信息：1.0.0、OG/Twitter/canonical/robots、社交预览图
      （`packages/app/public/og-image.png`）。
- [x] 仓库卫生：本机路径/密钥/邮箱/拒绝词由 `pnpm hygiene` 守护、依赖许可由
      `pnpm license:check` 守护（两者均在 verify 内每轮执行）；全历史一次性
      核对通过（提交邮箱单一、密钥零残留、无 >200KB 入库文件）。
- 验收：README 可对外；`pnpm verify` 绿；无隐私/来源残留。

#### 2.2 仓库公开与 CI 实证

- [x] 本地全量门禁绿后再改 public（`pnpm verify` 绿后转 public）。
- [x] gate/timing/multitab/visual 四个 job 实证：gate 修掉 PWA 横幅触控宽度后全绿；
      timing 层在并发派遣下出现过 1 次 bench 帧数不足（flake 记录，未升 gate）。
- [x] specs/linux-visual §14.7 两次 dispatch：普通校验（4 张基线全等）+ `visual_update`
      生成 artifact（92KB，PNG + environment + sha256）。
- [x] main 分支保护：required status checks = `gate`（strict），禁强推/删除。
- 验收：四 job 绿；visual 真门禁；dispatch 挂账关闭。

#### 2.3 GitHub Pages 上线

- [x] 子路径构建 `SPINTH_BASE=/<repo>/` + `check-pages-build`（gate 内每轮校验）。
- [x] Pages 源 = GitHub Actions（`build_type=workflow`），`pages.yml` 部署成功。
- [x] 线上验收（specs/oss-release §6.2/§8）：首屏、资源 200、CSP 零 violation、
      SW 接管、断网刷新、更新横幅全链路、Lighthouse（desktop 全阈值达标）；
      PWA 安装点击与移动端真机六项待人工（specs/oss-release §8.5）。
- [x] README Demo 链接与 badges；仓库 homepage = Pages 地址。
- 验收：Pages 地址可用；线上 smoke 全过。

#### 2.4 v1.0.0 发布

- [x] 打 tag `v1.0.0`（annotated，指向 1.0.0 功能提交）。
- [x] GitHub Release：release notes 按用户价值写。
- [x] 同步 docs/13 与 AGENTS 基线；1.0.x 只修 bug。
- 验收：Release 完整；后续破坏性变更走主版本。

### 阶段 3 — 1.0 后平台收口（并行 / 间隙）

本阶段不阻塞阶段 4：可访问性大项与平台人工验收按资源并行，完成即勾销；未完成项
继续挂在 §3 决策与挂账。

#### 3.1 可访问性

- [x] 小项先收：宿主浮层快捷键闸门、touch/pen 自动化、ActionBar 安全区性能、
      roving autoFocus 单测（specs/a11y-closeout §13.5 第 1/7/8/9 条已收口）。
- [x] 字号单位迁移（WCAG 1.4.4 文本缩放，specs/rem-typography）：铬件字号统一 rem 令牌、
      文本承载容器随根字号缩放、菜单/操作栏定位跟随实测，`check-font-units` 护栏进
      verify 与 CI gate（specs/a11y-closeout §13.5 第 3 条已收口）。
- [ ] 大项后做：画布内容朗读（独立内容层）、ToolFlyout Tab 顺序、
      ToolGhost/画布图形对比度（需产品判断）。
- 规格：specs/a11y-closeout §13.5。

#### 3.2 平台人工验收

- VoiceOver M1–M8（specs/a11y-closeout §8.7）。
- iOS/Android 添加到主屏幕的启动形态与图标裁切（specs/pwa §14）。

#### 3.3 可选能力

- 拖放 `.spinth.zip` 导入（docs/20 §1.2 当前非目标）。
- 其他按真实使用反馈立项，不预先扩表。

### 阶段 4 — 常见图能力（按序）

目标：把「能画」推进到「常见图种可用」。七类图按固定顺序推进，每类先审计
（代码 / docs / E2E / 真实样本），再拍板范围、补足或开发；每类独立提交、独立
验收、可回退。顺序不重排；跨项底座在首次被需要时落地，不预先造大而全。

#### 4.0 跨项底座（首次需要时落地）

| 底座                                         | 首次落地    | 后续复用                            | 约束                                                           |
| -------------------------------------------- | ----------- | ----------------------------------- | -------------------------------------------------------------- |
| 容器 / Frame（子元素归属、移动、裁剪、撤销） | 4.4 泳道    | 4.3 集群、4.5 组合片段、4.7 池/泳道 | 单层归属起步；group 仍是选择聚合层，不混用                     |
| 全局避障路由（第三方 obstacles）             | 4.3 网络    | 4.4–4.7                             | 扩 `IRouteElbowOptions`；先正确后视口过滤                      |
| 锚点沿边滑动 / 端口                          | 4.1 流程图  | 4.3 网络、4.6 类图                  | 同时解决同边多线汇聚与非矩形 bbox 浮空锚                       |
| 箭头族扩展（空心 / 鸦爪 / 虚线）             | 4.6 类图/ER | 4.5 时序、4.7 BPMN                  | 首尾独立语义不变；旧文档零迁移                                 |
| 两端标签 / 多重性                            | 4.6 类图/ER | 4.5 时序、4.7 BPMN                  | 单标签模型兼容扩展                                             |
| 符号注册（网络 / BPMN / UML）                | 4.3 网络    | 4.6、4.7                            | 先审计「扩 ShapeType / 符号控件 / 图标资产」，避免枚举无限膨胀 |
| 网格吸附                                     | 4.1 流程图  | 4.2–4.4、4.6、4.7                   | 只门控落点量化，不改交互期零 Yjs 写                            |
| 矢量导出 / SVG                               | 不承诺      | —                                   | 本阶段只做 PNG；SVG 需独立路径抽象，列 backlog                 |

#### 七类图总表

| #   | 图种              | 检查范围（审计）                                              | 补足 / 开发主线                                                                     | 依赖 / 底座                                       | 完成标志                                                      |
| --- | ----------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| 1   | 标准流程图        | 形状/文字/线型/箭头/标签/锚点/路由/吸附/撤销/导出与 docs 对账 | 网格吸附、白底黑框样式、沿边锚点、自环口径、级联删、拐点手柄                        | 无（底座首发）                                    | 白底黑框流程图样本；同边多线不重叠；自环文档=实现；网格可开关 |
| 2   | 组织架构 / 树     | MIND_MAP 布局/节点样式/折叠/重排/自动布局；复用 vs 新控件     | 组织架构布局 profile（上→下、折叠、节点卡）或新 ORG 控件（审计后拍板）              | 树布局、节点样式                                  | 3 层组织架构 + 折叠 + 重排 + 导出                             |
| 3   | 网络拓扑 / 架构图 | 设备符号、集群、避障、连接点、导出                            | 网络符号包；全局避障；集群框（4.4 前矩形近似）；锚点滑动复用                        | 4.1 锚点/网格；避障；4.4 容器（集群完整语义后置） | 10+ 设备 + 区域 + 正交避障线路样本                            |
| 4   | 跨职能 / 泳道图   | 容器/子元素归属/移动裁剪/撤销/嵌套/只读                       | FRAME/CONTAINER 控件；SWIMLANE 行/列表头；跨泳道连线；与 group/编组/剪贴板/导出集成 | 容器底座；4.1 锚点/网格                           | 3 泳道审批流程；移动容器带子；撤销/持久化/导出闭环            |
| 5   | UML 时序图        | 生命线/激活/消息/框架/时序语义                                | 时序图元套件（lifeline/activation/message/frame）+ 对齐吸附 + 模板；语义控件后置    | 4.4 框架；现有箭头/标签（空心等按需）             | 登录时序（3 参与者/5 消息/alt/激活）                          |
| 6   | UML 类图 / ER     | 分栏框/关系箭头/两端标签/包                                   | 分栏 CLASS/ENTITY；空心三角/菱形/鸦爪/虚线；两端多重性；包框架复用 4.4              | 4.4 容器；箭头/标签                               | 3 类类图 + ER 1:N/N:M 样本                                    |
| 7   | BPMN              | 事件/网关/任务/池泳道/消息流/校验                             | BPMN 核心子集符号；池/泳道复用 4.4；消息流；可选校验                                | 4.4/4.3/4.6                                       | 订单审批（2 池 3 泳道/事件/网关/任务/消息流）                 |

#### 4.1 标准流程图

**现状（审计起点）**：20 型形状 + 图形内富文本（内接换行 / autoHeight / per-实例
排版）；线型 STRAIGHT / ELBOWED / CURVE，ELBOWED 走廊 30/60/90、R14、共线合并、
抖动拉直；首尾独立箭头（open / solid / diamond + none）；单标签 + ratio；锚定
跟随、quick-add、段滑移 + pinned；对齐 6 + 分布 2、参考线（粘滞 / 端部链）、
编组、undo；PNG 与项目文件。已知文档漂移：docs/08 §5 箭头写四种（实现三型 +
none）、docs/08 §7 自环写同 widget 删除（`settle` 只判起终点距离）。

**检查范围（审计）**

- 形状 / 文字 / 线型 / 箭头 / 标签 / 锚点 / 路由 / 吸附 / 撤销 / 导出的 docs 与
  实现逐项对账。
- 白底黑框样式、描边宽度、同边多线汇聚、非矩形形状锚点、网格吸附、自环、
  断头线、拐点、线跳。
- 真实样本：含分支、回边、子流程、跨列节点的流程图。

**补足 / 开发（MVP）**

- 网格吸附开关：落点量化，交互期零 Yjs 写，松手落库；与参考线 / 对齐共存。
- 形状描边样式：`borderColor` / `borderWidth`（或预设）与无填充 / 透明填充，
  optional 零迁移；覆盖「白底黑框」。
- 锚点沿边滑动：同边多线不重叠；非矩形形状用轮廓交点替代 bbox 边中点。
- 自环口径收口：docs/08 §7 与实现二选一（同 widget 删除，或显式紧凑自环）；
  明确不同节点的回边可用。
- 删除节点时关联线：默认保留现状，补显式「删除关联线」命令或提示。
- 拐点手柄（显式 waypoint）与段滑移并存。
- 文档收口：箭头三型 + none、自环、锚点。

**完成标志**：白底黑框流程图样本；同边多线不重叠；自环文档 = 实现；断头线可
一键清理；网格吸附可开关；E2E + 视觉基线；`pnpm verify` 绿。
**规格**：specs/flowchart-closeout.md（实施时建）。

#### 4.2 组织架构 / 树

**现状（审计起点）**：MIND_MAP 是单 widget + 递归节点树；左右布局、文本节点、
拖拽重排 / 跨图、Tab/Enter、方向键、删除、整图移动；无折叠、无上→下布局、
无组织卡字段（姓名 / 职务 / 部门）；模板系统已移除（docs/11 §0）。

**检查范围（审计）**

- MIND_MAP 的布局 / 节点样式 / 折叠 / 排序 / 增删 / 撤销 / 导出；组织架构真实
  样本（CEO → 部门 → 组）。
- 方案：MIND_MAP 布局 profile（`layout: 'mind' | 'org'`）vs 新 ORG_CHART 控件
  vs 形状 + 正交线模板；节点字段是否必须结构化。
- 上→下 tidy tree、同级间距、节点尺寸随文本、折叠 / 展开、跨部门排序。

**补足 / 开发（审计后拍板；MVP 优先 A）**

- A：MIND_MAP 增组织架构布局 profile——上→下、层 / 同级间距、正交连接线、
  节点卡样式、折叠 / 展开；复用增量树 / 拖拽 / 快捷键 / 整图移动。
- B：新 ORG_CHART 控件（结构化字段 / 部门列）；成本高，作为 A 不满足时的后置。
- 无自动布局的兜底：形状 + 正交线模板文档 / 示例，不作主路径。

**完成标志**：3 层组织架构、折叠、重排、导出；E2E / 视觉；docs/11 同步（若改
MIND_MAP 语义）。
**规格**：specs/org-chart.md（实施时建）。

#### 4.3 网络拓扑 / 架构图

**现状（审计起点）**：20 型含 `eng-*`；无 server / router / switch / firewall /
cloud 等设备符号；IMAGE 可放外部图标；无集群容器；路由只避两端节点；锚点四边
中点，多线汇聚。

**检查范围（审计）**

- 设备 / 云 / 区域 / 集群符号清单；符号承载（扩 ShapeType vs 独立符号控件 vs
  图标资产）；连接点 / 端口；避障范围；集群框；导出。
- 真实样本：客户端 / 网关 / 服务 / DB + 云区域 + 负载均衡。

**补足 / 开发**

- 网络符号包（server / router / switch / firewall / cloud / LB / user /
  internet / DB 等）；先定承载方式，4.6 / 4.7 复用。
- 全局避障：`routeElbow` 扩第三方 obstacles（保留首末段豁免）；调用方收集
  可视 / 邻近 bounds；先正确后性能；可选 line jump。
- 集群 / 区域：4.4 容器落地前用矩形 + 标题 + 分组近似，容器落地后升级 Frame；
  不提前造完整容器。
- 锚点沿边滑动 / 端口复用 4.1。

**完成标志**：10+ 设备、区域 / 集群、正交线路避障的拓扑图；E2E / 视觉。
**依赖**：4.1 锚点 / 网格；全局避障；4.4 容器（集群完整语义）。
**规格**：specs/network-diagram.md（实施时建）。

#### 4.4 跨职能 / 泳道图

**现状（审计起点）**：group 是选择聚合层（成员仅 groupId 标记）——无渲染单元、
无标题、无组级变换、无容器型子元素归属、无裁剪；无泳道（docs/18 §1 非目标）。

**检查范围（审计）**

- 容器数据模型（显式 parentId vs 几何包含）、子元素移动 / 删除 / 复制 / 撤销、
  嵌套、裁剪、z-order、culling / 空间索引、只读、项目文件、导出。
- 泳道（行 / 列、标题、跨泳道连线、lane header）；与 group / 编组 / Alt 直选
  的关系。
- 真实样本：3 泳道审批流程。

**补足 / 开发**

- FRAME / CONTAINER 控件（三件套 + 注册）：标题 / 背景 / 边框；子元素归属
  （MVP 显式 parentId）；移动容器带子；resize 不缩放子元素；删除容器默认删子 /
  可配置；嵌套 v1 单层；裁剪可选；编组 / 对齐 / 参考线 / 复制粘贴 / 撤销 /
  只读 / 项目文件 / 导出 / culling 集成。
- SWIMLANE：容器上行 / 列泳道 + 表头；跨泳道连线；MVP 可先 FRAME + 手工泳道
  矩形，后续升级 SWIMLANE 控件。
- 交互：点容器选容器、Alt / 双击进子元素；移动 / 复制 / 删除；层级。

**完成标志**：容器数据 / 交互 / 撤销 / 持久化 / 导出 / 只读闭环；3 泳道样本；
E2E / 视觉；docs/04 / 05 / 18 同步。
**依赖**：4.1 锚点 / 网格（复用）；容器新底座；BPMN 依赖它。
**规格**：specs/container-frame.md（实施时建）。

#### 4.5 UML 时序图

**现状（审计起点）**：无生命线 / 激活条 / 消息语义 / 组合片段；线三型、单标签、
三型箭头；框架依赖 4.4。范围界定：时序图 = 生命线 / 时间轴 / 消息序列，不是
泳道图；泳道容器只用于组合片段框架，不复用 lane 语义。

**检查范围（审计）**

- UML 2.5 sequence 子集：participant / actor、lifeline、activation、
  sync / async / return、create / destroy、alt / loop / opt、guard。
- 语义控件 vs 图元套件 + 模板；是否新建 SEQUENCE 控件（数据 / 布局 / 编辑 /
  排序 / 导出）；与容器 / 箭头 / 标签的关系。
- 真实样本：登录时序（3 参与者、5 消息、alt、激活）。

**补足 / 开发（审计后拍板；MVP 优先 A）**

- A（图元套件）：lifeline 形状（头 + 虚线 + 高度）、activation 条、message
  线型（实线开箭头 / 虚线回箭头 / 异步）、消息标签、组合片段（4.4 FRAME 或
  专用 frame 形状）；生命线对齐 / 吸附；模板；不做语义模型。
- B（后置）：SEQUENCE 语义控件（参与者 / 消息序列 / 自动布局 / 编号 / 导出），
  成本高。
- 复用：4.4 容器（框架）；现有 open / solid / dashed 箭头与标签够起步，
  4.6 的空心 / 鸦爪按需回用。

**完成标志**：登录时序图可完成（生命线 / 激活 / 消息 / alt）；E2E / 视觉；
docs/08 / 04 同步。
**依赖**：4.4 容器 / 框架；箭头 / 标签按需扩展（不前置 4.6）。
**规格**：specs/sequence-diagram.md（实施时建）。

#### 4.6 UML 类图 / ER

**现状（审计起点）**：SHAPE 单文本框；无分栏；箭头 open / solid / diamond +
none；单标签；无表格；无空心三角 / 菱形 / 鸦爪；包 / 框架依赖 4.4。

**检查范围（审计）**

- class 分栏（名称 / 属性 / 方法）、ER 实体（表名 / 字段 / 类型 / 主键 / 外键）、
  关系（继承 / 实现 / 关联 / 聚合 / 组合 / 依赖 / ER 基数）、两端标签、包 / 框架。
- 新 CLASS / ENTITY 形状 vs 扩展 SHAPE sections；箭头扩展；标签扩展；自动布局
  （可选）；旧文档零迁移。
- 真实样本：3 类类图 + ER 1:N / N:M。

**补足 / 开发**

- 分栏形状：CLASS 三栏 / ENTITY 表格式（行 / 列）或类表格；逐栏文本；
  autoHeight；编辑会话接入；resize。
- 箭头族：hollow-triangle（继承 / 实现）、hollow-diamond（聚合）、
  filled-diamond（组合）、open-arrow（关联）、dashed-dependency；ER crow's
  foot（one / many / zero / one）；首尾独立不变。
- 两端标签：startText / endText 或多重性（两端独立）；旧文档零迁移；镂空 / 布局。
- 包 / 框架复用 4.4；自动布局可选。
- 文档：箭头语义矩阵、ER 基数。

**完成标志**：类图 + ER 样本；箭头 / 标签正确；E2E / 视觉；docs/08 / 04 同步。
**依赖**：4.4 容器；箭头 / 标签本阶段。
**规格**：specs/uml-er.md（实施时建）。

#### 4.7 BPMN

**现状（审计起点）**：无 BPMN 符号；池 / 泳道依赖 4.4；避障依赖 4.3；箭头族
依赖 4.6；无 BPMN 校验 / 导入导出。

**检查范围（审计）**

- 范围：BPMN 2.0 核心子集（start / intermediate / end events；exclusive /
  parallel / inclusive gateways；task / user / service；subprocess；pool /
  lane；sequence flow / message flow；边界事件可选）。
- 符号承载（扩 SHAPE vs BPMN 专用控件 / 符号注册）；连接规则 / 校验（可选）；
  导入 / 导出不做。
- 真实样本：订单审批（2 池 / 3 泳道、开始 / 结束、排他网关、任务、消息流）。

**补足 / 开发**

- BPMN 符号子集（形状 / 图标 / 端口）；池 / 泳道复用 4.4；消息流虚线 + 开箭头；
  网关 / 事件标记；任务类型标记。
- 可选校验：同池 sequence flow、跨池 message flow、起止事件、网关分支；先符号
  正确后校验。
- 不做：执行语义、BPMN XML 导入导出、完整合规。

**完成标志**：订单审批样本；符号 / 池泳道 / 消息流正确；E2E / 视觉；docs 同步。
**依赖**：4.4 容器 / 泳道、4.3 避障、4.6 箭头 / 标签、符号注册。
**规格**：specs/bpmn.md（实施时建）。

#### 4.8 执行纪律

- 每项顺序：审计（代码 / docs / E2E / 真实样本）→ 范围拍板 → `specs/<feature>.md`
  （检查结论、验收清单、手工步骤）→ types → 纯逻辑 + 单测 → VM / Service →
  E2E / 视觉基线 → docs 同步。
- 每项独立提交、可回退；不跳序。底座在首次被需要时落地；若某底座阻塞当前项，
  把它提前到当前项内实现，并保持后续复用接口稳定。
- 新控件走三件套 + 注册表；不改 dataEngine / vmEngine；公共 API 增量走
  allowlist / 类型锁；新控件必须同时接入只读、持久化、导出、剪贴板、撤销。
- 完成前 `pnpm verify` + 相关 E2E；关键图种补视觉基线；样本图进入 E2E 夹具。
- 本阶段不做：服务端 / 协同、SVG 导出（backlog）、BPMN 执行语义 / XML、UML
  模型校验（MVP 不做）。

### 阶段 5 — 协同（最后）

- 前置评估按 docs/10；只有 1.0 稳定且有真实多设备需求才启动。
- 不建 `packages/server`，不把 `y-websocket` 放进默认启动路径，不改单机离线语义。
- 启动时先补 editBlocked 交互面矩阵（docs/21 §4）与 Awareness/wsProvider 边界。

### 已完成批次（归档）

- 项目导出/导入（docs/20）、多标签单写者/只读（docs/21）、存储可靠性（docs/02 §6.1）。
- 资产/图片生命周期（docs/19）、纹理保活（specs/texture-keepalive.md）、PWA/Service Worker（specs/pwa.md）。
- Linux 视觉基线（specs/linux-visual.md）、API 收口（specs/api-surface.md）。
- 可访问性批次 A/B（specs/a11y-mobile.md、specs/a11y-closeout.md）。

## 3. 决策与挂账

- 阶段顺序：工程债 → 开源发布 → 1.0 后平台收口（并行）→ 常见图能力（主计划）→
  协同；协同不进入当前版本默认路径。
- 1.0 是首个公开 API 基线：运行时公共面 = `createBoard()` 冻结投影 + DEV 调试入口（specs/runtime-narrowing）；1.0 后破坏性变更走主版本。
- 纹理保活窗口期条目继续持有 URL 租约并计入 GC 持活（specs/texture-keepalive D1）；保活不让 GC 误删仍可复用的资产（docs/19 §3）。
- 边缘自动滚屏只作用于拖拽，不改视口持久化；线性速度与停止条件按 docs/05 §4.5。
  三路拖拽同属滚屏：元素拖拽、脑图节点拖拽、框选（框选以屏幕位移起拖判据门控滚屏、
  选中集按帧去重，specs/marquee-auto-scroll）。
- 空间索引 + culling 的 MIND_MAP 豁免：树增长不触发几何 diff，整图一个渲染单元；
  索引会过期，因此豁免 culling。
- LINE 选区交互：线不可整体拖动/缩放；拖线身 = 段滑移，端点 = 重锚定。
- 纹理按 assetId 共享（引用归零进保活窗口、窗口结束销毁；data/http 不缓存）、
  GC 单轮软预算 + mark 中断零删除（docs/19、specs/texture-keepalive）。
- 多标签：单写者 + 只读跟随，接管 = 整页刷新，不做实时同步（docs/21）。
- 只读态收口分层：core 修语义（右键不建选区、降级序列、工具钳制），react 修呈现（持久铬件禁用、浮动件随附着对象隐藏）；命令层守卫是安全网不是呈现面（docs/21 §4）。
- 项目文件格式、导入语义、ZIP 依赖：`fflate` + `.spinth.zip`、导入新建画布、外链保留 + warning、未知条目忽略 + warning（docs/20）。
- 颜色按角色拆分而非深浅拆分：`danger` 留给图形（≥3:1）、文字走 `danger-ink`
  （≥4.5:1）；`accent` 留给品牌/焦点环、填充按钮走 `accent-fill`+`on-accent`；
  不做「危险填充白字」（soft 底 + ink 字替代）。护栏在 `a11y.spec.ts`（CSSOM 取色）。
- 单机断网不做 editBlocked 矩阵：无 `wsUrl` 即无阻断路径，用「断言 OfflineBar
  不出现 + 断网仍可编辑/撤销/落盘」固化不变量（docs/10 §4）；`wsUrl` 进入启动
  路径时该测试先红，提醒补矩阵。
- PWA/Service Worker 已落地：manifest + 子路径 SW + 预缓存清单 + 可控更新横幅
  （specs/pwa.md）。Linux 视觉基线已落地（specs/linux-visual），平台侧剩余
  挂账为 CI 实证（Actions 恢复后普通 + update 两次 dispatch 补验）。
- 视觉基线不保留「靠未跟踪 actuals 假绿」的做法；基线必须入库并由
  `check-visual-baselines` 守护。
- 协同挂账：editBlocked 交互面矩阵（等 `wsUrl` 进入启动路径，与只读独立，
  docs/21 §4）。
- 可访问性遗留：画布内容元素级朗读（canvas 文本镜像/读屏游标，需独立内容层）、
  ToolGhost/画布图形对比度（幽灵预览非文本图形，是否抬 3:1 需产品判断）、
  ToolFlyout 的 Tab 顺序（portal 方案与 390px 裁剪约束冲突，需另案权衡）——
  specs/a11y-closeout §13.5；图标随字号缩放与字号刻度归一另案（specs/rem-typography §13.4）。
- 开源发布定案：许可 MIT；对外文档双语（`README.md` 英文主文档 + `README.zh-CN.md`）；
  提交元数据保留原样，不重写历史；暂不使用自定义域名，Demo 与 canonical 固定为
  `https://xiezongchen.github.io/Spinth/`。
- 第三方许可声明由脚本生成并进 verify（`THIRD_PARTY_NOTICES.md` 不手改）；
  依赖许可白名单含 13 项，`MPL-2.0` 只允许出现在构建期依赖。
- 版本策略（1.0 起）：1.0.x 只修 bug，破坏性变更走主版本。
