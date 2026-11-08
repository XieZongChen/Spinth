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
- [x] 1148 单测（core 1032 + react 78 + app 38）、E2E 49 spec / 251 例（249 通过 + 2 跳过为旋转手柄用例暂跳，specs/rotate-hide）、视觉 4/4（darwin/linux 双平台基线，docs/15 §4）、图片/资产专项 12/12、`pnpm verify` 通过

当前版本 `1.0.1`（已发布，tag `v1.0.1`），仓库已开源；1.0 是首个公开 API 基线。

## 2. 阶段路线

当前执行顺序固定为四段：

| 阶段 | 主题          | 交付                                              |
| ---- | ------------- | ------------------------------------------------- |
| 1    | 发布前工程债  | 拆大文件、纹理保活、边缘自动滚屏、运行时收窄      |
| 2    | 开源发布 v1.0 | 发布清仓、仓库公开、CI 实证、GitHub Pages、v1.0.0 |
| 3    | 1.0 后        | 可访问性大项、平台人工验收、可选能力              |
| 4    | 协同          | 最后评估；不进入默认启动路径                      |

排序约束：

- 运行时收窄是破坏性内部 API 变更，必须在 1.0 公开前完成；1.0 后只做兼容演进。
- 拆大文件先行，降低后续三项的审查与回滚成本。
- 纹理保活与边缘自动滚屏不改 Yjs 数据面，可独立提交、独立回退。
- 开源发布要求代码面与仓库卫生稳定，排在工程债之后。
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

### 阶段 3 — 1.0 后

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

### 阶段 4 — 协同（最后）

- 前置评估按 docs/10；只有 1.0 稳定且有真实多设备需求才启动。
- 不建 `packages/server`，不把 `y-websocket` 放进默认启动路径，不改单机离线语义。
- 启动时先补 editBlocked 交互面矩阵（docs/21 §4）与 Awareness/wsProvider 边界。

### 已完成批次（归档）

- 项目导出/导入（docs/20）、多标签单写者/只读（docs/21）、存储可靠性（docs/02 §6.1）。
- 资产/图片生命周期（docs/19）、纹理保活（specs/texture-keepalive.md）、PWA/Service Worker（specs/pwa.md）。
- Linux 视觉基线（specs/linux-visual.md）、API 收口（specs/api-surface.md）。
- 可访问性批次 A/B（specs/a11y-mobile.md、specs/a11y-closeout.md）。

## 3. 决策与挂账

- 阶段顺序：工程债 → 开源发布 → 1.0 后 → 协同；协同不进入当前版本默认路径。
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
